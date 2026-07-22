import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { isReservedSubjectId } from "./shared/profile";
import { withHeartbeat } from "./lib/heartbeat";

/**
 * Site-wide weekly averages for the Performance Chart's "league average" line
 * (original Player Profiles requirement: player's line vs an average line; CONTEXT.md:
 * league averages are REAL aggregates, never hardcoded constants).
 *
 * Daily job folds every PLAYER publicProfiles doc's weekly rows into
 * publicProfiles/_siteAverages — one doc, world-readable via the existing
 * publicProfiles rule, served to the chart alongside the player's own rows.
 * Experts and reserved ids are excluded (an expert in the average would skew the
 * "league"). '_siteAverages' itself can never collide with a real uid (auto uids
 * are 28-char alphanumerics — no underscore).
 */

export interface SiteAverageRow {
  season: string;
  week: number;
  avgAccuracy: number; // mean of per-player weekly accuracy, players with picks that week
  players: number;
}

/** Pure fold: player profiles' weekly rows -> per (season, week) averages. */
export function computeSiteAverages(
  profiles: Array<{ subjectKind?: string; weekly?: Array<{ season: string; week: number; correct: number; total: number }> }>,
): SiteAverageRow[] {
  const agg = new Map<string, { season: string; week: number; sumAcc: number; players: number }>();
  for (const p of profiles) {
    if (p.subjectKind === 'EXPERT') continue;
    for (const w of p.weekly || []) {
      if (!w || !(w.total > 0)) continue;
      const key = `${w.season}|${w.week}`;
      const a = agg.get(key) || { season: w.season, week: w.week, sumAcc: 0, players: 0 };
      a.sumAcc += (w.correct / w.total) * 100;
      a.players++;
      agg.set(key, a);
    }
  }
  return [...agg.values()]
    .map(a => ({ season: a.season, week: a.week, avgAccuracy: Math.round(a.sumAcc / a.players), players: a.players }))
    .sort((a, b) => (a.season === b.season ? a.week - b.week : a.season.localeCompare(b.season)));
}

export async function recomputeSiteAverages(db: admin.firestore.Firestore): Promise<{ rows: number; profiles: number }> {
  // Field projection: profiles carry sizable arrays (pickHistory, teamByTeam) the
  // average never reads — fetch only the two fields the fold consumes. If the user
  // base ever makes even this heavy, page with orderBy(documentId()).startAfter()
  // and fold incrementally (computeSiteAverages is a pure fold either way).
  const snap = await db.collection('publicProfiles').select('weekly', 'subjectKind').get();
  const profiles = snap.docs
    .filter(d => !isReservedSubjectId(d.id) && d.id !== '_siteAverages')
    .map(d => d.data() as any);
  const weekly = computeSiteAverages(profiles);
  await db.collection('publicProfiles').doc('_siteAverages').set({
    kind: 'SITE_AVERAGES',
    weekly,
    profilesCounted: profiles.length,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { rows: weekly.length, profiles: profiles.length };
}

/** Daily refresh (cheap: one collection scan, bounded by user count). Best-effort. */
export const siteAveragesJob = onSchedule(
  // 03:30 ET. Was '30 7 * * *' unpinned == 07:30 UTC == 03:30 ET.
  { schedule: '30 3 * * *', timeZone: 'America/New_York' },
  withHeartbeat('siteAveragesJob', async () => {
  try {
    const r = await recomputeSiteAverages(admin.firestore());
    console.log(`[siteAverages] ${r.rows} week-rows from ${r.profiles} profiles`);
    return { detail: { rows: r.rows, profiles: r.profiles } };
  } catch (e) {
    // The catch keeps a scheduled failure from becoming an unhandled rejection,
    // but the run did NOTHING. Without this the heartbeat would call that
    // healthy — the failure mode the wrapper exists to end.
    console.error('[siteAverages] failed:', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}));

/** On-demand refresh (SUPER_ADMIN). */
export const refreshSiteAverages = onCall(async (request) => {
  if (!request.auth || request.auth.token?.role !== 'SUPER_ADMIN') {
    throw new HttpsError('permission-denied', 'Super Admin only.');
  }
  return recomputeSiteAverages(admin.firestore());
});
