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
   * SQUARES IS CREATED AGAIN (PLAN-SQUARES-REOPEN PR-D). From 2026-08-28 until
   * that plan landed, this test proved the callable REFUSED the type. It now
   * proves the side-effect bundle through a squares pool, as it did before the
   * closure — and the test after it proves the off switch that needs no
   * deploy, at the real boundary: the callable, not the page.
   */
  it('SQUARES: pool + managedPools + POOL_CREATED activity + free billing + role upgrade; no participations', async () => {
    await seedUser('u1', 'PARTICIPANT');
    const res = (await wrappedCreatePool({ data: { name: 'Test Squares', costPerSquare: 10 }, auth: { uid: 'u1', token: {} } } as never)) as { poolId: string };
    expect(res.poolId).toBeTruthy();

    const pool = (await db.collection('pools').doc(res.poolId).get()).data() as {
      type?: string; squares: unknown[]; billing: { status: string }; ownerId: string; isLocked: boolean;
    };
    // A create with no `type` is a squares pool — that is what the wizard's
    // predecessor sent, and what an old client still sends.
    expect(pool.type ?? 'SQUARES').toBe('SQUARES');
    expect(pool.squares).toHaveLength(100);
    expect(pool.billing.status).toBe('free');
    expect(pool.ownerId).toBe('u1');
    expect(pool.isLocked).toBe(false);

    const mp = await db.collection('users').doc('u1').collection('managedPools').doc(res.poolId).get();
    expect(mp.exists).toBe(true);

    const activity = await db.collection('users').doc('u1').collection('activity').where('type', '==', 'POOL_CREATED').get();
    expect(activity.size).toBe(1);
    expect(activity.docs[0].data().poolId).toBe(res.poolId);

    const participations = await db.collection('users').doc('u1').collection('participations').get();
    expect(participations.size).toBe(0);

    const user = (await db.collection('users').doc('u1').get()).data() as { role: string };
    expect(user.role).toBe('COMMISSIONER');
  });

  it('SQUARES: with the runtime flag off the callable REFUSES it and writes nothing — and other types are still created', async () => {
    await seedUser('u1', 'PARTICIPANT');
    const config = db.collection('system').doc('config');
    await config.set({ poolTypeFlags: { SQUARES: false } });
    try {
      await expect(
        wrappedCreatePool({ data: { type: 'SQUARES', name: 'Test Squares', costPerSquare: 10 }, auth: { uid: 'u1', token: {} } } as never),
      ).rejects.toThrow(/SQUARES pools are temporarily disabled/);
      // ...the same for a create that names no type, which is a squares pool.
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

      // The flag closes squares only.
      const props = (await wrappedCreatePool({ data: { type: 'PROPS', name: 'Test Props', props: { cost: 5, maxCards: 1, questions: [] } }, auth: { uid: 'u1', token: {} } } as never)) as { poolId: string };
      expect(props.poolId).toBeTruthy();
    } finally {
      await config.delete();
    }
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
