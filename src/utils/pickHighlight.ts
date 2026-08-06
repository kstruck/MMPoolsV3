/**
 * Team-button highlight for the NFL pick sheets (Pick'em / Survivor / Margin).
 *
 * Two DISTINCT states, deliberately different colours:
 *
 *  - **saved** (green) — the on-screen selection is the pick the SERVER holds.
 *  - **selected** (navy / gold) — chosen in this browser, not submitted yet.
 *
 * Before this helper existed, all six team buttons across the three sheets
 * inlined the same navy/gold string for "selected" and had no saved state at
 * all, so a member could not tell a submitted pick from an unsubmitted tap.
 * The three sheets are separate files and the string was copied between them —
 * one definition here so a colour change cannot land on two sheets out of
 * three (same one-definition defect class as #315 / #319).
 *
 * `saved` is only meaningful together with `selected`: the sheets seed their
 * selection from the saved entry, so "the saved pick" and "the current
 * selection" coincide until the member changes it — at which point the new
 * team goes gold and nothing is green, which is the honest reading.
 */
export function pickHighlightClass(isSelected: boolean, isSaved: boolean): string {
  if (isSelected && isSaved) {
    return 'bg-[#E4F5EC] dark:bg-[#0F7B4A]/15 border-[#0F7B4A] ring-2 ring-[#0F7B4A] dark:border-[#4CC38A] dark:ring-[#4CC38A]';
  }
  if (isSelected) {
    return 'bg-page border-navy-600 ring-2 ring-navy-600 dark:border-gold-500 dark:ring-gold-500';
  }
  return 'bg-page border-line';
}

/**
 * The corner check badge Survivor and Margin draw on the chosen team. Same
 * green/gold split as the ring so the two never disagree about which state the
 * card is in.
 */
export function pickBadgeClass(isSaved: boolean): string {
  return isSaved
    ? 'bg-[#0F7B4A] text-white dark:bg-[#4CC38A] dark:text-ink'
    : 'bg-navy-800 text-white dark:bg-gold-500 dark:text-ink';
}

/**
 * Screen-reader / tooltip wording for the same three states. The colour alone
 * fails WCAG 1.4.1 (use of colour) and is invisible to a colour-blind member;
 * the sheets render this as the button's `title` and append it to the
 * `aria-label`.
 */
export function pickHighlightLabel(isSelected: boolean, isSaved: boolean): string {
  if (isSelected && isSaved) return 'Saved pick';
  if (isSelected) return 'Selected — not saved yet';
  return '';
}
