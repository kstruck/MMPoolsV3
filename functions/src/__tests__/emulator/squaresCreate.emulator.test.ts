import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';

/**
 * SQUARES — CREATE, KICKOFF LOCK AND THE AFTER-KICKOFF CLAIM, against the
 * emulator (PLAN-SQUARES-REOPEN PR-C).
 *
 * 🛑 SQUARES CREATION IS STILL CLOSED IN THE SHIPPED CODE. `poolCreation.
 * emulator.test.ts` proves the closure at the callable, and that test is
 * untouched. THIS file opens the gate for itself — and only for itself — so the
 * code that runs the moment the gate is lifted is proved before it is lifted,
 * not after. Nothing here changes what production refuses.
 */
vi.mock('../../lib/featureFlags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/featureFlags')>();
  return { ...actual, HARD_CLOSED_POOL_TYPES: [], isPoolTypeEnabled: () => true };
});

import { createPool } from '../../poolOps';
import { autoLockPools, SQUARES_LOCK_LEAD_MS, squaresLockLeadMs } from '../../autoLock';
import { reserveSquares } from '../../squares';
import { withSquaresDefaults } from '../../shared/squaresDefaults';
import { computePeriodPayouts, squaresPot } from '../../shared/squaresPayouts';
import { isUsableAxis } from '../../lib/squaresGame';
import { GUEST_KEY_PREFIX } from '../../shared/squaresClaim';

const test = ftest();
const db = admin.firestore();
const create = test.wrap(createPool);
const reserve = test.wrap(reserveSquares);
const runAutoLock = () =>
  (autoLockPools as unknown as { run: (event: unknown) => Promise<unknown> }).run({ scheduleTime: new Date().toISOString() });

const OWNER = 'owner-1';
const owner = { uid: OWNER, token: { name: 'Olivia Owner', email: 'owner@example.com' } };
const HOUR = 3_600_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a raw Firestore document, read field by field
type Doc = Record<string, any>;

const key = (tag: string) => `${GUEST_KEY_PREFIX}${tag.padEnd(36, '0')}`;
const poolDoc = async (id: string): Promise<Doc> => (await db.collection('pools').doc(id).get()).data() as Doc;

async function createSquares(over: Doc = {}): Promise<{ id: string; pool: Doc }> {
  const res = (await create({
    data: { type: 'SQUARES', name: 'Thanksgiving squares', costPerSquare: 10, ...over },
    auth: owner,
  } as never)) as { poolId: string };
  return { id: res.poolId, pool: await poolDoc(res.poolId) };
}

const guestReserve = (poolId: string, squareIds: number[], name: string) =>
  reserve({
    data: { poolId, squareIds, customerDetails: { name }, guestDeviceKey: key(name.toLowerCase()), pickedAsName: name },
  } as never);

beforeEach(async () => {
  for (const col of ['pools', 'users', 'pool_access_attempts']) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => db.recursiveDelete(d.ref)));
  }
  await db.collection('users').doc(OWNER).set({ role: 'COMMISSIONER', email: 'owner@example.com', name: 'Olivia Owner' });
});

afterAll(() => test.cleanup());

