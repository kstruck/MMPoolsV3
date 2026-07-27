import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import './setup';
import { scoreNFLWeekInternal } from '../../nflPools';
import { autoScoreOnce } from '../../nflAutoScore';
import { computeWeekFingerprint } from '../../lib/autoScoreDecisions';
import { readEntryRevisionSum } from '../../lib/entryRevision';
import { acquireScoringLease, fencedWrite, SCORING_LEASE_TTL_MS } from '../../lib/scoringLease';
import {
  enqueueRescore, readRescoreQueue, ackRescoreEvents, RESCORE_QUEUE, type RescoreReason,
} from '../../lib/rescoreQueue';
import type { NFLGame } from '../../nflPoolTypes';

/**
 * G1 PR-B1 write-path coverage: the `provisional` contract inside
 * scoreNFLWeekInternal, and the nflAutoScoreJob pass around it.
 *
 * These are emulator tests rather than unit tests because every guarantee here
 * is about what is and is NOT persisted — "the fingerprint stays unset", "the
 * entry's week is untouched", "scoredWeeks was not written". A test that only
 * inspected the return value would pass against a scorer that wrote all of it.
 */

const HOUR = 60 * 60 * 1000;
const db = admin.firestore();

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr, logoUrl: '' });
const SYSTEM_ACTOR = { uid: 'system', role: 'SYSTEM' as const, label: 'Auto Scorer' };

const SEASON = 'auto-2026';

async function wipe() {
  for (const col of ['nfl_games', 'pools', 'nfl_rescore_queue']) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map(async d => {
      for (const sub of ['entries', 'standings', 'weekly_recaps', 'audit', 'audit_dedupe']) {
        const s = await d.ref.collection(sub).get();
        await Promise.all(s.docs.map(x => x.ref.delete()));
      }
      await d.ref.delete();
    }));
  }
}

function gameDoc(id: string, over: Partial<NFLGame> = {}): NFLGame {
  return {
    id, espnGameId: id, week: 1, season: SEASON, seasonType: 1,
    homeTeam: T('KC'), awayTeam: T('BUF'),
    startTime: Date.now() - 4 * HOUR, status: 'FINAL', scores: { home: 27, away: 24 },
    clock: '0:00', period: 4, isMonday: false, spread: { value: -3, locked: true },
    ...over,
  } as NFLGame;
}

async function seedGames(games: NFLGame[]) {
  await Promise.all(games.map(g =>
    db.collection('nfl_games').doc(g.id).set(JSON.parse(JSON.stringify(g))),
  ));
}

async function seedPool(poolId: string, type: string, settings: Record<string, unknown>, over: Record<string, unknown> = {}) {
  await db.collection('pools').doc(poolId).set({
    name: `Auto ${type}`, type, league: 'NFL',
    season: SEASON, seasonType: 1,
    ownerId: 'owner-1', participantIds: ['owner-1'],
    status: 'OPEN', billing: { status: 'free' },
    settings: { entryFee: 0, payouts: { places: [], bonuses: [] }, ...settings },
    ...over,
  });
}

async function seedEntry(poolId: string, uid: string, data: Record<string, unknown>) {
  await db.collection('pools').doc(poolId).collection('entries').doc(uid).set({
    id: uid, poolId, ownerUid: uid, userName: uid, submittedAt: 0, paidStatus: 'PAID', ...data,
  });
}

const poolDoc = async (poolId: string) => (await db.collection('pools').doc(poolId).get()).data()!;
const entryDoc = async (poolId: string, uid: string) =>
  (await db.collection('pools').doc(poolId).collection('entries').doc(uid).get()).data()!;
const standingsDoc = async (poolId: string) =>
  (await db.collection('pools').doc(poolId).collection('standings').doc('current').get()).data();

/** An unplayed Week 2, so a fixture's season never completes and the pool stays
 *  live. Without it a one-week fixture finalizes on its first pass and is then
 *  filtered out as terminal — which silently makes any follow-up pass a no-op. */
const laterWeekGame = () => gameDoc('wk2-later', {
  id: 'wk2-later', week: 2, homeTeam: T('SF'), awayTeam: T('DAL'),
  startTime: Date.now() + 7 * 24 * HOUR, status: 'SCHEDULED', scores: undefined,
});

async function loadSlate(week = 1): Promise<NFLGame[]> {
  const snap = await db.collection('nfl_games')
    .where('season', '==', SEASON).where('seasonType', '==', 1).where('week', '==', week).get();
  return snap.docs.map(d => d.data() as NFLGame);
}

// ---------------------------------------------------------------------------
// provisional — the reveal gate
// ---------------------------------------------------------------------------

