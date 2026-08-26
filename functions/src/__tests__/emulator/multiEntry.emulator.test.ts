import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { createNFLPool, executeSurvivorRebuyInternal, joinNFLPoolInternal, submitNFLPicksInternal, scoreNFLWeekInternal } from '../../nflPools';
import { renameNFLEntryInternal } from '../../nflEntryRename';
import { deleteNFLEntryInternal } from '../../nflEntryDelete';
import { proxyPick } from '../../poolExceptions';
import { setPaidStatus } from '../../setPaidStatus';
import { updatePoolSettings } from '../../poolOps';
import { getPoolPicks } from '../../nflPickReveal';
import { maybeFinalizeNFLPool } from '../../nflFinalize';
import { recomputeUserProfile, getProfilePoolDetail } from '../../userProfile';

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
const wGetPicks = test.wrap(getPoolPicks);
const wPoolDetail = test.wrap(getProfilePoolDetail);
const wCreateNFL = test.wrap(createNFLPool);

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });
const HOUR = 60 * 60 * 1000;
const SEASON = 'me-season';
const G1 = 'me-g1';
const G2 = 'me-g2';
// T3 runs against its OWN season and its OWN, already-FINAL slate. `getPoolPicks`
// and the scorer both resolve a week by (season, seasonType, week), so reusing
// the T2 games — deliberately still SCHEDULED, hours from kickoff — would make
// every T3 scoring assertion depend on T2's unlocked state.
const T3_SEASON = 'me-t3-season';
const F1 = 'me-f1';
const F2 = 'me-f2';
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
// PLAN-MULTI-ENTRY-DUES D1 (amended): the per-entry map lives in the CLOSED
// `private/` subcollection, NOT on the participant-readable Member Record.
const dues = async (uid: string) => (await poolRef().collection('private').doc(`dues__${uid}`).get()).data()?.paidEntries;
const entry = async (id: string) => (await poolRef().collection('entries').doc(id).get());
const ownedEntries = async (uid: string) => (await poolRef().collection('entries').where('ownerUid', '==', uid).get()).docs;
const ledger = async (uid: string) => (await poolRef().collection('payments').where('uid', '==', uid).get()).docs.map(d => d.data());

const submit = (uid: string, payload: Record<string, unknown>) =>
  submitNFLPicksInternal(db, { actorUid: uid, subjectUid: uid, subjectName: uid }, { poolId: POOL, week: 1, ...payload } as never);

