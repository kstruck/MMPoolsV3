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

import { HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { validated } from "./lib/validated";
import { adminManageCouponSchema } from "./schemas/adminManageCoupon";
import {
  adminSaveBillingConfigSchema,
  adminUpdatePoolBillingSchema,
  adminSetPoolFeatureSchema,
  adminAdjustUserCreditsSchema,
} from "./schemas/adminBillingOps";
import { writeAdminAudit } from "./lib/adminAudit";
import { grantEntitlementTxn } from "./entitlements";
import { MAX_CREDITS_PER_BUNDLE, type ProductSnapshot } from "./shared/schemas/bundle";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Save the billing or referral config doc (settings/billing_config|referral_config). */
export const adminSaveBillingConfig = validated(
  { schema: adminSaveBillingConfigSchema, label: "adminSaveBillingConfig", role: "SUPER_ADMIN", appCheck: "monitor" },
  async (input, request) => {
    // auth + SUPER_ADMIN (claim AND doc) already enforced by the wrapper.
    const caller = { uid: request.auth!.uid, email: request.auth!.token.email as string | undefined };
    const docId = input.kind === "billing" ? "billing_config" : "referral_config";

    // For kind:"billing", input.config is the canonical BillingConfig already
    // parsed by the schema (defaults materialized, unknown keys stripped) so
    // client readers that cast `data() as BillingConfig` see the canonical shape.
    // For kind:"referral", input.config is the unmodeled passthrough object.
    await admin.firestore().doc(`settings/${docId}`).set(input.config);

    await writeAdminAudit({
      actorUid: caller.uid,
      actorEmail: caller.email,
      action: "BILLING_CONFIG_SAVED",
      targetType: "config",
      targetId: docId,
      metadata: { kind: input.kind },
      status: "success",
    });
    return { success: true };
  },
);

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
export const adminUpdatePoolBilling = validated(
  { schema: adminUpdatePoolBillingSchema, label: "adminUpdatePoolBilling", role: "SUPER_ADMIN", appCheck: "monitor" },
  async (input, request) => {
    const caller = { uid: request.auth!.uid, email: request.auth!.token.email as string | undefined };
    const poolRef = admin.firestore().doc(`pools/${input.poolId}`);
    const now = Date.now();

    if (input.action === "override") {
      await poolRef.set({ billing: input.data, updatedAt: now }, { merge: true });
    } else if (input.action === "extendTrial") {
      const snap = await poolRef.get();
      const currentEnd = (snap.data()?.billing?.trialEndsAt as number) || now;
      await poolRef.update({ "billing.status": "trial", "billing.trialEndsAt": currentEnd + 14 * DAY_MS, updatedAt: now });
    } else {
      // resetGrace
      const graceDays = typeof input.data?.gracePeriodDays === "number" ? input.data.gracePeriodDays : 7;
      await poolRef.update({ "billing.status": "grace_period", "billing.gracePeriodEndsAt": now + graceDays * DAY_MS, updatedAt: now });
    }

    await writeAdminAudit({
      actorUid: caller.uid,
      actorEmail: caller.email,
      action: `POOL_BILLING_${input.action.toUpperCase()}`,
      targetType: "pool",
      targetId: input.poolId,
      metadata: { action: input.action },
      status: "success",
    });
    return { success: true };
  },
);

/**
 * Turn ONE premium feature on or off for ONE pool, with an audit row that says
 * which (Kevin, 2026-08-23).
 *
 * ⚠️ IT WRITES `billing.paid.addons` TOO, NOT ONLY `featuresUnlocked`, and the
 * two have different jobs:
 *   - `featuresUnlocked.<key>` is the ENTITLEMENT every gate reads.
 *   - `paid.addons` is the PAID CEILING `assertPaidCeilingForUpdate` compares
 *     against, and the array a later purchase merges into.
 * Granting only the first would leave a pool holding a feature its own paid
 * ceiling says it never bought — so the next settings save that touches an
 * add-on would be refused, and a later add-on purchase would re-stamp
 * `paid.addons` without it. Revoking clears both for the same reason.
 *
 * ⚠️ IT DOES NOT TOUCH `billing.status`, `tier`, `pricePaid` or the ledger. A
 * grant is not a sale: no money moved, so nothing may claim it did. Use
 * `adminUpdatePoolBilling` for lifecycle changes.
 */
export const adminSetPoolFeature = validated(
  { schema: adminSetPoolFeatureSchema, label: "adminSetPoolFeature", role: "SUPER_ADMIN", appCheck: "monitor" },
  async (input, request) => {
    const caller = { uid: request.auth!.uid, email: request.auth!.token.email as string | undefined };
    const { poolId, feature, enabled } = input;
    const poolRef = admin.firestore().doc(`pools/${poolId}`);

    // Transactional: `paid.addons` is read-modify-write, and two admins toggling
    // two different features on the same pool would otherwise clobber each other.
    const outcome = await admin.firestore().runTransaction(async (txn) => {
      const snap = await txn.get(poolRef);
      if (!snap.exists) throw new HttpsError("not-found", "Pool not found.");
      type PoolBillingShape = {
        featuresUnlocked?: Record<string, boolean>;
        paid?: { addons?: string[] };
      };
      const billing: PoolBillingShape = (snap.data() as { billing?: PoolBillingShape } | undefined)?.billing ?? {};
      const before = billing?.featuresUnlocked?.[feature] === true;

      const addons: string[] = Array.isArray(billing.paid?.addons) ? [...billing.paid!.addons!] : [];
      const nextAddons = enabled
        ? (addons.includes(feature) ? addons : [...addons, feature])
        : addons.filter((k) => k !== feature);

      const patch: Record<string, unknown> = {
        [`billing.featuresUnlocked.${feature}`]: enabled,
        updatedAt: Date.now(),
      };
      // Only touch the paid ceiling when there IS one. Writing `billing.paid` on
      // a free or trial pool would invent a purchase record and switch on the
      // ceiling gate for a pool that has none (`assertPaidCeilingForUpdate`
      // returns early when `paid` is absent).
      if (billing?.paid) patch["billing.paid.addons"] = nextAddons;

      // `update`, NOT `set({merge:true})`: these are DOTTED FIELD PATHS, and
      // `set` would create literal top-level keys named "billing.paid.addons".
      txn.update(poolRef, patch);
      return { before, hadPaid: !!billing?.paid };
    });

    await writeAdminAudit({
      actorUid: caller.uid,
      actorEmail: caller.email,
      action: enabled ? "POOL_FEATURE_GRANT" : "POOL_FEATURE_REVOKE",
      targetType: "pool",
      targetId: poolId,
      metadata: { feature, enabled, previous: outcome.before, paidCeilingUpdated: outcome.hadPaid },
      status: "success",
    });
    return { success: true };
  },
);

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
export const adminAdjustUserCredits = validated(
  { schema: adminAdjustUserCreditsSchema, label: "adminAdjustUserCredits", role: "SUPER_ADMIN", appCheck: "monitor" },
  async (input, request) => {
    const caller = { uid: request.auth!.uid, email: request.auth!.token.email as string | undefined };
    const { targetUid, referralCredits, freePoolsAvailable } = input;

    const wantsReferral = typeof referralCredits === "number";
    const creditsToGrant = typeof freePoolsAvailable === "number" ? Math.floor(freePoolsAvailable) : undefined;
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
  },
);
