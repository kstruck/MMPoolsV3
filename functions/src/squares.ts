import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { GameState } from "./types";


export const reserveSquare = functions.https.onCall(async (data, context) => {
    // 0. Ensure Admin Init (Lazy)
    const db = admin.firestore();

    // 1. Auth Check
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "Must be logged in to reserve a square."
        );
    }

    const { poolId, squareId, customerDetails } = data;
    const userId = context.auth.uid;
    // Get user display name from auth token (or default)
    const userEmail = context.auth.token.email || "Unknown";
    const userName = context.auth.token.name || userEmail.split("@")[0];

    if (!poolId || squareId === undefined) {
        throw new functions.https.HttpsError("invalid-argument", "Missing required fields.");
    }

    const poolRef = db.collection("pools").doc(poolId);

    // 2. Transaction to prevent race conditions
    await db.runTransaction(async (transaction) => {
        const poolDoc = await transaction.get(poolRef);
        if (!poolDoc.exists) {
            throw new functions.https.HttpsError("not-found", "Pool not found.");
        }

        const pool = poolDoc.data() as GameState;

        // Check if Pool is open explicitly?
        // Usually squares can be bought unless isLocked, BUT admin might reserve even if locked (Manual).
        // Let's enforce: If locked, ONLY owner can edit.
        if (pool.isLocked && pool.ownerId !== userId) {
            throw new functions.https.HttpsError("failed-precondition", "Pool is locked.");
        }

        const squares = [...pool.squares];
        const targetSquare = squares.find((s) => s.id === squareId);

        if (!targetSquare) {
            throw new functions.https.HttpsError("not-found", "Square not found.");
        }

        // Check availability
        if (targetSquare.owner) {
            // Idempotency: If I already own it, success.
            if (targetSquare.owner === userName) { // Note: owner stored as Name string currently, safer to check ID if we had it on square
                return;
            }
            throw new functions.https.HttpsError("already-exists", "Square already taken.");
        }

        // Check Limits
        const mySquares = squares.filter(s => s.owner === userName).length;
        if (mySquares >= pool.maxSquaresPerPlayer && pool.ownerId !== userId) {
            throw new functions.https.HttpsError("resource-exhausted", `Max ${pool.maxSquaresPerPlayer} squares per player.`);
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
    });

    return { success: true };
});
