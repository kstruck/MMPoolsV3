import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Tournament, BracketPool, BracketEntry } from "./types";
import { checkBillingAccess } from "./billing";
import { assertPaidParticipantCeiling } from "./poolOps";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { sendEmail } from "./reminders";
import { renderEmailHtml, BASE_URL } from "./emailStyles";
import { assertNotBannedLive } from "./lib/systemGuards";



// ----------------------------------------------------------------------------
// Create Bracket Entry (Draft)
// ----------------------------------------------------------------------------
export const createBracketEntry = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const { poolId, name } = request.data;
    const uid = request.auth.uid;

    if (!poolId || !name) {
        throw new HttpsError("invalid-argument", "Missing poolId or entry name.");
    }

    const db = admin.firestore();
    const poolRef = db.collection("pools").doc(poolId);

    // Check constraints in Transaction
    const entryId = await db.runTransaction(async (transaction) => {
        const poolDoc = await transaction.get(poolRef);
        if (!poolDoc.exists) {
            throw new HttpsError("not-found", "Pool not found.");
        }

        const poolData = poolDoc.data() as BracketPool;

        const billingStatus = poolData.billing?.status ?? 'free';
        if (billingStatus === 'free') {
            const currentEntriesCount = poolData.entryCount || 0;
            if (currentEntriesCount >= 10) {
                throw new HttpsError("failed-precondition", "This pool is on the Free Plan and has reached the limit of 10 participants. The pool manager must upgrade to premium to allow more participants to join.");
            }
        }
        // Paid-ceiling gate (NOTES-WAVE2 A2, PLAN 6b(iii)): a PAID pool cannot
        // exceed its purchased entry ceiling. No-op for free/trial pools.
        assertPaidParticipantCeiling(poolData.billing, poolData.entryCount || 0);

        // Check lock status — only OPEN pools accept new entries
        if (poolData.status !== 'OPEN' && poolData.status !== 'DRAFT') {
            throw new HttpsError("failed-precondition", "Pool is not accepting new entries.");
        }
        if (poolData.lockAt > 0 && Date.now() > poolData.lockAt) {
            throw new HttpsError("failed-precondition", "Pool is locked.");
        }

        // Check max entries per user
        const maxPerUser = poolData.settings.maxEntriesPerUser;
        if (maxPerUser > 0) {
            const userEntriesSnapshot = await transaction.get(
                poolRef.collection("entries").where("ownerUid", "==", uid)
            );
            if (userEntriesSnapshot.size >= maxPerUser) {
                throw new HttpsError("resource-exhausted", `Max entries per user (${maxPerUser}) reached.`);
            }
        }

        // Check max entries total
        const maxTotal = poolData.settings.maxEntriesTotal;
        if (maxTotal > 0) {
            // Note: entryCount on pool might be approximate, better to trust it or use aggregation query if high scale.
            // For v1, trusting the counter or checking size if small. 
            // Using poolData.entryCount for efficiency.
            if ((poolData.entryCount || 0) >= maxTotal) {
                throw new HttpsError("resource-exhausted", `Pool is full (${maxTotal} entries).`);
            }
        }

        // Create Entry
        const newEntryRef = poolRef.collection("entries").doc();
        const now = Timestamp.now().toMillis();

        const newEntry: BracketEntry = {
            id: newEntryRef.id,
            poolId,
            ownerUid: uid,
            name,
            picks: {}, // Empty picks to start
            status: "DRAFT",
            paidStatus: "UNPAID",
            score: 0,
            createdAt: now,
            updatedAt: now
        };

        transaction.set(newEntryRef, newEntry);

        // Increment pool entry count and add user to participantIds
        transaction.update(poolRef, {
            entryCount: FieldValue.increment(1),
            participantIds: FieldValue.arrayUnion(uid)
        });

        return newEntryRef.id;
    });

    return { success: true, entryId };
});

