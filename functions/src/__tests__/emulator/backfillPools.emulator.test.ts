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
  for (const col of ['pools', 'users', 'adminAudit']) {
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

  it('writes for real when dryRun is explicitly false', async () => {
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

  // KNOWN DEFECT, characterized here so it cannot change silently.
  // Leg 1 recomputes `status` from isLocked/isFinal whenever `createdByUid` is
  // missing, without consulting the existing status — so a live run RESETS a
  // COMPLETED pool to DRAFT. This is a data-corruption bug that predates the
  // dry-run gate; the gate exists so an operator sees the blast radius first.
  // When it is fixed, this test SHOULD fail — update it to assert 'COMPLETED'.
  it('KNOWN DEFECT: a live run resets a COMPLETED pool to DRAFT', async () => {
    await wrapped({ data: { dryRun: false }, ...ADMIN_CTX });

    const pool = (await db.collection('pools').doc('pool1').get()).data()!;
    expect(pool.status).toBe('DRAFT');
  });

  it('a second live run is masked by that status clobber, not by idempotency', async () => {
    // The stat increments are non-idempotent by construction, but re-running
    // does NOT double-count in practice: run 1 knocks status off COMPLETED, so
    // run 2 skips leg 3 entirely. Pinned so that fixing the status clobber
    // surfaces the latent double-count instead of hiding it.
    await wrapped({ data: { dryRun: false }, ...ADMIN_CTX });
    await wrapped({ data: { dryRun: false }, ...ADMIN_CTX });

    const user = (await db.collection('users').doc('owner1').get()).data()!;
    expect(user.historicalStats.poolsEntered).toBe(1);
    expect(user.historicalStats.totalPoints).toBe(42);
  });
});
