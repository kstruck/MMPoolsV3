import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Source-level invariants for the SuperAdmin Overview cards
 * (PLAN-STATS-INTEGRITY §8.3 step 3, PR D).
 *
 * Source assertions rather than a render test, for the same reason
 * `tests/nfl-settings-lockdown.test.ts` gives: what matters here is not what the
 * component renders for one fixture, it is WHERE the numbers come from. A render
 * test with hand-made props passes just as happily when the component has quietly
 * gone back to re-deriving money in the browser — which is precisely the
 * regression this file exists to catch, because it is the ORIGINAL bug:
 *
 *   §2.4 — the cards aggregate every loaded pool client-side and never read
 *   `stats/global`, so the Cloud Functions fix Kevin was promised would not have
 *   changed the screen he was looking at by a single dollar.
 *
 * Two things must stay true, and they fail in opposite directions:
 *   1. the pool list is filtered by the SHARED predicate (not a local copy);
 *   2. the money comes from the server aggregate (not a head count).
 */

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('SuperAdmin Overview — test pools are excluded, from ONE predicate', () => {
  const superAdmin = read('src/components/SuperAdmin.tsx');

  it('imports the shared isTestPool rather than re-deriving it', () => {
    // A local copy is the defect, not the implementation. `shared/` exists so the
    // client and the stats/global writers cannot drift.
    expect(superAdmin).toContain("from '@shared/testPool'");
    expect(superAdmin).toContain('isTestPool');
  });

  it('actually filters the pool list with it', () => {
    // An import that is never called is the failure mode a "does it import"
    // assertion alone would sail straight past.
    // `.*` not `[^)]*`: the arrow's own parameter list contains a `)`, which a
    // negated-class version cannot cross. Caught by this test failing first.
    expect(superAdmin).toMatch(/pools\.filter\(.*!isTestPool\(/);
  });

  it('counts pools from the FILTERED list, not the raw one', () => {
    expect(superAdmin).toContain('totalPools: realPools.length');
    expect(superAdmin).not.toContain('totalPools: pools.length');
  });
});

describe('SuperAdmin Overview — money comes from the server aggregate', () => {
  const superAdmin = read('src/components/SuperAdmin.tsx');

  it('reads stats/global instead of recomputing money in the browser', () => {
    expect(superAdmin).toContain('dbService.onGlobalStatsUpdate');
    expect(superAdmin).toContain('globalStats?.totalPrizes');
    expect(superAdmin).toContain('globalStats?.totalDonated');
  });

  it('no longer multiplies an entry fee by a head count', () => {
    // codex R3 finding (i): the old code did
    // `entryFee × (entryCount || participantCount || participantIds.length)` —
    // everyone who JOINED, paid or not. No client can fix that, because the paid
    // state lives in per-pool Member Record subcollections this page never loads.
    expect(superAdmin).not.toMatch(/settings\?\.entryFee \|\| 0\) \* count/);
    expect(superAdmin).not.toMatch(/props\?\.cost \|\| 0\) \* count/);
  });
});

describe('SuperAdmin Overview — squares and entries are different units', () => {
  const dashboard = read('src/components/SuperAdminBentoDashboard.tsx');

  it('no longer labels a squares+entries sum as "Squares Sold"', () => {
    // The card added NFL/bracket/props ENTRY counts into the squares total and
    // called the result "Squares Sold" — which is how 2541 "squares sold" showed
    // up on a platform with far fewer squares.
    expect(dashboard).toContain('totalEntries');
    expect(dashboard).not.toMatch(/>\s*Squares Sold\s*</);
  });
});
