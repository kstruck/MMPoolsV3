import { describe, it, expect, vi } from 'vitest';

// `nflPending` imports the server clock, which imports `src/firebase.ts`, which
// touches `self` at module load and throws under vitest's node environment.
// Neither function under test reads the clock, so stubbing the module keeps
// Firebase out of the import graph entirely.
vi.mock('./serverClock', () => ({ now: () => 0 }));

import { gamesForPoolWeek, poolSeasonType, currentSlateWeek, poolSeasonWeeks, isWeekLockedNow, getWeekStatus, weekDeadline, isWeekComplete, weekLockCaption } from './nflPending';
import type { NFLGame } from '../types';

/**
 * The season-type filter is the rule that keeps preseason week 1 (HOF Weekend)
 * and regular-season week 1 apart. Both match `g.week === 1`, so week alone is
 * ambiguous, and the manager's "every game is final" gate for Score & Recap
 * counts the filtered set. These are the cases that fail if the rule breaks.
 */

const game = (id: string, week: number, seasonType: 1 | 2 | 3): NFLGame => ({
    id,
    espnGameId: id,
    week,
    season: '2026',
    seasonType,
    homeTeam: { id: 'h', name: 'Home', abbreviation: 'HOM' },
    awayTeam: { id: 'a', name: 'Away', abbreviation: 'AWY' },
    startTime: 1_000,
    status: 'SCHEDULED',
} as NFLGame);

// HOF Weekend and the regular-season opener collide on week 1.
const SCHEDULE: NFLGame[] = [
    game('pre1', 1, 1),
    game('pre2', 2, 1),
    game('reg1a', 1, 2),
    game('reg1b', 1, 2),
];

describe('poolSeasonType', () => {
    it('reads an explicit season type, as a number, from either a number or a string', () => {
        expect(poolSeasonType({ seasonType: 1 })).toBe(1);
        expect(poolSeasonType({ seasonType: '1' })).toBe(1);
        expect(poolSeasonType({ seasonType: 3 })).toBe(3);
    });

    it('defaults an unset season type to REGULAR (2), never NaN', () => {
        // `shared/schemas/nfl.ts` states the contract: omitting seasonType means
        // regular season. Bare Number(undefined) is NaN, which equals no game's
        // season type and would empty the whole schedule.
        expect(poolSeasonType({})).toBe(2);
        expect(poolSeasonType({ seasonType: undefined })).toBe(2);
        expect(poolSeasonType(null)).toBe(2);
        expect(Number.isNaN(poolSeasonType({}))).toBe(false);
    });
});

describe('gamesForPoolWeek', () => {
    it('does not leak regular-season week 1 into a PRESEASON pool week 1', () => {
        const ids = gamesForPoolWeek(SCHEDULE, { seasonType: 1 }, 1).map(g => g.id);
        expect(ids).toEqual(['pre1']);
    });

    it('does not leak preseason week 1 into a REGULAR-season pool week 1', () => {
        const ids = gamesForPoolWeek(SCHEDULE, { seasonType: 2 }, 1).map(g => g.id);
        expect(ids).toEqual(['reg1a', 'reg1b']);
    });

    it('treats a pool with no seasonType as regular season, not as having no games', () => {
        const ids = gamesForPoolWeek(SCHEDULE, {}, 1).map(g => g.id);
        expect(ids).toEqual(['reg1a', 'reg1b']);
    });

    it('returns an empty set for a week the pool season type has no games in', () => {
        expect(gamesForPoolWeek(SCHEDULE, { seasonType: 2 }, 2)).toEqual([]);
    });

    it('returns a new array, so callers may sort the result in place', () => {
        const out = gamesForPoolWeek(SCHEDULE, { seasonType: 2 }, 1);
        out.sort((a, b) => (a.id < b.id ? 1 : -1));
        expect(SCHEDULE.map(g => g.id)).toEqual(['pre1', 'pre2', 'reg1a', 'reg1b']);
    });
});

