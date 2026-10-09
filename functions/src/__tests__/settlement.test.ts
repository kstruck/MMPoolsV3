import { describe, it, expect } from 'vitest';
import {
  settlementPhase,
  aliveSetMismatch,
  poolIsOver,
  assertPoolAcceptsPlay,
  throughWeekOf,
  settlementMoney,
  rebuyDuesOf,
  followUpClaimable,
} from '../lib/settlement';
import { joinNames, type PoolSettlement } from '../shared/settlement';
import { settlePoolSchema } from '../schemas/poolSettlement';
import { settlementEmail } from '../lib/settlementEmail';

// PLAN-SPLIT-POT-SETTLEMENT §2.2 phase table and §2.3 terminal-pool guard.

describe('settlementPhase — the plan table, top to bottom', () => {
  it('an ordinary live pool is FULL', () => {
    expect(settlementPhase({ status: 'OPEN' })).toEqual({ kind: 'FULL' });
    expect(settlementPhase({})).toEqual({ kind: 'FULL' });
  });

  it('a crashed attempt (marker + finalizedAt, still OPEN) is FULL again', () => {
    expect(settlementPhase({ status: 'OPEN', finalizedAt: 123, finalizedVia: 'SETTLED' })).toEqual({ kind: 'FULL' });
  });

  it('a naturally finalized pool is refused ALREADY_FINALIZED', () => {
    expect(settlementPhase({ status: 'OPEN', finalizedAt: 123 })).toEqual({ kind: 'REFUSE', code: 'ALREADY_FINALIZED' });
  });

  it.each(['CANCELED', 'COMPLETED', 'ARCHIVED', 'archived', 'completed'])('status %s is ALREADY_CLOSED', (status) => {
    expect(settlementPhase({ status })).toEqual({ kind: 'REFUSE', code: 'ALREADY_CLOSED' });
  });

  it('any non-SETTLED closedVia is ALREADY_CLOSED even with an open status', () => {
    expect(settlementPhase({ status: 'OPEN', closedVia: 'ADMIN_CLOSE' })).toEqual({ kind: 'REFUSE', code: 'ALREADY_CLOSED' });
  });

  it('a SETTLED pool with nothing owed is ALREADY_SETTLED', () => {
    expect(settlementPhase({
      status: 'COMPLETED', closedVia: 'SETTLED',
      settlement: { notifyMembers: true, adminAuditedAt: 1, emailedAt: 2 },
    })).toEqual({ kind: 'REFUSE', code: 'ALREADY_SETTLED' });
    expect(settlementPhase({
      status: 'COMPLETED', closedVia: 'SETTLED',
      settlement: { notifyMembers: false, adminAuditedAt: 1 },
    })).toEqual({ kind: 'REFUSE', code: 'ALREADY_SETTLED' });
  });

  it('a SETTLED pool owing its follow-up is FOLLOW_UP — checked BEFORE the void test, since COMPLETED is voided', () => {
    expect(settlementPhase({
      status: 'COMPLETED', closedVia: 'SETTLED', settlement: { notifyMembers: true, adminAuditedAt: 1 },
    })).toEqual({ kind: 'FOLLOW_UP', adminAudit: false, email: true });
    expect(settlementPhase({
      status: 'COMPLETED', closedVia: 'SETTLED', settlement: { notifyMembers: false },
    })).toEqual({ kind: 'FOLLOW_UP', adminAudit: true, email: false });
  });
});

