
import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { Pool, PoolBilling, Coupon, BillingConfig } from "./types";
import { HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { renderEmailHtml, BASE_URL } from "./emailStyles";

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

export function checkBillingAccess(
    billing: PoolBilling | undefined,
    feature?: string
): { allowed: boolean; reason?: string } {
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
}

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
    const result = checkBillingAccess(pool.billing, feature);

    if (!result.allowed) {
        // validateBillingAccess is traditionally expected to return { allowed: false, reason } rather than throw
        return result;
    }

    return { allowed: true };
});

// =============================================================================
// 3. redeemCoupon — Callable Function
//    Atomically validates and redeems a coupon code within a Firestore transaction
// =============================================================================

export const redeemCoupon = functions.https.onCall({ cors: true }, async (request) => {
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

    if (pool.ownerId !== userId) {
        throw new HttpsError("permission-denied", "You must be the pool owner to redeem a coupon.");
    }

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

// =============================================================================
// 4. onPoolParticipantChange — Firestore Trigger
//    Sends alerts to pool managers when they hit 8 or 10 entries on the Free Plan
// =============================================================================

export const onPoolParticipantChange = onDocumentWritten("pools/{poolId}", async (event) => {
    const after = event.data?.after.data();
    if (!after) return; // Deleted

    const poolId = event.params.poolId;
    const db = admin.firestore();

    const billingStatus = after.billing?.status ?? 'free';
    if (billingStatus !== 'free') return; // Only notify for Free Plan pools

    // Count participants based on pool type
    let count = 0;
    if (after.type === 'NFL_PLAYOFFS' || after.type === 'playoff') {
        count = Object.keys(after.entries || {}).length;
    } else if (after.type === 'NFL_PICKEM' || after.type === 'NFL_SURVIVOR' || after.type === 'NFL_MARGIN') {
        count = (after.participantIds || []).length;
    } else {
        count = after.entryCount || 0;
    }

    const notified8 = after.billing?.notified8 === true;
    const notified10 = after.billing?.notified10 === true;

    // Check if we should notify
    const shouldNotify8 = count >= 8 && !notified8;
    const shouldNotify10 = count >= 10 && !notified10;

    if (!shouldNotify8 && !shouldNotify10) return;

    // Find manager's email
    let managerEmail = after.contactEmail;
    if (!managerEmail && (after.ownerId || after.createdByUid || after.managerUid)) {
        const managerUid = after.ownerId || after.createdByUid || after.managerUid;
        const userDoc = await db.collection("users").doc(managerUid).get();
        if (userDoc.exists) {
            managerEmail = userDoc.data()?.email;
        }
    }

    if (!managerEmail) {
        console.warn(`[onPoolParticipantChange] Manager email not found for pool ${poolId}`);
        return;
    }

    const updates: any = {};

    if (shouldNotify10) {
        // Send 10 players lock email
        const subject = `🚫 Locked: Your pool "${after.name}" has reached the Free Plan limit!`;
        const body = `
            <p>Hi there,</p>
            <p>Your pool <strong>${after.name}</strong> has reached the maximum limit of <strong>10 participants</strong> allowed on the Free Plan.</p>
            
            <div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 12px; padding: 16px; margin: 20px 0; color: #991b1b; font-family: sans-serif;">
                <p style="margin: 0; font-weight: bold; font-size: 16px;">Participant Entries Locked 🚫</p>
                <p style="margin: 4px 0 0 0; font-size: 13px;">New participants are currently blocked from joining your pool until you upgrade to a premium plan.</p>
            </div>

            <p>To accept more players and unlock your pool instantly, please upgrade to a Premium plan.</p>
        `;
        const html = renderEmailHtml('Pool Entries Locked!', body, `${BASE_URL}/pricing`, 'Upgrade to Premium');
        
        await db.collection('mail').add({
            to: managerEmail,
            message: { subject, html }
        });

        updates["billing.notified10"] = true;
        updates["billing.notified8"] = true; // Mark 8 as true too
        console.log(`[onPoolParticipantChange] Limit reached (10/10) email queued for pool ${poolId} to manager ${managerEmail}`);
    } else if (shouldNotify8) {
        // Send 8 players approaching warning email
        const subject = `⚠️ Action Required: Your pool "${after.name}" is approaching the Free Plan limit!`;
        const body = `
            <p>Hi there,</p>
            <p>Your pool <strong>${after.name}</strong> currently has <strong>${count} participants</strong>, approaching the maximum limit of <strong>10 participants</strong> allowed on the Free Plan.</p>
            
            <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 12px; padding: 16px; margin: 20px 0; color: #92400e; font-family: sans-serif;">
                <p style="margin: 0; font-weight: bold; font-size: 16px;">Approaching Limit: ${count}/10 Players ⚠️</p>
                <p style="margin: 4px 0 0 0; font-size: 13px;">Once your pool reaches 10 players, any new participants attempting to join will be blocked.</p>
            </div>

            <p>Upgrade to a Premium plan now to ensure your participants have a seamless, uninterrupted onboarding experience!</p>
        `;
        const html = renderEmailHtml('Approaching Free Limit!', body, `${BASE_URL}/pricing`, 'Upgrade to Premium');
        
        await db.collection('mail').add({
            to: managerEmail,
            message: { subject, html }
        });

        updates["billing.notified8"] = true;
        console.log(`[onPoolParticipantChange] Approaching limit (8/10) email queued for pool ${poolId} to manager ${managerEmail}`);
    }

    if (Object.keys(updates).length > 0) {
        await db.collection("pools").doc(poolId).update(updates);
    }
});
