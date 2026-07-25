import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
// Imported from lib/, NOT from the job module: nflAutoScore.ts pulls in the
// scorer, which pulls in billing.ts, which calls admin.firestore() at module
// load — so importing the job here fails at collection with "the default
// Firebase app does not exist", and this whole file would silently not run.
import {
  isTerminalPool,
  computeWeekFingerprint,
  autoScoreHeartbeat,
  rotateForRun,
  type AutoScoreResult,
} from '../lib/autoScoreDecisions';
import { isTerminalGame, isWeekComplete } from '../lib/weekCompletion';
import type { NFLGame } from '../nflPoolTypes';

/**
 * Pure-helper coverage for the auto-scorer's decision logic.
 *
 * The fingerprint cases are the load-bearing ones and they all assert the same
 * shape: a change a human would call "the grades moved" must move the hash. Each
 * term that is missing means the pool takes the skip path FOREVER, so these are
 * written as "this change re-scores", not as hash-value assertions.
 */

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr, logoUrl: '' });

function game(over: Partial<NFLGame> = {}): NFLGame {
  return {
    id: 'g1',
    espnGameId: '1',
    week: 1,
    season: '2026',
    seasonType: 1,
    homeTeam: T('KC'),
    awayTeam: T('BUF'),
    scores: { home: 27, away: 24 },
    startTime: NOW - 4 * HOUR,
    status: 'FINAL',
    clock: '0:00',
    period: 4,
    isMonday: false,
    spread: { value: -3, locked: true },
    ...over,
  } as NFLGame;
}

const pickem = (settings: Record<string, unknown> = {}) => ({
  type: 'NFL_PICKEM',
  settings: { lockBufferMinutes: 5, pickMode: 'STRAIGHT', confidenceMode: false, ...settings },
});
const survivor = (settings: Record<string, unknown> = {}) => ({
  type: 'NFL_SURVIVOR',
  settings: { lockBufferMinutes: 5, maxStrikes: 0, pickLosersMode: false, ...settings },
});

describe('isTerminalGame', () => {
  it('counts FINAL and CANCELLED as concluded, nothing else', () => {
    expect(isTerminalGame({ status: 'FINAL' })).toBe(true);
    // CANCELLED is graded (VOID / net 0 / survive) so it is as settled as a final.
    expect(isTerminalGame({ status: 'CANCELLED' })).toBe(true);
    expect(isTerminalGame({ status: 'IN_PROGRESS' })).toBe(false);
    expect(isTerminalGame({ status: 'SCHEDULED' })).toBe(false);
  });
});

describe('isTerminalPool — which pools the scorer must never touch', () => {
  it('excludes a finalized pool by either signal', () => {
    expect(isTerminalPool({ isFinal: true })).toBe(true);
    expect(isTerminalPool({ finalizedAt: 12345 })).toBe(true);
  });

  it('excludes every settled status, case-insensitively', () => {
    for (const status of ['FINAL', 'CANCELED', 'COMPLETED', 'ARCHIVED']) {
      expect(isTerminalPool({ status }), status).toBe(true);
      expect(isTerminalPool({ status: status.toLowerCase() }), status.toLowerCase()).toBe(true);
    }
  });

  it('excludes a CANCELED pool — the case normalizePhase gets wrong', () => {
    // normalizePhase maps CANCELED -> 'open', so a phase-based filter would let
    // a voided pool through and rewrite its scores every active slot.
    expect(isTerminalPool({ status: 'CANCELED' })).toBe(true);
  });

  it('excludes an archived pool that carries no isFinal/finalizedAt', () => {
    // dbService.archivePool persists status only.
    expect(isTerminalPool({ status: 'archived' })).toBe(true);
  });

  it('KEEPS a live pool — including one that is merely locked', () => {
    expect(isTerminalPool({ status: 'OPEN' })).toBe(false);
    expect(isTerminalPool({ status: 'LOCKED', isFinal: false })).toBe(false);
    expect(isTerminalPool({})).toBe(false);
  });

  it('treats a missing pool as terminal rather than scoring it', () => {
    expect(isTerminalPool(undefined)).toBe(true);
    expect(isTerminalPool(null)).toBe(true);
  });
});

