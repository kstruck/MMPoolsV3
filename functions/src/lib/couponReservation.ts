// Pure coupon reservation lifecycle (ADR-0002) — reserve → confirm → release,
// keyed by a SERVER-generated reservationId. NO Firebase imports: every function
// is a pure transform over the coupon doc's fields (usageLog array, counters,
// rule fields), so the Firestore transaction wrappers in stripe.ts stay thin and
// the whole lifecycle is exhaustively unit-testable (PLAN Layer 1).
//
// usageLog is the authoritative audit trail. An entry is one of:
//   - pending    : reserved at checkout, awaiting payment
//   - confirmed  : payment completed (or free-pool activated)
//   - released   : checkout expired/failed/swept — the use is reclaimed
//   - legacy     : { userId, poolId, usedAt } with no status — treated as confirmed
//
// maxUses / perUserLimit are enforced against ACTIVE uses = every entry that is
// not 'released' (pending + confirmed + legacy). This is "usesCount including
// live reservations": a coupon can never be over-redeemed, at the cost of an
// abandoned checkout holding a use until the 24h sweep.
import type { CouponUsageEntry, CouponReservationStatus } from "../shared/schemas/quote";

export type { CouponUsageEntry } from "../shared/schemas/quote";

/** Rule fields the validator needs (subset of the stored Coupon doc). */
export interface CouponRules {
  isActive: boolean;
  expiresAt?: number;
  maxUses?: number;
  perUserLimit?: number;
  allowedPoolTypes?: string[];
  usageLog?: CouponUsageEntry[];
}

export interface CouponValidationContext {
  userId: string;
  poolType: string;
  now: number;
}

export type CouponValidationResult = { valid: true } | { valid: false; reason: string };

/** True when a usageLog entry counts against limits (anything not released). */
export function isActiveEntry(entry: CouponUsageEntry): boolean {
  return entry.status !== "released";
}

/** Count of active (non-released) uses across all users. */
export function countActiveUses(usageLog: CouponUsageEntry[] | undefined): number {
  if (!usageLog) return 0;
  return usageLog.filter(isActiveEntry).length;
}

/** Count of active (non-released) uses for one user. */
export function countUserActiveUses(
  usageLog: CouponUsageEntry[] | undefined,
  userId: string
): number {
  if (!usageLog) return 0;
  return usageLog.filter((e) => e.userId === userId && isActiveEntry(e)).length;
}

/**
 * Validates every coupon rule against CURRENT state (live reservations
 * included). Shared by getPoolQuote (display validation) and the reservation
 * transaction (authoritative). Reasons mirror the historical redeemCoupon copy
 * so existing UX/tests stay stable.
 */
export function validateCouponRules(
  coupon: CouponRules,
  ctx: CouponValidationContext
): CouponValidationResult {
  // 1. Active?
  if (!coupon.isActive) {
    return { valid: false, reason: "This coupon is no longer active." };
  }
  // 2. Expired?
  if (coupon.expiresAt && coupon.expiresAt < ctx.now) {
    return { valid: false, reason: "This coupon has expired." };
  }
  // 3. Max uses? (active uses incl. live reservations)
  if (coupon.maxUses !== undefined && countActiveUses(coupon.usageLog) >= coupon.maxUses) {
    return { valid: false, reason: "This coupon has reached its maximum number of uses." };
  }
  // 4. Per-user limit? (this user's active uses)
  if (
    coupon.perUserLimit !== undefined &&
    countUserActiveUses(coupon.usageLog, ctx.userId) >= coupon.perUserLimit
  ) {
    return { valid: false, reason: "You have already used this coupon the maximum number of times." };
  }
  // 5. Allowed pool types?
  if (coupon.allowedPoolTypes && coupon.allowedPoolTypes.length > 0) {
    if (!coupon.allowedPoolTypes.includes(ctx.poolType)) {
      return { valid: false, reason: `This coupon is not valid for ${ctx.poolType} pools.` };
    }
  }
  return { valid: true };
}

/** Builds a fresh 'pending' reservation entry. */
export function makeReservationEntry(args: {
  reservationId: string;
  userId: string;
  poolId: string;
  now: number;
}): CouponUsageEntry {
  return {
    reservationId: args.reservationId,
    userId: args.userId,
    poolId: args.poolId,
    status: "pending",
    reservedAt: args.now,
  };
}

/** Builds a reservation entry already in 'confirmed' state (free-pool path). */
export function makeConfirmedEntry(args: {
  reservationId: string;
  userId: string;
  poolId: string;
  now: number;
  sessionId?: string;
}): CouponUsageEntry {
  return {
    reservationId: args.reservationId,
    userId: args.userId,
    poolId: args.poolId,
    status: "confirmed",
    reservedAt: args.now,
    confirmedAt: args.now,
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
  };
}

/**
 * Returns a NEW usageLog with the entry matching reservationId flipped to the
 * target status (confirmed/released), stamping the relevant timestamp + session.
 * Returns { changed:false } when no matching entry is found (idempotent no-op).
 */
export function transitionReservation(
  usageLog: CouponUsageEntry[] | undefined,
  reservationId: string,
  to: CouponReservationStatus,
  now: number,
  sessionId?: string
): { usageLog: CouponUsageEntry[]; changed: boolean; previousStatus?: CouponReservationStatus } {
  const log = usageLog ? [...usageLog] : [];
  const idx = log.findIndex((e) => e.reservationId === reservationId);
  if (idx === -1) {
    return { usageLog: log, changed: false };
  }
  const prev = log[idx];
  // Idempotency: if already in the target status, report no change.
  if (prev.status === to) {
    return { usageLog: log, changed: false, previousStatus: prev.status };
  }
  const updated: CouponUsageEntry = { ...prev, status: to };
  if (to === "confirmed") {
    updated.confirmedAt = now;
    if (sessionId) updated.sessionId = sessionId;
  } else if (to === "released") {
    updated.releasedAt = now;
  }
  log[idx] = updated;
  return { usageLog: log, changed: true, previousStatus: prev.status };
}

/** reservationIds of 'pending' entries older than `cutoff` (for the stale sweep). */
export function stalePendingReservationIds(
  usageLog: CouponUsageEntry[] | undefined,
  cutoff: number
): string[] {
  if (!usageLog) return [];
  return usageLog
    .filter(
      (e) =>
        e.status === "pending" &&
        typeof e.reservedAt === "number" &&
        e.reservedAt < cutoff &&
        typeof e.reservationId === "string"
    )
    .map((e) => e.reservationId as string);
}
