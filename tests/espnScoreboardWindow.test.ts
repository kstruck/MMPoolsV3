import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  monthKeysForWindow, scoreboardMonthUrls, fetchScoreboardWindow, windowAround,
} from '../src/services/espnScoreboardWindow';

/**
 * The public /scoreboard page's ESPN fetch, after the 2026-09-15 range outage.
 *
 * The page built `dates=<start>-<end>` for a ±7-day window. ESPN now answers
 * every date RANGE with HTTP 400, so the page threw `Failed to fetch scores` on
 * every 30-second refresh while ESPN itself was perfectly healthy — measured
 * from the live site's own origin. The window is now assembled from the months
 * it spans.
 */

const ok = (events: unknown[]) => ({ ok: true, status: 200, json: async () => ({ events }) });
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) });

const ev = (id: string, date: string) => ({ id, date });

describe('windowAround — the window is a function of the clock it is GIVEN', () => {
  it('spans ±7 days by default', () => {
    const { start, end } = windowAround(Date.parse('2026-09-23T12:00:00Z'));
    // Compared as a span rather than as fixed strings: the day arithmetic is
    // local, so pinning ISO text would make this test pass or fail by timezone.
    expect(Math.round((end.getTime() - start.getTime()) / 86_400_000)).toBe(14);
    expect(start.getTime()).toBeLessThan(Date.parse('2026-09-23T12:00:00Z'));
    expect(end.getTime()).toBeGreaterThan(Date.parse('2026-09-23T12:00:00Z'));
  });

  it('READS NO CLOCK OF ITS OWN — a wrong device clock cannot move it', () => {
    // The defect this closes: the page centred its window on `new Date()`, so a
    // device a day out fetched the wrong week and presented it as current.
    const fixed = Date.parse('2026-09-23T12:00:00Z');
    const a = windowAround(fixed);
    const realNow = Date.now;
    try {
      Date.now = () => Date.parse('2027-01-01T00:00:00Z');
      const b = windowAround(fixed);
      expect(b.start.getTime()).toBe(a.start.getTime());
      expect(b.end.getTime()).toBe(a.end.getTime());
    } finally {
      Date.now = realNow;
    }
  });

  it('honours a custom span', () => {
    const { start, end } = windowAround(Date.parse('2026-09-23T12:00:00Z'), 1);
    expect(Math.round((end.getTime() - start.getTime()) / 86_400_000)).toBe(2);
  });
});

describe('the Scoreboard page takes its window from the server clock', () => {
  // A source guard, not a render test: mounting this page pulls in Header,
  // Footer and src/firebase.ts, and the thing worth pinning is one import plus
  // one call site. Same shape as the other source-walking guards in tests/.
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/components/Scoreboard.tsx'), 'utf8');

  it('imports now() and the sync from utils/serverClock', () => {
    expect(src).toMatch(/import\s*\{[^}]*\bnow as serverNow\b[^}]*\}\s*from\s*'\.\.\/utils\/serverClock'/);
    expect(src).toMatch(/import\s*\{[^}]*\bsyncServerClock\b[^}]*\}\s*from\s*'\.\.\/utils\/serverClock'/);
  });

  it('builds the fetch window from serverNow(), never from a bare new Date()', () => {
    expect(src).toMatch(/windowAround\(\s*serverNow\(\)\s*\)/);
    // `new Date(game.date)` and `new Date(nowMs)` are fine and still present;
    // what must not come back is the no-argument form seeding the window.
    expect(src).not.toMatch(/const\s+today\s*=\s*new Date\(\)/);
  });

  it('AWAITS the sync before reading the clock — now() alone returns device time', () => {
    // The hole codex found: `now()` starts the sync and returns immediately, so
    // the first fetch (the only one, when auto-refresh is off) would still be
    // built on the uncorrected clock.
    const awaitIdx = src.indexOf('await Promise.race([');
    const windowIdx = src.indexOf('windowAround(serverNow())');
    expect(awaitIdx).toBeGreaterThan(-1);
    expect(src).toContain('syncServerClock()');
    expect(awaitIdx).toBeLessThan(windowIdx);
  });

  it('does NOT make the basketball tab wait on the clock', () => {
    // That feed sends no `dates=` and uses no window, so waiting on the sync
    // would delay live basketball scores for nothing. (codex r2.) Pinned by
    // position: the wait must sit after the basketball request, i.e. inside the
    // football branch.
    const basketballIdx = src.indexOf('mens-college-basketball/scoreboard');
    const awaitIdx = src.indexOf('await Promise.race([');
    expect(basketballIdx).toBeGreaterThan(-1);
    expect(awaitIdx).toBeGreaterThan(basketballIdx);
  });

  it('BOUNDS that wait, so scores never hang on the callable', () => {
    // The callable carries Firebase's ~70s default timeout; a public scoreboard
    // must not sit behind it.
    expect(src).toMatch(/const SERVER_CLOCK_SYNC_BUDGET_MS = \d+;/);
    const budget = Number(/const SERVER_CLOCK_SYNC_BUDGET_MS = (\d+);/.exec(src)?.[1]);
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThanOrEqual(5000);
    expect(src).toMatch(/setTimeout\(resolve, SERVER_CLOCK_SYNC_BUDGET_MS\)/);
  });
});

