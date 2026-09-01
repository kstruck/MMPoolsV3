import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import {
    simStartRun, simJoinMembers, simSubmitPicks, simExecuteRebuy,
    simSeedNFLGames, simFinalizePool, cleanupSimPool,
} from '../../simHarness';
import { scoreNFLWeek, submitNFLPicks, scoreNFLWeekInternal } from '../../nflPools';
import { updatePoolSettings } from '../../poolOps';
import type { NFLGame } from '../../nflPoolTypes';

/**
 * Golden-arc emulator gate (PLAN-NFL-SIM-HARNESS Phases 2-3).
 *
 * Certifies the REAL member-action paths end to end as sim subjects:
 *   simJoinMembers -> real join internal (membership, Member Record, participations)
 *   simSubmitPicks -> real submit internal (locks, membership, used-teams, consensus)
 *   scoreNFLWeek   -> real scorer
 *   simExecuteRebuy -> real rebuy internal
 *   simFinalizePool -> real finalize with allowSim (the ONLY sim finalize door)
 *   cleanupSimPool -> zero residue (Phase 0.8 contract)
 *
 * Also the extraction regression: the PUBLIC submitNFLPicks wrapper still
 * authenticates and enforces membership exactly as before.
 */
const test = ftest();
const db = admin.firestore();

const wStart = test.wrap(simStartRun);
const wJoin = test.wrap(simJoinMembers);
const wSubmit = test.wrap(simSubmitPicks);
const wRebuy = test.wrap(simExecuteRebuy);
const wSeed = test.wrap(simSeedNFLGames);
const wFinalize = test.wrap(simFinalizePool);
const wCleanup = test.wrap(cleanupSimPool);
const wScore = test.wrap(scoreNFLWeek);
const wPublicSubmit = test.wrap(submitNFLPicks);
const wUpdateSettings = test.wrap(updatePoolSettings);

const superAdmin = { uid: 'admin-1', token: { role: 'SUPER_ADMIN' } } as any;

// Claim+doc (PLAN-API-TRUST-BOUNDARY Phase 3): every SUPER_ADMIN claim must be
// backed by a users/{uid}.role doc; suites share one emulator DB and another
// file's wipe can delete it, so re-seed per test.
beforeEach(async () => {
    await db.collection('users').doc('admin-1').set({ role: 'SUPER_ADMIN' }, { merge: true });
});

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });
const HOUR = 60 * 60 * 1000;

async function seedSimPool(poolId: string, runId: string, type: string, settings: Record<string, unknown>) {
    await db.collection('pools').doc(poolId).set({
        name: `Golden ${type}`, type, league: 'NFL',
        season: `sim-${runId}`, seasonType: 2, simRunId: runId,
        ownerId: 'admin-1', participantIds: ['admin-1'],
        status: 'OPEN', billing: { status: 'free' }, settings,
    });
}

