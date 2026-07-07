/**
 * monetizationAlertLogic.test.ts — Unit tests for the coupon-abuse + housekeeping
 * alert detectors (PLAN-BUYFLOW-OVERHAUL Phase 6 #22). All pure functions over
 * plain coupon/usageLog fixtures with an injected `nowMs`, so every boundary is
 * deterministic. Runner: vitest. No firebase-admin — mirrors the pure style of
 * couponReservation.test.ts.
 *
 * Covers: velocity boundary (>threshold in 24h), near-max 80% boundary,
 * expiring window (<7d with uses left, already-expired excluded), new-account
 * cluster (>=3 redemptions from accounts <48h old), and the dedupe key.
 */
import { describe, it, expect } from 'vitest';
import {
  detectVelocitySpike,
  detectNearMax,
  detectExpiring,
  detectNewAccountCluster,
  computeCouponAlerts,
  countLiveUses,
  countLiveUsesInWindow,
  isAbuseAlert,
  alertDedupeKey,
  DEFAULT_VELOCITY_THRESHOLD,
  NEAR_MAX_FRACTION,
  EXPIRING_WINDOW_MS,
  VELOCITY_WINDOW_MS,
  NEW_ACCOUNT_WINDOW_MS,
  type AlertCoupon,
  type AlertUsageEntry,
} from '../lib/monetizationAlertLogic';

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Build N live (confirmed) usage entries at the same timestamp. */
function liveEntries(n: number, at: number, userPrefix = 'u'): AlertUsageEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    reservationId: `r${i}`,
    userId: `${userPrefix}${i}`,
    poolId: `p${i}`,
    status: 'confirmed' as const,
    confirmedAt: at,
  }));
}

describe('countLiveUses', () => {
  it('counts confirmed + pending + legacy, excludes released', () => {
    const log: AlertUsageEntry[] = [
      { userId: 'a', poolId: 'p1', status: 'confirmed' },
      { userId: 'b', poolId: 'p2', status: 'pending' },
      { userId: 'c', poolId: 'p3', status: 'released' },
      { userId: 'd', poolId: 'p4', usedAt: NOW }, // legacy => live
    ];
    expect(countLiveUses(log)).toBe(3);
  });

  it('empty/undefined => 0', () => {
    expect(countLiveUses(undefined)).toBe(0);
    expect(countLiveUses([])).toBe(0);
  });
});

describe('countLiveUsesInWindow', () => {
  it('counts only entries within [now-window, now]', () => {
    const log: AlertUsageEntry[] = [
      { userId: 'a', poolId: 'p1', status: 'confirmed', confirmedAt: NOW - 1 * HOUR }, // in
      { userId: 'b', poolId: 'p2', status: 'confirmed', confirmedAt: NOW - 25 * HOUR }, // out (>24h)
      { userId: 'c', poolId: 'p3', status: 'released', confirmedAt: NOW - 1 * HOUR }, // out (released)
      { userId: 'd', poolId: 'p4', status: 'pending', reservedAt: NOW - 2 * HOUR }, // in (via reservedAt)
    ];
    expect(countLiveUsesInWindow(log, NOW, VELOCITY_WINDOW_MS)).toBe(2);
  });

  it('entries with no timestamp are not counted', () => {
    const log: AlertUsageEntry[] = [{ userId: 'a', poolId: 'p1', status: 'confirmed' }];
    expect(countLiveUsesInWindow(log, NOW, VELOCITY_WINDOW_MS)).toBe(0);
  });
});

