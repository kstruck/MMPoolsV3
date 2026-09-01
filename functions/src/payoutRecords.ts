import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { writeLedgerEvent } from "./paymentLedger";
import { assertPoolOwnerOrSuperAdmin } from "./poolOps";
import { assertNotBannedLive } from "./lib/systemGuards";
import { confirmedAdminClaim } from "./lib/confirmedRole";
import { recomputeUserProfile } from "./userProfile";
import { PAYOUT_SCHEMA_VERSION, weeklyAwardId, type PayoutKind } from "./shared/payoutRecords";
import type { WeeklyPlace, WeeklyPrizeSnapshot } from "./shared/weeklyPrizes";
import { seasonAwardId, type SeasonPlace } from "./shared/seasonPrizes";
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


type PublishedRow = { entryId: string; userId: string; rank: number; prize?: number };
type Planned = { awardRef: FirebaseFirestore.DocumentReference; a: AwardInput; supersedes?: string; write: boolean };

/**
 * Bind a PLACE award to the row a publication holds for its entry (the recap's
 * `weeklyPlaces` or the pool's `seasonPlaces`): the entry must be listed and
 * owned by `uid`, `place` (when given) must be the published rank, `amount`
 * must EQUAL the published prize — or, WITH a `staleAwardId`, the entry may have
 * dropped out of the paid places, in which case only `amount: 0` (a REVERSAL)
 * is accepted. Returns the row the award binds to (rank/prize as published, or
 * a synthetic zero row for a reversal). Throws HttpsError otherwise.
 */
function bindToPublishedRow(a: AwardInput, foundRow: PublishedRow | undefined, scope: string): PublishedRow {
  // A REVERSAL (codex r6 on T4): after a rescore / re-finalization the entry may
  // have dropped out of the paid places entirely (or below any prize). The old
  // award is still live and counts in Profit; the ledger corrects it by
  // re-recording a ZERO award via staleAwardId, which supersedes the old one.
  // Only this path accepts amount 0 / a missing row, and only WITH a stale id.
  const reversal = a.staleAwardId !== undefined && (foundRow === undefined || (foundRow.prize ?? 0) <= 0);
  if (reversal) {
    if (a.amount !== 0) throw new HttpsError('failed-precondition', `NO_PRIZE: entry ${a.entryId} has no prize in ${scope} any more — re-record with amount 0 to reverse the old award.`);
    if (foundRow && foundRow.userId !== a.uid) throw new HttpsError('failed-precondition', `ENTRY_NOT_OWNED: entry ${a.entryId} is not owned by ${a.uid}.`);
  }
  const row: PublishedRow | undefined = reversal
    ? { entryId: a.entryId!, userId: a.uid, rank: foundRow?.rank ?? 0, prize: 0 }
    : foundRow;
  if (!row) throw new HttpsError('failed-precondition', `${scope.startsWith('week') ? 'NOT_IN_WEEKLY_PLACES' : 'NOT_IN_SEASON_PLACES'}: entry ${a.entryId} is not in ${scope}'s published places.`);
  if (row.userId !== a.uid) throw new HttpsError('failed-precondition', `ENTRY_NOT_OWNED: entry ${a.entryId} is not owned by ${a.uid}.`);
  if (!reversal) {
    if (a.place !== undefined && a.place !== row.rank) throw new HttpsError('failed-precondition', `PLACE_MISMATCH: entry ${a.entryId} finished ${row.rank} in ${scope}, not ${a.place}.`);
    const frozenPrize = row.prize ?? 0;
    if (frozenPrize <= 0) throw new HttpsError('failed-precondition', `NO_PRIZE: entry ${a.entryId} has no prize at place ${row.rank} in ${scope}.`);
    if (a.amount !== frozenPrize) throw new HttpsError('failed-precondition', `AMOUNT_MISMATCH: the published prize for entry ${a.entryId} in ${scope} is $${frozenPrize}; record a BONUS/ADJUSTMENT for a different figure.`);
  }
  a.place = row.rank;
  return row;
}