describe('golden arc — real-path pick’em lifecycle', () => {
    const runId = 'run-golden-pickem';
    const poolId = `pool-${runId}`;
    const ALICE = `sim-${runId}-alice`;
    const BOB = `sim-${runId}-bob`;

    beforeAll(async () => {
        await wStart({ data: { runId, scenarioId: 'golden-pickem' }, auth: superAdmin } as never);
        await seedSimPool(poolId, runId, 'NFL_PICKEM', {
            entryFee: 10, lockMode: 'PER_GAME', payoutMode: 'SEASON',
            pickMode: 'STRAIGHT', confidenceMode: false, payouts: { places: [], bonuses: [] },
        });
        // g1 kicks off in 2h (open), g2 kicked off 2h ago (locked).
        await wSeed({
            data: {
                runId,
                games: [
                    { week: 1, seasonType: 2, startTime: Date.now() + 2 * HOUR, status: 'SCHEDULED', isMonday: false, homeTeam: T('KC'), awayTeam: T('BUF'), scores: { home: 0, away: 0 }, spread: { value: -3, locked: true } },
                    { week: 1, seasonType: 2, startTime: Date.now() - 2 * HOUR, status: 'IN_PROGRESS', isMonday: true, homeTeam: T('SF'), awayTeam: T('DAL'), scores: { home: 14, away: 7 }, spread: { value: -7, locked: true } },
                ],
            },
            auth: superAdmin,
        } as never);
    }, 30000);

    it('joins simulated members through the real join flow (participants, Member Record, participation)', async () => {
        await wJoin({
            data: { poolId, runId, members: [{ uid: ALICE, name: 'Alice' }, { uid: BOB, name: 'Bob' }] },
            auth: superAdmin,
        } as never);
        const pool = (await db.collection('pools').doc(poolId).get()).data()!;
        expect(pool.participantIds).toContain(ALICE);
        expect(pool.participantIds).toContain(BOB);
        const member = (await db.collection('pools').doc(poolId).collection('members').doc(ALICE).get()).data();
        expect(member?.userName).toBe('Alice');
        const part = await db.collection('users').doc(ALICE).collection('participations').doc(poolId).get();
        expect(part.exists).toBe(true);
    }, 30000);

    it('REJECTS a submit from a non-member sim subject (membership binds to the SUBJECT)', async () => {
        const STRANGER = `sim-${runId}-mallory`;
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: STRANGER, week: 1, picks: { [`sim-${runId}-g1`]: 'KC' } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/NOT_POOL_MEMBER/);
    }, 30000);

    it('accepts a pre-lock pick and REJECTS changing a post-kickoff pick (real lock path)', async () => {
        // Pre-lock game g1: accepted.
        await wSubmit({
            data: { poolId, runId, subjectUid: ALICE, week: 1, picks: { [`sim-${runId}-g1`]: 'KC' }, tiebreakerPrediction: 38 },
            auth: superAdmin,
        } as never);
        const entry = (await db.collection('pools').doc(poolId).collection('entries').doc(ALICE).get()).data()!;
        expect(entry.picks[`sim-${runId}-g1`]).toBe('KC');
        expect(entry.simRunId).toBe(runId); // Phase 0.3 stamp on the real path too
        expect(entry.userName).toBe('alice'); // subjectName derived from run-scoped uid

        // Locked game g2: a NEW pick on a kicked-off game must be rejected.
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: ALICE, week: 1, picks: { [`sim-${runId}-g2`]: 'SF' } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/GAME_LOCKED/);
    }, 30000);

    it('post-submit consensus recompute wrote the pool consensus tally', async () => {
        const c = (await db.collection('pools').doc(poolId).collection('consensus').doc(`sim-${runId}-g1`).get()).data();
        expect(c?.total).toBe(1);
        expect(c?.homeAbbr === 'KC' ? c?.home : c?.away).toBe(1); // Alice picked KC
    }, 30000);

    it('public submitNFLPicks wrapper still authenticates + enforces membership (extraction regression)', async () => {
        await expect(wPublicSubmit({
            data: { poolId, week: 1, picks: { [`sim-${runId}-g1`]: 'KC' } },
        } as never)).rejects.toThrow(/logged in/i);
        await expect(wPublicSubmit({
            data: { poolId, week: 1, picks: { [`sim-${runId}-g1`]: 'KC' } },
            auth: { uid: 'random-real-user', token: {} },
        } as never)).rejects.toThrow(/NOT_POOL_MEMBER/);
    }, 30000);

    it('scores the week with the real engine, finalizes via simFinalizePool, cleans to zero residue', async () => {
        // Conclude both games, then score.
        await wSeed({
            data: {
                runId,
                games: [
                    { week: 1, seasonType: 2, startTime: Date.now() - 4 * HOUR, status: 'FINAL', isMonday: false, homeTeam: T('KC'), awayTeam: T('BUF'), scores: { home: 27, away: 24 }, spread: { value: -3, locked: true } },
                    { week: 1, seasonType: 2, startTime: Date.now() - 4 * HOUR, status: 'FINAL', isMonday: true, homeTeam: T('SF'), awayTeam: T('DAL'), scores: { home: 21, away: 17 }, spread: { value: -7, locked: true } },
                ],
            },
            auth: superAdmin,
        } as never);
        await db.collection('pools').doc(poolId).update({ scoredWeeks: {} });
        await wScore({ data: { poolId, week: 1 }, auth: superAdmin } as never);

        const alice = (await db.collection('pools').doc(poolId).collection('entries').doc(ALICE).get()).data()!;
        expect(alice.totalScore).toBe(1); // KC won; Alice's only pick

        // Inline finalize must NOT have fired for this sim pool (Phase 0.2)...
        let pool = (await db.collection('pools').doc(poolId).get()).data()!;
        expect(pool.finalizedAt).toBeUndefined();

        // ...the explicit sim door DOES finalize it.
        const outcome = await wFinalize({ data: { poolId, runId }, auth: superAdmin } as never);
        expect(outcome.finalized).toBe(true);
        pool = (await db.collection('pools').doc(poolId).get()).data()!;
        expect(pool.finalizedAt).toBeTruthy();
        const hist = (await db.collection('users').doc(ALICE).collection('seasonHistory').doc(poolId).get()).data();
        expect(hist?.finalRank).toBe(1);
        expect(hist?.isChampion).toBe(true);

        // Cleanup: manifest-driven, zero residue (admin_audit + manifest exempt).
        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
        expect((await db.collection('pools').doc(poolId).get()).exists).toBe(false);
        expect((await db.collection('users').doc(ALICE).collection('seasonHistory').doc(poolId).get()).exists).toBe(false);
        expect((await db.collection('publicProfiles').doc(ALICE).get()).exists).toBe(false);
        expect((await db.collection('nfl_games').doc(`sim-${runId}-g1`).get()).exists).toBe(false);
        const manifest = (await db.collection('simRuns').doc(runId).get()).data();
        expect(manifest?.status).toBe('CLEANED');
    }, 60000);
});

