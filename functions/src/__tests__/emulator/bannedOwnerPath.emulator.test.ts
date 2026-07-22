import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { recordPoolPayouts } from '../../payoutRecords';
import { simulateGameUpdate } from '../../scoreUpdates';
import { simFillSquares } from '../../simLegacy';

/**
 * A BANNED commissioner could still move the money ledger and decide winners.
 *
 * These three callables authorize from PERSISTED POOL OWNERSHIP
 * (`createdByUid` / `ownerId` / `managerUid` / `coManagers`) and never consulted
 * `users/{uid}.role`. So an owner who was banned kept full access until somebody
 * hand-edited the pool's ownership fields — not a token-refresh window, a
 * permanent hole. `CONTEXT.md` requires bans to be enforced server-side, and
 * `SECURITY-BARE-ONCALL-CLASSIFICATION.md` flags `recordPoolPayouts` as ON the
 * preseason pilot path via `RecordPayoutsCard.tsx`.
 *
 * WHY EMULATOR AND NOT A UNIT TEST. `assertNotBannedLive` reads Firestore, and
 * the hole was in the CALL SITE, not in the guard — the guard was already
 * correct and already used by three other callables. A test that mocked the
 * read would prove the guard works, which was never in doubt, while a call site
 * that forgot to invoke it would still pass. These drive the real callables
 * against the emulator so the assertion is about the wiring.
 */
const test = ftest();
const db = admin.firestore();

const wrappedPayouts = test.wrap(recordPoolPayouts);
const wrappedSimulate = test.wrap(simulateGameUpdate);
const wrappedFill = test.wrap(simFillSquares);

const OWNER = 'owner-1';
const POOL = 'pool-banned-path';

/**
 * FINAL so recordPoolPayouts clears its settled-pool gate, and carrying a
 * `scores` object because simulateGameUpdate's update path reads
 * `freshPool.scores.startTime` (scoreUpdates.ts:410) and throws INTERNAL
 * without it.
 */
async function seedPool() {
  await db.collection('pools').doc(POOL).set({
    name: 'Banned path pool',
    ownerId: OWNER,
    createdByUid: OWNER,
    status: 'FINAL',
    isFinal: true,
    participantIds: [OWNER],
    squares: [],
    scores: {
      current: { home: 0, away: 0 },
      gameStatus: 'in',
      period: 1,
      clock: '15:00',
      startTime: new Date('2026-08-06T00:00Z').toISOString(),
    },
  });
}

async function setRole(uid: string, role: string | null) {
  if (role === null) {
    await db.collection('users').doc(uid).delete();
    return;
  }
  await db.collection('users').doc(uid).set({ role });
}

/** Caller shapes. The claim role is COMMISSIONER — the ban lives in Firestore. */
const owner = { uid: OWNER, token: { role: 'COMMISSIONER' } } as any;

const payoutsCall = {
  data: { poolId: POOL, awards: [{ uid: OWNER, amount: 100, kind: 'PLACE', settled: true }] },
  auth: owner,
};
/**
 * simulateGameUpdate hands `request.data.scores` straight to processGameUpdate
 * as its ESPN-shaped payload, which reads `.current`, `.period`, `.gameStatus`
 * and `.clock` (scoreUpdates.ts:386-410) — not a bare {home, away}.
 */
const simulateCall = {
  data: {
    poolId: POOL,
    scores: {
      current: { home: 7, away: 0 },
      gameStatus: 'in',
      period: 1,
      clock: '10:00',
      startTime: new Date('2026-08-06T00:00Z').toISOString(),
    },
  },
  auth: owner,
};
const fillCall = { data: { poolId: POOL, blanksToLeave: 0 }, auth: owner };

const CALLABLES: Array<[string, any, any]> = [
  ['recordPoolPayouts', wrappedPayouts, payoutsCall],
  ['simulateGameUpdate', wrappedSimulate, simulateCall],
  ['simFillSquares', wrappedFill, fillCall],
];

beforeEach(async () => {
  for (const col of ['pools', 'users']) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => db.recursiveDelete(d.ref)));
  }
  await seedPool();
});

describe('a BANNED owner is refused on the ownership path', () => {
  for (const [name, fn, call] of CALLABLES) {
    it(`${name} rejects a banned owner`, async () => {
      await setRole(OWNER, 'BANNED');
      await expect(fn(call as never)).rejects.toThrow(/banned/i);
    });
  }

  it('recordPoolPayouts writes NOTHING when the owner is banned', async () => {
    // The refusal has to happen before the batch commits. Asserting only that
    // it threw would pass even if the ledger had already moved.
    await setRole(OWNER, 'BANNED');
    await expect(wrappedPayouts(payoutsCall as never)).rejects.toThrow(/banned/i);

    const records = await db.collection('pools').doc(POOL).collection('payoutRecords').get();
    expect(records.size).toBe(0);
    const pool = await db.collection('pools').doc(POOL).get();
    expect(pool.data()?.payoutsRecordedAt).toBeUndefined();
  });

  it('rejects a banned SUPER_ADMIN too — the claim does not outrank the ban', async () => {
    await setRole(OWNER, 'BANNED');
    const bannedAdmin = { uid: OWNER, token: { role: 'SUPER_ADMIN' } } as any;
    await expect(
      wrappedPayouts({ ...payoutsCall, auth: bannedAdmin } as never),
    ).rejects.toThrow(/banned/i);
  });
});

describe('ordinary owners are unaffected', () => {
  // The regression that would actually hurt: this callable exists to serve
  // pool owners, and SECURITY-BARE-ONCALL-CLASSIFICATION.md warns that a
  // `role:` gate here would lock them out. These pin that it did not happen.
  for (const [name, fn, call] of CALLABLES) {
    it(`${name} still admits a non-banned owner`, async () => {
      await setRole(OWNER, 'COMMISSIONER');
      await expect(fn(call as never)).resolves.toBeTruthy();
    });
  }

  it('fails OPEN when the user doc is missing', async () => {
    // Deliberate: never block a legitimate user because a lookup hiccuped.
    // Documented on assertNotBannedLive; pinned here because a future "tighten
    // it up" edit would silently start rejecting users with no user doc.
    await setRole(OWNER, null);
    await expect(wrappedPayouts(payoutsCall as never)).resolves.toBeTruthy();
  });
});
