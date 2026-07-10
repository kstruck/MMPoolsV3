/**
 * Audited billing/monetization admin callables (step 2 — kill direct client
 * admin writes). Each is SUPER_ADMIN-only (claim+doc agreement via
 * assertCallerRole) and records an admin_audit entry. The client (Super-Admin
 * Billing panel) calls these instead of writing Firestore directly, so every
 * money-adjacent mutation is server-validated and forensically logged.
 *
 * Rules lockdown pairs with this: coupons and settings/{billing_config,
 * referral_config} become server-only (Admin SDK bypasses rules). Pool-billing
 * and user-credit docs keep their existing owner/super-admin rules (they share
 * writers that can't be forbidden), but the UI path is audited here.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { validated } from "./lib/validated";
import { adminManageCouponSchema } from "./schemas/adminManageCoupon";
import { assertCallerRole } from "./adminClaims";
import { writeAdminAudit } from "./lib/adminAudit";
import { BillingConfigSchema } from "./shared/schemas/billingConfig";
import { grantEntitlementTxn } from "./entitlements";
import { MAX_CREDITS_PER_BUNDLE, type ProductSnapshot } from "./shared/schemas/bundle";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Save the billing or referral config doc (settings/billing_config|referral_config). */
export const adminSaveBillingConfig = onCall(async (request) => {
  const caller = await assertCallerRole(request, "SUPER_ADMIN");
  const { kind, config } = request.data as { kind: "billing" | "referral"; config: Record<string, unknown> };
  if (kind !== "billing" && kind !== "referral") {
    throw new HttpsError("invalid-argument", "kind must be 'billing' or 'referral'.");
  }
  if (!config || typeof config !== "object") {
    throw new HttpsError("invalid-argument", "config object is required.");
  }
  const docId = kind === "billing" ? "billing_config" : "referral_config";

  // billing_config is fully modeled by the shared contract — gate the write and
  // persist the PARSED doc (defaults materialized, unknown keys stripped) so
  // client readers that cast `data() as BillingConfig` see the canonical shape.
  // referral_config keeps the existing unvalidated passthrough.
  let toPersist: Record<string, unknown> = config;
  if (kind === "billing") {
    const parsed = BillingConfigSchema.safeParse(config);
    if (!parsed.success) {
      const summary = parsed.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new HttpsError("invalid-argument", `billing config failed validation: ${summary}`);
    }
    toPersist = parsed.data;
  }
  await admin.firestore().doc(`settings/${docId}`).set(toPersist);

  await writeAdminAudit({
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: "BILLING_CONFIG_SAVED",
    targetType: "config",
    targetId: docId,
    metadata: { kind },
    status: "success",
  });
  return { success: true };
});

/** Create / delete / toggle a coupon (coupons/{id}). Schema: ./schemas/adminManageCoupon. */
export const adminManageCoupon = validated(
  { schema: adminManageCouponSchema, label: "adminManageCoupon", role: "SUPER_ADMIN", appCheck: "monitor" },
  async (input, request) => {
    // auth + SUPER_ADMIN (claim AND doc) already enforced by the wrapper.
    const caller = { uid: request.auth!.uid, email: request.auth!.token.email as string | undefined };
    const coupons = admin.firestore().collection("coupons");

    let targetId: string;
    let code: string | undefined;

    if (input.op === "create") {
      const body = input.data;
      const ref = await coupons.add({
        ...body,
        code: body.code.toUpperCase(),
        createdAt: FieldValue.serverTimestamp(),
      });
      targetId = ref.id;
      code = body.code;
    } else if (input.op === "delete") {
      targetId = input.couponId;
      await coupons.doc(targetId).delete();
    } else {
      targetId = input.couponId;
      await coupons.doc(targetId).update({ isActive: input.data.isActive });
    }

    await writeAdminAudit({
      actorUid: caller.uid,
      actorEmail: caller.email,
      action: `COUPON_${input.op.toUpperCase()}`,
      targetType: "coupon",
      targetId,
      metadata: { op: input.op, code },
      status: "success",
    });
    return { success: true, couponId: targetId };
  },
);

