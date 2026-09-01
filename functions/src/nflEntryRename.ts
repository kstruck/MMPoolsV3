/**
 * `renameNFLEntry` — change the display name of an NFL entry that already
 * exists (PLAN-MULTI-ENTRY K5 follow-up, Kevin 2026-08-26).
 *
 * 🛑 WHY THIS IS A NEW CALLABLE AND NOT A FLAG ON `submitNFLPicks`.
 *
 * `entryName` has only ever travelled on `submitNFLPicks`, which means renaming
 * required re-submitting picks — and the Survivor/Margin branches
 * (`nflPools.ts:756`, `:820`) throw `Missing … team selection` when `picks` has
 * no team for the week, so on two of the three NFL pool types there was no
 * rename path at all once a week had locked. Extending that transaction was
 * rejected: it carries the effective-lock gates, the resubmit idempotency
 * latch, fee liability (`ensureMemberRecord`), `pickedWeeks`, `pool.entryCount`
 * and the K11 paid-reset. A rename must touch NONE of those, and the cheapest
 * way to guarantee that is to not be in the same code path.
 *
 * WHAT THIS WRITES — three documents, one transaction, and nothing else:
 *   1. the entry doc's `entryName` (the source of truth);
 *   2. the Member Record's `entries` roster map name for that entry id — this
 *      is what makes the new name visible to OTHER members, who cannot read
 *      entry documents (`firestore.rules`: entries are own-entry-only);
 *   3. the matching row in `pools/{id}/standings/current`, because a SCORED row
 *      is rendered from that projection rather than from the roster map.
 *
 * WHAT IT MUST NOT WRITE: `feeOwed`, `playableEntryCount`, `paidStatus`,
 * `pool.entryCount`, `pickedWeeks`, `submittedAt`, `lastRequestId`, `picks`,
 * `usedTeams`, `strikes`, `rank`. The emulator suite asserts every one of them
 * is byte-identical across a rename.
 *
 * AUTHORIZATION: the entry's OWNER, and only the owner, from
 * `request.auth.uid`. A commissioner rename was considered and deliberately NOT
 * built — see the PR body. It would add a new authorization capability (and so
 * a plan gate under `mmp-change-control` §1) to buy a rename the member can
 * already perform themselves. `firestore.rules` is untouched: entries are
 * already `allow write: if false`, and every write here goes through this
 * callable's admin credentials.
 */
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { assertNotBannedLive } from './lib/systemGuards';
import { membersCol } from './lib/memberRecord';
import { assertEntryNameFree, entryHasPick, ownerStateAfter, resolveOwnedEntry } from './lib/multiEntry';
import { validated } from './lib/validated';
import { renameNFLEntrySchema } from './schemas/poolCore';
import { assertNFLPickMembership, type MemberActionContext } from './nflPools';
import { confirmedAdminClaim } from './lib/confirmedRole';

/** The NFL pool types that have entries at all — a rename is meaningless elsewhere. */
const NFL_ENTRY_POOL_TYPES = new Set(['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN']);

/**
 * Rename one of the caller's own entries. Extracted from the callable so the
 * emulator suite can drive it directly (same shape as
 * `submitNFLPicksInternal`); the auth + ban checks stay in the wrapper.
 */
