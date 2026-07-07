/**
 * bundleSchema.test.ts — Unit tests for the canonical entitlement contract
 * (shared/schemas/bundle.ts) + the migration mapping (scripts/migrate-entitlements.mjs).
 *
 * Pure functions only — no Firestore. Runner: vitest.
 */
import { describe, it, expect } from 'vitest';
import {
  creditSatisfiesPool,
  statusAfterConsume,
  isPassLive,
  bundleDocSchema,
  creditDocSchema,
  MAX_CREDITS_PER_BUNDLE,
} from '../shared/schemas/bundle';
// The migration mapper is a pure ESM export from the repo-root script (plain
// .mjs, no types). Import it untyped, then re-type via a local signature so the
// assertions below type-check under tsc.
// @ts-expect-error — .mjs has no declaration file; typed via MapLegacyFn below.
import { mapLegacyUserToEntitlements as mapLegacyUserToEntitlementsRaw } from '../../../scripts/migrate-entitlements.mjs';

interface MigrationCredit {
  id: string;
  doc: {
    constraints: { poolType?: string; maxPlayersPerPool?: number };
    status: 'available' | 'used' | 'revoked';
    usedByPoolId?: string | null;
    usedAt?: number;
  };
}
interface MigrationBundle {
  id: string;
  doc: {
    ownerId: string;
    productKind: 'CREDIT_BUNDLE' | 'UNLIMITED_PASS';
    source: 'PURCHASE' | 'ADMIN_GRANT' | 'REFERRAL' | 'MIGRATION';
    productSnapshot: { name: string; price: number; poolType: string; maxPlayersPerPool: number };
    creditsTotal: number;
    creditsUsed: number;
    termEndsAt?: number;
    status: 'active' | 'revoked' | 'exhausted' | 'expired';
    createdAt: number;
  };
  credits: MigrationCredit[];
}
type MapLegacyFn = (
  uid: string,
  user: Record<string, unknown>,
  nowMs: number
) => { bundles: MigrationBundle[]; oldCount: number; newCount: number };
const mapLegacyUserToEntitlements = mapLegacyUserToEntitlementsRaw as MapLegacyFn;

describe('creditSatisfiesPool — constraint matching', () => {
  it('unconstrained credit satisfies any pool', () => {
    expect(creditSatisfiesPool(undefined, 'SQUARES', 25)).toBe(true);
    expect(creditSatisfiesPool({}, 'BRACKET', 100)).toBe(true);
  });

  it('poolType ALL satisfies any pool', () => {
    expect(creditSatisfiesPool({ poolType: 'ALL' }, 'NFL_PICKEM', 50)).toBe(true);
  });

  it('poolType must match exactly when set (not ALL)', () => {
    expect(creditSatisfiesPool({ poolType: 'SQUARES' }, 'SQUARES', 25)).toBe(true);
    expect(creditSatisfiesPool({ poolType: 'SQUARES' }, 'BRACKET', 25)).toBe(false);
  });

  it('maxPlayersPerPool is a ceiling: pool must be <= constraint', () => {
    expect(creditSatisfiesPool({ maxPlayersPerPool: 50 }, 'SQUARES', 50)).toBe(true);
    expect(creditSatisfiesPool({ maxPlayersPerPool: 50 }, 'SQUARES', 51)).toBe(false);
    // Unknown pool size (undefined) does not fail the ceiling check.
    expect(creditSatisfiesPool({ maxPlayersPerPool: 50 }, 'SQUARES', undefined)).toBe(true);
  });

  it('both constraints must hold together', () => {
    expect(creditSatisfiesPool({ poolType: 'BRACKET', maxPlayersPerPool: 25 }, 'BRACKET', 25)).toBe(true);
    expect(creditSatisfiesPool({ poolType: 'BRACKET', maxPlayersPerPool: 25 }, 'BRACKET', 26)).toBe(false);
    expect(creditSatisfiesPool({ poolType: 'BRACKET', maxPlayersPerPool: 25 }, 'SQUARES', 10)).toBe(false);
  });
});

describe('statusAfterConsume — exhausted transition at creditsUsed === creditsTotal', () => {
  it('stays active while credits remain', () => {
    expect(statusAfterConsume(3, 1)).toBe('active');
    expect(statusAfterConsume(3, 2)).toBe('active');
  });
  it('flips to exhausted exactly when the last credit is spent', () => {
    expect(statusAfterConsume(3, 3)).toBe('exhausted');
    expect(statusAfterConsume(1, 1)).toBe('exhausted');
  });
  it('treats over-consumption (defensive) as exhausted', () => {
    expect(statusAfterConsume(3, 4)).toBe('exhausted');
  });
});

