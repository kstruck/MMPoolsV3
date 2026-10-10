import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { settlePool } from '../../poolSettlement';
import { settlementMailKey } from '../../lib/settlement';
import { executeSurvivorRebuyInternal, joinNFLPoolInternal, submitNFLPicksInternal } from '../../nflPools';
import { proxyPick, cancelPool, closePool } from '../../poolExceptions';

/**
 * PLAN-SPLIT-POT-SETTLEMENT §2.6 — the whole settlement against the emulator.
 *
 * A 4-entry Survivor pool, two ALIVE (alice, bob) and two ELIMINATED, $25 a head,
 * 100 % to 1st. Settling it must: rank both survivors 1st and split the $100 pot
 * ($50 each), write season history and Season Places through the unchanged
 * finalizer, flip the pool to COMPLETED/SETTLED WITHOUT the three legacy fields
 * whose triggers would fire, write exactly one pool audit row, email every
 * member once, and refuse every play path afterwards.
 */

/** What the callable returns, as far as these tests read it. */
interface SettleResult {
  success: boolean;
  emailed: number;
  emailFailed: number;
  preview?: unknown;
}

const test = ftest();
const db = admin.firestore();
const wSettle = test.wrap(settlePool);
const wProxy = test.wrap(proxyPick);
const wCancel = test.wrap(cancelPool);
const wClose = test.wrap(closePool);

const HOST = 'st-host';
const ALICE = 'st-alice';
const BOB = 'st-bob';
const CAROL = 'st-carol';
const DAN = 'st-dan';
const NEWBIE = 'st-newbie';
const CO = 'st-co';
const SEASON = 'st-2099';
const GAME = 'st-g5';
const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });
const auth = (uid: string) => ({ uid, token: { email: `${uid}@example.com` } }) as never;

let n = 0;
let POOL = '';
const created: string[] = [];
const poolRef = () => db.collection('pools').doc(POOL);
const poolDoc = async () => (await poolRef().get()).data()!;

async function seed(extra: Record<string, unknown> = {}) {
  n += 1;
  POOL = `st-pool-${Date.now()}-${n}`;
  created.push(POOL);
  await poolRef().set({
    type: 'NFL_SURVIVOR', league: 'NFL', name: 'Split Test', status: 'OPEN', isLocked: false,
    ownerId: HOST, managerUid: HOST, coManagers: [CO],
    participantIds: [HOST, ALICE, BOB, CAROL, DAN],
    season: SEASON, seasonType: 2, entryCount: 4,
    scoredWeeks: { 1: true, 2: true, 3: true, 4: true },
    settings: {
      entryFee: 25, maxStrikes: 0, payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
      rebuyCost: 25, rebuyDeadlineWeek: 9, maxRebuys: 1,
    },
    ...extra,
  });
  const e = (uid: string, over: Record<string, unknown>) => poolRef().collection('entries').doc(uid).set({
    id: uid, poolId: POOL, ownerUid: uid, userName: uid, strikesUsed: 0, rebuysUsed: 0,
    usedTeams: [], picks: {}, exemptWeeks: [], submittedAt: 1, paidStatus: 'PAID', ...over,
  });
  await e(ALICE, { status: 'ALIVE' });
  await e(BOB, { status: 'ALIVE' });
  await e(CAROL, { status: 'ELIMINATED', eliminatedWeek: 3, strikesUsed: 1 });
  await e(DAN, { status: 'ELIMINATED', eliminatedWeek: 1, strikesUsed: 1 });
  for (const uid of [ALICE, BOB, CAROL, DAN]) {
    await poolRef().collection('members').doc(uid).set({ uid, poolId: POOL, role: 'PARTICIPANT', paidStatus: 'PAID' });
  }
}

const settle = (uid = HOST, data: Record<string, unknown> = {}) =>
  // The seeded pool: 4 entries x $25, 100 % to 1st, two survivors -> $100 pot, $50 each.
  wSettle({ data: { poolId: POOL, outcome: 'SPLIT', entryIds: [BOB, ALICE], expectedPot: 100, expectedPrizePerEntry: 50, ...data }, auth: auth(uid) } as never) as Promise<SettleResult>;

