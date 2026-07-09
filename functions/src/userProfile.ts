// Player Profile projection (ADR 0004/0005). Aggregates a subject's REAL performance across
// all the NFL pools they've entered into a sanitized, world-readable publicProfiles/{uid}
// doc. Leak rules (ADR 0005): the public doc carries ZERO pool identifiers (weekly rows are
// aggregated across pools; Best Finish is rank-only); pick history contains SCORED picks only
// (weeklyResults is written post-final — inherently reveal-safe); per-pool detail is served
// exclusively by the viewer-gated getProfilePoolDetail callable (subject / co-member of that
// pool / admin). Server-maintained; recomputed idempotently from authoritative entry state.
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { NFL_SEASON_TYPES } from "./shared/poolTypes";
import { reduceAwards, type PayoutRecord } from "./shared/payoutRecords";
import { buildPublicProfile, type ProfilePoolInput, type ProfileNFLPoolType } from "./lib/profileBuild";

type Firestore = admin.firestore.Firestore;

/** Gather one pool's inputs for the builder. Returns null when the subject has no entry. */
async function gatherPoolInput(db: Firestore, uid: string, poolId: string): Promise<ProfilePoolInput | null> {
  const poolRef = db.collection('pools').doc(poolId);
  const [entrySnap, poolSnap, memberSnap, historySnap, awardsSnap] = await Promise.all([
    poolRef.collection('entries').doc(uid).get(),
    poolRef.get(),
    poolRef.collection('members').doc(uid).get(),
    db.collection('users').doc(uid).collection('seasonHistory').doc(poolId).get(),
    poolRef.collection('payoutRecords').where('uid', '==', uid).get(),
  ]);
  if (!entrySnap.exists || !poolSnap.exists) return null;
  const pool: any = poolSnap.data();
  if (!NFL_SEASON_TYPES.includes(pool.type)) return null;

  const member: any = memberSnap.exists ? memberSnap.data() : {};
  const history: any = historySnap.exists ? historySnap.data() : null;
  const awards = awardsSnap.docs.map(d => d.data() as PayoutRecord);
  const { byUid } = reduceAwards(awards);

  return {
    poolId,
    poolName: pool.name || 'Pool',
    poolType: pool.type as ProfileNFLPoolType,
    ...(pool.type === 'NFL_PICKEM'
      ? { pickMode: pool.settings?.pickMode === 'ATS' ? 'ATS' as const : 'STRAIGHT' as const }
      : {}),
    season: String(pool.season || ''),
    entry: entrySnap.data() as Record<string, any>,
    finalRank: history ? { rank: history.finalRank, totalEntries: history.totalEntries } : null,
    awardsWon: byUid[uid] || 0,
    feeOwed: (Number(member.feeOwed) || 0) + (Number(member.rebuyOwed) || 0),
    feeEstimated: member.feeOwedSource === 'BACKFILL_ESTIMATE',
    finalized: !!pool.finalizedAt,
    payoutsRecorded: !!pool.payoutsRecordedAt,
  };
}

export async function recomputeUserProfile(db: Firestore, uid: string): Promise<any> {
  const userSnap = await db.collection('users').doc(uid).get();
  const userName = userSnap.data()?.name || 'Player';

  const partSnap = await db.collection('users').doc(uid).collection('participations').get();
  const poolIds = partSnap.docs
    .filter(p => NFL_SEASON_TYPES.includes((p.data() as any).type))
    .map(p => (p.data() as any).poolId || p.id);

  const inputs = (await Promise.all(poolIds.map(id => gatherPoolInput(db, uid, id))))
    .filter((x): x is ProfilePoolInput => x !== null);

  const profile = {
    ...buildPublicProfile(uid, userName, 'PLAYER', inputs),
    updatedAt: FieldValue.serverTimestamp(),
  };

  // set WITHOUT merge: the projection is a full re-derivation; merge would resurrect
  // rows from removed pools. Achievements live in a subcollection, unaffected.
  await db.collection('publicProfiles').doc(uid).set(profile);
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
  // Backfill suppression (Phase 8): the Operations backfill rewrites every scored entry
  // and enqueues one deduped recompute per subject afterwards instead.
  try {
    const guard = (await admin.firestore().doc('system/config').get()).data()?.profileBackfill;
    if (guard?.suppressTriggers === true) return;
  } catch { /* guard read failure -> proceed normally */ }
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

/**
 * Viewer-gated per-pool profile detail (ADR 0005 decision 7). The public projection
 * carries no pool identifiers; this callable reveals a single pool's name + the
 * subject's breakdown there, ONLY when the caller is the subject, a co-member of
 * THAT pool, or an admin. poolId is REQUIRED and authorization is per pool per
 * call — one shared pool never unlocks the subject's other pools.
 */
export const getProfilePoolDetail = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
  const caller = request.auth.uid;
  const { subjectId, poolId } = request.data || {};
  if (!subjectId || typeof subjectId !== 'string') throw new HttpsError('invalid-argument', 'subjectId is required.');
  if (!poolId || typeof poolId !== 'string') throw new HttpsError('invalid-argument', 'poolId is required.');

  const db = admin.firestore();
  const poolSnap = await db.collection('pools').doc(poolId).get();
  if (!poolSnap.exists) throw new HttpsError('not-found', 'Pool not found.');
  const pool: any = poolSnap.data();

  const isAdmin = request.auth.token?.role === 'SUPER_ADMIN';
  const participantIds: string[] = pool.participantIds || [];
  const isSubject = caller === subjectId;
  const isPoolStaff = pool.ownerId === caller || pool.managerUid === caller;
  // Co-membership via participantIds — authoritative today for NFL pools (ADR 0003
  // Member Record wiring still deferred; migrate this check when it lands). BOTH the
  // caller and the subject must be in THIS pool — one shared pool never unlocks others.
  const isCoMember = (participantIds.includes(caller) || isPoolStaff) && participantIds.includes(subjectId);
  if (!isSubject && !isAdmin && !isCoMember) {
    throw new HttpsError('permission-denied', 'Profile pool detail is visible to the member themself and co-members of that pool.');
  }

  const input = await gatherPoolInput(db, subjectId, poolId);
  if (!input) throw new HttpsError('not-found', 'No entry for that member in this pool.');

  const wr: Record<string, any> = input.entry?.weeklyResults || {};
  const weekly = Object.keys(wr).map(wk => {
    const r = wr[wk];
    const { games: _g, game: _g2, ...summary } = r;
    return { week: Number(wk), ...summary };
  }).sort((a, b) => a.week - b.week);

  return {
    poolId,
    poolName: input.poolName,
    poolType: input.poolType,
    season: input.season,
    weekly,
    finish: input.finalRank,
    profit: { won: input.awardsWon, feeOwed: input.feeOwed },
  };
});
