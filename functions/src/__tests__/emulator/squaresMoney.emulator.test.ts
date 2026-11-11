import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { Transaction } from 'firebase-admin/firestore';
import { fixPoolScores, simulateGameUpdate, syncGameStatus } from '../../scoreUpdates';
import { lockPool } from '../../poolParams';
import { toggleWinnerPaid } from '../../poolOps';
import { drawSquaresFinalPrize, recomputeSquaresWinners, unlockSquaresPool } from '../../squaresAdmin';
import { describeWinnerDrift, finalScoresOf, planWinnerWrites } from '../../shared/squaresWinnerPlan';

/**
 * SQUARES — MONEY AND LOCK, against the emulator (PLAN-SQUARES-REOPEN PR-B).
 *
 * These drive the REAL callables. `simulateGameUpdate` runs the same
 * `processGameUpdate` the scheduled ESPN sync runs, so a winner record asserted
 * here is the record a live pool would get.
 *
 * THE GRID. Numbers are 0–9 in order on both sides, and square N is owned by
 * `P{N}`, so away 3 / home 7 wins square 37 — every expectation is readable
 * without a lookup. A full grid at $10 is a $1,000 pot.
 */
const test = ftest();
const db = admin.firestore();

const simulate = test.wrap(simulateGameUpdate);
const lock = test.wrap(lockPool);
const unlock = test.wrap(unlockSquaresPool);
const draw = test.wrap(drawSquaresFinalPrize);
const recompute = test.wrap(recomputeSquaresWinners);
const togglePaid = test.wrap(toggleWinnerPaid);

const OWNER = 'owner-1';
const STRANGER = 'stranger-1';
const ADMIN = 'admin-1';
const POOL = 'sq-money';

const owner = { uid: OWNER, token: { role: 'COMMISSIONER', name: 'Olivia Owner' } };
const stranger = { uid: STRANGER, token: { role: 'MEMBER' } };
const superAdmin = { uid: ADMIN, token: { role: 'SUPER_ADMIN' } };

const IDENTITY = { home: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], away: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
const KICKOFF = '2026-11-26T17:30:00.000Z';

type Doc = Record<string, unknown>;
type Square = { id: number; owner: string | null };

const poolRef = () => db.collection('pools').doc(POOL);
const pool = async (): Promise<Doc> => (await poolRef().get()).data() as Doc;

const winners = async (): Promise<Record<string, Doc>> => {
  const snap = await poolRef().collection('winners').get();
  return Object.fromEntries(snap.docs.map((d) => [d.id, d.data() as Doc]));
};

const audits = async (): Promise<Doc[]> =>
  (await poolRef().collection('audit').get()).docs.map((d) => d.data() as Doc);

async function seedPool(over: Doc = {}, unsold: number[] = []) {
  const squares: Square[] = Array.from({ length: 100 }, (_, i) => ({ id: i, owner: `P${i}` }));
  for (const id of unsold) squares[id].owner = null;
  const doc: Doc = {
    id: POOL,
    name: 'Money pool',
    type: 'SQUARES',
    ownerId: OWNER,
    createdByUid: OWNER,
    status: 'ACTIVE',
    createdAt: admin.firestore.Timestamp.now(),
    isLocked: true,
    homeTeam: 'Lions',
    awayTeam: 'Packers',
    costPerSquare: 10,
    payouts: { q1: 20, half: 20, q3: 20, final: 40 },
    numberSets: 1,
    axisNumbers: IDENTITY,
    ruleVariations: {},
    squares,
    scores: { current: { home: 0, away: 0 }, q1: null, half: null, q3: null, final: null, gameStatus: 'pre', startTime: KICKOFF },
    ...over,
  };
  for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k];
  await poolRef().set(doc);
}

/** An ESPN-shaped payload: cumulative period scores, as fetchESPNScores returns them. */
type Line = [home: number, away: number];
function feed(opts: { period: number; state?: 'pre' | 'in' | 'post'; current: Line; q1?: Line; half?: Line; q3?: Line; final?: Line; plays?: Array<{ home: number; away: number; desc?: string }> }) {
  const pair = (l?: Line) => (l ? { home: l[0], away: l[1] } : { home: 0, away: 0 });
  return {
    current: pair(opts.current),
    q1: pair(opts.q1),
    half: pair(opts.half),
    q3: pair(opts.q3),
    final: pair(opts.final ?? opts.current),
    apiTotal: pair(opts.current),
    homeTeamName: 'DET',
    awayTeamName: 'GB',
    gameStatus: opts.state ?? 'in',
    period: opts.period,
    clock: '10:00',
    startTime: KICKOFF,
    scoringPlays: (opts.plays ?? []).map((p, i) => ({ homeScore: p.home, awayScore: p.away, description: p.desc ?? 'Score', id: `play-${i}` })),
  };
}

const sync = (scores: ReturnType<typeof feed>, auth = owner) =>
  simulate({ data: { poolId: POOL, scores }, auth } as never);

/** The game used throughout: 7–3, 14–10, 21–17, 28–24. */
const Q1 = feed({ period: 2, current: [7, 3], q1: [7, 3] });
const HALF = feed({ period: 3, current: [14, 10], q1: [7, 3], half: [14, 10] });
const Q3 = feed({ period: 4, current: [21, 17], q1: [7, 3], half: [14, 10], q3: [21, 17] });
const FINAL = feed({ period: 4, state: 'post', current: [28, 24], q1: [7, 3], half: [14, 10], q3: [21, 17], final: [28, 24] });

beforeEach(async () => {
  for (const col of ['pools', 'users', 'admin_audit', 'system']) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => db.recursiveDelete(d.ref)));
  }
  await db.collection('users').doc(OWNER).set({ role: 'COMMISSIONER' });
  await db.collection('users').doc(STRANGER).set({ role: 'MEMBER' });
  await db.collection('users').doc(ADMIN).set({ role: 'SUPER_ADMIN' });
});

describe('winner records follow the scores', () => {
  it('records each period as it goes final, at its share of the pot', async () => {
    await seedPool();
    await sync(Q1);
    expect(await winners()).toMatchObject({ q1: { squareId: 37, owner: 'P37', amount: 200, homeDigit: 7, awayDigit: 3, isReverse: false } });
    expect(Object.keys(await winners())).toEqual(['q1']);

    await sync(HALF);
    await sync(Q3);
    await sync(FINAL);
    const w = await winners();
    expect(Object.keys(w).sort()).toEqual(['final', 'half', 'q1', 'q3']);
    expect([w.q1.amount, w.half.amount, w.q3.amount, w.final.amount]).toEqual([200, 200, 200, 400]);
    expect([w.half.owner, w.q3.owner, w.final.owner]).toEqual(['P4', 'P71', 'P48']);
  });

  it('a second pass over the same scores writes nothing', async () => {
    await seedPool();
    await sync(Q1);
    const before = (await poolRef().collection('winners').doc('q1').get()).updateTime!.toMillis();
    const auditsBefore = (await audits()).length;
    await sync(Q1);
    await sync(Q1);
    expect((await poolRef().collection('winners').doc('q1').get()).updateTime!.toMillis()).toBe(before);
    expect((await audits()).length).toBe(auditsBefore);
  });

  it('M1 — charity comes off the pot before any prize is recorded', async () => {
    await seedPool({ charity: { enabled: true, percentage: 10 } });
    await sync(FINAL);
    const w = await winners();
    expect([w.q1.amount, w.half.amount, w.q3.amount, w.final.amount]).toEqual([180, 180, 180, 360]);
  });

  it('M2 — reverse winners on, both digits the same: one record, the whole prize', async () => {
    await seedPool({ ruleVariations: { reverseWinners: true } });
    await sync(feed({ period: 2, current: [24, 14], q1: [24, 14] }));
    const w = await winners();
    expect(Object.keys(w)).toEqual(['q1']);
    expect(w.q1).toMatchObject({ owner: 'P44', amount: 200 });
  });

  it('reverse winners on, two squares: each is recorded at half', async () => {
    await seedPool({ ruleVariations: { reverseWinners: true } });
    await sync(Q1);
    const w = await winners();
    expect(w.q1).toMatchObject({ squareId: 37, owner: 'P37', amount: 100, isReverse: false });
    expect(w.q1_reverse).toMatchObject({ squareId: 73, owner: 'P73', amount: 100, isReverse: true, homeDigit: 3, awayDigit: 7 });
  });

  it('M3 — rollover ON: an unsold square moves its prize to the next period', async () => {
    await seedPool({ ruleVariations: { quarterlyRollover: true } }, [37]);
    await sync(Q1);
    expect((await winners()).q1).toMatchObject({ owner: 'Rollover', amount: 0, isRollover: true });
    await sync(HALF);
    // 99 sold → $990: 198 rolled + 198 of its own.
    expect((await winners()).half).toMatchObject({ owner: 'P4', amount: 396 });
  });

  it('M3 — rollover OFF: an unsold square is recorded Unsold with its prize, and nothing moves', async () => {
    await seedPool({}, [37]);
    await sync(HALF);
    const w = await winners();
    expect(w.q1).toMatchObject({ owner: 'Unsold', amount: 198, isRollover: false });
    expect(w.half.amount).toBe(198);
  });

  it('M3 — the final square unsold: the money goes to the last player who won', async () => {
    await seedPool({ ruleVariations: { quarterlyRollover: true } }, [48]);
    await sync(FINAL);
    const w = await winners();
    expect(w.final).toMatchObject({ owner: 'Rollover', amount: 0 });
    expect(w.final_rollover).toMatchObject({ owner: 'P71', squareId: 71, amount: 396, isRollover: false });
  });

  it('M6 — a period that went final before a winner could be computed is healed on the next pass', async () => {
    // The state the old code left behind for good: q1 on the pool, no record.
    await seedPool({ scores: { current: { home: 7, away: 3 }, q1: { home: 7, away: 3 }, half: null, q3: null, final: null, gameStatus: 'in', period: 2, startTime: KICKOFF } });
    expect(await winners()).toEqual({});
    await sync(HALF);
    const w = await winners();
    expect(w.q1).toMatchObject({ owner: 'P37', amount: 200 });
    expect(w.half).toMatchObject({ owner: 'P4', amount: 200 });
  });

  it('four sets of numbers: each period is paid on its own set', async () => {
    const shifted = (n: number) => ({ home: IDENTITY.home.map((d) => (d + n) % 10), away: IDENTITY.away });
    await seedPool({ numberSets: 4, axisNumbers: shifted(4), quarterlyNumbers: { q1: shifted(1), q2: shifted(2), q3: shifted(3), q4: shifted(4) } });
    await sync(FINAL);
    const w = await winners();
    // Home digit d sits at column (d - n) mod 10 on the set shifted by n.
    expect(w.q1.squareId).toBe(36);     // 7–3 on q1: row 3, col 6
    expect(w.half.squareId).toBe(2);    // 14–10 on q2: row 0, col 2
    expect(w.q3.squareId).toBe(78);     // 21–17 on q3: row 7, col 8
    expect(w.final.squareId).toBe(44);  // 28–24 on q4: row 4, col 4
  });
});

