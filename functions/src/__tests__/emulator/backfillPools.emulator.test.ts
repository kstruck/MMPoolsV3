import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { backfillPools } from '../../backfill';

// Proves the dry-run gate on backfillPools actually withholds writes, rather
// than merely parsing a flag. This matters more than for most backfills: the
// historical-stats leg uses FieldValue.increment(), so a run that writes when
// it claimed not to would silently and irreversibly inflate user totals.
const test = ftest();
const db = admin.firestore();
const wrapped = test.wrap(backfillPools);

const ADMIN_CTX = {
  auth: {
    uid: 'admin1',
    token: { role: 'SUPER_ADMIN', email: 'admin@example.com' },
  },
} as any;

async function wipe() {
  // admin_audit, not adminAudit — writeAdminAudit() writes to the snake_case
  // collection, so the camelCase name silently wiped nothing.
  for (const col of ['pools', 'users', 'admin_audit', 'system']) {
    const snap = await db.collection(col).get();
    for (const d of snap.docs) {
      for (const sub of ['entries', 'managedPools']) {
        const s = await d.ref.collection(sub).get();
        await Promise.all(s.docs.map((x) => x.ref.delete()));
      }
      await d.ref.delete();
    }
  }
}

// One COMPLETED pool with one entry — exercises all three legs: base-field
// backfill, managedPools index, and the incrementing historical-stats write.
async function seed() {
  // The caller's own doc must carry SUPER_ADMIN too — validated()'s role gate
  // requires the JWT claim AND users/{uid}.role to agree (C5).
  await db.collection('users').doc('admin1').set({ role: 'SUPER_ADMIN' });
  await db.collection('users').doc('owner1').set({ role: 'MEMBER' });
  // Kill-switch armed by default in this suite (Phase 4); the refusal test
  // disarms it explicitly.
  await db.doc('system/config').set({ backfillPools: { enabled: true } }, { merge: true });
  const poolRef = db.collection('pools').doc('pool1');
  await poolRef.set({
    ownerId: 'owner1',
    name: 'Test Pool',
    type: 'SQUARES',
    status: 'COMPLETED',
    // createdByUid + isPublic deliberately absent → leg 1 has work to do.
  });
  await poolRef.collection('entries').doc('e1').set({
    ownerUid: 'owner1',
    rank: 1,
    totalScore: 42,
    payoutAmount: 100,
  });
}

beforeEach(async () => {
  await wipe();
  await seed();
});
afterAll(() => test.cleanup());

