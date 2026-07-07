/**
 * monetizationAlertLogic.ts — PURE detection functions for the coupon-abuse
 * alert center (PLAN-BUYFLOW-OVERHAUL Phase 6 #22). Zero I/O, zero
 * firebase-admin: every function takes plain data + an injected `nowMs` so the
 * boundaries (24h velocity window, 80% near-max, 7-day expiry, 48h new-account
 * cluster) are deterministic and unit-testable. The scheduled job
 * (monetizationAlerts.ts) is the only place that reads Firestore and writes
 * monetization_alerts docs; it delegates ALL decisions to these functions.
 *
 * Shapes are intentionally structural (not the full Coupon/CouponUsageEntry
 * types) so the tests can build minimal fixtures and so both the legacy
 * usageLog shape ({userId,poolId,usedAt}) and the ADR-0002 reservation shape
 * ({reservationId,status,reservedAt,confirmedAt,...}) are handled.
 */

// --- Constants (defaults; the scheduled job may override velocity from config) --

export const DEFAULT_VELOCITY_THRESHOLD = 10;
/** A coupon at or above this fraction of maxUses trips the near-max alert. */
export const NEAR_MAX_FRACTION = 0.8;
/** Coupons expiring within this window (and with uses left) trip the expiring alert. */
export const EXPIRING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** The velocity window: confirmed+pending uses within this look-back trip the spike alert. */
export const VELOCITY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** New-account cluster: an account created within this window BEFORE redeeming is "new". */
export const NEW_ACCOUNT_WINDOW_MS = 48 * 60 * 60 * 1000;
/** New-account cluster trips at this many new-account redemptions on one coupon. */
export const NEW_ACCOUNT_CLUSTER_MIN = 3;

// --- Structural inputs --------------------------------------------------------

/** Minimal coupon usage entry — covers legacy + reservation shapes. */
export interface AlertUsageEntry {
  reservationId?: string;
  userId?: string;
  poolId?: string;
  status?: 'pending' | 'confirmed' | 'released';
  reservedAt?: number;
  confirmedAt?: number;
  releasedAt?: number;
  usedAt?: number; // legacy
}

/** Minimal coupon shape the detectors read. */
export interface AlertCoupon {
  id?: string;
  code: string;
  isActive?: boolean;
  maxUses?: number;
  usesCount?: number;
  expiresAt?: number;
  usageLog?: AlertUsageEntry[];
}

export type MonetizationAlertType =
  | 'COUPON_VELOCITY_SPIKE'
  | 'COUPON_NEW_ACCOUNT_CLUSTER'
  | 'COUPON_NEAR_MAX'
  | 'COUPON_EXPIRING';

/** The two ABUSE alert types (velocity + new-account cluster) that also email. */
export const ABUSE_ALERT_TYPES: readonly MonetizationAlertType[] = [
  'COUPON_VELOCITY_SPIKE',
  'COUPON_NEW_ACCOUNT_CLUSTER',
];

export function isAbuseAlert(type: MonetizationAlertType): boolean {
  return ABUSE_ALERT_TYPES.includes(type);
}

/** A computed alert candidate (before it is upserted into Firestore). */
export interface AlertCandidate {
  type: MonetizationAlertType;
  couponCode: string;
  couponId?: string;
  /** Human-readable one-line summary for the dashboard + email body. */
  message: string;
  /** Structured detail (counts/thresholds) for the UI + audit. */
  detail: Record<string, unknown>;
}

// --- Entry classification -----------------------------------------------------

/**
 * Is this usage entry a LIVE use (counts toward maxUses)? Missing status ==>
 * legacy confirmed use (see quote.ts CouponUsageEntry doc). 'released' never
 * counts. Mirrors couponReservation.isActiveEntry so counting stays consistent.
 */
export function isLiveUse(entry: AlertUsageEntry): boolean {
  if (entry.status === 'released') return false;
  return true;
}

/** Is this a confirmed OR pending (i.e. live) use? Alias kept for clarity at call sites. */
export function isConfirmedOrPending(entry: AlertUsageEntry): boolean {
  return isLiveUse(entry);
}

