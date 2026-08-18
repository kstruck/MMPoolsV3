import type { Pool, BracketPool, PlayoffPool, PropsPool, GameState } from '../types';

/**
 * Whether a pool appears in public discovery (the Browse page).
 *
 * PLAYOFF USED TO BE HARD-CODED `true` inside `BrowsePools`, so a host who
 * turned "List this pool publicly" off still had their pool listed. The wizard
 * has always persisted the choice — `buildPlayoffPayload` writes both
 * `isPublic` and `settings.isListedPublic` — and the filter ignored it. Found
 * by qodo on PR #475, against that PR's new help copy, which promises the
 * option removes the pool from Browse.
 *
 * The fix only ever honours an explicit choice: every create wizard defaults
 * `isPublic` to true, so the only pools this can hide are the ones whose host
 * asked for them to be hidden. It is LISTING, not access — a share link still
 * works either way, and Firestore rules are what govern reads.
 *
 * It lives here rather than in `BrowsePools.tsx` so it can be tested: importing
 * that component pulls in `Header` → `authService` → `firebase`, which needs a
 * browser. A rule whose failure mode is a privacy surprise should not be
 * untestable because of where it happens to sit.
 */
export function isPubliclyListed(p: Pool): boolean {
  if (p.type === 'BRACKET') return (p as BracketPool).isListedPublic;
  if (p.type === 'NFL_PLAYOFFS') {
    const playoff = p as PlayoffPool;
    // A playoff pool from before either field existed carries neither and stays
    // listed, which is what it does today.
    return playoff.isPublic ?? playoff.settings?.isListedPublic ?? true;
  }
  // `PropsPool.isPublic` is optional. `?? false` keeps the previous behaviour
  // exactly: the old code tested `if (!isPublic) return false`, so an absent
  // value already meant not listed. Only the playoff branch changes.
  if (p.type === 'PROPS') return (p as PropsPool).isPublic ?? false;
  return (p as GameState).isPublic;
}
