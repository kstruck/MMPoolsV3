import { describe, it, expect } from 'vitest';
import {
  clampLookbackDays,
  syncScoresWindow,
  scoreSyncHeartbeat,
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
    // The scoreless-FINAL recovery query is bounded (qodo), so the stand-in has
    // to accept `.limit()` — without it the second query throws and this file's
    // lookback assertions fail for a reason that has nothing to do with lookback.
    limit() {
      return query;
    },
    async get() {
      return { empty: true, size: 0, docs: [], forEach: () => undefined };
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
    expect(result).toEqual({
      slates: 0, gamesWritten: 0, corrections: 0,
      slatesNotReconciled: 0, snapshotFailures: 0, correctionReportFailures: 0,
      scorelessFinals: 0,
    });
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
  // The §5b handoff: syncScoresWindow enqueues a rescore event after it commits a
  // slate. Recorded rather than ignored so the enqueue is asserted here, at the
  // one place that knows whether a correction or a first-final actually happened.
  const enqueued: any[] = [];
  let autoIds = 0;
  const docOf = (id: string) => ({
    id,
    exists: stored[id] !== undefined,
    data: () => stored[id],
  });
  /**
   * `where()` used to ignore its arguments entirely and every query returned the
   * time-windowed set. That was harmless while there was ONE query — and became
   * actively misleading the moment `syncScoresWindow` grew a second one
   * (`scoresMissing == true`, the door that un-strands a scoreless FINAL past the
   * lookback): the fake would answer it with the in-window docs, so the test
   * would pass without the door existing. Constraints are applied for real now.
   */
  const makeQuery = (constraints: Array<[string, string, any]>, cap?: number): any => ({
    where: (field: string, op: string, value: any) => makeQuery([...constraints, [field, op, value]], cap),
    limit: (n: number) => makeQuery(constraints, n),
    async get() {
      const ids = Object.keys(stored).filter((id) => constraints.every(([field, op, value]) => {
        const actual = (stored[id] as Record<string, unknown>)[field];
        if (op === '>=') return typeof actual === 'number' && actual >= value;
        if (op === '<=') return typeof actual === 'number' && actual <= value;
        if (op === '==') return actual === value;
        throw new Error(`fakeDb: unsupported operator ${op}`);
      }));
      const docs = (cap === undefined ? ids : ids.slice(0, cap)).map(docOf);
      return { empty: docs.length === 0, size: docs.length, docs, forEach: (f: any) => docs.forEach(f) };
    },
  });
  const query = makeQuery([]);
  const db = {
    collection: (name: string) => ({
      ...query,
      // doc() with no id is how a batch appends a queue event.
      doc: (id?: string) => ({ id: id ?? `auto${autoIds++}`, _id: id ?? `auto${autoIds}`, _col: name }),
    }),
    async getAll(...refs: any[]) {
      return refs.map((r) => docOf(r._id));
    },
    batch: () => ({
      set: (ref: any, data: any) => {
        if (ref._col === 'nfl_rescore_queue') enqueued.push(data);
        else writes.push({ id: ref._id, data });
      },
      async commit() { /* no-op */ },
    }),
    doc: () => ({ async get() { return { data: () => undefined }; } }),
  } as unknown as Firestore;
  return { db, writes, enqueued };
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

// Codex review of PR #245, rounds 1 and 2. syncScoresWindow RESOLVES NORMALLY
// through both ways a slate can go unreconciled, and neither throws:
//   - ESPN is down: fetchNFLWeekScheduleWithRaw catches and returns
//     `{ games: [], raw: null }`;
//   - ESPN answers but with the WRONG SEASON: resolveScoreboardUrl's calendar
//     lookup fails, the fallback URL serves another season, and the PR #219
//     season guard filters every event — a successful fetch (`raw` non-null)
//     that reconciles nothing.
// A heartbeat derived only from "did this throw" stamps ok:true through both —
// the exact blind spot the heartbeat module was built to close, reintroduced
// inside it. A slate is only in the loop because nfl_games already holds games
// for it, so zero games back is always an anomaly.
describe('syncScoresWindow — an unreconciled slate is counted, however it failed', () => {
  const NOW = 1_760_000_000_000;
  const HOUR = 60 * 60 * 1000;
  const oneStoredGame = {
    espn_thu: { id: 'espn_thu', season: '2026', seasonType: 1, week: 1, startTime: NOW - 20 * HOUR, status: 'LIVE' },
  };

  it('counts the fetcher\'s catch-block return (ESPN down)', async () => {
    const { db } = fakeDbWithDocs(oneStoredGame, NOW, HOT_WINDOW_LOOKBACK_MS);
    // Precisely what fetchNFLWeekScheduleWithRaw returns when ESPN is down.
    const r = await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, {
      fetchSlate: async () => ({ games: [], raw: null }),
    });
    expect(r.slatesNotReconciled).toBe(1);
    expect(scoreSyncHeartbeat(r).ok).toBe(false);
  });

  it('counts a SUCCESSFUL fetch whose events were all season-filtered', async () => {
    // raw is non-null — the request worked — but the season guard dropped
    // every event. Nothing is written and nothing throws.
    const { db, writes } = fakeDbWithDocs(oneStoredGame, NOW, HOT_WINDOW_LOOKBACK_MS);
    const r = await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, {
      fetchSlate: async () => ({ games: [], raw: { events: ['wrong season'] } }),
    });
    expect(writes).toHaveLength(0);
    expect(r.slatesNotReconciled).toBe(1);
    expect(scoreSyncHeartbeat(r).ok).toBe(false);
  });

  it('does NOT count a healthy slate', async () => {
    const { db } = fakeDbWithDocs(oneStoredGame, NOW, HOT_WINDOW_LOOKBACK_MS);
    const r = await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, {
      fetchSlate: async () => ({
        // `scores` is required for this to be a HEALTHY final: a FINAL the feed
        // reported no scores for is now a degraded run (NFL7-3), which is what
        // this fixture accidentally was.
        games: [espnGame({
          id: 'espn_thu', startTime: NOW - 20 * HOUR, status: 'FINAL',
          scores: { home: 27, away: 24 },
        })] as any,
        raw: { ok: true },
      }),
    });
    expect(r.slatesNotReconciled).toBe(0);
    expect(r.scorelessFinals).toBe(0);
    expect(scoreSyncHeartbeat(r).ok).toBe(true);
  });

  it('COUNTS a FINAL the feed reported no scores for, and marks the doc', async () => {
    // The condition is invisible everywhere else: the fetch succeeded, the slate
    // reconciled, the game was written. Only this counter says the game cannot be
    // scored — and `scoresMissing` on the doc is what keeps its slate in the sync
    // window after it ages past the lookback, which is the difference between
    // waiting and being stranded.
    const { db, writes } = fakeDbWithDocs(oneStoredGame, NOW, HOT_WINDOW_LOOKBACK_MS);
    const r = await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, {
      fetchSlate: async () => ({
        games: [espnGame({ id: 'espn_thu', startTime: NOW - 20 * HOUR, status: 'FINAL' })] as any,
        raw: { ok: true },
      }),
    });
    expect(r.slatesNotReconciled).toBe(0);
    expect(r.scorelessFinals).toBe(1);
    expect(scoreSyncHeartbeat(r).ok).toBe(false);
    expect(scoreSyncHeartbeat(r).error).toContain('FINAL with no reported scores');
    expect(writes.some((w: any) => w?.data?.scoresMissing === true)).toBe(true);
  });

  it('re-syncs a scoreless FINAL that has aged OUT of the lookback window', async () => {
    // The stall codex found, and the reason `scoresMissing` is persisted at all.
    //
    // The window query bounds on startTime, so this game — 40h old, well past the
    // 24h lookback — is invisible to it. It is also not terminal (no scores), so
    // its pool never finalizes. Without the second door nothing would ever ask
    // ESPN about it again and the pool would sit unfinalized forever, with no
    // failure anywhere to notice.
    const stranded = {
      espn_old: {
        id: 'espn_old', season: '2026', seasonType: 1, week: 1,
        startTime: NOW - 40 * HOUR, status: 'FINAL', scoresMissing: true,
      },
    };
    const { db, writes } = fakeDbWithDocs(stranded, NOW, HOT_WINDOW_LOOKBACK_MS);
    const r = await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, {
      fetchSlate: async () => ({
        // This run is the one where ESPN finally delivers.
        games: [espnGame({
          id: 'espn_old', startTime: NOW - 40 * HOUR, status: 'FINAL',
          scores: { home: 27, away: 24 },
        })] as any,
        raw: { ok: true },
      }),
    });

    // The slate was fetched at all — that is the whole point.
    expect(r.slates).toBe(1);
    expect(r.slatesNotReconciled).toBe(0);
    // ...and the marker is CLEARED by the same write, so the door closes behind
    // it rather than re-fetching this slate on every run forever.
    const write = writes.find((w: any) => w.id === 'espn_old');
    expect(write?.data?.scoresMissing).toBe(false);
    expect(r.scorelessFinals).toBe(0);
    expect(scoreSyncHeartbeat(r).ok).toBe(true);
  });

  it('does not re-enqueue a rescore when the feed temporarily drops scores it already delivered', async () => {
    // codex r3. Every write is merge:true, so a payload that omits `scores`
    // leaves the stored ones in place — but the RAW payload reads as a scoreless
    // FINAL, i.e. non-terminal. Comparing that to a stored terminal game looks
    // like a terminal → nonterminal transition, and would enqueue a `terminal`
    // rescore on every 5-minute sync for as long as ESPN kept omitting them,
    // repeatedly rescoring an already-finalized pool.
    const stored = {
      espn_thu: {
        id: 'espn_thu', season: '2026', seasonType: 1, week: 1,
        startTime: NOW - 20 * HOUR, status: 'FINAL', scores: { home: 27, away: 24 },
      },
    };
    const { db, writes, enqueued } = fakeDbWithDocs(stored, NOW, HOT_WINDOW_LOOKBACK_MS);
    const r = await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, {
      fetchSlate: async () => ({
        // Same status, scores dropped from THIS payload only.
        games: [espnGame({ id: 'espn_thu', startTime: NOW - 20 * HOUR, status: 'FINAL' })] as any,
        raw: { ok: true },
      }),
    });

    expect(enqueued.filter((e: any) => e.reason === 'terminal')).toHaveLength(0);
    // ...and the game is not flagged either: the merged result still has scores.
    expect(writes.find((w: any) => w.id === 'espn_thu')?.data?.scoresMissing).toBe(false);
    expect(r.scorelessFinals).toBe(0);
    expect(scoreSyncHeartbeat(r).ok).toBe(true);
  });

  it('a DRY RUN still reports a scoreless FINAL, while writing nothing', async () => {
    // codex r3. The deep sweep runs dry by DEFAULT, so a dry run that re-fetches
    // an already-stranded game, gets another scoreless FINAL and then reports a
    // healthy run makes the monitoring worthless in exactly the case it exists
    // for.
    const stranded = {
      espn_old: {
        id: 'espn_old', season: '2026', seasonType: 1, week: 1,
        startTime: NOW - 40 * HOUR, status: 'FINAL', scoresMissing: true,
      },
    };
    const { db, writes, enqueued } = fakeDbWithDocs(stranded, NOW, HOT_WINDOW_LOOKBACK_MS);
    const r = await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, {
      dryRun: true,
      fetchSlate: async () => ({
        games: [espnGame({ id: 'espn_old', startTime: NOW - 40 * HOUR, status: 'FINAL' })] as any,
        raw: { ok: true },
      }),
    });

    expect(r.scorelessFinals).toBe(1);
    expect(scoreSyncHeartbeat(r).ok).toBe(false);
    // A dry run is still a dry run.
    expect(writes).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it('stays degraded when the refresh does not return the marked game at all', async () => {
    // codex r4. The slate came back NON-empty, so slatesNotReconciled stays 0,
    // and the counting loop only sees what was returned — so a marked game the
    // feed simply omits keeps its flag, is retried forever, and the heartbeat
    // reports healthy while the pool is still blocked. The ABSENCE is the signal,
    // and an absent error is not evidence of success.
    const stranded = {
      espn_old: {
        id: 'espn_old', season: '2026', seasonType: 1, week: 1,
        startTime: NOW - 40 * HOUR, status: 'FINAL', scoresMissing: true,
      },
    };
    const { db } = fakeDbWithDocs(stranded, NOW, HOT_WINDOW_LOOKBACK_MS);
    const r = await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, {
      fetchSlate: async () => ({
        // A different game of the same slate came back; the marked one did not.
        games: [espnGame({
          id: 'espn_other', startTime: NOW - 40 * HOUR, status: 'FINAL',
          scores: { home: 20, away: 17 },
        })] as any,
        raw: { ok: true },
      }),
    });

    expect(r.slatesNotReconciled).toBe(0);
    expect(r.scorelessFinals).toBe(1);
    expect(scoreSyncHeartbeat(r).ok).toBe(false);
  });

  it('does not open the second door for a game that has scores', async () => {
    // The negative: `scoresMissing` is false, the game is outside the window, so
    // there is nothing to sync and the run is a clean no-op. Without this the
    // test above would pass against a query that simply returned everything.
    const settled = {
      espn_done: {
        id: 'espn_done', season: '2026', seasonType: 1, week: 1,
        startTime: NOW - 40 * HOUR, status: 'FINAL',
        scores: { home: 27, away: 24 }, scoresMissing: false,
      },
    };
    const { db } = fakeDbWithDocs(settled, NOW, HOT_WINDOW_LOOKBACK_MS);
    const r = await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, {
      fetchSlate: async () => { throw new Error('must not fetch — nothing is owed'); },
    });
    expect(r.slates).toBe(0);
    expect(r.gamesWritten).toBe(0);
    expect(scoreSyncHeartbeat(r).ok).toBe(true);
  });
});

