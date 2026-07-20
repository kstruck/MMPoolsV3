import { describe, it, expect } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import * as fs from 'fs';
import * as path from 'path';
import {
    simStartRun, simWriteEntries, simSeedNFLGames, cleanupSimPool,
    simJoinMembers, simSubmitPicks, simExecuteRebuy, simFinalizePool,
} from '../../simHarness';
import { scoreNFLWeek, createNFLPool } from '../../nflPools';
import { recordPoolPayouts } from '../../payoutRecords';
// The BROWSER assertion evaluator — same fixtures, same evaluator, both runners
// (PLAN-NFL-SIM-HARNESS Phase 4 items 25-27). Type-only imports inside it erase.
import { runAssertions } from '../../../../src/utils/testing/scenarios/assertionRunner';

/**
 * Generic fixture matrix runner (Phase 4). Every `nfl-*.json` Scenario in
 * src/utils/testing/scenarios runs end to end against the emulator THROUGH THE
 * WRAPPED CALLABLES — direct-write matrix cells score via the real scoreNFLWeek;
 * `lifecycleOps` fixtures drive the REAL join/submit/rebuy/finalize/payout
 * paths; `createViaCallable` fixtures create through the real createNFLPool
 * (billing launch-mode stamps). Each fixture's own `assertions` array is then
 * evaluated with the SAME evaluator the browser Test Suite uses — one fixture,
 * two runners, identical semantics. Expected values are hand-verified
 * (PHASE4-EXPECTATIONS.md) — never synced from engine output.
 */
const test = ftest();
const db = admin.firestore();

const wStart = test.wrap(simStartRun);
const wWrite = test.wrap(simWriteEntries);
const wSeed = test.wrap(simSeedNFLGames);
const wCleanup = test.wrap(cleanupSimPool);
const wJoin = test.wrap(simJoinMembers);
const wSubmit = test.wrap(simSubmitPicks);
const wRebuy = test.wrap(simExecuteRebuy);
const wFinalize = test.wrap(simFinalizePool);
const wScore = test.wrap(scoreNFLWeek);
const wCreate = test.wrap(createNFLPool);
const wPayouts = test.wrap(recordPoolPayouts);

const superAdmin = { uid: 'admin-1', token: { role: 'SUPER_ADMIN', name: 'Admin' } } as any;

const FIXTURE_DIR = path.resolve(__dirname, '../../../../src/utils/testing/scenarios');
const FIXTURES: any[] = fs.readdirSync(FIXTURE_DIR)
    .filter(f => f.startsWith('nfl-') && f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8')));

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });

