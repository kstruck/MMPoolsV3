"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lockPool = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
exports.lockPool = functions.https.onCall(async (data, context) => {
    // 0. Ensure Admin Init (Lazy)
    const db = admin.firestore();
    // 1. Auth Check - Must be logged in
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "User must be logged in to lock a pool.");
    }
    const { poolId } = data;
    if (!poolId) {
        throw new functions.https.HttpsError("invalid-argument", "Pool ID is required.");
    }
    const poolRef = db.collection("pools").doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Pool not found.");
    }
    const poolData = poolSnap.data();
    // 2. Permission Check - Must be Owner
    if (poolData.ownerId !== context.auth.uid) {
        // Optional: Allow global admins here if you had a super-admin role
        throw new functions.https.HttpsError("permission-denied", "Only the pool owner can lock the grid.");
    }
    // 3. Generate Random Digits (Secure Server-Side RNG)
    const generateDigits = () => {
        const nums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
        // Fisher-Yates Shuffle
        for (let i = nums.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [nums[i], nums[j]] = [nums[j], nums[i]];
        }
        return nums;
    };
    const axisNumbers = {
        home: generateDigits(),
        away: generateDigits(),
    };
    // 4. Update Pool
    await poolRef.update({
        isLocked: true,
        lockGrid: true, // Legacy support
        axisNumbers,
        updatedAt: admin.firestore.Timestamp.now(),
    });
    return { success: true, axisNumbers };
});
//# sourceMappingURL=poolParams.js.map