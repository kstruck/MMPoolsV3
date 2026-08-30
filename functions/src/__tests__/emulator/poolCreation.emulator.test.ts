import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { createPool } from '../../poolOps';
import { createNFLPool } from '../../nflPools';

// Full create-path verification against a live Firestore emulator: proves the
// uniform side-effect bundle (pool doc, managedPools, participations for NFL,
// POOL_CREATED activity, role upgrade) + free billing + schema/ban gates.
const test = ftest();
const db = admin.firestore();
const wrappedCreatePool = test.wrap(createPool);
const wrappedCreateNFL = test.wrap(createNFLPool);

async function seedUser(uid: string, role = 'PARTICIPANT') {
  await db.collection('users').doc(uid).set({ role, email: `${uid}@example.com` });
}

async function wipe() {
  for (const coll of ['pools']) {
    const snap = await db.collection(coll).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  const users = await db.collection('users').get();
  for (const u of users.docs) {
    for (const sub of ['managedPools', 'participations', 'activity']) {
      const s = await u.ref.collection(sub).get();
      await Promise.all(s.docs.map((d) => d.ref.delete()));
    }
    await u.ref.delete();
  }
}

beforeEach(wipe);
afterAll(() => test.cleanup());

describe('createPool side-effect bundle (emulator)', () => {
  /**
   * 🛑 SQUARES CREATION IS CLOSED (Kevin, 2026-08-28) — see
   * `HARD_CLOSED_POOL_TYPES` in `lib/featureFlags.ts` and `SQUARES-BACKLOG.md`.
   *
   * This test used to prove the side-effect bundle THROUGH a squares pool. The
   * bundle is type-agnostic (`createPool` writes it for whatever type it
   * builds), so the coverage moves to PROPS — the other type this same callable
   * creates — and the squares case becomes the closure's proof at the real
   * boundary, which is the only boundary that counts: hiding the client entry
   * points does not stop a callable being invoked from DevTools.
   */
  it('SQUARES: the callable REFUSES it, whatever the client shows', async () => {
    await seedUser('u1', 'PARTICIPANT');
    await expect(
      wrappedCreatePool({ data: { name: 'Test Squares', costPerSquare: 10 }, auth: { uid: 'u1', token: {} } } as never),
    ).rejects.toThrow(/SQUARES pools are temporarily disabled/);

    // Nothing was written on the way to the refusal.
    expect((await db.collection('pools').get()).size).toBe(0);
    expect((await db.collection('users').doc('u1').collection('managedPools').get()).size).toBe(0);
    const acts = await db.collection('users').doc('u1').collection('activity').where('type', '==', 'POOL_CREATED').get();
    expect(acts.size).toBe(0);
    // ...and the refusal did not promote the user to commissioner.
    expect(((await db.collection('users').doc('u1').get()).data() as Record<string, unknown>).role).toBe('PARTICIPANT');
  });

  it('PROPS: pool + managedPools + POOL_CREATED activity + free billing + role upgrade; no participations', async () => {
    await seedUser('u1', 'PARTICIPANT');
    const res = (await wrappedCreatePool({ data: { type: 'PROPS', name: 'Test Props', props: { cost: 5, maxCards: 1, questions: [] } }, auth: { uid: 'u1', token: {} } } as never)) as { poolId: string };
    expect(res.poolId).toBeTruthy();

    const pool = (await db.collection('pools').doc(res.poolId).get()).data() as Record<string, any>;
    expect(pool.type).toBe('PROPS');
    expect(pool.billing.status).toBe('free');
    expect(pool.status).toBe('DRAFT');
    expect(pool.ownerId).toBe('u1');

    const mp = await db.collection('users').doc('u1').collection('managedPools').doc(res.poolId).get();
    expect(mp.exists).toBe(true);

    const activity = await db.collection('users').doc('u1').collection('activity').where('type', '==', 'POOL_CREATED').get();
    expect(activity.size).toBe(1);
    expect(activity.docs[0].data().poolId).toBe(res.poolId);

    const participations = await db.collection('users').doc('u1').collection('participations').get();
    expect(participations.size).toBe(0);

    const user = (await db.collection('users').doc('u1').get()).data() as Record<string, any>;
    expect(user.role).toBe('COMMISSIONER'); // T6 canonical (was POOL_MANAGER)
  });

  it('NFL_PICKEM: also writes the participations index + OPEN status', async () => {
    await seedUser('u2', 'MEMBER');
    const res = (await wrappedCreateNFL({
      data: { type: 'NFL_PICKEM', name: 'Weekly', season: '2025', settings: { entryFee: 0, isListedPublic: true, payouts: { places: [], bonuses: [] } } },
      auth: { uid: 'u2', token: {} },
    } as never)) as { poolId: string };
    expect(res.poolId).toBeTruthy();

    const pool = (await db.collection('pools').doc(res.poolId).get()).data() as Record<string, any>;
    expect(pool.type).toBe('NFL_PICKEM');
    expect(pool.status).toBe('OPEN');
    expect(pool.billing.status).toBe('free');

    const part = await db.collection('users').doc('u2').collection('participations').doc(res.poolId).get();
    expect(part.exists).toBe(true);

    const activity = await db.collection('users').doc('u2').collection('activity').where('type', '==', 'POOL_CREATED').get();
    expect(activity.size).toBe(1);
  });

  it('rejects a BANNED user (via claim)', async () => {
    await seedUser('u3', 'MEMBER');
    await expect(
      wrappedCreatePool({ data: { name: 'X', costPerSquare: 1 }, auth: { uid: 'u3', token: { role: 'BANNED' } } } as never),
    ).rejects.toThrow();
  });

  it('rejects invalid input at the schema gate (squares missing costPerSquare)', async () => {
    await seedUser('u4', 'MEMBER');
    await expect(
      wrappedCreatePool({ data: { name: 'X' }, auth: { uid: 'u4', token: {} } } as never),
    ).rejects.toThrow();
  });
});
