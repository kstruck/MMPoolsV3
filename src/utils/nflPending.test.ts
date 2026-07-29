import { describe, it, expect, vi } from 'vitest';

// `nflPending` imports the server clock, which imports `src/firebase.ts`, which
// touches `self` at module load and throws under vitest's node environment.
// Neither function under test reads the clock, so stubbing the module keeps
// Firebase out of the import graph entirely.
vi.mock('./serverClock', () => ({ now: () => 0 }));

import { gamesForPoolWeek, poolSeasonType } from './nflPending';
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
