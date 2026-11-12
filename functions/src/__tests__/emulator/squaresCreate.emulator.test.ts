import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';

/**
 * SQUARES — CREATE, KICKOFF LOCK AND THE AFTER-KICKOFF CLAIM, against the
 * emulator (PLAN-SQUARES-REOPEN PR-C).
 *
 * Until PR-D this file opened the creation gate for itself with a mock, so the
 * code that runs the moment the gate is lifted was proved before it was lifted.
 * The gate is open now and the mock is gone: this runs against the flags as
 * shipped.
 */

import { createPool } from '../../poolOps';
import { autoLockPools, SQUARES_LOCK_LEAD_MS } from '../../autoLock';
import { checkLockReminders } from '../../reminders';
import { reserveSquares } from '../../squares';
import { withSquaresDefaults } from '../../shared/squaresDefaults';
import { computePeriodPayouts, squaresPot } from '../../shared/squaresPayouts';
import { isUsableAxis } from '../../lib/squaresGame';
import { GUEST_KEY_PREFIX } from '../../shared/squaresClaim';
import { FEED_FIXTURE_COLLECTION, feedFixtureDocId } from '../../lib/squaresFeedGame';

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

/**
 * The score feed, as the server sees it in the emulator (PLAN-SQUARES-SERVER-FIELDS):
 * `createPool` looks a linked game up in the feed and stores what the feed says,
 * and in an emulator run the feed is this fixture.
 */
const seededFeed = new Set<string>();
async function seedFeed(gameId: string, game: Doc): Promise<void> {
  seededFeed.add(gameId);
  await db.collection(FEED_FIXTURE_COLLECTION).doc(feedFixtureDocId(gameId)).set(game);
}

/**
 * Create a squares pool the way the wizard does. A linked game the test has not
 * put in the feed itself is put there AS THE WIZARD DESCRIBED IT — the feed and
 * the picker agree, which is the ordinary case. Tests about the feed disagreeing
 * seed it first.
 */
