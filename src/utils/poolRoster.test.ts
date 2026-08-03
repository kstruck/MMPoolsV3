import { describe, it, expect } from 'vitest';
import {
  buildPoolRoster,
  rosterPotStats,
  outstandingDue,
  clearingRate,
  duesRates,
  memberOutstanding,
  unsubmittedRoster,
  type RosterInputs,
} from './poolRoster';

/**
 * These cover the defect this module exists for — an entries-only money reader
 * being blind to every member who holds a Member Record but no entry document —
 * plus the four codex-hardened edge cases the dues maths carries over from
 * PLAN-PAYMENT-TRUTH P3. Each assertion was verified to FAIL with the
 * corresponding line reverted; a test nobody has watched fail is not a guard.
 */

const pool = (over: any = {}) => ({
  id: 'p1',
  ownerId: 'owner',
  settings: { entryFee: 20 },
  participantIds: ['owner'],
  ...over,
});

/**
 * Every member fixture is CANONICAL by default — `joinedAt` stamped, as every
 * server join path stamps it (`planMembershipWrite`).
 *
 * Defaulted here rather than repeated on ~30 fixtures, because the alternative
 * is that one fixture quietly omits it and the test then asserts the behaviour
 * of a FORGED record while reading as if it were about a real member. A test
 * that wants the forged shape opts out explicitly with `joinedAt: undefined`,
 * which the spread order below honours.
 */
const inputs = (over: Partial<RosterInputs>): RosterInputs => {
  const base: RosterInputs = { pool: pool(), members: [], entries: [], ...over };
  return { ...base, members: base.members.map((m) => ({ joinedAt: 1, ...m })) };
};

