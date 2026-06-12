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
exports.resolveReferralToken = exports.generateReferralToken = exports.creditReferralOnPayment = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
const db = admin.firestore();
// Triggered when a pool's billing status changes to 'active' (payment confirmed)
exports.creditReferralOnPayment = (0, firestore_1.onDocumentUpdated)('pools/{poolId}', async (event) => {
    var _a, _b, _c, _d, _e, _f, _g;
    const before = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
    const after = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
    if (!before || !after)
        return;
    // Only trigger when billing status changes TO 'active'
    if (((_e = before.billing) === null || _e === void 0 ? void 0 : _e.status) === ((_f = after.billing) === null || _f === void 0 ? void 0 : _f.status))
        return;
    if (((_g = after.billing) === null || _g === void 0 ? void 0 : _g.status) !== 'active')
        return;
    const ownerId = after.ownerId || after.createdByUid;
    if (!ownerId)
        return;
    // Check if this pool owner was referred by someone
    const referralsSnap = await db.collection('referrals')
        .where('referredUserId', '==', ownerId)
        .where('status', '==', 'pending')
        .limit(1)
        .get();
    if (referralsSnap.empty)
        return;
    const referralDoc = referralsSnap.docs[0];
    const referrerId = referralDoc.data().referrerId;
    // Load referral config
    const configSnap = await db.doc('settings/referral_config').get();
    const config = configSnap.data() || { creditsRequiredForFreePool: 5, discountPerCredit: 5 };
    // Run atomic transaction
    await db.runTransaction(async (tx) => {
        var _a;
        const referrerRef = db.doc(`users/${referrerId}`);
        const referrerSnap = await tx.get(referrerRef);
        if (!referrerSnap.exists)
            return;
        const currentCredits = (((_a = referrerSnap.data()) === null || _a === void 0 ? void 0 : _a.referralCredits) || 0) + 1;
        const updates = { referralCredits: currentCredits };
        // If they've hit the free pool threshold, award a free pool token
        if (currentCredits >= config.creditsRequiredForFreePool) {
            updates.freePoolsAvailable = admin.firestore.FieldValue.increment(1);
            updates.referralCredits = currentCredits - config.creditsRequiredForFreePool;
        }
        tx.update(referrerRef, updates);
        // Mark this referral as confirmed
        tx.update(referralDoc.ref, {
            status: 'confirmed',
            confirmedAt: Date.now(),
            creditAwarded: true
        });
    });
    console.log(`Referral credit awarded to ${referrerId} for referred user ${ownerId}`);
});
exports.generateReferralToken = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be logged in.');
    }
    const uid = request.auth.uid;
    const token = crypto.randomBytes(16).toString('hex');
    await db.collection('referralTokens').doc(token).set({
        uid,
        createdAt: Date.now()
    });
    return { token };
});
exports.resolveReferralToken = (0, https_1.onCall)(async (request) => {
    var _a;
    const { token } = request.data;
    if (!token) {
        throw new https_1.HttpsError('invalid-argument', 'Missing token.');
    }
    const tokenDoc = await db.collection('referralTokens').doc(token).get();
    if (!tokenDoc.exists) {
        throw new https_1.HttpsError('not-found', 'Invalid referral token.');
    }
    return { uid: (_a = tokenDoc.data()) === null || _a === void 0 ? void 0 : _a.uid };
});
//# sourceMappingURL=referral.js.map