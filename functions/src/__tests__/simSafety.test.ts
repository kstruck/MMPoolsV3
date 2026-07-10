import { describe, it, expect } from 'vitest';
import { isSimPool } from '../nflFinalize';
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
