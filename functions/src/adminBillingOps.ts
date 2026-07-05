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
import { assertCallerRole } from "./adminClaims";
import { writeAdminAudit } from "./lib/adminAudit";

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
  await admin.firestore().doc(`settings/${docId}`).set(config);

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

/** Create / delete / toggle a coupon (coupons/{id}). */
export const adminManageCoupon = onCall(async (request) => {
  const caller = await assertCallerRole(request, "SUPER_ADMIN");
  const { op, couponId, data } = request.data as {
    op: "create" | "delete" | "toggle";
    couponId?: string;
    data?: Record<string, unknown>;
  };
  const coupons = admin.firestore().collection("coupons");

  let targetId = couponId;
  if (op === "create") {
    if (!data || typeof data !== "object" || typeof data.code !== "string" || !data.code.trim()) {
      throw new HttpsError("invalid-argument", "coupon data with a non-empty code is required.");
    }
    const ref = await coupons.add({ ...data, code: (data.code as string).trim().toUpperCase(), createdAt: FieldValue.serverTimestamp() });
    targetId = ref.id;
  } else if (op === "delete") {
    if (!couponId) throw new HttpsError("invalid-argument", "couponId is required.");
    await coupons.doc(couponId).delete();
  } else if (op === "toggle") {
    if (!couponId || typeof data?.isActive !== "boolean") {
      throw new HttpsError("invalid-argument", "couponId and isActive are required.");
    }
    await coupons.doc(couponId).update({ isActive: data.isActive });
  } else {
    throw new HttpsError("invalid-argument", "op must be create | delete | toggle.");
  }

  await writeAdminAudit({
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: `COUPON_${op.toUpperCase()}`,
    targetType: "coupon",
    targetId,
    metadata: { op, code: typeof data?.code === "string" ? data.code : undefined },
    status: "success",
  });
  return { success: true, couponId: targetId };
});

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

/** Manual adjustment of a user's referral credit balances (users/{id}). */
export const adminAdjustUserCredits = onCall(async (request) => {
  const caller = await assertCallerRole(request, "SUPER_ADMIN");
  const { targetUid, referralCredits, freePoolsAvailable } = request.data as {
    targetUid: string;
    referralCredits?: number;
    freePoolsAvailable?: number;
  };
  if (!targetUid) throw new HttpsError("invalid-argument", "targetUid is required.");
  const updates: Record<string, unknown> = {};
  if (typeof referralCredits === "number") updates.referralCredits = referralCredits;
  if (typeof freePoolsAvailable === "number") updates.freePoolsAvailable = freePoolsAvailable;
  if (Object.keys(updates).length === 0) {
    throw new HttpsError("invalid-argument", "at least one numeric credit field is required.");
  }
  await admin.firestore().doc(`users/${targetUid}`).set(updates, { merge: true });

  await writeAdminAudit({
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: "USER_CREDITS_ADJUSTED",
    targetType: "user",
    targetId: targetUid,
    metadata: { referralCredits, freePoolsAvailable },
    status: "success",
  });
  return { success: true };
});
