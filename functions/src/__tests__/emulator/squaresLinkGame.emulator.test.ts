import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { linkSquaresPoolGame } from '../../squaresAdmin';
import { FEED_FIXTURE_COLLECTION, feedFixtureDocId } from '../../lib/squaresFeedGame';

/**
 * linkSquaresPoolGame against the emulator (PLAN-SQUARES-SERVER-FIELDS §2b;
 * plan K11).
 *
 * The manage page used to write a game link straight onto the pool, as the
 * browser described the game. These drive the REAL callable: the game is
 * looked up in the feed — in an emulator run, the fixture document — and what
 * is stored is what the feed says, or nothing at all.
 */
const test = ftest();
const db = admin.firestore();
const link = test.wrap(linkSquaresPoolGame);

const OWNER = 'owner-1';
const STRANGER = 'stranger-1';
const ADMIN = 'admin-1';
const POOL = 'sq-link';
const GAME = '401772510';
const HOUR = 3_600_000;
const LOGO = 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png';

const owner = { uid: OWNER, token: { role: 'COMMISSIONER', name: 'Olivia Owner' } };
const stranger = { uid: STRANGER, token: { role: 'MEMBER' } };
const superAdmin = { uid: ADMIN, token: { role: 'SUPER_ADMIN' } };

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const poolRef = () => db.collection('pools').doc(POOL);
const pool = async (): Promise<Doc> => (await poolRef().get()).data() as Doc;
const audits = async (): Promise<Doc[]> => (await poolRef().collection('audit').get()).docs.map((d) => d.data() as Doc);

async function seedFeed(gameId: string, game: Doc) {
  await db.collection(FEED_FIXTURE_COLLECTION).doc(feedFixtureDocId(gameId)).set(game);
}
async function seedPool(over: Doc = {}) {
  await poolRef().set({
    id: POOL, name: 'Thanksgiving squares', type: 'SQUARES', ownerId: OWNER, createdByUid: OWNER,
    status: 'DRAFT', createdAt: admin.firestore.Timestamp.now(), isLocked: false,
    homeTeam: 'Home', awayTeam: 'Away',
    scores: { current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre' },
    reminders: { payment: { enabled: false } },
    ...over,
  });
}
const call = (data: Doc, auth: Doc = owner) => link({ data, auth } as never) as Promise<Doc>;

beforeEach(async () => {
  for (const col of ['pools', 'users', 'admin_audit', FEED_FIXTURE_COLLECTION]) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => db.recursiveDelete(d.ref)));
  }
  await db.collection('users').doc(OWNER).set({ role: 'COMMISSIONER' });
  await db.collection('users').doc(STRANGER).set({ role: 'MEMBER' });
  await db.collection('users').doc(ADMIN).set({ role: 'SUPER_ADMIN' });
});

afterAll(() => test.cleanup());