describe('aliveSetMismatch — winners must be exactly the ALIVE set (D3)', () => {
  it('accepts the same set in any order', () => {
    expect(aliveSetMismatch(['b', 'a'], ['a', 'b'])).toBeNull();
  });
  it('refuses a subset, a superset, a different member, and duplicates', () => {
    expect(aliveSetMismatch(['a'], ['a', 'b'])).toBe('WINNERS_MUST_BE_ALIVE_SET');
    expect(aliveSetMismatch(['a', 'b', 'c'], ['a', 'b'])).toBe('WINNERS_MUST_BE_ALIVE_SET');
    expect(aliveSetMismatch(['a', 'c'], ['a', 'b'])).toBe('WINNERS_MUST_BE_ALIVE_SET');
    expect(aliveSetMismatch(['a', 'a'], ['a', 'b'])).toBe('WINNERS_MUST_BE_ALIVE_SET');
  });
  it('a pool with nobody alive is NO_SURVIVORS', () => {
    expect(aliveSetMismatch(['a'], [])).toBe('NO_SURVIVORS');
  });
});

describe('poolIsOver / assertPoolAcceptsPlay', () => {
  it('an open, unfinalized pool plays — including a FINAL-status one not yet finalized', () => {
    expect(poolIsOver({ status: 'OPEN' })).toBe(false);
    expect(poolIsOver({ status: 'LOCKED' })).toBe(false);
    expect(poolIsOver({ status: 'FINAL' })).toBe(false);
    expect(() => assertPoolAcceptsPlay({ status: 'OPEN' })).not.toThrow();
  });
  it('voided, closed or finalized pools refuse play with POOL_OVER', () => {
    for (const pool of [
      { status: 'CANCELED' }, { status: 'COMPLETED' }, { status: 'archived' },
      { status: 'OPEN', closedVia: 'SETTLED' }, { status: 'OPEN', finalizedAt: 1 }, null,
    ]) {
      expect(poolIsOver(pool)).toBe(true);
      expect(() => assertPoolAcceptsPlay(pool)).toThrow(/POOL_OVER/);
    }
  });
});

describe('throughWeekOf', () => {
  it('is the highest true week, or null', () => {
    expect(throughWeekOf({ 1: true, 2: true, 4: true, 3: true })).toBe(4);
    expect(throughWeekOf({ 1: true, 5: false })).toBe(1);
    expect(throughWeekOf({})).toBeNull();
    expect(throughWeekOf(undefined)).toBeNull();
  });
});

describe('settlementMoney — copied from the published Season Places, never recomputed', () => {
  const places = [
    { entryId: 'a', prize: 100 }, { entryId: 'b', prize: 100 }, { entryId: 'c' },
  ];
  it('reads the shared rank-1 prize and the pot', () => {
    expect(settlementMoney({ seasonPlaces: places, seasonPrize: { pot: 200 } }, ['a', 'b'])).toEqual({ prizePerEntry: 100, pot: 200 });
  });
  it('is null on an unpriced publication (seasonPrize null, or seasonPlacesError with no prizes)', () => {
    expect(settlementMoney({ seasonPlaces: places, seasonPrize: null }, ['a', 'b'])).toEqual({ prizePerEntry: null, pot: null });
    expect(settlementMoney({ seasonPlaces: [{ entryId: 'a' }, { entryId: 'b' }], seasonPrize: { pot: 200 } }, ['a', 'b']))
      .toEqual({ prizePerEntry: null, pot: 200 });
  });
  it('refuses to state one figure when the winners disagree', () => {
    expect(settlementMoney({ seasonPlaces: [{ entryId: 'a', prize: 101 }, { entryId: 'b', prize: 100 }], seasonPrize: { pot: 201 } }, ['a', 'b']))
      .toEqual({ prizePerEntry: null, pot: 201 });
  });
});

describe('rebuyDuesOf / joinNames', () => {
  it('sums positive numeric rebuyOwed only', () => {
    expect(rebuyDuesOf([{ rebuyOwed: 25 }, {}, { rebuyOwed: 'x' }, { rebuyOwed: -5 }, { rebuyOwed: 25 }])).toBe(50);
  });
  it('joins names in plain English', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });
});


