
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";

import { Timestamp } from "firebase-admin/firestore";
import { writeLedgerEvent } from "./paymentLedger";
import { sendEmail } from "./reminders";
import { renderEmailHtml, BASE_URL, escapeHtml } from "./emailStyles";



// ----------------------------------------------------------------------------
// Mark Entry Paid Status
// ----------------------------------------------------------------------------
export const markEntryPaidStatus = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const { poolId, entryId, isPaid } = request.data;
    const uid = request.auth.uid;

    if (!poolId || !entryId) {
        throw new HttpsError("invalid-argument", "Missing poolId or entryId.");
    }

    const db = admin.firestore();
    const poolRef = db.collection("pools").doc(poolId);
    const entryRef = poolRef.collection("entries").doc(entryId);

    // Verify Ownership/Managership
    const poolDoc = await poolRef.get();
    if (!poolDoc.exists) {
        throw new HttpsError("not-found", "Pool not found.");
    }
    const poolData = poolDoc.data();

    // Allow Manager OR Owner to update paid status
    if (poolData?.managerUid !== uid && poolData?.ownerId !== uid) {
        throw new HttpsError("permission-denied", "Only the pool manager can update payment status.");
    }

    await entryRef.update({
        paidStatus: isPaid ? 'PAID' : 'UNPAID',
        updatedAt: Timestamp.now().toMillis()
    });

    // Ledger event + receipt: every paid-status flip leaves a timestamped,
    // attributed record the member can see, and a PAID mark emails a receipt
    const entrySnap = await entryRef.get();
    const entry = entrySnap.data() ?? {};
    const targetUid: string = entry.ownerUid || entryId;
    const entryFee: number | undefined = poolData?.settings?.entryFee;

    await writeLedgerEvent(db, poolId, {
        type: isPaid ? 'MARKED_PAID' : 'MARKED_UNPAID',
        uid: targetUid,
        entryId,
        entryName: entry.entryName || entry.userName,
        amount: typeof entryFee === 'number' ? entryFee : undefined,
        actorUid: uid,
    });

    if (isPaid) {
        try {
            const userSnap = await db.collection('users').doc(targetUid).get();
            const email = userSnap.data()?.email;
            if (email) {
                const poolName = escapeHtml(poolData?.name || 'your pool');
                const body = `
                    <p>Hi ${escapeHtml(entry.userName || 'there')},</p>
                    <p>Your entry payment for <strong>${poolName}</strong> has been confirmed by the commissioner.</p>
                    <div style="background-color: #ecfdf5; border: 1px solid #10b981; border-radius: 8px; padding: 15px; margin: 20px 0; color: #064e3b;">
                        <p style="margin: 0; font-weight: bold; font-size: 18px;">PAID ✅</p>
                        ${entry.entryName ? `<p style="margin: 5px 0 0 0;">Entry: ${escapeHtml(entry.entryName)}</p>` : ''}
                        ${typeof entryFee === 'number' ? `<p style="margin: 5px 0 0 0;">Amount: $${entryFee}</p>` : ''}
                        <p style="margin: 5px 0 0 0;">Confirmed: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET</p>
                    </div>
                    <p>Keep this email as your receipt. Good luck!</p>
                `;
                const html = renderEmailHtml('Payment Receipt', body, `${BASE_URL}/pool/${poolId}`, 'View Pool');
                await sendEmail(db, email, `Payment Receipt: ${poolData?.name || 'Pool Entry'}`, html, { poolId, transactional: true });
            }
        } catch (emailErr) {
            // Receipt failure must not fail the paid mark itself
            console.error('Failed to send payment receipt:', emailErr);
        }
    }

    return { success: true };
});


// ----------------------------------------------------------------------------
// Update Tournament Data (Admin / ESPN Sync)
// ----------------------------------------------------------------------------
export const updateTournamentData = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    // Role check: Only SuperAdmin should call this
    const db = admin.firestore();
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (userDoc.data()?.role !== 'SUPER_ADMIN') {
        throw new HttpsError("permission-denied", "Admin only.");
    }

    const { tournamentId, tournamentData } = request.data;
    // tournamentData should match Partial<Tournament>

    await db.collection("tournaments").doc(tournamentId).set(tournamentData, { merge: true });

    return { success: true };
});
