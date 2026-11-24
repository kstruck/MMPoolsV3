/**
 * PTS LEFT WHEN THE SERVER'S TOTAL IS OLDER THAN THE GAME STATUSES.
 *
 * `hiddenLeft` is a snapshot: the points a row has on picks the viewer cannot
 * see, on games that were NOT DECIDED when `getPoolPicks` ran. The statuses
 * the page renders are live, and the total is refetched only every 60 seconds
 * (commissioner) or 300 (member) — and not at all while a refresh fails.
 *
 * So a hidden game can be decided on screen while the total still counts a
 * pick on it. Before this file's change the tally printed that number as
 * exact, one pick too high. It now prints "?" when a hidden game is decided
 * now AND was open when the request for the total was sent
 * (`hiddenLeftOpenAtFetch`, stamped by `fetchStampedReveal`). The stamp is
 * taken BEFORE the call, so it errs toward "?" and never toward a wrong number.
 *
 * Found by the Claude pre-review of #801. Kevin, 2026-11-23: "Fix 1 as well".
 */
import { describe, it, expect } from 'vitest';
import type { NFLGame } from '../types';
import type { PicksGridCell } from '../utils/picksGrid';
import { fetchStampedReveal, isGameDecided, needsStampedRefetch, pointsLeft, pointsLeftUnknownTitle, tallyGridRow, undecidedGameIds } from '../utils/picksGridMax';

const game = (id: string, status: NFLGame['status'] = 'SCHEDULED', extra: Record<string, unknown> = {}) => ({
    id, status,
    homeTeam: { abbreviation: 'HOM' }, awayTeam: { abbreviation: 'AWY' },
    ...(status === 'FINAL' ? { scores: { home: 20, away: 24 } } : {}),
    ...extra,
} as unknown as NFLGame);
const pick = (result: 'W' | 'L' | null, confidence?: number): PicksGridCell => ({
    kind: 'PICK', team: 'KC', result, ...(confidence === undefined ? {} : { confidence }),
});
const HIDDEN: PicksGridCell = { kind: 'HIDDEN' };
const cellsFor = (games: NFLGame[], ...c: PicksGridCell[]) => new Map(games.map((g, i) => [g.id, c[i]] as const));

/**
 * The slate WHEN THE TOTAL WAS FETCHED: g1 won, g2 live (revealed), g3 and g4
 * not kicked off (hidden). The row has a pick on both hidden games.
 */
const AT_FETCH = [game('g1', 'FINAL'), game('g2', 'IN_PROGRESS'), game('g3'), game('g4')];
const OPEN_AT_FETCH = new Set(undecidedGameIds(AT_FETCH));

describe('the stamp: which games were open when the total arrived', () => {
    it('lists the games that are not decided', () => {
        expect([...OPEN_AT_FETCH].sort()).toEqual(['g2', 'g3', 'g4']);
    });

    it('an empty schedule is "not known", never "every game was decided"', () => {
        // An empty array would make every later-decided game look like it was
        // already decided at fetch, and the stale check would never fire.
        expect(undecidedGameIds([])).toBeUndefined();
    });

    it('decided = CANCELLED, or FINAL with scores; a scoreless FINAL is still open', () => {
        expect(isGameDecided(game('a', 'CANCELLED'))).toBe(true);
        expect(isGameDecided(game('a', 'FINAL'))).toBe(true);
        expect(isGameDecided(game('a', 'FINAL', { scores: undefined }))).toBe(false);
        expect(isGameDecided(game('a', 'IN_PROGRESS'))).toBe(false);
        expect(isGameDecided(game('a'))).toBe(false);
    });
});

