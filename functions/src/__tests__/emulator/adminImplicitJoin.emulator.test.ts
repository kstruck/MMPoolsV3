import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { submitNFLPicksInternal } from '../../nflPools';
import { FREE_PLAN_PARTICIPANT_CAP, FREE_PLAN_FULL_MESSAGE } from '../../shared/freePlanCap';

/**
 * PLAN-ADMIN-PICK-IMPLICIT-JOIN.
 *
 * `assertNFLPickMembership` admits a SUPER_ADMIN who never joined. Before this
 * change the submit path then wrote the entry and the Member Record but never
 * touched `pool.participantIds` — the array My Entries, the participant count,
 * reminder targeting and the Firestore rules all key off. Measured on prod pool
 * ubHD4bgszL05oURYubrn (2026-09-10): 22 Member Records, 21 participantIds, the
 * missing one a SUPER_ADMIN the commissioner had marked PAID.
 *
 * Case 1 MUST FAIL on origin/main (participantIds stays [HOST]).
 * Case 2 guards the seat gate: the bypass does not become a way past the cap.
 * Case 3 guards the ordinary path: a member's resubmit does not duplicate.
 * Cases 4–6 are qodo's findings on PR #686 (#2 removal race, #3 stale creator,
 * #8 replay ordering).
 */
const test = ftest();
const db = admin.firestore();

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });
const HOUR = 60 * 60 * 1000;
const SEASON = 'implicit-join-season';
const GAME = 'implicit-join-g1';
const HOST = 'implicit-join-host';
const ADMIN = 'implicit-join-admin';
const MEMBER = 'implicit-join-member';
const CREATOR = 'implicit-join-creator';
const POOLS = [
  'pool-implicit-join-1',
  'pool-implicit-join-full',
  'pool-implicit-join-member',
  'pool-implicit-join-race',
  'pool-implicit-join-creator',
  'pool-implicit-join-replay',
];
const USERS = [HOST, ADMIN, MEMBER, CREATOR];

const seedGame = async () => {
  await db.collection('nfl_games').doc(GAME).set({
    id: GAME, espnGameId: GAME, season: SEASON, seasonType: 1, week: 1,
    startTime: Date.now() + 4 * HOUR, status: 'SCHEDULED', isMonday: false,
    homeTeam: T('KC'), awayTeam: T('BUF'),
    scores: { home: 0, away: 0 }, spread: { value: -3, locked: true },
  });
};

const seedPool = async (poolId: string, participantIds: string[], extra: Record<string, unknown> = {}) => {
  await db.collection('pools').doc(poolId).set({
    name: 'Implicit join', type: 'NFL_PICKEM', league: 'NFL', season: SEASON, seasonType: 1,
    ownerId: HOST, managerUid: HOST, participantIds, status: 'OPEN', billing: { status: 'free' },
    settings: { entryFee: 25, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false },
    ...extra,
  });
  await db.collection('pools').doc(poolId).collection('members').doc(HOST).set({
    uid: HOST, poolId, userName: 'Host', role: 'MANAGER',
    paidStatus: 'UNPAID', feeOwed: 0, feeOwedSource: 'LIVE', hasPlayableEntry: false,
  });
};

const submitAs = (poolId: string, uid: string, actorRole?: string, requestId?: string, dbLike: admin.firestore.Firestore = db) =>
  submitNFLPicksInternal(dbLike, { actorUid: uid, subjectUid: uid, subjectName: uid, actorRole, requestId }, {
    poolId, week: 1, picks: { [GAME]: 'KC' },
  });

const roster = async (poolId: string) =>
  ((await db.collection('pools').doc(poolId).get()).data()!.participantIds as string[]);

// Cleanup is best-effort on both ends (qodo #7): a rerun against the persistent
// emulator must not inherit a previous run's entries, and later suites that scan
// collections must not see this one's residue.
const wipe = async () => {
  for (const id of POOLS) await db.recursiveDelete(db.collection('pools').doc(id)).catch(() => undefined);
  for (const uid of USERS) await db.recursiveDelete(db.collection('users').doc(uid)).catch(() => undefined);
  await db.collection('nfl_games').doc(GAME).delete().catch(() => undefined);
};

