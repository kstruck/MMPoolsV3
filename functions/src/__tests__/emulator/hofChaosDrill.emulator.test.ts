import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import './setup';
import { scoreNFLWeekInternal } from '../../nflPools';
import { autoScoreOnce } from '../../nflAutoScore';
import { enqueueRescore, RESCORE_QUEUE } from '../../lib/rescoreQueue';
import { isWeekComplete } from '../../lib/weekCompletion';
import { assessSeasonCompleteness } from '../../nflFinalize';
import type { NFLGame } from '../../nflPoolTypes';

/**
 * NFL-7 — THE HOF CHAOS DRILL: the feed going WRONG on a one-game preseason week.
 *
 * `hofDressRehearsal.emulator.test.ts` (#328) proved the HAPPY path on a
 * seasonType 1 slate: create → join → pick → lock → score → finalize, with a
 * feed that behaves. Nothing had ever exercised the same slate with a feed that
 * misbehaves, and the HOF game is the one night where a single game IS the whole
 * week AND the whole season — so every "the other games will cover for it"
 * assumption in the scorer is unavailable.
 *
 * Five failure modes, all of which ESPN has produced in real seasons:
 *   (a) a FINAL score is later CORRECTED
 *   (b) a game is POSTPONED (mapEspnGameStatus sends it back to SCHEDULED)
 *   (c) the ONLY game of the week is CANCELLED
 *   (d) the feed returns a PARTIAL or garbage payload mid-scoring
 *   (e) a game regresses FINAL → IN_PROGRESS after it has been scored
 *
 * Harness note: this file seeds Firestore directly and drives
 * `autoScoreOnce` / `scoreNFLWeekInternal`, matching
 * `autoScore.emulator.test.ts`. It does NOT use the sim harness, because a sim
 * pool is excluded from the auto-scorer by design and the whole point here is
 * the scheduled path. Its fixture is deliberately its own: a ONE-GAME week whose
 * single game is the entire season, which no other suite's helpers produce.
 */

const HOUR = 60 * 60 * 1000;
const db = admin.firestore();

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr, logoUrl: '' });
const SYSTEM_ACTOR = { uid: 'system', role: 'SYSTEM' as const, label: 'Auto Scorer' };

const SEASON = 'hof-chaos-2026';
const GID = 'hof-g1';
const AWAY = 'CAR';
const HOME = 'ARI';

/** Every member uid this file seeds. `wipe()` clears season history for all of them. */
const MEMBERS = ['alice', 'bob', 'erin', 'frank', 'gina', 'hank'] as const;

async function wipe() {
  for (const col of ['nfl_games', 'pools', RESCORE_QUEUE]) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map(async d => {
      for (const sub of ['entries', 'standings', 'weekly_recaps', 'audit', 'audit_dedupe']) {
        const s = await d.ref.collection(sub).get();
        await Promise.all(s.docs.map(x => x.ref.delete()));
      }
      await d.ref.delete();
    }));
  }
  // Season history is written by finalization and read back by the convergence
  // case, so it has to be cleared between tests too. Driven off MEMBERS rather
  // than an inline list: a test that introduces a new member and forgets to add
  // it here would inherit a champion from the previous test and pass on it.
  for (const uid of MEMBERS) {
    const s = await db.collection('users').doc(uid).collection('seasonHistory').get();
    await Promise.all(s.docs.map(d => d.ref.delete()));
  }
}

/** The HOF slate: exactly one game, CAR at ARI, already concluded 4h ago. */
const hofGame = (over: Partial<NFLGame> = {}): NFLGame => ({
  id: GID, espnGameId: GID, week: 1, season: SEASON, seasonType: 1,
  homeTeam: T(HOME), awayTeam: T(AWAY),
  startTime: Date.now() - 4 * HOUR, status: 'FINAL', scores: { home: 20, away: 24 },
  clock: '0:00', period: 4, isMonday: false, spread: { value: -3, locked: true },
  ...over,
} as NFLGame);

async function seedGame(over: Partial<NFLGame> = {}) {
  const g = hofGame(over);
  // A field explicitly set to `undefined` must be ABSENT in Firestore, not null —
  // that is the shape the importer writes when the feed omits it.
  await db.collection('nfl_games').doc(g.id).set(JSON.parse(JSON.stringify(g)));
}