// ----------------------------------------------------------------------------
// Update Bracket Entry (Draft Picks)
// ----------------------------------------------------------------------------
export const updateBracketEntry = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const { poolId, entryId, picks, tieBreakerPrediction, name } = request.data;
    const uid = request.auth.uid;

    if (!poolId || !entryId || !picks) {
        throw new HttpsError("invalid-argument", "Missing data.");
    }

    const db = admin.firestore();
    const entryRef = db.collection("pools").doc(poolId).collection("entries").doc(entryId);
    const poolRef = db.collection("pools").doc(poolId);

    await db.runTransaction(async (transaction) => {
        const entryDoc = await transaction.get(entryRef);
        if (!entryDoc.exists) {
            throw new HttpsError("not-found", "Entry not found.");
        }

        const entryData = entryDoc.data() as BracketEntry;
        if (entryData.ownerUid !== uid) {
            throw new HttpsError("permission-denied", "Not your entry.");
        }

        // Check pool lock — only OPEN pools allow edits
        const poolDoc = await transaction.get(poolRef);
        const poolData = poolDoc.data() as BracketPool;
        
        const billingCheck = checkBillingAccess(poolData.billing);
        if (!billingCheck.allowed) {
            throw new HttpsError("failed-precondition", billingCheck.reason || "Pool is locked due to billing.");
        }

        if (poolData.status === 'LOCKED' || poolData.status === 'LIVE' || poolData.status === 'COMPLETED') {
            throw new HttpsError("failed-precondition", "Pool is locked. No edits allowed.");
        }
        if (poolData.lockAt > 0 && Date.now() > poolData.lockAt) {
            throw new HttpsError("failed-precondition", "Pool is locked.");
        }

        // Per-game lock check
        const tournamentRef = db.collection('tournaments').doc(poolData.tournamentId);
        const tournamentDoc = await transaction.get(tournamentRef);
        if (tournamentDoc.exists) {
            const tournament = tournamentDoc.data();
            for (const [slotId, teamId] of Object.entries(picks as Record<string, string>)) {
                if (entryData.picks?.[slotId] !== teamId) {
                    const slot = tournament?.slots?.[slotId];
                    const game = slot ? tournament?.games?.[slot.gameId] : null;
                    if (game && game.startTime) {
                        const gameTime = new Date(game.startTime).getTime();
                        if (Date.now() >= gameTime) {
                            throw new HttpsError('failed-precondition', `Game for slot ${slotId} has already started.`);
                        }
                    }
                }
            }
        }

        const updateData: Partial<BracketEntry> = {
            picks,
            tieBreakerPrediction: tieBreakerPrediction || 0,
            updatedAt: Timestamp.now().toMillis()
        };

        if (name && typeof name === 'string' && name.trim().length > 0) {
            updateData.name = name.trim();
        }

        transaction.update(entryRef, updateData as admin.firestore.UpdateData<BracketEntry>);
    });

    return { success: true };
});

