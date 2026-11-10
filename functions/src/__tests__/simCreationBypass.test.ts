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
     * NO TYPE IS HARD-CLOSED (PLAN-SQUARES-REOPEN PR-D). The list held
     * 'SQUARES' from 2026-08-28 until that plan landed. The rule that the
     * bypass does not cross a hard-closed type is still true and is pinned with
     * a planted type in `hardClosedMechanism.test.ts` — a loop over an empty
     * list here would pass whatever the guard did.
     */
    it('nothing is hard-closed — squares was the only entry and it is reopened', () => {
        expect([...HARD_CLOSED_POOL_TYPES]).toEqual([]);
    });

    it('SQUARES is created when its flag is on, absent, or the config is empty', async () => {
        for (const cfg of [{}, { poolTypeFlags: {} }, { poolTypeFlags: { SQUARES: true } }, { maintenanceMode: false }]) {
            h.configData = cfg;
            await expect(assertPoolCreationAllowed('SQUARES')).resolves.toBeUndefined();
        }
    });

    it('SQUARES is refused when the runtime flag is off — the rollback that needs no deploy', async () => {
        h.configData = { poolTypeFlags: { SQUARES: false } };
        await expect(assertPoolCreationAllowed('SQUARES')).rejects.toThrow(/New SQUARES pools are temporarily disabled/);
        // ...and that flag closes squares only.
        await expect(assertPoolCreationAllowed('NFL_PICKEM')).resolves.toBeUndefined();
        await expect(assertPoolCreationAllowed('PROPS')).resolves.toBeUndefined();
    });

    it('SQUARES is refused in maintenance mode, like every type', async () => {
        h.configData = { maintenanceMode: true };
        await expect(assertPoolCreationAllowed('SQUARES')).rejects.toThrow(/maintenance/i);
    });

    it('...while the bypass still works for every type that is NOT hard-closed', async () => {
        // The planted counter-example: if the new check had been written to
        // catch everything, the whole sim harness would have gone down with it.
        // Its own config, not whatever the test before it left behind.
        h.configData = { maintenanceMode: false, poolTypeFlags: { NFL_PICKEM: false, NFL_SURVIVOR: false, NFL_MARGIN: false } };
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
    // "Refuses every hard-closed type" is pinned with a planted type in
    // `hardClosedMechanism.test.ts`: the list is empty since squares reopened,
    // and a loop over nothing proves nothing.
    it('allows every type, SQUARES included now that it is reopened', () => {
        // The planted counter-example: a guard written too wide would have
        // stopped Kevin's own customers paying during launch week.
        for (const type of ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN', 'BRACKET', 'PROPS', 'NFL_PLAYOFFS', 'SQUARES']) {
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
