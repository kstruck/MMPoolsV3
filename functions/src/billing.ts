
import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { Pool, PoolBilling, Coupon, BillingConfig } from "./types";
import { HttpsError } from "firebase-functions/v2/https";

const db = admin.firestore();

// =============================================================================
// 1. enforceBillingStatus — Daily Scheduled Job
//    Transitions expired trials → grace_period, expired grace → locked
// =============================================================================

export const enforceBillingStatus = functions.scheduler.onSchedule("every day 03:00", async () => {
    const now = Date.now();
    console.log(`[BillingEnforce] Starting billing enforcement at ${new Date(now).toISOString()}`);

    // --- Fetch global billing config for grace period duration ---
    const configDoc = await db.collection("config").doc("billing_config").get();
    const billingConfig = configDoc.data() as BillingConfig | undefined;
    const gracePeriodDays = billingConfig?.gracePeriodDays ?? 7;
    const gracePeriodMs = gracePeriodDays * 24 * 60 * 60 * 1000;

    let trialToGraceCount = 0;
    let graceToLockedCount = 0;

    // --- Phase 1: Trial → Grace Period ---
    const expiredTrials = await db.collection("pools")
        .where("billing.status", "==", "trial")
        .where("billing.trialEndsAt", "<", now)
        .get();

    for (const doc of expiredTrials.docs) {
        try {
            const poolRef = db.collection("pools").doc(doc.id);
            await poolRef.update({
                "billing.status": "grace_period" as PoolBilling["status"],
                "billing.gracePeriodEndsAt": now + gracePeriodMs,
            });
            trialToGraceCount++;
            console.log(`[BillingEnforce] Pool ${doc.id}: trial → grace_period (ends ${new Date(now + gracePeriodMs).toISOString()})`);
        } catch (err) {
            console.error(`[BillingEnforce] Error transitioning pool ${doc.id} to grace_period:`, err);
        }
    }

    // --- Phase 2: Grace Period → Locked ---
    const expiredGrace = await db.collection("pools")
        .where("billing.status", "==", "grace_period")
        .where("billing.gracePeriodEndsAt", "<", now)
        .get();

    for (const doc of expiredGrace.docs) {
        try {
            const poolRef = db.collection("pools").doc(doc.id);
            await poolRef.update({
                "billing.status": "locked" as PoolBilling["status"],
            });
            graceToLockedCount++;
            console.log(`[BillingEnforce] Pool ${doc.id}: grace_period → locked`);
        } catch (err) {
            console.error(`[BillingEnforce] Error transitioning pool ${doc.id} to locked:`, err);
        }
    }

    console.log(`[BillingEnforce] Complete. Transitions: ${trialToGraceCount} trial→grace, ${graceToLockedCount} grace→locked`);
});

// =============================================================================
// 2. validateBillingAccess — Callable Function
//    Checks if a pool is accessible and optionally if a premium feature is unlocked
// =============================================================================

export const validateBillingAccess = functions.https.onCall(async (request) => {
    const { poolId, feature } = request.data as { poolId: string; feature?: string };

    if (!poolId) {
        throw new HttpsError("invalid-argument", "poolId is required.");
    }

    const poolDoc = await db.collection("pools").doc(poolId).get();
    if (!poolDoc.exists) {
        throw new HttpsError("not-found", "Pool not found.");
    }

    const pool = poolDoc.data() as Pool;
    const billing = pool.billing;

    // No billing record = free pool, always allowed
    if (!billing) {
        return { allowed: true };
    }

    // Locked pool requires payment
    if (billing.status === "locked") {
        return { allowed: false, reason: "Pool is locked. Payment required." };
    }

    // Check specific feature access
    if (feature) {
        const featureKey = feature as keyof PoolBilling["featuresUnlocked"];
        if (billing.featuresUnlocked && featureKey in billing.featuresUnlocked) {
            if (!billing.featuresUnlocked[featureKey]) {
                return { allowed: false, reason: "Feature requires premium upgrade." };
            }
        }
    }

    return { allowed: true };
});

// =============================================================================
// 3. redeemCoupon — Callable Function
//    Atomically validates and redeems a coupon code within a Firestore transaction
// =============================================================================

export const redeemCoupon = functions.https.onCall(async (request) => {
    // --- Auth Check ---
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "You must be signed in to redeem a coupon.");
    }

    const userId = request.auth.uid;
    const { couponCode, poolId } = request.data as { couponCode: string; poolId: string };

    if (!couponCode || !poolId) {
        throw new HttpsError("invalid-argument", "couponCode and poolId are required.");
    }

    // --- Fetch the pool to validate pool type ---
    const poolDoc = await db.collection("pools").doc(poolId).get();
    if (!poolDoc.exists) {
        throw new HttpsError("not-found", "Pool not found.");
    }
    const pool = poolDoc.data() as Pool;

    // --- Transaction: Validate & Redeem ---
    const result = await db.runTransaction(async (transaction) => {
        // Find coupon by code
        const couponQuery = await transaction.get(
            db.collection("coupons").where("code", "==", couponCode).limit(1)
        );

        if (couponQuery.empty) {
            throw new HttpsError("not-found", "Coupon code not found.");
        }

        const couponDoc = couponQuery.docs[0];
        const coupon = { id: couponDoc.id, ...couponDoc.data() } as Coupon;
        const now = Date.now();

        // --- Validation Checks ---

        // 1. Active?
        if (!coupon.isActive) {
            throw new HttpsError("failed-precondition", "This coupon is no longer active.");
        }

        // 2. Expired?
        if (coupon.expiresAt && coupon.expiresAt < now) {
            throw new HttpsError("failed-precondition", "This coupon has expired.");
        }

        // 3. Max uses?
        if (coupon.maxUses !== undefined && coupon.usesCount >= coupon.maxUses) {
            throw new HttpsError("resource-exhausted", "This coupon has reached its maximum number of uses.");
        }

        // 4. Per-user limit?
        if (coupon.perUserLimit !== undefined && coupon.usageLog) {
            const userUsageCount = coupon.usageLog.filter(entry => entry.userId === userId).length;
            if (userUsageCount >= coupon.perUserLimit) {
                throw new HttpsError("resource-exhausted", "You have already used this coupon the maximum number of times.");
            }
        }

        // 5. Allowed pool types?
        if (coupon.allowedPoolTypes && coupon.allowedPoolTypes.length > 0) {
            const poolType = pool.type;
            if (!coupon.allowedPoolTypes.includes(poolType as typeof coupon.allowedPoolTypes[number])) {
                throw new HttpsError("failed-precondition", `This coupon is not valid for ${poolType} pools.`);
            }
        }

        // --- Apply Redemption ---
        const usageEntry = { userId, poolId, usedAt: now };

        transaction.update(couponDoc.ref, {
            usesCount: admin.firestore.FieldValue.increment(1),
            usageLog: admin.firestore.FieldValue.arrayUnion(usageEntry),
        });

        return {
            valid: true,
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
        };
    });

    return result;
});
