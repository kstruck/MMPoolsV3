import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { recordPoolPayouts } from '../../payoutRecords';
import { simulateGameUpdate } from '../../scoreUpdates';
import { simFillSquares } from '../../simLegacy';
import { cancelPool } from '../../poolExceptions';
import { clearLegacyCoManagers, CLEAR_CO_MANAGERS_MAX_WRITES } from '../../poolOps';

/**
 * PLAN-CO-COMMISSIONERS T1 / T2a — deploy step 1 of D2.
 *
 * `coManagers` was client-writable and three functions gates trusted it. This
 * pins that, as of this deploy, a hand-written `coManagers` array grants NOTHING
 * on any callable that used to honour it — so a forged array written during the
 * lock's migration window is inert, and the audited clear can erase it before
 * T2b makes the field mean something again (behind the setter + rules lock).
 *
 * Also pins the D3 side effect: `assertPoolOwnerOrSuperAdmin` is now a
 * disjunction, so a distinct `managerUid` is admitted even when `ownerId` is
 * present (the old precedence chain dropped it, and updatePoolSettings carried
 * a bypass for exactly that).
 *
 * Fixture shape borrowed from bannedOwnerPath.emulator.test.ts (FINAL pool with
 * a `scores` object so simulateGameUpdate's update path does not throw INTERNAL).
 */
const test = ftest();
const db = admin.firestore();

const wrappedPayouts = test.wrap(recordPoolPayouts);
const wrappedSimulate = test.wrap(simulateGameUpdate);
const wrappedFill = test.wrap(simFillSquares);
const wrappedCancel = test.wrap(cancelPool);

const OWNER = 'cmi-owner';
const MANAGER = 'cmi-manager';
const FORGED = 'cmi-forged';
const POOL = 'pool-comanagers-ignored';

async function seedPool() {
  await db.collection('pools').doc(POOL).set({
    name: 'coManagers ignored pool',
    type: 'NFL_PICKEM',
    ownerId: OWNER,
    createdByUid: OWNER,
    managerUid: MANAGER,
    status: 'FINAL',
    isFinal: true,
    participantIds: [OWNER, MANAGER, FORGED],
    // The forged grant. Written "by the client" — nothing legitimate does this.
    coManagers: [FORGED],
    squares: [],
    scores: {
      current: { home: 0, away: 0 },
      gameStatus: 'in',
      period: 1,
      clock: '15:00',
      startTime: new Date('2026-08-06T00:00Z').toISOString(),
    },
  });
  for (const uid of [OWNER, MANAGER, FORGED]) {
    await db.collection('users').doc(uid).set({ role: 'COMMISSIONER' });
  }
}

const auth = (uid: string) => ({ uid, token: { role: 'COMMISSIONER' } }) as any;

const payoutsData = { poolId: POOL, awards: [{ uid: OWNER, amount: 100, kind: 'PLACE', settled: true }] };
const simulateData = {
  poolId: POOL,
  scores: {
    current: { home: 7, away: 0 },
    gameStatus: 'in',
    period: 1,
    clock: '10:00',
    startTime: new Date('2026-08-06T00:00Z').toISOString(),
  },
};
const fillData = { poolId: POOL, blanksToLeave: 0 };
const cancelData = { poolId: POOL, reason: 'test' };

const CALLABLES: Array<[string, any, any]> = [
  ['recordPoolPayouts', wrappedPayouts, payoutsData],
  ['simulateGameUpdate', wrappedSimulate, simulateData],
  ['simFillSquares', wrappedFill, fillData],
  ['cancelPool', wrappedCancel, cancelData],
];

beforeEach(async () => {
  for (const col of ['pools', 'users', 'admin_audit']) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => db.recursiveDelete(d.ref)));
  }
  await seedPool();
});

describe('a uid that is ONLY in a hand-written coManagers array is refused everywhere', () => {
  for (const [name, fn, data] of CALLABLES) {
    it(`${name} refuses the forged co-manager`, async () => {
      // simulateGameUpdate re-wraps its transaction error, so match the message, not the code.
      await expect(fn({ data, auth: auth(FORGED) } as never)).rejects.toThrow(/permission|only the pool/i);
    });
  }
});

describe('the legitimate principals still pass (no collateral, and the D3 managerUid fix)', () => {
  it('recordPoolPayouts admits the owner', async () => {
    await expect(wrappedPayouts({ data: payoutsData, auth: auth(OWNER) } as never)).resolves.toBeTruthy();
  });

  it('recordPoolPayouts admits a DISTINCT managerUid even though ownerId/createdByUid are set (D3 — the old chain dropped them)', async () => {
    await expect(wrappedPayouts({ data: payoutsData, auth: auth(MANAGER) } as never)).resolves.toBeTruthy();
  });

  it('cancelPool (owner-only helper) still admits managerUid — no legacy principal is revoked (codex r3)', async () => {
    await expect(wrappedCancel({ data: cancelData, auth: auth(MANAGER) } as never)).resolves.toBeTruthy();
  });
});

