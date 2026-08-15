/**
 * The ONE label rule for every "go make/edit your picks" button on the pool
 * home — the week-checklist banner, the live-week card, the bottom strip.
 *
 * Kevin, 2026-08-14 (item 8): the two red buttons must agree. No picks in →
 * "Make Picks". Picks in and edits still allowed → "Edit My Picks". Derived
 * from the member's OWN entry and the pool's lock rule, never from a hardcoded
 * string per button — three buttons carried three different labels for the
 * same state ("Make picks" / "Make My Picks" / "Submit My Picks Now").
 *
 * This reads only the viewer's own entry, so a client-side lock check is the
 * right tool: the reveal boundary that must stay server-only
 * (`weekRevealFor`) is about OTHER members' picks, and none are read here.
 *
 * ponytail: takes booleans, not the entry — `isWeekComplete` /
 * `isWeekLockedNow` (utils/nflPending) already compute them per pool type and
 * lock mode; this is the label table on top. Under PLAN-MULTI-ENTRY the caller
 * passes the ACTIVE entry's booleans; the table does not change.
 */
export interface PickCtaInput {
    /** The pool's lock rule says this week can no longer be edited. */
    locked: boolean;
    /** Every pick this week asks for is in (Pick'em: whole slate; Survivor/Margin: the week's pick). */
    complete: boolean;
    /** At least one pick exists for the week (Pick'em can be half-filled). */
    hasAnyPick: boolean;
}

export interface PickCta {
    label: string;
}

/**
 * The button is NEVER disabled. It always goes to My Entry — a locked week is
 * still worth looking at, and the viewer's own entry can arrive a beat after
 * the standings rows (qodo on #435: `hasAnyPick` reads `myEntry.picks`, which
 * is grafted only once `ownEntry` loads, so a disabled state would have flashed
 * on every locked week during load). The LABEL is allowed to be provisional
 * for that beat; the ACTION is not.
 */
export function pickCtaFor({ locked, complete, hasAnyPick }: PickCtaInput): PickCta {
    if (!locked) {
        return complete ? { label: 'Edit My Picks' } : { label: 'Make Picks' };
    }
    // Locked: nothing can change. There is still something to look at if a
    // pick exists; otherwise the honest state is "you missed it".
    return hasAnyPick ? { label: 'View My Picks' } : { label: 'Picks Locked' };
}
