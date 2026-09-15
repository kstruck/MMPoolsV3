import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveScoreboardUrls, fetchNFLWeekSchedule, fetchNFLWeekScheduleWithRaw } from '../nflSchedule';

/**
 * The ESPN date-RANGE outage of 2026-09-15, and the fallback that survives it.
 *
 * WHAT HAPPENED. `resolveScoreboardUrls` prefers a `dates=YYYYMMDD-YYYYMMDD` URL
 * built from ESPN's own calendar, because the naive week/season/seasontype form
 * ignores `season` and serves the CURRENT season during the off-season. At
 * 2026-09-15T21:55Z ESPN began answering EVERY date-range request with
 * `{"code":400,"message":"Failed to get events endpoint."}` — measured host-wide
 * (mens-college-basketball too) and for 2025 dates as well, so it is an API
 * change and not our data. `syncNFLScoresJob` went dark about two hours before a
 * Monday-night kickoff, reporting `1 slate(s) returned no games`.
 *
 * WHY THESE TESTS AND NOT A MOCK OF THE WHOLE JOB. The failure was entirely
 * inside URL resolution + fetch: everything downstream behaved correctly, which
 * is why the heartbeat fired at all. So the guard belongs at the same level —
 * the fetch tries each candidate in ORDER and a 400 on the first one must not
 * end the run.
 */

const CAL = {
  leagues: [{
    calendar: [{
      value: '2',
      entries: [{ startDate: '2026-09-06T07:00Z', endDate: '2026-09-16T06:59Z' }],
    }],
  }],
};

const DATES_URL = 'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20260906-20260916';
const WEEK_URL = 'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=1&season=2026&seasontype=2';

/** One valid regular-season event, enough for parseScoreboardResponse to emit a game. */
const PAYLOAD = {
  events: [{
    id: '401872656',
    date: '2026-09-13T17:00Z',
    season: { year: 2026, type: 2 },
    week: { number: 1 },
    status: { type: { state: 'pre', name: 'STATUS_SCHEDULED' } },
    competitions: [{
      date: '2026-09-13T17:00Z',
      competitors: [
        { homeAway: 'home', team: { abbreviation: 'SEA', displayName: 'Seattle Seahawks' }, score: '0' },
        { homeAway: 'away', team: { abbreviation: 'NE', displayName: 'New England Patriots' }, score: '0' },
      ],
    }],
  }],
};

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number) => ({ ok: false, status, json: async () => ({ code: status }) });

/** Route by URL so the order the code tries them in is what is asserted. */
function routeFetch(handler: (url: string) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => handler(String(url))));
}

