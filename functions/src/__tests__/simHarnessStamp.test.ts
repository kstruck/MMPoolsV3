import { describe, it, expect, vi } from 'vitest';

// Stub firebase-admin so poolOps → billing.ts top-level `admin.firestore()`
// does not crash at import (same pattern as poolOpsBilling.test.ts).
vi.mock('firebase-admin', () => {
    const firestore: any = () => ({ collection: () => ({ doc: () => ({}) }) });
    firestore.FieldValue = { increment: () => ({}), arrayUnion: () => ({}), delete: () => ({}) };
    firestore.Timestamp = { now: () => ({ toMillis: () => 0 }) };
    return { firestore, __esModule: true, default: { firestore } };
});

import { simRunIdForCreate, stripPrivilegedPoolFields } from '../poolOps';
import { simSeason } from '../simHarness';

// PLAN-TEST-SUITE 8f: simRunId is the sim harness trust anchor. It must be
// (a) stripped from every client payload, and (b) re-stamped only for
// SUPER_ADMIN callers with a well-formed run id.
describe('simRunId trust anchor', () => {
    it('is stripped from client create payloads', () => {
        const clean = stripPrivilegedPoolFields({ name: 'x', simRunId: 'sneaky-run' });
        expect(clean).not.toHaveProperty('simRunId');
    });

    it('stamps only for SUPER_ADMIN', () => {
        expect(simRunIdForCreate({ simRunId: 'run-12345' }, 'SUPER_ADMIN')).toBe('run-12345');
        expect(simRunIdForCreate({ simRunId: 'run-12345' }, 'COMMISSIONER')).toBeUndefined();
        expect(simRunIdForCreate({ simRunId: 'run-12345' }, undefined)).toBeUndefined();
    });

    it('rejects malformed run ids even for SUPER_ADMIN', () => {
        expect(simRunIdForCreate({ simRunId: 'X' }, 'SUPER_ADMIN')).toBeUndefined();
        expect(simRunIdForCreate({ simRunId: 'has spaces' }, 'SUPER_ADMIN')).toBeUndefined();
        expect(simRunIdForCreate({ simRunId: 42 }, 'SUPER_ADMIN')).toBeUndefined();
        expect(simRunIdForCreate({}, 'SUPER_ADMIN')).toBeUndefined();
    });

    it('simSeason produces a value no real ESPN import can generate', () => {
        expect(simSeason('run-12345')).toBe('sim-run-12345');
        // Real seasons are 4-digit year strings — the sim- prefix can never collide.
        expect(simSeason('run-12345')).not.toMatch(/^\d{4}$/);
    });
});
