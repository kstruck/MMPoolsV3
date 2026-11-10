import { describe, it, expect } from 'vitest';
import {
    finalScoresOf,
    parseEventWinnerId,
    planWinnerWrites,
    type StoredWinner,
    type WinnerWrite,
} from '../lib/squaresWinners';
import { isUsableAxis, squaresGameHasStarted } from '../lib/squaresGame';
import type { PayoutPool } from '../shared/squaresPayouts';

/**
 * The decision table behind squares winner records (PLAN-SQUARES-REOPEN B2).
 *
 * `planWinnerWrites` decides what to create, change and remove so the records
 * match the scores. The emulator suite (squaresMoney.emulator.test.ts) proves it
 * is wired into the score sync; these pin the cases that are awkward to reach
 * from there — what gets AUDITED, and how loudly.
 *
 * Grid: numbers 0–9 in order, square N owned by `P{N}`, $10 a square → $1,000.
 */
const IDENTITY = { home: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], away: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };

const pool = (over: Partial<PayoutPool> = {}, unsold: number[] = []): PayoutPool => ({
    costPerSquare: 10,
    squares: Array.from({ length: 100 }, (_, i) => ({ owner: unsold.includes(i) ? null : `P${i}` })),
    payouts: { q1: 20, half: 20, q3: 20, final: 40 },
    axisNumbers: IDENTITY,
    numberSets: 1,
    ruleVariations: {},
    ...over,
});

const Q1 = { q1: { home: 7, away: 3 } };
const q1Record = (over: Record<string, unknown> = {}): StoredWinner => ({
    id: 'q1',
    data: { period: 'q1', squareId: 37, owner: 'P37', amount: 200, homeDigit: 7, awayDigit: 3, isReverse: false, isRollover: false, description: 'Q1 Winner', ...over },
});

const plan = (p: PayoutPool, scores: Parameters<typeof planWinnerWrites>[1], existing: StoredWinner[] = [], gameFinal = false) =>
    planWinnerWrites(p, scores, existing, { gameFinal });

const only = <K extends WinnerWrite['kind']>(writes: WinnerWrite[], kind: K) =>
    writes.filter((w): w is Extract<WinnerWrite, { kind: K }> => w.kind === kind);

describe('creating records', () => {
    it('a newly final period gets a record and an audit line', () => {
        const writes = plan(pool(), Q1);
        expect(writes).toHaveLength(1);
        expect(writes[0]).toMatchObject({
            kind: 'create', id: 'q1',
            doc: { period: 'q1', squareId: 37, owner: 'P37', amount: 200, homeDigit: 7, awayDigit: 3, isReverse: false, isRollover: false },
            audit: { type: 'WINNER_COMPUTED', severity: 'INFO' },
        });
        expect(writes[0].audit?.message).toBe('Q1 Winner: P37 ($200.00)');
    });

    it('nothing is final → nothing to write', () => {
        expect(plan(pool(), {})).toEqual([]);
    });
});

describe('leaving records alone', () => {
    it('a record that already says what the rules say is not rewritten', () => {
        expect(plan(pool(), Q1, [q1Record()])).toEqual([]);
    });

    it('fields the payout math does not own are never touched', () => {
        const writes = plan(pool(), Q1, [q1Record({ isPaid: true, paidAt: 123, paidByUid: 'owner', aiNote: 'kept' })]);
        expect(writes).toEqual([]);
    });

    it('a grid with NO numbers plans nothing — an empty result is not "delete everything"', () => {
        expect(plan(pool({ axisNumbers: null }), Q1, [q1Record()])).toEqual([]);
    });

    it('a four-set grid with only its quarter sets still counts as having numbers', () => {
        const p = pool({ numberSets: 4, axisNumbers: null, quarterlyNumbers: { q1: IDENTITY } });
        expect(only(plan(p, Q1), 'create')).toHaveLength(1);
    });

    it('a record from before `isRollover` existed is brought up to date quietly', () => {
        const legacy = q1Record();
        delete legacy.data.isRollover;
        const writes = plan(pool(), Q1, [legacy]);
        expect(writes).toEqual([{ kind: 'update', id: 'q1', fields: { isRollover: false } }]);
    });
});

