/**
 * browsePublicListing.test.ts — who appears in public discovery.
 *
 * Regression cover for a defect qodo found on PR #475: `BrowsePools` treated
 * EVERY NFL playoff pool as public, so a host who turned "List this pool
 * publicly" off still had their pool listed in Browse. The wizard has always
 * persisted the choice (`buildPlayoffPayload` writes both `isPublic` and
 * `settings.isListedPublic`); the filter ignored it.
 *
 * It surfaced because T1's help copy PROMISES the setting works. The copy was
 * right about what the option means and the code was wrong, which is the one
 * direction of that mismatch worth fixing in the code.
 *
 * The second half of this file covers the same promise broken a different way
 * on the NFL types: `NFLManagerView.handleSaveSettings` wrote
 * `settings.isListedPublic` and nothing else, so the toggle changed a field
 * nothing reads. The create wizard wrote both, so only the LATER toggle was
 * inert — a host could only ever choose once.
 */

import { describe, it, expect } from 'vitest';
import {
  isPubliclyListed,
  publicListingToggleValue,
  publicListingUpdate,
} from '../utils/publicListing';
import type { Pool } from '../types';

const pool = (over: Record<string, unknown>): Pool => over as unknown as Pool;

/** The shape `publicListingToggleValue` reads — a stored pool, narrowed. */
type StoredListing = { isPublic?: boolean; settings?: { isListedPublic?: boolean } };
const asStored = (p: Pool): StoredListing => p as unknown as StoredListing;

describe('isPubliclyListed', () => {
  describe('NFL playoff pools', () => {
    it('hides a pool whose host turned public listing off', () => {
      expect(isPubliclyListed(pool({ type: 'NFL_PLAYOFFS', isPublic: false }))).toBe(false);
    });

    it('lists a pool whose host left it on', () => {
      expect(isPubliclyListed(pool({ type: 'NFL_PLAYOFFS', isPublic: true }))).toBe(true);
    });

    it('falls back to the nested setting when the top-level field is absent', () => {
      expect(
        isPubliclyListed(pool({ type: 'NFL_PLAYOFFS', settings: { isListedPublic: false } })),
      ).toBe(false);
    });

    /**
     * A playoff pool created before either field existed keeps today's
     * behaviour. The fix only ever honours an explicit choice — it must not
     * retroactively hide pools nobody asked to hide.
     */
    it('lists a legacy pool that carries neither field', () => {
      expect(isPubliclyListed(pool({ type: 'NFL_PLAYOFFS' }))).toBe(true);
    });
  });

  describe('the other pool types are unchanged', () => {
    it('reads isListedPublic on a bracket pool', () => {
      expect(isPubliclyListed(pool({ type: 'BRACKET', isListedPublic: false }))).toBe(false);
      expect(isPubliclyListed(pool({ type: 'BRACKET', isListedPublic: true }))).toBe(true);
    });

    it('reads isPublic on a props pool, and treats an absent value as not listed', () => {
      expect(isPubliclyListed(pool({ type: 'PROPS', isPublic: true }))).toBe(true);
      expect(isPubliclyListed(pool({ type: 'PROPS', isPublic: false }))).toBe(false);
      // Matches the previous `if (!isPublic) return false` exactly.
      expect(isPubliclyListed(pool({ type: 'PROPS' }))).toBe(false);
    });

    it('reads isPublic on a squares pool, typed or untyped', () => {
      expect(isPubliclyListed(pool({ type: 'SQUARES', isPublic: true }))).toBe(true);
      expect(isPubliclyListed(pool({ isPublic: false }))).toBe(false);
    });
  });

  /**
   * The premise `publicListingUpdate` is built on. If an NFL pool's listing ever
   * stops being decided by the top-level `isPublic`, that helper writes the
   * wrong field and this is the test that says so.
   */
  it.each(['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'])(
    'decides a %s pool from the top-level isPublic, not the settings mirror',
    type => {
      expect(isPubliclyListed(pool({ type, isPublic: true, settings: { isListedPublic: false } }))).toBe(true);
      expect(isPubliclyListed(pool({ type, isPublic: false, settings: { isListedPublic: true } }))).toBe(false);
    },
  );
});