const uidFor = (runId: string, userName: string) =>
    `sim-${runId}-${userName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

function seedGamePayload(g: any, seasonType: number, runStart: number) {
    return {
        week: g.week, seasonType,
        startTime: runStart + (g.startOffsetMs ?? -24 * 60 * 60 * 1000),
        status: g.status ?? 'FINAL', isMonday: g.isMonday ?? false,
        homeTeam: T(g.home), awayTeam: T(g.away),
        scores: { home: g.homeScore ?? 0, away: g.awayScore ?? 0 },
        // Spread shape is fixture-controlled. It used to be hardcoded to
        // `{ value: g.spread ?? 0, locked: true }`, which meant EVERY game in
        // EVERY fixture carried a locked spread — so submitNFLPicks's
        // SPREADS_NOT_LOCKED precondition was structurally unreachable in the
        // whole 45-fixture matrix. That blind spot is why the eval never caught
        // the gate blocking straight-up pools (fixed 2026-07-19, PR #214).
        //   noSpread: true      -> no spread field at all (the real preseason
        //                          case: 48 of 49 games carry no betting line)
        //   spreadLocked: false -> a line exists but has not been locked yet
        ...(g.noSpread
            ? {}
            : { spread: { value: g.spread ?? 0, locked: g.spreadLocked !== false } }),
    };
}

/** Per-week gN keys -> this run's seeded doc ids (seed-order contract). */
function translateGameKeys(
    byWeek: Record<string, Record<string, unknown>> | undefined,
    runId: string,
    games: any[],
): Record<string, unknown> {
    const flat: Record<string, unknown> = {};
    for (const [week, weekPicks] of Object.entries(byWeek ?? {})) {
        const idx: number[] = [];
        games.forEach((g, i) => { if (g.week === Number(week)) idx.push(i); });
        for (const [key, value] of Object.entries(weekPicks)) {
            const n = parseInt(key.replace(/^g/, ''), 10);
            if (Number.isFinite(n) && n >= 1 && idx[n - 1] !== undefined) {
                flat[`sim-${runId}-g${idx[n - 1] + 1}`] = value;
            }
        }
    }
    return flat;
}

function numKeys<V>(rec: Record<string, V> | undefined): Record<number, V> {
    const out: Record<number, V> = {};
    for (const [k, v] of Object.entries(rec ?? {})) out[Number(k)] = v;
    return out;
}

function buildEntry(fx: any, e: any, runId: string, games: any[]): Record<string, unknown> {
    const base = {
        ownerUid: uidFor(runId, e.userName), userName: e.userName,
        submittedAt: 0, paidStatus: 'PAID',
    };
    if (fx.poolType === 'NFL_PICKEM') {
        return {
            ...base,
            picks: translateGameKeys(e.pickemPicks, runId, games),
            ...(e.confidence ? { confidence: translateGameKeys(e.confidence, runId, games) } : {}),
            weeklyTiebreakers: numKeys(e.weeklyTiebreakers),
            weeklyPoints: {}, totalScore: 0,
        };
    }
    if (fx.poolType === 'NFL_SURVIVOR') {
        return {
            ...base, status: 'ALIVE', strikesUsed: 0, rebuysUsed: 0,
            usedTeams: e.usedTeams ?? [],
            picks: numKeys(e.survivorPicks), exemptWeeks: [],
        };
    }
    return {
        ...base, picks: numKeys(e.marginPicks),
        weeklyScores: {}, seasonTotal: 0, negativeBurden: 0, positiveWeeks: 0, bestWeek: 0,
    };
}

interface OpsCtx {
    poolId: string; runId: string; seasonType: number; runStart: number;
    games: any[]; scoredWeeks: number[];
    rejections: Array<{ userName: string; week?: number; op: string; code: string }>;
}

async function runOps(ctx: OpsCtx, ops: any[]): Promise<void> {
    const { poolId, runId } = ctx;
    const guarded = async (
        op: string, userName: string, week: number | undefined,
        expectError: string | undefined, fn: () => Promise<unknown>,
    ) => {
        try {
            await fn();
            if (expectError) ctx.rejections.push({ userName, week, op, code: 'SUCCESS' });
        } catch (e: any) {
            if (!expectError) throw e;
            ctx.rejections.push({ userName, week, op, code: String(e?.message ?? e) });
        }
    };

    for (const op of ops) {
        if (op.op === 'join') {
            for (const name of op.userNames) {
                await guarded('join', name, undefined, op.expectError, () =>
                    wJoin({ data: { poolId, runId, members: [{ uid: uidFor(runId, name), name }] }, auth: superAdmin } as never));
            }
        } else if (op.op === 'submit') {
            const subjectUid = uidFor(runId, op.userName);
            const picks = op.team !== undefined
                ? { [op.week]: op.team }
                : translateGameKeys({ [String(op.week)]: op.picks ?? {} }, runId, ctx.games);
            const confidence = op.confidence
                ? translateGameKeys({ [String(op.week)]: op.confidence }, runId, ctx.games)
                : undefined;
            await guarded('submit', op.userName, op.week, op.expectError, () =>
                wSubmit({
                    data: {
                        poolId, runId, subjectUid, week: op.week, picks,
                        ...(confidence ? { confidence } : {}),
                        ...(op.tiebreaker !== undefined ? { tiebreakerPrediction: op.tiebreaker } : {}),
                    },
                    auth: superAdmin,
                } as never));
        } else if (op.op === 'rebuy') {
            await guarded('rebuy', op.userName, op.week, op.expectError, () =>
                wRebuy({ data: { poolId, runId, subjectUid: uidFor(runId, op.userName), week: op.week }, auth: superAdmin } as never));
        } else if (op.op === 'score') {
            await wScore({ data: { poolId, week: op.week }, auth: superAdmin } as never);
            if (!ctx.scoredWeeks.includes(op.week)) ctx.scoredWeeks.push(op.week);
        } else if (op.op === 'reseedGames') {
            await wSeed({
                data: { runId, games: op.games.map((g: any) => seedGamePayload(g, ctx.seasonType, ctx.runStart)) },
                auth: superAdmin,
            } as never);
            ctx.games = op.games;
        } else if (op.op === 'finalize') {
            await guarded('finalize', '(pool)', undefined, op.expectError, () =>
                wFinalize({ data: { poolId, runId }, auth: superAdmin } as never));
        } else if (op.op === 'recordPayouts') {
            await wPayouts({
                data: {
                    poolId,
                    awards: op.awards.map((a: any) => ({
                        uid: uidFor(runId, a.userName), amount: a.amount,
                        kind: 'PLACE', place: a.place, settled: true,
                    })),
                },
                auth: superAdmin,
            } as never);
        }
    }
}

/** "week:gameKey" -> doc id (matches the browser buildGameKeyMap). */
function gameKeyMap(runId: string, games: any[]): Record<string, string> {
    const map: Record<string, string> = {};
    const perWeek: Record<number, number> = {};
    games.forEach((g, i) => {
        perWeek[g.week] = (perWeek[g.week] ?? 0) + 1;
        map[`${g.week}:g${perWeek[g.week]}`] = `sim-${runId}-g${i + 1}`;
    });
    return map;
}

describe('fixture matrix — every nfl-* Scenario through the real callables (emulator = browser semantics)', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(40);

    for (const fx of FIXTURES) {
        it(`${fx.id}: ${fx.name}`, async () => {
            const runId = `run-fx-${fx.id.replace(/[^a-z0-9-]/g, '')}`.slice(0, 60);
            const seasonType = Number(fx.poolConfig?.seasonType ?? 2);
            const runStart = Date.now();
            let poolId = `pool-${runId}`;

            await wStart({ data: { runId, scenarioId: fx.id }, auth: superAdmin } as never);

            if (fx.createViaCallable) {
                // REAL create path — billing launch-mode stamps are what's under test.
                await db.collection('users').doc('admin-1').set({ role: 'SUPER_ADMIN', name: 'Admin', email: 'admin@example.com' }, { merge: true });
                const res = (await wCreate({
                    data: {
                        ...fx.poolConfig,
                        type: fx.poolType, league: 'NFL',
                        season: `sim-${runId}`, seasonType,
                        simRunId: runId, isPublic: false,
                    },
                    auth: superAdmin,
                } as never)) as { poolId: string };
                poolId = res.poolId;
            } else {
                await db.collection('pools').doc(poolId).set({
                    name: fx.poolConfig?.name ?? fx.id, type: fx.poolType, league: 'NFL',
                    season: `sim-${runId}`, seasonType, simRunId: runId,
                    ownerId: 'admin-1', participantIds: ['admin-1'],
                    status: 'OPEN', billing: { status: 'free' },
                    settings: fx.poolConfig?.settings ?? {},
                });
            }

            let games: any[] = fx.nflGames ?? [];
            await wSeed({
                data: { runId, games: games.map((g: any) => seedGamePayload(g, seasonType, runStart)) },
                auth: superAdmin,
            } as never);

            const entries = (fx.testEntries ?? []).map((e: any) => buildEntry(fx, e, runId, games));
            if (entries.length > 0) {
                await wWrite({ data: { poolId, runId, entries }, auth: superAdmin } as never);
            }

            const ctx: OpsCtx = { poolId, runId, seasonType, runStart, games, scoredWeeks: [], rejections: [] };
            try {
                if (fx.lifecycleOps?.length) {
                    await runOps(ctx, fx.lifecycleOps);
                    games = ctx.games;
                } else {
                    const weeks: number[] = fx.scoreWeeks ?? [...new Set(games.map((g: any) => g.week))].sort((a: any, b: any) => a - b);
                    for (const week of weeks) {
                        await wScore({ data: { poolId, week }, auth: superAdmin } as never);
                        ctx.scoredWeeks.push(week);
                    }
                }

                // Hydrate the SAME TestPool shape the browser hands to runAssertions.
                const entriesSnap = await db.collection('pools').doc(poolId).collection('entries').get();
                const hydratedEntries = entriesSnap.docs.map(d => d.data());
                const recaps: Record<string, unknown> = {};
                for (const week of ctx.scoredWeeks) {
                    const r = await db.collection('pools').doc(poolId).collection('weekly_recaps').doc(`week_${week}`).get();
                    if (r.exists) recaps[String(week)] = r.data();
                }
                const poolDoc = (await db.collection('pools').doc(poolId).get()).data() ?? {};

                const kinds = new Set((fx.assertions ?? []).map((a: any) => a.type));
                const testPool: Record<string, unknown> = {
                    ...poolDoc,
                    _nflEntries: hydratedEntries,
                    _nflRecaps: recaps,
                    _gameKeyMap: gameKeyMap(runId, games),
                    _rejections: ctx.rejections,
                };
                if (kinds.has('standingsRow')) {
                    const s = await db.collection('pools').doc(poolId).collection('standings').doc('current').get();
                    testPool._standings = (s.data()?.rows ?? []);
                }
                if (kinds.has('seasonHistoryRow')) {
                    const hist: Record<string, unknown> = {};
                    for (const a of fx.assertions.filter((x: any) => x.type === 'seasonHistoryRow')) {
                        const h = await db.collection('users').doc(uidFor(runId, a.userName)).collection('seasonHistory').doc(poolId).get();
                        if (h.exists) hist[a.userName] = h.data();
                    }
                    testPool._seasonHistory = hist;
                }
                if (kinds.has('payoutRecordExists')) {
                    const uidToName = new Map(hydratedEntries.map((e: any) => [String(e.ownerUid), String(e.userName)]));
                    const p = await db.collection('pools').doc(poolId).collection('payoutRecords').get();
                    testPool._payoutRecords = p.docs.map(d => {
                        const rec = d.data() as Record<string, unknown>;
                        return { ...rec, userName: rec.userName ?? uidToName.get(String(rec.uid)) };
                    });
                }
                if (kinds.has('consensusTally')) {
                    const consensus: Record<string, unknown> = {};
                    const km = testPool._gameKeyMap as Record<string, string>;
                    for (const a of fx.assertions.filter((x: any) => x.type === 'consensusTally')) {
                        const docId = km[`${a.week}:${a.gameKey}`];
                        if (!docId) continue;
                        const c = await db.collection('pools').doc(poolId).collection('consensus').doc(docId).get();
                        if (c.exists) consensus[`${a.week}:${a.gameKey}`] = c.data();
                    }
                    testPool._consensus = consensus;
                }

                const validation = runAssertions(fx, [], testPool as never);
                const failures = validation.results.filter(r => !r.passed).map(r => r.message);
                expect(failures, `${fx.id} assertion failures:\n${failures.join('\n')}`).toEqual([]);
            } finally {
                await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
            }
        }, 120000);
    }
});
