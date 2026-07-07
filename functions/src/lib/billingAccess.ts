// Pure billing-access gate — deny-by-default for paid features (PLAN Phase 4
// #6c). No Firebase imports so it is unit-testable and importable anywhere.
// billing.ts re-exports checkBillingAccess from here.
import type { PoolBilling } from "../types";

// Paid premium features gated by billing.featuresUnlocked. A pool must carry an
// EXPLICIT `true` flag for these; a MISSING flag DENIES (was previously treated
// as allowed). Free/trial launches stamp all of these explicitly false so state
// is legible.
export const PAID_FEATURE_KEYS: ReadonlyArray<keyof PoolBilling["featuresUnlocked"]> = [
  "aiCommissioner",
  "smsNotifications",
  "whatIfSimulator",
  "customBranding",
];

export function checkBillingAccess(
  billing: PoolBilling | undefined,
  feature?: string
): { allowed: boolean; reason?: string } {
  // No billing record = legacy free pool, always allowed (pool-level access).
  if (!billing) {
    return { allowed: true };
  }

  // Locked pool requires payment.
  if (billing.status === "locked") {
    return { allowed: false, reason: "Pool is locked. Payment required." };
  }

  // Feature-level access.
  if (feature) {
    const featureKey = feature as keyof PoolBilling["featuresUnlocked"];
    if (PAID_FEATURE_KEYS.includes(featureKey)) {
      // Deny-by-default: allowed ONLY when explicitly true. A missing flag denies.
      const unlocked = billing.featuresUnlocked?.[featureKey] === true;
      if (!unlocked) {
        return { allowed: false, reason: "Feature requires premium upgrade." };
      }
    } else {
      // Non-paid / unknown feature key: preserve prior behavior (explicit false
      // denies; missing is allowed).
      if (
        billing.featuresUnlocked &&
        featureKey in billing.featuresUnlocked &&
        !billing.featuresUnlocked[featureKey]
      ) {
        return { allowed: false, reason: "Feature requires premium upgrade." };
      }
    }
  }

  return { allowed: true };
}
