/**
 * Canonical entitlements — grant / revoke / redeem for the Bundle + Pool-Credit
 * model (PLAN Phase 4 #14-17). Replaces the four legacy user-doc fields
 * (`freePoolsAvailable`, `activeBundleType`, `bundleExpiresAt`, `poolCredits[]`).
 *
 * Firestore layout (see shared/schemas/bundle.ts):
 *   bundles/{bundleId}                    — owner-scoped entitlement doc
 *   bundles/{bundleId}/credits/{creditId} — one doc per redeemable Pool Credit
 *
 * All writes go through the Admin SDK (rules-bypassing). Wave 5 adds firestore
 * rules: owner-read-own + SUPER_ADMIN read, functions-only write (see
 * NOTES-WAVE3B.md). This module never trusts client-supplied prices — admin
 * grants snapshot the product the SUPER_ADMIN describes; purchase grants
 * snapshot the server-resolved billing-config package.
 *
 * Transaction discipline: a grant creates ONE bundle doc + N credit docs in a
 * single Firestore transaction. N <= MAX_CREDITS_PER_BUNDLE (100) keeps the
 * write count (1 bundle + <=100 credits + <=1 ledger row) well under the 500
 * per-transaction limit.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { randomUUID } from "crypto";
import { assertCallerRole } from "./adminClaims";
import { validated } from "./lib/validated";
import { adminGrantEntitlementSchema, adminRevokeEntitlementSchema } from "./schemas/entitlements";
import { redeemPoolCreditSchema } from "./schemas/billingCheckout";
import { writeAdminAudit } from "./lib/adminAudit";
import { writeBillingChargeTxn } from "./lib/billingCharges";
import {
  MAX_CREDITS_PER_BUNDLE,
  creditSatisfiesPool,
  statusAfterConsume,
  type ProductKind,
  type BundleSource,
  type CreditConstraints,
  type ProductSnapshot,
} from "./shared/schemas/bundle";
import { isPoolType, type PoolType } from "./shared/poolTypes";

// Re-export the snapshot type so callers (and tests) can type grant inputs
// without reaching into the shared schema path directly.
export type { ProductSnapshot } from "./shared/schemas/bundle";

const db = admin.firestore();

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Shared grant helper (reused by the Stripe webhook, admin grant, migration).
// ---------------------------------------------------------------------------

export interface GrantEntitlementInput {
  ownerId: string;
  productKind: ProductKind;
  source: BundleSource;
  productSnapshot: ProductSnapshot;
  /** CREDIT_BUNDLE: number of credits to spawn (1..100). Ignored for passes. */
  creditsTotal?: number;
  /** Per-credit constraints applied to every spawned credit. */
  creditConstraints?: CreditConstraints;
  /** UNLIMITED_PASS only — ms since epoch when the pass expires. */
  termEndsAt?: number;
  /** source PURCHASE only. */
  stripeSessionId?: string;
  paymentIntentId?: string;
  /** Ledger row: when set, a billingCharges row is written IN THE SAME txn. */
  ledgerAmount?: number;
  createdAt?: number;
  /** Optional explicit bundle id (idempotency / migration determinism). */
  bundleId?: string;
}

/**
 * Enqueues a bundle + its credit docs (+ optional ledger row) onto an existing
 * Firestore transaction. Pure w.r.t. Firestore reads — it only issues writes, so
 * the caller controls read/idempotency ordering. Returns the bundle id and the
 * count of credits spawned.
 *
 * Enforces the creditsTotal <= 100 cap here too (defense in depth: the config
 * schema and the callables also enforce it).
 */
