import { describe, it, expect } from 'vitest';
import { poolUsesSpreads, spreadsBlockWeek } from './poolUsesSpreads';

const ATS = { type: 'NFL_PICKEM', settings: { pickMode: 'ATS' } };
const STRAIGHT = { type: 'NFL_PICKEM', settings: { pickMode: 'STRAIGHT' } };
const UNSET = { type: 'NFL_PICKEM', settings: {} };

const locked = { spread: { locked: true } };
const open = { spread: { locked: false } };
const noLine = {};

describe('poolUsesSpreads', () => {
    it('only an ATS pick’em pool consumes a spread', () => {
        expect(poolUsesSpreads(ATS)).toBe(true);
        expect(poolUsesSpreads(STRAIGHT)).toBe(false);
        expect(poolUsesSpreads(UNSET)).toBe(false);
        expect(poolUsesSpreads({ type: 'NFL_SURVIVOR', settings: { pickMode: 'ATS' } })).toBe(false);
        expect(poolUsesSpreads({ type: 'NFL_MARGIN', settings: { pickMode: 'ATS' } })).toBe(false);
        expect(poolUsesSpreads(undefined)).toBe(false);
    });
});

describe('spreadsBlockWeek', () => {
    it('blocks an ATS week until EVERY game of it carries a frozen line', () => {
        expect(spreadsBlockWeek(ATS, [locked, locked])).toBe(false);
        expect(spreadsBlockWeek(ATS, [locked, open])).toBe(true);
        expect(spreadsBlockWeek(ATS, [locked, noLine])).toBe(true);
        expect(spreadsBlockWeek(ATS, [noLine, noLine])).toBe(true);
    });

    it('never blocks a pool whose scoring does not read a spread', () => {
        // #214 scoped the server’s SPREADS_NOT_LOCKED the same way. A straight
        // pick’em preseason week has almost no lines and must still take picks.
        expect(spreadsBlockWeek(STRAIGHT, [noLine, noLine])).toBe(false);
        expect(spreadsBlockWeek(UNSET, [noLine])).toBe(false);
        expect(spreadsBlockWeek({ type: 'NFL_SURVIVOR' }, [noLine])).toBe(false);
    });

    it('an empty slate is not blocked — `every` over nothing is true, as on the server', () => {
        expect(spreadsBlockWeek(ATS, [])).toBe(false);
    });

    it('counts CANCELLED games too, because the server’s week query does', () => {
        // The client used to exempt them, which rendered an editable sheet whose
        // every submission came back SPREADS_NOT_LOCKED. There is deliberately no
        // status argument here: the predicate cannot be told to skip a game.
        expect(spreadsBlockWeek(ATS, [locked, { status: 'CANCELLED' } as { spread?: { locked?: boolean } }])).toBe(true);
    });
});
