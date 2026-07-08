import { describe, it, expect } from 'vitest';
import { effectiveGameLockAt, effectiveWeekLockAt, isGameLocked } from '../lib/effectiveLock';

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