describe('backfillPools dry-run gate (emulator)', () => {
  it('writes NOTHING on a dry run but still reports the planned writes', async () => {
    const res = (await wrapped({ data: { dryRun: true }, ...ADMIN_CTX })) as any;

    expect(res.dryRun).toBe(true);
    expect(res.plannedWrites).toBeGreaterThan(0);

    // Leg 1: pool doc untouched.
    const pool = (await db.collection('pools').doc('pool1').get()).data()!;
    expect(pool.createdByUid).toBeUndefined();
    expect(pool.isPublic).toBeUndefined();

    // Leg 2: no managed-pool index created.
    const idx = await db.collection('users').doc('owner1').collection('managedPools').get();
    expect(idx.empty).toBe(true);

    // Leg 3: the non-idempotent one — no stat increments applied.
    const user = (await db.collection('users').doc('owner1').get()).data()!;
    expect(user.historicalStats).toBeUndefined();
  });

  it('defaults to dry-run when called with no argument at all', async () => {
    // request.data arrives as null for a no-arg httpsCallable(fn)() call.
    const res = (await wrapped({ data: null, ...ADMIN_CTX })) as any;

    expect(res.dryRun).toBe(true);
    const user = (await db.collection('users').doc('owner1').get()).data()!;
    expect(user.historicalStats).toBeUndefined();
  });

  it('REFUSES a live run while the kill-switch is off (PLAN-API-TRUST-BOUNDARY Phase 4)', async () => {
    // Disarm — absent/false both mean disabled; dry runs stay allowed.
    await db.doc('system/config').set({ backfillPools: { enabled: false } }, { merge: true });
    await expect(wrapped({ data: { dryRun: false }, ...ADMIN_CTX })).rejects.toThrow(/backfillPools\.enabled/);
    await expect(wrapped({ data: { dryRun: true }, ...ADMIN_CTX })).resolves.toMatchObject({ dryRun: true });
    // and nothing was written
    const user = (await db.collection('users').doc('owner1').get()).data()!;
    expect(user.historicalStats).toBeUndefined();
  });

  it('writes for real when dryRun is explicitly false AND the kill-switch is armed', async () => {
    await db.doc('system/config').set({ backfillPools: { enabled: true } }, { merge: true });
    const res = (await wrapped({ data: { dryRun: false }, ...ADMIN_CTX })) as any;

    expect(res.dryRun).toBe(false);
    expect(res.plannedWrites).toBeGreaterThan(0);

    const pool = (await db.collection('pools').doc('pool1').get()).data()!;
    expect(pool.createdByUid).toBe('owner1');
    expect(pool.isPublic).toBe(true);

    const idx = await db.collection('users').doc('owner1').collection('managedPools').get();
    expect(idx.size).toBe(1);

    const user = (await db.collection('users').doc('owner1').get()).data()!;
    expect(user.historicalStats.poolsEntered).toBe(1);
    expect(user.historicalStats.poolsWon).toBe(1);
    expect(user.historicalStats.totalPoints).toBe(42);
    expect(user.historicalStats.totalEarnings).toBe(100);
  });

  it('preserves an existing status instead of recomputing it', async () => {
    // Regression: leg 1 used to derive status from isLocked/isFinal whenever
    // createdByUid was missing, ignoring the value on the doc — which reset a
    // COMPLETED pool to DRAFT. isLocked/isFinal cannot express COMPLETED.
    await wrapped({ data: { dryRun: false }, ...ADMIN_CTX });

    const pool = (await db.collection('pools').doc('pool1').get()).data()!;
    expect(pool.status).toBe('COMPLETED');
    expect(pool.createdByUid).toBe('owner1');
  });

  it('still derives a status for a legacy pool that has none', async () => {
    await db.collection('pools').doc('pool2').set({
      ownerId: 'owner1',
      name: 'Statusless',
      type: 'SQUARES',
      isLocked: true,
    });

    await wrapped({ data: { dryRun: false }, ...ADMIN_CTX });

    const pool = (await db.collection('pools').doc('pool2').get()).data()!;
    expect(pool.status).toBe('LOCKED');
  });

  it('derives a status for a pool that HAS createdByUid but no status', async () => {
    // The status derivation used to be nested inside the !createdByUid branch,
    // so a pool in this shape could never be migrated.
    await db.collection('pools').doc('pool3').set({
      ownerId: 'owner1',
      createdByUid: 'owner1',
      name: 'Has creator, no status',
      type: 'SQUARES',
      isFinal: true,
    });

    await wrapped({ data: { dryRun: false }, ...ADMIN_CTX });

    const pool = (await db.collection('pools').doc('pool3').get()).data()!;
    expect(pool.status).toBe('FINAL');
  });

  it('does not double-count historical stats when run live twice', async () => {
    // The increments are non-idempotent by construction, so each entry is
    // stamped historicalStatsFoldedAt in the SAME batch as its increment.
    // Before the status fix this was masked by accident (run 1 knocked status
    // off COMPLETED so run 2 skipped the leg); preserving status correctly
    // removes that accident, which is why the guard has to be explicit.
    await wrapped({ data: { dryRun: false }, ...ADMIN_CTX });
    await wrapped({ data: { dryRun: false }, ...ADMIN_CTX });

    const user = (await db.collection('users').doc('owner1').get()).data()!;
    expect(user.historicalStats.poolsEntered).toBe(1);
    expect(user.historicalStats.poolsWon).toBe(1);
    expect(user.historicalStats.totalPoints).toBe(42);
    expect(user.historicalStats.totalEarnings).toBe(100);

    const entry = (
      await db.collection('pools').doc('pool1').collection('entries').doc('e1').get()
    ).data()!;
    expect(entry.historicalStatsFoldedAt).toBeDefined();
  });

  it('folds only the unfolded entries when a prior run was interrupted', async () => {
    // Simulates a crash partway through a large pool: e1 already carries the
    // marker, e2 does not. Only e2 may be folded. This is the case a per-POOL
    // marker written after the entry loop could not express — a >400-entry pool
    // flushes mid-loop, so increments can commit before any pool-level marker.
    await db
      .collection('pools').doc('pool1').collection('entries').doc('e1')
      .update({ historicalStatsFoldedAt: new Date() });
    await db
      .collection('pools').doc('pool1').collection('entries').doc('e2')
      .set({ ownerUid: 'owner1', rank: 4, totalScore: 7, payoutAmount: 0 });

    await wrapped({ data: { dryRun: false }, ...ADMIN_CTX });

    const user = (await db.collection('users').doc('owner1').get()).data()!;
    // e2 only: 1 entry, 0 wins, 7 points — e1's 42 points are NOT re-folded.
    expect(user.historicalStats.poolsEntered).toBe(1);
    expect(user.historicalStats.poolsWon).toBe(0);
    expect(user.historicalStats.totalPoints).toBe(7);
  });
});
