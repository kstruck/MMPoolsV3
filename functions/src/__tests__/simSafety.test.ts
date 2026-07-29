import { describe, it, expect } from 'vitest';
import { isSimPool } from '../nflFinalize';
import { isTestPool, isExplicitlyMarkedTestPool } from '../shared/testPool';
import { isActivePoolForStats, isFinishedPool } from '../lib/poolInclusion';
import { simSeason, simUidPrefix } from '../lib/simNamespace';

// Phase 0 sim-safety guards (PLAN-NFL-SIM-HARNESS). The load-bearing fact under
// test: callable-created Test Pools have SERVER-GENERATED doc IDs — only the
// persisted simRunId field / sim- season mark them (Codex R1 #1/#3).

describe('isSimPool', () => {
  it('detects the persisted simRunId field regardless of doc id', () => {
    expect(isSimPool({ simRunId: 'run-abc123' }, 'aUtoGen3RatedId')).toBe(true);
  });
  it('detects a sim- season', () => {
    expect(isSimPool({ season: 'sim-run-abc123' }, 'aUtoGen3RatedId')).toBe(true);
  });
  it('detects a legacy sim- doc id', () => {
    expect(isSimPool({}, 'sim-legacy-pool')).toBe(true);
  });
  it('passes a real pool (real season, auto id, no simRunId)', () => {
    expect(isSimPool({ season: '2025', type: 'NFL_PICKEM' }, 'aUtoGen3RatedId')).toBe(false);
  });
  it('is not fooled by a LIST season — String(["sim-x"]) === "sim-x" (codex r4)', () => {
    // The original String(...) coercion made a Firestore array value forge a sim
    // season, which took a real pool out of nflAutoScore, nflLockWatch and the
    // finalize sweep. The season must be an actual string.
    expect(isSimPool({ season: ['sim-x'] } as never, 'aUtoGen3RatedId')).toBe(false);
    expect(isSimPool({ season: { 0: 'sim-x' } } as never, 'aUtoGen3RatedId')).toBe(false);
    expect(isSimPool({ season: 2026 } as never, 'aUtoGen3RatedId')).toBe(false);
  });
});

// The stats discriminator (PLAN-STATS-INTEGRITY §8.1, amended by Kevin 2026-07-25):
// three independent arms, any one of which makes a pool invisible to every
// published money figure. Each arm is asserted alone so removing one fails here.
describe('isTestPool', () => {
  it('arm 1 — inherits every isSimPool case', () => {
    expect(isTestPool({ simRunId: 'run-abc123' }, 'aUtoGen3RatedId')).toBe(true);
    expect(isTestPool({ season: 'sim-run-abc123' }, 'aUtoGen3RatedId')).toBe(true);
    expect(isTestPool({}, 'sim-legacy-pool')).toBe(true);
  });

  it('arm 2 — an NFL season pool on seasonType 1 is preseason, i.e. Kevin testing', () => {
    expect(isTestPool({ type: 'NFL_PICKEM', season: '2026', seasonType: 1 }, 'realId')).toBe(true);
    expect(isTestPool({ type: 'NFL_SURVIVOR', season: '2026', seasonType: 1 }, 'realId')).toBe(true);
    expect(isTestPool({ type: 'NFL_MARGIN', season: '2026', seasonType: 1 }, 'realId')).toBe(true);
  });

  it('arm 2 — reads a STRING seasonType, because the create schema does not normalise it', () => {
    expect(isTestPool({ type: 'NFL_PICKEM', season: '2026', seasonType: '1' }, 'realId')).toBe(true);
  });

  it('arm 2 — an absent seasonType defaults to 2 (regular season), so it counts', () => {
    // `|| 2`, matching poolInLiveScope. A pool with no seasonType is NOT preseason.
    expect(isTestPool({ type: 'NFL_PICKEM', season: '2026' }, 'realId')).toBe(false);
  });

  it('arm 2 — is scoped to NFL SEASON types, so a stray seasonType elsewhere is inert', () => {
    // A BRACKET/SQUARES/PROPS pool has no NFL season; seasonType has no meaning on
    // it, and must not be able to hide it from the totals.
    expect(isTestPool({ type: 'BRACKET', seasonType: 1 }, 'realId')).toBe(false);
    expect(isTestPool({ type: 'SQUARES', seasonType: 1 }, 'realId')).toBe(false);
    expect(isTestPool({ type: 'NFL_PLAYOFFS', seasonType: 1 }, 'realId')).toBe(false);
  });

  it('arm 3 — the explicit server-only flag Kevin sets on legacy test pools', () => {
    expect(isTestPool({ type: 'SQUARES', isTestPool: true }, 'realId')).toBe(true);
    expect(isTestPool({ type: 'BRACKET', isTestPool: true }, 'realId')).toBe(true);
  });

  it('arm 3 — is strictly `=== true`, so a truthy string cannot flip it by accident', () => {
    expect(isTestPool({ type: 'SQUARES', isTestPool: 'yes' } as never, 'realId')).toBe(false);
    expect(isTestPool({ type: 'SQUARES', isTestPool: false }, 'realId')).toBe(false);
  });

  it('counts the real pools Kevin named: playoffs, March Madness, regular-season NFL', () => {
    // The date cutoff this predicate replaced would have excluded all three
    // (created Jan/Mar 2026, before the 2026-09-09 line). That is why it is gone.
    expect(isTestPool({ type: 'NFL_PLAYOFFS', season: '2025' }, 'realId')).toBe(false);
    expect(isTestPool({ type: 'BRACKET', season: '2026' }, 'realId')).toBe(false);
    expect(isTestPool({ type: 'NFL_PICKEM', season: '2026', seasonType: 2 }, 'realId')).toBe(false);
    expect(isTestPool({ type: 'SQUARES', season: '2026' }, 'realId')).toBe(false);
  });

  it('tolerates null/undefined pool docs', () => {
    expect(isTestPool(null)).toBe(false);
    expect(isTestPool(undefined, 'realId')).toBe(false);
  });
});