describe('currentSlateWeek', () => {
    const finished = (g: NFLGame): NFLGame => ({ ...g, status: 'FINAL' });

    // The reported defect: HOF Weekend (preseason week 1, one game) had finished,
    // and the dashboard still opened on it because the calendar week had not ticked.
    it('skips a fully FINAL week and lands on the next week with a game to play', () => {
        const slate = [finished(game('pre1', 1, 1)), game('pre2', 2, 1)];
        expect(currentSlateWeek(slate, { seasonType: 1 })).toBe(2);
    });

    it('stays on a week that still has an unplayed game, even if some are FINAL', () => {
        const slate = [
            finished(game('pre2a', 2, 1)),
            game('pre2b', 2, 1),
            game('pre3', 3, 1),
        ];
        expect(currentSlateWeek(slate, { seasonType: 1 })).toBe(2);
    });

    it('counts only the pool season type, so a live regular-season week cannot pull a preseason pool forward', () => {
        const slate = [finished(game('pre1', 1, 1)), game('reg1', 1, 2)];
        expect(currentSlateWeek(slate, { seasonType: 1 })).toBe(1); // all preseason final -> last week
        expect(currentSlateWeek(slate, { seasonType: 2 })).toBe(1);
    });

    it('lands on the LAST week once every game of the season type is FINAL', () => {
        const slate = [finished(game('pre1', 1, 1)), finished(game('pre2', 2, 1))];
        expect(currentSlateWeek(slate, { seasonType: 1 })).toBe(2);
    });

    // codex r1: CANCELLED is terminal too — a week of only cancelled games can
    // never be entered, so treating it as open parks the dashboard on it.
    it('treats CANCELLED as terminal, not as a game still to play', () => {
        const cancelled = (g: NFLGame): NFLGame => ({ ...g, status: 'CANCELLED' });
        const slate = [
            finished(game('pre1', 1, 1)),
            cancelled(game('pre2', 2, 1)),
            game('pre3', 3, 1),
        ];
        expect(currentSlateWeek(slate, { seasonType: 1 })).toBe(3);
    });

    it('returns null when nothing is loaded for the season type, so callers keep their estimate', () => {
        expect(currentSlateWeek([], { seasonType: 1 })).toBeNull();
        expect(currentSlateWeek(SCHEDULE, { seasonType: 3 })).toBeNull();
    });

    it('treats an unset pool seasonType as regular season', () => {
        expect(currentSlateWeek(SCHEDULE, {})).toBe(1);
    });

    it('picks the lowest open week regardless of document order', () => {
        const slate = [game('pre3', 3, 1), game('pre2', 2, 1)];
        expect(currentSlateWeek(slate, { seasonType: 1 })).toBe(2);
    });
});

/**
 * The week columns of the Season Summary / Margin Summary grids come from here.
 * The obvious `1..18` is wrong twice — a preseason pool runs four weeks, and a
 * regular-season length is the schedule's fact, not a constant.
 */
describe('poolSeasonWeeks', () => {
    it('derives the weeks from the schedule, ascending, deduped', () => {
        const slate = [game('r3', 3, 2), game('r1a', 1, 2), game('r1b', 1, 2), game('r2', 2, 2)];
        expect(poolSeasonWeeks(slate, { seasonType: 2 })).toEqual([1, 2, 3]);
    });

    it("gives a preseason pool only its own weeks, never the regular season's", () => {
        expect(poolSeasonWeeks(SCHEDULE, { seasonType: 1 })).toEqual([1, 2]);
    });

    it('treats an unset pool seasonType as regular season, matching poolSeasonType', () => {
        expect(poolSeasonWeeks(SCHEDULE, {})).toEqual([1]);
    });

    it('is empty while the schedule is still loading, so the grid renders empty rather than fabricated', () => {
        expect(poolSeasonWeeks([], { seasonType: 2 })).toEqual([]);
        expect(poolSeasonWeeks(SCHEDULE, { seasonType: 3 })).toEqual([]);
    });
});

/**
 * The picks-CTA lock (item 8). `serverClock.now` is mocked to 0 above, so a
 * kickoff at t=1000 with a 5-minute buffer is in the future and the week is
 * open; a kickoff in the past is locked. The override is a commissioner's
 * `extendWeekDeadline`, which the server applies with Math.max on Pick'em.
 */
describe('isWeekLockedNow', () => {
    const at = (id: string, startTime: number) => ({ ...game(id, 1, 2), startTime } as NFLGame);
    it('empty slate is never locked', () => {
        expect(isWeekLockedNow([], 5)).toBe(false);
    });
    it('WEEKLY locks at the FIRST kickoff, PER_GAME at the LAST', () => {
        const slate = [at('a', -10_000_000), at('b', 10_000_000)]; // one past, one future
        expect(isWeekLockedNow(slate, 0, 'WEEKLY')).toBe(true);
        expect(isWeekLockedNow(slate, 0, 'PER_GAME')).toBe(false);
    });
    it('a commissioner extension pushes the deadline later (Math.max, never earlier)', () => {
        const slate = [at('a', -10_000_000)]; // kicked off long ago
        expect(isWeekLockedNow(slate, 0, 'PER_GAME')).toBe(true);
        expect(isWeekLockedNow(slate, 0, 'PER_GAME', 60_000)).toBe(false); // extended to t=60s, now is 0
        // An override EARLIER than the natural deadline changes nothing.
        const future = [at('b', 10_000_000)];
        expect(isWeekLockedNow(future, 0, 'PER_GAME', -1)).toBe(false);
    });
});

