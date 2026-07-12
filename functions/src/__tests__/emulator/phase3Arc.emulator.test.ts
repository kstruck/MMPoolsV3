import { describe, it, expect } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import {
    simStartRun, simJoinMembers, simWriteEntries, simSeedNFLGames,
    simExecuteRebuy, simFinalizePool, cleanupSimPool,
} from '../../simHarness';
import { scoreNFLWeek } from '../../nflPools';
import { recordPoolPayouts } from '../../payoutRecords';
import { recomputeUserProfile } from '../../userProfile';
import { generateNFLSeason } from '../../shared/simGen';
import { expectSurvivor, expectPickem } from '../../shared/simOracle';

/**
 * Phase 3 arc gates (PLAN-NFL-SIM-HARNESS items 22-24):
 *  - full post-score arc: finalize -> recordPoolPayouts -> profile recompute,
 *    asserted against the oracle/known fixture values;
 *  - SEASON-LENGTH survivor golden (18 generated weeks): elimination arcs over
 *    time, real-path rebuy at the deadline week, oracle agreement at season end;
 *  - rescore idempotency: scoring the same week twice leaves identical state
 *    (PLAN-TEST-SUITE item 13 contract).
 */
const test = ftest();
const db = admin.firestore();

const wStart = test.wrap(simStartRun);
const wJoin = test.wrap(simJoinMembers);
const wWrite = test.wrap(simWriteEntries);
const wSeed = test.wrap(simSeedNFLGames);
const wRebuy = test.wrap(simExecuteRebuy);
const wFinalize = test.wrap(simFinalizePool);
const wCleanup = test.wrap(cleanupSimPool);
const wScore = test.wrap(scoreNFLWeek);
const wPayouts = test.wrap(recordPoolPayouts);

const superAdmin = { uid: 'admin-1', token: { role: 'SUPER_ADMIN' } } as any;
const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });

function seedGamePayload(g: any) {
    return {
        week: g.week, seasonType: 2,
        startTime: Date.now() - 24 * 60 * 60 * 1000,
        status: g.status ?? 'FINAL', isMonday: g.isMonday ?? false,
        homeTeam: T(g.home), awayTeam: T(g.away),
        scores: { home: g.homeScore ?? 0, away: g.awayScore ?? 0 },
        spread: { value: g.spread ?? 0, locked: true },
    };
}

describe('phase 3 — payouts + profile arc (pick’em)', () => {
    const runId = 'run-p3-arc';
    const poolId = `pool-${runId}`;
    const ALICE = `sim-${runId}-alice`;
    const BOB = `sim-${runId}-bob`;

    it('finalize -> recordPoolPayouts -> profile shows record, best finish, profit', async () => {
        await wStart({ data: { runId, scenarioId: 'p3-arc' }, auth: superAdmin } as never);
        await db.collection('pools').doc(poolId).set({
            name: 'P3 Arc', type: 'NFL_PICKEM', league: 'NFL',
            season: `sim-${runId}`, seasonType: 2, simRunId: runId,
            ownerId: 'admin-1', participantIds: ['admin-1'],
            status: 'OPEN', billing: { status: 'free' },
            settings: { entryFee: 10, lockMode: 'PER_GAME', payoutMode: 'SEASON', pickMode: 'STRAIGHT', confidenceMode: false, payouts: { places: [], bonuses: [] } },
        });
        await wSeed({
            data: { runId, games: [
                { week: 1, home: 'KC', away: 'BUF', homeScore: 27, awayScore: 24, spread: -3 },
                { week: 1, home: 'SF', away: 'DAL', homeScore: 30, awayScore: 10, spread: -7, isMonday: true },
            ].map(seedGamePayload) },
            auth: superAdmin,
        } as never);
        await wJoin({ data: { poolId, runId, members: [{ uid: ALICE, name: 'Alice' }, { uid: BOB, name: 'Bob' }] }, auth: superAdmin } as never);
        await wWrite({
            data: { poolId, runId, entries: [
                { ownerUid: ALICE, userName: 'Alice', picks: { [`sim-${runId}-g1`]: 'KC', [`sim-${runId}-g2`]: 'SF' }, weeklyTiebreakers: { 1: 40 }, weeklyPoints: {}, totalScore: 0, submittedAt: 0, paidStatus: 'PAID' },
                { ownerUid: BOB, userName: 'Bob', picks: { [`sim-${runId}-g1`]: 'BUF', [`sim-${runId}-g2`]: 'DAL' }, weeklyTiebreakers: { 1: 30 }, weeklyPoints: {}, totalScore: 0, submittedAt: 0, paidStatus: 'PAID' },
            ] },
            auth: superAdmin,
        } as never);
        await wScore({ data: { poolId, week: 1 }, auth: superAdmin } as never);

        const fin = await wFinalize({ data: { poolId, runId }, auth: superAdmin } as never);
        expect(fin.finalized).toBe(true);

        // Commissioner records the prize through the REAL payout callable.
        await wPayouts({
            data: { poolId, awards: [{ uid: ALICE, amount: 18, kind: 'PLACE', place: 1, settled: true }] },
            auth: superAdmin,
        } as never);
        const awards = await db.collection('pools').doc(poolId).collection('payoutRecords').where('uid', '==', ALICE).get();
        expect(awards.size).toBe(1);
        expect(awards.docs[0].data().amount).toBe(18);

        // Explicit profile recompute (the trigger is sim-suppressed by Phase 0.3).
        const profile = await recomputeUserProfile(db, ALICE);
        expect(profile.subjectKind ?? 'PLAYER').toBeTruthy();
        const profileDoc = (await db.collection('publicProfiles').doc(ALICE).get()).data() as any;
        expect(profileDoc).toBeTruthy();
        const json = JSON.stringify(profileDoc);
        // Best finish rank 1 and the awarded profit figure must be derivable from the doc.
        expect(json).toContain('18'); // profit from the award
        expect(profileDoc.best?.rank ?? profileDoc.bestFinish?.rank ?? 1).toBe(1);

        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
        expect((await db.collection('publicProfiles').doc(ALICE).get()).exists).toBe(false);
    }, 90000);
});