export function grantEntitlementTxn(
  txn: admin.firestore.Transaction,
  input: GrantEntitlementInput
): { bundleId: string; creditsSpawned: number } {
  const now = input.createdAt ?? Date.now();
  const bundleId = input.bundleId ?? randomUUID();
  const bundleRef = db.collection("bundles").doc(bundleId);

  const isPass = input.productKind === "UNLIMITED_PASS";
  const creditsTotal = isPass ? 0 : Math.floor(input.creditsTotal ?? 0);

  if (!isPass) {
    if (creditsTotal < 1) {
      throw new HttpsError("invalid-argument", "CREDIT_BUNDLE requires creditsTotal >= 1.");
    }
    if (creditsTotal > MAX_CREDITS_PER_BUNDLE) {
      throw new HttpsError(
        "invalid-argument",
        `creditsTotal ${creditsTotal} exceeds the ${MAX_CREDITS_PER_BUNDLE}-credit cap.`
      );
    }
  }
  if (isPass && (typeof input.termEndsAt !== "number" || input.termEndsAt <= 0)) {
    throw new HttpsError("invalid-argument", "UNLIMITED_PASS requires a positive termEndsAt.");
  }

  const bundleDoc: Record<string, unknown> = {
    ownerId: input.ownerId,
    productKind: input.productKind,
    source: input.source,
    productSnapshot: input.productSnapshot,
    creditsTotal,
    creditsUsed: 0,
    status: "active",
    createdAt: now,
  };
  if (isPass) bundleDoc.termEndsAt = input.termEndsAt;
  if (input.source === "PURCHASE") {
    if (input.stripeSessionId) bundleDoc.stripeSessionId = input.stripeSessionId;
    if (input.paymentIntentId) bundleDoc.paymentIntentId = input.paymentIntentId;
  }
  txn.set(bundleRef, bundleDoc);

  // Constraints applied to every credit. Omit absent/ALL keys so the doc stays
  // small and the shape matches the schema (optional fields).
  const constraints: CreditConstraints = {};
  const cc = input.creditConstraints ?? {};
  if (cc.poolType && cc.poolType !== "ALL") constraints.poolType = cc.poolType;
  if (typeof cc.maxPlayersPerPool === "number") constraints.maxPlayersPerPool = cc.maxPlayersPerPool;

  let creditsSpawned = 0;
  if (!isPass) {
    for (let i = 0; i < creditsTotal; i++) {
      const creditRef = bundleRef.collection("credits").doc();
      txn.set(creditRef, { constraints, status: "available" });
      creditsSpawned++;
    }
  }

  // Ledger row in the SAME txn (a failure aborts the whole grant).
  if (typeof input.ledgerAmount === "number") {
    writeBillingChargeTxn(txn, db, {
      userId: input.ownerId,
      kind: "bundle",
      amount: input.ledgerAmount,
      bundleType: bundleId,
      stripeSessionId: input.stripeSessionId,
      paymentIntentId: input.paymentIntentId,
    });
  }

  return { bundleId, creditsSpawned };
}

// ---------------------------------------------------------------------------
// adminGrantEntitlement — SUPER_ADMIN grants a bundle/pass to a user.
// ---------------------------------------------------------------------------

/**
 * Grant a CREDIT_BUNDLE (source ADMIN_GRANT) or UNLIMITED_PASS to a user.
 * SUPER_ADMIN only, audited. `reason` required. No money changes hands — no
 * ledger row (admin grants are comps, not revenue). The target is promoted to
 * COMMISSIONER so they can create pools with the entitlement.
 */