describe('golden arc — survivor rebuy through the real path', () => {
    const runId = 'run-golden-surv';
    const poolId = `pool-${runId}`;
    const CAROL = `sim-${runId}-carol`;

    it('eliminated subject rebuys via simExecuteRebuy and is ALIVE again', async () => {
        await wStart({ data: { runId, scenarioId: 'golden-survivor' }, auth: superAdmin } as never);
        await seedSimPool(poolId, runId, 'NFL_SURVIVOR', {
            entryFee: 20, maxStrikes: 0, pickLosersMode: false, autoSurviveExemption: false,
            maxRebuys: 1, rebuyDeadlineWeek: 3, rebuyCost: 20, payouts: { places: [], bonuses: [] },
        });
        await wSeed({
            data: {
                runId,
                games: [{ week: 1, seasonType: 2, startTime: Date.now() + 2 * HOUR, status: 'SCHEDULED', isMonday: false, homeTeam: T('KC'), awayTeam: T('BUF'), scores: { home: 0, away: 0 }, spread: { value: -3, locked: true } }],
            },
            auth: superAdmin,
        } as never);
        await wJoin({ data: { poolId, runId, members: [{ uid: CAROL, name: 'Carol' }] }, auth: superAdmin } as never);

        // Real submit pre-lock: Carol takes BUF.
        await wSubmit({
            data: { poolId, runId, subjectUid: CAROL, week: 1, picks: { 1: 'BUF' } },
            auth: superAdmin,
        } as never);

        // BUF loses; score the week with the real engine -> Carol eliminated.
        await wSeed({
            data: {
                runId,
                games: [{ week: 1, seasonType: 2, startTime: Date.now() - 4 * HOUR, status: 'FINAL', isMonday: false, homeTeam: T('KC'), awayTeam: T('BUF'), scores: { home: 27, away: 10 }, spread: { value: -3, locked: true } }],
            },
            auth: superAdmin,
        } as never);
        await wScore({ data: { poolId, week: 1 }, auth: superAdmin } as never);
        let carol = (await db.collection('pools').doc(poolId).collection('entries').doc(CAROL).get()).data()!;
        expect(carol.status).toBe('ELIMINATED');

        // Real rebuy path: strikes reset, ALIVE, rebuy dues on the Member Record.
        await wRebuy({ data: { poolId, runId, subjectUid: CAROL, week: 2 }, auth: superAdmin } as never);
        carol = (await db.collection('pools').doc(poolId).collection('entries').doc(CAROL).get()).data()!;
        expect(carol.status).toBe('ALIVE');
        expect(carol.rebuysUsed).toBe(1);
        const member = (await db.collection('pools').doc(poolId).collection('members').doc(CAROL).get()).data();
        expect(member?.rebuyOwed).toBe(20);

        // The rebuy-week check (nflPools executeSurvivorRebuyInternal, "Verify
        // Deadline cutoff"): a rebuy for a week past rebuyDeadlineWeek (3 here)
        // is refused before any entry state is read, and changes nothing.
        await expect(wRebuy({ data: { poolId, runId, subjectUid: CAROL, week: 4 }, auth: superAdmin } as never))
            .rejects.toThrow(/PAST_DEADLINE/);
        carol = (await db.collection('pools').doc(poolId).collection('entries').doc(CAROL).get()).data()!;
        expect(carol.rebuysUsed).toBe(1);
        expect((await db.collection('pools').doc(poolId).collection('members').doc(CAROL).get()).data()?.rebuyOwed).toBe(20);

        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
    }, 60000);
});