describe('isWeekComplete — what makes a pass provisional', () => {
  it('is complete when every game is concluded and past its lock', () => {
    expect(isWeekComplete(pickem(), 1, [game(), game({ id: 'g2' })], NOW)).toBe(true);
  });

  it('is INCOMPLETE while any game is unfinished', () => {
    expect(isWeekComplete(pickem(), 1, [game(), game({ id: 'g2', status: 'IN_PROGRESS' })], NOW)).toBe(false);
  });

  it('is INCOMPLETE when a FINAL game is still withheld by a Pick’em week override', () => {
    // The game is over but the commissioner extended the deadline, so members can
    // still change picks — revealing it would show them the answer.
    const pool = pickem({ weekLockOverrides: { 1: NOW + HOUR } });
    expect(isWeekComplete(pool, 1, [game()], NOW)).toBe(false);
  });

  it('IGNORES a week override on Survivor — those pools take no extension', () => {
    // effectiveLockSettings drops weekLockOverrides for hard-lock types, so the
    // same settings blob that withholds a Pick’em game cannot withhold this one.
    const pool = survivor({ weekLockOverrides: { 1: NOW + HOUR } });
    expect(isWeekComplete(pool, 1, [game()], NOW)).toBe(true);
  });
});

describe('computeWeekFingerprint — every skip-forever trap', () => {
  const base = () => computeWeekFingerprint(pickem(), 1, [game()], NOW);

  it('is stable for identical inputs and independent of game order', () => {
    const a = computeWeekFingerprint(pickem(), 1, [game(), game({ id: 'g2' })], NOW);
    const b = computeWeekFingerprint(pickem(), 1, [game({ id: 'g2' }), game()], NOW);
    expect(a).toBe(b);
    expect(a).toBe(computeWeekFingerprint(pickem(), 1, [game(), game({ id: 'g2' })], NOW));
  });

  it('moves when a final score is RESTATED (the count is unchanged)', () => {
    // The whole reason a bare FINAL count cannot be the skip key.
    expect(computeWeekFingerprint(pickem(), 1, [game({ scores: { home: 28, away: 24 } })], NOW))
      .not.toBe(base());
  });

  it('moves when a game flips to CANCELLED (the count does not grow)', () => {
    expect(computeWeekFingerprint(pickem(), 1, [game({ status: 'CANCELLED' })], NOW)).not.toBe(base());
  });

  it('moves when a locked spread is corrected — ATS winners change with no score change', () => {
    expect(computeWeekFingerprint(pickem(), 1, [game({ spread: { value: -6.5, locked: true } })], NOW))
      .not.toBe(base());
  });

  it('moves when the reveal bit flips as an override expires', () => {
    // Same raw game data before and after; only the lock moved. Without this term
    // the withheld game would never be revealed.
    const pool = pickem({ weekLockOverrides: { 1: NOW + HOUR } });
    const withheld = computeWeekFingerprint(pool, 1, [game()], NOW);
    const released = computeWeekFingerprint(pool, 1, [game()], NOW + 2 * HOUR);
    expect(withheld).not.toBe(released);
  });

  it('moves on a mid-week scoring-settings edit', () => {
    expect(computeWeekFingerprint(pickem({ pickMode: 'ATS' }), 1, [game()], NOW)).not.toBe(base());
    expect(computeWeekFingerprint(pickem({ confidenceMode: true }), 1, [game()], NOW)).not.toBe(base());

    const s = () => computeWeekFingerprint(survivor(), 1, [game()], NOW);
    expect(computeWeekFingerprint(survivor({ maxStrikes: 2 }), 1, [game()], NOW)).not.toBe(s());
    expect(computeWeekFingerprint(survivor({ pickLosersMode: true }), 1, [game()], NOW)).not.toBe(s());
    expect(computeWeekFingerprint(survivor({ autoSurviveExemptionEnabled: false }), 1, [game()], NOW)).not.toBe(s());
  });

  it('moves for Survivor the moment the weekly lock passes, with no game final', () => {
    // The at-lock no-pick strike must fire at the deadline, not wait for a game
    // to finish. Nothing else about the week has changed at that instant.
    const upcoming = game({ status: 'SCHEDULED', startTime: NOW + HOUR, scores: undefined });
    const beforeLock = computeWeekFingerprint(survivor(), 1, [upcoming], NOW);
    const afterLock = computeWeekFingerprint(survivor(), 1, [upcoming], NOW + HOUR);
    expect(beforeLock).not.toBe(afterLock);
  });

  it('does NOT add a lock term for Pick’em — it has no at-lock penalty to trigger', () => {
    const upcoming = game({ status: 'SCHEDULED', startTime: NOW + HOUR, scores: undefined });
    expect(computeWeekFingerprint(pickem(), 1, [upcoming], NOW))
      .toBe(computeWeekFingerprint(pickem(), 1, [upcoming], NOW + HOUR));
  });

  it('ignores unfinished games — they contribute no grade yet', () => {
    const withPending = computeWeekFingerprint(
      pickem(), 1, [game(), game({ id: 'g2', status: 'SCHEDULED', startTime: NOW + 3 * HOUR, scores: undefined })], NOW,
    );
    expect(withPending).toBe(base());
  });

  it('separates weeks — the same games under a different week number differ', () => {
    expect(computeWeekFingerprint(pickem(), 2, [game()], NOW)).not.toBe(base());
  });
});

