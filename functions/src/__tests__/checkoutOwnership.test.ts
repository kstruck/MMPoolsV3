import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// stripe.ts touches admin.firestore() at module load — stub the SDK so the pure
// gate can be imported (same shape as entitlements.test.ts).
vi.mock('firebase-admin', () => {
  const firestore: any = () => ({});
  firestore.FieldValue = { delete: () => null, serverTimestamp: () => 0, increment: (n: number) => ({ __inc__: n }) };
  return { default: { firestore, apps: [], initializeApp: () => undefined }, firestore, apps: [], initializeApp: () => undefined };
});
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { delete: () => null, serverTimestamp: () => 0, increment: (n: number) => ({ __inc__: n }) } }));

import { assertCheckoutOwnership } from '../stripe';

/**
 * PLAN-COMMISSIONER-TRANSFER K17, shipped standalone (Kevin 2026-08-17, per the
 * 2026-08-16 board memo): the pool-purchase path of createCheckoutSession is
 * owner/manager-only, or a SUPER_ADMIN whose claim AND live doc agree. Before
 * this any signed-in user could start a hosting checkout for any pool.
 */
const pool = { ownerId: 'owner', managerUid: 'mgr' };

describe('assertCheckoutOwnership (K17)', () => {
  it('admits the owner and the manager without any role', () => {
    expect(() => assertCheckoutOwnership(pool, 'owner', undefined, undefined)).not.toThrow();
    expect(() => assertCheckoutOwnership(pool, 'mgr', undefined, undefined)).not.toThrow();
  });
  it('falls back to createdByUid when ownerId is absent or empty (legacy pools)', () => {
    expect(() => assertCheckoutOwnership({ createdByUid: 'c' }, 'c', undefined, undefined)).not.toThrow();
    expect(() => assertCheckoutOwnership({ ownerId: '', createdByUid: 'c' }, 'c', undefined, undefined)).not.toThrow();
  });
  it('refuses a stranger — including one whose CLAIM says SUPER_ADMIN but whose live doc does not (demoted, stale token)', () => {
    expect(() => assertCheckoutOwnership(pool, 'x', undefined, undefined)).toThrow(/permission-denied|Only the pool commissioner/);
    expect(() => assertCheckoutOwnership(pool, 'x', 'SUPER_ADMIN', 'USER')).toThrow(/Only the pool commissioner/);
    expect(() => assertCheckoutOwnership(pool, 'x', 'SUPER_ADMIN', undefined)).toThrow(/Only the pool commissioner/);
    // and the reverse: a doc that says SA but a claim that does not is not enough either
    expect(() => assertCheckoutOwnership(pool, 'x', 'USER', 'SUPER_ADMIN')).toThrow(/Only the pool commissioner/);
  });
  it('admits a SUPER_ADMIN whose claim AND live doc agree (the audited support case)', () => {
    expect(() => assertCheckoutOwnership(pool, 'x', 'SUPER_ADMIN', 'SUPER_ADMIN')).not.toThrow();
  });
});

describe('createCheckoutSession — the gate is applied at the pre-read AND inside BOTH write transactions', () => {
  const src = readFileSync(resolve(__dirname, '..', 'stripe.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('three call sites: pre-read (ref.get()) and two in-transaction (txn.get)', () => {
    expect(src.match(/assertCheckoutOwnership\(poolData, userId, claimRole, await readCallerRole\(ref => ref\.get\(\)\)\)/g) ?? []).toHaveLength(1);
    expect(src.match(/assertCheckoutOwnership\(freshPool\.data\(\), userId, claimRole, await readCallerRole\(ref => txn\.get\(ref\)\)\)/g) ?? []).toHaveLength(2);
  });
  it('the bundle path is untouched: it returns before the pool read', () => {
    const fn = src.slice(src.indexOf('export const createCheckoutSession'));
    expect(fn.indexOf('createBundleCheckout(userId')).toBeLessThan(fn.indexOf('assertCheckoutOwnership(poolData'));
  });
});
