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

/**
 * Firestore stand-in with real documents, so the WRITE path can be exercised.
 * `stored` is the nfl_games collection keyed by id; the time-window query returns
 * only the docs that fall inside it, exactly as Firestore would, while getAll()
 * resolves any id directly. That asymmetry is the whole point of the test below.
 */
function fakeDbWithDocs(stored: Record<string, any>, now: number, lookbackMs: number) {
  const writes: Array<{ id: string; data: any }> = [];
  const docOf = (id: string) => ({
    id,
    exists: stored[id] !== undefined,
    data: () => stored[id],
  });
  const inWindow = Object.keys(stored).filter(
    (id) => stored[id].startTime >= now - lookbackMs && stored[id].startTime <= now + 2 * 60 * 60 * 1000,
  );
  const query: any = {
    where: () => query,
    async get() {
      const docs = inWindow.map(docOf);
      return { empty: docs.length === 0, docs, forEach: (f: any) => docs.forEach(f) };
    },
  };
  const db = {
    collection: () => ({ ...query, doc: (id: string) => ({ id, _id: id }) }),
    async getAll(...refs: any[]) {
      return refs.map((r) => docOf(r._id));
    },
    batch: () => ({
      set: (ref: any, data: any) => writes.push({ id: ref._id, data }),
      async commit() { /* no-op */ },
    }),
    doc: () => ({ async get() { return { data: () => undefined }; } }),
  } as unknown as Firestore;
  return { db, writes };
}

const espnGame = (over: Record<string, any>) => ({
  season: '2026', seasonType: 1, week: 1,
  homeTeam: { abbreviation: 'KC' }, awayTeam: { abbreviation: 'DET' },
  status: 'SCHEDULED', ...over,
});

describe('syncScoresWindow — a locked spread survives the write', () => {
  const NOW = 1_760_000_000_000;
  const HOUR = 60 * 60 * 1000;

  // qodo (PR #235): ESPN returns the WHOLE week, and every returned game is
  // written. Lock preservation used to consult only the time-windowed docs, so a
  // game later in the same week — outside [now-24h, now+2h] but inside the ESPN
  // slate — was written with the parser's `locked: false`, silently unlocking a
  // line members had already picked against.
  it('preserves spread.locked on a game OUTSIDE the time window', async () => {
    const stored = {
      // Thursday game, already played — this is what pulls week 1 into the sweep.
      espn_thu: { id: 'espn_thu', season: '2026', seasonType: 1, week: 1, startTime: NOW - 20 * HOUR, status: 'FINAL' },
      // Sunday game, three days out: NOT in the window, but locked by lockNFLSpreadsJob.
      espn_sun: { id: 'espn_sun', season: '2026', seasonType: 1, week: 1, startTime: NOW + 72 * HOUR, status: 'SCHEDULED', spread: { value: -3.5, locked: true } },
    };
    const { db, writes } = fakeDbWithDocs(stored, NOW, HOT_WINDOW_LOOKBACK_MS);

    await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, {
      fetchSlate: async () => ({
        games: [
          espnGame({ id: 'espn_thu', startTime: NOW - 20 * HOUR, status: 'FINAL' }),
          // ESPN re-offers a fresh, DIFFERENT line with locked:false, as the parser emits.
          espnGame({ id: 'espn_sun', startTime: NOW + 72 * HOUR, spread: { value: -7, locked: false } }),
        ] as any,
        raw: null,
      }),
    });

    const sunday = writes.find((w) => w.id === 'espn_sun');
    expect(sunday).toBeDefined();
    // Both the flag AND the frozen value must survive — an unlocked-but-correct
    // value would still have moved the line members picked against.
    expect(sunday!.data.spread).toEqual({ value: -3.5, locked: true });
  });

  it('still takes ESPN\'s line when the stored spread is NOT locked', async () => {
    const stored = {
      espn_thu: { id: 'espn_thu', season: '2026', seasonType: 1, week: 1, startTime: NOW - 20 * HOUR, status: 'FINAL' },
      espn_sun: { id: 'espn_sun', season: '2026', seasonType: 1, week: 1, startTime: NOW + 72 * HOUR, status: 'SCHEDULED', spread: { value: -3.5, locked: false } },
    };
    const { db, writes } = fakeDbWithDocs(stored, NOW, HOT_WINDOW_LOOKBACK_MS);

    await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, {
      fetchSlate: async () => ({
        games: [
          espnGame({ id: 'espn_thu', startTime: NOW - 20 * HOUR, status: 'FINAL' }),
          espnGame({ id: 'espn_sun', startTime: NOW + 72 * HOUR, spread: { value: -7, locked: false } }),
        ] as any,
        raw: null,
      }),
    });

    expect(writes.find((w) => w.id === 'espn_sun')!.data.spread).toEqual({ value: -7, locked: false });
  });
});
