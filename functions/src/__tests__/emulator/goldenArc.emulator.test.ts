import { describe, it, expect, beforeAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import {
    simStartRun, simJoinMembers, simSubmitPicks, simExecuteRebuy,
    simSeedNFLGames, simFinalizePool, cleanupSimPool,
} from '../../simHarness';
import { scoreNFLWeek, submitNFLPicks } from '../../nflPools';

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

const superAdmin = { uid: 'admin-1', token: { role: 'SUPER_ADMIN' } } as any;

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

        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
    }, 60000);
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

        // Dry run reports it, writes nothing.
        const dry = await wSweep({ data: { dryRun: true }, auth: superAdmin } as never);
        expect(dry.dryRun).toBe(true);
        expect((dry.runs ?? []).map((r: any) => r.runId)).toContain(runId);
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
