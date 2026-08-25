// Functions-side Member Record helpers. The membership WRITE decision is a pure
// function (planMembershipWrite) so it is unit-testable without Firestore; the thin
// reconcileMembership applies that plan inside a caller's transaction.
//
// WIRING IS DEFERRED (PLAN-COMMISSIONER-DASH.md step 7, option B): callers in
// nflPools/bracketPools/playoffPools/squares/participant must call reconcileMembership
// on every join/leave/delete/release/claim. That wiring lands in a separate commit
// merged AFTER the Test Suite NFL wave, so this file does not modify those hot paths.
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { ROSTER_SCHEMA_VERSION, memberLiableEntries, memberPlayedEntries, type MemberRecord } from "../shared/memberRecord";

export type Firestore = admin.firestore.Firestore;
export type Transaction = admin.firestore.Transaction;

/** Authoritative membership facts a caller reads from pool state before reconciling. */
export interface MembershipFacts {
  userName: string;
  role?: string;              // 'MANAGER' | 'PARTICIPANT'
  poolType: string;
  present: boolean;           // still a member: has >=1 entry / >=1 owned square / joined
  unitsOwned?: number;        // SQUARES only
  // ADR 0005 Phase 4 — base-dues stamping. entryFee is the pool's fee at write
  // time; hasPlayableEntry marks that the uid has committed an Entry (used to
  // start owner liability — a seeded MANAGER owes 0 until they actually play).
  //
  // As of 2026-07-31 hasPlayableEntry is also PERSISTED onto the record as a
  // one-way latch (see `MemberRecord.hasPlayableEntry`). Callers that are not
  // reporting a submit leave it `undefined`; that means "no new information",
  // never "false", on an existing record.
  entryFee?: number;
  hasPlayableEntry?: boolean;
  /**
   * The week this write is committing a pick for, if any. Unioned into
   * `MemberRecord.pickedWeeks` (PLAN-COMMISSIONER-BLIND-PICKS T1).
   *
   * `undefined` means "this caller is not reporting a pick" — a join, a
   * backfill-on-touch, a payment edit — and leaves the stored array alone.
   */
  pickedWeek?: number;
  /**
   * PLAN-MULTI-ENTRY D2. The number of this owner's entries that have committed
   * a pick, counted by the caller from the entry docs INSIDE its transaction
   * (after applying its own write). `undefined` = "not reporting" — join,
   * backfill-on-touch, payment edit — and the stored counter is left alone.
   * When supplied it must be ≥ 1 for a submit that latched play; it is folded
   * with `hasPlayableEntry` so the two cannot disagree (`count > 0`).
   */
  playableEntryCount?: number;
  /** D2/D6 — the owner's entry roster (id → index + name), rebuilt by the caller. `undefined` = leave alone. */
  entries?: Record<string, { entryIndex: number; name?: string }>;
}

/**
 * K11 — an entry added under a PAID mark. `feeOwed` rose, so the member is
 * no longer paid in full; the record flips to UNPAID in the same transaction
 * and the caller ledgers it (`MARKED_UNPAID` with the new `feeOwed`) and
 * mirrors it onto every entry the member owns.
 */
export interface PaidReset {
  previousFeeOwed: number;
  feeOwed: number;
  paidAt?: number;
  paymentMethod?: string;
}

export type MembershipPlan =
  | { participant: 'remove'; member: { op: 'delete' } }
  | { participant: 'add'; member: { op: 'set'; data: Partial<MemberRecord>; merge: boolean; paidReset?: PaidReset;
      /** D8 — how much this write raised the member's liable-entry count (feeds `pool.entryCount`). */
      liabilityDelta: number } };

/**
 * Pure decision for one uid's post-write membership state. Never clobbers
 * commissioner-owned payment fields (paidStatus/paidAt/paidBy) or a member's own
 * claim on an existing record — only fills them on first create.
 */