beforeEach(async () => {
  for (const uid of [HOST, ALICE, BOB, CAROL, DAN, NEWBIE, CO]) {
    await db.collection('users').doc(uid).set({ name: uid, email: `${uid}@example.com` });
  }
  await db.collection('nfl_games').doc(GAME).set({
    id: GAME, espnGameId: GAME, season: SEASON, seasonType: 2, week: 5,
    startTime: Date.now() + 48 * 3600 * 1000, status: 'SCHEDULED', isMonday: false,
    homeTeam: T('KC'), awayTeam: T('BUF'),
  });
});

afterAll(async () => {
  try {
    for (const id of created) await db.recursiveDelete(db.collection('pools').doc(id));
    await db.collection('nfl_games').doc(GAME).delete();
    for (const uid of [HOST, ALICE, BOB, CAROL, DAN, NEWBIE, CO]) await db.recursiveDelete(db.collection('users').doc(uid));
  } catch (e) {
    console.warn('[poolSettlement.emulator] teardown incomplete:', e);
  }
  test.cleanup();
});

describe('settlePool — a full settlement', () => {
  it('finalizes now, splits 1st place, flips to COMPLETED/SETTLED without the legacy trio, audits once, emails every member', async () => {
    await seed();
    const res = await settle();
    expect(res.success).toBe(true);

    const p = await poolDoc();
    expect(p.status).toBe('COMPLETED');
    expect(p.closedVia).toBe('SETTLED');
    expect(typeof p.closedAt).toBe('number');
    // Sweep S1: these three would fire onPoolLocked stats and a SQUARES email.
    expect(p.isLocked).toBe(false);
    expect(p.isFinal).toBeUndefined();
    expect(p.scores).toBeUndefined();
    expect(p.finalizedAt).toBeTruthy();
    expect(p.finalizedVia).toBe('SETTLED');

    expect(p.settlement).toMatchObject({
      kind: 'SPLIT', entryIds: [ALICE, BOB].sort(), winnerNames: [ALICE, BOB].sort(),
      settledBy: HOST, note: null, throughWeek: 4, notifyMembers: true,
      prizePerEntry: 50, pot: 100, rebuyDuesExcluded: 0,
    });
    expect(p.settlement.adminAuditedAt).toBeTruthy();
    expect(p.settlement.emailedAt).toBeTruthy();

    // The unchanged finalizer: both survivors rank 1 and share the pot.
    const byEntry = Object.fromEntries((p.seasonPlaces as Array<{ entryId: string; rank: number; prize?: number }>).map(r => [r.entryId, r]));
    expect(byEntry[ALICE]).toMatchObject({ rank: 1, prize: 50 });
    expect(byEntry[BOB]).toMatchObject({ rank: 1, prize: 50 });
    expect(byEntry[CAROL].rank).toBe(3);
    expect(byEntry[CAROL].prize).toBeUndefined();
    const hist = (await db.collection('users').doc(ALICE).collection('seasonHistory').get()).docs.map(d => d.data());
    expect(hist.find(h => h.poolId === POOL)).toMatchObject({ finalRank: 1, isChampion: true });

    const audit = (await poolRef().collection('audit').where('type', '==', 'POOL_SETTLED').get()).docs;
    expect(audit).toHaveLength(1);

    // Every roster member (participantIds ∪ entry owners), once each: the host
    // and four players — the host has no entry and must still be told.
    expect(res.emailed).toBe(5);
  });

  it('a second call is ALREADY_SETTLED and changes nothing', async () => {
    await seed();
    await settle();
    const before = (await poolDoc()).settlement.settledAt;
    await expect(settle()).rejects.toThrow(/ALREADY_SETTLED/);
    expect((await poolDoc()).settlement.settledAt).toBe(before);
  });

  it('records the rebuy dues the pot does not include', async () => {
    await seed();
    await poolRef().collection('members').doc(CAROL).set({ rebuyOwed: 25 }, { merge: true });
    await settle(HOST, { notifyMembers: false });
    const p = await poolDoc();
    expect(p.settlement.rebuyDuesExcluded).toBe(25);
    expect(p.settlement.emailedAt).toBeUndefined();
  });
});

