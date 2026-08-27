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
 *  5. a legacy pool (no `weeklyTiebreaker`) freezes the whole Monday SET, and
 *     on a Monday-less week freezes the week's FINAL GAME like every other
 *     asking rule (PLAN-TIEBREAKER-MONDAYLESS) — while a week that ALREADY
 *     froze an empty list keeps it (5c).
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

  it('3b. an EMPTY submission (no pick for this week) does not freeze the target (codex r3 on #452)', async () => {
    await seedPool({ weeklyTiebreaker: 'MNF_LAST_GAME' });
    await submit(ALICE, { picks: {} });
    expect((await pool()).frozenTiebreakTargets).toBeUndefined();
    await submit(ALICE, { picks: { [SUN]: 'KC' } });
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

  it('5b. a LEGACY pool on a Monday-less week now freezes the FINAL GAME of the week (PLAN-TIEBREAKER-MONDAYLESS, Kevin 2026-08-27)', async () => {
    // WAS `{ '1': [] }`. An absent `settings.weeklyTiebreaker` resolves to the
    // legacy MNF_COMBINED, which alone had no Monday-less fallback — so this
    // pool froze "no target", the pick sheet (gated on a non-empty target)
    // rendered no input, and the rules page still promised that the closest
    // prediction takes the week. That is the production defect, at its source.
    await seedGames({ includeMondays: false });
    await seedPool();
    // The displayed list is what proves the sheet RENDERED the new card — see 5d.
    await submit(ALICE, { picks: { [SUN]: 'KC' }, displayedTiebreakTargetIds: [SUN] });
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [SUN] });
    // And it is still a FREEZE: Monday games appearing later do not re-point it.
    await seedGames();
    await submit(BOB, { picks: { [SUN]: 'BUF' }, displayedTiebreakTargetIds: [SUN] });
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [SUN] });
    await expect(submit(BOB, { picks: { [SUN]: 'BUF' }, displayedTiebreakTargetIds: [MON1, MON2] }))
      .rejects.toThrow(/TIEBREAK_TARGET_STALE/);
  }, 30000);

  it('5d. THE ROLLOUT WINDOW — a legacy sheet that never rendered the new card cannot introduce the target (codex r1 on PLAN-TIEBREAKER-MONDAYLESS)', async () => {
    // 🛑 Functions and the www frontend deploy SEPARATELY, so a member can
    // submit from a bundle whose MNF_COMBINED sheet shows no tiebreaker card at
    // all. It sends no prediction and no displayed list. Freezing the fallback
    // on that submission would let the next member to reload answer a question
    // the first was never asked — and `computeWeeklyWinners` DROPS a leader
    // with no prediction the moment another leader has one.
    await seedGames({ includeMondays: false });
    await seedPool();
    await submit(ALICE, { picks: { [SUN]: 'KC' } });   // no displayedTiebreakTargetIds
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [] });
    // ...and it STAYS empty for everyone, current bundle or not. Nobody is
    // asked, so a tied week is shared — the previous release's meaning, kept.
    await expect(submit(BOB, { picks: { [SUN]: 'BUF' }, displayedTiebreakTargetIds: [SUN] }))
      .rejects.toThrow(/TIEBREAK_TARGET_STALE/);
    await submit(BOB, { picks: { [SUN]: 'BUF' } });
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [] });
  }, 30000);

  it('5g. THE INVERSE ORDERING — once a CURRENT sheet froze the fallback, a stale no-handshake submit is REFUSED rather than saved without a prediction (codex r3 P1)', async () => {
    // 5d covers the stale client submitting FIRST. This is the other order.
    // Alice is current: her sheet rendered the new card and sent the list.
    await seedGames({ includeMondays: false });
    await seedPool();
    await submit(ALICE, { picks: { [SUN]: 'KC' }, displayedTiebreakTargetIds: [SUN], tiebreakerPrediction: 44 });
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [SUN] });

    // Bob is on a stale bundle: no card, so no displayed list and no
    // prediction. Accepting would save his entry unable to win a tied week.
    // Refusing is safe HERE because Alice's submit proves the new frontend is
    // live, so a reload actually gets Bob a sheet that asks the question.
    await expect(submit(BOB, { picks: { [SUN]: 'BUF' } }))
      .rejects.toThrow(/TIEBREAK_TARGET_STALE/);
    // After reloading he sends the list and is accepted.
    await submit(BOB, { picks: { [SUN]: 'BUF' }, displayedTiebreakTargetIds: [SUN], tiebreakerPrediction: 41 });
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [SUN] });
  }, 30000);

  it('5h. that refusal is scoped — a week frozen EMPTY, and every non-legacy rule, still accept a no-handshake submit', async () => {
    // A week frozen EMPTY has no prediction to miss, so refusing would lock
    // members out of a week for nothing.
    await seedGames({ includeMondays: false });
    await seedPool();
    await submit(ALICE, { picks: { [SUN]: 'KC' } });          // freezes []
    await submit(BOB, { picks: { [SUN]: 'BUF' } });           // accepted
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [] });

    // And a pre-#452 client on a NON-legacy rule sends no displayed list
    // either. It must keep working — that week's target did not change.
    await seedPool({ weeklyTiebreaker: 'MNF_LAST_GAME' });
    await submit(ALICE, { picks: { [SUN]: 'KC' }, displayedTiebreakTargetIds: [SUN] });
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [SUN] });
    await submit(BOB, { picks: { [SUN]: 'BUF' }, tiebreakerPrediction: 40 });   // no list
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [SUN] });
  }, 30000);

  it('5f. the rollout guard exempts a SERVER-SIDE caller — the sim harness has no bundle to be stale (codex r2 P2)', async () => {
    // Every simulator pool is a legacy MNF_COMBINED pool: no simulator path
    // writes `settings.weeklyTiebreaker`. The sim harness never sends a
    // displayed list and never will, so without the exemption the guard would
    // freeze an empty target on every simulated Monday-less week FOREVER —
    // permanently withholding this fix from the population it most affects.
    await seedGames({ includeMondays: false });
    await seedPool();
    await submitNFLPicksInternal(db, {
      actorUid: ALICE, subjectUid: ALICE, subjectName: ALICE, serverSideCaller: true,
    }, { poolId: POOL, week: 1, picks: { [SUN]: 'KC' } } as never);
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [SUN] });
  }, 30000);

  it('5e. the rollout guard is scoped to the ONE week this release changed — it does not withhold a target the previous release already gave', async () => {
    // A no-handshake submission still freezes the canonical target everywhere
    // else, because everywhere else the previous release resolved the same
    // list. Widening the guard would REGRESS pools that already had a target
    // (a pre-#452 client sends no displayed list either).
    await seedPool();                       // legacy MNF_COMBINED, Monday games present
    await submit(ALICE, { picks: { [SUN]: 'KC' } });
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [MON1, MON2] });

    await seedGames({ includeMondays: false });
    await seedPool({ weeklyTiebreaker: 'MNF_LAST_GAME' });   // Monday-less, but NOT legacy
    await submit(ALICE, { picks: { [SUN]: 'KC' } });
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [SUN] });
  }, 30000);

  it('5c. a week that ALREADY froze an EMPTY list keeps it — the fix does not add a target under members who already submitted (qodo #9 on #452; PLAN-TIEBREAKER-MONDAYLESS C2)', async () => {
    // 🛑 THE GUARANTEE 5b USED TO CARRY, PINNED WHERE IT NOW LIVES.
    //
    // After the fallback change no FRESH submission can freeze `[]` on a
    // non-empty schedule, so this state only ever arrives as data written
    // before the fix — which is exactly the pool in Kevin's screenshot. It must
    // stay empty. Adding a target now would hand a tied week to whoever
    // submits next, over the members who were never asked for a prediction.
    await seedGames({ includeMondays: false });
    await seedPool();
    await poolRef().set({ frozenTiebreakTargets: { 1: [] } }, { merge: true });
    await submit(ALICE, { picks: { [SUN]: 'KC' } });
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [] });
    // The schedule gains Monday games after the fact…
    await seedGames();
    // …a sheet that read the freeze sends nothing; accepted; still frozen empty.
    await submit(BOB, { picks: { [SUN]: 'BUF' } });
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [] });
    // A sheet that ignored the freeze and displayed the new Monday set is refused.
    await expect(submit(BOB, { picks: { [SUN]: 'BUF' }, displayedTiebreakTargetIds: [MON1, MON2] }))
      .rejects.toThrow(/TIEBREAK_TARGET_STALE/);
    // ...and so is one that displayed the week's final game — the new canonical
    // answer, which this week is NOT playing.
    await expect(submit(BOB, { picks: { [SUN]: 'BUF' }, displayedTiebreakTargetIds: [SUN] }))
      .rejects.toThrow(/TIEBREAK_TARGET_STALE/);
  }, 30000);

  it('6. a Monday-less week under MNF_FIRST_GAME freezes the final game of the week', async () => {
    await seedGames({ includeMondays: false });
    await seedPool({ weeklyTiebreaker: 'MNF_FIRST_GAME' });
    await submit(ALICE, { picks: { [SUN]: 'KC' } });
    expect((await pool()).frozenTiebreakTargets).toEqual({ '1': [SUN] });
  }, 30000);
});