describe('a SUPER_ADMIN pick submission is an implicit join', () => {
  beforeAll(async () => {
    await wipe();
    await seedGame();
    for (const uid of USERS) await db.collection('users').doc(uid).set({ name: uid });
  }, 30000);

  afterAll(async () => {
    await wipe();
    await test.cleanup();
  }, 30000);

  it('adds the admin to participantIds in the same write as the entry and Member Record', async () => {
    const POOL = 'pool-implicit-join-1';
    await seedPool(POOL, [HOST]);

    await submitAs(POOL, ADMIN, 'SUPER_ADMIN');

    const ids = await roster(POOL);
    expect(ids).toContain(ADMIN);
    expect(ids.filter(x => x === ADMIN)).toHaveLength(1);
    const member = (await db.collection('pools').doc(POOL).collection('members').doc(ADMIN).get()).data()!;
    expect(member.role).toBe('PARTICIPANT');
    expect(member.hasPlayableEntry).toBe(true);
    const participation = (await db.collection('users').doc(ADMIN).collection('participations').doc(POOL).get()).data();
    expect(participation).toMatchObject({ poolId: POOL, type: 'NFL_PICKEM', role: 'PARTICIPANT' });

    // Resubmit: arrayUnion is idempotent, the roster does not grow.
    await submitAs(POOL, ADMIN, 'SUPER_ADMIN');
    expect((await roster(POOL)).filter(x => x === ADMIN)).toHaveLength(1);
  });

  it('the bypass still honours the free-plan seat cap — nothing is written on refusal', async () => {
    const POOL = 'pool-implicit-join-full';
    const filled = [HOST, ...Array.from({ length: FREE_PLAN_PARTICIPANT_CAP - 1 }, (_, i) => `filler-${i}`)];
    expect(filled).toHaveLength(FREE_PLAN_PARTICIPANT_CAP);
    await seedPool(POOL, filled);

    await expect(submitAs(POOL, ADMIN, 'SUPER_ADMIN')).rejects.toThrow(FREE_PLAN_FULL_MESSAGE);

    expect(await roster(POOL)).not.toContain(ADMIN);
    expect((await db.collection('pools').doc(POOL).collection('entries').doc(ADMIN).get()).exists).toBe(false);
    expect((await db.collection('pools').doc(POOL).collection('members').doc(ADMIN).get()).exists).toBe(false);
  });

  it('an ordinary member and the host are untouched by the gate', async () => {
    const POOL = 'pool-implicit-join-member';
    const filled = [HOST, MEMBER, ...Array.from({ length: FREE_PLAN_PARTICIPANT_CAP - 2 }, (_, i) => `filler-${i}`)];
    await seedPool(POOL, filled);

    // A member of a FULL pool can still submit — they hold a seat already.
    await submitAs(POOL, MEMBER);
    expect((await roster(POOL)).filter(x => x === MEMBER)).toHaveLength(1);

    // The host of a full pool (legacy pools may lack the owner in participantIds)
    // is never counted against their own ceiling.
    await db.collection('pools').doc(POOL).update({ participantIds: filled.filter(x => x !== HOST) });
    await submitAs(POOL, HOST);
    expect(await roster(POOL)).toContain(HOST);
  });

  /**
   * qodo #2: the membership gate runs on a snapshot read BEFORE the transaction.
   * A member removed in that window is absent from the in-transaction roster,
   * and "absent → join" would recreate the slot, the Member Record and the
   * mirror. The removal is injected deterministically: a Firestore proxy whose
   * `runTransaction` performs the commissioner's removal, then delegates.
   */
  it('a member removed between the gate and the transaction is NOT re-enrolled', async () => {
    const POOL = 'pool-implicit-join-race';
    await seedPool(POOL, [HOST, MEMBER]);
    await db.collection('pools').doc(POOL).collection('members').doc(MEMBER).set({
      uid: MEMBER, poolId: POOL, userName: 'Member', role: 'PARTICIPANT',
      paidStatus: 'UNPAID', feeOwed: 25, feeOwedSource: 'LIVE',
    });

    const removeThenRun: admin.firestore.Firestore = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'runTransaction') {
          return async (fn: (t: admin.firestore.Transaction) => Promise<unknown>, opts?: unknown) => {
            // The commissioner's removal lands here — after the pre-transaction
            // gate admitted MEMBER, before the transaction reads the pool.
            await db.collection('pools').doc(POOL).update({ participantIds: admin.firestore.FieldValue.arrayRemove(MEMBER) });
            await db.collection('pools').doc(POOL).collection('members').doc(MEMBER).delete();
            return target.runTransaction(fn as never, opts as never);
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });

    await expect(submitAs(POOL, MEMBER, undefined, undefined, removeThenRun)).rejects.toThrow(/NOT_POOL_MEMBER/);

    expect(await roster(POOL)).not.toContain(MEMBER);
    expect((await db.collection('pools').doc(POOL).collection('members').doc(MEMBER).get()).exists).toBe(false);
    expect((await db.collection('pools').doc(POOL).collection('entries').doc(MEMBER).get()).exists).toBe(false);
    expect((await db.collection('users').doc(MEMBER).collection('participations').doc(POOL).get()).exists).toBe(false);
  });

  /**
   * qodo #3: `ownerId` is canonical; `createdByUid` is a fallback only when it
   * is absent. A stale creator on a pool whose two fields disagree is not a
   * host and not a member — the pick is refused, nothing is enrolled.
   */
  it('a stale createdByUid with a different ownerId gets no roster slot', async () => {
    const POOL = 'pool-implicit-join-creator';
    await seedPool(POOL, [HOST], { createdByUid: CREATOR });

    await expect(submitAs(POOL, CREATOR)).rejects.toThrow(/NOT_POOL_MEMBER/);
    expect(await roster(POOL)).not.toContain(CREATOR);
    expect((await db.collection('pools').doc(POOL).collection('entries').doc(CREATOR).get()).exists).toBe(false);
  });

  /**
   * qodo #8: a replay (same requestId) of a submission that landed BEFORE the
   * implicit join — the caller off the roster, the pool now full — must stay a
   * no-op success, not a capacity refusal. The seat gate runs after the replay
   * check.
   */
  it('a replayed request from a roster-less admin in a FULL pool is still a no-op success', async () => {
    const POOL = 'pool-implicit-join-replay';
    const filled = [HOST, ...Array.from({ length: FREE_PLAN_PARTICIPANT_CAP - 1 }, (_, i) => `filler-${i}`)];
    await seedPool(POOL, filled);
    // The pre-implicit-join state: an entry that already carries the requestId,
    // a Member Record, no roster slot.
    await db.collection('pools').doc(POOL).collection('entries').doc(ADMIN).set({
      id: ADMIN, entryIndex: 1, ownerUid: ADMIN, poolId: POOL, userName: 'Admin',
      picks: { [GAME]: 'KC' }, lastRequestId: 'req-landed-before', revision: 1, submittedAt: Date.now(),
    });
    await db.collection('pools').doc(POOL).collection('members').doc(ADMIN).set({
      uid: ADMIN, poolId: POOL, userName: 'Admin', role: 'PARTICIPANT',
      paidStatus: 'UNPAID', feeOwed: 25, feeOwedSource: 'LIVE', hasPlayableEntry: true,
    });

    await expect(submitAs(POOL, ADMIN, 'SUPER_ADMIN', 'req-landed-before')).resolves.toEqual({ success: true });
    // A no-op stays a no-op: the replay repairs nothing, the next real submit does.
    expect(await roster(POOL)).not.toContain(ADMIN);
  });
});
