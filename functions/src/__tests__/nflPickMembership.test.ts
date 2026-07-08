import { describe, it, expect, vi } from 'vitest';

// Stub firebase-admin so nflPools → billing.ts top-level `admin.firestore()`
// does not crash at import (same pattern as poolOpsBilling.test.ts).
vi.mock('firebase-admin', () => {
    const firestore: any = () => ({ collection: () => ({ doc: () => ({}) }) });
    firestore.FieldValue = { increment: () => ({}), arrayUnion: () => ({}), delete: () => ({}) };
    firestore.Timestamp = { now: () => ({ toMillis: () => 0 }) };
    return { firestore, __esModule: true, default: { firestore } };
});

import { assertNFLPickMembership } from '../nflPools';

// PLAN-TEST-SUITE item 11: submitNFLPicks previously accepted picks from ANY
// authenticated user. The gate must reject non-members and admit participants,
// owner/manager, and SUPER_ADMIN.
describe('assertNFLPickMembership', () => {
    const pool = {
        participantIds: ['member-1', 'owner-1'],
        ownerId: 'owner-1',
        managerUid: 'manager-1',
        createdByUid: 'owner-1',
    };

    it('rejects an authenticated non-member', () => {
        expect(() => assertNFLPickMembership(pool, 'stranger', undefined))
            .toThrowError(/NOT_POOL_MEMBER/);
    });

    it('admits a participant', () => {
        expect(() => assertNFLPickMembership(pool, 'member-1', undefined)).not.toThrow();
    });

    it('admits the owner and the manager even if not in participantIds', () => {
        expect(() => assertNFLPickMembership(pool, 'manager-1', undefined)).not.toThrow();
        expect(() => assertNFLPickMembership({ ...pool, participantIds: [] }, 'owner-1', undefined)).not.toThrow();
    });

    it('admits SUPER_ADMIN regardless of membership', () => {
        expect(() => assertNFLPickMembership(pool, 'stranger', 'SUPER_ADMIN')).not.toThrow();
    });

    it('rejects when participantIds is missing or malformed', () => {
        expect(() => assertNFLPickMembership({}, 'stranger', undefined)).toThrowError(/NOT_POOL_MEMBER/);
        expect(() => assertNFLPickMembership({ participantIds: 'not-an-array' }, 'stranger', undefined))
            .toThrowError(/NOT_POOL_MEMBER/);
    });
});
