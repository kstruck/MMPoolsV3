import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { writeLedgerEvent } from "./paymentLedger";
import { assertPoolOwnerOrSuperAdmin } from "./poolOps";
import { assertNotBannedLive } from "./lib/systemGuards";
import { recomputeUserProfile } from "./userProfile";
import { PAYOUT_SCHEMA_VERSION, weeklyAwardId, type PayoutKind } from "./shared/payoutRecords";
import type { WeeklyPlace, WeeklyPrizeSnapshot } from "./shared/weeklyPrizes";
import { writeAuditEvent } from "./audit";

/**
 * recordPoolPayouts — the Commissioner's "record payouts" action (ADR 0005
 * decision 3 / PLAN-PLAYER-PROFILES Phase 4). The FIRST real writer of payout
 * truth: canonical award docs split by sensitivity —
 *   pools/{poolId}/payoutRecords/{awardId}         {uid, entryId?, amount, kind, place?, week?, recordedAt, supersededBy?}
 *   pools/{poolId}/payoutRecordsPrivate/{awardId}  {uid, settled, note?, recordedBy}
 * plus PAYOUT_PAID/PAYOUT_UNPAID ledger events (audit trail only) and
 * pool.payoutsRecordedAt. Corrections supersede (supersedes: awardId) — never
 * mutate. The platform records figures; the money moves peer-to-peer.
 *
 * PLAN-PAYMENT-LEDGER T4 (D4, K4/K5/K11/K12 — signed 2026-08-15) — the ledger's
 * checkbox is this callable with `settled: true`, ONE award, and:
 *   • a WEEKLY PLACE award (`kind: 'PLACE'`, `week`) is allowed once that week's
 *     recap carries `weeklyPlaces` + `weeklyPrize` (K4 — the pool need not be
 *     FINAL); it is BOUND to the recap: `entryId` owned by `uid`, `(entryId,
 *     place)` present in `weeklyPlaces` with a prize, `amount` EQUAL to that
 *     frozen prize. Anything else is refused — a different figure goes through
 *     BONUS/ADJUSTMENT, the override path that already exists (K11).
 *   • its doc id is DETERMINISTIC (`weeklyAwardId`) and created only if
 *     absent, inside the transaction — a double-click, a retry, or two tabs
 *     cannot record the same win twice and double Profit; a repeat call returns
 *     the live award id and writes nothing.
 *   • after a rescore (K12) a live record that no longer matches the recap is
 *     re-recorded by SUPERSESSION: the request carries `staleAwardId`; in one
 *     transaction the old record gets `supersededBy` and the replacement lands
 *     at `${base}~${k}`. If the stale award is already superseded when the
 *     transaction reads it, the call returns the current live matching award
 *     and writes nothing — two tabs cannot churn the chain.
 *   • every award is gated INDEPENDENTLY before any write (weekly rule above,
 *     `POOL_NOT_SETTLED` for the rest) and the batch is all-or-nothing.
 * One authorizer for record AND settle: `assertPayoutAuthority`.
 */

interface AwardInput {
  uid: string;
  entryId?: string;
  amount: number;
  kind: PayoutKind;
  place?: number;
  week?: number;
  settled: boolean;
  note?: string;
  supersedes?: string;
  /** K12: the live weekly award this re-record replaces. */
  staleAwardId?: string;
}

const KINDS: PayoutKind[] = ['PLACE', 'BONUS', 'ADJUSTMENT'];
const MAX_AWARDS_PER_CALL = 100;

/**
 * The one principal set for recording AND settling a payout (PLAN-PAYMENT-LEDGER
 * D4): the pool commissioner — owner, manager, or a named co-commissioner, per
 * PLAN-CO-COMMISSIONERS' `isPoolCommissioner` inside `assertPoolOwnerOrSuperAdmin`
 * — or a SUPER_ADMIN, and never a live-banned account.
 */
export async function assertPayoutAuthority(pool: any, uid: string, claimRole: string | undefined): Promise<void> {
  try {
    assertPoolOwnerOrSuperAdmin(pool, uid, claimRole);
  } catch {
    throw new HttpsError('permission-denied', 'Only the pool commissioner or a super admin can record payouts.');
  }
  await assertNotBannedLive(uid);
}

