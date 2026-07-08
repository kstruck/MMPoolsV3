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

  if (!existing) {
    // First write: seed payment defaults. Merge=false so the doc is well-formed.
    data.paidStatus = 'UNPAID';
    data.joinedAt = now;
    return { participant: 'add', member: { op: 'set', data, merge: false } };
  }
  // Update: merge identity/units only; preserve paidStatus + claim.
  return { participant: 'add', member: { op: 'set', data, merge: true } };
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
