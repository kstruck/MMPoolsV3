"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onPoolParticipantChange = exports.redeemCoupon = exports.validateBillingAccess = exports.enforceBillingStatus = void 0;
exports.checkBillingAccess = checkBillingAccess;
const functions = __importStar(require("firebase-functions/v2"));
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const emailStyles_1 = require("./emailStyles");
const db = admin.firestore();
// =============================================================================
// 1. enforceBillingStatus — Daily Scheduled Job
//    Transitions expired trials → grace_period, expired grace → locked
// =============================================================================
exports.enforceBillingStatus = functions.scheduler.onSchedule("every day 03:00", async () => {
    var _a;
    const now = Date.now();
    console.log(`[BillingEnforce] Starting billing enforcement at ${new Date(now).toISOString()}`);
    // --- Fetch global billing config for grace period duration ---
    const configDoc = await db.collection("config").doc("billing_config").get();
    const billingConfig = configDoc.data();
    const gracePeriodDays = (_a = billingConfig === null || billingConfig === void 0 ? void 0 : billingConfig.gracePeriodDays) !== null && _a !== void 0 ? _a : 7;
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
                "billing.status": "grace_period",
                "billing.gracePeriodEndsAt": now + gracePeriodMs,
            });
            trialToGraceCount++;
            console.log(`[BillingEnforce] Pool ${doc.id}: trial → grace_period (ends ${new Date(now + gracePeriodMs).toISOString()})`);
        }
        catch (err) {
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
                "billing.status": "locked",
            });
            graceToLockedCount++;
            console.log(`[BillingEnforce] Pool ${doc.id}: grace_period → locked`);
        }
        catch (err) {
            console.error(`[BillingEnforce] Error transitioning pool ${doc.id} to locked:`, err);
        }
    }
    console.log(`[BillingEnforce] Complete. Transitions: ${trialToGraceCount} trial→grace, ${graceToLockedCount} grace→locked`);
});
// =============================================================================
// 2. validateBillingAccess — Callable Function
//    Checks if a pool is accessible and optionally if a premium feature is unlocked
// =============================================================================
function checkBillingAccess(billing, feature) {
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
        const featureKey = feature;
        if (billing.featuresUnlocked && featureKey in billing.featuresUnlocked) {
            if (!billing.featuresUnlocked[featureKey]) {
                return { allowed: false, reason: "Feature requires premium upgrade." };
            }
        }
    }
    return { allowed: true };
}
exports.validateBillingAccess = functions.https.onCall(async (request) => {
    const { poolId, feature } = request.data;
    if (!poolId) {
        throw new https_1.HttpsError("invalid-argument", "poolId is required.");
    }
    const poolDoc = await db.collection("pools").doc(poolId).get();
    if (!poolDoc.exists) {
        throw new https_1.HttpsError("not-found", "Pool not found.");
    }
    const pool = poolDoc.data();
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
exports.redeemCoupon = functions.https.onCall({ cors: true }, async (request) => {
    // --- Auth Check ---
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in to redeem a coupon.");
    }
    const userId = request.auth.uid;
    const { couponCode, poolId } = request.data;
    if (!couponCode || !poolId) {
        throw new https_1.HttpsError("invalid-argument", "couponCode and poolId are required.");
    }
    // --- Fetch the pool to validate pool type ---
    const poolDoc = await db.collection("pools").doc(poolId).get();
    if (!poolDoc.exists) {
        throw new https_1.HttpsError("not-found", "Pool not found.");
    }
    const pool = poolDoc.data();
    if (pool.ownerId !== userId) {
        throw new https_1.HttpsError("permission-denied", "You must be the pool owner to redeem a coupon.");
    }
    // --- Transaction: Validate & Redeem ---
    const result = await db.runTransaction(async (transaction) => {
        // Find coupon by code
        const couponQuery = await transaction.get(db.collection("coupons").where("code", "==", couponCode).limit(1));
        if (couponQuery.empty) {
            throw new https_1.HttpsError("not-found", "Coupon code not found.");
        }
        const couponDoc = couponQuery.docs[0];
        const coupon = Object.assign({ id: couponDoc.id }, couponDoc.data());
        const now = Date.now();
        // --- Validation Checks ---
        // 1. Active?
        if (!coupon.isActive) {
            throw new https_1.HttpsError("failed-precondition", "This coupon is no longer active.");
        }
        // 2. Expired?
        if (coupon.expiresAt && coupon.expiresAt < now) {
            throw new https_1.HttpsError("failed-precondition", "This coupon has expired.");
        }
        // 3. Max uses?
        if (coupon.maxUses !== undefined && coupon.usesCount >= coupon.maxUses) {
            throw new https_1.HttpsError("resource-exhausted", "This coupon has reached its maximum number of uses.");
        }
        // 4. Per-user limit?
        if (coupon.perUserLimit !== undefined && coupon.usageLog) {
            const userUsageCount = coupon.usageLog.filter(entry => entry.userId === userId).length;
            if (userUsageCount >= coupon.perUserLimit) {
                throw new https_1.HttpsError("resource-exhausted", "You have already used this coupon the maximum number of times.");
            }
        }
        // 5. Allowed pool types?
        if (coupon.allowedPoolTypes && coupon.allowedPoolTypes.length > 0) {
            const poolType = pool.type;
            if (!coupon.allowedPoolTypes.includes(poolType)) {
                throw new https_1.HttpsError("failed-precondition", `This coupon is not valid for ${poolType} pools.`);
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
exports.onPoolParticipantChange = (0, firestore_1.onDocumentWritten)("pools/{poolId}", async (event) => {
    var _a, _b, _c, _d, _e, _f;
    const after = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after.data();
    if (!after)
        return; // Deleted
    const poolId = event.params.poolId;
    const db = admin.firestore();
    const billingStatus = (_c = (_b = after.billing) === null || _b === void 0 ? void 0 : _b.status) !== null && _c !== void 0 ? _c : 'free';
    if (billingStatus !== 'free')
        return; // Only notify for Free Plan pools
    // Count participants based on pool type
    let count = 0;
    if (after.type === 'NFL_PLAYOFFS' || after.type === 'playoff') {
        count = Object.keys(after.entries || {}).length;
    }
    else if (after.type === 'NFL_PICKEM' || after.type === 'NFL_SURVIVOR' || after.type === 'NFL_MARGIN') {
        count = (after.participantIds || []).length;
    }
    else {
        count = after.entryCount || 0;
    }
    const notified8 = ((_d = after.billing) === null || _d === void 0 ? void 0 : _d.notified8) === true;
    const notified10 = ((_e = after.billing) === null || _e === void 0 ? void 0 : _e.notified10) === true;
    // Check if we should notify
    const shouldNotify8 = count >= 8 && !notified8;
    const shouldNotify10 = count >= 10 && !notified10;
    if (!shouldNotify8 && !shouldNotify10)
        return;
    // Find manager's email
    let managerEmail = after.contactEmail;
    if (!managerEmail && (after.ownerId || after.createdByUid || after.managerUid)) {
        const managerUid = after.ownerId || after.createdByUid || after.managerUid;
        const userDoc = await db.collection("users").doc(managerUid).get();
        if (userDoc.exists) {
            managerEmail = (_f = userDoc.data()) === null || _f === void 0 ? void 0 : _f.email;
        }
    }
    if (!managerEmail) {
        console.warn(`[onPoolParticipantChange] Manager email not found for pool ${poolId}`);
        return;
    }
    const updates = {};
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
        const html = (0, emailStyles_1.renderEmailHtml)('Pool Entries Locked!', body, `${emailStyles_1.BASE_URL}/pricing`, 'Upgrade to Premium');
        await db.collection('mail').add({
            to: managerEmail,
            message: { subject, html }
        });
        updates["billing.notified10"] = true;
        updates["billing.notified8"] = true; // Mark 8 as true too
        console.log(`[onPoolParticipantChange] Limit reached (10/10) email queued for pool ${poolId} to manager ${managerEmail}`);
    }
    else if (shouldNotify8) {
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
        const html = (0, emailStyles_1.renderEmailHtml)('Approaching Free Limit!', body, `${emailStyles_1.BASE_URL}/pricing`, 'Upgrade to Premium');
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
//# sourceMappingURL=billing.js.map