describe('isPassLive — pass liveness', () => {
  const now = 1_000_000;
  it('is live only for an active pass before its term', () => {
    expect(isPassLive({ productKind: 'UNLIMITED_PASS', status: 'active', termEndsAt: now + 1000 }, now)).toBe(true);
  });
  it('is not live once expired by time', () => {
    expect(isPassLive({ productKind: 'UNLIMITED_PASS', status: 'active', termEndsAt: now - 1 }, now)).toBe(false);
  });
  it('is not live when revoked/expired status', () => {
    expect(isPassLive({ productKind: 'UNLIMITED_PASS', status: 'revoked', termEndsAt: now + 1000 }, now)).toBe(false);
    expect(isPassLive({ productKind: 'UNLIMITED_PASS', status: 'expired', termEndsAt: now + 1000 }, now)).toBe(false);
  });
  it('a CREDIT_BUNDLE is never a live pass', () => {
    expect(isPassLive({ productKind: 'CREDIT_BUNDLE', status: 'active', termEndsAt: undefined }, now)).toBe(false);
  });
});

describe('bundleDocSchema — cross-field invariants', () => {
  const base = {
    ownerId: 'u1',
    productSnapshot: { name: 'X', price: 0, poolType: 'ALL', maxPlayersPerPool: 9999 },
    creditsUsed: 0,
    status: 'active',
    createdAt: 0,
  };

  it('accepts a valid CREDIT_BUNDLE (no term, credits >= 1)', () => {
    const r = bundleDocSchema.safeParse({
      ...base, productKind: 'CREDIT_BUNDLE', source: 'PURCHASE', creditsTotal: 3,
    });
    expect(r.success).toBe(true);
  });

  it('rejects a CREDIT_BUNDLE carrying a termEndsAt (Pool Credits never expire)', () => {
    const r = bundleDocSchema.safeParse({
      ...base, productKind: 'CREDIT_BUNDLE', source: 'PURCHASE', creditsTotal: 3, termEndsAt: 123,
    });
    expect(r.success).toBe(false);
  });

  it('rejects creditsTotal > 100 at the schema (product-smell cap)', () => {
    const r = bundleDocSchema.safeParse({
      ...base, productKind: 'CREDIT_BUNDLE', source: 'ADMIN_GRANT', creditsTotal: MAX_CREDITS_PER_BUNDLE + 1,
    });
    expect(r.success).toBe(false);
  });

  it('accepts a valid UNLIMITED_PASS (term set, credits === 0)', () => {
    const r = bundleDocSchema.safeParse({
      ...base, productKind: 'UNLIMITED_PASS', source: 'PURCHASE', creditsTotal: 0, termEndsAt: 999,
    });
    expect(r.success).toBe(true);
  });

  it('rejects an UNLIMITED_PASS with no termEndsAt', () => {
    const r = bundleDocSchema.safeParse({
      ...base, productKind: 'UNLIMITED_PASS', source: 'PURCHASE', creditsTotal: 0,
    });
    expect(r.success).toBe(false);
  });

  it('rejects creditsUsed > creditsTotal', () => {
    const r = bundleDocSchema.safeParse({
      ...base, productKind: 'CREDIT_BUNDLE', source: 'PURCHASE', creditsTotal: 2, creditsUsed: 3,
    });
    expect(r.success).toBe(false);
  });
});

describe('creditDocSchema', () => {
  it('accepts an available credit with constraints', () => {
    expect(creditDocSchema.safeParse({ constraints: { poolType: 'SQUARES', maxPlayersPerPool: 25 }, status: 'available' }).success).toBe(true);
  });
  it('accepts a used credit with usedByPoolId', () => {
    expect(creditDocSchema.safeParse({ constraints: {}, status: 'used', usedByPoolId: 'p1', usedAt: 1 }).success).toBe(true);
  });
});

