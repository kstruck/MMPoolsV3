/**
 * PLAN-SPLIT-POT-SETTLEMENT Part C — the Pick Distribution visibility rule.
 *
 * The rule decides whether a game's crowd split may be shown. Three settings ×
 * the two lock modes × before/after a game's lock. The case that matters most is
 * AFTER_LOCK on a PER_GAME pool: a split must appear for a game that has locked
 * while a later game's split stays hidden, using the SAME per-game lock the pick
 * sheet uses.
 */
import { describe, it, expect } from 'vitest';
import {
  distributionGameVisible,
  effectivePickDistribution,
  isPickDistributionVisibility,
} from '@shared/pickDistribution';

const HOUR = 3_600_000;
const T0 = 1_800_000_000_000;
const early = { startTime: T0, status: 'SCHEDULED' };
const late = { startTime: T0 + 72 * HOUR, status: 'SCHEDULED' };
const games = [early, late];

const pool = (pickDistribution: unknown, lockMode: 'PER_GAME' | 'WEEKLY') => ({
  type: 'NFL_PICKEM',
  settings: { pickDistribution, lockMode, lockBufferMinutes: 5, lockRuleVersion: 2 },
});

describe('effectivePickDistribution', () => {
  it('defaults to ALWAYS when absent or unrecognised', () => {
    expect(effectivePickDistribution(undefined)).toBe('ALWAYS');
    expect(effectivePickDistribution({})).toBe('ALWAYS');
    expect(effectivePickDistribution({ pickDistribution: 'OFFF' })).toBe('ALWAYS');
  });
  it('reads the three stored values', () => {
    for (const v of ['ALWAYS', 'AFTER_LOCK', 'OFF']) {
      expect(isPickDistributionVisibility(v)).toBe(true);
      expect(effectivePickDistribution({ pickDistribution: v })).toBe(v);
    }
  });
});

describe('distributionGameVisible', () => {
  const before = T0 - 2 * HOUR;          // nothing locked yet
  const between = T0 + HOUR;             // early game locked, late game open

  it('ALWAYS shows every game at any time; OFF shows none', () => {
    for (const now of [before, between]) {
      expect(distributionGameVisible(pool('ALWAYS', 'PER_GAME'), 1, late, games, now)).toBe(true);
      expect(distributionGameVisible(pool('OFF', 'PER_GAME'), 1, early, games, now)).toBe(false);
    }
  });

  it('AFTER_LOCK on a PER_GAME pool: each game appears at its own lock', () => {
    const p = pool('AFTER_LOCK', 'PER_GAME');
    expect(distributionGameVisible(p, 1, early, games, before)).toBe(false);
    expect(distributionGameVisible(p, 1, early, games, between)).toBe(true);
    expect(distributionGameVisible(p, 1, late, games, between)).toBe(false);
  });

  it('AFTER_LOCK on a WEEKLY pool: every game appears together once the week locks', () => {
    const p = pool('AFTER_LOCK', 'WEEKLY');
    expect(distributionGameVisible(p, 1, late, games, before)).toBe(false);
    expect(distributionGameVisible(p, 1, early, games, between)).toBe(true);
    expect(distributionGameVisible(p, 1, late, games, between)).toBe(true);
  });

  it('respects the lock buffer: not visible in the last minutes before kickoff is not enough — it locks 5 minutes early', () => {
    const p = pool('AFTER_LOCK', 'PER_GAME');
    expect(distributionGameVisible(p, 1, early, games, T0 - 10 * 60_000)).toBe(false);
    expect(distributionGameVisible(p, 1, early, games, T0 - 4 * 60_000)).toBe(true);
  });
});
