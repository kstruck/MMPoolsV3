// Single authorized path for Member Record payment writes. Replaces the four direct-client
// paidStatus writes (removed in the deferred wiring commit). Commissioner/owner/admin set the
// authoritative paidStatus; a member may set only their OWN honor-system claim, never paidStatus.
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { validated } from "./lib/validated";
import { setPaidStatusSchema } from "./schemas/participantOps";
import { membersCol } from "./lib/memberRecord";
import { recomputeRosterSummary } from "./lib/rosterSummary";
import { recomputeCommissionerAggregate, ownerOf } from "./lib/commissionerAggregate";

export const setPaidStatus = validated(
  // Dual-mode contract preserved: claim present = member self-report; claim
  // absent = authoritative mark (owner/commissioner/SUPER_ADMIN check below).
  { schema: setPaidStatusSchema, label: "setPaidStatus", appCheck: "monitor" },
  async (input, request) => {
  const uid = request.auth!.uid;
  const { poolId, memberUid, isPaid, claim } = input;

  const db = admin.firestore();
  const poolRef = db.collection('pools').doc(poolId);
  const poolSnap = await poolRef.get();
  if (!poolSnap.exists) throw new HttpsError("not-found", "Pool not found.");
  const pool: any = poolSnap.data();
  const mRef = membersCol(db, poolId).doc(memberUid);

  // --- Member self-report claim: own record only, claim fields only ---
  if (claim !== undefined) {
    if (memberUid !== uid) throw new HttpsError("permission-denied", "Members can only report their own payment.");
    await mRef.set({ memberReportedPaid: !!claim, memberReportedAt: Date.now() }, { merge: true });
    return { success: true, mode: 'claim' as const };
  }

  // --- Authoritative paid mark: commissioner/owner/admin only ---
  const isOwner =
    pool.ownerId === uid || pool.managerUid === uid || pool.createdByUid === uid ||
    request.auth!.token?.role === 'SUPER_ADMIN';
  if (!isOwner) throw new HttpsError("permission-denied", "Only the commissioner can set paid status.");

  const entryFee: number | undefined = pool.settings?.entryFee;
  let memberName: string | undefined;
  // Member Record mutation + ledger append in one transaction (ADR 0003 item 5).
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(mRef);
    if (!snap.exists) throw new HttpsError("not-found", "Member is not on this pool's roster.");
    memberName = snap.data()?.userName;
    tx.set(mRef, {
      paidStatus: isPaid ? 'PAID' : 'UNPAID',
      paidAt: isPaid ? Date.now() : FieldValue.delete(),
      paidBy: uid,
    }, { merge: true });
    const ledgerRef = poolRef.collection('payments').doc();
    tx.set(ledgerRef, {
      type: isPaid ? 'MARKED_PAID' : 'MARKED_UNPAID',
      uid: memberUid,
      entryName: memberName,
      amount: typeof entryFee === 'number' ? entryFee : undefined,
      actorUid: uid,
      at: Date.now(),
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  // Derived projections refresh right after (eventual — not in the write tx because they
  // fan-out read all members/pools; the onMemberWrite trigger also covers this).
  await recomputeRosterSummary(db, poolId);
  const owner = ownerOf(pool);
  if (owner) await recomputeCommissionerAggregate(db, owner);

  return { success: true, mode: 'paid' as const };
  },
);
