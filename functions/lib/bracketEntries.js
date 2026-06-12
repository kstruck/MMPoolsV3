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
exports.deleteBracketEntry = exports.submitBracketEntry = exports.submitBracketEntryInternal = exports.updateBracketEntry = exports.createBracketEntry = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const billing_1 = require("./billing");
const firestore_1 = require("firebase-admin/firestore");
const reminders_1 = require("./reminders");
const emailStyles_1 = require("./emailStyles");
// ----------------------------------------------------------------------------
// Create Bracket Entry (Draft)
// ----------------------------------------------------------------------------
exports.createBracketEntry = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be logged in.");
    }
    const { poolId, name } = request.data;
    const uid = request.auth.uid;
    if (!poolId || !name) {
        throw new https_1.HttpsError("invalid-argument", "Missing poolId or entry name.");
    }
    const db = admin.firestore();
    const poolRef = db.collection("pools").doc(poolId);
    // Check constraints in Transaction
    const entryId = await db.runTransaction(async (transaction) => {
        var _a, _b;
        const poolDoc = await transaction.get(poolRef);
        if (!poolDoc.exists) {
            throw new https_1.HttpsError("not-found", "Pool not found.");
        }
        const poolData = poolDoc.data();
        const billingStatus = (_b = (_a = poolData.billing) === null || _a === void 0 ? void 0 : _a.status) !== null && _b !== void 0 ? _b : 'free';
        if (billingStatus === 'free') {
            const currentEntriesCount = poolData.entryCount || 0;
            if (currentEntriesCount >= 10) {
                throw new https_1.HttpsError("failed-precondition", "This pool is on the Free Plan and has reached the limit of 10 participants. The pool manager must upgrade to premium to allow more participants to join.");
            }
        }
        // Check lock status — only OPEN pools accept new entries
        if (poolData.status !== 'OPEN' && poolData.status !== 'DRAFT') {
            throw new https_1.HttpsError("failed-precondition", "Pool is not accepting new entries.");
        }
        if (poolData.lockAt > 0 && Date.now() > poolData.lockAt) {
            throw new https_1.HttpsError("failed-precondition", "Pool is locked.");
        }
        // Check max entries per user
        const maxPerUser = poolData.settings.maxEntriesPerUser;
        if (maxPerUser > 0) {
            const userEntriesSnapshot = await transaction.get(poolRef.collection("entries").where("ownerUid", "==", uid));
            if (userEntriesSnapshot.size >= maxPerUser) {
                throw new https_1.HttpsError("resource-exhausted", `Max entries per user (${maxPerUser}) reached.`);
            }
        }
        // Check max entries total
        const maxTotal = poolData.settings.maxEntriesTotal;
        if (maxTotal > 0) {
            // Note: entryCount on pool might be approximate, better to trust it or use aggregation query if high scale.
            // For v1, trusting the counter or checking size if small. 
            // Using poolData.entryCount for efficiency.
            if ((poolData.entryCount || 0) >= maxTotal) {
                throw new https_1.HttpsError("resource-exhausted", `Pool is full (${maxTotal} entries).`);
            }
        }
        // Create Entry
        const newEntryRef = poolRef.collection("entries").doc();
        const now = firestore_1.Timestamp.now().toMillis();
        const newEntry = {
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
            entryCount: admin.firestore.FieldValue.increment(1),
            participantIds: admin.firestore.FieldValue.arrayUnion(uid)
        });
        return newEntryRef.id;
    });
    return { success: true, entryId };
});
// ----------------------------------------------------------------------------
// Update Bracket Entry (Draft Picks)
// ----------------------------------------------------------------------------
exports.updateBracketEntry = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be logged in.");
    }
    const { poolId, entryId, picks, tieBreakerPrediction, name } = request.data;
    const uid = request.auth.uid;
    if (!poolId || !entryId || !picks) {
        throw new https_1.HttpsError("invalid-argument", "Missing data.");
    }
    const db = admin.firestore();
    const entryRef = db.collection("pools").doc(poolId).collection("entries").doc(entryId);
    const poolRef = db.collection("pools").doc(poolId);
    await db.runTransaction(async (transaction) => {
        var _a, _b, _c;
        const entryDoc = await transaction.get(entryRef);
        if (!entryDoc.exists) {
            throw new https_1.HttpsError("not-found", "Entry not found.");
        }
        const entryData = entryDoc.data();
        if (entryData.ownerUid !== uid) {
            throw new https_1.HttpsError("permission-denied", "Not your entry.");
        }
        // Check pool lock — only OPEN pools allow edits
        const poolDoc = await transaction.get(poolRef);
        const poolData = poolDoc.data();
        const billingCheck = (0, billing_1.checkBillingAccess)(poolData.billing);
        if (!billingCheck.allowed) {
            throw new https_1.HttpsError("failed-precondition", billingCheck.reason || "Pool is locked due to billing.");
        }
        if (poolData.status === 'LOCKED' || poolData.status === 'LIVE' || poolData.status === 'COMPLETED') {
            throw new https_1.HttpsError("failed-precondition", "Pool is locked. No edits allowed.");
        }
        if (poolData.lockAt > 0 && Date.now() > poolData.lockAt) {
            throw new https_1.HttpsError("failed-precondition", "Pool is locked.");
        }
        // Per-game lock check
        const tournamentRef = db.collection('tournaments').doc(poolData.tournamentId);
        const tournamentDoc = await transaction.get(tournamentRef);
        if (tournamentDoc.exists) {
            const tournament = tournamentDoc.data();
            for (const [slotId, teamId] of Object.entries(picks)) {
                if (((_a = entryData.picks) === null || _a === void 0 ? void 0 : _a[slotId]) !== teamId) {
                    const slot = (_b = tournament === null || tournament === void 0 ? void 0 : tournament.slots) === null || _b === void 0 ? void 0 : _b[slotId];
                    const game = slot ? (_c = tournament === null || tournament === void 0 ? void 0 : tournament.games) === null || _c === void 0 ? void 0 : _c[slot.gameId] : null;
                    if (game && game.startTime) {
                        const gameTime = new Date(game.startTime).getTime();
                        if (Date.now() >= gameTime) {
                            throw new https_1.HttpsError('failed-precondition', `Game for slot ${slotId} has already started.`);
                        }
                    }
                }
            }
        }
        const updateData = {
            picks,
            tieBreakerPrediction: tieBreakerPrediction || 0,
            updatedAt: firestore_1.Timestamp.now().toMillis()
        };
        if (name && typeof name === 'string' && name.trim().length > 0) {
            updateData.name = name.trim();
        }
        transaction.update(entryRef, updateData);
    });
    return { success: true };
});
// ----------------------------------------------------------------------------
// Submit Bracket Entry
// ----------------------------------------------------------------------------
const submitBracketEntryInternal = async (uid, data, db) => {
    const { poolId, entryId, picks: newPicks, tieBreakerPrediction } = data;
    const entryRef = db.collection("pools").doc(poolId).collection("entries").doc(entryId);
    const poolRef = db.collection("pools").doc(poolId);
    await db.runTransaction(async (transaction) => {
        var _a, _b, _c, _d;
        const entryDoc = await transaction.get(entryRef);
        if (!entryDoc.exists)
            throw new https_1.HttpsError("not-found", "Entry not found.");
        const entryData = entryDoc.data();
        if (entryData.ownerUid !== uid)
            throw new https_1.HttpsError("permission-denied", "Not your entry.");
        const poolDoc = await transaction.get(poolRef);
        const poolData = poolDoc.data();
        const billingCheck = (0, billing_1.checkBillingAccess)(poolData.billing);
        if (!billingCheck.allowed) {
            throw new https_1.HttpsError("failed-precondition", billingCheck.reason || "Pool is locked due to billing.");
        }
        if (poolData.status === 'LOCKED' || poolData.status === 'LIVE' || poolData.status === 'COMPLETED') {
            throw new https_1.HttpsError("failed-precondition", "Pool is locked. Submissions are closed.");
        }
        if (poolData.lockAt > 0 && Date.now() > poolData.lockAt) {
            throw new https_1.HttpsError("failed-precondition", "Pool is locked.");
        }
        if (((_a = poolData.settings) === null || _a === void 0 ? void 0 : _a.lockUnpaid) === true && entryData.paidStatus !== 'PAID') {
            throw new https_1.HttpsError("failed-precondition", "Your entry is currently unpaid. Please complete payment to submit picks.");
        }
        // Per-game lock check
        const finalPicks = newPicks || entryData.picks || {};
        const tournamentRef = db.collection('tournaments').doc(poolData.tournamentId);
        const tournamentDoc = await transaction.get(tournamentRef);
        if (tournamentDoc.exists) {
            const tournament = tournamentDoc.data();
            for (const [slotId, teamId] of Object.entries(finalPicks)) {
                if (((_b = entryData.picks) === null || _b === void 0 ? void 0 : _b[slotId]) !== teamId) {
                    const slot = (_c = tournament === null || tournament === void 0 ? void 0 : tournament.slots) === null || _c === void 0 ? void 0 : _c[slotId];
                    const game = slot ? (_d = tournament === null || tournament === void 0 ? void 0 : tournament.games) === null || _d === void 0 ? void 0 : _d[slot.gameId] : null;
                    if (game && game.startTime) {
                        const gameTime = new Date(game.startTime).getTime();
                        if (Date.now() >= gameTime) {
                            throw new https_1.HttpsError('failed-precondition', `Game for slot ${slotId} has already started.`);
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
                requiredPicks = Object.keys((tData === null || tData === void 0 ? void 0 : tData.games) || {}).length;
            }
            else {
                requiredPicks = 10; // Big East default fallback
            }
        }
        if (pickCount < requiredPicks) {
            throw new https_1.HttpsError("failed-precondition", `Bracket incomplete. Only ${pickCount}/${requiredPicks} picks made.`);
        }
        const updateData = {
            status: "SUBMITTED",
            picks: finalPicks,
            tieBreakerPrediction: tieBreakerPrediction || 0,
            updatedAt: firestore_1.Timestamp.now().toMillis()
        };
        const { name } = data;
        if (name && typeof name === 'string' && name.trim().length > 0) {
            updateData.name = name.trim();
        }
        transaction.update(entryRef, updateData);
        // Log audit
        const auditRef = db.collection("audit").doc();
        transaction.set(auditRef, {
            poolId,
            type: "ENTRY_SUBMITTED",
            message: `Entry ${entryData.name} submitted by ${uid}`,
            severity: "INFO",
            actor: { uid, role: "USER" },
            timestamp: firestore_1.Timestamp.now().toMillis()
        });
    });
    try {
        const userRec = await admin.auth().getUser(uid);
        if (userRec.email) {
            const poolDoc = await db.collection("pools").doc(poolId).get();
            const poolData = poolDoc.data();
            if (poolData) {
                const finalEntryName = (data.name && typeof data.name === 'string' && data.name.trim().length > 0) ? data.name.trim() : "Your Bracket";
                const emailHtml = (0, emailStyles_1.renderEmailHtml)(`
                    <p>Hi ${userRec.displayName || 'there'},</p>
                    <p>Your bracket entry <strong>${finalEntryName}</strong> for the pool <strong>${poolData.name}</strong> has been successfully submitted!</p>
                    <p>You can view your picks and track your performance here:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${emailStyles_1.BASE_URL}/pool/${poolId}" style="display: inline-block; padding: 12px 24px; background-color: #fca311; color: #14213d; text-decoration: none; border-radius: 4px; font-weight: bold;">View My Bracket</a>
                    </div>
                    <p>Good luck!</p>
                `, "Bracket Submitted");
                await (0, reminders_1.sendEmail)(db, userRec.email, `Bracket Submitted: ${finalEntryName}`, emailHtml, {
                    type: "bracket_submitted",
                    poolId,
                    uid
                });
            }
        }
    }
    catch (e) {
        console.error("Failed to send bracket submission email:", e);
    }
    return { success: true };
};
exports.submitBracketEntryInternal = submitBracketEntryInternal;
exports.submitBracketEntry = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be logged in.");
    }
    const db = admin.firestore();
    return (0, exports.submitBracketEntryInternal)(request.auth.uid, request.data, db);
});
// ----------------------------------------------------------------------------
// Delete Bracket Entry
// ----------------------------------------------------------------------------
exports.deleteBracketEntry = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be logged in.");
    }
    const { poolId, entryId } = request.data;
    const uid = request.auth.uid;
    if (!poolId || !entryId) {
        throw new https_1.HttpsError("invalid-argument", "Missing data.");
    }
    const db = admin.firestore();
    const entryRef = db.collection("pools").doc(poolId).collection("entries").doc(entryId);
    const poolRef = db.collection("pools").doc(poolId);
    await db.runTransaction(async (transaction) => {
        const entryDoc = await transaction.get(entryRef);
        if (!entryDoc.exists)
            throw new https_1.HttpsError("not-found", "Entry not found.");
        const entryData = entryDoc.data();
        const poolDoc = await transaction.get(poolRef);
        if (!poolDoc.exists) {
            throw new https_1.HttpsError("not-found", "Pool not found.");
        }
        const poolData = poolDoc.data();
        if (entryData.ownerUid !== uid) {
            // Give managers the ability to delete entries as well
            if (uid !== poolData.managerUid && uid !== poolData.ownerId) {
                throw new https_1.HttpsError("permission-denied", "Not your entry. Only the owner or pool manager can delete it.");
            }
        }
        // Check pool lock — block non-managers from deleting after lock
        if (poolData.status === 'LOCKED' || poolData.status === 'LIVE' || poolData.status === 'COMPLETED' || (poolData.lockAt > 0 && Date.now() > poolData.lockAt)) {
            if (uid !== poolData.managerUid && uid !== poolData.ownerId) {
                throw new https_1.HttpsError("failed-precondition", "Cannot delete entry after pool is locked.");
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
            message: `Entry ${entryData.name || 'Unknown'} deleted by ${uid}`,
            severity: "INFO",
            actor: { uid, role: "USER" },
            timestamp: Date.now()
        });
    });
    return { success: true, message: "Entry deleted successfully" };
});
//# sourceMappingURL=bracketEntries.js.map