describe('fetchStampedReveal: the stamp is taken BEFORE the request, not when the response lands', () => {
    it('a game decided WHILE the request is in flight is still in the stamp', async () => {
        // The ordering the pre-review of this fix found: the server reads g3 as
        // open and counts the pick on it; the page's listener then delivers g3
        // as CANCELLED before the response lands. A stamp taken on arrival would
        // leave g3 out, the stale check would not fire, and the too-high total
        // would print. The schedule is mutated inside the fetch to model that.
        const live = [game('g1', 'FINAL'), game('g2', 'IN_PROGRESS'), game('g3'), game('g4')];
        const fetch = async () => {
            live[2] = game('g3', 'CANCELLED');
            return { week: 3, hiddenLeft: { u2: 2 } };
        };
        const stamped = await fetchStampedReveal(fetch, live);
        expect(stamped.hiddenLeftOpenGameIds).toEqual(['g2', 'g3', 'g4']);
        // The response itself is passed through untouched.
        expect(stamped.week).toBe(3);
        expect(stamped.hiddenLeft).toEqual({ u2: 2 });

        // And that stamp is what makes the tally refuse the number.
        const t = tallyGridRow({
            weekGames: live, cells: cellsFor(live, pick('W'), pick(null), HIDDEN, HIDDEN),
            setCount: 4, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false,
            hiddenLeft: 2, hiddenLeftOpenAtFetch: new Set(stamped.hiddenLeftOpenGameIds),
        });
        expect(pointsLeft(t)).toBeNull();
    });

    it('the arrival-time stamp it replaces would have printed the wrong number', () => {
        // Guard-the-guard: the same slate, stamped from the statuses AFTER the
        // cancel, as the first version of this fix did. g3 is absent, nothing
        // fires, and Pts Left reads 3 with a pick on a cancelled game inside it.
        const after = [game('g1', 'FINAL'), game('g2', 'IN_PROGRESS'), game('g3', 'CANCELLED'), game('g4')];
        const arrivalStamp = new Set(undecidedGameIds(after));
        expect(arrivalStamp.has('g3')).toBe(false);
        const t = tallyGridRow({
            weekGames: after, cells: cellsFor(after, pick('W'), pick(null), HIDDEN, HIDDEN),
            setCount: 4, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false,
            hiddenLeft: 2, hiddenLeftOpenAtFetch: arrivalStamp,
        });
        expect(pointsLeft(t)).toBe(3);
    });

    it('an unloaded schedule stamps nothing, and a rejected fetch still rejects', async () => {
        const stamped = await fetchStampedReveal(async () => ({ week: 1 }), []);
        expect(stamped.hiddenLeftOpenGameIds).toBeUndefined();
        await expect(fetchStampedReveal(async () => { throw new Error('denied'); }, AT_FETCH)).rejects.toThrow('denied');
    });
});

describe('needsStampedRefetch: the first request of a page load can beat the schedule', () => {
    // qodo on #805. The reveal request leaves before the games subscription has
    // delivered anything, so it comes back unstamped. The tables withhold an
    // unstamped total; this decides when fetching again will produce a stamped one.
    it('an unstamped total, and the schedule has now loaded: fetch again', () => {
        expect(needsStampedRefetch({ hiddenLeft: { u2: 2 } }, true)).toBe(true);
    });

    it('not while the schedule is still empty — the refetch would be unstamped too', () => {
        expect(needsStampedRefetch({ hiddenLeft: { u2: 2 } }, false)).toBe(false);
    });

    it('never for a stamped reveal, even one stamped with an empty list: no loop', () => {
        expect(needsStampedRefetch({ hiddenLeft: { u2: 2 }, hiddenLeftOpenGameIds: ['g3'] }, true)).toBe(false);
        expect(needsStampedRefetch({ hiddenLeft: { u2: 2 }, hiddenLeftOpenGameIds: [] }, true)).toBe(false);
    });

    it('not when the server sent no total at all — nothing would be withheld', () => {
        // A Survivor pool, a pre-deploy server, or the sharing setting off.
        expect(needsStampedRefetch({}, true)).toBe(false);
        expect(needsStampedRefetch(undefined, true)).toBe(false);
        expect(needsStampedRefetch(null, true)).toBe(false);
    });

    it('a fetch made with the schedule loaded always clears it', async () => {
        const stamped = await fetchStampedReveal(async () => ({ hiddenLeft: { u2: 2 } }), AT_FETCH);
        expect(needsStampedRefetch(stamped, true)).toBe(false);
        const unstamped = await fetchStampedReveal(async () => ({ hiddenLeft: { u2: 2 } }), []);
        expect(needsStampedRefetch(unstamped, true)).toBe(true);
    });
});

