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
 * exact, one pick too high. It now prints "?" for exactly that window: when a
 * hidden game is decided now AND was open when the total arrived
 * (`hiddenLeftOpenAtFetch`, stamped by the dashboard).
 *
 * Found by the Claude pre-review of #801. Kevin, 2026-11-23: "Fix 1 as well".
 */
import { describe, it, expect } from 'vitest';
import type { NFLGame } from '../types';
import type { PicksGridCell } from '../utils/picksGrid';
import { isGameDecided, pointsLeft, pointsLeftUnknownTitle, tallyGridRow, undecidedGameIds } from '../utils/picksGridMax';

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

describe('standard scoring: a hidden game is decided after the total was fetched', () => {
    // g3 is cancelled before kickoff. It is still HIDDEN on this row, and the
    // total in hand (2) still counts the row's pick on it.
    const NOW = [game('g1', 'FINAL'), game('g2', 'IN_PROGRESS'), game('g3', 'CANCELLED'), game('g4')];
    const row = () => cellsFor(NOW, pick('W'), pick(null), HIDDEN, HIDDEN);
    const base = { weekGames: NOW, setCount: 4, revealMode: 'PER_GAME' as const, isOwnRow: false, confidenceMode: false };

    it('Pts Left is "?" — it is 2 or 3 and we cannot see which', () => {
        const t = tallyGridRow({ ...base, cells: row(), hiddenLeft: 2, hiddenLeftOpenAtFetch: OPEN_AT_FETCH });
        expect(pointsLeft(t)).toBeNull();
        expect(t.leftUnknown).toBe('COUNT_UNKNOWN');
        expect(pointsLeftUnknownTitle(t.leftUnknown)).toBe('Not known yet');
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

    it('Pts Left is "?", with the weights wording', () => {
        // The total (6 + 7) may still hold the weight on the cancelled game.
        const t = tallyGridRow({ ...base, cells: row(), hiddenLeft: 13, hiddenLeftOpenAtFetch: OPEN_AT_FETCH });
        expect(pointsLeft(t)).toBeNull();
        expect(t.leftUnknown).toBe('WEIGHTS_HIDDEN');
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
