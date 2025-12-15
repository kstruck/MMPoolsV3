"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recalculateGlobalStats = exports.onPoolLocked = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
// Helper to calculate total pot for a pool
const calculatePoolPot = (pool) => {
    let squaresSold = 0;
    if (pool.squares && Array.isArray(pool.squares)) {
        squaresSold = pool.squares.filter((s) => s.owner).length;
    }
    // Pot is squares * cost
    const totalPot = squaresSold * (pool.costPerSquare || 0);
    // Calculate total payout percentage (usually 1st Q + 2nd Q + 3rd Q + Final)
    // If charity is involved, payouts usually sum to < 100%. 
    // The prize amount is Total Pot * Total Payout %.
    let totalPayoutPct = 0;
    if (pool.payouts) {
        totalPayoutPct = (pool.payouts.q1 || 0) + (pool.payouts.half || 0) + (pool.payouts.q3 || 0) + (pool.payouts.final || 0);
    }
    return totalPot * (totalPayoutPct / 100);
};
// Trigger: When a pool is LOCKED, add its pot to the global "Total Prizes"
exports.onPoolLocked = (0, firestore_1.onDocumentUpdated)("pools/{poolId}", async (event) => {
    if (!event.data)
        return;
    try {
        const before = event.data.before.data();
        const after = event.data.after.data();
        // Trigger only when transitioning from unlocked -> locked
        if (!before.isLocked && after.isLocked) {
            const db = admin.firestore();
            const prizeAmount = calculatePoolPot(after);
            if (prizeAmount > 0) {
                await db.doc("stats/global").set({
                    totalPrizes: admin.firestore.FieldValue.increment(prizeAmount),
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                console.log(`[Stats] Added $${prizeAmount} to global prizes for newly locked pool ${event.params.poolId}`);
            }
        }
    }
    catch (e) {
        console.error("Error in onPoolLocked:", e);
    }
});
// Callable: Manually recalculate global stats from ALL existing locked/finished pools
exports.recalculateGlobalStats = (0, https_1.onCall)({
    timeoutSeconds: 300,
    memory: "512MiB"
}, async (request) => {
    // Only allow super admin
    if (!request.auth || request.auth.token.email !== 'kstruck@gmail.com') {
        throw new https_1.HttpsError('permission-denied', 'Only super admin can run this');
    }
    try {
        const db = admin.firestore();
        // Fetch ALL pools that are locked (includes active and finished)
        const poolsSnap = await db.collection("pools")
            .where("isLocked", "==", true)
            .get();
        let totalAllTimePrizes = 0;
        let count = 0;
        let errors = 0;
        for (const doc of poolsSnap.docs) {
            try {
                const pool = doc.data();
                const pot = calculatePoolPot(pool);
                if (!isNaN(pot)) {
                    totalAllTimePrizes += pot;
                    count++;
                }
                else {
                    console.warn(`Pool ${doc.id} returned NaN pot`);
                }
            }
            catch (err) {
                console.error(`Error calculating pot for pool ${doc.id}:`, err);
                errors++;
            }
        }
        // Overwrite the global stat with the recalculated total
        await db.doc("stats/global").set({
            totalPrizes: totalAllTimePrizes,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            recalculatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return {
            success: true,
            message: `Recalculated from ${count} pools. Skipped ${errors} errors.`,
            totalPrizes: totalAllTimePrizes
        };
    }
    catch (e) {
        console.error("Recalculate Error:", e);
        throw new https_1.HttpsError('internal', `Recalc Failed: ${e.message}`);
    }
});
//# sourceMappingURL=statsTrigger.js.map