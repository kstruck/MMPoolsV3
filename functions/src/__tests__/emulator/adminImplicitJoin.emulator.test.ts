import { describe, it, expect, beforeAll } from 'vitest';
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
 */
const test = ftest();
const db = admin.firestore();
void test;

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });
const HOUR = 60 * 60 * 1000;
const SEASON = 'implicit-join-season';
const GAME = 'implicit-join-g1';
const HOST = 'implicit-join-host';
const ADMIN = 'implicit-join-admin';
const MEMBER = 'implicit-join-member';

const seedGame = async () => {
  await db.collection('nfl_games').doc(GAME).set({
    id: GAME, espnGameId: GAME, season: SEASON, seasonType: 1, week: 1,
    startTime: Date.now() + 4 * HOUR, status: 'SCHEDULED', isMonday: false,
    homeTeam: T('KC'), awayTeam: T('BUF'),
    scores: { home: 0, away: 0 }, spread: { value: -3, locked: true },
  });
};

const seedPool = async (poolId: string, participantIds: string[]) => {
  await db.collection('pools').doc(poolId).set({
    name: 'Implicit join', type: 'NFL_PICKEM', league: 'NFL', season: SEASON, seasonType: 1,
    ownerId: HOST, managerUid: HOST, participantIds, status: 'OPEN', billing: { status: 'free' },
    settings: { entryFee: 25, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false },
  });
  await db.collection('pools').doc(poolId).collection('members').doc(HOST).set({
    uid: HOST, poolId, userName: 'Host', role: 'MANAGER',
    paidStatus: 'UNPAID', feeOwed: 0, feeOwedSource: 'LIVE', hasPlayableEntry: false,
  });
};

const submitAs = (poolId: string, uid: string, actorRole?: string) =>
  submitNFLPicksInternal(db, { actorUid: uid, subjectUid: uid, subjectName: uid, actorRole }, {
    poolId, week: 1, picks: { [GAME]: 'KC' },
  });

const roster = async (poolId: string) =>
  ((await db.collection('pools').doc(poolId).get()).data()!.participantIds as string[]);

describe('a SUPER_ADMIN pick submission is an implicit join', () => {
  beforeAll(async () => {
    await seedGame();
    await db.collection('users').doc(ADMIN).set({ name: 'Admin' });
    await db.collection('users').doc(MEMBER).set({ name: 'Member' });
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
});