export async function renameNFLEntryInternal(
  db: admin.firestore.Firestore,
  ctx: MemberActionContext,
  payload: { poolId: string; entryIndex: number; entryName: string },
): Promise<{ success: true; entryId: string; entryName: string }> {
  const uid = ctx.subjectUid;
  const { poolId, entryIndex, entryName } = payload;

  const poolRef = db.collection('pools').doc(poolId);
  let renamedId = '';
  let renamedName = '';

  // ⚠️ NO SCORING LEASE, DELIBERATELY (`assertNoScoringInProgress`, which
  // `submitNFLPicksInternal` takes). A submit needs it because it changes what
  // the scorer is mid-way through reading; a rename changes no input to
  // scoring. The two orderings both end correctly on their own:
  //   - scorer commits first  → this transaction's reads (the entry doc and
  //     `standings/current`) are stale, Firestore aborts and retries us, and we
  //     patch the freshly published rows.
  //   - rename commits first  → the scorer republishes `rows` from the entry
  //     documents, which now carry the new name, so the projection self-heals.
  // Nothing here writes the pool document, so the scoring FENCE
  // (`checkFence`, which reads only the pool doc) is never disturbed.
  await db.runTransaction(async (transaction) => {
    // ---- READS (Firestore requires all reads before any write) ----
    const poolSnap = await transaction.get(poolRef);
    if (!poolSnap.exists) throw new HttpsError('not-found', 'Pool not found.');
    // Only the fields this callable actually consults — the pool TYPE and the
    // four membership fields `assertNFLPickMembership` reads.
    const pool = poolSnap.data() as {
      type?: string; participantIds?: unknown; ownerId?: string; managerUid?: string; createdByUid?: string;
    };
    if (!NFL_ENTRY_POOL_TYPES.has(String(pool.type))) {
      throw new HttpsError('failed-precondition', 'NOT_AN_NFL_POOL: entries can only be renamed in NFL pools.');
    }
    // A departed member must not rename a row that outlived their membership.
    // Same predicate the submit path uses, so the two cannot drift.
    assertNFLPickMembership(pool, uid, ctx.actorRole);

    // Which doc IS "entry n of uid" — deterministic id, the owned-entries set,
    // and the auto-id fallback, all read inside this transaction. Reused rather
    // than reimplemented so the rename addresses exactly the document a submit
    // would (lib/multiEntry.ts).
    const target = await resolveOwnedEntry(transaction, poolRef, uid, entryIndex);
    // 🛑 A RENAME MUST NEVER CREATE AN ENTRY. `resolveOwnedEntry` hands back a
    // ref for a doc that does not exist yet (that is how submit creates one);
    // here that case is a refusal, not a write. Creating an entry through this
    // path would mint a contestant with no picks that still moved
    // `pool.entryCount` and the owner's dues — the exact liability this
    // callable is built to leave alone.
    if (target.existing === null) {
      throw new HttpsError('not-found',
        `ENTRY_NOT_FOUND: you do not have an entry #${entryIndex} in this pool yet. An entry is created by its first saved pick.`);
    }

    // K5 uniqueness, per owner, case-insensitive — the same helper the submit
    // transaction calls. Throws ENTRY_NAME_EMPTY / ENTRY_NAME_TAKEN, both
    // already mapped in src/utils/errorMessages.ts.
    const name = assertEntryNameFree(entryName, target);

    const memberRef = membersCol(db, poolId).doc(uid);
    const memberSnap = await transaction.get(memberRef);
    const standingsRef = poolRef.collection('standings').doc('current');
    const standingsSnap = await transaction.get(standingsRef);

    // ---- WRITES ----
    // 1. The entry doc FIRST, and it alone is the source of truth. A merge of a
    //    single field: nothing else on the document is named, so nothing else
    //    can move.
    //
    //    The entry REVISION watermark is deliberately NOT bumped. It exists to
    //    force one more scoring pass when a pick lands after the scorer read
    //    entries (lib/entryRevision.ts); a rename changes no pick, so bumping it
    //    would buy an extra pass that recomputes identical scores.
    transaction.set(target.ref, { entryName: name }, { merge: true });

    // 2. The Member Record's roster map — the ONLY copy of the name that other
    //    members can read (participants cannot read entry docs).
    //
    //    ⚠️ THE WHOLE MAP IS REBUILT, NOT ONE NESTED KEY. Writing just
    //    `entries.<id>.name` onto a LEGACY record that has no map at all would
    //    create a map holding exactly one id — and `ownedEntryIds`
    //    (src/utils/memberStandings.ts:107) renders one row per key in that
    //    map, so every OTHER entry this member owns would lose its standings
    //    row. `ownerStateAfter` rebuilds the map from the entry docs read in
    //    this transaction, with the new name substituted for the target.
    //
    //    Its `playableEntryCount` is DISCARDED on purpose: it is a one-way
    //    counter tied to fee liability, and a rename has no business restating
    //    it even to the same value.
    if (memberSnap.exists) {
      const { entries } = ownerStateAfter(target.owned, {
        id: target.ref.id,
        entryIndex,
        entryName: name,
        hasPick: entryHasPick(target.existing),
      });
      transaction.set(memberRef, { entries }, { merge: true });
    }
    // No Member Record ⇒ nothing to update. One is NOT created here: a rename
    // must not invent membership, dues or paid state for someone the roster
    // does not carry. The entry doc write above still lands, so the owner's own
    // switcher shows the new name and the next submit rebuilds the roster map.

    // 3. The published standings projection. A row that has been SCORED is
    //    rendered from `standings/current`, not from the roster map above, so
    //    without this the two would disagree until the next scoring pass.
    //
    //    🛑 THE ORDER MATTERS AND IT IS THE ORDER ABOVE. The entry doc is
    //    written before this patch precisely so that if a scoring pass races us
    //    and republishes `rows` from the entry documents, it re-derives the NEW
    //    name and the projection self-heals. Patching the projection first
    //    would make the losing order the one that sticks.
    if (standingsSnap.exists) {
      const rows = (standingsSnap.data() as { rows?: unknown })?.rows;
      if (Array.isArray(rows)) {
        let hit = false;
        const patched = (rows as Array<Record<string, unknown>>).map((r) => {
          if (r && r.id === target.ref.id) { hit = true; return { ...r, entryName: name }; }
          return r;
        });
        // Only write when a row actually changed: an unscored entry has no row
        // yet, and rewriting an untouched array would churn `standings/current`
        // (which the deadline-extension guard reads) for nothing.
        if (hit) transaction.update(standingsRef, { rows: patched });
      }
    }

    renamedId = target.ref.id;
    renamedName = name;
  });

  return { success: true, entryId: renamedId, entryName: renamedName };
}

/** Renames one of the caller's own entries in an NFL pool. */
export const renameNFLEntry = validated(
  { schema: renameNFLEntrySchema, label: "renameNFLEntry", appCheck: "monitor" },
  async (input, request) => {
    await assertNotBannedLive(request.auth!.uid);
    const token = request.auth!.token as { name?: string; role?: string };
    return renameNFLEntryInternal(
      admin.firestore(),
      {
        actorUid: request.auth!.uid,
        // Unconfirmed SUPER_ADMIN claims stripped (Phase 3) — this value feeds
        // assertNFLPickMembership's admin bypass.
        actorRole: await confirmedAdminClaim(request),
        // 🛑 THE SUBJECT IS THE CALLER, ALWAYS. There is no payload uid and
        // there must never be one — the entry id is derived from this value.
        subjectUid: request.auth!.uid,
        subjectName: token?.name,
      },
      { poolId: input.poolId, entryIndex: input.entryIndex, entryName: input.entryName },
    );
  },
);
