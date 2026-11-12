import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/**
 * THE HARD-CLOSE MECHANISM, PINNED WITH A PLANTED TYPE.
 *
 * `HARD_CLOSED_POOL_TYPES` is empty since squares reopened (PLAN-SQUARES-
 * REOPEN PR-D). The mechanism is kept — it is how a type is closed so that no
 * config document, no simulator bypass and no purchase path can reopen it — and
 * a mechanism with nothing in its list is exactly the kind that rots unnoticed:
 * every test that looped over the list now loops over nothing.
 *
 * So this file plants a type in the list and holds the guard to its three
 * promises. PROPS is the plant; nothing about it is special.
 */
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

// Planted into the REAL list, so the real guard and the real
// `isPoolTypeEnabled` are what run — not a mock of either.
beforeAll(() => { (HARD_CLOSED_POOL_TYPES as string[]).push('PROPS'); });
afterAll(() => { (HARD_CLOSED_POOL_TYPES as string[]).length = 0; });

describe('a type listed in HARD_CLOSED_POOL_TYPES', () => {
    it('is refused at creation, whatever the config says', async () => {
        for (const cfg of [{}, { poolTypeFlags: { PROPS: true } }, { maintenanceMode: false, poolTypeFlags: { PROPS: true } }]) {
            h.configData = cfg;
            await expect(assertPoolCreationAllowed('PROPS')).rejects.toThrow(/New PROPS pools are temporarily disabled/);
        }
    });

    it('is refused even WITH the simulator bypass — the bypass is a SUPER_ADMIN path, not an exemption', async () => {
        h.configData = { poolTypeFlags: { PROPS: true } };
        await expect(assertPoolCreationAllowed('PROPS', { simBypass: true })).rejects.toThrow(/temporarily disabled/);
    });

    it('cannot be purchased or activated', () => {
        expect(() => assertPoolTypePurchasable('PROPS')).toThrow(/cannot be purchased or upgraded/);
    });

    it('closes that type ONLY — every other type is created, bypassed and purchased as before', async () => {
        h.configData = {};
        for (const type of ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN', 'SQUARES', 'BRACKET']) {
            await expect(assertPoolCreationAllowed(type as never), type).resolves.toBeUndefined();
            await expect(assertPoolCreationAllowed(type as never, { simBypass: true }), type).resolves.toBeUndefined();
            expect(() => assertPoolTypePurchasable(type), type).not.toThrow();
        }
    });
});
