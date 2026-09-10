/**
 * PLAN-CONFIDENCE-PER-GAME-LOCK — T8, through the REAL callables against the
 * emulator (sim harness real-path fidelity, ADR 0006).
 *
 * Kevin, 2026-09-10: "It is important that if we allow users to change picks of
 * games that have already started, they are not able to change any confidence
 * selection of a game that has already started. They should be allowed to
 * change the team they picked and the confidence pick if that game has not
 * started. Any confidence pick for a game that has started can not be changed
 * under any circumstances."
 *
 * Run: `npm --prefix functions run test:emulator` (needs the Firestore emulator).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import {
    simStartRun, simJoinMembers, simSubmitPicks, simSeedNFLGames, cleanupSimPool,
} from '../../simHarness';
import { proxyPick, extendWeekDeadline } from '../../poolExceptions';
import { updatePoolSettings } from '../../poolOps';
import { createNFLPool } from '../../nflPools';
import { backfillConfidenceLockMode } from '../../migrations/backfillConfidenceLockMode';

const test = ftest();
const db = admin.firestore();

const wStart = test.wrap(simStartRun);
const wJoin = test.wrap(simJoinMembers);
const wSubmit = test.wrap(simSubmitPicks);
const wSeed = test.wrap(simSeedNFLGames);
const wCleanup = test.wrap(cleanupSimPool);
const wProxy = test.wrap(proxyPick);
const wExtend = test.wrap(extendWeekDeadline);
const wUpdate = test.wrap(updatePoolSettings);
const wCreate = test.wrap(createNFLPool);
const wBackfill = test.wrap(backfillConfidenceLockMode);

const superAdmin = { uid: 'admin-1', token: { role: 'SUPER_ADMIN', email: 'admin@test.local' } } as any;

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });
const HOUR = 60 * 60 * 1000;
const PRESEASON = 1;

// The sim-harness guard confirms the claim against users/{uid}.role, and a
// describe's beforeAll runs BEFORE any beforeEach — so the doc is seeded at the
// top of every beforeAll too.
const seedAdmin = () => db.collection('users').doc('admin-1').set({ role: 'SUPER_ADMIN', name: 'Admin' }, { merge: true });
beforeEach(seedAdmin);

/** A Pick'em pool doc, seeded directly so the lock settings are exactly what the test says. */
async function seedPool(poolId: string, runId: string, settings: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
    await db.collection('pools').doc(poolId).set({
        name: `Conf ${poolId}`, type: 'NFL_PICKEM', league: 'NFL',
        season: `sim-${runId}`, seasonType: PRESEASON, simRunId: runId,
        ownerId: 'admin-1', managerUid: 'admin-1', createdByUid: 'admin-1', participantIds: ['admin-1'],
        status: 'OPEN', isLocked: false, billing: { status: 'free' },
        settings: { entryFee: 0, payoutMode: 'SEASON', pickMode: 'STRAIGHT', payouts: { places: [], bonuses: [] }, weeklyTiebreaker: 'NONE', ...settings },
        ...overrides,
    });
}

/** Three games: g1 (Wed), g2 (Sun), g3 (Mon). Ids are assigned by the harness as sim-<runId>-g<n>. */
const slate = (wedStart: number, over: Record<string, Record<string, unknown>> = {}) => [
    { week: 1, seasonType: PRESEASON, startTime: wedStart, status: 'SCHEDULED', isMonday: false,
      homeTeam: T('SEA'), awayTeam: T('NE'), scores: { home: 0, away: 0 }, spread: { value: -3, locked: true }, ...(over.g1 ?? {}) },
    { week: 1, seasonType: PRESEASON, startTime: wedStart + 4 * 24 * HOUR, status: 'SCHEDULED', isMonday: false,
      homeTeam: T('PIT'), awayTeam: T('ATL'), scores: { home: 0, away: 0 }, spread: { value: -3, locked: true }, ...(over.g2 ?? {}) },
    { week: 1, seasonType: PRESEASON, startTime: wedStart + 5 * 24 * HOUR, status: 'SCHEDULED', isMonday: true,
      homeTeam: T('KC'), awayTeam: T('DEN'), scores: { home: 0, away: 0 }, spread: { value: -3, locked: true }, ...(over.g3 ?? {}) },
];

