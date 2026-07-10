import { describe, it, expect, beforeAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import * as fs from 'fs';
import * as path from 'path';
import { simWriteEntries, simSeedNFLGames, cleanupSimPool, simStartRun } from '../../simHarness';
import { scoreNFLWeek } from '../../nflPools';
import { generateNFLSeason, type GeneratedSeason } from '../../shared/simGen';
import { expectPickem, expectSurvivor, expectMargin } from '../../shared/simOracle';

/**
 * Headless Scenario runner (PLAN-NFL-SIM-HARNESS Phase 1.14).
 *
 * Runs NFL Scenarios end to end against the Firestore emulator THROUGH THE
 * WRAPPED EXPORTED CALLABLES (Codex R2#4 — the sim callables' auth/audit/
 * namespace guards are part of what a green run certifies), including the REAL
 * scoreNFLWeek. Expectations come from the independent Scenario Oracle —
 * oracle/engine divergence fails the run and is a finding, never a value to sync.
 *
 * The browser Test Suite consumes the same JSON fixtures; this runner is the CI
 * matrix home (emulator = full matrix, prod browser = curated smoke).
 */
const test = ftest();
const db = admin.firestore();

const wrappedStart = test.wrap(simStartRun);
const wrappedWrite = test.wrap(simWriteEntries);
const wrappedSeed = test.wrap(simSeedNFLGames);
const wrappedCleanup = test.wrap(cleanupSimPool);
const wrappedScore = test.wrap(scoreNFLWeek);

const superAdmin = { uid: 'admin-1', token: { role: 'SUPER_ADMIN' } } as any;

// Fixtures are shared with the browser Test Suite — single source of truth.
const FIXTURE_DIR = path.resolve(__dirname, '../../../../src/utils/testing/scenarios');
function loadFixture(name: string): any {
    return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

const TEAM_STUB = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });

interface RunHandle {
    runId: string;
    poolId: string;
    entries: Record<string, any>; // uid -> entry data
    recaps: Record<string, any>;
}

/** Seed pool + games + entries via wrapped callables, score every week, hydrate. */
async function driveScenario(opts: {
    runId: string;
    poolType: 'NFL_PICKEM' | 'NFL_SURVIVOR' | 'NFL_MARGIN';
    settings: Record<string, unknown>;
    games: Array<any>; // ScenarioNFLGame-like (week/home/away/scores/spread/isMonday)
    entries: Array<Record<string, unknown>>;
    scoreWeeks: number[];
}): Promise<RunHandle> {
    const { runId, poolType, settings, games, entries, scoreWeeks } = opts;
    const poolId = `pool-${runId}`;

    await wrappedStart({ data: { runId, scenarioId: `headless-${poolType}` }, auth: superAdmin } as never);

    // Pool doc seeded directly (the create callable's billing surface is out of the
    // harness's certification scope — pool CREATION fidelity stays with the browser
    // golden smoke; everything after creation goes through wrapped callables).
    await db.collection('pools').doc(poolId).set({
        name: `Headless ${poolType}`,
        type: poolType,
        league: 'NFL',
        season: `sim-${runId}`,
        seasonType: 2,
        simRunId: runId,
        ownerId: 'admin-1',
        participantIds: ['admin-1'],
        status: 'OPEN',
        settings,
    });

    await wrappedSeed({
        data: {
            runId,
            games: games.map((g: any) => ({
                week: g.week,
                seasonType: 2,
                startTime: Date.now() - 24 * 60 * 60 * 1000 + (g.startOffsetMs ?? 0),
                status: g.status ?? 'FINAL',
                isMonday: g.isMonday ?? false,
                homeTeam: TEAM_STUB(g.home),
                awayTeam: TEAM_STUB(g.away),
                scores: { home: g.homeScore ?? 0, away: g.awayScore ?? 0 },
                spread: { value: g.spread ?? 0, locked: true },
            })),
        },
        auth: superAdmin,
    } as never);

    await wrappedWrite({ data: { poolId, runId, entries }, auth: superAdmin } as never);

    for (const week of scoreWeeks) {
        await wrappedScore({ data: { poolId, week }, auth: superAdmin } as never);
    }

    const entriesSnap = await db.collection('pools').doc(poolId).collection('entries').get();
    const hydrated: Record<string, any> = {};
    entriesSnap.docs.forEach(d => { hydrated[d.id] = d.data(); });
    const recaps: Record<string, any> = {};
    for (const week of scoreWeeks) {
        const r = await db.collection('pools').doc(poolId).collection('weekly_recaps').doc(`week_${week}`).get();
        if (r.exists) recaps[String(week)] = r.data();
    }
    return { runId, poolId, entries: hydrated, recaps };
}

