import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { GameState } from "./types";
import { renderEmailHtml, BASE_URL, escapeHtml } from "./emailStyles";
import { writeAuditEvent } from "./audit";
import { SQUARE_PRIVATE, SquarePrivate } from "./squarePrivate";

/**
 * Cloud Function: confirmPayment
 * Called by participants to notify the pool host that they have sent payment.
 * Sends an email to the pool owner with payment details.
 */
export const confirmPayment = onCall(async (request) => {
    const db = admin.firestore();
    const { poolId, squareIds } = request.data;

    if (!poolId || !squareIds || !Array.isArray(squareIds) || squareIds.length === 0) {
        throw new HttpsError("invalid-argument", "Pool ID and square IDs are required.");
    }

    // Get caller identity
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in to confirm payment.");
    }
    const userId = request.auth.uid;
    const userEmail = request.auth.token.email || "";

    const poolRef = db.collection("pools").doc(poolId);

    // Transaction to update squares and send notification
    const result = await db.runTransaction(async (transaction) => {
        const poolDoc = await transaction.get(poolRef);
        if (!poolDoc.exists) {
            throw new HttpsError("not-found", "Pool not found.");
        }

        const pool = poolDoc.data() as GameState;

        // Validate that the user owns these squares
        const squares = [...pool.squares];
        const confirmedSquares: number[] = [];
        let playerName = "";
        let firstSquareId: number | null = null;

        for (const sqId of squareIds) {
            const square = squares.find(s => s.id === sqId);
            if (!square) continue;

            // Check ownership
            if (!square.owner) {
                throw new HttpsError("failed-precondition", `Square #${sqId} is not claimed.`);
            }

            if (square.reservedByUid !== userId) {
                throw new HttpsError("permission-denied", `You do not own Square #${sqId}.`);
            }

            // Capture display name from the first owned square.
            if (!playerName && square.owner) {
                playerName = square.owner;
                firstSquareId = sqId;
            }

            confirmedSquares.push(sqId);
        }

        if (confirmedSquares.length === 0) {
            throw new HttpsError("invalid-argument", "No valid squares to confirm.");
        }

        // Resolve player email from the restricted subcollection (fallback: auth token).
        let playerEmail = userEmail;
        if (firstSquareId !== null) {
            const privDoc = await transaction.get(
                poolRef.collection(SQUARE_PRIVATE).doc(String(firstSquareId))
            );
            playerEmail = (privDoc.data() as SquarePrivate | undefined)?.email || userEmail;
        }

        // Update squares with payment confirmation timestamp
        const updatedSquares = squares.map(s => {
            if (confirmedSquares.includes(s.id)) {
                return {
                    ...s,
                    paymentConfirmedAt: Date.now(),
                    paymentConfirmedByUid: userId
                };
            }
            return s;
        });

        transaction.update(poolRef, {
            squares: updatedSquares,
            updatedAt: admin.firestore.Timestamp.now()
        });

        // Calculate total amount
        const totalAmount = confirmedSquares.length * (pool.costPerSquare || 0);

        return {
            poolName: pool.name,
            hostEmail: pool.contactEmail,
            playerName,
            playerEmail,
            squareIds: confirmedSquares,
            totalAmount,
            poolId
        };
    });

    // Send email to pool host
    if (result.hostEmail) {
        const squareList = result.squareIds.map(id => `#${id}`).join(", ");

        const bodyContent = `
            <p style="font-size: 16px; color: #334155; margin-bottom: 20px;">
                <strong>${escapeHtml(result.playerName)}</strong> has confirmed payment for their squares in your pool.
            </p>
            
            <div style="background-color: #f1f5f9; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Player:</td>
                        <td style="padding: 8px 0; color: #0f172a; font-weight: bold; text-align: right;">${escapeHtml(result.playerName)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Email:</td>
                        <td style="padding: 8px 0; color: #0f172a; text-align: right;">${escapeHtml(result.playerEmail || "Not provided")}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Squares:</td>
                        <td style="padding: 8px 0; color: #0f172a; font-weight: bold; text-align: right;">${escapeHtml(squareList)}</td>
                    </tr>
                    <tr style="border-top: 1px solid #e2e8f0;">
                        <td style="padding: 12px 0 0; color: #64748b; font-size: 14px;">Total Amount:</td>
                        <td style="padding: 12px 0 0; color: #10b981; font-weight: bold; font-size: 20px; text-align: right;">$${result.totalAmount}</td>
                    </tr>
                </table>
            </div>
            
            <p style="font-size: 14px; color: #64748b; margin-top: 20px;">
                Please verify receipt of payment and mark the squares as paid in your admin panel.
            </p>
        `;

        const emailHtml = renderEmailHtml(
            escapeHtml(`Payment Confirmation from ${result.playerName}`),
            bodyContent,
            `${BASE_URL}/#admin/${result.poolId}`,
            "View Pool Admin"
        );

        await db.collection("mail").add({
            to: result.hostEmail,
            message: {
                subject: escapeHtml(`[${result.poolName}] Payment Confirmation from ${result.playerName}`),
                html: emailHtml
            }
        });

        console.log(`Payment confirmation email sent to ${result.hostEmail} for pool ${poolId}`);
    }

    // Audit log
    await writeAuditEvent({
        poolId,
        type: "PAYMENT_CONFIRMED",
        message: `${result.playerName} confirmed payment for squares: ${result.squareIds.join(", ")}`,
        severity: "INFO",
        actor: { uid: userId, role: "USER", label: result.playerName },
        payload: { squareIds: result.squareIds, totalAmount: result.totalAmount }
    });

    return { success: true, squaresConfirmed: result.squareIds.length };
});
