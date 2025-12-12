"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lockPool = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
exports.lockPool = (0, https_1.onCall)(async (request) => {
    // 0. Ensure Admin Init (Lazy)
    const db = admin.firestore();
    // 1. Auth Check - Must be logged in
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be logged in to lock a pool.");
    }
    const { poolId } = request.data;
    if (!poolId) {
        throw new https_1.HttpsError("invalid-argument", "Pool ID is required.");
    }
    const poolRef = db.collection("pools").doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        throw new https_1.HttpsError("not-found", "Pool not found.");
    }
    const poolData = poolSnap.data();
    // 2. Permission Check - Must be Owner
    if (poolData.ownerId !== request.auth.uid) {
        // Optional: Allow global admins here if you had a super-admin role
        throw new https_1.HttpsError("permission-denied", "Only the pool owner can lock the grid.");
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