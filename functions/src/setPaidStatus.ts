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
import { isCanonicalMemberRecord, derivePaidStatus, liableEntryIds, type MemberRecord, type PaidEntryMap } from "./shared/memberRecord";
import { readPoolDues, writePoolDues } from "./lib/poolDues";
import { entryHasPick } from "./lib/multiEntry";
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
  const { poolId, memberUid, isPaid, claim, settleRebuys, entryId, paymentMethod, paidAt, paymentNote } = input;

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

    // --- PLAN-MULTI-ENTRY-DUES P2-T2: per-entry dues -------------------------
    //
    // The whole feature in one paragraph: `paidEntries` is the truth (D1),
    // `paidStatus` is a STORED SUMMARY derived from it (D1/section 0a), and both
    // are written HERE, in this one transaction, so they cannot disagree.
    //
    // The liable set comes from the entry documents this transaction already
    // read — `entries` on the Member Record carries no pick state, deliberately
    // (commissioner-blind picks), so it cannot answer WHICH entries are liable.
    // See `liableEntryIds`.
    const member = snap.data() as unknown as MemberRecord;
    // The per-entry map now lives in the CLOSED `private/` subcollection, not on
    // this participant-readable record (amended D1). Read in the SAME
    // transaction, which is what replaces single-document atomicity now that
    // money truth spans two documents.
    const storedMap = await readPoolDues(tx, poolRef, memberUid);
    const pickedEntryIds = ownedSnap.docs.filter(d => entryHasPick(d.data())).map(d => d.id);
    if (legacySnap?.exists && entryHasPick(legacySnap.data())) pickedEntryIds.push(legacyRef.id);
    const liable = liableEntryIds(member, memberUid, pickedEntryIds);
    // 🛑 A LEGACY `PAID` RECORD IS MATERIALIZED BEFORE ANYTHING IS DERIVED FROM
    // IT, AND SKIPPING THIS DOWNGRADES PAYING MEMBERS IN PRODUCTION (codex r1).
    //
    // Every record written before this ticket has NO `paidEntries` — including
    // members who are already `PAID`. Treating that absence as "nothing is paid"
    // and then deriving would turn the first per-entry edit on such a member
    // into an UNPAID mark plus a spurious ledger event: money already collected,
    // reported as owed. Pools are live and members are already PAID, so this is
    // reachable on real data on day one, not a migration hypothetical.
    //
    // R3 in the plan already fixes the rule — `undefined` means "no per-entry
    // detail recorded" and the reader falls back to the stored `paidStatus`.
    // This is that rule applied at the moment of the write: a stored `PAID`
    // means every entry the member is liable for was paid, so seed exactly
    // those, carrying the member-level detail onto each row so the ledger and
    // the roster keep the date and method they already displayed.
    //
    // Deliberately NOT a backfill (plan section 5, fix-forward): only the record
    // being written is materialized, and only inside this transaction. After the
    // D1 amendment the legacy shape is an ABSENT dues DOCUMENT rather than an
    // absent field, which changes nothing about the rule.
    // Null-prototype throughout: `map['__proto__'] = row` on an ordinary object
    // sets the PROTOTYPE instead of creating a key (see `RESERVED_ID` in
    // shared/memberRecord.ts). `liableEntryIds` already filters such ids out, so
    // this is the second lock on the same door — the maps here are also built
    // from stored Firestore data, which this code does not get to choose.
    const legacySeed: PaidEntryMap = Object.create(null);
    if (!storedMap && member.paidStatus === 'PAID') {
      for (const id of liable) {
        legacySeed[id] = {
          ...(typeof member.paidAt === 'number' ? { paidAt: member.paidAt } : {}),
          ...(typeof (member as { paymentMethod?: unknown }).paymentMethod === 'string'
            ? { method: (member as { paymentMethod?: string }).paymentMethod } : {}),
        };
      }
    }
    const priorPaidEntries: PaidEntryMap = storedMap
      ? Object.assign(Object.create(null), storedMap) : legacySeed;

    // ENTRY_NOT_FOUND rather than a ghost key (D7a). Marking PAID is restricted
    // to rows the ledger actually charges; UN-marking additionally allows any id
    // already in the map, so a key stranded by a fee change or a delete can
    // still be cleaned up — that direction only ever REMOVES paid state.
    if (entryId !== undefined) {
      const payable = isPaid
        ? liable.includes(entryId)
        : liable.includes(entryId) || Object.prototype.hasOwnProperty.call(priorPaidEntries, entryId);
      if (!payable) {
        throw new HttpsError("not-found",
          "ENTRY_NOT_FOUND: That entry is not one of this member's payable entries.");
      }
    }

    // The row itself. D1b: PRESENCE is the paid signal — there is no
    // `paid: boolean`, so an un-mark DELETES the key rather than falsifying it.
    const paidRow: PaidEntryMap[string] = {
      ...(stampedPaidAt !== undefined ? { paidAt: stampedPaidAt } : {}),
      ...(paymentMethod !== undefined ? { method: paymentMethod } : {}),
      ...(paymentNote !== undefined && paymentNote !== null ? { note: paymentNote.slice(0, 500) } : {}),
    };
    // Which keys this mark moves: the named entry, or EVERY liable entry when
    // no entryId was given (the member-level mark keeps working exactly as it
    // reads — "this member has paid" means all of their rows).
    const targetIds = entryId !== undefined ? [entryId] : liable;
    const nextPaidEntries: PaidEntryMap = Object.assign(Object.create(null), priorPaidEntries);
    for (const id of targetIds) {
      if (isPaid) nextPaidEntries[id] = paidRow;
      else delete nextPaidEntries[id];
    }
    // The SUMMARY, recomputed from the map that is being written in this same
    // transaction — never from the caller's intent.
    const nextPaidStatus = derivePaidStatus({ ...member, paidEntries: nextPaidEntries }, liable);
    // WHICH rows this call actually moved. Everything the ledger says is
    // computed from this, never from the verb or the member-level flag — see
    // the ledger block below for the two ways that goes wrong.
    const changedIds = targetIds.filter(id => Object.prototype.hasOwnProperty.call(priorPaidEntries, id) !== isPaid);

    if (isPaid) {
      tx.set(mRef, {
        paidStatus: nextPaidStatus,
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
      //
      // ⚠️ THE CLEAR IS NOW CONDITIONAL ON THE DERIVED SUMMARY, not on the verb.
      // Un-marking an id that is not in the liable set (the D7a cleanup case)
      // can leave every liable entry still paid, so `nextPaidStatus` stays PAID
      // — and wiping the member's payment date out from under a PAID summary
      // would produce exactly the mismatch this clear exists to prevent, in the
      // other direction.
      tx.set(mRef, {
        paidStatus: nextPaidStatus,
        paidBy: uid,
        ...(nextPaidStatus === 'UNPAID' ? {
          paidAt: FieldValue.delete(),
          paymentMethod: FieldValue.delete(),
          paymentNote: FieldValue.delete(),
        } : {}),
      }, { merge: true });
    }

    // The per-entry map, written WHOLE, to the CLOSED dues document.
    //
    // ⚠️ THIS SUPERSEDES D1b's `new FieldPath('paidEntries', entryId)`
    // INSTRUCTION, for two reasons that both point the same way. First, the
    // legacy seed above has to PERSIST — a materialization that exists only in
    // memory derives the right summary and then stores a map with one key in it,
    // which is a bug test 7i caught before review did. Persisting it is a
    // whole-map write by definition, so a per-key path would be a SECOND write
    // shape covering a subset of the cases. Second, `paidEntries` is now the
    // whole point of its own document rather than one field among many, so
    // replacing it wholesale is the natural write and the `:`-in-a-dotted-path
    // ambiguity D1b was avoiding never arises at all — the ids are object keys
    // here, never path segments.
    //
    // Safe because this transaction READ that document (`readPoolDues` above).
    // Spread back to an ORDINARY object for the write: object spread copies own
    // keys as data properties (never through a setter), and the Firestore
    // serializer is not asked to reason about a null prototype.
    writePoolDues(tx, poolRef, poolId, memberUid, { ...nextPaidEntries }, Date.now());
    // The mirror lands on the NAMED entry only when one was named — mirroring a
    // single entry's payment onto all of the member's entries is the
    // all-or-nothing behaviour this ticket removes. With no entryId the member
    // -level mark still touches every entry, exactly as before.
    const mirrorRefs = entryId !== undefined
      ? entryRefs.filter(r => r.id === entryId)
      : entryRefs;
    for (const entryRef of mirrorRefs) {
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
    //
    // ⚠️ FOR A PER-ENTRY MARK THE TRANSITION IS THE ENTRY'S, NOT THE MEMBER'S.
    // Paying entry 2 of 3 leaves the member UNPAID before and after, so the
    // member-level test reports "no transition" and the payment would appear in
    // NO ledger — money received with no record, which is the failure the
    // ledger exists to prevent. Keyed on the map instead: presence changed.
    // A row moved, or nothing happened. This replaces the member-level
    // PAID/UNPAID comparison, which was wrong in BOTH directions once a partial
    // map exists (codex r1/r2):
    //
    //   - paying entry 2 of 3 leaves the member UNPAID before and after, so the
    //     member-level test saw no transition and $25 was received with NO
    //     ledger row at all;
    //   - a member-level mark over a partial map moves only the rows that were
    //     still outstanding, but the member-level test reported the whole
    //     `feeOwed` — $50 recorded for the $25 that was actually collected —
    //     and a bulk un-mark from an already-UNPAID partial state recorded
    //     nothing at all.
    const isTransition = changedIds.length > 0;
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
      // The AMOUNT is what THIS mark settles: one entry's fee for a per-entry
      // mark, the member's whole `feeOwed` for a member-level one. Billing the
      // member total against a single entry is the $50-for-one-entry defect
      // this plan exists to fix, arriving in the ledger instead of the UI.
      // The AMOUNT is what THIS call settled: the fee for the rows that moved.
      //
      // The one case that keeps the member's stored `feeOwed` is a member-level
      // mark that moved EVERY liable row — today's behaviour, preserved exactly,
      // because `feeOwed` is the authority on what a member owes and can differ
      // from `entryFee x liable` on a legacy record whose stamp predates a fee
      // change. Any partial movement is priced per row instead, which is the
      // only way the ledger can add up to what was handed over.
      const movedEverything = entryId === undefined && changedIds.length === liable.length;
      const ledgerAmount = movedEverything
        ? (memberFeeOwed ?? entryFee)
        : (typeof entryFee === 'number' ? entryFee * changedIds.length : undefined);
      tx.set(ledgerRef, {
        type: isPaid ? 'MARKED_PAID' : 'MARKED_UNPAID',
        uid: memberUid,
        // `entryName` stays the MEMBER's name — it is an existing reader
        // contract shared with the rebuy and payout writers, and repurposing it
        // per entry would silently change what every historical row means. It
        // is also the safe choice: naming the ENTRY here would leak the same bit
        // the box below refuses to write.
        ...(memberName !== undefined ? { entryName: memberName } : {}),
        // 🛑 THE ENTRY ID IS DELIBERATELY *NOT* WRITTEN HERE, AND AN EARLIER
        // VERSION OF THIS PR DID WRITE IT.
        //
        // `pools/{id}/payments` is `allow read: if isPoolParticipant()`
        // (firestore.rules) — every member of the pool reads this trail. A row
        // saying `entryId: e2:alice` proves Alice's entry 2 has committed a
        // pick, because only a LIABLE entry can be marked paid. That is the
        // exact leak the 2026-08-26 amendment moved `paidEntries` off the
        // Member Record to close, arriving through the other participant-
        // readable door, and it would have shipped inside the fix for itself.
        //
        // Nothing is lost that this trail is for. Its stated job is to settle
        // "I paid you" disputes, and amount + date + note + actor do that. The
        // commissioner's per-entry attribution lives in the sealed dues
        // document, which P2-T5 reads through a callable.
        ...(typeof ledgerAmount === 'number' ? { amount: ledgerAmount } : {}),
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
