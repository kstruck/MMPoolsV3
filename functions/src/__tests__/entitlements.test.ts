/**
 * entitlements.test.ts — Transactional logic for grant / redeem / revoke
 * (functions/src/entitlements.ts).
 *
 * The default vitest gate has no live Firestore, so this drives the exported
 * transaction helpers (grantEntitlementTxn, redeemPoolCreditForPool,
 * revokeEntitlementTxn) against a small in-memory Firestore fake. firebase-admin
 * is mocked so `admin.firestore()` (called at module load) returns that fake, and
 * `FieldValue.delete()` yields a sentinel the fake honors.
 *
 * Covered (per the ticket):
 *   - redemption picks a valid credit; rejects used / revoked / constraint-
 *     violating / expired-bundle credits;
 *   - revoke voids only AVAILABLE credits (used untouched);
 *   - exhausted transition at creditsUsed === creditsTotal;
 *   - creditsTotal > 100 rejected at grant.
 *
 * Runner: vitest.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- In-memory Firestore fake ------------------------------------------------
// Path-keyed doc store. Supports collection()/doc() nesting, get/set/update, and
// where()-chained queries with equality filters over the fake's docs.
//
// Everything the firebase-admin mock factory needs is created inside vi.hoisted
// so it exists BEFORE the hoisted vi.mock() runs (entitlements.ts calls
// admin.firestore() at module load — no TDZ on `fakeDb`).

type DocData = Record<string, any>;

const h = vi.hoisted(() => {
  const DELETE_SENTINEL = { __delete__: true };
  const store = new Map<string, Record<string, any>>();

  const pathJoin = (...parts: string[]) => parts.join('/');
  const getField = (data: Record<string, any>, field: string) => {
    if (field === '__name__') return undefined;
    return field.split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), data);
  };

  class FakeQuery {
    constructor(public prefix: string, public filters: Array<[string, any]> = []) {}
    where(field: string, _op: string, value: any) {
      return new FakeQuery(this.prefix, [...this.filters, [field, value]]);
    }
    _matchingDocs() {
      const depth = this.prefix.split('/').length + 1;
      const out: Array<{ id: string; ref: FakeDocRef; data: Record<string, any> }> = [];
      for (const [path, data] of store.entries()) {
        if (!path.startsWith(this.prefix + '/')) continue;
        if (path.split('/').length !== depth) continue;
        const ok = this.filters.every(([f, v]) => getField(data, f) === v);
        if (!ok) continue;
        out.push({ id: path.slice(this.prefix.length + 1), ref: new FakeDocRef(path), data });
      }
      return out;
    }
  }
  class FakeCollectionRef extends FakeQuery {
    constructor(public path: string) { super(path, []); }
    doc(id?: string) {
      const realId = id ?? `auto_${Math.random().toString(36).slice(2, 10)}`;
      return new FakeDocRef(pathJoin(this.path, realId));
    }
  }
  class FakeDocRef {
    constructor(public path: string) {}
    get id() { const p = this.path.split('/'); return p[p.length - 1]; }
    collection(name: string) { return new FakeCollectionRef(pathJoin(this.path, name)); }
  }

  function applyUpdate(path: string, updates: Record<string, any>) {
    const cur = store.get(path) || {};
    const next = { ...cur };
    for (const [k, v] of Object.entries(updates)) {
      if (v === DELETE_SENTINEL) {
        if (k.includes('.')) {
          const keys = k.split('.');
          let o: any = next;
          for (let i = 0; i < keys.length - 1; i++) { o[keys[i]] = { ...(o[keys[i]] || {}) }; o = o[keys[i]]; }
          delete o[keys[keys.length - 1]];
        } else { delete next[k]; }
        continue;
      }
      if (k.includes('.')) {
        const keys = k.split('.');
        let o: any = next;
        for (let i = 0; i < keys.length - 1; i++) { o[keys[i]] = { ...(o[keys[i]] || {}) }; o = o[keys[i]]; }
        o[keys[keys.length - 1]] = v;
      } else { next[k] = v; }
    }
    store.set(path, next);
  }

  class FakeTxn {
    async get(target: any): Promise<any> {
      if (target instanceof FakeDocRef) {
        const data = store.get(target.path);
        return { exists: data !== undefined, id: target.id, ref: target, data: () => data };
      }
      const docs = (target as FakeQuery)._matchingDocs().map((d) => ({ id: d.id, ref: d.ref, data: () => d.data }));
      return { empty: docs.length === 0, size: docs.length, docs };
    }
    set(ref: FakeDocRef, data: Record<string, any>, opts?: { merge?: boolean }) {
      if (opts?.merge) applyUpdate(ref.path, data);
      else store.set(ref.path, { ...data });
    }
    update(ref: FakeDocRef, updates: Record<string, any>) { applyUpdate(ref.path, updates); }
  }

  const fakeDb = {
    collection: (name: string) => new FakeCollectionRef(name),
    runTransaction: async (fn: (txn: FakeTxn) => Promise<any>) => fn(new FakeTxn()),
  };

  return { store, DELETE_SENTINEL, FakeQuery, fakeDb };
});

const store = h.store;
const fakeDb = h.fakeDb;
const FakeQuery = h.FakeQuery;

// --- Mocks (hoisted above imports; reference only the hoisted handle `h`) -----

vi.mock('firebase-admin', () => {
  const firestore: any = () => h.fakeDb;
  firestore.FieldValue = { delete: () => h.DELETE_SENTINEL, serverTimestamp: () => 0, increment: (n: number) => ({ __inc__: n }) };
  return { default: { firestore, apps: [], initializeApp: () => undefined }, firestore, apps: [], initializeApp: () => undefined };
});
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => h.DELETE_SENTINEL, serverTimestamp: () => 0, increment: (n: number) => ({ __inc__: n }) },
}));
vi.mock('../lib/adminAudit', () => ({ writeAdminAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../adminClaims', () => ({ assertCallerRole: vi.fn().mockResolvedValue({ uid: 'admin1', email: 'a@x.com' }) }));

// Import AFTER mocks are set up.
import {
  grantEntitlementTxn,
  redeemPoolCreditForPool,
  revokeEntitlementTxn,
  type ProductSnapshot,
} from '../entitlements';

const SNAP: ProductSnapshot = { name: 'B', price: 49, poolType: 'ALL', maxPlayersPerPool: 9999 };

async function seedGrant(input: Parameters<typeof grantEntitlementTxn>[1]) {
  return fakeDb.runTransaction(async (txn) => grantEntitlementTxn(txn as any, input));
}

beforeEach(() => {
  store.clear();
});

describe('grantEntitlementTxn — creation + cap', () => {
  it('creates a CREDIT_BUNDLE + N credit docs', async () => {
    const { bundleId, creditsSpawned } = await seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'ADMIN_GRANT',
      productSnapshot: SNAP, creditsTotal: 3, bundleId: 'b1',
    });
    expect(bundleId).toBe('b1');
    expect(creditsSpawned).toBe(3);
    expect(store.get('bundles/b1')?.creditsTotal).toBe(3);
    const credits = new FakeQuery('bundles/b1/credits')._matchingDocs();
    expect(credits).toHaveLength(3);
    expect(credits.every((c) => c.data.status === 'available')).toBe(true);
  });

  it('rejects creditsTotal > 100 at grant', async () => {
    await expect(seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'ADMIN_GRANT',
      productSnapshot: SNAP, creditsTotal: 101, bundleId: 'bX',
    })).rejects.toThrow(/exceeds the 100-credit cap/);
  });

  it('a CREDIT_BUNDLE grant with creditsTotal < 1 is rejected', async () => {
    await expect(seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'ADMIN_GRANT',
      productSnapshot: SNAP, creditsTotal: 0, bundleId: 'bY',
    })).rejects.toThrow(/creditsTotal >= 1/);
  });

  it('an UNLIMITED_PASS grant requires a positive termEndsAt and spawns no credits', async () => {
    const { creditsSpawned } = await seedGrant({
      ownerId: 'u1', productKind: 'UNLIMITED_PASS', source: 'ADMIN_GRANT',
      productSnapshot: SNAP, termEndsAt: Date.now() + 100000, bundleId: 'bp',
    });
    expect(creditsSpawned).toBe(0);
    expect(store.get('bundles/bp')?.termEndsAt).toBeGreaterThan(Date.now());
    await expect(seedGrant({
      ownerId: 'u1', productKind: 'UNLIMITED_PASS', source: 'ADMIN_GRANT',
      productSnapshot: SNAP, bundleId: 'bp2',
    })).rejects.toThrow(/positive termEndsAt/);
  });

  it('applies per-credit constraints (poolType + maxPlayersPerPool)', async () => {
    await seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'ADMIN_GRANT',
      productSnapshot: SNAP, creditsTotal: 1, bundleId: 'bc',
      creditConstraints: { poolType: 'NFL_PICKEM', maxPlayersPerPool: 25 },
    });
    const credit = new FakeQuery('bundles/bc/credits')._matchingDocs()[0];
    expect(credit.data.constraints).toEqual({ poolType: 'NFL_PICKEM', maxPlayersPerPool: 25 });
  });
});

describe('redeemPoolCreditForPool — happy path', () => {
  it('picks an available credit, marks it used, increments creditsUsed, activates the pool', async () => {
    await seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'PURCHASE',
      productSnapshot: SNAP, creditsTotal: 2, bundleId: 'b1',
    });
    store.set('pools/p1', { createdByUid: 'u1', type: 'NFL_PICKEM', billing: { status: 'trial' } });

    const res = await redeemPoolCreditForPool({ ownerId: 'u1', poolId: 'p1' });
    expect(res.bundleId).toBe('b1');
    expect(res.bundleStatus).toBe('active'); // 1 of 2 used

    // Pool activated via credit.
    const pool = store.get('pools/p1')!;
    expect(pool.billing.status).toBe('active');
    expect(pool.billing.paidVia).toBe('credit');
    expect(pool.billing.creditBundleId).toBe('b1');

    // Exactly one credit used; bundle counter advanced.
    const used = new FakeQuery('bundles/b1/credits', [['status', 'used']])._matchingDocs();
    expect(used).toHaveLength(1);
    expect(used[0].data.usedByPoolId).toBe('p1');
    expect(store.get('bundles/b1')!.creditsUsed).toBe(1);
  });

  /**
   * 🛑 A HARD-CLOSED POOL TYPE CANNOT BE ACTIVATED WITH A CREDIT EITHER
   * (codex r3, 2026-08-28).
   *
   * Closing CREATION left this path open: a commissioner already holding a
   * draft or trial squares pool could still activate it with a bundle credit.
   * Kevin's instruction was "purchased OR setup".
   *
   * The fixtures above moved off SQUARES for exactly this reason — it can no
   * longer stand in for "an ordinary pool" — so this is the one test that still
   * uses it, deliberately.
   */
  it('refuses a SQUARES pool outright, before spending the credit', async () => {
    await seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'PURCHASE',
      productSnapshot: SNAP, creditsTotal: 2, bundleId: 'b1',
    });
    store.set('pools/p1', { createdByUid: 'u1', type: 'SQUARES', billing: { status: 'trial' } });

    await expect(redeemPoolCreditForPool({ ownerId: 'u1', poolId: 'p1' }))
      .rejects.toThrow(/cannot be purchased or upgraded/);

    // Nothing was spent on the way out: a refusal must never cost the owner a
    // credit, and must not leave the pool half-activated.
    expect(store.get('pools/p1')!.billing.status).toBe('trial');
    expect(store.get('bundles/b1')!.creditsUsed ?? 0).toBe(0);
    expect(new FakeQuery('bundles/b1/credits', [['status', 'used']])._matchingDocs()).toHaveLength(0);
  });

  it('flips the bundle to exhausted when the LAST credit is spent (creditsUsed === creditsTotal)', async () => {
    await seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'PURCHASE',
      productSnapshot: SNAP, creditsTotal: 1, bundleId: 'b1',
    });
    store.set('pools/p1', { createdByUid: 'u1', type: 'BRACKET', billing: { status: 'trial' } });

    const res = await redeemPoolCreditForPool({ ownerId: 'u1', poolId: 'p1' });
    expect(res.bundleStatus).toBe('exhausted');
    expect(store.get('bundles/b1')!.status).toBe('exhausted');
    expect(store.get('bundles/b1')!.creditsUsed).toBe(1);
  });
});

