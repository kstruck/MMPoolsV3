import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { submitNFLPicksInternal } from '../../nflPools';

/**
 * PLAN-WEEKLY-PRIZES §2b / §9 A6 — the frozen tiebreak target, end to end.
 *
 *  1. the FIRST submission of a week freezes the canonical target
 *     (`pool.frozenTiebreakTargets[week]`) — the LAST Monday game to kick off
 *     under MNF_LAST_GAME — even when the client sent no list.
 *  2. a later submission whose displayed list matches the frozen one is accepted;
 *     one whose list differs (a sheet rendered before a schedule change) is
 *     refused with TIEBREAK_TARGET_STALE, and the frozen value does not move.
 *  3. a schedule change AFTER the freeze (the late game loses `isMonday`) does
 *     NOT re-point the week: the frozen list stays, and a fresh submit that
 *     displays the new canonical target is refused (it must reload → frozen).
 *  4. under NONE nothing is frozen and any list is ignored.
 *  5. a legacy pool (no `weeklyTiebreaker`) freezes the whole Monday SET.
 *  6. Monday-less week under MNF_LAST_GAME freezes the week's final game.
 */
const test = ftest();
const db = admin.firestore();

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });
const HOUR = 60 * 60 * 1000;
const SEASON = 'tf-season';
const SUN = 'tf-sun';
const MON1 = 'tf-mon1';
const MON2 = 'tf-mon2';
const HOST = 'tf-host';
const ALICE = 'tf-alice';
const BOB = 'tf-bob';

let n = 0;
let POOL = '';
const createdPools: string[] = [];
const poolRef = () => db.collection('pools').doc(POOL);
const pool = async () => (await poolRef().get()).data()!;

const submit = (uid: string, payload: Record<string, unknown>) =>
  submitNFLPicksInternal(db, { actorUid: uid, subjectUid: uid, subjectName: uid }, { poolId: POOL, week: 1, ...payload } as never);

async function seedPool(settings: Record<string, unknown> = {}) {
  n += 1;
  POOL = `pool-tf-${n}`;
  createdPools.push(POOL);
  await poolRef().set({
    name: 'Freeze', type: 'NFL_PICKEM', league: 'NFL', season: SEASON, seasonType: 1,
    ownerId: HOST, managerUid: HOST, participantIds: [HOST, ALICE, BOB], status: 'OPEN', billing: { status: 'free' },
    entryCount: 0,
    settings: {
      entryFee: 0, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false,
      payouts: { places: [], bonuses: [] },
      ...settings,
    },
  });
  for (const uid of [HOST, ALICE, BOB]) {
    await poolRef().collection('members').doc(uid).set({
      uid, poolId: POOL, userName: uid, role: uid === HOST ? 'MANAGER' : 'PARTICIPANT', joinedAt: Date.now(),
      paidStatus: 'UNPAID', feeOwed: 0, feeOwedSource: 'LIVE',
    });
  }
}

async function seedGames(opts: { mon2IsMonday?: boolean; includeMondays?: boolean } = {}) {
  const base = Date.now() + 4 * HOUR;
  await db.collection('nfl_games').doc(SUN).set({
    id: SUN, espnGameId: SUN, season: SEASON, seasonType: 1, week: 1,
    startTime: base, status: 'SCHEDULED', isMonday: false,
    homeTeam: T('KC'), awayTeam: T('BUF'), scores: { home: 0, away: 0 }, spread: { value: -3, locked: true },
  });
  if (opts.includeMondays === false) {
    await db.collection('nfl_games').doc(MON1).delete();
    await db.collection('nfl_games').doc(MON2).delete();
    return;
  }
  await db.collection('nfl_games').doc(MON1).set({
    id: MON1, espnGameId: MON1, season: SEASON, seasonType: 1, week: 1,
    startTime: base + 24 * HOUR, status: 'SCHEDULED', isMonday: true,
    homeTeam: T('DAL'), awayTeam: T('NYG'), scores: { home: 0, away: 0 }, spread: { value: -1, locked: true },
  });
  await db.collection('nfl_games').doc(MON2).set({
    id: MON2, espnGameId: MON2, season: SEASON, seasonType: 1, week: 1,
    startTime: base + 27 * HOUR, status: 'SCHEDULED', isMonday: opts.mon2IsMonday ?? true,
    homeTeam: T('SF'), awayTeam: T('SEA'), scores: { home: 0, away: 0 }, spread: { value: -2, locked: true },
  });
}

