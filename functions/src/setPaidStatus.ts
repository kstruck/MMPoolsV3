// Single authorized path for Member Record payment writes. Replaces the four direct-client
// paidStatus writes (removed in the deferred wiring commit). Commissioner/owner/admin set the
// authoritative paidStatus; a member may set only their OWN honor-system claim, never paidStatus.
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { validated } from "./lib/validated";
import { setPaidStatusSchema } from "./schemas/participantOps";
import { isProvableMember, membersCol } from "./lib/memberRecord";
import { refreshProjectionsBestEffort } from "./lib/refreshProjections";

export const setPaidStatus = validated(
  // Dual-mode contract preserved: claim present = member self-report; claim
  // absent = authoritative mark (owner/commissioner/SUPER_ADMIN check below).
  { schema: setPaidStatusSchema, label: "setPaidStatus", appCheck: "monitor" },
  async (input, request) => {
  const uid = request.auth!.uid;
  const { poolId, memberUid, isPaid, claim, settleRebuys, paymentMethod, paidAt, paymentNote } = input;

  const db = admin.firestore();
  const poolRef = db.collection('pools').doc(poolId);
  const poolSnap = await poolRef.get();
  if (!poolSnap.exists) throw new HttpsError("not-found", "Pool not found.");
  const pool: any = poolSnap.data();
  const mRef = membersCol(db, poolId).doc(memberUid);

  // --- Member self-report claim: own record only, claim fields only ---
  if (claim !== undefined) {
    if (memberUid !== uid) throw new HttpsError("permission-denied", "Members can only report their own payment.");
    // PLAN-SETPAIDSTATUS-MEMBERSHIP. `set(..., { merge: true })` CREATES the
    // document when absent, and a Member Record is roster truth (ADR 0003) — so
    // with only the self-check above, any authenticated user could mint
    // `pools/{anyPool}/members/{their-uid}` and land on that pool's roster,
    // memberCount, dues figures and reminder targets.
    //
    // firestore.rules already encodes the correct policy beside this collection
    // (`allow create: if false`; update restricted to the same two claim fields
    // on an EXISTING doc). A callable runs with admin credentials and bypasses
    // rules, so this is not a new policy — it is the one path that never had one.
    //
    // Every piece of evidence is read with `tx.get` INSIDE the transaction,
    // including the pool document `poolSnap` already holds. Reusing that
    // snapshot would defeat the transaction: a `voidMemberRecord` landing after
    // it would go unobserved and the record would be resurrected from a stale
    // `participantIds` — the same class of bug this guard exists to close.
    await db.runTransaction(async (tx) => {
      const [freshPoolSnap, memberSnap] = await Promise.all([tx.get(poolRef), tx.get(mRef)]);
      // Deleting a pool does NOT delete its subcollections, so `members/*`
      // outlives its pool. Without this re-check, a pool deleted between the
      // opening read and this transaction would still admit a surviving
      // canonical record and the claim would recreate an orphan under it.
      if (!freshPoolSnap.exists) throw new HttpsError("not-found", "Pool not found.");
      if (!isProvableMember(freshPoolSnap.data(), memberSnap.data(), uid)) {
        throw new HttpsError("permission-denied", "NOT_A_POOL_MEMBER: You are not a member of this pool.");
      }
      const now = Date.now();
      // When the claim CREATES the record, stamp it canonical (codex P2 on
      // #338). Otherwise the two halves of this fix contradict each other on
      // the same person: the guard above just proved a legacy `participantIds`
      // member IS a member, and the record it then wrote — claim fields only —
      // is exactly the shape `resolveReminderTargets` calls a forgery, so that
      // member would never be nudged again. `backfillMemberRecords` would have
      // written the same stamp; this is heal-on-touch, not a new join path.
      //
      // Safe because it is unreachable without passing the guard, and the guard
      // takes only manager-written evidence — #341 cut the repair-job route that
      // laundered square claims into `participantIds`.
      //
      // Deliberately NOT `planMembershipWrite`: that seeds `feeOwed` from the
      // pool's entry fee, and a member-triggered path must not write a money
      // field. Identity and the join stamp only.
      const seedIfNew = memberSnap.exists
        ? {}
        : {
            uid,
            poolId,
            joinedAt: now,
            paidStatus: 'UNPAID' as const,
            ...(typeof request.auth!.token?.name === 'string' && request.auth!.token.name
              ? { userName: request.auth!.token.name }
              : {}),
          };
      tx.set(mRef, { ...seedIfNew, memberReportedPaid: !!claim, memberReportedAt: now }, { merge: true });
    });
    return { success: true, mode: 'claim' as const };
  }

  // --- Authoritative paid mark: commissioner/owner/admin only ---
  const isOwner =
    pool.ownerId === uid || pool.managerUid === uid || pool.createdByUid === uid ||
    request.auth!.token?.role === 'SUPER_ADMIN';
  if (!isOwner) throw new HttpsError("permission-denied", "Only the commissioner can set paid status.");

  // --- Rebuy settlement (PLAN-PAYMENT-TRUTH P3, Q2 = option B) ---
  // A rebuy is money OWED and collected out of band — the rebuy confirmation
  // tells the member "$X due to the commissioner" (SurvivorPickEntry). This is
  // the control that settles it: rebuyPaid := rebuyOwed (or back to 0), which
  // is the field memberDues has always added to `collected` — every rebuy
  // dollar was invisible to the pot and the roster until now because nothing
  // wrote it. Independent of base-dues paidStatus on purpose: a member who
  // paid their entry fee and still owes a rebuy is settled and unsettled at
  // the same time, which is exactly why option A (fold into paidStatus) was
  // rejected in the plan.
  if (settleRebuys !== undefined) {
    await db.runTransaction(async (tx) => {
      const entryRef = poolRef.collection('entries').doc(memberUid);
      const [snap, entrySnap] = await Promise.all([tx.get(mRef), tx.get(entryRef)]);
      if (!snap.exists) throw new HttpsError("not-found", "MEMBER_NOT_ON_ROSTER: Member is not on this pool's roster.");
      const m: any = snap.data();
      // LEGACY FALLBACK (codex r2): survivor pools have existed since
      // 2026-05-25 but the rebuyOwed writer only since 2026-07-08 (1bb7e89),
      // and the backfill copies only paidStatus — so a rebuy from that window
      // left rebuysUsed on the entry with NOTHING on the member record. When
      // the field was never stamped, derive the debt from the surviving
      // evidence and stamp it as part of the settlement, so every money
      // surface converges. A STAMPED rebuyOwed (any number, incl. 0) is
      // always trusted as-is — the live writer owns it.
      let owed: number;
      if (typeof m.rebuyOwed === 'number') {
        owed = m.rebuyOwed;
      } else {
        // Derivation chain for the never-stamped case (codex r4): the pool's
        // REBUY_DUE ledger events carry the amount actually charged AT REBUY
        // TIME, so they survive a later rebuyCost settings edit. Only when no
        // events exist either (the oldest window) does the count × CURRENT
        // price approximation apply.
        const dueEvents = await tx.get(
          poolRef.collection('payments')
            .where('uid', '==', memberUid)
            .where('type', '==', 'REBUY_DUE'),
        );
        const fromLedger = dueEvents.docs.reduce((sum, d) => {
          const amt = (d.data() as any).amount;
          return sum + (typeof amt === 'number' ? amt : 0);
        }, 0);
        if (dueEvents.size > 0) {
          owed = fromLedger;
        } else {
          const rebuysUsed: number = entrySnap.exists ? ((entrySnap.data() as any).rebuysUsed ?? 0) : 0;
          const rebuyCost: number = pool.settings?.rebuyCost ?? pool.settings?.entryFee ?? 0;
          owed = rebuysUsed * rebuyCost;
        }
      }
      const prevPaid = typeof m.rebuyPaid === 'number' ? m.rebuyPaid : 0;
      const nextPaid = settleRebuys ? owed : 0;
      // Transition-only, same contract as the base-dues ledger: re-clicking a
      // settled row is not a payment event.
      if (nextPaid === prevPaid) return;
      // Stamping rebuyOwed too makes the legacy-derived debt visible to
      // memberDues/rosterSummary — not just to this settlement.
      tx.set(mRef, { rebuyPaid: nextPaid, rebuyOwed: owed }, { merge: true });
      const entryName = m.userName;
      tx.set(poolRef.collection('payments').doc(), {
        type: settleRebuys ? 'REBUY_SETTLED' : 'REBUY_UNSETTLED',
        uid: memberUid,
        ...(entryName !== undefined ? { entryName } : {}),
        // The amount that MOVED, not the running total — ledger rows are events.
        amount: Math.abs(nextPaid - prevPaid),
        actorUid: uid,
        at: Date.now(),
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    // Non-fatal by design — see lib/refreshProjections.ts. The rebuy settlement
    // above is committed; failing the callable here would report collected money
    // as uncollected and invite a reversing retry.
    await refreshProjectionsBestEffort(db, poolId, pool);
    return { success: true, mode: 'rebuys' as const };
  }

  const entryFee: number | undefined = pool.settings?.entryFee;
  let memberName: string | undefined;
  // Member Record mutation + ledger append + entry-doc mirror in ONE transaction
  // (ADR 0003 item 5; PLAN-PAYMENT-TRUTH P1).
  //
  // ⚠️ The reason given here USED to be that the Bento ledger UI reads entry
  // docs. That stopped being true in #322, which repointed that panel onto the
  // Member Record. The mirror is still kept, but for a different and weaker
  // reason: other surfaces and exports still read `entry.paidStatus`, and
  // letting the two stores disagree is what P2's reconciliation existed to
  // clean up. Mirroring in the same transaction keeps them equal by
  // construction. Do not cite the Bento ledger as the justification again.
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(mRef);
    if (!snap.exists) throw new HttpsError("not-found", "MEMBER_NOT_ON_ROSTER: Member is not on this pool's roster.");
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
      // Conditional spreads on every optional field: this project deliberately
      // does NOT set ignoreUndefinedProperties (nflPools.ts:482 records the
      // crash class), so `amount: undefined` on a pool with no entryFee would
      // abort the WHOLE transaction — the paid mark included (codex r3 on P2,
      // which copied this shape and got caught).
      tx.set(ledgerRef, {
        type: isPaid ? 'MARKED_PAID' : 'MARKED_UNPAID',
        uid: memberUid,
        ...(memberName !== undefined ? { entryName: memberName } : {}),
        ...(typeof entryFee === 'number' ? { amount: entryFee } : {}),
        actorUid: uid,
        at: Date.now(),
        createdAt: FieldValue.serverTimestamp(),
        ...(noteParts.length > 0 ? { note: noteParts.join(' — ') } : {}),
      });
    }
  });

  // Derived projections refresh right after (eventual — not in the write tx because they
  // fan-out read all members/pools; onMemberRecordWrite also covers this). NON-FATAL:
  // the payment above is committed, and rejecting here would report it as failed and
  // invite a retry that reverses it. See lib/refreshProjections.ts.
  await refreshProjectionsBestEffort(db, poolId, pool);

  return { success: true, mode: 'paid' as const };
  },
);
