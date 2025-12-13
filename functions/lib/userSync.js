"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onUserCreated = void 0;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
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
                lastLogin: admin.firestore.FieldValue.serverTimestamp()
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
//# sourceMappingURL=userSync.js.map