describe('detectVelocitySpike (>threshold in 24h)', () => {
  it('does NOT trip at exactly threshold uses (strict greater-than)', () => {
    const coupon: AlertCoupon = { code: 'SPIKE', usageLog: liveEntries(10, NOW - HOUR) };
    expect(detectVelocitySpike(coupon, NOW, 10)).toBeNull();
  });

  it('trips at threshold+1 uses', () => {
    const coupon: AlertCoupon = { code: 'SPIKE', usageLog: liveEntries(11, NOW - HOUR) };
    const r = detectVelocitySpike(coupon, NOW, 10);
    expect(r).not.toBeNull();
    expect(r?.type).toBe('COUPON_VELOCITY_SPIKE');
    expect(r?.detail.recentUses).toBe(11);
    expect(r?.detail.threshold).toBe(10);
  });

  it('ignores uses older than 24h', () => {
    const coupon: AlertCoupon = {
      code: 'OLD',
      usageLog: [...liveEntries(20, NOW - 30 * HOUR)], // all stale
    };
    expect(detectVelocitySpike(coupon, NOW, 10)).toBeNull();
  });

  it('uses the default threshold when none passed', () => {
    const coupon: AlertCoupon = {
      code: 'DEF',
      usageLog: liveEntries(DEFAULT_VELOCITY_THRESHOLD + 1, NOW - HOUR),
    };
    expect(detectVelocitySpike(coupon, NOW)).not.toBeNull();
  });

  it('respects a configured lower threshold', () => {
    const coupon: AlertCoupon = { code: 'LOW', usageLog: liveEntries(4, NOW - HOUR) };
    expect(detectVelocitySpike(coupon, NOW, 3)).not.toBeNull();
    expect(detectVelocitySpike(coupon, NOW, 4)).toBeNull(); // 4 is not > 4
  });
});

describe('detectNearMax (>=80% of maxUses)', () => {
  it('trips exactly at the 80% boundary (maxUses=10 => 8)', () => {
    const coupon: AlertCoupon = { code: 'NM', maxUses: 10, usageLog: liveEntries(8, NOW) };
    const r = detectNearMax(coupon);
    expect(r).not.toBeNull();
    expect(r?.detail.used).toBe(8);
    expect(r?.detail.maxUses).toBe(10);
  });

  it('does NOT trip at 7/10 (just below 80%)', () => {
    const coupon: AlertCoupon = { code: 'NM', maxUses: 10, usageLog: liveEntries(7, NOW) };
    expect(detectNearMax(coupon)).toBeNull();
  });

  it('uses ceil for the trigger (maxUses=9 => ceil(7.2)=8)', () => {
    expect(detectNearMax({ code: 'A', maxUses: 9, usageLog: liveEntries(7, NOW) })).toBeNull();
    expect(detectNearMax({ code: 'B', maxUses: 9, usageLog: liveEntries(8, NOW) })).not.toBeNull();
  });

  it('never trips without a maxUses', () => {
    expect(detectNearMax({ code: 'NOMAX', usageLog: liveEntries(1000, NOW) })).toBeNull();
  });

  it('released uses do not count toward near-max', () => {
    const log: AlertUsageEntry[] = [
      ...liveEntries(7, NOW),
      { userId: 'x', poolId: 'px', status: 'released', confirmedAt: NOW },
    ];
    // 7 live (released excluded) < 8 trigger
    expect(detectNearMax({ code: 'REL', maxUses: 10, usageLog: log })).toBeNull();
  });

  it('NEAR_MAX_FRACTION constant is 0.8', () => {
    expect(NEAR_MAX_FRACTION).toBe(0.8);
  });
});

