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
 * - **Only when the browser will actually keep it.** `saveDraft` catches its own
 *   write failure so a lost draft never breaks the sheet, which means private
 *   mode and blocked site data produce no error and no draft. `isDraftStorageAvailable`
 *   probes with a real write; the hint is hidden when it comes back false.
 *
 * The 500 ms save debounce used to be a third hole — a member could pick and close
 * the tab inside the window — and `draftStore` now flushes pending drafts on
 * `pagehide` and on the app-switch `visibilitychange`, so the sentence holds
 * rather than being qualified into uselessness.
 *
 * Survivor and Margin never call `saveDraft` at all, which is why the save bar's
 * `hint` prop is optional with no default — see `StickySaveBar`.
 */
export const PICKEM_DRAFT_HINT =
  'Picks are kept in this browser as you go, so you can leave and finish later. They only reach the pool when you submit.';

/**
 * @param isWeekLocked   the sheet's draft effect stops writing once the week locks
 * @param storageAvailable  `isDraftStorageAvailable()` — pass the real probe, not `true`
 *
 * ⚠️ `storageAvailable` is NOT defaulted, on purpose. `saveDraft` swallows its
 * write failure, so a caller that simply forgot the argument would show the
 * reassurance to precisely the members whose picks are NOT being kept — private
 * mode, blocked site data. Making it required means that mistake is a compile
 * error. (codex r1 P2.)
 */
export function pickemDraftHint(
  isWeekLocked: boolean,
  storageAvailable: boolean,
): string | undefined {
  if (isWeekLocked || !storageAvailable) return undefined;
  return PICKEM_DRAFT_HINT;
}
