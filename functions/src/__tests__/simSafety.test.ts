import { describe, it, expect } from 'vitest';
import { isSimPool } from '../nflFinalize';
import { isTestPool } from '../shared/testPool';
import { isActivePoolForStats } from '../lib/poolInclusion';
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
});

describe('run-scoped namespaces', () => {
  it('simSeason and simUidPrefix are consistent and run-scoped', () => {
    expect(simSeason('run-x1')).toBe('sim-run-x1');
    expect(simUidPrefix('run-x1')).toBe('sim-run-x1-');
    // A different run can never produce a uid inside this run's prefix.
    expect('sim-run-x2-alice'.startsWith(simUidPrefix('run-x1'))).toBe(false);
  });
});