describe('D12 — what is on record is not re-decided by the grid', () => {
  it('a name put on an unsold winning square afterwards does not win it', async () => {
    await seedPool({}, [37]);
    await sync(Q1);
    expect((await winners()).q1.owner).toBe('Unsold');

    const squares = (await pool()).squares as Square[];
    squares[37].owner = 'Latecomer';
    await poolRef().update({ squares });
    await sync(HALF);
    expect((await winners()).q1).toMatchObject({ owner: 'Unsold', squareId: 37 });
  });

  it('"paid" survives a recompute while the winner is unchanged', async () => {
    await seedPool();
    await sync(Q1);
    await togglePaid({ data: { poolId: POOL, winnerId: 'q1' }, auth: owner } as never);
    await sync(HALF);
    await sync(FINAL);
    expect((await winners()).q1).toMatchObject({ owner: 'P37', isPaid: true, paidByUid: OWNER });
  });

  it('a corrected score moves the win, clears "paid", and says so loudly', async () => {
    await seedPool();
    await sync(Q1);
    await togglePaid({ data: { poolId: POOL, winnerId: 'q1' }, auth: owner } as never);

    // At the final whistle the feed restates the first quarter as 8–3.
    await sync(feed({ period: 4, state: 'post', current: [28, 24], q1: [8, 3], half: [14, 10], q3: [21, 17], final: [28, 24] }));
    const q1 = (await winners()).q1;
    expect(q1).toMatchObject({ squareId: 38, owner: 'P38', isPaid: false, paidByUid: null });
    const loud = (await audits()).filter((a) => a.severity === 'CRITICAL');
    expect(loud).toHaveLength(1);
    expect(String(loud[0].message)).toMatch(/P37 → P38/);
    expect(String(loud[0].message)).toMatch(/marked PAID/);
  });

  it('a record the rules no longer call for is removed', async () => {
    await seedPool({ ruleVariations: { reverseWinners: true } });
    await sync(Q1);
    expect(Object.keys(await winners()).sort()).toEqual(['q1', 'q1_reverse']);
    await poolRef().update({ 'ruleVariations.reverseWinners': false });
    await sync(HALF);
    const w = await winners();
    expect(Object.keys(w).sort()).toEqual(['half', 'q1']);
    expect(w.q1.amount).toBe(200);
  });
});

