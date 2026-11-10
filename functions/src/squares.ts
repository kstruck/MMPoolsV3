import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
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
import { reserveSquareSchema, reserveSquaresSchema, markSquaresPaidSchema } from "./schemas/squaresProps";
import { planClaim, claimRefusalMessage, normalizePlayerName, type ClaimRefusal } from "./shared/squaresClaim";
import { guestKeyHashOrNull } from "./lib/guestKey";


/** What a claim needs, whichever callable it arrived through. */
interface ReserveArgs {
    poolId: string;
    squareIds: number[];
    customerDetails?: {
        name?: string; email?: string; phone?: string;
        address?: string; notes?: string; referral?: string;
    } | null;
    guestDeviceKey?: string | null;
    pickedAsName?: string | null;
}

function refusalToHttpsError(refusal: ClaimRefusal): HttpsError {
    const message = claimRefusalMessage(refusal);
    switch (refusal.code) {
        case 'NOT_FOUND': return new HttpsError("not-found", message);
        case 'TAKEN': return new HttpsError("already-exists", message);
        case 'LIMIT': return new HttpsError("resource-exhausted", message);
        default: return new HttpsError("invalid-argument", message);
    }
}

/**
 * Reserve a selection of squares for the caller, ALL OR NOTHING, in one
 * transaction. Both callables below end here, so the single-square path and
 * the whole-selection path cannot drift apart.
 *
 * The DECISION — taken or not, over the limit or not, already the caller's or
 * not — is `planClaim` in `shared/squaresClaim.ts`, the same function the pool
 * page uses to preview a claim. This function supplies it with WHO is asking,
 * which only the server can know.
 */
