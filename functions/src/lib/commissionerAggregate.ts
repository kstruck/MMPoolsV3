// Maintains users/{ownerUid}.commissionerAggregate — the cross-pool commissioner rollup
// (pools managed, participants, dues collected/expected, payouts). Computed from Member
// Record roster summaries + payout ledger, never a client blob (replaces the never-written
// user.managerStats). See docs/adr/0003.
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { foldCommissionerAggregate, type RosterSummary, type CommissionerAggregate } from "../shared/memberRecord";
import { recomputeRosterSummary, rosterSummaryRef } from "./rosterSummary";
import { isActivePoolForStats } from "./poolInclusion";

type Firestore = admin.firestore.Firestore;

/** Total payouts recorded for a pool (winners marked paid out). */
export async function sumPoolPayouts(db: Firestore, poolId: string): Promise<number> {
  const snap = await db.collection('pools').doc(poolId).collection('winners').get();
  let total = 0;
  for (const d of snap.docs) {
    const w: any = d.data();
    if (w?.paidOut === true || w?.paidStatus === 'PAID') total += w.amount || 0;
  }
  return total;
}

export async function recomputeCommissionerAggregate(db: Firestore, ownerUid: string): Promise<CommissionerAggregate> {
  const snap = await db.collection('pools').where('ownerId', '==', ownerUid).get();
  const summaries: RosterSummary[] = [];
  const payouts: number[] = [];
  for (const doc of snap.docs) {
    const pool: any = doc.data();
    if (!isActivePoolForStats(pool, doc.id)) continue;
    const sSnap = await rosterSummaryRef(db, doc.id).get();
    const summary = sSnap.exists ? (sSnap.data() as RosterSummary) : await recomputeRosterSummary(db, doc.id);
    summaries.push(summary);
    payouts.push(await sumPoolPayouts(db, doc.id));
  }
  const agg = foldCommissionerAggregate(summaries, payouts);
  await db.collection('users').doc(ownerUid).set(
    { commissionerAggregate: { ...agg, updatedAt: FieldValue.serverTimestamp() } },
    { merge: true },
  );
  return agg;
}

/** Resolve the owner uid to refresh from a pool doc. */
export function ownerOf(pool: any): string | undefined {
  return pool?.ownerId || pool?.createdByUid || pool?.managerUid;
}