describe('a pool played under the OLD rules is history — its records are never recomputed', () => {
  // Squares creation was closed from 2026-08-28; anything older than the reopen is a finished game.
  const OLD = { createdAt: admin.firestore.Timestamp.fromDate(new Date('2026-02-08T12:00:00Z')), charity: { enabled: true, percentage: 10 } };
  // What the old code recorded: the prize on the GROSS pot ($200, not $180).
  const asPaid = { period: 'q1', squareId: 37, owner: 'P37', amount: 200, homeDigit: 7, awayDigit: 3, isReverse: false, description: 'Q1 Winner', isPaid: true };

  it('a score pass changes no record and adds none', async () => {
    await seedPool(OLD);
    await poolRef().collection('winners').doc('q1').set(asPaid);
    await sync(FINAL);
    expect(await winners()).toEqual({ q1: asPaid });
    expect((await audits()).filter((a) => a.type === 'WINNER_COMPUTED')).toEqual([]);
  });

  it('…while the scores themselves still update', async () => {
    await seedPool(OLD);
    await sync(FINAL);
    expect(((await pool()).scores as Doc).final).toEqual({ home: 28, away: 24 });
  });

  it('recomputeSquaresWinners refuses it and touches nothing', async () => {
    await seedPool({ ...OLD, scores: { current: { home: 7, away: 3 }, q1: { home: 7, away: 3 }, half: null, q3: null, final: null, gameStatus: 'post', startTime: KICKOFF } });
    await poolRef().collection('winners').doc('q1').set(asPaid);
    await expect(recompute({ data: { poolId: POOL }, auth: owner } as never)).rejects.toThrow(/previous payout rules/i);
    expect(await winners()).toEqual({ q1: asPaid });
  });

  it('drawSquaresFinalPrize refuses it', async () => {
    await seedPool({ ...OLD, ruleVariations: { quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' } }, [48]);
    await sync(FINAL);
    await expect(draw({ data: { poolId: POOL }, auth: owner } as never)).rejects.toThrow(/previous payout rules/i);
    expect(await winners()).toEqual({});
  });

  it('a pool with no readable creation time is treated as old, not as new', async () => {
    await seedPool({ createdAt: undefined });
    await sync(FINAL);
    expect(await winners()).toEqual({});
  });
});

describe('score history', () => {
  it('M5 — a touchdown and its extra point in one sync are BOTH recorded', async () => {
    await seedPool();
    await sync(feed({ period: 1, current: [7, 0], plays: [{ home: 7, away: 0, desc: 'Touchdown' }] }));
    const events = (await pool()).scoreEvents as Array<{ home: number; away: number }>;
    expect(events.map((e) => `${e.home}-${e.away}`).sort()).toEqual(['6-0', '7-0']);
  });
});

describe('Every Score Pays', () => {
  const plays = [
    { home: 3, away: 0, desc: 'Field Goal' },
    { home: 3, away: 3, desc: 'Field Goal' },
    { home: 6, away: 3, desc: 'Field Goal' },
    { home: 9, away: 3, desc: 'Field Goal' },
  ];
  const endOfGame = feed({ period: 4, state: 'post', current: [9, 3], q1: [3, 0], half: [3, 3], q3: [6, 3], final: [9, 3], plays });

  it('equal split: no period record, every event an equal share of the whole pot', async () => {
    await seedPool({ ruleVariations: { scoreChangePayout: true, scoreChangePayoutStrategy: 'equal_split', combineTDandXP: true } });
    await sync(endOfGame);
    const w = await winners();
    expect(Object.keys(w).sort()).toEqual(['event_3_0', 'event_3_3', 'event_6_3', 'event_9_3']);
    expect(Object.values(w).map((x) => x.amount)).toEqual([250, 250, 250, 250]);
  });

  it('M4 — an unsold event rolls to the next event a player won', async () => {
    // 3–3 wins square 33; leave it unsold. 99 sold → $990 → 247.50 each.
    await seedPool({ ruleVariations: { scoreChangePayout: true, scoreChangePayoutStrategy: 'equal_split', combineTDandXP: true } }, [33]);
    await sync(endOfGame);
    const w = await winners();
    expect(w.event_3_3).toMatchObject({ owner: 'Unsold', amount: 0 });
    expect(w.event_6_3.amount).toBe(495);
    expect([w.event_3_0.amount, w.event_9_3.amount]).toEqual([247.5, 247.5]);
  });

  it('an UNSET strategy pays 20 / 40 to halftime and final and only the remaining 40% to events', async () => {
    await seedPool({ ruleVariations: { scoreChangePayout: true, combineTDandXP: true } });
    await sync(endOfGame);
    const w = await winners();
    expect(w.half.amount).toBe(200);
    expect(w.final.amount).toBe(400);
    expect(w.q1).toBeUndefined();
    const events = Object.entries(w).filter(([id]) => id.startsWith('event_')).map(([, d]) => d.amount as number);
    expect(events).toEqual([100, 100, 100, 100]);
    // The whole pot, once — the old code paid 60% to periods AND 100% to events.
    const total = Object.values(w).reduce((n, d) => n + (d.amount as number), 0);
    expect(total).toBe(1000);
  });

  it('re-processing a finished game does not zero the event prizes', async () => {
    await seedPool({ ruleVariations: { scoreChangePayout: true, scoreChangePayoutStrategy: 'equal_split', combineTDandXP: true } });
    await sync(endOfGame);
    // What "Fix Sync" does: wind the stored score back and run the same feed again.
    await poolRef().update({ 'scores.current': { home: 0, away: 0 }, 'scores.q1': null, 'scores.half': null, 'scores.q3': null, 'scores.final': null, scoreEvents: [] });
    await sync(endOfGame);
    expect(Object.values(await winners()).map((x) => x.amount)).toEqual([250, 250, 250, 250]);
  });
});

describe('Every Score Pays — what is on record survives a re-sync', () => {
  const plays = [
    { home: 3, away: 0, desc: 'Field Goal' },
    { home: 3, away: 3, desc: 'Field Goal' },
    { home: 6, away: 3, desc: 'Field Goal' },
    { home: 9, away: 3, desc: 'Field Goal' },
  ];
  const endOfGame = feed({ period: 4, state: 'post', current: [9, 3], q1: [3, 0], half: [3, 3], q3: [6, 3], final: [9, 3], plays });

  it('re-processing a finished game does not re-decide who won an event', async () => {
    await seedPool({ ruleVariations: { scoreChangePayout: true, scoreChangePayoutStrategy: 'equal_split', combineTDandXP: true } }, [33]);
    await sync(endOfGame);
    expect((await winners()).event_3_3.owner).toBe('Unsold');

    // Square 33 is taken AFTER the game, then the game is replayed ("Fix Sync").
    const squares = (await pool()).squares as Square[];
    squares[33].owner = 'Latecomer';
    await poolRef().update({ squares, 'scores.current': { home: 0, away: 0 }, 'scores.q1': null, 'scores.half': null, 'scores.q3': null, 'scores.final': null, scoreEvents: [] });
    await sync(endOfGame);

    const w = await winners();
    expect(w.event_3_3).toMatchObject({ owner: 'Unsold', amount: 0 });
    // 100 sold now → $250 a share; the unsold 3–3 share still rolls to 6–3.
    expect(w.event_6_3.amount).toBe(500);
  });
});

describe('the scheduled ESPN sync', () => {
  /** ESPN's summary payload, cut down to what fetchESPNScores reads: Lions 7, Packers 3, second quarter. */
  const espnSummary = {
    header: {
      competitions: [{
        date: KICKOFF,
        status: { type: { state: 'in' }, period: 2, displayClock: '10:00' },
        competitors: [
          { homeAway: 'home', score: '7', linescores: [{ value: 7 }], team: { abbreviation: 'DET' } },
          { homeAway: 'away', score: '3', linescores: [{ value: 3 }], team: { abbreviation: 'GB' } },
        ],
      }],
    },
    scoringPlays: [],
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => espnSummary }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const runSync = () => (syncGameStatus as unknown as { run: (event: unknown) => Promise<unknown> }).run({ scheduleTime: new Date().toISOString() });

  it('scores a linked pool and records its winner', async () => {
    await seedPool({ gameId: '401772900' });
    await runSync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(((await pool()).scores as Doc).q1).toEqual({ home: 7, away: 3 });
    expect((await winners()).q1).toMatchObject({ owner: 'P37', amount: 200 });
  });

  it('leaves a pool on Manual Score Override alone — its scores are the commissioner\'s', async () => {
    const typed = { current: { home: 10, away: 0 }, q1: { home: 10, away: 0 }, half: null, q3: null, final: null, gameStatus: 'in', startTime: KICKOFF };
    await seedPool({ gameId: '401772900', manualScoreOverride: true, scores: typed });
    await runSync();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await pool()).scores).toEqual(typed);
    expect(await winners()).toEqual({});
  });
});

describe('recomputeSquaresWinners — scores entered by hand', () => {
  const manual = { current: { home: 14, away: 10 }, q1: { home: 7, away: 3 }, half: { home: 14, away: 10 }, q3: null, final: null, gameStatus: 'in', startTime: KICKOFF };

  it('creates the records the sync would have, so "Mark Paid" has something to mark', async () => {
    await seedPool({ scores: manual });
    await expect(togglePaid({ data: { poolId: POOL, winnerId: 'q1' }, auth: owner } as never)).rejects.toThrow(/not found/i);

    const res = await recompute({ data: { poolId: POOL }, auth: owner } as never);
    expect(res).toMatchObject({ success: true, changed: 2 });
    const w = await winners();
    expect(w.q1).toMatchObject({ owner: 'P37', amount: 200 });
    expect(w.half).toMatchObject({ owner: 'P4', amount: 200 });
    await expect(togglePaid({ data: { poolId: POOL, winnerId: 'q1' }, auth: owner } as never)).resolves.toMatchObject({ isPaid: true });
  });

  it('removes a record when the commissioner switches that period back off', async () => {
    await seedPool({ scores: manual });
    await recompute({ data: { poolId: POOL }, auth: owner } as never);
    await poolRef().update({ 'scores.half': null });
    await recompute({ data: { poolId: POOL }, auth: owner } as never);
    expect(Object.keys(await winners())).toEqual(['q1']);
  });

  it('does nothing on a grid with no numbers — and deletes nothing either', async () => {
    await seedPool({ scores: manual, axisNumbers: undefined });
    await poolRef().collection('winners').doc('q1').set({ period: 'q1', squareId: 37, owner: 'P37', amount: 200 });
    await expect(recompute({ data: { poolId: POOL }, auth: owner } as never)).resolves.toMatchObject({ changed: 0 });
    expect(Object.keys(await winners())).toEqual(['q1']);
  });

  it('ATTACK: someone who does not run the pool is refused', async () => {
    await seedPool({ scores: manual });
    await expect(recompute({ data: { poolId: POOL }, auth: stranger } as never)).rejects.toThrow(/permission/i);
    expect(await winners()).toEqual({});
  });

  it('refuses a pool that is not squares', async () => {
    await seedPool({ type: 'PROPS', scores: manual });
    await expect(recompute({ data: { poolId: POOL }, auth: owner } as never)).rejects.toThrow(/not a squares pool/i);
  });
});

describe('lockPool — the numbers are drawn once', () => {
  const isPermutation = (a: unknown) => Array.isArray(a) && a.length === 10 && [...a].sort((x, y) => x - y).join('') === '0123456789';
  const unlocked = { isLocked: false, axisNumbers: undefined, scores: { current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre' } };

  it('the first lock draws a full set of numbers and locks the grid', async () => {
    await seedPool(unlocked);
    const res = await lock({ data: { poolId: POOL }, auth: owner } as never) as { generated: boolean };
    expect(res.generated).toBe(true);
    const p = await pool();
    expect(p.isLocked).toBe(true);
    const axis = p.axisNumbers as { home: number[]; away: number[] };
    expect(isPermutation(axis.home) && isPermutation(axis.away)).toBe(true);
    expect((await audits()).map((a) => a.type).sort()).toEqual(['DIGITS_GENERATED', 'POOL_LOCKED']);
  });

  it('L1 — locking again keeps the SAME numbers, however many times', async () => {
    await seedPool(unlocked);
    await lock({ data: { poolId: POOL }, auth: owner } as never);
    const first = (await pool()).axisNumbers;
    for (let i = 0; i < 3; i++) {
      // The old admin "unlock" was a bare client write that left the numbers in place.
      await poolRef().update({ isLocked: false });
      const res = await lock({ data: { poolId: POOL }, auth: owner } as never) as { generated: boolean };
      expect(res.generated).toBe(false);
    }
    const p = await pool();
    expect(p.axisNumbers).toEqual(first);
    expect(p.isLocked).toBe(true);
    expect((await audits()).filter((a) => a.type === 'DIGITS_GENERATED')).toHaveLength(1);
  });

  it('two locks at the same moment agree on one set of numbers', async () => {
    await seedPool(unlocked);
    const call = () => lock({ data: { poolId: POOL }, auth: owner } as never) as Promise<{ axisNumbers: unknown }>;
    const [a, b] = await Promise.all([call(), call()]);
    expect(a.axisNumbers).toEqual(b.axisNumbers);
    expect((await pool()).axisNumbers).toEqual(a.axisNumbers);
    expect((await audits()).filter((x) => x.type === 'DIGITS_GENERATED')).toHaveLength(1);
  });

  it('a grid never locked before kickoff can still be given numbers mid-game', async () => {
    await seedPool({ ...unlocked, scores: { current: { home: 7, away: 3 }, q1: { home: 7, away: 3 }, half: null, q3: null, final: null, gameStatus: 'in', startTime: KICKOFF } });
    const res = await lock({ data: { poolId: POOL }, auth: owner } as never) as { generated: boolean };
    expect(res.generated).toBe(true);
  });

  it('four sets: the first set is also the first-quarter set', async () => {
    await seedPool({ ...unlocked, numberSets: 4 });
    await lock({ data: { poolId: POOL }, auth: owner } as never);
    const p = await pool();
    expect((p.quarterlyNumbers as Doc).q1).toEqual(p.axisNumbers);
  });

  it('ATTACK: an owner asking for the fixed test numbers gets a real draw', async () => {
    // 0–9 in order is the simulator's deterministic grid. Open to an owner, it let
    // them buy the best squares for known numbers and then lock with those numbers.
    for (let i = 0; i < 3; i++) {
      await seedPool(unlocked);
      await lock({ data: { poolId: POOL, forceAxis: true }, auth: owner } as never);
      if (JSON.stringify((await pool()).axisNumbers) !== JSON.stringify(IDENTITY)) return;
    }
    throw new Error('three locks in a row produced 0–9 in order — forceAxis is being honoured for an owner');
  });

  it('a confirmed SUPER_ADMIN still gets the fixed numbers the simulators need', async () => {
    await seedPool(unlocked);
    await lock({ data: { poolId: POOL, forceAxis: true }, auth: superAdmin } as never);
    expect((await pool()).axisNumbers).toEqual(IDENTITY);
  });

  it('ATTACK: someone who does not run the pool cannot lock it', async () => {
    await seedPool(unlocked);
    await expect(lock({ data: { poolId: POOL }, auth: stranger } as never)).rejects.toThrow(/permission/i);
    expect((await pool()).isLocked).toBe(false);
  });

  it('a BRACKET pool locks exactly as it always did — no numbers, status LOCKED', async () => {
    await seedPool({ ...unlocked, type: 'BRACKET', status: 'ACTIVE' });
    await expect(lock({ data: { poolId: POOL }, auth: owner } as never)).resolves.toEqual({ success: true });
    const p = await pool();
    expect(p).toMatchObject({ isLocked: true, status: 'LOCKED' });
    expect(p.axisNumbers).toBeUndefined();
    expect(p.lockGrid).toBeUndefined();
    expect((await audits()).map((a) => a.type)).toEqual(['POOL_LOCKED']);
  });

  it('a PROPS pool locks exactly as it always did — isLocked and nothing else', async () => {
    await seedPool({ ...unlocked, type: 'PROPS', status: 'ACTIVE' });
    await expect(lock({ data: { poolId: POOL }, auth: owner } as never)).resolves.toEqual({ success: true });
    const p = await pool();
    expect(p).toMatchObject({ isLocked: true, status: 'ACTIVE' });
    expect(p.axisNumbers).toBeUndefined();
  });
});

describe('unlockSquaresPool — reopening sales discards the numbers', () => {
  const pregame = { scores: { current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre', startTime: new Date(Date.now() + 3 * 3600_000).toISOString() } };

  it('before kickoff: the grid reopens and the numbers are gone', async () => {
    await seedPool({ ...pregame, numberSets: 4, quarterlyNumbers: { q1: IDENTITY } });
    await expect(unlock({ data: { poolId: POOL }, auth: owner } as never)).resolves.toEqual({ success: true, numbersDiscarded: true });
    const p = await pool();
    expect(p.isLocked).toBe(false);
    expect(p.axisNumbers).toBeUndefined();
    expect(p.quarterlyNumbers).toBeUndefined();
    const a = await audits();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ type: 'POOL_UNLOCKED', severity: 'WARNING' });
  });

  it('…and the next lock draws new ones', async () => {
    await seedPool(pregame);
    await unlock({ data: { poolId: POOL }, auth: owner } as never);
    const res = await lock({ data: { poolId: POOL }, auth: owner } as never) as { generated: boolean };
    expect(res.generated).toBe(true);
  });

  const started: Array<[string, Doc, Doc?]> = [
    ['the feed says the game is in progress', { gameStatus: 'in', startTime: pregame.scores.startTime }],
    ['the game is over', { gameStatus: 'post', startTime: pregame.scores.startTime }],
    ['a period score has been entered by hand', { gameStatus: 'pre', q1: { home: 0, away: 0 }, startTime: pregame.scores.startTime }],
    ['points are on the board', { gameStatus: 'pre', current: { home: 3, away: 0 }, startTime: pregame.scores.startTime }],
    ['the scheduled kickoff has passed, even though the feed still says "pre"', { gameStatus: 'pre', startTime: new Date(Date.now() - 60_000).toISOString() }],
    // qodo #765, finding 2: under Manual Score Override the commissioner typed
    // "not started, kickoff tomorrow" after kickoff. The pool's gameTime — which
    // only the server writes — still says the game has started.
    ['the pool\'s server-owned kickoff has passed, though the scores were typed back to "not started"', { gameStatus: 'pre', startTime: pregame.scores.startTime }, { gameTime: Date.now() - 60_000, manualScoreOverride: true }],
  ];
  for (const [why, scores, extra] of started) {
    it(`REFUSED once ${why} — and the numbers stay`, async () => {
      await seedPool({ scores: { current: null, q1: null, half: null, q3: null, final: null, ...scores }, ...(extra ?? {}) });
      await expect(unlock({ data: { poolId: POOL }, auth: owner } as never)).rejects.toThrow(/game has started/i);
      const p = await pool();
      expect(p.isLocked).toBe(true);
      expect(p.axisNumbers).toEqual(IDENTITY);
    });
  }

  it('ATTACK: someone who does not run the pool is refused', async () => {
    await seedPool(pregame);
    await expect(unlock({ data: { poolId: POOL }, auth: stranger } as never)).rejects.toThrow(/permission/i);
    expect((await pool()).axisNumbers).toEqual(IDENTITY);
  });

  it('refuses a pool that is not squares', async () => {
    await seedPool({ ...pregame, type: 'BRACKET' });
    await expect(unlock({ data: { poolId: POOL }, auth: owner } as never)).rejects.toThrow(/not a squares pool/i);
    expect((await pool()).isLocked).toBe(true);
  });
});

describe('drawSquaresFinalPrize — the random draw happens once, on the server', () => {
  const randomRules = { ruleVariations: { quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' } };

  it('the unclaimed final prize waits for the draw', async () => {
    await seedPool(randomRules, [48]);
    await sync(FINAL);
    expect((await winners()).final_rollover).toMatchObject({ owner: 'Rollover', amount: 396, isRollover: true });
  });

  it('draws a SOLD square, records who and how, and mirrors it on the pool', async () => {
    // Only three squares sold besides the game's winners, so an unsold pick would show.
    const unsold = Array.from({ length: 100 }, (_, i) => i).filter((i) => ![37, 4, 71, 11, 22].includes(i));
    await seedPool(randomRules, unsold);
    await sync(FINAL);
    const res = await draw({ data: { poolId: POOL }, auth: owner } as never) as { squareId: number; owner: string; amount: number };
    expect([37, 4, 71, 11, 22]).toContain(res.squareId);
    expect(res.owner).toBe(`P${res.squareId}`);
    // 5 sold → $50: the final's 40% = $20, unclaimed.
    expect(res.amount).toBe(20);

    const rec = (await winners()).final_rollover;
    expect(rec).toMatchObject({ owner: res.owner, squareId: res.squareId, amount: 20, isRollover: false, drawnByUid: OWNER, drawnFrom: 5 });
    expect(rec.drawnAt).toBeTruthy();
    expect((await pool()).randomWinner).toMatchObject({ squareId: res.squareId, owner: res.owner, amount: 20 });
    expect((await audits()).some((a) => /random draw/.test(String(a.message)))).toBe(true);
  });

  it('ATTACK: it cannot be drawn twice', async () => {
    await seedPool(randomRules, [48]);
    await sync(FINAL);
    const first = await draw({ data: { poolId: POOL }, auth: owner } as never) as { squareId: number };
    for (let i = 0; i < 5; i++) {
      await expect(draw({ data: { poolId: POOL }, auth: owner } as never)).rejects.toThrow(/already been made/i);
    }
    expect((await winners()).final_rollover.squareId).toBe(first.squareId);
  });

  it('a later score pass keeps the drawn winner', async () => {
    await seedPool(randomRules, [48]);
    await sync(FINAL);
    const res = await draw({ data: { poolId: POOL }, auth: owner } as never) as { squareId: number; owner: string };
    await sync(FINAL);
    await recompute({ data: { poolId: POOL }, auth: owner } as never);
    expect((await winners()).final_rollover).toMatchObject({ owner: res.owner, squareId: res.squareId, amount: 396 });
  });

  it('ATTACK: wiping the mirror on the pool does not reopen the draw', async () => {
    // `randomWinner` is commissioner-writable; the old "reset" link cleared it and re-rolled.
    await seedPool(randomRules, [48]);
    await sync(FINAL);
    await draw({ data: { poolId: POOL }, auth: owner } as never);
    await poolRef().update({ randomWinner: admin.firestore.FieldValue.delete() });
    await expect(draw({ data: { poolId: POOL }, auth: owner } as never)).rejects.toThrow(/already been made/i);
  });

  it('refused when the final square was sold — there is nothing to draw for', async () => {
    await seedPool(randomRules);
    await sync(FINAL);
    await expect(draw({ data: { poolId: POOL }, auth: owner } as never)).rejects.toThrow(/no unclaimed final prize/i);
  });

  it('refused before the game is over', async () => {
    await seedPool(randomRules, [48]);
    await sync(Q3);
    await expect(draw({ data: { poolId: POOL }, auth: owner } as never)).rejects.toThrow(/no unclaimed final prize/i);
  });

  it('refused under the last-winner rule — that prize already has an owner', async () => {
    await seedPool({ ruleVariations: { quarterlyRollover: true } }, [48]);
    await sync(FINAL);
    await expect(draw({ data: { poolId: POOL }, auth: owner } as never)).rejects.toThrow(/no unclaimed final prize/i);
    expect((await winners()).final_rollover.owner).toBe('P71');
  });

  it('ATTACK: someone who does not run the pool cannot make the draw', async () => {
    await seedPool(randomRules, [48]);
    await sync(FINAL);
    await expect(draw({ data: { poolId: POOL }, auth: stranger } as never)).rejects.toThrow(/permission/i);
    expect((await winners()).final_rollover.owner).toBe('Rollover');
  });
});

describe('qodo #9 — the draw cannot be undone by taking the final score away', () => {
  const randomRules = { ruleVariations: { quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' } };
  const call = { data: { poolId: POOL }, auth: owner } as never;

  it('ATTACK: final score off, then on again — the drawn winner stands and no second draw is offered', async () => {
    await seedPool(randomRules, [48]);
    await sync(FINAL);
    const first = await draw(call) as { squareId: number; owner: string };

    // The commissioner switches the final score off on the admin page…
    await poolRef().update({ 'scores.final': null });
    await recompute(call);
    const kept = (await winners()).final_rollover;
    expect(kept.drawnAt).toBeTruthy();
    expect(kept).toMatchObject({ drawnOwner: first.owner, drawnSquareId: first.squareId, amount: 0 });
    await expect(draw(call)).rejects.toThrow(/already been made/i);

    // …and back on.
    await poolRef().update({ 'scores.final': { home: 28, away: 24 } });
    await recompute(call);
    expect((await winners()).final_rollover).toMatchObject({ owner: first.owner, squareId: first.squareId, amount: 396 });
    await expect(draw(call)).rejects.toThrow(/already been made/i);
  });

  it('says so loudly when a drawn prize drops to $0', async () => {
    await seedPool(randomRules, [48]);
    await sync(FINAL);
    await draw(call);
    await poolRef().update({ 'scores.final': null });
    await recompute(call);
    const loud = (await audits()).filter((a) => a.severity === 'CRITICAL');
    expect(loud).toHaveLength(1);
    expect(String(loud[0].message)).toMatch(/cannot be made again/);
  });

  it('a draw that has been made STANDS when the rule is changed afterwards', async () => {
    await seedPool(randomRules, [48]);
    await sync(FINAL);
    const first = await draw(call) as { squareId: number; owner: string };

    // "Give it to the last winner" would name P71. The prize has already been
    // awarded, so there is nothing left for the rule to decide.
    await poolRef().update({ 'ruleVariations.unclaimedFinalPrizeStrategy': 'last_winner' });
    await expect(recompute(call)).resolves.toMatchObject({ changed: 0 });
    expect((await winners()).final_rollover).toMatchObject({ owner: first.owner, squareId: first.squareId, amount: 396 });

    await poolRef().update({ 'ruleVariations.unclaimedFinalPrizeStrategy': 'random' });
    await expect(recompute(call)).resolves.toMatchObject({ changed: 0 });
    expect((await winners()).final_rollover).toMatchObject({ owner: first.owner, squareId: first.squareId });
    await expect(draw(call)).rejects.toThrow(/already been made/i);
  });

  it('ATTACK: a drawn prize that was PAID is not put back on the books as unpaid by flipping the rule', async () => {
    // qodo, PR #759 round 3. The flip used to move the prize to the last
    // winner (clearing "paid", which was about the drawn winner) and the flip
    // back returned it to the drawn winner — unpaid, to be handed over again.
    await seedPool(randomRules, [48]);
    await sync(FINAL);
    const first = await draw(call) as { squareId: number; owner: string };
    await togglePaid({ data: { poolId: POOL, winnerId: 'final_rollover', paid: true }, auth: owner } as never);

    await poolRef().update({ 'ruleVariations.unclaimedFinalPrizeStrategy': 'last_winner' });
    await recompute(call);
    await poolRef().update({ 'ruleVariations.unclaimedFinalPrizeStrategy': 'random' });
    await recompute(call);

    expect((await winners()).final_rollover).toMatchObject({ owner: first.owner, isPaid: true, paidAmount: 396 });
    // And nobody else was ever shown as owed it.
    expect((await audits()).filter((a) => /CHANGED/.test(String(a.message)))).toEqual([]);
  });

  it('a pool that never drew still follows the rule (the counter-example)', async () => {
    await seedPool(randomRules, [48]);
    await sync(FINAL);
    await poolRef().update({ 'ruleVariations.unclaimedFinalPrizeStrategy': 'last_winner' });
    await recompute(call);
    expect((await winners()).final_rollover).toMatchObject({ owner: 'P71', amount: 396 });
  });
});

describe('qodo #7 / #8 — marking a prize paid', () => {
  const toggle = (extra: Doc = {}, auth: { uid: string; token: Doc } = owner) => togglePaid({ data: { poolId: POOL, winnerId: 'q1', ...extra }, auth } as never);

  it('records what the prize WAS when it was paid, and keeps that when the prize later changes', async () => {
    await seedPool({}, [0, 1, 2, 3, 5]);         // 95 sold → Q1 prize $190
    await sync(Q1);
    await toggle();
    expect((await winners()).q1).toMatchObject({ isPaid: true, amount: 190, paidAmount: 190 });

    // Five more squares sell; the pot, and so the prize, goes up.
    const squares = (await pool()).squares as Square[];
    for (const id of [0, 1, 2, 3, 5]) squares[id].owner = `Late${id}`;
    await poolRef().update({ squares });
    await sync(HALF);
    expect((await winners()).q1).toMatchObject({ isPaid: true, amount: 200, paidAmount: 190 });
  });

  it('un-marking clears the paid amount', async () => {
    await seedPool();
    await sync(Q1);
    await toggle();
    await toggle();
    expect((await winners()).q1).toMatchObject({ isPaid: false, paidAmount: null, paidByUid: null });
  });

  it('ATTACK: a click meant for a winner that has since changed does not mark the NEW winner paid', async () => {
    await seedPool();
    await sync(Q1);                                // on the page: Q1 → P37
    // The score is corrected before the click lands: Q1 is now P38's.
    await sync(feed({ period: 4, state: 'post', current: [28, 24], q1: [8, 3], half: [14, 10], q3: [21, 17], final: [28, 24] }));
    await expect(toggle({ expectedOwner: 'P37', expectedSquareId: 37 })).rejects.toThrow(/has changed since the page loaded/i);
    const q1 = (await winners()).q1;
    expect(q1.owner).toBe('P38');
    expect(q1.isPaid).not.toBe(true);
  });

  it('ATTACK: either half of what was on the page is enough to catch a changed winner', async () => {
    await seedPool();
    await sync(Q1);
    await sync(feed({ period: 4, state: 'post', current: [28, 24], q1: [8, 3], half: [14, 10], q3: [21, 17], final: [28, 24] }));
    await expect(toggle({ expectedOwner: 'P37' })).rejects.toThrow(/has changed since the page loaded/i);
    await expect(toggle({ expectedSquareId: 37 })).rejects.toThrow(/has changed since the page loaded/i);
    expect((await winners()).q1.isPaid).not.toBe(true);
  });

  it('a click for the winner who IS on record goes through', async () => {
    await seedPool();
    await sync(Q1);
    await expect(toggle({ expectedOwner: 'P37', expectedSquareId: 37 })).resolves.toMatchObject({ isPaid: true });
  });

  it('a page built before this change — no expected winner sent — still works', async () => {
    await seedPool();
    await sync(Q1);
    await expect(toggle()).resolves.toMatchObject({ isPaid: true });
  });

  it('ATTACK: someone who does not run the pool cannot mark a prize paid', async () => {
    await seedPool();
    await sync(Q1);
    await expect(toggle({}, stranger)).rejects.toThrow(/permission/i);
    expect((await winners()).q1.isPaid).toBeUndefined();
  });
});

describe('qodo #2 — Every Score Pays scored by hand is reported, not papered over', () => {
  const byHand = { current: { home: 9, away: 3 }, q1: { home: 3, away: 0 }, half: { home: 3, away: 3 }, q3: { home: 6, away: 3 }, final: { home: 9, away: 3 }, gameStatus: 'post', startTime: KICKOFF };
  const call = { data: { poolId: POOL }, auth: owner } as never;

  it('a finished Every-Score-Pays game with no scoring events says so', async () => {
    await seedPool({ scores: byHand, ruleVariations: { scoreChangePayout: true, scoreChangePayoutStrategy: 'equal_split' } });
    await expect(recompute(call)).resolves.toMatchObject({ success: true, eventsNotRecorded: true });
  });

  it('…and stops saying so once the events exist', async () => {
    await seedPool({ ruleVariations: { scoreChangePayout: true, scoreChangePayoutStrategy: 'equal_split', combineTDandXP: true } });
    await sync(feed({ period: 4, state: 'post', current: [3, 0], q1: [3, 0], half: [3, 0], q3: [3, 0], final: [3, 0], plays: [{ home: 3, away: 0 }] }));
    await expect(recompute(call)).resolves.toMatchObject({ eventsNotRecorded: false });
  });

  it('is never raised on a pool that pays by the quarter, or on a game still going', async () => {
    await seedPool({ scores: byHand });
    await expect(recompute(call)).resolves.toMatchObject({ eventsNotRecorded: false });
    await seedPool({ scores: { ...byHand, final: null, gameStatus: 'in' }, ruleVariations: { scoreChangePayout: true } });
    await expect(recompute(call)).resolves.toMatchObject({ eventsNotRecorded: false });
  });
});

describe('qodo #6 — a SUPER_ADMIN acting on someone else\'s pool leaves a row in admin_audit', () => {
  const pregame = { scores: { current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre', startTime: new Date(Date.now() + 3 * 3600_000).toISOString() } };
  const adminAudit = async () => (await db.collection('admin_audit').get()).docs.map((d) => d.data() as Doc);

  it('unlock by a SUPER_ADMIN who does not run the pool is logged there, with the pool', async () => {
    await seedPool(pregame);
    await unlock({ data: { poolId: POOL }, auth: superAdmin } as never);
    const rows = await adminAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUid: ADMIN, action: 'SQUARES_UNLOCK', targetType: 'pool', targetId: POOL, status: 'success' });
  });

  it('the commissioner\'s own action is NOT — it is in the pool\'s audit trail', async () => {
    await seedPool(pregame);
    await unlock({ data: { poolId: POOL }, auth: owner } as never);
    expect(await adminAudit()).toEqual([]);
    expect((await audits()).map((a) => a.type)).toEqual(['POOL_UNLOCKED']);
  });

  it('a SUPER_ADMIN who runs the pool themselves is its commissioner here, not an outside admin', async () => {
    await seedPool({ ...pregame, ownerId: ADMIN, createdByUid: ADMIN });
    await unlock({ data: { poolId: POOL }, auth: superAdmin } as never);
    expect(await adminAudit()).toEqual([]);
  });

  it('a SUPER_ADMIN making the draw or recording winners is logged too', async () => {
    await seedPool({ ruleVariations: { quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' } }, [48]);
    await sync(FINAL);
    await recompute({ data: { poolId: POOL }, auth: superAdmin } as never);
    await draw({ data: { poolId: POOL }, auth: superAdmin } as never);
    expect((await adminAudit()).map((r) => r.action).sort()).toEqual(['SQUARES_FINAL_PRIZE_DRAW', 'SQUARES_RECOMPUTE_WINNERS']);
  });
});

/**
 * qodo, PR #759 round 3.
 */
describe('qodo r3 — "mark paid" SETS the state it is asked for', () => {
  const setPaid = (paid: boolean | undefined, auth = owner) =>
    togglePaid({ data: { poolId: POOL, winnerId: 'q1', ...(paid === undefined ? {} : { paid }) }, auth } as never);
  const paidAudits = async () => (await audits()).filter((a) => a.type === 'SQUARE_MARKED_PAID');

  it('ATTACK: a second "mark paid" does not un-pay the prize', async () => {
    await seedPool();
    await sync(Q1);
    await expect(setPaid(true)).resolves.toMatchObject({ isPaid: true });
    const first = (await winners()).q1;

    // The double-click, the other tab, the co-manager.
    await expect(setPaid(true)).resolves.toMatchObject({ isPaid: true, unchanged: true });
    const after = (await winners()).q1;
    expect(after.isPaid).toBe(true);
    // When and how much still describe the FIRST time.
    expect(after.paidAt).toEqual(first.paidAt);
    expect(after.paidAmount).toBe(200);
    expect(after.paidByUid).toBe(OWNER);
    // One thing happened, so one line in the trail.
    expect(await paidAudits()).toHaveLength(1);
  });

  it('two "mark paid" requests at once leave it paid', async () => {
    await seedPool();
    await sync(Q1);
    await Promise.all([setPaid(true), setPaid(true)]);
    expect((await winners()).q1).toMatchObject({ isPaid: true, paidAmount: 200 });
    expect(await paidAudits()).toHaveLength(1);
  });

  it('"mark not paid" on a prize that is not paid changes nothing', async () => {
    await seedPool();
    await sync(Q1);
    await expect(setPaid(false)).resolves.toMatchObject({ isPaid: false, unchanged: true });
    expect((await winners()).q1.isPaid).toBeUndefined();
    expect(await paidAudits()).toHaveLength(0);
  });

  it('asking for the other state does change it, both ways', async () => {
    await seedPool();
    await sync(Q1);
    await setPaid(true);
    await expect(setPaid(false)).resolves.toMatchObject({ isPaid: false });
    expect((await winners()).q1).toMatchObject({ isPaid: false, paidAmount: null, paidByUid: null });
    await expect(setPaid(true)).resolves.toMatchObject({ isPaid: true });
    expect(await paidAudits()).toHaveLength(3);
  });

  it('a page built before this change sends no state and still toggles', async () => {
    await seedPool();
    await sync(Q1);
    await expect(setPaid(undefined)).resolves.toMatchObject({ isPaid: true });
    await expect(setPaid(undefined)).resolves.toMatchObject({ isPaid: false });
  });

  it('the stale-winner check still comes first', async () => {
    await seedPool();
    await sync(Q1);
    await expect(
      togglePaid({ data: { poolId: POOL, winnerId: 'q1', paid: true, expectedOwner: 'Somebody else' }, auth: owner } as never),
    ).rejects.toThrow(/has changed since the page loaded/i);
    expect((await winners()).q1.isPaid).toBeUndefined();
  });
});

describe('qodo r3 — "Record winners" records the scores the commissioner was looking at', () => {
  const typed = { current: { home: 7, away: 3 }, q1: { home: 7, away: 3 }, half: null, q3: null, final: null, gameStatus: 'in', startTime: KICKOFF };
  const record = (expectedScores?: Doc) =>
    recompute({ data: { poolId: POOL, ...(expectedScores ? { expectedScores } : {}) }, auth: owner } as never);
  const seen = (q1: [number, number] | null) => ({ q1: q1 ? { home: q1[0], away: q1[1] } : null, half: null, q3: null, final: null });

  it('records when the stored scores are the ones on the page', async () => {
    await seedPool({ scores: typed });
    await expect(record(seen([7, 3]))).resolves.toMatchObject({ success: true, changed: 1 });
    expect((await winners()).q1).toMatchObject({ owner: 'P37' });
  });

  it('ATTACK: the press that beats the save records NOTHING — not the winner for the old score', async () => {
    // Stored: 7–3 (P37). The commissioner has just typed 8–3 (P38) and pressed
    // Record winners before that save landed.
    await seedPool({ scores: typed });
    await expect(record(seen([8, 3]))).rejects.toThrow(/still being saved/i);
    expect(await winners()).toEqual({});

    // The save lands; the same press now goes through, for the right square.
    await poolRef().update({ 'scores.q1': { home: 8, away: 3 }, 'scores.current': { home: 8, away: 3 } });
    await expect(record(seen([8, 3]))).resolves.toMatchObject({ changed: 1 });
    expect((await winners()).q1).toMatchObject({ owner: 'P38', squareId: 38 });
  });

  it.each([
    ['a quarter the page shows that is not stored', seen([7, 3]), { ...typed, q1: null }],
    ['a quarter stored that the page does not show', seen(null), typed],
    ['the home score differs', seen([6, 3]), typed],
    ['the away score differs', seen([7, 4]), typed],
  ])('refused when %s', async (_label, expected, stored) => {
    await seedPool({ scores: stored });
    await expect(record(expected)).rejects.toThrow(/still being saved/i);
    expect(await winners()).toEqual({});
  });

  it('a page built before this change sends no scores and still records', async () => {
    await seedPool({ scores: typed });
    await expect(record()).resolves.toMatchObject({ changed: 1 });
  });
});

describe('qodo r3 — a quarter switched off after its winner was recorded', () => {
  const manual = { current: { home: 14, away: 10 }, q1: { home: 7, away: 3 }, half: { home: 14, away: 10 }, q3: null, final: null, gameStatus: 'in', startTime: KICKOFF };

  it('the page\'s own check sees the record that has to go, and recording removes it', async () => {
    await seedPool({ scores: manual });
    await recompute({ data: { poolId: POOL }, auth: owner } as never);
    await togglePaid({ data: { poolId: POOL, winnerId: 'half', paid: true }, auth: owner } as never);
    await poolRef().update({ 'scores.half': null });

    // What the page runs before it offers the button: the server's planner,
    // on the pool and the records as the page holds them.
    const stored = Object.entries(await winners()).map(([id, data]) => ({ id, data }));
    const p = await pool();
    const drift = describeWinnerDrift(
      planWinnerWrites(p as never, finalScoresOf(p.scores), stored, { gameFinal: false }),
      stored,
    );
    expect(drift).toEqual([{ kind: 'remove', text: 'Halftime Winner — P4 ($200.00)' }]);

    await recompute({ data: { poolId: POOL }, auth: owner } as never);
    expect(Object.keys(await winners())).toEqual(['q1']);
    // It had been marked paid, so removing it is not quiet.
    expect((await audits()).some((a) => a.severity === 'CRITICAL' && /marked PAID/.test(String(a.message)))).toBe(true);
  });
});

describe('qodo r3 — the pause switch', () => {
  const espnSummary = {
    header: {
      competitions: [{
        date: KICKOFF,
        status: { type: { state: 'in' }, period: 2, displayClock: '10:00' },
        competitors: [
          { homeAway: 'home', score: '7', linescores: [{ value: 7 }], team: { abbreviation: 'DET' } },
          { homeAway: 'away', score: '3', linescores: [{ value: 3 }], team: { abbreviation: 'GB' } },
        ],
      }],
    },
    scoringPlays: [],
  };
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => espnSummary }))));
  afterEach(() => vi.unstubAllGlobals());
  const runSync = () => (syncGameStatus as unknown as { run: (event: unknown) => Promise<unknown> }).run({ scheduleTime: new Date().toISOString() });
  const pause = (paused: unknown) => db.collection('system').doc('config').set({ squaresWinners: { paused } }, { merge: true });
  const manual = { current: { home: 7, away: 3 }, q1: { home: 7, away: 3 }, half: null, q3: null, final: null, gameStatus: 'in', startTime: KICKOFF };

  it('paused: the sync still keeps the SCORES and writes no winner record', async () => {
    await pause(true);
    await seedPool({ gameId: '401772900' });
    await runSync();
    expect(((await pool()).scores as Doc).q1).toEqual({ home: 7, away: 3 });
    expect(await winners()).toEqual({});
  });

  it('un-paused: the next pass records what was held back — nothing was lost', async () => {
    await pause(true);
    await seedPool({ gameId: '401772900' });
    await runSync();
    await pause(false);
    await runSync();
    expect((await winners()).q1).toMatchObject({ owner: 'P37', amount: 200 });
  });

  it('paused: "Record winners" is refused, in words, and writes nothing', async () => {
    await pause(true);
    await seedPool({ scores: manual });
    await expect(recompute({ data: { poolId: POOL }, auth: owner } as never)).rejects.toThrow(/paused by the site administrator/i);
    expect(await winners()).toEqual({});
  });

  it('paused: the final-prize draw is refused', async () => {
    await seedPool({ ruleVariations: { quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' } }, [48]);
    await sync(FINAL);
    await pause(true);
    await expect(draw({ data: { poolId: POOL }, auth: owner } as never)).rejects.toThrow(/paused by the site administrator/i);
    expect((await winners()).final_rollover.drawnAt).toBeUndefined();
  });

  it('paused: an Every-Score-Pays pool still notes each score as it happens — at $0 — and is paid out once un-paused', async () => {
    // An event not noted when it happens cannot be rebuilt from the final
    // score, so the switch holds back the PRIZES, not the record of the event.
    const esp = { ruleVariations: { scoreChangePayout: true, scoreChangePayoutStrategy: 'equal_split', combineTDandXP: true } };
    const game = feed({ period: 4, state: 'post', current: [3, 0], q1: [3, 0], half: [3, 0], q3: [3, 0], final: [3, 0], plays: [{ home: 3, away: 0 }] });
    await pause(true);
    await seedPool(esp);

    await poolRef().update({ gameId: '401772900' });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        header: { competitions: [{ date: KICKOFF, status: { type: { state: 'post' }, period: 4, displayClock: '0:00' }, competitors: [
          { homeAway: 'home', score: '3', linescores: [{ value: 3 }, { value: 0 }, { value: 0 }, { value: 0 }], team: { abbreviation: 'DET' } },
          { homeAway: 'away', score: '0', linescores: [{ value: 0 }, { value: 0 }, { value: 0 }, { value: 0 }], team: { abbreviation: 'GB' } },
        ] }] },
        scoringPlays: [{ id: 'p1', homeScore: 3, awayScore: 0, text: 'Field goal', type: { text: 'Field Goal' }, period: { number: 1 }, clock: { displayValue: '5:00' } }],
      }),
    })));
    await runSync();
    const held = await winners();
    expect(held.event_3_0).toMatchObject({ owner: 'P3', amount: 0 });
    // No quarter winner and no prize while paused.
    expect(Object.keys(held).filter((id) => !id.startsWith('event_'))).toEqual([]);

    await pause(false);
    await sync(game);
    expect((await winners()).event_3_0).toMatchObject({ owner: 'P3', amount: 1000 });
  });

  it('paused does not let a stranger learn anything they could not before', async () => {
    await pause(true);
    await seedPool({ scores: manual });
    await expect(recompute({ data: { poolId: POOL }, auth: stranger } as never)).rejects.toThrow(/permission/i);
  });

  it.each([['absent', undefined], ['false', false], ['the string "true"', 'true'], ['1', 1]])(
    'only an explicit true pauses (%s does not)',
    async (_label, value) => {
      if (value !== undefined) await pause(value);
      await seedPool({ scores: manual });
      await expect(recompute({ data: { poolId: POOL }, auth: owner } as never)).resolves.toMatchObject({ changed: 1 });
    },
  );

  it('marking a prize paid is not paused — it records a hand-over, it does not compute one', async () => {
    await seedPool();
    await sync(Q1);
    await pause(true);
    await expect(togglePaid({ data: { poolId: POOL, winnerId: 'q1', paid: true }, auth: owner } as never)).resolves.toMatchObject({ isPaid: true });
  });
});

describe('qodo r4 — the pause switch is read where the winners are written', () => {
  const HELD = 'squaresWinnersHeld';
  const GAME_ID = '401772900';
  const espnSummary = {
    header: {
      competitions: [{
        date: KICKOFF,
        status: { type: { state: 'in' }, period: 2, displayClock: '10:00' },
        competitors: [
          { homeAway: 'home', score: '7', linescores: [{ value: 7 }], team: { abbreviation: 'DET' } },
          { homeAway: 'away', score: '3', linescores: [{ value: 3 }], team: { abbreviation: 'GB' } },
        ],
      }],
    },
    scoringPlays: [],
  };
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => espnSummary }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const runSync = () => (syncGameStatus as unknown as { run: (event: unknown) => Promise<unknown> }).run({ scheduleTime: new Date().toISOString() });
  const pause = (paused: unknown) => db.collection('system').doc('config').set({ squaresWinners: { paused } }, { merge: true });
  const fixSync = test.wrap(fixPoolScores);

  /** A game that ended three days ago: the sync no longer looks at it. */
  const LONG_OVER = '2026-01-04T18:00:00.000Z';
  const finished = {
    current: { home: 28, away: 24 }, q1: { home: 7, away: 3 }, half: { home: 14, away: 10 }, q3: { home: 21, away: 17 }, final: { home: 28, away: 24 },
    gameStatus: 'post', startTime: LONG_OVER,
  };

  // ---- finding 1: every road to the writer passes the switch ----------------

  it('paused: the SIMULATOR keeps the scores, writes no winner, and marks the pool', async () => {
    await pause(true);
    await seedPool();
    await sync(Q1);
    expect(((await pool()).scores as Doc).q1).toEqual({ home: 7, away: 3 });
    expect(await winners()).toEqual({});
    expect((await pool())[HELD]).toBe(true);
  });

  it('paused: "Fix Sync" keeps the scores, writes no winner, and marks the pool', async () => {
    await pause(true);
    await seedPool({ gameId: GAME_ID });
    await fixSync({ data: { poolId: POOL }, auth: superAdmin } as never);
    expect(((await pool()).scores as Doc).q1).toEqual({ home: 7, away: 3 });
    expect(await winners()).toEqual({});
    expect((await pool())[HELD]).toBe(true);
  });

  it('not paused: the simulator and "Fix Sync" record the winner, and leave no mark', async () => {
    await seedPool();
    await sync(Q1);
    expect((await winners()).q1).toMatchObject({ owner: 'P37', amount: 200 });
    expect((await pool())[HELD]).toBeUndefined();

    await seedPool({ gameId: GAME_ID });
    await poolRef().collection('winners').doc('q1').delete();
    await fixSync({ data: { poolId: POOL }, auth: superAdmin } as never);
    expect((await winners()).q1).toMatchObject({ owner: 'P37', amount: 200 });
    expect((await pool())[HELD]).toBeUndefined();
  });

  // ---- finding 7: a pause that lands after the run has started --------------

  it('a pause set AFTER the run started is seen by the pool the run had not written yet', async () => {
    await seedPool({ gameId: GAME_ID });
    // The feed is fetched before that pool's write is prepared. Set the switch then.
    fetchMock.mockImplementation(async () => {
      await pause(true);
      return { ok: true, status: 200, json: async () => espnSummary };
    });
    await runSync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(((await pool()).scores as Doc).q1).toEqual({ home: 7, away: 3 });
    expect(await winners()).toEqual({});
    expect((await pool())[HELD]).toBe(true);
  });

  // ---- finding 2: nothing is lost, however long the switch is set -----------

  it('a game that finished and left the sync window while paused is recorded once the switch is cleared', async () => {
    await seedPool({ gameId: GAME_ID, scores: finished, [HELD]: true, updatedAt: admin.firestore.Timestamp.fromMillis(Date.parse(LONG_OVER)) });
    await runSync();
    // The sync itself never touched the game: it is far outside the window.
    expect(fetchMock).not.toHaveBeenCalled();
    const w = await winners();
    expect(w.q1).toMatchObject({ owner: 'P37', amount: 200 });
    expect(w.half).toMatchObject({ owner: 'P4', amount: 200 });
    expect(w.q3).toMatchObject({ owner: 'P71', amount: 200 });
    expect(w.final).toMatchObject({ owner: 'P48', amount: 400 });
    expect((await pool())[HELD]).toBeUndefined();
    expect((await audits()).some((a) => (a.actor as Doc)?.label === 'Winners held by the pause switch')).toBe(true);
  });

  it('still paused: the held game stays marked and unrecorded', async () => {
    await pause(true);
    await seedPool({ gameId: GAME_ID, scores: finished, [HELD]: true, updatedAt: admin.firestore.Timestamp.fromMillis(Date.parse(LONG_OVER)) });
    await runSync();
    expect(await winners()).toEqual({});
    expect((await pool())[HELD]).toBe(true);
  });

  it('a pause set after the catch-up has started is seen by the pool it had not written yet', async () => {
    await seedPool({ gameId: GAME_ID, scores: finished, [HELD]: true, updatedAt: admin.firestore.Timestamp.fromMillis(Date.parse(LONG_OVER)) });
    // The catch-up has looked at the switch and found it clear. It is set
    // before the pool's own transaction reads it.
    const realGet = Transaction.prototype.get;
    let set = false;
    vi.spyOn(Transaction.prototype, 'get').mockImplementation(async function (this: Transaction, ref: unknown) {
      if (!set && (ref as { path?: string }).path === 'pools/' + POOL) {
        set = true;
        await pause(true);
      }
      return (realGet as (...a: unknown[]) => unknown).call(this, ref);
    } as never);
    await runSync();
    expect(set).toBe(true);
    expect(await winners()).toEqual({});
    expect((await pool())[HELD]).toBe(true);
  });

  it('the whole story: paused through the end of the game, cleared days later, paid in full', async () => {
    await pause(true);
    await seedPool();
    await sync(Q1);
    await sync(HALF);
    await sync(Q3);
    await sync(FINAL);
    expect(await winners()).toEqual({});
    expect((await pool())[HELD]).toBe(true);
    // Days pass; the game is far outside the window when the switch is cleared.
    await poolRef().update({ 'scores.startTime': LONG_OVER, updatedAt: admin.firestore.Timestamp.fromMillis(Date.parse(LONG_OVER)) });
    await pause(false);
    await runSync();
    const w = await winners();
    expect([w.q1.amount, w.half.amount, w.q3.amount, w.final.amount]).toEqual([200, 200, 200, 400]);
    expect((await pool())[HELD]).toBeUndefined();
  });

  it('an Every-Score-Pays game held through its end has its event prizes paid by the catch-up', async () => {
    const esp = { ruleVariations: { scoreChangePayout: true, scoreChangePayoutStrategy: 'equal_split', combineTDandXP: true } };
    await pause(true);
    await seedPool(esp);
    await sync(feed({ period: 4, state: 'post', current: [3, 0], q1: [3, 0], half: [3, 0], q3: [3, 0], final: [3, 0], plays: [{ home: 3, away: 0 }] }));
    // The event was noted when it happened, at $0. Its prize was held.
    expect((await winners()).event_3_0).toMatchObject({ owner: 'P3', amount: 0 });
    await poolRef().update({ 'scores.startTime': LONG_OVER, updatedAt: admin.firestore.Timestamp.fromMillis(Date.parse(LONG_OVER)) });
    await pause(false);
    await runSync();
    expect((await winners()).event_3_0).toMatchObject({ owner: 'P3', amount: 1000 });
    expect((await pool())[HELD]).toBeUndefined();
  });

  it('a marked pool is found however many other pools there are', async () => {
    // More unmarked pools than one catch-up pass takes, all filed ahead of the marked one.
    const old = admin.firestore.Timestamp.fromMillis(Date.parse(LONG_OVER));
    const batch = db.batch();
    for (let i = 0; i < 30; i++) {
      batch.set(db.collection('pools').doc('a-filler-' + String(i).padStart(2, '0')), { type: 'SQUARES', scores: { gameStatus: 'post', startTime: LONG_OVER }, updatedAt: old });
    }
    await batch.commit();
    await seedPool({ gameId: GAME_ID, scores: finished, [HELD]: true, updatedAt: old });
    await runSync();
    expect((await winners()).final).toMatchObject({ owner: 'P48', amount: 400 });
    expect((await pool())[HELD]).toBeUndefined();
  });

  it('a pool whose mark came off after the catch-up found it is left alone', async () => {
    await seedPool({ gameId: GAME_ID, scores: finished, [HELD]: true, updatedAt: admin.firestore.Timestamp.fromMillis(Date.parse(LONG_OVER)) });
    const realGet = Transaction.prototype.get;
    let cleared = false;
    vi.spyOn(Transaction.prototype, 'get').mockImplementation(async function (this: Transaction, ref: unknown) {
      if (!cleared && (ref as { path?: string }).path === 'pools/' + POOL) {
        cleared = true;
        await poolRef().update({ [HELD]: admin.firestore.FieldValue.delete() });
      }
      return (realGet as (...a: unknown[]) => unknown).call(this, ref);
    } as never);
    await runSync();
    expect(cleared).toBe(true);
    expect(await winners()).toEqual({});
  });

  it('still paused: the catch-up does not even open the held pools', async () => {
    await pause(true);
    await seedPool({ gameId: GAME_ID, scores: finished, [HELD]: true, updatedAt: admin.firestore.Timestamp.fromMillis(Date.parse(LONG_OVER)) });
    const opened: string[] = [];
    const realGet = Transaction.prototype.get;
    vi.spyOn(Transaction.prototype, 'get').mockImplementation(function (this: Transaction, ref: unknown) {
      opened.push(String((ref as { path?: string }).path));
      return (realGet as (...a: unknown[]) => unknown).call(this, ref);
    } as never);
    await runSync();
    expect(opened).toEqual([]);
  });

  it('the simulator records a marked pool once the switch is cleared, and takes the mark off', async () => {
    await pause(true);
    await seedPool();
    await sync(Q1);
    expect((await pool())[HELD]).toBe(true);
    await pause(false);
    await sync(HALF);
    const w = await winners();
    expect([w.q1.amount, w.half.amount]).toEqual([200, 200]);
    expect((await pool())[HELD]).toBeUndefined();
  });

  it('a pool that is not marked is not touched by the catch-up', async () => {
    await seedPool({ gameId: GAME_ID, scores: finished, updatedAt: admin.firestore.Timestamp.fromMillis(Date.parse(LONG_OVER)) });
    await runSync();
    expect(await winners()).toEqual({});
  });

  it('a marked pool on the OLD rules has its mark taken off and its records left exactly as they were', async () => {
    const old = admin.firestore.Timestamp.fromMillis(Date.UTC(2025, 0, 5));
    await seedPool({ gameId: GAME_ID, scores: finished, [HELD]: true, createdAt: old, updatedAt: old });
    await poolRef().collection('winners').doc('q1').set({ owner: 'Somebody Else', amount: 999, squareId: 0 });
    await runSync();
    expect(await winners()).toEqual({ q1: { owner: 'Somebody Else', amount: 999, squareId: 0 } });
    expect((await pool())[HELD]).toBeUndefined();
  });

  it('a marked pool now scored BY HAND is left for the commissioner\'s button — the catch-up records nothing', async () => {
    await seedPool({ gameId: GAME_ID, scores: finished, [HELD]: true, manualScoreOverride: true, updatedAt: admin.firestore.Timestamp.fromMillis(Date.parse(LONG_OVER)) });
    await runSync();
    expect(await winners()).toEqual({});
    expect((await pool())[HELD]).toBeUndefined();
    // The button still records all of it.
    await recompute({ data: { poolId: POOL }, auth: owner } as never);
    expect(Object.keys(await winners()).sort()).toEqual(['final', 'half', 'q1', 'q3']);
  });

  it('one held pool failing does not stop the next one', async () => {
    const other = db.collection('pools').doc('sq-money-2');
    await seedPool({ gameId: GAME_ID, scores: finished, [HELD]: true, updatedAt: admin.firestore.Timestamp.fromMillis(Date.parse(LONG_OVER)) });
    await other.set({ ...(await pool()), id: 'sq-money-2' });
    const realGet = Transaction.prototype.get;
    let failed = 0;
    vi.spyOn(Transaction.prototype, 'get').mockImplementation(function (this: Transaction, ref: unknown) {
      if ((ref as { path?: string }).path === 'pools/' + POOL + '/winners') {
        failed++;
        return Promise.reject(new Error('unavailable'));
      }
      return (realGet as (...a: unknown[]) => unknown).call(this, ref);
    } as never);
    await runSync();
    expect(failed).toBeGreaterThan(0);
    expect((await pool())[HELD]).toBe(true);
    expect(await winners()).toEqual({});
    const otherWinners = await other.collection('winners').get();
    expect(otherWinners.docs.map((d) => d.id).sort()).toEqual(['final', 'half', 'q1', 'q3']);
    expect((await other.get()).data()?.[HELD]).toBeUndefined();
  });

  it('the normal sync records a marked pool itself, and takes the mark off', async () => {
    await pause(true);
    await seedPool({ gameId: GAME_ID });
    await runSync();
    expect((await pool())[HELD]).toBe(true);
    await pause(false);
    await runSync();
    expect((await winners()).q1).toMatchObject({ owner: 'P37', amount: 200 });
    expect((await pool())[HELD]).toBeUndefined();
  });

  it('"Record winners" after the switch is cleared takes the mark off', async () => {
    await pause(true);
    await seedPool();
    await sync(Q1);
    expect((await pool())[HELD]).toBe(true);
    await pause(false);
    await recompute({ data: { poolId: POOL }, auth: owner } as never);
    expect((await winners()).q1).toMatchObject({ owner: 'P37', amount: 200 });
    expect((await pool())[HELD]).toBeUndefined();
  });

  it('the final-prize draw after the switch is cleared takes the mark off', async () => {
    await pause(true);
    await seedPool({ ruleVariations: { quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' } }, [48]);
    await sync(FINAL);
    expect((await pool())[HELD]).toBe(true);
    await pause(false);
    await draw({ data: { poolId: POOL }, auth: owner } as never);
    expect((await winners()).final_rollover.drawnAt).toBeDefined();
    expect((await pool())[HELD]).toBeUndefined();
  });

  // ---- finding 21: a switch nobody could read ------------------------------

  describe('when the switch cannot be read', () => {
    const breakConfig = () => {
      const realGet = Transaction.prototype.get;
      vi.spyOn(Transaction.prototype, 'get').mockImplementation(function (this: Transaction, ref: unknown) {
        if ((ref as { path?: string }).path === 'system/config') return Promise.reject(new Error('unavailable'));
        return (realGet as (...a: unknown[]) => unknown).call(this, ref);
      } as never);
    };

    it('the sync writes NOTHING for that pool — and records it on the next pass', async () => {
      await seedPool({ gameId: GAME_ID });
      breakConfig();
      await runSync();
      expect(await winners()).toEqual({});
      expect(((await pool()).scores as Doc).q1).toBeNull();
      expect((await pool())[HELD]).toBeUndefined();

      vi.restoreAllMocks();
      await runSync();
      expect((await winners()).q1).toMatchObject({ owner: 'P37', amount: 200 });
    });

    it('"Record winners" fails and writes nothing', async () => {
      const manual = { current: { home: 7, away: 3 }, q1: { home: 7, away: 3 }, half: null, q3: null, final: null, gameStatus: 'in', startTime: KICKOFF };
      await seedPool({ scores: manual });
      breakConfig();
      await expect(recompute({ data: { poolId: POOL }, auth: owner } as never)).rejects.toThrow();
      expect(await winners()).toEqual({});
    });

    it('the simulator fails and writes nothing', async () => {
      await seedPool();
      breakConfig();
      await expect(sync(Q1)).rejects.toThrow();
      expect(await winners()).toEqual({});
      expect(((await pool()).scores as Doc).q1).toBeNull();
    });

    it('scores BEFORE the first quarter ends are still kept — no winner is at stake, so the switch is not read', async () => {
      await seedPool();
      breakConfig();
      await sync(feed({ period: 1, current: [7, 0] }));
      expect(((await pool()).scores as Doc).current).toEqual({ home: 7, away: 0 });
    });
  });
});

// qodo (PR #761) read the winners gate as looking only at the stored pool, so
// that a simulation which had to DRAW the numbers skipped the winners for that
// update. It does not: the drawn numbers are merged into the pool the gate
// reads (`{ ...doc.data(), ...overrides }`). This pins that.
describe('qodo r6 — the simulator on a grid that was never locked', () => {
  it('draws the numbers AND records the first-quarter winner in the same update', async () => {
    await seedPool({ axisNumbers: undefined, isLocked: false });
    await sync(Q1);

    const after = await pool();
    const axis = after.axisNumbers as { home: number[]; away: number[] };
    expect([...axis.home].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect([...axis.away].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // 7–3 on the numbers that were just drawn: away digit → row, home digit → column.
    const square = axis.away.indexOf(3) * 10 + axis.home.indexOf(7);
    expect((await winners()).q1).toMatchObject({ owner: `P${square}`, squareId: square, amount: 200 });
  });

  it('and every later period is judged on those same numbers', async () => {
    await seedPool({ axisNumbers: undefined, isLocked: false });
    await sync(Q1);
    const drawn = (await pool()).axisNumbers;
    await sync(HALF);
    expect((await pool()).axisNumbers).toEqual(drawn);
    const axis = drawn as { home: number[]; away: number[] };
    // 14–10 at the half: away 0, home 4.
    const square = axis.away.indexOf(0) * 10 + axis.home.indexOf(4);
    expect((await winners()).half).toMatchObject({ owner: `P${square}`, amount: 200 });
  });
});