async function reserveSquaresForCaller(
    args: ReserveArgs,
    request: CallableRequest<unknown>,
): Promise<{ reserved: number[]; alreadyHeld: number[] }> {
    const db = admin.firestore();

    // Banned users can't reserve (guests/anonymous are unaffected — no account).
    if (request.auth) await assertNotBannedLive(request.auth.uid);

    const { poolId, squareIds, customerDetails, guestDeviceKey, pickedAsName } = args;

    // 1. Who is this? A signed-in player is their ACCOUNT. A guest is the device
    //    key their browser holds — stored only as a hash (lib/guestKey.ts).
    const isAuthenticated = !!request.auth;
    const userId = request.auth?.uid || "anonymous";

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

    // The name that goes on the squares is the one the player TYPED. The limit
    // and the "already mine" check used to compare against `userName` instead —
    // the token name for a signed-in player — so they counted a name the square
    // never carried.
    const displayName = (pickedAsName || userName || "").trim();

    // Resolved inside the transaction, once the pool's owner is known.
    const callerIdentity = {
        uid: isAuthenticated ? userId : null,
        guestKeyHash: guestKeyHashOrNull(poolId, guestDeviceKey),
    };

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

        if (!Array.isArray(pool.squares)) {
            throw new HttpsError("failed-precondition", "This pool has no squares grid.");
        }

        // Once the grid is locked only the owner may still place a name on it.
        if (pool.isLocked && pool.ownerId !== userId) {
            throw new HttpsError("failed-precondition", "Pool is locked.");
        }

        // THE COMMISSIONER ENTERING A SQUARE FOR SOMEONE ELSE. The owner is
        // exempt from the limit precisely so they can type in the players who
        // paid in person. Stamping the owner's account on those squares put
        // them on the OWNER's dashboard, let only the owner press "I've paid"
        // for them, and counted them as the owner's (qodo, PR #758). A square
        // the owner enters under a name that is not their own carries the name
        // and no identity — the same as a hand-entered square always has.
        const isOwner = isAuthenticated && pool.ownerId === userId;
        const onBehalf = isOwner && normalizePlayerName(displayName) !== normalizePlayerName(userName);
        const identity = onBehalf ? { uid: null, guestKeyHash: null } : callerIdentity;

        const plan = planClaim({
            squares: pool.squares,
            squareIds,
            identity,
            displayName,
            maxSquaresPerPlayer: pool.maxSquaresPerPlayer,
            exemptFromCap: isOwner,
            now: Date.now(),
        });
        if (!plan.ok) throw refusalToHttpsError(plan.refusal);

        // Every square asked for is already the caller's: nothing to write.
        if (plan.reserved.length === 0) {
            return { reserved: [] as number[], alreadyHeld: plan.alreadyHeld, isGridFull: false, poolName: pool.name, contactEmail: pool.contactEmail, notifyAdminFull: false };
        }

        transaction.update(poolRef, {
            squares: plan.squares,
            participantIds: userId !== "anonymous" ? FieldValue.arrayUnion(userId) : FieldValue.arrayUnion("guest"),
            updatedAt: Timestamp.now()
        });

        const role = pool.ownerId === userId ? 'ADMIN' : (isAuthenticated ? 'USER' : 'GUEST');
        for (const squareId of plan.reserved) {
            // PII (email/phone/etc) is written to the restricted subcollection, NOT the pool doc.
            const privateRef = poolRef.collection(SQUARE_PRIVATE).doc(String(squareId));
            // On-behalf: the contact details are the PLAYER's, as typed — never the
            // commissioner's own email by default, or the player's payment
            // reminders would go to the commissioner.
            transaction.set(privateRef, buildSquarePrivate(squareId, { email: onBehalf ? "Unknown" : userEmail, ...customerDetails }));

            await writeAuditEvent({
                poolId,
                type: 'SQUARE_RESERVED',
                message: `Square #${squareId} reserved by ${displayName}`,
                severity: 'INFO',
                actor: { uid: userId, role, label: displayName },
                payload: { squareId, ownerName: displayName, email: onBehalf ? (customerDetails?.email || "Unknown") : userEmail, ...(onBehalf ? { enteredByOwner: true } : {}) }
            }, transaction);
        }

        const isGridFull = plan.squares.every(s => s.owner !== null);
        return { reserved: plan.reserved, alreadyHeld: plan.alreadyHeld, isGridFull, poolName: pool.name, contactEmail: pool.contactEmail, notifyAdminFull: pool.notifyAdminFull };
    });

    if (result.isGridFull && result.notifyAdminFull && result.contactEmail) {
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

    // NOTE: Confirmation emails are sent by the frontend (PoolRoute.tsx) AFTER the
    // reservation completes, as one summary for the whole selection, and respect
    // the pool's emailConfirmation setting. Do NOT send emails here.

    return { reserved: result.reserved, alreadyHeld: result.alreadyHeld };
}

/**
 * reserveSquare — ONE square. Kept for bundles built before `reserveSquares`
 * existed; a browser tab open across the deploy still calls this.
 */
export const reserveSquare = validated(
    // PUBLIC (guest flow): strict shape is the primary gate. customerDetails
    // is a STRIPPING object so arbitrary client keys can no longer reach the
    // squarePrivate PII doc.
    { schema: reserveSquareSchema, label: "reserveSquare", auth: "public", appCheck: "monitor" },
    async (input, request) => {
        const { squareId, ...rest } = input;
        await reserveSquaresForCaller({ ...rest, squareIds: [squareId] }, request);
        return { success: true };
    },
);

/**
 * reserveSquares — a whole selection, all or nothing.
 *
 * The pool page used to call `reserveSquare` once per square, in parallel. A
 * refusal part-way through left the earlier squares reserved and told the
 * player the claim had failed.
 */
export const reserveSquares = validated(
    { schema: reserveSquaresSchema, label: "reserveSquares", auth: "public", appCheck: "monitor" },
    async (input, request) => {
        const result = await reserveSquaresForCaller(input, request);
        return { success: true, reserved: result.reserved, alreadyHeld: result.alreadyHeld };
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
                    guestKeyHash: null,
                    guestClaimId: null,
                    reservedAt: null,
                    reservedByUid: null,
                    pickedAsName: null,
                    paymentConfirmedAt: null,
                    paymentConfirmedByUid: null,
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