describe('isActivePoolForStats — sim exclusion', () => {
  const active = { type: 'NFL_PICKEM', status: 'OPEN' };
  it('excludes a pool with the persisted simRunId field (auto doc id)', () => {
    expect(isActivePoolForStats({ ...active, simRunId: 'run-abc123' }, 'aUtoGen3RatedId')).toBe(false);
  });
  it('excludes a pool with a sim- season (auto doc id)', () => {
    expect(isActivePoolForStats({ ...active, season: 'sim-run-abc123' }, 'aUtoGen3RatedId')).toBe(false);
  });
  it('still excludes legacy sim- doc ids', () => {
    expect(isActivePoolForStats(active, 'sim-legacy')).toBe(false);
  });
  it('includes a real active pool', () => {
    expect(isActivePoolForStats({ ...active, season: '2025' }, 'aUtoGen3RatedId')).toBe(true);
  });

  it('agrees with the canonical isSimPool on an ARRAY season — the divergence the copy carried', () => {
    // This predicate used to re-derive the sim rule with
    // `String(pool.season || '').startsWith('sim-')`, and `String(['sim-x'])` is
    // exactly 'sim-x'. So a Firestore ARRAY season forged a sim pool HERE while
    // the hardened `isSimPool` (codex r4, typeof === 'string') correctly said no
    // — a real pool silently dropped from commissioner rosters and stats. Stated
    // as agreement between the two, which is the property that must hold.
    const pool = { ...active, season: ['sim-x'] as unknown as string };
    expect(isSimPool(pool, 'aUtoGen3RatedId')).toBe(false);
    expect(isActivePoolForStats(pool, 'aUtoGen3RatedId')).toBe(true);
  });

  it('keeps its own SLUG arm, which isSimPool does not have', () => {
    // isSimPool takes ONE id. The slug is resolved by isActivePoolForStats and
    // handed in, so delegating must not lose this arm.
    expect(isActivePoolForStats({ ...active, slug: 'sim-legacy' }, undefined)).toBe(false);
  });
});