describe('autoScoreHeartbeat', () => {
  const result = (over: Partial<AutoScoreResult> = {}): AutoScoreResult => ({
    activeSlates: 1, poolsScored: 3, poolsSkipped: 2, overflow: 0, poolsFailed: 0, ...over,
  });

  it('is healthy on a clean run and carries the counts', () => {
    const v = autoScoreHeartbeat(result(), false);
    expect(v.ok).toBe(true);
    expect(v.detail).toMatchObject({ activeSlates: 1, poolsScored: 3, poolsSkipped: 2, dryRun: false });
  });

  it('stays healthy on overflow — the next run is 10 minutes away, not an outage', () => {
    expect(autoScoreHeartbeat(result({ overflow: 5 }), false).ok).toBe(true);
  });

  it('is UNHEALTHY when a pool actually threw', () => {
    const v = autoScoreHeartbeat(result({ poolsFailed: 2 }), false);
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/2 pool\(s\) failed/);
  });
});

describe('rotateForRun — the per-run cap must not starve the tail', () => {
  const items = ['a', 'b', 'c', 'd'];
  const INTERVAL = 10 * 60 * 1000;

  it('advances the starting point by one per run interval', () => {
    expect(rotateForRun(items, 0, INTERVAL)).toEqual(['a', 'b', 'c', 'd']);
    expect(rotateForRun(items, INTERVAL, INTERVAL)).toEqual(['b', 'c', 'd', 'a']);
    expect(rotateForRun(items, 2 * INTERVAL, INTERVAL)).toEqual(['c', 'd', 'a', 'b']);
  });

  it('is stable within a single run interval', () => {
    expect(rotateForRun(items, INTERVAL, INTERVAL))
      .toEqual(rotateForRun(items, INTERVAL + 60_000, INTERVAL));
  });

  it('brings every item to the front within one cycle', () => {
    // The actual guarantee: no item can be permanently stuck behind a capful of
    // pools that bank no fingerprint and are therefore retried every run.
    const firsts = new Set(
      items.map((_, i) => rotateForRun(items, i * INTERVAL, INTERVAL)[0]),
    );
    expect(firsts).toEqual(new Set(items));
  });

  it('preserves length and contents, and handles an empty list', () => {
    expect(rotateForRun(items, 7 * INTERVAL, INTERVAL).sort()).toEqual([...items].sort());
    expect(rotateForRun([], 5 * INTERVAL, INTERVAL)).toEqual([]);
  });
});

describe('nflAutoScoreJob deployment wiring', () => {
  it('is re-exported from index.ts', () => {
    // Firebase deploys only what the entry point exports. A scheduled job left
    // out of index.ts type-checks, tests green, deploys — and never runs. The
    // callable export-surface guard scans onCall/validated only, so nothing else
    // in this suite covers a scheduled job.
    const index = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
    expect(index).toMatch(/export\s*\{[^}]*\bnflAutoScoreJob\b[^}]*\}\s*from\s*["']\.\/nflAutoScore["']/);
  });
});