describe('changing records', () => {
    it('a prize that changes for the same winner is updated and logged', () => {
        const writes = plan(pool(), Q1, [q1Record({ amount: 150 })]);
        expect(writes).toHaveLength(1);
        expect(writes[0]).toMatchObject({ kind: 'update', id: 'q1', fields: { amount: 200 }, audit: { severity: 'INFO' } });
        expect(writes[0].audit?.message).toMatch(/now \$200\.00 \(was \$150\.00\)/);
    });

    it('…and logged as a WARNING if that winner was already marked paid — "paid" itself is kept', () => {
        const [w] = plan(pool(), Q1, [q1Record({ amount: 150, isPaid: true })]);
        expect(w).toMatchObject({ kind: 'update', fields: { amount: 200 }, audit: { severity: 'WARNING' } });
        expect((w as Extract<WinnerWrite, { kind: 'update' }>).fields).not.toHaveProperty('isPaid');
    });

    it('a different winner clears "paid" and is CRITICAL when the old one had been paid', () => {
        const [w] = plan(pool(), { q1: { home: 8, away: 3 } }, [q1Record({ isPaid: true, paidAt: 123, paidByUid: 'owner' })]);
        expect(w).toMatchObject({
            kind: 'update', id: 'q1',
            fields: { squareId: 38, owner: 'P38', homeDigit: 8, isPaid: false, paidAt: null, paidByUid: null },
            audit: { severity: 'CRITICAL', payload: { previousWinner: 'P37', previousSquareId: 37, wasPaid: true } },
        });
    });

    it('a different winner that was never paid is a WARNING and leaves the paid fields out', () => {
        const [w] = plan(pool(), { q1: { home: 8, away: 3 } }, [q1Record()]);
        expect(w).toMatchObject({ kind: 'update', audit: { severity: 'WARNING' } });
        expect((w as Extract<WinnerWrite, { kind: 'update' }>).fields).not.toHaveProperty('isPaid');
    });
});

describe('removing records', () => {
    const reverse: StoredWinner = { id: 'q1_reverse', data: { period: 'q1', squareId: 73, owner: 'P73', amount: 100, isReverse: true } };

    it('a period record the rules no longer call for is removed, with a WARNING', () => {
        const writes = plan(pool(), Q1, [q1Record({ amount: 100 }), reverse]);
        expect(only(writes, 'delete')).toEqual([expect.objectContaining({ id: 'q1_reverse', audit: expect.objectContaining({ severity: 'WARNING' }) })]);
    });

    it('…CRITICAL if it had been marked paid', () => {
        const writes = plan(pool(), Q1, [q1Record({ amount: 100 }), { ...reverse, data: { ...reverse.data, isPaid: true } }]);
        expect(only(writes, 'delete')[0].audit).toMatchObject({ severity: 'CRITICAL', payload: { wasPaid: true } });
    });

    it('a scoring-event record is never removed by the period pass', () => {
        const event: StoredWinner = { id: 'event_7_3', data: { period: 'Event', squareId: 37, owner: 'P37', amount: 0 } };
        expect(only(plan(pool(), Q1, [q1Record(), event]), 'delete')).toEqual([]);
    });

    it('a record with an id this code does not know is left alone', () => {
        const unknown: StoredWinner = { id: 'bonus_manual', data: { owner: 'Someone', amount: 50 } };
        expect(plan(pool(), Q1, [q1Record(), unknown])).toEqual([]);
    });
});

describe('scoring events', () => {
    const esp = pool({ ruleVariations: { scoreChangePayout: true, scoreChangePayoutStrategy: 'equal_split' } });
    const events: StoredWinner[] = [
        { id: 'event_3_0', data: { period: 'Event', squareId: 3, owner: 'P3', amount: 0 } },
        { id: 'event_rev_3_0', data: { period: 'Event', squareId: 30, owner: 'Unsold', amount: 0, isReverse: true } },
    ];

    it('amounts are left at $0 while the game is still going', () => {
        expect(plan(esp, {}, events, false)).toEqual([]);
    });

    it('at the final whistle each event is given its amount, with one summary audit line', () => {
        const writes = plan(esp, {}, events, true);
        expect(only(writes, 'update')).toEqual([{ kind: 'update', id: 'event_3_0', fields: { amount: 1000 } }]);
        const audit = only(writes, 'audit');
        expect(audit).toHaveLength(1);
        expect(audit[0].audit.payload).toMatchObject({ scoreChangePot: 1000, eventCount: 2, paidEvents: 1, updatedCount: 1 });
    });

    it('a second pass after that writes nothing', () => {
        const settled = [{ ...events[0], data: { ...events[0].data, amount: 1000 } }, events[1]];
        expect(plan(esp, {}, settled, true)).toEqual([]);
    });

    it('a pool that is not Every-Score-Pays never touches event records', () => {
        expect(plan(pool(), {}, events, true)).toEqual([]);
    });

    it('reads the score out of the record id', () => {
        expect(parseEventWinnerId('event_14_7')).toEqual({ home: 14, away: 7, isReverse: false });
        expect(parseEventWinnerId('event_rev_14_7')).toEqual({ home: 14, away: 7, isReverse: true });
        expect(parseEventWinnerId('event_x_7')).toBeNull();
        expect(parseEventWinnerId('q1')).toBeNull();
    });
});

