// NFL season-pool simulator (PLAN-TEST-SUITE Phase 2 items 8-10, 16).
// One parameterized simulator drives all three NFL season types — Pick'em,
// Survivor, Margin — because their lifecycle is identical: create pool via the
// real createNFLPool callable → seed synthetic games → fabricate entries via
// the guarded sim harness → score each week via the REAL scoreNFLWeek callable
// (RBAC + recaps + audit are part of what's under test) → hydrate → cleanup.
//
// Safety model (items 8e/8f): the simulator performs ZERO raw Firestore
// writes. Every mutation goes through the simRunId-scoped server callables in
// functions/src/simHarness.ts; the pool's season is the run's synthetic
// 'sim-<runId>' value, so no production query or ESPN import can collide.
// Cleanup runs in `finally` — a failed run must not strand prod docs.
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { dbService } from '../../../services/dbService';
import { logger } from '../../logger';
import type { TestScenario, ScenarioNFLGame } from '../scenarios/index';

export interface NFLSimStep {
    step: string;
    status: 'success' | 'failed' | 'skipped';
    message: string;
}

export interface NFLSimEntry {
    ownerUid: string;
    userName: string;
    totalScore?: number;
    weeklyPoints?: Record<string, number>;
    status?: string;
    strikesUsed?: number;
    strikeWeeks?: number[];
    seasonTotal?: number;
    weeklyScores?: Record<string, number>;
    rank?: number;
    [key: string]: unknown;
}

export interface NFLSimResult {
    poolId?: string;
    runId: string;
    steps: NFLSimStep[];
    entries: NFLSimEntry[];
    recaps: Record<string, Record<string, unknown>>; // week -> recap doc
    poolSnapshot?: Record<string, unknown>; // pre-cleanup pool doc
}

const TEAM_NAMES: Record<string, string> = {
    KC: 'Chiefs', BUF: 'Bills', SF: '49ers', DAL: 'Cowboys', BAL: 'Ravens',
    DET: 'Lions', PHI: 'Eagles', MIA: 'Dolphins', GB: 'Packers', NYJ: 'Jets',
    CIN: 'Bengals', LAR: 'Rams', MIN: 'Vikings', SEA: 'Seahawks', PIT: 'Steelers',
    HOU: 'Texans',
};

// Scenario games are addressed by 1-based array position: "g1", "g2", ...
// The server forces doc IDs to `sim-<runId>-g<n>` in seed order, so this
// mapping is deterministic without the scenario knowing the runId.
function gameDocId(runId: string, index: number): string {
    return `sim-${runId}-g${index + 1}`;
}

function toSeedGame(g: ScenarioNFLGame, seasonType: number): Record<string, unknown> {
    return {
        week: g.week,
        seasonType,
        // startTime in the past: every game already kicked off
        startTime: Date.now() - 24 * 60 * 60 * 1000,
        status: g.status ?? 'FINAL',
        isMonday: g.isMonday ?? false,
        homeTeam: { id: g.home, name: TEAM_NAMES[g.home] ?? g.home, abbreviation: g.home },
        awayTeam: { id: g.away, name: TEAM_NAMES[g.away] ?? g.away, abbreviation: g.away },
        scores: { home: g.homeScore ?? 0, away: g.awayScore ?? 0 },
        spread: { value: g.spread ?? 0, locked: true },
    };
}

// Translates "gN" pick keys into the run's real game doc IDs.
function translateGameKeys(
    byWeek: Record<string, Record<string, unknown>> | undefined,
    runId: string,
): Record<string, unknown> {
    const flat: Record<string, unknown> = {};
    if (!byWeek) return flat;
    for (const weekPicks of Object.values(byWeek)) {
        for (const [gameKey, value] of Object.entries(weekPicks)) {
            const idx = parseInt(gameKey.replace(/^g/, ''), 10);
            if (Number.isFinite(idx) && idx >= 1) flat[gameDocId(runId, idx - 1)] = value;
        }
    }
    return flat;
}

function numKeys<T>(rec: Record<string, T> | undefined): Record<number, T> {
    const out: Record<number, T> = {};
    for (const [k, v] of Object.entries(rec ?? {})) out[Number(k)] = v;
    return out;
}

