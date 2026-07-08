// Player Profile projection (ADR 0004). Aggregates a user's REAL performance across all the
// NFL pools they've entered into a sanitized, world-readable publicProfiles/{uid} doc — never
// exposing the private per-user docs or another pool's un-revealed picks (only scored weeks are
// included, which are inherently reveal-safe). Server-maintained; recomputed idempotently from
// authoritative entry state.
//
// v1 covers overall accuracy + weekly record + performance-chart series + pools/seasons entered.
// Team-by-team (needs per-pick results, not just weekly counts), detailed pick history, and
// Profit (needs PAYOUT ledger events) are follow-ups — the profile renders honest empty states
// for those until the data exists.
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { NFL_SEASON_TYPES } from "./shared/poolTypes";

type Firestore = admin.firestore.Firestore;

interface WeeklyRec { poolId: string; poolName: string; season: string; week: number; correct: number; total: number; points: number }

export async function recomputeUserProfile(db: Firestore, uid: string): Promise<any> {
  const userSnap = await db.collection('users').doc(uid).get();
  const userName = userSnap.data()?.name || 'Player';

  const partSnap = await db.collection('users').doc(uid).collection('participations').get();
  const weekly: WeeklyRec[] = [];
  const seasons = new Set<string>();
  let correct = 0, total = 0, points = 0, poolsEntered = 0;

  for (const p of partSnap.docs) {
    const part: any = p.data();
    if (!NFL_SEASON_TYPES.includes(part.type)) continue; // NFL season pools only for v1
    const poolId = part.poolId || p.id;
    const entrySnap = await db.collection('pools').doc(poolId).collection('entries').doc(uid).get();
    if (!entrySnap.exists) continue;
    const entry: any = entrySnap.data();
    poolsEntered++;
    const poolSnap = await db.collection('pools').doc(poolId).get();
    const pool: any = poolSnap.data() || {};
    const season = String(pool.season || part.season || '');
    if (season) seasons.add(season);

    // weeklyResults keys are SCORED weeks -> reveal-safe to publish.
    const wr = entry.weeklyResults || {};
    for (const wk of Object.keys(wr)) {
      const r = wr[wk];
      weekly.push({ poolId, poolName: pool.name || 'Pool', season, week: Number(wk), correct: r.correct || 0, total: r.total || 0, points: r.points || 0 });
      correct += r.correct || 0; total += r.total || 0; points += r.points || 0;
    }
  }

  weekly.sort((a, b) => (a.season === b.season ? a.week - b.week : a.season.localeCompare(b.season)));

  const profile = {
    uid,
    userName,
    overall: {
      accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      correct, total, points,
      poolsEntered,
      seasonsPlayed: seasons.size,
    },
    weekly, // performance chart + weekly record table read from this
    // Honest stubs (need more backend — see header):
    teamByTeam: [] as any[],
    profit: null as number | null,
    updatedAt: FieldValue.serverTimestamp(),
  };

  await db.collection('publicProfiles').doc(uid).set(profile, { merge: true });
  return profile;
}

/** Recompute a user's profile when their entry changes (scored/picks). Bounded to that user. */
export const onEntryChangedRecomputeProfile = onDocumentWritten('pools/{poolId}/entries/{entryId}', async (event) => {
  const after = event.data?.after?.data() as any | undefined;
  const before = event.data?.before?.data() as any | undefined;
  const uid = after?.ownerUid || before?.ownerUid || event.params.entryId;
  if (!uid) return;
  // Only recompute when scored results or picks changed (skip pure payment writes).
  const changed = JSON.stringify(after?.weeklyResults) !== JSON.stringify(before?.weeklyResults)
    || JSON.stringify(after?.picks) !== JSON.stringify(before?.picks)
    || (after?.totalScore !== before?.totalScore);
  if (!changed) return;
  try { await recomputeUserProfile(admin.firestore(), uid); }
  catch (e) { console.error(`[profile] recompute failed for ${uid}:`, e); }
});

/** On-demand recompute (self or SUPER_ADMIN). */
export const recomputeMyProfile = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
  const target = request.data?.uid || request.auth.uid;
  if (target !== request.auth.uid && request.auth.token?.role !== 'SUPER_ADMIN') {
    throw new HttpsError('permission-denied', 'Can only recompute your own profile.');
  }
  return recomputeUserProfile(admin.firestore(), target);
});
