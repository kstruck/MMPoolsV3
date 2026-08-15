import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { recordPoolPayouts } from '../../payoutRecords';
import { simulateGameUpdate } from '../../scoreUpdates';
import { simFillSquares } from '../../simLegacy';
import { cancelPool } from '../../poolExceptions';

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
  for (const col of ['pools', 'users']) {
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
