import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { setPoolCoCommissioner, MAX_CO_COMMISSIONERS } from '../../coCommissioners';
import { extendWeekDeadline } from '../../poolExceptions';
import { setPaidStatus } from '../../setPaidStatus';

/**
 * setPoolCoCommissioner — PLAN-CO-COMMISSIONERS D2 (deploy step 3), the ONLY
 * writer of `coManagers`. Every gate in the callable's header has a case here,
 * plus the race the revision fence exists for (remove wins over a stale add),
 * and two end-to-end grants: a named co-commissioner is admitted on
 * extendWeekDeadline (C3) and setPaidStatus (C6, K3 = Yes).
 */
const test = ftest();
const db = admin.firestore();
const wSet = test.wrap(setPoolCoCommissioner);
const wExtend = test.wrap(extendWeekDeadline);
const wPaid = test.wrap(setPaidStatus);

const OWNER = 'cc-owner';
const MANAGER = 'cc-manager';
const ALICE = 'cc-alice';   // canonical member
const BOB = 'cc-bob';       // canonical member
const CAROL = 'cc-carol';   // canonical member
const DAVE = 'cc-dave';     // canonical member (4th, for the cap)
const GHOST = 'cc-ghost';   // in participantIds, NO member record
const POOL = 'cc-pool';
const SEASON = 'cc-season';
const HOUR = 60 * 60 * 1000;
const T = (a: string) => ({ id: a, name: a, abbreviation: a });

const auth = (uid: string, role?: string) => ({ uid, token: role ? { role } : {} }) as any;

async function seed(type = 'NFL_PICKEM') {
  await db.collection('pools').doc(POOL).set({
    name: 'co-comm', type, league: 'NFL', season: SEASON, seasonType: 1,
    ownerId: OWNER, managerUid: MANAGER,
    participantIds: [OWNER, MANAGER, ALICE, BOB, CAROL, DAVE, GHOST], status: 'OPEN',
    billing: { status: 'free' },
    settings: { entryFee: 25, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false },
  });
  for (const uid of [OWNER, MANAGER, ALICE, BOB, CAROL, DAVE]) {
    await db.collection('pools').doc(POOL).collection('members').doc(uid).set({
      uid, poolId: POOL, userName: uid, role: uid === OWNER ? 'MANAGER' : 'PARTICIPANT',
      joinedAt: Date.now(), paidStatus: 'UNPAID', feeOwed: 25, feeOwedSource: 'LIVE',
    });
    await db.collection('users').doc(uid).set({ name: uid, role: 'COMMISSIONER' });
  }
  await db.collection('users').doc(GHOST).set({ name: GHOST });
  // Claim+doc (PLAN-API-TRUST-BOUNDARY Phase 3): the SUPER_ADMIN caller's
  // claim must be backed by their users doc.
  await db.collection('users').doc('cc-sa').set({ role: 'SUPER_ADMIN' });
  await db.collection('nfl_games').doc('cc-g1').set({
    id: 'cc-g1', espnGameId: 'cc-g1', season: SEASON, seasonType: 1, week: 1,
    startTime: Date.now() + 4 * HOUR, status: 'SCHEDULED', isMonday: false,
    homeTeam: T('KC'), awayTeam: T('BUF'), scores: { home: 0, away: 0 }, spread: { value: -3, locked: true },
  });
}

const pool = async () => (await db.collection('pools').doc(POOL).get()).data()!;
const add = (uid: string, revision: number, as = OWNER, role?: string) =>
  wSet({ data: { op: 'add', poolId: POOL, uid, revision }, auth: auth(as, role) } as never);
const remove = (uid: string, as = OWNER) =>
  wSet({ data: { op: 'remove', poolId: POOL, uid }, auth: auth(as) } as never);

beforeEach(async () => {
  for (const col of ['pools', 'users', 'nfl_games']) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => db.recursiveDelete(d.ref)));
  }
  await seed();
});