/**
 * Weekly HARD lock through the REAL submit path (Kevin's ruling 2026-07-25,
 * PR-0 / #272). Survivor and Margin share the enforcement but each throws its
 * own WEEK_LOCKED message, so both types run the same arc: a submit before the
 * deadline is accepted, a submit after it is refused, and BOTH record the
 * week's frozen deadline (`hardLockByWeek`) — the refused one too, because the
 * freeze is persisted BEFORE the lock check (freeze-before-enforce), which is
 * what stops a later buffer widening from reopening a week that already threw.
 */
describe.each([
    ['NFL_SURVIVOR', 'run-golden-hardlock-surv'],
    ['NFL_MARGIN', 'run-golden-hardlock-margin'],
] as const)('golden arc — %s weekly hard lock through the real submit path', (type, runId) => {
    const poolId = `pool-${runId}`;
    const ALICE = `sim-${runId}-alice`;
    const SEC = 1000;
    const MINUTE = 60 * SEC;

    it('accepts pre-deadline, throws WEEK_LOCKED at T+1s, and freezes the deadline both times', async () => {
        await wStart({ data: { runId, scenarioId: `golden-hardlock-${type}` }, auth: superAdmin } as never);
        // No lock settings on purpose: the hard lock derives from the pool TYPE
        // and the absent buffer snaps to the 5-minute preset.
        await seedSimPool(poolId, runId, type, { entryFee: 10, payouts: { places: [], bonuses: [] } });
        const now = Date.now();
        const week1Start = now + 10 * MINUTE;        // deadline (−5min buffer) ≈ now+5min → OPEN
        const week2Start = now + 5 * MINUTE - SEC;   // deadline ≈ now−1s → LOCKED, submit lands at T+1s
        await wSeed({
            data: {
                runId,
                games: [
                    { week: 1, seasonType: 2, startTime: week1Start, status: 'SCHEDULED', isMonday: false, homeTeam: T('KC'), awayTeam: T('BUF'), scores: { home: 0, away: 0 }, spread: { value: -3, locked: true } },
                    { week: 2, seasonType: 2, startTime: week2Start, status: 'SCHEDULED', isMonday: false, homeTeam: T('SF'), awayTeam: T('DAL'), scores: { home: 0, away: 0 }, spread: { value: -7, locked: true } },
                ],
            },
            auth: superAdmin,
        } as never);
        await wJoin({ data: { poolId, runId, members: [{ uid: ALICE, name: 'Alice' }] }, auth: superAdmin } as never);

        // Week 1: deadline ~5 minutes away → accepted, and the successful
        // submit records the frozen deadline for its week.
        await wSubmit({ data: { poolId, runId, subjectUid: ALICE, week: 1, picks: { 1: 'KC' } }, auth: superAdmin } as never);
        let pool = (await db.collection('pools').doc(poolId).get()).data()!;
        expect(pool.hardLockByWeek?.['1']).toBe(week1Start - 5 * MINUTE);

        // Week 2: the deadline passed one second ago → the hard weekly lock refuses.
        await expect(wSubmit({ data: { poolId, runId, subjectUid: ALICE, week: 2, picks: { 2: 'SF' } }, auth: superAdmin } as never))
            .rejects.toThrow(/WEEK_LOCKED/);

        // …and the REFUSED submit still recorded the freeze (freeze-before-enforce,
        // nflPools: persisted before the lock is enforced, precisely so the first
        // post-deadline submit leaves a frozen value behind).
        pool = (await db.collection('pools').doc(poolId).get()).data()!;
        expect(pool.hardLockByWeek?.['2']).toBe(week2Start - 5 * MINUTE);

        // Only the accepted week-1 pick reached the entry.
        const entry = (await db.collection('pools').doc(poolId).collection('entries').doc(ALICE).get()).data()!;
        expect(entry.picks['1']).toBe('KC');
        expect(entry.picks['2']).toBeUndefined();

        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
    }, 60000);
});

