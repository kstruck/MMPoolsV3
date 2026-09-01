// Expert profiles (ADR 0005 decision 4 / PLAN-PLAYER-PROFILES Phase 6).
//
// Grades the ingested per-game expert predictions (nfl_games/{id}.expertPredictions —
// espnFpi + vegas, see expertPicks.ts) against final scores into a SERVER-ONLY store
//   expertResults/{expertId}/seasons/{season}_{seasonType}
// and renders each expert through the SAME projection shape as players:
//   publicProfiles/expert_espnFpi, publicProfiles/expert_vegas (subjectKind EXPERT).
// Experts have no pools, entries, fees, or Profit — buildPublicProfile nulls money for
// EXPERT subjects. Straight-up grading for both experts (a favorite-vs-spread record is
// definitionally ~50% and would be noise); EVEN / missing predictions grade VOID-or-skip.
// Best-effort and isolated like the ingestion job: failures never block anything else.
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { EXPERT_SUBJECT_IDS } from "./shared/profile";
import { buildPublicProfile, type ProfilePoolInput } from "./lib/profileBuild";
import type { PickSide } from "./expertPicks";
import { withHeartbeat } from "./lib/heartbeat";
import { assertCallerRole } from "./lib/assertRole";
import { z } from "zod";

type Firestore = admin.firestore.Firestore;

const EXPERTS: Array<{ key: 'espnFpi' | 'vegas'; subjectId: string; displayName: string }> = [
  { key: 'espnFpi', subjectId: EXPERT_SUBJECT_IDS.espnFpi, displayName: 'ESPN FPI' },
  { key: 'vegas', subjectId: EXPERT_SUBJECT_IDS.vegas, displayName: 'Vegas Line' },
];

export interface ExpertGameGrade {
  pick: string;
  result: 'W' | 'L' | 'PUSH' | 'VOID';
  away: string;
  home: string;
}

/** Straight-up grade of one expert prediction vs a concluded game. null = nothing to grade. */
export function gradeExpertGame(side: PickSide | undefined, game: any): ExpertGameGrade | null {
  if (!side) return null;
  const away = game.awayTeam?.abbreviation || '';
  const home = game.homeTeam?.abbreviation || '';
  if (side === 'EVEN') return { pick: '', result: 'VOID', away, home };
  const pick = side === 'HOME' ? home : away;
  if (game.status === 'CANCELLED') return { pick, result: 'VOID', away, home };
  if (game.status !== 'FINAL') return null;
  const hs = game.scores?.home ?? 0;
  const as = game.scores?.away ?? 0;
  if (hs === as) return { pick, result: 'PUSH', away, home };
  const winner = hs > as ? home : away;
  return { pick, result: pick === winner ? 'W' : 'L', away, home };
}

/**
 * Grade one (season, seasonType) for every expert and rebuild their public profiles
 * from ALL stored seasons. Idempotent full overwrite of the season doc.
 */
