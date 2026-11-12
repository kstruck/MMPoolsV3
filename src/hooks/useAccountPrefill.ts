import { useEffect, useRef } from 'react';

/** The parts of a signed-in account a form is pre-filled from. */
export interface AccountIdentity {
  id?: string | null;
  name?: string | null;
  email?: string | null;
}

/**
 * Pre-fill a form from the signed-in account — WHEN THE ACCOUNT CHANGES, and
 * not otherwise.
 *
 * `fill` runs when someone signs in, and again only if that account's own
 * name or email changes. It does NOT run because the app handed down a fresh
 * copy of the same user, which it does every time anything on the user's
 * document changes: a role upgrade, a pool added to their list, a last-seen
 * stamp.
 *
 * WHY THIS IS A HOOK AND NOT THREE LINES IN THE GRID. The grid did this with
 * `useEffect(..., [currentUser])`. An organizer entering squares for somebody
 * else types that person's name into the same field — and the next copy of
 * their own user object put their own name back, silently, between typing the
 * name and pressing Reserve. The squares were then recorded for the organizer.
 * It needed the organizer's own first claim to still be settling, so it showed
 * up as "sometimes", which is the worst way for a wrong name on a paid square
 * to show up. Found by the end-to-end test written for the reopen (review log,
 * round W2); the hand-driven walk-through before it paused long enough between
 * steps to miss it.
 */
export function useAccountPrefill(
  user: AccountIdentity | null | undefined,
  fill: (account: { name: string; email: string }) => void,
): void {
  const id = user?.id ?? null;
  const name = user?.name ?? '';
  const email = user?.email ?? '';

  // The latest `fill`, without making its identity a reason to run.
  const latest = useRef(fill);
  useEffect(() => {
    latest.current = fill;
  });

  useEffect(() => {
    if (id === null) return;
    latest.current({ name, email });
  }, [id, name, email]);
}
