
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { BracketPool, BracketEntry } from "./types";
import { Timestamp } from "firebase-admin/firestore";
import { sendEmail } from "./reminders";
import { renderEmailHtml, BASE_URL } from "./emailStyles";



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

        // Check lock status
        if (poolData.status === 'LOCKED' || poolData.status === 'COMPLETED' || (poolData.lockAt > 0 && Date.now() > poolData.lockAt)) {
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

        // Increment pool entry count
        transaction.update(poolRef, {
            entryCount: admin.firestore.FieldValue.increment(1)
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

        // Check pool lock
        const poolDoc = await transaction.get(poolRef);
        const poolData = poolDoc.data() as BracketPool;
        if (poolData.lockAt > 0 && Date.now() > poolData.lockAt) {
            throw new HttpsError("failed-precondition", "Pool is locked.");
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
export const submitBracketEntry = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const { poolId, entryId, picks: newPicks, tieBreakerPrediction } = request.data;
    const uid = request.auth.uid;

    const db = admin.firestore();
    const entryRef = db.collection("pools").doc(poolId).collection("entries").doc(entryId);
    const poolRef = db.collection("pools").doc(poolId);

    await db.runTransaction(async (transaction) => {
        const entryDoc = await transaction.get(entryRef);
        if (!entryDoc.exists) throw new HttpsError("not-found", "Entry not found.");
        const entryData = entryDoc.data() as BracketEntry;

        if (entryData.ownerUid !== uid) throw new HttpsError("permission-denied", "Not your entry.");

        const poolDoc = await transaction.get(poolRef);
        const poolData = poolDoc.data() as BracketPool;
        if (poolData.lockAt > 0 && Date.now() > poolData.lockAt) {
            throw new HttpsError("failed-precondition", "Pool is locked.");
        }

        // Validate that bracket is complete:
        // NCAA = 63 picks (64-team bracket: 32+16+8+4+2+1)
        // Conference = total games in tournament (10 for Big East)
        const finalPicks = newPicks || entryData.picks || {};
        const pickCount = Object.keys(finalPicks).length;
        const isConference = poolData.tournamentType === 'conference';

        let requiredPicks = 63; // Default for NCAA
        if (isConference) {
            // Look up the tournament to get actual game count
            const tournamentRef = db.collection('tournaments').doc(poolData.tournamentId);
            const tournamentDoc = await transaction.get(tournamentRef);
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

        const { name } = request.data;
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
            const poolDoc = await admin.firestore().collection("pools").doc(poolId).get();
            const poolData = poolDoc.data();

            if (poolData) {
                const finalEntryName = (request.data.name && typeof request.data.name === 'string' && request.data.name.trim().length > 0) ? request.data.name.trim() : "Your Bracket";

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
        const poolData = poolDoc.data() as BracketPool;

        if (entryData.ownerUid !== uid) {
            // Give managers the ability to delete entries as well
            if (uid !== poolData.managerUid && uid !== poolData.ownerId) {
                throw new HttpsError("permission-denied", "Not your entry. Only the owner or pool manager can delete it.");
            }
        }

        // Check pool lock
        if (poolData.status === 'LOCKED' || poolData.status === 'COMPLETED' || (poolData.lockAt > 0 && Date.now() > poolData.lockAt)) {
            // Managers could potentially bypass this, but for now we follow playoff structure:
            if (uid !== poolData.managerUid && uid !== poolData.ownerId) {
                throw new HttpsError("failed-precondition", "Cannot delete entry after pool is locked.");
            }
        }

        transaction.delete(entryRef);

        // Decrement pool entry count
        transaction.update(poolRef, {
            entryCount: admin.firestore.FieldValue.increment(-1)
        });

        // Log audit
        const auditRef = db.collection("audit").doc();
        transaction.set(auditRef, {
            poolId,
            type: "ENTRY_DELETED",
            message: `Entry ${entryData.name} deleted by ${uid}`,
            severity: "INFO",
            actor: { uid, role: "USER" },
            timestamp: Timestamp.now().toMillis()
        });
    });

    return { success: true, message: "Entry deleted successfully" };
});