describe('detectExpiring (<7d with uses remaining)', () => {
  it('trips inside the 7-day window', () => {
    const coupon: AlertCoupon = { code: 'EXP', expiresAt: NOW + 3 * DAY };
    const r = detectExpiring(coupon, NOW);
    expect(r).not.toBeNull();
    expect(r?.type).toBe('COUPON_EXPIRING');
  });

  it('does NOT trip at exactly the 7-day edge + 1ms (outside window)', () => {
    const coupon: AlertCoupon = { code: 'EDGE', expiresAt: NOW + EXPIRING_WINDOW_MS + 1 };
    expect(detectExpiring(coupon, NOW)).toBeNull();
  });

  it('trips right at the 7-day edge', () => {
    const coupon: AlertCoupon = { code: 'EDGE2', expiresAt: NOW + EXPIRING_WINDOW_MS };
    expect(detectExpiring(coupon, NOW)).not.toBeNull();
  });

  it('does NOT trip for an already-expired coupon', () => {
    const coupon: AlertCoupon = { code: 'GONE', expiresAt: NOW - 1 };
    expect(detectExpiring(coupon, NOW)).toBeNull();
  });

  it('does NOT trip when the coupon is fully consumed', () => {
    const coupon: AlertCoupon = {
      code: 'FULL',
      expiresAt: NOW + DAY,
      maxUses: 5,
      usageLog: liveEntries(5, NOW),
    };
    expect(detectExpiring(coupon, NOW)).toBeNull();
  });

  it('trips when partially consumed with uses left', () => {
    const coupon: AlertCoupon = {
      code: 'PART',
      expiresAt: NOW + DAY,
      maxUses: 5,
      usageLog: liveEntries(3, NOW),
    };
    expect(detectExpiring(coupon, NOW)).not.toBeNull();
  });

  it('never trips without an expiresAt', () => {
    expect(detectExpiring({ code: 'NOEXP' }, NOW)).toBeNull();
  });
});

describe('detectNewAccountCluster (>=3 redemptions from <48h-old accounts)', () => {
  function usageForUsers(uids: string[], redeemedAt: number): AlertUsageEntry[] {
    return uids.map((uid, i) => ({
      reservationId: `r${i}`,
      userId: uid,
      poolId: `p${i}`,
      status: 'confirmed' as const,
      confirmedAt: redeemedAt,
    }));
  }

  it('trips at 3 fresh-account redemptions', () => {
    const redeemedAt = NOW;
    const created = NOW - 10 * HOUR; // 10h before redeeming => fresh (<48h)
    const coupon: AlertCoupon = { code: 'CLUS', usageLog: usageForUsers(['u1', 'u2', 'u3'], redeemedAt) };
    const map = { u1: created, u2: created, u3: created };
    const r = detectNewAccountCluster(coupon, map);
    expect(r).not.toBeNull();
    expect(r?.type).toBe('COUPON_NEW_ACCOUNT_CLUSTER');
    expect(r?.detail.freshRedemptions).toBe(3);
    expect(r?.detail.distinctFreshAccounts).toBe(3);
  });

  it('does NOT trip at 2 fresh redemptions', () => {
    const coupon: AlertCoupon = { code: 'TWO', usageLog: usageForUsers(['u1', 'u2'], NOW) };
    const map = { u1: NOW - HOUR, u2: NOW - HOUR };
    expect(detectNewAccountCluster(coupon, map)).toBeNull();
  });

  it('accounts older than 48h do not count', () => {
    const coupon: AlertCoupon = { code: 'OLD', usageLog: usageForUsers(['u1', 'u2', 'u3'], NOW) };
    // created 49h before redeeming => NOT fresh
    const old = NOW - (NEW_ACCOUNT_WINDOW_MS + HOUR);
    const map = { u1: old, u2: old, u3: old };
    expect(detectNewAccountCluster(coupon, map)).toBeNull();
  });

  it('exactly 48h old is NOT fresh (strict less-than window)', () => {
    const coupon: AlertCoupon = { code: 'EXACT', usageLog: usageForUsers(['u1', 'u2', 'u3'], NOW) };
    const at48h = NOW - NEW_ACCOUNT_WINDOW_MS; // age === window => not < window
    const map = { u1: at48h, u2: at48h, u3: at48h };
    expect(detectNewAccountCluster(coupon, map)).toBeNull();
  });

  it('users missing from the account map are not accused', () => {
    const coupon: AlertCoupon = { code: 'MISS', usageLog: usageForUsers(['u1', 'u2', 'u3'], NOW) };
    const map = { u1: NOW - HOUR }; // only u1 known
    expect(detectNewAccountCluster(coupon, map)).toBeNull();
  });

  it('a redemption before account creation (negative age) is ignored', () => {
    const coupon: AlertCoupon = { code: 'NEG', usageLog: usageForUsers(['u1', 'u2', 'u3'], NOW) };
    const map = { u1: NOW + HOUR, u2: NOW + HOUR, u3: NOW + HOUR }; // created after redeeming
    expect(detectNewAccountCluster(coupon, map)).toBeNull();
  });

  it('released redemptions do not count toward the cluster', () => {
    const log: AlertUsageEntry[] = [
      { userId: 'u1', poolId: 'p1', status: 'released', confirmedAt: NOW },
      { userId: 'u2', poolId: 'p2', status: 'confirmed', confirmedAt: NOW },
      { userId: 'u3', poolId: 'p3', status: 'confirmed', confirmedAt: NOW },
    ];
    const created = NOW - HOUR;
    const map = { u1: created, u2: created, u3: created };
    // only 2 live fresh redemptions => no trip
    expect(detectNewAccountCluster({ code: 'REL', usageLog: log }, map)).toBeNull();
  });
});