const isSettledPool = (pool: any): boolean =>
  !!pool.finalizedAt || pool.status === 'FINAL' || pool.status === 'COMPLETED' || pool.isFinal === true;


export const recordPoolPayouts = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
  const actorUid = request.auth.uid;
  const db = admin.firestore();
  const { poolId, awards } = request.data || {};
  if (!poolId || typeof poolId !== 'string') throw new HttpsError('invalid-argument', 'poolId is required.');
  if (!Array.isArray(awards) || awards.length === 0) throw new HttpsError('invalid-argument', 'awards[] is required.');
  if (awards.length > MAX_AWARDS_PER_CALL) throw new HttpsError('invalid-argument', `At most ${MAX_AWARDS_PER_CALL} awards per call.`);

  const poolRef = db.collection('pools').doc(poolId);
  const poolSnap = await poolRef.get();
  if (!poolSnap.exists) throw new HttpsError('not-found', 'Pool not found.');
  const pool = poolSnap.data() as any;
  await assertPayoutAuthority(pool, actorUid, request.auth.token.role as string | undefined);

  const participantIds: string[] = pool.participantIds || [];
  const validated: AwardInput[] = awards.map((a: any, i: number) => {
    if (!a || typeof a.uid !== 'string' || !a.uid) throw new HttpsError('invalid-argument', `awards[${i}].uid is required — every award needs an explicit recipient.`);
    if (!participantIds.includes(a.uid)) throw new HttpsError('invalid-argument', `awards[${i}].uid is not a member of this pool.`);
    const amount = Number(a.amount);
    if (!Number.isFinite(amount)) throw new HttpsError('invalid-argument', `awards[${i}].amount must be a number.`);
    if (!KINDS.includes(a.kind)) throw new HttpsError('invalid-argument', `awards[${i}].kind must be one of ${KINDS.join('/')}.`);
    if (a.kind !== 'ADJUSTMENT' && amount < 0) throw new HttpsError('invalid-argument', `awards[${i}].amount must be >= 0 (negative only on ADJUSTMENT corrections).`);
    if (a.supersedes !== undefined && typeof a.supersedes !== 'string') throw new HttpsError('invalid-argument', `awards[${i}].supersedes must be an awardId.`);
    if (a.staleAwardId !== undefined && typeof a.staleAwardId !== 'string') throw new HttpsError('invalid-argument', `awards[${i}].staleAwardId must be an awardId.`);
    const week = a.week === undefined || a.week === null ? undefined : Number(a.week);
    if (week !== undefined && (!Number.isInteger(week) || week < 1)) throw new HttpsError('invalid-argument', `awards[${i}].week must be a positive integer.`);
    if (week !== undefined && a.kind !== 'PLACE') throw new HttpsError('invalid-argument', `awards[${i}].week is only valid on a PLACE award.`);
    if (week !== undefined && (typeof a.entryId !== 'string' || !a.entryId)) throw new HttpsError('invalid-argument', `awards[${i}].entryId is required on a weekly award.`);
    if (week !== undefined && a.supersedes !== undefined) throw new HttpsError('invalid-argument', `awards[${i}]: a weekly award re-records via staleAwardId, not supersedes.`);
    return {
      uid: a.uid,
      entryId: typeof a.entryId === 'string' ? a.entryId : undefined,
      amount,
      kind: a.kind,
      place: Number.isFinite(Number(a.place)) ? Number(a.place) : undefined,
      week,
      settled: a.settled === true,
      note: typeof a.note === 'string' && a.note.trim() ? a.note.trim().slice(0, 500) : undefined,
      supersedes: a.supersedes,
      staleAwardId: a.staleAwardId,
    };
  });

  // Two weekly awards for the same (entry, week) in one call would race each
  // other inside the transaction (both read "absent", both plan a write — codex
  // r1). Refuse the batch; the ledger sends one award per row.
  const weeklyKeys = new Set<string>();
  for (const a of validated) {
    if (a.week === undefined) continue;
    const key = `${a.entryId}|${a.week}`;
    if (weeklyKeys.has(key)) throw new HttpsError('invalid-argument', `DUPLICATE_WEEKLY_AWARD: entry ${a.entryId} week ${a.week} appears more than once in awards[].`);
    weeklyKeys.add(key);
  }

  // Per-award eligibility BEFORE any write (D4). Non-weekly awards keep the
  // pool-must-be-settled gate; weekly awards are gated on their recap below,
  // inside the transaction that reads it.
  if (validated.some(a => a.week === undefined) && !isSettledPool(pool)) {
    throw new HttpsError('failed-precondition', 'POOL_NOT_SETTLED: record season payouts after the pool is finalized.');
  }

  const now = Date.now();
  const recordsCol = poolRef.collection('payoutRecords');
  const privateCol = poolRef.collection('payoutRecordsPrivate');

  type Planned = { awardRef: FirebaseFirestore.DocumentReference; a: AwardInput; supersedes?: string; write: boolean };
  const planned = await db.runTransaction(async (tx): Promise<Planned[]> => {
    const out: Planned[] = [];
    // ---- reads ----
    const recapCache = new Map<number, { weeklyPlaces?: WeeklyPlace[]; weeklyPrize?: WeeklyPrizeSnapshot | null } | undefined>();
    for (const a of validated) {
      if (a.week === undefined) continue;
      if (!recapCache.has(a.week)) {
        recapCache.set(a.week, (await tx.get(poolRef.collection('weekly_recaps').doc(`week_${a.week}`))).data() as never);
      }
    }
    for (const a of validated) {
      if (a.week === undefined) {
        // Season / bonus / adjustment — today's path, random id, optional supersession.
        if (a.supersedes) {
          const target = await tx.get(recordsCol.doc(a.supersedes));
          if (!target.exists) throw new HttpsError('invalid-argument', `supersedes target ${a.supersedes} not found.`);
          if ((target.data() as any).supersededBy) throw new HttpsError('failed-precondition', `award ${a.supersedes} is already superseded — correct the latest record instead.`);
        }
        out.push({ awardRef: recordsCol.doc(), a, supersedes: a.supersedes, write: true });
        continue;
      }
      // ---- WEEKLY PLACE award: bound to the recap (K11) ----
      const recap = recapCache.get(a.week);
      const places = recap?.weeklyPlaces;
      const prize = recap?.weeklyPrize;
      if (!places || !places.length || !prize) {
        throw new HttpsError('failed-precondition', `WEEK_NOT_PUBLISHED: week ${a.week} has no published weekly places/prize yet.`);
      }
      const row = places.find(p => p.entryId === a.entryId);
      if (!row) throw new HttpsError('failed-precondition', `NOT_IN_WEEKLY_PLACES: entry ${a.entryId} is not in week ${a.week}'s published places.`);
      if (row.userId !== a.uid) throw new HttpsError('failed-precondition', `ENTRY_NOT_OWNED: entry ${a.entryId} is not owned by ${a.uid}.`);
      if (a.place !== undefined && a.place !== row.rank) throw new HttpsError('failed-precondition', `PLACE_MISMATCH: entry ${a.entryId} finished ${row.rank} in week ${a.week}, not ${a.place}.`);
      const frozenPrize = row.prize ?? 0;
      if (frozenPrize <= 0) throw new HttpsError('failed-precondition', `NO_PRIZE: entry ${a.entryId} has no prize at place ${row.rank} in week ${a.week}.`);
      if (a.amount !== frozenPrize) throw new HttpsError('failed-precondition', `AMOUNT_MISMATCH: the published prize for entry ${a.entryId} in week ${a.week} is $${frozenPrize}; record a BONUS/ADJUSTMENT for a different figure.`);
      a.place = row.rank;

      const base = weeklyAwardId(a.week, a.entryId!, row.rank);
      // The LIVE weekly award for this (entry, week), if any — read in-tx. There
      // is at most one by construction (every path below keeps it so).
      const liveSnap = await tx.get(recordsCol.where('entryId', '==', a.entryId).where('week', '==', a.week));
      const liveDocs = liveSnap.docs.filter(d => !(d.data() as any).supersededBy);
      if (liveDocs.length > 1) throw new HttpsError('failed-precondition', `LEDGER_INCONSISTENT: more than one live weekly award for entry ${a.entryId} week ${a.week}.`);
      const live = liveDocs[0];
      const liveMatches = live !== undefined && live.id === base && Number((live.data() as any).amount) === a.amount;

      if (!a.staleAwardId) {
        if (live && liveMatches) {
          // Idempotent: the same win is already recorded — return it, write nothing.
          out.push({ awardRef: live.ref, a, write: false });
          continue;
        }
        if (live) {
          // The recap moved (rescore) and a live award at the OLD place/amount
          // exists — a plain record would leave two live records and double
          // Profit (codex r1). The ledger must re-record via staleAwardId.
          throw new HttpsError('failed-precondition', `LIVE_AWARD_EXISTS: entry ${a.entryId} already has a live weekly award for week ${a.week} (${live.id}); re-record it with staleAwardId.`);
        }
        // Nothing live: create at the deterministic id (a superseded doc may
        // already sit at `base` after an earlier chain — then take the next k).
        let k = 1;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const candidate = recordsCol.doc(weeklyAwardId(a.week, a.entryId!, row.rank, k));
          if (!(await tx.get(candidate)).exists) { out.push({ awardRef: candidate, a, write: true }); break; }
          k += 1;
          if (k > 50) throw new HttpsError('failed-precondition', 'RE_RECORD_CHAIN_TOO_LONG');
        }
        continue;
      }

      // K12 re-record by supersession. Resolve the FULL chain from the stale id
      // to its live end (codex r1): a stale id that was already re-recorded —
      // possibly more than once — returns the current live award, writes nothing.
      let cursor = await tx.get(recordsCol.doc(a.staleAwardId));
      if (!cursor.exists) throw new HttpsError('invalid-argument', `staleAwardId ${a.staleAwardId} not found.`);
      const staleData = cursor.data() as any;
      if (staleData.entryId !== a.entryId || staleData.week !== a.week) {
        throw new HttpsError('invalid-argument', `staleAwardId ${a.staleAwardId} is not a weekly award for entry ${a.entryId} week ${a.week}.`);
      }
      let hops = 0;
      while ((cursor.data() as any)?.supersededBy && hops < 50) {
        cursor = await tx.get(recordsCol.doc(String((cursor.data() as any).supersededBy)));
        hops += 1;
      }
      const chainLive = cursor;
      if (chainLive.id !== a.staleAwardId) {
        // Someone already re-recorded. If the live end already matches the recap
        // return it; if it does not (a further rescore), the caller re-records
        // against THAT id — never silently chain past what they clicked.
        out.push({ awardRef: chainLive.ref, a, write: false });
        continue;
      }
      // Supersede the live stale award with a fresh record at the current base
      // (the base itself when the place changed and it is free, else ~k).
      let k = 1;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const candidate = recordsCol.doc(weeklyAwardId(a.week, a.entryId!, row.rank, k));
        if (!(await tx.get(candidate)).exists) { out.push({ awardRef: candidate, a, supersedes: a.staleAwardId, write: true }); break; }
        k += 1;
        if (k > 50) throw new HttpsError('failed-precondition', 'RE_RECORD_CHAIN_TOO_LONG');
      }
    }
    // ---- writes ----
    let wrote = 0;
    for (const p of out) {
      if (!p.write) continue;
      wrote += 1;
      const { awardRef, a } = p;
      tx.set(awardRef, {
        uid: a.uid,
        ...(a.entryId ? { entryId: a.entryId } : {}),
        amount: a.amount,
        kind: a.kind,
        ...(a.place !== undefined ? { place: a.place } : {}),
        ...(a.week !== undefined ? { week: a.week } : {}),
        recordedAt: now,
        schemaVersion: PAYOUT_SCHEMA_VERSION,
      });
      tx.set(privateCol.doc(awardRef.id), {
        uid: a.uid,
        settled: a.settled,
        ...(a.note ? { note: a.note } : {}),
        recordedBy: actorUid,
        schemaVersion: PAYOUT_SCHEMA_VERSION,
      });
      if (p.supersedes) {
        tx.update(recordsCol.doc(p.supersedes), { supersededBy: awardRef.id });
      }
    }
    if (wrote > 0) tx.update(poolRef, { payoutsRecordedAt: FieldValue.serverTimestamp() });
    return out;
  });

  const written = planned.filter(p => p.write);
  for (const p of written) {
    const a = p.a;
    await writeLedgerEvent(db, poolId, {
      type: a.settled ? 'PAYOUT_PAID' : 'PAYOUT_UNPAID',
      uid: a.uid,
      ...(a.entryId ? { entryId: a.entryId } : {}),
      amount: a.amount,
      ...(a.note ? { note: a.note } : {}),
      actorUid,
    });
  }
  if (written.length > 0) {
    await writeAuditEvent({
      poolId,
      type: 'POOL_STATUS_CHANGED',
      message: `Payouts recorded (${written.length} award(s)) by ${actorUid}`,
      severity: 'INFO',
      actor: { uid: actorUid, role: 'ADMIN', label: 'Host' },
      payload: { awards: written.length, awardIds: written.map(p => p.awardRef.id) },
    });
    const recipients = [...new Set(written.map(p => p.a.uid))];
    for (const uid of recipients) {
      try {
        await recomputeUserProfile(db, uid);
      } catch (e) {
        console.warn(`[recordPoolPayouts] profile recompute failed for ${uid}:`, e);
      }
    }
  }
  return { success: true, awardIds: planned.map(p => p.awardRef.id), written: written.length };
});

