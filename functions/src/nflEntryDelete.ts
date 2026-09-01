/**
 * `deleteNFLEntry` — a commissioner removes an entry that was never paid for and
 * never scored (PLAN-MULTI-ENTRY-DUES D2/D3/D4/D7/D8/D12, Kevin 2026-08-25:
 * *"If they do not pay for one, the commissioner should be able to delete the
 * non-paid entry and that should reflect on the payment ledger."*).
 *
 * 🛑 THIS IS THE FIRST PATH IN THIS REPO THAT LOWERS A COUNTER THAT HAS ONLY
 * EVER GONE UP. `playableEntryCount` and `pool.entryCount` were one-way by
 * design (parent plan K7: *"deleting an entry is out of scope"*). What makes
 * lowering them safe is not care, it is the two refusals below — and if either
 * is ever relaxed, D4 (the pot decrement) has to be re-decided in the same
 * breath. D9 is the tripwire paragraph for that.
 *
 * TWO REFUSALS, AND THE SECOND IS LOAD-BEARING FOR THE WHOLE FEATURE:
 *
 *   D2  `ENTRY_IS_PAID`   — money already collected has no undo, and the ledger
 *                           is the only place it was ever written down. The
 *                           commissioner un-marks first, which leaves a visible
 *                           `MARKED_UNPAID` line rather than a silent side
 *                           effect of a delete.
 *   D3  `ENTRY_IS_SCORED` — tested on the POOL, not the entry. An entry with
 *                           `totalScore: 0` in a pool that has scored week 1 is
 *                           still ON the published board, and may be NAMED in a
 *                           recap. **This is what makes D4 safe**: no published
 *                           prize can have been priced at the old denominator,
 *                           because nothing has been published at all.
 *
 * WHAT IT WRITES — one transaction, and the count is the point:
 *   1. the entry document, HARD deleted (D12 — not a tombstone; five readers
 *      would each have to learn to filter one);
 *   2. the Member Record: `entries` roster map rebuilt WITHOUT the id,
 *      `playableEntryCount` RECOUNTED from the surviving documents, `feeOwed`
 *      restamped (only if it was already there), `paidStatus` re-derived;
 *   3. the dues document's key for that entry, removed (D1/N2 — a re-created
 *      entry at the same id starts unpaid, so a commissioner cannot manufacture
 *      a paid entry by deleting and re-adding one);
 *   4. `pool.entryCount`, clamped at zero (D8);
 *   5. a `payments` ledger line and an `admin_audit` row — the durable record,
 *      since D12 keeps no corpse.
 *
 * WHAT IT DOES NOT TOUCH (D7b): `rebuyOwed` / `rebuyPaid`, which are
 * member-level sums settled independently; and the `entryFee` CASCADE, which
 * exists for a fee change and would restamp the whole roster over one entry.
 *
 * AUTHORIZATION: commissioner only — `isPoolCommissioner`, the same helper
 * `setPaidStatus` uses, so the ledger and the tab agree on who a commissioner
 * is. `firestore.rules` is untouched (D11): entries are already
 * `allow write: if false` and every write here goes through admin credentials.
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { assertNotBannedLive } from './lib/systemGuards';
import { membersCol } from './lib/memberRecord';
import { entryCountAfterDelete, entryHasPick, ownerStateWithout, resolveOwnedEntry } from './lib/multiEntry';
import { readPoolDues, writePoolDues } from './lib/poolDues';
import { derivePaidStatus, liableEntryIds, memberLiableEntries, memberPlayedEntries, paidEntryCountOf, type MemberRecord } from './shared/memberRecord';
import { validated } from './lib/validated';
import { deleteNFLEntrySchema } from './schemas/poolCore';
import { isPoolCommissioner } from './poolOps';
import { legacyPublishedWeeks } from './lib/publishedWeeks';
import { writeAuditEvent } from './audit';
import { confirmedAdminClaim } from './lib/confirmedRole';

/** The NFL pool types that have entries at all. */
const NFL_ENTRY_POOL_TYPES = new Set(['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN']);