describe('monthKeysForWindow', () => {
  it('returns one key when the window sits inside a month', () => {
    expect(monthKeysForWindow(new Date('2026-09-10T00:00Z'), new Date('2026-09-20T00:00Z')))
      .toEqual(['202609']);
  });

  it('returns both keys when the window crosses a month boundary', () => {
    expect(monthKeysForWindow(new Date('2026-09-25T00:00Z'), new Date('2026-10-05T00:00Z')))
      .toEqual(['202609', '202610']);
  });

  it('ROLLS THE YEAR OVER — a December window reaching into January', () => {
    // Month 13 would be the bug here, and NFL weeks cross new year every season.
    expect(monthKeysForWindow(new Date('2026-12-28T00:00Z'), new Date('2027-01-04T00:00Z')))
      .toEqual(['202612', '202701']);
  });

  it('returns nothing for a reversed or unusable window', () => {
    expect(monthKeysForWindow(new Date('2026-10-05T00:00Z'), new Date('2026-09-25T00:00Z'))).toEqual([]);
    expect(monthKeysForWindow(new Date('nope'), new Date('2026-09-25T00:00Z'))).toEqual([]);
  });
});

describe('scoreboardMonthUrls', () => {
  it('builds a month URL per month, and NEVER a date range', () => {
    const urls = scoreboardMonthUrls('nfl', new Date('2026-09-25T00:00Z'), new Date('2026-10-05T00:00Z'));
    expect(urls).toEqual([
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=202609&limit=200',
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=202610&limit=200',
    ]);
    // The exact shape ESPN now rejects. If this ever matches again the page is broken.
    for (const u of urls) expect(u).not.toMatch(/dates=\d{8}-\d{8}/);
  });

  it('keeps limit at 200 by default — above 500 ESPN returns FEWER events', () => {
    // Measured 2026-09-23 on college-football/202609: limit 200/300/500 all
    // returned 323 events, limit=900 returned 25.
    const [url] = scoreboardMonthUrls('college-football', new Date('2026-09-10T00:00Z'), new Date('2026-09-12T00:00Z'));
    expect(url).toContain('/college-football/');
    expect(url).toContain('limit=200');
  });
});

describe('fetchScoreboardWindow', () => {
  it('unions both months and drops events outside the window', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      return String(url).includes('202609')
        ? ok([ev('a', '2026-09-27T17:00Z'), ev('outside', '2026-09-02T17:00Z')])
        : ok([ev('b', '2026-10-04T17:00Z'), ev('late', '2026-10-30T17:00Z')]);
    }) as unknown as typeof fetch;

    const r = await fetchScoreboardWindow<{ id: string; date: string }>(
      'nfl', new Date('2026-09-25T00:00Z'), new Date('2026-10-05T00:00Z'), fetchImpl);

    expect(calls).toHaveLength(2);
    expect(r.events.map(e => e.id)).toEqual(['a', 'b']);
    expect(r.monthsFailed).toBe(0);
  });

  it('keeps the window INCLUSIVE of its first and last day', async () => {
    const fetchImpl = (async () => ok([
      ev('firstDay', '2026-09-10T00:30Z'), ev('lastDay', '2026-09-20T23:30Z'),
      ev('dayBefore', '2026-09-09T23:30Z'),
    ])) as unknown as typeof fetch;
    const r = await fetchScoreboardWindow<{ id: string; date: string }>(
      'nfl', new Date('2026-09-10T14:00Z'), new Date('2026-09-20T14:00Z'), fetchImpl);
    expect(r.events.map(e => e.id)).toEqual(['firstDay', 'lastDay']);
  });

  it('dedupes an event returned by two months', async () => {
    const fetchImpl = (async () => ok([ev('same', '2026-09-30T17:00Z')])) as unknown as typeof fetch;
    const r = await fetchScoreboardWindow<{ id: string; date: string }>(
      'nfl', new Date('2026-09-25T00:00Z'), new Date('2026-10-05T00:00Z'), fetchImpl);
    expect(r.events).toHaveLength(1);
  });

  it('renders what it has when ONE month fails, and says so', async () => {
    const fetchImpl = (async (url: string) => (String(url).includes('202610')
      ? fail(400)
      : ok([ev('a', '2026-09-26T17:00Z')]))) as unknown as typeof fetch;
    const r = await fetchScoreboardWindow<{ id: string; date: string }>(
      'nfl', new Date('2026-09-25T00:00Z'), new Date('2026-10-05T00:00Z'), fetchImpl);
    expect(r.events.map(e => e.id)).toEqual(['a']);
    expect(r.monthsFailed).toBe(1);
    expect(r.monthsRequested).toBe(2);
  });

  it('throws only when EVERY month fails', async () => {
    const fetchImpl = (async () => fail(400)) as unknown as typeof fetch;
    await expect(fetchScoreboardWindow(
      'nfl', new Date('2026-09-25T00:00Z'), new Date('2026-10-05T00:00Z'), fetchImpl))
      .rejects.toThrow('Failed to fetch scores');
  });

  it('treats a thrown request as a failed month, not a failed run', async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).includes('202609')) throw new Error('ECONNRESET');
      return ok([ev('b', '2026-10-01T17:00Z')]);
    }) as unknown as typeof fetch;
    const r = await fetchScoreboardWindow<{ id: string; date: string }>(
      'nfl', new Date('2026-09-25T00:00Z'), new Date('2026-10-05T00:00Z'), fetchImpl);
    expect(r.events.map(e => e.id)).toEqual(['b']);
    expect(r.monthsFailed).toBe(1);
  });

  it('KEEPS an event with no usable date rather than dropping it', async () => {
    // If ESPN renames the field, a blank page is the worst possible answer for
    // a page whose whole job is showing a live game.
    const fetchImpl = (async () => ok([{ id: 'x' }, { id: 'y', date: 'not-a-date' }])) as unknown as typeof fetch;
    const r = await fetchScoreboardWindow<{ id: string; date?: string }>(
      'nfl', new Date('2026-09-10T00:00Z'), new Date('2026-09-20T00:00Z'), fetchImpl);
    expect(r.events.map(e => e.id).sort()).toEqual(['x', 'y']);
  });
});