describe('settlePool — refusals', () => {
  it('refuses a co-commissioner (D2)', async () => {
    await seed();
    await expect(settle(CO)).rejects.toThrow();
    expect((await poolDoc()).status).toBe('OPEN');
  });

  it('refuses anything but the exact ALIVE set (D3), leaving the pool OPEN and unfinalized', async () => {
    await seed();
    await expect(settle(HOST, { entryIds: [ALICE] })).rejects.toThrow(/WINNERS_MUST_BE_ALIVE_SET/);
    await expect(settle(HOST, { entryIds: [ALICE, BOB, CAROL] })).rejects.toThrow(/WINNERS_MUST_BE_ALIVE_SET/);
    const p = await poolDoc();
    expect(p.status).toBe('OPEN');
    expect(p.finalizedAt).toBeUndefined();
    // codex code-review r5: a refused attempt leaves NO state a later call could
    // mistake for an interrupted settlement.
    expect(p.finalizedVia).toBeUndefined();
    expect(p.settlementStartedAt).toBeUndefined();
    expect((await poolRef().collection('audit').where('type', '==', 'POOL_SETTLED').get()).size).toBe(0);
  });

  it('refuses a non-Survivor pool, a cancelled pool, and a naturally finalized one', async () => {
    await seed({ type: 'NFL_PICKEM' });
    await expect(settle()).rejects.toThrow(/NOT_SURVIVOR/);
    await seed({ status: 'CANCELED' });
    await expect(settle()).rejects.toThrow(/ALREADY_CLOSED/);
    await seed({ finalizedAt: admin.firestore.Timestamp.now() });
    await expect(settle()).rejects.toThrow(/ALREADY_FINALIZED/);
  });
});

describe('settlePool — crash recovery', () => {
  it('a crashed attempt (marker + finalizedAt, still OPEN) completes on retry', async () => {
    await seed({ finalizedVia: 'SETTLED', finalizedAt: admin.firestore.Timestamp.now() });
    await settle(HOST, { notifyMembers: false });
    const p = await poolDoc();
    expect(p.closedVia).toBe('SETTLED');
    expect(p.finalizedVia).toBe('SETTLED');
  });

  it('FOLLOW_UP sends only the owed emails and re-runs nothing else', async () => {
    await seed({
      status: 'COMPLETED', closedVia: 'SETTLED',
      settlement: {
        kind: 'SPLIT', entryIds: [ALICE, BOB], winnerNames: [ALICE, BOB], settledAt: 7, settledBy: HOST,
        note: null, throughWeek: 4, notifyMembers: true, prizePerEntry: 50, pot: 100,
        rebuyDuesExcluded: 0, adminAuditedAt: 8,
      },
    });
    const res = await settle();
    expect(res.emailed).toBe(5);
    const p = await poolDoc();
    expect(p.settlement.settledAt).toBe(7);
    expect(p.settlement.adminAuditedAt).toBe(8);
    expect(p.settlement.emailedAt).toBeTruthy();
    expect(p.finalizedAt).toBeUndefined();           // the finalizer did NOT run again
    await expect(settle()).rejects.toThrow(/ALREADY_SETTLED/);
  });
});

describe('settlePool — read-only preview (codex code-review r1 P1)', () => {
  it('returns every ALIVE entry doc — including one standings would show as unscored — with the exact money, and writes nothing', async () => {
    await seed();
    const before = JSON.stringify(await poolDoc());
    const res = await wSettle({ data: { poolId: POOL, outcome: 'SPLIT', preview: true }, auth: auth(HOST) } as never) as SettleResult;
    expect(res.preview).toEqual({
      alive: [{ id: ALICE, name: ALICE }, { id: BOB, name: BOB }],
      pot: 100, prizePerEntry: 50, entryCount: 4, rebuyDuesExcluded: 0,
    });
    expect(JSON.stringify(await poolDoc())).toBe(before);
    expect((await poolRef().collection('audit').get()).size).toBe(0);
  });

  it('is refused to a co-commissioner and on a settled pool', async () => {
    await seed();
    await expect(wSettle({ data: { poolId: POOL, outcome: 'SPLIT', preview: true }, auth: auth(CO) } as never)).rejects.toThrow();
    await settle(HOST, { notifyMembers: false });
    await expect(wSettle({ data: { poolId: POOL, outcome: 'SPLIT', preview: true }, auth: auth(HOST) } as never)).rejects.toThrow(/ALREADY_SETTLED/);
  });
});