async function createSquares(over: Doc = {}): Promise<{ id: string; pool: Doc }> {
  const id = typeof over.gameId === 'string' ? over.gameId : '';
  if (/^\d{1,15}$/.test(id) && typeof over.gameTime === 'number' && !seededFeed.has(id)) {
    await seedFeed(id, {
      kickoff: over.gameTime, state: 'pre',
      homeTeam: over.homeTeam ?? 'Detroit Lions', awayTeam: over.awayTeam ?? 'Green Bay Packers',
      ...(over.homeTeamLogo ? { homeLogo: over.homeTeamLogo } : {}),
      ...(over.awayTeamLogo ? { awayLogo: over.awayTeamLogo } : {}),
      ...(over.seasonType ? { seasonType: over.seasonType } : {}),
      ...(over.week ? { week: over.week } : {}),
    });
  }
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
  seededFeed.clear();
  for (const col of ['pools', 'users', 'pool_access_attempts', FEED_FIXTURE_COLLECTION]) {
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

  // ---- PLAN-SQUARES-SERVER-FIELDS §2c: the game is the FEED's, not the wizard's.

  it('the kickoff, teams and badges stored are the FEED\'s — what the wizard sent is not used', async () => {
    const feedKickoff = Date.now() + 72 * HOUR;
    await seedFeed('401772510', {
      kickoff: feedKickoff, state: 'pre', homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers',
      homeLogo: logos.homeTeamLogo, seasonType: '2', week: 13,
    });
    const { pool } = await createSquares({
      gameId: '401772510', gameTime: Date.now() + 2 * HOUR, league: 'nfl', seasonType: '3', week: 1,
      homeTeam: 'Green Bay Packers', awayTeam: 'Detroit Lions', awayTeamLogo: 'https://a.espncdn.com/i/teamlogos/nfl/500/chi.png',
    });
    expect(pool.gameTime).toBe(feedKickoff);
    expect(pool.reminders.lock.lockAt).toBe(feedKickoff);          // the grid locks at the REAL kickoff
    expect(pool.scores.startTime).toBe(new Date(feedKickoff).toISOString());
    expect(pool.homeTeam).toBe('Detroit Lions');                   // not swapped: the score sync reads this order
    expect(pool.awayTeam).toBe('Green Bay Packers');
    expect(pool.homeTeamLogo).toBe(logos.homeTeamLogo);
    expect('awayTeamLogo' in pool).toBe(false);                    // the feed had none; the wizard's is dropped
    expect(pool.seasonType).toBe('2');
    expect(pool.week).toBe(13);
  });

  it('a game id with no kickoff from the wizard is linked with the feed\'s kickoff', async () => {
    const feedKickoff = Date.now() + 48 * HOUR;
    await seedFeed('401772510', { kickoff: feedKickoff, state: 'pre', homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers' });
    const { pool } = await createSquares({ gameId: '401772510' });
    expect(pool.gameTime).toBe(feedKickoff);
    expect(pool.reminders.lock).toMatchObject({ enabled: true, lockAt: feedKickoff });
  });

  it('a game the FEED says is under way is REFUSED, however far off the wizard said it was', async () => {
    await seedFeed('401772510', { kickoff: Date.now() + 48 * HOUR, state: 'in', homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers' });
    await expect(createSquares({ gameId: '401772510', gameTime: Date.now() + 48 * HOUR })).rejects.toThrow(/already kicked off/);
    expect((await db.collection('pools').get()).size).toBe(0);
  });

  it('a game whose FEED kickoff has passed is REFUSED, whatever kickoff the wizard sent', async () => {
    await seedFeed('401772510', { kickoff: Date.now() - 60_000, state: 'pre', homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers' });
    await expect(createSquares({ gameId: '401772510', gameTime: Date.now() + 48 * HOUR })).rejects.toThrow(/already kicked off/);
    expect((await db.collection('pools').get()).size).toBe(0);
  });

  it('a game the feed does not have is REFUSED, and no pool is written', async () => {
    // A fixture the feed cannot make a game of stands in for "the feed answered, not with that game".
    await seedFeed('401772599', { kickoff: Date.now() + 48 * HOUR, state: 'pre', homeTeam: '', awayTeam: '' });
    await expect(createSquares({ gameId: '401772599', gameTime: Date.now() + 48 * HOUR })).rejects.toThrow(/not found on the schedule/);
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
 * K7 — ONE AUTO-LOCK. Two jobs lock a squares grid whose time has come: the
 * dedicated one (`autoLock.ts`, every minute) and `runReminders` (every
 * fifteen). The second had its own copy of the lock, which drew the numbers
 * with a biased `Math.random` sort and REPLACED numbers a grid already had.
 *
 * That copy is gone; `checkLockReminders` calls the dedicated job's function.
 * So these tests drive the reminders path itself and hold it to the same
 * behaviour — and the 90-second head start that existed only to beat the copy
 * to the grid is back to 30.
 */
describe('K7 — the lock lead is 30 seconds again, for every pool this job locks', () => {
  const due = async (inMs: number, over: Doc = {}) => {
    const { id } = await createSquares({ gameId: '401772510', gameTime: Date.now() + 48 * HOUR });
    await db.collection('pools').doc(id).update({ 'reminders.lock.lockAt': Date.now() + inMs, ...over });
    return id;
  };

  it('the lead is 30 seconds', () => {
    expect(SQUARES_LOCK_LEAD_MS).toBe(30_000);
  });

  it('a grid due in 20 seconds is locked now', async () => {
    const id = await due(20_000);
    await runAutoLock();
    const pool = await poolDoc(id);
    expect(pool.isLocked).toBe(true);
    expect(isUsableAxis(pool.axisNumbers)).toBe(true);
  });

  it('a grid due in 75 seconds is left open — players keep that minute', async () => {
    const id = await due(75_000);
    await runAutoLock();
    const pool = await poolDoc(id);
    expect(pool.isLocked).toBe(false);
    expect(pool.axisNumbers ?? null).toBeNull();
  });

  it('a grid whose time passed while the job was not running is locked on the next run', async () => {
    const id = await due(-10 * 60_000);
    await runAutoLock();
    expect((await poolDoc(id)).isLocked).toBe(true);
  });
});

describe('K7 — the reminders job locks a squares grid with the SAME function', () => {
  const PUBLISHED = { home: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], away: [5, 6, 7, 8, 9, 0, 1, 2, 3, 4] };
  const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
  const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  /** A grid whose lock time has passed and that nothing has locked yet. */
  async function missed(over: Doc = {}) {
    const { id } = await createSquares({ gameId: '401772510', gameTime: Date.now() + 48 * HOUR });
    await db.collection('pools').doc(id).update({ 'reminders.lock.lockAt': Date.now() - 60_000, ...over });
    return id;
  }
  /** The reminders job's view of the pool: the document as it read it. */
  const asRead = async (id: string) => ({ id, ...(await poolDoc(id)) }) as never;
  const remind = async (id: string, pool?: unknown) => checkLockReminders(db, (pool ?? await asRead(id)) as never, Date.now());
  const auditTypes = async (id: string) =>
    (await db.collection('pools').doc(id).collection('audit').get()).docs.map((d) => d.data().type as string);

  it('numbers already on the grid survive, digit for digit — the old copy replaced them', async () => {
    const id = await missed({ axisNumbers: PUBLISHED });
    await remind(id);
    const pool = await poolDoc(id);
    expect(pool.isLocked).toBe(true);
    expect(pool.lockGrid).toBe(true);
    expect(pool.axisNumbers).toEqual(PUBLISHED);
    expect(await auditTypes(id)).not.toContain('DIGITS_GENERATED');
  });

  it('a grid with no numbers gets a full set on each axis, and the draw is on record', async () => {
    const id = await missed();
    await remind(id);
    const pool = await poolDoc(id);
    expect(pool.isLocked).toBe(true);
    expect(sorted(pool.axisNumbers.home)).toEqual(DIGITS);
    expect(sorted(pool.axisNumbers.away)).toEqual(DIGITS);
    const types = await auditTypes(id);
    expect(types).toContain('POOL_LOCKED');
    expect(types).toContain('DIGITS_GENERATED');
  });

  it('a "new numbers each quarter" grid starts its first quarter on the numbers drawn', async () => {
    const id = await missed({ numberSets: 4 });
    await remind(id);
    const pool = await poolDoc(id);
    expect(pool.quarterlyNumbers.q1).toEqual(pool.axisNumbers);
  });

  // The race K7 is about: both jobs see the grid open and both go to lock it.
  it('the two jobs racing: the numbers are drawn ONCE, whichever gets there first', async () => {
    const id = await missed();
    const stale = await asRead(id);           // what the reminders job read, grid still open
    await runAutoLock();                       // the dedicated job gets there first
    const first = (await poolDoc(id)).axisNumbers;
    await remind(id, stale);                   // the reminders job arrives with its stale copy
    expect((await poolDoc(id)).axisNumbers).toEqual(first);
    expect((await auditTypes(id)).filter((t) => t === 'DIGITS_GENERATED')).toHaveLength(1);
    expect((await auditTypes(id)).filter((t) => t === 'POOL_LOCKED')).toHaveLength(1);
  });

  it('…and the other way round', async () => {
    const id = await missed();
    await remind(id);
    const first = (await poolDoc(id)).axisNumbers;
    await runAutoLock();
    expect((await poolDoc(id)).axisNumbers).toEqual(first);
    expect((await auditTypes(id)).filter((t) => t === 'DIGITS_GENERATED')).toHaveLength(1);
  });

  it('before the lock time it locks nothing', async () => {
    const { id } = await createSquares({ gameId: '401772510', gameTime: Date.now() + 48 * HOUR });
    await remind(id);
    const pool = await poolDoc(id);
    expect(pool.isLocked).toBe(false);
    expect(pool.axisNumbers ?? null).toBeNull();
  });

  it('a grid that is already locked is left exactly as it is', async () => {
    const id = await missed({ isLocked: true, axisNumbers: PUBLISHED });
    const before = await poolDoc(id);
    await remind(id);
    expect(await poolDoc(id)).toEqual(before);
    const types = await auditTypes(id);
    expect(types).not.toContain('POOL_LOCKED');
    expect(types).not.toContain('DIGITS_GENERATED');
  });

  // The old copy drew with `sort(() => Math.random() - 0.5)`. Pin Math.random
  // and that sort gives the SAME order every time — both axes of every grid
  // alike. The dedicated job draws from `crypto.randomInt`, which a pinned
  // Math.random does not touch, so its draws still differ. (Chance of two
  // honest draws matching: 1 in 3,628,800.)
  it('the draw does not come from Math.random', async () => {
    const pinned = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    try {
      const a = await missed();
      const b = await missed();
      await remind(a);
      await remind(b);
      const first = (await poolDoc(a)).axisNumbers;
      const second = (await poolDoc(b)).axisNumbers;
      expect(sorted(first.home)).toEqual(DIGITS);
      expect(first.home).not.toEqual(first.away);
      expect(first.home).not.toEqual(second.home);
    } finally {
      pinned.mockRestore();
    }
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
