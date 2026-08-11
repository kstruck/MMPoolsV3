import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { createNFLPool, joinNFLPool, submitNFLPicks } from '../../nflPools';

/**
 * The invite path, end to end through the REAL callables (launch T3).
 *
 * The launch action is the commissioner sending invite links to strangers, so
 * this pins the whole journey an ordinary member takes: register (a users doc,
 * no special role) → open the link → joinNFLPool → submit a survivor pick →
 * the pick is on the entry doc the dashboard reads. No SUPER_ADMIN anywhere in
 * the member half.
 *
 * It also pins what the join deliberately does NOT require:
 *  - no invite token beyond the pool id — the link IS the invite
 *    (`joinNFLPoolInternal` gates only maintenance, the free-plan cap and the
 *    paid ceiling);
 *  - no POOLS_OPEN dependency — that flag lives in src/config/season.ts and
 *    gates pool CREATION in the client only. Nothing server-side reads it, and
 *    this suite proves a join+pick works while it is false.
 */
const test = ftest();
const db = admin.firestore();
const wCreate = test.wrap(createNFLPool);
const wJoin = test.wrap(joinNFLPool);
const wSubmit = test.wrap(submitNFLPicks);

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });
const HOUR = 60 * 60 * 1000;
const SEASON = 'invite-season';
const OWNER = 'invite-owner';
const STRANGER = 'invite-stranger';
const LURKER = 'invite-lurker'; // never joins

const GAMES = [
  { id: 'inv-w1-a', week: 1, home: 'KC', away: 'BUF' },
  { id: 'inv-w1-b', week: 1, home: 'SF', away: 'DAL' },
];

beforeAll(async () => {
  for (const g of GAMES) {
    await db.collection('nfl_games').doc(g.id).set({
      id: g.id, season: SEASON, seasonType: 1, week: g.week,
      startTime: Date.now() + 48 * HOUR, status: 'SCHEDULED', isMonday: false,
      homeTeam: T(g.home), awayTeam: T(g.away),
      scores: { home: 0, away: 0 },
      spread: { value: 0, locked: false },
    });
  }
  // Ordinary accounts — registration produces a users doc with no special role.
  await db.collection('users').doc(OWNER).set({ name: 'Pool Host', role: 'MEMBER', email: `${OWNER}@example.com` });
  await db.collection('users').doc(STRANGER).set({ name: 'Invited Stranger', role: 'PARTICIPANT', email: `${STRANGER}@example.com` });
  await db.collection('users').doc(LURKER).set({ name: 'Lurker', role: 'PARTICIPANT', email: `${LURKER}@example.com` });
}, 60000);

afterAll(() => test.cleanup());

describe('invite path — a stranger with the link (emulator)', () => {
  let poolId: string;

  it('host creates the survivor pool', async () => {
    const res = (await wCreate({
      data: {
        type: 'NFL_SURVIVOR', name: 'Invite Pool', season: SEASON, seasonType: 1,
        settings: {
          entryFee: 0, maxStrikes: 1, maxRebuys: 0, rebuyDeadlineWeek: 0, rebuyCost: 0,
          pickLosersMode: false, autoSurviveExemptionEnabled: true,
          lockBufferMinutes: 5, payouts: { places: [], bonuses: [] },
        },
      },
      auth: { uid: OWNER, token: { name: 'Pool Host' } },
    } as never)) as { poolId: string };
    poolId = res.poolId;
    expect(poolId).toBeTruthy();
  }, 60000);

  it('the stranger joins with nothing but the pool id, and lands on the roster', async () => {
    await wJoin({ data: { poolId }, auth: { uid: STRANGER, token: { name: 'Invited Stranger' } } } as never);

    const pool = (await db.collection('pools').doc(poolId).get()).data()!;
    expect(pool.participantIds).toContain(STRANGER);

    const m = (await db.collection('pools').doc(poolId).collection('members').doc(STRANGER).get()).data()!;
    expect(m.role).toBe('PARTICIPANT');
    expect(m.userName).toBe('Invited Stranger');
    expect(m.joinedAt).toEqual(expect.any(Number)); // canonical record, not a forgery shape
  }, 60000);

  it('the stranger submits a survivor pick and it is visible on the entry', async () => {
    await wSubmit({
      data: { poolId, week: 1, picks: { 1: 'KC' }, requestId: 'invite-pick-1' },
      auth: { uid: STRANGER, token: { name: 'Invited Stranger' } },
    } as never);

    // The entry doc is what the dashboard, standings and scorer all read.
    const entry = (await db.collection('pools').doc(poolId).collection('entries').doc(STRANGER).get()).data()!;
    expect(entry.picks?.['1']).toBe('KC');
    expect(entry.usedTeams).toContain('KC');
    expect(entry.status).toBe('ALIVE');
  }, 60000);

  it('without the join, the same submit is REFUSED and leaves no entry', async () => {
    await expect(wSubmit({
      data: { poolId, week: 1, picks: { 1: 'SF' }, requestId: 'lurker-pick-1' },
      auth: { uid: LURKER, token: { name: 'Lurker' } },
    } as never)).rejects.toThrow(/NOT_POOL_MEMBER/);

    expect((await db.collection('pools').doc(poolId).collection('entries').doc(LURKER).get()).exists).toBe(false);
  }, 60000);

  it('free-plan pools stop accepting joiner #11 with the upgrade message', async () => {
    // The one limit an invite wave can actually hit: billing 'free' caps the
    // roster at 10 (joinNFLPoolInternal). Seeded directly — ten join calls
    // would test the loop, not the gate.
    const cappedId = 'invite-capped-pool';
    await db.collection('pools').doc(cappedId).set({
      id: cappedId, type: 'NFL_SURVIVOR', name: 'Capped', league: 'NFL',
      season: SEASON, seasonType: 1, ownerId: OWNER, status: 'OPEN',
      billing: { status: 'free' },
      participantIds: Array.from({ length: 10 }, (_, i) => `filled-${i}`),
      settings: { entryFee: 0, payouts: { places: [], bonuses: [] } },
    });

    await expect(wJoin({
      data: { poolId: cappedId }, auth: { uid: STRANGER, token: { name: 'Invited Stranger' } },
    } as never)).rejects.toThrow(/Free Plan.*limit of 10/);
  }, 60000);
});