export async function runNFLSeasonScenario(scenario: TestScenario): Promise<NFLSimResult> {
    const runId = `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const steps: NFLSimStep[] = [];
    const addStep = (step: string, status: NFLSimStep['status'], message: string) => {
        steps.push({ step, status, message });
        logger.log(`[NFLSim] ${step}: ${message}`);
    };

    const functions = getFunctions();
    const db = getFirestore();
    const result: NFLSimResult = { runId, steps, entries: [], recaps: {} };

    const poolType = scenario.poolType as 'NFL_PICKEM' | 'NFL_SURVIVOR' | 'NFL_MARGIN';
    const seasonType = Number((scenario.poolConfig as Record<string, unknown>).seasonType ?? 2);
    let poolId: string | undefined;

    try {
        // 1. Create the pool via the REAL create callable (ADR-0001). The pool's
        // season is the run's synthetic value so scoring queries only ever see
        // this run's games; simRunId arms the guarded harness callables.
        poolId = await dbService.createNFLPool({
            ...scenario.poolConfig,
            type: poolType,
            league: 'NFL',
            season: `sim-${runId}`,
            seasonType,
            simRunId: runId,
            isPublic: false,
        } as Record<string, unknown>);
        result.poolId = poolId;
        addStep('Create Pool', 'success', `Pool ${poolId} created (run ${runId})`);

        // 2. Seed synthetic games.
        const games = scenario.nflGames ?? [];
        if (games.length === 0) throw new Error('Scenario has no nflGames');
        await httpsCallable(functions, 'simSeedNFLGames')({
            runId,
            games: games.map(g => toSeedGame(g, seasonType)),
        });
        addStep('Seed Games', 'success', `${games.length} synthetic games (season sim-${runId})`);

        // 3. Fabricate entries via the guarded harness (docId === ownerUid).
        const entries = (scenario.testEntries ?? []).map(e => {
            const ownerUid = `sim-user-${e.userName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
            const base: Record<string, unknown> = {
                ownerUid,
                userName: e.userName,
                submittedAt: Date.now(),
                paidStatus: 'PAID',
            };
            if (poolType === 'NFL_PICKEM') {
                return {
                    ...base,
                    picks: translateGameKeys(e.pickemPicks, runId),
                    confidence: translateGameKeys(e.confidence, runId),
                    weeklyTiebreakers: numKeys(e.weeklyTiebreakers),
                    weeklyPoints: {},
                    totalScore: 0,
                };
            }
            if (poolType === 'NFL_SURVIVOR') {
                return {
                    ...base,
                    status: 'ALIVE',
                    strikesUsed: 0,
                    rebuysUsed: 0,
                    usedTeams: e.usedTeams ?? [],
                    picks: numKeys(e.survivorPicks),
                    exemptWeeks: [],
                };
            }
            return {
                ...base,
                picks: numKeys(e.marginPicks),
                weeklyScores: {},
                seasonTotal: 0,
                negativeBurden: 0,
                positiveWeeks: 0,
                bestWeek: 0,
            };
        });
        await httpsCallable(functions, 'simWriteEntries')({ poolId, runId, entries });
        addStep('Write Entries', 'success', `${entries.length} entries fabricated`);

        // 4. Score each week via the REAL callable.
        const weeks = scenario.scoreWeeks ?? [...new Set(games.map(g => g.week))].sort((a, b) => a - b);
        for (const week of weeks) {
            await httpsCallable(functions, 'scoreNFLWeek')({ poolId, week });
            addStep('Score Week', 'success', `Week ${week} scored via scoreNFLWeek`);
        }

        // 5. Hydrate BEFORE cleanup — assertions run on this snapshot.
        const entriesSnap = await getDocs(collection(db, 'pools', poolId, 'entries'));
        result.entries = entriesSnap.docs.map(d => ({ ...(d.data() as NFLSimEntry) }));
        for (const week of weeks) {
            const recapSnap = await getDoc(doc(db, 'pools', poolId, 'weekly_recaps', `week_${week}`));
            if (recapSnap.exists()) result.recaps[String(week)] = recapSnap.data() as Record<string, unknown>;
        }
        const poolSnap = await getDoc(doc(db, 'pools', poolId));
        result.poolSnapshot = poolSnap.data() as Record<string, unknown>;
        addStep('Hydrate', 'success', `${result.entries.length} entries, ${Object.keys(result.recaps).length} recaps read back`);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        addStep('Simulator Error', 'failed', msg);
    } finally {
        // 6. Guaranteed cleanup — pool tree + user-side docs + this run's games.
        if (poolId) {
            try {
                await httpsCallable(functions, 'cleanupSimPool')({ poolId, runId, deleteGames: true });
                addStep('Cleanup', 'success', `Pool ${poolId} + run games removed`);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                addStep('Cleanup Error', 'failed', `Manual sweep needed for pool ${poolId} / run ${runId}: ${msg}`);
            }
        }
    }

    return result;
}