describe('redeemPoolCreditForPool — rejection paths', () => {
  it('rejects when the only credit is already USED', async () => {
    await seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'PURCHASE',
      productSnapshot: SNAP, creditsTotal: 1, bundleId: 'b1',
    });
    // Mark the sole credit used.
    const c = new FakeQuery('bundles/b1/credits')._matchingDocs()[0];
    applyUpdateExternal(c.ref.path, { status: 'used', usedByPoolId: 'other' });
    store.set('pools/p1', { createdByUid: 'u1', type: 'NFL_PICKEM', billing: { status: 'trial' } });

    await expect(redeemPoolCreditForPool({ ownerId: 'u1', poolId: 'p1' })).rejects.toThrow(/No available Pool Credit/);
    expect(store.get('pools/p1')!.billing.status).toBe('trial'); // untouched
  });

  it('rejects when the only credit is REVOKED', async () => {
    await seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'PURCHASE',
      productSnapshot: SNAP, creditsTotal: 1, bundleId: 'b1',
    });
    const c = new FakeQuery('bundles/b1/credits')._matchingDocs()[0];
    applyUpdateExternal(c.ref.path, { status: 'revoked' });
    store.set('pools/p1', { createdByUid: 'u1', type: 'NFL_PICKEM', billing: { status: 'trial' } });

    await expect(redeemPoolCreditForPool({ ownerId: 'u1', poolId: 'p1' })).rejects.toThrow(/No available Pool Credit/);
  });

  it('rejects a constraint-violating credit (poolType mismatch)', async () => {
    await seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'PURCHASE',
      productSnapshot: { ...SNAP, poolType: 'NFL_PICKEM' }, creditsTotal: 1, bundleId: 'b1',
      creditConstraints: { poolType: 'NFL_PICKEM' },
    });
    // Pool is BRACKET — credit is NFL_PICKEM-only.
    store.set('pools/p1', { createdByUid: 'u1', type: 'BRACKET', billing: { status: 'trial' } });

    await expect(redeemPoolCreditForPool({ ownerId: 'u1', poolId: 'p1' })).rejects.toThrow(/No available Pool Credit/);
  });

  it('rejects a constraint-violating credit (pool exceeds maxPlayersPerPool)', async () => {
    await seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'PURCHASE',
      productSnapshot: SNAP, creditsTotal: 1, bundleId: 'b1',
      creditConstraints: { maxPlayersPerPool: 25 },
    });
    store.set('pools/p1', { createdByUid: 'u1', type: 'NFL_PICKEM', billing: { status: 'trial', paid: { maxPlayersAllowed: 50 } } });

    await expect(redeemPoolCreditForPool({ ownerId: 'u1', poolId: 'p1' })).rejects.toThrow(/No available Pool Credit/);
  });

  it('rejects a credit whose bundle is REVOKED/expired (bundle not active)', async () => {
    await seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'PURCHASE',
      productSnapshot: SNAP, creditsTotal: 1, bundleId: 'b1',
    });
    // Bundle revoked but a credit somehow still 'available' — must NOT be redeemable.
    applyUpdateExternal('bundles/b1', { status: 'revoked' });
    store.set('pools/p1', { createdByUid: 'u1', type: 'NFL_PICKEM', billing: { status: 'trial' } });

    await expect(redeemPoolCreditForPool({ ownerId: 'u1', poolId: 'p1' })).rejects.toThrow(/No available Pool Credit/);
  });

  it("rejects when the pool is already active (no double-activation)", async () => {
    await seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'PURCHASE',
      productSnapshot: SNAP, creditsTotal: 1, bundleId: 'b1',
    });
    store.set('pools/p1', { createdByUid: 'u1', type: 'NFL_PICKEM', billing: { status: 'active' } });
    await expect(redeemPoolCreditForPool({ ownerId: 'u1', poolId: 'p1' })).rejects.toThrow(/already active/);
  });

  it('rejects when the caller does not own the pool', async () => {
    await seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'PURCHASE',
      productSnapshot: SNAP, creditsTotal: 1, bundleId: 'b1',
    });
    store.set('pools/p1', { createdByUid: 'someoneElse', type: 'NFL_PICKEM', billing: { status: 'trial' } });
    await expect(redeemPoolCreditForPool({ ownerId: 'u1', poolId: 'p1' })).rejects.toThrow(/do not own/);
  });
});

