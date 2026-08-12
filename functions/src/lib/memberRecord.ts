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
import { ROSTER_SCHEMA_VERSION, type MemberRecord } from "../shared/memberRecord";

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
  return { participant: 'add', member: { op: 'set', data, merge: true } };
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
