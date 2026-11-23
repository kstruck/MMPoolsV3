import { describe, it, expect } from 'vitest';
import type { NFLGame } from '../types';
import type { PicksGridCell } from '../utils/picksGrid';
import { tallyGridRow, formatWinLoss, maxUnknownTitle, pointsLeft, pointsLeftUnknownTitle } from '../utils/picksGridMax';

// A FINAL game carries a real score (away 24, home 20) unless told otherwise —
// a scoreless FINAL is a separate case, pinned by its own test.
const game = (id: string, status: NFLGame['status'] = 'SCHEDULED', extra: Record<string, unknown> = {}) => ({
    id, status,
    homeTeam: { abbreviation: 'HOM' }, awayTeam: { abbreviation: 'AWY' },
    ...(status === 'FINAL' ? { scores: { home: 20, away: 24 } } : {}),
    ...extra,
} as unknown as NFLGame);
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

    it('a FINAL the feed reported no scores for is ungraded: not in W-L, but still winnable, so Max keeps it (qodo #2 on #722)', () => {
        const slate = [game('s1', 'FINAL', { scores: undefined })];
        const t = tallyGridRow({
            weekGames: slate, cells: new Map([['s1', pick(null)]]),
            setCount: 1, revealMode: 'PER_GAME', isOwnRow: true, confidenceMode: false,
        });
        expect(t).toMatchObject({ wins: 0, losses: 0, earned: 0, max: 1 });
        expect(formatWinLoss(t)).toBeNull();
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

    it('confidence with every saved pick already revealed is exact even though other cells are hidden (codex)', () => {
        // Set says 2 picks and both are revealed; g3–g5 are hidden but hold no pick.
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('W', 16), pick('L', 15), HIDDEN, HIDDEN, HIDDEN),
            setCount: 2, revealMode: 'WEEK', isOwnRow: false, confidenceMode: true,
        });
        expect(t).toMatchObject({ earned: 16, max: 16 });
        expect(t.maxUnknown).toBeUndefined();
    });

    it('confidence, a player with no picks at all: Max is exactly 0, not "?"', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(HIDDEN, HIDDEN, HIDDEN, HIDDEN, HIDDEN),
            setCount: 0, revealMode: 'WEEK', isOwnRow: false, confidenceMode: true,
        });
        expect(t.max).toBe(0);
    });

    it('a hidden FINAL that tied, or exactly covered the spread, grades PUSH and is not winnable (qodo #1 on #721)', () => {
        const tie = [game('t1', 'FINAL', { scores: { home: 21, away: 21 } })];
        expect(tallyGridRow({
            weekGames: tie, cells: new Map([['t1', HIDDEN]]),
            setCount: 1, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false,
        }).max).toBe(0);
        // ATS: home 20 + spread 4 = away 24 — an exact cover, a PUSH.
        const cover = [game('t2', 'FINAL', { spread: { value: 4 } })];
        expect(tallyGridRow({
            weekGames: cover, cells: new Map([['t2', HIDDEN]]),
            setCount: 1, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false, pickMode: 'ATS',
        }).max).toBe(0);
        // The same game straight-up is a decided win/loss, so it is still counted.
        expect(tallyGridRow({
            weekGames: cover, cells: new Map([['t2', HIDDEN]]),
            setCount: 1, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false,
        }).max).toBe(1);
    });

    it('a hidden FINAL the feed reported no scores for is still winnable, so it stays in Max (qodo #2 on #722)', () => {
        const scoreless = [game('s1', 'FINAL', { scores: undefined })];
        expect(tallyGridRow({
            weekGames: scoreless, cells: new Map([['s1', HIDDEN]]),
            setCount: 1, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false,
        }).max).toBe(1);
    });

    it('confidence: when every hidden game is cancelled the weights cannot matter, so Max is exact (qodo #2 on #721)', () => {
        const slate = [game('c1', 'CANCELLED'), game('c2', 'CANCELLED')];
        const t = tallyGridRow({
            weekGames: slate, cells: new Map([['c1', HIDDEN], ['c2', HIDDEN]]),
            setCount: 1, revealMode: 'WEEK', isOwnRow: false, confidenceMode: true,
        });
        expect(t.max).toBe(0);
        expect(t.maxUnknown).toBeUndefined();
    });

    it('a hidden FINAL game stays counted: the reveal can lag the game, and that pick may already be a win', () => {
        const slate = [game('f1', 'FINAL')];
        const t = tallyGridRow({
            weekGames: slate, cells: new Map([['f1', HIDDEN]]),
            setCount: 1, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false,
        });
        expect(t.max).toBe(1);
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

    it('a hidden CANCELLED game is not priced as winnable (codex)', () => {
        const only = [game('c1', 'CANCELLED')];
        const t = tallyGridRow({
            weekGames: only, cells: new Map([['c1', HIDDEN]]),
            setCount: 1, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false,
        });
        expect(t.max).toBe(0);
    });

    it('unrevealed picks cannot outnumber the hidden games that can still pay', () => {
        // Two hidden games, one of them cancelled; Set says 2 unrevealed picks.
        const slate = [game('h1'), game('h2', 'CANCELLED')];
        const t = tallyGridRow({
            weekGames: slate, cells: new Map([['h1', HIDDEN], ['h2', HIDDEN]]),
            setCount: 2, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false,
        });
        expect(t.max).toBe(1);
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

// Pts Left (Kevin, 2026-11-19): points on games NOT YET DECIDED, from the same
// tally as Max — but not `max − earned` (codex r1 on the Pts Left PR).
describe('tallyGridRow — left (the Pts Left column)', () => {
    it('own row, standard: one point per pick on a game not yet decided', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('W'), pick('L'), pick(null), pick(null), pick(null)),
            setCount: 5, revealMode: 'PER_GAME', isOwnRow: true, confidenceMode: false,
        });
        expect(pointsLeft(t)).toBe(3);
        expect(t.max).toBe(4);
    });

    it("own row, confidence: Kevin's example — two games to go at 5 and 6 is 11", () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('W', 9), pick('L', 3), pick('W', 4), pick(null, 5), pick(null, 6)),
            setCount: 5, revealMode: 'WEEK', isOwnRow: true, confidenceMode: true,
        });
        expect(pointsLeft(t)).toBe(11);
    });

    it('a finished week reads 0', () => {
        const t = tallyGridRow({
            weekGames: GAMES.slice(0, 2), cells: cells(pick('W'), pick('L')),
            setCount: 2, revealMode: 'PER_GAME', isOwnRow: true, confidenceMode: false,
        });
        expect(pointsLeft(t)).toBe(0);
    });

    it('PUSH and VOID are not points left', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('PUSH'), pick('VOID'), NO_PICK, NO_PICK, NO_PICK),
            setCount: 2, revealMode: 'PER_GAME', isOwnRow: true, confidenceMode: false,
        });
        expect(pointsLeft(t)).toBe(0);
    });

    // codex r1: a PER_GAME reveal can lag a game that has just ended. Max keeps
    // the hidden pick on it (it may already be a win — an upper bound must), but
    // a decided game is not "left to play".
    it('a hidden pick on a FINISHED game is in Max but NOT in Pts Left (lagging reveal)', () => {
        const slate = [game('f1', 'FINAL'), game('o1')];
        const t = tallyGridRow({
            weekGames: slate, cells: new Map([['f1', HIDDEN], ['o1', HIDDEN]]),
            setCount: 2, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false,
        });
        expect(t.max).toBe(2);
        expect(pointsLeft(t)).toBe(1);
    });

    // codex r2: one hidden pick across a just-finished game and an open one is
    // 0 or 1 left — not knowable, so "?", never the best case.
    it('ambiguous: fewer unrevealed picks than hidden games, spanning finished and open games → unknown', () => {
        const slate = [game('f1', 'FINAL'), game('o1')];
        const t = tallyGridRow({
            weekGames: slate, cells: new Map([['f1', HIDDEN], ['o1', HIDDEN]]),
            setCount: 1, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false,
        });
        expect(pointsLeft(t)).toBeNull();
        expect(t.leftUnknown).toBe('COUNT_UNKNOWN');
        expect(t.max).toBe(1);                         // Max stays the upper bound
    });

    it('not ambiguous: every hidden game is still open, so each unrevealed pick is 1 left', () => {
        const slate = [game('o1'), game('o2'), game('o3')];
        const t = tallyGridRow({
            weekGames: slate, cells: new Map([['o1', HIDDEN], ['o2', HIDDEN], ['o3', HIDDEN]]),
            setCount: 2, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false,
        });
        expect(pointsLeft(t)).toBe(2);
    });

    it('a hidden pick on an unfinished game, standard scoring: 1 point left each', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('W'), pick('L'), HIDDEN, HIDDEN, HIDDEN),
            setCount: 4, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false,
        });
        expect(pointsLeft(t)).toBe(2);                 // 4 saved − 2 revealed, both on open games
    });

    it('confidence: an unrevealed pick on an open game makes Pts Left unknown', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('W', 9), pick('L', 3), HIDDEN, HIDDEN, HIDDEN),
            setCount: 5, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: true,
        });
        expect(pointsLeft(t)).toBeNull();
        expect(t.leftUnknown).toBe('WEIGHTS_HIDDEN');
    });

    it('confidence: hidden picks only on FINISHED games leave Pts Left exact, even while Max is unknown', () => {
        const slate = [game('f1', 'FINAL'), game('o1')];
        const t = tallyGridRow({
            weekGames: slate, cells: new Map([['f1', HIDDEN], ['o1', pick(null, 7)]]),
            setCount: 2, revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: true,
        });
        expect(t.max).toBeNull();
        expect(pointsLeft(t)).toBe(7);
    });

    it('no reveal yet for another player: unknown, never a guess', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(HIDDEN, HIDDEN, HIDDEN, HIDDEN, HIDDEN),
            setCount: undefined, revealMode: undefined, isOwnRow: false, confidenceMode: false,
        });
        expect(pointsLeft(t)).toBeNull();
        expect(t.leftUnknown).toBe('COUNT_UNKNOWN');
    });

    // qodo #790, finding 1: a won pick with no stored weight makes Max unknown,
    // but it is on a decided game — Pts Left is still exact.
    it('a won pick missing its weight: Max unknown, Pts Left still exact (0 on a finished week)', () => {
        const t = tallyGridRow({
            weekGames: GAMES.slice(0, 2), cells: cells(pick('W'), pick('L', 3)),
            setCount: 2, revealMode: 'WEEK', isOwnRow: true, confidenceMode: true,
        });
        expect(t.max).toBeNull();
        expect(pointsLeft(t)).toBe(0);
    });

    it('a pick still IN PLAY missing its weight: Pts Left unknown too', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('W', 9), NO_PICK, pick(null), NO_PICK, NO_PICK),
            setCount: 2, revealMode: 'WEEK', isOwnRow: true, confidenceMode: true,
        });
        expect(pointsLeft(t)).toBeNull();
        expect(t.leftUnknown).toBe('WEIGHT_MISSING');
    });

    // qodo #790, finding 2: no reveal, but every hidden game is decided.
    it("another player, no reveal, a finished week: Pts Left 0 (Max stays '?')", () => {
        const t = tallyGridRow({
            weekGames: GAMES.slice(0, 2), cells: cells(HIDDEN, HIDDEN),
            setCount: undefined, revealMode: undefined, isOwnRow: false, confidenceMode: false,
        });
        expect(t.max).toBeNull();
        expect(pointsLeft(t)).toBe(0);
    });

    it('explains a "?" about points left', () => {
        expect(pointsLeftUnknownTitle('WEIGHTS_HIDDEN')).toContain('points they have left');
        expect(pointsLeftUnknownTitle(undefined)).toBe('Not known yet');
    });
});

