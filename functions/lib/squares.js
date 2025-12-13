"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reserveSquare = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const audit_1 = require("./audit");
exports.reserveSquare = (0, https_1.onCall)(async (request) => {
    // 0. Ensure Admin Init (Lazy)
    const db = admin.firestore();
    // 1. Auth Check
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in to reserve a square.");
    }
    const { poolId, squareId, customerDetails } = request.data;
    const userId = request.auth.uid;
    // Get user display name from auth token (or default)
    const userEmail = request.auth.token.email || "Unknown";
    const userName = request.auth.token.name || userEmail.split("@")[0];
    if (!poolId || squareId === undefined) {
        throw new https_1.HttpsError("invalid-argument", "Missing required fields.");
    }
    const poolRef = db.collection("pools").doc(poolId);
    // 2. Transaction to prevent race conditions
    await db.runTransaction(async (transaction) => {
        const poolDoc = await transaction.get(poolRef);
        if (!poolDoc.exists) {
            throw new https_1.HttpsError("not-found", "Pool not found.");
        }
        const pool = poolDoc.data();
        // Check if Pool is open explicitly?
        // Usually squares can be bought unless isLocked, BUT admin might reserve even if locked (Manual).
        // Let's enforce: If locked, ONLY owner can edit.
        if (pool.isLocked && pool.ownerId !== userId) {
            throw new https_1.HttpsError("failed-precondition", "Pool is locked.");
        }
        const squares = [...pool.squares];
        const targetSquare = squares.find((s) => s.id === squareId);
        if (!targetSquare) {
            throw new https_1.HttpsError("not-found", "Square not found.");
        }
        // Check availability
        if (targetSquare.owner) {
            // Idempotency: If I already own it, success.
            if (targetSquare.owner === userName) { // Note: owner stored as Name string currently, safer to check ID if we had it on square
                return;
            }
            throw new https_1.HttpsError("already-exists", "Square already taken.");
        }
        // Check Limits
        const mySquares = squares.filter(s => s.owner === userName).length;
        if (mySquares >= pool.maxSquaresPerPlayer && pool.ownerId !== userId) {
            throw new https_1.HttpsError("resource-exhausted", `Max ${pool.maxSquaresPerPlayer} squares per player.`);
        }
        // Reserve
        const updatedSquares = squares.map((s) => {
            if (s.id === squareId) {
                return Object.assign(Object.assign({}, s), { owner: userName, 
                    // Ideally we store ownerUid: userId too, but schema currently uses 'owner' string.
                    // We will stick to schema for now to avoid breaking UI.
                    playerDetails: Object.assign({ email: userEmail }, customerDetails), isPaid: false });
            }
            return s;
        });
        transaction.update(poolRef, {
            squares: updatedSquares,
            updatedAt: admin.firestore.Timestamp.now()
        });
        // --- AUDIT LOGGING ---
        const role = pool.ownerId === userId ? 'ADMIN' : 'USER';
        await (0, audit_1.writeAuditEvent)({
            poolId,
            type: 'SQUARE_RESERVED',
            message: `Square #${squareId} reserved by ${userName}`,
            severity: 'INFO',
            actor: { uid: userId, role, label: userName },
            payload: { squareId, ownerName: userName, email: userEmail }
        }, transaction);
    });
    return { success: true };
});
//# sourceMappingURL=squares.js.map