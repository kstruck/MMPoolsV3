import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { executeSurvivorRebuyInternal, joinNFLPoolInternal, submitNFLPicksInternal } from '../../nflPools';
import { proxyPick } from '../../poolExceptions';
import { setPaidStatus } from '../../setPaidStatus';
import { updatePoolSettings } from '../../poolOps';

/**
 * PLAN-MULTI-ENTRY T2 — the submit/dues paths, end to end against the emulator.
 *
 *  1. entry 2 lands at `e2:${uid}` carrying ownerUid + entryIndex; the Member
 *     Record gains playableEntryCount 2 + the entries map; feeOwed 25 → 50 (K3);
 *     pool.entryCount follows.
 *  2. the cap is refused (index beyond max, and a create once max docs exist).
 *  3. K11: a PAID member who adds an entry flips to UNPAID, both entries
 *     mirror UNPAID, and a MARKED_UNPAID ledger line carries the new feeOwed.
 *  4. a legacy pool with no `entryCount` derives it from the Member Records.
 *  5. two concurrent first-submits of entry 2 and 3 → count 3, never 4.
 *  6. fee edit 25 → 30 with two entries → 60 (cascade × count).
 *  7. setPaidStatus mirrors PAID onto both entries and ledgers feeOwed (60).
 *  8. proxyPick on entry 2 leaves entry 1 untouched.
 *  9. a duplicate entryName for the same owner is refused.
 * 10. Survivor: two entries of one player may pick the same team the same week
 *     (K4); a rebuy on entry 2 leaves entry 1's strikes alone (D3).
 * 11. updatePoolSettings raising the max on a populated legacy pool initialises
 *     entryCount without any follow-up submit (D8).
 * 12. an existing single-entry pool is byte-for-byte unchanged: entry 1's id is
 *     still the uid, no entryIndex is required from the client.
 */
const test = ftest();
const db = admin.firestore();
const wProxy = test.wrap(proxyPick);
const wPaid = test.wrap(setPaidStatus);
const wUpdate = test.wrap(updatePoolSettings);

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });
const HOUR = 60 * 60 * 1000;
const SEASON = 'me-season';
const G1 = 'me-g1';
const G2 = 'me-g2';
const HOST = 'me-host';
const ALICE = 'me-alice';
const BOB = 'me-bob';
const auth = (uid: string, role?: string) => ({ uid, token: role ? { role } : {} }) as any;

let n = 0;
let POOL = '';
const createdPools: string[] = [];
const poolRef = () => db.collection('pools').doc(POOL);
const pool = async () => (await poolRef().get()).data()!;
const member = async (uid: string) => (await poolRef().collection('members').doc(uid).get()).data()!;
const entry = async (id: string) => (await poolRef().collection('entries').doc(id).get());
const ownedEntries = async (uid: string) => (await poolRef().collection('entries').where('ownerUid', '==', uid).get()).docs;
const ledger = async (uid: string) => (await poolRef().collection('payments').where('uid', '==', uid).get()).docs.map(d => d.data());

const submit = (uid: string, payload: Record<string, unknown>) =>
  submitNFLPicksInternal(db, { actorUid: uid, subjectUid: uid, subjectName: uid }, { poolId: POOL, week: 1, ...payload } as never);

