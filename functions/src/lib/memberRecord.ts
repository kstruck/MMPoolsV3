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
import { ROSTER_SCHEMA_VERSION, isCanonicalMemberRecord, type MemberRecord } from "../shared/memberRecord";

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
}

export type MembershipPlan =
  | { participant: 'remove'; member: { op: 'delete' } }
  | { participant: 'add'; member: { op: 'set'; data: Partial<MemberRecord>; merge: boolean } };

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

  // Base-dues liability (ADR 0005 Phase 4): a seeded MANAGER owes 0 until they
  // commit a playable entry; everyone else owes the pool fee from the moment
  // they join. Only computed when the caller supplied entryFee.
  const liableFee = facts.entryFee === undefined
    ? undefined
    : (facts.role === 'MANAGER' && !facts.hasPlayableEntry ? 0 : facts.entryFee);

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
    if (facts.hasPlayableEntry !== undefined) {
      data.hasPlayableEntry = facts.hasPlayableEntry;
    }
    return { participant: 'add', member: { op: 'set', data, merge: false } };
  }
  // Update: merge identity/units only; preserve paidStatus + claim. feeOwed is
  // filled when missing (heal-on-touch) or upgraded 0 -> fee when an owner who
  // previously hadn't played now has a playable entry. Never lowered here —
  // fee changes cascade through the entryFee-edit path instead.
  if (liableFee !== undefined && (existing.feeOwed === undefined || (existing.feeOwed === 0 && liableFee > 0))) {
    data.feeOwed = liableFee;
    data.feeOwedSource = 'LIVE';
  }
  // The latch only ever goes UP. Join/backfill touches pass `undefined`, and
  // writing `!!undefined` here would clear the flag on a member who has already
  // submitted — the join path at nflPools.ts:238 touches existing records on
  // every re-join, so that would not be a rare case. It also heals records
  // written before the field existed, without a backfill.
  if (facts.hasPlayableEntry === true && existing.hasPlayableEntry !== true) {
    data.hasPlayableEntry = true;
  }
  return { participant: 'add', member: { op: 'set', data, merge: true } };
}

/**
 * The literal string squares.ts inserts into `participantIds` for an anonymous
 * reservation. It is a sentinel, never a person — `src/utils/poolRoster.ts` and
 * `lib/reminderTargets.ts` both exclude it, and a membership predicate must not
 * be the one place that disagrees.
 */
const GUEST_SENTINEL = 'guest';

/**
 * Is `uid` a PROVABLE member of this pool? Two checks, both on data the caller
 * has already read — no extra query. See PLAN-SETPAIDSTATUS-MEMBERSHIP §4.
 *
 * ⚠️ There is no third check. Draft 4 accepted claimed-square ownership
 * (`pool.squares[*].reservedByUid === uid`) and review round 5 removed it as
 * ATTACKER-SETTABLE: `firestore.rules` makes every pool document world-readable,
 * so anyone with the pool id can read a `guestDeviceKey` off it and have
 * `claimMySquares` stamp `reservedByUid` for them. Reintroducing a
 * squares-ownership branch here restores the exact authorization route the plan
 * rejected.
 *
 * Callers pass plain data, not snapshots, so the rule is unit-testable.
 *
 * Both parameters are raw document data (`Record<string, unknown>`), not narrow
 * shapes: this is an authorization predicate and it must accept — and refuse —
 * a document carrying NONE of the fields it looks for. A
 * `{ joinedAt?: unknown }` parameter made the forged-record case
 * (`{ memberReportedPaid, memberReportedAt }`) a TS2559 compile error, i.e. the
 * type declared the most important input impossible. It is not; it is the one
 * this guard exists for. (codex r1)
 */
export function isProvableMember(
  pool: Record<string, unknown> | undefined,
  memberRecord: Record<string, unknown> | undefined,
  uid: string,
): boolean {
  // The sentinel is not an account. Rejected up front rather than only inside
  // the participantIds check: an authenticated user whose Firebase uid is the
  // literal string `guest` would otherwise be admitted to every pool holding a
  // single anonymous square reservation.
  if (!uid || uid === GUEST_SENTINEL) return false;

  // Evidence 1 — a CANONICAL Member Record. Mere existence proves nothing,
  // because the claim path this guard protects is itself a way to create one:
  // accepting existence would ratify a record forged before the fix.
  //
  // The discriminator lives in `shared/memberRecord.ts` because
  // `resolveReminderTargets` needs exactly the same one (§4a) — this guard shuts
  // the door on NEW forgeries, that filter stops OLD ones being emailed, and if
  // the two ever disagreed one of the doors would be open.
  if (isCanonicalMemberRecord(memberRecord)) return true;

  // Evidence 2 — the pool's own cross-type membership set. Every join path
  // writes it, and writing it needs `isPoolManager()`, so no self-add. A manager
  // listing someone as a participant IS membership.
  const ids = pool?.participantIds;
  return Array.isArray(ids) && ids.includes(uid);
}

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
): boolean {
  const plan = planMembershipWrite(poolId, uid, facts, existing, now);
  if (plan.participant !== 'add') return false;
  tx.set(membersCol(db, poolId).doc(uid), plan.member.data, { merge: plan.member.merge });
  return true;
}

/** Remove a Member Record + drop the uid from participantIds (leave/last-entry-removal). */
export function voidMemberRecord(tx: Transaction, db: Firestore, poolId: string, uid: string): void {
  tx.update(db.collection('pools').doc(poolId), { participantIds: FieldValue.arrayRemove(uid) });
  tx.delete(membersCol(db, poolId).doc(uid));
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
    tx.update(poolRef, { participantIds: FieldValue.arrayRemove(uid) });
    tx.delete(mRef);
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