async function seedPool(opts: { type?: string; max?: number; entryCount?: number | null; alicePaid?: boolean; season?: string } = {}) {
  n += 1;
  POOL = `pool-me-${n}`;
  createdPools.push(POOL);
  const type = opts.type ?? 'NFL_PICKEM';
  await poolRef().set({
    name: 'Multi', type, league: 'NFL', season: opts.season ?? SEASON, seasonType: 1,
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
      for (const id of [G1, G2, F1, F2]) await db.collection('nfl_games').doc(id).delete();
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

  /**
   * 🛑 CASE 3 NOW ASSERTS THE OPPOSITE OF WHAT IT USED TO (PLAN-MULTI-ENTRY-DUES
   * D6 — K11 RETIRED). It previously demanded that adding an entry mirror UNPAID
   * onto EVERY entry and write a `MARKED_UNPAID` ledger line. Under per-entry
   * dues that is wrong, not merely redundant: Alice paid for entry 1, and adding
   * entry 2 does not unpay entry 1.
   *
   * What must STILL happen is the member's stored SUMMARY moving to UNPAID —
   * `paidStatus` is a stored field and nothing derives it on read, so dropping
   * that write would report $50 collected when $25 was.
   */
  it('3. D6: adding an entry leaves entry 1 PAID and writes NO ledger line — but the member summary still goes UNPAID', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    // Pay entry 1 for real, through the callable, so the dues store is populated
    // the way production would have it.
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true, paymentMethod: 'venmo' }, auth: auth(HOST) } as never);
    expect((await member(ALICE)).paidStatus).toBe('PAID');
    expect(Object.keys(await dues(ALICE))).toEqual([ALICE]);

    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });   // the add

    const m = await member(ALICE);
    expect(m.paidStatus).toBe('UNPAID');        // the surviving half of K11
    expect(m.feeOwed).toBe(50);
    expect(m.paidAt).toBeUndefined();           // detail clears with the summary
    expect(m.paymentMethod).toBeUndefined();

    // 🛑 THE RETIREMENT, IN THREE ASSERTIONS.
    // 1. entry 1's payment SURVIVES in the per-entry store.
    expect(Object.keys(await dues(ALICE))).toEqual([ALICE]);
    // 2. entry 1's own document is NOT mirrored back to UNPAID.
    expect((await entry(ALICE)).data()!.paidStatus).toBe('PAID');
    expect((await entry(`e2:${ALICE}`)).data()!.paidStatus).not.toBe('PAID');
    // 3. NO `MARKED_UNPAID` line — no money moved, so the ledger says nothing.
    expect((await ledger(ALICE)).filter(l => l.type === 'MARKED_UNPAID')).toHaveLength(0);
    // ...and paying the new entry settles the member without re-paying entry 1.
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true, entryId: `e2:${ALICE}` }, auth: auth(HOST) } as never);
    expect((await member(ALICE)).paidStatus).toBe('PAID');
    expect((await ledger(ALICE)).filter(l => l.type === 'MARKED_PAID')).toHaveLength(2);
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

  /**
   * PLAN-MULTI-ENTRY-DUES P2-T2 — per-entry dues, end to end.
   * Kevin, 2026-08-25: "It is possible someone enters multiple entries but only
   * pays for a portion of them."
   */
  it('7a. pay entry 2 but NOT entry 1 → the member stays UNPAID, and only entry 2 mirrors', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true, entryId: `e2:${ALICE}`, paymentMethod: 'cash' }, auth: auth(HOST) } as never);

    const m = await member(ALICE);
    expect(Object.keys(await dues(ALICE) ?? {})).toEqual([`e2:${ALICE}`]);   // presence IS the signal
    expect(m.paidStatus).toBe('UNPAID');                                 // one of two -> not paid in full
    expect((await entry(`e2:${ALICE}`)).data()).toMatchObject({ paidStatus: 'PAID', paymentMethod: 'cash' });
    expect((await entry(ALICE)).data()!.paidStatus).not.toBe('PAID');    // entry 1 untouched

    // The ledger records the ENTRY's fee, not the member's $50 total, and says which entry.
    const paid = (await ledger(ALICE)).filter(l => l.type === 'MARKED_PAID');
    expect(paid).toHaveLength(1);
    expect(paid[0].amount).toBe(25);
    // 🛑 THE ENTRY ID MUST NOT BE HERE. `payments` is participant-readable,
    // and only a LIABLE entry can be marked paid — so `entryId: e2:alice` would
    // prove to the whole pool that Alice's entry 2 has a pick, which is the very
    // leak the dues store was moved to close. An earlier version of this PR
    // wrote it and would have shipped the leak inside its own fix.
    expect('entryId' in paid[0]).toBe(false);
  }, 60000);

  it('7b. paying the SECOND entry too flips the member to PAID', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true, entryId: `e2:${ALICE}` }, auth: auth(HOST) } as never);
    expect((await member(ALICE)).paidStatus).toBe('UNPAID');
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true, entryId: ALICE }, auth: auth(HOST) } as never);

    const m = await member(ALICE);
    expect(m.paidStatus).toBe('PAID');
    expect(Object.keys(await dues(ALICE)).sort()).toEqual([`e2:${ALICE}`, ALICE].sort());
    // TWO ledger rows, one per entry, $25 each -- not one $50 row.
    const paid = (await ledger(ALICE)).filter(l => l.type === 'MARKED_PAID');
    expect(paid).toHaveLength(2);
    expect(paid.map(r => r.amount)).toEqual([25, 25]);
  }, 60000);

  it('7c. un-marking ONE entry DELETES its key and drops the member back to UNPAID', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    for (const id of [ALICE, `e2:${ALICE}`]) {
      await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true, entryId: id }, auth: auth(HOST) } as never);
    }
    expect((await member(ALICE)).paidStatus).toBe('PAID');

    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: false, entryId: `e2:${ALICE}` }, auth: auth(HOST) } as never);
    const m = await member(ALICE);
    // D1b: the key is GONE, not set to a falsy value.
    const d = await dues(ALICE);
    expect(Object.prototype.hasOwnProperty.call(d, `e2:${ALICE}`)).toBe(false);
    expect(Object.keys(d)).toEqual([ALICE]);
    expect(m.paidStatus).toBe('UNPAID');
    expect((await entry(ALICE)).data()!.paidStatus).toBe('PAID');        // the OTHER entry stays paid
    const unpaid = (await ledger(ALICE)).filter(l => l.type === 'MARKED_UNPAID');
    expect(unpaid).toHaveLength(1);
    expect('entryId' in unpaid[0]).toBe(false);      // participant-readable: no entry id
  }, 60000);

  /**
   * 🛑 THE CASE THAT SEPARATES A PER-ENTRY LEDGER FROM A MEMBER-LEVEL ONE, and
   * it was MISSING until a mutation test found the hole.
   *
   * 7a-7c all pass with the OLD member-level transition test, because in every
   * one of them the member's own PAID/UNPAID flag also moves. Here it does not:
   * the member is UNPAID before AND after, so `priorStatus === 'PAID'` is false
   * and the member-level test reports "no transition" — $25 comes off the books
   * with NO ledger row at all.
   */
  it('7g. un-marking the ONLY paid entry of an UNPAID member still ledgers it', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true, entryId: `e2:${ALICE}` }, auth: auth(HOST) } as never);
    expect((await member(ALICE)).paidStatus).toBe('UNPAID');            // never became PAID

    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: false, entryId: `e2:${ALICE}` }, auth: auth(HOST) } as never);
    expect((await member(ALICE)).paidStatus).toBe('UNPAID');            // ...and still is

    const unpaid = (await ledger(ALICE)).filter(l => l.type === 'MARKED_UNPAID');
    expect(unpaid).toHaveLength(1);                                      // the money is on the record
    expect('entryId' in unpaid[0]).toBe(false);      // participant-readable: no entry id
    expect(unpaid[0].amount).toBe(25);
  }, 60000);

  it('7h. re-marking an already-paid ENTRY adds no second ledger row', async () => {
    // The mirror of 7g: with the member-level test this member is UNPAID
    // throughout, so every repeat mark would log again and read as money
    // arriving twice.
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    for (let i = 0; i < 3; i++) {
      await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true, entryId: `e2:${ALICE}`, paymentNote: `note ${i}` }, auth: auth(HOST) } as never);
    }
    expect((await ledger(ALICE)).filter(l => l.type === 'MARKED_PAID')).toHaveLength(1);
  }, 60000);

  /**
   * 🛑 THE LIVE-DATA CASE (codex r1 on T2). Every Member Record written before
   * this ticket has NO `paidEntries` — including members who are already PAID.
   * Deriving from an empty map would turn the first per-entry edit into an
   * UNPAID mark plus a spurious ledger row: money already collected, reported
   * as owed. Pools are live and members are already PAID, so this is reachable
   * on real data, not a migration hypothetical.
   */
  it('7i. a LEGACY PAID member (no paidEntries) is materialized, not downgraded', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    // The legacy shape, written directly: PAID with NO `paidEntries`. It is
    // stamped AFTER the submits on purpose — K11 is still live until P2-T3, so
    // seeding `alicePaid` up front would be undone by the second submit and the
    // test would silently stop testing what it says it tests.
    await poolRef().collection('members').doc(ALICE).set(
      { paidStatus: 'PAID', paidAt: 1_700_000_000_000, paymentMethod: 'venmo' }, { merge: true });
    const before = await member(ALICE);
    expect(before.paidStatus).toBe('PAID');
    expect(await dues(ALICE)).toBeUndefined();                           // the legacy shape: NO dues doc

    // Re-marking one entry of an already-paid member must be a no-op.
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true, entryId: `e2:${ALICE}` }, auth: auth(HOST) } as never);
    const after = await member(ALICE);
    expect(after.paidStatus).toBe('PAID');                               // NOT downgraded
    const seeded = await dues(ALICE);
    expect(Object.keys(seeded).sort()).toEqual([`e2:${ALICE}`, ALICE].sort());
    expect(seeded[ALICE].paidAt).toBe(1_700_000_000_000);                // the stored detail carried
    expect(seeded[ALICE].method).toBe('venmo');
    expect((await ledger(ALICE)).filter(l => l.type === 'MARKED_PAID')).toHaveLength(0);  // no phantom payment

    // ...and un-marking one of them now behaves per-entry, from the real state.
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: false, entryId: `e2:${ALICE}` }, auth: auth(HOST) } as never);
    const un = await member(ALICE);
    expect(un.paidStatus).toBe('UNPAID');
    expect(Object.keys(await dues(ALICE))).toEqual([ALICE]);             // entry 1 keeps its payment
  }, 60000);

  it('7d. a member-level mark (no entryId) still pays EVERY entry — the old callers are unchanged', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true }, auth: auth(HOST) } as never);
    const m = await member(ALICE);
    expect(m.paidStatus).toBe('PAID');
    expect(Object.keys(await dues(ALICE)).sort()).toEqual([`e2:${ALICE}`, ALICE].sort());
    for (const d of await ownedEntries(ALICE)) expect(d.data().paidStatus).toBe('PAID');
  }, 60000);

  it('7e. N1: a seeded commissioner with NO liable entries stays UNPAID, and a mark cannot green them', async () => {
    // `[].every(...)` is true, so a naive derivation turns every host green.
    await seedPool({ max: 2, entryCount: 2 });
    expect((await member(HOST)).paidStatus).toBe('UNPAID');
    await wPaid({ data: { poolId: POOL, memberUid: HOST, isPaid: true }, auth: auth(HOST) } as never);
    const h = await member(HOST);
    expect(h.paidStatus).toBe('UNPAID');
    expect(Object.keys(await dues(HOST) ?? {})).toEqual([]);
  }, 60000);

  it('7f. D7a: marking an entry the member does not own is ENTRY_NOT_FOUND, not a ghost key', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await expect(wPaid({
      data: { poolId: POOL, memberUid: ALICE, isPaid: true, entryId: `e2:${BOB}` }, auth: auth(HOST),
    } as never)).rejects.toThrow(/ENTRY_NOT_FOUND/);
    expect(Object.keys(await dues(ALICE) ?? {})).toEqual([]);
  }, 60000);

  /**
   * codex r2 on T2. A member-level mark over a PARTIAL map settles only what is
   * still outstanding, so pricing it at the member's whole `feeOwed` records
   * money that was never handed over.
   */
  it('7j. a member-level mark over a partial map ledgers only the ROWS IT MOVED', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true, entryId: `e2:${ALICE}` }, auth: auth(HOST) } as never);

    // $25 already collected. The member-level mark collects the REMAINING $25.
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true }, auth: auth(HOST) } as never);
    expect((await member(ALICE)).paidStatus).toBe('PAID');
    const paid = (await ledger(ALICE)).filter(l => l.type === 'MARKED_PAID');
    expect(paid).toHaveLength(2);
    expect(paid.map(r => r.amount).sort()).toEqual([25, 25]);            // NOT 25 + 50
  }, 60000);

  it('7k. a bulk un-mark from a partial state still ledgers the reversal', async () => {
    // The member is UNPAID before AND after, so a member-level transition test
    // records nothing and $25 leaves the books silently.
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true, entryId: `e2:${ALICE}` }, auth: auth(HOST) } as never);
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: false }, auth: auth(HOST) } as never);

    const m = await member(ALICE);
    expect(m.paidStatus).toBe('UNPAID');
    expect(Object.keys(await dues(ALICE) ?? {})).toEqual([]);
    const unpaid = (await ledger(ALICE)).filter(l => l.type === 'MARKED_UNPAID');
    expect(unpaid).toHaveLength(1);
    expect(unpaid[0].amount).toBe(25);                                   // the one row that moved
  }, 60000);

  /**
   * 🛑 REPLACED BY D6. This asserted that K11 CLEARED the per-entry map on an
   * add. K11 is retired, and clearing is now exactly the wrong behaviour: the
   * member paid for entry 1, and adding entry 2 must not throw that away. Case 3
   * above now pins the opposite. Kept as a named marker so the change is visible
   * in the diff rather than a silent deletion.
   */
  it('7l. D6: an add PRESERVES the per-entry map (K11 no longer clears it)', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true }, auth: auth(HOST) } as never);
    expect(Object.keys(await dues(ALICE))).toEqual([ALICE]);

    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    const afterAdd = await member(ALICE);
    expect(afterAdd.paidStatus).toBe('UNPAID');                 // summary moves
    expect(Object.keys(await dues(ALICE))).toEqual([ALICE]);    // payment does NOT
    expect((await entry(ALICE)).data()!.paidStatus).toBe('PAID');
  }, 60000);

  /**
   * 🛑 THE LEDGER IS PARTICIPANT-READABLE, SO IT IS SWEPT AS A WHOLE.
   *
   * `pools/{id}/payments` is `allow read: if isPoolParticipant()`. Only a LIABLE
   * entry can be marked paid, so ANY field on a ledger row naming a specific
   * entry proves that entry has committed a pick — the leak the dues store was
   * moved to close. An earlier version of this PR wrote `entryId` here.
   *
   * Swept over every row after a MIXED sequence rather than asserted on one row,
   * because the next person to add a field will add it to one branch.
   */
  it('7m. NO paid/unpaid ledger row ever names an entry, after per-entry AND member-level marks', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true, entryId: `e2:${ALICE}` }, auth: auth(HOST) } as never);
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: false, entryId: `e2:${ALICE}` }, auth: auth(HOST) } as never);
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true }, auth: auth(HOST) } as never);

    const rows = (await ledger(ALICE)).filter(r => r.type === 'MARKED_PAID' || r.type === 'MARKED_UNPAID');
    expect(rows.length).toBeGreaterThan(0);          // or this asserts nothing

    // The bit that leaks is an EXTRA entry's id. Entry #1's id IS the bare uid
    // (parent plan D1), and `uid` has always been on every ledger row as the
    // MEMBER key — so that collision is unavoidable and carries no information
    // a participant does not already have. `e2:` upward is the real signal.
    for (const r of rows) {
      for (const [k, v] of Object.entries(r)) {
        expect(v === `e2:${ALICE}`, `ledger field "${k}" leaks an extra entry's id`).toBe(false);
      }
      expect('entryId' in r, 'no ledger row may carry an entryId field').toBe(false);
    }
    // MUST NOT catch: `uid` and `entryName` are the member's, and stay.
    expect(rows.every(r => r.uid === ALICE)).toBe(true);
    expect(rows.some(r => r.entryName === ALICE)).toBe(true);
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