export async function recomputeExpertProfiles(
  db: Firestore,
  season: string,
  seasonType: number,
): Promise<{ graded: Record<string, number> }> {
  const gamesSnap = await db.collection('nfl_games')
    .where('season', '==', season)
    .where('seasonType', '==', seasonType)
    .get();

  const graded: Record<string, number> = {};

  for (const expert of EXPERTS) {
    // weeklyResults in the Pickem shape so the shared builder consumes it verbatim.
    const weeklyResults: Record<number, any> = {};
    let count = 0;
    for (const doc of gamesSnap.docs) {
      const g: any = doc.data();
      const grade = gradeExpertGame(g.expertPredictions?.[expert.key]?.pick, g);
      if (!grade) continue;
      const wk = Number(g.week);
      const week = weeklyResults[wk] || { correct: 0, total: 0, points: 0, mode: 'STRAIGHT', games: {} };
      week.games[doc.id] = grade;
      if (grade.result !== 'VOID') {
        week.total++;
        if (grade.result === 'W') { week.correct++; week.points++; }
      }
      weeklyResults[wk] = week;
      count++;
    }
    graded[expert.key] = count;

    await db.collection('expertResults').doc(expert.subjectId)
      .collection('seasons').doc(`${season}_${seasonType}`)
      .set({ season, seasonType, weeklyResults, updatedAt: FieldValue.serverTimestamp() });

    // Rebuild the public profile from ALL stored seasons (cheap: a handful of docs).
    const seasonsSnap = await db.collection('expertResults').doc(expert.subjectId)
      .collection('seasons').get();
    const inputs: ProfilePoolInput[] = seasonsSnap.docs.map(d => {
      const data: any = d.data();
      return {
        poolId: `expert:${d.id}`, // internal only — builder publishes no pool identifiers
        poolName: expert.displayName,
        poolType: 'NFL_PICKEM',
        pickMode: 'STRAIGHT',
        season: String(data.season),
        entry: { weeklyResults: data.weeklyResults || {} },
        finalRank: null,
        awardsWon: 0,
        feeOwed: 0,
        feeEstimated: false,
        finalized: false,
        payoutsRecorded: false,
      };
    });

    const profile = {
      ...buildPublicProfile(expert.subjectId, expert.displayName, 'EXPERT', inputs),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await db.collection('publicProfiles').doc(expert.subjectId).set(profile);
  }

  return { graded };
}

/** The (season, seasonType) pairs with recent activity — what's worth (re)grading. */
async function activeSeasonPairs(db: Firestore, now: number): Promise<Array<{ season: string; seasonType: number }>> {
  const snap = await db.collection('nfl_games')
    .where('startTime', '>=', now - 10 * 24 * 60 * 60 * 1000)
    .where('startTime', '<=', now)
    .get();
  const pairs = new Map<string, { season: string; seasonType: number }>();
  for (const d of snap.docs) {
    const g: any = d.data();
    if (!g.season) continue;
    pairs.set(`${g.season}_${g.seasonType}`, { season: String(g.season), seasonType: Number(g.seasonType || 2) });
  }
  return [...pairs.values()];
}

/** Daily: grade recently active seasons + refresh expert profiles. Best-effort. */
export const gradeExpertProfilesJob = onSchedule(
  // 03:00 ET. Was '0 7 * * *' unpinned == 07:00 UTC == 03:00 ET during EDT;
  // now fixed at 03:00 ET year-round. See the DST note in
  // __tests__/scheduleTimezones.test.ts.
  { schedule: '0 3 * * *', timeZone: 'America/New_York' },
  withHeartbeat('gradeExpertProfilesJob', async () => {
  const db = admin.firestore();
  try {
    const pairs = await activeSeasonPairs(db, Date.now());
    for (const p of pairs) {
      const r = await recomputeExpertProfiles(db, p.season, p.seasonType);
      console.log(`[expertProfiles] ${p.season}/${p.seasonType}:`, r.graded);
    }
    if (pairs.length === 0) console.log('[expertProfiles] no active season window; nothing to grade.');
  } catch (e) {
    console.error('[expertProfiles] failed:', e);
  }
}));

/** On-demand (SUPER_ADMIN — claim+doc agreement, PLAN-AUDIT-AUTH-HARDENING A1): grade a specific season now. */
export const refreshExpertProfiles = onCall(async (request) => {
  await assertCallerRole(request, 'SUPER_ADMIN');
  // Typed parse (PLAN-API-TRUST-BOUNDARY Phase 2): the old
  // `Number(seasonType || 2)` accepted NaN into the recompute's query.
  const parsed = refreshExpertProfilesSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpsError('invalid-argument', `Invalid request: ${issue?.path?.join('.') || '(root)'} — ${issue?.message ?? 'validation failed'}`);
  }
  return recomputeExpertProfiles(admin.firestore(), parsed.data.season, parsed.data.seasonType);
});

/**
 * season: year-ish string ("2026"); seasonType: 1 (pre) | 2 (regular) | 3
 * (post), default 2 — matching the scheduled job's activeSeasonPairs shapes.
 * Number-or-string season accepted (both transports exist). PURE zod, local:
 * the module already mixes schedule + callable concerns.
 */
export const refreshExpertProfilesSchema = z.object({
  season: z.union([z.string().trim().min(1).max(16), z.number().int()]).transform(String),
  seasonType: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().default(2),
});