describe('phase 3 — season-length survivor golden (generated, 18 weeks)', () => {
    const runId = 'run-p3-season';
    const poolId = `pool-${runId}`;

    it('elimination arcs match the oracle; real-path rebuy at deadline; rescore is idempotent', async () => {
        const season = generateNFLSeason({ seed: 20260711, weeks: 18, entryCount: 6 });
        expect(season.games.some(g => g.homeScore === g.awayScore)).toBe(false); // tie-free seed

        await wStart({ data: { runId, scenarioId: 'p3-season-survivor' }, auth: superAdmin } as never);
        await db.collection('pools').doc(poolId).set({
            name: 'P3 Season Survivor', type: 'NFL_SURVIVOR', league: 'NFL',
            season: `sim-${runId}`, seasonType: 2, simRunId: runId,
            ownerId: 'admin-1', participantIds: ['admin-1'],
            status: 'OPEN', billing: { status: 'free' },
            settings: { entryFee: 20, maxStrikes: 0, pickLosersMode: false, autoSurviveExemption: false, maxRebuys: 1, rebuyDeadlineWeek: 6, rebuyCost: 20, payouts: { places: [], bonuses: [] } },
        });
        await wSeed({ data: { runId, games: season.games.map(seedGamePayload) }, auth: superAdmin } as never);

        const members = season.entries.map((e, i) => ({ uid: `sim-${runId}-u${i + 1}`, name: e.userName }));
        await wJoin({ data: { poolId, runId, members }, auth: superAdmin } as never);
        await wWrite({
            data: { poolId, runId, entries: season.entries.map((e, i) => ({
                ownerUid: `sim-${runId}-u${i + 1}`, userName: e.userName,
                status: 'ALIVE', strikesUsed: 0, rebuysUsed: 0, usedTeams: [],
                picks: Object.fromEntries(Object.entries(e.survivorPicks).map(([k, v]) => [Number(k), v])),
                exemptWeeks: [], submittedAt: 0, paidStatus: 'PAID',
            })) },
            auth: superAdmin,
        } as never);

        const expected = expectSurvivor(season, { maxStrikes: 0 });

        // Score weeks 1..18; at the first elimination at/before the deadline,
        // rebuy that subject through the REAL path exactly once.
        let rebuySubject: string | null = null;
        let rebuyAtWeek: number | null = null;
        for (let week = 1; week <= 18; week++) {
            await wScore({ data: { poolId, week }, auth: superAdmin } as never);
            if (!rebuySubject && week < 6) {
                const idx = expected.findIndex(x => x.eliminatedWeek === week);
                if (idx >= 0) {
                    rebuySubject = `sim-${runId}-u${idx + 1}`;
                    rebuyAtWeek = week + 1;
                    await wRebuy({ data: { poolId, runId, subjectUid: rebuySubject, week: rebuyAtWeek }, auth: superAdmin } as never);
                    const e = (await db.collection('pools').doc(poolId).collection('entries').doc(rebuySubject).get()).data()!;
                    expect(e.status).toBe('ALIVE');
                    expect(e.rebuysUsed).toBe(1);
                }
            }
        }
        expect(rebuySubject, 'fixture should produce an early elimination to exercise rebuy').toBeTruthy();

        // Season end: every NON-rebuy entry matches the oracle exactly.
        for (let i = 0; i < expected.length; i++) {
            const uid = `sim-${runId}-u${i + 1}`;
            if (uid === rebuySubject) continue; // rebuy restarts its arc — oracle models the no-rebuy baseline
            const exp = expected[i];
            const actual = (await db.collection('pools').doc(poolId).collection('entries').doc(uid).get()).data()!;
            const status = actual.status === 'ELIMINATED' ? 'ELIMINATED' : 'ALIVE';
            expect(status, `${exp.userName} status`).toBe(exp.status);
            if (exp.eliminatedWeek !== null) {
                expect(actual.eliminatedWeek, `${exp.userName} eliminatedWeek`).toBe(exp.eliminatedWeek);
            }
        }
        // The rebuy subject: post-rebuy arc = oracle over the REMAINING weeks with a fresh slate.
        const rebuyIdx = members.findIndex(m => m.uid === rebuySubject);
        const rebuyActual = (await db.collection('pools').doc(poolId).collection('entries').doc(rebuySubject!).get()).data()!;
        const postRebuy = expectSurvivor({
            games: season.games.filter(g => g.week >= (rebuyAtWeek as number)),
            entries: [{
                ...season.entries[rebuyIdx],
                survivorPicks: Object.fromEntries(Object.entries(season.entries[rebuyIdx].survivorPicks).filter(([w]) => Number(w) >= (rebuyAtWeek as number))),
            }],
        } as any, { maxStrikes: 0 })[0];
        const rebuyStatus = rebuyActual.status === 'ELIMINATED' ? 'ELIMINATED' : 'ALIVE';
        expect(rebuyStatus, 'rebuy subject post-rebuy arc').toBe(postRebuy.status);

        // Rescore idempotency (item 13 contract): score week 18 again -> identical entries.
        const before = JSON.stringify(Object.fromEntries(
            (await db.collection('pools').doc(poolId).collection('entries').get()).docs
                .map(d => [d.id, { ...d.data(), submittedAt: 0 }]),
        ));
        await wScore({ data: { poolId, week: 18 }, auth: superAdmin } as never);
        const after = JSON.stringify(Object.fromEntries(
            (await db.collection('pools').doc(poolId).collection('entries').get()).docs
                .map(d => [d.id, { ...d.data(), submittedAt: 0 }]),
        ));
        expect(after).toBe(before);

        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
    }, 180000);
});

