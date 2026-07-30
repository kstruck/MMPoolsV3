import { describe, it, expect } from 'vitest';
import {
  buildPoolRoster,
  rosterPotStats,
  outstandingDue,
  clearingRate,
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

const inputs = (over: Partial<RosterInputs>): RosterInputs => ({
  pool: pool(),
  members: [],
  entries: [],
  ...over,
});

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

  it('an empty pool is $0 / 0%, not a divide-by-zero', () => {
    const pot = rosterPotStats(inputs({ pool: pool({ participantIds: [] }) }));
    expect(pot).toEqual({ memberCount: 0, paidCount: 0, unpaidCount: 0, collected: 0, expected: 0 });
    expect(clearingRate(pot)).toBe(0);
    expect(outstandingDue(pot)).toBe(0);
  });

  it('outstanding never goes negative when collected exceeds expected', () => {
    expect(outstandingDue({ memberCount: 1, paidCount: 1, unpaidCount: 0, collected: 50, expected: 20 })).toBe(0);
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
