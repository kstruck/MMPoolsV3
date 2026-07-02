import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

import { sendEmail } from "./reminders";
import { renderEmailHtml } from "./emailStyles";
import { getSquareEmails } from "./squarePrivate";

// Helper to calculate total pot and charity for a pool
const calculatePoolPot = async (db: admin.firestore.Firestore, poolId: string, pool: any): Promise<{ prizePot: number; charityAmount: number }> => {
    let grossPot = 0;

    if (pool.type === 'BRACKET' || pool.type === 'NFL_PLAYOFFS') {
        const entryFee = pool.settings?.entryFee || 0;
        if (entryFee > 0) {
            const collectionName = pool.type === 'BRACKET' ? 'entries' : 'playoff_entries';
            const entriesSnap = await db.collection('pools').doc(poolId).collection(collectionName).get();
            const paidEntriesCount = entriesSnap.docs.filter(doc => {
                const data = doc.data();
                return data.paidStatus === 'PAID' || data.paid === true;
            }).length;
            grossPot = paidEntriesCount * entryFee;
        }
    } else {
        let squaresSold = 0;
        if (pool.squares && Array.isArray(pool.squares)) {
            squaresSold = pool.squares.filter((s: any) => s.owner).length;
        }
        grossPot = squaresSold * (pool.costPerSquare || 0);
    }

    // Charity
    let charityAmount = 0;
    const charityConfig = pool.charity || pool.settings?.charity;
    if (charityConfig && charityConfig.enabled && charityConfig.percentage) {
        charityAmount = grossPot * (charityConfig.percentage / 100);
    }

    // Prize Pot defaults to Gross - Charity
    const prizePot = grossPot - charityAmount;

    return { prizePot: Math.floor(prizePot), charityAmount: Math.floor(charityAmount) };
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
            const { prizePot, charityAmount } = await calculatePoolPot(db, event.params.poolId, after);

            if (prizePot > 0 || charityAmount > 0) {
                await db.doc("stats/global").set({
                    totalPrizes: admin.firestore.FieldValue.increment(prizePot),
                    totalDonated: admin.firestore.FieldValue.increment(charityAmount),
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                console.log(`[Stats] Added $${prizePot} prizes / $${charityAmount} charity for pool ${event.params.poolId}`);
            }

            // --- EMAIL NOTIFICATION LOGIC ---
            // If email enabled, numbers generated, and NOT already sent
            if (after.emailNumbersGenerated && after.axisNumbers && !after.numbersEmailSent) {
                console.log(`[onPoolLocked] Triggering 'Numbers Set' emails for pool ${event.params.poolId}`);

                // Mark as sent immediately to prevent re-entry (idempotency)
                await event.data.after.ref.update({ numbersEmailSent: true });

                const homeNums = after.axisNumbers.home.join(", ");
                const awayNums = after.axisNumbers.away.join(", ");
                const subject = `Numbers Generated: ${after.name}`;

                const html = renderEmailHtml(
                    "The Numbers Are Set!",
                    `<p>The pool <strong>${after.name}</strong> has been locked and the numbers have been generated.</p>
                     <div style="background-color: #f1f5f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin: 5px 0;"><strong>${after.homeTeam} (Row):</strong> ${homeNums}</p>
                        <p style="margin: 5px 0;"><strong>${after.awayTeam} (Col):</strong> ${awayNums}</p>
                     </div>
                     <p>Good luck!</p>`,
                    `https://www.marchmeleepools.com/pool/${event.params.poolId}`,
                    "View Your Squares"
                );

                // Collect unique emails from the restricted squarePrivate subcollection.
                const uniqueEmails = await getSquareEmails(db, event.params.poolId);
                console.log(`[onPoolLocked] Sending to ${uniqueEmails.length} recipients`);

                await Promise.all(uniqueEmails.map(email =>
                    sendEmail(db, email, subject, html, { poolId: event.params.poolId, reason: 'NUMBERS_GENERATED_TRIGGER' })
                ));
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
    cors: ["https://www.marchmeleepools.com", "https://gridiron-gamble-uzuqo.firebaseapp.com", "https://gridiron-gamble-uzuqo.web.app"]
}, async (request) => {
    try {
        // Only allow super admin
        if (!request.auth || request.auth.token.role !== 'SUPER_ADMIN') {
            return { success: false, message: 'Permission Denied: Only super admin can run this' };
        }

        const db = admin.firestore();

        // Fetch ALL pools that are locked (includes active and finished)
        const poolsSnap = await db.collection("pools")
            .where("isLocked", "==", true)
            .get();

        let totalAllTimePrizes = 0;
        let totalAllTimeCharity = 0;
        let count = 0;
        let errors = 0;

        for (const doc of poolsSnap.docs) {
            try {
                const pool = doc.data();
                if (!pool) continue; // Safety check

                const { prizePot, charityAmount } = await calculatePoolPot(db, doc.id, pool);
                if (!isNaN(prizePot)) {
                    totalAllTimePrizes += prizePot;
                    totalAllTimeCharity += charityAmount;
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
            totalRevenue: totalAllTimePrizes, // Backwards compat or Total Volume? Let's treat Revenue as Prizes for now or sum? Let's just track Prizes and Donated separately.
            totalDonated: totalAllTimeCharity,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            recalculatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return {
            success: true,
            message: `Recalculated from ${count} pools. Skipped ${errors} errors.`,
            totalPrizes: totalAllTimePrizes,
            totalDonated: totalAllTimeCharity
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
