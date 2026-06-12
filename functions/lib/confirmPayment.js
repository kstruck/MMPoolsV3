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
exports.confirmPayment = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const emailStyles_1 = require("./emailStyles");
const audit_1 = require("./audit");
/**
 * Cloud Function: confirmPayment
 * Called by participants to notify the pool host that they have sent payment.
 * Sends an email to the pool owner with payment details.
 */
exports.confirmPayment = (0, https_1.onCall)(async (request) => {
    const db = admin.firestore();
    const { poolId, squareIds } = request.data;
    if (!poolId || !squareIds || !Array.isArray(squareIds) || squareIds.length === 0) {
        throw new https_1.HttpsError("invalid-argument", "Pool ID and square IDs are required.");
    }
    // Get caller identity
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be logged in to confirm payment.");
    }
    const userId = request.auth.uid;
    const userEmail = request.auth.token.email || "";
    const poolRef = db.collection("pools").doc(poolId);
    // Transaction to update squares and send notification
    const result = await db.runTransaction(async (transaction) => {
        var _a;
        const poolDoc = await transaction.get(poolRef);
        if (!poolDoc.exists) {
            throw new https_1.HttpsError("not-found", "Pool not found.");
        }
        const pool = poolDoc.data();
        // Validate that the user owns these squares
        const squares = [...pool.squares];
        const confirmedSquares = [];
        let playerName = "";
        let playerEmail = "";
        for (const sqId of squareIds) {
            const square = squares.find(s => s.id === sqId);
            if (!square)
                continue;
            // Check ownership
            if (!square.owner) {
                throw new https_1.HttpsError("failed-precondition", `Square #${sqId} is not claimed.`);
            }
            if (square.reservedByUid !== userId) {
                throw new https_1.HttpsError("permission-denied", `You do not own Square #${sqId}.`);
            }
            // Get player details from the first square
            if (!playerName && square.owner) {
                playerName = square.owner;
                playerEmail = ((_a = square.playerDetails) === null || _a === void 0 ? void 0 : _a.email) || userEmail;
            }
            confirmedSquares.push(sqId);
        }
        if (confirmedSquares.length === 0) {
            throw new https_1.HttpsError("invalid-argument", "No valid squares to confirm.");
        }
        // Update squares with payment confirmation timestamp
        const updatedSquares = squares.map(s => {
            if (confirmedSquares.includes(s.id)) {
                return Object.assign(Object.assign({}, s), { paymentConfirmedAt: Date.now(), paymentConfirmedByUid: userId });
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
                <strong>${(0, emailStyles_1.escapeHtml)(result.playerName)}</strong> has confirmed payment for their squares in your pool.
            </p>
            
            <div style="background-color: #f1f5f9; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Player:</td>
                        <td style="padding: 8px 0; color: #0f172a; font-weight: bold; text-align: right;">${(0, emailStyles_1.escapeHtml)(result.playerName)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Email:</td>
                        <td style="padding: 8px 0; color: #0f172a; text-align: right;">${(0, emailStyles_1.escapeHtml)(result.playerEmail || "Not provided")}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Squares:</td>
                        <td style="padding: 8px 0; color: #0f172a; font-weight: bold; text-align: right;">${(0, emailStyles_1.escapeHtml)(squareList)}</td>
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
        const emailHtml = (0, emailStyles_1.renderEmailHtml)((0, emailStyles_1.escapeHtml)(`Payment Confirmation from ${result.playerName}`), bodyContent, `${emailStyles_1.BASE_URL}/#admin/${result.poolId}`, "View Pool Admin");
        await db.collection("mail").add({
            to: result.hostEmail,
            message: {
                subject: (0, emailStyles_1.escapeHtml)(`[${result.poolName}] Payment Confirmation from ${result.playerName}`),
                html: emailHtml
            }
        });
        console.log(`Payment confirmation email sent to ${result.hostEmail} for pool ${poolId}`);
    }
    // Audit log
    await (0, audit_1.writeAuditEvent)({
        poolId,
        type: "PAYMENT_CONFIRMED",
        message: `${result.playerName} confirmed payment for squares: ${result.squareIds.join(", ")}`,
        severity: "INFO",
        actor: { uid: userId, role: "USER", label: result.playerName },
        payload: { squareIds: result.squareIds, totalAmount: result.totalAmount }
    });
    return { success: true, squaresConfirmed: result.squareIds.length };
});
//# sourceMappingURL=confirmPayment.js.map