/**
 * KNOWN RESIDUAL (effectiveLock.ts, codex r5 — deferred to the settings-path
 * PR): the freeze defends a week only if something recorded it before that
 * week's original deadline passed. Settings edits now DO go through the
 * `updatePoolSettings` callable (PR-B′), but the callable still does not
 * freeze the outgoing deadline when a lock-affecting save lands — so on a week
 * NOBODY touched (no submit, no proxy pick, no reminder pass), a deadline that
 * passes unfrozen can be reopened by narrowing the buffer.
 *
 * it.fails() documents the hole WITHOUT fixing it (report-only): the body
 * asserts the DESIRED behaviour — the narrow cannot reopen the week — which is
 * exactly what does not hold today. When updatePoolSettings learns to freeze
 * transactionally on lock-affecting saves, this test reports "expected failure
 * passed" — flip it to a plain it() and it becomes the fix's regression guard.
 *
 * THE TRAP THIS TEST MUST AVOID: any submit before the narrow — even a REFUSED
 * one — records the freeze (freeze-before-enforce) and the reopen disappears.
 * So the body must not "sanity check" the locked state by submitting first.
 */
describe('golden arc — hard-lock freeze residual (updatePoolSettings does not freeze)', () => {
    const runId = 'run-golden-freeze-residual';
    const poolId = `pool-${runId}`;
    const ALICE = `sim-${runId}-alice`;
    const MINUTE = 60_000;

    afterAll(async () => {
        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
    });

    it.fails('a buffer narrow through updatePoolSettings must not reopen a week whose deadline already passed', async () => {
        await wStart({ data: { runId, scenarioId: 'golden-freeze-residual' }, auth: superAdmin } as never);
        // Buffer 60: with kickoff 10 minutes out, the deadline (kickoff − 60min)
        // passed ~50 minutes ago. Nothing has touched the week, so nothing froze it.
        await seedSimPool(poolId, runId, 'NFL_SURVIVOR', {
            entryFee: 10, lockBufferMinutes: 60, payouts: { places: [], bonuses: [] },
        });
        const kickoffAt = Date.now() + 10 * MINUTE;
        await wSeed({
            data: {
                runId,
                games: [{ week: 1, seasonType: 2, startTime: kickoffAt, status: 'SCHEDULED', isMonday: false, homeTeam: T('KC'), awayTeam: T('BUF'), scores: { home: 0, away: 0 }, spread: { value: -3, locked: true } }],
            },
            auth: superAdmin,
        } as never);
        await wJoin({ data: { poolId, runId, members: [{ uid: ALICE, name: 'Alice' }] }, auth: superAdmin } as never);

        // The manager narrows 60 → 5 through the REAL settings path. The newly
        // computed deadline is kickoff − 5min ≈ 5 minutes FROM NOW: the closed
        // week is open again, because no frozen value exists to hold it.
        await wUpdateSettings({
            data: { poolId, updates: { settings: { lockBufferMinutes: 5 } } },
            auth: superAdmin,
        } as never);

        // DESIRED: the week stays locked. TODAY: this submit is accepted.
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: ALICE, week: 1, picks: { 1: 'KC' } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/WEEK_LOCKED/);
    }, 60000);
});

/**
 * PR-A extraction gate: scoreNFLWeekInternal's dryRun writes NOTHING while still
 * computing the standings a live pass would publish, and the live pass through
 * the same internal materialises exactly what the dry run predicted.
 *
 * Margin on purpose — its rank pass re-reads the entries mid-scoring, which is
 * the one place a dry run could silently report last week's stale numbers.
 */