describe('revokeEntitlementTxn — voids only AVAILABLE credits', () => {
  it('bundle revoke: available → revoked, USED left untouched, bundle status revoked', async () => {
    await seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'ADMIN_GRANT',
      productSnapshot: SNAP, creditsTotal: 3, bundleId: 'b1',
    });
    // Mark one credit used.
    const credits = new FakeQuery('bundles/b1/credits')._matchingDocs();
    applyUpdateExternal(credits[0].ref.path, { status: 'used', usedByPoolId: 'p9' });

    const res = await fakeDb.runTransaction((txn) =>
      revokeEntitlementTxn(txn as any, { bundleId: 'b1', scope: 'bundle', reason: 'fraud', nowMs: 123 })
    );
    expect(res.revokedCredits).toBe(2); // the 2 available ones only

    const after = new FakeQuery('bundles/b1/credits')._matchingDocs();
    expect(after.filter((c) => c.data.status === 'revoked')).toHaveLength(2);
    expect(after.filter((c) => c.data.status === 'used')).toHaveLength(1); // untouched
    const bundle = store.get('bundles/b1')!;
    expect(bundle.status).toBe('revoked');
    expect(bundle.revokedReason).toBe('fraud');
    expect(bundle.revokedAt).toBe(123);
  });

  it('single-credit revoke: available credit → revoked', async () => {
    await seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'ADMIN_GRANT',
      productSnapshot: SNAP, creditsTotal: 2, bundleId: 'b1',
    });
    const target = new FakeQuery('bundles/b1/credits')._matchingDocs()[0];
    const res = await fakeDb.runTransaction((txn) =>
      revokeEntitlementTxn(txn as any, { bundleId: 'b1', scope: 'credit', creditId: target.id, reason: 'oops', nowMs: 1 })
    );
    expect(res.revokedCredits).toBe(1);
    expect(store.get(target.ref.path)!.status).toBe('revoked');
  });

  it('single-credit revoke rejects a non-available credit', async () => {
    await seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'ADMIN_GRANT',
      productSnapshot: SNAP, creditsTotal: 1, bundleId: 'b1',
    });
    const target = new FakeQuery('bundles/b1/credits')._matchingDocs()[0];
    applyUpdateExternal(target.ref.path, { status: 'used' });
    await expect(fakeDb.runTransaction((txn) =>
      revokeEntitlementTxn(txn as any, { bundleId: 'b1', scope: 'credit', creditId: target.id, reason: 'x', nowMs: 1 })
    )).rejects.toThrow(/not available/);
  });

  it('pass revoke: UNLIMITED_PASS → status expired', async () => {
    await seedGrant({
      ownerId: 'u1', productKind: 'UNLIMITED_PASS', source: 'ADMIN_GRANT',
      productSnapshot: SNAP, termEndsAt: Date.now() + 100000, bundleId: 'bp',
    });
    const res = await fakeDb.runTransaction((txn) =>
      revokeEntitlementTxn(txn as any, { bundleId: 'bp', scope: 'pass', reason: 'refund', nowMs: 5 })
    );
    expect(res.revokedCredits).toBe(0);
    expect(store.get('bundles/bp')!.status).toBe('expired');
    expect(store.get('bundles/bp')!.revokedReason).toBe('refund');
  });

  it("pass revoke on a CREDIT_BUNDLE is rejected", async () => {
    await seedGrant({
      ownerId: 'u1', productKind: 'CREDIT_BUNDLE', source: 'ADMIN_GRANT',
      productSnapshot: SNAP, creditsTotal: 1, bundleId: 'b1',
    });
    await expect(fakeDb.runTransaction((txn) =>
      revokeEntitlementTxn(txn as any, { bundleId: 'b1', scope: 'pass', reason: 'x', nowMs: 1 })
    )).rejects.toThrow(/only applies to an UNLIMITED_PASS/);
  });
});

// Small helper: mutate the fake store outside a transaction (test setup only).
function applyUpdateExternal(path: string, updates: DocData) {
  const cur = store.get(path) || {};
  store.set(path, { ...cur, ...updates });
}
