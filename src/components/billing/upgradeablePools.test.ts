import { describe, it, expect } from 'vitest';
import {
    isUpgradeableStatus,
    canCheckoutPool,
    upgradeablePools,
    upgradeStatusLabel,
} from './upgradeablePools';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES G3 — /pricing listed only trial/grace pools, so a
 * `free` pool that hit the 10-player wall had NO working upgrade path, even
 * though the lock banner and the lock email both send the commissioner here.
 */

describe('isUpgradeableStatus', () => {
    it.each(['trial', 'grace_period', 'free', 'locked'])('%s is upgradeable', (s) => {
        expect(isUpgradeableStatus(s)).toBe(true);
    });

    it('active is NOT — that pool is paid and has nothing to sell', () => {
        expect(isUpgradeableStatus('active')).toBe(false);
    });

    it('missing billing is treated as free, which IS upgradeable', () => {
        // BillingGate makes the same substitution (`billing?.status ?? 'free'`).
        expect(isUpgradeableStatus(undefined)).toBe(true);
        expect(isUpgradeableStatus(null)).toBe(true);
    });
});

describe('canCheckoutPool mirrors the server ownership rule', () => {
    it('accepts the owner', () => {
        expect(canCheckoutPool({ ownerId: 'u1' }, 'u1')).toBe(true);
    });

    it('accepts the legacy managerUid', () => {
        expect(canCheckoutPool({ ownerId: 'u1', managerUid: 'u2' }, 'u2')).toBe(true);
    });

    it('falls back to createdByUid when ownerId is an empty string', () => {
        // `||` not `??` — the same legacy case isPoolOwnerOrManager handles.
        expect(canCheckoutPool({ ownerId: '', createdByUid: 'u1' }, 'u1')).toBe(true);
    });

    it('refuses everyone else, so no pay button is offered that always fails', () => {
        expect(canCheckoutPool({ ownerId: 'u1' }, 'u9')).toBe(false);
        expect(canCheckoutPool({ ownerId: 'u1' }, undefined)).toBe(false);
        expect(canCheckoutPool(null, 'u1')).toBe(false);
    });
});

describe('upgradeablePools', () => {
    const pools = [
        { id: 'a', ownerId: 'u1', billing: { status: 'trial' as const } },
        { id: 'b', ownerId: 'u1', billing: { status: 'free' as const } },
        { id: 'c', ownerId: 'u1', billing: { status: 'locked' as const } },
        { id: 'd', ownerId: 'u1', billing: { status: 'grace_period' as const } },
        { id: 'e', ownerId: 'u1', billing: { status: 'active' as const } },
        { id: 'f', ownerId: 'someone-else', billing: { status: 'free' as const } },
    ];

    it('lists every unpaid pool the user owns, and only those', () => {
        expect(upgradeablePools(pools, 'u1').map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('includes the free pool at the player wall — the case that dead-ended', () => {
        expect(upgradeablePools(pools, 'u1').some((p) => p.id === 'b')).toBe(true);
    });

    it('returns nothing for a signed-out user', () => {
        expect(upgradeablePools(pools, undefined)).toEqual([]);
    });
});

describe('upgradeStatusLabel', () => {
    it('stops calling every pool a trial', () => {
        expect(upgradeStatusLabel('trial')).toBe('Trial');
        expect(upgradeStatusLabel('free')).toBe('Free plan');
        expect(upgradeStatusLabel('locked')).toBe('Locked');
        expect(upgradeStatusLabel('grace_period')).toBe('Grace period');
        expect(upgradeStatusLabel(undefined)).toBe('Free plan');
    });
});