describe('settlePool — per-member delivery (codex code-review r2)', () => {
  it('a retry reaches only members not yet notified, and reads the roster as it is NOW', async () => {
    await seed({
      status: 'COMPLETED', closedVia: 'SETTLED',
      participantIds: [HOST, ALICE, BOB, CAROL, DAN, NEWBIE],   // NEWBIE joined after the first read
      settlement: {
        kind: 'SPLIT', entryIds: [ALICE, BOB], winnerNames: [ALICE, BOB], settledAt: 7, settledBy: HOST,
        note: null, throughWeek: 4, notifyMembers: true, prizePerEntry: 50, pot: 100,
        rebuyDuesExcluded: 0, adminAuditedAt: 8, notifiedUids: [ALICE, BOB],
      },
    });
    const res = await settle();
    expect(res.emailed).toBe(4);                      // host, carol, dan, newbie
    expect(res.emailFailed).toBe(0);
    const p = await poolDoc();
    expect([...p.settlement.notifiedUids].sort()).toEqual([ALICE, BOB, CAROL, DAN, HOST, NEWBIE].sort());
    expect(p.settlement.emailedAt).toBeTruthy();
    // No address ever lands on the member-readable pool document.
    expect(JSON.stringify(p.settlement)).not.toContain('@');
  });
});

describe('settlePool — an email already queued is never sent twice (qodo #4 on #715)', () => {
  it('a crash after the enqueue but before the notifiedUids stamp: the retry sends the rest and leaves that mail doc alone', async () => {
    const mailId = (uid: string) => settlementMailKey(POOL, 7, uid);
    await seed({
      status: 'COMPLETED', closedVia: 'SETTLED',
      settlement: {
        kind: 'SPLIT', entryIds: [ALICE, BOB], winnerNames: [ALICE, BOB], settledAt: 7, settledBy: HOST,
        note: null, throughWeek: 4, notifyMembers: true, prizePerEntry: 50, pot: 100,
        rebuyDuesExcluded: 0, adminAuditedAt: 8,       // notifiedUids absent: the stamp was lost
      },
    });
    // Carol's mail was enqueued by the crashed attempt.
    await db.collection('mail').doc(mailId(CAROL)).set({ to: `${CAROL}@example.com`, poolId: POOL, preexisting: true });
    try {
      const res = await settle();
      expect(res.emailed).toBe(4);                     // everyone except Carol
      expect(res.emailFailed).toBe(0);
      const carolMail = (await db.collection('mail').doc(mailId(CAROL)).get()).data();
      expect(carolMail).toEqual({ to: `${CAROL}@example.com`, poolId: POOL, preexisting: true });   // untouched, not re-created
      for (const uid of [HOST, ALICE, BOB, DAN]) {
        expect((await db.collection('mail').doc(mailId(uid)).get()).exists).toBe(true);
      }
      const p = await poolDoc();
      expect([...p.settlement.notifiedUids].sort()).toEqual([ALICE, BOB, CAROL, DAN, HOST].sort());   // Carol is stamped done
      expect(p.settlement.emailedAt).toBeTruthy();
    } finally {
      for (const uid of [HOST, ALICE, BOB, CAROL, DAN]) await db.collection('mail').doc(mailId(uid)).delete();
    }
  });
});

describe('settlePool — overlapping FOLLOW_UP retries (codex code-review r1 P2)', () => {
  it('two concurrent retries send each email exactly once in total', async () => {
    await seed({
      status: 'COMPLETED', closedVia: 'SETTLED',
      settlement: {
        kind: 'SPLIT', entryIds: [ALICE, BOB], winnerNames: [ALICE, BOB], settledAt: 7, settledBy: HOST,
        note: null, throughWeek: 4, notifyMembers: true, prizePerEntry: 50, pot: 100,
        rebuyDuesExcluded: 0, adminAuditedAt: 8,
      },
    });
    const [a, b] = await Promise.all([settle(), settle()]);
    expect(a.emailed + b.emailed).toBe(5);
    expect([a.emailed, b.emailed].sort()).toEqual([0, 5]);
  });
});

describe('a settled pool takes no more play (POOL_OVER)', () => {
  it('refuses a pick, a proxy pick, a rebuy and a new member', async () => {
    await seed();
    await settle(HOST, { notifyMembers: false });

    await expect(submitNFLPicksInternal(db, { actorUid: ALICE, subjectUid: ALICE, subjectName: ALICE },
      { poolId: POOL, week: 5, picks: { 5: 'KC' } } as never)).rejects.toThrow(/POOL_OVER/);
    await expect(wProxy({
      data: { poolId: POOL, week: 5, targetUid: ALICE, picks: { 5: 'KC' }, reason: 'test' },
      auth: auth(HOST),
    } as never)).rejects.toThrow(/POOL_OVER/);
    await expect(executeSurvivorRebuyInternal(db, { actorUid: CAROL, subjectUid: CAROL }, { poolId: POOL, week: 5 }))
      .rejects.toThrow(/POOL_OVER/);
    await expect(joinNFLPoolInternal(db, { subjectUid: NEWBIE, subjectName: NEWBIE }, POOL))
      .rejects.toThrow(/POOL_OVER/);
    // …and an EXISTING participant re-running join is refused too (codex r6):
    // that branch could otherwise create a Member Record and move entryCount.
    const countBefore = (await poolDoc()).entryCount;
    await expect(joinNFLPoolInternal(db, { subjectUid: HOST, subjectName: HOST }, POOL))
      .rejects.toThrow(/POOL_OVER/);
    expect((await poolDoc()).entryCount).toBe(countBefore);
  });
});