export function planMembershipWrite(
  poolId: string,
  uid: string,
  facts: MembershipFacts,
  existing: MemberRecord | null,
  now: number,
): MembershipPlan {
  if (!facts.present) {
    return { participant: 'remove', member: { op: 'delete' } };
  }

  const data: Partial<MemberRecord> = {
    uid,
    poolId,
    userName: facts.userName,
  };
  if (facts.role) data.role = facts.role;
  if (facts.poolType === 'SQUARES') data.unitsOwned = facts.unitsOwned ?? 0;

  // Base-dues liability (ADR 0005 Phase 4 × PLAN-MULTI-ENTRY D2): a seeded
  // MANAGER owes 0 until they commit a playable entry; everyone else owes the
  // pool fee from the moment they join; and every ADDITIONAL entry that has
  // committed a pick adds one more fee — `fee × max(joinLiability, count)`
  // (`memberLiableEntries`). Only computed when the caller supplied entryFee.
  //
  // The count this write establishes: the caller's transactional count when it
  // reported one, else the latch (`hasPlayableEntry ? 1 : 0`), else — on an
  // existing record — whatever the record already knows. A caller that is not
  // reporting play never LOWERS the count (one-way, K7).
  const reportedCount = facts.playableEntryCount !== undefined
    ? facts.playableEntryCount
    : (facts.hasPlayableEntry === true ? 1 : (facts.hasPlayableEntry === false ? 0 : undefined));
  const storedCount = existing ? memberPlayedEntries(existing) : 0;
  const nextCount = Math.max(storedCount, reportedCount ?? 0);
  const role = facts.role ?? existing?.role;
  const liableEntries = memberLiableEntries({ role, playableEntryCount: nextCount });
  const priorLiableEntries = existing ? memberLiableEntries({ ...existing, role }) : 0;
  const liableFee = facts.entryFee === undefined ? undefined : facts.entryFee * liableEntries;
  // Persist the counter whenever a caller reports one and it differs from what
  // is stored — this also heals a legacy record (latch only) to an explicit count.
  if (facts.playableEntryCount !== undefined && existing?.playableEntryCount !== nextCount) data.playableEntryCount = nextCount;
  if (facts.entries !== undefined) data.entries = facts.entries;

  if (!existing) {
    // First write: seed payment defaults. Merge=false so the doc is well-formed.
    data.paidStatus = 'UNPAID';
    data.joinedAt = now;
    if (liableFee !== undefined) {
      data.feeOwed = liableFee;
      data.feeOwedSource = 'LIVE';
    }
    // Persist the play latch ONLY when the caller actually established the fact.
    //
    // codex r1 on this change: stamping `!!facts.hasPlayableEntry` here was wrong
    // on the backfill-on-touch path. `joinNFLPoolInternal` (nflPools.ts:238)
    // reaches this CREATE branch for someone who is ALREADY a participant but has
    // no Member Record — a legacy pool — and that person may well already have an
    // entry. Coercing `undefined` to `false` there turns an unknown fact into a
    // durable "never entered", which is exactly what this field must never mean.
    //
    // Absent is the honest value when the caller does not know. Readers fall back
    // to entry evidence, and the latch fills in on the next submit.
    if (facts.hasPlayableEntry !== undefined || nextCount > 0) {
      // `count > 0` and the latch can never disagree (PLAN-MULTI-ENTRY D2).
      data.hasPlayableEntry = facts.hasPlayableEntry === true || nextCount > 0;
    }
    // Same unknown-is-not-false discipline as `hasPlayableEntry` directly above,
    // and for the same reason: THIS CREATE BRANCH IS ALSO THE BACKFILL-ON-TOUCH
    // PATH. `joinNFLPoolInternal` (nflPools.ts:238) reaches it for someone who
    // is ALREADY a participant but has no Member Record — a legacy pool — and
    // that person may well already have weeks of picks.
    //
    // Seeding `[]` there would convert "we do not know which weeks this member
    // picked" into "they picked no week", and the standings cell renders those
    // two differently on purpose: absent is "—", `[]` is "No selection". So the
    // field is written ONLY when this caller is actually reporting a pick.
    // (codex r3 on the commissioner-blind-picks PR, which caught the first
    // version doing exactly what the comment above it warns against.)
    //
    // Cost of the honest version: nothing visible. `buildMemberStandings` keeps
    // a member off the leaderboard until they have a scored row or the
    // `hasPlayableEntry` latch, so a joined-and-never-picked member has no cell
    // to render either way.
    if (facts.pickedWeek !== undefined) data.pickedWeeks = [facts.pickedWeek];
    return { participant: 'add', member: { op: 'set', data, merge: false, liabilityDelta: liableEntries } };
  }
  // Update: merge identity/units only; preserve paidStatus + claim. feeOwed is
  // filled when missing (heal-on-touch), upgraded 0 -> fee when an owner who
  // previously hadn't played now has a playable entry, and RE-STAMPED at
  // fee × liable entries when this write raises the member's liability (a
  // second entry's first committed pick — PLAN-MULTI-ENTRY D2). Never lowered
  // here — fee changes cascade through the entryFee-edit path instead, and a
  // legacy record whose stamp predates a fee change is deliberately left alone
  // when liability is unchanged (that is the cascade's job, not a submit's).
  let paidReset: PaidReset | undefined;
  if (liableFee !== undefined && (
    existing.feeOwed === undefined
    || (existing.feeOwed === 0 && liableFee > 0)
    || liableEntries > priorLiableEntries
  )) {
    data.feeOwed = liableFee;
    data.feeOwedSource = 'LIVE';
    // K11: a PAID member whose dues just rose is no longer paid in full. The
    // alternative — reporting the new fee as collected — is a money lie.
    // Applied by `ensureMemberRecord` (it needs FieldValue.delete for the
    // payment details) and ledgered + mirrored by the caller.
    if (existing.paidStatus === 'PAID' && liableFee > (existing.feeOwed ?? 0)) {
      paidReset = {
        previousFeeOwed: existing.feeOwed ?? 0,
        feeOwed: liableFee,
        ...(typeof existing.paidAt === 'number' ? { paidAt: existing.paidAt } : {}),
        ...(typeof (existing as { paymentMethod?: unknown }).paymentMethod === 'string'
          ? { paymentMethod: (existing as { paymentMethod?: string }).paymentMethod } : {}),
      };
      data.paidStatus = 'UNPAID';
    }
  }
  // The latch only ever goes UP. Join/backfill touches pass `undefined`, and
  // writing `!!undefined` here would clear the flag on a member who has already
  // submitted — the join path at nflPools.ts:238 touches existing records on
  // every re-join, so that would not be a rare case. It also heals records
  // written before the field existed, without a backfill.
  if ((facts.hasPlayableEntry === true || nextCount > 0) && existing.hasPlayableEntry !== true) {
    data.hasPlayableEntry = true;
  }
  // Union-only, and written ONLY when this caller is actually reporting a pick.
  // A join/backfill touch passes `undefined`; writing `[]` for it under
  // `merge: true` would REPLACE the stored array (Firestore merges maps, not
  // array contents) and erase every marker the member had earned.
  if (facts.pickedWeek !== undefined) {
    const stored = Array.isArray(existing.pickedWeeks) ? existing.pickedWeeks : [];
    if (!stored.includes(facts.pickedWeek)) {
      data.pickedWeeks = [...stored, facts.pickedWeek].sort((a, b) => a - b);
    }
  }
  return { participant: 'add', member: { op: 'set', data, merge: true, liabilityDelta: liableEntries - priorLiableEntries, ...(paidReset ? { paidReset } : {}) } };
}