describe('PLAN-WEEKLY-PRIZES §2b — frozen tiebreak target', () => {
  beforeEach(async () => {
    for (const uid of [HOST, ALICE, BOB]) await db.collection('users').doc(uid).set({ name: uid });
    await seedGames();
  }, 30000);

  afterAll(async () => {
    try {
      for (const id of createdPools) await db.recursiveDelete(db.collection('pools').doc(id));
      for (const id of [SUN, MON1, MON2]) await db.collection('nfl_games').doc(id).delete();
      for (const uid of [HOST, ALICE, BOB]) await db.recursiveDelete(db.collection('users').doc(uid));
    } catch { /* best-effort */ }
    test.cleanup();
  }, 30000);

  it('1. the first submission freezes the canonical target (LAST Monday game) even with no displayed list', async () => {
    await seedPool({ weeklyTiebreaker: 'MNF_LAST_GAME' });
    await submit(ALICE, { picks: { [SUN]: 'KC' }, tiebreakerPrediction: 40 });
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [MON2] });
  }, 30000);

  it('2. matching displayed list accepted; a different one is TIEBREAK_TARGET_STALE and the freeze does not move', async () => {
    await seedPool({ weeklyTiebreaker: 'MNF_LAST_GAME' });
    await submit(ALICE, { picks: { [SUN]: 'KC' }, displayedTiebreakTargetIds: [MON2] });
    await expect(submit(BOB, { picks: { [SUN]: 'BUF' }, displayedTiebreakTargetIds: [MON1] }))
      .rejects.toThrow(/TIEBREAK_TARGET_STALE/);
    await submit(BOB, { picks: { [SUN]: 'BUF' }, displayedTiebreakTargetIds: [MON2] });
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [MON2] });
  }, 30000);

  it('3. a schedule change after the freeze does not re-point the week', async () => {
    await seedPool({ weeklyTiebreaker: 'MNF_LAST_GAME' });
    await submit(ALICE, { picks: { [SUN]: 'KC' }, displayedTiebreakTargetIds: [MON2] });
    // Flex: MON2 is no longer a Monday game — canonical would now be MON1.
    await seedGames({ mon2IsMonday: false });
    // A sheet rendered from the NEW schedule without reading the frozen value is refused…
    await expect(submit(BOB, { picks: { [SUN]: 'BUF' }, displayedTiebreakTargetIds: [MON1] }))
      .rejects.toThrow(/TIEBREAK_TARGET_STALE/);
    // …and one that read the frozen value (as the real sheet does) is accepted.
    await submit(BOB, { picks: { [SUN]: 'BUF' }, displayedTiebreakTargetIds: [MON2] });
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [MON2] });
  }, 30000);

  it('4. under NONE nothing is frozen and a displayed list is ignored', async () => {
    await seedPool({ weeklyTiebreaker: 'NONE' });
    await submit(ALICE, { picks: { [SUN]: 'KC' }, displayedTiebreakTargetIds: [MON1] });
    expect((await pool()).frozenTiebreakTargets).toBeUndefined();
  }, 30000);

  it('5. a legacy pool (no weeklyTiebreaker) freezes the whole Monday SET', async () => {
    await seedPool();
    await submit(ALICE, { picks: { [SUN]: 'KC' } });
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [MON1, MON2] });
  }, 30000);

  it('6. a Monday-less week under MNF_FIRST_GAME freezes the final game of the week', async () => {
    await seedGames({ includeMondays: false });
    await seedPool({ weeklyTiebreaker: 'MNF_FIRST_GAME' });
    await submit(ALICE, { picks: { [SUN]: 'KC' } });
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [SUN] });
  }, 30000);
});
