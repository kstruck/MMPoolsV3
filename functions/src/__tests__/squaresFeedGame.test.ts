import { describe, it, expect, vi } from 'vitest';
import {
  feedFixturesAllowed,
  fetchSquaresFeedGame,
  gameFromFixture,
  lookupSquaresGame,
  parseSquaresFeedGame,
  squaresFeedGameHasStarted,
  type FeedFetch,
} from '../lib/squaresFeedGame';

/**
 * The server's own look-up of a squares game in the score feed
 * (PLAN-SQUARES-SERVER-FIELDS §2b/§2c; plan K11).
 */
const ID = '401772510';
const KICKOFF_ISO = '2026-11-26T17:30Z';
const KICKOFF = Date.parse(KICKOFF_ISO);

/** A summary response cut down to what the score sync and this module read. */
const summary = (over: { state?: string; headerId?: string; home?: Record<string, unknown>; away?: Record<string, unknown>; date?: string; season?: unknown; week?: unknown } = {}) => ({
  header: {
    id: over.headerId ?? ID,
    season: over.season ?? { year: 2026, type: 2 },
    week: over.week ?? 13,
    competitions: [{
      date: over.date ?? KICKOFF_ISO,
      status: { type: { state: over.state ?? 'pre' } },
      competitors: [
        { homeAway: 'home', team: { displayName: 'Detroit Lions', name: 'Lions', abbreviation: 'DET', logos: [{ href: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png' }], ...over.home } },
        { homeAway: 'away', team: { displayName: 'Green Bay Packers', name: 'Packers', abbreviation: 'GB', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/gb.png', ...over.away } },
      ],
    }],
  },
});

describe('parseSquaresFeedGame', () => {
  it('reads the game: kickoff, display names (as the picker does), badges, season type and week', () => {
    expect(parseSquaresFeedGame(summary(), ID)).toEqual({
      id: ID, kickoff: KICKOFF, homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers', state: 'pre',
      homeLogo: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png',
      awayLogo: 'https://a.espncdn.com/i/teamlogos/nfl/500/gb.png',
      seasonType: '2', week: 13,
    });
  });

  it('home is home: the order comes from homeAway, not from the list', () => {
    const s = summary();
    s.header.competitions[0].competitors.reverse();
    const g = parseSquaresFeedGame(s, ID)!;
    expect(g.homeTeam).toBe('Detroit Lions');
    expect(g.awayTeam).toBe('Green Bay Packers');
  });

  it('falls back to the short name when there is no display name', () => {
    expect(parseSquaresFeedGame(summary({ home: { displayName: '' } }), ID)!.homeTeam).toBe('Lions');
  });

  it('carries the feed\'s state', () => {
    expect(parseSquaresFeedGame(summary({ state: 'in' }), ID)!.state).toBe('in');
  });

  it('is NOT a game: a missing side, no team name, no kickoff, or an answer about a different event', () => {
    const noAway = summary();
    noAway.header.competitions[0].competitors.pop();
    expect(parseSquaresFeedGame(noAway, ID)).toBeNull();
    expect(parseSquaresFeedGame(summary({ home: { displayName: '', name: '' } }), ID)).toBeNull();
    expect(parseSquaresFeedGame(summary({ date: 'not a date' }), ID)).toBeNull();
    expect(parseSquaresFeedGame(summary({ headerId: '401772511' }), ID)).toBeNull();
    expect(parseSquaresFeedGame({}, ID)).toBeNull();
    expect(parseSquaresFeedGame(null, ID)).toBeNull();
  });

  it('leaves out what it cannot read rather than failing the link', () => {
    const g = parseSquaresFeedGame(summary({ season: { type: 9 }, week: 'x', home: { logos: [] }, away: { logo: '' } }), ID)!;
    expect(g).toEqual({ id: ID, kickoff: KICKOFF, homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers', state: 'pre' });
  });
});

describe('squaresFeedGameHasStarted — by the feed OR the server clock', () => {
  it('a game the feed says is under way or over has started, whatever the clock', () => {
    expect(squaresFeedGameHasStarted({ state: 'in', kickoff: KICKOFF }, KICKOFF - 3_600_000)).toBe(true);
    expect(squaresFeedGameHasStarted({ state: 'post', kickoff: KICKOFF }, KICKOFF - 3_600_000)).toBe(true);
  });
  it('a game the feed has not started has started at its kickoff, not a moment before', () => {
    expect(squaresFeedGameHasStarted({ state: 'pre', kickoff: KICKOFF }, KICKOFF - 1)).toBe(false);
    expect(squaresFeedGameHasStarted({ state: 'pre', kickoff: KICKOFF }, KICKOFF)).toBe(true);
  });
});

const respond = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('fetchSquaresFeedGame — never throws; says which way it failed', () => {
  it('asks the summary for the event, in the league asked for', async () => {
    const f = vi.fn<FeedFetch>(async () => respond(200, summary()));
    await fetchSquaresFeedGame(ID, 'college', f);
    expect(f.mock.calls[0][0]).toBe(`https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${ID}`);
    await fetchSquaresFeedGame(ID, 'nfl', f);
    expect(f.mock.calls[1][0]).toContain('/football/nfl/summary?event=');
  });

  it('the game, when the feed has it', async () => {
    expect(await fetchSquaresFeedGame(ID, 'nfl', async () => respond(200, summary()))).toMatchObject({ id: ID, kickoff: KICKOFF });
  });

  it('"not-found": a 4xx, or an answer that is not a linkable game — not retried', async () => {
    const f = vi.fn<FeedFetch>(async () => respond(404));
    expect(await fetchSquaresFeedGame(ID, 'nfl', f)).toBe('not-found');
    expect(f).toHaveBeenCalledTimes(1);
    expect(await fetchSquaresFeedGame(ID, 'nfl', async () => respond(200, {}))).toBe('not-found');
  });

  it('"unreachable": a 5xx or a network failure, after ONE retry', async () => {
    const f5 = vi.fn<FeedFetch>(async () => respond(503));
    expect(await fetchSquaresFeedGame(ID, 'nfl', f5)).toBe('unreachable');
    expect(f5).toHaveBeenCalledTimes(2);
    const fNet = vi.fn<FeedFetch>(async () => { throw new Error('ECONNRESET'); });
    expect(await fetchSquaresFeedGame(ID, 'nfl', fNet)).toBe('unreachable');
    expect(fNet).toHaveBeenCalledTimes(2);
  });

  it('a 5xx then the game: the retry is what answers', async () => {
    const f = vi.fn<FeedFetch>().mockResolvedValueOnce(respond(502)).mockResolvedValueOnce(respond(200, summary()));
    expect(await fetchSquaresFeedGame(ID, 'nfl', f)).toMatchObject({ id: ID });
  });

  it('an id that is not digits never reaches the network — it would go into the URL', async () => {
    const f = vi.fn<FeedFetch>();
    for (const bad of ['', 'abc', '401772510/../x', '401772510?event=1', '4017725104017725100']) {
      expect(await fetchSquaresFeedGame(bad, 'nfl', f)).toBe('not-found');
    }
    expect(f).not.toHaveBeenCalled();
  });
});

describe('lookupSquaresGame — the emulator fixture is used in the emulator ONLY', () => {
  const fixture = { kickoff: KICKOFF, state: 'pre', homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers' };

  it('🛑 in a deployed function the fixture reader is never even asked, and the feed is', async () => {
    const readFixture = vi.fn(async () => fixture);
    const fetchImpl = vi.fn<FeedFetch>(async () => respond(200, summary({ state: 'in' })));
    const out = await lookupSquaresGame(ID, 'nfl', { env: {}, readFixture, fetchImpl });
    expect(readFixture).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalled();
    expect(out).toMatchObject({ state: 'in' });
  });

  it('in the emulator a fixture, when there is one, stands in for the feed', async () => {
    const fetchImpl = vi.fn<FeedFetch>();
    const out = await lookupSquaresGame(ID, 'nfl', { env: { FIRESTORE_EMULATOR_HOST: 'localhost:8080' }, readFixture: async () => fixture, fetchImpl });
    expect(out).toEqual({ id: ID, ...fixture });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('in the emulator with no fixture, the feed is asked', async () => {
    const fetchImpl = vi.fn<FeedFetch>(async () => respond(404));
    expect(await lookupSquaresGame(ID, 'nfl', { env: { FUNCTIONS_EMULATOR: 'true' }, readFixture: async () => null, fetchImpl })).toBe('not-found');
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('a fixture with no teams or kickoff is "not-found", as the feed\'s would be', async () => {
    expect(await lookupSquaresGame(ID, 'nfl', { env: { FUNCTIONS_EMULATOR: 'true' }, readFixture: async () => ({ ...fixture, homeTeam: '' }) })).toBe('not-found');
  });

  it('feedFixturesAllowed: only the variables the emulators set', () => {
    expect(feedFixturesAllowed({})).toBe(false);
    expect(feedFixturesAllowed({ FUNCTIONS_EMULATOR: 'false' })).toBe(false);
    expect(feedFixturesAllowed({ NODE_ENV: 'test' })).toBe(false);
    expect(feedFixturesAllowed({ FUNCTIONS_EMULATOR: 'true' })).toBe(true);
    expect(feedFixturesAllowed({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toBe(true);
  });

  it('gameFromFixture keeps only well-formed optional fields', () => {
    expect(gameFromFixture(ID, { ...fixture, seasonType: '7', week: 0, homeLogo: '' })).toEqual({ id: ID, ...fixture });
  });
});