export interface DeleteEntryResult {
  success: true;
  entryId: string;
  entryIndex: number;
  entryName?: string;
  /** How much the member's liability fell — 0 when the entry was never liable. */
  liabilityDelta: number;
}

/**
 * Extracted from the callable so the emulator suite can drive it directly (same
 * shape as `renameNFLEntryInternal`); the auth and ban checks stay in the
 * wrapper, and `actorUid` is the already-authorized commissioner.
 */
export async function deleteNFLEntryInternal(
  db: admin.firestore.Firestore,
  ctx: { actorUid: string; actorRole?: unknown },
  payload: { poolId: string; targetUid: string; entryIndex: number },
): Promise<DeleteEntryResult> {
  const { poolId, targetUid, entryIndex } = payload;
  const poolRef = db.collection('pools').doc(poolId);
  let out: DeleteEntryResult | null = null;

  await db.runTransaction(async (tx) => {
    // ---- READS. Firestore requires every read before any write, and the dues
    // document is one of them now that money truth spans two documents (D1).
    const poolSnap = await tx.get(poolRef);
    if (!poolSnap.exists) throw new HttpsError('not-found', 'Pool not found.');
    const pool = poolSnap.data() as Record<string, unknown> & { type?: string; settings?: { entryFee?: unknown }; entryCount?: unknown };
    if (!NFL_ENTRY_POOL_TYPES.has(String(pool.type))) {
      throw new HttpsError('failed-precondition',
        'NOT_AN_NFL_POOL: entries can only be deleted in NFL pools.');
    }
    if (!isPoolCommissioner(pool, ctx.actorUid) && String(ctx.actorRole) !== 'SUPER_ADMIN') {
      throw new HttpsError('permission-denied',
        'Only the commissioner can delete an entry.');
    }

    // ---- D3, and it is checked THREE ways because it is load-bearing for D4.
    //
    // `legacyPublishedWeeks` folds `scoredWeeks` and the legacy
    // `scoredThroughWeek` high-water mark into one list, so a pool that predates
    // the per-week markers is covered. `standings/current` is asserted
    // separately rather than trusted to follow: a published projection is the
    // thing members have actually SEEN, and if it exists at all this delete
    // would be removing a row from under them.
    const standingsRef = poolRef.collection('standings').doc('current');
    const standingsSnap = await tx.get(standingsRef);
    // `publishedWeeks` is checked FIRST because it is the strongest of the three
    // and `legacyPublishedWeeks` does not read it (codex r2).
    //
    // 🛑 A PROVISIONAL SCORING PASS WRITES IT AND WITHHOLDS THE OTHERS.
    // `nflPools.ts:1876` sets `publishedWeeks.{week}` whenever anything was
    // revealed, while `scoredWeeks` and `scoredThroughWeek` are wrapped in
    // `...(provisional ? {} : { … })` — deliberately, so a mid-week pass cannot
    // trip finalization. So a mid-week pool CAN have shown members a result and
    // carry neither marker `legacyPublishedWeeks` reads.
    //
    // Today `standings/current` also lands on that pass and would catch it, but
    // that is a projection — overwritten every pass and, in principle,
    // removable. `publishedWeeks` is documented as SET-ONCE AND NEVER CLEARED,
    // "the durable evidence that members have already seen that week's
    // outcome". Depending on the projection to imply the durable marker is the
    // weaker of two available tests, so take the durable one.
    const publishedMap = pool.publishedWeeks as Record<string, unknown> | undefined;
    const anyPublished = !!publishedMap && typeof publishedMap === 'object'
      && Object.values(publishedMap).some(v => v === true);
    const scored = legacyPublishedWeeks(pool);
    if (anyPublished || scored.length > 0 || standingsSnap.exists) {
      throw new HttpsError('failed-precondition',
        'ENTRY_IS_SCORED: this pool has already scored a week, so entries can no longer be deleted. '
        + 'Published standings, recaps and prizes reference them.');
    }

    const target = await resolveOwnedEntry(tx, poolRef, targetUid, entryIndex);
    // A delete must never CREATE, and `resolveOwnedEntry` hands back a ref for a
    // document that does not exist yet — that is how submit creates one.
    if (target.existing === null) {
      throw new HttpsError('not-found',
        `ENTRY_NOT_FOUND: that member has no entry #${entryIndex} in this pool.`);
    }
    const entryId = target.ref.id;

    const memberRef = membersCol(db, poolId).doc(targetUid);
    const memberSnap = await tx.get(memberRef);
    // 🛑 NO MEMBER RECORD ⇒ REFUSE, rather than delete and hope (codex r2).
    //
    // An orphan entry is reachable on a pool that predates ADR-0003's roster
    // model. Treating the absent record as `{}` looked harmless and is not:
    // `memberLiableEntries({})` is 1 both before AND after (an undefined role
    // counts as a participant, and the join liability floor is 1), so
    // `liabilityDelta` is ZERO — the entry document would be destroyed while
    // `pool.entryCount` went on counting it, leaving the pot denominator
    // permanently one too high with nothing left to explain why.
    //
    // Refusing is recoverable: the record is rebuilt by the member's next
    // submit or by the roster backfill, and the delete then works. Deleting is
    // not — D12 keeps no corpse.
    if (!memberSnap.exists) {
      throw new HttpsError('failed-precondition',
        'ENTRY_MEMBER_NOT_FOUND: that entry has no Member Record, so its dues cannot be recomputed. '
        + 'Have the member save a pick once — that rebuilds the roster and the counters — then retry.');
    }
    const member = memberSnap.data() as MemberRecord;
    const storedDues = await readPoolDues(tx, poolRef, targetUid);
    // Read only when the counter has to be DERIVED (legacy pool with no
    // `entryCount`) — a whole-collection read on every delete otherwise.
    const membersForCount = typeof pool.entryCount === 'number'
      ? null
      : (await tx.get(membersCol(db, poolId))).docs.map(d => d.data() as Record<string, unknown>);

    // ---- D2. Every source of payment evidence refuses, not just the canonical
    // one. The dues map is authoritative, but a record that predates it means
    // "no per-entry detail" and falls back to the member summary (R3), and the
    // entry document carries a mirror. Any of the three saying PAID refuses:
    // the failure direction is "a commissioner is told to un-mark first", which
    // is one click, against "collected money is destroyed", which has no undo.
    const paidByMap = storedDues
      ? Object.prototype.hasOwnProperty.call(storedDues, entryId)
      : member.paidStatus === 'PAID';
    const paidByMirror = (target.existing as { paidStatus?: unknown }).paidStatus === 'PAID';
    if (paidByMap || paidByMirror) {
      throw new HttpsError('failed-precondition',
        'ENTRY_IS_PAID: this entry is marked paid. Un-mark its payment first, so the money coming '
        + 'off the books is recorded, then delete it.');
    }

    // ---- The arithmetic. ONE delta drives all three counters (D8): three
    // numbers derived from one quantity cannot disagree; three independent
    // decrements can.
    const after = ownerStateWithout(target.owned, entryId);
    const liableBefore = memberLiableEntries(member);

    // 🛑 THE RECORD MUST AGREE WITH THE DOCUMENTS BEFORE ANY ARITHMETIC ON IT
    // (codex r3, generalising its finding about the recovery advice).
    //
    // The delta is `liableAfter - liableBefore`, and `liableBefore` comes from
    // the STORED counter. If that counter disagrees with the entry documents,
    // the delta is a subtraction between two different worlds — and it fails
    // SILENTLY toward zero, destroying an entry while `pool.entryCount` goes on
    // counting it.
    //
    // This is not hypothetical. `backfillMemberRecords` writes a record with
    // `merge: false` and NO `playableEntryCount` and NO `entries`
    // (`migrations/backfillMemberRecords.ts:270`), so a backfilled member who
    // owns two picked entries reads as liable for ONE. An earlier version of
    // this callable's own error message recommended running that backfill as
    // the fix — which would have manufactured exactly this state.
    //
    // A pre-T2 record whose `playableEntryCount` is absent but whose
    // `hasPlayableEntry` latch is set still agrees when it owns one picked
    // entry, which is the ordinary legacy shape and passes.
    const pickedBefore = target.owned.filter(e => entryHasPick(e.data)).length;
    if (memberPlayedEntries(member) !== pickedBefore) {
      throw new HttpsError('failed-precondition',
        'MEMBER_RECORD_STALE: the stored entry count for this member disagrees with their actual entries, '
        + `so deleting one cannot be costed safely (record says ${memberPlayedEntries(member)}, `
        + `documents say ${pickedBefore}). Have the member save a pick once — that restamps the record — then retry.`);
    }
    const memberAfter: MemberRecord = {
      ...member,
      playableEntryCount: after.playableEntryCount,
      hasPlayableEntry: after.playableEntryCount > 0,
      entries: after.entries,
    };
    const liableAfter = memberLiableEntries(memberAfter);
    const liabilityDelta = liableAfter - liableBefore;

    // ---- WRITES ----
    // 1. HARD delete (D12). A tombstone would have to be filtered by
    //    `resolveOwnedEntry`'s cap check, the standings fold, the reveal, the
    //    profile aggregate and the ledger — five readers, five places to forget.
    tx.delete(target.ref);

    // 2. The Member Record.
    //
    // 🛑 `feeOwed` IS LOWERED ONLY IF IT WAS ALREADY THERE (D7a). An ABSENT
    // `feeOwed` predates the ADR-0005 stamp and means "unknown"; `memberDues`
    // falls back to the pool fee for exactly that case. Writing a computed
    // number would convert an unknown into a claim — on the one path in this
    // plan that REDUCES money owed.
    const entryFee = Number(pool.settings?.entryFee ?? 0);
    const memberPatch: Record<string, unknown> = {
      entries: after.entries,
      playableEntryCount: after.playableEntryCount,
      // 🛑 THE LATCH IS CLEARED TOO, AND THIS IS THE SECOND ONE-WAY THING THIS
      // CALLABLE MAKES REVERSIBLE (codex r1 on T4).
      //
      // `hasPlayableEntry` is documented as one-way because "a member cannot
      // un-submit, and losing membership deletes the record outright, so there
      // is no case that clears it". A DELETE is exactly that missing case, and
      // it did not exist when the field was written.
      //
      // Leaving it `true` on a member whose last entry just went leaves a GHOST
      // COMPETITOR: `buildMemberStandings` includes an unscored member on the
      // strength of this latch (`memberStandings.ts:234`), and `ownedEntryIds`
      // treats an EMPTY roster map as a legacy record with one entry keyed by
      // the uid (`:111`) — so the deleted entry keeps a standings row that
      // members can see, until scoring starts.
      //
      // Recount-driven in both directions, like `playableEntryCount` beside it.
      // It cannot disturb liability: `memberPlayedEntries` prefers
      // `playableEntryCount` whenever that is a number, and it always is here.
      hasPlayableEntry: after.playableEntryCount > 0,
    };
    // `pickedWeeks` is a member-level UNION of weeks with at least one pick, and
    // it is union-only for the same reason the latch was one-way: nobody can
    // un-pick. A delete is again the missing case.
    //
    // ⚠️ CLEARED ONLY WHEN NOTHING SURVIVES, and the partial case is left ALONE
    // ON PURPOSE (codex r2, accepted with a bound). With other entries still
    // present the union may over-claim a week whose only pick belonged to the
    // deleted entry — but it CANNOT be recomputed here: pick'em picks are keyed
    // by gameId, not week, so deriving the week set would need every game
    // document. The consequence is bounded to display — a standings cell reads
    // "Hidden" instead of "—" for a week the member no longer has a pick in —
    // and D3 guarantees nothing is scored, so no result is being misreported.
    // Stated rather than silently accepted; pinned by a test.
    if (after.playableEntryCount === 0 && Object.keys(after.entries).length === 0) {
      memberPatch.pickedWeeks = FieldValue.delete();
    }
    if (typeof member.feeOwed === 'number') {
      memberPatch.feeOwed = entryFee * liableAfter;
      memberPatch.feeOwedSource = 'LIVE';
    }
    // 3. The dues key, removed with the entry (N2). Computed here because the
    //    summary below is derived from it in the same transaction.
    //
    // ⚠️ THE `delete` IS UNREACHABLE FOR THE TARGET ENTRY, BY D2 — recorded
    // because a mutation test SURVIVES it and the next person deserves to know
    // that is deliberate rather than a coverage hole. D2 above refuses whenever
    // `storedDues` has this id, so by the time control reaches here it cannot.
    // What this line really does is keep the OTHER members' keys — the spread —
    // and state the N2 rule where a future relaxation of D2 would need it.
    //
    // The coupling is pinned instead of the line: the D2 test asserts that a
    // dues key REFUSES the delete, so if D2 ever stops checking the map, that
    // test fails and this line stops being decorative.
    const duesAfter = { ...(storedDues ?? {}) };
    delete duesAfter[entryId];
    const liableIdsAfter = liableEntryIds(memberAfter, targetUid, after.pickedEntryIds);
    memberPatch.paidStatus = derivePaidStatus(
      { ...memberAfter, paidEntries: duesAfter },
      liableIdsAfter,
    );
    // 🛑 THE MIRRORED COUNT MOVES WITH THE MAP, UNCONDITIONALLY — and NOT under
    // the `if (storedDues)` that guards the dues write below (D1 writer #2,
    // PLAN-PARTIAL-DUES-AGGREGATES C1).
    //
    // That write is conditional for a good reason (R3: do not invent a dues
    // document for a member who never had one). The COUNT is a different animal:
    // it lives on the Member Record, which always exists here, and deleting an
    // entry SHRINKS the liable set whether or not a dues document exists. Gating
    // it the same way would leave a stale count above a member whose liability
    // just fell — the count over-reporting money is precisely the direction C2
    // is written to prevent.
    //
    // Computed from `duesAfter` and `liableIdsAfter`, the same two values the
    // summary above was derived from, so the pair cannot disagree.
    memberPatch.paidEntryCount = paidEntryCountOf(duesAfter, liableIdsAfter);
    // A member who is no longer paid in full must not keep payment DETAIL — the
    // same clear `setPaidStatus` and `planMembershipWrite` apply.
    if (memberPatch.paidStatus === 'UNPAID' && member.paidStatus === 'PAID') {
      memberPatch.paidAt = FieldValue.delete();
      memberPatch.paymentMethod = FieldValue.delete();
      memberPatch.paymentNote = FieldValue.delete();
    }
    // 🛑 `update`, NOT `set(..., { merge: true })`, AND MY FIRST VERSION GOT THIS
    // WRONG — the emulator test caught it, not review.
    //
    // A merge UNIONS nested maps, so `entries: <map without the deleted id>`
    // written with merge leaves the deleted id sitting there: the roster map is
    // the ONLY copy other members can read, so the entry would vanish from its
    // owner's switcher and stay on everyone else's standings. `update` REPLACES
    // a field value, which is the only way to express a removal.
    //
    // Exactly the trap D1b names for `paidEntries`, in a second place. Any map
    // on this record that can LOSE a key has to be written this way.
    //
    // Safe: the document exists (checked), and `update` accepts the
    // `FieldValue.delete()` sentinels above.
    tx.update(memberRef, memberPatch);
    // Only touch the dues store if there was one — creating an empty document
    // for a member who never had one would invent a second representation of
    // "nothing recorded" (R3).
    if (storedDues) writePoolDues(tx, poolRef, poolId, targetUid, duesAfter, Date.now());

    // 4. The pot denominator, clamped (D8).
    const countPatch = entryCountAfterDelete(pool, membersForCount, liabilityDelta);
    if (Object.keys(countPatch).length > 0) tx.update(poolRef, countPatch);

    // 5. The durable record. D12 keeps no corpse, so this IS the trail — and it
    //    carries the NAME and INDEX, not just the id: entry ids are
    //    deterministic and REUSABLE (`e2:uid`), so two deletions of "entry 2"
    //    would otherwise be indistinguishable.
    const entryName = (target.existing as { entryName?: unknown }).entryName;
    // ⚠️ The LEDGER is participant-readable (`allow read: if isPoolParticipant()`)
    // and so must not name the entry id — same rule the paid/unpaid rows follow.
    // The audit row below is where the id belongs.
    tx.set(poolRef.collection('payments').doc(), {
      type: 'ENTRY_DELETED',
      uid: targetUid,
      ...(typeof member.userName === 'string' ? { entryName: member.userName } : {}),
      ...(liabilityDelta !== 0 && entryFee > 0 ? { amount: entryFee * -liabilityDelta } : {}),
      actorUid: ctx.actorUid,
      at: Date.now(),
      createdAt: FieldValue.serverTimestamp(),
      note: `Entry #${entryIndex}${typeof entryName === 'string' && entryName ? ` "${entryName}"` : ''} deleted by the commissioner`
        + (liabilityDelta === 0 ? ' (it had no committed pick, so no dues changed)' : ''),
    });

    // 🛑 AND THE ADMIN AUDIT ROW. D12 is explicit that the durable record is
    // "an `admin_audit` row (actor, target uid, entry id, index, name,
    // timestamp) AND a ledger line, neither of which the delete can remove" —
    // the delete keeps no corpse, so these two ARE the evidence.
    //
    // Written INSIDE this transaction (the helper takes one), so a deletion can
    // never be committed without its trail. No `dedupeKey`, so the helper
    // performs no read and cannot violate reads-before-writes.
    //
    // Unlike the ledger line, this row MAY name the entry id: `pools/{id}/audit`
    // is not participant-readable, and the id is what makes two deletions of
    // "entry 2" distinguishable.
    await writeAuditEvent({
      poolId,
      type: 'ENTRY_DELETED',
      message: `Entry #${entryIndex}${typeof entryName === 'string' && entryName ? ` "${entryName}"` : ''} of ${targetUid} deleted by ${ctx.actorUid}`,
      severity: 'WARNING',
      actor: { uid: ctx.actorUid, role: 'ADMIN', label: 'Commissioner' },
      payload: {
        targetUid,
        entryId,
        entryIndex,
        ...(typeof entryName === 'string' && entryName ? { entryName } : {}),
        liabilityDelta,
        feeOwedBefore: member.feeOwed ?? null,
        entryFee,
      },
    }, tx);

    out = {
      success: true,
      entryId,
      entryIndex,
      ...(typeof entryName === 'string' && entryName ? { entryName } : {}),
      liabilityDelta,
    };
  });

  if (!out) throw new HttpsError('internal', 'ENTRY_DELETE_FAILED: the transaction produced no result.');
  return out;
}

export const deleteNFLEntry = validated(
  { schema: deleteNFLEntrySchema, label: 'deleteNFLEntry', appCheck: 'monitor' },
  async (input, request) => {
    const uid = request.auth!.uid;
    await assertNotBannedLive(uid);
    return deleteNFLEntryInternal(
      admin.firestore(),
      // Unconfirmed SUPER_ADMIN claims stripped BEFORE the transaction
      // (Phase 3, PLAN-API-TRUST-BOUNDARY) — the in-tx bypass at the
      // commissioner check now sees a resolved role.
      { actorUid: uid, actorRole: await confirmedAdminClaim(request) },
      input,
    );
  },
);
