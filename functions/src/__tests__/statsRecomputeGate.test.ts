import { describe, it, expect, vi } from 'vitest';

// Same firebase-admin stub the other statsTrigger-adjacent unit suites use, so
// importing the module does not try to reach a real Firestore at load time.
vi.mock('firebase-admin', () => {
    const firestore: any = () => ({ collection: () => ({ doc: () => ({}) }), doc: () => ({}) });
    firestore.FieldValue = { increment: () => ({}), serverTimestamp: () => ({}) };
    firestore.FieldPath = class { constructor(public p: string) {} };
    return { firestore, __esModule: true, default: { firestore } };
});

import { readStatsRecomputeGate } from '../statsTrigger';

/**
 * The daily recompute's kill-switch (PLAN-STATS-INTEGRITY §8.3 step 2).
 *
 * Its only write target is `stats/global`, which `firestore.rules:470` makes
 * WORLD-READABLE. So both defaults have to fail safe, and both are pinned here:
 * absent config must not run the job, and `enabled: true` alone must not publish.
 */
describe('readStatsRecomputeGate', () => {
    it('absent config is DISABLED — a missing system/config never arms a money job', () => {
        expect(readStatsRecomputeGate(undefined)).toEqual({ enabled: false, dryRun: true });
        expect(readStatsRecomputeGate(null)).toEqual({ enabled: false, dryRun: true });
        expect(readStatsRecomputeGate({})).toEqual({ enabled: false, dryRun: true });
    });

    it('enabled must be the BOOLEAN true, not merely truthy', () => {
        // A console edit that stores the string "true" is a classic way to arm a
        // job by accident; it does not arm this one.
        expect(readStatsRecomputeGate({ enabled: 'true' }).enabled).toBe(false);
        expect(readStatsRecomputeGate({ enabled: 1 }).enabled).toBe(false);
        expect(readStatsRecomputeGate({ enabled: true }).enabled).toBe(true);
    });

    it('enabling alone stays DRY — arming is deliberately two steps', () => {
        expect(readStatsRecomputeGate({ enabled: true })).toEqual({ enabled: true, dryRun: true });
    });

    it('only an explicit dryRun:false publishes', () => {
        expect(readStatsRecomputeGate({ enabled: true, dryRun: false }))
            .toEqual({ enabled: true, dryRun: false });
        // Anything else — absent, "false" as a string, 0 — stays dry.
        for (const v of [undefined, 'false', 0, null]) {
            expect(readStatsRecomputeGate({ enabled: true, dryRun: v }).dryRun).toBe(true);
        }
    });
});