describe('buildPoolRoster', () => {
  it('lists a member who has a Member Record but NO entry (the D13 blind spot)', () => {
    const rows = buildPoolRoster(
      inputs({
        pool: pool({ participantIds: ['owner', 'm2'] }),
        members: [
          { uid: 'owner', userName: 'Commish', paidStatus: 'PAID' },
          { uid: 'm2', userName: 'Dana', paidStatus: 'UNPAID' },
        ],
      }),
    );
    expect(rows.map((r) => r.uid).sort()).toEqual(['m2', 'owner']);
    const dana = rows.find((r) => r.uid === 'm2')!;
    expect(dana.userName).toBe('Dana');
    expect(dana.hasEntry).toBe(false);
    expect(dana.hasMember).toBe(true);
    expect(dana.paidStatus).toBe('UNPAID');
  });

  it('the Member Record paid status wins over a stale entry mirror', () => {
    const rows = buildPoolRoster(
      inputs({
        pool: pool({ participantIds: ['u1'] }),
        members: [{ uid: 'u1', userName: 'Ada', paidStatus: 'PAID' }],
        entries: [{ id: 'u1', ownerUid: 'u1', userName: 'Ada', paidStatus: 'UNPAID' }],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].paidStatus).toBe('PAID');
  });

  it('falls back to the entry when no Member Record exists (pre-backfill)', () => {
    const rows = buildPoolRoster(
      inputs({
        pool: pool({ participantIds: [] }),
        entries: [{ id: 'u1', ownerUid: 'u1', userName: 'Ada', paidStatus: 'PAID' }],
      }),
    );
    expect(rows[0].hasMember).toBe(false);
    expect(rows[0].paidStatus).toBe('PAID');
  });

  it('never lists the SQUARES guest sentinel as a person', () => {
    const rows = buildPoolRoster(
      inputs({ pool: pool({ participantIds: ['owner', 'guest', ''] }) }),
    );
    expect(rows.map((r) => r.uid)).toEqual(['owner']);
  });

  it('prefers the Member Record payment detail and falls back to the entry mirror', () => {
    const rows = buildPoolRoster(
      inputs({
        members: [
          { uid: 'u1', userName: 'Ada', paidStatus: 'PAID', paymentMethod: 'Zelle', paidAt: 111 },
          { uid: 'u2', userName: 'Bo', paidStatus: 'PAID' },
        ],
        entries: [
          { id: 'u1', ownerUid: 'u1', paymentMethod: 'Venmo', paidAt: 999, paymentNote: 'from entry' },
          { id: 'u2', ownerUid: 'u2', paymentMethod: 'Cash', paidAt: 222, paymentNote: 'entry only' },
        ],
      }),
    );
    const u1 = rows.find((r) => r.uid === 'u1')!;
    expect(u1.paymentMethod).toBe('Zelle');
    expect(u1.paidAt).toBe(111);
    // Not on the member record at all — the mirror is the only source left.
    expect(u1.paymentNote).toBe('from entry');
    const u2 = rows.find((r) => r.uid === 'u2')!;
    expect(u2.paymentMethod).toBe('Cash');
    expect(u2.paidAt).toBe(222);
  });

  it('an explicitly cleared member paidAt (null) is not overwritten by the entry', () => {
    // `setPaidStatus` supports "paid, but no date on record"; a fallback that
    // treated null as absent would resurrect a stale entry date.
    const rows = buildPoolRoster(
      inputs({
        pool: pool({ participantIds: ['u1'] }),
        members: [{ uid: 'u1', paidStatus: 'PAID', paidAt: null }],
        entries: [{ id: 'u1', ownerUid: 'u1', paidAt: 999 }],
      }),
    );
    expect(rows[0].paidAt).toBeNull();
  });

  it('marks the owner row and carries entry play state through', () => {
    const rows = buildPoolRoster(
      inputs({
        members: [{ uid: 'owner', userName: 'Commish', paidStatus: 'UNPAID' }],
        entries: [{ id: 'owner', ownerUid: 'owner', status: 'ALIVE', strikesUsed: 1, seasonTotal: 42 }],
      }),
    );
    expect(rows[0].isOwner).toBe(true);
    expect(rows[0].status).toBe('ALIVE');
    expect(rows[0].strikesUsed).toBe(1);
    expect(rows[0].seasonTotal).toBe(42);
  });
});

describe('rosterPotStats', () => {
  it('counts entry-less members — an entries-only reader reported $0 here', () => {
    const pot = rosterPotStats(
      inputs({
        pool: pool({ participantIds: ['owner', 'm2'] }),
        members: [
          { uid: 'owner', paidStatus: 'PAID' },
          { uid: 'm2', paidStatus: 'UNPAID' },
        ],
      }),
    );
    expect(pot.memberCount).toBe(2);
    expect(pot.expected).toBe(40);
    expect(pot.collected).toBe(20);
    expect(pot.paidCount).toBe(1);
    expect(pot.unpaidCount).toBe(1);
  });

  it('an unset entry fee stays $0 — it does NOT invent a default', () => {
    // The Bento ledger read `entryFee || 20`, so a free pool projected a pot.
    const pot = rosterPotStats(
      inputs({
        pool: pool({ settings: {}, participantIds: ['a', 'b'] }),
        members: [
          { uid: 'a', paidStatus: 'PAID' },
          { uid: 'b', paidStatus: 'UNPAID' },
        ],
      }),
    );
    expect(pot.expected).toBe(0);
    expect(pot.collected).toBe(0);
  });

  it('a stamped feeOwed of 0 (seeded owner: hosting is not playing) owes nothing', () => {
    const pot = rosterPotStats(
      inputs({
        pool: pool({ participantIds: ['owner', 'm2'] }),
        members: [
          { uid: 'owner', paidStatus: 'PAID', feeOwed: 0 },
          { uid: 'm2', paidStatus: 'UNPAID' },
        ],
      }),
    );
    expect(pot.expected).toBe(20);
    expect(pot.collected).toBe(0);
    // Still counted as a paid member — paidCount is about status, not dollars.
    expect(pot.paidCount).toBe(1);
  });

  it('an OWED rebuy is expected money, not collected money (codex r1 / D12)', () => {
    const pot = rosterPotStats(
      inputs({
        pool: pool({ participantIds: ['a'] }),
        members: [{ uid: 'a', paidStatus: 'PAID', rebuyOwed: 15, rebuyPaid: 0 }],
      }),
    );
    expect(pot.expected).toBe(35);
    expect(pot.collected).toBe(20);
  });

  it('a settled rebuy adds to collected', () => {
    const pot = rosterPotStats(
      inputs({
        pool: pool({ participantIds: ['a'] }),
        members: [{ uid: 'a', paidStatus: 'PAID', rebuyOwed: 15, rebuyPaid: 15 }],
      }),
    );
    expect(pot.collected).toBe(35);
    expect(outstandingDue(pot)).toBe(0);
  });

  it('an un-stamped rebuyOwed falls back to entry evidence (codex r3)', () => {
    const pot = rosterPotStats(
      inputs({
        pool: pool({ settings: { entryFee: 20, rebuyCost: 5 }, participantIds: ['a'] }),
        members: [{ uid: 'a', paidStatus: 'UNPAID' }],
        entries: [{ id: 'a', ownerUid: 'a', rebuysUsed: 3 }],
      }),
    );
    expect(pot.expected).toBe(35); // 20 fee + 3 x 5
  });

  it('a STAMPED rebuyOwed of 0 is trusted over entry evidence (codex r3)', () => {
    const pot = rosterPotStats(
      inputs({
        pool: pool({ settings: { entryFee: 20, rebuyCost: 5 }, participantIds: ['a'] }),
        members: [{ uid: 'a', paidStatus: 'UNPAID', rebuyOwed: 0 }],
        entries: [{ id: 'a', ownerUid: 'a', rebuysUsed: 3 }],
      }),
    );
    expect(pot.expected).toBe(20);
  });

  it('a partially backfilled pool keeps unmatched entries’ fee AND rebuy dues (codex r4)', () => {
    const pot = rosterPotStats(
      inputs({
        pool: pool({ settings: { entryFee: 20, rebuyCost: 5 }, participantIds: ['a', 'b'] }),
        members: [{ uid: 'a', paidStatus: 'PAID' }],
        entries: [
          { id: 'a', ownerUid: 'a' },
          { id: 'b', ownerUid: 'b', rebuysUsed: 2 },
        ],
      }),
    );
    // a: 20. b has no Member Record: 20 fee + 2 x 5 rebuy.
    expect(pot.expected).toBe(50);
    expect(pot.memberCount).toBe(2);
  });

  it('pre-backfill (no Member Records at all) derives everything from entries', () => {
    const pot = rosterPotStats(
      inputs({
        pool: pool({ settings: { entryFee: 10, rebuyCost: 4 }, participantIds: [] }),
        entries: [
          { id: 'a', ownerUid: 'a', paidStatus: 'PAID' },
          { id: 'b', ownerUid: 'b', paidStatus: 'UNPAID', rebuysUsed: 2 },
        ],
      }),
    );
    expect(pot.memberCount).toBe(2);
    expect(pot.paidCount).toBe(1);
    expect(pot.collected).toBe(10);
    expect(pot.expected).toBe(28); // 2 x 10 + 2 x 4
  });

  it('participantIds beyond both stores still owe the fee', () => {
    const pot = rosterPotStats(
      inputs({
        pool: pool({ participantIds: ['a', 'b', 'c'] }),
        members: [{ uid: 'a', paidStatus: 'PAID' }],
      }),
    );
    expect(pot.memberCount).toBe(3);
    expect(pot.expected).toBe(60);
  });

  it('counts the UID UNION, not the largest single source (codex r1)', () => {
    // members and participantIds hold a,b; an entry exists for c alone. A
    // max(2, 2, 1) head count returns 2 — undercounting the roster
    // buildPoolRoster actually produces, and then `memberCount - members.length`
    // is 0, so c's base fee silently disappears from `expected`.
    const args = inputs({
      pool: pool({ participantIds: ['a', 'b'] }),
      members: [
        { uid: 'a', paidStatus: 'PAID' },
        { uid: 'b', paidStatus: 'UNPAID' },
      ],
      entries: [{ id: 'c', ownerUid: 'c', paidStatus: 'UNPAID' }],
    });
    const pot = rosterPotStats(args);
    expect(pot.memberCount).toBe(3);
    expect(pot.expected).toBe(60); // a + b + c, one fee each
    expect(pot.unpaidCount).toBe(2);
    // The head count and the roster must be the same set of people.
    expect(pot.memberCount).toBe(buildPoolRoster(args).length);
  });

  it('an entry-only person who is PAID is counted as paid (codex r2)', () => {
    // buildPoolRoster renders this person's row as PAID off the entry, so the
    // totals must agree. Charging them in `expected` while ignoring their
    // payment showed a PAID row beside an understated Collected — and the old
    // entries-backed ledger DID count it, so dropping it was a regression.
    const args = inputs({
      pool: pool({ participantIds: ['a'] }),
      members: [{ uid: 'a', paidStatus: 'UNPAID' }],
      entries: [{ id: 'c', ownerUid: 'c', paidStatus: 'PAID' }],
    });
    const pot = rosterPotStats(args);
    expect(pot.memberCount).toBe(2);
    expect(pot.expected).toBe(40);
    expect(pot.collected).toBe(20);
    expect(pot.paidCount).toBe(1);
    expect(pot.unpaidCount).toBe(1);
    expect(clearingRate(pot)).toBe(50);
    expect(outstandingDue(pot)).toBe(20);
    // The row really does render PAID — that is why the totals had to change.
    expect(buildPoolRoster(args).find(r => r.uid === 'c')!.paidStatus).toBe('PAID');
  });

  it('an entry-only person who is UNPAID is not counted as paid', () => {
    const pot = rosterPotStats(
      inputs({
        pool: pool({ participantIds: ['a'] }),
        members: [{ uid: 'a', paidStatus: 'PAID' }],
        entries: [{ id: 'c', ownerUid: 'c', paidStatus: 'UNPAID' }],
      }),
    );
    expect(pot.paidCount).toBe(1);
    expect(pot.collected).toBe(20);
    expect(pot.expected).toBe(40);
  });

  it('an entry-only person’s rebuy dues are charged too (codex r1)', () => {
    const pot = rosterPotStats(
      inputs({
        pool: pool({ settings: { entryFee: 20, rebuyCost: 5 }, participantIds: ['a'] }),
        members: [{ uid: 'a', paidStatus: 'PAID' }],
        entries: [{ id: 'c', ownerUid: 'c', rebuysUsed: 4 }],
      }),
    );
    expect(pot.memberCount).toBe(2);
    expect(pot.expected).toBe(60); // a: 20; c: 20 fee + 4 x 5 rebuy
  });

  it('the guest sentinel is excluded from the head count as well as the roster', () => {
    const pot = rosterPotStats(
      inputs({
        pool: pool({ participantIds: ['a', 'guest'] }),
        members: [{ uid: 'a', paidStatus: 'PAID' }],
        entries: [{ id: 'guest', ownerUid: 'guest' }],
      }),
    );
    expect(pot.memberCount).toBe(1);
    expect(pot.expected).toBe(20);
  });

  it('a FREE pool is 100% cleared, not 0% (codex r5)', () => {
    // Nobody is marked PAID because nobody owes anything. A paid-STATUS clearing
    // rate reported 0% beside Expected $0 and Outstanding Due $0.
    const args = inputs({
      pool: pool({ settings: {}, participantIds: ['a', 'b'] }),
      members: [
        { uid: 'a', paidStatus: 'UNPAID' },
        { uid: 'b', paidStatus: 'UNPAID' },
      ],
    });
    const pot = rosterPotStats(args);
    expect(pot.expected).toBe(0);
    expect(outstandingDue(pot)).toBe(0);
    expect(pot.paidCount).toBe(0);
    expect(pot.clearedCount).toBe(2);
    expect(clearingRate(pot)).toBe(100);
    // ...and nobody belongs in a "still owing" queue.
    const rates = duesRates(args.pool);
    expect(buildPoolRoster(args).filter(r => memberOutstanding(r, rates) > 0)).toEqual([]);
  });

  it('a seeded owner with feeOwed 0 is cleared even though UNPAID (codex r5)', () => {
    const args = inputs({
      pool: pool({ participantIds: ['owner', 'm2'] }),
      members: [
        { uid: 'owner', paidStatus: 'UNPAID', feeOwed: 0 },
        { uid: 'm2', paidStatus: 'PAID' },
      ],
    });
    const pot = rosterPotStats(args);
    expect(pot.clearedCount).toBe(2);
    expect(clearingRate(pot)).toBe(100);
    expect(outstandingDue(pot)).toBe(0);
    const rates = duesRates(args.pool);
    expect(buildPoolRoster(args).filter(r => memberOutstanding(r, rates) > 0)).toEqual([]);
  });

  it('a PAID member who still owes a rebuy is NOT cleared (codex r5)', () => {
    // The other direction: paid status overstates clearance when rebuy dues are
    // outstanding, because base and rebuy dues settle independently (P3).
    const args = inputs({
      pool: pool({ participantIds: ['a'] }),
      members: [{ uid: 'a', paidStatus: 'PAID', rebuyOwed: 15, rebuyPaid: 0 }],
    });
    const pot = rosterPotStats(args);
    expect(pot.paidCount).toBe(1);
    expect(pot.clearedCount).toBe(0);
    expect(clearingRate(pot)).toBe(0);
    expect(outstandingDue(pot)).toBe(15);
    const rates = duesRates(args.pool);
    expect(buildPoolRoster(args).filter(r => memberOutstanding(r, rates) > 0)).toHaveLength(1);
  });

  it('memberOutstanding never returns a credit for an overpaid rebuy', () => {
    const rates = { entryFee: 20, rebuyCost: 5 };
    expect(memberOutstanding(
      { uid: 'a', paidStatus: 'PAID', hasMember: true, hasEntry: false, isOwner: false, rebuyOwed: 10, rebuyPaid: 40 },
      rates,
    )).toBe(0);
  });

  it('an empty pool is $0 / 0%, not a divide-by-zero', () => {
    const pot = rosterPotStats(inputs({ pool: pool({ participantIds: [] }) }));
    expect(pot).toEqual({ memberCount: 0, paidCount: 0, unpaidCount: 0, clearedCount: 0, collected: 0, expected: 0 });
    expect(clearingRate(pot)).toBe(0);
    expect(outstandingDue(pot)).toBe(0);
  });

  it('outstanding never goes negative when collected exceeds expected', () => {
    expect(outstandingDue({ memberCount: 1, paidCount: 1, unpaidCount: 0, clearedCount: 1, collected: 50, expected: 20 })).toBe(0);
  });

  it('clearing rate is paid over everyone who joined, not over entry holders', () => {
    // Four joined, one paid, only that one has an entry. An entries-only
    // denominator would report 100%.
    const pot = rosterPotStats(
      inputs({
        pool: pool({ participantIds: ['a', 'b', 'c', 'd'] }),
        members: [
          { uid: 'a', paidStatus: 'PAID' },
          { uid: 'b', paidStatus: 'UNPAID' },
          { uid: 'c', paidStatus: 'UNPAID' },
          { uid: 'd', paidStatus: 'UNPAID' },
        ],
        entries: [{ id: 'a', ownerUid: 'a', paidStatus: 'PAID' }],
      }),
    );
    expect(clearingRate(pot)).toBe(25);
  });
});

/**
 * A forged Member Record must not reach ANY roster surface.
 *
 * Before #344, `setPaidStatus`'s claim branch would CREATE
 * `pools/{anyPool}/members/{caller}` for any authenticated caller, writing only
 * `memberReportedPaid` / `memberReportedAt`. #344 shut that door and #338 stopped
 * such a record being a reminder target — but this module still put it on the
 * commissioner's roster list, in `memberCount`, and in the dues totals, so a
 * stranger who self-added before #344 landed still appeared on that pool.
 *
 * The forged shape below is the real one: the two claim fields, no `joinedAt`,
 * and — decisively — NO `participantIds` entry and NO entry document, because
 * the exploit wrote only the member doc.
 */
describe('forged Member Records (the #344 shape) are not roster truth', () => {
  const FORGED = { uid: 'stranger', memberReportedPaid: true, memberReportedAt: 123, joinedAt: undefined };

  it('does not list a forged record on the commissioner roster', () => {
    const rows = buildPoolRoster(
      inputs({
        pool: pool({ participantIds: ['owner'] }),
        members: [{ uid: 'owner', userName: 'Commish', paidStatus: 'UNPAID' }, FORGED],
      }),
    );
    expect(rows.map((r) => r.uid)).toEqual(['owner']);
  });

  it('does not count a forged record in memberCount, and does not charge it dues', () => {
    const args = inputs({
      pool: pool({ participantIds: ['owner'] }),
      members: [{ uid: 'owner', userName: 'Commish', paidStatus: 'UNPAID' }, FORGED],
    });
    const pot = rosterPotStats(args);
    expect(pot.memberCount).toBe(1);
    // The head count and the rendered roster must agree — the invariant this
    // module already holds for every other source.
    expect(pot.memberCount).toBe(buildPoolRoster(args).length);
    // One member at the $20 pool fee. A forged record counted here inflated
    // Expected by a whole entry fee for someone who owes nothing to anyone.
    expect(pot.expected).toBe(20);
    expect(pot.unpaidCount).toBe(1);
  });

  it('a forged record does not put a stranger in the unsubmitted-picks list', () => {
    const roster = buildPoolRoster(
      inputs({
        pool: pool({ participantIds: ['owner'] }),
        members: [{ uid: 'owner', userName: 'Commish', paidStatus: 'UNPAID' }, FORGED],
        entries: [{ id: 'owner', ownerUid: 'owner', picks: { g1: 'A', g2: 'B' } }],
      }),
    );
    expect(unsubmittedRoster(roster, { poolType: 'NFL_PICKEM', week: 1, weeklyGameIds: ['g1', 'g2'] })).toEqual([]);
  });

  it('a pool whose ONLY member record is forged reads as empty, not as one member', () => {
    const args = inputs({ pool: pool({ participantIds: [] }), members: [FORGED] });
    expect(buildPoolRoster(args)).toEqual([]);
    expect(rosterPotStats(args).memberCount).toBe(0);
    expect(rosterPotStats(args).expected).toBe(0);
  });

  /**
   * The genuine-member half of the rule, and the one that decides whether this
   * filter is safe to ship. CODEX ROUND 1, P1: filtering on the canonical stamp
   * ALONE also discards a real participant's un-stamped record — and those exist
   * carrying real money state, because `setPaidStatus`'s commissioner branch
   * merges `paidStatus: 'PAID'` without stamping `joinedAt`, and
   * `reconcilePaymentTruth` promotes claim-only documents to PAID from a paid
   * entry.
   *
   * The failure that caused was silent and expensive: the commissioner marks
   * someone PAID, the roster keeps showing UNPAID, and `collected` loses the fee.
   *
   * `participantIds` is what separates them — every server join path writes it,
   * and the #344 exploit wrote only the member document.
   */
  it('keeps the PAYMENT state of an un-stamped record for a real participant (codex r1 P1)', () => {
    const args = inputs({
      pool: pool({ participantIds: ['owner', 'legacy'] }),
      members: [
        { uid: 'owner', userName: 'Commish', paidStatus: 'UNPAID' },
        // Marked PAID by the commissioner; never stamped canonical.
        { uid: 'legacy', userName: 'Legacy', paidStatus: 'PAID', joinedAt: undefined },
      ],
    });
    const legacy = buildPoolRoster(args).find((r) => r.uid === 'legacy')!;
    expect(legacy.hasMember).toBe(true);
    expect(legacy.userName).toBe('Legacy');
    // The assertion that fails if the canonical-only filter comes back: an
    // entry-less member whose record is discarded reads UNPAID off no entry.
    expect(legacy.paidStatus).toBe('PAID');

    const pot = rosterPotStats(args);
    expect(pot.memberCount).toBe(2);
    expect(pot.expected).toBe(40);
    // Their $20 must still be counted as collected.
    expect(pot.collected).toBe(20);
    expect(pot.paidCount).toBe(1);
  });

  it('an un-stamped record for a real participant keeps its fee and rebuy stamps', () => {
    const args = inputs({
      pool: pool({ participantIds: ['legacy'], settings: { entryFee: 20, rebuyCost: 5 } }),
      members: [
        { uid: 'legacy', paidStatus: 'UNPAID', feeOwed: 0, rebuyOwed: 10, rebuyPaid: 10, joinedAt: undefined },
      ],
    });
    // feeOwed: 0 (a seeded host) plus a fully settled rebuy = owes nothing.
    // Discarding the record would charge them the full $20 pool fee instead.
    expect(rosterPotStats(args).expected).toBe(10);
    expect(rosterPotStats(args).clearedCount).toBe(1);
  });

  // The SOURCE invariant that protects this filter from a projecting caller
  // lives with the other two doors' invariants, in
  // `tests/setpaidstatus-membership-guard.test.ts` — one home for the rule that
  // all three readers share a discriminator.
});

/**
 * Submission Health — HANDOFF item 12. Every case below was verified to FAIL
 * against the entries-derived version this replaced.
 */
describe('unsubmittedRoster', () => {
  const PICKEM = { poolType: 'NFL_PICKEM', week: 1, weeklyGameIds: ['g1', 'g2'] };

  it('counts a member with NO entry as pending — the whole point (HANDOFF item 12)', () => {
    const roster = buildPoolRoster(
      inputs({
        pool: pool({ participantIds: ['owner', 'm2', 'm3'] }),
        members: [
          { uid: 'owner', userName: 'Commish' },
          { uid: 'm2', userName: 'Dana' },
          { uid: 'm3', userName: 'Eli' },
        ],
        entries: [{ id: 'owner', ownerUid: 'owner', picks: { g1: 'KC', g2: 'SF' } }],
      }),
    );
    // The defect, stated as an assertion: three joined, one submitted. The
    // entries-derived reader saw a one-person pool and reported 1 of 1 = 100%.
    expect(roster).toHaveLength(3);
    expect(unsubmittedRoster(roster, PICKEM).map((r) => r.uid).sort()).toEqual(['m2', 'm3']);
  });

  it('counts a PARTIAL pick sheet as pending — one of two games picked is not submitted', () => {
    const roster = buildPoolRoster(
      inputs({
        pool: pool({ participantIds: ['owner'] }),
        members: [{ uid: 'owner', userName: 'Commish' }],
        entries: [{ id: 'owner', ownerUid: 'owner', picks: { g1: 'KC' } }],
      }),
    );
    expect(unsubmittedRoster(roster, PICKEM).map((r) => r.uid)).toEqual(['owner']);
  });

  it('counts a COMPLETE pick sheet as submitted', () => {
    const roster = buildPoolRoster(
      inputs({
        pool: pool({ participantIds: ['owner'] }),
        members: [{ uid: 'owner', userName: 'Commish' }],
        entries: [{ id: 'owner', ownerUid: 'owner', picks: { g1: 'KC', g2: 'SF' } }],
      }),
    );
    expect(unsubmittedRoster(roster, PICKEM)).toEqual([]);
  });

  it('reports NOBODY pending on a pick’em week with no games — there is nothing to pick', () => {
    const roster = buildPoolRoster(
      inputs({
        pool: pool({ participantIds: ['owner', 'm2'] }),
        members: [{ uid: 'owner' }, { uid: 'm2' }],
        entries: [{ id: 'owner', ownerUid: 'owner', picks: {} }],
      }),
    );
    // 'm2' still has no entry at all, so they remain pending; 'owner' does not
    // become delinquent for failing to pick games that do not exist.
    expect(unsubmittedRoster(roster, { ...PICKEM, weeklyGameIds: [] }).map((r) => r.uid)).toEqual(['m2']);
  });

  it('keys SURVIVOR and MARGIN off the WEEK NUMBER, not game ids', () => {
    const roster = buildPoolRoster(
      inputs({
        pool: pool({ participantIds: ['a', 'b'] }),
        members: [{ uid: 'a' }, { uid: 'b' }],
        entries: [
          { id: 'a', ownerUid: 'a', picks: { 1: 'CAR' } },
          { id: 'b', ownerUid: 'b', picks: { 2: 'ARI' } }, // picked a DIFFERENT week
        ],
      }),
    );
    for (const poolType of ['NFL_SURVIVOR', 'NFL_MARGIN']) {
      expect(
        unsubmittedRoster(roster, { poolType, week: 1, weeklyGameIds: ['g1'] }).map((r) => r.uid),
      ).toEqual(['b']);
    }
  });

  it('an empty pool has nobody pending rather than throwing', () => {
    expect(unsubmittedRoster([], PICKEM)).toEqual([]);
  });
});

/**
 * KEVIN'S RULING 2026-07-31: assume the pool manager is also playing, 99% of
 * the time. So the commissioner is expected to pick like anyone else, and an
 * entry-less manager is a genuine outstanding pick.
 *
 * An earlier version of `unsubmittedRoster` exempted `isOwner && !hasEntry`,
 * which let a pool read 100% while the commissioner personally had not picked.
 * These pin the ruling so the exemption cannot creep back in.
 */
describe('the pool manager is a player too', () => {
  const PICKEM = { poolType: 'NFL_PICKEM', week: 1, weeklyGameIds: ['g1'] };

  it('counts an entry-less MANAGER as pending, like any other member', () => {
    const roster = buildPoolRoster(
      inputs({
        pool: pool({ ownerId: 'owner', participantIds: ['owner', 'm2'] }),
        members: [
          { uid: 'owner', userName: 'Commish', hasPlayableEntry: false },
          { uid: 'm2', userName: 'Dana' },
        ],
        entries: [{ id: 'm2', ownerUid: 'm2', picks: { g1: 'CAR' } }],
      }),
    );
    // Dana has picked; the commissioner has not. The pool is NOT fully in.
    expect(unsubmittedRoster(roster, PICKEM).map((r) => r.uid)).toEqual(['owner']);
  });

  it('reaches empty once the manager submits too', () => {
    const roster = buildPoolRoster(
      inputs({
        pool: pool({ ownerId: 'owner', participantIds: ['owner', 'm2'] }),
        members: [
          { uid: 'owner', userName: 'Commish', hasPlayableEntry: true },
          { uid: 'm2', userName: 'Dana' },
        ],
        entries: [
          { id: 'owner', ownerUid: 'owner', picks: { g1: 'ARI' } },
          { id: 'm2', ownerUid: 'm2', picks: { g1: 'CAR' } },
        ],
      }),
    );
    expect(unsubmittedRoster(roster, PICKEM)).toEqual([]);
  });

  it('carries the persisted hasPlayableEntry latch through, and leaves it UNDEFINED when absent', () => {
    const roster = buildPoolRoster(
      inputs({
        pool: pool({ ownerId: 'owner', participantIds: ['owner', 'm2', 'm3'] }),
        members: [
          { uid: 'owner', hasPlayableEntry: true },
          { uid: 'm2', hasPlayableEntry: false },
          { uid: 'm3' }, // pre-2026-07-31 record: field absent
        ],
      }),
    );
    const by = (uid: string) => roster.find((r) => r.uid === uid)!;
    expect(by('owner').hasPlayableEntry).toBe(true);
    expect(by('m2').hasPlayableEntry).toBe(false);
    // UNKNOWN, not false. Absence must never be read as "has not entered".
    expect(by('m3').hasPlayableEntry).toBeUndefined();
  });

  it('does NOT exempt anyone on the latch — a false latch is still pending', () => {
    // The latch is carried for a future explicit opt-out; it must not quietly
    // become an exemption, which is the defect this ruling replaced.
    const roster = buildPoolRoster(
      inputs({
        pool: pool({ ownerId: 'owner', participantIds: ['owner'] }),
        members: [{ uid: 'owner', hasPlayableEntry: false }],
      }),
    );
    expect(unsubmittedRoster(roster, PICKEM).map((r) => r.uid)).toEqual(['owner']);
  });
});