describe('linkSquaresPoolGame — the link is what the FEED says', () => {
  it('links an unlocked pool: the feed\'s kickoff, teams and badge, and the grid locks itself at kickoff', async () => {
    const kickoff = Date.now() + 48 * HOUR;
    await seedFeed(GAME, { kickoff, state: 'pre', homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers', homeLogo: LOGO, seasonType: '2', week: 13 });
    await seedPool();
    const res = await call({ poolId: POOL, gameId: GAME, league: 'nfl' });
    expect(res).toEqual({ linked: true, gameId: GAME, homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers', kickoff });

    const p = await pool();
    expect(p.gameId).toBe(GAME);
    expect(p.gameTime).toBe(kickoff);
    expect(p.league).toBe('nfl');
    expect(p.homeTeam).toBe('Detroit Lions');
    expect(p.awayTeam).toBe('Green Bay Packers');
    expect(p.homeTeamLogo).toBe(LOGO);
    expect(p.seasonType).toBe('2');
    expect(p.week).toBe(13);
    expect(p.reminders.lock).toMatchObject({ enabled: true, lockAt: kickoff });
    expect(p.reminders.payment).toEqual({ enabled: false });        // other reminder settings untouched
    expect(p.scores.startTime).toBe(new Date(kickoff).toISOString());
    expect(p.name).toBe('Thanksgiving squares');                       // the name is not the server's to change

    const audit = await audits();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ type: 'POOL_GAME_LINKED', payload: { gameId: GAME, league: 'nfl', kickoff } });
  });

  it('the league is the one asked for', async () => {
    await seedFeed(GAME, { kickoff: Date.now() + 48 * HOUR, state: 'pre', homeTeam: 'Michigan', awayTeam: 'Ohio State' });
    await seedPool();
    await call({ poolId: POOL, gameId: GAME, league: 'college' });
    expect((await pool()).league).toBe('college');
  });

  it('a game the feed says is under way is REFUSED and nothing is written', async () => {
    await seedFeed(GAME, { kickoff: Date.now() + 48 * HOUR, state: 'in', homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers' });
    await seedPool();
    await expect(call({ poolId: POOL, gameId: GAME })).rejects.toThrow(/already kicked off/);
    expect('gameId' in (await pool())).toBe(false);
    expect(await audits()).toHaveLength(0);
  });

  it('a game whose kickoff has passed by the SERVER\'s clock is REFUSED', async () => {
    await seedFeed(GAME, { kickoff: Date.now() - 1000, state: 'pre', homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers' });
    await seedPool();
    await expect(call({ poolId: POOL, gameId: GAME })).rejects.toThrow(/already kicked off/);
    expect('gameId' in (await pool())).toBe(false);
  });

  it('a game the feed cannot make a link of is REFUSED as not found', async () => {
    await seedFeed(GAME, { kickoff: Date.now() + 48 * HOUR, state: 'pre', homeTeam: '', awayTeam: 'Green Bay Packers' });
    await seedPool();
    await expect(call({ poolId: POOL, gameId: GAME })).rejects.toThrow(/not found on the schedule/);
    expect('gameId' in (await pool())).toBe(false);
  });

  it('nothing but the event id is accepted — teams or a kickoff in the request are refused by the schema', async () => {
    await seedPool();
    await expect(call({ poolId: POOL, gameId: GAME, homeTeam: 'X' })).rejects.toThrow();
    await expect(call({ poolId: POOL, gameId: GAME, gameTime: Date.now() + HOUR })).rejects.toThrow();
    await expect(call({ poolId: POOL, gameId: '401772510/../x' })).rejects.toThrow();
    expect('gameId' in (await pool())).toBe(false);
  });
});

describe('linkSquaresPoolGame — who, and when', () => {
  beforeEach(async () => {
    await seedFeed(GAME, { kickoff: Date.now() + 48 * HOUR, state: 'pre', homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers' });
  });

  it('a player who does not own the pool is REFUSED', async () => {
    await seedPool();
    await expect(call({ poolId: POOL, gameId: GAME }, stranger)).rejects.toThrow(/permission/);
    expect('gameId' in (await pool())).toBe(false);
  });

  it('a SUPER_ADMIN may link a pool they do not own, and that is put on the admin audit', async () => {
    await seedPool();
    await call({ poolId: POOL, gameId: GAME }, superAdmin);
    expect((await pool()).gameId).toBe(GAME);
    const adminAudit = (await db.collection('admin_audit').get()).docs.map((d) => d.data() as Doc);
    expect(adminAudit.some((a) => a.action === 'SQUARES_LINK_GAME' && a.targetId === POOL)).toBe(true);
  });

  it('a LOCKED grid is REFUSED — reopen it first', async () => {
    await seedPool({ isLocked: true });
    await expect(call({ poolId: POOL, gameId: GAME })).rejects.toThrow(/locked/);
    expect('gameId' in (await pool())).toBe(false);
  });

  it('a pool of another type is REFUSED', async () => {
    await seedPool({ type: 'NFL_PICKEM' });
    await expect(call({ poolId: POOL, gameId: GAME })).rejects.toThrow(/not a squares pool/);
  });

  it('a pool that does not exist is REFUSED', async () => {
    await expect(call({ poolId: 'nope', gameId: GAME })).rejects.toThrow(/not found/i);
  });
});

describe('linkSquaresPoolGame — unlinking', () => {
  it('clears the link and switches off the kickoff lock, keeping the lock time for a re-link', async () => {
    const kickoff = Date.now() + 48 * HOUR;
    await seedPool({ gameId: GAME, gameTime: kickoff, league: 'nfl', reminders: { lock: { enabled: true, lockAt: kickoff, scheduleMinutes: [] } } });
    expect(await call({ poolId: POOL, gameId: null })).toEqual({ linked: false, changed: true });
    const p = await pool();
    expect('gameId' in p).toBe(false);
    expect('gameTime' in p).toBe(false);
    expect('league' in p).toBe(false);
    expect(p.reminders.lock).toEqual({ enabled: false, lockAt: kickoff, scheduleMinutes: [] });
    expect((await audits())[0]).toMatchObject({ type: 'POOL_GAME_LINKED', payload: { unlinked: GAME } });
  });

  it('unlinking a pool with no game changes nothing', async () => {
    await seedPool();
    expect(await call({ poolId: POOL, gameId: null })).toEqual({ linked: false, changed: false });
    expect(await audits()).toHaveLength(0);
  });

  it('unlinking a LOCKED grid is REFUSED', async () => {
    await seedPool({ isLocked: true, gameId: GAME, gameTime: Date.now() + HOUR, league: 'nfl' });
    await expect(call({ poolId: POOL, gameId: null })).rejects.toThrow(/locked/);
    expect((await pool()).gameId).toBe(GAME);
  });
});

describe('linkSquaresPoolGame — changing the game (qodo #765, findings 1 and 9)', () => {
  const OTHER = '401772599';
  const oldKickoff = () => Date.now() + 24 * HOUR;
  const seedLinkedTo = (over: Doc = {}) => {
    const kickoff = oldKickoff();
    return seedPool({
      gameId: OTHER, gameTime: kickoff, league: 'nfl', homeTeam: 'Old Home', awayTeam: 'Old Away',
      homeTeamLogo: LOGO, awayTeamLogo: LOGO, seasonType: '3', week: 1,
      scores: { current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre', startTime: new Date(kickoff).toISOString(), leftover: 'old game' },
      ...over,
    });
  };

  it('a different game starts from fresh scores, and the old game\'s badges, season type and week are cleared', async () => {
    const kickoff = Date.now() + 48 * HOUR;
    await seedFeed(GAME, { kickoff, state: 'pre', homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers' }); // no badges, no week
    await seedLinkedTo();
    await call({ poolId: POOL, gameId: GAME });
    const p = await pool();
    expect(p.gameId).toBe(GAME);
    expect(p.scores.startTime).toBe(new Date(kickoff).toISOString());
    expect('leftover' in p.scores).toBe(false);
    for (const k of ['homeTeamLogo', 'awayTeamLogo', 'seasonType', 'week']) expect(k in p).toBe(false);
  });

  it('re-linking the SAME game keeps the scores it has', async () => {
    await seedFeed(OTHER, { kickoff: oldKickoff(), state: 'pre', homeTeam: 'Old Home', awayTeam: 'Old Away' });
    await seedLinkedTo();
    await call({ poolId: POOL, gameId: OTHER });
    expect((await pool()).scores.leftover).toBe('old game');
  });

  it('a grid whose scores show a game PLAYED cannot be moved to another game; nothing is written', async () => {
    await seedFeed(GAME, { kickoff: Date.now() + 48 * HOUR, state: 'pre', homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers' });
    await seedLinkedTo({ scores: { gameStatus: 'post', final: { home: 24, away: 17 }, current: { home: 24, away: 17 } } });
    await expect(call({ poolId: POOL, gameId: GAME })).rejects.toThrow(/already has scores or winners/);
    const p = await pool();
    expect(p.gameId).toBe(OTHER);
    expect(p.homeTeamLogo).toBe(LOGO);
    expect(await audits()).toHaveLength(0);
  });

  it('a grid with a winner on record cannot be moved to another game, even with its scores cleared', async () => {
    await seedFeed(GAME, { kickoff: Date.now() + 48 * HOUR, state: 'pre', homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers' });
    await seedPool(); // unlinked, scores show nothing
    await poolRef().collection('winners').doc('q1').set({ period: 'q1', squareId: 3, owner: 'Ann', amount: 25 });
    await expect(call({ poolId: POOL, gameId: GAME })).rejects.toThrow(/already has scores or winners/);
    expect('gameId' in (await pool())).toBe(false);
  });
});