/** Per-week gN keys -> seeded doc ids (mirror of the simulator's seed-order contract). */
function pickemDocKeys(
    picksByWeek: Record<string, Record<string, string>>,
    games: Array<{ week: number }>,
    runId: string,
): Record<string, string> {
    const flat: Record<string, string> = {};
    for (const [week, picks] of Object.entries(picksByWeek)) {
        const weekIdx: number[] = [];
        games.forEach((g, i) => { if (g.week === Number(week)) weekIdx.push(i); });
        for (const [key, team] of Object.entries(picks)) {
            const n = parseInt(key.replace(/^g/, ''), 10);
            const globalIdx = weekIdx[n - 1];
            if (globalIdx !== undefined) flat[`sim-${runId}-g${globalIdx + 1}`] = team;
        }
    }
    return flat;
}

function genEntriesFor(
    poolType: string, runId: string, season: GeneratedSeason,
): Array<Record<string, unknown>> {
    return season.entries.map((e, i) => {
        const ownerUid = `sim-${runId}-u${i + 1}`;
        const base = { ownerUid, userName: e.userName, submittedAt: 0, paidStatus: 'PAID' };
        if (poolType === 'NFL_PICKEM') {
            return {
                ...base,
                picks: pickemDocKeys(e.pickemPicks, season.games, runId),
                weeklyTiebreakers: Object.fromEntries(Object.entries(e.weeklyTiebreakers).map(([k, v]) => [Number(k), v])),
                weeklyPoints: {}, totalScore: 0,
            };
        }
        if (poolType === 'NFL_SURVIVOR') {
            return {
                ...base, status: 'ALIVE', strikesUsed: 0, rebuysUsed: 0, usedTeams: [],
                picks: Object.fromEntries(Object.entries(e.survivorPicks).map(([k, v]) => [Number(k), v])),
                exemptWeeks: [],
            };
        }
        return {
            ...base,
            picks: Object.fromEntries(Object.entries(e.marginPicks).map(([k, v]) => [Number(k), v])),
            weeklyScores: {}, seasonTotal: 0, negativeBurden: 0, positiveWeeks: 0, bestWeek: 0,
        };
    });
}

// Seed chosen so the generated season has NO tied games — tie-grade semantics are
// a Phase 4 edge scenario with human-verified expectations, not implicit coverage.
const SEED = 20260710;
let season: GeneratedSeason;

beforeAll(() => {
    season = generateNFLSeason({ seed: SEED, weeks: 4, entryCount: 6 });
    const ties = season.games.filter(g => g.homeScore === g.awayScore);
    expect(ties).toHaveLength(0);
});

