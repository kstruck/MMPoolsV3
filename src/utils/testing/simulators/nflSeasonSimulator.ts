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
import type { TestScenario, ScenarioNFLGame, LifecycleOp } from '../scenarios/index';

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
    // Persisted-schema hydration (Phase 4 item 26) — populated pre-cleanup only
    // when the scenario's assertions need them (see hydrateExtras):
    standings?: Array<Record<string, unknown>>;
    seasonHistory?: Record<string, Record<string, unknown>>; // userName -> row
    payoutRecords?: Array<Record<string, unknown>>;
    profiles?: Record<string, Record<string, unknown>>; // userName -> profile doc
    consensus?: Record<string, Record<string, unknown>>; // "week:gameKey" -> tally
    gameKeyMap?: Record<string, string>; // "week:gameKey" -> game doc id
    rejections?: Array<{ userName: string; week?: number; op: string; code: string }>;
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

function toSeedGame(g: ScenarioNFLGame, seasonType: number, runStart: number): Record<string, unknown> {
    return {
        week: g.week,
        seasonType,
        // Kickoff relative to run start; default -24h (already kicked off) so
        // score-only fixtures behave as before. Lock-timing Golden Scenarios set
        // future offsets so the REAL submit path can be exercised pre-lock and
        // asserted post-lock (Codex R2#3).
        startTime: runStart + (g.startOffsetMs ?? -24 * 60 * 60 * 1000),
        status: g.status ?? 'FINAL',
        isMonday: g.isMonday ?? false,
        homeTeam: { id: g.home, name: TEAM_NAMES[g.home] ?? g.home, abbreviation: g.home },
        awayTeam: { id: g.away, name: TEAM_NAMES[g.away] ?? g.away, abbreviation: g.away },
        scores: { home: g.homeScore ?? 0, away: g.awayScore ?? 0 },
        spread: { value: g.spread ?? 0, locked: true },
    };
}

// Translates per-week "gN" pick keys into the run's real game doc IDs.
// "g1" = the first game OF THE PICK'S WEEK — the old translator flattened keys
// into one global map, so week 2's g1 overwrote week 1's g1 and every
// multi-week fixture was structurally broken (Codex R1#5).
function translateGameKeys(
    byWeek: Record<string, Record<string, unknown>> | undefined,
    runId: string,
    games: ScenarioNFLGame[],
): Record<string, unknown> {
    const flat: Record<string, unknown> = {};
    if (!byWeek) return flat;
    for (const [week, weekPicks] of Object.entries(byWeek)) {
        const weekGlobalIdx: number[] = [];
        games.forEach((g, i) => { if (g.week === Number(week)) weekGlobalIdx.push(i); });
        for (const [gameKey, value] of Object.entries(weekPicks)) {
            const n = parseInt(gameKey.replace(/^g/, ''), 10);
            const globalIdx = Number.isFinite(n) && n >= 1 ? weekGlobalIdx[n - 1] : undefined;
            if (globalIdx !== undefined) flat[gameDocId(runId, globalIdx)] = value;
        }
    }
    return flat;
}

function numKeys<T>(rec: Record<string, T> | undefined): Record<number, T> {
    const out: Record<number, T> = {};
    for (const [k, v] of Object.entries(rec ?? {})) out[Number(k)] = v;
    return out;
}

