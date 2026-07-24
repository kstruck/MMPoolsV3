import { describe, it, expect } from 'vitest';
import {
  effectiveGameLockAt,
  effectiveWeekLockAt,
  isGameLocked,
  usesWeeklyHardLock,
  normalizeLockBufferMinutes,
  effectiveLockSettings,
  weekLockDecision,
  LOCK_BUFFER_PRESETS,
} from '../lib/effectiveLock';

const MIN = 60_000;
const kickoff = 1_800_000_000_000;

describe('effectiveGameLockAt', () => {
  it('locks at kickoff minus the buffer (default 5 min)', () => {
    expect(effectiveGameLockAt(kickoff, 1, {})).toBe(kickoff - 5 * MIN);
    expect(effectiveGameLockAt(kickoff, 1, { lockBufferMinutes: 10 })).toBe(kickoff - 10 * MIN);
  });

  it('a commissioner week override can only push the lock LATER', () => {
    const later = kickoff + 60 * MIN;
    expect(effectiveGameLockAt(kickoff, 1, { weekLockOverrides: { 1: later } })).toBe(later);
    // an override earlier than the computed lock does not pull it in
    const earlier = kickoff - 60 * MIN;
    expect(effectiveGameLockAt(kickoff, 1, { weekLockOverrides: { 1: earlier } })).toBe(kickoff - 5 * MIN);
  });

  it('override applies only to its own week', () => {
    const later = kickoff + 60 * MIN;
    expect(effectiveGameLockAt(kickoff, 2, { weekLockOverrides: { 1: later } })).toBe(kickoff - 5 * MIN);
  });
});

describe('effectiveWeekLockAt', () => {
  it('uses the earliest game in the week', () => {
    const g1 = kickoff, g2 = kickoff + 3 * 3600_000;
    expect(effectiveWeekLockAt([g2, g1], 1, {})).toBe(g1 - 5 * MIN);
  });
});