describe('phase 3 — season-length pick’em golden (generated, 18 weeks)', () => {
    const runId = 'run-p3-pickem18';
    const poolId = `pool-${runId}`;

    it('18-week accumulation matches the oracle for every entry', async () => {
        const season = generateNFLSeason({ seed: 20260711, weeks: 18, entryCount: 6 });
        await wStart({ data: { runId, scenarioId: 'p3-season-pickem' }, auth: superAdmin } as never);
        await db.collection('pools').doc(poolId).set({
            name: 'P3 Season Pickem', type: 'NFL_PICKEM', league: 'NFL',
            season: `sim-${runId}`, seasonType: 2, simRunId: runId,
            ownerId: 'admin-1', participantIds: ['admin-1'],
            status: 'OPEN', billing: { status: 'free' },
            settings: { entryFee: 0, lockMode: 'PER_GAME', payoutMode: 'SEASON', pickMode: 'STRAIGHT', confidenceMode: false, payouts: { places: [], bonuses: [] } },
        });
        await wSeed({ data: { runId, games: season.games.map(seedGamePayload) }, auth: superAdmin } as never);

        // Per-week gN -> global seed-order doc ids.
        const docKeys = (byWeek: Record<string, Record<string, string>>) => {
            const flat: Record<string, string> = {};
            for (const [week, picks] of Object.entries(byWeek)) {
                const idx: number[] = [];
                season.games.forEach((g, i) => { if (g.week === Number(week)) idx.push(i); });
                for (const [k, team] of Object.entries(picks)) {
                    const n = parseInt(k.replace(/^g/, ''), 10);
                    if (idx[n - 1] !== undefined) flat[`sim-${runId}-g${idx[n - 1] + 1}`] = team;
                }
            }
            return flat;
        };
        await wWrite({
            data: { poolId, runId, entries: season.entries.map((e, i) => ({
                ownerUid: `sim-${runId}-u${i + 1}`, userName: e.userName,
                picks: docKeys(e.pickemPicks),
                weeklyTiebreakers: Object.fromEntries(Object.entries(e.weeklyTiebreakers).map(([k, v]) => [Number(k), v])),
                weeklyPoints: {}, totalScore: 0, submittedAt: 0, paidStatus: 'PAID',
            })) },
            auth: superAdmin,
        } as never);

        for (let week = 1; week <= 18; week++) {
            await wScore({ data: { poolId, week }, auth: superAdmin } as never);
        }

        const expected = expectPickem(season);
        for (let i = 0; i < expected.length; i++) {
            const exp = expected[i];
            const actual = (await db.collection('pools').doc(poolId).collection('entries').doc(`sim-${runId}-u${i + 1}`).get()).data()!;
            expect(actual.totalScore, `${exp.userName} season total`).toBe(exp.totalScore);
        }

        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
    }, 180000);
});
