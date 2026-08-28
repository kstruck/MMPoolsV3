/**
 * The one sentence the Pick'em save bar shows about unsubmitted work.
 *
 * 🔨 KEVIN 2026-08-27: "add another line telling the player that picks are
 * captured and saved to return later."
 *
 * It lives here, exported, rather than inline in the sheet's JSX so the
 * conditions under which it is TRUE are testable. Both halves matter:
 *
 * - **"in this browser"** is not hedging. `PickemPickEntry` drafts through
 *   `utils/draftStore`, which writes `localStorage` — an unsubmitted sheet
 *   survives a closed tab on that device and nowhere else. It is not on the
 *   server and it will not follow the member to their phone.
 * - **Only while the week is open.** The sheet's draft effect is guarded by
 *   `if (!dirtyRef.current || isWeekLocked) return;`, so once the week locks
 *   nothing is being kept and the sentence would be a false promise.
 *
 * Survivor and Margin never call `saveDraft` at all, which is why the save bar's
 * `hint` prop is optional with no default — see `StickySaveBar`.
 */
export const PICKEM_DRAFT_HINT =
  'Picks are kept in this browser as you go, so you can leave and finish later. They only reach the pool when you submit.';

export function pickemDraftHint(isWeekLocked: boolean): string | undefined {
  return isWeekLocked ? undefined : PICKEM_DRAFT_HINT;
}
