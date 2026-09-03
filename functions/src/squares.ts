import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import { GameState } from "./types";
import { writeAuditEvent } from "./audit";
import { sendEmail } from "./reminders";
import { renderEmailHtml } from "./emailStyles";
import { checkBillingAccess } from "./billing";
import { SQUARE_PRIVATE, buildSquarePrivate } from "./squarePrivate";
import { assertNotBannedLive } from "./lib/systemGuards";
import { validated } from "./lib/validated";
import { hasConfirmedRole } from "./lib/confirmedRole";
import { updatePlayerSchema, releaseSquaresSchema } from "./schemas/squares";
import { reserveSquareSchema, markSquaresPaidSchema } from "./schemas/squaresProps";


export const reserveSquare = validated(
    // PUBLIC (guest flow): strict shape is the primary gate. customerDetails
    // is a STRIPPING object so arbitrary client keys can no longer reach the
    // squarePrivate PII doc.
    { schema: reserveSquareSchema, label: "reserveSquare", auth: "public", appCheck: "monitor" },
    async (input, request) => {
    const db = admin.firestore();

    // Banned users can't reserve (guests/anonymous are unaffected — no account).
    if (request.auth) await assertNotBannedLive(request.auth.uid);

    const { poolId, squareId, customerDetails, guestDeviceKey, pickedAsName } = input;

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

    const poolRef = db.collection("pools").doc(poolId);

    // 2. Transaction to prevent race conditions
    const result = await db.runTransaction(async (transaction) => {
        const poolDoc = await transaction.get(poolRef);
        if (!poolDoc.exists) {
            throw new HttpsError("not-found", "Pool not found.");
        }

        const pool = poolDoc.data() as GameState;

        const billingCheck = checkBillingAccess(pool.billing);
        if (!billingCheck.allowed) {
            throw new HttpsError("failed-precondition", billingCheck.reason || "Pool is locked due to billing.");
        }

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

        // Reserve — only NON-SENSITIVE display data goes on the public square.
        const updatedSquares = squares.map((s) => {
            if (s.id === squareId) {
                return {
                    ...s,
                    owner: pickedAsName || userName, // Storing Name for display.
                    // Ideally we store ownerUid: userId too, but schema currently uses 'owner' string.
                    // We will stick to schema for now to avoid breaking UI.
                    isPaid: false,
                    guestDeviceKey: guestDeviceKey || null,
                    pickedAsName: pickedAsName || userName,
                };
            }
            return s;
        });

        transaction.update(poolRef, {
            squares: updatedSquares,
            participantIds: userId !== "anonymous" ? FieldValue.arrayUnion(userId) : FieldValue.arrayUnion("guest"),
            updatedAt: Timestamp.now()
        });

        // PII (email/phone/etc) is written to the restricted subcollection, NOT the pool doc.
        const privateRef = poolRef.collection(SQUARE_PRIVATE).doc(String(squareId));
        transaction.set(privateRef, buildSquarePrivate(squareId, { email: userEmail, ...customerDetails }));

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

        const isGridFull = updatedSquares.every(s => s.owner !== null);
        console.log(`[reserveSquare] Grid Full Check - Pool: ${poolId}, IsFull: ${isGridFull}, Notify: ${pool.notifyAdminFull}, Email: ${pool.contactEmail}`);
        return { isGridFull, poolName: pool.name, contactEmail: pool.contactEmail, notifyAdminFull: pool.notifyAdminFull };
    });

    if (result && result.isGridFull && result.notifyAdminFull && result.contactEmail) {
        console.log(`[reserveSquare] Sending Grid Full email to ${result.contactEmail}`);
        const subject = `Grid Full: ${result.poolName}`;
        const html = renderEmailHtml(
            "Your Grid is Full!",
            `<p>Great news! All squares in your pool <strong>${result.poolName}</strong> have been reserved.</p>
             <p>It's time to generate the numbers and lock the pool!</p>`,
            `https://www.marchmeleepools.com/pool/${poolId}`,
            "Go to Pool"
        );
        sendEmail(db, result.contactEmail, subject, html, { poolId, reason: 'GRID_FULL' }).catch(err => console.error("Failed to send grid full email", err));
    }

    // NOTE: Confirmation emails are sent by the frontend (PoolRoute.tsx) AFTER the batch reservation
    // completes. This allows for a summary email with all squares instead of one email per square,
    // and respects the pool's emailConfirmation setting. Do NOT send emails here.

    return { success: true };
    },
);

