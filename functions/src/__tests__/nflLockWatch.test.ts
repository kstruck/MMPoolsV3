import { describe, it, expect } from 'vitest';
import {
  decideAlert, evaluateSlate, formatAlertMessage, gatesSubmission, poolMatchesSlate, slateId,
  type SlateKey, type WatchedGame, type WatchedPool,
} from '../lib/nflLockWatch';

// PLAN-NFL-PRESEASON-PILOT A3a — the pre-kickoff tripwire's decision logic.
// The contract these pin: the alarm's predicate must match the submit gate at
// nflPools.ts:351-355 (`games.every(g => g.spread?.locked === true)`), so the
// alarm fires exactly when a real member would really be blocked.

const KEY: SlateKey = { season: '2026', seasonType: 1, week: 1 };
const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

const game = (id: string, over: Partial<WatchedGame> = {}): WatchedGame => ({
  id, season: '2026', seasonType: 1, week: 1,
  startTime: NOW + 24 * HOUR, status: 'SCHEDULED',
  spread: { value: -3, locked: true },
  ...over,
});

const pool = (id: string, over: Partial<WatchedPool> = {}): WatchedPool => ({
  id, type: 'NFL_PICKEM', season: '2026', seasonType: 1, status: 'OPEN', ...over,
});

describe('gatesSubmission — scope must match the submit gate', () => {
  it('SCHEDULED and IN_PROGRESS games gate submission', () => {
    expect(gatesSubmission(game('a'))).toBe(true);
    expect(gatesSubmission(game('a', { status: 'IN_PROGRESS' }))).toBe(true);
  });

  it('a CANCELLED game does not gate — it can never be picked', () => {
    expect(gatesSubmission(game('a', { status: 'CANCELLED' }))).toBe(false);
  });
});

describe('poolMatchesSlate', () => {
  it('matches on season + seasonType, coercing a string seasonType', () => {
    expect(poolMatchesSlate(pool('p'), KEY)).toBe(true);
    expect(poolMatchesSlate(pool('p', { seasonType: '1' as any }), KEY)).toBe(true);
  });

  it('a preseason slate must not implicate a regular-season pool', () => {
    expect(poolMatchesSlate(pool('p', { seasonType: 2 }), KEY)).toBe(false);
    expect(poolMatchesSlate(pool('p', { season: '2025' }), KEY)).toBe(false);
  });

  it('a pool with no seasonType defaults to regular season (2), same as the gate', () => {
    expect(poolMatchesSlate(pool('p', { seasonType: undefined }), { ...KEY, seasonType: 2 })).toBe(true);
    expect(poolMatchesSlate(pool('p', { seasonType: undefined }), KEY)).toBe(false);
  });
});

describe('evaluateSlate', () => {
  it('counts a fully locked slate as covered', () => {
    const c = evaluateSlate(KEY, [game('g1'), game('g2')], [pool('p1')]);
    expect(c).toMatchObject({ total: 2, locked: 2, unlockedGameIds: [], affectedPoolIds: ['p1'] });
  });

  it('one unlocked game is enough to block the week', () => {
    const c = evaluateSlate(KEY, [game('g1'), game('g2', { spread: { value: -3, locked: false } })], [pool('p1')]);
    expect(c.total).toBe(2);
    expect(c.locked).toBe(1);
    expect(c.unlockedGameIds).toEqual(['g2']);
  });

  it('treats a missing spread and a missing locked flag as unlocked', () => {
    const c = evaluateSlate(KEY, [
      game('g1', { spread: null }),
      game('g2', { spread: { value: -3 } }),
    ], [pool('p1')]);
    expect(c.unlockedGameIds).toEqual(['g1', 'g2']);
  });

  it('separates "no line at all" from "line exists but unlocked" — different fixes', () => {
    const c = evaluateSlate(KEY, [
      game('noline', { spread: null }),
      game('unlocked', { spread: { value: -7, locked: false } }),
    ], [pool('p1')]);
    expect(c.unlockedGameIds).toEqual(['noline', 'unlocked']);
    expect(c.missingLineGameIds).toEqual(['noline']); // re-running the lock job cannot fix this one
  });

  it('excludes CANCELLED games from the count entirely', () => {
    const c = evaluateSlate(KEY, [game('g1'), game('dead', { status: 'CANCELLED', spread: null })], [pool('p1')]);
    expect(c.total).toBe(1);
    expect(c.unlockedGameIds).toEqual([]);
  });

  it('reports the earliest kickoff, not the first document', () => {
    const c = evaluateSlate(KEY, [
      game('late', { startTime: NOW + 48 * HOUR }),
      game('early', { startTime: NOW + 6 * HOUR }),
    ], [pool('p1')]);
    expect(c.firstKickoffMs).toBe(NOW + 6 * HOUR);
  });

  it('lists only the pools actually on the slate', () => {
    const c = evaluateSlate(KEY, [game('g1')], [pool('mine'), pool('other', { seasonType: 2 })]);
    expect(c.affectedPoolIds).toEqual(['mine']);
  });
});