// PLAN-REALTIME-SCORING §5b — the durable handoff to nfl_rescore_queue. These are
// the enqueue half; the drain half lives in autoScore.emulator.test.ts.
describe('syncScoresWindow — the rescore handoff', () => {
  const NOW = 1_760_000_000_000;
  const HOUR = 60 * 60 * 1000;
  const storedLive = {
    espn_thu: { id: 'espn_thu', season: '2026', seasonType: 1, week: 1, startTime: NOW - 20 * HOUR, status: 'LIVE' },
  };
  const storedFinal = {
    espn_thu: {
      id: 'espn_thu', season: '2026', seasonType: 1, week: 1, startTime: NOW - 20 * HOUR,
      status: 'FINAL', scores: { home: 27, away: 24 },
    },
  };
  const fresh = (over: Record<string, any> = {}) =>
    [espnGame({ id: 'espn_thu', startTime: NOW - 20 * HOUR, status: 'FINAL', scores: { home: 27, away: 24 }, ...over })] as any;

  it('enqueues on a nonterminal → terminal transition', async () => {
    // The postponed-game case: a first FINAL is the ONLY signal, and past 24h the
    // live tier can no longer see the slate at all.
    const { db, enqueued } = fakeDbWithDocs(storedLive, NOW, HOT_WINDOW_LOOKBACK_MS);
    const r = await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, { fetchSlate: async () => ({ games: fresh(), raw: { ok: true } }) });

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ season: '2026', seasonType: 1, week: 1, reason: 'terminal' });
  });

  it('enqueues a CANCELLED transition too, not just a FINAL', async () => {
    // A game postponed and later cancelled past 24h still carries a void, the
    // deferred penalties and the week's completion (codex r10).
    const { db, enqueued } = fakeDbWithDocs(storedLive, NOW, HOT_WINDOW_LOOKBACK_MS);
    await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, {
      fetchSlate: async () => ({ games: fresh({ status: 'CANCELLED', scores: undefined }), raw: { ok: true } }),
    });
    expect(enqueued.map((e: any) => e.reason)).toEqual(['terminal']);
  });

  it('enqueues a CANCELLED → FINAL reactivation, which neither test alone catches', async () => {
    // codex r3: both statuses are terminal, so a "became terminal" test never
    // fires; detectStatCorrections ignores it too because it only compares games
    // that were ALREADY FINAL. Without this a pool finalized on the void keeps it.
    const storedCancelled = {
      espn_thu: {
        id: 'espn_thu', season: '2026', seasonType: 1, week: 1,
        startTime: NOW - 20 * HOUR, status: 'CANCELLED',
      },
    };
    const { db, enqueued } = fakeDbWithDocs(storedCancelled, NOW, HOT_WINDOW_LOOKBACK_MS);
    await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, { fetchSlate: async () => ({ games: fresh(), raw: { ok: true } }) });
    expect(enqueued.map((e: any) => e.reason)).toEqual(['terminal']);
  });

  it('enqueues a CANCELLED → SCHEDULED reinstatement', async () => {
    // codex r11: the pool already graded this game VOID. Nothing else revisits
    // that until the game next goes terminal, which may never happen — and
    // detectStatCorrections ignores it because it only compares prior FINALs.
    const storedCancelled = {
      espn_thu: {
        id: 'espn_thu', season: '2026', seasonType: 1, week: 1,
        startTime: NOW - 20 * HOUR, status: 'CANCELLED',
      },
    };
    const { db, enqueued } = fakeDbWithDocs(storedCancelled, NOW, HOT_WINDOW_LOOKBACK_MS);
    await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, {
      fetchSlate: async () => ({ games: fresh({ status: 'SCHEDULED', scores: undefined }), raw: { ok: true } }),
    });
    expect(enqueued.map((e: any) => e.reason)).toEqual(['terminal']);
  });

  it('enqueues NOTHING for SCHEDULED → IN_PROGRESS — every live game, every 5 minutes', async () => {
    const storedScheduled = {
      espn_thu: {
        id: 'espn_thu', season: '2026', seasonType: 1, week: 1,
        startTime: NOW - 20 * HOUR, status: 'SCHEDULED',
      },
    };
    const { db, enqueued } = fakeDbWithDocs(storedScheduled, NOW, HOT_WINDOW_LOOKBACK_MS);
    await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, {
      fetchSlate: async () => ({ games: fresh({ status: 'IN_PROGRESS', scores: undefined }), raw: { ok: true } }),
    });
    expect(enqueued).toHaveLength(0);
  });

  it('enqueues a correction on an already-FINAL game', async () => {
    // detectStatCorrections only fires on games that were ALREADY final, which is
    // the other half of the pair — a Sunday score restated on the Tuesday.
    const { db, enqueued } = fakeDbWithDocs(storedFinal, NOW, HOT_WINDOW_LOOKBACK_MS);
    const r = await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, {
      fetchSlate: async () => ({ games: fresh({ scores: { home: 30, away: 24 } }), raw: { ok: true } }),
    });
    expect(r.corrections).toBe(1);
    expect(enqueued.map((e: any) => e.reason)).toEqual(['correction']);
  });

  it('enqueues NOTHING when a final slate is simply rewritten unchanged', async () => {
    // The 5-minute job rewrites the whole slate on every run; without this the
    // queue would fill with no-op events all night.
    const { db, enqueued } = fakeDbWithDocs(storedFinal, NOW, HOT_WINDOW_LOOKBACK_MS);
    await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, { fetchSlate: async () => ({ games: fresh(), raw: { ok: true } }) });
    expect(enqueued).toHaveLength(0);
  });

  it('enqueues NOTHING on a dry run — no game changed, so there is nothing to reconcile', async () => {
    const { db, enqueued, writes } = fakeDbWithDocs(storedLive, NOW, HOT_WINDOW_LOOKBACK_MS);
    await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, {
      dryRun: true, fetchSlate: async () => ({ games: fresh(), raw: { ok: true } }),
    });
    expect(writes).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it('judges on games returned, not on whether a raw payload came with them', async () => {
    // Fixtures elsewhere in this file pass raw:null WITH games. That is a test
    // convenience, not an outage, and counting it would make the signal cry wolf.
    const { db } = fakeDbWithDocs(storedLive, NOW, HOT_WINDOW_LOOKBACK_MS);
    const r = await syncScoresWindow(db, NOW, HOT_WINDOW_LOOKBACK_MS, {
      fetchSlate: async () => ({
        games: [espnGame({ id: 'espn_thu', startTime: NOW - 20 * HOUR, status: 'FINAL' })] as any,
        raw: null,
      }),
    });
    expect(r.slatesNotReconciled).toBe(0);
  });
});