export const markSquaresPaid = validated(
    // Owner/SUPER_ADMIN check stays in the transaction below (needs the pool).
    { schema: markSquaresPaidSchema, label: "markSquaresPaid", appCheck: "monitor" },
    async (input, request) => {
    const db = admin.firestore();
    const { poolId, squareIds, isPaid } = input;
    const userId = request.auth!.uid;

    const poolRef = db.collection("pools").doc(poolId);

    // CLAIM+DOC, resolved OUTSIDE the transaction (Phase 3,
    // PLAN-API-TRUST-BOUNDARY). This check was DOC-ONLY — the reverse weakness
    // of the claim-only sites: it never required the tamper-proof claim at all.
    // Now both must agree, matching assertCallerRole everywhere else. An owner
    // pays no read (claim short-circuit).
    const isConfirmedAdmin = await hasConfirmedRole(request, 'SUPER_ADMIN');

    await db.runTransaction(async (transaction) => {
        const poolDoc = await transaction.get(poolRef);
        if (!poolDoc.exists) throw new HttpsError("not-found", "Pool not found.");

        const pool = poolDoc.data() as GameState;

        // Permission Check: Owner only for now (managerUid is for BracketPool, not GameState)
        const isAuthorized = pool.ownerId === userId || isConfirmedAdmin;

        if (!isAuthorized) {
            throw new HttpsError("permission-denied", "Only the pool manager can mark squares as paid.");
        }

        const newSquares = pool.squares.map(s => {
            if (squareIds.includes(s.id)) {
                return { ...s, isPaid: isPaid };
            }
            return s;
        });

        transaction.update(poolRef, {
            squares: newSquares,
            updatedAt: Timestamp.now()
        });

        // Audit
        await writeAuditEvent({
            poolId,
            type: 'SQUARE_MARKED_PAID',
            message: `Marked ${squareIds.length} squares as ${isPaid ? 'PAID' : 'UNPAID'}`,
            severity: 'INFO',
            actor: { uid: userId, role: 'ADMIN', label: 'Manager' },
            payload: { squareIds, isPaid }
        }, transaction);
    });

    return { success: true };
    },
);

// Shared authorization: pool owner, manager, or super admin.
//
// `isConfirmedAdmin` is resolved by the CALLER via hasConfirmedRole BEFORE its
// transaction (Phase 3, PLAN-API-TRUST-BOUNDARY): the old shape read
// users/{uid}.role inside the transaction with NO claim requirement — doc-only,
// the reverse of the claim-only weakness, and a re-run cost on every tx retry.
function assertPoolManager(
    pool: GameState,
    userId: string,
    isConfirmedAdmin: boolean,
): void {
    if (pool.ownerId === userId || pool.managerUid === userId) return;
    if (isConfirmedAdmin) return;
    throw new HttpsError("permission-denied", "Only the pool manager can edit players.");
}

/**
 * updatePlayer — manager/admin edits a player's display name and contact info.
 * Display name (owner) is written to the public square; PII goes to the
 * restricted squarePrivate subcollection. Renames all squares owned by
 * `originalName`.
 */