/**
 * PLAN-MULTI-ENTRY T3 — scoring, reveal, finalize and profile keyed by ENTRY id.
 *
 * The acceptance row, one test each:
 *  A. a two-entry Margin player gets two DISTINCT ranks, each on its own doc
 *     (the `entries/{ownerUid}` rank write-back used to put entry 2's rank on
 *     entry 1 and leave entry 2 rankless — sweeps S1a).
 *  B. the reveal maps hold BOTH entries, keyed by entry id; and a participant
 *     sees no `entries` metadata before the week reveals (D5 / the K1 boundary).
 *  C. the weekly recap lists both entries and names them apart (D4).
 *  D. finalize writes TWO seasonHistory docs with distinct ids, each carrying
 *     its own `entryId` (D9).
 *  E. the profile aggregates both entries but charges the fee ONCE, and
 *     `getProfilePoolDetail` returns one `entries[]` block per entry (D9).
 */
const SYSTEM_ACTOR = { uid: 'system', name: 'system', role: 'SYSTEM' } as never;

/**
 * 🛑 THE SLATE HAS TO OPEN BEFORE IT CLOSES. Picks are refused once a game
 * locks (GAME_LOCKED / WEEK_LOCKED), and the scorer only runs
 * non-provisionally — the branch that publishes the recap — once every game
 * is FINAL and past its lock. So every scoring test here seeds an OPEN slate,
 * submits, and only then concludes it. Writing the FINAL slate up front is
 * the shape that fails, and it fails at SUBMIT, not at the assertion.
 */
async function seedOpenSlate() {
  const future = Date.now() + 5 * HOUR;
  await db.collection('nfl_games').doc(F1).set({
    id: F1, espnGameId: F1, season: T3_SEASON, seasonType: 1, week: 1,
    startTime: future, status: 'SCHEDULED', isMonday: false,
    homeTeam: T('KC'), awayTeam: T('BUF'), scores: { home: 0, away: 0 }, spread: { value: -3, locked: true },
  });
  await db.collection('nfl_games').doc(F2).set({
    id: F2, espnGameId: F2, season: T3_SEASON, seasonType: 1, week: 1,
    startTime: future + 60_000, status: 'SCHEDULED', isMonday: true,
    homeTeam: T('DAL'), awayTeam: T('NYG'), scores: { home: 0, away: 0 }, spread: { value: -1, locked: true },
  });
}

/** The same two games, concluded: kicked off hours ago, FINAL, with scores. */
async function concludeSlate(scores: { f1: [number, number]; f2: [number, number] }) {
  const past = Date.now() - 6 * HOUR;
  await db.collection('nfl_games').doc(F1).set({
    id: F1, espnGameId: F1, season: T3_SEASON, seasonType: 1, week: 1,
    startTime: past, status: 'FINAL', isMonday: false,
    homeTeam: T('KC'), awayTeam: T('BUF'),
    scores: { home: scores.f1[0], away: scores.f1[1] }, spread: { value: -3, locked: true },
  });
  await db.collection('nfl_games').doc(F2).set({
    id: F2, espnGameId: F2, season: T3_SEASON, seasonType: 1, week: 1,
    startTime: past + 60_000, status: 'FINAL', isMonday: true,
    homeTeam: T('DAL'), awayTeam: T('NYG'),
    scores: { home: scores.f2[0], away: scores.f2[1] }, spread: { value: -1, locked: true },
  });
}

const loadSlate = async () => (await db.collection('nfl_games')
  .where('season', '==', T3_SEASON).where('seasonType', '==', 1).where('week', '==', 1).get())
  .docs.map(d => d.data() as never);

const score = async () => scoreNFLWeekInternal(db, POOL, 1, {
  pool: { ...(await pool()), id: POOL }, games: await loadSlate(),
  actor: SYSTEM_ACTOR, provisional: false,
} as never);

