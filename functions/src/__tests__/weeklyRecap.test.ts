import { describe, it, expect } from 'vitest';
import { buildWeeklyRecap } from '../nflScoringEngine';

// Regression for a real prod bug found by the NFL Phase-2 simulator's first
// live scoreNFLWeek call: the inline recapDoc literal set sharpOfWeek /
// closestTiebreaker / attritionCount to `undefined` whenever there was no
// sharp user, no MNF tiebreaker, or a non-Survivor pool — and Firestore's
// set() throws on any literal `undefined` field (no ignoreUndefinedProperties
// configured). That crashed EVERY normal scoreNFLWeek call in one of those
// cases (a Margin pool always hits this, since sharpUser is a Pick'em-only
// concept never populated for Margin/Survivor). No JSON key for an omitted
// optional field is the only representation Firestore accepts.
describe('buildWeeklyRecap', () => {
    it('omits sharpOfWeek/closestTiebreaker/attritionCount when nothing applies (Margin pool)', () => {
        const recap = buildWeeklyRecap({
            poolId: 'p1', week: 1, poolType: 'NFL_MARGIN',
            sharpUser: null, closestTie: null, aliveCount: 0, nowMs: 123,
        });
        expect(recap).toEqual({ id: 'week_1', poolId: 'p1', week: 1, createdAt: 123 });
        expect(JSON.stringify(recap)).not.toContain('undefined');
        expect(Object.values(recap).every(v => v !== undefined)).toBe(true);
    });

    it('includes sharpOfWeek and closestTiebreaker when present (Pick em pool)', () => {
        const recap = buildWeeklyRecap({
            poolId: 'p1', week: 1, poolType: 'NFL_PICKEM',
            sharpUser: { uid: 'u1', name: 'Alice', val: 3 },
            closestTie: { uid: 'u2', name: 'Bob', diff: 2 },
            aliveCount: 0, nowMs: 123,
        });
        expect(recap.sharpOfWeek).toEqual({ userId: 'u1', userName: 'Alice', score: 3 });
        expect(recap.closestTiebreaker).toEqual({ userId: 'u2', userName: 'Bob', diff: 2 });
        expect('attritionCount' in recap).toBe(false); // not a Survivor pool
    });

    it('includes attritionCount only for Survivor pools, even at 0', () => {
        const recap = buildWeeklyRecap({
            poolId: 'p1', week: 1, poolType: 'NFL_SURVIVOR',
            sharpUser: null, closestTie: null, aliveCount: 0, nowMs: 123,
        });
        expect(recap.attritionCount).toBe(0);
        expect('sharpOfWeek' in recap).toBe(false);
        expect('closestTiebreaker' in recap).toBe(false);
    });

    it('every produced recap is JSON-safe (no undefined leaks under any input combination)', () => {
        const users = [null, { uid: 'u', name: 'N', val: 1 }] as const;
        const ties = [null, { uid: 'u', name: 'N', diff: 1 }] as const;
        const types = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'];
        for (const sharpUser of users) {
            for (const closestTie of ties) {
                for (const poolType of types) {
                    const recap = buildWeeklyRecap({ poolId: 'p', week: 1, poolType, sharpUser, closestTie, aliveCount: 2 });
                    for (const v of Object.values(recap)) expect(v).not.toBeUndefined();
                }
            }
        }
    });
});
