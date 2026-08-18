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
 */

import { describe, it, expect } from 'vitest';
import { isPubliclyListed } from '../utils/publicListing';
import type { Pool } from '../types';

const pool = (over: Record<string, unknown>): Pool => over as unknown as Pool;

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
});