/**
 * The best timestamp (ms) for WHEN a live use happened, for windowed counts:
 * prefer confirmedAt, then reservedAt, then legacy usedAt. Returns undefined if
 * the entry carries no usable timestamp.
 */
export function entryEventMs(entry: AlertUsageEntry): number | undefined {
  if (typeof entry.confirmedAt === 'number') return entry.confirmedAt;
  if (typeof entry.reservedAt === 'number') return entry.reservedAt;
  if (typeof entry.usedAt === 'number') return entry.usedAt;
  return undefined;
}

/** Count live (confirmed+pending+legacy) uses in the usageLog. */
export function countLiveUses(usageLog: AlertUsageEntry[] | undefined): number {
  if (!usageLog) return 0;
  return usageLog.filter(isLiveUse).length;
}

/**
 * Count live uses whose event timestamp falls within [nowMs - windowMs, nowMs].
 * Entries with no timestamp are NOT counted (we cannot prove they are recent).
 */
export function countLiveUsesInWindow(
  usageLog: AlertUsageEntry[] | undefined,
  nowMs: number,
  windowMs: number
): number {
  if (!usageLog) return 0;
  const cutoff = nowMs - windowMs;
  let n = 0;
  for (const e of usageLog) {
    if (!isLiveUse(e)) continue;
    const t = entryEventMs(e);
    if (typeof t === 'number' && t >= cutoff && t <= nowMs) n += 1;
  }
  return n;
}

// --- Individual detectors (each returns a candidate or null) ------------------

/**
 * Velocity spike: > threshold live uses in the last 24h. Strictly greater-than
 * (threshold=10 trips at 11), matching PLAN "> X uses/24h".
 */
export function detectVelocitySpike(
  coupon: AlertCoupon,
  nowMs: number,
  threshold: number = DEFAULT_VELOCITY_THRESHOLD
): AlertCandidate | null {
  const recent = countLiveUsesInWindow(coupon.usageLog, nowMs, VELOCITY_WINDOW_MS);
  if (recent > threshold) {
    return {
      type: 'COUPON_VELOCITY_SPIKE',
      couponCode: coupon.code,
      couponId: coupon.id,
      message: `Coupon ${coupon.code} used ${recent} times in 24h (threshold ${threshold}).`,
      detail: { recentUses: recent, threshold, windowHours: 24 },
    };
  }
  return null;
}

/**
 * New-account cluster: >= NEW_ACCOUNT_CLUSTER_MIN live redemptions whose
 * redeeming user's account was created LESS THAN 48h before the redemption.
 * `accountCreatedAtByUid` maps uid -> account createdAt (ms). Users missing
 * from the map are treated as NOT new (we cannot prove freshness → no false
 * accusation).
 */
export function detectNewAccountCluster(
  coupon: AlertCoupon,
  accountCreatedAtByUid: Record<string, number>
): AlertCandidate | null {
  const log = coupon.usageLog ?? [];
  const freshUids = new Set<string>();
  let freshRedemptions = 0;
  for (const e of log) {
    if (!isLiveUse(e)) continue;
    const uid = e.userId;
    if (!uid) continue;
    const createdAt = accountCreatedAtByUid[uid];
    const redeemedAt = entryEventMs(e);
    if (typeof createdAt !== 'number' || typeof redeemedAt !== 'number') continue;
    // "created < 48h before redeeming": redeemedAt - createdAt within the window
    // (and non-negative — a redemption before account creation is nonsensical).
    const age = redeemedAt - createdAt;
    if (age >= 0 && age < NEW_ACCOUNT_WINDOW_MS) {
      freshRedemptions += 1;
      freshUids.add(uid);
    }
  }
  if (freshRedemptions >= NEW_ACCOUNT_CLUSTER_MIN) {
    return {
      type: 'COUPON_NEW_ACCOUNT_CLUSTER',
      couponCode: coupon.code,
      couponId: coupon.id,
      message: `Coupon ${coupon.code} redeemed ${freshRedemptions} times by ${freshUids.size} accounts created <48h before use.`,
      detail: {
        freshRedemptions,
        distinctFreshAccounts: freshUids.size,
        windowHours: 48,
      },
    };
  }
  return null;
}

