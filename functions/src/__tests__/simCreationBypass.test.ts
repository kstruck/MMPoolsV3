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
});