describe('provisional Pick’em — only concluded, lock-closed games are revealed', () => {
  const poolId = 'p-pickem-partial';
  const ALICE = 'alice';

  beforeEach(async () => {
    await wipe();
    // g1 finished; g2 kicks off in 3h and Alice has already picked it.
    await seedGames([
      gameDoc('g1'),
      gameDoc('g2', {
        id: 'g2', homeTeam: T('SF'), awayTeam: T('DAL'),
        startTime: Date.now() + 3 * HOUR, status: 'SCHEDULED', scores: undefined,
      }),
    ]);
    await seedPool(poolId, 'NFL_PICKEM', { lockBufferMinutes: 5, pickMode: 'STRAIGHT', confidenceMode: false });
    await seedEntry(poolId, ALICE, { picks: { g1: 'KC', g2: 'SF' }, weeklyPoints: {}, totalScore: 0 });
  });

  it('scores the finished game, and counts ONLY it in the week summary', async () => {
    const result = await scoreNFLWeekInternal(db, poolId, 1, {
      pool: await poolDoc(poolId), games: await loadSlate(),
      actor: SYSTEM_ACTOR, provisional: true,
    });

    expect(result.provisional).toBe(true);
    const alice = await entryDoc(poolId, ALICE);
    expect(alice.weeklyPoints[1]).toBe(1);      // KC won g1
    expect(alice.weeklyResults[1].correct).toBe(1);
    // THE LEAK THIS GUARDS: `total` is copied verbatim into member-readable
    // standings/current. Counting the whole slate would tell every rival that
    // Alice has already submitted a pick for the unplayed g2.
    expect(alice.weeklyResults[1].total).toBe(1);
    expect(Object.keys(alice.weeklyResults[1].games)).toEqual(['g1']);
  });

  it('publishes live standings but writes NO finalization markers', async () => {
    await scoreNFLWeekInternal(db, poolId, 1, {
      pool: await poolDoc(poolId), games: await loadSlate(),
      actor: SYSTEM_ACTOR, provisional: true,
    });

    expect((await standingsDoc(poolId))!.lastScoredWeek).toBe(1);
    const pool = await poolDoc(poolId);
    expect(pool.scoredWeeks).toBeUndefined();
    expect(pool.scoredThroughWeek).toBeUndefined();
    expect(pool.finalizedAt).toBeUndefined();
    // The recap CREATE trigger fires AI trash-talk, and the later complete pass
    // would only UPDATE the doc — so a provisional create would permanently
    // freeze the recap on incomplete standings.
    expect((await db.collection('pools').doc(poolId).collection('weekly_recaps').doc('week_1').get()).exists).toBe(false);
  });

  it('stamps publishedWeeks as soon as anything is revealed', async () => {
    await scoreNFLWeekInternal(db, poolId, 1, {
      pool: await poolDoc(poolId), games: await loadSlate(),
      actor: SYSTEM_ACTOR, provisional: true,
    });
    expect((await poolDoc(poolId)).publishedWeeks).toEqual({ 1: true });
  });

  it('does NOT claim publication when nothing has been revealed yet', async () => {
    // A pass can fire up to 2h before kickoff. Marking the week published then
    // would close the deadline-extension door over a week nobody has seen.
    await db.collection('nfl_games').doc('g1').update({
      status: 'SCHEDULED', startTime: Date.now() + 2 * HOUR,
    });
    await scoreNFLWeekInternal(db, poolId, 1, {
      pool: await poolDoc(poolId), games: await loadSlate(),
      actor: SYSTEM_ACTOR, provisional: true,
    });
    expect((await poolDoc(poolId)).publishedWeeks).toBeUndefined();
  });

  it('withholds a FINAL game whose week override still extends its lock', async () => {
    await db.collection('pools').doc(poolId).update({
      'settings.weekLockOverrides': { 1: Date.now() + 2 * HOUR },
    });
    await scoreNFLWeekInternal(db, poolId, 1, {
      pool: await poolDoc(poolId), games: await loadSlate(),
      actor: SYSTEM_ACTOR, provisional: true,
    });

    // The game is over, but picks are still open — so it earns nothing yet and
    // the week is not published.
    const alice = await entryDoc(poolId, ALICE);
    expect(alice.weeklyPoints[1]).toBe(0);
    expect(alice.weeklyResults[1].total).toBe(0);
    expect((await poolDoc(poolId)).publishedWeeks).toBeUndefined();
  });

  it('reveals it once the override has passed', async () => {
    await db.collection('pools').doc(poolId).update({
      'settings.weekLockOverrides': { 1: Date.now() - HOUR },
    });
    await scoreNFLWeekInternal(db, poolId, 1, {
      pool: await poolDoc(poolId), games: await loadSlate(),
      actor: SYSTEM_ACTOR, provisional: true,
    });
    expect((await entryDoc(poolId, ALICE)).weeklyPoints[1]).toBe(1);
  });

  it('a COMPLETE pass writes the markers, the recap and the publication marker', async () => {
    await db.collection('nfl_games').doc('g2').update({
      status: 'FINAL', startTime: Date.now() - 2 * HOUR, scores: { home: 21, away: 17 },
    });
    const result = await scoreNFLWeekInternal(db, poolId, 1, {
      pool: await poolDoc(poolId), games: await loadSlate(), actor: SYSTEM_ACTOR,
    });

    expect(result.provisional).toBe(false);
    const alice = await entryDoc(poolId, ALICE);
    expect(alice.weeklyPoints[1]).toBe(2);
    expect(alice.weeklyResults[1].total).toBe(2);
    const pool = await poolDoc(poolId);
    expect(pool.scoredWeeks).toEqual({ 1: true });
    expect(pool.scoredThroughWeek).toBe(1);
    expect(pool.publishedWeeks).toEqual({ 1: true });
    expect((await db.collection('pools').doc(poolId).collection('weekly_recaps').doc('week_1').get()).exists).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// provisional — Survivor / Margin penalty timing
// ---------------------------------------------------------------------------

describe('provisional Survivor — penalties wait for the weekly lock, grades wait for the game', () => {
  const poolId = 'p-surv';
  const NOPICK = 'nopick';
  const PICKER = 'picker';

  /** Kickoff `inHours` from now; the weekly lock is 5 minutes before it. */
  async function setup(inHours: number) {
    await wipe();
    await seedGames([
      gameDoc('g1', { startTime: Date.now() + inHours * HOUR, status: 'SCHEDULED', scores: undefined }),
    ]);
    await seedPool(poolId, 'NFL_SURVIVOR', {
      lockBufferMinutes: 5, maxStrikes: 0, pickLosersMode: false, autoSurviveExemptionEnabled: false,
      maxRebuys: 0, rebuyDeadlineWeek: 0,
    });
    await seedEntry(poolId, NOPICK, { status: 'ALIVE', strikesUsed: 0, strikeWeeks: [], rebuysUsed: 0, usedTeams: [], picks: {}, exemptWeeks: [] });
    await seedEntry(poolId, PICKER, { status: 'ALIVE', strikesUsed: 0, strikeWeeks: [], rebuysUsed: 0, usedTeams: ['KC'], picks: { 1: 'KC' }, exemptWeeks: [] });
  }

  const score = async () => scoreNFLWeekInternal(db, poolId, 1, {
    pool: await poolDoc(poolId), games: await loadSlate(), actor: SYSTEM_ACTOR, provisional: true,
  });

  it('does NOT strike a no-pick entry while its pick window is still open', async () => {
    // The candidate window reaches 2h before kickoff, so a pass genuinely fires
    // here. Striking now eliminates a member whose valid pick submitNFLPicks
    // would then reject as ELIMINATED.
    await setup(1.5);
    const result = await score();

    const nopick = await entryDoc(poolId, NOPICK);
    expect(nopick.status).toBe('ALIVE');
    expect(nopick.strikeWeeks).toEqual([]);
    expect(nopick.weeklyResults).toBeUndefined();
    expect(result.survivorScored).toBe(0);
    // Still counted alive, so the recap/attrition number stays honest.
    expect(result.aliveCount).toBe(2);
  });

  it('does NOT grade a pick whose game is CANCELLED before kickoff', async () => {
    // codex r4. ESPN can mark a game CANCELLED days ahead, which makes it
    // terminal while the pick window is still open. Grading it would publish
    // Carol's pick — as a VOID survival — into member-readable standings for a
    // week she can still change, and the value would flip when she did.
    await setup(1.5);
    await db.collection('nfl_games').doc('g1').update({ status: 'CANCELLED' });

    await score();

    expect((await entryDoc(poolId, PICKER)).weeklyResults).toBeUndefined();
  });

  it('grades a pre-kickoff CANCELLED pick once the weekly lock passes', async () => {
    await setup(-0.5);
    await db.collection('nfl_games').doc('g1').update({ status: 'CANCELLED' });

    await score();

    // Cancelled = survive, per evaluateSurvivorWeek.
    expect((await entryDoc(poolId, PICKER)).weeklyResults[1].survived).toBe(true);
  });

  it('strikes the no-pick entry on the first pass AFTER the lock, with no game final', async () => {
    await setup(-0.5); // kickoff 30m ago, so the 5m-before lock has passed
    await score();

    const nopick = await entryDoc(poolId, NOPICK);
    expect(nopick.strikeWeeks).toEqual([1]);
    expect(nopick.status).toBe('ELIMINATED'); // maxStrikes 0
  });

  it('leaves a made pick UNTOUCHED until its own game concludes', async () => {
    await setup(-0.5);
    await score();

    // computeSurvivorWeekUpdate reports survived:true for an unfinished game —
    // writing that would publish an unplayed pick as a survival.
    const picker = await entryDoc(poolId, PICKER);
    expect(picker.weeklyResults).toBeUndefined();
    expect(picker.status).toBe('ALIVE');
  });

  it('grades the made pick once the game finalizes', async () => {
    await setup(-0.5);
    await score();
    await db.collection('nfl_games').doc('g1').update({ status: 'FINAL', scores: { home: 27, away: 24 } });
    await score();

    const picker = await entryDoc(poolId, PICKER);
    expect(picker.weeklyResults[1].survived).toBe(true);   // KC won
    expect(picker.status).toBe('ALIVE');
  });
});

describe('provisional Margin — the -14 is due at the lock, not at the pass', () => {
  const poolId = 'p-margin';
  const NOPICK = 'm-nopick';
  const PICKER = 'm-picker';

  async function setup(inHours: number) {
    await wipe();
    await seedGames([
      gameDoc('g1', { startTime: Date.now() + inHours * HOUR, status: 'SCHEDULED', scores: undefined }),
    ]);
    await seedPool(poolId, 'NFL_MARGIN', { lockBufferMinutes: 5 });
    for (const uid of [NOPICK, PICKER]) {
      await seedEntry(poolId, uid, {
        picks: uid === PICKER ? { 1: 'KC' } : {}, usedTeams: uid === PICKER ? ['KC'] : [],
        weeklyScores: {}, seasonTotal: 0, negativeBurden: 0, positiveWeeks: 0, bestWeek: 0,
      });
    }
  }

  const score = async () => scoreNFLWeekInternal(db, poolId, 1, {
    pool: await poolDoc(poolId), games: await loadSlate(), actor: SYSTEM_ACTOR, provisional: true,
  });

  it('applies no penalty while picks are still open', async () => {
    await setup(1.5);
    await score();
    expect((await entryDoc(poolId, NOPICK)).weeklyScores).toEqual({});
    expect((await entryDoc(poolId, NOPICK)).seasonTotal).toBe(0);
  });

  it('writes NO entry docs at all when every pick is still pending', async () => {
    // codex r3. The rank pass used to run unconditionally, so a pool with
    // nothing to score still took one write per entry — every ten minutes, each
    // firing the entry-change profile recompute — on a retry that is supposed to
    // be read-only because the pass banks no fingerprint.
    await setup(-0.5);
    await db.collection('pools').doc(poolId).collection('entries').doc(NOPICK)
      .set({ picks: { 1: 'BUF' }, usedTeams: ['BUF'] }, { merge: true }); // both entries now pending

    await score();

    for (const uid of [NOPICK, PICKER]) {
      const e = await entryDoc(poolId, uid);
      expect(e.rank, `${uid} rank`).toBeUndefined();
      expect(e.weeklyScores, `${uid} scores`).toEqual({});
    }
  });

  it('applies -14 after the lock, and leaves a made pick pending', async () => {
    await setup(-0.5);
    await score();

    expect((await entryDoc(poolId, NOPICK)).weeklyScores).toEqual({ 1: -14 });
    // A pending pick would otherwise score 0 — indistinguishable from a real
    // zero-margin result, and it would flip when the game ends.
    expect((await entryDoc(poolId, PICKER)).weeklyScores).toEqual({});
  });

  it('grades the made pick live once its game ends', async () => {
    await setup(-0.5);
    await score();
    await db.collection('nfl_games').doc('g1').update({ status: 'FINAL', scores: { home: 27, away: 10 } });
    await score();

    expect((await entryDoc(poolId, PICKER)).weeklyScores).toEqual({ 1: 17 });
    // Standings move as games finish — the whole point of the live tier.
    const rows = (await standingsDoc(poolId))!.rows as Array<{ ownerUid: string; seasonTotal: number }>;
    expect(rows.find(r => r.ownerUid === PICKER)!.seasonTotal).toBe(17);
    expect(rows.find(r => r.ownerUid === NOPICK)!.seasonTotal).toBe(-14);
  });
});

describe('provisional never finalizes a season', () => {
  const poolId = 'p-final';

  it('withholds finalization mid-week, then the complete pass finalizes', async () => {
    await wipe();
    // The season's ONLY slate: one game done, one still to play.
    await seedGames([
      gameDoc('g1'),
      gameDoc('g2', {
        id: 'g2', homeTeam: T('SF'), awayTeam: T('DAL'),
        startTime: Date.now() + 3 * HOUR, status: 'SCHEDULED', scores: undefined,
      }),
    ]);
    await seedPool(poolId, 'NFL_PICKEM', { lockBufferMinutes: 5, pickMode: 'STRAIGHT', confidenceMode: false });
    await seedEntry(poolId, 'alice', { picks: { g1: 'KC', g2: 'SF' }, weeklyPoints: {}, totalScore: 0 });

    await scoreNFLWeekInternal(db, poolId, 1, {
      pool: await poolDoc(poolId), games: await loadSlate(), actor: SYSTEM_ACTOR, provisional: true,
    });
    // maybeFinalizeNFLPool keys off scoredWeeks + terminal status and never
    // consults effective locks, so writing scoredWeeks here would finalize the
    // pool — and write season history — while g2's picks are still open.
    expect((await poolDoc(poolId)).finalizedAt).toBeUndefined();
    expect((await db.collection('users').doc('alice').collection('seasonHistory').doc(poolId).get()).exists).toBe(false);

    await db.collection('nfl_games').doc('g2').update({
      status: 'FINAL', startTime: Date.now() - 2 * HOUR, scores: { home: 21, away: 17 },
    });
    await scoreNFLWeekInternal(db, poolId, 1, {
      pool: await poolDoc(poolId), games: await loadSlate(), actor: SYSTEM_ACTOR,
    });
    expect((await poolDoc(poolId)).finalizedAt).toBeTruthy();
  }, 60000);
});

// ---------------------------------------------------------------------------
// the job
// ---------------------------------------------------------------------------

describe('autoScoreOnce — candidate selection, skip and dry-run', () => {
  const poolId = 'p-job';

  /**
   * A live week-1 slate plus an unplayed week 2, so the SEASON is not complete.
   *
   * Without that week-2 game the pool finalizes on its very first complete pass —
   * correct behaviour, and exactly what a one-game preseason slate does — but it
   * then becomes a terminal pool and drops out of candidate selection, which
   * makes every skip/re-score assertion below untestable.
   */
  async function setupJob(poolOver: Record<string, unknown> = {}) {
    await wipe();
    await seedGames([
      gameDoc('g1'),
      gameDoc('wk2', {
        id: 'wk2', week: 2, homeTeam: T('SF'), awayTeam: T('DAL'),
        startTime: Date.now() + 7 * 24 * HOUR, status: 'SCHEDULED', scores: undefined,
      }),
    ]);
    await seedPool(poolId, 'NFL_PICKEM', { lockBufferMinutes: 5, pickMode: 'STRAIGHT', confidenceMode: false }, poolOver);
    await seedEntry(poolId, 'alice', { picks: { g1: 'KC' }, weeklyPoints: {}, totalScore: 0 });
  }

  it('scores a live pool and records the fingerprint', async () => {
    await setupJob();
    const r = await autoScoreOnce(db, Date.now(), { dryRun: false });

    expect(r).toMatchObject({ activeSlates: 1, poolsScored: 1, poolsSkipped: 0, poolsFailed: 0, overflow: 0 });
    expect((await entryDoc(poolId, 'alice')).totalScore).toBe(1);
    expect((await poolDoc(poolId)).autoScore.fingerprintByWeek['1']).toEqual(expect.any(String));
  }, 60000);

  it('writes with the SYSTEM actor', async () => {
    await setupJob();
    await autoScoreOnce(db, Date.now(), { dryRun: false });

    const audit = await db.collection('pools').doc(poolId).collection('audit').get();
    const scored = audit.docs.map(d => d.data()).find(a => a.type === 'SCORE_FINALIZED');
    expect(scored?.actor?.role).toBe('SYSTEM');
    expect(scored?.actor?.label).toBe('Auto Scorer');
  }, 60000);

  it('a second run with an unchanged fingerprint writes NOTHING', async () => {
    await setupJob();
    await autoScoreOnce(db, Date.now(), { dryRun: false });
    const before = await entryDoc(poolId, 'alice');

    const second = await autoScoreOnce(db, Date.now(), { dryRun: false });

    expect(second).toMatchObject({ poolsScored: 0, poolsSkipped: 1 });
    // resultsVersion increments on every staged entry write, so an unchanged
    // value is proof no write happened — not merely that the values matched.
    expect((await entryDoc(poolId, 'alice')).resultsVersion).toBe(before.resultsVersion);
  }, 60000);

  it.each([
    ['a restated final score', async () => db.collection('nfl_games').doc('g1').update({ scores: { home: 30, away: 24 } })],
    ['a CANCELLED flip', async () => db.collection('nfl_games').doc('g1').update({ status: 'CANCELLED' })],
    ['a corrected locked spread', async () => db.collection('nfl_games').doc('g1').update({ spread: { value: -9.5, locked: true } })],
    ['a mid-week settings edit', async () => db.collection('pools').doc(poolId).update({ 'settings.pickMode': 'ATS' })],
  ])('re-scores after %s', async (_label, mutate) => {
    await setupJob();
    await autoScoreOnce(db, Date.now(), { dryRun: false });
    await mutate();

    const after = await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect(after).toMatchObject({ poolsScored: 1, poolsSkipped: 0 });
  }, 60000);

  it('DRY RUN writes nothing AND leaves the fingerprint unset', async () => {
    await setupJob();
    const dry = await autoScoreOnce(db, Date.now(), { dryRun: true });

    expect(dry.poolsScored).toBe(1); // "would score"
    expect((await entryDoc(poolId, 'alice')).totalScore).toBe(0);
    expect(await standingsDoc(poolId)).toBeUndefined();
    // The subtle one: persisting the fingerprint on a dry run would leave the
    // pool "already current", so the first LIVE run would skip it forever.
    expect((await poolDoc(poolId)).autoScore).toBeUndefined();

    const live = await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect(live.poolsScored).toBe(1);
    expect((await entryDoc(poolId, 'alice')).totalScore).toBe(1);
  }, 60000);

  it.each([
    ['isFinal', { isFinal: true }],
    ['finalizedAt', { finalizedAt: Date.now() }],
    ['status CANCELED', { status: 'CANCELED' }],
    ['status archived', { status: 'archived' }],
    ['status COMPLETED', { status: 'COMPLETED' }],
  ])('skips a terminal pool (%s)', async (_label, over) => {
    await setupJob(over);
    const r = await autoScoreOnce(db, Date.now(), { dryRun: false });

    expect(r).toMatchObject({ poolsScored: 0, poolsSkipped: 0 });
    expect((await entryDoc(poolId, 'alice')).totalScore).toBe(0);
  }, 60000);

  it('does NOT score a regular-season pool during a preseason slot of the same week', async () => {
    // Both have a "week 1". Matching on the bare week number would score the
    // regular-season pool months early.
    await setupJob();
    await seedPool('p-regular', 'NFL_PICKEM', { lockBufferMinutes: 5, pickMode: 'STRAIGHT' }, { seasonType: 2 });
    await seedEntry('p-regular', 'alice', { picks: { g1: 'KC' }, weeklyPoints: {}, totalScore: 0 });

    const r = await autoScoreOnce(db, Date.now(), { dryRun: false });

    expect(r.poolsScored).toBe(1);
    expect((await entryDoc('p-regular', 'alice')).totalScore).toBe(0);
  }, 60000);

  it('scores a pool whose seasonType is OMITTED as regular season, not preseason', async () => {
    // The create schema allows the field to be absent and scoring reads
    // `Number(pool.seasonType || 2)`, so an equality filter in the query would
    // silently drop these pools.
    await wipe();
    await seedGames([gameDoc('g1', { seasonType: 2 })]);
    // Written WITHOUT a seasonType field at all — the shape the create schema
    // permits, not a null or a zero.
    await db.collection('pools').doc('p-omitted').set({
      name: 'Omitted', type: 'NFL_PICKEM', league: 'NFL', season: SEASON,
      ownerId: 'owner-1', participantIds: ['owner-1'], status: 'OPEN',
      billing: { status: 'free' },
      settings: { entryFee: 0, payouts: { places: [], bonuses: [] }, lockBufferMinutes: 5, pickMode: 'STRAIGHT' },
    });
    await seedEntry('p-omitted', 'alice', { picks: { g1: 'KC' }, weeklyPoints: {}, totalScore: 0 });

    const r = await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect(r.poolsScored).toBe(1);
    expect((await entryDoc('p-omitted', 'alice')).totalScore).toBe(1);
  }, 60000);

  it.each([
    ['a simRunId stamp', 'p-sim-stamped', { simRunId: 'run-x' }],
    ['a sim- pool id', 'sim-p-auto', {}],
  ])('never touches a simulation pool (%s)', async (_label, simPoolId, over) => {
    // The harness owns sim scoring (simFinalizePool is the only finalize door)
    // and cleanupSimPool asserts zero residue afterwards. A scheduled pass would
    // corrupt a run in flight and leave residue — and maybeFinalizeNFLPool
    // refusing to FINALIZE a sim pool does not stop any of these writes.
    await setupJob();
    await seedPool(simPoolId, 'NFL_PICKEM', { lockBufferMinutes: 5, pickMode: 'STRAIGHT' }, over);
    await seedEntry(simPoolId, 'simmer', { picks: { g1: 'KC' }, weeklyPoints: {}, totalScore: 0 });

    const r = await autoScoreOnce(db, Date.now(), { dryRun: false });

    expect(r.poolsScored).toBe(1); // the real pool only
    expect((await entryDoc(simPoolId, 'simmer')).totalScore).toBe(0);
    expect(await standingsDoc(simPoolId)).toBeUndefined();
  }, 60000);

  it('reports no slates when nothing is in the active window', async () => {
    await wipe();
    await seedGames([gameDoc('old', { startTime: Date.now() - 40 * HOUR })]);
    expect(await autoScoreOnce(db, Date.now(), { dryRun: false }))
      .toMatchObject({ activeSlates: 0, poolsScored: 0 });
  }, 60000);

  it('keeps a slate eligible for the full 24h window, not just 2h', async () => {
    // A single-game slate (the Hall of Fame opener) or a game running long would
    // otherwise drop out before it finalized and never be scored.
    await wipe();
    await seedGames([gameDoc('g1', { startTime: Date.now() - 20 * HOUR })]);
    await seedPool(poolId, 'NFL_PICKEM', { lockBufferMinutes: 5, pickMode: 'STRAIGHT' });
    await seedEntry(poolId, 'alice', { picks: { g1: 'KC' }, weeklyPoints: {}, totalScore: 0 });

    expect(await autoScoreOnce(db, Date.now(), { dryRun: false }))
      .toMatchObject({ activeSlates: 1, poolsScored: 1 });
  }, 60000);

  it('judges completeness from the WHOLE week, not the windowed subset', async () => {
    await wipe();
    // Thursday game done and in-window; Monday game still ahead and OUTSIDE the
    // +2h window. Reading only the window would call the week finished tonight.
    await seedGames([
      gameDoc('thu'),
      gameDoc('mon', {
        id: 'mon', homeTeam: T('SF'), awayTeam: T('DAL'), isMonday: true,
        startTime: Date.now() + 3 * 24 * HOUR, status: 'SCHEDULED', scores: undefined,
      }),
    ]);
    await seedPool(poolId, 'NFL_PICKEM', { lockBufferMinutes: 5, pickMode: 'STRAIGHT' });
    await seedEntry(poolId, 'alice', { picks: { thu: 'KC' }, weeklyPoints: {}, totalScore: 0 });

    await autoScoreOnce(db, Date.now(), { dryRun: false });

    // Provisional: standings published, no finalization markers.
    expect((await standingsDoc(poolId))!.lastScoredWeek).toBe(1);
    expect((await poolDoc(poolId)).scoredWeeks).toBeUndefined();
  }, 60000);

  it('one failing pool does not stop the others, and marks the run unhealthy', async () => {
    await setupJob();
    // An entries subcollection the scorer can read but a pool doc shaped so the
    // engine throws: a pool type it does not know, with the NFL type kept for
    // candidate selection, is not reachable — so break the slate instead by
    // removing the field buildStandingsRows needs. Simpler: a second pool with a
    // corrupt settings blob that makes grading throw.
    await seedPool('p-broken', 'NFL_PICKEM', { lockBufferMinutes: 5, pickMode: 'STRAIGHT' });
    await seedEntry('p-broken', 'bob', { picks: null, weeklyPoints: {}, totalScore: 0 });

    const r = await autoScoreOnce(db, Date.now(), { dryRun: false });

    expect(r.poolsFailed).toBe(1);
    expect(r.poolsScored).toBe(1);
    expect((await entryDoc(poolId, 'alice')).totalScore).toBe(1);
  }, 60000);
});

describe('fingerprint gate — the guard fails when removed', () => {
  /** Live week 1 plus an unplayed week 2, so the pool never finalizes mid-test. */
  async function seedOngoing(poolId: string) {
    await wipe();
    await seedGames([
      gameDoc('g1'),
      gameDoc('wk2', {
        id: 'wk2', week: 2, homeTeam: T('SF'), awayTeam: T('DAL'),
        startTime: Date.now() + 7 * 24 * HOUR, status: 'SCHEDULED', scores: undefined,
      }),
    ]);
    await seedPool(poolId, 'NFL_PICKEM', { lockBufferMinutes: 5, pickMode: 'STRAIGHT' });
    await seedEntry(poolId, 'alice', { picks: { g1: 'KC' }, weeklyPoints: {}, totalScore: 0 });
  }

  it('the stored fingerprint is what causes the skip', async () => {
    await seedOngoing('p-fp');

    await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect((await autoScoreOnce(db, Date.now(), { dryRun: false })).poolsSkipped).toBe(1);

    // Clear ONLY the fingerprint — nothing else about the world changes — and the
    // pool is scored again. If the skip came from anywhere else this would still
    // report a skip, and the test above would be vacuous.
    await db.collection('pools').doc('p-fp').update({ autoScore: admin.firestore.FieldValue.delete() });
    expect((await autoScoreOnce(db, Date.now(), { dryRun: false })).poolsScored).toBe(1);
  }, 60000);

  it('banks NO fingerprint for a pass that scored nothing, so a later entry still scores', async () => {
    // codex r1 P2. The pool has no entries, so the scorer returns before it can
    // finalize and nothing at all is written. Its games are ALREADY terminal, so
    // if this pass banked a fingerprint nothing would ever move the hash again
    // and an entry submitted afterwards would be skipped forever.
    await wipe();
    await seedGames([gameDoc('g1')]);
    await seedPool('p-empty', 'NFL_PICKEM', { lockBufferMinutes: 5, pickMode: 'STRAIGHT' });

    await autoScoreOnce(db, Date.now(), { dryRun: false });
    // The pass DOES take (and release) the scoring lease, which lives under
    // `autoScore` — so the assertion is about the fingerprint map specifically,
    // not the whole map being absent.
    expect((await poolDoc('p-empty')).autoScore?.fingerprintByWeek).toBeUndefined();

    await seedEntry('p-empty', 'alice', { picks: { g1: 'KC' }, weeklyPoints: {}, totalScore: 0 });
    expect((await autoScoreOnce(db, Date.now(), { dryRun: false })).poolsScored).toBe(1);
    expect((await entryDoc('p-empty', 'alice')).totalScore).toBe(1);
  }, 60000);

  it('banks NO fingerprint while every entry is still held pending', async () => {
    // Same trap via the provisional gates: a Survivor pool whose only entry has a
    // made pick on an unfinished game scores nobody. Its OTHER games being
    // terminal must not be enough to bank the hash.
    await wipe();
    await seedGames([
      gameDoc('done'),
      gameDoc('later', {
        id: 'later', homeTeam: T('SF'), awayTeam: T('DAL'),
        startTime: Date.now() - 0.5 * HOUR, status: 'IN_PROGRESS', scores: { home: 0, away: 0 },
      }),
    ]);
    await seedPool('p-pending', 'NFL_SURVIVOR', {
      lockBufferMinutes: 5, maxStrikes: 0, pickLosersMode: false,
      autoSurviveExemptionEnabled: false, maxRebuys: 0, rebuyDeadlineWeek: 0,
    });
    await seedEntry('p-pending', 'carol', {
      status: 'ALIVE', strikesUsed: 0, strikeWeeks: [], rebuysUsed: 0,
      usedTeams: ['SF'], picks: { 1: 'SF' }, exemptWeeks: [],
    });

    await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect((await poolDoc('p-pending')).autoScore?.fingerprintByWeek).toBeUndefined();

    await db.collection('nfl_games').doc('later').update({ status: 'FINAL', scores: { home: 24, away: 20 } });
    await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect((await entryDoc('p-pending', 'carol')).weeklyResults[1].survived).toBe(true);
  }, 60000);

  it('the computed fingerprint actually matches what was stored', async () => {
    await seedOngoing('p-fp2');

    const now = Date.now();
    await autoScoreOnce(db, now, { dryRun: false });

    const pool = await poolDoc('p-fp2');
    expect(pool.autoScore.fingerprintByWeek['1'])
      .toBe(computeWeekFingerprint(pool, 1, await loadSlate(), now, await readEntryRevisionSum(db, 'p-fp2') ?? 0));
  }, 60000);
});

// ---------------------------------------------------------------------------
// PR-B′ — the per-entry submission watermark
// ---------------------------------------------------------------------------

describe('entry-revision watermark — a late submission defeats the skip', () => {
  it('re-scores a pool whose entry revision moved, with games and settings unchanged', async () => {
    // The hole this closes: submitNFLPicks captures its clock BEFORE its
    // transaction, so a valid pick can commit after the scorer has read entries.
    // Every other fingerprint term (games, scores, spreads, settings, lock bits)
    // is identical here on purpose — the revision sum is the only thing that
    // moves, which is the whole guarantee.
    await wipe();
    // An unplayed Week 2 keeps the season incomplete — a single-game, single-week
    // fixture finalizes on its first complete pass and the pool then drops out of
    // candidate selection entirely, so every later assertion would be vacuous.
    await seedGames([gameDoc('g1'), laterWeekGame()]);
    await seedPool('p-rev', 'NFL_PICKEM', { lockBufferMinutes: 5, pickMode: 'STRAIGHT' });
    await seedEntry('p-rev', 'alice', { picks: { g1: 'KC' }, weeklyPoints: {}, totalScore: 0, revision: 1 });

    expect((await autoScoreOnce(db, Date.now(), { dryRun: false })).poolsScored).toBe(1);
    // Second pass with nothing changed: skipped, as before.
    expect((await autoScoreOnce(db, Date.now(), { dryRun: false })).poolsSkipped).toBe(1);

    // A second member submits — a NEW entry, so the sum moves 1 -> 3.
    await seedEntry('p-rev', 'bob', { picks: { g1: 'BUF' }, weeklyPoints: {}, totalScore: 0, revision: 2 });
    expect((await autoScoreOnce(db, Date.now(), { dryRun: false })).poolsScored).toBe(1);
    expect((await entryDoc('p-rev', 'bob')).weeklyPoints[1]).toBe(0); // BUF lost

    // And an EDIT to an existing entry moves the sum too. This is the case a
    // `max` aggregate misses (a lower entry moving 1 -> 4 leaves max at 2) and a
    // count misses (bob was already above any threshold).
    await db.collection('pools').doc('p-rev').collection('entries').doc('alice')
      .update({ revision: 4 });
    expect((await autoScoreOnce(db, Date.now(), { dryRun: false })).poolsScored).toBe(1);
  }, 60000);

  it('a legacy entry with no revision field still counts as a change once it moves', async () => {
    // Entries written before this release carry no `revision`, so the aggregate
    // omits them and the sum starts at 0. The first mutation takes them to 1,
    // which is itself a change — a legacy pool is not permanently invisible.
    await wipe();
    await seedGames([gameDoc('g1'), laterWeekGame()]);
    await seedPool('p-legacy', 'NFL_PICKEM', { lockBufferMinutes: 5, pickMode: 'STRAIGHT' });
    await seedEntry('p-legacy', 'alice', { picks: { g1: 'KC' }, weeklyPoints: {}, totalScore: 0 });

    expect(await readEntryRevisionSum(db, 'p-legacy')).toBe(0);
    await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect((await autoScoreOnce(db, Date.now(), { dryRun: false })).poolsSkipped).toBe(1);

    await db.collection('pools').doc('p-legacy').collection('entries').doc('alice')
      .update({ revision: 1 });
    expect(await readEntryRevisionSum(db, 'p-legacy')).toBe(1);
    expect((await autoScoreOnce(db, Date.now(), { dryRun: false })).poolsScored).toBe(1);
  }, 60000);
});

// ---------------------------------------------------------------------------
// PR-B′ — the fenced scoring lease
// ---------------------------------------------------------------------------

describe('scoring lease — the mutex between scorers', () => {
  const seedScorable = async (poolId: string) => {
    await wipe();
    await seedGames([gameDoc('g1')]);
    await seedPool(poolId, 'NFL_PICKEM', { lockBufferMinutes: 5, pickMode: 'STRAIGHT' });
    await seedEntry(poolId, 'alice', { picks: { g1: 'KC' }, weeklyPoints: {}, totalScore: 0 });
  };

  it('a second pass does nothing at all while the first holds the lease', async () => {
    await seedScorable('p-lease');
    const held = await acquireScoringLease(db, 'p-lease', Date.now());
    expect(held).not.toBeNull();

    const result = await scoreNFLWeekInternal(db, 'p-lease', 1, {
      pool: await poolDoc('p-lease'), games: await loadSlate(), actor: SYSTEM_ACTOR,
    });

    expect(result.leaseBusy).toBe(true);
    expect(result.standingsWritten).toBe(false);
    // The load-bearing half: not merely "reported busy" but WROTE NOTHING.
    expect((await entryDoc('p-lease', 'alice')).weeklyPoints).toEqual({});
    expect(await standingsDoc('p-lease')).toBeUndefined();
  }, 60000);

  it('the auto-scorer counts a lease-held pool as skipped, not scored', async () => {
    await seedScorable('p-lease2');
    await acquireScoringLease(db, 'p-lease2', Date.now());

    const r = await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect(r.poolsScored).toBe(0);
    expect(r.poolsSkipped).toBe(1);
    expect(r.poolsFailed).toBe(0);
    // No fingerprint banked — a pass that never ran must not mark the pool current.
    expect((await poolDoc('p-lease2')).autoScore?.fingerprintByWeek).toBeUndefined();
  }, 60000);

  it('an expired lease does not block a new pass', async () => {
    await seedScorable('p-lease3');
    await acquireScoringLease(db, 'p-lease3', Date.now() - SCORING_LEASE_TTL_MS - 1000);

    const result = await scoreNFLWeekInternal(db, 'p-lease3', 1, {
      pool: await poolDoc('p-lease3'), games: await loadSlate(), actor: SYSTEM_ACTOR,
    });
    expect(result.leaseBusy).toBe(false);
    expect((await entryDoc('p-lease3', 'alice')).weeklyPoints[1]).toBe(1);
  }, 60000);

  it('a stale scoring clock does not produce an already-expired lease', async () => {
    // codex r1. `opts.now` is the injectable SCORING clock: the auto-scorer
    // captures it once per run and hands the same value to every pool it works
    // through. Acquiring the lease from it means a run that has been going longer
    // than the TTL writes a lease that is already expired, and the first fenced
    // write — which compares against the real clock — throws FENCE_LOST, so every
    // pool after that point in the run scores nothing.
    await seedScorable('p-stale-clock');
    const result = await scoreNFLWeekInternal(db, 'p-stale-clock', 1, {
      pool: await poolDoc('p-stale-clock'), games: await loadSlate(), actor: SYSTEM_ACTOR,
      now: Date.now() - SCORING_LEASE_TTL_MS - 60_000,
    });

    expect(result.leaseBusy).toBe(false);
    expect(result.standingsWritten).toBe(true);
    expect((await entryDoc('p-stale-clock', 'alice')).weeklyPoints[1]).toBe(1);
  }, 60000);

  it('grades from the pool as it is AFTER the lease, not the caller snapshot', async () => {
    // codex r2. The caller reads the pool doc BEFORE the lease exists, so an
    // extendWeekDeadline can commit in between — it correctly sees no live lease,
    // writes the override and bumps lockRevision, and the fence then captures the
    // ALREADY-BUMPED revision, so the revision backstop never fires. Grading from
    // the stale snapshot would reveal a finished game while the newly accepted
    // override keeps picks open.
    await seedScorable('p-stale-pool');
    const stalePool = await poolDoc('p-stale-pool');

    // The extension lands in the gap.
    await db.collection('pools').doc('p-stale-pool').update({
      'settings.weekLockOverrides.1': Date.now() + 3 * HOUR,
      'settings.lockRevision': 1,
    });

    const result = await scoreNFLWeekInternal(db, 'p-stale-pool', 1, {
      pool: stalePool, games: await loadSlate(), actor: SYSTEM_ACTOR, provisional: true,
    });

    expect(result.leaseBusy).toBe(false);
    // Withheld: the game is FINAL but its pick window was reopened.
    expect(result.pickemScored).toBe(1);
    expect((await entryDoc('p-stale-pool', 'alice')).weeklyResults[1].total).toBe(0);
    expect((await poolDoc('p-stale-pool')).publishedWeeks).toBeUndefined();
  }, 60000);

  it('re-derives `provisional` from the post-lease pool, so a gap override cannot finalize', async () => {
    // Self-review follow-up to codex r2. `provisional` is computed by the CALLER
    // from the same pre-lease snapshot, and it gates the heavy artifacts:
    // scoredWeeks, maybeFinalizeNFLPool, the weekly recap (whose CREATE trigger
    // fires AI trash-talk and never refires). An override landing in the gap makes
    // the week incomplete, so a stale `provisional: false` would finalize a week
    // whose pick window is open.
    await seedScorable('p-stale-provisional');
    const stalePool = await poolDoc('p-stale-provisional');
    await db.collection('pools').doc('p-stale-provisional').update({
      'settings.weekLockOverrides.1': Date.now() + 3 * HOUR,
    });

    // provisional deliberately NOT passed: the caller's snapshot says complete.
    const result = await scoreNFLWeekInternal(db, 'p-stale-provisional', 1, {
      pool: stalePool, games: await loadSlate(), actor: SYSTEM_ACTOR,
    });

    expect(result.provisional).toBe(true);
    const pool = await poolDoc('p-stale-provisional');
    expect(pool.scoredWeeks).toBeUndefined();
    expect(pool.finalizedAt).toBeUndefined();
    expect(result.recapWritten).toBe(false);
  }, 60000);

  it('a lockRevision bump mid-pass discards the rest of the pass', async () => {
    // The backstop for an override that commits between lease acquisition and the
    // next fenced commit. Simulated by bumping the revision under a held fence,
    // which is exactly what extendWeekDeadline does.
    await seedScorable('p-rev-guard');
    const fence = (await acquireScoringLease(db, 'p-rev-guard', Date.now()))!;
    await db.collection('pools').doc('p-rev-guard').update({ 'settings.lockRevision': 99 });

    await expect(
      fencedWrite(db, db.collection('pools').doc('p-rev-guard'), fence, () => {}, { probe: true }),
    ).rejects.toThrow(/FENCE_LOST/);
    expect((await poolDoc('p-rev-guard')).probe).toBeUndefined();
  }, 60000);

  it('a pass that lost the lease to another owner commits nothing', async () => {
    await seedScorable('p-steal');
    const mine = (await acquireScoringLease(db, 'p-steal', Date.now()))!;
    // Someone else takes it (only possible once mine expires, which is the exact
    // stalled-worker case the fencing token exists for).
    await db.collection('pools').doc('p-steal')
      .update({ 'autoScore.scoringLease': { owner: 'someone-else', until: Date.now() + 60000 } });

    await expect(
      fencedWrite(db, db.collection('pools').doc('p-steal'), mine, () => {}, { probe: true }),
    ).rejects.toThrow(/FENCE_LOST/);
    expect((await poolDoc('p-steal')).probe).toBeUndefined();
  }, 60000);
});

// ---------------------------------------------------------------------------
// PR-B2 — the nfl_rescore_queue reconciliation tier (plan §5b)
// ---------------------------------------------------------------------------

/**
 * Every case here is about a slate the LIVE tier cannot see: its games kicked off
 * more than 24h ago, so `findActiveSlates` returns nothing and only the queue can
 * make it a candidate. That is the whole point of the tier, and it is also why
 * these have to be emulator tests — the guarantees are about which docs exist
 * afterwards (was the event acknowledged? was the pool written?), not about a
 * returned object.
 */
describe('rescore queue — the tier that catches what the 24h window cannot', () => {
  const STALE = 48 * HOUR;

  /** A finished week-1 slate whose kickoff is two days back, plus an unplayed week 2 so nothing finalizes. */
  const seedStale = async (poolId: string, type = 'NFL_PICKEM', settings: Record<string, unknown> = {}) => {
    await wipe();
    await seedGames([
      gameDoc('g1', { startTime: Date.now() - STALE }),
      laterWeekGame(),
    ]);
    await seedPool(poolId, type, { lockBufferMinutes: 5, pickMode: 'STRAIGHT', ...settings });
    await seedEntry(poolId, 'alice', { picks: { g1: 'KC' }, weeklyPoints: {}, totalScore: 0 });
  };

  const enqueue = (reason: RescoreReason, over: Record<string, unknown> = {}) =>
    enqueueRescore(db, { season: SEASON, seasonType: 1, week: 1, reason, enqueuedAt: Date.now(), ...over });

  const queueSize = async () => (await db.collection(RESCORE_QUEUE).get()).size;

  it('the live tier alone does NOTHING with a stale slate — the gap the queue exists to close', async () => {
    await seedStale('p-q-baseline');
    const r = await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect(r.activeSlates).toBe(0);
    expect(r.poolsScored).toBe(0);
    expect((await entryDoc('p-q-baseline', 'alice')).weeklyPoints[1]).toBeUndefined();
  }, 60000);

  it('a queued terminal event scores that stale slate and acknowledges the event', async () => {
    await seedStale('p-q-terminal');
    await enqueue('terminal');

    const r = await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect(r.queuedEvents).toBe(1);
    expect(r.queuedSlates).toBe(1);
    expect(r.poolsScored).toBe(1);
    expect(r.queuedAcked).toBe(1);
    expect((await entryDoc('p-q-terminal', 'alice')).weeklyPoints[1]).toBe(1);
    expect(await queueSize()).toBe(0);
  }, 60000);

  it('a DRY RUN reads the queue, writes nothing and acknowledges NOTHING', async () => {
    // codex r30. During the watching period a queued event is often the only
    // candidate for an out-of-window slate; clearing it on a dry run would leave
    // the live flip with no queue item and no active slate, so the stale result
    // would never be applied at all.
    await seedStale('p-q-dry');
    await enqueue('correction');

    const dry = await autoScoreOnce(db, Date.now(), { dryRun: true });
    expect(dry.queuedEvents).toBe(1);
    expect(dry.poolsScored).toBe(1);          // "would score"
    expect(dry.queuedAcked).toBe(0);
    expect(await queueSize()).toBe(1);
    expect((await entryDoc('p-q-dry', 'alice')).weeklyPoints[1]).toBeUndefined();
    expect((await poolDoc('p-q-dry')).autoScore?.fingerprintByWeek).toBeUndefined();

    // The handoff: the first live run still finds the work.
    const live = await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect(live.poolsScored).toBe(1);
    expect(live.queuedAcked).toBe(1);
    expect((await entryDoc('p-q-dry', 'alice')).weeklyPoints[1]).toBe(1);
  }, 60000);

  it('an event enqueued DURING a drain survives the acknowledgement', async () => {
    // The lossless requirement (codex r25) spelled out as the exact interleaving:
    // read the queue, let a new event land, then acknowledge. Deleting by the ids
    // that were READ is what makes the newcomer survive — a "clear the slate
    // marker" ack would take it with the rest.
    await seedStale('p-q-interleave');
    await enqueue('terminal');

    const read = await readRescoreQueue(db, Date.now());
    expect(read.events).toHaveLength(1);
    await enqueue('correction');                       // lands mid-drain
    await ackRescoreEvents(db, read.events.map(e => e.id));

    const after = await readRescoreQueue(db, Date.now());
    expect(after.events).toHaveLength(1);
    expect(after.events[0].event.reason).toBe('correction');
  }, 60000);

  it('a queued correction rescores a pool this job already FINALIZED', async () => {
    await seedStale('p-q-finalized');
    await db.collection('pools').doc('p-q-finalized').update({ finalizedAt: Date.now() - HOUR });
    await enqueue('correction');

    const r = await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect(r.poolsScored).toBe(1);
    expect((await entryDoc('p-q-finalized', 'alice')).weeklyPoints[1]).toBe(1);
  }, 60000);

  it('a queued event never writes into a RETIRED pool', async () => {
    // codex r9: a slate queued while active can be cancelled before the drain,
    // and maybeFinalizeNFLPool only checks cancellation AFTER the writes, so it
    // cannot undo entry/standings/recap/audit writes into a voided pool.
    await seedStale('p-q-cancelled');
    await db.collection('pools').doc('p-q-cancelled').update({ status: 'CANCELED' });
    await enqueue('correction');

    const r = await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect(r.poolsScored).toBe(0);
    expect((await entryDoc('p-q-cancelled', 'alice')).weeklyPoints[1]).toBeUndefined();
    // Still acknowledged: nothing was owed, so re-draining it every 10 minutes forever is pure cost.
    expect(await queueSize()).toBe(0);
  }, 60000);

  it('defers a Survivor pool on a correction-ONLY group, and scores it when the group carries a terminal', async () => {
    await seedStale('p-q-surv', 'NFL_SURVIVOR', {
      maxStrikes: 0, pickLosersMode: false, autoSurviveExemptionEnabled: false,
      maxRebuys: 0, rebuyDeadlineWeek: 0,
    });
    await seedEntry('p-q-surv', 'alice', {
      status: 'ALIVE', strikesUsed: 0, strikeWeeks: [], rebuysUsed: 0,
      usedTeams: ['KC'], picks: { 1: 'KC' }, exemptWeeks: [],
    });
    await enqueue('correction');

    const deferred = await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect(deferred.survivorCorrectionsDeferred).toBe(1);
    expect(deferred.poolsScored).toBe(0);
    // Acknowledged anyway — there is no repair to retry until reset-and-replay ships.
    expect(await queueSize()).toBe(0);

    // A delayed FIRST final is a normal first score and is safe for Survivor.
    await enqueue('terminal');
    const allowed = await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect(allowed.survivorCorrectionsDeferred).toBe(0);
    expect(allowed.poolsScored).toBe(1);
  }, 60000);

  it('holds a lockPending event until its notBefore, then drains it', async () => {
    await seedStale('p-q-notbefore');
    await enqueue('lockPending', { notBefore: Date.now() + HOUR });

    const early = await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect(early.queuedDeferred).toBe(1);
    expect(early.queuedEvents).toBe(0);
    expect(early.poolsScored).toBe(0);
    expect(await queueSize()).toBe(1);          // left in place, not acknowledged

    const later = await autoScoreOnce(db, Date.now() + 2 * HOUR, { dryRun: false });
    expect(later.queuedEvents).toBe(1);
    expect(later.poolsScored).toBe(1);
    expect(await queueSize()).toBe(0);
  }, 60000);

  it('a live run drops an unparseable event instead of draining it forever', async () => {
    await seedStale('p-q-junk');
    await db.collection(RESCORE_QUEUE).add({ season: '', week: 'nope', reason: 'terminal' });

    const r = await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect(r.queuedEvents).toBe(0);
    expect(r.queuedAcked).toBe(1);
    expect(await queueSize()).toBe(0);
  }, 60000);

  it('a queued slate with no games is acknowledged rather than drained forever', async () => {
    await seedStale('p-q-nogames');
    await enqueueRescore(db, { season: SEASON, seasonType: 1, week: 9, reason: 'terminal', enqueuedAt: Date.now() });

    const r = await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect(r.queuedSlates).toBe(1);
    expect(r.poolsScored).toBe(0);
    expect(await queueSize()).toBe(0);
  }, 60000);

  it('a live pass leaves a lockPending reminder for a terminal game held behind an override', async () => {
    // The §5b codex-r8 case: nothing terminal happens AT the override's expiry, so
    // without this reminder the eligibility bit is never re-evaluated once the
    // slate leaves the 24h window and the result is never revealed.
    await wipe();
    await seedGames([gameDoc('g1', { startTime: Date.now() - 3 * HOUR }), laterWeekGame()]);
    await seedPool('p-q-withheld', 'NFL_PICKEM', {
      lockBufferMinutes: 5, pickMode: 'STRAIGHT', weekLockOverrides: { 1: Date.now() + 3 * HOUR },
    });
    await seedEntry('p-q-withheld', 'alice', { picks: { g1: 'KC' }, weeklyPoints: {}, totalScore: 0 });

    await autoScoreOnce(db, Date.now(), { dryRun: false });
    const snap = await db.collection(RESCORE_QUEUE).get();
    expect(snap.size).toBe(1);
    expect(snap.docs[0].data().reason).toBe('lockPending');
    expect(snap.docs[0].data().notBefore).toBeGreaterThan(Date.now());
  }, 60000);

  it('a DRY RUN writes no lockPending reminder — a dry run writes nothing at all', async () => {
    await wipe();
    await seedGames([gameDoc('g1', { startTime: Date.now() - 3 * HOUR }), laterWeekGame()]);
    await seedPool('p-q-withheld-dry', 'NFL_PICKEM', {
      lockBufferMinutes: 5, pickMode: 'STRAIGHT', weekLockOverrides: { 1: Date.now() + 3 * HOUR },
    });
    await seedEntry('p-q-withheld-dry', 'alice', { picks: { g1: 'KC' }, weeklyPoints: {}, totalScore: 0 });

    await autoScoreOnce(db, Date.now(), { dryRun: true });
    expect(await queueSize()).toBe(0);
  }, 60000);
});
