"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncAllUsers = exports.onUserCreated = void 0;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const db = admin.firestore();
exports.onUserCreated = functions.auth.user().onCreate(async (user) => {
    const { uid, email, displayName, photoURL } = user;
    // Determine registration method
    let method = 'unknown';
    if (user.providerData && user.providerData.length > 0) {
        const providerId = user.providerData[0].providerId;
        if (providerId === 'google.com')
            method = 'google';
        else if (providerId === 'password')
            method = 'email';
    }
    const name = displayName || (email === null || email === void 0 ? void 0 : email.split('@')[0]) || 'Unknown User';
    try {
        const userRef = db.collection("users").doc(uid);
        const doc = await userRef.get();
        if (!doc.exists) {
            await userRef.set({
                id: uid,
                name,
                email: email || "",
                picture: photoURL || null,
                registrationMethod: method,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                lastLogin: admin.firestore.FieldValue.serverTimestamp(),
                role: 'PARTICIPANT'
            });
            console.log(`[UserSync] Successfully synced user ${uid} (${email}) to Firestore.`);
        }
        else {
            console.log(`[UserSync] User ${uid} already exists in Firestore. Using merge just in case.`);
            await userRef.set({
                email: email || "", // Ensure email is up to date
                lastLogin: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
    }
    catch (error) {
        console.error(`[UserSync] Failed to sync user ${uid}:`, error);
    }
});
// Force Sync All Users (Callable)
exports.syncAllUsers = (0, https_1.onCall)(async (request) => {
    var _a;
    if (!request.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    try {
        // List max 1000 users (pagination needed for large apps, but fine for MVP)
        const listUsersResult = await admin.auth().listUsers(1000);
        const users = listUsersResult.users;
        const batch = db.batch();
        let count = 0;
        for (const user of users) {
            const userRef = db.collection("users").doc(user.uid);
            let method = 'unknown';
            if (user.providerData && user.providerData.length > 0) {
                const pid = user.providerData[0].providerId;
                if (pid === 'google.com')
                    method = 'google';
                else if (pid === 'password')
                    method = 'email';
            }
            const userData = {
                id: user.uid,
                name: user.displayName || ((_a = user.email) === null || _a === void 0 ? void 0 : _a.split('@')[0]) || 'Unknown',
                email: user.email || '',
                picture: user.photoURL || null,
                registrationMethod: method,
                // Don't overwrite createdAt if it exists, but ensure sync timestamp
                syncedAt: admin.firestore.FieldValue.serverTimestamp()
            };
            batch.set(userRef, userData, { merge: true });
            count++;
        }
        await batch.commit();
        return { success: true, count };
    }
    catch (error) {
        console.error("Sync Users Error:", error);
        throw new functions.https.HttpsError('internal', 'Failed to sync users.');
    }
});
//# sourceMappingURL=userSync.js.map