describe('resolveScoreboardUrls — ordered candidates', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('puts the calendar date-range URL FIRST and keeps the week URL as fallback', async () => {
    routeFetch(() => ok(CAL));
    expect(await resolveScoreboardUrls(1, '2026', 2)).toEqual([DATES_URL, WEEK_URL]);
  });

  it('returns the week URL alone when the calendar lookup fails', async () => {
    routeFetch(() => fail(500));
    expect(await resolveScoreboardUrls(1, '2026', 2)).toEqual([WEEK_URL]);
  });

  it('returns the week URL alone when the calendar has no entry for that week', async () => {
    routeFetch(() => ok({ leagues: [{ calendar: [{ value: '2', entries: [] }] }] }));
    expect(await resolveScoreboardUrls(1, '2026', 2)).toEqual([WEEK_URL]);
  });

  it('never returns the week URL twice — one candidate, not a duplicate retry', async () => {
    routeFetch(() => ok({}));
    const urls = await resolveScoreboardUrls(1, '2026', 2);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('the fetchers fall back past a 400 on the date-range URL', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  /** Exactly the live outage: calendar fine, range 400, week form healthy. */
  const outage = (url: string) => {
    if (url.includes('dates=')) return fail(400);
    if (url.includes('week=')) return ok(PAYLOAD);
    return ok(CAL);
  };

  it('fetchNFLWeekSchedule returns the slate instead of an empty array', async () => {
    routeFetch(outage);
    const games = await fetchNFLWeekSchedule(1, '2026', 2);
    expect(games.map(g => g.id)).toEqual(['espn_401872656']);
  });

  it('fetchNFLWeekScheduleWithRaw returns games AND a non-null raw payload', async () => {
    routeFetch(outage);
    const { games, raw } = await fetchNFLWeekScheduleWithRaw(1, '2026', 2);
    expect(games).toHaveLength(1);
    // raw null is the "feed is down" signal the snapshot writer keys on; a
    // successful fallback must not look like an outage to it.
    expect(raw).not.toBeNull();
  });

  it('tries the range URL FIRST — the fallback does not replace the calendar', async () => {
    const seen: string[] = [];
    routeFetch((url) => { seen.push(url); return outage(url); });
    await fetchNFLWeekScheduleWithRaw(1, '2026', 2);
    expect(seen.filter(u => u.includes('scoreboard?dates=') || u.includes('week='))).toEqual([DATES_URL, WEEK_URL]);
  });

  it('still reports an empty slate when EVERY candidate fails — no silent success', async () => {
    routeFetch((url) => (url.includes('season=2026') && !url.includes('week=') ? ok(CAL) : fail(400)));
    const { games, raw } = await fetchNFLWeekScheduleWithRaw(1, '2026', 2);
    expect(games).toEqual([]);
    expect(raw).toBeNull();
  });

  it('falls back when the range URL THROWS instead of answering', async () => {
    // A reset socket or an unparseable body rejects rather than returning a
    // status. Before the per-candidate catch that ended the run at the first URL.
    routeFetch((url) => {
      if (url.includes('scoreboard?dates=')) throw new Error('ECONNRESET');
      if (url.includes('week=')) return ok(PAYLOAD);
      return ok(CAL);
    });
    const { games } = await fetchNFLWeekScheduleWithRaw(1, '2026', 2);
    expect(games).toHaveLength(1);
  });

  it('does not call the fallback when the range URL succeeds', async () => {
    const seen: string[] = [];
    routeFetch((url) => { seen.push(url); return url.includes('dates=') ? ok(PAYLOAD) : ok(CAL); });
    await fetchNFLWeekScheduleWithRaw(1, '2026', 2);
    expect(seen.some(u => u.includes('week='))).toBe(false);
  });
});

/**
 * HTTP 200 is not acceptance (qodo #3), and the season-ignoring week URL must
 * prove its season (qodo #2).
 */
describe('a 200 that says nothing about this slate is not an answer', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  /** Week 2 events returned by the week-1 fetch — the overlapping-calendar shape. */
  const SPILLOVER = {
    events: [{ ...PAYLOAD.events[0], id: '401872999', week: { number: 2 } }],
  };

  it('falls through an empty 200 envelope to the healthy week URL', async () => {
    routeFetch((url) => {
      if (url.includes('scoreboard?dates=')) return ok({ events: [] });
      if (url.includes('week=')) return ok(PAYLOAD);
      return ok(CAL);
    });
    const { games } = await fetchNFLWeekScheduleWithRaw(1, '2026', 2);
    expect(games.map(g => g.id)).toEqual(['espn_401872656']);
  });

  it('falls through a SPILLOVER-ONLY 200 to the healthy week URL', async () => {
    routeFetch((url) => {
      if (url.includes('scoreboard?dates=')) return ok(SPILLOVER);
      if (url.includes('week=')) return ok(PAYLOAD);
      return ok(CAL);
    });
    const { games } = await fetchNFLWeekScheduleWithRaw(1, '2026', 2);
    expect(games.map(g => g.id)).toEqual(['espn_401872656']);
  });

  it('REFUSES a week-URL payload that cannot prove its season', async () => {
    // The corruption path: the week URL ignores `season`, `eventMatchesSeason`
    // fails open on an absent field, and the parser would relabel these as 2026
    // week 1 — enough for importNFLSeason to mark the week fetched and let the
    // orphan sweep delete the real games.
    const NO_SEASON = { events: [{ ...PAYLOAD.events[0], season: undefined, week: undefined }] };
    routeFetch((url) => {
      if (url.includes('scoreboard?dates=')) return fail(400);
      if (url.includes('week=')) return ok(NO_SEASON);
      return ok(CAL);
    });
    const { games, raw } = await fetchNFLWeekScheduleWithRaw(1, '2026', 2);
    expect(games).toEqual([]);
    // Refused, not merely unpreferred — it must never reach the caller.
    expect(raw).toBeNull();
  });

  it('REFUSES a week-URL payload proving a DIFFERENT season', async () => {
    const OTHER = { events: [{ ...PAYLOAD.events[0], season: { year: 2025, type: 2 } }] };
    routeFetch((url) => {
      if (url.includes('scoreboard?dates=')) return fail(400);
      if (url.includes('week=')) return ok(OTHER);
      return ok(CAL);
    });
    const { games, raw } = await fetchNFLWeekScheduleWithRaw(1, '2026', 2);
    expect(games).toEqual([]);
    expect(raw).toBeNull();
  });

  it('accepts an unusable-but-OK payload once nothing better exists', async () => {
    // An empty week is real information downstream — slatesNotReconciled, and
    // the spillover games still get written. Reporting it as a feed outage
    // (raw: null) would be a different and wrong claim.
    routeFetch((url) => {
      if (url.includes('scoreboard?dates=')) return ok({ events: [] });
      if (url.includes('week=')) return fail(500);
      return ok(CAL);
    });
    const { games, raw } = await fetchNFLWeekScheduleWithRaw(1, '2026', 2);
    expect(games).toEqual([]);
    expect(raw).not.toBeNull();
  });
});