describe('standard scoring: a hidden game is decided after the total was fetched', () => {
    // g3 is cancelled before kickoff. It is still HIDDEN on this row, and the
    // total in hand (2) still counts the row's pick on it.
    const NOW = [game('g1', 'FINAL'), game('g2', 'IN_PROGRESS'), game('g3', 'CANCELLED'), game('g4')];
    const row = () => cellsFor(NOW, pick('W'), pick(null), HIDDEN, HIDDEN);
    const base = { weekGames: NOW, setCount: 4, revealMode: 'PER_GAME' as const, isOwnRow: false, confidenceMode: false };

    it('Pts Left is "?" — it is 2 or 3 and we cannot see which', () => {
        const t = tallyGridRow({ ...base, cells: row(), hiddenLeft: 2, hiddenLeftOpenAtFetch: OPEN_AT_FETCH });
        expect(pointsLeft(t)).toBeNull();
        expect(t.leftUnknown).toBe('TOTAL_STALE');
        // The tooltip names the real cause. It must not blame hidden weights or
        // a missing count: neither is what is wrong here (qodo on #805).
        expect(pointsLeftUnknownTitle(t.leftUnknown)).toBe(
            'A game has finished or been cancelled since these points were last checked. This updates within a few minutes',
        );
    });

    it('BEFORE this change the same inputs printed 3, one too high', () => {
        // The unstamped call is the old behaviour, kept for a reveal that could
        // not be stamped. Pinned so the difference the stamp makes is visible.
        const t = tallyGridRow({ ...base, cells: row(), hiddenLeft: 2 });
        expect(pointsLeft(t)).toBe(3);
    });

    it('Max does not drop: it stays the upper bound it was', () => {
        const stamped = tallyGridRow({ ...base, cells: row(), hiddenLeft: 2, hiddenLeftOpenAtFetch: OPEN_AT_FETCH });
        const unstamped = tallyGridRow({ ...base, cells: row(), hiddenLeft: 2 });
        expect(stamped.max).toBe(unstamped.max);
        expect(stamped.max).toBe(1 + 3);
    });

    it('the NEXT poll fixes it: a total fetched after the cancel is exact again', () => {
        // The server now leaves g3 out (total 1), and g3 was already decided when
        // this total arrived, so it is not in the stamp.
        const fresh = new Set(undecidedGameIds(NOW));
        expect(fresh.has('g3')).toBe(false);
        const t = tallyGridRow({ ...base, cells: row(), hiddenLeft: 1, hiddenLeftOpenAtFetch: fresh });
        expect(pointsLeft(t)).toBe(2);
        expect(t.leftUnknown).toBeUndefined();
    });

    it('a total of 0 cannot overcount, so it stays exact', () => {
        const t = tallyGridRow({ ...base, cells: row(), setCount: 2, hiddenLeft: 0, hiddenLeftOpenAtFetch: OPEN_AT_FETCH });
        expect(pointsLeft(t)).toBe(1);
    });

    it('a game that finished with scores since the fetch counts the same as a cancel', () => {
        const finished = [game('g1', 'FINAL'), game('g2', 'IN_PROGRESS'), game('g3', 'FINAL'), game('g4')];
        const t = tallyGridRow({
            ...base, weekGames: finished, cells: cellsFor(finished, pick('W'), pick(null), HIDDEN, HIDDEN),
            hiddenLeft: 2, hiddenLeftOpenAtFetch: OPEN_AT_FETCH,
        });
        expect(pointsLeft(t)).toBeNull();
    });

    it('nothing decided since the fetch: the total is used exactly as before', () => {
        const t = tallyGridRow({
            ...base, weekGames: AT_FETCH, cells: cellsFor(AT_FETCH, pick('W'), pick(null), HIDDEN, HIDDEN),
            hiddenLeft: 2, hiddenLeftOpenAtFetch: OPEN_AT_FETCH,
        });
        expect(pointsLeft(t)).toBe(3);
        expect(t.max).toBe(4);
    });

    it('a decided game that is REVEALED does not trigger it — only hidden ones can hide a counted pick', () => {
        // g2 finishes (it was open at fetch) but its pick is revealed and graded.
        const g2Done = [game('g1', 'FINAL'), game('g2', 'FINAL'), game('g3'), game('g4')];
        const t = tallyGridRow({
            ...base, weekGames: g2Done, cells: cellsFor(g2Done, pick('W'), pick('L'), HIDDEN, HIDDEN),
            hiddenLeft: 2, hiddenLeftOpenAtFetch: OPEN_AT_FETCH,
        });
        expect(pointsLeft(t)).toBe(2);
    });
});

describe('confidence scoring: the same window', () => {
    const NOW = [game('g1', 'FINAL'), game('g2', 'IN_PROGRESS'), game('g3', 'CANCELLED'), game('g4')];
    const row = () => cellsFor(NOW, pick('W', 9), pick(null, 5), HIDDEN, HIDDEN);
    const base = { weekGames: NOW, setCount: 4, revealMode: 'PER_GAME' as const, isOwnRow: false, confidenceMode: true };

    it('Pts Left is "?", for the same stated reason — not "weights are hidden"', () => {
        // The total (6 + 7) may still hold the weight on the cancelled game.
        const t = tallyGridRow({ ...base, cells: row(), hiddenLeft: 13, hiddenLeftOpenAtFetch: OPEN_AT_FETCH });
        expect(pointsLeft(t)).toBeNull();
        expect(t.leftUnknown).toBe('TOTAL_STALE');
        expect(pointsLeftUnknownTitle(t.leftUnknown)).not.toMatch(/weights/i);
    });

    it('and exact again once a fresh total arrives', () => {
        const t = tallyGridRow({ ...base, cells: row(), hiddenLeft: 7, hiddenLeftOpenAtFetch: new Set(undecidedGameIds(NOW)) });
        expect(pointsLeft(t)).toBe(5 + 7);
    });
});

describe("the viewer's own row never needs any of this", () => {
    it('ignores both the total and the stamp', () => {
        const NOW = [game('g1', 'FINAL'), game('g2', 'IN_PROGRESS'), game('g3', 'CANCELLED'), game('g4')];
        const t = tallyGridRow({
            weekGames: NOW, cells: cellsFor(NOW, pick('W'), pick(null), pick(null), pick(null)),
            setCount: 4, revealMode: 'PER_GAME', isOwnRow: true, confidenceMode: false,
            hiddenLeft: 99, hiddenLeftOpenAtFetch: OPEN_AT_FETCH,
        });
        // g2 and g4 are still in play; the cancelled g3 is not.
        expect(pointsLeft(t)).toBe(2);
    });
});
