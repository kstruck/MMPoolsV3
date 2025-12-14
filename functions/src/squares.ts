import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { GameState } from "./types";
import { writeAuditEvent } from "./audit";


export const reserveSquare = onCall(async (request) => {
    // 0. Ensure Admin Init (Lazy)
    const db = admin.firestore();

    const { poolId, squareId, customerDetails } = request.data;

    // 1. Determine user identity - allow unauthenticated users with customerDetails
    const isAuthenticated = !!request.auth;
    const userId = request.auth?.uid || "anonymous";

    // Get user info from auth token OR from customerDetails for anonymous users
    let userName: string;
    let userEmail: string;

    if (isAuthenticated && request.auth) {
        userEmail = request.auth.token.email || customerDetails?.email || "Unknown";
        userName = request.auth.token.name || customerDetails?.name || userEmail.split("@")[0];
    } else {
        // Anonymous user - MUST provide name via customerDetails
        if (!customerDetails?.name) {
            throw new HttpsError(
                "invalid-argument",
                "Name is required to reserve a square."
            );
        }
        userName = customerDetails.name;
        userEmail = customerDetails.email || "Unknown";
    }

    if (!poolId || squareId === undefined) {
        throw new HttpsError("invalid-argument", "Missing required fields.");
    }

    const poolRef = db.collection("pools").doc(poolId);

    // 2. Transaction to prevent race conditions
    await db.runTransaction(async (transaction) => {
        const poolDoc = await transaction.get(poolRef);
        if (!poolDoc.exists) {
            throw new HttpsError("not-found", "Pool not found.");
        }

        const pool = poolDoc.data() as GameState;

        // Check if Pool is open explicitly?
        // Usually squares can be bought unless isLocked, BUT admin might reserve even if locked (Manual).
        // Let's enforce: If locked, ONLY owner can edit.
        if (pool.isLocked && pool.ownerId !== userId) {
            throw new HttpsError("failed-precondition", "Pool is locked.");
        }

        const squares = [...pool.squares];
        const targetSquare = squares.find((s) => s.id === squareId);

        if (!targetSquare) {
            throw new HttpsError("not-found", "Square not found.");
        }

        // Check availability
        if (targetSquare.owner) {
            // Idempotency: If I already own it, success.
            if (targetSquare.owner === userName) { // Note: owner stored as Name string currently, safer to check ID if we had it on square
                return;
            }
            throw new HttpsError("already-exists", "Square already taken.");
        }

        // Check Limits
        const mySquares = squares.filter(s => s.owner === userName).length;
        if (mySquares >= pool.maxSquaresPerPlayer && pool.ownerId !== userId) {
            throw new HttpsError("resource-exhausted", `Max ${pool.maxSquaresPerPlayer} squares per player.`);
        }

        // Reserve
        const updatedSquares = squares.map((s) => {
            if (s.id === squareId) {
                return {
                    ...s,
                    owner: userName, // Storing Name for display.
                    // Ideally we store ownerUid: userId too, but schema currently uses 'owner' string.
                    // We will stick to schema for now to avoid breaking UI.
                    playerDetails: {
                        email: userEmail,
                        ...customerDetails
                    },
                    isPaid: false
                };
            }
            return s;
        });

        transaction.update(poolRef, {
            squares: updatedSquares,
            updatedAt: admin.firestore.Timestamp.now()
        });

        // --- AUDIT LOGGING ---
        const role = pool.ownerId === userId ? 'ADMIN' : (isAuthenticated ? 'USER' : 'GUEST');
        await writeAuditEvent({
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