/** Pool billing override / extend-trial / reset-grace (pools/{id}.billing). */
export const adminUpdatePoolBilling = onCall(async (request) => {
  const caller = await assertCallerRole(request, "SUPER_ADMIN");
  const { poolId, action, data } = request.data as {
    poolId: string;
    action: "override" | "extendTrial" | "resetGrace";
    data?: Record<string, unknown>;
  };
  if (!poolId) throw new HttpsError("invalid-argument", "poolId is required.");
  const poolRef = admin.firestore().doc(`pools/${poolId}`);
  const now = Date.now();

  if (action === "override") {
    if (!data || typeof data !== "object") throw new HttpsError("invalid-argument", "billing override data is required.");
    await poolRef.set({ billing: data, updatedAt: now }, { merge: true });
  } else if (action === "extendTrial") {
    const snap = await poolRef.get();
    const currentEnd = (snap.data()?.billing?.trialEndsAt as number) || now;
    await poolRef.update({ "billing.status": "trial", "billing.trialEndsAt": currentEnd + 14 * DAY_MS, updatedAt: now });
  } else if (action === "resetGrace") {
    const graceDays = typeof data?.gracePeriodDays === "number" ? data.gracePeriodDays : 7;
    await poolRef.update({ "billing.status": "grace_period", "billing.gracePeriodEndsAt": now + graceDays * DAY_MS, updatedAt: now });
  } else {
    throw new HttpsError("invalid-argument", "action must be override | extendTrial | resetGrace.");
  }

  await writeAdminAudit({
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: `POOL_BILLING_${action.toUpperCase()}`,
    targetType: "pool",
    targetId: poolId,
    metadata: { action },
    status: "success",
  });
  return { success: true };
});

/**
 * Adjust a user's credit balances (users/{id}).
 *
 * @deprecated for the pool-credit path — prefer `adminGrantEntitlement`
 * (entitlements.ts) which grants an auditable, revocable bundle. This callable
 * is kept for export/back-compat, but it NO LONGER pokes the legacy
 * `users.freePoolsAvailable` int: a positive `freePoolsAvailable` is interpreted
 * as "grant this many Pool Credits" and routed into an ADMIN_GRANT CREDIT_BUNDLE
 * via the canonical model. `referralCredits` remains a raw referral-tally poke
 * (that counter is separate from entitlements).
 */
export const adminAdjustUserCredits = onCall(async (request) => {
  const caller = await assertCallerRole(request, "SUPER_ADMIN");
  const { targetUid, referralCredits, freePoolsAvailable } = request.data as {
    targetUid: string;
    referralCredits?: number;
    freePoolsAvailable?: number;
  };
  if (!targetUid) throw new HttpsError("invalid-argument", "targetUid is required.");

  const wantsReferral = typeof referralCredits === "number";
  const creditsToGrant = typeof freePoolsAvailable === "number" ? Math.floor(freePoolsAvailable) : undefined;
  if (!wantsReferral && creditsToGrant === undefined) {
    throw new HttpsError("invalid-argument", "at least one numeric credit field is required.");
  }
  if (creditsToGrant !== undefined && creditsToGrant > MAX_CREDITS_PER_BUNDLE) {
    throw new HttpsError(
      "invalid-argument",
      `freePoolsAvailable ${creditsToGrant} exceeds the ${MAX_CREDITS_PER_BUNDLE}-credit cap; split into multiple grants.`
    );
  }

  let grantedBundleId: string | null = null;
  await admin.firestore().runTransaction(async (txn) => {
    const userRef = admin.firestore().doc(`users/${targetUid}`);
    // Raw referral-tally poke stays as-is (distinct from entitlements).
    if (wantsReferral) {
      txn.set(userRef, { referralCredits }, { merge: true });
    }
    // Positive pool-credit request → ADMIN_GRANT CREDIT_BUNDLE (canonical model).
    if (creditsToGrant !== undefined && creditsToGrant > 0) {
      const snapshot: ProductSnapshot = {
        name: "Admin Credit Grant",
        price: 0,
        poolType: "ALL",
        maxPlayersPerPool: 9999,
      };
      const res = grantEntitlementTxn(txn, {
        ownerId: targetUid,
        productKind: "CREDIT_BUNDLE",
        source: "ADMIN_GRANT",
        productSnapshot: snapshot,
        creditsTotal: creditsToGrant,
      });
      grantedBundleId = res.bundleId;
      txn.set(userRef, { role: "COMMISSIONER" }, { merge: true });
    }
  });

  await writeAdminAudit({
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: "USER_CREDITS_ADJUSTED",
    targetType: "user",
    targetId: targetUid,
    metadata: { referralCredits, freePoolsAvailable, grantedBundleId },
    status: "success",
  });
  return { success: true, grantedBundleId };
});
