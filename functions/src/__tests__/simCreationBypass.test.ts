import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Minimal firebase-admin mock: assertPoolCreationAllowed reads exactly
// system/config once. Configurable per test via h.configData.
const h = vi.hoisted(() => ({ configData: {} as Record<string, unknown> }));
vi.mock('firebase-admin', () => {
    const firestore: unknown = () => ({
        collection: () => ({
            doc: () => ({
                get: async () => ({ exists: true, data: () => h.configData }),
            }),
        }),
    });
    return { default: { firestore, apps: [{}] }, firestore, apps: [{}] };
});
import { assertPoolCreationAllowed, assertPoolTypePurchasable } from '../lib/systemGuards';
import { HARD_CLOSED_POOL_TYPES } from '../lib/featureFlags';
import { simRunIdForCreate } from '../poolOps';

// The bypass is keyed on the STAMPED trust anchor: simBypass is passed as
// `simRunIdForCreate(payload, claimRole) !== undefined` at every wired call
// site, so these tests pin the anchor's gate legs — the same value that gets
// persisted on the pool doc is the only thing that can clear the kill-switch.
describe('bypass key = simRunIdForCreate (the stamped trust anchor)', () => {
    it('SUPER_ADMIN + well-formed run id = stamped (the E2E path)', () => {
        expect(simRunIdForCreate({ simRunId: 'run-abc123-xy' }, 'SUPER_ADMIN')).toBe('run-abc123-xy');
    });

    it('non-admin with a FORGED run id gets nothing — role leg is server-verified', () => {
        expect(simRunIdForCreate({ simRunId: 'run-abc123-xy' }, 'USER')).toBeUndefined();
        expect(simRunIdForCreate({ simRunId: 'run-abc123-xy' }, undefined)).toBeUndefined();
    });

    it('SUPER_ADMIN without a well-formed run id gets nothing — a real pool cannot clear the flag', () => {
        expect(simRunIdForCreate({}, 'SUPER_ADMIN')).toBeUndefined();
        expect(simRunIdForCreate({ simRunId: 'BAD ID!' }, 'SUPER_ADMIN')).toBeUndefined();
        expect(simRunIdForCreate({ simRunId: ['run-x'] }, 'SUPER_ADMIN')).toBeUndefined();
    });
});

describe('assertPoolCreationAllowed ordering (mutation anchor)', () => {
    it('MAINTENANCE BEATS BYPASS — a sim run during maintenance mode still refuses', async () => {
        h.configData = { maintenanceMode: true, poolTypeFlags: { NFL_PICKEM: true } };
        await expect(assertPoolCreationAllowed('NFL_PICKEM', { simBypass: true }))
            .rejects.toThrow(/maintenance/i);
    });

    it('bypass clears ONLY the disabled type flag', async () => {
        h.configData = { maintenanceMode: false, poolTypeFlags: { NFL_PICKEM: false } };
        await expect(assertPoolCreationAllowed('NFL_PICKEM', { simBypass: true })).resolves.toBeUndefined();
        await expect(assertPoolCreationAllowed('NFL_PICKEM')).rejects.toThrow(/temporarily disabled/);
    });


    /**
     * 🛑 THE BYPASS DOES NOT CROSS A HARD-CLOSED TYPE (codex r2, 2026-08-28).
     *
     * `HARD_CLOSED_POOL_TYPES` claims that NOTHING creates the type while it is
     * listed. The sim path is a SUPER_ADMIN path, so a carve-out here would
     * make that claim false — and would let the simulator mint squares pools
     * that exercise the very defect the closure exists to hide.
     */
    it('a hard-closed type is refused even WITH a stamped sim run id', async () => {
        for (const type of HARD_CLOSED_POOL_TYPES) {
            await expect(assertPoolCreationAllowed(type, { simBypass: true }))
                .rejects.toThrow(/temporarily disabled/);
            await expect(assertPoolCreationAllowed(type))
                .rejects.toThrow(/temporarily disabled/);
        }
    });

    it('...while the bypass still works for every type that is NOT hard-closed', async () => {
        // The planted counter-example: if the new check had been written to
        // catch everything, the whole sim harness would have gone down with it.
        expect(HARD_CLOSED_POOL_TYPES).not.toContain('NFL_PICKEM');
        await expect(assertPoolCreationAllowed('NFL_PICKEM', { simBypass: true })).resolves.toBeUndefined();
        await expect(assertPoolCreationAllowed('NFL_SURVIVOR', { simBypass: true })).resolves.toBeUndefined();
        await expect(assertPoolCreationAllowed('NFL_MARGIN', { simBypass: true })).resolves.toBeUndefined();
    });});

/**
 * PURCHASE AND ACTIVATION, NOT ONLY CREATION (codex r3, 2026-08-28).
 *
 * Kevin's instruction was "purchased OR setup". Closing creation leaves a
 * commissioner who ALREADY holds a draft or trial squares pool able to take it
 * through Stripe checkout, the $0 path, or a bundle credit. `createCheckoutSession`
 * and `redeemPoolCreditForPool` both consult this guard against the PERSISTED
 * pool type.
 */
describe('assertPoolTypePurchasable', () => {
    it('refuses every hard-closed type', () => {
        for (const type of HARD_CLOSED_POOL_TYPES) {
            expect(() => assertPoolTypePurchasable(type)).toThrow(/cannot be purchased or upgraded/);
        }
    });

    it('allows the three live NFL types, and every other open type', () => {
        // The planted counter-example: a guard written too wide would have
        // stopped Kevin's own customers paying during launch week.
        for (const type of ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN', 'BRACKET', 'PROPS', 'NFL_PLAYOFFS']) {
            expect(() => assertPoolTypePurchasable(type), type).not.toThrow();
        }
    });

    it('an absent or malformed type is not refused — it is not a hard-closed one', () => {
        // A legacy pool doc with no `type` must not be bricked out of billing by
        // a guard whose whole job is to name ONE type.
        expect(() => assertPoolTypePurchasable(undefined)).not.toThrow();
        expect(() => assertPoolTypePurchasable(null)).not.toThrow();
        expect(() => assertPoolTypePurchasable('')).not.toThrow();
        expect(() => assertPoolTypePurchasable('NOT_A_POOL_TYPE')).not.toThrow();
    });

    it('is consulted against the PERSISTED type at both purchase paths', () => {
        // The client sends its own `poolType` to createCheckoutSession; reading
        // that instead would let a caller simply send a different string.
        const stripe = readFileSync(resolve(__dirname, '..', 'stripe.ts'), 'utf8');
        expect(stripe).toContain('assertPoolTypePurchasable(poolData?.type);');
        const ent = readFileSync(resolve(__dirname, '..', 'entitlements.ts'), 'utf8');
        expect(ent).toContain('assertPoolTypePurchasable(pool.type);');
    });
});
