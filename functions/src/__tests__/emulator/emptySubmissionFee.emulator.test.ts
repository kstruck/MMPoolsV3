import { describe, it, expect, beforeAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { submitNFLPicksInternal } from '../../nflPools';

/**
 * PLAN-EMPTY-SUBMISSION-FEE (signed 2026-08-15, Q1–Q4 all recommendations).
 *
 * `submitNFLPicksSchema` permits `picks: {}` on a pick'em pool, and the handler
 * accepted it as a no-op entry write — but the base-dues stamp on that path
 * passed `hasPlayableEntry: true` UNCONDITIONALLY, so a seeded MANAGER (feeOwed
 * 0 — hosting is not playing) who submitted an EMPTY sheet had their feeOwed
 * upgraded 0 → entry fee for a pick nobody made. Live money bug; multi-entry
 * would multiply it (its K9), which is why this ships first.
 *
 * Mirror of proxyPickLatch's "an empty proxy payload does not latch play" —
 * the same defect was fixed on the proxyPick sibling on 2026-07-31.
 *
 * Case 1 MUST FAIL on origin/main (it did: feeOwed 25, hasPlayableEntry true).
 * Case 2 is the guard against a "fix" that never latches at all.
 */
const test = ftest();
const db = admin.firestore();
void test;

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });
const HOUR = 60 * 60 * 1000;
const SEASON = 'empty-fee-season';
const GAME = 'empty-fee-g1';
const POOL = 'pool-empty-fee';
const HOST = 'empty-fee-host';

describe('an EMPTY pick\'em submission does not start fee liability', () => {
  beforeAll(async () => {
    await db.collection('nfl_games').doc(GAME).set({
      id: GAME, espnGameId: GAME, season: SEASON, seasonType: 1, week: 1,
      startTime: Date.now() + 4 * HOUR, status: 'SCHEDULED', isMonday: false,
      homeTeam: T('KC'), awayTeam: T('BUF'),
      scores: { home: 0, away: 0 }, spread: { value: -3, locked: true },
    });
    await db.collection('pools').doc(POOL).set({
      name: 'Empty fee', type: 'NFL_PICKEM', league: 'NFL', season: SEASON, seasonType: 1,
      ownerId: HOST, participantIds: [HOST], status: 'OPEN', billing: { status: 'free' },
      settings: { entryFee: 25, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false },
    });
    // The seeded host: hosting is not playing, so dues start at 0.
    await db.collection('pools').doc(POOL).collection('members').doc(HOST).set({
      uid: HOST, poolId: POOL, userName: 'Host', role: 'MANAGER',
      paidStatus: 'UNPAID', feeOwed: 0, feeOwedSource: 'LIVE', hasPlayableEntry: false,
    });
    await db.collection('users').doc(HOST).set({ name: 'Host' });
  }, 30000);

  const member = async () => (await db.collection('pools').doc(POOL).collection('members').doc(HOST).get()).data()!;

  it('picks: {} leaves the latch FALSE and feeOwed at 0', async () => {
    await submitNFLPicksInternal(db, { actorUid: HOST, subjectUid: HOST }, {
      poolId: POOL, week: 1, picks: {},
    } as never);
    const m = await member();
    expect(m.hasPlayableEntry).toBe(false);
    expect(m.feeOwed).toBe(0);
  }, 30000);

  it('one REAL pick still latches and upgrades feeOwed to the entry fee', async () => {
    await submitNFLPicksInternal(db, { actorUid: HOST, subjectUid: HOST }, {
      poolId: POOL, week: 1, picks: { [GAME]: 'KC' },
    } as never);
    const m = await member();
    expect(m.hasPlayableEntry).toBe(true);
    expect(m.feeOwed).toBe(25);
  }, 30000);
});