describe('headless scenario runner — engine vs Scenario Oracle', () => {
    it('NFL_PICKEM (straight): weekly points + totals match the oracle for every entry', async () => {
        const runId = 'run-head-pickem-01';
        const handle = await driveScenario({
            runId, poolType: 'NFL_PICKEM',
            settings: { entryFee: 0, lockMode: 'PER_GAME', payoutMode: 'SEASON', pickMode: 'STRAIGHT', confidenceMode: false, payouts: { places: [], bonuses: [] } },
            games: season.games,
            entries: genEntriesFor('NFL_PICKEM', runId, season),
            scoreWeeks: [1, 2, 3, 4],
        });
        try {
            const expected = expectPickem(season);
            for (let i = 0; i < expected.length; i++) {
                const exp = expected[i];
                const actual = handle.entries[`sim-${runId}-u${i + 1}`];
                expect(actual, `entry ${exp.userName} missing`).toBeTruthy();
                expect(actual.totalScore, `${exp.userName} totalScore`).toBe(exp.totalScore);
                for (const [week, pts] of Object.entries(exp.weeklyPoints)) {
                    expect(actual.weeklyPoints?.[week] ?? actual.weeklyResults?.[week]?.points, `${exp.userName} wk${week}`).toBe(pts);
                }
            }
        } finally {
            await wrappedCleanup({ data: { poolId: handle.poolId, runId, deleteGames: true }, auth: superAdmin } as never);
        }
    }, 60000);

    it('NFL_SURVIVOR (sudden death): statuses, strikes, and elimination weeks match the oracle', async () => {
        const runId = 'run-head-surv-01';
        const handle = await driveScenario({
            runId, poolType: 'NFL_SURVIVOR',
            settings: { entryFee: 0, maxStrikes: 0, pickLosersMode: false, autoSurviveExemption: false, maxRebuys: 0, payouts: { places: [], bonuses: [] } },
            games: season.games,
            entries: genEntriesFor('NFL_SURVIVOR', runId, season),
            scoreWeeks: [1, 2, 3, 4],
        });
        try {
            const expected = expectSurvivor(season, { maxStrikes: 0 });
            for (let i = 0; i < expected.length; i++) {
                const exp = expected[i];
                const actual = handle.entries[`sim-${runId}-u${i + 1}`];
                expect(actual, `entry ${exp.userName} missing`).toBeTruthy();
                const actualStatus = actual.status === 'ELIMINATED' ? 'ELIMINATED' : 'ALIVE';
                expect(actualStatus, `${exp.userName} status`).toBe(exp.status);
                expect(actual.strikesUsed ?? 0, `${exp.userName} strikes`).toBe(exp.strikesUsed);
                if (exp.eliminatedWeek !== null) {
                    expect(actual.eliminatedWeek, `${exp.userName} eliminatedWeek`).toBe(exp.eliminatedWeek);
                }
            }
        } finally {
            await wrappedCleanup({ data: { poolId: handle.poolId, runId, deleteGames: true }, auth: superAdmin } as never);
        }
    }, 60000);

    it('NFL_MARGIN: weekly margins + season totals match the oracle', async () => {
        const runId = 'run-head-margin-01';
        const handle = await driveScenario({
            runId, poolType: 'NFL_MARGIN',
            settings: { entryFee: 0, payoutMode: 'SEASON', payouts: { places: [], bonuses: [] } },
            games: season.games,
            entries: genEntriesFor('NFL_MARGIN', runId, season),
            scoreWeeks: [1, 2, 3, 4],
        });
        try {
            const expected = expectMargin(season);
            for (let i = 0; i < expected.length; i++) {
                const exp = expected[i];
                const actual = handle.entries[`sim-${runId}-u${i + 1}`];
                expect(actual, `entry ${exp.userName} missing`).toBeTruthy();
                expect(actual.seasonTotal, `${exp.userName} seasonTotal`).toBe(exp.seasonTotal);
                for (const [week, m] of Object.entries(exp.weeklyScores)) {
                    expect(actual.weeklyScores?.[week], `${exp.userName} wk${week} margin`).toBe(m);
                }
            }
        } finally {
            await wrappedCleanup({ data: { poolId: handle.poolId, runId, deleteGames: true }, auth: superAdmin } as never);
        }
    }, 60000);
});

describe('headless scenario runner — hand-authored fixtures (browser parity)', () => {
    it('nfl-pickem-basic.json passes its own assertions through the real engine', async () => {
        const fx = loadFixture('nfl-pickem-basic.json');
        const runId = 'run-head-fx-pickem';
        const entries = fx.testEntries.map((e: any, i: number) => ({
            ownerUid: `sim-${runId}-u${i + 1}`,
            userName: e.userName,
            submittedAt: 0, paidStatus: 'PAID',
            picks: pickemDocKeys(e.pickemPicks, fx.nflGames, runId),
            weeklyTiebreakers: Object.fromEntries(Object.entries(e.weeklyTiebreakers ?? {}).map(([k, v]) => [Number(k), v])),
            weeklyPoints: {}, totalScore: 0,
        }));
        const handle = await driveScenario({
            runId, poolType: 'NFL_PICKEM',
            settings: fx.poolConfig.settings,
            games: fx.nflGames,
            entries,
            scoreWeeks: fx.scoreWeeks,
        });
        try {
            const byName = (n: string) => Object.values(handle.entries).find((e: any) => e.userName === n) as any;
            // Mirror the fixture's own assertions:
            expect(Object.keys(handle.entries)).toHaveLength(3);
            expect(byName('Alice').weeklyPoints?.['1'] ?? byName('Alice').weeklyResults?.['1']?.points).toBe(3);
            expect(byName('Carol').weeklyPoints?.['1'] ?? byName('Carol').weeklyResults?.['1']?.points).toBe(0);
            expect(byName('Bob').totalScore).toBe(2);
            expect(handle.recaps['1']).toBeTruthy();
            expect((handle.recaps['1'] as any)?.closestTiebreaker?.userName).toBe('Carol');
        } finally {
            await wrappedCleanup({ data: { poolId: handle.poolId, runId, deleteGames: true }, auth: superAdmin } as never);
        }
    }, 60000);
});
