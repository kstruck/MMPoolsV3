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

/**
 * What the commissioner's "List Pool Publicly" toggle should SHOW for a pool
 * whose listing is decided by the top-level `isPublic` field (the NFL types —
 * see `isPubliclyListed`'s final branch).
 *
 * Order matters and is not arbitrary. `settings.isListedPublic` is the field the
 * toggle has always WRITTEN, so it is the host's recorded preference and comes
 * first; a pool that never got that mirror falls back to the field Browse
 * actually reads. Reading `isPublic` first would show a host who turned listing
 * off — and whose choice never reached Browse, which is the defect below — their
 * setting back ON, and make them turn it off a second time.
 */
export function publicListingToggleValue(
  pool: { isPublic?: boolean; settings?: { isListedPublic?: boolean } } | null | undefined,
): boolean {
  return pool?.settings?.isListedPublic ?? pool?.isPublic ?? false;
}

/**
 * The two halves of a listing change, from one call.
 *
 * `NFLManagerView.handleSaveSettings` used to send `settings.isListedPublic`
 * and nothing else, while `isPubliclyListed` reads the TOP-LEVEL `isPublic` on
 * an NFL pool — so the toggle wrote a field nothing reads and the pool's Browse
 * listing never moved. The create wizard has always written both
 * (`buildNFLPayload.ts`), so only the later toggle was inert.
 *
 * Returned as one object with both halves rather than as two constants because
 * writing one and forgetting the other IS the defect. `top` is spread into the
 * `updatePoolSettings` payload (`isPublic` classifies as `lifecycle` in
 * `shared/editability.ts`, editable in every phase); `settings` is spread into
 * the settings blob, keeping the mirror in step so the two can never disagree.
 *
 * This is LISTING, not access: `firestore.rules` uses `isPublic` to allow the
 * Browse LIST query, while `allow get` is unconditional, so a share link keeps
 * working either way.
 */
export function publicListingUpdate(listed: boolean): {
  top: { isPublic: boolean };
  settings: { isListedPublic: boolean };
} {
  return { top: { isPublic: listed }, settings: { isListedPublic: listed } };
}