describe('PLAN-MULTI-ENTRY T3 — scoring / reveal / finalize / profile key by entry', () => {
  /** Only the fields these tests assert on. */
  type Reveal = {
    weekRevealed: boolean;
    counts: Record<string, number>;
    picks: Record<string, Record<string, string>>;
    entries?: Record<string, { ownerUid: string; entryName?: string }>;
  };
  type Detail = {
    profit: { feesOwed?: number; feeOwed: number; won: number };
    entries: Array<{ entryId: string; entryName?: string }>;
  };
  type StandingsRow = { id: string; ownerUid: string; rank?: number; entryName?: string };
  type Recap = {
    weeklyWinners: Array<{ entryId?: string }>;
    weeklyPlaces: Array<{ entryId: string }>;
    sharpOfWeek: { entryId?: string; userId: string; userName: string };
  };
  it('A. a two-entry Margin player gets two distinct ranks, each on its own entry doc', async () => {
    // KC wins by 20, DAL loses by 10 — two different margins, so the two
    // entries cannot tie and the cascade must separate them on real keys.
    await seedOpenSlate();
    await seedPool({ type: 'NFL_MARGIN', max: 3, entryCount: 2, season: T3_SEASON });
    await submit(ALICE, { picks: { 1: 'KC' } });
    await submit(ALICE, { picks: { 1: 'DAL' }, entryIndex: 2, entryName: 'Alice B' });
    await submit(BOB, { picks: { 1: 'BUF' } });
    await concludeSlate({ f1: [30, 10], f2: [10, 20] });

    await score();

    const e1 = (await entry(ALICE)).data()!;
    const e2 = (await entry('e2:' + ALICE)).data()!;
    expect(e1.weeklyScores[1]).toBe(20);
    expect(e2.weeklyScores[1]).toBe(-10);
    // 🛑 THE REGRESSION THIS PINS: with the old `doc(r.ownerUid)` write-back,
    // entry 2's rank landed on entry 1 and entry 2 had none at all.
    expect(typeof e1.rank).toBe('number');
    expect(typeof e2.rank).toBe('number');
    expect(e1.rank).not.toBe(e2.rank);
    expect(e1.rank).toBe(1);
    // The member-readable projection carries both rows, distinctly.
    const rows = (await poolRef().collection('standings').doc('current').get()).data()!.rows as StandingsRow[];
    const alices = rows.filter(r => r.ownerUid === ALICE);
    expect(alices.map(r => r.id).sort()).toEqual([ALICE, 'e2:' + ALICE].sort());
    expect(new Set(alices.map(r => r.rank)).size).toBe(2);
    expect(alices.find(r => r.id === 'e2:' + ALICE)!.entryName).toBe('Alice B');
  }, 90000);

  it('B. reveal maps are keyed by entry id and hold both; a participant sees no entries metadata pre-reveal', async () => {
    // Pre-reveal first: an OPEN slate on the T3 season, so nothing has locked.
    await seedOpenSlate();
    await seedPool({ type: 'NFL_PICKEM', max: 3, entryCount: 2, season: T3_SEASON });
    await submit(ALICE, { picks: { [F1]: 'KC', [F2]: 'DAL' } });
    await submit(ALICE, { picks: { [F1]: 'BUF' }, entryIndex: 2, entryName: 'Alice B' });
    await submit(BOB, { picks: { [F1]: 'KC' } });

    // A PARTICIPANT, before the week reveals: counts arrive (ungated since
    // 2026-08-22) and are keyed by ENTRY, but `entries` metadata does not.
    const pre = await wGetPicks({ data: { poolId: POOL, week: 1 }, auth: auth(BOB) } as never) as Reveal;
    expect(pre.weekRevealed).toBe(false);
    expect(pre.entries).toBeUndefined();
    expect(Object.keys(pre.counts).sort()).toEqual([ALICE, BOB, 'e2:' + ALICE].sort());
    expect(pre.counts[ALICE]).toBe(2);
    expect(pre.counts['e2:' + ALICE]).toBe(1);
    expect(pre.picks).toEqual({});

    // The COMMISSIONER gets the roster at any time — chasing missing picks is
    // their job, and they already see counts.
    const host = await wGetPicks({ data: { poolId: POOL, week: 1 }, auth: auth(HOST) } as never) as Reveal;
    expect(host.entries!['e2:' + ALICE]).toEqual({ ownerUid: ALICE, entryName: 'Alice B' });
    expect(host.entries![ALICE]).toEqual({ ownerUid: ALICE });

    // Once the week has revealed, the participant gets both — keyed by entry id,
    // with each entry's OWN picks rather than one overwriting the other.
    await concludeSlate({ f1: [30, 10], f2: [10, 20] });
    const post = await wGetPicks({ data: { poolId: POOL, week: 1 }, auth: auth(BOB) } as never) as Reveal;
    expect(post.weekRevealed).toBe(true);
    expect(post.picks[ALICE][F1]).toBe('KC');
    expect(post.picks['e2:' + ALICE][F1]).toBe('BUF');
    expect(post.entries!['e2:' + ALICE].ownerUid).toBe(ALICE);
  }, 90000);

  it('C. the weekly recap lists both of a player’s entries, and names them apart', async () => {
    await seedOpenSlate();
    await seedPool({ type: 'NFL_PICKEM', max: 3, entryCount: 2, season: T3_SEASON });
    // Entry 2 goes 2-for-2 and answers the tiebreaker; entry 1 goes 1-for-2.
    await submit(ALICE, { picks: { [F1]: 'KC', [F2]: 'NYG' }, tiebreakerPrediction: 30 });
    await submit(ALICE, { picks: { [F1]: 'KC', [F2]: 'DAL' }, entryIndex: 2, entryName: 'Alice B', tiebreakerPrediction: 44 });
    await submit(BOB, { picks: { [F1]: 'BUF', [F2]: 'NYG' }, tiebreakerPrediction: 10 });
    await concludeSlate({ f1: [30, 10], f2: [24, 20] });

    await score();

    const recap = (await poolRef().collection('weekly_recaps').doc('week_1').get()).data()! as Recap;
    // The winner is the ENTRY that scored 2, and the recap names the entry.
    expect(recap.weeklyWinners.map(w => w.entryId)).toEqual(['e2:' + ALICE]);
    expect(recap.sharpOfWeek.entryId).toBe('e2:' + ALICE);
    expect(recap.sharpOfWeek.userName).toBe('Alice B');
    expect(recap.sharpOfWeek.userId).toBe(ALICE);
    // Every scored entry is placed, so BOTH of Alice's rows appear.
    expect(recap.weeklyPlaces.map(pl => pl.entryId).sort())
      .toEqual([ALICE, BOB, 'e2:' + ALICE].sort());
  }, 90000);

  it('D+E. finalize writes one seasonHistory doc per entry; the profile aggregates both and charges ONE fee', async () => {
    await seedOpenSlate();
    await seedPool({ type: 'NFL_PICKEM', max: 3, entryCount: 2, season: T3_SEASON });
    await submit(ALICE, { picks: { [F1]: 'KC', [F2]: 'NYG' } });
    await submit(ALICE, { picks: { [F1]: 'KC', [F2]: 'DAL' }, entryIndex: 2, entryName: 'Alice B' });
    await submit(BOB, { picks: { [F1]: 'BUF', [F2]: 'NYG' } });
    await concludeSlate({ f1: [30, 10], f2: [24, 20] });
    await score();

    const outcome = await maybeFinalizeNFLPool(db, POOL);
    expect(outcome.finalized).toBe(true);

    const hist = await db.collection('users').doc(ALICE).collection('seasonHistory').get();
    const mine = hist.docs.filter(d => (d.data() as { poolId?: string }).poolId === POOL);
    // D9 — two documents, distinct ids, each stating WHICH entry it is about.
    expect(mine.map(d => d.id).sort()).toEqual([POOL, POOL + '__e2'].sort());
    expect(mine.find(d => d.id === POOL)!.data().entryId).toBe(ALICE);
    const extra = mine.find(d => d.id === POOL + '__e2')!.data();
    expect(extra.entryId).toBe('e2:' + ALICE);
    expect(extra.entryName).toBe('Alice B');
    // Entry 2 went 2-for-2 and outranks entry 1 — the two rows are not copies.
    expect(extra.finalRank).toBe(1);
    expect(mine.find(d => d.id === POOL)!.data().finalRank).not.toBe(1);
    expect(extra.totalEntries).toBe(3);

    // E — the fee is the MEMBER's, counted once (D2 already multiplied it).
    expect((await member(ALICE)).feeOwed).toBe(50);
    await db.collection('users').doc(ALICE).collection('participations').doc(POOL)
      .set({ poolId: POOL, type: 'NFL_PICKEM' });
    const profile = await recomputeUserProfile(db, ALICE);
    expect(profile.profit.feesOwed).toBe(50);   // NOT 100
    // Both entries' play is aggregated: 2 games x 2 entries graded...
    expect(profile.overall.total).toBe(4);
    // ...but ONE pool was entered, not two.
    expect(profile.overall.poolsEntered).toBe(1);

    const detail = await wPoolDetail({ data: { subjectId: ALICE, poolId: POOL }, auth: auth(ALICE) } as never) as Detail;
    expect(detail.entries).toHaveLength(2);
    expect(detail.entries.map(e => e.entryId).sort()).toEqual([ALICE, 'e2:' + ALICE].sort());
    expect(detail.entries[1].entryName).toBe('Alice B');
    expect(detail.profit.feeOwed).toBe(50);
  }, 120000);
});

/**
 * PLAN-MULTI-ENTRY — THE FLIP'S PROOF: a two-entry member is playable from the
 * WIZARD'S CREATE PAYLOAD all the way to the standings projection every member
 * reads.
 *
 * 🛑 THIS IS THE TEST THE FLIP IS GATED ON, and it is deliberately an ARC
 * rather than a set of unit assertions. Every ticket in this plan is individually
 * green with the feature switched off; the only question the flip actually asks
 * is whether the pieces line up end to end — and the way that fails is not a
 * crash, it is a member holding two entries and seeing one row.
 *
 * The seam this cannot cross, stated: the emulator suite runs inside
 * `functions/` and cannot import the client fold (`src/utils/memberStandings`).
 * The other half of the arc — those exact artifacts turning into two playable
 * rows — is `src/utils/memberStandings.test.ts`'s "one row per ENTRY" block,
 * which is fed the same shapes this test asserts the server writes.
 */
