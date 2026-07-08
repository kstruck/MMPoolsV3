// Maintains pools/{poolId}/rosterSummary/current — the member-readable roster projection
// (member count, dues collected/expected, paid/unpaid, guest/unclaimed-squares bucket).
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import {
  computeRosterSummary,
  type DuesInputs,
  type MemberRecord,
  type RosterSummary,
} from "../shared/memberRecord";

type Firestore = admin.firestore.Firestore;

export function rosterSummaryRef(db: Firestore, poolId: string) {
  return db.collection('pools').doc(poolId).collection('rosterSummary').doc('current');
}

function duesInputs(pool: any): DuesInputs {
  return {
    poolType: pool.type || '',
    entryFee: pool.settings?.entryFee ?? 0,
    costPerSquare: pool.costPerSquare ?? pool.settings?.costPerSquare,
  };
}

/** SQUARES dues owed on squares claimed under the "guest" sentinel (no Member Record). */
function guestUnclaimedDues(pool: any, inputs: DuesInputs): number {
  if (inputs.poolType !== 'SQUARES') return 0;
  const squares: any[] = Array.isArray(pool.squares) ? pool.squares : [];
  const unit = inputs.costPerSquare ?? inputs.entryFee ?? 0;
  const guestCount = squares.filter((s) => s?.reservedByUid === 'guest').length;
  return unit * guestCount;
}

export async function recomputeRosterSummary(db: Firestore, poolId: string): Promise<RosterSummary> {
  const poolRef = db.collection('pools').doc(poolId);
  const [poolSnap, membersSnap] = await Promise.all([
    poolRef.get(),
    poolRef.collection('members').get(),
  ]);
  const pool: any = poolSnap.data() || {};
  const members = membersSnap.docs.map((d) => d.data() as MemberRecord);
  const inputs = duesInputs(pool);
  const summary = computeRosterSummary(members, inputs, guestUnclaimedDues(pool, inputs));
  await rosterSummaryRef(db, poolId).set(
    { ...summary, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return summary;
}
