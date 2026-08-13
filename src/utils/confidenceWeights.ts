/**
 * Which confidence weight is already spoken for, and by which game.
 *
 * A confidence pick'em asks the member to spend each weight `[17-N .. 16]`
 * exactly once across the week's N games. Every game's `<select>` used to offer
 * the FULL range, so assigning 10 twice was a normal-looking action that the
 * sheet only complained about afterwards ("Duplicate value!", submit blocked).
 * Kevin, 2026-08-13: gray the used ones out so the mistake cannot be made.
 *
 * ⚠️ THIS IS A GUARD RAIL, NOT THE CHECK. `duplicateConfidenceValues` in
 * `PickemPickEntry` stays exactly where it is, and so does the `canSubmit`
 * block: a saved entry can already carry a duplicate (an older client, a direct
 * callable call), and the graying must not be the only thing standing between
 * that state and a submit. If this function is ever wrong, the sheet still
 * refuses the duplicate — it just refuses it late.
 */

/**
 * gameId set per assigned weight, over the games of ONE week.
 *
 * A `Set` rather than a single owner because a duplicate is a state the sheet
 * can legitimately be in (see above) — collapsing two owners to one would make
 * one of the two games unable to keep its own value.
 */
export function confidenceValueOwners(
  gameIds: string[],
  confidence: Record<string, number>,
): Map<number, Set<string>> {
  const owners = new Map<number, Set<string>>();
  for (const id of gameIds) {
    const value = confidence[id];
    // Falsy covers the two non-values this can hold: absent (never set) and
    // NaN (a `parseInt` of an empty option). Zero is not in any week's range —
    // the lowest possible weight is 17 - 16 = 1.
    if (!value) continue;
    const set = owners.get(value);
    if (set) set.add(id);
    else owners.set(value, new Set([id]));
  }
  return owners;
}

/**
 * Should `value` render disabled in `gameId`'s dropdown?
 *
 * True only when ANOTHER game holds it. A game's own current value always stays
 * selectable — disabling it would strand the member's own selection, and on a
 * re-render the `<select>` would show a value its option list forbids.
 */
export function isConfidenceValueTaken(
  owners: Map<number, Set<string>>,
  value: number,
  gameId: string,
): boolean {
  const holders = owners.get(value);
  if (!holders) return false;
  return !holders.has(gameId);
}