describe('isGameLocked', () => {
  it('true only at/after the effective lock', () => {
    const lock = kickoff - 5 * MIN;
    expect(isGameLocked(lock - 1, kickoff, 1, {})).toBe(false);
    expect(isGameLocked(lock, kickoff, 1, {})).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Weekly HARD lock — Survivor + Margin (Kevin's ruling 2026-07-25)
// ---------------------------------------------------------------------------

describe('usesWeeklyHardLock', () => {
  it('is true for Survivor and Margin, false for Pick\'em and anything else', () => {
    expect(usesWeeklyHardLock('NFL_SURVIVOR')).toBe(true);
    expect(usesWeeklyHardLock('NFL_MARGIN')).toBe(true);
    expect(usesWeeklyHardLock('NFL_PICKEM')).toBe(false);
    expect(usesWeeklyHardLock('SQUARES')).toBe(false);
    expect(usesWeeklyHardLock(undefined)).toBe(false);
  });
});

describe('normalizeLockBufferMinutes', () => {
  it('keeps the allowed presets', () => {
    for (const preset of LOCK_BUFFER_PRESETS) {
      expect(normalizeLockBufferMinutes(preset)).toBe(preset);
    }
  });

  it('snaps anything else to the 5-minute default', () => {
    // 0 would put the deadline AT kickoff and a negative one AFTER it — the two
    // values that would break "the deadline is before the first game".
    expect(normalizeLockBufferMinutes(0)).toBe(5);
    expect(normalizeLockBufferMinutes(-90)).toBe(5);
    expect(normalizeLockBufferMinutes(15)).toBe(5);
    expect(normalizeLockBufferMinutes(undefined)).toBe(5);
    expect(normalizeLockBufferMinutes('60')).toBe(5);
    expect(normalizeLockBufferMinutes(null)).toBe(5);
  });
});

describe('effectiveLockSettings', () => {
  it('passes Pick\'em settings through untouched (extensions still work)', () => {
    const settings = { lockBufferMinutes: 15, weekLockOverrides: { 1: kickoff + 60 * MIN } };
    expect(effectiveLockSettings(settings, 'NFL_PICKEM')).toEqual(settings);
  });

  it('drops overrides for hard-lock pools so the deadline cannot move past kickoff', () => {
    const later = kickoff + 60 * MIN;
    const settings = { lockBufferMinutes: 60, weekLockOverrides: { 1: later } };
    const survivor = effectiveLockSettings(settings, 'NFL_SURVIVOR');
    expect(survivor.weekLockOverrides).toBeUndefined();
    expect(effectiveWeekLockAt([kickoff], 1, survivor)).toBe(kickoff - 60 * MIN);
    // ...and the un-normalized settings would have pushed it PAST kickoff:
    expect(effectiveWeekLockAt([kickoff], 1, settings)).toBe(later);
  });

  it('snaps an out-of-range buffer for hard-lock pools', () => {
    const margin = effectiveLockSettings({ lockBufferMinutes: 0 }, 'NFL_MARGIN');
    expect(margin.lockBufferMinutes).toBe(5);
    expect(effectiveWeekLockAt([kickoff], 1, margin)).toBe(kickoff - 5 * MIN);
  });

  it('a hard deadline can only ever move EARLIER, never later', () => {
    // The reopen exploit: commissioner runs a 60-min deadline, lets it pass, then
    // switches to 5 min — the recomputed lock lands 55 minutes later and the week
    // is live again. The freeze is what stops it.
    const games = [kickoff];
    const at60 = weekLockDecision({ type: 'NFL_SURVIVOR', settings: { lockBufferMinutes: 60 } }, 1, games);
    expect(at60.lockAt).toBe(kickoff - 60 * MIN);
    expect(at60.freezeTo).toBe(kickoff - 60 * MIN);

    // ...now widened to 5 minutes, with the 60-minute deadline already frozen:
    const widened = weekLockDecision(
      { type: 'NFL_SURVIVOR', settings: { lockBufferMinutes: 5 }, hardLockByWeek: { 1: kickoff - 60 * MIN } },
      1,
      games,
    );
    expect(widened.lockAt).toBe(kickoff - 60 * MIN); // still the earlier one
    expect(widened.freezeTo).toBeUndefined();        // nothing new to persist

    // Tightening still applies immediately — that only closes picks sooner.
    const tightened = weekLockDecision(
      { type: 'NFL_SURVIVOR', settings: { lockBufferMinutes: 60 }, hardLockByWeek: { 1: kickoff - 5 * MIN } },
      1,
      games,
    );
    expect(tightened.lockAt).toBe(kickoff - 60 * MIN);
    expect(tightened.freezeTo).toBe(kickoff - 60 * MIN);
  });

  it('does not freeze Pick\'em (its per-game picks are already immutable once locked)', () => {
    const d = weekLockDecision({ type: 'NFL_PICKEM', settings: { lockBufferMinutes: 5 } }, 1, [kickoff]);
    expect(d.lockAt).toBe(kickoff - 5 * MIN);
    expect(d.freezeTo).toBeUndefined();
  });

  it('the hard deadline is ALWAYS before the first kickoff, for every input', () => {
    // The invariant the whole ruling exists to guarantee: picks close before any
    // game of the week starts, so a weekly pick can never change once a game has
    // been played. Exercised against inputs that defeat the raw settings path.
    const hostile = [
      { lockBufferMinutes: 0 },
      { lockBufferMinutes: -120 },
      { lockBufferMinutes: undefined },
      { weekLockOverrides: { 1: kickoff + 5 * 3600_000 } },
      { lockBufferMinutes: 60, weekLockOverrides: { 1: kickoff + MIN } },
    ];
    for (const type of ['NFL_SURVIVOR', 'NFL_MARGIN']) {
      for (const settings of hostile) {
        const lockAt = effectiveWeekLockAt([kickoff, kickoff + 3600_000], 1, effectiveLockSettings(settings, type));
        expect(lockAt).toBeLessThan(kickoff);
      }
    }
  });
});
