import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { simStartRun, simWriteEntries, simSeedNFLGames, cleanupSimPool } from '../../simHarness';
import { scoreNFLWeek } from '../../nflPools';
import { generateNFLSeason, type GeneratedSeason } from '../../shared/simGen';
import { expectPickem, expectSurvivor, expectMargin } from '../../shared/simOracle';

/**
 * Settings matrix (PLAN-NFL-SIM-HARNESS Phase 4, item 25 — the automated core).
 *
 * Each cell runs a DETERMINISTIC generated season through the REAL scorer with
 * a distinct settings combination and asserts engine === Scenario Oracle for
 * every entry. This is the config-driven "list of pool types, each with its
 * settings, producing verifiable results" the owner asked for.
 *
 * Deliberately NOT here (each needs human-verified expectations per the plan's
 * oracle-honesty rule): tie games, ATS pushes on exact spreads, missed-pick
 * weeks, dual-MNF tiebreakers, survivor pickLosers/autoSurvive exemptions,
 * cancelled-game VOIDs. Those are the hand-authored Phase 4 edge fixtures.
 */
const test = ftest();
const db = admin.firestore();

const wStart = test.wrap(simStartRun);
const wWrite = test.wrap(simWriteEntries);
const wSeed = test.wrap(simSeedNFLGames);
const wCleanup = test.wrap(cleanupSimPool);
const wScore = test.wrap(scoreNFLWeek);

const superAdmin = { uid: 'admin-1', token: { role: 'SUPER_ADMIN' } } as any;

// Claim+doc (PLAN-API-TRUST-BOUNDARY Phase 3): every SUPER_ADMIN claim must be
// backed by a users/{uid}.role doc; suites share one emulator DB and another
// file's wipe can delete it, so re-seed per test.
beforeEach(async () => {
    await db.collection('users').doc('admin-1').set({ role: 'SUPER_ADMIN' }, { merge: true });
});
const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });

const WEEKS = 3;
const SEED = 20260711; // tie-free through 18 weeks (superset covers 3)

function seedGamePayload(g: any) {
    return {
        week: g.week, seasonType: 2, startTime: Date.now() - 24 * 60 * 60 * 1000,
        status: 'FINAL', isMonday: g.isMonday ?? false,
        homeTeam: T(g.home), awayTeam: T(g.away),
        scores: { home: g.homeScore, away: g.awayScore },
        spread: { value: g.spread, locked: true },
    };
}

function pickemDocKeys(season: GeneratedSeason, byWeek: Record<string, Record<string, string>>, runId: string) {
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
}
function confDocKeys(season: GeneratedSeason, byWeek: Record<string, Record<string, number>> | undefined, runId: string) {
    const flat: Record<string, number> = {};
    for (const [week, conf] of Object.entries(byWeek ?? {})) {
        const idx: number[] = [];
        season.games.forEach((g, i) => { if (g.week === Number(week)) idx.push(i); });
        for (const [k, v] of Object.entries(conf)) {
            const n = parseInt(k.replace(/^g/, ''), 10);
            if (idx[n - 1] !== undefined) flat[`sim-${runId}-g${idx[n - 1] + 1}`] = v;
        }
    }
    return flat;
}

async function runCell(opts: {
    cell: string;
    type: 'NFL_PICKEM' | 'NFL_SURVIVOR' | 'NFL_MARGIN';
    settings: Record<string, unknown>;
    season: GeneratedSeason;
    buildEntry: (e: GeneratedSeason['entries'][number], uid: string) => Record<string, unknown>;
    assertEntries: (get: (uid: string) => Promise<any>) => Promise<void>;
}) {
    const runId = `run-mx-${opts.cell}`;
    const poolId = `pool-${runId}`;
    await wStart({ data: { runId, scenarioId: `matrix-${opts.cell}` }, auth: superAdmin } as never);
    await db.collection('pools').doc(poolId).set({
        name: `Matrix ${opts.cell}`, type: opts.type, league: 'NFL',
        season: `sim-${runId}`, seasonType: 2, simRunId: runId,
        ownerId: 'admin-1', participantIds: ['admin-1'],
        status: 'OPEN', billing: { status: 'free' }, settings: opts.settings,
    });
    await wSeed({ data: { runId, games: opts.season.games.map(seedGamePayload) }, auth: superAdmin } as never);
    await wWrite({
        data: {
            poolId, runId,
            entries: opts.season.entries.map((e, i) => opts.buildEntry(e, `sim-${runId}-u${i + 1}`)),
        },
        auth: superAdmin,
    } as never);
    try {
        for (let week = 1; week <= WEEKS; week++) {
            await wScore({ data: { poolId, week }, auth: superAdmin } as never);
        }
        await opts.assertEntries(async (uid) =>
            (await db.collection('pools').doc(poolId).collection('entries').doc(uid).get()).data());
    } finally {
        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
    }
}

