/**
 * Script to promote/demote a user to/from SUPER_ADMIN.
 * Sets the Firebase Auth Custom Claim (necessary for security rules) and mirrors it in Firestore.
 * 
 * Usage:
 *   node functions/setUserAdmin.cjs <USER_UID> [role]
 * 
 * Examples:
 *   node functions/setUserAdmin.cjs abc123xyz SUPER_ADMIN
 *   node functions/setUserAdmin.cjs abc123xyz PARTICIPANT
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// 1. Initialize Firebase Admin SDK
let initialized = false;

// Try loading service account if it exists
const serviceAccountPath = path.join(__dirname, 'service-account.json');
if (fs.existsSync(serviceAccountPath)) {
    try {
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        initialized = true;
        console.log('Initialized Firebase Admin using service-account.json');
    } catch (err) {
        console.warn('Failed to initialize with service-account.json, falling back to default...');
    }
}

// Fallback to Application Default Credentials
if (!initialized) {
    try {
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            projectId: 'gridiron-gamble-uzuqo'
        });
        console.log('Initialized Firebase Admin using applicationDefault()');
    } catch (err) {
        console.error('Failed to initialize Firebase Admin SDK:', err.message);
        console.error('Make sure you have set GOOGLE_APPLICATION_CREDENTIALS or logged in via `gcloud auth application-default login`');
        process.exit(1);
    }
}

const db = admin.firestore();
const auth = admin.auth();

async function setRole(uid, role) {
    if (!uid) {
        console.error('Error: Please provide a User UID.');
        console.log('Usage: node functions/setUserAdmin.cjs <USER_UID> [SUPER_ADMIN|POOL_MANAGER|PARTICIPANT]');
        process.exit(1);
    }

    const targetRole = (role || 'SUPER_ADMIN').toUpperCase();
    if (!['SUPER_ADMIN', 'POOL_MANAGER', 'PARTICIPANT'].includes(targetRole)) {
        console.error(`Error: Invalid role "${targetRole}". Must be one of: SUPER_ADMIN, POOL_MANAGER, PARTICIPANT`);
        process.exit(1);
    }

    try {
        // Verify user exists in Firebase Auth
        console.log(`Verifying user ${uid} exists in Firebase Auth...`);
        const userRecord = await auth.getUser(uid);
        console.log(`Found User: ${userRecord.displayName || 'No Name'} (${userRecord.email})`);

        // Set custom user claims
        console.log(`Setting Auth Custom Claims for ${uid} to { role: "${targetRole}" }...`);
        await auth.setCustomUserClaims(uid, { role: targetRole });

        // Update Firestore users/{uid} document
        console.log(`Updating Firestore document users/${uid} to role: "${targetRole}"...`);
        await db.collection('users').doc(uid).set({
            role: targetRole
        }, { merge: true });

        console.log('--------------------------------------------------');
        console.log(`SUCCESS: User ${uid} is now a ${targetRole}!`);
        console.log('Important: The user needs to refresh their Auth token (e.g. by logging out and in, or force-refreshing their token) for the claims to take effect in the browser client.');
        process.exit(0);
    } catch (error) {
        console.error('Error setting user role:', error.message);
        process.exit(1);
    }
}

const args = process.argv.slice(2);
setRole(args[0], args[1]);