describe('cancel / close respect the scoring lease (codex code-review r4)', () => {
  it('a live lease (a settlement or a scoring pass in flight) bounces both, leaving the pool untouched', async () => {
    await seed({ autoScore: { scoringLease: { owner: 'someone', until: Date.now() + 5 * 60 * 1000 } } });
    await expect(wCancel({ data: { poolId: POOL, reason: 'testing the race' }, auth: auth(HOST) } as never))
      .rejects.toThrow(/SCORING_IN_PROGRESS/);
    await expect(wClose({ data: { poolId: POOL }, auth: auth(HOST) } as never))
      .rejects.toThrow(/SCORING_IN_PROGRESS/);
    const p = await poolDoc();
    expect(p.status).toBe('OPEN');
    expect(p.closedVia).toBeUndefined();
  });

  it('with no live lease, cancel still works', async () => {
    await seed({ autoScore: { scoringLease: { owner: 'someone', until: Date.now() - 1000 } } });
    await wCancel({ data: { poolId: POOL, reason: 'season over early' }, auth: auth(HOST) } as never);
    expect((await poolDoc()).status).toBe('CANCELED');
  });
});

describe('qodo review of #715', () => {
  it('#1 a settled pool cannot be cancelled (no overwrite, no cancellation email)', async () => {
    await seed();
    await settle(HOST, { notifyMembers: false });
    await expect(wCancel({ data: { poolId: POOL, reason: 'changed my mind' }, auth: auth(HOST) } as never))
      .rejects.toThrow(/POOL_OVER/);
    const p = await poolDoc();
    expect(p.status).toBe('COMPLETED');
    expect(p.closedVia).toBe('SETTLED');
  });

  it('#1 an interrupted settlement cannot be admin-closed out from under its resume', async () => {
    await seed({ finalizedVia: 'SETTLED', finalizedAt: admin.firestore.Timestamp.now() });
    await expect(wClose({ data: { poolId: POOL }, auth: auth(HOST) } as never)).rejects.toThrow(/SETTLEMENT_IN_PROGRESS/);
  });

  it('#3 the Super-Admin audit row has one stable id per settlement', async () => {
    await seed();
    await settle(HOST, { notifyMembers: false });
    const s = (await poolDoc()).settlement;
    const doc = await db.collection('admin_audit').doc(`pool-settled-${POOL}-${s.settledAt}`).get();
    expect(doc.exists).toBe(true);
  });

  it('#10 more than 50 survivors can still be settled', async () => {
    await seed();
    const many = Array.from({ length: 60 }, (_, i) => `st-many-${i}`);
    for (const id of many) {
      await poolRef().collection('entries').doc(id).set({ id, poolId: POOL, ownerUid: id, userName: id, status: 'ALIVE', strikesUsed: 0 });
    }
    const pv = await wSettle({ data: { poolId: POOL, outcome: 'SPLIT', preview: true }, auth: auth(HOST) } as never) as SettleResult;
    const q = pv.preview as { pot: number | null; prizePerEntry: number | null };
    const res = await settle(HOST, { entryIds: [ALICE, BOB, ...many], notifyMembers: false, expectedPot: q.pot, expectedPrizePerEntry: q.prizePerEntry });
    expect(res.success).toBe(true);
    expect((await poolDoc()).settlement.entryIds).toHaveLength(62);
  });
});

describe('codex code-review r11 — the confirmed pot', () => {
  it('a pot that changed since the preview is refused with QUOTE_CHANGED, and nothing is written', async () => {
    await seed();
    await poolRef().update({ entryCount: 5 });          // someone joined after the preview
    await expect(settle()).rejects.toThrow(/QUOTE_CHANGED/);
    const p = await poolDoc();
    expect(p.status).toBe('OPEN');
    expect(p.finalizedAt).toBeUndefined();
  });
});
