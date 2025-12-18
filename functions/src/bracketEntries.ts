
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { BracketPool, BracketEntry } from "./types";
import { Timestamp } from "firebase-admin/firestore";

const db = admin.firestore();

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

    const { poolId, entryId, picks, tieBreakerPrediction } = request.data;
    const uid = request.auth.uid;

    if (!poolId || !entryId || !picks) {
        throw new HttpsError("invalid-argument", "Missing data.");
    }

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

        if (entryData.status === 'SUBMITTED') {
            // Allow updates if not locked yet? Usually SUBMITTED means ready, but can edit until lock.
            // Requirement: "Submit before lock; after submit and after lock, picks immutable."
            // This implies if I submit, I can't edit? Or allows "Unsubmit"?
            // Usually bracket pools allow editing until lock.
            // But let's follow strict instruction: "after submit... picks immutable". 
            throw new HttpsError("failed-precondition", "Entry already submitted.");
        }

        // Check pool lock
        const poolDoc = await transaction.get(poolRef);
        const poolData = poolDoc.data() as BracketPool;
        if (poolData.lockAt > 0 && Date.now() > poolData.lockAt) {
            throw new HttpsError("failed-precondition", "Pool is locked.");
        }

        transaction.update(entryRef, {
            picks,
            tieBreakerPrediction: tieBreakerPrediction || 0,
            updatedAt: Timestamp.now().toMillis()
        });
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

    const { poolId, entryId } = request.data;
    const uid = request.auth.uid;

    const entryRef = db.collection("pools").doc(poolId).collection("entries").doc(entryId);
    const poolRef = db.collection("pools").doc(poolId);

    await db.runTransaction(async (transaction) => {
        const entryDoc = await transaction.get(entryRef);
        if (!entryDoc.exists) throw new HttpsError("not-found", "Entry not found.");
        const entryData = entryDoc.data() as BracketEntry;

        if (entryData.ownerUid !== uid) throw new HttpsError("permission-denied", "Not your entry.");
        if (entryData.status === 'SUBMITTED') throw new HttpsError("failed-precondition", "Already submitted.");

        const poolDoc = await transaction.get(poolRef);
        const poolData = poolDoc.data() as BracketPool;
        if (poolData.lockAt > 0 && Date.now() > poolData.lockAt) {
            throw new HttpsError("failed-precondition", "Pool is locked.");
        }

        // Validate complete bracket?
        // Ideally we validate that all slots are filled.
        // For V1, client creates valid structure, strict server validation of 63 picks is good practice.
        // I will assume `picks` key count checking for now.
        const pickCount = Object.keys(entryData.picks || {}).length;
        if (pickCount < 63) {
            // 63 games in a 64 bracket.
            // Wait, does this include First Four? 
            // "Participants do NOT pick between Team A and Team B... No scoring for First Four."
            // So 63 picks for the main bracket.
            // If we allow saving incomplete drafts, we must validate here.
            throw new HttpsError("failed-precondition", `Bracket incomplete. Only ${pickCount}/63 picks made.`);
        }

        transaction.update(entryRef, {
            status: "SUBMITTED",
            updatedAt: Timestamp.now().toMillis()
        });

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

    return { success: true };
});


