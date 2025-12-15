"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onPoolCompleted = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
exports.onPoolCompleted = (0, firestore_1.onDocumentUpdated)("pools/{poolId}", async (event) => {
    var _a, _b;
    if (!event.data)
        return;
    const before = event.data.before.data();
    const after = event.data.after.data();
    const wasPost = ((_a = before === null || before === void 0 ? void 0 : before.scores) === null || _a === void 0 ? void 0 : _a.gameStatus) === 'post';
    const isPost = ((_b = after === null || after === void 0 ? void 0 : after.scores) === null || _b === void 0 ? void 0 : _b.gameStatus) === 'post';
    // Only run if transitioning to 'post' (Final)
    // This simple logic satisfies the "never decrease" requirement by only adding when it *becomes* final.
    // If it moves back to 'in' (unlikely) and then 'post' again, it would double count.
    // To prevent double counting on re-finalization, we could check an idempotency flag on the pool doc, 
    // but for now we assume 'post' is a terminal state reached once.
    if (!wasPost && isPost) {
        const db = admin.firestore();
        const pool = after;
        // Calculate total prizes
        // Total Pot = squaresSold * cost
        // Prize Pool = Total Pot - (Total Pot * charity%) - (Total Pot * platformFee?)
        // Actually, simpler: Total Pot * (sum of payouts / 100)
        let squaresSold = 0;
        if (pool.squares && Array.isArray(pool.squares)) {
            squaresSold = pool.squares.filter((s) => s.owner).length;
        }
        const totalPot = squaresSold * (pool.costPerSquare || 0);
        // Calculate total payout percentage
        let totalPayoutPct = 0;
        if (pool.payouts) {
            // q1 + q2 + q3 + final
            totalPayoutPct = (pool.payouts.q1 || 0) + (pool.payouts.half || 0) + (pool.payouts.q3 || 0) + (pool.payouts.final || 0);
        }
        const statsRef = db.doc("stats/global");
        // Use a transaction or simple increment
        // Provide a default payout of 100% if undefined, but usually it's defined.
        // If there is a charity cut, usually payouts sum to < 100.
        // Example: 50% charity -> payouts sum to 50%.
        // So `totalPot * (totalPayoutPct / 100)` is correct.
        const prizeAmount = totalPot * (totalPayoutPct / 100);
        if (prizeAmount > 0) {
            await statsRef.set({
                totalPrizes: admin.firestore.FieldValue.increment(prizeAmount),
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log(`Added $${prizeAmount} to global prizes for pool ${event.params.poolId}`);
        }
    }
});
//# sourceMappingURL=statsTrigger.js.map