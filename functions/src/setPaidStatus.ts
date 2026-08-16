// Single authorized path for Member Record payment writes. Replaces the four direct-client
// paidStatus writes (removed in the deferred wiring commit). Commissioner/owner/admin set the
// authoritative paidStatus; a member may set only their OWN honor-system claim, never paidStatus.
import * as admin from "firebase-admin";
import { isPoolCommissioner } from './poolOps';
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { validated } from "./lib/validated";
import { setPaidStatusSchema } from "./schemas/participantOps";
import { isProvableMember, membersCol } from "./lib/memberRecord";
import { isCanonicalMemberRecord } from "./shared/memberRecord";
import { refreshProjectionsBestEffort } from "./lib/refreshProjections";

/** Every entry doc this member owns (PLAN-MULTI-ENTRY D1: readers never parse ids). */
const ownedEntriesQuery = (poolRef: admin.firestore.DocumentReference, memberUid: string) =>
  poolRef.collection('entries').where('ownerUid', '==', memberUid);

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
      const existing = memberSnap.data();
      // Stamp the record CANONICAL whenever it is not already (codex P2, twice).
      //
      // Without this the two halves of this fix contradict each other about the
      // same person. In a legacy or partially-backfilled pool a uid can be in
      // `participantIds` with no Member Record; the guard above admits their
      // self-report on exactly that evidence, and the record it writes — claim
      // fields only — is precisely the shape `resolveReminderTargets` calls a
      // forgery. That member would be dropped from every nudge, having just
      // been told by the same feature that they are a member.
      //
      // The condition is "not canonical", NOT "does not exist" (codex r3): a
      // genuine participant who self-reported BEFORE this rollout already has a
      // claim-only document, so a create-only seed would never reach them and
      // they would be excluded permanently. Heal on touch, the same way
      // `ensureMemberRecord` heals `feeOwed` and `hasPlayableEntry`.
      //
      // Safe because it is unreachable without passing the guard, and a
      // NON-canonical record cannot pass on evidence 1 — so the only way here is
      // manager-written `participantIds`, and #341 cut the repair-job route that
      // laundered guest square claims into it.
      //
      // Deliberately NOT `planMembershipWrite`: it seeds `feeOwed` from the
      // pool's entry fee, and a member-triggered path must not write money.
      const seed: Record<string, unknown> = {};
      if (!isCanonicalMemberRecord(existing)) {
        seed.uid = uid;
        seed.poolId = poolId;
        seed.joinedAt = now;
        const tokenName = request.auth!.token?.name;
        if (typeof tokenName === 'string' && tokenName && !existing?.userName) {
          seed.userName = tokenName;
        }
        // paidStatus ONLY on create. `reconcilePaymentTruth` can promote a
        // claim-only document to PAID from a paid entry, so an existing
        // non-canonical record may already carry a commissioner-owned PAID that
        // this member-triggered path must never reset to UNPAID.
        if (!memberSnap.exists) seed.paidStatus = 'UNPAID';
      }
      tx.set(mRef, { ...seed, memberReportedPaid: !!claim, memberReportedAt: now }, { merge: true });
    });
    return { success: true, mode: 'claim' as const };
  }

  // --- Authoritative paid mark: commissioner/owner/admin only ---
  // PLAN-CO-COMMISSIONERS C6 (K3 = Yes): a co-commissioner may mark members
  // paid — one helper, same principal set as every other NFL commissioner
  // callable, so the ledger and the tab agree on who is a commissioner.
  const isOwner = isPoolCommissioner(pool, uid) || request.auth!.token?.role === 'SUPER_ADMIN';
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
      // PLAN-MULTI-ENTRY D3: rebuyOwed is the SUM across every entry the
      // member owns, so the legacy derivation below reads them all (codex r2
      // on the plan) — entries/{uid} plus any `e${n}:${uid}` / auto-id doc.
      const [snap, ownedSnap] = await Promise.all([tx.get(mRef), tx.get(ownedEntriesQuery(poolRef, memberUid))]);
      if (!snap.exists) throw new HttpsError("not-found", "MEMBER_NOT_ON_ROSTER: Member is not on this pool's roster.");
      // A legacy entries/{uid} doc may carry no `ownerUid` and so miss the
      // query — read it too, as the paid mirror below does (qodo #2 on #450).
      const legacyRebuySnap = ownedSnap.docs.some(d => d.id === memberUid)
        ? null : await tx.get(poolRef.collection('entries').doc(memberUid));
      const rebuyDocs = [...ownedSnap.docs, ...(legacyRebuySnap?.exists ? [legacyRebuySnap] : [])];
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
          // Same guard as the ledger sum above: untyped Firestore data, and
          // this derived figure is persisted as `rebuyOwed` (qodo re-review on #450).
          const rebuysUsed: number = rebuyDocs.reduce((n, d) => {
            const v = (d.data() as any).rebuysUsed;
            return n + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
          }, 0);
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
  let memberFeeOwed: number | undefined;
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
    // PLAN-MULTI-ENTRY D2: Paid Status is ONE flag per member, so the mirror
    // lands on EVERY entry the member owns — entries/{uid} (entry #1, and every
    // legacy doc) plus any `e${n}:${uid}` / auto-id extra. Members without an
    // entry (the commissioner, or joined-not-yet-picked) simply have no doc to
    // mirror onto. Read inside the tx (all reads before writes).
    const ownedSnap = await tx.get(ownedEntriesQuery(poolRef, memberUid));
    const legacyRef = poolRef.collection('entries').doc(memberUid);
    const legacySnap = ownedSnap.docs.some(d => d.id === memberUid) ? null : await tx.get(legacyRef);
    const entryRefs = [
      ...ownedSnap.docs.map(d => d.ref),
      ...(legacySnap?.exists ? [legacyRef] : []),
    ];
    memberName = snap.data()?.userName;
    // The ledger amount is what this member OWES — `feeOwed`, the fee × liable
    // entries figure (D2) — not the per-entry pool fee.
    memberFeeOwed = typeof snap.data()?.feeOwed === 'number' ? snap.data()!.feeOwed : undefined;
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
    for (const entryRef of entryRefs) {
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
        ...(typeof (memberFeeOwed ?? entryFee) === 'number' ? { amount: memberFeeOwed ?? entryFee } : {}),
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
