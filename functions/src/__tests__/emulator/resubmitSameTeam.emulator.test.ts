import { describe, it, expect, beforeAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { submitNFLPicks } from '../../nflPools';
import { proxyPick } from '../../poolExceptions';

/**
 * Re-submitting the team you already picked THIS week must succeed.
 *
 * `usedTeams` is a season-long ledger and it already contains this week's own
 * saved pick, but the reuse guard tested the whole ledger. So a Survivor or
 * Margin member who re-submitted the same team — double-checking their pick, or
 * a client retrying a request whose response was lost — got
 * `TEAM_ALREADY_USED: You have already picked the CAR this season.` about a pick
 * that was safely in, rendered to them as a FAILED SAVE.
 *
 * The write path immediately below the guard has always excluded the current
 * week (`usedTeams.filter(t => t !== picks[week])`); only the guard did not, so
 * the two disagreed about what "used" means. That is why an emulator test and
 * not a unit test: nothing about either expression was wrong in isolation.
 *
 * The client gained a local short-circuit for this in #378, which stopped
 * members SEEING it, but the server was still wrong — and the client
 * short-circuit cannot help a retry, a proxy path, or any future caller.
 *
 * ⚠️ This test also pins the guard STILL WORKS: re-picking a team used in a
 * DIFFERENT week must still be rejected. A fix that simply deleted the guard
 * would pass the first assertion and break Survivor's central rule.
 */
const test = ftest();
const db = admin.firestore();
const wSubmit = test.wrap(submitNFLPicks);

const wProxy = test.wrap(proxyPick);

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });
const HOUR = 60 * 60 * 1000;
const SEASON = 'resubmit-season';
const MEMBER = 'resubmit-member';
const COMMISH_UID = 'commish-rs';
const AUTH = { uid: MEMBER, token: {} } as never;
const COMMISH = { uid: COMMISH_UID, token: { role: 'SUPER_ADMIN' } } as never;

// Three weeks of games so "used in another week" and a third use are both
// representable. ARI plays every week on purpose — it is the reuse subject.
const GAMES = [
  { id: 'rs-w1-a', week: 1, home: 'ARI', away: 'CAR' },
  { id: 'rs-w1-b', week: 1, home: 'BUF', away: 'MIA' },
  { id: 'rs-w2-a', week: 2, home: 'KC', away: 'DEN' },
  { id: 'rs-w2-b', week: 2, home: 'ARI', away: 'SF' },
  { id: 'rs-w3-a', week: 3, home: 'ARI', away: 'MIA' },
  { id: 'rs-w3-b', week: 3, home: 'KC', away: 'BUF' },
];

async function seedPool(
  poolId: string,
  type: 'NFL_SURVIVOR' | 'NFL_MARGIN',
  extraSettings: Record<string, unknown> = {},
) {
  await db.collection('pools').doc(poolId).set({
    name: `${type} resubmit`, type, league: 'NFL',
    season: SEASON, seasonType: 1,
    ownerId: COMMISH_UID, participantIds: [COMMISH_UID, MEMBER],
    status: 'OPEN', billing: { status: 'free' },
    settings: { entryFee: 0, lockBufferMinutes: 5, payouts: { places: [], bonuses: [] }, ...extraSettings },
  });
}

const entryOf = (poolId: string) =>
  db.collection('pools').doc(poolId).collection('entries').doc(MEMBER).get().then(s => s.data());

beforeAll(async () => {
  for (const g of GAMES) {
    await db.collection('nfl_games').doc(g.id).set({
      id: g.id, season: SEASON, seasonType: 1, week: g.week,
      // Far enough out that no lock or buffer interferes with the assertions.
      startTime: Date.now() + 48 * HOUR, status: 'SCHEDULED', isMonday: false,
      homeTeam: T(g.home), awayTeam: T(g.away),
      scores: { home: 0, away: 0 },
      // Deliberately UNLOCKED: neither pool type reads a spread, and the
      // SPREADS_NOT_LOCKED gate is scoped to ATS pick'em (#214). If that
      // scoping ever regresses, these submits fail and this test says so.
      spread: { value: 0, locked: false },
    });
  }
  await db.collection('users').doc(MEMBER).set({ name: 'Robin' });
}, 60000);