/**
 * Plan ONE bound PLACE award against the live record set for its (entry, scope):
 * idempotent at the deterministic id; refuses a plain record while a mismatched
 * live award exists (LIVE_AWARD_EXISTS — the ledger must re-record via
 * staleAwardId); K12 re-record by supersession walks the chain from the stale
 * id to its live end. `idFor(k)` yields the deterministic id, `~k` for k ≥ 2.
 * Shared by the weekly (recap-bound) and season (pool-bound) awards.
 */
async function planBoundAward(
  tx: FirebaseFirestore.Transaction,
  recordsCol: FirebaseFirestore.CollectionReference,
  a: AwardInput,
  row: PublishedRow,
  liveDocs: FirebaseFirestore.QueryDocumentSnapshot[],
  idFor: (k: number) => string,
  scope: string,
  /** Is this doc id a bound award of THIS scope (`wk…` / `season-…`)? A stale id must be one, and so must every hop of its chain. */
  isBoundId: (id: string) => boolean,
): Promise<Planned> {
  if (liveDocs.length > 1) throw new HttpsError('failed-precondition', `LEDGER_INCONSISTENT: more than one live award for entry ${a.entryId} in ${scope}.`);
  const live = liveDocs[0];
  // "Matches" = same place and same amount as the publication now says (the id may carry a ~k suffix after earlier corrections).
  const liveMatches = live !== undefined && Number((live.data() as any).place) === row.rank && Number((live.data() as any).amount) === a.amount;
  const freeSlot = async (supersedes?: string): Promise<Planned> => {
    let k = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const candidate = recordsCol.doc(idFor(k));
      if (!(await tx.get(candidate)).exists) return { awardRef: candidate, a, ...(supersedes ? { supersedes } : {}), write: true };
      k += 1;
      if (k > 50) throw new HttpsError('failed-precondition', 'RE_RECORD_CHAIN_TOO_LONG');
    }
  };

  if (!a.staleAwardId) {
    // Idempotent: the same win is already recorded — return it, write nothing.
    if (live && liveMatches) return { awardRef: live.ref, a, write: false };
    // The publication moved and a live award at the OLD place/amount exists — a
    // plain record would leave two live records and double Profit (codex r1 on
    // T4). The ledger must re-record via staleAwardId.
    if (live) throw new HttpsError('failed-precondition', `LIVE_AWARD_EXISTS: entry ${a.entryId} already has a live award for ${scope} (${live.id}); re-record it with staleAwardId.`);
    // Nothing live: create at the deterministic id (a superseded doc may already
    // sit at the base after an earlier chain — then take the next k).
    return freeSlot();
  }

  // K12 re-record by supersession. Resolve the FULL chain from the stale id to
  // its live end (codex r1 on T4): a stale id that was already re-recorded —
  // possibly more than once — returns the current live award, writes nothing.
  let cursor = await tx.get(recordsCol.doc(a.staleAwardId));
  if (!cursor.exists) throw new HttpsError('invalid-argument', `staleAwardId ${a.staleAwardId} not found.`);
  // The stale id — and every hop of its chain — must be a bound PLACE award of
  // THIS entry and scope. Otherwise a season re-record could name an unrelated
  // no-week BONUS/ADJUSTMENT for the same entry and supersede it out of the
  // ledger (codex r5 on #464).
  const isOurs = (id: string, d: any) => d?.kind === 'PLACE' && d?.entryId === a.entryId && (d?.week ?? undefined) === (a.week ?? undefined) && isBoundId(id);
  if (!isOurs(cursor.id, cursor.data())) {
    throw new HttpsError('invalid-argument', `staleAwardId ${a.staleAwardId} is not a bound PLACE award for entry ${a.entryId} in ${scope}.`);
  }
  let hops = 0;
  while ((cursor.data() as any)?.supersededBy && hops < 50) {
    cursor = await tx.get(recordsCol.doc(String((cursor.data() as any).supersededBy)));
    hops += 1;
    if (!cursor.exists || !isOurs(cursor.id, cursor.data())) throw new HttpsError('failed-precondition', `RE_RECORD_CHAIN_BROKEN: ${a.staleAwardId}'s chain leaves ${scope}'s bound awards.`);
  }
  // A bounded walk that did not reach a live end must not be treated as live (codex r4 on T4).
  if ((cursor.data() as any)?.supersededBy) throw new HttpsError('failed-precondition', 'RE_RECORD_CHAIN_TOO_LONG');
  const chainLive = cursor;
  if (chainLive.id !== a.staleAwardId) {
    // Someone already re-recorded past the id the caller clicked. If the live
    // end already matches the publication, return it (write nothing); if it does
    // not — a further rescore — REFUSE and name the live id (codex r2 on T4).
    const liveData = chainLive.data() as any;
    if (Number(liveData.place) === row.rank && Number(liveData.amount) === a.amount) return { awardRef: chainLive.ref, a, write: false };
    throw new HttpsError('failed-precondition', `STALE_AWARD_SUPERSEDED: ${a.staleAwardId} was already re-recorded; the live award is ${chainLive.id} and it no longer matches — re-record with staleAwardId=${chainLive.id}.`);
  }
  // The clicked id IS the live award and it already matches — nothing to
  // correct; a retry / second tab must not grow the chain (qodo #8 on #455).
  if (liveMatches && live && live.id === chainLive.id) return { awardRef: chainLive.ref, a, write: false };
  // Supersede the live stale award with a fresh record at the current base (the
  // base itself when the place changed and it is free, else ~k).
  return freeSlot(a.staleAwardId);
}

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
  // confirmedAdminClaim strips an UNCONFIRMED SUPER_ADMIN claim (Phase 3,
  // PLAN-API-TRUST-BOUNDARY): owners/co-commissioners are byte-identical, a
  // stale-token admin falls to the ownership check instead of the money ledger.
  await assertPayoutAuthority(pool, actorUid, await confirmedAdminClaim(request));

  const participantIds: string[] = pool.participantIds || [];
  const validated: AwardInput[] = awards.map((a: any, i: number) => {
    if (!a || typeof a.uid !== 'string' || !a.uid) throw new HttpsError('invalid-argument', `awards[${i}].uid is required — every award needs an explicit recipient.`);
    const weekly = a.week !== undefined && a.week !== null;
    // A season PLACE award naming an ENTRY on a pool with published season places
    // is BOUND to that list (below, in-tx) — ownership comes from the published
    // row's userId, not participantIds, exactly as weekly awards do (codex r1 on
    // step 3: a legacy ranked entry can be missing from participantIds).
    const boundSeason = !weekly && a.kind === 'PLACE' && typeof a.entryId === 'string' && !!a.entryId && Array.isArray(pool.seasonPlaces);
    // Season/bonus/adjustment awards are gated on the participant list as today.
    // A WEEKLY award is bound to the recap row instead (below): the row's
    // `userId` came from the entry document the scorer ranked, which is a
    // stronger membership proof than `participantIds` — and a legacy roster
    // can hold a canonical Member Record + entry that `participantIds` never
    // listed (codex r4 on T5); refusing those would leave a published prize
    // that can never be recorded.
    if (!weekly && !boundSeason && !participantIds.includes(a.uid)) throw new HttpsError('invalid-argument', `awards[${i}].uid is not a member of this pool.`);
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
    if (week === undefined && a.staleAwardId !== undefined && !boundSeason) throw new HttpsError('invalid-argument', `awards[${i}]: staleAwardId is only valid on a weekly award or a bound season award — a free-form season award corrects via supersedes.`);
    if (boundSeason && a.supersedes !== undefined) throw new HttpsError('invalid-argument', `awards[${i}]: a bound season award re-records via staleAwardId, not supersedes.`);
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

  const planned = await db.runTransaction(async (tx): Promise<Planned[]> => {
    const out: Planned[] = [];
    // ---- reads ----
    const recapCache = new Map<number, { weeklyPlaces?: WeeklyPlace[]; weeklyPrize?: WeeklyPrizeSnapshot | null } | undefined>();
    // Season places — AND the decision to bind at all — come from the pool AS
    // READ IN THIS TRANSACTION, not the pre-tx snapshot: a finalization landing
    // between the two reads must make this transaction retry and bind, never
    // slip a free-form PLACE past the newly published list (codex r1/r4 on #464).
    const wantsSeason = validated.some(a => a.week === undefined && a.kind === 'PLACE' && !!a.entryId);
    const freshPool = wantsSeason ? ((await tx.get(poolRef)).data() as any) : pool;
    const seasonPlaces: SeasonPlace[] | undefined = Array.isArray(freshPool?.seasonPlaces) ? freshPool.seasonPlaces : undefined;
    const seasonPublished = seasonPlaces !== undefined;
    // Two bound season awards for the same entry in one call would plan two
    // writes to one deterministic doc (codex r1 on #464).
    const seasonKeys = new Set<string>();
    for (const a of validated) {
      if (a.week !== undefined || a.kind !== 'PLACE' || !a.entryId || !seasonPublished) continue;
      if (seasonKeys.has(a.entryId)) throw new HttpsError('invalid-argument', `DUPLICATE_SEASON_AWARD: entry ${a.entryId} appears more than once in awards[].`);
      seasonKeys.add(a.entryId);
    }
    for (const a of validated) {
      if (a.week === undefined) continue;
      if (!recapCache.has(a.week)) {
        recapCache.set(a.week, (await tx.get(poolRef.collection('weekly_recaps').doc(`week_${a.week}`))).data() as never);
      }
    }
    for (const a of validated) {
      // ---- SEASON PLACE award bound to the published Season Places (PLAN-WEEKLY-PRIZES step 3) ----
      // Once the pool carries `seasonPlaces` (finalization publishes them), a
      // PLACE award that names an ENTRY is bound to that list exactly as a weekly
      // award is bound to its recap: the entry must hold a prize, `place` is the
      // published rank, `amount` EQUALS the published prize, the id is
      // DETERMINISTIC (`seasonAwardId`), and after a re-finalization (a rescored
      // FINAL pool republishes the places) a live award that no longer matches is
      // re-recorded by supersession via `staleAwardId` — the same K12 rule as the
      // weekly half (codex r3 on #464). PLACE awards WITHOUT an entryId (the Record
      // Payouts card) keep the free path below.
      if (a.week === undefined && a.kind === 'PLACE' && a.entryId && seasonPlaces) {
        const row = bindToPublishedRow(a, seasonPlaces.find(r => r.entryId === a.entryId), 'season');
        const liveSnap = await tx.get(recordsCol.where('entryId', '==', a.entryId));
        // Season awards carry no `week`; the deterministic prefix keeps free-form
        // (random-id) season PLACE records out of the live set.
        const liveDocs = liveSnap.docs.filter(d => { const x = d.data() as any; return !x.supersededBy && x.kind === 'PLACE' && x.week === undefined && d.id.startsWith('season-'); });
        out.push(await planBoundAward(tx, recordsCol, a, row, liveDocs, k => seasonAwardId(a.entryId!, row.rank, k), 'season', id => id.startsWith('season-')));
        continue;
      }
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
      const row = bindToPublishedRow(a, places.find(p => p.entryId === a.entryId), `week ${a.week}`);
      // The LIVE weekly award for this (entry, week), if any — read in-tx. There
      // is at most one by construction (every path below keeps it so).
      const liveSnap = await tx.get(recordsCol.where('entryId', '==', a.entryId).where('week', '==', a.week));
      const liveDocs = liveSnap.docs.filter(d => !(d.data() as any).supersededBy);
      out.push(await planBoundAward(tx, recordsCol, a, row, liveDocs, k => weeklyAwardId(a.week!, a.entryId!, row.rank, k), `week ${a.week}`, id => id.startsWith(`wk${a.week}-`)));
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
  // Same claim+doc treatment as recordPoolPayouts above (Phase 3).
  await assertPayoutAuthority(poolSnap.data(), actorUid, await confirmedAdminClaim(request));

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
