/**
 * couponReservation.test.ts — Unit tests for the ADR-0002 coupon reservation
 * lifecycle (reserve → confirm → release), all pure functions over the coupon
 * doc's usageLog. Runner: vitest.
 *
 * Covers the PLAN Layer-1 reservation cases: maxUses boundary (last use),
 * perUserLimit boundary, expired/inactive/wrong-format rejection, release
 * decrements (via transition), confirm flips status, free-pool writes confirmed,
 * and the stale-sweep selection.
 */
import { describe, it, expect } from 'vitest';
import {
  validateCouponRules,
  countActiveUses,
  countUserActiveUses,
  isActiveEntry,
  makeReservationEntry,
  makeConfirmedEntry,
  transitionReservation,
  stalePendingReservationIds,
  type CouponUsageEntry,
} from '../lib/couponReservation';

const NOW = 1_700_000_000_000;

describe('active-use counting (usesCount incl. live reservations)', () => {
  const log: CouponUsageEntry[] = [
    { reservationId: 'r1', userId: 'u1', poolId: 'p1', status: 'pending', reservedAt: NOW },
    { reservationId: 'r2', userId: 'u1', poolId: 'p2', status: 'confirmed', reservedAt: NOW },
    { reservationId: 'r3', userId: 'u2', poolId: 'p3', status: 'released', reservedAt: NOW },
    { userId: 'u3', poolId: 'p4', usedAt: NOW }, // legacy entry (no status) => active
  ];

  it('counts pending + confirmed + legacy as active, excludes released', () => {
    expect(countActiveUses(log)).toBe(3);
  });

  it('per-user active count excludes released and other users', () => {
    expect(countUserActiveUses(log, 'u1')).toBe(2);
    expect(countUserActiveUses(log, 'u2')).toBe(0); // their only entry is released
    expect(countUserActiveUses(log, 'u3')).toBe(1); // legacy counts
  });

  it('isActiveEntry treats missing status as active (legacy) and released as inactive', () => {
    expect(isActiveEntry({ userId: 'x', poolId: 'y' })).toBe(true);
    expect(isActiveEntry({ userId: 'x', poolId: 'y', status: 'released' })).toBe(false);
  });

  it('empty/undefined logs count as 0', () => {
    expect(countActiveUses(undefined)).toBe(0);
    expect(countActiveUses([])).toBe(0);
  });
});

describe('validateCouponRules', () => {
  const base = { isActive: true } as const;

  it('rejects inactive', () => {
    const r = validateCouponRules({ ...base, isActive: false }, { userId: 'u', poolType: 'SQUARES', now: NOW });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/no longer active/);
  });

  it('rejects expired', () => {
    const r = validateCouponRules({ ...base, expiresAt: NOW - 1 }, { userId: 'u', poolType: 'SQUARES', now: NOW });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/expired/);
  });

  it('accepts unexpired / no-expiry', () => {
    expect(validateCouponRules({ ...base, expiresAt: NOW + 1 }, { userId: 'u', poolType: 'SQUARES', now: NOW }).valid).toBe(true);
    expect(validateCouponRules({ ...base }, { userId: 'u', poolType: 'SQUARES', now: NOW }).valid).toBe(true);
  });

  // maxUses BOUNDARY — last use available, then exhausted.
  it('allows the LAST use (active == maxUses-1) and rejects at maxUses', () => {
    const four: CouponUsageEntry[] = Array.from({ length: 4 }, (_, i) => ({
      reservationId: `r${i}`, userId: 'x', poolId: `p${i}`, status: 'confirmed', reservedAt: NOW,
    }));
    // 4 active, maxUses 5 → one left → valid
    expect(validateCouponRules({ ...base, maxUses: 5, usageLog: four }, { userId: 'u', poolType: 'SQUARES', now: NOW }).valid).toBe(true);
    // 5 active, maxUses 5 → exhausted → reject
    const five = [...four, { reservationId: 'r4', userId: 'x', poolId: 'p4', status: 'pending' as const, reservedAt: NOW }];
    const r = validateCouponRules({ ...base, maxUses: 5, usageLog: five }, { userId: 'u', poolType: 'SQUARES', now: NOW });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/maximum number of uses/);
  });

  it('maxUses counts live PENDING reservations (cannot over-redeem)', () => {
    const log: CouponUsageEntry[] = [
      { reservationId: 'r0', userId: 'a', poolId: 'p0', status: 'pending', reservedAt: NOW },
    ];
    // maxUses 1, one pending reservation → next reservation must be rejected.
    const r = validateCouponRules({ ...base, maxUses: 1, usageLog: log }, { userId: 'b', poolType: 'SQUARES', now: NOW });
    expect(r.valid).toBe(false);
  });

  it('released reservations DO NOT count toward maxUses', () => {
    const log: CouponUsageEntry[] = [
      { reservationId: 'r0', userId: 'a', poolId: 'p0', status: 'released', reservedAt: NOW },
    ];
    expect(validateCouponRules({ ...base, maxUses: 1, usageLog: log }, { userId: 'b', poolType: 'SQUARES', now: NOW }).valid).toBe(true);
  });

  // perUserLimit BOUNDARY.
  it('perUserLimit: allows up to the limit, rejects at the limit for that user', () => {
    const log: CouponUsageEntry[] = [
      { reservationId: 'r0', userId: 'u1', poolId: 'p0', status: 'confirmed', reservedAt: NOW },
    ];
    // limit 2, user has 1 active → valid; user with 0 active → valid
    expect(validateCouponRules({ ...base, perUserLimit: 2, usageLog: log }, { userId: 'u1', poolType: 'SQUARES', now: NOW }).valid).toBe(true);
    // limit 1, user has 1 active → reject
    const r = validateCouponRules({ ...base, perUserLimit: 1, usageLog: log }, { userId: 'u1', poolType: 'SQUARES', now: NOW });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/maximum number of times/);
    // different user unaffected
    expect(validateCouponRules({ ...base, perUserLimit: 1, usageLog: log }, { userId: 'u2', poolType: 'SQUARES', now: NOW }).valid).toBe(true);
  });

  it('rejects a pool format not in allowedPoolTypes; accepts one that is', () => {
    const rules = { ...base, allowedPoolTypes: ['SQUARES', 'BRACKET'] };
    expect(validateCouponRules(rules, { userId: 'u', poolType: 'PROPS', now: NOW }).valid).toBe(false);
    expect(validateCouponRules(rules, { userId: 'u', poolType: 'BRACKET', now: NOW }).valid).toBe(true);
  });

  it('empty allowedPoolTypes means all formats allowed', () => {
    expect(validateCouponRules({ ...base, allowedPoolTypes: [] }, { userId: 'u', poolType: 'PROPS', now: NOW }).valid).toBe(true);
  });
});