describe('scoreNFLWeekInternal — dry run computes without writing', () => {
    const runId = 'run-dryrun-margin';
    const poolId = `pool-${runId}`;
    const DEE = `sim-${runId}-dee`;
    const EVE = `sim-${runId}-eve`;

    const loadArgs = async () => {
        const poolSnap = await db.collection('pools').doc(poolId).get();
        const gamesSnap = await db.collection('nfl_games')
            .where('season', '==', `sim-${runId}`)
            .where('seasonType', '==', 2)
            .where('week', '==', 1)
            .get();
        return {
            pool: poolSnap.data() as any,
            games: gamesSnap.docs.map(d => d.data() as NFLGame),
        };
    };

    it('reports the standings it would publish, writes nothing, then the live pass matches', async () => {
        const { simWriteEntries } = await import('../../simHarness');
        const wWrite = test.wrap(simWriteEntries);

        await wStart({ data: { runId, scenarioId: 'dryrun-margin' }, auth: superAdmin } as never);
        await seedSimPool(poolId, runId, 'NFL_MARGIN', {
            entryFee: 0, payouts: { places: [], bonuses: [] },
        });
        // KC beats BUF by 17: Dee (KC) +17, Eve (BUF) -17.
        await wSeed({
            data: {
                runId,
                games: [{ week: 1, seasonType: 2, startTime: Date.now() - 4 * HOUR, status: 'FINAL', isMonday: false, homeTeam: T('KC'), awayTeam: T('BUF'), scores: { home: 27, away: 10 }, spread: { value: -3, locked: true } }],
            },
            auth: superAdmin,
        } as never);
        const marginEntry = (ownerUid: string, userName: string, team: string) => ({
            ownerUid, userName, picks: { 1: team }, usedTeams: [team],
            weeklyScores: {}, seasonTotal: 0, negativeBurden: 0, positiveWeeks: 0,
            bestWeek: 0, submittedAt: 0, paidStatus: 'PAID',
        });
        await wWrite({
            data: {
                poolId, runId,
                entries: [marginEntry(DEE, 'Dee', 'KC'), marginEntry(EVE, 'Eve', 'BUF')],
            },
            auth: superAdmin,
        } as never);

        // --- dry run ---
        const dry = await scoreNFLWeekInternal(db, poolId, 1, {
            ...(await loadArgs()),
            actor: { uid: 'system', role: 'SYSTEM', label: 'Scoring Engine' },
            dryRun: true,
        });

        expect(dry.dryRun).toBe(true);
        expect(dry.marginScored).toBe(2);
        expect(dry.standingsWritten).toBe(false);
        expect(dry.recapWritten).toBe(false);

        // The rows are computed from THIS week's staged scores — a dry run that
        // re-read the (unwritten) entries would report seasonTotal 0 and no rank.
        const dryByUid = Object.fromEntries(dry.standings.map(r => [r.ownerUid, r]));
        expect(dryByUid[DEE].seasonTotal).toBe(17);
        expect(dryByUid[EVE].seasonTotal).toBe(-17);
        expect(dryByUid[DEE].rank).toBe(1);
        expect(dryByUid[EVE].rank).toBe(2);

        // ...and nothing at all was persisted.
        const deeAfterDry = (await db.collection('pools').doc(poolId).collection('entries').doc(DEE).get()).data()!;
        expect(deeAfterDry.seasonTotal).toBe(0);
        expect(deeAfterDry.weeklyScores).toEqual({});
        expect(deeAfterDry.rank).toBeUndefined();
        expect((await db.collection('pools').doc(poolId).collection('standings').doc('current').get()).exists).toBe(false);
        expect((await db.collection('pools').doc(poolId).collection('weekly_recaps').doc('week_1').get()).exists).toBe(false);
        const poolAfterDry = (await db.collection('pools').doc(poolId).get()).data()!;
        expect(poolAfterDry.scoredWeeks).toBeUndefined();
        expect(poolAfterDry.lastScoredAt).toBeUndefined();

        // --- live run through the same internal ---
        const live = await scoreNFLWeekInternal(db, poolId, 1, {
            ...(await loadArgs()),
            actor: { uid: 'admin-1', role: 'ADMIN', label: 'Host' },
        });

        expect(live.dryRun).toBe(false);
        expect(live.marginScored).toBe(2);
        expect(live.standingsWritten).toBe(true);
        expect(live.standings).toEqual(dry.standings); // the dry run's prediction held

        const deeAfterLive = (await db.collection('pools').doc(poolId).collection('entries').doc(DEE).get()).data()!;
        expect(deeAfterLive.seasonTotal).toBe(17);
        expect(deeAfterLive.rank).toBe(1);
        const standings = (await db.collection('pools').doc(poolId).collection('standings').doc('current').get()).data()!;
        expect(standings.lastScoredWeek).toBe(1);
        expect(standings.rows).toHaveLength(2);
        expect((await db.collection('pools').doc(poolId).collection('weekly_recaps').doc('week_1').get()).exists).toBe(true);
        expect((await db.collection('pools').doc(poolId).get()).data()!.scoredWeeks).toEqual({ 1: true });

        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
    }, 90000);
});