async function seedPool(opts: { type?: string; max?: number; entryCount?: number | null; alicePaid?: boolean } = {}) {
  n += 1;
  POOL = `pool-me-${n}`;
  createdPools.push(POOL);
  const type = opts.type ?? 'NFL_PICKEM';
  await poolRef().set({
    name: 'Multi', type, league: 'NFL', season: SEASON, seasonType: 1,
    ownerId: HOST, managerUid: HOST, participantIds: [HOST, ALICE, BOB], status: 'OPEN', billing: { status: 'free' },
    ...(opts.entryCount === null || opts.entryCount === undefined ? {} : { entryCount: opts.entryCount }),
    settings: {
      entryFee: 25, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false,
      payouts: { places: [], bonuses: [] },
      ...(type === 'NFL_SURVIVOR' ? { maxStrikes: 0, maxRebuys: 2, rebuyDeadlineWeek: 8, rebuyCost: 10, pickLosersMode: false } : {}),
      ...(opts.max !== undefined ? { maxEntriesPerUser: opts.max } : {}),
    },
  });
  await poolRef().collection('members').doc(HOST).set({
    uid: HOST, poolId: POOL, userName: 'Host', role: 'MANAGER', joinedAt: Date.now(),
    paidStatus: 'UNPAID', feeOwed: 0, feeOwedSource: 'LIVE', hasPlayableEntry: false,
  });
  for (const uid of [ALICE, BOB]) {
    await poolRef().collection('members').doc(uid).set({
      uid, poolId: POOL, userName: uid, role: 'PARTICIPANT', joinedAt: Date.now(),
      paidStatus: uid === ALICE && opts.alicePaid ? 'PAID' : 'UNPAID',
      ...(uid === ALICE && opts.alicePaid ? { paidAt: 1_700_000_000_000, paymentMethod: 'venmo' } : {}),
      feeOwed: 25, feeOwedSource: 'LIVE',
    });
  }
}