describe('mapLegacyUserToEntitlements — legacy→canonical migration mapping', () => {
  const NOW = 2_000_000;

  it('freePoolsAvailable → ONE CREDIT_BUNDLE (source MIGRATION) with N credit docs', () => {
    const { bundles, oldCount, newCount } = mapLegacyUserToEntitlements('u1', { freePoolsAvailable: 3 }, NOW);
    expect(bundles).toHaveLength(1);
    const b = bundles[0];
    expect(b.id).toBe('migrate_u1_freepools');
    expect(b.doc.productKind).toBe('CREDIT_BUNDLE');
    expect(b.doc.source).toBe('MIGRATION');
    expect(b.doc.creditsTotal).toBe(3);
    expect(b.credits).toHaveLength(3);
    expect(b.credits.every((c) => c.doc.status === 'available')).toBe(true);
    // Census parity: 3 old, 3 new.
    expect(oldCount).toBe(3);
    expect(newCount).toBe(3);
  });

  it('poolCredits[] → one credit doc each, preserving constraints, dropping expiry', () => {
    const { bundles } = mapLegacyUserToEntitlements('u2', {
      poolCredits: [
        { id: 'x', poolType: 'SQUARES', maxPlayersPerPool: 25, expiresAt: 123, isUsed: false },
        { id: 'y', poolType: 'ALL', maxPlayersPerPool: 9999, isUsed: true },
      ],
    }, NOW);
    expect(bundles).toHaveLength(1);
    const b = bundles[0];
    expect(b.doc.creditsTotal).toBe(2);
    // constrained credit
    expect(b.credits[0].doc.constraints).toEqual({ poolType: 'SQUARES', maxPlayersPerPool: 25 });
    expect(b.credits[0].doc.status).toBe('available');
    // ALL + 9999 → unconstrained; used credit preserved
    expect(b.credits[1].doc.constraints).toEqual({});
    expect(b.credits[1].doc.status).toBe('used');
    expect(b.doc.creditsUsed).toBe(1);
  });

  it('activeBundleType + bundleExpiresAt → ONE UNLIMITED_PASS (source MIGRATION)', () => {
    const { bundles, newCount } = mapLegacyUserToEntitlements('u3', {
      activeBundleType: 'unlimited_1yr',
      bundleExpiresAt: NOW + 1000,
    }, NOW);
    expect(bundles).toHaveLength(1);
    const b = bundles[0];
    expect(b.doc.productKind).toBe('UNLIMITED_PASS');
    expect(b.doc.source).toBe('MIGRATION');
    expect(b.doc.creditsTotal).toBe(0);
    expect(b.doc.termEndsAt).toBe(NOW + 1000);
    expect(b.doc.status).toBe('active');
    expect(b.credits).toHaveLength(0);
    expect(newCount).toBe(1);
  });

  it('an already-expired pass migrates with status expired', () => {
    const { bundles } = mapLegacyUserToEntitlements('u4', {
      activeBundleType: 'unlimited_1yr',
      bundleExpiresAt: NOW - 1,
    }, NOW);
    expect(bundles[0].doc.status).toBe('expired');
  });

  it('a user with all three legacy fields yields three bundles', () => {
    const { bundles, oldCount, newCount } = mapLegacyUserToEntitlements('u5', {
      freePoolsAvailable: 2,
      poolCredits: [{ id: 'a', poolType: 'ALL', maxPlayersPerPool: 9999, isUsed: false }],
      activeBundleType: 'unlimited_1yr',
      bundleExpiresAt: NOW + 5000,
    }, NOW);
    expect(bundles).toHaveLength(3);
    // old = 2 freepools + 1 poolCredit + 1 pass = 4
    expect(oldCount).toBe(4);
    // new = 2 credits + 1 credit + 1 pass(as one) = 4
    expect(newCount).toBe(4);
  });

  it('produces every migration bundle from the resulting docs as schema-valid', () => {
    const { bundles } = mapLegacyUserToEntitlements('u6', {
      freePoolsAvailable: 1,
      activeBundleType: 'unlimited_1yr',
      bundleExpiresAt: NOW + 1000,
    }, NOW);
    for (const b of bundles) {
      expect(bundleDocSchema.safeParse(b.doc).success).toBe(true);
      for (const c of b.credits) {
        expect(creditDocSchema.safeParse(c.doc).success).toBe(true);
      }
    }
  });

  it('a user with no legacy entitlement fields yields nothing', () => {
    const { bundles, oldCount, newCount } = mapLegacyUserToEntitlements('u7', { name: 'Bob' }, NOW);
    expect(bundles).toHaveLength(0);
    expect(oldCount).toBe(0);
    expect(newCount).toBe(0);
  });
});