describe('settlePoolSchema', () => {
  const ok = (d: unknown) => settlePoolSchema.safeParse(d).success;
  const req = { poolId: 'p1', outcome: 'SPLIT', entryIds: ['a', 'b'] };
  it('accepts the client payload and defaults notifyMembers to true', () => {
    expect(ok(req)).toBe(true);
    expect(settlePoolSchema.parse(req).notifyMembers).toBe(true);
    expect(ok({ ...req, note: 'Split 50/50', notifyMembers: false })).toBe(true);
  });
  it('rejects another outcome, empty winners, a long note and unknown fields', () => {
    expect(ok({ ...req, outcome: 'WINNER' })).toBe(false);
    expect(ok({ ...req, entryIds: [] })).toBe(false);
    expect(ok({ ...req, note: 'x'.repeat(501) })).toBe(false);
    expect(ok({ ...req, force: true })).toBe(false);
  });
});

describe('settlementEmail — says only what the record knows', () => {
  const base: PoolSettlement = {
    kind: 'SPLIT', entryIds: ['a', 'b'], winnerNames: ['Ann', 'Bo <b>'], settledAt: 1, settledBy: 'h',
    note: null, throughWeek: 4, notifyMembers: true, prizePerEntry: 50, pot: 100, rebuyDuesExcluded: 0,
  };
  it('names the winners (escaped), the week and the per-winner prize', () => {
    const { subject, html } = settlementEmail('My Pool', base);
    expect(subject).toBe('My Pool is over — the pot was split');
    expect(html).toContain('after week 4');
    expect(html).toContain('Ann and Bo &lt;b&gt;');
    expect(html).toContain('$50 each');
    expect(html).not.toContain('rebuy');
  });
  it('a single survivor reads as a winner, not a split', () => {
    const { subject, html } = settlementEmail('P', { ...base, winnerNames: ['Ann'], entryIds: ['a'], prizePerEntry: 100 });
    expect(subject).toBe('P is over — we have a winner');
    expect(html).toContain('Ann</strong> is the last player standing and wins 1st place, $100');
    expect(html).not.toContain('split');
  });

  it('omits the amount when unpriced, and states excluded rebuy dues and the note', () => {
    const { html } = settlementEmail('P', { ...base, prizePerEntry: null, throughWeek: null, rebuyDuesExcluded: 25, note: 'Paid via Venmo' });
    expect(html).not.toContain('each.</p>');
    expect(html).not.toContain('after week');
    expect(html).toContain('$25 of rebuy dues are not included');
    expect(html).toContain('Paid via Venmo');
  });
});

describe('followUpClaimable — one attempt per follow-up step', () => {
  const now = 1_000_000_000;
  it('is claimable when neither done nor claimed', () => {
    expect(followUpClaimable({}, 'email', now)).toBe(true);
    expect(followUpClaimable(undefined, 'adminAudit', now)).toBe(true);
  });
  it('is never claimable once done', () => {
    expect(followUpClaimable({ emailedAt: 1 }, 'email', now)).toBe(false);
    expect(followUpClaimable({ adminAuditedAt: 1 }, 'adminAudit', now)).toBe(false);
  });
  it('a live claim blocks; an abandoned one (over 10 minutes) does not', () => {
    expect(followUpClaimable({ emailClaimedAt: now - 60_000 }, 'email', now)).toBe(false);
    expect(followUpClaimable({ emailClaimedAt: now - 11 * 60_000 }, 'email', now)).toBe(true);
  });
  it('the two steps claim independently', () => {
    expect(followUpClaimable({ emailClaimedAt: now }, 'adminAudit', now)).toBe(true);
  });
});

describe('settlePoolSchema — preview mode', () => {
  it('preview needs no entryIds; a real call does', () => {
    expect(settlePoolSchema.safeParse({ poolId: 'p', outcome: 'SPLIT', preview: true }).success).toBe(true);
    expect(settlePoolSchema.safeParse({ poolId: 'p', outcome: 'SPLIT' }).success).toBe(false);
  });
});
