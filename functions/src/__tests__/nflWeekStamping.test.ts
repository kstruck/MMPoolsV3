import { describe, it, expect } from 'vitest';
import { eventWeekNumber, parseScoreboardResponse } from '../nflSchedule';

/**
 * A game is filed under the week ESPN says it belongs to, not the week we asked
 * for.
 *
 * ## The production defect this reproduces
 *
 * `importNFLSeason` does not query ESPN by week number. `resolveScoreboardUrl`
 * looks the week up in ESPN's own calendar and queries a DATE RANGE instead,
 * because the naive week/season/seasontype form silently falls back to the prior
 * season during the off-season.
 *
 * ESPN's preseason calendar entries OVERLAP at the boundary — measured live on
 * 2026-08-06:
 *
 *     entries[0] "Hall of Fame Weekend"  2026-08-06 .. 2026-08-13
 *     entries[1] "Preseason Week 1"      2026-08-13 .. 2026-08-20
 *
 * So the week-1 import issues `dates=20260806-20260813` and gets back SEVEN
 * events: the Hall of Fame game plus the six that ESPN itself labels week 2. The
 * parser then stamped every one of them `week: week` — the REQUESTED week — and
 * six games from the following weekend were filed into the Hall of Fame week.
 *
 * Observed in production: season 2026 seasonType 1 held week1=7 and week2=10
 * where the truth is 1 and 16. A commissioner's HOF pool asked members to pick
 * seven games, six of which would not kick off for another week, and the week
 * could not score cleanly because those six could never be final in time.
 *
 * Every calendar boundary overlaps, so this was not a one-off.
 *
 * The fix trusts `event.week.number`, matching what `eventMatchesSeason`
 * directly above it already did for season and seasonType — that function
 * trusted ESPN over our own arguments; the week did not, and that inconsistency
 * was the bug.
 */

const T = (abbr: string) => ({ id: abbr, abbreviation: abbr, name: abbr, displayName: abbr });

function event(id: string, espnWeek: number | undefined, date: string, away: string, home: string) {
  return {
    id,
    date,
    ...(espnWeek === undefined ? {} : { week: { number: espnWeek } }),
    season: { year: 2026, type: 1 },
    status: { type: { state: 'pre', name: 'STATUS_SCHEDULED' }, displayClock: '0:00', period: 0 },
    competitions: [{
      competitors: [
        { homeAway: 'home', team: T(home), score: null },
        { homeAway: 'away', team: T(away), score: null },
      ],
    }],
  };
}

/** The real 2026 HOF-window payload, in shape: 1 week-1 event + 6 week-2 events. */
const HOF_WINDOW = {
  events: [
    event('401873271', 1, '2026-08-07T00:00Z', 'CAR', 'ARI'),
    event('401873272', 2, '2026-08-13T23:00Z', 'DET', 'CIN'),
    event('401873275', 2, '2026-08-13T23:00Z', 'GB', 'PIT'),
    event('401873273', 2, '2026-08-13T23:30Z', 'IND', 'NE'),
    event('401873274', 2, '2026-08-14T00:00Z', 'LAC', 'HOU'),
    event('401873640', 2, '2026-08-14T00:00Z', 'ARI', 'LV'),
    event('401874392', 2, '2026-08-14T01:00Z', 'TEN', 'SF'),
  ],
};

describe('eventWeekNumber', () => {
  it("uses ESPN's week when present, even though we asked for another", () => {
    expect(eventWeekNumber({ week: { number: 2 } }, 1)).toBe(2);
  });

  it('falls back to the requested week when ESPN omits it', () => {
    // Fail-OPEN on a missing field, exactly like eventMatchesSeason. Degrading
    // to the old behaviour beats importing games with an undefined week.
    expect(eventWeekNumber({}, 3)).toBe(3);
    expect(eventWeekNumber(undefined, 3)).toBe(3);
    expect(eventWeekNumber(null, 3)).toBe(3);
    expect(eventWeekNumber({ week: {} }, 3)).toBe(3);
  });

  it('falls back on a non-numeric or nonsensical week rather than storing it', () => {
    // A week of 0 or NaN matches no pool slate, so the pool renders empty —
    // the same shape as the seasonType NaN bug in #319.
    expect(eventWeekNumber({ week: { number: 'wk2' as unknown as number } }, 5)).toBe(5);
    expect(eventWeekNumber({ week: { number: 0 } }, 5)).toBe(5);
    expect(eventWeekNumber({ week: { number: -1 } }, 5)).toBe(5);
  });

  it('accepts a numeric string, which is how ESPN sometimes sends it', () => {
    expect(eventWeekNumber({ week: { number: '2' as unknown as number } }, 1)).toBe(2);
  });
});

describe('parseScoreboardResponse — the HOF-window regression', () => {
  const games = parseScoreboardResponse(HOF_WINDOW, 1, '2026', 1);

  it('files the seven returned events into the weeks ESPN assigned', () => {
    expect(games).toHaveLength(7);
    const byWeek = games.reduce<Record<number, string[]>>((acc, g) => {
      (acc[g.week] ||= []).push(g.id);
      return acc;
    }, {});
    expect(Object.keys(byWeek).sort()).toEqual(['1', '2']);
    expect(byWeek[1]).toEqual(['espn_401873271']);
    expect(byWeek[2]).toHaveLength(6);
  });

  it('puts ONLY the Hall of Fame game in week 1 — the actual bug', () => {
    // Before the fix all seven came back week 1, and that is precisely what a
    // commissioner saw on the pick sheet.
    const week1 = games.filter(g => g.week === 1);
    expect(week1).toHaveLength(1);
    expect(week1[0].awayTeam.abbreviation).toBe('CAR');
    expect(week1[0].homeTeam.abbreviation).toBe('ARI');
  });

  it('never files a team twice in one week', () => {
    // ARI plays CAR in week 1 and LV in week 2. Both landing in week 1 is what
    // made the defect visible — a team cannot play twice in a week.
    for (const wk of [1, 2]) {
      const teams = games.filter(g => g.week === wk)
        .flatMap(g => [g.homeTeam.abbreviation, g.awayTeam.abbreviation]);
      expect(new Set(teams).size, `week ${wk} has a duplicate team`).toBe(teams.length);
    }
  });

  it('still stamps the requested week when ESPN sends no week at all', () => {
    const noWeek = { events: [event('401873271', undefined, '2026-08-07T00:00Z', 'CAR', 'ARI')] };
    expect(parseScoreboardResponse(noWeek, 4, '2026', 1)[0].week).toBe(4);
  });

  it('leaves season and seasonType stamped from the request, as before', () => {
    // Those are validated separately by eventMatchesSeason; this change is
    // deliberately scoped to `week` and must not disturb them.
    expect(games.every(g => g.season === '2026')).toBe(true);
    expect(games.every(g => g.seasonType === 1)).toBe(true);
  });
});