describe('finalScoresOf', () => {
    it('takes the periods that have a score, including 0–0', () => {
        expect(finalScoresOf({ q1: { home: 0, away: 0 }, half: null, q3: undefined, final: { home: '28', away: 24 }, current: { home: 1, away: 2 } }))
            .toEqual({ q1: { home: 0, away: 0 }, final: { home: 28, away: 24 } });
    });

    it('is empty for a pool with no scores, and skips a half-written one', () => {
        expect(finalScoresOf(undefined)).toEqual({});
        expect(finalScoresOf({ q1: { home: 7 } })).toEqual({});
    });
});

describe('squaresGameHasStarted', () => {
    const NOW = Date.parse('2026-11-26T18:00:00Z');
    const before = '2026-11-26T21:30:00Z';

    it('not started: no scores, or a pre-game pool with kickoff still ahead', () => {
        expect(squaresGameHasStarted({}, NOW)).toBe(false);
        expect(squaresGameHasStarted({ scores: { gameStatus: 'pre', startTime: before, current: null } }, NOW)).toBe(false);
        expect(squaresGameHasStarted({ scores: { gameStatus: 'pre', current: { home: 0, away: 0 } } }, NOW)).toBe(false);
    });

    it('started on any one signal', () => {
        expect(squaresGameHasStarted({ scores: { gameStatus: 'in', startTime: before } }, NOW)).toBe(true);
        expect(squaresGameHasStarted({ scores: { gameStatus: 'post', startTime: before } }, NOW)).toBe(true);
        expect(squaresGameHasStarted({ scores: { gameStatus: 'pre', q1: { home: 0, away: 0 }, startTime: before } }, NOW)).toBe(true);
        expect(squaresGameHasStarted({ scores: { gameStatus: 'pre', current: { home: 0, away: 3 }, startTime: before } }, NOW)).toBe(true);
        expect(squaresGameHasStarted({ scores: { gameStatus: 'pre', startTime: '2026-11-26T17:59:00Z' } }, NOW)).toBe(true);
        expect(squaresGameHasStarted({ scores: { gameStatus: 'pre', startTime: NOW - 1 } }, NOW)).toBe(true);
    });

    it('an unreadable kickoff time is not treated as "already passed"', () => {
        expect(squaresGameHasStarted({ scores: { gameStatus: 'pre', startTime: 'TBD' } }, NOW)).toBe(false);
        expect(squaresGameHasStarted({ scores: { gameStatus: 'pre', startTime: '' } }, NOW)).toBe(false);
        expect(squaresGameHasStarted({ scores: { gameStatus: 'pre', startTime: 0 } }, NOW)).toBe(false);
    });
});

describe('isUsableAxis', () => {
    it('accepts ten distinct digits on each side, in any order', () => {
        expect(isUsableAxis(IDENTITY)).toBe(true);
        expect(isUsableAxis({ home: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], away: [5, 6, 7, 8, 9, 0, 1, 2, 3, 4] })).toBe(true);
    });

    it('rejects anything a lock must replace rather than keep', () => {
        expect(isUsableAxis(null)).toBe(false);
        expect(isUsableAxis({})).toBe(false);
        expect(isUsableAxis({ home: IDENTITY.home })).toBe(false);
        expect(isUsableAxis({ home: [0, 1, 2], away: IDENTITY.away })).toBe(false);
        expect(isUsableAxis({ home: [0, 0, 2, 3, 4, 5, 6, 7, 8, 9], away: IDENTITY.away })).toBe(false);
        expect(isUsableAxis({ home: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], away: IDENTITY.away })).toBe(false);
    });
});
