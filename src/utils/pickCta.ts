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
    /** No useful action behind the button — render it disabled, do not hide it. */
    disabled: boolean;
}

export function pickCtaFor({ locked, complete, hasAnyPick }: PickCtaInput): PickCta {
    if (!locked) {
        return complete
            ? { label: 'Edit My Picks', disabled: false }
            : { label: 'Make Picks', disabled: false };
    }
    // Locked: nothing can change. There is still something to look at if a
    // pick exists; otherwise the honest state is "you missed it".
    return hasAnyPick
        ? { label: 'View My Picks', disabled: false }
        : { label: 'Picks Locked', disabled: true };
}
