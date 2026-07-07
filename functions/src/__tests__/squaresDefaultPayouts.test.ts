import { describe, it, expect, vi } from 'vitest';

// Stub firebase-admin so poolOps → billing.ts top-level `admin.firestore()` does
// not crash at import (same pattern as poolOpsBilling.test.ts).
vi.mock('firebase-admin', () => {
    const firestore: any = () => ({ collection: () => ({ doc: () => ({}) }) });
    firestore.FieldValue = { increment: () => ({}), arrayUnion: () => ({}), delete: () => ({}) };
    firestore.Timestamp = { now: () => ({ toMillis: () => 0 }) };
    return { firestore, __esModule: true, default: { firestore } };
});

import { DEFAULT_SQUARES_PAYOUTS, stripPrivilegedPoolFields } from '../poolOps';

// Guards the squares payout pipeline: `payouts` is privileged (client value is
// stripped at create), so the server default is the ONLY thing standing between
// a new squares pool and $0 period payouts (scoreUpdates.ts getSafePayout
// returns 0 for a missing map).
describe('squares default payouts', () => {
    it('defaults distribute exactly 100% of the pot', () => {
        const total = Object.values(DEFAULT_SQUARES_PAYOUTS).reduce((s, v) => s + v, 0);
        expect(total).toBe(100);
    });

    it('covers every period scoreUpdates pays on', () => {
        expect(Object.keys(DEFAULT_SQUARES_PAYOUTS).sort()).toEqual(['final', 'half', 'q1', 'q3']);
    });

    it('client-supplied payouts are stripped, so the server default wins', () => {
        const clean = stripPrivilegedPoolFields({
            name: 'x',
            payouts: { q1: 100, half: 0, q3: 0, final: 0 },
        });
        expect(clean).not.toHaveProperty('payouts');
        expect(clean.name).toBe('x');
    });
});