// ----------------------------------------------------------------------------
// Submit Bracket Entry
// ----------------------------------------------------------------------------
export const submitBracketEntryInternal = async (
    uid: string,
    data: { poolId: string; entryId: string; picks: Record<string, string>; tieBreakerPrediction?: number; name?: string },
    db: admin.firestore.Firestore
) => {
    const { poolId, entryId, picks: newPicks, tieBreakerPrediction } = data;
    const entryRef = db.collection("pools").doc(poolId).collection("entries").doc(entryId);
    const poolRef = db.collection("pools").doc(poolId);

    await db.runTransaction(async (transaction) => {
        const entryDoc = await transaction.get(entryRef);
        if (!entryDoc.exists) throw new HttpsError("not-found", "Entry not found.");
        const entryData = entryDoc.data() as BracketEntry;

        if (entryData.ownerUid !== uid) throw new HttpsError("permission-denied", "Not your entry.");

        const poolDoc = await transaction.get(poolRef);
        const poolData = poolDoc.data() as BracketPool;

        const billingCheck = checkBillingAccess(poolData.billing);
        if (!billingCheck.allowed) {
            throw new HttpsError("failed-precondition", billingCheck.reason || "Pool is locked due to billing.");
        }

        if (poolData.status === 'LOCKED' || poolData.status === 'LIVE' || poolData.status === 'COMPLETED') {
            throw new HttpsError("failed-precondition", "Pool is locked. Submissions are closed.");
        }
        if (poolData.lockAt > 0 && Date.now() > poolData.lockAt) {
            throw new HttpsError("failed-precondition", "Pool is locked.");
        }

        if (poolData.settings?.lockUnpaid === true && entryData.paidStatus !== 'PAID') {
            throw new HttpsError("failed-precondition", "Your entry is currently unpaid. Please complete payment to submit picks.");
        }

        // Per-game lock check
        const finalPicks = newPicks || entryData.picks || {};
        const tournamentRef = db.collection('tournaments').doc(poolData.tournamentId);
        const tournamentDoc = await transaction.get(tournamentRef);
        if (tournamentDoc.exists) {
            const tournament = tournamentDoc.data();
            for (const [slotId, teamId] of Object.entries(finalPicks)) {
                if (entryData.picks?.[slotId] !== teamId) {
                    const slot = tournament?.slots?.[slotId];
                    const game = slot ? tournament?.games?.[slot.gameId] : null;
                    if (game && game.startTime) {
                        const gameTime = new Date(game.startTime).getTime();
                        if (Date.now() >= gameTime) {
                            throw new HttpsError('failed-precondition', `Game for slot ${slotId} has already started.`);
                        }
                    }
                }
            }
        }

        // Validate that bracket is complete:
        // NCAA = 63 picks (64-team bracket: 32+16+8+4+2+1)
        // Conference = total games in tournament (10 for Big East)
        const pickCount = Object.keys(finalPicks).length;
        const isConference = poolData.tournamentType === 'conference';

        let requiredPicks = 63; // Default for NCAA
        if (isConference) {
            // Look up the tournament to get actual game count
            const tournamentRef = db.collection('tournaments').doc(poolData.tournamentId);
            if (tournamentDoc.exists) {
                const tData = tournamentDoc.data();
                requiredPicks = Object.keys(tData?.games || {}).length;
            } else {
                requiredPicks = 10; // Big East default fallback
            }
        }

        if (pickCount < requiredPicks) {
            throw new HttpsError("failed-precondition", `Bracket incomplete. Only ${pickCount}/${requiredPicks} picks made.`);
        }

        const updateData: Partial<BracketEntry> = {
            status: "SUBMITTED",
            picks: finalPicks,
            tieBreakerPrediction: tieBreakerPrediction || 0,
            updatedAt: Timestamp.now().toMillis()
        };

        const { name } = data;
        if (name && typeof name === 'string' && name.trim().length > 0) {
            updateData.name = name.trim();
        }

        transaction.update(entryRef, updateData as admin.firestore.UpdateData<BracketEntry>);

        // Log audit
        const auditRef = db.collection("audit").doc();
        transaction.set(auditRef, {
            poolId,
            type: "ENTRY_SUBMITTED",
            message: `Entry ${entryData.name} submitted by ${uid}`,
            severity: "INFO",
            actor: { uid, role: "USER" },
            timestamp: Timestamp.now().toMillis()
        });
    });

    try {
        const userRec = await admin.auth().getUser(uid);
        if (userRec.email) {
            const poolDoc = await db.collection("pools").doc(poolId).get();
            const poolData = poolDoc.data();

            if (poolData) {
                const finalEntryName = (data.name && typeof data.name === 'string' && data.name.trim().length > 0) ? data.name.trim() : "Your Bracket";

                const emailHtml = renderEmailHtml(`
                    <p>Hi ${userRec.displayName || 'there'},</p>
                    <p>Your bracket entry <strong>${finalEntryName}</strong> for the pool <strong>${poolData.name}</strong> has been successfully submitted!</p>
                    <p>You can view your picks and track your performance here:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${BASE_URL}/pool/${poolId}" style="display: inline-block; padding: 12px 24px; background-color: #fca311; color: #14213d; text-decoration: none; border-radius: 4px; font-weight: bold;">View My Bracket</a>
                    </div>
                    <p>Good luck!</p>
                `, "Bracket Submitted");

                await sendEmail(
                    db,
                    userRec.email,
                    `Bracket Submitted: ${finalEntryName}`,
                    emailHtml,
                    {
                        type: "bracket_submitted",
                        poolId,
                        uid
                    }
                );
            }
        }
    } catch (e) {
        console.error("Failed to send bracket submission email:", e);
    }

    return { success: true };
};

export const submitBracketEntry = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }
    await assertNotBannedLive(request.auth.uid);
    const db = admin.firestore();
    return submitBracketEntryInternal(request.auth.uid, request.data, db);
});