/**
 * `isProvableMember` MOVED to `shared/memberRecord.ts` and is re-exported here
 * so existing functions-side importers are unchanged.
 *
 * It moved because a THIRD door needs the same answer: the commissioner roster
 * (`src/utils/poolRoster.ts`) must decide whether a non-canonical Member Record
 * is roster truth, and `src/` cannot import this file — it pulls in
 * firebase-admin. Re-implementing the two-evidence rule client-side is exactly
 * the drift `isCanonicalMemberRecord` was hoisted to shared/ to prevent.
 */
export { isProvableMember } from "../shared/memberRecord";

export function membersCol(db: Firestore, poolId: string) {
  return db.collection('pools').doc(poolId).collection('members');
}

/**
 * Write ONLY the Member Record (leaves participantIds to the caller's existing logic).
 * Use in join/create/submit paths that already manage participantIds — additive, does not
 * disturb certified membership logic. `existing` must be read before writes in the same tx.
 * Returns true if a doc write was issued.
 */
export function ensureMemberRecord(
  tx: Transaction,
  db: Firestore,
  poolId: string,
  uid: string,
  facts: MembershipFacts,
  existing: MemberRecord | null,
  now: number,
): { wrote: boolean; paidReset?: PaidReset; liabilityDelta: number } {
  const plan = planMembershipWrite(poolId, uid, facts, existing, now);
  if (plan.participant !== 'add') return { wrote: false, liabilityDelta: 0 };
  const reset = plan.member.paidReset;
  tx.set(membersCol(db, poolId).doc(uid), {
    ...plan.member.data,
    // K11 — same clear as setPaidStatus's UNPAID transition: stale
    // method/date/note on an unpaid member misreads as a payment record. The
    // details survive in the caller's ledger line.
    ...(reset ? { paidAt: FieldValue.delete(), paymentMethod: FieldValue.delete(), paymentNote: FieldValue.delete() } : {}),
  }, { merge: plan.member.merge });
  return { wrote: true, liabilityDelta: plan.member.liabilityDelta, ...(reset ? { paidReset: reset } : {}) };
}

