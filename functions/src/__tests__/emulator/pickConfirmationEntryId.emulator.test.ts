import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { submitNFLPicksInternal } from '../../nflPools';
import type { CommittedPickSave } from '../../nflPickConfirmation';

/**
 * Pick confirmation email — the `committed` out-param (CommittedPickSave) the submitNFLPicks
 * callable keys the email off (nflPickConfirmation.ts).
 *
 * - a real save reports the id of the entry it wrote, and that doc holds the
 *   MERGED picks the email is built from (an earlier stored pick survives a save that
 *   omits it — the reason the email uses the save, not the input);
 * - a requestId replay reports nothing, so a client resend emails nothing;
 * - the response shape is unchanged: still exactly `{ success: true }`.
 */
const test = ftest();
const db = admin.firestore();

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });
const HOUR = 60 * 60 * 1000;
const SEASON = 'pick-confirm-season';
const G1 = 'pick-confirm-g1';
const G2 = 'pick-confirm-g2';
const HOST = 'pick-confirm-host';
const MEMBER = 'pick-confirm-member';
const POOL = 'pool-pick-confirm';

const wipe = async () => {
  await db.recursiveDelete(db.collection('pools').doc(POOL)).catch(() => undefined);
  for (const uid of [HOST, MEMBER]) await db.recursiveDelete(db.collection('users').doc(uid)).catch(() => undefined);
  for (const g of [G1, G2]) await db.collection('nfl_games').doc(g).delete().catch(() => undefined);
};

const seedGame = (id: string, home: string, away: string) =>
  db.collection('nfl_games').doc(id).set({
    id, espnGameId: id, season: SEASON, seasonType: 2, week: 1,
    startTime: Date.now() + 4 * HOUR, status: 'SCHEDULED', isMonday: false,
    homeTeam: T(home), awayTeam: T(away), scores: { home: 0, away: 0 }, spread: { value: -3, locked: true },
  });

describe('submitNFLPicksInternal reports the committed entry for the confirmation email', () => {
  beforeAll(async () => {
    await wipe();
    await seedGame(G1, 'KC', 'BUF');
    await seedGame(G2, 'MIA', 'NYJ');
    for (const uid of [HOST, MEMBER]) await db.collection('users').doc(uid).set({ name: uid });
    await db.collection('pools').doc(POOL).set({
      name: 'Pick confirm', type: 'NFL_PICKEM', league: 'NFL', season: SEASON, seasonType: 2,
      ownerId: HOST, managerUid: HOST, participantIds: [HOST, MEMBER], status: 'OPEN', billing: { status: 'free' },
      settings: { entryFee: 0, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false },
    });
  }, 30000);

  afterAll(async () => {
    await wipe();
    await test.cleanup();
  }, 30000);

  const submit = (picks: Record<string, string>, requestId: string, committed: CommittedPickSave) =>
    submitNFLPicksInternal(db, { actorUid: MEMBER, subjectUid: MEMBER, subjectName: MEMBER, requestId }, {
      poolId: POOL, week: 1, picks,
    }, committed);

  it('a real save sets entryId to the written doc, which holds the merged picks', async () => {
    const first: CommittedPickSave = {};
    await expect(submit({ [G1]: 'KC' }, 'req-1', first)).resolves.toEqual({ success: true });
    expect(first.entryId).toBe(MEMBER);

    const second: CommittedPickSave = {};
    await submit({ [G2]: 'MIA' }, 'req-2', second);
    expect(second.entryId).toBe(MEMBER);
    // The snapshot carries the MERGED picks — G1 survives a save that omitted it —
    // and matches what landed in the doc.
    expect(second.picks).toEqual({ [G1]: 'KC', [G2]: 'MIA' });
    expect(second.confidence).toBeNull();
    const entry = (await db.collection('pools').doc(POOL).collection('entries').doc(second.entryId!).get()).data()!;
    expect(entry.picks).toEqual(second.picks);
  });

  it('a requestId replay leaves entryId unset and still answers { success: true }', async () => {
    const replay: CommittedPickSave = {};
    await expect(submit({ [G2]: 'MIA' }, 'req-2', replay)).resolves.toEqual({ success: true });
    expect(replay).toEqual({});
  });
});
