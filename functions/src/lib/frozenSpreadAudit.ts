// Was this change to a frozen line APPROVED? (PLAN-NFL-SPREAD-FREEZE 2.4,
// Revision 1's approval table.)
//
// Pure: the trigger's IO lives in `nflSpreadOverride.ts`. This is the decision,
// and it is the one the plan got wrong three separate times — each time by
// pointing a detector at the mechanism it exists to protect:
//
//  - original round 5: the predicate fired on any write to a game carrying the
//    marker, so the FREEZE ITSELF was an unapproved edit on all sixteen games;
//  - revision round 6: "no fresh `overrideId` means unapproved" files every
//    scheduled freeze as unauthorized, because a freeze by design carries none;
//  - revision round 8: the first `source` rule still demanded an `overrideId`
//    from writes that never carry one.
//
// The generalisation the plan settled on, and the reason this file exists at all:
// **every writer declares itself, and approval is judged PER SOURCE.** A console
// or Admin-SDK write satisfies no row of the table, because nothing tells it to
// set `source`.
//
// ⚠️ APPROVAL AND RESCORE ARE NOT THE SAME QUESTION (original round 11).
//
// | | Fires for |
// |---|---|
// | rescore enqueue | ANY change to a frozen line — override or not |
// | `admin_audit` "unapproved" row | only a change with no valid provenance |
//
// Collapsing them breaks the override outright: an approved override exists
// precisely to correct a line after results may already have been scored, and the
// rescore handoff is the only thing that repairs those standings. Routing
// overrides away from it would leave finalized ATS standings on the old number
// *because the change was properly approved*.

import type { FrozenSpread } from '../shared/frozenSpread';

export type FrozenChangeKind = 'create' | 'amend' | 'delete' | 'noop';

export interface FrozenChangeVerdict {
  kind: FrozenChangeKind;
  /** Enqueue a rescore? True for every real change. */
  rescore: boolean;
  /** Approved changes get no `admin_audit` "unapproved" row. */
  approved: boolean;
  reason: string;
}

const CREATE_SOURCES = new Set(['freeze', 'backfill']);

/**
 * ⚠️ AND `override` CREATES TOO — THE PLAN'S OWN TABLE CONTRADICTED ITSELF HERE,
 * AND IT IS THE FOURTH INSTANCE OF THE SAME PATTERN (found writing this file's
 * tests, 2026-08-20).
 *
 * The table in Revision 1 reads *"CREATE, no prior record → approved when `source`
 * is `freeze` or `backfill`"*. But `overrideLockedSpread` keeps a CREATE shape on
 * purpose — it is R3's whole remediation path, the only way to give a frozen line
 * to a game added to a slate after it froze — and the plan says two paragraphs
 * later that BOTH override paths write `source: 'override'` *"because the approval
 * table above would then have filed every legitimate override as an unapproved
 * change"*. Read literally, the table does exactly that anyway.
 *
 * So a create by the override is approved when it carries an id, which is what the
 * plan intended and what round 8 was reaching for. The plan is amended rather than
 * diverged from.
 */
const isApprovedOverrideCreate = (rec: FrozenSpread) => rec.source === 'override' && !!rec.overrideId;

/**
 * Every field a change to which alters what a week is graded on, or what the
 * detector can still see.
 *
 * `frozenAt` IS IN THIS LIST, and it has to be (round 15 of the original). A
 * whole-map console write can drop the marker while leaving value and `locked`
 * exactly as they were; on a predicate that ignored it, nothing fires, and the
 * game leaves the detector permanently after one quiet write.
 */
function materiallyEqual(a: FrozenSpread, b: FrozenSpread): boolean {
  return (
    a.value === b.value &&
    a.frozenAt === b.frozenAt &&
    a.source === b.source &&
    (a.overrideId ?? null) === (b.overrideId ?? null) &&
    a.season === b.season &&
    a.seasonType === b.seasonType &&
    a.week === b.week
  );
}

export function classifyFrozenChange(
  before: FrozenSpread | undefined,
  after: FrozenSpread | undefined,
): FrozenChangeVerdict {
  if (!before && !after) {
    return { kind: 'noop', rescore: false, approved: true, reason: 'no document on either side' };
  }

  if (!before && after) {
    // The first record for a game. It can still change what the week is graded
    // on: before it existed, readers fell back to `nfl_games.spread`, so a create
    // whose value differs from the working line moves the canonical number.
    const approved = CREATE_SOURCES.has(String(after.source)) || isApprovedOverrideCreate(after);
    return {
      kind: 'create',
      rescore: true,
      approved,
      reason: approved
        ? `created by ${after.source}`
        : `created with source ${after.source ?? '(none)'} — only freeze, backfill, or an override carrying an id may create a frozen line`,
    };
  }

  if (before && !after) {
    // Deleting a frozen record is a canonical-line change: reads fall back to the
    // working spread, so finalized ATS standings may need repair. NEVER approved —
    // nothing in the design deletes one (codex round 6 on the revision).
    return { kind: 'delete', rescore: true, approved: false, reason: 'a frozen record was deleted' };
  }

  const b = before as FrozenSpread;
  const a = after as FrozenSpread;
  if (materiallyEqual(b, a)) {
    return { kind: 'noop', rescore: false, approved: true, reason: 'no material change' };
  }

  const freshId = !!a.overrideId && a.overrideId !== b.overrideId;
  const approved = a.source === 'override' && freshId;
  return {
    kind: 'amend',
    rescore: true,
    approved,
    reason: approved
      ? `amended by override ${a.overrideId}`
      : `amended with source ${a.source ?? '(none)'}${freshId ? '' : ' and no fresh overrideId'} — only overrideLockedSpread may amend a frozen line`,
  };
}