describe('reservation entry builders', () => {
  it('makeReservationEntry produces a pending entry', () => {
    const e = makeReservationEntry({ reservationId: 'r', userId: 'u', poolId: 'p', now: NOW });
    expect(e).toMatchObject({ reservationId: 'r', userId: 'u', poolId: 'p', status: 'pending', reservedAt: NOW });
  });

  it('makeConfirmedEntry produces a confirmed entry (free-pool path)', () => {
    const e = makeConfirmedEntry({ reservationId: 'r', userId: 'u', poolId: 'p', now: NOW });
    expect(e.status).toBe('confirmed');
    expect(e.confirmedAt).toBe(NOW);
  });
});

describe('transitionReservation (confirm / release)', () => {
  const pending: CouponUsageEntry[] = [
    { reservationId: 'r1', userId: 'u1', poolId: 'p1', status: 'pending', reservedAt: NOW },
    { reservationId: 'r2', userId: 'u2', poolId: 'p2', status: 'pending', reservedAt: NOW },
  ];

  it('confirm flips the matching entry to confirmed + stamps sessionId', () => {
    const { usageLog, changed } = transitionReservation(pending, 'r1', 'confirmed', NOW + 5, 'sess_123');
    expect(changed).toBe(true);
    const e = usageLog.find((x) => x.reservationId === 'r1')!;
    expect(e.status).toBe('confirmed');
    expect(e.sessionId).toBe('sess_123');
    expect(e.confirmedAt).toBe(NOW + 5);
    // other entry untouched
    expect(usageLog.find((x) => x.reservationId === 'r2')!.status).toBe('pending');
  });

  it('release flips to released + stamps releasedAt', () => {
    const { usageLog, changed } = transitionReservation(pending, 'r2', 'released', NOW + 9);
    expect(changed).toBe(true);
    const e = usageLog.find((x) => x.reservationId === 'r2')!;
    expect(e.status).toBe('released');
    expect(e.releasedAt).toBe(NOW + 9);
  });

  it('is a no-op (changed:false) when reservationId is not found', () => {
    const { changed } = transitionReservation(pending, 'nope', 'confirmed', NOW);
    expect(changed).toBe(false);
  });

  it('is idempotent: transitioning to the same status reports no change', () => {
    const confirmed: CouponUsageEntry[] = [{ reservationId: 'r1', userId: 'u', poolId: 'p', status: 'confirmed', reservedAt: NOW }];
    const { changed } = transitionReservation(confirmed, 'r1', 'confirmed', NOW);
    expect(changed).toBe(false);
  });

  it('does not mutate the input array', () => {
    const copy = JSON.parse(JSON.stringify(pending));
    transitionReservation(pending, 'r1', 'confirmed', NOW, 's');
    expect(pending).toEqual(copy);
  });
});

describe('stalePendingReservationIds (24h sweep)', () => {
  const cutoff = NOW - 24 * 60 * 60 * 1000;
  const log: CouponUsageEntry[] = [
    { reservationId: 'old', userId: 'u', poolId: 'p', status: 'pending', reservedAt: cutoff - 1 },   // stale
    { reservationId: 'fresh', userId: 'u', poolId: 'p', status: 'pending', reservedAt: cutoff + 1 },  // fresh
    { reservationId: 'done', userId: 'u', poolId: 'p', status: 'confirmed', reservedAt: cutoff - 100 }, // not pending
    { reservationId: 'gone', userId: 'u', poolId: 'p', status: 'released', reservedAt: cutoff - 100 },  // not pending
  ];

  it('selects only pending entries older than the cutoff', () => {
    expect(stalePendingReservationIds(log, cutoff)).toEqual(['old']);
  });

  it('returns [] for empty/undefined', () => {
    expect(stalePendingReservationIds(undefined, cutoff)).toEqual([]);
    expect(stalePendingReservationIds([], cutoff)).toEqual([]);
  });
});

describe('session-creation-failure release semantics (integration of transition + counting)', () => {
  it('releasing a just-reserved pending entry restores the active count', () => {
    // Reserve.
    let log: CouponUsageEntry[] = [];
    log = [...log, makeReservationEntry({ reservationId: 'r', userId: 'u', poolId: 'p', now: NOW })];
    expect(countActiveUses(log)).toBe(1);
    // Session creation fails → release.
    const t = transitionReservation(log, 'r', 'released', NOW + 1);
    expect(t.changed).toBe(true);
    expect(countActiveUses(t.usageLog)).toBe(0); // use reclaimed
  });
});