describe('phase 6 — stranded-run sweep', () => {
    it('finds a deliberately-stranded run (dry), then sweeps it clean including off-pool residue', async () => {
        const { simWriteEntries: sw, sweepSimRuns } = await import('../../simHarness');
        const wWrite2 = test.wrap(sw);
        const wSweep = test.wrap(sweepSimRuns);
        const runId = 'run-stranded-01';
        const poolId = `pool-${runId}`;
        const UID = `sim-${runId}-ghost`;

        // Simulate a run killed mid-scenario: manifest RUNNING, pool + entry +
        // off-pool residue present, cleanup never called.
        await wStart({ data: { runId, scenarioId: 'stranded' }, auth: superAdmin } as never);
        await seedSimPool(poolId, runId, 'NFL_PICKEM', { entryFee: 0, payouts: { places: [], bonuses: [] } });
        await wSeed({
            data: { runId, games: [{ week: 1, seasonType: 2, startTime: Date.now() - HOUR, status: 'FINAL', isMonday: false, homeTeam: T('KC'), awayTeam: T('BUF'), scores: { home: 20, away: 10 }, spread: { value: -3, locked: true } }] },
            auth: superAdmin,
        } as never);
        await wWrite2({ data: { poolId, runId, entries: [{ ownerUid: UID, userName: 'Ghost', picks: {}, weeklyPoints: {}, totalScore: 0, submittedAt: 0, paidStatus: 'PAID' }] }, auth: superAdmin } as never);
        await db.collection('publicProfiles').doc(UID).set({ subjectKind: 'PLAYER' });

        const runIdsOf = (res: { runs?: Array<{ runId: string }> }) => (res.runs ?? []).map(r => r.runId);

        // FRESH RUNNING manifests are ACTIVE simulations — the sweep must skip
        // them (qodo PR #156 finding: sweeping mid-flight destroys a live run).
        const fresh = await wSweep({ data: { dryRun: true }, auth: superAdmin } as never);
        expect(runIdsOf(fresh)).not.toContain(runId);
        expect(fresh.skippedActive).toBeGreaterThanOrEqual(1);

        // Backdate beyond the grace window, then perform simUpdatePool activity —
        // the heartbeat must refresh liveness and the sweep must skip it again
        // (qodo PR #157 finding: update/rebuy/finalize previously never touched
        // the manifest, so a run doing only that work aged toward sweepability).
        const backdate = () => db.collection('simRuns').doc(runId).set(
            { updatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000) },
            { merge: true },
        );
        await backdate();
        const { simUpdatePool: su } = await import('../../simHarness');
        await test.wrap(su)({ data: { poolId, runId, patch: { name: 'still alive' } }, auth: superAdmin } as never);
        const touched = await wSweep({ data: { dryRun: true }, auth: superAdmin } as never);
        expect(runIdsOf(touched)).not.toContain(runId);

        // Backdate again with NO activity -> genuinely stranded.
        await backdate();

        // Dry run reports it, writes nothing.
        const dry = await wSweep({ data: { dryRun: true }, auth: superAdmin } as never);
        expect(dry.dryRun).toBe(true);
        expect(runIdsOf(dry)).toContain(runId);
        expect((await db.collection('pools').doc(poolId).get()).exists).toBe(true);

        // Execute sweeps it: pool tree, entry, profile, games gone; manifest SWEPT.
        const res = await wSweep({ data: { dryRun: false }, auth: superAdmin } as never);
        expect(res.swept).toBeGreaterThanOrEqual(1);
        expect((await db.collection('pools').doc(poolId).get()).exists).toBe(false);
        expect((await db.collection('publicProfiles').doc(UID).get()).exists).toBe(false);
        expect((await db.collection('nfl_games').doc(`sim-${runId}-g1`).get()).exists).toBe(false);
        const manifest = (await db.collection('simRuns').doc(runId).get()).data();
        expect(manifest?.status).toBe('SWEPT');
    }, 90000);
});
