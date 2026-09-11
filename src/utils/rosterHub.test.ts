import { describe, it, expect } from 'vitest';
import type { Pool } from '../types';
import { getPoolTabStatus, isCanceledPool, isMyEntryPool } from './rosterHub';

const ME = 'uid-me';
const OTHER = 'uid-other';

/** Minimal pool shapes — only the fields the helpers read. */
const pool = (overrides: Record<string, unknown>): Pool =>
    ({ id: 'p1', name: 'Pool', participantIds: [ME, OTHER], ...overrides }) as unknown as Pool;

describe('rosterHub — canceled pools leave the roster tabs (prod RXCaFRqa1buTau8uYoda)', () => {
    /** Exactly what `cancelPool` (functions/src/poolExceptions.ts) writes: status only, no isFinal/finalizedAt. */
    const canceledPickem = pool({
        type: 'NFL_PICKEM',
        status: 'CANCELED',
        isLocked: false,
        cancelledAt: 1789101663593,
        cancelReason: 'Not enough players',
    });

    it('a canceled NFL pool is Completed, not Open — the tab reader must honour status', () => {
        expect(getPoolTabStatus(canceledPickem)).toBe('completed');
    });

    it('a canceled pool is not one of my entries even though participantIds still lists me', () => {
        expect(isMyEntryPool(canceledPickem, ME)).toBe(false);
    });

    it('isCanceledPool is case-insensitive and false for every other status', () => {
        expect(isCanceledPool({ status: 'CANCELED' })).toBe(true);
        expect(isCanceledPool({ status: 'canceled' })).toBe(true);
        expect(isCanceledPool({ status: 'OPEN' })).toBe(false);
        expect(isCanceledPool({ status: 'COMPLETED' })).toBe(false);
        expect(isCanceledPool({})).toBe(false);
        expect(isCanceledPool({ status: 7 })).toBe(false);
    });
});

describe('rosterHub — the live/open/completed rules the component had are unchanged', () => {
    it('NFL season pool: open when unlocked, live when locked', () => {
        expect(getPoolTabStatus(pool({ type: 'NFL_PICKEM', status: 'OPEN', isLocked: false }))).toBe('open');
        expect(getPoolTabStatus(pool({ type: 'NFL_PICKEM', status: 'OPEN', isLocked: true }))).toBe('live');
    });

    it('NFL season pool the finalizer stamped (finalizedAt only, status untouched) is Completed', () => {
        expect(getPoolTabStatus(pool({ type: 'NFL_PICKEM', status: 'OPEN', isLocked: true, finalizedAt: { seconds: 1 } }))).toBe('completed');
    });

    it('SQUARES: game post → completed, locked → live, otherwise open', () => {
        expect(getPoolTabStatus(pool({ type: 'SQUARES', scores: { gameStatus: 'post' }, isLocked: true }))).toBe('completed');
        expect(getPoolTabStatus(pool({ type: 'SQUARES', scores: { gameStatus: 'in' }, isLocked: true }))).toBe('live');
        expect(getPoolTabStatus(pool({ type: 'SQUARES', scores: { gameStatus: 'pre' }, isLocked: false }))).toBe('open');
    });

    it('BRACKET: COMPLETED → completed, LOCKED or past lockAt → live, else open', () => {
        expect(getPoolTabStatus(pool({ type: 'BRACKET', status: 'COMPLETED', lockAt: 0 }))).toBe('completed');
        expect(getPoolTabStatus(pool({ type: 'BRACKET', status: 'LOCKED', lockAt: 0 }))).toBe('live');
        expect(getPoolTabStatus(pool({ type: 'BRACKET', status: 'OPEN', lockAt: Date.now() - 1000 }))).toBe('live');
        expect(getPoolTabStatus(pool({ type: 'BRACKET', status: 'OPEN', lockAt: Date.now() + 60_000 }))).toBe('open');
    });

    it('an admin-closed pool (closedVia ADMIN_CLOSE) is Completed', () => {
        expect(getPoolTabStatus(pool({ type: 'NFL_SURVIVOR', status: 'COMPLETED', closedVia: 'ADMIN_CLOSE' }))).toBe('completed');
    });

    it('a completed pool I played is still one of my entries; a pool I never joined is not', () => {
        expect(isMyEntryPool(pool({ type: 'NFL_PICKEM', status: 'COMPLETED' }), ME)).toBe(true);
        expect(isMyEntryPool(pool({ type: 'NFL_PICKEM', status: 'OPEN', participantIds: [OTHER] }), ME)).toBe(false);
        expect(isMyEntryPool(pool({ type: 'NFL_PICKEM', status: 'OPEN', participantIds: undefined }), ME)).toBe(false);
    });
});

describe('rosterHub — codex r1 absorptions', () => {
    it('a legacy squares doc with no `type` and a finished game is still Completed', () => {
        expect(getPoolTabStatus(pool({ type: undefined, scores: { gameStatus: 'post' }, isLocked: true }))).toBe('completed');
        expect(getPoolTabStatus(pool({ type: undefined, scores: { gameStatus: 'in' }, isLocked: true }))).toBe('live');
    });
});