export const updatePlayer = validated(
    // Manager/admin gate stays in-handler (assertPoolManager needs the pool doc
    // inside the transaction).
    { schema: updatePlayerSchema, label: "updatePlayer", appCheck: "monitor" },
    async ({ poolId, originalName, details }, request) => {
    const db = admin.firestore();
    const userId = request.auth!.uid;

    const poolRef = db.collection("pools").doc(poolId);
    const newName = details.name?.trim() || originalName;

    // Claim+doc resolved before the transaction (Phase 3; see assertPoolManager).
    const isConfirmedAdmin = await hasConfirmedRole(request, 'SUPER_ADMIN');

    await db.runTransaction(async (transaction) => {
        const poolDoc = await transaction.get(poolRef);
        if (!poolDoc.exists) throw new HttpsError("not-found", "Pool not found.");
        const pool = poolDoc.data() as GameState;

        assertPoolManager(pool, userId, isConfirmedAdmin);

        const affected = pool.squares.filter((s) => s.owner === originalName);
        if (affected.length === 0) throw new HttpsError("not-found", "Player not found.");

        const updatedSquares = pool.squares.map((s) =>
            s.owner === originalName ? { ...s, owner: newName } : s,
        );
        transaction.update(poolRef, {
            squares: updatedSquares,
            updatedAt: Timestamp.now(),
        });

        // Upsert PII for each of the player's squares in the restricted subcollection.
        for (const s of affected) {
            const privateRef = poolRef.collection(SQUARE_PRIVATE).doc(String(s.id));
            transaction.set(
                privateRef,
                buildSquarePrivate(s.id, {
                    email: details.email,
                    phone: details.phone,
                    notes: details.notes,
                }),
                { merge: true },
            );
        }

        await writeAuditEvent({
            poolId,
            type: "SQUARE_RESERVED",
            message: `Player "${originalName}" updated by manager`,
            severity: "INFO",
            actor: { uid: userId, role: "ADMIN", label: newName },
            payload: { squareIds: affected.map((s) => s.id), renamedTo: newName },
        }, transaction);
    });

    return { success: true };
    },
);

/**
 * releaseSquares — manager/admin releases squares (clears owner + payment) and
 * deletes the associated PII from the squarePrivate subcollection.
 * Accepts either explicit squareIds or an ownerName (releases all their squares).
 */
export const releaseSquares = validated(
    // Manager/admin gate stays in-handler (assertPoolManager needs the pool doc
    // inside the transaction).
    { schema: releaseSquaresSchema, label: "releaseSquares", appCheck: "monitor" },
    async ({ poolId, squareIds, ownerName }, request) => {
    const db = admin.firestore();
    const userId = request.auth!.uid;

    const poolRef = db.collection("pools").doc(poolId);

    // Claim+doc resolved before the transaction (Phase 3; see assertPoolManager).
    const isConfirmedAdmin = await hasConfirmedRole(request, 'SUPER_ADMIN');

    const releasedIds = await db.runTransaction(async (transaction) => {
        const poolDoc = await transaction.get(poolRef);
        if (!poolDoc.exists) throw new HttpsError("not-found", "Pool not found.");
        const pool = poolDoc.data() as GameState;

        assertPoolManager(pool, userId, isConfirmedAdmin);

        const idSet = new Set<number>(Array.isArray(squareIds) ? squareIds : []);
        const toRelease = pool.squares
            .filter((s) => s.owner && (ownerName ? s.owner === ownerName : idSet.has(s.id)))
            .map((s) => s.id);

        if (toRelease.length === 0) return [];

        const releaseSet = new Set(toRelease);
        const updatedSquares = pool.squares.map((s) =>
            releaseSet.has(s.id)
                ? {
                    ...s,
                    owner: null,
                    isPaid: false,
                    guestDeviceKey: null,
                    guestClaimId: null,
                    reservedAt: null,
                    reservedByUid: null,
                    pickedAsName: null,
                }
                : s,
        );
        transaction.update(poolRef, {
            squares: updatedSquares,
            updatedAt: Timestamp.now(),
        });

        // Delete PII for released squares.
        for (const id of toRelease) {
            transaction.delete(poolRef.collection(SQUARE_PRIVATE).doc(String(id)));
        }

        await writeAuditEvent({
            poolId,
            type: "SQUARE_RELEASED",
            message: `Released ${toRelease.length} squares${ownerName ? ` for ${ownerName}` : ""}`,
            severity: "INFO",
            actor: { uid: userId, role: "ADMIN", label: "Manager" },
            payload: { squareIds: toRelease },
        }, transaction);

        return toRelease;
    });

    return { success: true, released: releasedIds };
    },
);