async function seedPool(poolId: string, type: string, settings: Record<string, unknown>, over: Record<string, unknown> = {}) {
  await db.collection('pools').doc(poolId).set({
    name: `HOF ${type}`, type, league: 'NFL',
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
const recapDoc = async (poolId: string, week = 1) =>
  (await db.collection('pools').doc(poolId).collection('weekly_recaps').doc(`week_${week}`).get()).data();
const historyDoc = async (uid: string, poolId: string) =>
  (await db.collection('users').doc(uid).collection('seasonHistory').doc(poolId).get()).data();

async function loadSlate(week = 1): Promise<NFLGame[]> {
  const snap = await db.collection('nfl_games')
    .where('season', '==', SEASON).where('seasonType', '==', 1).where('week', '==', week).get();
  return snap.docs.map(d => d.data() as NFLGame);
}

const PICKEM = { lockBufferMinutes: 5, pickMode: 'STRAIGHT' as const, confidenceMode: false };
/**
 * `autoSurviveExemptionEnabled` is deliberately LEFT OUT: the engine reads it as
 * `?? true` (nflScoringEngine.ts:453), so omitting it exercises the default a
 * real pool has. It matters for the cancelled-week case below — the exemption
 * machinery is the mechanism that would have to rescue a non-submitter, and
 * showing it does not fire with the setting at its most generous is the point.
 */
const SURVIVOR = { maxStrikes: 0, pickLosersMode: false, maxRebuys: 0, rebuyDeadlineWeek: 0 };

// ---------------------------------------------------------------------------
// (a) A CORRECTED FINAL SCORE
// ---------------------------------------------------------------------------

/**
 * The HOF week is the whole season, so the first complete pass FINALIZES the
 * pool and writes season history. A correction therefore has to reach further
 * than the standings: it has to un-crown a champion. And by the time ESPN
 * restates a score the slate is normally outside the 24h live window, so the
 * `nfl_rescore_queue` tier (PLAN-REALTIME-SCORING §5b) is the ONLY thing that
 * can make it a candidate at all.
 */
describe('NFL-7 (a) — a corrected final score must converge standings AND season history', () => {
  const poolId = 'p-hof-correction';

  beforeEach(async () => {
    await wipe();
    await seedGame();                                    // CAR 24, ARI 20
    await seedPool(poolId, 'NFL_PICKEM', PICKEM);
    await seedEntry(poolId, 'alice', { picks: { [GID]: AWAY }, weeklyPoints: {}, totalScore: 0 });
    await seedEntry(poolId, 'bob', { picks: { [GID]: HOME }, weeklyPoints: {}, totalScore: 0 });
  });

  it('crowns the right champion first, then re-crowns the other when the feed corrects the score', async () => {
    const first = await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect(first.poolsScored).toBe(1);
    expect((await entryDoc(poolId, 'alice')).totalScore).toBe(1);
    expect((await entryDoc(poolId, 'bob')).totalScore).toBe(0);
    // One game, one week, all of it concluded: the season is complete and the
    // pool finalizes on this very first pass. That is what makes a later
    // correction hard.
    expect((await poolDoc(poolId)).finalizedAt).toBeTruthy();
    expect((await historyDoc('alice', poolId))?.isChampion).toBe(true);
    expect((await historyDoc('bob', poolId))?.isChampion).toBe(false);

    // ESPN restates it two days later: ARI actually won 27-24.
    await db.collection('nfl_games').doc(GID).update({ scores: { home: 27, away: 24 } });
    await enqueueRescore(db, {
      season: SEASON, seasonType: 1, week: 1, reason: 'correction', enqueuedAt: Date.now(),
    });

    // +48h: the live tier is blind to this slate, so the queue is the only door.
    const later = await autoScoreOnce(db, Date.now() + 48 * HOUR, { dryRun: false });
    expect(later.activeSlates).toBe(0);
    expect(later.queuedEvents).toBe(1);
    expect(later.poolsScored).toBe(1);
    expect(later.queuedAcked).toBe(1);

    expect((await entryDoc(poolId, 'alice')).totalScore).toBe(0);
    expect((await entryDoc(poolId, 'bob')).totalScore).toBe(1);

    // Member-readable standings, not just the entries.
    const rows = (await standingsDoc(poolId))!.rows as Array<Record<string, unknown>>;
    const row = (uid: string) => rows.find(r => (r.ownerUid ?? r.id) === uid)!;
    expect(row('bob').totalScore).toBe(1);
    expect(row('alice').totalScore).toBe(0);

    // The one that would otherwise rot: finalization is documented as a
    // re-runnable overwrite, so the trophy has to move too.
    expect((await historyDoc('bob', poolId))?.isChampion).toBe(true);
    expect((await historyDoc('alice', poolId))?.isChampion).toBe(false);
    expect((await historyDoc('bob', poolId))?.finalRank).toBe(1);
  }, 90000);
});

// ---------------------------------------------------------------------------
// (b) POSTPONEMENT
// ---------------------------------------------------------------------------

/**
 * `mapEspnGameStatus` sends POSTPONED/DELAYED/SUSPENDED back to SCHEDULED
 * (nflSchedule.ts:46), and the sync writes with `merge: true`, so a postponement
 * arrives as a moved `startTime` on a still-SCHEDULED game. On a one-game week
 * that means the week — and the season — must simply wait.
 */
describe('NFL-7 (b) — the only game of the week is postponed', () => {
  const poolId = 'p-hof-postponed';

  beforeEach(async () => {
    await wipe();
    await seedGame({ startTime: Date.now() + 2 * HOUR, status: 'SCHEDULED', scores: undefined });
    await seedPool(poolId, 'NFL_PICKEM', PICKEM);
    await seedEntry(poolId, 'alice', { picks: { [GID]: AWAY }, weeklyPoints: {}, totalScore: 0 });
  });

  it('reveals no grade and claims no publication while the game has not kicked off', async () => {
    // The slate IS a candidate — the active window opens 2h before kickoff — so a
    // provisional pass really does run and really does write a live standings
    // projection with everyone on 0. That is intended (PR-B1) and is NOT what is
    // asserted here. What must be absent is anything that reads as a RESULT:
    // a graded game, a publication marker, a scored week, a finalized season.
    await autoScoreOnce(db, Date.now(), { dryRun: false });
    const pool = await poolDoc(poolId);
    expect(pool.publishedWeeks).toBeUndefined();
    expect(pool.scoredWeeks).toBeUndefined();
    expect(pool.finalizedAt).toBeUndefined();
    expect((await entryDoc(poolId, 'alice')).weeklyResults?.['1']?.games).toEqual({});
    expect(await recapDoc(poolId)).toBeUndefined();
  }, 60000);

  it('after the ORIGINAL kickoff has passed, a moved startTime keeps the week incomplete and the pick window open', async () => {
    const moved = Date.now() + 5 * 24 * HOUR;
    await db.collection('nfl_games').doc(GID).update({ startTime: moved });

    // Three hours later — past where kickoff USED to be.
    const now = Date.now() + 3 * HOUR;
    const games = await loadSlate();
    expect(isWeekComplete(await poolDoc(poolId), 1, games, now)).toBe(false);

    const res = await scoreNFLWeekInternal(db, poolId, 1, {
      pool: await poolDoc(poolId), games, actor: SYSTEM_ACTOR,
      provisional: !isWeekComplete(await poolDoc(poolId), 1, games, now), now,
    });
    expect(res.provisional).toBe(true);

    // Nothing finalization-shaped may exist: the game has not been played.
    const pool = await poolDoc(poolId);
    expect(pool.scoredWeeks).toBeUndefined();
    expect(pool.publishedWeeks).toBeUndefined();
    expect(pool.finalizedAt).toBeUndefined();
    expect(await recapDoc(poolId)).toBeUndefined();
    expect((await historyDoc('alice', poolId))).toBeUndefined();
  }, 60000);

  it('reports a game still SCHEDULED 13h past its own kickoff as STALLED rather than pending forever', async () => {
    // The postponement nobody entered: ESPN moved nothing, the game just never
    // happened. On a 16-game week this is one blocked pool among many; on the HOF
    // week it is the entire pilot sitting unfinalized, so an operator has to be
    // able to tell "waiting for tonight" from "waiting forever".
    // Only `startTime` moves here: this describe's beforeEach already seeded the
    // game SCHEDULED, which is the state a postponement leaves behind. Spelled
    // out because `seedGame()`'s own default is FINAL, and a reader (or a
    // reviewer) landing on this line alone will assume the default applies —
    // codex round 1 did exactly that and filed it as a P1.
    const startTime = Date.now() - 13 * HOUR;
    await db.collection('nfl_games').doc(GID).update({ startTime });
    expect((await loadSlate())[0].status).toBe('SCHEDULED');

    const verdict = assessSeasonCompleteness(
      [{ id: GID, week: 1, status: 'SCHEDULED', startTime }], {}, Date.now(),
    );
    expect(verdict.complete).toBe(false);
    expect(verdict.stalledGameIds).toEqual([GID]);
    expect(verdict.reason).toMatch(/STALLED/);

    // The week-completeness half, pinned on the TERMINAL check specifically.
    // In the moved-startTime case above the week is incomplete for a second,
    // independent reason — the new kickoff has not passed, so the game is not
    // lock-closed either — and that assertion therefore survives a mutation that
    // makes SCHEDULED count as concluded. Here the kickoff is 13h in the PAST, so
    // the lock IS closed and `isTerminalGame` is the only thing left holding the
    // week open. Mutation-verified: without this line, teaching `isTerminalGame`
    // to accept SCHEDULED leaves the whole drill green.
    expect(isWeekComplete(await poolDoc(poolId), 1, await loadSlate(), Date.now())).toBe(false);

    // And the pool really is left alone by the scheduled path.
    await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect((await poolDoc(poolId)).finalizedAt).toBeUndefined();
  }, 60000);
});

// ---------------------------------------------------------------------------
// (c) THE ONLY GAME OF THE WEEK IS CANCELLED
// ---------------------------------------------------------------------------

/**
 * HOF-specific: no other week can reach this state, because no other week has
 * one game. A cancelled game is TERMINAL (`isTerminalGame`), so the week reads
 * COMPLETE and the season finalizes — off a week in which nothing was played.
 *
 * The pointed question is what happens to a member who never submitted. The
 * no-pick penalty (Survivor strike, Margin -14) exists to punish not showing up
 * for a game. When the game itself was cancelled there was nothing to show up
 * for, and `checkAutoSurviveExemption` cannot rescue them: it requires
 * `teamsPlaying.size > 0`, and a fully-cancelled week has none.
 */
describe('NFL-7 (c) — the only game of the week is CANCELLED', () => {
  beforeEach(async () => {
    await wipe();
    await seedGame({ status: 'CANCELLED', scores: undefined });
  });

  it('Pick’em: a picked cancelled game grades VOID and the week still completes', async () => {
    const poolId = 'p-cancel-pickem';
    await seedPool(poolId, 'NFL_PICKEM', PICKEM);
    await seedEntry(poolId, 'alice', { picks: { [GID]: AWAY }, weeklyPoints: {}, totalScore: 0 });

    const r = await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect(r.poolsScored).toBe(1);

    const alice = await entryDoc(poolId, 'alice');
    expect(alice.weeklyResults?.['1']?.games?.[GID]?.result).toBe('VOID');
    expect(alice.totalScore).toBe(0);
    expect((await poolDoc(poolId)).scoredWeeks?.['1']).toBe(true);
    expect(await recapDoc(poolId)).toBeTruthy();
    expect((await poolDoc(poolId)).finalizedAt).toBeTruthy();
  }, 60000);

  it('Survivor: a member who PICKED the cancelled game survives on a VOID', async () => {
    const poolId = 'p-cancel-survivor-picked';
    await seedPool(poolId, 'NFL_SURVIVOR', SURVIVOR);
    await seedEntry(poolId, 'erin', {
      status: 'ALIVE', strikesUsed: 0, strikeWeeks: [], rebuysUsed: 0,
      usedTeams: [AWAY], picks: { 1: AWAY }, exemptWeeks: [],
    });

    await autoScoreOnce(db, Date.now(), { dryRun: false });

    expect((await entryDoc(poolId, 'erin')).status).toBe('ALIVE');
    expect((await entryDoc(poolId, 'erin')).strikesUsed).toBe(0);
    expect((await entryDoc(poolId, 'erin')).weeklyResults?.['1']?.game?.result).toBe('VOID');
  }, 60000);

  /**
   * DEFECT NFL7-1 — FIXED by PLAN-NFL7-CHAOS-FIXES §3.2. Was report-only per the it.fails() convention of
   * `goldenArc` and `poolPot`. The body asserts the behaviour the pilot needs;
   * it currently throws, and when the fix lands this flips to "expected failure
   * passed" and must be promoted to a plain it().
   *
   * A Survivor member who never submitted is auto-struck
   * (`evaluateSurvivorWeek`, nflScoringEngine.ts:196). That is right when there
   * was a game to pick. On a week where EVERY game is cancelled there was no
   * legal pick to make, and `checkAutoSurviveExemption` cannot rescue them: it
   * returns false unless `teamsPlaying.size > 0`, and a fully-cancelled slate
   * contributes no teams. So the exemption machinery — even at its default-ON
   * setting — is silent exactly when it is needed.
   *
   * HOF blast radius: one game IS the week, so a cancellation eliminates every
   * non-submitter in the pool on night one, with `maxStrikes: 0`.
   */
  it('Survivor: a NON-SUBMITTER is not struck for a week whose only game was cancelled', async () => {
    const poolId = 'p-cancel-survivor-nopick';
    await seedPool(poolId, 'NFL_SURVIVOR', SURVIVOR);
    await seedEntry(poolId, 'frank', {
      status: 'ALIVE', strikesUsed: 0, strikeWeeks: [], rebuysUsed: 0,
      usedTeams: [], picks: {}, exemptWeeks: [],
    });

    await autoScoreOnce(db, Date.now(), { dryRun: false });

    expect((await entryDoc(poolId, 'frank')).strikesUsed).toBe(0);
    expect((await entryDoc(poolId, 'frank')).status).toBe('ALIVE');
  }, 60000);

  it('Margin: a member who PICKED the cancelled game nets 0', async () => {
    const poolId = 'p-cancel-margin-picked';
    await seedPool(poolId, 'NFL_MARGIN', {});
    await seedEntry(poolId, 'gina', { picks: { 1: AWAY }, weeklyScores: {}, seasonTotal: 0, negativeBurden: 0 });

    await autoScoreOnce(db, Date.now(), { dryRun: false });

    expect((await entryDoc(poolId, 'gina')).weeklyScores?.['1']).toBe(0);
    expect((await entryDoc(poolId, 'gina')).negativeBurden).toBe(0);
  }, 60000);

  /**
   * DEFECT NFL7-2 — the Margin half of NFL7-1, and a separate code path:
   * the -14 no-submission penalty is inline in `nflPools.ts:1271`, not in the
   * engine, so fixing the Survivor side alone would leave this standing.
   */
  it('Margin: a NON-SUBMITTER is not charged -14 for a game that was never played', async () => {
    const poolId = 'p-cancel-margin-nopick';
    await seedPool(poolId, 'NFL_MARGIN', {});
    await seedEntry(poolId, 'hank', { picks: {}, weeklyScores: {}, seasonTotal: 0, negativeBurden: 0 });

    await autoScoreOnce(db, Date.now(), { dryRun: false });

    expect((await entryDoc(poolId, 'hank')).weeklyScores?.['1']).toBe(0);
    expect((await entryDoc(poolId, 'hank')).negativeBurden).toBe(0);
  }, 60000);
});

// ---------------------------------------------------------------------------
// (d) PARTIAL / GARBAGE FEED
// ---------------------------------------------------------------------------

/**
 * `nflSchedule.ts:271` deliberately OMITS the `scores` object when the feed
 * delivers no score for either competitor, so that a partial payload is
 * distinguishable from a real 0-0 (the A5 false-correction guard). That leaves a
 * genuinely reachable document: `status: FINAL` with NO `scores` field.
 *
 * Every engine then reads `game.scores?.home ?? 0`. Nothing downstream repeats
 * the importer's distinction — so this asks whether the scorer notices.
 */
describe('NFL-7 (d) — a partial or garbage feed payload', () => {
  beforeEach(async () => { await wipe(); });

  /**
   * DEFECT NFL7-3 — FIXED by PLAN-NFL7-CHAOS-FIXES §3.1.
   *
   * The importer goes out of its way to make "ESPN dropped the field" and "the
   * team scored zero" distinguishable: it emits NO `scores` object at all when
   * neither competitor carries a score (nflSchedule.ts:267-271), precisely so
   * `detectStatCorrections` does not page a false 21-17 → 0-0 correction. Nothing
   * downstream repeats that distinction — every engine reads
   * `game.scores?.home ?? 0` — so a FINAL with no scores grades as a real 0-0.
   *
   * For Pick'em that is a PUSH for everyone, which is a published result nobody
   * played. Worse, the week then reads COMPLETE, so `scoredWeeks` is stamped, the
   * recap is written and (on the one-game HOF season) the pool FINALIZES. When
   * the real scores arrive they are a "correction" to a settled pool rather than
   * the first score of an unsettled one.
   */
  it('Pick’em: a FINAL game with NO scores object is not graded as a 0-0 tie', async () => {
    await seedGame({ scores: undefined });
    const poolId = 'p-partial-pickem';
    await seedPool(poolId, 'NFL_PICKEM', PICKEM);
    await seedEntry(poolId, 'alice', { picks: { [GID]: AWAY }, weeklyPoints: {}, totalScore: 0 });

    await autoScoreOnce(db, Date.now(), { dryRun: false });

    expect((await entryDoc(poolId, 'alice')).weeklyResults?.['1']?.games?.[GID]).toBeUndefined();
    expect((await poolDoc(poolId)).scoredWeeks?.['1']).toBeUndefined();
  }, 60000);

  /**
   * DEFECT NFL7-4 — the same root cause as NFL7-3 with the worst blast radius.
   * A 0-0 reads as a TIE, and a tie is a strike (`evaluateSurvivorWeek`:230-242).
   * With `maxStrikes: 0` that is an ELIMINATION caused entirely by a field the
   * feed happened to drop — and it eliminates the member who picked correctly
   * just as readily as the one who did not.
   */
  it('Survivor: a FINAL game with NO scores object does not strike the member who picked it', async () => {
    await seedGame({ scores: undefined });
    const poolId = 'p-partial-survivor';
    await seedPool(poolId, 'NFL_SURVIVOR', SURVIVOR);
    await seedEntry(poolId, 'erin', {
      status: 'ALIVE', strikesUsed: 0, strikeWeeks: [], rebuysUsed: 0,
      usedTeams: [AWAY], picks: { 1: AWAY }, exemptWeeks: [],
    });

    await autoScoreOnce(db, Date.now(), { dryRun: false });

    expect((await entryDoc(poolId, 'erin')).strikesUsed).toBe(0);
    expect((await entryDoc(poolId, 'erin')).status).toBe('ALIVE');
  }, 60000);

  it('ATS: a null spread on a locked spread falls back to straight-up rather than throwing', async () => {
    // Documented behaviour (nflScoringEngine.ts:46). Pinned because the fallback
    // is silent: an ATS pool graded straight-up looks identical in the UI.
    await seedGame({ spread: { value: null, locked: true } as never });
    const poolId = 'p-partial-ats';
    await seedPool(poolId, 'NFL_PICKEM', { ...PICKEM, pickMode: 'ATS' });
    await seedEntry(poolId, 'alice', { picks: { [GID]: AWAY }, weeklyPoints: {}, totalScore: 0 });

    const r = await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect(r.poolsFailed).toBe(0);
    // CAR won 24-20 outright, so a straight-up grade is a W.
    expect((await entryDoc(poolId, 'alice')).weeklyResults?.['1']?.games?.[GID]?.result).toBe('W');
  }, 60000);

  /**
   * DEFECT NFL7-5 — FIXED by PLAN-NFL7-CHAOS-FIXES §3.3. LATENT rather than live.
   *
   * `isWeekComplete` is `games.every(...)`, which is vacuously TRUE for an empty
   * array: an empty slate reads as a fully-concluded week. Every caller today
   * happens to be safe — `scoreNFLWeek` throws on `games.length === 0`
   * (nflPools.ts:1504) and a slate from `findActiveSlates`/the queue drain is
   * built FROM games — so this is not reachable in production as written.
   *
   * It is worth pinning anyway because the failure is silent and total: the one
   * caller that ever hands it `[]` gets `provisional: false`, stamps
   * `scoredWeeks`, writes a recap and finalizes a season on a slate it could not
   * read. On the HOF week that is the whole pilot settled off a failed fetch.
   */
  it('an EMPTY slate never completes a week or finalizes a season', async () => {
    await seedGame();
    const poolId = 'p-empty-slate';
    await seedPool(poolId, 'NFL_PICKEM', PICKEM);
    await seedEntry(poolId, 'alice', { picks: { [GID]: AWAY }, weeklyPoints: {}, totalScore: 0 });

    const pool = await poolDoc(poolId);
    const now = Date.now();
    expect(isWeekComplete(pool, 1, [], now)).toBe(false);

    await scoreNFLWeekInternal(db, poolId, 1, {
      pool, games: [], actor: SYSTEM_ACTOR,
      provisional: !isWeekComplete(pool, 1, [], now), now,
    });
    expect((await poolDoc(poolId)).scoredWeeks).toBeUndefined();
    expect((await poolDoc(poolId)).finalizedAt).toBeUndefined();
  }, 60000);
});

// ---------------------------------------------------------------------------
// (e) FINAL → IN_PROGRESS REGRESSION
// ---------------------------------------------------------------------------

/**
 * The feed marks the game FINAL, the pool scores and finalizes, and then a later
 * poll reports it IN_PROGRESS again — a real ESPN behaviour when a game is
 * resumed or a status is misfiled. The pool is now FINALIZED off a game the feed
 * says is still being played.
 *
 * The failure to avoid is a HALF state: a published week whose grades have been
 * silently withdrawn while `finalizedAt` and the season history stand.
 */
describe('NFL-7 (e) — a game regresses FINAL → IN_PROGRESS after it was scored', () => {
  const poolId = 'p-hof-regression';

  beforeEach(async () => {
    await wipe();
    await seedGame();
    await seedPool(poolId, 'NFL_PICKEM', PICKEM);
    await seedEntry(poolId, 'alice', { picks: { [GID]: AWAY }, weeklyPoints: {}, totalScore: 0 });
    await seedEntry(poolId, 'bob', { picks: { [GID]: HOME }, weeklyPoints: {}, totalScore: 0 });
  });

  it('leaves the settled result alone — the finalized pool is not a candidate', async () => {
    await autoScoreOnce(db, Date.now(), { dryRun: false });
    const alice = await entryDoc(poolId, 'alice');
    expect(alice.totalScore).toBe(1);
    expect(alice.weeklyResults?.['1']?.games?.[GID]?.result).toBe('W');
    expect((await poolDoc(poolId)).finalizedAt).toBeTruthy();
    expect((await poolDoc(poolId)).publishedWeeks?.['1']).toBe(true);

    // The feed regresses, still inside the 24h live window.
    await db.collection('nfl_games').doc(GID).update({ status: 'IN_PROGRESS', clock: '2:00', period: 4 });
    const r = await autoScoreOnce(db, Date.now(), { dryRun: false });

    // WHY this is safe, stated rather than implied: `finalizedAt` makes the pool
    // terminal, so candidate selection drops it and the regression is a complete
    // no-op. The slate is still active (the game is back to non-terminal), which
    // is why `activeSlates` is 1 and `poolsScored` is 0 — those two numbers
    // together are the evidence, and asserting only the entry would pass equally
    // against a pass that re-graded to the identical values.
    expect(r.activeSlates).toBe(1);
    expect(r.poolsScored).toBe(0);
    expect(r.poolsFailed).toBe(0);

    const after = await entryDoc(poolId, 'alice');
    expect(after.resultsVersion).toBe(alice.resultsVersion);
    expect(after.totalScore).toBe(1);
    expect(after.weeklyResults?.['1']?.games?.[GID]?.result).toBe('W');
    expect((await historyDoc('alice', poolId))?.isChampion).toBe(true);
  }, 90000);

  /**
   * The other half of the same story, and the reason the no-op above is a
   * DESIGN rather than an accident: a regression that turns out to be real
   * (the game genuinely resumes and ends differently) still has a door.
   * The reconciliation queue bypasses the finalization exclusion — that is
   * exactly what §5b's "finalized pools with a late correction" clause is for.
   */
  it('a queued correction can still reach the pool once the game concludes again', async () => {
    await autoScoreOnce(db, Date.now(), { dryRun: false });
    expect((await entryDoc(poolId, 'alice')).totalScore).toBe(1);

    await db.collection('nfl_games').doc(GID).update({ status: 'IN_PROGRESS' });
    await autoScoreOnce(db, Date.now(), { dryRun: false });          // no-op, as above

    // The resumed game ends the other way.
    await db.collection('nfl_games').doc(GID).update({ status: 'FINAL', scores: { home: 31, away: 24 } });
    await enqueueRescore(db, {
      season: SEASON, seasonType: 1, week: 1, reason: 'correction', enqueuedAt: Date.now(),
    });
    const drained = await autoScoreOnce(db, Date.now() + 48 * HOUR, { dryRun: false });

    expect(drained.poolsScored).toBe(1);
    expect((await entryDoc(poolId, 'alice')).totalScore).toBe(0);
    expect((await entryDoc(poolId, 'bob')).totalScore).toBe(1);
    expect((await historyDoc('bob', poolId))?.isChampion).toBe(true);
  }, 90000);
});
