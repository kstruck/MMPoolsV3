import { describe, it, expect } from 'vitest';
import { dryRunVerdict, poolInLiveScope, readSweepGate, sweepRunVerdict, SWEEP_ERROR_PREFIX } from '../nflFinalize';

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

  it('falls back exactly like isSeasonComplete for the falsy edge values', () => {
    // `|| 2` vs `?? 2` diverge on '' and 0. isSeasonComplete uses `|| 2`, so
    // these must land on 2 as well — otherwise a legacy pool gets scored against
    // one slate and scoped by another, which is the bug this guard prevents.
    expect(poolInLiveScope({ seasonType: '' }, [2])).toBe(true);
    expect(poolInLiveScope({ seasonType: '' }, [1])).toBe(false);
    expect(poolInLiveScope({ seasonType: 0 }, [2])).toBe(true);
    expect(poolInLiveScope({ seasonType: 0 }, [1])).toBe(false);
  });

  it('coerces a string seasonType', () => {
    expect(poolInLiveScope({ seasonType: '1' }, [1])).toBe(true);
  });

  it('admits nothing when no scope is armed', () => {
    expect(poolInLiveScope({ seasonType: 1 }, null)).toBe(false);
  });
});

// Codex review of PR #245, round 2. The sweep catches a failing pool so one bad
// pool cannot stop the run — which meant a run where finalization THREW for a
// pool still stamped ok:true and looked healthy forever.
describe('sweepRunVerdict — a caught failure is still a failure', () => {
  it('is healthy when nothing was blocked at all', () => {
    expect(sweepRunVerdict({}, { finalized: 3 })).toEqual({ detail: { finalized: 3 } });
  });

  it('is healthy when pools were merely BLOCKED, not broken', () => {
    // A10: a postponed game blocks finalization indefinitely and legitimately.
    // Counting these would page every day of a preseason with a postponed game.
    const v = sweepRunVerdict(
      { poolA: 'game 401 still in progress', poolB: 'postponed game 402' },
      { finalized: 0, skipped: 2 },
    );
    expect(v.ok).toBeUndefined();
    expect(v.detail).toEqual({ finalized: 0, skipped: 2 });
  });

  it('is UNHEALTHY when a pool threw during finalization', () => {
    const v = sweepRunVerdict({ poolA: `${SWEEP_ERROR_PREFIX}boom` }, { finalized: 0, skipped: 1 });
    expect(v.ok).toBe(false);
    expect(v.error).toBe('1 pool(s) threw during finalization');
    expect(v.detail).toMatchObject({ errored: 1 });
  });

  it('counts only the thrown ones when both kinds are present', () => {
    const v = sweepRunVerdict(
      { a: `${SWEEP_ERROR_PREFIX}x`, b: 'still in progress', c: `${SWEEP_ERROR_PREFIX}y` },
      {},
    );
    expect(v.ok).toBe(false);
    expect(v.error).toBe('2 pool(s) threw during finalization');
  });

  it('uses the same prefix the sweep writes, so the two cannot drift apart', () => {
    expect(SWEEP_ERROR_PREFIX).toBe('ERROR: ');
  });
});

// Codex review of PR #245, round 4. writeAdminAudit now REPORTS its own failure
// instead of only swallowing it, and both sweep branches must act on that —
// a run whose only output is a report, that then loses the report, produced
// nothing at all while claiming to be healthy.
describe('sweep verdicts fold in a lost audit write', () => {
  it('live: a lost run summary is unhealthy even with nothing else wrong', () => {
    const v = sweepRunVerdict({}, { finalized: 2 }, false);
    expect(v.ok).toBe(false);
    expect(v.error).toBe('run summary not written');
  });

  it('live: names both the thrown pools and the lost summary', () => {
    const v = sweepRunVerdict({ a: `${SWEEP_ERROR_PREFIX}x` }, {}, false);
    expect(v.error).toBe('1 pool(s) threw during finalization; run summary not written');
  });

  it('live: healthy when audited (the default)', () => {
    expect(sweepRunVerdict({}, { finalized: 1 }).ok).toBeUndefined();
  });

  it('dry: healthy when the report was written and the scope was not refused', () => {
    const v = dryRunVerdict(true, undefined, 4);
    expect(v.ok).toBeUndefined();
    expect(v.detail).toEqual({ dryRun: true, candidates: 4 });
  });

  it('dry: a lost report is unhealthy — the report IS the whole output', () => {
    const v = dryRunVerdict(false, undefined, 4);
    expect(v.ok).toBe(false);
    expect(v.error).toBe('dry-run report not written');
  });

  it('dry: a refused arm request is unhealthy — the operator thinks it is live', () => {
    const v = dryRunVerdict(true, 'dryRun:false was set but liveSeasonTypes is missing', 4);
    expect(v.ok).toBe(false);
    expect(v.error).toContain('liveSeasonTypes is missing');
  });

  it('dry: names both problems at once', () => {
    expect(dryRunVerdict(false, 'refused', 0).error).toBe('dry-run report not written; refused');
  });
});