/**
 * setPayoutSettled — the ledger's un-tick / re-tick (PLAN-PAYMENT-LEDGER D4, K5).
 * Flips `settled` on the PRIVATE record only; the amount is immutable (supersede
 * to correct it). Transaction over both docs; refuses a superseded award;
 * transition-only ledger event; NO profile recompute — settlement does not move
 * Profit (CONTEXT.md §Profit counts recorded prizes whether or not settled).
 */
export const setPayoutSettled = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
  const actorUid = request.auth.uid;
  const db = admin.firestore();
  const { poolId, awardId, settled } = request.data || {};
  if (!poolId || typeof poolId !== 'string') throw new HttpsError('invalid-argument', 'poolId is required.');
  if (!awardId || typeof awardId !== 'string') throw new HttpsError('invalid-argument', 'awardId is required.');
  if (typeof settled !== 'boolean') throw new HttpsError('invalid-argument', 'settled must be a boolean.');

  const poolRef = db.collection('pools').doc(poolId);
  const poolSnap = await poolRef.get();
  if (!poolSnap.exists) throw new HttpsError('not-found', 'Pool not found.');
  await assertPayoutAuthority(poolSnap.data(), actorUid, request.auth.token.role as string | undefined);

  const pubRef = poolRef.collection('payoutRecords').doc(awardId);
  const privRef = poolRef.collection('payoutRecordsPrivate').doc(awardId);
  const result = await db.runTransaction(async (tx) => {
    const [pub, priv] = await Promise.all([tx.get(pubRef), tx.get(privRef)]);
    if (!pub.exists || !priv.exists) throw new HttpsError('not-found', 'Award not found.');
    const pubData = pub.data() as any;
    if (pubData.supersededBy) throw new HttpsError('failed-precondition', 'AWARD_SUPERSEDED: settle the live record instead.');
    const was = (priv.data() as any).settled === true;
    if (was === settled) return { changed: false, uid: pubData.uid as string, entryId: pubData.entryId as string | undefined, amount: Number(pubData.amount) };
    tx.update(privRef, { settled, settledAt: settled ? Date.now() : FieldValue.delete(), settledBy: actorUid });
    return { changed: true, uid: pubData.uid as string, entryId: pubData.entryId as string | undefined, amount: Number(pubData.amount) };
  });

  if (result.changed) {
    await writeLedgerEvent(db, poolId, {
      type: settled ? 'PAYOUT_PAID' : 'PAYOUT_UNPAID',
      uid: result.uid,
      ...(result.entryId ? { entryId: result.entryId } : {}),
      amount: result.amount,
      actorUid,
    });
    await writeAuditEvent({
      poolId,
      type: 'POOL_STATUS_CHANGED',
      message: `Payout ${awardId} marked ${settled ? 'PAID' : 'UNPAID'} by ${actorUid}`,
      severity: 'INFO',
      actor: { uid: actorUid, role: 'ADMIN', label: 'Host' },
      payload: { awardId, settled },
    });
  }
  return { success: true, changed: result.changed };
});