describe('publicListingToggleValue — what the manager toggle shows', () => {
  it('prefers the host’s recorded preference over the field Browse reads', () => {
    // The state this defect LEAVES BEHIND in production: a host turned listing
    // off, the write went to the mirror only, and the pool stayed listed. The
    // toggle must keep showing OFF, or their next visit reverts their choice
    // and they have to make it twice.
    expect(publicListingToggleValue({ isPublic: true, settings: { isListedPublic: false } })).toBe(false);
  });

  it('falls back to the top-level field for a pool with no mirror', () => {
    // Without the fallback the toggle would claim OFF on a listed pool, and the
    // very next save — now that the save writes `isPublic` — would de-list it
    // with nobody having asked.
    expect(publicListingToggleValue({ isPublic: true })).toBe(true);
    expect(publicListingToggleValue({ isPublic: false })).toBe(false);
  });

  it('shows OFF when a pool carries neither field', () => {
    expect(publicListingToggleValue({})).toBe(false);
    expect(publicListingToggleValue(undefined)).toBe(false);
  });

  it('reads an explicit false in the mirror as false, not as absent', () => {
    // `??` rather than `||`: a stored `false` is a choice, and `||` would step
    // over it to the fallback.
    expect(publicListingToggleValue({ settings: { isListedPublic: false }, isPublic: true })).toBe(false);
  });
});

describe('publicListingUpdate — the toggle actually moves the Browse listing', () => {
  /** Apply an update payload to a stored pool the way `updatePoolSettings` would. */
  const applied = (stored: Record<string, unknown>, listed: boolean) => {
    const update = publicListingUpdate(listed);
    return pool({
      ...stored,
      ...update.top,
      settings: { ...(stored.settings as Record<string, unknown> ?? {}), ...update.settings },
    });
  };

  it.each(['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'])(
    'turning the toggle off de-lists a listed %s pool',
    type => {
      const stored = { type, isPublic: true, settings: { isListedPublic: true } };
      expect(isPubliclyListed(pool(stored))).toBe(true);
      expect(isPubliclyListed(applied(stored, false))).toBe(false);
    },
  );

  it.each(['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'])(
    'turning the toggle on lists an unlisted %s pool',
    type => {
      const stored = { type, isPublic: false, settings: { isListedPublic: false } };
      expect(isPubliclyListed(pool(stored))).toBe(false);
      expect(isPubliclyListed(applied(stored, true))).toBe(true);
    },
  );

  /**
   * THE DISCRIMINATING FIXTURE. This is the old payload — the settings mirror
   * alone — and it must still fail to move the listing. Without this case the
   * two tests above would pass on a helper that wrote only `isPublic`, and the
   * suite could not tell the fix from the bug.
   */
  it('writing only the settings mirror leaves the listing exactly where it was', () => {
    const stored = { type: 'NFL_PICKEM', isPublic: true, settings: { isListedPublic: true } };
    const mirrorOnly = pool({
      ...stored,
      settings: { ...stored.settings, ...publicListingUpdate(false).settings },
    });
    expect(asStored(mirrorOnly).settings?.isListedPublic).toBe(false);
    expect(isPubliclyListed(mirrorOnly)).toBe(true); // the defect, reproduced
  });

  it('returns both halves in step, so the two fields can never disagree', () => {
    expect(publicListingUpdate(true)).toEqual({
      top: { isPublic: true },
      settings: { isListedPublic: true },
    });
    expect(publicListingUpdate(false)).toEqual({
      top: { isPublic: false },
      settings: { isListedPublic: false },
    });
  });

  it('round-trips through the toggle reader', () => {
    // Save with the toggle off, reopen the page: it still says off.
    const stored = { type: 'NFL_PICKEM', isPublic: true, settings: { isListedPublic: true } };
    const after = applied(stored, false);
    expect(publicListingToggleValue(asStored(after))).toBe(false);
    expect(publicListingToggleValue(asStored(applied(stored, true)))).toBe(true);
  });
});
