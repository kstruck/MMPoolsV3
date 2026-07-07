import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Platform-revenue ledger (T14). Every Stripe money event (per-pool billing,
 * bundle purchases, and — post buy-flow overhaul — refunds and disputes) is
 * recorded here so revenue can be aggregated without a Stripe API round-trip
 * and reconciled against Stripe. This is COMPANY income (Commissioner →
 * platform), distinct from the member Entry-Fee dues ledger
 * (pools/{id}/payments) which is GMV, not revenue. See CONTEXT.md Billing.
 *
 * Written only by Cloud Functions (the Stripe webhook + mock dev paths);
 * rules: read SUPER_ADMIN, write:false.
 *
 * IDEMPOTENCY: each row has a deterministic doc id so retries can't
 * double-count. Charge rows use the Stripe session id; refund/dispute
 * adjustment rows use a `refund_<chargeId>` / `dispute_<chargeId>` id (they key
 * off charge/payment-intent, not a session — a session may not even exist).
 *
 * RELIABILITY (PLAN Phase 5 #20): for money events processed inside a Firestore
 * transaction, use {@link writeBillingChargeTxn} so the ledger row is written in
 * the SAME transaction as the pool/bundle mutation — a ledger failure fails the
 * webhook and Stripe retries. {@link recordBillingCharge} remains a best-effort,
 * non-transactional writer for the mock/dev-sandbox paths that are not wrapped
 * in a transaction.
 */

// Widened for refunds/disputes (PLAN Phase 5 #18). Negative-amount adjustment
// rows carry kind 'refund' | 'dispute'.
export type BillingChargeKind = "pool" | "bundle" | "refund" | "dispute";

export interface BillingCharge {
  userId: string;
  kind: BillingChargeKind;
  amount: number; // dollars, post-discount (Stripe amount_total / 100). NEGATIVE for refund/dispute.
  poolId?: string;
  bundleType?: string;
  tier?: string;
  couponCode?: string;
  /** Stripe checkout session id — the doc id for charge rows. Absent on some refund/dispute events. */
  stripeSessionId?: string;
  /** Stripe PaymentIntent id — stamped on every new charge row so refunds/disputes can be linked. */
  paymentIntentId?: string;
  /** Stripe charge id (ch_...) — set on refund/dispute rows and, when available, on charge rows. */
  chargeId?: string;
  /** For a refund/dispute row: the original charge/session doc id this adjustment reverses. */
  relatedChargeId?: string;
}

/** The deterministic Firestore doc id for a ledger row. Pure (unit-testable). */
export function billingChargeDocId(charge: BillingCharge): string {
  if (charge.kind === "refund") {
    return `refund_${charge.chargeId || charge.relatedChargeId || charge.stripeSessionId || "unknown"}`;
  }
  if (charge.kind === "dispute") {
    return `dispute_${charge.chargeId || charge.relatedChargeId || charge.stripeSessionId || "unknown"}`;
  }
  // pool | bundle — one row per Stripe session.
  return charge.stripeSessionId || charge.chargeId || `charge_${charge.userId}_${charge.poolId || charge.bundleType || "x"}`;
}

/** Builds the {docId, data} pair for a ledger row. Pure — no I/O, fully testable. */
export function buildBillingChargeDoc(charge: BillingCharge): {
  docId: string;
  data: Record<string, unknown>;
} {
  return {
    docId: billingChargeDocId(charge),
    data: {
      userId: charge.userId,
      kind: charge.kind,
      amount: Number(charge.amount) || 0,
      poolId: charge.poolId ?? null,
      bundleType: charge.bundleType ?? null,
      tier: charge.tier ?? null,
      couponCode: charge.couponCode ?? null,
      stripeSessionId: charge.stripeSessionId ?? null,
      paymentIntentId: charge.paymentIntentId ?? null,
      chargeId: charge.chargeId ?? null,
      relatedChargeId: charge.relatedChargeId ?? null,
      at: Date.now(),
      createdAt: FieldValue.serverTimestamp(),
    },
  };
}

/**
 * Best-effort ledger write for the mock/dev-sandbox paths (NOT in a
 * transaction). Never throws — revenue reporting must never fail a money action
 * on the non-transactional paths. Real webhook money events use
 * {@link writeBillingChargeTxn} instead.
 */
export async function recordBillingCharge(
  db: admin.firestore.Firestore,
  charge: BillingCharge
): Promise<void> {
  try {
    const { docId, data } = buildBillingChargeDoc(charge);
    // Doc id is deterministic → a retried write can't double-count revenue.
    await db.collection("billingCharges").doc(docId).set(data, { merge: true });
  } catch (err) {
    console.error(`[billingCharges] record failed for ${billingChargeDocId(charge)}:`, err);
  }
}

/**
 * Transactional ledger write (PLAN Phase 5 #20). Enqueues the ledger row onto
 * the SAME transaction that mutates the pool/bundle so an error aborts the whole
 * webhook and Stripe retries. Deterministic doc id keeps retries idempotent.
 * Throws on programmer error (never swallows) — the caller's transaction owns
 * the failure semantics.
 */
export function writeBillingChargeTxn(
  txn: admin.firestore.Transaction,
  db: admin.firestore.Firestore,
  charge: BillingCharge
): void {
  const { docId, data } = buildBillingChargeDoc(charge);
  txn.set(db.collection("billingCharges").doc(docId), data, { merge: true });
}

export interface RevenueSummary {
  totalRevenue: number;
  last30dRevenue: number;
  byKind: Record<BillingChargeKind, number>;
  chargeCount: number;
}

/**
 * Pure reducer over charge rows → revenue summary. `nowMs` is injected so the
 * 30-day window is deterministic and unit-testable. Refund/dispute rows carry
 * negative amounts, so totals net them automatically.
 */
export function summarizeCharges(
  charges: Array<Pick<BillingCharge, "amount" | "kind"> & { at?: number }>,
  nowMs: number
): RevenueSummary {
  const cutoff = nowMs - 30 * 24 * 60 * 60 * 1000;
  const summary: RevenueSummary = {
    totalRevenue: 0,
    last30dRevenue: 0,
    byKind: { pool: 0, bundle: 0, refund: 0, dispute: 0 },
    chargeCount: 0,
  };
  for (const c of charges) {
    const amt = Number(c.amount) || 0;
    summary.totalRevenue += amt;
    summary.chargeCount += 1;
    if (c.kind in summary.byKind) summary.byKind[c.kind] += amt;
    if (typeof c.at === "number" && c.at >= cutoff) summary.last30dRevenue += amt;
  }
  return summary;
}
