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
exports.markSquaresPaid = exports.reserveSquare = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const audit_1 = require("./audit");
const reminders_1 = require("./reminders");
const emailStyles_1 = require("./emailStyles");
exports.reserveSquare = (0, https_1.onCall)(async (request) => {
    var _a;
    // 0. Ensure Admin Init (Lazy)
    const db = admin.firestore();
    const { poolId, squareId, customerDetails, guestDeviceKey, pickedAsName } = request.data;
    // 1. Determine user identity - allow unauthenticated users with customerDetails
    const isAuthenticated = !!request.auth;
    const userId = ((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid) || "anonymous";
    // Get user info from auth token OR from customerDetails for anonymous users
    let userName;
    let userEmail;
    if (isAuthenticated && request.auth) {
        userEmail = request.auth.token.email || (customerDetails === null || customerDetails === void 0 ? void 0 : customerDetails.email) || "Unknown";
        userName = request.auth.token.name || (customerDetails === null || customerDetails === void 0 ? void 0 : customerDetails.name) || userEmail.split("@")[0];
    }
    else {
        // Anonymous user - MUST provide name via customerDetails
        if (!(customerDetails === null || customerDetails === void 0 ? void 0 : customerDetails.name)) {
            throw new https_1.HttpsError("invalid-argument", "Name is required to reserve a square.");
        }
        userName = customerDetails.name;
        userEmail = customerDetails.email || "Unknown";
    }
    if (!poolId || squareId === undefined) {
        throw new https_1.HttpsError("invalid-argument", "Missing required fields.");
    }
    const poolRef = db.collection("pools").doc(poolId);
    // 2. Transaction to prevent race conditions
    const result = await db.runTransaction(async (transaction) => {
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
                return Object.assign(Object.assign({}, s), { owner: pickedAsName || userName, 
                    // Ideally we store ownerUid: userId too, but schema currently uses 'owner' string.
                    // We will stick to schema for now to avoid breaking UI.
                    playerDetails: Object.assign({ email: userEmail }, customerDetails), isPaid: false, guestDeviceKey: guestDeviceKey || null, pickedAsName: pickedAsName || userName });
            }
            return s;
        });
        transaction.update(poolRef, {
            squares: updatedSquares,
            participantIds: userId !== "anonymous" ? admin.firestore.FieldValue.arrayUnion(userId) : admin.firestore.FieldValue.arrayUnion("guest"),
            updatedAt: admin.firestore.Timestamp.now()
        });
        // --- AUDIT LOGGING ---
        const role = pool.ownerId === userId ? 'ADMIN' : (isAuthenticated ? 'USER' : 'GUEST');
        await (0, audit_1.writeAuditEvent)({
            poolId,
            type: 'SQUARE_RESERVED',
            message: `Square #${squareId} reserved by ${userName}`,
            severity: 'INFO',
            actor: { uid: userId, role, label: userName },
            payload: { squareId, ownerName: userName, email: userEmail }
        }, transaction);
        const isGridFull = updatedSquares.every(s => s.owner !== null);
        console.log(`[reserveSquare] Grid Full Check - Pool: ${poolId}, IsFull: ${isGridFull}, Notify: ${pool.notifyAdminFull}, Email: ${pool.contactEmail}`);
        return { isGridFull, poolName: pool.name, contactEmail: pool.contactEmail, notifyAdminFull: pool.notifyAdminFull };
    });
    if (result && result.isGridFull && result.notifyAdminFull && result.contactEmail) {
        console.log(`[reserveSquare] Sending Grid Full email to ${result.contactEmail}`);
        const subject = `Grid Full: ${result.poolName}`;
        const html = (0, emailStyles_1.renderEmailHtml)("Your Grid is Full!", `<p>Great news! All squares in your pool <strong>${result.poolName}</strong> have been reserved.</p>
             <p>It's time to generate the numbers and lock the pool!</p>`, `https://www.marchmeleepools.com/pool/${poolId}`, "Go to Pool");
        (0, reminders_1.sendEmail)(db, result.contactEmail, subject, html, { poolId, reason: 'GRID_FULL' }).catch(err => console.error("Failed to send grid full email", err));
    }
    // NOTE: Confirmation emails are sent by the frontend (PoolRoute.tsx) AFTER the batch reservation
    // completes. This allows for a summary email with all squares instead of one email per square,
    // and respects the pool's emailConfirmation setting. Do NOT send emails here.
    return { success: true };
});
exports.markSquaresPaid = (0, https_1.onCall)(async (request) => {
    const db = admin.firestore();
    const { poolId, squareIds, isPaid } = request.data;
    // Auth Check
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in.");
    }
    const userId = request.auth.uid;
    if (!poolId || !squareIds || !Array.isArray(squareIds)) {
        throw new https_1.HttpsError("invalid-argument", "Missing required fields.");
    }
    const poolRef = db.collection("pools").doc(poolId);
    await db.runTransaction(async (transaction) => {
        var _a;
        const poolDoc = await transaction.get(poolRef);
        if (!poolDoc.exists)
            throw new https_1.HttpsError("not-found", "Pool not found.");
        const pool = poolDoc.data();
        // Permission Check: Owner only for now (managerUid is for BracketPool, not GameState)
        let isAuthorized = pool.ownerId === userId;
        if (!isAuthorized) {
            const userDoc = await transaction.get(db.collection("users").doc(userId));
            if (userDoc.exists && ((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role) === 'SUPER_ADMIN') {
                isAuthorized = true;
            }
        }
        if (!isAuthorized) {
            throw new https_1.HttpsError("permission-denied", "Only the pool manager can mark squares as paid.");
        }
        const newSquares = pool.squares.map(s => {
            if (squareIds.includes(s.id)) {
                return Object.assign(Object.assign({}, s), { isPaid: isPaid });
            }
            return s;
        });
        transaction.update(poolRef, {
            squares: newSquares,
            updatedAt: admin.firestore.Timestamp.now()
        });
        // Audit
        await (0, audit_1.writeAuditEvent)({
            poolId,
            type: 'SQUARE_MARKED_PAID',
            message: `Marked ${squareIds.length} squares as ${isPaid ? 'PAID' : 'UNPAID'}`,
            severity: 'INFO',
            actor: { uid: userId, role: 'ADMIN', label: 'Manager' },
            payload: { squareIds, isPaid }
        }, transaction);
    });
    return { success: true };
});
//# sourceMappingURL=squares.js.map