describe.each([
  ['NFL_SURVIVOR', 'pool-resubmit-survivor'],
  ['NFL_MARGIN', 'pool-resubmit-margin'],
] as const)('%s — re-submitting this week\'s own pick', (type, poolId) => {
  beforeAll(async () => {
    await seedPool(poolId, type);
  }, 60000);

  it('accepts the first pick of the week', async () => {
    await wSubmit({
      data: { poolId, week: 1, picks: { 1: 'CAR' }, requestId: `${poolId}-r1` },
      auth: AUTH,
    } as never);

    const entry = (await db.collection('pools').doc(poolId).collection('entries').doc(MEMBER).get()).data();
    expect(entry?.picks?.['1']).toBe('CAR');
    expect(entry?.usedTeams).toContain('CAR');
  }, 60000);

  it('accepts the SAME team again for the SAME week — this is the fix', async () => {
    // Before the fix this threw
    // `TEAM_ALREADY_USED: You have already picked the CAR this season.`
    await expect(
      wSubmit({
        data: { poolId, week: 1, picks: { 1: 'CAR' }, requestId: `${poolId}-r2` },
        auth: AUTH,
      } as never),
    ).resolves.toBeDefined();

    const entry = (await db.collection('pools').doc(poolId).collection('entries').doc(MEMBER).get()).data();
    expect(entry?.picks?.['1']).toBe('CAR');
    // And the ledger did not grow a duplicate.
    expect(entry?.usedTeams.filter((t: string) => t === 'CAR')).toHaveLength(1);
  }, 60000);

  it('still lets the member CHANGE this week\'s pick, releasing the old team', async () => {
    await wSubmit({
      data: { poolId, week: 1, picks: { 1: 'ARI' }, requestId: `${poolId}-r3` },
      auth: AUTH,
    } as never);

    const entry = (await db.collection('pools').doc(poolId).collection('entries').doc(MEMBER).get()).data();
    expect(entry?.picks?.['1']).toBe('ARI');
    expect(entry?.usedTeams).toContain('ARI');
    // CAR was only ever used in week 1, so changing away from it frees it.
    expect(entry?.usedTeams).not.toContain('CAR');
  }, 60000);

  it('STILL REJECTS a team already used in a DIFFERENT week', async () => {
    // Guard the fix: deleting the reuse check would pass every assertion above
    // and destroy the one rule Survivor is built on. ARI is week 1's pick, and
    // ARI also plays in week 2.
    await expect(
      wSubmit({
        data: { poolId, week: 2, picks: { 2: 'ARI' }, requestId: `${poolId}-r4` },
        auth: AUTH,
      } as never),
    ).rejects.toThrow(/TEAM_ALREADY_USED/);

    const entry = (await db.collection('pools').doc(poolId).collection('entries').doc(MEMBER).get()).data();
    expect(entry?.picks?.['2']).toBeUndefined();
  }, 60000);
});

/**
 * PLAN-SURVIVOR-PARITY-SCORING Phase 2 — `settings.maxTeamUses`.
 *
 * The reuse guard exists in THREE places (submit, proxy, client grid) and this
 * file is where the first two are pinned against each other. A commissioner
 * proxy pick that refused a reuse the member could submit themselves would be
 * the same class of bug as #384: two expressions with different opinions about
 * what "used" means.
 *
 * These run against the emulator rather than as unit tests for the same reason
 * #384 did: nothing about either expression is wrong in isolation.
 */
describe('NFL_SURVIVOR maxTeamUses — the submit guard', () => {
  const POOL = 'pool-resubmit-reuse-2';

  beforeAll(async () => {
    await seedPool(POOL, 'NFL_SURVIVOR', { maxTeamUses: 2 });
  }, 60000);

  it('accepts a SECOND use of the same team — one use left', async () => {
    await wSubmit({ data: { poolId: POOL, week: 1, picks: { 1: 'ARI' }, requestId: 'ru2-1' }, auth: AUTH } as never);
    await expect(
      wSubmit({ data: { poolId: POOL, week: 2, picks: { 2: 'ARI' }, requestId: 'ru2-2' }, auth: AUTH } as never),
    ).resolves.toBeDefined();

    const entry = await entryOf(POOL);
    expect(entry?.picks?.['2']).toBe('ARI');
    // The ledger is a SET of teams ever picked — it does not grow a duplicate.
    expect(entry?.usedTeams.filter((t: string) => t === 'ARI')).toHaveLength(1);
  }, 60000);

  it('REJECTS the third use, and says what the limit is', async () => {
    await expect(
      wSubmit({ data: { poolId: POOL, week: 3, picks: { 3: 'ARI' }, requestId: 'ru2-3' }, auth: AUTH } as never),
    ).rejects.toThrow(/TEAM_ALREADY_USED.*ARI 2 times/);
    expect((await entryOf(POOL))?.picks?.['3']).toBeUndefined();
  }, 60000);

  it('still accepts re-submitting THIS week own pick at the limit', async () => {
    // The current week is excluded by construction, so a member double-checking
    // a pick that is already at the limit is not making a third use.
    await expect(
      wSubmit({ data: { poolId: POOL, week: 2, picks: { 2: 'ARI' }, requestId: 'ru2-4' }, auth: AUTH } as never),
    ).resolves.toBeDefined();
    expect((await entryOf(POOL))?.picks?.['2']).toBe('ARI');
  }, 60000);

  it('CHANGING a duplicated week keeps the team in the ledger — the other week still holds it', async () => {
    // The bug the derived rewrite exists to stop: remove-then-re-add assumes one
    // use per team, so this would have stripped ARI entirely despite week 1.
    await wSubmit({ data: { poolId: POOL, week: 2, picks: { 2: 'SF' }, requestId: 'ru2-5' }, auth: AUTH } as never);

    const entry = await entryOf(POOL);
    expect(entry?.picks?.['1']).toBe('ARI');
    expect(entry?.picks?.['2']).toBe('SF');
    expect(entry?.usedTeams).toContain('ARI');
    expect(entry?.usedTeams).toContain('SF');
  }, 60000);
});