export const adminGrantEntitlement = validated(
  { schema: adminGrantEntitlementSchema, label: "adminGrantEntitlement", role: "SUPER_ADMIN", appCheck: "monitor" },
  async (input, request) => {
    // auth + SUPER_ADMIN (claim AND doc) already enforced by the wrapper;
    // schema guarantees targetUid, productKind, non-empty reason, and the
    // per-kind field (creditsTotal >= 1 | termDays >= 1).
    const caller = { uid: request.auth!.uid, email: request.auth!.token.email as string | undefined };
    const { targetUid, reason } = input;

    const poolType = input.poolType && input.poolType !== "ALL" && isPoolType(input.poolType)
      ? (input.poolType as PoolType)
      : ("ALL" as const);
    const maxPlayersPerPool = Math.max(1, Math.round(Number(input.maxPlayersPerPool) || 9999));
    const snapshot: ProductSnapshot = {
      name: (input.name ?? "").trim() || (input.productKind === "UNLIMITED_PASS" ? "Admin Unlimited Pass" : "Admin Credit Grant"),
      price: Math.max(0, Number(input.price) || 0),
      poolType,
      maxPlayersPerPool,
    };

    const now = Date.now();
    let creditsTotal = 0;
    let termEndsAt: number | undefined;
    if (input.productKind === "CREDIT_BUNDLE") {
      creditsTotal = Math.floor(input.creditsTotal);
      if (creditsTotal > MAX_CREDITS_PER_BUNDLE) {
        throw new HttpsError(
          "invalid-argument",
          `creditsTotal ${creditsTotal} exceeds the ${MAX_CREDITS_PER_BUNDLE}-credit cap.`
        );
      }
    } else {
      termEndsAt = now + Math.floor(input.termDays) * DAY_MS;
    }

    let bundleId = "";
    await db.runTransaction(async (txn) => {
      const res = grantEntitlementTxn(txn, {
        ownerId: targetUid,
        productKind: input.productKind,
        source: "ADMIN_GRANT",
        productSnapshot: snapshot,
        creditsTotal,
        creditConstraints: {
          poolType: poolType === "ALL" ? undefined : poolType,
          maxPlayersPerPool: maxPlayersPerPool >= 9999 ? undefined : maxPlayersPerPool,
        },
        termEndsAt,
        createdAt: now,
      });
      bundleId = res.bundleId;
      // Promote to COMMISSIONER so the grant is usable (mirrors legacy grantBundle).
      txn.set(db.collection("users").doc(targetUid), { role: "COMMISSIONER" }, { merge: true });
    });

    await writeAdminAudit({
      actorUid: caller.uid,
      actorEmail: caller.email,
      action: "ENTITLEMENT_GRANTED",
      targetType: "user",
      targetId: targetUid,
      metadata: { bundleId, productKind: input.productKind, creditsTotal, termEndsAt: termEndsAt ?? null, reason },
      status: "success",
    });

    return { success: true, bundleId };
  },
);

// ---------------------------------------------------------------------------
// adminRevokeEntitlement — SUPER_ADMIN revokes bundle / single credit / pass.
// ---------------------------------------------------------------------------

/**
 * Revocation transaction body (factored out of the callable so it is unit
 * testable against a fake Firestore transaction). Semantics:
 *   - scope 'bundle'  → status 'revoked'; every AVAILABLE credit → 'revoked'.
 *                       USED credits are left untouched (already spent on pools).
 *   - scope 'credit'  → a single AVAILABLE credit → 'revoked'.
 *   - scope 'pass'    → an UNLIMITED_PASS → status 'expired' (early expiry).
 * Returns the number of credits voided. Throws HttpsError on missing/ineligible
 * targets.
 */
export async function revokeEntitlementTxn(
  txn: admin.firestore.Transaction,
  args: {
    bundleId: string;
    scope: "bundle" | "credit" | "pass";
    creditId?: string;
    reason: string;
    nowMs: number;
  }
): Promise<{ revokedCredits: number }> {
  const { bundleId, scope, reason, nowMs } = args;
  const bundleRef = db.collection("bundles").doc(bundleId);
  const bundleSnap = await txn.get(bundleRef);
  if (!bundleSnap.exists) {
    throw new HttpsError("not-found", "Bundle not found.");
  }
  const bundle = bundleSnap.data() as { productKind: ProductKind; status: string };

  if (scope === "pass") {
    if (bundle.productKind !== "UNLIMITED_PASS") {
      throw new HttpsError("failed-precondition", "scope 'pass' only applies to an UNLIMITED_PASS.");
    }
    txn.update(bundleRef, { status: "expired", revokedReason: reason, revokedAt: nowMs });
    return { revokedCredits: 0 };
  }

  if (scope === "credit") {
    if (!args.creditId) throw new HttpsError("invalid-argument", "creditId is required for scope 'credit'.");
    const creditRef = bundleRef.collection("credits").doc(args.creditId);
    const creditSnap = await txn.get(creditRef);
    if (!creditSnap.exists) throw new HttpsError("not-found", "Credit not found.");
    const credit = creditSnap.data() as { status: string };
    if (credit.status !== "available") {
      throw new HttpsError("failed-precondition", `Credit is '${credit.status}', not available — cannot revoke.`);
    }
    txn.update(creditRef, { status: "revoked" });
    txn.update(bundleRef, { revokedReason: reason, revokedAt: nowMs });
    return { revokedCredits: 1 };
  }

  // scope === 'bundle' — void the whole bundle + all AVAILABLE credits (USED untouched).
  const availableSnap = await txn.get(bundleRef.collection("credits").where("status", "==", "available"));
  availableSnap.docs.forEach((d) => txn.update(d.ref, { status: "revoked" }));
  txn.update(bundleRef, { status: "revoked", revokedReason: reason, revokedAt: nowMs });
  return { revokedCredits: availableSnap.size };
}

