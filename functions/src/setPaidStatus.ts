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
  const { poolId, memberUid, isPaid, claim, paymentMethod, paidAt, paymentNote } = input;

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
  // Member Record mutation + ledger append + entry-doc mirror in ONE transaction
  // (ADR 0003 item 5; PLAN-PAYMENT-TRUTH P1). The mirror is REQUIRED, not
  // cosmetic: the Bento ledger UI is entry-backed (ledgerStats counts
  // entry.paidStatus and the table renders entry paymentMethod/paidAt/
  // paymentNote), so repointing that panel here without mirroring would blank
  // its table and freeze the collected/remaining figures. Mirroring in the same
  // transaction makes the two stores agree by construction, which is what turns
  // P2's reconciliation into a one-off for historical data.
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(mRef);
    if (!snap.exists) throw new HttpsError("not-found", "Member is not on this pool's roster.");
    // NFL entry docs are keyed by uid (nflPools), so the member's entry — when
    // they have one — lives at entries/{memberUid}. Members without an entry
    // (e.g. the commissioner, or joined-not-yet-picked) simply have no doc to
    // mirror onto. Read inside the tx (all reads before writes).
    const entryRef = poolRef.collection('entries').doc(memberUid);
    const entrySnap = await tx.get(entryRef);
    memberName = snap.data()?.userName;
    // paidAt: number = commissioner-chosen date, null = explicit clear-the-date
    // (paid, but no date on record — codex r2), absent = stamp now.
    const stampedPaidAt =
      typeof paidAt === 'number' ? paidAt : (paidAt === null ? undefined : Date.now());
    if (isPaid) {
      tx.set(mRef, {
        paidStatus: 'PAID',
        paidAt: stampedPaidAt ?? FieldValue.delete(),
        paidBy: uid,
        ...(paymentMethod !== undefined ? { paymentMethod } : {}),
        ...(paymentNote !== undefined
          ? { paymentNote: paymentNote === null ? FieldValue.delete() : paymentNote.slice(0, 500) }
          : {}),
      }, { merge: true });
    } else {
      // UNPAID is a full clear (schema refuses details with it): stale
      // method/date/note on an unpaid member misreads as a payment record.
      tx.set(mRef, {
        paidStatus: 'UNPAID',
        paidAt: FieldValue.delete(),
        paidBy: uid,
        paymentMethod: FieldValue.delete(),
        paymentNote: FieldValue.delete(),
      }, { merge: true });
    }
    if (entrySnap.exists) {
      // Mirror keeps updateEntryPayment's field conventions (method
      // overwritten-or-cleared, literal-null clears for date/note) so the
      // entry-backed panel displays exactly what it used to — with two
      // deliberate divergences from the old path (codex r2/r3): the UNPAID
      // transition clears the details instead of preserving stale ones, and
      // the PAID mirror gets the RESOLVED timestamp (the quick toggle sends no
      // paidAt; without this the member record says now while the panel's
      // date column says N/A).
      // An omitted method PRESERVES the stored one on both stores (codex r4 —
      // the old path's delete-when-absent would diverge from the member
      // record, which merge-preserves it); UNPAID still clears everything.
      tx.update(entryRef, {
        paidStatus: isPaid ? 'PAID' : 'UNPAID',
        ...(isPaid
          ? {
              ...(paymentMethod !== undefined ? { paymentMethod } : {}),
              paidAt: stampedPaidAt ?? null,
              ...(paymentNote !== undefined
                ? { paymentNote: paymentNote === null ? null : paymentNote.slice(0, 500) }
                : {}),
            }
          : { paymentMethod: FieldValue.delete(), paidAt: null, paymentNote: null }),
        updatedAt: Date.now(),
      });
    }
    // Append a ledger event ONLY on a real status transition (codex r3): a
    // metadata-only edit of an already-PAID row is not a payment-state change,
    // and a MARKED_PAID row per note edit reads as money moving again in the
    // member-facing ledger.
    const priorStatus = snap.data()?.paidStatus;
    const isTransition = isPaid ? priorStatus !== 'PAID' : priorStatus === 'PAID';
    if (isTransition) {
      // Dispute-prevention detail, when the commissioner recorded it. The
      // shared ledger's reader contract is `note` (PaymentLedgerEvent /
      // PaymentsPanel, same field the rebuy and payout writers use — codex r1),
      // so method and note fold into it rather than landing in fields nothing
      // renders.
      const noteParts = [
        paymentMethod,
        typeof paymentNote === 'string' ? paymentNote.slice(0, 500) : undefined,
      ].filter(Boolean);
      const ledgerRef = poolRef.collection('payments').doc();
      tx.set(ledgerRef, {
        type: isPaid ? 'MARKED_PAID' : 'MARKED_UNPAID',
        uid: memberUid,
        entryName: memberName,
        amount: typeof entryFee === 'number' ? entryFee : undefined,
        actorUid: uid,
        at: Date.now(),
        createdAt: FieldValue.serverTimestamp(),
        ...(noteParts.length > 0 ? { note: noteParts.join(' — ') } : {}),
      });
    }
  });

  // Derived projections refresh right after (eventual — not in the write tx because they
  // fan-out read all members/pools; the onMemberWrite trigger also covers this).
  await recomputeRosterSummary(db, poolId);
  const owner = ownerOf(pool);
  if (owner) await recomputeCommissionerAggregate(db, owner);

  return { success: true, mode: 'paid' as const };
  },
);
