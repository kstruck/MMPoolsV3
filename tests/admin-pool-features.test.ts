import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { adminSetPoolFeatureSchema } from '../functions/src/schemas/adminBillingOps';
import { ADDON_KEYS } from '../shared/schemas/quote';

/**
 * C1 (Kevin, 2026-08-23): "I, as the super-admin must be able to turn the
 * feature on for any pool at any time through a toggle switch or something."
 *
 * The server capability PARTLY existed: `adminUpdatePoolBilling({action:
 * 'override'})` merges an arbitrary billing object onto one pool, so it could
 * already set `billing.featuresUnlocked`. What was missing was (a) any UI and
 * (b) a NARROW, auditable action — an `admin_audit` row reading
 * POOL_BILLING_OVERRIDE tells nobody which feature moved, or which way.
 */
const repoRoot = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

const ops = read('functions/src/adminBillingOps.ts');
const index = read('functions/src/index.ts');
const admin = read('src/components/SuperAdmin.tsx');
const dbService = read('src/services/dbService.ts');

describe('the input is a closed list, not an arbitrary billing blob', () => {
  it('accepts every add-on key', () => {
    for (const feature of ADDON_KEYS) {
      expect(adminSetPoolFeatureSchema.safeParse({ poolId: 'p1', feature, enabled: true }).success).toBe(true);
    }
  });

  it('refuses a key that is not an add-on', () => {
    expect(adminSetPoolFeatureSchema.safeParse({ poolId: 'p1', feature: 'status', enabled: true }).success).toBe(false);
    expect(adminSetPoolFeatureSchema.safeParse({ poolId: 'p1', feature: 'paid', enabled: true }).success).toBe(false);
  });

  it('is strict — no extra keys ride along', () => {
    expect(adminSetPoolFeatureSchema.safeParse({
      poolId: 'p1', feature: 'aiCommissioner', enabled: true, tier: 'premium_tier',
    }).success).toBe(false);
  });

  it('requires an explicit boolean, so a missing value cannot read as OFF', () => {
    expect(adminSetPoolFeatureSchema.safeParse({ poolId: 'p1', feature: 'aiCommissioner' }).success).toBe(false);
  });
});

describe('the grant is SUPER_ADMIN-only and audited', () => {
  it('declares the role at the gate', () => {
    expect(ops).toContain('label: "adminSetPoolFeature", role: "SUPER_ADMIN"');
  });

  it('writes an admin_audit row that names the feature and the direction', () => {
    expect(ops).toContain('action: enabled ? "POOL_FEATURE_GRANT" : "POOL_FEATURE_REVOKE"');
    expect(ops).toContain('metadata: { feature, enabled, previous: outcome.before');
  });

  it('is exported', () => {
    expect(index).toContain('adminSetPoolFeature');
  });
});

describe('it moves the entitlement AND the paid ceiling, and nothing else', () => {
  it('writes featuresUnlocked and paid.addons together', () => {
    expect(ops).toContain('[`billing.featuresUnlocked.${feature}`]: enabled');
    expect(ops).toContain('patch["billing.paid.addons"] = nextAddons');
  });

  it('only touches the paid ceiling when the pool HAS one', () => {
    // `assertPaidCeilingForUpdate` returns early when `billing.paid` is absent;
    // writing it here would invent a purchase record on a free or trial pool and
    // switch the ceiling gate on for a pool that never bought anything.
    expect(ops).toContain('if (billing?.paid) patch["billing.paid.addons"]');
  });

  it('claims no money moved', () => {
    // A grant is not a sale. The handler must not touch status/tier/pricePaid,
    // and must not write a billing_charges row.
    const handler = ops.slice(ops.indexOf('export const adminSetPoolFeature'), ops.indexOf('adminAdjustUserCredits'));
    expect(handler).not.toContain('billing.status');
    expect(handler).not.toContain('pricePaid');
    expect(handler).not.toContain('billing_charges');
  });

  it('uses update(), not set(), because these are dotted field paths', () => {
    // `set` with a key containing dots creates a LITERAL top-level field named
    // "billing.paid.addons" and the entitlement never lands.
    expect(ops).toContain('txn.update(poolRef, patch);');
  });

  it('is transactional, so two toggles on one pool cannot clobber each other', () => {
    expect(ops).toContain('runTransaction(async (txn) => {');
  });
});

describe('the Super-Admin surface offers it per pool', () => {
  it('goes through the audited callable, never a direct write', () => {
    expect(admin).toContain('dbService.adminSetPoolFeature(pool.id, key, !on)');
    expect(dbService).toContain("httpsCallable<{ poolId: string; feature: string; enabled: boolean }");
  });

  it('explains, then confirms — this is a money-adjacent grant', () => {
    expect(admin).toContain('toast.confirm({');
    expect(admin).toContain('with no payment recorded');
    // The AI add-on is the one that starts real spend, and the copy says so.
    expect(admin).toContain('bills real Gemini usage');
  });

  it('renders a real switch for every add-on key', () => {
    expect(admin).toContain('{ADDON_KEYS.map(key => {');
    expect(admin).toContain('role="switch"');
    expect(admin).toContain('aria-checked={on}');
  });

  it('labels every key the schema has, including the ones nothing sells', () => {
    for (const key of ADDON_KEYS) {
      expect(admin).toContain(`${key}: '`);
    }
  });
});