/**
 * Revoke an entitlement. SUPER_ADMIN only, audited, owner-visible (the bundle
 * doc carries revokedReason/revokedAt). Delegates to {@link revokeEntitlementTxn}.
 * `reason` required.
 */
export const adminRevokeEntitlement = validated(
  { schema: adminRevokeEntitlementSchema, label: "adminRevokeEntitlement", role: "SUPER_ADMIN", appCheck: "monitor" },
  async (input, request) => {
    // Schema guarantees bundleId, scope, non-empty reason, and creditId when
    // scope is 'credit' (discriminated union).
    const caller = { uid: request.auth!.uid, email: request.auth!.token.email as string | undefined };
    const { bundleId, scope, reason } = input;
    const creditId = input.scope === "credit" ? input.creditId : undefined;

    const result = await db.runTransaction((txn) =>
      revokeEntitlementTxn(txn, { bundleId, scope, creditId, reason, nowMs: Date.now() })
    );

    await writeAdminAudit({
      actorUid: caller.uid,
      actorEmail: caller.email,
      action: "ENTITLEMENT_REVOKED",
      targetType: "bundle",
      targetId: bundleId,
      metadata: { scope, creditId: creditId ?? null, revokedCredits: result.revokedCredits, reason },
      status: "success",
    });

    return { success: true, revokedCredits: result.revokedCredits };
  },
);

// ---------------------------------------------------------------------------
// redeemPoolCredit — spend one credit to activate a pool.
// ---------------------------------------------------------------------------

export interface RedeemResult {
  bundleId: string;
  creditId: string;
  bundleStatus: string;
}

/**
 * Redeem one available Pool Credit owned by `ownerId` to activate `poolId`.
 * In ONE transaction:
 *   1. read the pool, verify it belongs to the owner and is not already active,
 *      derive its poolType + player ceiling;
 *   2. find an AVAILABLE credit (in an ACTIVE, non-expired CREDIT_BUNDLE owned by
 *      the caller) whose constraints satisfy the pool;
 *   3. mark the credit used (+ usedByPoolId, usedAt), increment bundle.creditsUsed,
 *      flip bundle.status → 'exhausted' when creditsUsed === creditsTotal;
 *   4. stamp pool billing status:'active', paidVia:'credit'.
 * Rejects used/revoked/constraint-violating credits and expired/revoked bundles.
 *
 * `preferBundleId`/`preferCreditId` let a caller (wizard) target a specific
 * credit; when absent the helper picks the first eligible one.
 */