/**
 * The week checklist and the "picks due" CTA shared the pick sheet's defect.
 *
 * `getWeekStatus` marked a week `missed` once the EARLIEST kickoff passed, so a
 * per-game pool told a member the week was missed while their Sunday picks were
 * still open and the sheet still accepted them. Same bug, different surface;
 * found by self-review after the sheet was fixed. The stubbed clock is t=0, so
 * a negative kickoff is in the past.
 */
describe('getWeekStatus follows the pool lock mode', () => {
    const at = (id: string, startTime: number) => ({ ...game(id, 1, 2), startTime } as NFLGame);
    // One game kicked off, one still to come.
    const slate = [at('thu', -10_000_000), at('sun', 10_000_000)];

    it('a per-game week is still DUE after the first kickoff', () => {
        expect(getWeekStatus('NFL_PICKEM', null, slate, 1, 0, 'PER_GAME')).toBe('due');
        // The discriminator: the same slate read as WEEKLY is already missed, so
        // this does not pass merely because the clock is early.
        expect(getWeekStatus('NFL_PICKEM', null, slate, 1, 0, 'WEEKLY')).toBe('missed');
    });

    it('a per-game week is missed once its LAST game has started', () => {
        const allStarted = [at('thu', -10_000_000), at('sun', -1_000)];
        expect(getWeekStatus('NFL_PICKEM', null, allStarted, 1, 0, 'PER_GAME')).toBe('missed');
    });

    it('defaults to WEEKLY, so an un-migrated caller keeps its old reading', () => {
        expect(getWeekStatus('NFL_PICKEM', null, slate, 1, 0)).toBe('missed');
    });
});

describe('weekDeadline follows the pool lock mode', () => {
    const at = (id: string, startTime: number) => ({ ...game(id, 1, 2), startTime } as NFLGame);
    const slate = [at('thu', 1_000), at('sun', 9_000)];

    it('is the LAST kickoff on per-game and the FIRST on weekly', () => {
        expect(weekDeadline(slate, 0, 'PER_GAME')).toBe(9_000);
        expect(weekDeadline(slate, 0, 'WEEKLY')).toBe(1_000);
    });

    it('defaults to WEEKLY', () => {
        expect(weekDeadline(slate, 0)).toBe(1_000);
    });

    it('is null for an empty slate', () => {
        expect(weekDeadline([], 0, 'PER_GAME')).toBeNull();
    });
});

/**
 * The two halves the lock-mode fix left behind, both found by qodo on #482.
 *
 * Fixing the pick sheet without these left the checklist contradicting it: an
 * extended week still read as missed at the ORIGINAL deadline, and a member who
 * had saved every pick they could still make was told to "Make Picks" forever
 * because completion counted a game they were never able to answer.
 */
describe('week status honours a commissioner extension', () => {
    const at = (id: string, startTime: number) => ({ ...game(id, 1, 2), startTime } as NFLGame);
    // Both kicked off; without an extension the week is over on any reading.
    const slate = [at('thu', -10_000_000), at('sun', -1_000)];

    it('an extended week is still DUE past its original deadline', () => {
        // Clock is stubbed at 0; the extension runs to t=60s.
        expect(getWeekStatus('NFL_PICKEM', null, slate, 1, 0, 'PER_GAME')).toBe('missed');
        expect(getWeekStatus('NFL_PICKEM', null, slate, 1, 0, 'PER_GAME', 60_000)).toBe('due');
    });

    it('the deadline shown moves with it, and only ever later', () => {
        expect(weekDeadline(slate, 0, 'PER_GAME', 60_000)).toBe(60_000);
        // An override EARLIER than the natural deadline changes nothing.
        expect(weekDeadline(slate, 0, 'PER_GAME', -9_999_999)).toBe(-1_000);
    });
});