describe('decideAlert', () => {
  const unlocked = (over: Partial<WatchedGame> = {}) =>
    evaluateSlate(KEY, [game('g1', { spread: { value: -3, locked: false }, ...over })], [pool('p1')]);

  it('fires inside the warning window', () => {
    const d = decideAlert(unlocked({ startTime: NOW + 10 * HOUR }), NOW, 36);
    expect(d.alert).toBe(true);
    expect(d.reason).toContain('1/1 spreads unlocked');
  });

  it('stays quiet for a slate that is still days out — no line yet is normal', () => {
    const d = decideAlert(unlocked({ startTime: NOW + 60 * HOUR }), NOW, 36);
    expect(d.alert).toBe(false);
    expect(d.reason).toContain('outside 36h window');
  });

  it('fires LOUDER once kickoff has passed — that is the live outage', () => {
    const d = decideAlert(unlocked({ startTime: NOW - 2 * HOUR }), NOW, 36);
    expect(d.alert).toBe(true);
    expect(d.reason).toContain('OUTAGE IN PROGRESS');
    expect(d.hoursToKickoff).toBeCloseTo(-2, 5);
  });

  it('stays quiet when every spread is locked', () => {
    const d = decideAlert(evaluateSlate(KEY, [game('g1')], [pool('p1')]), NOW, 36);
    expect(d.alert).toBe(false);
    expect(d.reason).toBe('all spreads locked');
  });

  it('stays quiet when no live pool sits on the slate — nobody is blocked', () => {
    const c = evaluateSlate(KEY, [game('g1', { spread: { value: -3, locked: false }, startTime: NOW + 2 * HOUR })], []);
    expect(decideAlert(c, NOW, 36)).toMatchObject({ alert: false, reason: 'no live pool on this slate' });
  });

  it('stays quiet on an empty slate rather than dividing by nothing', () => {
    const c = evaluateSlate(KEY, [], [pool('p1')]);
    expect(decideAlert(c, NOW, 36)).toMatchObject({ alert: false, reason: 'no gating games' });
  });
});

describe('formatAlertMessage', () => {
  it('names the blocked pools and the unlocked games', () => {
    const c = evaluateSlate(KEY, [game('g1', { spread: { value: -3, locked: false }, startTime: NOW + 2 * HOUR })], [pool('p1')]);
    const msg = formatAlertMessage(c, decideAlert(c, NOW, 36));
    expect(msg).toContain('Week 1');
    expect(msg).toContain('SPREADS_NOT_LOCKED');
    expect(msg).toContain('g1');
    expect(msg).toContain('p1');
  });

  it('calls out no-line games, because re-running the lock job will not fix them', () => {
    const c = evaluateSlate(KEY, [game('g1', { spread: null, startTime: NOW + 2 * HOUR })], [pool('p1')]);
    expect(formatAlertMessage(c, decideAlert(c, NOW, 36))).toContain('NO spread value at all');
  });
});

describe('slateId', () => {
  it('keys a slate by the same triple the submit gate queries on', () => {
    expect(slateId(KEY)).toBe('2026/1/1');
  });
});
