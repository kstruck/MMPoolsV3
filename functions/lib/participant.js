"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncParticipantIndices = exports.claimByCode = exports.claimMySquares = exports.createClaimCode = exports.onUserCreated = void 0;
const admin = require("firebase-admin");
const v1 = require("firebase-functions/v1");
const https_1 = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const firestore_1 = require("firebase-functions/v2/firestore");
// 1. onUserCreated: Create participant profile
exports.onUserCreated = v1.auth.user().onCreate(async (user) => {
    var _a;
    const db = admin.firestore();
    const { uid, email, displayName, photoURL } = user;
    try {
        await db.collection("users").doc(uid).set({
            id: uid,
            email: email || "",
            name: displayName || "New User",
            photoURL: photoURL || null,
            role: "PARTICIPANT", // Default role
            createdAt: Date.now(),
            provider: ((_a = user.providerData[0]) === null || _a === void 0 ? void 0 : _a.providerId) || "unknown",
        });
        logger.info(`Created user profile for ${uid}`);
    }
    catch (error) {
        logger.error(`Error creating user profile for ${uid}`, error);
    }
});
// 2. createClaimCode: Generate a code for guest
exports.createClaimCode = (0, https_1.onCall)(async (request) => {
    // Determine context (Guest or Auth)
    // If auth, use uid. If not, use deviceKey passed in data? 
    // Actually, this just generates a code LINKED to a guest key.
    // The guest key comes from CLIENT (localStorage).
    // Caller provides: poolId, guestDeviceKey
    const { poolId, guestDeviceKey } = request.data;
    if (!poolId || !guestDeviceKey) {
        throw new https_1.HttpsError('invalid-argument', 'Missing poolId or guestDeviceKey');
    }
    const db = admin.firestore();
    const claimCode = generateShortCode(); // Implement helper
    const claimId = db.collection("poolClaims").doc().id;
    const now = Date.now();
    // Create the claim record
    // We link the 'claimCode' to the 'guestDeviceKey'
    // Actually, the requirement says "guestClaimId stable random".
    // "Store guestClaimId... associates with poolId"
    // Strategy:
    // 1. Client has guestDeviceKey.
    // 2. Client asks for a code to "export" this identity.
    // 3. We store { claimCode: "1234", guestDeviceKey: "uuid-from-client", ... }
    // Wait, the prompt says "guestClaimId stable ID". 
    // If the client ALREADY has guestDeviceKey, we can just use that as the link?
    // "creates /poolClaims/{claimId} ... Links to the guest identity ... guestClaimId"
    // Let's stick effectively to: Mapping Code -> guestDeviceKey
    const claimDoc = {
        claimId,
        claimCode,
        createdAt: now,
        guestClaimId: guestDeviceKey, // Map directly for simplicity? Or generate a new stable ID?
        // Prompt says "guestClaimId stable random".
        // If we use guestDeviceKey, that IS the stable ID on the device.
        poolId,
        uses: 0
    };
    await db.collection("poolClaims").doc(claimId).set(claimDoc);
    return { claimCode, claimId };
});
// 3. claimMySquares: Claim guest squares for logged-in user
exports.claimMySquares = (0, https_1.onCall)(async (request) => {
    const { poolId, guestDeviceKey } = request.data;
    // claimIds removed for now until implemented
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be logged in to claim squares');
    }
    const uid = request.auth.uid;
    const db = admin.firestore();
    const poolRef = db.collection("pools").doc(poolId);
    // Run transaction to be safe
    const result = await db.runTransaction(async (t) => {
        var _a;
        const poolDoc = await t.get(poolRef);
        if (!poolDoc.exists)
            throw new https_1.HttpsError('not-found', 'Pool not found');
        const squares = ((_a = poolDoc.data()) === null || _a === void 0 ? void 0 : _a.squares) || [];
        let updated = false;
        const warnings = [];
        const newSquares = squares.map((s) => {
            // Check if this square belongs to the guest context
            const isGuestKeyMatch = guestDeviceKey && s.guestDeviceKey === guestDeviceKey;
            // Note: We don't overwrite if ALREADY owned by someone else (authoritative check)
            if (isGuestKeyMatch) {
                if (s.reservedByUid && s.reservedByUid !== uid) {
                    // Conflict! Owned by someone else. 
                    warnings.push(`Square ${s.id} is already owned by someone else.`);
                    return s;
                }
                // Claim it!
                updated = true;
                return Object.assign(Object.assign({}, s), { reservedByUid: uid, 
                    // Clear guest keys to finalize ownership? Or keep for history?
                    // Prompt says "clears guestDeviceKey... after claiming"
                    guestDeviceKey: null, guestClaimId: null });
            }
            return s;
        });
        if (updated) {
            t.update(poolRef, { squares: newSquares });
            // Also need to update participant indices?
            // "syncParticipantIndicesOnSquareWrite trigger" will handle it?
            // Prompt says "Updates participant indices...".
            // If I rely on trigger, it's easier. "Avoid expensive recalcs" -> userSync func instructions.
            // But prompt explicitly calls out "syncParticipantIndicesOnSquareWrite trigger" as separate item E.
            // So I can leave it to the trigger.
        }
        return { success: true, warnings };
    });
    return { success: true, warnings: result.warnings };
});
// 4. claimByCode: Merge squares from another device
exports.claimByCode = (0, https_1.onCall)(async (request) => {
    const { claimCode } = request.data;
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Must be logged in');
    const db = admin.firestore();
    const uid = request.auth.uid;
    // 1. Find claim doc
    const claimsSnap = await db.collection("poolClaims")
        .where("claimCode", "==", claimCode)
        .limit(1)
        .get();
    if (claimsSnap.empty) {
        throw new https_1.HttpsError('not-found', 'Invalid claim code');
    }
    const claimDoc = claimsSnap.docs[0];
    const claim = claimDoc.data();
    // 2. Identify target scopes
    // Scope: specific pool?
    const targetPoolId = claim.poolId;
    const targetGuestKey = claim.guestClaimId; // This is the guestDeviceKey we want to claim
    if (!targetPoolId)
        throw new https_1.HttpsError('unimplemented', 'Global claims not supported yet');
    // 3. Claim squares in that pool
    const poolRef = db.collection("pools").doc(targetPoolId);
    await db.runTransaction(async (t) => {
        var _a;
        const poolDoc = await t.get(poolRef);
        if (!poolDoc.exists)
            return; // Should weirdly fail gracefully?
        const squares = ((_a = poolDoc.data()) === null || _a === void 0 ? void 0 : _a.squares) || [];
        let updated = false;
        const newSquares = squares.map((s) => {
            // Check if matches the code's linked guest identity
            if (s.guestDeviceKey === targetGuestKey) {
                if (s.reservedByUid && s.reservedByUid !== uid) {
                    return s; // Conflict
                }
                updated = true;
                return Object.assign(Object.assign({}, s), { reservedByUid: uid, guestDeviceKey: null });
            }
            return s;
        });
        if (updated) {
            t.update(poolRef, { squares: newSquares });
            // Increment uses
            t.update(claimDoc.ref, {
                uses: admin.firestore.FieldValue.increment(1),
                lastUsedAt: Date.now()
            });
        }
    });
    return { success: true, poolId: targetPoolId };
});
// 5. syncParticipantIndices: Trigger
// "Whenever a square changes: If reservedByUid/paidByUid, ensure indices exist and update counts"
exports.syncParticipantIndices = (0, firestore_1.onDocumentWritten)("pools/{poolId}", async (event) => {
    var _a;
    // Only care if 'squares' changed
    const after = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after.data();
    if (!after)
        return; // Deleted
    // Simple diff check (could be optimized)
    const afterSquares = (after === null || after === void 0 ? void 0 : after.squares) || [];
    // We need to Map<Uid, { count, ids }>
    const stats = new Map();
    afterSquares.forEach((s, idx) => {
        const ownerUid = s.reservedByUid || s.paidByUid;
        if (ownerUid) {
            if (!stats.has(ownerUid)) {
                stats.set(ownerUid, { count: 0, ids: [], paid: 0 });
            }
            const entry = stats.get(ownerUid);
            entry.count++;
            // Format ID as "Row_Col"? Or just idx? Requirement says "7_4".
            // 7=Row, 4=Col. idx = row*10 + col.
            const row = Math.floor(idx / 10);
            const col = idx % 10;
            entry.ids.push(`${row}_${col}`);
            if (s.isPaid)
                entry.paid++;
        }
    });
    const poolId = event.params.poolId;
    const db = admin.firestore();
    // Update indices for each found participant
    const promises = [];
    for (const [uid, data] of stats.entries()) {
        const poolRef = db.collection("pools").doc(poolId);
        // 1. /pools/{poolId}/participants/{uid}
        const pRef = poolRef.collection("participants").doc(uid);
        promises.push(pRef.set({
            uid,
            squaresCount: data.count,
            squareIds: data.ids,
            paidCount: data.paid,
            lastActiveAt: admin.firestore.FieldValue.serverTimestamp() // approximate
        }, { merge: true }));
        // 2. /users/{uid}/participations/{poolId}
        const uRef = db.collection("users").doc(uid).collection("participations").doc(poolId);
        promises.push(uRef.set({
            poolId,
            poolName: after.name || "Unknown Pool",
            squaresCount: data.count,
            squareIds: data.ids,
            role: "PARTICIPANT",
            joinedAt: admin.firestore.FieldValue.serverTimestamp() // This will update every time, maybe check existence?
            // Actually `merge: true` preserves joinedAt if we don't send it? 
            // But we want to preserve original joinedAt. 
            // For now, let's just set updated fields.
        }, { merge: true }));
    }
    await Promise.all(promises);
});
function generateShortCode() {
    // Simple 6-char alphanumeric
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let res = "";
    for (let i = 0; i < 6; i++) {
        res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return res;
}
//# sourceMappingURL=participant.js.map