export async function redeemPoolCreditForPool(args: {
  ownerId: string;
  poolId: string;
  preferBundleId?: string;
  preferCreditId?: string;
}): Promise<RedeemResult> {
  const { ownerId, poolId } = args;
  const now = Date.now();

  return db.runTransaction(async (txn) => {
    // --- 1. Pool: ownership + not-already-active + derive constraints ---
    const poolRef = db.collection("pools").doc(poolId);
    const poolSnap = await txn.get(poolRef);
    if (!poolSnap.exists) throw new HttpsError("not-found", "Pool not found.");
    const pool = poolSnap.data() as {
      createdByUid?: string;
      ownerId?: string;
      managerUid?: string;
      type?: string;
      billing?: { status?: string; paid?: { maxPlayersAllowed?: number } };
      maxPlayers?: number;
      settings?: { maxPlayers?: number };
    };
    // Owner precedence mirrors poolOps.ts (createdByUid primary, then legacy fallbacks).
    const poolOwner = pool.createdByUid || pool.ownerId || pool.managerUid;
    if (poolOwner && poolOwner !== ownerId) {
      throw new HttpsError("permission-denied", "You do not own this pool.");
    }
    if (pool.billing?.status === "active") {
      throw new HttpsError("failed-precondition", "This pool is already active.");
    }
    const poolType = (isPoolType(pool.type) ? pool.type : undefined) as PoolType | undefined;
    const poolMaxPlayers =
      pool.billing?.paid?.maxPlayersAllowed ?? pool.settings?.maxPlayers ?? pool.maxPlayers;

    // --- 2. Find an eligible bundle + credit ---
    // Candidate bundles: owner's ACTIVE CREDIT_BUNDLEs. If a specific bundle is
    // requested, scope to it; otherwise scan the owner's active credit bundles.
    let bundleRefs: FirebaseFirestore.DocumentReference[] = [];
    if (args.preferBundleId) {
      bundleRefs = [db.collection("bundles").doc(args.preferBundleId)];
    } else {
      const bundlesSnap = await txn.get(
        db
          .collection("bundles")
          .where("ownerId", "==", ownerId)
          .where("productKind", "==", "CREDIT_BUNDLE")
          .where("status", "==", "active")
      );
      bundleRefs = bundlesSnap.docs.map((d) => d.ref);
    }

    for (const bundleRef of bundleRefs) {
      const bundleSnap = await txn.get(bundleRef);
      if (!bundleSnap.exists) continue;
      const bundle = bundleSnap.data() as {
        ownerId: string;
        productKind: ProductKind;
        status: string;
        creditsUsed?: number;
        creditsTotal?: number;
      };
      if (bundle.ownerId !== ownerId) continue;
      if (bundle.productKind !== "CREDIT_BUNDLE") continue;
      if (bundle.status !== "active") continue; // rejects revoked/exhausted/expired bundles

      // Available credits in this bundle.
      const creditsCol = bundleRef.collection("credits");
      const availSnap = await txn.get(creditsCol.where("status", "==", "available"));

      // Pick the requested credit if given, else the first constraint-satisfying one.
      let chosen: FirebaseFirestore.QueryDocumentSnapshot | undefined;
      for (const c of availSnap.docs) {
        if (args.preferCreditId && c.id !== args.preferCreditId) continue;
        const constraints = (c.data() as { constraints?: CreditConstraints }).constraints;
        if (poolType && !creditSatisfiesPool(constraints, poolType, poolMaxPlayers)) continue;
        chosen = c;
        break;
      }
      if (!chosen) continue;

      // --- 3. Consume the credit + advance the bundle ---
      const creditsTotal = Number(bundle.creditsTotal) || 0;
      const creditsUsedAfter = (Number(bundle.creditsUsed) || 0) + 1;
      const nextStatus = statusAfterConsume(creditsTotal, creditsUsedAfter);

      txn.update(chosen.ref, { status: "used", usedByPoolId: poolId, usedAt: now });
      txn.update(bundleRef, { creditsUsed: creditsUsedAfter, status: nextStatus });

      // --- 4. Activate the pool via credit ---
      const maxPlayersAllowed =
        typeof poolMaxPlayers === "number" ? poolMaxPlayers : 10;
      txn.update(poolRef, {
        "billing.status": "active",
        "billing.paidVia": "credit",
        "billing.creditBundleId": bundleRef.id,
        "billing.creditId": chosen.id,
        "billing.maxPlayersAllowed": maxPlayersAllowed,
        "billing.pendingSessionId": admin.firestore.FieldValue.delete(),
      });

      return { bundleId: bundleRef.id, creditId: chosen.id, bundleStatus: nextStatus };
    }

    throw new HttpsError(
      "failed-precondition",
      "No available Pool Credit satisfies this pool (used/revoked/constraint-violating/expired)."
    );
  });
}

/** Callable wrapper: the authenticated user redeems a credit for their pool. */
export const redeemPoolCredit = validated(
  // Ownership + credit-eligibility checks live in redeemPoolCreditForPool's txn.
  { schema: redeemPoolCreditSchema, label: "redeemPoolCredit", appCheck: "monitor" },
  async (input, request) => {
    const res = await redeemPoolCreditForPool({
      ownerId: request.auth!.uid,
      poolId: input.poolId,
      preferBundleId: input.bundleId,
      preferCreditId: input.creditId,
    });
    return { success: true, ...res };
  },
);