/**
 * EVERY write a member's departure implies, issued into ONE caller transaction.
 *
 * There are SIX places a membership fact is stored, and a removal that misses
 * one leaves a copy that outlives the member (PLAN-MEMBER-REMOVAL-HARDENING):
 *
 *   1. `pools/{poolId}.participantIds` — the array every authorization check
 *      reads. `firestore.rules` resolves it with a LIVE `get()` on every
 *      request, so dropping the uid here is what actually revokes access.
 *   2. `pools/{poolId}.coManagers` — the delegated co-commissioner grant. A
 *      departed member must never keep one (PLAN-CO-COMMISSIONERS D2, sweeps
 *      S8), and it has to go in the SAME write as (1): a removal that revoked
 *      membership but left the grant standing would leave a non-member holding
 *      commissioner powers, which `isNFLCoManagerOf` honours in both the rules
 *      and the payout callables.
 *   3. `pools/{poolId}/members/{uid}` — the Member Record, roster + payment
 *      truth (ADR 0003) and the canonical admission evidence `getPoolPicks`
 *      demands (`nflPickReveal.ts` assertPickReader).
 *   4. THE THREE RECIPROCAL INDEXES, which is what this helper was missing:
 *      • `pools/{poolId}/participants/{uid}` — written by the
 *        `syncParticipantIndices` trigger (`participant.ts`). Leaving it is not
 *        cosmetic: `backfillMemberRecords` reads that subcollection
 *        (`migrations/backfillMemberRecords.ts`), so a stale index doc lets the
 *        next backfill RESURRECT a removed member's name onto a rebuilt record.
 *      • `users/{uid}/participations/{poolId}` — written by the NFL-season join
 *        and create paths (`nflPools.ts`, `lib/poolCreation.ts`) and read by
 *        `recomputeUserProfile` (`userProfile.ts`) and the client's own
 *        pool-discovery query (`src/services/dbService.ts`). Leaving it means a
 *        removed member's profile keeps counting the pool and their pool list
 *        keeps offering it — a door that now 403s.
 *      • `users/{uid}/joinedPools/{poolId}` — the bracket password-join index
 *        (`bracketPools.ts`). NOTHING reads it today, and it is deleted anyway:
 *        a write-only membership index is precisely the kind of thing that
 *        acquires a reader later, and the cost here is one `tx.delete` that is
 *        a no-op on every pool type that never wrote one.
 *
 * ⚠️ ONE TRANSACTION IS THE WHOLE POINT. All of them are issued on the caller's
 * `tx`, so Firestore commits them together or not at all; there is no window in
 * which the Member Record is gone and the grant survives. `tx.delete` on a
 * document that does not exist is a no-op, so a pool carrying none of the three
 * indexes pays three cheap deletes and nothing else.
 *
 * ponytail: on a pool with NO `coManagers` field the transform materialises an
 * EMPTY array (Firestore arrayRemove semantics — codex r2). Accepted: an empty
 * array grants nothing anywhere, and the clear's invariant is "no NON-EMPTY
 * array" (`nonEmpty === 0`), not field absence. Guarding it would cost a pool
 * read inside every removal transaction for a cosmetic property.
 */
function applyMembershipRemoval(tx: Transaction, db: Firestore, poolId: string, uid: string): void {
  const poolRef = db.collection('pools').doc(poolId);
  tx.update(poolRef, {
    participantIds: FieldValue.arrayRemove(uid),
    coManagers: FieldValue.arrayRemove(uid),
  });
  tx.delete(membersCol(db, poolId).doc(uid));
  const userRef = db.collection('users').doc(uid);
  tx.delete(poolRef.collection('participants').doc(uid));
  tx.delete(userRef.collection('participations').doc(poolId));
  tx.delete(userRef.collection('joinedPools').doc(poolId));
}

/** Remove a Member Record + drop the uid from participantIds (leave/last-entry-removal). */
export function voidMemberRecord(tx: Transaction, db: Firestore, poolId: string, uid: string): void {
  applyMembershipRemoval(tx, db, poolId, uid);
}

/**
 * Apply a membership reconciliation inside the caller's transaction. `existing` must
 * be read by the caller (Firestore forbids reads after writes in a transaction).
 */
export function reconcileMembership(
  tx: Transaction,
  db: Firestore,
  poolId: string,
  uid: string,
  facts: MembershipFacts,
  existing: MemberRecord | null,
  now: number,
): void {
  const poolRef = db.collection('pools').doc(poolId);
  const mRef = membersCol(db, poolId).doc(uid);
  const plan = planMembershipWrite(poolId, uid, facts, existing, now);

  if (plan.participant === 'remove') {
    // ONE code path for removal, deliberately. This branch and voidMemberRecord
    // were byte-identical duplicates, and the duplication is how the reciprocal
    // indexes came to be missed by both: a fix applied to one would not reach
    // the other. `applyMembershipRemoval` is now the single definition of what
    // a departure writes, so whichever removal callable is wired later inherits
    // the complete set no matter which helper it reaches for.
    applyMembershipRemoval(tx, db, poolId, uid);
    return;
  }
  tx.update(poolRef, { participantIds: FieldValue.arrayUnion(uid) });
  tx.set(mRef, plan.member.data, { merge: plan.member.merge });
}

/** Convenience: does a Member Record exist? (Non-transactional read for migrations.) */
export async function memberRecordExists(db: Firestore, poolId: string, uid: string): Promise<boolean> {
  const snap = await membersCol(db, poolId).doc(uid).get();
  return snap.exists;
}

export { ROSTER_SCHEMA_VERSION };
