import { describe, it, expect, vi } from 'vitest';

// Stub firebase-admin so nflPools → billing.ts top-level `admin.firestore()`
// does not crash at import (same pattern as poolOpsBilling.test.ts).
vi.mock('firebase-admin', () => {
    const firestore: any = () => ({ collection: () => ({ doc: () => ({}) }) });
    firestore.FieldValue = { increment: () => ({}), arrayUnion: () => ({}), delete: () => ({}) };
    firestore.Timestamp = { now: () => ({ toMillis: () => 0 }) };
    return { firestore, __esModule: true, default: { firestore } };
});

import { assertNFLPickMembership, assertJoinCapacity } from '../nflPools';
import { FREE_PLAN_PARTICIPANT_CAP } from '../shared/freePlanCap';

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

// PLAN-ADMIN-PICK-IMPLICIT-JOIN: the seat gates joinNFLPool applies, hoisted so
// the implicit join in submitNFLPicks runs the SAME two checks. `count` is the
// roster size BEFORE the joiner.
describe('assertJoinCapacity', () => {
    it('admits a joiner while a free pool is under the cap', () => {
        expect(() => assertJoinCapacity({ billing: { status: 'free' } }, FREE_PLAN_PARTICIPANT_CAP - 1)).not.toThrow();
    });

    it('refuses the joiner that would exceed the free cap', () => {
        expect(() => assertJoinCapacity({ billing: { status: 'free' } }, FREE_PLAN_PARTICIPANT_CAP))
            .toThrowError(/full/i);
    });

    it('treats a missing billing block as free', () => {
        expect(() => assertJoinCapacity({}, FREE_PLAN_PARTICIPANT_CAP)).toThrowError(/full/i);
        expect(() => assertJoinCapacity({ billing: null }, 0)).not.toThrow();
    });

    it('enforces a PAID pool\'s purchased ceiling and ignores the free cap', () => {
        const paid = { billing: { status: 'paid', paid: { maxPlayersAllowed: 25 } } };
        expect(() => assertJoinCapacity(paid, FREE_PLAN_PARTICIPANT_CAP)).not.toThrow();
        expect(() => assertJoinCapacity(paid, 24)).not.toThrow();
        expect(() => assertJoinCapacity(paid, 25)).toThrowError(/full/i);
    });

    it('a trial pool has no seat limit', () => {
        expect(() => assertJoinCapacity({ billing: { status: 'trial' } }, 500)).not.toThrow();
    });
});

// qodo #3 on PR #686: `ownerId` is canonical, `createdByUid` a fallback ONLY when
// it is absent (poolOps isPoolOwnerOrManager). A stale creator on a pool whose
// two fields disagree is NOT a host — the implicit join would otherwise hand
// them durable roster membership.
describe('assertNFLPickMembership — host precedence', () => {
    it('admits createdByUid only when ownerId is absent', () => {
        expect(() => assertNFLPickMembership({ participantIds: [], createdByUid: 'creator' }, 'creator', undefined)).not.toThrow();
        expect(() => assertNFLPickMembership({ participantIds: [], ownerId: '', createdByUid: 'creator' }, 'creator', undefined)).not.toThrow();
    });

    it('rejects a stale creator when a different ownerId is present', () => {
        expect(() => assertNFLPickMembership({ participantIds: [], ownerId: 'owner-2', createdByUid: 'creator' }, 'creator', undefined))
            .toThrowError(/NOT_POOL_MEMBER/);
    });

    it('managerUid is a separate principal, not dropped by an owner being present', () => {
        expect(() => assertNFLPickMembership({ participantIds: [], ownerId: 'owner-2', createdByUid: 'creator', managerUid: 'mgr' }, 'mgr', undefined)).not.toThrow();
    });
});
