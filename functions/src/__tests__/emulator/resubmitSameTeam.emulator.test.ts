import { describe, it, expect, beforeAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { submitNFLPicks } from '../../nflPools';

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

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });
const HOUR = 60 * 60 * 1000;
const SEASON = 'resubmit-season';
const MEMBER = 'resubmit-member';
const AUTH = { uid: MEMBER, token: {} } as never;

// Two weeks of games so "used in another week" is representable.
const GAMES = [
  { id: 'rs-w1-a', week: 1, home: 'ARI', away: 'CAR' },
  { id: 'rs-w1-b', week: 1, home: 'BUF', away: 'MIA' },
  { id: 'rs-w2-a', week: 2, home: 'KC', away: 'DEN' },
  { id: 'rs-w2-b', week: 2, home: 'ARI', away: 'SF' },
];

async function seedPool(poolId: string, type: 'NFL_SURVIVOR' | 'NFL_MARGIN') {
  await db.collection('pools').doc(poolId).set({
    name: `${type} resubmit`, type, league: 'NFL',
    season: SEASON, seasonType: 1,
    ownerId: 'commish-rs', participantIds: ['commish-rs', MEMBER],
    status: 'OPEN', billing: { status: 'free' },
    settings: { entryFee: 0, lockBufferMinutes: 5, payouts: { places: [], bonuses: [] } },
  });
}

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