/** A complete pre-kickoff sheet, written the way submitNFLPicks stores one. */
async function seedEntry(poolId: string, uid: string, picks: Record<string, string>, confidence: Record<string, number>) {
    await db.collection('pools').doc(poolId).collection('entries').doc(uid).set({
        id: uid, poolId, ownerUid: uid, entryIndex: 1, userName: uid, picks, confidence,
        weeklyTiebreakers: {}, totalScore: 0, submittedAt: Date.now() - HOUR, paidStatus: 'UNPAID',
    });
}

const entry = async (poolId: string, uid: string) =>
    (await db.collection('pools').doc(poolId).collection('entries').doc(uid).get()).data()!;

// ---------------------------------------------------------------------------

describe('T8 #1 / #14 — LEGACY: an unstamped confidence pool still locks the whole week', () => {
    const runId = 'run-cpg-legacy';
    const poolId = `pool-${runId}`;
    const ALICE = `sim-${runId}-alice`;
    const g = (n: number) => `sim-${runId}-g${n}`;

    beforeAll(async () => {
        await seedAdmin();
        await wStart({ data: { runId, scenarioId: 'cpg-legacy' }, auth: superAdmin } as never);
        // The wizard default — PER_GAME stored on a confidence pool, NO stamp.
        await seedPool(poolId, runId, { confidenceMode: true, lockMode: 'PER_GAME' });
        await wSeed({ data: { runId, games: slate(Date.now() - HOUR, { g1: { status: 'IN_PROGRESS' } }) }, auth: superAdmin } as never);
        await wJoin({ data: { poolId, runId, members: [{ uid: ALICE, name: 'Alice' }] }, auth: superAdmin } as never);
    }, 30000);

    it('refuses a Sunday pick with WEEK_LOCKED once Wednesday has kicked off (the old rule, byte for byte)', async () => {
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: ALICE, week: 1, picks: { [g(2)]: 'PIT', [g(3)]: 'KC' }, confidence: { [g(2)]: 15, [g(3)]: 14 } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/WEEK_LOCKED/);
    }, 30000);

    it('cleans up', async () => {
        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
    }, 60000);
});

