import { describe, it, expect } from 'vitest';
import {
  monthKeysForWindow, scoreboardMonthUrls, fetchScoreboardWindow,
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
