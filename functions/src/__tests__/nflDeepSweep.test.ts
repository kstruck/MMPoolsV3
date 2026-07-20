import { describe, it, expect } from 'vitest';
import {
  clampLookbackDays,
  syncScoresWindow,
  DEFAULT_DEEP_SWEEP_DAYS,
  HOT_WINDOW_LOOKBACK_MS,
} from '../nflSchedule';
import type { Firestore } from 'firebase-admin/firestore';

// PICKUP §6.4: syncNFLScoresJob only re-reads games that kicked off in the last
// 24h, so a stat correction restated on the Tuesday after a Sunday game was never
// seen — which silently bounded what A5's correction detection could protect.
// nflDeepScoreSweepJob re-runs the same reconciliation over a wider window once a
// day. These pin the two things that can regress silently: the clamp on the
// config-supplied window, and that the window actually reaches the query.

describe('clampLookbackDays', () => {
  it('defaults when the config value is absent or not a finite number', () => {
    expect(clampLookbackDays(undefined)).toBe(DEFAULT_DEEP_SWEEP_DAYS);
    expect(clampLookbackDays(null)).toBe(DEFAULT_DEEP_SWEEP_DAYS);
    expect(clampLookbackDays('7')).toBe(DEFAULT_DEEP_SWEEP_DAYS);
    expect(clampLookbackDays(NaN)).toBe(DEFAULT_DEEP_SWEEP_DAYS);
    expect(clampLookbackDays(Infinity)).toBe(DEFAULT_DEEP_SWEEP_DAYS);
  });

  it('clamps to [1, 30] so one bad config edit cannot re-fetch the season nightly', () => {
    expect(clampLookbackDays(0)).toBe(1);
    expect(clampLookbackDays(-5)).toBe(1);
    expect(clampLookbackDays(365)).toBe(30);
    expect(clampLookbackDays(30)).toBe(30);
  });

  it('passes through a sane value, floored', () => {
    expect(clampLookbackDays(3)).toBe(3);
    expect(clampLookbackDays(10.9)).toBe(10);
  });
});

/**
 * Minimal Firestore stand-in that records the range bounds the query was built
 * with and reports an empty result, so syncScoresWindow returns before any
 * network call. Enough to prove the lookback parameter is load-bearing.
 */
function fakeDb() {
  const wheres: Array<[string, string, number]> = [];
  const query = {
    where(field: string, op: string, value: number) {
      wheres.push([field, op, value]);
      return query;
    },
    async get() {
      return { empty: true, docs: [], forEach: () => undefined };
    },
  };
  const db = { collection: () => query } as unknown as Firestore;
  return { db, wheres };
}

describe('syncScoresWindow — the lookback is what it queries', () => {
  const NOW = 1_760_000_000_000;

  it('sets the lower bound from lookbackMs, not a hardcoded 24h', async () => {
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const { db, wheres } = fakeDb();

    const result = await syncScoresWindow(db, NOW, sevenDays);

    const lower = wheres.find(([, op]) => op === '>=');
    expect(lower).toEqual(['startTime', '>=', NOW - sevenDays]);
    // Regression guard: if someone reintroduces the constant, this is the value
    // the bound would wrongly take.
    expect(lower?.[2]).not.toBe(NOW - HOT_WINDOW_LOOKBACK_MS);
    expect(result).toEqual({ slates: 0, gamesWritten: 0, corrections: 0 });
  });

  it('keeps the +2h upper bound regardless of lookback', async () => {
    const { db, wheres } = fakeDb();
    await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS);
    expect(wheres.find(([, op]) => op === '<=')).toEqual([
      'startTime',
      '<=',
      NOW + 2 * 60 * 60 * 1000,
    ]);
  });
});