describe('computeCouponAlerts (aggregate)', () => {
  it('returns multiple candidates when several detectors trip', () => {
    // near-max AND expiring on the same coupon
    const coupon: AlertCoupon = {
      code: 'MULTI',
      maxUses: 10,
      expiresAt: NOW + 2 * DAY,
      usageLog: liveEntries(9, NOW),
    };
    const cands = computeCouponAlerts(coupon, NOW);
    const types = cands.map((c) => c.type).sort();
    expect(types).toContain('COUPON_NEAR_MAX');
    expect(types).toContain('COUPON_EXPIRING');
  });

  it('returns empty for a quiet coupon', () => {
    const coupon: AlertCoupon = { code: 'QUIET', usageLog: liveEntries(1, NOW) };
    expect(computeCouponAlerts(coupon, NOW)).toEqual([]);
  });

  it('passes velocity threshold + account map through', () => {
    const coupon: AlertCoupon = {
      code: 'AGG',
      usageLog: liveEntries(4, NOW, 'newuser'),
    };
    const map: Record<string, number> = {};
    for (let i = 0; i < 4; i++) map[`newuser${i}`] = NOW - HOUR;
    const cands = computeCouponAlerts(coupon, NOW, { velocityThreshold: 3, accountCreatedAtByUid: map });
    const types = cands.map((c) => c.type);
    expect(types).toContain('COUPON_VELOCITY_SPIKE'); // 4 > 3
    expect(types).toContain('COUPON_NEW_ACCOUNT_CLUSTER'); // 4 fresh >= 3
  });
});

describe('abuse classification + dedupe key', () => {
  it('velocity + new-account cluster are abuse alerts', () => {
    expect(isAbuseAlert('COUPON_VELOCITY_SPIKE')).toBe(true);
    expect(isAbuseAlert('COUPON_NEW_ACCOUNT_CLUSTER')).toBe(true);
  });

  it('near-max + expiring are NOT abuse alerts (housekeeping)', () => {
    expect(isAbuseAlert('COUPON_NEAR_MAX')).toBe(false);
    expect(isAbuseAlert('COUPON_EXPIRING')).toBe(false);
  });

  it('dedupe key is stable per (type, normalized code)', () => {
    expect(alertDedupeKey('COUPON_NEAR_MAX', 'save20')).toBe('COUPON_NEAR_MAX__SAVE20');
    // case + whitespace normalized so the same coupon never double-alerts
    expect(alertDedupeKey('COUPON_NEAR_MAX', '  save20 ')).toBe(alertDedupeKey('COUPON_NEAR_MAX', 'SAVE20'));
  });

  it('different types on the same code produce different keys', () => {
    expect(alertDedupeKey('COUPON_NEAR_MAX', 'X')).not.toBe(alertDedupeKey('COUPON_EXPIRING', 'X'));
  });
});