describe('settings matrix — engine vs oracle per combination', () => {
    const season = generateNFLSeason({ seed: SEED, weeks: WEEKS, entryCount: 6 });

    const pickemCells: Array<{ cell: string; pickMode: 'STRAIGHT' | 'ATS'; confidenceMode: boolean }> = [
        { cell: 'pk-straight', pickMode: 'STRAIGHT', confidenceMode: false },
        { cell: 'pk-straight-conf', pickMode: 'STRAIGHT', confidenceMode: true },
        { cell: 'pk-ats', pickMode: 'ATS', confidenceMode: false },
        { cell: 'pk-ats-conf', pickMode: 'ATS', confidenceMode: true },
    ];

    for (const c of pickemCells) {
        it(`NFL_PICKEM ${c.pickMode}${c.confidenceMode ? ' + confidence' : ''}`, async () => {
            const runId = `run-mx-${c.cell}`;
            await runCell({
                cell: c.cell, type: 'NFL_PICKEM', season,
                settings: {
                    entryFee: 0, lockMode: 'PER_GAME', payoutMode: 'SEASON',
                    pickMode: c.pickMode, confidenceMode: c.confidenceMode,
                    payouts: { places: [], bonuses: [] },
                },
                buildEntry: (e, uid) => ({
                    ownerUid: uid, userName: e.userName,
                    picks: pickemDocKeys(season, e.pickemPicks, runId),
                    ...(c.confidenceMode ? { confidence: confDocKeys(season, e.confidence, runId) } : {}),
                    weeklyTiebreakers: Object.fromEntries(Object.entries(e.weeklyTiebreakers).map(([k, v]) => [Number(k), v])),
                    weeklyPoints: {}, totalScore: 0, submittedAt: 0, paidStatus: 'PAID',
                }),
                assertEntries: async (get) => {
                    const expected = expectPickem(season, { pickMode: c.pickMode, confidenceMode: c.confidenceMode });
                    for (let i = 0; i < expected.length; i++) {
                        const exp = expected[i];
                        const actual = await get(`sim-${runId}-u${i + 1}`);
                        expect(actual.totalScore, `${c.cell} ${exp.userName} total`).toBe(exp.totalScore);
                        for (const [week, pts] of Object.entries(exp.weeklyPoints)) {
                            expect(actual.weeklyPoints?.[week] ?? actual.weeklyResults?.[week]?.points,
                                `${c.cell} ${exp.userName} wk${week}`).toBe(pts);
                        }
                    }
                },
            });
        }, 120000);
    }

    for (const maxStrikes of [0, 2]) {
        it(`NFL_SURVIVOR maxStrikes=${maxStrikes}`, async () => {
            const runId = `run-mx-sv${maxStrikes}`;
            await runCell({
                cell: `sv${maxStrikes}`, type: 'NFL_SURVIVOR', season,
                settings: {
                    entryFee: 0, maxStrikes, pickLosersMode: false, autoSurviveExemptionEnabled: false,
                    maxRebuys: 0, payouts: { places: [], bonuses: [] },
                },
                buildEntry: (e, uid) => ({
                    ownerUid: uid, userName: e.userName,
                    status: 'ALIVE', strikesUsed: 0, rebuysUsed: 0, usedTeams: [],
                    picks: Object.fromEntries(Object.entries(e.survivorPicks).map(([k, v]) => [Number(k), v])),
                    exemptWeeks: [], submittedAt: 0, paidStatus: 'PAID',
                }),
                assertEntries: async (get) => {
                    const expected = expectSurvivor(season, { maxStrikes });
                    for (let i = 0; i < expected.length; i++) {
                        const exp = expected[i];
                        const actual = await get(`sim-${runId}-u${i + 1}`);
                        const status = actual.status === 'ELIMINATED' ? 'ELIMINATED' : 'ALIVE';
                        expect(status, `sv${maxStrikes} ${exp.userName} status`).toBe(exp.status);
                        expect(actual.strikesUsed ?? 0, `sv${maxStrikes} ${exp.userName} strikes`).toBe(exp.strikesUsed);
                    }
                },
            });
        }, 120000);
    }

    it('NFL_MARGIN accumulation', async () => {
        const runId = 'run-mx-margin';
        await runCell({
            cell: 'margin', type: 'NFL_MARGIN', season,
            settings: { entryFee: 0, payoutMode: 'SEASON', payouts: { places: [], bonuses: [] } },
            buildEntry: (e, uid) => ({
                ownerUid: uid, userName: e.userName,
                picks: Object.fromEntries(Object.entries(e.marginPicks).map(([k, v]) => [Number(k), v])),
                weeklyScores: {}, seasonTotal: 0, negativeBurden: 0, positiveWeeks: 0, bestWeek: 0,
                submittedAt: 0, paidStatus: 'PAID',
            }),
            assertEntries: async (get) => {
                const expected = expectMargin(season);
                for (let i = 0; i < expected.length; i++) {
                    const exp = expected[i];
                    const actual = await get(`sim-${runId}-u${i + 1}`);
                    expect(actual.seasonTotal, `margin ${exp.userName} total`).toBe(exp.seasonTotal);
                }
            },
        });
    }, 120000);
});