describe('PLAN-MULTI-ENTRY — FLIP: wizard payload → two entries → standings', () => {
  it('a member creates a 3-entry pool, plays two entries, and both reach the standings projection', async () => {
    // 1. THE WIZARD END. `maxEntriesPerUser` is set on the create payload, which
    //    is the ONLY place it can be declared (the NFL create schemas are
    //    `z.object` and strip unknown keys — sweeps S2). If T1's schema change
    //    ever regressed, the value would vanish here and every later assertion
    //    would still pass on a one-entry pool. So it is asserted on the DOC.
    await db.collection('users').doc(HOST).set({ name: 'Host', role: 'PARTICIPANT' });
    const created = await wCreateNFL({
      data: {
        type: 'NFL_PICKEM',
        name: 'Launch Day',
        season: T3_SEASON,
        seasonType: 1,
        settings: {
          entryFee: 25,
          isListedPublic: true,
          lockMode: 'PER_GAME',
          pickMode: 'STRAIGHT',
          confidenceMode: false,
          maxEntriesPerUser: 3,
          payouts: { places: [], bonuses: [] },
        },
      },
      auth: auth(HOST),
    } as never) as { poolId: string };
    POOL = created.poolId;
    createdPools.push(POOL);
    expect((await pool()).settings.maxEntriesPerUser).toBe(3);

    // 2. A member joins the normal way.
    await db.collection('users').doc(ALICE).set({ name: 'Alice', role: 'PARTICIPANT' });
    await joinNFLPoolInternal(db, { subjectUid: ALICE, subjectName: 'Alice' }, POOL);
    expect((await member(ALICE)).feeOwed).toBe(25);

    // 3. Two entries, the second named — exactly what the "My Entries" switcher
    //    sends: `entryIndex` plus `entryName`, and nothing at all for entry #1.
    await seedOpenSlate();
    await submit(ALICE, { picks: { [F1]: 'KC', [F2]: 'DAL' } });
    await submit(ALICE, { picks: { [F1]: 'BUF', [F2]: 'NYG' }, entryIndex: 2, entryName: 'Alice B' });

    // The dues doubled, the roster map holds both, and the pot denominator moved.
    const m = await member(ALICE);
    expect(m.feeOwed).toBe(50);
    expect(m.playableEntryCount).toBe(2);
    expect(Object.keys(m.entries).sort()).toEqual([ALICE, 'e2:' + ALICE].sort());
    expect(m.entries['e2:' + ALICE].name).toBe('Alice B');
    expect((await pool()).entryCount).toBe(2);

    // A third entry is refused only past the cap the WIZARD set, not before.
    await submit(ALICE, { picks: { [F1]: 'KC' }, entryIndex: 3, entryName: 'Alice C' });
    await expect(submit(ALICE, { picks: { [F1]: 'KC' }, entryIndex: 4 }))
      .rejects.toThrow(/ENTRY_INDEX_EXCEEDS_MAX/);

    // 4. Score the week for real.
    await concludeSlate({ f1: [30, 10], f2: [24, 20] });
    await score();

    // 5. THE STANDINGS PROJECTION — what every member's table is built from.
    const rows = (await poolRef().collection('standings').doc('current').get()).data()!.rows as Array<Record<string, unknown>>;
    const mine = rows.filter(r => r.ownerUid === ALICE);
    expect(mine).toHaveLength(3);
    expect(mine.map(r => r.id).sort()).toEqual([ALICE, 'e2:' + ALICE, 'e3:' + ALICE].sort());
    // 🛑 THREE DISTINCT SCORES FROM THREE DIFFERENT SHEETS. KC and DAL both won,
    // so entry 1 (KC + DAL) is 2, entry 2 (BUF + NYG) is 0 and entry 3 (KC only)
    // is 1. If any consumer still keyed by uid, these would collapse onto one
    // number — and the collapse, not a crash, is how multi-entry fails.
    expect(mine.find(r => r.id === ALICE)!.totalScore).toBe(2);
    expect(mine.find(r => r.id === 'e2:' + ALICE)!.totalScore).toBe(0);
    expect(mine.find(r => r.id === 'e3:' + ALICE)!.totalScore).toBe(1);
    // The extra entries carry their names; entry #1 carries none, by contract.
    expect(mine.find(r => r.id === 'e2:' + ALICE)!.entryName).toBe('Alice B');
    expect(mine.find(r => r.id === ALICE)!.entryName).toBeUndefined();
    // Every row states its owner, which is what "is this me" and the profile
    // link key on (§0b.2) — and what the client fold uses for membership.
    expect(mine.every(r => r.ownerUid === ALICE)).toBe(true);
  }, 120000);
});


/**
 * `renameNFLEntry` — PLAN-MULTI-ENTRY K5 follow-up (Kevin, 2026-08-26).
 *
 * 🛑 WHAT THESE TESTS ARE REALLY FOR: proving a rename is a rename.
 *
 * The reason this is a separate callable rather than a field on
 * `submitNFLPicks` is that the submit transaction also moves money —
 * `feeOwed`, `playableEntryCount`, `pool.entryCount`, the K11 paid-reset — and
 * a display-name edit must move none of it. That is not something code reading
 * can settle, because the coupling is inside `ensureMemberRecord` and
 * `entryCountWrite`, several call frames down. So the money fields are
 * SNAPSHOTTED before the rename and deep-compared after, and the entry document
 * is compared field-for-field with `entryName` removed from both sides.
 *
 * The other half is staleness. A member's row is rendered from ONE of two
 * places depending on whether it has been scored — the Member Record's roster
 * map (unscored) or `standings/current` (scored) — and a rename that updated
 * only one of them would look correct to whoever tested it and wrong to
 * everybody in the other state. Both are asserted, on the same pool.
 */