// PLAN-PAYMENT-TRUTH P4. `isFinishedPool` was extracted from `isActivePoolForStats`
// so the Member Record backfill can gate on "finished?" separately from "sim?".
// These guard BOTH halves of that claim: the extraction is behaviour-preserving,
// and the two predicates are genuinely independent.
describe('isFinishedPool — the status half, split out for the backfill', () => {
  const active = { type: 'NFL_PICKEM', status: 'OPEN' };

  it('catches every finished/closed shape', () => {
    expect(isFinishedPool({ ...active, status: 'COMPLETED' })).toBe(true);
    expect(isFinishedPool({ ...active, status: 'CANCELED' })).toBe(true);
    expect(isFinishedPool({ ...active, status: 'archived' })).toBe(true);
    expect(isFinishedPool({ ...active, isFinal: true })).toBe(true);
    expect(isFinishedPool({ ...active, closedVia: 'ADMIN_CLOSE' })).toBe(true);
    expect(isFinishedPool({ ...active, closedVia: 'SCORED_OUT' })).toBe(true);
  });

  it('does not catch an active pool', () => {
    expect(isFinishedPool(active)).toBe(false);
  });

  it('says NOTHING about sim-ness — that is the point of the split', () => {
    // A sim pool that is still open is not "finished". If these two collapsed
    // back into one boolean, includeFinished would re-open the sweep onto sim
    // data, which is the D25 defect Q3 split apart.
    expect(isFinishedPool({ ...active, simRunId: 'run-abc123' })).toBe(false);
    expect(isSimPool({ ...active, simRunId: 'run-abc123' }, 'aUtoGen3RatedId')).toBe(true);
  });

  it('composes back to the original isActivePoolForStats behaviour', () => {
    // The extraction must be behaviour-preserving for consensus.ts and
    // commissionerAggregate.ts, which were not touched.
    for (const p of [
      active,
      { ...active, status: 'COMPLETED' },
      { ...active, status: 'CANCELED' },
      { ...active, status: 'archived' },
      { ...active, isFinal: true },
      { ...active, closedVia: 'ADMIN_CLOSE' },
      { ...active, simRunId: 'run-abc123' },
      { ...active, season: 'sim-run-abc123' },
    ]) {
      const expected = !isFinishedPool(p) && !isSimPool(p, 'aUtoGen3RatedId');
      expect(isActivePoolForStats(p, 'aUtoGen3RatedId')).toBe(expected);
    }
  });

});

/**
 * The exact skip rule the Member Record backfill applies (PLAN-PAYMENT-TRUTH P4):
 * arms 1 and 3 of `isTestPool`, deliberately NOT arm 2.
 *
 * Both halves are load-bearing and BOTH were got wrong once. Using full
 * `isTestPool` would skip the preseason pilot; using bare `isSimPool` silently
 * backfilled hand-labelled legacy test pools (codex r2). This pins the seam.
 */
describe('P4 backfill skip rule — sim OR hand-marked, but never merely preseason', () => {
  const skippedByBackfill = (pool: any, id?: string) =>
    isSimPool(pool, id) || isExplicitlyMarkedTestPool(pool);

  const preseason = { type: 'NFL_PICKEM', status: 'OPEN', seasonType: 1, season: '2026' };

  it('leaves NFL PRESEASON pools reachable — they are the 2026-08-06 pilot', () => {
    // Excluded from every published stat, but real pools with real members owing
    // real dues. Skipping them here would leave them without Member Records,
    // which is exactly the state that makes setPaidStatus throw once P1 repoints
    // the payment control at it.
    expect(isTestPool(preseason, 'realPoolId')).toBe(true);        // excluded from stats
    expect(skippedByBackfill(preseason, 'realPoolId')).toBe(false); // but still backfilled
    expect(isFinishedPool(preseason)).toBe(false);
  });

  it('skips a hand-marked legacy test pool with no sim marker at all', () => {
    // The legacy Squares/Props/Playoff runners create pools through the normal
    // path, so arms 1 and 2 cannot see them; the K12 census flag is the only
    // signal. isSimPool alone returns false here — the r2 defect.
    const legacy = { type: 'SQUARES', status: 'COMPLETED', season: '2024', isTestPool: true };
    expect(isSimPool(legacy, 'autoGenId')).toBe(false);
    expect(skippedByBackfill(legacy, 'autoGenId')).toBe(true);
  });

  it('skips a hand-marked PRESEASON pool — an explicit marker still wins', () => {
    expect(skippedByBackfill({ ...preseason, isTestPool: true }, 'realPoolId')).toBe(true);
  });

  it('only an exact true marks a pool — no truthy coercion', () => {
    for (const v of ['true', 1, {}, [], 'yes']) {
      expect(isExplicitlyMarkedTestPool({ isTestPool: v } as any)).toBe(false);
    }
    expect(isExplicitlyMarkedTestPool({ isTestPool: true })).toBe(true);
    expect(isExplicitlyMarkedTestPool(null)).toBe(false);
    expect(isExplicitlyMarkedTestPool(undefined)).toBe(false);
  });

  it('still backfills an ordinary finished real pool — that is the whole point', () => {
    const real = { type: 'SQUARES', status: 'COMPLETED', season: '2024' };
    expect(skippedByBackfill(real, 'autoGenId')).toBe(false);
    expect(isFinishedPool(real)).toBe(true); // reached only with includeFinished
  });
});

describe('run-scoped namespaces', () => {
  it('simSeason and simUidPrefix are consistent and run-scoped', () => {
    expect(simSeason('run-x1')).toBe('sim-run-x1');
    expect(simUidPrefix('run-x1')).toBe('sim-run-x1-');
    // A different run can never produce a uid inside this run's prefix.
    expect('sim-run-x2-alice'.startsWith(simUidPrefix('run-x1'))).toBe(false);
  });
});