describe('scoreSyncHeartbeat — not throwing is not the same as healthy', () => {
  const clean = {
    slates: 2, gamesWritten: 16, corrections: 0,
    slatesNotReconciled: 0, snapshotFailures: 0, correctionReportFailures: 0,
    scorelessFinals: 0,
  };

  it('reports ok on a clean run', () => {
    expect(scoreSyncHeartbeat(clean).ok).toBe(true);
  });

  it('reports NOT ok when a slate went unreconciled, even though nothing threw', () => {
    const v = scoreSyncHeartbeat({ ...clean, slatesNotReconciled: 2 });
    expect(v.ok).toBe(false);
    expect(v.error).toContain('2 slate(s) returned no games');
  });

  it('reports NOT ok when a snapshot write was swallowed — the A5 failure', () => {
    const v = scoreSyncHeartbeat({ ...clean, snapshotFailures: 1 });
    expect(v.ok).toBe(false);
    expect(v.error).toContain('1 snapshot write(s) failed');
  });

  it('names both causes when both happened', () => {
    expect(scoreSyncHeartbeat({ ...clean, slatesNotReconciled: 1, snapshotFailures: 3 }).error)
      .toBe('1 slate(s) returned no games; 3 snapshot write(s) failed');
  });

  it('reports NOT ok when a detected correction could not be REPORTED', () => {
    // The most expensive silent failure in the file: the correction was found
    // and then dropped, so pools stay finalized on stale scores and nobody knows.
    const v = scoreSyncHeartbeat({ ...clean, corrections: 2, correctionReportFailures: 1 });
    expect(v.ok).toBe(false);
    expect(v.error).toContain('1 stat-correction report(s) undelivered');
  });

  it('reports NOT ok when the feed left a game FINAL with no scores (NFL7-3)', () => {
    // Not a failure of the sync itself - the FEED is what is broken - but the
    // game cannot be scored and its pool cannot finalize, so a green heartbeat
    // here would be a lie. This is the operator's signal for the condition.
    const v = scoreSyncHeartbeat({ ...clean, scorelessFinals: 1 });
    expect(v.ok).toBe(false);
    expect(v.error).toContain('1 game(s) FINAL with no reported scores');
    expect(v.detail.scorelessFinals).toBe(1);
  });

  it('always carries the counts as detail, so a degraded run is diagnosable', () => {
    expect(scoreSyncHeartbeat({ ...clean, slatesNotReconciled: 1 }).detail).toEqual({
      slates: 2, gamesWritten: 16, corrections: 0,
      slatesNotReconciled: 1, snapshotFailures: 0, correctionReportFailures: 0,
      scorelessFinals: 0,
    });
  });

});