describe('setPoolCoCommissioner — gates', () => {
  it('owner adds a canonical member: array + revision advance, audit event written', async () => {
    const r: any = await add(ALICE, 0);
    expect(r).toMatchObject({ success: true, coManagers: [ALICE], coManagersRevision: 1 });
    const p = await pool();
    expect(p.coManagers).toEqual([ALICE]);
    expect(p.coManagersRevision).toBe(1);
    const audit = await db.collection('pools').doc(POOL).collection('audit').where('type', '==', 'CO_COMMISSIONER_CHANGED').get();
    expect(audit.size).toBe(1);
    expect(audit.docs[0].data().payload).toMatchObject({ op: 'add', uid: ALICE, before: [], after: [ALICE], revision: 1 });
  });

  it('legacy managerUid may also name co-commissioners (strict owner set = ownerId ∨ managerUid)', async () => {
    await expect(add(ALICE, 0, MANAGER)).resolves.toBeTruthy();
  });

  it('a co-commissioner CANNOT add another (C10 — delegation does not delegate itself)', async () => {
    await add(ALICE, 0);
    await expect(add(BOB, 1, ALICE)).rejects.toThrow(/only the pool owner/i);
  });

  it('a plain member is refused', async () => {
    await expect(add(ALICE, 0, BOB)).rejects.toThrow(/only the pool owner/i);
  });

  it('a BANNED owner is refused', async () => {
    await db.collection('users').doc(OWNER).set({ role: 'BANNED' });
    await expect(add(ALICE, 0)).rejects.toThrow(/banned|permission/i);
  });

  it('a uid with NO canonical Member Record is refused (K6)', async () => {
    await expect(add(GHOST, 0)).rejects.toThrow(/member of the pool/i);
  });

  it('the owner cannot add themself, nor the managerUid', async () => {
    await expect(add(OWNER, 0)).rejects.toThrow(/already a commissioner/i);
    await expect(add(MANAGER, 0)).rejects.toThrow(/already a commissioner/i);
  });

  it(`cap: at most ${MAX_CO_COMMISSIONERS} (K5)`, async () => {
    await add(ALICE, 0); await add(BOB, 1); await add(CAROL, 2);
    await expect(add(DAVE, 3)).rejects.toThrow(/at most/i);
  });

  it('a non-NFL pool is refused (C13 — enforced, not implied)', async () => {
    await db.collection('pools').doc(POOL).update({ type: 'SQUARES' });
    await expect(add(ALICE, 0)).rejects.toThrow(/NFL pools only/i);
  });

  it('a stale revision is refused (failed-precondition) — the fence', async () => {
    await add(ALICE, 0);
    await expect(add(BOB, 0)).rejects.toThrow(/roster changed/i);
    await expect(add(BOB, 1)).resolves.toBeTruthy();
  });

  it('remove needs no revision, always wins, and a stale add after it is refused (codex r2 on the plan)', async () => {
    await add(ALICE, 0);                     // rev 1
    await remove(ALICE);                     // rev 2, no revision presented
    expect((await pool()).coManagers).toEqual([]);
    // A tab that still shows rev 1 tries to re-add: refused, the remove stands.
    await expect(add(ALICE, 1)).rejects.toThrow(/roster changed/i);
    expect((await pool()).coManagers).toEqual([]);
  });

  it('removing a uid that is not a co-commissioner is not-found; a duplicate add is already-exists', async () => {
    await expect(remove(ALICE)).rejects.toThrow(/not a co-commissioner/i);
    await add(ALICE, 0);
    await expect(add(ALICE, 1)).rejects.toThrow(/already a co-commissioner/i);
  });

  it('a malformed legacy array is rebuilt from its trustworthy strings, not honoured as-is', async () => {
    await db.collection('pools').doc(POOL).update({ coManagers: [ALICE, 42, ALICE, null] });
    await add(BOB, 0);
    expect((await pool()).coManagers).toEqual([ALICE, BOB]);
  });

  it('SUPER_ADMIN may name co-commissioners on any pool', async () => {
    await expect(add(ALICE, 0, 'cc-sa', 'SUPER_ADMIN')).resolves.toBeTruthy();
  });
});

describe('a named co-commissioner is a commissioner on the NFL callables', () => {
  it('C3 — extendWeekDeadline admits them', async () => {
    await add(ALICE, 0);
    await expect(wExtend({
      data: { poolId: POOL, week: 1, extraMinutes: 30, reason: 'co-comm test' }, auth: auth(ALICE),
    } as never)).resolves.toBeTruthy();
  });

  it('C6 (K3 Yes) — setPaidStatus authoritative mark admits them', async () => {
    await add(ALICE, 0);
    await expect(wPaid({
      data: { poolId: POOL, memberUid: BOB, isPaid: true }, auth: auth(ALICE),
    } as never)).resolves.toBeTruthy();
    const m = (await db.collection('pools').doc(POOL).collection('members').doc(BOB).get()).data()!;
    expect(m.paidStatus).toBe('PAID');
  });

  it('...and a plain member is still refused on both', async () => {
    await expect(wExtend({
      data: { poolId: POOL, week: 1, extraMinutes: 30, reason: 'plain member' }, auth: auth(BOB),
    } as never)).rejects.toThrow(/permission/i);
    await expect(wPaid({
      data: { poolId: POOL, memberUid: ALICE, isPaid: true }, auth: auth(BOB),
    } as never)).rejects.toThrow(/permission|commissioner/i);
  });
});