// Run-scoped subject uid for a scenario userName — must match the uid used
// when the entry was fabricated (and what simJoinMembers enrolled).
function uidForUserName(runId: string, userName: string): string {
    return `sim-${runId}-${userName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
}

/** "week:gameKey" -> game doc id, for gradedPick/consensusTally assertions. */
function buildGameKeyMap(runId: string, games: ScenarioNFLGame[]): Record<string, string> {
    const map: Record<string, string> = {};
    const perWeekCount: Record<number, number> = {};
    games.forEach((g, i) => {
        perWeekCount[g.week] = (perWeekCount[g.week] ?? 0) + 1;
        map[`${g.week}:g${perWeekCount[g.week]}`] = gameDocId(runId, i);
    });
    return map;
}

/**
 * Executes a scenario's real-path lifecycle ops IN ORDER (Phase 4 item 25).
 * Ops with `expectError` record their outcome into `rejections` (asserted via
 * the submitRejected assertion type) instead of failing the run; an op that
 * fails WITHOUT expectError throws and fails the scenario.
 */
async function runLifecycleOps(ctx: {
    functions: ReturnType<typeof getFunctions>;
    poolId: string;
    runId: string;
    seasonType: number;
    runStart: number;
    games: ScenarioNFLGame[]; // mutated by reseedGames
    addStep: (step: string, status: NFLSimStep['status'], message: string) => void;
    rejections: Array<{ userName: string; week?: number; op: string; code: string }>;
    scoredWeeks: number[];
}, ops: LifecycleOp[]): Promise<void> {
    const { functions, poolId, runId, addStep } = ctx;
    const call = (name: string) => httpsCallable(functions, name);

    const guarded = async (
        op: string, userName: string, week: number | undefined,
        expectError: string | undefined, fn: () => Promise<unknown>,
    ) => {
        try {
            await fn();
            if (expectError) {
                ctx.rejections.push({ userName, week, op, code: 'SUCCESS' });
                addStep(`Op ${op}`, 'failed', `${userName}: expected rejection ("${expectError}") but the call SUCCEEDED`);
            } else {
                addStep(`Op ${op}`, 'success', `${userName}${week !== undefined ? ` wk${week}` : ''}`);
            }
        } catch (e: unknown) {
            const code = e instanceof Error ? e.message : String(e);
            if (!expectError) throw e;
            ctx.rejections.push({ userName, week, op, code });
            addStep(`Op ${op}`, 'success', `${userName}: rejected as expected (${code.slice(0, 120)})`);
        }
    };

    for (const op of ops) {
        if (op.op === 'join') {
            // One call per member so an expected rejection is isolated to its member.
            for (const name of op.userNames) {
                await guarded('join', name, undefined, op.expectError, () =>
                    call('simJoinMembers')({ poolId, runId, members: [{ uid: uidForUserName(runId, name), name }] }));
            }
        } else if (op.op === 'submit') {
            const subjectUid = uidForUserName(runId, op.userName);
            const picks = op.team !== undefined
                ? { [op.week]: op.team } // survivor/margin: week -> team
                : translateGameKeys({ [String(op.week)]: op.picks ?? {} }, runId, ctx.games);
            const confidence = op.confidence
                ? translateGameKeys({ [String(op.week)]: op.confidence }, runId, ctx.games)
                : undefined;
            await guarded('submit', op.userName, op.week, op.expectError, () =>
                call('simSubmitPicks')({
                    poolId, runId, subjectUid, week: op.week, picks,
                    ...(confidence ? { confidence } : {}),
                    ...(op.tiebreaker !== undefined ? { tiebreakerPrediction: op.tiebreaker } : {}),
                }));
        } else if (op.op === 'rebuy') {
            await guarded('rebuy', op.userName, op.week, op.expectError, () =>
                call('simExecuteRebuy')({ poolId, runId, subjectUid: uidForUserName(runId, op.userName), week: op.week }));
        } else if (op.op === 'score') {
            await call('scoreNFLWeek')({ poolId, week: op.week });
            if (!ctx.scoredWeeks.includes(op.week)) ctx.scoredWeeks.push(op.week);
            addStep('Op score', 'success', `Week ${op.week} scored via scoreNFLWeek`);
        } else if (op.op === 'reseedGames') {
            await call('simSeedNFLGames')({
                runId,
                games: op.games.map(g => toSeedGame(g, ctx.seasonType, ctx.runStart)),
            });
            ctx.games.length = 0;
            ctx.games.push(...op.games);
            addStep('Op reseedGames', 'success', `${op.games.length} games re-seeded`);
        } else if (op.op === 'finalize') {
            await guarded('finalize', '(pool)', undefined, op.expectError, () =>
                call('simFinalizePool')({ poolId, runId }));
        } else if (op.op === 'recordPayouts') {
            await call('recordPoolPayouts')({
                poolId,
                awards: op.awards.map(a => ({
                    uid: uidForUserName(runId, a.userName),
                    amount: a.amount, kind: 'PLACE', place: a.place, settled: true,
                })),
            });
            addStep('Op recordPayouts', 'success', `${op.awards.length} award(s) recorded`);
        }
    }
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
    const runStart = Date.now();
    let poolId: string | undefined;

    // A Scenario with no assertions is INVALID — "it ran" is never a pass
    // (CONTEXT.md "Scenario"; PLAN-NFL-SIM-HARNESS Phase 1.10).
    if (!scenario.assertions || scenario.assertions.length === 0) {
        addStep('Schema Gate', 'failed', `Scenario "${scenario.id}" has no assertions — refusing to run.`);
        return result;
    }

    // Materialize a generated season (deterministic — same seed, same fixture,
    // browser and emulator alike). Generated scenarios must not hand-author
    // games/entries; the generator is their single source.
    let scenarioGames = scenario.nflGames ?? [];
    let scenarioEntries = scenario.testEntries ?? [];
    if (scenario.generator) {
        const { generateNFLSeason } = await import('@shared/simGen');
        const season = generateNFLSeason(scenario.generator);
        scenarioGames = season.games;
        scenarioEntries = season.entries.map(e => ({
            userName: e.userName,
            pickemPicks: e.pickemPicks,
            confidence: e.confidence,
            weeklyTiebreakers: e.weeklyTiebreakers,
            survivorPicks: e.survivorPicks,
            marginPicks: e.marginPicks,
        }));
        addStep('Generate', 'success',
            `Seed ${scenario.generator.seed}: ${scenarioGames.length} games / ${scenarioEntries.length} entries materialized`);
    }

    try {
        // 0. Open the run manifest FIRST — even a run that dies on its next step is
        // then discoverable by the stranded-run sweep (PLAN-NFL-SIM-HARNESS Phase 0.7).
        await httpsCallable(functions, 'simStartRun')({ runId, scenarioId: scenario.id });
        addStep('Start Run', 'success', `Manifest simRuns/${runId} opened`);

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
        const games = scenarioGames;
        if (games.length === 0) throw new Error('Scenario has no nflGames');
        await httpsCallable(functions, 'simSeedNFLGames')({
            runId,
            games: games.map(g => toSeedGame(g, seasonType, runStart)),
        });
        addStep('Seed Games', 'success', `${games.length} synthetic games (season sim-${runId})`);

        // 3. Fabricate entries via the guarded harness (docId === ownerUid).
        // Uids are RUN-SCOPED (`sim-<runId>-…`) so successive/concurrent runs can never
        // collide on off-pool docs (publicProfiles/seasonHistory/users) — enforced
        // server-side by simWriteEntries (Phase 0.6, Codex R1#6).
        const entries = scenarioEntries.map(e => {
            const ownerUid = uidForUserName(runId, e.userName);
            const base: Record<string, unknown> = {
                ownerUid,
                userName: e.userName,
                submittedAt: Date.now(),
                paidStatus: 'PAID',
            };
            if (poolType === 'NFL_PICKEM') {
                return {
                    ...base,
                    picks: translateGameKeys(e.pickemPicks, runId, games),
                    confidence: translateGameKeys(e.confidence, runId, games),
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
        if (entries.length > 0) {
            await httpsCallable(functions, 'simWriteEntries')({ poolId, runId, entries });
            addStep('Write Entries', 'success', `${entries.length} entries fabricated`);
        }

        // 4. Drive the season: lifecycle ops when present (real-path scenarios),
        // otherwise score each scoreWeek via the REAL callable (direct-write matrix).
        const rejections: NonNullable<NFLSimResult['rejections']> = [];
        let weeks: number[];
        if (scenario.lifecycleOps?.length) {
            const scoredWeeks: number[] = [];
            const mutableGames = [...games];
            await runLifecycleOps({
                functions, poolId, runId, seasonType, runStart,
                games: mutableGames, addStep, rejections, scoredWeeks,
            }, scenario.lifecycleOps);
            weeks = scoredWeeks.sort((a, b) => a - b);
            games.length = 0;
            games.push(...mutableGames); // reseeds visible to hydration key maps
        } else {
            weeks = scenario.scoreWeeks ?? [...new Set(games.map(g => g.week))].sort((a, b) => a - b);
            for (const week of weeks) {
                await httpsCallable(functions, 'scoreNFLWeek')({ poolId, week });
                addStep('Score Week', 'success', `Week ${week} scored via scoreNFLWeek`);
            }
        }
        result.rejections = rejections;

        // 5. Hydrate BEFORE cleanup — assertions run on this snapshot.
        const entriesSnap = await getDocs(collection(db, 'pools', poolId, 'entries'));
        result.entries = entriesSnap.docs.map(d => ({ ...(d.data() as NFLSimEntry) }));
        for (const week of weeks) {
            const recapSnap = await getDoc(doc(db, 'pools', poolId, 'weekly_recaps', `week_${week}`));
            if (recapSnap.exists()) result.recaps[String(week)] = recapSnap.data() as Record<string, unknown>;
        }
        const poolSnap = await getDoc(doc(db, 'pools', poolId));
        result.poolSnapshot = poolSnap.data() as Record<string, unknown>;

        // 5b. Persisted-schema hydration, only what this scenario's assertions need
        // (standings projection, seasonHistory, payoutRecords, profiles, consensus).
        const kinds = new Set(scenario.assertions.map(a => a.type));
        result.gameKeyMap = buildGameKeyMap(runId, games);
        if (kinds.has('standingsRow')) {
            const s = await getDoc(doc(db, 'pools', poolId, 'standings', 'current'));
            result.standings = (s.data()?.rows ?? []) as Array<Record<string, unknown>>;
        }
        const namesFor = (type: string) => [...new Set(
            scenario.assertions.filter(a => a.type === type && a.userName).map(a => a.userName as string))];
        if (kinds.has('seasonHistoryRow')) {
            result.seasonHistory = {};
            for (const name of namesFor('seasonHistoryRow')) {
                const h = await getDoc(doc(db, 'users', uidForUserName(runId, name), 'seasonHistory', poolId));
                if (h.exists()) result.seasonHistory[name] = h.data() as Record<string, unknown>;
            }
        }
        if (kinds.has('payoutRecordExists')) {
            const uidToName = new Map(
                result.entries.map(e => [String(e.ownerUid), String(e.userName)]));
            const p = await getDocs(collection(db, 'pools', poolId, 'payoutRecords'));
            result.payoutRecords = p.docs.map(d => {
                const rec = d.data() as Record<string, unknown>;
                return { ...rec, userName: rec.userName ?? uidToName.get(String(rec.uid)) };
            });
        }
        if (kinds.has('profileField')) {
            result.profiles = {};
            for (const name of namesFor('profileField')) {
                const pr = await getDoc(doc(db, 'publicProfiles', uidForUserName(runId, name)));
                if (pr.exists()) result.profiles[name] = pr.data() as Record<string, unknown>;
            }
        }
        if (kinds.has('consensusTally')) {
            result.consensus = {};
            for (const a of scenario.assertions.filter(x => x.type === 'consensusTally')) {
                const docId = result.gameKeyMap[`${a.week}:${a.gameKey}`];
                if (!docId) continue;
                const c = await getDoc(doc(db, 'pools', poolId, 'consensus', docId));
                if (c.exists()) result.consensus[`${a.week}:${a.gameKey}`] = c.data() as Record<string, unknown>;
            }
        }
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