describe('renameNFLEntry — a rename that renames and nothing else', () => {
  // ⚠️ THIS BLOCK SEEDS ITS OWN SLATE. The T2 block's `beforeEach` seeds G1/G2
  // and its `afterAll` deletes them, and both are scoped to that describe — so
  // a test out here that relied on them got "No NFL games found for HOF
  // Weekend" from `submitNFLPicksInternal`, not a rename failure. Same two
  // documents, seeded locally, refreshed per test (the Survivor case below
  // back-dates their kickoff to force a hard lock).
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

  afterAll(async () => {
    try {
      for (const id of createdPools) await db.recursiveDelete(db.collection('pools').doc(id));
      for (const id of [G1, G2, F1, F2]) await db.collection('nfl_games').doc(id).delete();
    } catch (e) {
      console.warn('[renameNFLEntry.emulator] teardown incomplete:', e);
    }
  }, 60000);

  const rename = (uid: string, entryIndex: number, entryName: string) =>
    renameNFLEntryInternal(db, { actorUid: uid, subjectUid: uid, subjectName: uid },
      { poolId: POOL, entryIndex, entryName });

  /** Everything a rename MUST NOT move, in one comparable object. */
  const moneyState = async (uid: string) => {
    const m = await member(uid);
    const p = await pool();
    return {
      feeOwed: m.feeOwed, playableEntryCount: m.playableEntryCount, paidStatus: m.paidStatus,
      paidAt: m.paidAt ?? null, paymentMethod: m.paymentMethod ?? null,
      hasPlayableEntry: m.hasPlayableEntry, pickedWeeks: m.pickedWeeks ?? null,
      rebuyOwed: m.rebuyOwed ?? null, entryCount: p.entryCount,
      ledgerLines: (await ledger(uid)).length,
    };
  };

  /** An entry document with its display name removed — everything else must be identical. */
  const entryStateSansName = async (id: string) => {
    const d = (await entry(id)).data()! as Record<string, unknown>;
    delete d.entryName;
    return d;
  };

  it('renames entry 2: the doc, the roster map and the standings row all move; entry 1 does not', async () => {
    await seedOpenSlate();
    await seedPool({ max: 3, entryCount: 2, season: T3_SEASON });
    await submit(ALICE, { picks: { [F1]: 'KC' } });
    await submit(ALICE, { picks: { [F1]: 'BUF' }, entryIndex: 2, entryName: 'Alice B' });
    // SCORED, so the standings projection exists — the surface that does NOT
    // self-heal from the roster map.
    await concludeSlate({ f1: [30, 10], f2: [24, 20] });
    await score();

    const beforeMoney = await moneyState(ALICE);
    const beforeE1 = await entryStateSansName(ALICE);
    const beforeE2 = await entryStateSansName(`e2:${ALICE}`);
    const e1NameBefore = (await entry(ALICE)).data()!.entryName;

    const out = await rename(ALICE, 2, '  Alice Deux  ');
    // Trimmed by `assertEntryNameFree`, and the id is the server's, never the client's.
    expect(out).toEqual({ success: true, entryId: `e2:${ALICE}`, entryName: 'Alice Deux' });

    // 1. the entry doc — the source of truth.
    expect((await entry(`e2:${ALICE}`)).data()!.entryName).toBe('Alice Deux');
    // 2. the Member Record roster map — the ONLY copy other members can read.
    const m = await member(ALICE);
    expect(m.entries[`e2:${ALICE}`]).toEqual({ entryIndex: 2, name: 'Alice Deux' });
    expect(m.entries[ALICE]).toEqual({ entryIndex: 1 });
    // 3. the published standings row — what a SCORED row renders from.
    const rows = (await poolRef().collection('standings').doc('current').get()).data()!.rows as Array<Record<string, unknown>>;
    expect(rows.find(r => r.id === `e2:${ALICE}`)!.entryName).toBe('Alice Deux');
    // ...and the row's score is untouched: this patches a name, not a result.
    expect(rows.find(r => r.id === `e2:${ALICE}`)!.totalScore).toBe(0);
    expect(rows.find(r => r.id === ALICE)!.totalScore).toBe(1);
    expect(rows.find(r => r.id === ALICE)!.entryName).toBeUndefined();

    // 🛑 ENTRY 1 IS BYTE-IDENTICAL, name included.
    expect(await entryStateSansName(ALICE)).toEqual(beforeE1);
    expect((await entry(ALICE)).data()!.entryName).toBe(e1NameBefore);
    // 🛑 ENTRY 2 IS BYTE-IDENTICAL APART FROM THE NAME — picks, usedTeams,
    // submittedAt, lastRequestId, totalScore, the revision watermark, all of it.
    expect(await entryStateSansName(`e2:${ALICE}`)).toEqual(beforeE2);
    // 🛑 AND NO MONEY MOVED.
    expect(await moneyState(ALICE)).toEqual(beforeMoney);
  }, 120000);

  it('names entry #1, which has none by default, without disturbing the extra', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2, entryName: 'Alice B' });
    const before = await moneyState(ALICE);

    await rename(ALICE, 1, 'Alice Prime');

    expect((await entry(ALICE)).data()!.entryName).toBe('Alice Prime');
    expect((await entry(`e2:${ALICE}`)).data()!.entryName).toBe('Alice B');
    expect((await member(ALICE)).entries).toEqual({
      [ALICE]: { entryIndex: 1, name: 'Alice Prime' },
      [`e2:${ALICE}`]: { entryIndex: 2, name: 'Alice B' },
    });
    expect(await moneyState(ALICE)).toEqual(before);
  }, 60000);

  it('refuses a name another of the owner\'s entries already holds (case-insensitively)', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2, entryName: 'Alice B' });

    await rename(ALICE, 1, 'Alice A');
    await expect(rename(ALICE, 2, 'alice a')).rejects.toThrow(/ENTRY_NAME_TAKEN/);
    // The refusal wrote NOTHING — not a partial rename of the doc with a stale
    // roster map, which is the shape a non-transactional version would leave.
    expect((await entry(`e2:${ALICE}`)).data()!.entryName).toBe('Alice B');
    expect((await member(ALICE)).entries[`e2:${ALICE}`].name).toBe('Alice B');

    // ...but renaming an entry to the name it ALREADY has is fine: the helper
    // excludes the target from its own clash check.
    await expect(rename(ALICE, 2, 'Alice B')).resolves.toMatchObject({ success: true });
  }, 60000);

  it('🛑 a rename NEVER CREATES an entry — a missing one is not-found', async () => {
    await seedPool({ max: 3, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    const before = await moneyState(ALICE);

    await expect(rename(ALICE, 2, 'Ghost')).rejects.toThrow(/ENTRY_NOT_FOUND/);
    // The document `resolveOwnedEntry` handed back a ref for does not exist,
    // and the owner's liability did not move. A created-on-rename entry would
    // be a contestant with no picks that still counted toward the pot.
    expect((await entry(`e2:${ALICE}`)).exists).toBe(false);
    expect(await moneyState(ALICE)).toEqual(before);
    expect((await member(ALICE)).entries).toEqual({ [ALICE]: { entryIndex: 1 } });
  }, 60000);

  it('refuses a caller who is not in the pool, and one who does not own the entry', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });

    // A stranger: not on `participantIds` at all.
    await expect(renameNFLEntryInternal(db, { actorUid: 'me-stranger', subjectUid: 'me-stranger' },
      { poolId: POOL, entryIndex: 1, entryName: 'Mine now' })).rejects.toThrow(/NOT_POOL_MEMBER/);

    // 🛑 A FELLOW MEMBER. Bob is a legitimate participant, so membership alone
    // does not protect Alice's entry — the entry id is derived from the
    // CALLER's uid, so Bob's "entry 1" is his own document, which does not
    // exist. He cannot address hers at all, and there is no payload uid he
    // could put a different answer in.
    await expect(rename(BOB, 1, 'Alice pwned')).rejects.toThrow(/ENTRY_NOT_FOUND/);
    expect((await entry(ALICE)).data()!.entryName).toBeUndefined();
  }, 60000);

  it('🛑 rebuilds the WHOLE roster map on a legacy Member Record, never one key', async () => {
    // The trap: writing `entries.<id>.name` onto a record with no map at all
    // leaves a map holding exactly ONE id — and `ownedEntryIds`
    // (src/utils/memberStandings.ts:107) renders one row per key, so every
    // other entry this member owns would lose its standings row. A rename that
    // DELETED a row from the board would be far worse than a stale name.
    await seedPool({ max: 3, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2, entryName: 'Alice B' });
    // Back-date the record to its pre-T2 shape: entries exist, the map does not.
    await poolRef().collection('members').doc(ALICE).update({
      entries: admin.firestore.FieldValue.delete(),
    });
    expect((await member(ALICE)).entries).toBeUndefined();

    await rename(ALICE, 2, 'Alice Deux');

    expect((await member(ALICE)).entries).toEqual({
      [ALICE]: { entryIndex: 1 },
      [`e2:${ALICE}`]: { entryIndex: 2, name: 'Alice Deux' },
    });
  }, 60000);

  it('renames a SURVIVOR entry after the week has locked — the case submit cannot serve', async () => {
    // 🛑 THIS IS THE WHOLE REASON THE CALLABLE EXISTS. `submitNFLPicksInternal`
    // throws `Missing Survivor team selection` on a payload with no team, and
    // `WEEK_LOCKED` on one that has a team once the deadline passes — so on
    // Survivor and Margin there has never been a way to change a name after a
    // week locked. If this ever regresses to "resubmit with a name", this test
    // is what fails.
    await seedPool({ type: 'NFL_SURVIVOR', max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { 1: 'KC' } });
    await submit(ALICE, { picks: { 1: 'BUF' }, entryIndex: 2, entryName: 'Alice B' });
    // Kick the slate off: the week is now hard-locked for a Survivor pool.
    for (const id of [G1, G2]) {
      await db.collection('nfl_games').doc(id).update({ startTime: Date.now() - HOUR });
    }
    await expect(submit(ALICE, { picks: { 1: 'BUF' }, entryIndex: 2, entryName: 'Alice Deux' }))
      .rejects.toThrow(/WEEK_LOCKED/);
    const before = await moneyState(ALICE);

    await rename(ALICE, 2, 'Alice Deux');

    const e2 = (await entry(`e2:${ALICE}`)).data()!;
    expect(e2.entryName).toBe('Alice Deux');
    // The Survivor state a rename must not touch.
    expect(e2.picks).toEqual({ 1: 'BUF' });
    expect(e2.usedTeams).toEqual(['BUF']);
    expect(e2.status).toBe('ALIVE');
    expect(e2.strikesUsed).toBe(0);
    expect(await moneyState(ALICE)).toEqual(before);
  }, 60000);

  it('leaves a PAID member paid — a rename is not a dues change (K11 does not fire)', async () => {
    await seedPool({ max: 2, entryCount: 2, alicePaid: true });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    expect((await member(ALICE)).paidStatus).toBe('PAID');

    await rename(ALICE, 1, 'Alice Prime');

    const m = await member(ALICE);
    expect(m.paidStatus).toBe('PAID');
    expect(m.paidAt).toBe(1_700_000_000_000);
    expect(m.feeOwed).toBe(25);
    // ...and no MARKED_UNPAID line was appended. K11 fires on a dues RISE; a
    // rename raises nothing, so the ledger must be silent.
    expect(await ledger(ALICE)).toHaveLength(0);
  }, 60000);
});

/**
 * PLAN-MULTI-ENTRY-DUES P2-T4 — `deleteNFLEntry`.
 *
 * 🛑 THE FIRST PATH IN THIS REPO THAT LOWERS A ONE-WAY COUNTER. What makes that
 * safe is D2 and D3, so the refusals are tested before the arithmetic.
 */
