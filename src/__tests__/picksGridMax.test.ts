import { describe, it, expect } from 'vitest';
import type { NFLGame } from '../types';
import type { PicksGridCell } from '../utils/picksGrid';
import { tallyGridRow, formatWinLoss, maxUnknownTitle } from '../utils/picksGridMax';

const game = (id: string, status: NFLGame['status'] = 'SCHEDULED') => ({ id, status } as unknown as NFLGame);
const pick = (result: 'W' | 'L' | 'PUSH' | 'VOID' | null, confidence?: number): PicksGridCell => ({
    kind: 'PICK', team: 'KC', result, ...(confidence === undefined ? {} : { confidence }),
});
const HIDDEN: PicksGridCell = { kind: 'HIDDEN' };
const NO_PICK: PicksGridCell = { kind: 'NO_PICK' };

/** A five-game slate: g1 FINAL, g2 FINAL, g3 in progress, g4 and g5 not started. */
const GAMES = [game('g1', 'FINAL'), game('g2', 'FINAL'), game('g3', 'IN_PROGRESS'), game('g4'), game('g5')];
const cells = (...c: PicksGridCell[]) => new Map(GAMES.map((g, i) => [g.id, c[i]] as const));

describe('tallyGridRow — own row, standard scoring', () => {
    it('counts wins and losses, and Max = wins + every undecided pick', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('W'), pick('L'), pick(null), pick(null), pick(null)),
            setCount: 5, revealMode: 'PER_GAME', isOwnRow: true, confidenceMode: false,
        });
        expect(t).toMatchObject({ wins: 1, losses: 1, earned: 1, max: 4 });   // 1 earned + 3 winnable
    });

    it('a pick on a game still in progress is still winnable', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('W'), pick('W'), pick(null), NO_PICK, NO_PICK),
            setCount: 3, revealMode: 'PER_GAME', isOwnRow: true, confidenceMode: false,
        });
        expect(t.max).toBe(3);                                                // 2 earned + the live game
    });

    it('PUSH and VOID are excluded from W-L and from Max', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('PUSH'), pick('VOID'), pick('W'), pick(null), pick(null)),
            setCount: 5, revealMode: 'PER_GAME', isOwnRow: true, confidenceMode: false,
        });
        expect(t).toMatchObject({ wins: 1, losses: 0, earned: 1, max: 3 });
    });

    it('a FINAL game the feed reported no scores for stays ungraded and is not winnable', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick(null), NO_PICK, NO_PICK, NO_PICK, NO_PICK),
            setCount: 1, revealMode: 'PER_GAME', isOwnRow: true, confidenceMode: false,
        });
        expect(t).toMatchObject({ wins: 0, losses: 0, max: 0 });
    });

    it('an own row that picked nothing is 0-0 with Max 0, not unknown', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(NO_PICK, NO_PICK, NO_PICK, NO_PICK, NO_PICK),
            setCount: 0, revealMode: undefined, isOwnRow: true, confidenceMode: false,
        });
        expect(t).toMatchObject({ wins: 0, losses: 0, max: 0 });
        expect(formatWinLoss(t)).toBeNull();
    });
});

describe('tallyGridRow — own row, confidence scoring', () => {
    it('earned is the sum of won weights; Max adds the weights still in play', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('W', 16), pick('L', 15), pick(null, 10), pick(null, 3), pick('W', 1)),
            setCount: 5, revealMode: 'WEEK', isOwnRow: true, confidenceMode: true,
        });
        expect(t).toMatchObject({ wins: 2, losses: 1, earned: 17, max: 30 });   // 17 + 10 + 3
    });

    it('a confidence pick with no stored weight cannot be priced', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('W', 16), NO_PICK, pick(null), NO_PICK, NO_PICK),
            setCount: 2, revealMode: 'WEEK', isOwnRow: true, confidenceMode: true,
        });
        expect(t).toMatchObject({ max: null, maxUnknown: 'WEIGHT_MISSING' });
    });
});

describe("tallyGridRow — another player's row", () => {
    it('PER_GAME standard: 2 of 5 revealed, the rest priced from the Set count', () => {
        // They saved 5 picks; g1 (won) and g2 (lost) are revealed, g3–g5 are not.
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('W'), pick('L'), HIDDEN, HIDDEN, HIDDEN),
            setCount: 5, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false,
        });
        expect(t).toMatchObject({ wins: 1, losses: 1, earned: 1, max: 4 });   // 1 + (5 - 2 revealed)
    });

    it('standard WEEK reveal before the deadline: nothing revealed, every pick is worth 1', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(HIDDEN, HIDDEN, HIDDEN, HIDDEN, HIDDEN),
            setCount: 4, revealMode: 'WEEK', isOwnRow: false, confidenceMode: false,
        });
        expect(t).toMatchObject({ wins: 0, losses: 0, max: 4 });
    });

    it('confidence WEEK reveal before the deadline: weights unknown, so "?"', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(HIDDEN, HIDDEN, HIDDEN, HIDDEN, HIDDEN),
            setCount: 5, revealMode: 'WEEK', isOwnRow: false, confidenceMode: true,
        });
        expect(t).toMatchObject({ max: null, maxUnknown: 'WEIGHTS_HIDDEN' });
    });

    it('confidence WEEK reveal after the deadline: everything is revealed, so exact', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('W', 16), pick('L', 15), pick(null, 10), pick(null, 3), pick(null, 1)),
            setCount: 5, revealMode: 'WEEK', isOwnRow: false, confidenceMode: true,
        });
        expect(t).toMatchObject({ earned: 16, max: 30 });
    });

    it('the Set count has not arrived: "?", never a guess', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('W'), HIDDEN, HIDDEN, HIDDEN, HIDDEN),
            setCount: undefined, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false,
        });
        expect(t).toMatchObject({ max: null, maxUnknown: 'COUNT_UNKNOWN' });
    });

    it('the reveal has not arrived at all: "?"', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(HIDDEN, HIDDEN, HIDDEN, HIDDEN, HIDDEN),
            setCount: 3, revealMode: undefined, isOwnRow: false, confidenceMode: false,
        });
        expect(t).toMatchObject({ max: null, maxUnknown: 'COUNT_UNKNOWN' });
    });

    it('a stale Set count smaller than what is already revealed clamps to 0, never negative', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('W'), pick('W'), pick(null), HIDDEN, HIDDEN),
            setCount: 1, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false,
        });
        expect(t.max).toBe(3);                                                // 2 earned + 1 live, + 0 unrevealed
    });

    it('a fully revealed row needs no Set count', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('W'), pick('L'), pick(null), NO_PICK, NO_PICK),
            setCount: undefined, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false,
        });
        expect(t).toMatchObject({ wins: 1, losses: 1, max: 2 });
    });
});

describe('formatting', () => {
    it('W-L reads 3-1, and null while nothing is graded', () => {
        expect(formatWinLoss({ wins: 3, losses: 1 })).toBe('3-1');
        expect(formatWinLoss({ wins: 0, losses: 0 })).toBeNull();
    });
    it('every unknown reason has its own tooltip', () => {
        const titles = new Set(['COUNT_UNKNOWN', 'WEIGHTS_HIDDEN', 'WEIGHT_MISSING'].map(r => maxUnknownTitle(r as never)));
        expect(titles.size).toBe(3);
    });
});