describe('T8 #2–#7, #11–#13, #15–#16, #18 — STAMPED PER_GAME confidence pool, Wednesday game started', () => {
    const runId = 'run-cpg-pergame';
    const poolId = `pool-${runId}`;
    const ALICE = `sim-${runId}-alice`;
    const BOB = `sim-${runId}-bob`;
    const g = (n: number) => `sim-${runId}-g${n}`;
    const WED = Date.now() - HOUR;

    beforeAll(async () => {
        await seedAdmin();
        await wStart({ data: { runId, scenarioId: 'cpg-pergame' }, auth: superAdmin } as never);
        await seedPool(poolId, runId, { confidenceMode: true, lockMode: 'PER_GAME', lockRuleVersion: 2, lockBufferMinutes: 10, weeklyTiebreaker: 'MNF_LAST_GAME' });
        // Wednesday game is live. Its feed startTime is MOVED TWO HOURS INTO THE
        // FUTURE on purpose (codex r2 #1): status must lock it, not the clock.
        await wSeed({ data: { runId, games: slate(WED, { g1: { status: 'IN_PROGRESS', startTime: Date.now() + 2 * HOUR, scores: { home: 10, away: 3 } } }) }, auth: superAdmin } as never);
        await wJoin({ data: { poolId, runId, members: [{ uid: ALICE, name: 'Alice' }, { uid: BOB, name: 'Bob' }] }, auth: superAdmin } as never);
        // Alice submitted her full sheet before Wednesday kicked off.
        await seedEntry(poolId, ALICE, { [g(1)]: 'SEA', [g(2)]: 'PIT', [g(3)]: 'KC' }, { [g(1)]: 16, [g(2)]: 15, [g(3)]: 14 });
    }, 30000);

    it('#2 Alice changes a Sunday pick AND weight (swapping 15/14 between Sun and Mon) — accepted; Wednesday untouched', async () => {
        await wSubmit({
            data: { poolId, runId, subjectUid: ALICE, week: 1,
                picks: { [g(1)]: 'SEA', [g(2)]: 'ATL', [g(3)]: 'KC' },
                confidence: { [g(1)]: 16, [g(2)]: 14, [g(3)]: 15 } },
            auth: superAdmin,
        } as never);
        const e = await entry(poolId, ALICE);
        expect(e.picks).toEqual({ [g(1)]: 'SEA', [g(2)]: 'ATL', [g(3)]: 'KC' });
        expect(e.confidence).toEqual({ [g(1)]: 16, [g(2)]: 14, [g(3)]: 15 });
    }, 30000);

    it('#3 / #18 changing the Wednesday WEIGHT alone → CONFIDENCE_LOCKED (status beats a moved startTime)', async () => {
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: ALICE, week: 1,
                picks: { [g(1)]: 'SEA', [g(2)]: 'ATL', [g(3)]: 'KC' },
                confidence: { [g(1)]: 14, [g(2)]: 16, [g(3)]: 15 } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/CONFIDENCE_LOCKED/);
    }, 30000);

    it('#3 changing the Wednesday PICK → GAME_LOCKED', async () => {
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: ALICE, week: 1,
                picks: { [g(1)]: 'NE', [g(2)]: 'ATL', [g(3)]: 'KC' },
                confidence: { [g(1)]: 16, [g(2)]: 14, [g(3)]: 15 } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/GAME_LOCKED/);
    }, 30000);

    it('#4 moving the Wednesday 16 onto Sunday → DUPLICATE_CONFIDENCE_VALUES (the frozen 16 still counts)', async () => {
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: ALICE, week: 1,
                picks: { [g(2)]: 'ATL', [g(3)]: 'KC' },
                confidence: { [g(2)]: 16, [g(3)]: 15 } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/DUPLICATE_CONFIDENCE_VALUES/);
    }, 30000);

    it('#7 a weight keyed to a game outside this week → invalid-argument', async () => {
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: ALICE, week: 1,
                picks: { [g(2)]: 'ATL', [g(3)]: 'KC' },
                confidence: { [g(2)]: 14, [g(3)]: 15, 'sim-other-g9': 13 } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/not found/);
    }, 30000);

    it('#5 late joiner Bob: missed Wednesday, so the 16 is gone — 15 and 14 pass, a 16 fails (D2)', async () => {
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: BOB, week: 1, picks: { [g(2)]: 'PIT', [g(3)]: 'DEN' }, confidence: { [g(2)]: 16, [g(3)]: 15 } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/OUT_OF_RANGE_CONFIDENCE/);
        await wSubmit({
            data: { poolId, runId, subjectUid: BOB, week: 1, picks: { [g(2)]: 'PIT', [g(3)]: 'DEN' }, confidence: { [g(2)]: 15, [g(3)]: 14 } },
            auth: superAdmin,
        } as never);
        const e = await entry(poolId, BOB);
        expect(e.picks[g(1)]).toBeUndefined();
        expect(e.confidence[g(1)]).toBeUndefined();
        expect(e.confidence).toEqual({ [g(2)]: 15, [g(3)]: 14 });
    }, 30000);

    it('#6 leaving an OPEN game unpicked → INCOMPLETE_CONFIDENCE_SUBMISSION', async () => {
        const CAROL = `sim-${runId}-carol`;
        await wJoin({ data: { poolId, runId, members: [{ uid: CAROL, name: 'Carol' }] }, auth: superAdmin } as never);
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: CAROL, week: 1, picks: { [g(2)]: 'PIT' }, confidence: { [g(2)]: 15 } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/INCOMPLETE_CONFIDENCE_SUBMISSION/);
    }, 30000);

    it('#13 proxyPick on a confidence pool → PROXY_CONFIDENCE_UNSUPPORTED (codex r1 #6)', async () => {
        await expect(wProxy({
            data: { poolId, targetUid: BOB, week: 1, picks: { [g(2)]: 'ATL' }, reason: 'texted' },
            auth: superAdmin,
        } as never)).rejects.toThrow(/PROXY_CONFIDENCE_UNSUPPORTED/);
    }, 30000);

    it('#11 a deadline extension does NOT reopen the started Wednesday game (kickoff ceiling)', async () => {
        await wExtend({ data: { poolId, week: 1, extraMinutes: 24 * 60, reason: 'test' }, auth: superAdmin } as never);
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: ALICE, week: 1,
                picks: { [g(1)]: 'SEA', [g(2)]: 'ATL', [g(3)]: 'KC' },
                confidence: { [g(1)]: 13, [g(2)]: 14, [g(3)]: 15 } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/CONFIDENCE_LOCKED/);
    }, 30000);

    it('#12 shrinking the buffer to 0 does NOT reopen it either', async () => {
        await wUpdate({ data: { poolId, updates: { settings: { lockBufferMinutes: 0 } } }, auth: superAdmin } as never);
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: ALICE, week: 1, picks: { [g(1)]: 'NE' }, confidence: { [g(1)]: 16 } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/GAME_LOCKED/);
    }, 30000);

    it('#15 confidenceMode cannot be flipped once anybody has submitted (T10)', async () => {
        await expect(wUpdate({
            data: { poolId, updates: { settings: { confidenceMode: false } } }, auth: superAdmin,
        } as never)).rejects.toThrow(/CONFIDENCE_MODE_LOCKED_AFTER_SUBMISSIONS/);
    }, 30000);

    it('#21 a manager save cannot downgrade or set the stamp (server-owned)', async () => {
        await expect(wUpdate({
            data: { poolId, updates: { settings: { lockRuleVersion: 1 } } }, auth: superAdmin,
        } as never)).rejects.toThrow(/lockRuleVersion/);
        const doc = (await db.collection('pools').doc(poolId).get()).data()!;
        expect(doc.settings.lockRuleVersion).toBe(2);
    }, 30000);

    it('#7 (D3) a CHANGED tiebreaker after the Monday target has started → TIEBREAK_LOCKED; unchanged resend OK', async () => {
        // Alice records 40 while Monday is open (target = the last Monday game, g3).
        await wSubmit({
            data: { poolId, runId, subjectUid: ALICE, week: 1,
                picks: { [g(1)]: 'SEA', [g(2)]: 'ATL', [g(3)]: 'KC' },
                confidence: { [g(1)]: 16, [g(2)]: 14, [g(3)]: 15 }, tiebreakerPrediction: 40 },
            auth: superAdmin,
        } as never);
        expect((await entry(poolId, ALICE)).weeklyTiebreakers?.['1']).toBe(40);
        // Monday kicks off.
        await db.collection('nfl_games').doc(g(3)).update({ status: 'IN_PROGRESS' });
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: ALICE, week: 1,
                picks: { [g(1)]: 'SEA', [g(2)]: 'ATL', [g(3)]: 'KC' },
                confidence: { [g(1)]: 16, [g(2)]: 14, [g(3)]: 15 }, tiebreakerPrediction: 41 },
            auth: superAdmin,
        } as never)).rejects.toThrow(/TIEBREAK_LOCKED/);
        await wSubmit({
            data: { poolId, runId, subjectUid: ALICE, week: 1,
                picks: { [g(1)]: 'SEA', [g(2)]: 'ATL', [g(3)]: 'KC' },
                confidence: { [g(1)]: 16, [g(2)]: 14, [g(3)]: 15 }, tiebreakerPrediction: 40 },
            auth: superAdmin,
        } as never);
    }, 30000);

    it('cleans up', async () => {
        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
    }, 60000);
});