describe('C0 — a pool the wizard creates is a complete document', () => {
  it('has every piece the squares pages read with no guard', async () => {
    const { pool } = await createSquares();
    // The reads that threw on a wizard-created pool, off the STORED document.
    expect(pool.ruleVariations.quarterlyRollover).toBe(false);
    expect(pool.ruleVariations.reverseWinners).toBe(false);
    expect(pool.ruleVariations.scoreChangePayout).toBe(false);
    expect(pool.ruleVariations.unclaimedFinalPrizeStrategy).toBe('last_winner');
    expect(pool.payouts).toEqual({ q1: 25, half: 25, q3: 25, final: 25 });
    expect(pool.charity).toMatchObject({ enabled: false, percentage: 0 });
    expect(pool.scores).toEqual({ current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre' });
    expect(pool.scoreEvents).toEqual([]);
    expect(pool.numberSets).toBe(1);
    expect(pool.squares).toHaveLength(100);
    expect(pool.squares.every((s: Doc, i: number) => s.id === i && s.owner === null)).toBe(true);
    expect(pool.isLocked).toBe(false);
    expect(pool.ownerId).toBe(OWNER);
    expect(pool.createdAt).toBeTruthy();
  });

  it('needs nothing filled in: the page-side defaults change nothing on it', async () => {
    const { pool } = await createSquares({
      squaresPayouts: { q1: 10, half: 20, q3: 10, final: 60 },
      ruleVariations: { reverseWinners: true, quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' },
      charity: { enabled: true, name: 'Food bank', percentage: 10 },
      maxSquaresPerPlayer: 5,
      homeTeam: 'Lions',
      awayTeam: 'Packers',
    });
    const filled = withSquaresDefaults(pool);
    for (const k of ['ruleVariations', 'payouts', 'charity', 'scores', 'squares', 'scoreEvents', 'numberSets', 'costPerSquare', 'maxSquaresPerPlayer', 'homeTeam', 'awayTeam']) {
      expect(filled[k], k).toEqual(pool[k]);
    }
  });

  it('keeps the wizard\'s split, rules and charity', async () => {
    const { pool } = await createSquares({
      squaresPayouts: { q1: 10, half: 20, q3: 10, final: 60 },
      ruleVariations: { reverseWinners: true, quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' },
      charity: { enabled: true, name: 'Food bank', percentage: 10 },
      numberSets: 4,
    });
    expect(pool.payouts).toEqual({ q1: 10, half: 20, q3: 10, final: 60 });
    expect(pool.ruleVariations).toMatchObject({ reverseWinners: true, quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' });
    expect(pool.charity).toMatchObject({ enabled: true, name: 'Food bank', percentage: 10 });
    expect(pool.numberSets).toBe(4);
    // The carrier field is not left on the document beside the real one.
    expect('squaresPayouts' in pool).toBe(false);
  });

  it('and the scorer pays that pool what the wizard\'s example showed', async () => {
    // The step's example and the winner records both come from this engine.
    // A full grid at $10 with 10% to charity: $1,000 pot, $900 in prizes.
    const { pool } = await createSquares({
      squaresPayouts: { q1: 10, half: 20, q3: 10, final: 60 },
      charity: { enabled: true, name: 'Food bank', percentage: 10 },
    });
    const full = {
      ...pool,
      squares: pool.squares.map((s: Doc) => ({ ...s, owner: `P${s.id}` })),
      axisNumbers: { home: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], away: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
    };
    expect(squaresPot(full)).toMatchObject({ gross: 1000, charity: 100, net: 900 });
    const results = computePeriodPayouts(full, { q1: { home: 7, away: 3 }, half: { home: 4, away: 0 }, q3: { home: 4, away: 7 }, final: { home: 1, away: 1 } });
    expect(results.map((r) => r.prize)).toEqual([90, 180, 90, 540]);
  });

  it('a split that does not total 100 is REFUSED, and no pool is written', async () => {
    await expect(createSquares({ squaresPayouts: { q1: 25, half: 25, q3: 25, final: 20 } })).rejects.toThrow();
    await expect(createSquares({ squaresPayouts: { q1: 50, half: 50, q3: 50, final: -50 } })).rejects.toThrow();
    expect((await db.collection('pools').get()).size).toBe(0);
  });

  it('`payouts` in the payload is still not the client\'s to set', async () => {
    // It is a privileged field. Only the validated `squaresPayouts` reaches the
    // document; a raw `payouts` is dropped and the even split stands.
    const { pool } = await createSquares({ payouts: { q1: 100, half: 100, q3: 100, final: 100 } });
    expect(pool.payouts).toEqual({ q1: 25, half: 25, q3: 25, final: 25 });
    // ...and not even alongside a valid split: the validated one wins.
    const both = await createSquares({
      payouts: { q1: 100, half: 100, q3: 100, final: 100 },
      squaresPayouts: { q1: 40, half: 10, q3: 10, final: 40 },
    });
    expect(both.pool.payouts).toEqual({ q1: 40, half: 10, q3: 10, final: 40 });
  });

  it('a team badge from anywhere but the score feed is refused', async () => {
    const kickoff = Date.now() + 48 * HOUR;
    await expect(
      createSquares({ gameId: '401', gameTime: kickoff, homeTeamLogo: 'https://evil.example/pixel.gif' }),
    ).rejects.toThrow();
    expect((await db.collection('pools').get()).size).toBe(0);
  });
});

describe('C1 — a linked game locks itself at kickoff', () => {
  const logos = {
    homeTeamLogo: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png',
    awayTeamLogo: 'https://a.espncdn.com/i/teamlogos/nfl/500/gb.png',
  };

  it('stores the game, arms the kickoff lock, and gives the score sync its start time', async () => {
    const kickoff = Date.now() + 48 * HOUR;
    const { pool } = await createSquares({
      gameId: '401772510', gameTime: kickoff, league: 'nfl', seasonType: '2', week: 12,
      homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers', ...logos,
    });
    expect(pool.gameId).toBe('401772510');
    expect(pool.gameTime).toBe(kickoff);
    expect(pool.league).toBe('nfl');
    expect(pool.homeTeamLogo).toBe(logos.homeTeamLogo);
    expect(pool.reminders.lock).toEqual({ scheduleMinutes: [], enabled: true, lockAt: kickoff });
    expect(pool.scores.startTime).toBe(new Date(kickoff).toISOString());
    expect(pool.scores.gameStatus).toBe('pre');
    expect(pool.isLocked).toBe(false);
  });

  it('an unlinked pool arms no lock and carries no game', async () => {
    const { pool } = await createSquares({ homeTeam: 'Lions', awayTeam: 'Packers', gameId: '' });
    expect('reminders' in pool).toBe(false);
    expect('gameId' in pool).toBe(false);
    expect('gameTime' in pool).toBe(false);
    expect('startTime' in pool.scores).toBe(false);
  });

  it('a kickoff with no game is not a link, and is not left on the document', async () => {
    const { pool } = await createSquares({ gameTime: Date.now() + 48 * HOUR });
    expect('gameId' in pool).toBe(false);
    expect('gameTime' in pool).toBe(false);
    expect('reminders' in pool).toBe(false);
  });

  it('a game with no kickoff time is REFUSED — it would be scored and never locked', async () => {
    await expect(createSquares({ gameId: '401772510' })).rejects.toThrow(/no kickoff time/);
    await expect(createSquares({ gameId: '401772510', gameTime: 0 })).rejects.toThrow(/no kickoff time/);
    expect((await db.collection('pools').get()).size).toBe(0);
  });

  it('a game id that is not digits is refused — it goes into the score feed\'s URL every minute', async () => {
    const kickoff = Date.now() + 48 * HOUR;
    for (const gameId of ['401772510/../../x', '401772510?event=1', 'abc', '401 772', '4017725104017725100']) {
      await expect(createSquares({ gameId, gameTime: kickoff }), gameId).rejects.toThrow();
    }
    expect((await db.collection('pools').get()).size).toBe(0);
  });

  it('a game that has already kicked off is REFUSED', async () => {
    await expect(createSquares({ gameId: '401772510', gameTime: Date.now() - 60_000 })).rejects.toThrow(/already kicked off/);
    expect((await db.collection('pools').get()).size).toBe(0);
  });

  it('the scheduled lock leaves it open before kickoff and locks it at kickoff, drawing the numbers', async () => {
    const { id } = await createSquares({ gameId: '401772510', gameTime: Date.now() + 48 * HOUR, ...logos });
    await guestReserve(id, [12, 13], 'Alice');

    await runAutoLock();
    let pool = await poolDoc(id);
    expect(pool.isLocked).toBe(false);
    expect(pool.axisNumbers ?? null).toBeNull();

    // Kickoff arrives. (The lock is moved rather than the clock: the job reads
    // the document, and the document is what a real kickoff changes relative to.)
    await db.collection('pools').doc(id).update({ 'reminders.lock.lockAt': Date.now() + 10_000 });
    await runAutoLock();
    pool = await poolDoc(id);
    expect(pool.isLocked).toBe(true);
    expect(isUsableAxis(pool.axisNumbers)).toBe(true);
    // Nobody's square moved.
    expect(pool.squares[12].owner).toBe('Alice');
    expect(pool.squares[13].owner).toBe('Alice');
  });

  it('a four-set pool gets its first set at the lock', async () => {
    const { id } = await createSquares({ gameId: '401772510', gameTime: Date.now() + 48 * HOUR, numberSets: 4 });
    await db.collection('pools').doc(id).update({ 'reminders.lock.lockAt': Date.now() + 10_000 });
    await runAutoLock();
    const pool = await poolDoc(id);
    expect(pool.isLocked).toBe(true);
    expect(pool.quarterlyNumbers.q1).toEqual(pool.axisNumbers);
  });
});

/**
 * THE DEDICATED LOCK RUNS AHEAD OF THE LOCK TIME (qodo, PR #760 / plan K7).
 *
 * `runReminders` in `reminders.ts` also locks a squares grid whose time has
 * passed, and draws its numbers with a biased shuffle. This job runs every
 * minute; with a 30-second lead it reached a grid anywhere from 30 seconds
 * before its lock time to 30 seconds after, and in that second half the other
 * job could draw the numbers. At 90 seconds it has always run before the time
 * arrives.
 */
describe('C2b — a squares grid is locked from 90 seconds before its time, so the dedicated job always gets there first', () => {
  const due = async (inMs: number, over: Doc = {}) => {
    const { id } = await createSquares({ gameId: '401772510', gameTime: Date.now() + 48 * HOUR });
    await db.collection('pools').doc(id).update({ 'reminders.lock.lockAt': Date.now() + inMs, ...over });
    return id;
  };

  it('the lead is longer than the job\'s own interval, with room to spare', () => {
    expect(SQUARES_LOCK_LEAD_MS).toBe(90_000);
    expect(SQUARES_LOCK_LEAD_MS).toBeGreaterThan(60_000);
    expect(squaresLockLeadMs({ type: 'SQUARES' })).toBe(90_000);
    expect(squaresLockLeadMs({})).toBe(90_000);          // a squares pool from before `type` existed
    expect(squaresLockLeadMs({ type: 'PROPS' })).toBe(30_000);
    expect(squaresLockLeadMs({ type: 'BRACKET' })).toBe(30_000);
  });

  it('a grid due in 75 seconds is locked now — a 30-second lead would have left it for the next run, after its time', async () => {
    const id = await due(75_000);
    await runAutoLock();
    const pool = await poolDoc(id);
    expect(pool.isLocked).toBe(true);
    expect(isUsableAxis(pool.axisNumbers)).toBe(true);
  });

  it('a grid due in two minutes is left open — it is not locked early for the sake of it', async () => {
    const id = await due(120_000);
    await runAutoLock();
    const pool = await poolDoc(id);
    expect(pool.isLocked).toBe(false);
    expect(pool.axisNumbers ?? null).toBeNull();
  });

  it('a pool of another type on the same lock setting keeps the 30-second lead', async () => {
    const id = await due(75_000, { type: 'PROPS' });
    await runAutoLock();
    expect((await poolDoc(id)).isLocked).toBe(false);
  });
});

/**
 * D9 / sweep SW2 — THE NUMBERS ARE DRAWN ONCE. The scheduled lock used to draw
 * a fresh set every time it ran, so a grid that had been locked by hand (its
 * numbers already published to every player) and was then found unlocked at
 * kickoff had its numbers REPLACED.
 */
describe('C2 — the kickoff lock keeps numbers a grid already has', () => {
  const PUBLISHED = { home: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], away: [5, 6, 7, 8, 9, 0, 1, 2, 3, 4] };

  async function dueGrid(over: Doc = {}) {
    const { id } = await createSquares({ gameId: '401772510', gameTime: Date.now() + 48 * HOUR });
    await db.collection('pools').doc(id).update({ 'reminders.lock.lockAt': Date.now() + 10_000, ...over });
    return id;
  }

  it('numbers already on the grid survive the lock, digit for digit', async () => {
    const id = await dueGrid({ axisNumbers: PUBLISHED });
    await runAutoLock();
    const pool = await poolDoc(id);
    expect(pool.isLocked).toBe(true);
    expect(pool.axisNumbers).toEqual(PUBLISHED);
  });

  it('and no "numbers generated" entry is written for a draw that did not happen', async () => {
    const id = await dueGrid({ axisNumbers: PUBLISHED });
    await runAutoLock();
    const audit = await db.collection('pools').doc(id).collection('audit').get();
    const types = audit.docs.map((d) => d.data().type);
    expect(types).toContain('POOL_LOCKED');
    expect(types).not.toContain('DIGITS_GENERATED');
  });

  it('a four-set grid keeps the sets it has', async () => {
    const sets = { q1: PUBLISHED, q2: { home: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], away: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] } };
    const id = await dueGrid({ axisNumbers: PUBLISHED, numberSets: 4, quarterlyNumbers: sets });
    await runAutoLock();
    const pool = await poolDoc(id);
    expect(pool.quarterlyNumbers).toEqual(sets);
  });

  it.each([
    ['none', undefined],
    ['a short row', { home: [1, 2, 3], away: PUBLISHED.away }],
    ['a repeated digit', { home: [0, 0, 2, 3, 4, 5, 6, 7, 8, 9], away: PUBLISHED.away }],
    ['null', null],
  ])('numbers that are not a full set (%s) are drawn fresh', async (_label, axisNumbers) => {
    const id = await dueGrid(axisNumbers === undefined ? {} : { axisNumbers });
    await runAutoLock();
    const pool = await poolDoc(id);
    expect(pool.isLocked).toBe(true);
    expect(isUsableAxis(pool.axisNumbers)).toBe(true);
    const audit = await db.collection('pools').doc(id).collection('audit').get();
    expect(audit.docs.map((d) => d.data().type)).toContain('DIGITS_GENERATED');
  });
});

/**
 * C2 — NO SQUARE IS SOLD AFTER KICKOFF. `isLocked` is one field, written by a
 * job that can miss and a page that can clear it. The claim path now also asks
 * whether the game has started, so an open grid at kickoff is no longer squares
 * on sale to people watching the score.
 */
describe('C2 — nobody but the owner claims a square once the game has started', () => {
  async function openGrid(scores: Doc) {
    const { id } = await createSquares({ homeTeam: 'Lions', awayTeam: 'Packers' });
    await db.collection('pools').doc(id).update({ scores: { current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre', ...scores } });
    return id;
  }

  it('before kickoff a guest claims normally (the counter-example)', async () => {
    const id = await openGrid({ startTime: new Date(Date.now() + HOUR).toISOString() });
    await guestReserve(id, [7], 'Alice');
    expect((await poolDoc(id)).squares[7].owner).toBe('Alice');
  });

  it('a pool with no game and no scores is never "started"', async () => {
    const id = await openGrid({});
    await guestReserve(id, [7], 'Alice');
    expect((await poolDoc(id)).squares[7].owner).toBe('Alice');
  });

  it.each([
    ['the kickoff time has passed', { startTime: new Date(Date.now() - 60_000).toISOString() }],
    ['the feed says the game is in progress', { gameStatus: 'in', startTime: new Date(Date.now() + HOUR).toISOString() }],
    ['the feed says the game is over', { gameStatus: 'post' }],
    ['points are on the board', { current: { home: 3, away: 0 } }],
    ['a quarter score has been entered by hand', { q1: { home: 7, away: 0 } }],
  ])('refused when %s — on a grid that is NOT locked', async (_label, scores) => {
    const id = await openGrid(scores);
    expect((await poolDoc(id)).isLocked).toBe(false);
    await expect(guestReserve(id, [7], 'Alice')).rejects.toThrow(/game has started/);
    expect((await poolDoc(id)).squares[7].owner).toBeNull();
  });

  it('a signed-in player who is not the owner is refused too', async () => {
    const id = await openGrid({ startTime: new Date(Date.now() - 60_000).toISOString() });
    await db.collection('users').doc('bob-1').set({ role: 'MEMBER', email: 'bob@example.com', name: 'Bob' });
    await expect(
      reserve({
        data: { poolId: id, squareIds: [7], customerDetails: { name: 'Bob' }, pickedAsName: 'Bob' },
        auth: { uid: 'bob-1', token: { name: 'Bob', email: 'bob@example.com' } },
      } as never),
    ).rejects.toThrow(/game has started/);
    expect((await poolDoc(id)).squares[7].owner).toBeNull();
  });

  it('the owner can still enter a square that was paid for in person', async () => {
    const id = await openGrid({ startTime: new Date(Date.now() - 60_000).toISOString() });
    await reserve({
      data: { poolId: id, squareIds: [7], customerDetails: { name: 'Uncle Ray' }, pickedAsName: 'Uncle Ray' },
      auth: owner,
    } as never);
    expect((await poolDoc(id)).squares[7].owner).toBe('Uncle Ray');
  });
});