// ----------------------------------------------------------------------------
// Delete Bracket Entry
// ----------------------------------------------------------------------------
export const deleteBracketEntry = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const { poolId, entryId } = request.data;
    const uid = request.auth.uid;

    if (!poolId || !entryId) {
        throw new HttpsError("invalid-argument", "Missing data.");
    }

    const db = admin.firestore();
    const entryRef = db.collection("pools").doc(poolId).collection("entries").doc(entryId);
    const poolRef = db.collection("pools").doc(poolId);

    await db.runTransaction(async (transaction) => {
        const entryDoc = await transaction.get(entryRef);
        if (!entryDoc.exists) throw new HttpsError("not-found", "Entry not found.");
        const entryData = entryDoc.data() as BracketEntry;

        const poolDoc = await transaction.get(poolRef);
        if (!poolDoc.exists) {
            throw new HttpsError("not-found", "Pool not found.");
        }
        const poolData = poolDoc.data() as BracketPool;

        if (entryData.ownerUid !== uid) {
            // Give managers the ability to delete entries as well
            if (uid !== poolData.managerUid && uid !== poolData.ownerId) {
                throw new HttpsError("permission-denied", "Not your entry. Only the owner or pool manager can delete it.");
            }
        }

        // Check pool lock — block non-managers from deleting after lock
        if (poolData.status === 'LOCKED' || poolData.status === 'LIVE' || poolData.status === 'COMPLETED' || (poolData.lockAt > 0 && Date.now() > poolData.lockAt)) {
            if (uid !== poolData.managerUid && uid !== poolData.ownerId) {
                throw new HttpsError("failed-precondition", "Cannot delete entry after pool is locked.");
            }
        }

        transaction.delete(entryRef);

        // Decrement pool entry count
        transaction.update(poolRef, {
            entryCount: FieldValue.increment(-1)
        });

        // Log audit
        const auditRef = db.collection("audit").doc();
        transaction.set(auditRef, {
            poolId,
            type: "ENTRY_DELETED",
            message: `Entry ${entryData.name || 'Unknown'} deleted by ${uid}`,
            severity: "INFO",
            actor: { uid, role: "USER" },
            timestamp: Date.now()
        });
    });

    return { success: true, message: "Entry deleted successfully" };
});


// ----------------------------------------------------------------------------
// Update Entry Payment display status (PLAN-NFL-SIM-HARNESS Phase 5)
// ----------------------------------------------------------------------------
// Replaces the client's raw `updateDoc(pools/{id}/entries/{eid}, {paidStatus})`
// (dbService.updateBracketEntryPayment), which depended on the blanket
// SUPER_ADMIN entries-write rule dropped in Phase 5 — and which ordinary
// commissioners could never use (the rule was admin-only even though the UI
// offered the toggle). Authorization mirrors setPaidStatus: owner/manager/
// creator or SUPER_ADMIN. NOTE: the entry's paidStatus is display/legacy;
// the Member Record (setPaidStatus) remains the authoritative payment truth.
export const updateEntryPayment = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }
    const uid = request.auth.uid;
    // paidAt/paymentNote support the manager ledger's detailed edit (qodo review
    // of PR #162 finding 1 — NFLManagerBentoDashboard.saveDetailedPayment was a
    // surviving raw entry write). Explicit null clears the field (parity with
    // the old client write, which stored literal nulls).
    const { poolId, entryId, paidStatus, paymentMethod, paidAt, paymentNote } = (request.data ?? {}) as {
        poolId?: string; entryId?: string; paidStatus?: string; paymentMethod?: string;
        paidAt?: number | null; paymentNote?: string | null;
    };
    if (!poolId || !entryId || (paidStatus !== 'PAID' && paidStatus !== 'UNPAID')) {
        throw new HttpsError("invalid-argument", "poolId, entryId, and paidStatus (PAID|UNPAID) are required.");
    }
    const ALLOWED_METHODS = ['Cash', 'Check', 'Venmo', 'Google Pay', 'Cash.me', 'Other'];
    if (paymentMethod !== undefined && !ALLOWED_METHODS.includes(paymentMethod)) {
        throw new HttpsError("invalid-argument", "Invalid paymentMethod.");
    }
    if (paidAt !== undefined && paidAt !== null && (typeof paidAt !== 'number' || !Number.isFinite(paidAt))) {
        throw new HttpsError("invalid-argument", "paidAt must be a timestamp or null.");
    }
    if (paymentNote !== undefined && paymentNote !== null && typeof paymentNote !== 'string') {
        throw new HttpsError("invalid-argument", "paymentNote must be a string or null.");
    }

    const db = admin.firestore();
    const poolRef = db.collection("pools").doc(poolId);
    const entryRef = poolRef.collection("entries").doc(entryId);

    await db.runTransaction(async (transaction) => {
        const poolDoc = await transaction.get(poolRef);
        if (!poolDoc.exists) throw new HttpsError("not-found", "Pool not found.");
        const pool = poolDoc.data() as Record<string, unknown>;

        const isOwner = pool.ownerId === uid || pool.managerUid === uid || pool.createdByUid === uid ||
            request.auth?.token?.role === 'SUPER_ADMIN';
        if (!isOwner) {
            throw new HttpsError("permission-denied", "Only the commissioner can update entry payment status.");
        }

        const entryDoc = await transaction.get(entryRef);
        if (!entryDoc.exists) throw new HttpsError("not-found", "Entry not found.");

        transaction.update(entryRef, {
            paidStatus,
            paymentMethod: paymentMethod ?? FieldValue.delete(),
            ...(paidAt !== undefined ? { paidAt } : {}),
            ...(paymentNote !== undefined ? { paymentNote: paymentNote === null ? null : paymentNote.slice(0, 500) } : {}),
            updatedAt: Date.now(),
        });

        const auditRef = db.collection("audit").doc();
        transaction.set(auditRef, {
            poolId,
            type: "ENTRY_PAYMENT_UPDATED",
            message: `Entry ${entryId} marked ${paidStatus} by ${uid}`,
            severity: "INFO",
            actor: { uid, role: "USER" },
            timestamp: Date.now(),
        });
    });

    return { success: true };
});

