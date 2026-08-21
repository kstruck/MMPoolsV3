import { describe, it, expect } from 'vitest';
import { runNFLSpreadFreezeSchema } from '../schemas/nflPools';

/**
 * The force/slate contract (Kevin, 2026-08-21).
 *
 * `force` skips the stated Tuesday-09:00-ET cutoff and NOTHING else. The two
 * refinements below are what stop it becoming a general-purpose bypass: an early
 * freeze must be explained, and reaching past the freeze horizon must be aimed at
 * a named week rather than left to "the earliest slate with no frozen record",
 * which is how codex round 8's walk-forward defect happened.
 */

const parse = (v: unknown) => runNFLSpreadFreezeSchema.safeParse(v);

describe('defaults', () => {
  it('is a DRY RUN when nothing is passed, and unforced', () => {
    // House Rule 1: a handler-side truthy check runs LIVE when the flag is omitted.
    expect(parse({})).toMatchObject({ success: true, data: { dryRun: true, force: false } });
  });
});

describe('force requires a reason', () => {
  it('refuses force with no reason', () => {
    const r = parse({ dryRun: false, force: true });
    expect(r.success).toBe(false);
  });

  it('refuses a reason that is not a real sentence', () => {
    expect(parse({ dryRun: false, force: true, reason: 'because' }).success).toBe(false);
    expect(parse({ dryRun: false, force: true, reason: '          ' }).success).toBe(false);
  });

  it('accepts force with a written reason', () => {
    const r = parse({ dryRun: false, force: true, reason: 'Week 1 has no games before it' });
    expect(r.success).toBe(true);
  });
});

describe('a named slate requires force', () => {
  it('refuses a slate on its own — bypassing the horizon is a deliberate act', () => {
    const r = parse({ dryRun: false, slate: { season: '2026', seasonType: 2, week: 1 } });
    expect(r.success).toBe(false);
  });

  it('accepts a named slate alongside force and a reason', () => {
    const r = parse({
      dryRun: false, force: true, reason: 'Opening week 1 picks early, no prior slate',
      slate: { season: '2026', seasonType: 2, week: 1 },
    });
    expect(r.success).toBe(true);
  });

  it('rejects a seasonType ESPN does not publish', () => {
    const r = parse({
      dryRun: false, force: true, reason: 'a perfectly good reason',
      slate: { season: '2026', seasonType: 4, week: 1 },
    });
    expect(r.success).toBe(false);
  });

  it('rejects week 0 — there is no week 0 in this data', () => {
    const r = parse({
      dryRun: false, force: true, reason: 'a perfectly good reason',
      slate: { season: '2026', seasonType: 2, week: 0 },
    });
    expect(r.success).toBe(false);
  });
});

describe('the shape is closed', () => {
  it('rejects an unknown key rather than silently ignoring it', () => {
    expect(parse({ dryRun: false, forse: true }).success).toBe(false);
  });
});
