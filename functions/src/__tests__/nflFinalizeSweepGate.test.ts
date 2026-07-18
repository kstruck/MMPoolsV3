import { describe, it, expect } from 'vitest';
import { poolInLiveScope, readSweepGate } from '../nflFinalize';

// PLAN-NFL-PRESEASON-PILOT A6 — the preseason burn-in arms nflFinalize's
// dryRun:false, but ONLY against preseason pools. These pin the guard that makes
// "only" enforceable instead of merely intended.
//
// This gate is deliberately STRICTER than the other kill-switched jobs: asking
// for live without naming a scope keeps the run dry. Arming the finalizer is the
// one flip that settles real seasons for real members, and "I meant preseason
// but forgot the scope field" is exactly the mistake that would settle every
// regular-season pool by accident.

describe('readSweepGate — enabled', () => {
  it('fails safe when config is missing or malformed', () => {
    expect(readSweepGate(undefined)).toMatchObject({ enabled: false, dryRun: true });
    expect(readSweepGate(null)).toMatchObject({ enabled: false, dryRun: true });
    expect(readSweepGate({})).toMatchObject({ enabled: false, dryRun: true });
  });

  it('only a literal true enables', () => {
    expect(readSweepGate({ enabled: true }).enabled).toBe(true);
    expect(readSweepGate({ enabled: 'true' as unknown as boolean }).enabled).toBe(false);
    expect(readSweepGate({ enabled: 1 as unknown as boolean }).enabled).toBe(false);
  });
});

describe('readSweepGate — dry-run stays on unless a scope is named', () => {
  it('stays dry by default', () => {
    expect(readSweepGate({ enabled: true }).dryRun).toBe(true);
  });

  it('REFUSES to go live when dryRun:false is set without liveSeasonTypes', () => {
    const g = readSweepGate({ enabled: true, dryRun: false });
    expect(g.dryRun).toBe(true);
    expect(g.liveSeasonTypes).toBeNull();
    expect(g.forcedDryReason).toContain('liveSeasonTypes');
  });

  it('REFUSES an empty scope array — arming nothing is a mistake, not an intent', () => {
    const g = readSweepGate({ enabled: true, dryRun: false, liveSeasonTypes: [] });
    expect(g.dryRun).toBe(true);
    expect(g.forcedDryReason).toBeTruthy();
  });

  it('REFUSES a scope of only garbage values', () => {
    const g = readSweepGate({ enabled: true, dryRun: false, liveSeasonTypes: ['x', 99, null] });
    expect(g.dryRun).toBe(true);
    expect(g.forcedDryReason).toBeTruthy();
  });

  it('goes live ONLY with an explicit valid scope — the preseason arm', () => {
    const g = readSweepGate({ enabled: true, dryRun: false, liveSeasonTypes: [1] });
    expect(g).toMatchObject({ enabled: true, dryRun: false, liveSeasonTypes: [1] });
    expect(g.forcedDryReason).toBeUndefined();
  });

  it('coerces numeric strings, since a console-entered value may be a string', () => {
    expect(readSweepGate({ enabled: true, dryRun: false, liveSeasonTypes: ['1'] }).liveSeasonTypes).toEqual([1]);
  });

  it('drops out-of-range season types but keeps valid siblings', () => {
    expect(readSweepGate({ enabled: true, dryRun: false, liveSeasonTypes: [1, 7, 2] }).liveSeasonTypes).toEqual([1, 2]);
  });

  it('a scope without dryRun:false still does not arm anything', () => {
    expect(readSweepGate({ enabled: true, liveSeasonTypes: [1] }).dryRun).toBe(true);
  });
});

describe('poolInLiveScope', () => {
  it('admits a preseason pool when preseason is armed', () => {
    expect(poolInLiveScope({ seasonType: 1 }, [1])).toBe(true);
  });

  it('EXCLUDES a regular-season pool when only preseason is armed', () => {
    // The whole point of A6: the pilot must not settle real regular-season pools.
    expect(poolInLiveScope({ seasonType: 2 }, [1])).toBe(false);
  });

  it('treats a pool with no seasonType as regular season, matching the finalizer', () => {
    // isSeasonComplete queries Number(pool.seasonType || 2) — the default must
    // agree, or a legacy pool would be scored against one slate and scoped by another.
    expect(poolInLiveScope({ seasonType: undefined }, [1])).toBe(false);
    expect(poolInLiveScope({ seasonType: undefined }, [2])).toBe(true);
  });

  it('coerces a string seasonType', () => {
    expect(poolInLiveScope({ seasonType: '1' }, [1])).toBe(true);
  });

  it('admits nothing when no scope is armed', () => {
    expect(poolInLiveScope({ seasonType: 1 }, null)).toBe(false);
  });
});