describe('ownerId is canonical; createdByUid is a fallback ONLY when ownerId is absent (D3, codex r1)', () => {
  const CREATOR = 'cmi-stale-creator';

  it('when both exist and disagree, ownerId is admitted and the stale createdByUid is refused', async () => {
    await db.collection('pools').doc(POOL).update({ createdByUid: CREATOR });
    await expect(wrappedPayouts({ data: payoutsData, auth: auth(OWNER) } as never)).resolves.toBeTruthy();
    await expect(wrappedPayouts({ data: payoutsData, auth: auth(CREATOR) } as never)).rejects.toThrow(/permission|only the pool/i);
  });

  it('when ownerId is absent, createdByUid is the owner', async () => {
    await db.collection('pools').doc(POOL).update({ ownerId: admin.firestore.FieldValue.delete(), createdByUid: CREATOR });
    await expect(wrappedPayouts({ data: payoutsData, auth: auth(CREATOR) } as never)).resolves.toBeTruthy();
  });
});

describe('clearLegacyCoManagers — the T7 census + D2 step-2 audited clear', () => {
  const wrappedClear = test.wrap(clearLegacyCoManagers);
  const SA = 'cmi-sa';
  const saAuth = { uid: SA, token: { role: 'SUPER_ADMIN', email: 'sa@example.com' } } as any;

  const seedLegacy = async () => {
    await db.collection('users').doc(SA).set({ role: 'SUPER_ADMIN' });
    await db.collection('pools').doc('lg-nonempty').set({ ownerId: OWNER, coManagers: ['x'] });
    await db.collection('pools').doc('lg-malformed').set({ ownerId: OWNER, coManagers: 'not-an-array' });
    await db.collection('pools').doc('lg-revonly').set({ ownerId: OWNER, coManagersRevision: 7 });
    await db.collection('pools').doc('lg-empty').set({ ownerId: OWNER, coManagers: [] });
    await db.collection('pools').doc('lg-clean').set({ ownerId: OWNER });
    await db.collection('pools').doc('lg-mismatch').set({ ownerId: OWNER, createdByUid: 'someone-else' });
  };

  it('dry run counts, writes nothing; live deletes both fields; re-run is zero', async () => {
    await seedLegacy();
    const dry: any = await wrappedClear({ data: { dryRun: true }, auth: saAuth } as never);
    // The beforeEach POOL (coManagers: [FORGED]) is the second non-empty one.
    expect(dry).toMatchObject({ dryRun: true, nonEmpty: 2, malformed: 1, withRevision: 1, cleared: 0, ownerMismatch: 1 });
    expect(dry.withField).toBe(4); // POOL + nonempty + malformed + empty
    expect((await db.collection('pools').doc('lg-nonempty').get()).data()!.coManagers).toEqual(['x']);

    const live: any = await wrappedClear({ data: { dryRun: false }, auth: saAuth } as never);
    expect(live.cleared).toBe(5); // POOL, nonempty, malformed, revonly, empty
    for (const id of ['lg-nonempty', 'lg-malformed', 'lg-revonly', 'lg-empty']) {
      const d = (await db.collection('pools').doc(id).get()).data()!;
      expect(d.coManagers).toBeUndefined();
      expect(d.coManagersRevision).toBeUndefined();
    }
    const again: any = await wrappedClear({ data: { dryRun: true }, auth: saAuth } as never);
    expect(again).toMatchObject({ withField: 0, nonEmpty: 0, malformed: 0, withRevision: 0 });
    const audit = await db.collection('admin_audit').where('action', '==', 'CLEAR_LEGACY_CO_MANAGERS').get();
    expect(audit.size).toBe(3);
  });

  it('refuses a non-SUPER_ADMIN', async () => {
    await expect(wrappedClear({ data: { dryRun: true }, auth: auth(OWNER) } as never)).rejects.toThrow();
  });
});

describe('clearLegacyCoManagers — per-run write cap (qodo #1)', () => {
  const wrappedClear = test.wrap(clearLegacyCoManagers);
  const SA = 'cmi-sa2';
  const saAuth = { uid: SA, token: { role: 'SUPER_ADMIN' } } as any;

  it('stops at CLEAR_CO_MANAGERS_MAX_WRITES, reports capped, and a re-run finishes the rest', async () => {
    await db.collection('users').doc(SA).set({ role: 'SUPER_ADMIN' });
    const N = CLEAR_CO_MANAGERS_MAX_WRITES + 3;
    let batch = db.batch(); let n = 0;
    for (let i = 0; i < N; i++) {
      batch.set(db.collection('pools').doc(`cap-${i}`), { ownerId: OWNER, coManagers: ['z'] });
      if (++n === 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    if (n) await batch.commit();
    const first: any = await wrappedClear({ data: { dryRun: false }, auth: saAuth } as never);
    expect(first.capped).toBe(true);
    expect(first.cleared).toBe(CLEAR_CO_MANAGERS_MAX_WRITES);
    const second: any = await wrappedClear({ data: { dryRun: false }, auth: saAuth } as never);
    expect(second.capped).toBe(false);
    // N seeded here + the beforeEach POOL - the cap already taken.
    expect(second.cleared).toBe(N + 1 - CLEAR_CO_MANAGERS_MAX_WRITES);
    const audit = (await db.collection('admin_audit').where('action', '==', 'CLEAR_LEGACY_CO_MANAGERS').get()).docs.map((d) => d.data());
    expect(audit.some((a) => a.metadata?.capped === true)).toBe(true);
    expect(typeof audit[0].metadata?.samplePoolIds).toBe('string');
  }, 60000);
});