describe('PLAN-MULTI-ENTRY T2 — submit + dues paths', () => {
  beforeEach(async () => {
    for (const uid of [HOST, ALICE, BOB]) await db.collection('users').doc(uid).set({ name: uid });
    await db.collection('nfl_games').doc(G1).set({
      id: G1, espnGameId: G1, season: SEASON, seasonType: 1, week: 1,
      startTime: Date.now() + 4 * HOUR, status: 'SCHEDULED', isMonday: false,
      homeTeam: T('KC'), awayTeam: T('BUF'), scores: { home: 0, away: 0 }, spread: { value: -3, locked: true },
    });
    await db.collection('nfl_games').doc(G2).set({
      id: G2, espnGameId: G2, season: SEASON, seasonType: 1, week: 1,
      startTime: Date.now() + 5 * HOUR, status: 'SCHEDULED', isMonday: false,
      homeTeam: T('DAL'), awayTeam: T('NYG'), scores: { home: 0, away: 0 }, spread: { value: -1, locked: true },
    });
  }, 30000);

  // Teardown (qodo #3 on #450): every doc this suite created, best-effort.
  afterAll(async () => {
    try {
      for (const id of createdPools) await db.recursiveDelete(db.collection('pools').doc(id));
      for (const id of [G1, G2]) await db.collection('nfl_games').doc(id).delete();
      for (const uid of [HOST, ALICE, BOB, 'me-carol']) await db.recursiveDelete(db.collection('users').doc(uid));
    } catch (e) {
      console.warn('[multiEntry.emulator] teardown incomplete:', e);
    }
    test.cleanup();
  }, 60000);

  it('1. entry 2 lands at e2:uid; Member Record count 2 + roster; feeOwed 25 → 50; entryCount follows', async () => {
    await seedPool({ max: 3, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });

    const e1 = await entry(ALICE);
    const e2 = await entry(`e2:${ALICE}`);
    expect(e1.exists && e2.exists).toBe(true);
    expect(e1.data()).toMatchObject({ id: ALICE, ownerUid: ALICE, entryIndex: 1, picks: { [G1]: 'KC' } });
    expect(e2.data()).toMatchObject({ id: `e2:${ALICE}`, ownerUid: ALICE, entryIndex: 2, entryName: `${ALICE} #2`, picks: { [G1]: 'BUF' } });

    const m = await member(ALICE);
    expect(m.playableEntryCount).toBe(2);
    expect(m.hasPlayableEntry).toBe(true);
    expect(m.feeOwed).toBe(50);
    expect(m.entries).toEqual({ [ALICE]: { entryIndex: 1 }, [`e2:${ALICE}`]: { entryIndex: 2, name: `${ALICE} #2` } });
    // Two liable entries were counted at seed (Alice 1, Bob 1); Alice's second adds one.
    expect((await pool()).entryCount).toBe(3);
  }, 60000);

  it('2. the cap: index beyond max, and a create once max docs exist', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await expect(submit(ALICE, { picks: { [G1]: 'KC' }, entryIndex: 3 })).rejects.toThrow(/ENTRY_INDEX_EXCEEDS_MAX/);
    // A legacy pool (setting absent) admits exactly one — the today contract.
    await seedPool({ entryCount: 2 });
    await expect(submit(ALICE, { picks: { [G1]: 'KC' }, entryIndex: 2 })).rejects.toThrow(/ENTRY_INDEX_EXCEEDS_MAX/);
    expect((await entry(`e2:${ALICE}`)).exists).toBe(false);
  }, 60000);

  it('3. K11: a PAID member who adds an entry flips UNPAID, both entries mirror it, ledger says why', async () => {
    await seedPool({ max: 2, entryCount: 2, alicePaid: true });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    expect((await member(ALICE)).paidStatus).toBe('PAID');   // a resubmit-shaped first entry changes nothing
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });

    const m = await member(ALICE);
    expect(m.paidStatus).toBe('UNPAID');
    expect(m.feeOwed).toBe(50);
    expect(m.paidAt).toBeUndefined();
    expect(m.paymentMethod).toBeUndefined();
    for (const d of await ownedEntries(ALICE)) expect(d.data().paidStatus).toBe('UNPAID');
    const lines = await ledger(ALICE);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'MARKED_UNPAID', amount: 50, actorUid: 'system' });
    expect(lines[0].note).toMatch(/dues rose from \$25 to \$50/);
    expect(lines[0].note).toMatch(/via venmo/);
  }, 60000);

  it('4. a legacy pool with no entryCount derives it from the Member Records on the first write', async () => {
    await seedPool({ max: 2, entryCount: null });
    expect((await pool()).entryCount).toBeUndefined();
    // Host: manager, never played → 0. Alice, Bob: 1 each. Alice's first submit
    // changes nothing about her liability, so entryCount = 2 exactly.
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    expect((await pool()).entryCount).toBe(2);
    // …and the field is present now, so the next write increments rather than re-derives.
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    expect((await pool()).entryCount).toBe(3);
    // The host's first playable entry starts THEIR liability (0 → 1).
    await submit(HOST, { picks: { [G1]: 'KC' } });
    expect((await pool()).entryCount).toBe(4);
    expect((await member(HOST)).feeOwed).toBe(25);
  }, 60000);

  it('4b. an ordinary member joining a legacy pool derives + increments entryCount', async () => {
    await seedPool({ entryCount: null });
    await joinNFLPoolInternal(db, { subjectUid: 'me-carol', subjectName: 'Carol' }, POOL);
    // Host 0 + Alice 1 + Bob 1 + Carol 1.
    expect((await pool()).entryCount).toBe(3);
  }, 60000);

  it('5. two concurrent first-submits of entry 2 and 3 → count 3, never 4', async () => {
    await seedPool({ max: 3, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await Promise.all([
      submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 }),
      submit(ALICE, { picks: { [G2]: 'DAL' }, entryIndex: 3 }),
    ]);
    const m = await member(ALICE);
    expect(m.playableEntryCount).toBe(3);
    expect(m.feeOwed).toBe(75);
    expect((await ownedEntries(ALICE)).length).toBe(3);
    expect((await pool()).entryCount).toBe(4);
  }, 60000);

  it('6. fee edit 25 → 30 with two entries → 60 (cascade × liable entries); Bob (one) → 30; host stays 0', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await wUpdate({
      data: { poolId: POOL, updates: { settings: { entryFee: 30, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false, maxEntriesPerUser: 2 } } },
      auth: auth(HOST),
    } as never);
    expect((await member(ALICE)).feeOwed).toBe(60);
    expect((await member(BOB)).feeOwed).toBe(30);
    expect((await member(HOST)).feeOwed).toBe(0);
  }, 60000);

  it('7. setPaidStatus mirrors PAID onto BOTH entries and ledgers feeOwed, not the pool fee', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true, paymentMethod: 'cash' }, auth: auth(HOST) } as never);
    for (const d of await ownedEntries(ALICE)) expect(d.data()).toMatchObject({ paidStatus: 'PAID', paymentMethod: 'cash' });
    const paid = (await ledger(ALICE)).filter(l => l.type === 'MARKED_PAID');
    expect(paid).toHaveLength(1);
    expect(paid[0].amount).toBe(50);
  }, 60000);

  it('8. proxyPick on entry 2 leaves entry 1 untouched (and creates it with the default name)', async () => {
    await seedPool({ type: 'NFL_SURVIVOR', max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { 1: 'KC' } });
    await wProxy({
      data: { poolId: POOL, week: 1, targetUid: ALICE, entryIndex: 2, picks: { 1: 'DAL' }, reason: 'texted me' },
      auth: auth(HOST),
    } as never);
    expect((await entry(ALICE)).data()).toMatchObject({ picks: { 1: 'KC' }, entryIndex: 1 });
    expect((await entry(ALICE)).data()!.proxySubmittedBy).toBeUndefined();
    expect((await entry(`e2:${ALICE}`)).data()).toMatchObject({
      ownerUid: ALICE, entryIndex: 2, entryName: `${ALICE} #2`, picks: { 1: 'DAL' }, proxySubmittedBy: HOST,
    });
    expect((await member(ALICE))).toMatchObject({ playableEntryCount: 2, feeOwed: 50 });
    // …and the same cap applies to the commissioner.
    await expect(wProxy({
      data: { poolId: POOL, week: 1, targetUid: ALICE, entryIndex: 3, picks: { 1: 'DAL' }, reason: 'texted me' },
      auth: auth(HOST),
    } as never)).rejects.toThrow(/ENTRY_INDEX_EXCEEDS_MAX/);
  }, 60000);

  it('9. a duplicate entryName for the same owner is refused; renaming your own entry is fine', async () => {
    await seedPool({ max: 3, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' }, entryName: 'Sharp' });
    await expect(submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2, entryName: ' sharp ' })).rejects.toThrow(/ENTRY_NAME_TAKEN/);
    expect((await entry(`e2:${ALICE}`)).exists).toBe(false);
    await submit(ALICE, { picks: { [G1]: 'KC' }, entryName: 'Sharper' });
    expect((await entry(ALICE)).data()!.entryName).toBe('Sharper');
    expect((await member(ALICE)).entries[ALICE]).toEqual({ entryIndex: 1, name: 'Sharper' });
    // Bob may use Alice's name — uniqueness is per owner.
    await submit(BOB, { picks: { [G1]: 'KC' }, entryName: 'Sharper' });
  }, 60000);

  it('10. Survivor: two entries may pick the same team the same week (K4); a rebuy names an entry (D3)', async () => {
    await seedPool({ type: 'NFL_SURVIVOR', max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { 1: 'KC' } });
    await submit(ALICE, { picks: { 1: 'KC' }, entryIndex: 2 });   // NOT TEAM_ALREADY_USED — independent contestants
    expect((await entry(`e2:${ALICE}`)).data()!.usedTeams).toEqual(['KC']);
    // Eliminate entry 2 by hand, rebuy it: entry 1 keeps its life; the ledger names e2.
    await poolRef().collection('entries').doc(`e2:${ALICE}`).update({ status: 'ELIMINATED', strikesUsed: 1, eliminatedWeek: 1 });
    await executeSurvivorRebuyInternal(db, { actorUid: ALICE, subjectUid: ALICE }, { poolId: POOL, week: 2, entryIndex: 2 });
    expect((await entry(`e2:${ALICE}`)).data()).toMatchObject({ status: 'ALIVE', rebuysUsed: 1, strikesUsed: 0 });
    expect((await entry(ALICE)).data()).toMatchObject({ status: 'ALIVE', rebuysUsed: 0 });
    expect((await member(ALICE)).rebuyOwed).toBe(10);
    const due = (await ledger(ALICE)).filter(l => l.type === 'REBUY_DUE');
    expect(due[0].entryId).toBe(`e2:${ALICE}`);
    // A rebuy on an entry that does not exist is not-found, never a create.
    await expect(executeSurvivorRebuyInternal(db, { actorUid: BOB, subjectUid: BOB }, { poolId: POOL, week: 2, entryIndex: 2 }))
      .rejects.toThrow(/not found/);
  }, 60000);

  it('11. raising the max on a populated legacy pool initialises entryCount with no follow-up submit', async () => {
    await seedPool({ entryCount: null });
    await wUpdate({
      data: { poolId: POOL, updates: { settings: { entryFee: 25, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false, maxEntriesPerUser: 3 } } },
      auth: auth(HOST),
    } as never);
    const p = await pool();
    expect(p.settings.maxEntriesPerUser).toBe(3);
    expect(p.entryCount).toBe(2);   // host 0 + Alice 1 + Bob 1
  }, 60000);

  it('13. a legacy entries/{uid} doc with NO ownerUid still counts when entry 2 is created (codex r4 on #450)', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    // Pre-T2 shape: no ownerUid, no entryIndex, one real pick.
    await poolRef().collection('entries').doc(ALICE).set({
      id: ALICE, poolId: POOL, userName: ALICE, picks: { [G1]: 'KC' }, totalScore: 0, submittedAt: 1, paidStatus: 'UNPAID',
    });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    const m = await member(ALICE);
    expect(m.playableEntryCount).toBe(2);
    expect(m.feeOwed).toBe(50);
    expect(Object.keys(m.entries).sort()).toEqual([ALICE, `e2:${ALICE}`].sort());
    expect((await pool()).entryCount).toBe(3);
    // …and the cap sees it: a third is refused on a max-2 pool.
    await expect(submit(ALICE, { picks: { [G1]: 'KC' }, entryIndex: 3 })).rejects.toThrow(/ENTRY_INDEX_EXCEEDS_MAX/);
    // Legacy doc untouched except nothing — entry 1 keeps its pick.
    expect((await entry(ALICE)).data()!.picks[G1]).toBe('KC');
  }, 60000);

  it('12. an existing single-entry pool is unchanged: no entryIndex from the client, entry id === uid, feeOwed 25', async () => {
    await seedPool({ entryCount: null });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    const e = await entry(ALICE);
    expect(e.exists).toBe(true);
    expect(e.data()).toMatchObject({ id: ALICE, ownerUid: ALICE, entryIndex: 1 });
    expect(e.data()!.entryName).toBeUndefined();
    const m = await member(ALICE);
    expect(m.feeOwed).toBe(25);
    expect(m.playableEntryCount).toBe(1);
    expect(m.entries).toEqual({ [ALICE]: { entryIndex: 1 } });
    // Idempotent resubmit still no-ops on requestId.
    await submitNFLPicksInternal(db, { actorUid: ALICE, subjectUid: ALICE, requestId: 'r1' }, { poolId: POOL, week: 1, picks: { [G1]: 'BUF' } } as never);
    await submitNFLPicksInternal(db, { actorUid: ALICE, subjectUid: ALICE, requestId: 'r1' }, { poolId: POOL, week: 1, picks: { [G1]: 'KC' } } as never);
    expect((await entry(ALICE)).data()!.picks[G1]).toBe('BUF');
  }, 60000);
});
