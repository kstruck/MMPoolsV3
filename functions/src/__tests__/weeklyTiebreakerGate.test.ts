import { describe, it, expect } from 'vitest';
import {
  weeklyTiebreakerRefusal,
  tiebreakerEditNeedsEntries,
  touchesWeeklyTiebreakerSetting,
  poolHasSubmission,
} from '../lib/weeklyTiebreakerGate';

/**
 * The freeze on `settings.weeklyTiebreaker` (PLAN-WEEKLY-TIEBREAKERS §5).
 *
 * Two codex P1s shaped this gate and both are pinned below:
 *
 *  - R1.1 — freezing at the first SCORED week (the survivor gate's line) is too
 *    late: it lets a commissioner change the rule after members have already
 *    typed a number, silently re-reading their guess against a new target.
 *  - R2.1 — freezing on stored tiebreaker VALUES is vacuous under `NONE`, whose
 *    sheet stores none. That is the direction where the switch does most harm,
 *    because nobody was ever asked.
 */

const K = 'settings.weeklyTiebreaker';
const pickem = (settings: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({ type: 'NFL_PICKEM', settings, ...extra });

const played = [{ picks: { g1: 'KC' } }];
const guessed = [{ picks: {}, weeklyTiebreakers: { 1: 44 } }];
const empty = [{ picks: {} }, undefined];

describe('touchesWeeklyTiebreakerSetting', () => {
  it('fires on the dotted key and nothing else', () => {
    expect(touchesWeeklyTiebreakerSetting({ [K]: 'NONE' })).toBe(true);
    expect(touchesWeeklyTiebreakerSetting({ 'settings.maxStrikes': 2 })).toBe(false);
    expect(touchesWeeklyTiebreakerSetting({})).toBe(false);
  });
});

describe('poolHasSubmission — the OR is load-bearing', () => {
  it('is false on an untouched pool', () => {
    expect(poolHasSubmission(empty)).toBe(false);
    expect(poolHasSubmission([])).toBe(false);
  });

  it('fires on submitted picks even with no tiebreaker value (the NONE case, R2.1)', () => {
    expect(poolHasSubmission(played)).toBe(true);
  });

  it('fires on a stored tiebreaker value even with no picks', () => {
    expect(poolHasSubmission(guessed)).toBe(true);
  });
});

describe('weeklyTiebreakerRefusal', () => {
  it('allows the change while nobody has submitted', () => {
    expect(weeklyTiebreakerRefusal(pickem(), { [K]: 'NONE' }, empty)).toBeNull();
  });

  it('REFUSES once anybody has submitted picks', () => {
    const r = weeklyTiebreakerRefusal(pickem(), { [K]: 'MNF_LAST_GAME' }, played);
    expect(r?.code).toBe('TIEBREAKER_LOCKED_AFTER_SUBMISSIONS');
  });

  it('REFUSES NONE -> an MNF rule after picks, where no tiebreaker value exists (R2.1)', () => {
    // The exact hole the round-1 fix left: entries carry no weeklyTiebreakers at
    // all, so a values-only gate would allow this and the scorer would read
    // every member as having predicted 0.
    const r = weeklyTiebreakerRefusal(pickem({ weeklyTiebreaker: 'NONE' }), { [K]: 'MNF_COMBINED' }, played);
    expect(r?.code).toBe('TIEBREAKER_LOCKED_AFTER_SUBMISSIONS');
  });

  it('REFUSES on a scored pool with the scoring-specific message', () => {
    const pool = pickem({}, { publishedWeeks: { 1: true } });
    const r = weeklyTiebreakerRefusal(pool, { [K]: 'NONE' }, empty);
    expect(r?.code).toBe('SETTINGS_LOCKED_AFTER_SCORING');
  });

  it('allows a save that does not carry the key at all', () => {
    expect(weeklyTiebreakerRefusal(pickem(), { 'settings.pointsPerPick': 2 }, played)).toBeNull();
  });

  it('allows a legacy pool re-saving the DEFAULT — undefined -> MNF_COMBINED is not a change', () => {
    // The manager UI submits a complete settings object on every save. Refusing
    // here would make an unrelated edit impossible on every pre-existing pool.
    expect(weeklyTiebreakerRefusal(pickem(), { [K]: 'MNF_COMBINED' }, played)).toBeNull();
  });

  it('allows re-saving the SAME explicit value', () => {
    expect(
      weeklyTiebreakerRefusal(pickem({ weeklyTiebreaker: 'NONE' }), { [K]: 'NONE' }, played),
    ).toBeNull();
  });

  it('treats a junk stored value as the default, so junk -> MNF_COMBINED is allowed', () => {
    expect(
      weeklyTiebreakerRefusal(pickem({ weeklyTiebreaker: 'MNF_LASTGAME' }), { [K]: 'MNF_COMBINED' }, played),
    ).toBeNull();
  });

  it('REFUSES a junk value, even on a pool already playing the default', () => {
    // The create-time z.enum does not cover updatePoolSettings — that schema is
    // permissive and the flattener writes present keys as given. Checked BEFORE
    // the changed-value test on purpose: junk resolves to MNF_COMBINED, so on a
    // pool already on MNF_COMBINED it reads as "no change" and would be stored.
    // (codex P2, implementation round 2.)
    const r = weeklyTiebreakerRefusal(pickem(), { [K]: 'MNF_LASTGAME' }, empty);
    expect(r?.code).toBe('TIEBREAKER_INVALID_VALUE');
  });

  it('REFUSES a junk value that would silently flip a NONE pool to the default', () => {
    const r = weeklyTiebreakerRefusal(pickem({ weeklyTiebreaker: 'NONE' }), { [K]: 'whatever' }, empty);
    expect(r?.code).toBe('TIEBREAKER_INVALID_VALUE');
  });

  it.each([undefined, null, 3, {}])('REFUSES the non-string value %s', (v) => {
    expect(weeklyTiebreakerRefusal(pickem(), { [K]: v }, empty)?.code).toBe('TIEBREAKER_INVALID_VALUE');
  });

  it('does not police junk on a pool type it does not govern', () => {
    expect(weeklyTiebreakerRefusal({ type: 'NFL_MARGIN', settings: {} }, { [K]: 'junk' }, empty)).toBeNull();
  });

  it('ignores non-pickem pools entirely', () => {
    const survivor = { type: 'NFL_SURVIVOR', settings: {} };
    expect(weeklyTiebreakerRefusal(survivor, { [K]: 'NONE' }, played)).toBeNull();
  });
});

describe('tiebreakerEditNeedsEntries — the read is not free', () => {
  it('does not read entries when the key is absent', () => {
    expect(tiebreakerEditNeedsEntries(pickem(), { 'settings.pointsPerPick': 2 })).toBe(false);
  });

  it('does not read entries when the effective value is unchanged', () => {
    expect(tiebreakerEditNeedsEntries(pickem(), { [K]: 'MNF_COMBINED' })).toBe(false);
  });

  it('does not read entries on an already-scored pool — the cheap check settles it', () => {
    const pool = pickem({}, { publishedWeeks: { 1: true } });
    expect(tiebreakerEditNeedsEntries(pool, { [K]: 'NONE' })).toBe(false);
  });

  it('DOES read entries on a real change to an unscored pool', () => {
    expect(tiebreakerEditNeedsEntries(pickem(), { [K]: 'NONE' })).toBe(true);
  });

  it('does not read entries for a non-pickem pool', () => {
    expect(tiebreakerEditNeedsEntries({ type: 'NFL_MARGIN', settings: {} }, { [K]: 'NONE' })).toBe(false);
  });
});