describe('T8 #19 / #20 — cancellation policy (codex r2 #5)', () => {
    const runId = 'run-cpg-cancel';
    const poolId = `pool-${runId}`;
    const CAROL = `sim-${runId}-carol`;
    const DAVE = `sim-${runId}-dave`;
    const g = (n: number) => `sim-${runId}-g${n}`;

    beforeAll(async () => {
        await seedAdmin();
        await wStart({ data: { runId, scenarioId: 'cpg-cancel' }, auth: superAdmin } as never);
        await seedPool(poolId, runId, { confidenceMode: true, lockMode: 'PER_GAME', lockRuleVersion: 2 });
        // g2 CANCELLED before anyone picked it; g1 and g3 open.
        await wSeed({ data: { runId, games: slate(Date.now() + 24 * HOUR, { g2: { status: 'CANCELLED' } }) }, auth: superAdmin } as never);
        await wJoin({ data: { poolId, runId, members: [{ uid: CAROL, name: 'Carol' }, { uid: DAVE, name: 'Dave' }] }, auth: superAdmin } as never);
        // Dave had already weighted the game that was then cancelled.
        await seedEntry(poolId, DAVE, { [g(1)]: 'SEA', [g(2)]: 'PIT', [g(3)]: 'KC' }, { [g(1)]: 14, [g(2)]: 16, [g(3)]: 15 });
    }, 30000);

    it('#19 the cancelled game leaves Carol\'s slate: two games, range 15..16; a weight on it is refused', async () => {
        await wSubmit({
            data: { poolId, runId, subjectUid: CAROL, week: 1, picks: { [g(1)]: 'SEA', [g(3)]: 'KC' }, confidence: { [g(1)]: 16, [g(3)]: 15 } },
            auth: superAdmin,
        } as never);
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: CAROL, week: 1, picks: { [g(1)]: 'SEA', [g(3)]: 'KC' }, confidence: { [g(1)]: 14, [g(3)]: 15 } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/OUT_OF_RANGE_CONFIDENCE/);
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: CAROL, week: 1, picks: { [g(1)]: 'SEA', [g(3)]: 'KC' }, confidence: { [g(1)]: 16, [g(2)]: 14, [g(3)]: 15 } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/not in play/);
    }, 30000);

    it('#20 Dave\'s 16 on the cancelled game stays frozen; he can still re-rank the open two around it', async () => {
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: DAVE, week: 1, picks: { [g(1)]: 'SEA', [g(3)]: 'KC' }, confidence: { [g(1)]: 16, [g(2)]: 14, [g(3)]: 15 } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/CONFIDENCE_LOCKED/);
        await wSubmit({
            data: { poolId, runId, subjectUid: DAVE, week: 1, picks: { [g(1)]: 'NE', [g(3)]: 'DEN' }, confidence: { [g(1)]: 15, [g(3)]: 14 } },
            auth: superAdmin,
        } as never);
        const e = await entry(poolId, DAVE);
        expect(e.confidence).toEqual({ [g(1)]: 15, [g(2)]: 16, [g(3)]: 14 });
    }, 30000);

    it('cleans up', async () => {
        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
    }, 60000);
});

