import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Platform-revenue ledger (T14). Every Stripe charge (per-pool billing and
 * bundle purchases) is recorded here so revenue can be aggregated without a
 * Stripe API round-trip and reconciled against Stripe. This is COMPANY income
 * (Commissioner → platform), distinct from the member Entry-Fee dues ledger
 * (pools/{id}/payments) which is GMV, not revenue. See CONTEXT.md Billing.
 *
 * Written only by Cloud Functions (the Stripe webhook + mock dev paths);
 * rules: read SUPER_ADMIN, write:false. One doc per Stripe session
 * (doc id = stripeSessionId) so webhook retries are idempotent.
 */

export type BillingChargeKind = "pool" | "bundle";

export interface BillingCharge {
  userId: string;
  kind: BillingChargeKind;
  amount: number; // dollars, post-discount (Stripe amount_total / 100)
  poolId?: string;
  bundleType?: string;
  tier?: string;
  couponCode?: string;
  stripeSessionId: string;
}

export async function recordBillingCharge(
  db: admin.firestore.Firestore,
  charge: BillingCharge
): Promise<void> {
  try {
    // Doc id = session id → a retried webhook can't double-count revenue.
    await db.collection("billingCharges").doc(charge.stripeSessionId).set(
      {
        userId: charge.userId,
        kind: charge.kind,
        amount: Number(charge.amount) || 0,
        poolId: charge.poolId ?? null,
        bundleType: charge.bundleType ?? null,
        tier: charge.tier ?? null,
        couponCode: charge.couponCode ?? null,
        stripeSessionId: charge.stripeSessionId,
        at: Date.now(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    // Revenue ledger is reporting, not a gate — never fail the money action.
    console.error(`[billingCharges] record failed for ${charge.stripeSessionId}:`, err);
  }
}

export interface RevenueSummary {
  totalRevenue: number;
  last30dRevenue: number;
  byKind: Record<BillingChargeKind, number>;
  chargeCount: number;
}

/**
 * Pure reducer over charge rows → revenue summary. `nowMs` is injected so the
 * 30-day window is deterministic and unit-testable.
 */
export function summarizeCharges(
  charges: Array<Pick<BillingCharge, "amount" | "kind"> & { at?: number }>,
  nowMs: number
): RevenueSummary {
  const cutoff = nowMs - 30 * 24 * 60 * 60 * 1000;
  const summary: RevenueSummary = {
    totalRevenue: 0,
    last30dRevenue: 0,
    byKind: { pool: 0, bundle: 0 },
    chargeCount: 0,
  };
  for (const c of charges) {
    const amt = Number(c.amount) || 0;
    summary.totalRevenue += amt;
    summary.chargeCount += 1;
    if (c.kind === "pool" || c.kind === "bundle") summary.byKind[c.kind] += amt;
    if (typeof c.at === "number" && c.at >= cutoff) summary.last30dRevenue += amt;
  }
  return summary;
}
