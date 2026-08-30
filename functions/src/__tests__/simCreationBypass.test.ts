import { describe, it, expect, vi } from 'vitest';

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
import { assertPoolCreationAllowed } from '../lib/systemGuards';
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