describe('deleteNFLEntry — the first path that lowers a one-way counter', () => {
  beforeEach(async () => {
    for (const uid of [HOST, ALICE, BOB]) await db.collection('users').doc(uid).set({ name: uid });
    await db.collection('nfl_games').doc(G1).set({
      id: G1, espnGameId: G1, season: SEASON, seasonType: 1, week: 1,
      startTime: Date.now() + 4 * HOUR, status: 'SCHEDULED', isMonday: false,
      homeTeam: T('KC'), awayTeam: T('BUF'), scores: { home: 0, away: 0 }, spread: { value: -3, locked: true },
    });
  });

  const del = (actor: string, target: string, entryIndex: number) =>
    deleteNFLEntryInternal(db, { actorUid: actor }, { poolId: POOL, targetUid: target, entryIndex });

  it('deletes an unpaid, unscored entry and takes ALL THREE counters down together', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    expect((await member(ALICE)).feeOwed).toBe(50);
    expect((await pool()).entryCount).toBe(3);          // host 0 + alice 2 + bob 1

    const res = await del(HOST, ALICE, 2);
    expect(res).toMatchObject({ success: true, entryId: `e2:${ALICE}`, entryIndex: 2, liabilityDelta: -1 });

    // D12: HARD delete, no tombstone.
    expect((await entry(`e2:${ALICE}`)).exists).toBe(false);
    const m = await member(ALICE);
    expect(m.feeOwed).toBe(25);                          // one fee, not two
    expect(m.playableEntryCount).toBe(1);                // RECOUNTED, not decremented
    expect(Object.keys(m.entries)).toEqual([ALICE]);     // roster map rebuilt without it
    expect((await pool()).entryCount).toBe(2);           // the pot denominator follows
  }, 60000);

  it('D2: refuses a PAID entry, and changes NOTHING when it refuses', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true, entryId: `e2:${ALICE}` }, auth: auth(HOST) } as never);

    await expect(del(HOST, ALICE, 2)).rejects.toThrow(/ENTRY_IS_PAID/);
    // A refusal is a no-op on every store it would have touched.
    expect((await entry(`e2:${ALICE}`)).exists).toBe(true);
    expect((await member(ALICE)).feeOwed).toBe(50);
    expect((await pool()).entryCount).toBe(3);
    expect(Object.keys(await dues(ALICE))).toEqual([`e2:${ALICE}`]);

    // ...and the documented escape hatch actually works: un-mark, then delete.
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: false, entryId: `e2:${ALICE}` }, auth: auth(HOST) } as never);
    await expect(del(HOST, ALICE, 2)).resolves.toMatchObject({ success: true });
  }, 60000);

  it('D2 IS what makes the dues-key removal unreachable — pin the coupling, not the line', async () => {
    // A mutation that KEEPS the key after a delete survives the suite, because
    // D2 refuses before the removal can matter. That is fine, but only while D2
    // checks the map — so assert the coupling directly: a key present in the
    // dues store refuses the delete, full stop.
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true, entryId: `e2:${ALICE}` }, auth: auth(HOST) } as never);
    expect(Object.prototype.hasOwnProperty.call(await dues(ALICE), `e2:${ALICE}`)).toBe(true);
    await expect(del(HOST, ALICE, 2)).rejects.toThrow(/ENTRY_IS_PAID/);
    // ...and with the key gone, the same delete succeeds — so the refusal is
    // keyed on the MAP and not on something incidental.
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: false, entryId: `e2:${ALICE}` }, auth: auth(HOST) } as never);
    expect(Object.prototype.hasOwnProperty.call(await dues(ALICE), `e2:${ALICE}`)).toBe(false);
    await expect(del(HOST, ALICE, 2)).resolves.toMatchObject({ success: true });
  }, 60000);

  it('D2: a LEGACY paid member (no dues doc) is refused too — absent detail is not "unpaid"', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    // The pre-ticket shape: PAID on the member, no per-entry map at all.
    await poolRef().collection('members').doc(ALICE).set({ paidStatus: 'PAID' }, { merge: true });
    expect(await dues(ALICE)).toBeUndefined();
    await expect(del(HOST, ALICE, 2)).rejects.toThrow(/ENTRY_IS_PAID/);
  }, 60000);

  it('D3: refuses once ANY week is scored — the test is on the POOL, not the entry', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    // Entry 2 itself has scored nothing; the POOL has scored a week.
    await poolRef().set({ scoredWeeks: { 1: true } }, { merge: true });
    await expect(del(HOST, ALICE, 2)).rejects.toThrow(/ENTRY_IS_SCORED/);
    expect((await entry(`e2:${ALICE}`)).exists).toBe(true);
  }, 60000);

  it('D3: the legacy scoredThroughWeek high-water mark refuses too', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await poolRef().set({ scoredThroughWeek: 2 }, { merge: true });
    await expect(del(HOST, ALICE, 2)).rejects.toThrow(/ENTRY_IS_SCORED/);
  }, 60000);

  it('D3: a published standings projection refuses even with no scored-week marker', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await poolRef().collection('standings').doc('current').set({ rows: [], lastScoredWeek: 1 });
    await expect(del(HOST, ALICE, 2)).rejects.toThrow(/ENTRY_IS_SCORED/);
  }, 60000);

  it('D3: the DURABLE publishedWeeks marker refuses, even with no scoredWeeks (a provisional pass)', async () => {
    // A provisional scoring pass writes publishedWeeks.{week} and deliberately
    // WITHHOLDS scoredWeeks/scoredThroughWeek (nflPools.ts:1876). So a mid-week
    // pool can have shown members a result while carrying neither marker
    // `legacyPublishedWeeks` reads.
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await poolRef().set({ publishedWeeks: { 1: true } }, { merge: true });
    const p = await pool();
    expect(p.scoredWeeks).toBeUndefined();          // the weaker markers are absent...
    expect(p.scoredThroughWeek).toBeUndefined();
    expect((await poolRef().collection('standings').doc('current').get()).exists).toBe(false);
    await expect(del(HOST, ALICE, 2)).rejects.toThrow(/ENTRY_IS_SCORED/);   // ...and it still refuses
  }, 60000);

  it('refuses an ORPHAN entry with no Member Record, rather than stranding the pot denominator', async () => {
    // Reachable on a pool predating ADR-0003's roster model. Treating the absent
    // record as {} makes liabilityDelta 0, so the entry would be destroyed while
    // pool.entryCount kept counting it — permanently, with nothing left to
    // explain why. Refusing is recoverable; deleting is not.
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    const before = (await pool()).entryCount;
    await poolRef().collection('members').doc(ALICE).delete();

    await expect(del(HOST, ALICE, 2)).rejects.toThrow(/ENTRY_MEMBER_NOT_FOUND/);
    expect((await entry(`e2:${ALICE}`)).exists).toBe(true);      // nothing destroyed
    expect((await pool()).entryCount).toBe(before);              // denominator untouched
  }, 60000);

  it('refuses a STALE Member Record whose count disagrees with the entry documents', async () => {
    // `backfillMemberRecords` writes with merge:false and NO playableEntryCount
    // and NO entries, so a backfilled member owning two picked entries reads as
    // liable for ONE. The delta would then be 1 - 1 = 0 and the entry would be
    // destroyed while pool.entryCount kept counting it. An earlier version of
    // this callable recommended running that very backfill as the fix.
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    const before = (await pool()).entryCount;
    // Exactly what the backfill produces.
    await poolRef().collection('members').doc(ALICE).set({
      uid: ALICE, poolId: POOL, userName: ALICE, role: 'PARTICIPANT',
      paidStatus: 'UNPAID', joinedAt: Date.now(),
    }, { merge: false });

    await expect(del(HOST, ALICE, 2)).rejects.toThrow(/MEMBER_RECORD_STALE/);
    expect((await entry(`e2:${ALICE}`)).exists).toBe(true);
    expect((await pool()).entryCount).toBe(before);

    // The recovery the message actually recommends: one submit restamps the
    // record, and the delete then costs correctly.
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    expect((await member(ALICE)).playableEntryCount).toBe(2);   // no longer stale
    const res = await del(HOST, ALICE, 2);
    expect(res.liabilityDelta).toBe(-1);                        // costed, not silently zero
    expect((await member(ALICE)).playableEntryCount).toBe(1);

    // ⚠️ `pool.entryCount` is NOT asserted against `before` here, and the reason
    // is worth stating: WIPING the record desynced it. The stale record
    // under-reported, so the healing submit added +1 to a counter that already
    // counted both entries. That drift is caused by the corruption this test
    // fabricates, not by the delete — which is precisely why the delete refuses
    // to do arithmetic on a record in that state.
  }, 60000);

  it('an ordinary LEGACY record (no playableEntryCount, one picked entry) still passes', async () => {
    // The stale-record guard must not refuse the common pre-T2 shape: the latch
    // set, the counter absent, one entry. memberPlayedEntries reads 1 and the
    // documents say 1, so they agree.
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await poolRef().collection('members').doc(ALICE).update({
      playableEntryCount: admin.firestore.FieldValue.delete(),
    });
    expect((await member(ALICE)).playableEntryCount).toBeUndefined();
    expect((await member(ALICE)).hasPlayableEntry).toBe(true);

    await expect(del(HOST, ALICE, 1)).resolves.toMatchObject({ success: true, liabilityDelta: 0 });
  }, 60000);

  it('pickedWeeks is cleared when nothing survives, and left alone when something does', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    expect((await member(ALICE)).pickedWeeks).toEqual([1]);

    // Partial: ACCEPTED staleness. pick'em picks are keyed by gameId, not week,
    // so the union cannot be recomputed without every game doc. Bounded to
    // display, and D3 means nothing is scored.
    await del(HOST, ALICE, 2);
    expect((await member(ALICE)).pickedWeeks).toEqual([1]);

    // Total: nothing survives, so the union is a claim about picks that no
    // longer exist anywhere.
    await del(HOST, ALICE, 1);
    expect((await member(ALICE)).pickedWeeks).toBeUndefined();
  }, 60000);

  it('AUTHORIZATION: a member cannot delete their own entry, nor another member', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await expect(del(ALICE, ALICE, 2)).rejects.toThrow(/Only the commissioner/);
    await expect(del(BOB, ALICE, 2)).rejects.toThrow(/Only the commissioner/);
    expect((await entry(`e2:${ALICE}`)).exists).toBe(true);
  }, 60000);

  it('a NON-LIABLE entry deletes but moves NO counter (D8 — the delta is the rule)', async () => {
    // `picks: {}` is schema-legal on pick'em and persists an entry with no
    // committed pick. It was never in playableEntryCount, feeOwed or entryCount.
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: {}, entryIndex: 2 });
    const before = await member(ALICE);
    const poolBefore = await pool();
    expect(before.playableEntryCount).toBe(1);

    const res = await del(HOST, ALICE, 2);
    expect(res.liabilityDelta).toBe(0);
    const m = await member(ALICE);
    expect(m.feeOwed).toBe(before.feeOwed);
    expect(m.playableEntryCount).toBe(1);
    expect((await pool()).entryCount).toBe(poolBefore.entryCount);
  }, 60000);

  it('D7a: an ABSENT feeOwed stays absent — a delete must not turn "unknown" into a claim', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await poolRef().collection('members').doc(ALICE).update({ feeOwed: admin.firestore.FieldValue.delete() });
    expect((await member(ALICE)).feeOwed).toBeUndefined();

    await del(HOST, ALICE, 2);
    // Still absent. `memberDues` falls back to the pool fee for exactly this
    // case; writing a number here would be a claim on the one path that lowers
    // money owed.
    expect((await member(ALICE)).feeOwed).toBeUndefined();
    expect((await member(ALICE)).playableEntryCount).toBe(1);   // the recount still lands
  }, 60000);

  it('D7b: rebuyOwed and rebuyPaid are byte-identical across a delete', async () => {
    // Unreachable in practice (a rebuy needs an ELIMINATED entry, which needs a
    // scored week, which D3 forbids) — pinned anyway, because only one line in
    // nflPools.ts and D3 make it so, and neither is visible from here.
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await poolRef().collection('members').doc(ALICE).set({ rebuyOwed: 10, rebuyPaid: 5 }, { merge: true });

    await del(HOST, ALICE, 2);
    const m = await member(ALICE);
    expect(m.rebuyOwed).toBe(10);
    expect(m.rebuyPaid).toBe(5);
  }, 60000);

  it('N2: the dues key goes with the entry, so a RE-CREATED entry starts unpaid', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: true, entryId: `e2:${ALICE}` }, auth: auth(HOST) } as never);
    await wPaid({ data: { poolId: POOL, memberUid: ALICE, isPaid: false, entryId: `e2:${ALICE}` }, auth: auth(HOST) } as never);
    await del(HOST, ALICE, 2);
    expect(Object.keys(await dues(ALICE) ?? {})).toEqual([]);

    // Re-create at the SAME deterministic id and it is unpaid, so a commissioner
    // cannot manufacture a paid entry by deleting and re-adding one.
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    expect((await entry(`e2:${ALICE}`)).exists).toBe(true);
    expect(Object.keys(await dues(ALICE) ?? {})).toEqual([]);
    expect((await member(ALICE)).paidStatus).toBe('UNPAID');
    expect((await member(ALICE)).feeOwed).toBe(50);        // and it is charged again
  }, 60000);

  it('the ledger records the deletion with the entry NAME and INDEX (ids are reusable)', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2, entryName: 'Lucky Two' });
    await del(HOST, ALICE, 2);

    const rows = (await ledger(ALICE)).filter(l => l.type === 'ENTRY_DELETED');
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toMatch(/Entry #2 "Lucky Two" deleted/);
    expect(rows[0].amount).toBe(25);
    expect(rows[0].actorUid).toBe(HOST);
    // Participant-readable collection: it must not name the entry ID.
    expect(rows[0].entryId).toBeUndefined();

    // ...and D12's OTHER durable record, which is NOT participant-readable and
    // therefore MAY name the id. The delete keeps no corpse, so these two rows
    // are the only evidence the entry ever existed.
    const audit = (await poolRef().collection('audit').get()).docs
      .map(d => d.data()).filter(a => a.type === 'ENTRY_DELETED');
    expect(audit).toHaveLength(1);
    expect(audit[0].payload).toMatchObject({
      targetUid: ALICE, entryId: `e2:${ALICE}`, entryIndex: 2, entryName: 'Lucky Two', liabilityDelta: -1,
    });
    expect(audit[0].actor.uid).toBe(HOST);
  }, 60000);

  it('deleting a member LAST entry clears the hasPlayableEntry latch — no ghost competitor', async () => {
    // The latch was documented one-way ("a member cannot un-submit"). A delete is
    // the case that did not exist when it was written. Left true, the member
    // keeps a standings row for an entry that is gone — `buildMemberStandings`
    // includes them on the latch and reads an EMPTY roster map as legacy entry #1.
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    expect((await member(ALICE)).hasPlayableEntry).toBe(true);

    await del(HOST, ALICE, 1);
    const m = await member(ALICE);
    expect(m.hasPlayableEntry).toBe(false);
    expect(m.playableEntryCount).toBe(0);
    expect(m.entries).toEqual({});
    // A participant who joined still owes their join fee — liability is not the
    // same question as being on the leaderboard.
    expect(m.feeOwed).toBe(25);
  }, 60000);

  it('a REFUSED delete writes no audit row and no ledger line', async () => {
    // The trail must record deletions, not attempts — an audit row for a delete
    // that never happened is worse than none, because D12 makes these rows the
    // only evidence the entry existed at all.
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await poolRef().set({ scoredWeeks: { 1: true } }, { merge: true });
    await expect(del(HOST, ALICE, 2)).rejects.toThrow(/ENTRY_IS_SCORED/);

    const audit = (await poolRef().collection('audit').get()).docs
      .map(d => d.data()).filter(a => a.type === 'ENTRY_DELETED');
    expect(audit).toHaveLength(0);
    expect((await ledger(ALICE)).filter(l => l.type === 'ENTRY_DELETED')).toHaveLength(0);
  }, 60000);

  it('refuses an entry the member does not have, and never CREATES one', async () => {
    await seedPool({ max: 2, entryCount: 2 });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await expect(del(HOST, ALICE, 2)).rejects.toThrow(/ENTRY_NOT_FOUND/);
    expect((await entry(`e2:${ALICE}`)).exists).toBe(false);
    // A retried delete is ENTRY_NOT_FOUND, which is the right answer.
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    await del(HOST, ALICE, 2);
    await expect(del(HOST, ALICE, 2)).rejects.toThrow(/ENTRY_NOT_FOUND/);
  }, 60000);

  it('a legacy pool with NO entryCount derives it, then subtracts', async () => {
    await seedPool({ max: 2, entryCount: null });
    await submit(ALICE, { picks: { [G1]: 'KC' } });
    await submit(ALICE, { picks: { [G1]: 'BUF' }, entryIndex: 2 });
    expect((await pool()).entryCount).toBe(3);
    await poolRef().update({ entryCount: admin.firestore.FieldValue.delete() });   // back to legacy
    await del(HOST, ALICE, 2);
    // Derived from the Member Records (host 0 + alice 1-after + bob 1) rather
    // than incremented from a field that is not there.
    expect((await pool()).entryCount).toBe(2);
  }, 60000);
});