// PLAN-PTS-LEFT-HIDDEN-TOTAL (Kevin, 2026-11-23): members saw "?" on every other
// row until the last games kicked off. The server now sends one total per row —
// the points on its hidden picks whose games are not decided — and the tally
// uses it.
describe('tallyGridRow — the server total for hidden open picks (hiddenLeft)', () => {
    // g1 won at 9, g2 lost, g3 live at 5 — revealed; g4 and g5 not kicked off — hidden.
    const sunday = () => cells(pick('W', 9), pick('L', 3), pick(null, 5), HIDDEN, HIDDEN);

    it('confidence: Pts Left = revealed picks in play + the total; Max = won + Pts Left', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: sunday(), setCount: 5, revealMode: 'PER_GAME',
            isOwnRow: false, confidenceMode: true, hiddenLeft: 6 + 7,
        });
        expect(pointsLeft(t)).toBe(5 + 13);
        expect(t.max).toBe(9 + 18);
    });

    it('without it, the same row is still "?" — the pre-deploy behaviour', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: sunday(), setCount: 5, revealMode: 'PER_GAME',
            isOwnRow: false, confidenceMode: true,
        });
        expect(pointsLeft(t)).toBeNull();
        expect(t.max).toBeNull();
    });

    it('standard scoring: the total is one point per hidden open pick', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('W'), pick('L'), pick(null), HIDDEN, HIDDEN), setCount: 4,
            revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false, hiddenLeft: 1,
        });
        expect(pointsLeft(t)).toBe(2);
        expect(t.max).toBe(3);
    });

    it('a total of 0 is a real 0 (no hidden picks still in play)', () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: sunday(), setCount: 3, revealMode: 'PER_GAME',
            isOwnRow: false, confidenceMode: true, hiddenLeft: 0,
        });
        expect(pointsLeft(t)).toBe(5);
        expect(t.max).toBe(14);
    });

    it('a hidden pick on a game that has just FINISHED: Pts Left exact, confidence Max unknown', () => {
        // The reveal lags the game: f1 is final but its pick is still hidden. The
        // server's total covers only open games; the f1 pick may already be a
        // win at an unknown weight, so Max cannot be stated.
        const slate = [game('f1', 'FINAL', { scores: { home: 20, away: 10 } }), game('o1')];
        const t = tallyGridRow({
            weekGames: slate, cells: new Map([['f1', HIDDEN], ['o1', HIDDEN]]), setCount: 2,
            revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: true, hiddenLeft: 8,
        });
        expect(pointsLeft(t)).toBe(8);
        expect(t.max).toBeNull();
        expect(t.maxUnknown).toBe('WEIGHTS_HIDDEN');
    });

    it('the same case in standard scoring bounds the finished hidden pick at 1', () => {
        const slate = [game('f1', 'FINAL', { scores: { home: 20, away: 10 } }), game('o1')];
        const t = tallyGridRow({
            weekGames: slate, cells: new Map([['f1', HIDDEN], ['o1', HIDDEN]]), setCount: 2,
            revealMode: 'PER_GAME', isOwnRow: false, confidenceMode: false, hiddenLeft: 1,
        });
        expect(pointsLeft(t)).toBe(1);
        expect(t.max).toBe(2);
    });

    it("the viewer's own row ignores it: every cell is already known", () => {
        const t = tallyGridRow({
            weekGames: GAMES, cells: cells(pick('W', 9), pick('L', 3), pick(null, 5), pick(null, 6), pick(null, 7)),
            setCount: 5, revealMode: 'PER_GAME', isOwnRow: true, confidenceMode: true, hiddenLeft: 999,
        });
        expect(pointsLeft(t)).toBe(18);
        expect(t.max).toBe(27);
    });
});
