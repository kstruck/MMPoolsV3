import { describe, it, expect, vi, afterEach } from 'vitest';
import { espnDateParam, fetchGamesOn, hasStarted, mapScoreboard, scheduleUrl } from './espnSchedule';

/**
 * The squares wizard's game picker reads ESPN's scoreboard by DATE. What is
 * pinned here is the part a wrong answer would cost money on: the game id and
 * kickoff a pool is linked with, and which team is home — the home digit is the
 * grid's COLUMN.
 */

const team = (id: string, name: string, abbr: string) => ({
  id, displayName: name, name: name.split(' ').pop(), abbreviation: abbr,
  logo: `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png`,
});

const event = (over: Record<string, unknown> = {}) => ({
  id: '401772510',
  date: '2026-11-26T18:00Z',
  season: { year: 2026, type: 2 },
  week: { number: 12 },
  status: { type: { state: 'pre' } },
  competitions: [{
    date: '2026-11-26T18:00Z',
    competitors: [
      { homeAway: 'home', team: team('8', 'Detroit Lions', 'DET') },
      { homeAway: 'away', team: team('9', 'Green Bay Packers', 'GB') },
    ],
  }],
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('espnDateParam', () => {
  it('turns a date input value into ESPN\'s form', () => {
    expect(espnDateParam('2026-11-26')).toBe('20261126');
    expect(espnDateParam(' 2026-01-03 ')).toBe('20260103');
  });

  it.each(['', '2026-11', '11/26/2026', '20261126', '2026-13-01', '2026-02-31', '2026-00-10', 'tomorrow'])(
    'refuses %s',
    (v) => expect(espnDateParam(v)).toBeNull(),
  );
});

describe('scheduleUrl', () => {
  it('asks the NFL scoreboard for that day', () => {
    expect(scheduleUrl('nfl', '2026-11-26')).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261126',
    );
  });

  it('asks for every FBS game, not the default top-25 slice', () => {
    expect(scheduleUrl('college', '2026-11-27')).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20261127&groups=80&limit=200',
    );
  });

  it('is null for something that is not a date', () => {
    expect(scheduleUrl('nfl', 'soon')).toBeNull();
  });
});

describe('mapScoreboard', () => {
  it('reads the id, the kickoff and which side is home', () => {
    const [g] = mapScoreboard({ events: [event()] });
    expect(g).toEqual({
      id: '401772510',
      kickoff: Date.UTC(2026, 10, 26, 18, 0),
      homeTeam: 'Detroit Lions',
      awayTeam: 'Green Bay Packers',
      homeAbbr: 'DET',
      awayAbbr: 'GB',
      homeLogo: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png',
      awayLogo: 'https://a.espncdn.com/i/teamlogos/nfl/500/gb.png',
      seasonType: '2',
      week: 12,
      state: 'pre',
    });
  });

  it('goes by homeAway, not by the order the feed lists the two teams in', () => {
    const flipped = event();
    (flipped.competitions[0].competitors as unknown[]).reverse();
    const [g] = mapScoreboard({ events: [flipped] });
    expect(g.homeTeam).toBe('Detroit Lions');
    expect(g.awayTeam).toBe('Green Bay Packers');
  });

  it('lists the day earliest kickoff first', () => {
    const games = mapScoreboard({
      events: [
        event({ id: 'night', date: '2026-11-27T01:20Z' }),
        event({ id: 'early', date: '2026-11-26T18:00Z' }),
        event({ id: 'mid', date: '2026-11-26T21:30Z' }),
      ],
    });
    expect(games.map((g) => g.id)).toEqual(['early', 'mid', 'night']);
  });

  it('leaves out a game it cannot fully read, rather than offering half a link', () => {
    const noHome = event({ id: 'a' });
    (noHome.competitions[0].competitors as unknown[]).shift();
    const games = mapScoreboard({
      events: [
        noHome,
        event({ id: '' }),
        event({ id: 'b', date: 'not a date', competitions: [{ competitors: event().competitions[0].competitors }] }),
        event({ id: 'c', competitions: [] }),
        event({ id: 'd', competitions: undefined }),
        null,
        'x',
        event({ id: 'good' }),
      ],
    });
    expect(games.map((g) => g.id)).toEqual(['good']);
  });

  it('falls back to the competition date and the short team name', () => {
    const e = event({ date: undefined });
    (e.competitions[0].competitors[0].team as Record<string, unknown>).displayName = undefined;
    const [g] = mapScoreboard({ events: [e] });
    expect(g.kickoff).toBe(Date.UTC(2026, 10, 26, 18, 0));
    expect(g.homeTeam).toBe('Lions');
  });

  it('omits a season type or week it does not recognise', () => {
    const [g] = mapScoreboard({ events: [event({ season: { type: 4 }, week: {} })] });
    expect('seasonType' in g).toBe(false);
    expect('week' in g).toBe(false);
  });

  it('reports a game in progress or finished', () => {
    const [live] = mapScoreboard({ events: [event({ status: { type: { state: 'in' } } })] });
    expect(live.state).toBe('in');
    const [done] = mapScoreboard({ events: [event({ status: { type: { state: 'post' } } })] });
    expect(done.state).toBe('post');
  });

  it.each([null, undefined, 'x', 7, {}, { events: 'x' }, { events: null }])('is empty for a payload of %s', (payload) => {
    expect(mapScoreboard(payload)).toEqual([]);
  });
});

describe('hasStarted — a game that has kicked off cannot take a new pool', () => {
  const kickoff = Date.UTC(2026, 10, 26, 18, 0);

  it('not started before kickoff while the feed says pre', () => {
    expect(hasStarted({ state: 'pre', kickoff }, kickoff - 1)).toBe(false);
  });

  it('started the moment kickoff arrives, even if the feed still says pre', () => {
    expect(hasStarted({ state: 'pre', kickoff }, kickoff)).toBe(true);
    expect(hasStarted({ state: 'pre', kickoff }, kickoff + 60_000)).toBe(true);
  });

  it('started when the feed says so, even ahead of the clock', () => {
    expect(hasStarted({ state: 'in', kickoff }, kickoff - 60_000)).toBe(true);
    expect(hasStarted({ state: 'post', kickoff }, kickoff - 60_000)).toBe(true);
  });
});

describe('fetchGamesOn', () => {
  it('fetches that day\'s scoreboard and maps it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ events: [event()] }) });
    vi.stubGlobal('fetch', fetchMock);
    const games = await fetchGamesOn('nfl', '2026-11-26');
    expect(fetchMock).toHaveBeenCalledWith('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261126');
    expect(games.map((g) => g.id)).toEqual(['401772510']);
  });

  it('throws on a bad date without calling out', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchGamesOn('nfl', '')).rejects.toThrow('Pick a date first.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when ESPN answers with an error — an empty list would read as "no games that day"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    await expect(fetchGamesOn('nfl', '2026-11-26')).rejects.toThrow(/could not be loaded/);
  });
});