// ----------------------------------------------------------------------------
// SUPER_ADMIN entry ops (qodo review of PR #162, finding 1)
// ----------------------------------------------------------------------------
// The Phase 5 rules drop (`entries: allow write: if false`) orphaned three
// SuperAdmin dashboard actions that still raw-wrote entry docs: the paid
// toggle, the score/payout/tiebreaker overrides, and the non-BRACKET entry
// delete. The toggle now rides updateEntryPayment; these two callables carry
// the other two — SUPER_ADMIN only, allowlisted fields, audited.

const OVERRIDE_FIELDS = new Set(['score', 'payout', 'tiebreakerScore', 'tieBreakerPrediction']);

export const adminUpdateEntryOverrides = onCall(async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be logged in.");
    if (request.auth.token?.role !== 'SUPER_ADMIN') {
        throw new HttpsError("permission-denied", "Entry overrides are SUPER_ADMIN only.");
    }
    const uid = request.auth.uid;
    const { poolId, entryId, overrides } = (request.data ?? {}) as {
        poolId?: string; entryId?: string; overrides?: Record<string, unknown>;
    };
    if (!poolId || !entryId || !overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
        throw new HttpsError("invalid-argument", "poolId, entryId, and an overrides object are required.");
    }
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(overrides)) {
        if (!OVERRIDE_FIELDS.has(key)) {
            throw new HttpsError("invalid-argument", `Field "${key}" is not an allowed override.`);
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new HttpsError("invalid-argument", `Override "${key}" must be a finite number.`);
        }
        patch[key] = value;
    }
    if (Object.keys(patch).length === 0) {
        throw new HttpsError("invalid-argument", "No overrides provided.");
    }

    const db = admin.firestore();
    const entryRef = db.collection("pools").doc(poolId).collection("entries").doc(entryId);
    await db.runTransaction(async (transaction) => {
        const entryDoc = await transaction.get(entryRef);
        if (!entryDoc.exists) throw new HttpsError("not-found", "Entry not found.");
        transaction.update(entryRef, { ...patch, updatedAt: Date.now() });
        const auditRef = db.collection("audit").doc();
        transaction.set(auditRef, {
            poolId,
            type: "ENTRY_OVERRIDES_UPDATED",
            message: `Entry ${entryId} overrides ${Object.keys(patch).join(', ')} set by admin ${uid}`,
            severity: "WARNING",
            actor: { uid, role: "ADMIN" },
            payload: patch,
            timestamp: Date.now(),
        });
    });
    return { success: true };
});

export const adminDeleteEntry = onCall(async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be logged in.");
    if (request.auth.token?.role !== 'SUPER_ADMIN') {
        throw new HttpsError("permission-denied", "Admin entry deletion is SUPER_ADMIN only.");
    }
    const uid = request.auth.uid;
    const { poolId, entryId } = (request.data ?? {}) as { poolId?: string; entryId?: string };
    if (!poolId || !entryId) {
        throw new HttpsError("invalid-argument", "poolId and entryId are required.");
    }

    const db = admin.firestore();
    const poolRef = db.collection("pools").doc(poolId);
    const entryRef = poolRef.collection("entries").doc(entryId);
    await db.runTransaction(async (transaction) => {
        const entryDoc = await transaction.get(entryRef);
        if (!entryDoc.exists) throw new HttpsError("not-found", "Entry not found.");
        const entryName = (entryDoc.data() as Record<string, unknown>)?.name
            ?? (entryDoc.data() as Record<string, unknown>)?.userName ?? 'Unknown';
        transaction.delete(entryRef);
        // Transactional decrement — same rationale as deleteBracketEntry: client-side
        // count math races concurrent joins/deletes.
        transaction.update(poolRef, { entryCount: FieldValue.increment(-1) });
        const auditRef = db.collection("audit").doc();
        transaction.set(auditRef, {
            poolId,
            type: "ENTRY_DELETED",
            message: `Entry ${entryName} (${entryId}) deleted by admin ${uid}`,
            severity: "WARNING",
            actor: { uid, role: "ADMIN" },
            timestamp: Date.now(),
        });
    });
    return { success: true };
});