describe('a week is complete once nothing pickable is left', () => {
    const at = (id: string, startTime: number) => ({ ...game(id, 1, 2), startTime } as NFLGame);
    const slate = [at('thu', -10_000_000), at('sun', 10_000_000)];
    // Missed Thursday entirely; picked the Sunday game that is still open.
    const entry = { picks: { sun: 'BUF' } };

    it('does not count a game the member can no longer pick', () => {
        const closed = (g: NFLGame) => g.id === 'thu';
        expect(isWeekComplete('NFL_PICKEM', entry, slate, 1, closed)).toBe(true);
        // Without that knowledge it reads incomplete — which is the old
        // behaviour, and why "Make Picks" never went away.
        expect(isWeekComplete('NFL_PICKEM', entry, slate, 1)).toBe(false);
    });

    it('still reports incomplete while an OPEN game is unpicked', () => {
        const closed = (g: NFLGame) => g.id === 'thu';
        expect(isWeekComplete('NFL_PICKEM', { picks: {} }, slate, 1, closed)).toBe(false);
    });

    /**
     * The over-correction, caught by codex on the fix for qodo #10.
     *
     * Exempting every closed game turns a WHOLLY missed slate into "picks
     * submitted" the moment the last game kicks off — the checklist would tell
     * a member who never played that their picks are in. The exemption is for a
     * PARTIALLY answered week, which is the case it was written for.
     */
    it('a member who answered NOTHING has not completed the week', () => {
        const allClosed = () => true;
        expect(isWeekComplete('NFL_PICKEM', { picks: {} }, slate, 1, allClosed)).toBe(false);
        // …while one answer plus closed remainder IS complete, so the rule is
        // "answered something", not "closed games never count".
        expect(isWeekComplete('NFL_PICKEM', { picks: { sun: 'BUF' } }, slate, 1, allClosed)).toBe(true);
    });

    it('a fully locked, wholly unanswered week reads as missed end to end', () => {
        const bothStarted = [at('thu', -10_000_000), at('sun', -1_000)];
        expect(getWeekStatus('NFL_PICKEM', { picks: {} }, bothStarted, 1, 0, 'PER_GAME')).toBe('missed');
    });

    it('the checklist stops nagging once the open games are saved', () => {
        // End to end through getWeekStatus, which derives `closed` itself.
        expect(getWeekStatus('NFL_PICKEM', entry, slate, 1, 0, 'PER_GAME')).toBe('complete');
        expect(getWeekStatus('NFL_PICKEM', { picks: {} }, slate, 1, 0, 'PER_GAME')).toBe('due');
    });
});

describe('weekLockCaption — the checklist must say WHICH lock its timestamp is', () => {
    it('a weekly pool locks the whole sheet at one moment', () => {
        expect(weekLockCaption('WEEKLY', 'Sun, Aug 23 · 5:55 PM MDT'))
            .toBe('locks Sun, Aug 23 · 5:55 PM MDT');
    });

    it('a per-game pool says the timestamp is only the LAST game', () => {
        // ⚠️ The defect this guards: `weekDeadline` returns the LATEST
        // kickoff in PER_GAME mode, so "locks Sun, Aug 23" told a member with a
        // Friday pick that nothing shut until Sunday evening. Their Friday pick
        // froze on Friday. (Kevin's live test, 2026-08-21.)
        expect(weekLockCaption('PER_GAME', 'Sun, Aug 23 · 5:55 PM MDT'))
            .toBe('each pick locks at its kickoff — last Sun, Aug 23 · 5:55 PM MDT');
    });

    it('an EXTENDED per-game week no longer claims each pick locks at its kickoff', () => {
        // `gameLockAt` is Math.max(kickoff - buffer, override), so an extension
        // applies to every game and every kickoff it sits past stops being that
        // game's lock. (codex r1.)
        expect(weekLockCaption('PER_GAME', 'Sun, Aug 23 · 5:55 PM MDT', true))
            .toBe('each pick locks at its kickoff or the extended deadline, whichever is later — last Sun, Aug 23 · 5:55 PM MDT');
        // A WEEKLY pool already has one deadline and the extension only moves it,
        // so its sentence is unchanged either way.
        expect(weekLockCaption('WEEKLY', 'x', true)).toBe(weekLockCaption('WEEKLY', 'x', false));
    });

    it('the two modes never produce the same sentence', () => {
        const ts = 'Sun, Aug 23 · 5:55 PM MDT';
        expect(weekLockCaption('PER_GAME', ts)).not.toBe(weekLockCaption('WEEKLY', ts));
    });
});