describe('NFL_SURVIVOR maxTeamUses 0 — unlimited', () => {
  const POOL = 'pool-resubmit-reuse-0';

  beforeAll(async () => {
    await seedPool(POOL, 'NFL_SURVIVOR', { maxTeamUses: 0 });
  }, 60000);

  it('accepts the same team in every week', async () => {
    for (const week of [1, 2, 3]) {
      await expect(
        wSubmit({ data: { poolId: POOL, week, picks: { [week]: 'ARI' }, requestId: `ru0-${week}` }, auth: AUTH } as never),
      ).resolves.toBeDefined();
    }
    const entry = await entryOf(POOL);
    expect([entry?.picks?.['1'], entry?.picks?.['2'], entry?.picks?.['3']]).toEqual(['ARI', 'ARI', 'ARI']);
  }, 60000);
});

describe('NFL_SURVIVOR maxTeamUses — proxyPick enforces the SAME limit', () => {
  const POOL = 'pool-resubmit-reuse-proxy';

  beforeAll(async () => {
    await seedPool(POOL, 'NFL_SURVIVOR', { maxTeamUses: 2 });
    await db.collection('pools').doc(POOL).collection('members').doc(MEMBER)
      .set({ userName: 'Robin', role: 'PARTICIPANT', paidStatus: 'UNPAID', hasPlayableEntry: false });
  }, 60000);

  it('accepts a proxy reuse the member could have submitted themselves', async () => {
    await wProxy({
      data: { poolId: POOL, targetUid: MEMBER, week: 1, picks: { 1: 'ARI' }, reason: 'texted their pick in' },
      auth: COMMISH,
    } as never);
    await expect(
      wProxy({
        data: { poolId: POOL, targetUid: MEMBER, week: 2, picks: { 2: 'ARI' }, reason: 'texted their pick in' },
        auth: COMMISH,
      } as never),
    ).resolves.toBeDefined();
    expect((await entryOf(POOL))?.picks?.['2']).toBe('ARI');
  }, 60000);

  it('REJECTS the third use, exactly as the member submit path does', async () => {
    await expect(
      wProxy({
        data: { poolId: POOL, targetUid: MEMBER, week: 3, picks: { 3: 'ARI' }, reason: 'texted their pick in' },
        auth: COMMISH,
      } as never),
    ).rejects.toThrow(/TEAM_ALREADY_USED/);
    expect((await entryOf(POOL))?.picks?.['3']).toBeUndefined();
  }, 60000);

  it('keeps the ledger correct when a duplicated week is changed', async () => {
    await wProxy({
      data: { poolId: POOL, targetUid: MEMBER, week: 2, picks: { 2: 'SF' }, reason: 'corrected' },
      auth: COMMISH,
    } as never);
    const entry = await entryOf(POOL);
    expect(entry?.usedTeams).toContain('ARI'); // week 1 still holds it
    expect(entry?.usedTeams).toContain('SF');
  }, 60000);
});

describe('a DIVERGENT usedTeams ledger keeps its authority at the default limit', () => {
  // The legacy-entry guarantee. Seeded entries exist whose usedTeams does not
  // match picks; at maxTeamUses absent or 1 the guard must still read the
  // ledger, or those entries change behaviour on a pool nobody reconfigured.
  it.each([
    ['absent', 'pool-divergent-absent', {}],
    ['explicit 1', 'pool-divergent-one', { maxTeamUses: 1 }],
  ])('rejects a team the LEDGER knows but picks does not (%s)', async (_label, poolId, settings) => {
    await seedPool(poolId, 'NFL_SURVIVOR', settings);
    await db.collection('pools').doc(poolId).collection('entries').doc(MEMBER).set({
      id: MEMBER, poolId, ownerUid: MEMBER, userName: 'Robin',
      status: 'ALIVE', strikesUsed: 0, rebuysUsed: 0,
      usedTeams: ['ARI'], picks: {}, exemptWeeks: [], submittedAt: 0, paidStatus: 'UNPAID',
    });

    await expect(
      wSubmit({ data: { poolId, week: 1, picks: { 1: 'ARI' }, requestId: `${poolId}-d1` }, auth: AUTH } as never),
    ).rejects.toThrow(/TEAM_ALREADY_USED/);
  }, 60000);
});