/**
 * Near-max: live uses >= 80% of maxUses (and maxUses is set). Uses ceil so a
 * coupon with maxUses=10 trips at 8. Coupons with no maxUses never trip.
 */
export function detectNearMax(coupon: AlertCoupon): AlertCandidate | null {
  const maxUses = coupon.maxUses;
  if (typeof maxUses !== 'number' || maxUses <= 0) return null;
  const used = countLiveUses(coupon.usageLog);
  const trigger = Math.ceil(maxUses * NEAR_MAX_FRACTION);
  if (used >= trigger) {
    return {
      type: 'COUPON_NEAR_MAX',
      couponCode: coupon.code,
      couponId: coupon.id,
      message: `Coupon ${coupon.code} at ${used}/${maxUses} uses (>=${Math.round(
        NEAR_MAX_FRACTION * 100
      )}%).`,
      detail: { used, maxUses, fraction: NEAR_MAX_FRACTION, trigger },
    };
  }
  return null;
}

/**
 * Expiring: coupon expires within 7 days (from now) AND still has uses
 * remaining (unlimited coupons always "have uses remaining"). Already-expired
 * coupons do NOT trip (expiry is in the past — nothing actionable). Coupons
 * without an expiresAt never trip.
 */
export function detectExpiring(coupon: AlertCoupon, nowMs: number): AlertCandidate | null {
  const expiresAt = coupon.expiresAt;
  if (typeof expiresAt !== 'number' || expiresAt <= 0) return null;
  if (expiresAt <= nowMs) return null; // already expired — not "expiring soon"
  if (expiresAt - nowMs > EXPIRING_WINDOW_MS) return null;

  const used = countLiveUses(coupon.usageLog);
  const hasUsesLeft = typeof coupon.maxUses !== 'number' || used < coupon.maxUses;
  if (!hasUsesLeft) return null; // fully consumed — expiry is moot

  const daysLeft = Math.max(0, Math.round((expiresAt - nowMs) / (24 * 60 * 60 * 1000)));
  return {
    type: 'COUPON_EXPIRING',
    couponCode: coupon.code,
    couponId: coupon.id,
    message: `Coupon ${coupon.code} expires in ~${daysLeft}d with uses remaining.`,
    detail: {
      expiresAt,
      daysLeft,
      used,
      maxUses: typeof coupon.maxUses === 'number' ? coupon.maxUses : null,
    },
  };
}

/**
 * Run every detector over one coupon and return all tripped candidates. The
 * scheduled job maps these to monetization_alerts docs (deduped on
 * (type,couponCode)). `accountCreatedAtByUid` is only needed for the
 * new-account-cluster detector.
 */
export function computeCouponAlerts(
  coupon: AlertCoupon,
  nowMs: number,
  opts: {
    velocityThreshold?: number;
    accountCreatedAtByUid?: Record<string, number>;
  } = {}
): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const velocity = detectVelocitySpike(coupon, nowMs, opts.velocityThreshold ?? DEFAULT_VELOCITY_THRESHOLD);
  if (velocity) out.push(velocity);
  const cluster = detectNewAccountCluster(coupon, opts.accountCreatedAtByUid ?? {});
  if (cluster) out.push(cluster);
  const nearMax = detectNearMax(coupon);
  if (nearMax) out.push(nearMax);
  const expiring = detectExpiring(coupon, nowMs);
  if (expiring) out.push(expiring);
  return out;
}

// --- Dedupe key ---------------------------------------------------------------

/**
 * Deterministic dedupe key for an alert. The scheduled job upserts on this key
 * so it never creates a SECOND open alert for the same (type,couponCode) — it
 * refreshes the existing one instead (PLAN #22 "don't re-create an open alert
 * for the same (type,couponCode)"). Coupon-abuse/housekeeping alerts written by
 * this job all key on type+code; the Wave-2 refund/dispute/double-charge alerts
 * use their own ids and are untouched by this job.
 */
export function alertDedupeKey(type: MonetizationAlertType, couponCode: string): string {
  return `${type}__${couponCode.trim().toUpperCase()}`;
}