describe('T8 #8 / #17 — backfillConfidenceLockMode stamps every legacy confidence pool, pages, and is idempotent', () => {
    const runId = 'run-cpg-backfill';
    const ids = ['a-pergame', 'b-absent', 'c-weekly', 'd-straight'].map((s) => `pool-${runId}-${s}`);

    beforeAll(async () => {
        await seedAdmin();
        await wStart({ data: { runId, scenarioId: 'cpg-backfill' }, auth: superAdmin } as never);
        await seedPool(ids[0], runId, { confidenceMode: true, lockMode: 'PER_GAME' });
        await seedPool(ids[1], runId, { confidenceMode: true });
        await seedPool(ids[2], runId, { confidenceMode: true, lockMode: 'WEEKLY', lockRevision: 3 });
        await seedPool(ids[3], runId, { confidenceMode: false, lockMode: 'PER_GAME' });
    }, 30000);

    const mine = (r: any) => (r.plannedWrites as any[]).filter((w) => ids.includes(w.poolId));

    it('dry run lists the THREE confidence pools with their stored lock mode, writes nothing', async () => {
        const r: any = await wBackfill({ data: { dryRun: true, limit: 200 }, auth: superAdmin } as never);
        const planned = mine(r);
        expect(planned.map((w) => w.poolId).sort()).toEqual([ids[0], ids[1], ids[2]].sort());
        expect(planned.find((w) => w.poolId === ids[0]).storedLockMode).toBe('PER_GAME');
        expect(planned.find((w) => w.poolId === ids[1]).storedLockMode).toBeNull();
        expect(planned.find((w) => w.poolId === ids[2]).storedLockMode).toBe('WEEKLY');
        for (const id of ids) {
            expect((await db.collection('pools').doc(id).get()).data()!.settings.lockRuleVersion).toBeUndefined();
        }
    }, 30000);

    it('#17 pages: limit 2 returns a cursor and the second page finishes', async () => {
        // Other tests' pools may be in the collection; what matters is the
        // cursor contract: a full page carries one, and following it terminates.
        let cursor: string | null = null;
        let pages = 0;
        let scanned = 0;
        do {
            const r: any = await wBackfill({ data: { dryRun: true, limit: 2, ...(cursor ? { startAfter: cursor } : {}) }, auth: superAdmin } as never);
            scanned += r.poolsScanned;
            cursor = r.nextCursor;
            pages++;
        } while (cursor && pages < 50);
        expect(pages).toBeGreaterThan(1);
        expect(scanned).toBeGreaterThanOrEqual(4);
    }, 60000);

    it('live run stamps all three (lockMode WEEKLY, a no-op on the third), bumps lockRevision, leaves the straight pool alone', async () => {
        const r: any = await wBackfill({ data: { dryRun: false, limit: 200 }, auth: superAdmin } as never);
        expect(mine(r)).toHaveLength(3);
        for (const id of [ids[0], ids[1], ids[2]]) {
            const s = (await db.collection('pools').doc(id).get()).data()!.settings;
            expect(s.lockMode).toBe('WEEKLY');
            expect(s.lockRuleVersion).toBe(2);
        }
        expect((await db.collection('pools').doc(ids[2]).get()).data()!.settings.lockRevision).toBe(4);
        const straight = (await db.collection('pools').doc(ids[3]).get()).data()!.settings;
        expect(straight.lockMode).toBe('PER_GAME');
        expect(straight.lockRuleVersion).toBeUndefined();
    }, 30000);

    it('a second live run changes nothing', async () => {
        const r: any = await wBackfill({ data: { dryRun: false, limit: 200 }, auth: superAdmin } as never);
        expect(mine(r)).toHaveLength(0);
    }, 30000);

    it('cleans up', async () => {
        for (const id of ids) await db.collection('pools').doc(id).delete();
    }, 30000);
});

describe('T8 #14 — createNFLPool stamps a new Pick\'em pool (codex r1 #4)', () => {
    it('a wizard-created confidence pool carries lockRuleVersion 2 and therefore plays its stored lockMode', async () => {
        await seedAdmin();
        const res: any = await wCreate({
            data: {
                type: 'NFL_PICKEM', name: 'Stamp test', season: 2026, seasonType: 2,
                settings: { entryFee: 0, confidenceMode: true, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', payoutMode: 'SEASON', payouts: { places: [], bonuses: [] } },
            },
            auth: superAdmin,
        } as never);
        const poolId = res?.poolId ?? res?.id;
        expect(typeof poolId).toBe('string');
        const doc = (await db.collection('pools').doc(poolId).get()).data()!;
        expect(doc.settings.lockRuleVersion).toBe(2);
        expect(doc.settings.lockMode).toBe('PER_GAME');
        await db.collection('pools').doc(poolId).delete();
    }, 60000);
});
