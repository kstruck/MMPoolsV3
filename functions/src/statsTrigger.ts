import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

// Helper to calculate total pot for a pool
const calculatePoolPot = (pool: any): number => {
    let squaresSold = 0;
    if (pool.squares && Array.isArray(pool.squares)) {
        squaresSold = pool.squares.filter((s: any) => s.owner).length;
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
export const onPoolLocked = onDocumentUpdated("pools/{poolId}", async (event) => {
    if (!event.data) return;
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
    } catch (e) {
        console.error("Error in onPoolLocked:", e);
    }
});

// Callable: Manually recalculate global stats from ALL existing locked/finished pools
export const recalculateGlobalStats = onCall({
    timeoutSeconds: 300,
    memory: "512MiB",
    cors: true // Explicitly enable CORS
}, async (request) => {
    try {
        // Only allow super admin
        if (!request.auth || request.auth.token.email !== 'kstruck@gmail.com') {
            return { success: false, message: 'Permission Denied: Only super admin can run this' };
        }

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
                if (!pool) continue; // Safety check

                const pot = calculatePoolPot(pool);
                if (!isNaN(pot)) {
                    totalAllTimePrizes += pot;
                    count++;
                } else {
                    console.warn(`Pool ${doc.id} returned NaN pot`);
                }
            } catch (err) {
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
    } catch (e: any) {
        console.error("Recalculate Error:", e);
        // Return structured error instead of throwing to avoid CORS masking the message
        return {
            success: false,
            message: `Recalc Failed: ${e.message}`,
            totalPrizes: 0
        };
    }
});
