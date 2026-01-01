"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.joinBracketPool = exports.publishBracketPool = exports.createBracketPool = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const crypto = require("crypto");
const db = admin.firestore();
// ----------------------------------------------------------------------------
// Create Bracket Pool (Draft)
// ----------------------------------------------------------------------------
exports.createBracketPool = (0, https_1.onCall)(async (request) => {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be logged in.");
    }
    const { name, settings, seasonYear, gender } = request.data;
    const uid = request.auth.uid;
    // Debug logs
    console.log("createBracketPool called by:", uid);
    console.log("Request Data:", JSON.stringify(request.data, null, 2));
    if (!name || !seasonYear) {
        console.error("Missing required fields");
        throw new https_1.HttpsError("invalid-argument", "Missing required fields.");
    }
    // Create a base slug suggestion
    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const slug = `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}`;
    const poolRef = db.collection("pools").doc();
    const now = firestore_1.Timestamp.now().toMillis();
    console.log("Constructing new pool object...");
    const newPool = {
        id: poolRef.id,
        type: "BRACKET",
        name,
        slug, // temporary, finalized on publish
        slugLower: slug.toLowerCase(),
        managerUid: uid,
        ownerId: uid, // Added for backward compatibility/rules
        seasonYear,
        gender: gender || 'mens',
        isListedPublic: false,
        status: "DRAFT",
        lockAt: 0, // Set on publish or specific date
        settings: Object.assign({ maxEntriesTotal: (_a = settings === null || settings === void 0 ? void 0 : settings.maxEntriesTotal) !== null && _a !== void 0 ? _a : -1, maxEntriesPerUser: (_b = settings === null || settings === void 0 ? void 0 : settings.maxEntriesPerUser) !== null && _b !== void 0 ? _b : -1, entryFee: (_c = settings === null || settings === void 0 ? void 0 : settings.entryFee) !== null && _c !== void 0 ? _c : 0, paymentInstructions: (_d = settings === null || settings === void 0 ? void 0 : settings.paymentInstructions) !== null && _d !== void 0 ? _d : "", scoringSystem: (_e = settings === null || settings === void 0 ? void 0 : settings.scoringSystem) !== null && _e !== void 0 ? _e : "CLASSIC", 
            // Firestore doesn't like undefined. Use null or omit.
            customScoring: (settings === null || settings === void 0 ? void 0 : settings.scoringSystem) === 'CUSTOM' ? (settings.customScoring || null) : null, tieBreakers: (_f = settings === null || settings === void 0 ? void 0 : settings.tieBreakers) !== null && _f !== void 0 ? _f : {
                closestAbsolute: true,
                closestUnder: false,
            }, payouts: (_g = settings === null || settings === void 0 ? void 0 : settings.payouts) !== null && _g !== void 0 ? _g : {
                places: [{ rank: 1, percentage: 100 }],
                bonuses: []
            } }, settings),
        createdAt: now,
        updatedAt: now,
    };
    console.log("New Pool Object:", JSON.stringify(newPool, null, 2));
    await poolRef.set(newPool);
    console.log("Pool created successfully:", poolRef.id);
    // Add audit log
    await db.collection("audit").add({
        poolId: poolRef.id,
        type: "POOL_CREATED",
        message: `Bracket Pool created by ${uid}`,
        severity: "INFO",
        actor: { uid, role: "USER" },
        timestamp: now,
    });
    return { poolId: poolRef.id };
});
// ----------------------------------------------------------------------------
// Publish Bracket Pool (Reserve Slug & Set Password)
// ----------------------------------------------------------------------------
exports.publishBracketPool = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be logged in.");
    }
    const { poolId, slug, password, isListedPublic } = request.data;
    const uid = request.auth.uid;
    if (!poolId || !slug) {
        throw new https_1.HttpsError("invalid-argument", "Missing poolId or slug.");
    }
    // Validate slug format
    const slugLower = slug.toLowerCase();
    if (!/^[a-z0-9-]+$/.test(slugLower)) {
        throw new https_1.HttpsError("invalid-argument", "Invalid slug format.");
    }
    // Run transaction to reserve slug
    await db.runTransaction(async (transaction) => {
        var _a;
        const poolRef = db.collection("pools").doc(poolId);
        const slugRef = db.collection("slugs").doc(slugLower);
        const poolDoc = await transaction.get(poolRef);
        if (!poolDoc.exists) {
            throw new https_1.HttpsError("not-found", "Pool not found.");
        }
        const poolData = poolDoc.data();
        if (poolData.managerUid !== uid) {
            throw new https_1.HttpsError("permission-denied", "Not your pool.");
        }
        if (poolData.status !== "DRAFT") {
            throw new https_1.HttpsError("failed-precondition", "Pool already published.");
        }
        const slugDoc = await transaction.get(slugRef);
        if (slugDoc.exists) {
            throw new https_1.HttpsError("already-exists", "Slug is already taken.");
        }
        // Hash password if provided (PBKDF2)
        let passwordHash = undefined;
        if (password) {
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
            passwordHash = `${salt}:${hash}`;
        }
        // Find Season Lock Time (Fetch from Tournament doc)
        const tournamentRef = db.collection("tournaments").doc(`mens-${poolData.seasonYear}`);
        const tournamentDoc = await transaction.get(tournamentRef);
        let lockAt = 0;
        if (tournamentDoc.exists) {
            lockAt = ((_a = tournamentDoc.data()) === null || _a === void 0 ? void 0 : _a.lockAt) || 0;
        }
        transaction.set(slugRef, {
            poolId,
            createdAt: firestore_1.Timestamp.now().toMillis(),
        });
        transaction.update(poolRef, {
            slug: slugLower,
            slugLower,
            isListedPublic: !!isListedPublic,
            passwordHash: passwordHash || admin.firestore.FieldValue.delete(),
            status: "PUBLISHED",
            lockAt: lockAt,
            updatedAt: firestore_1.Timestamp.now().toMillis(),
        });
    });
    return { success: true, slug: slugLower };
});
// ----------------------------------------------------------------------------
// Join Bracket Pool
// ----------------------------------------------------------------------------
exports.joinBracketPool = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be logged in.");
    }
    const { poolId, password } = request.data;
    const uid = request.auth.uid;
    if (!poolId) {
        throw new https_1.HttpsError("invalid-argument", "Missing poolId.");
    }
    const poolRef = db.collection("pools").doc(poolId);
    const poolDoc = await poolRef.get();
    if (!poolDoc.exists) {
        throw new https_1.HttpsError("not-found", "Pool not found.");
    }
    const poolData = poolDoc.data();
    // Check Password
    if (poolData.passwordHash) {
        if (!password) {
            throw new https_1.HttpsError("permission-denied", "Password required.");
        }
        // Support legacy SHA-256 (if any) and new PBKDF2
        if (poolData.passwordHash.includes(':')) {
            const [salt, originalHash] = poolData.passwordHash.split(':');
            const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
            if (originalHash !== verifyHash) {
                throw new https_1.HttpsError("permission-denied", "Incorrect password.");
            }
        }
        else {
            // Legacy SHA-256 fallback
            const providedHash = crypto.createHash('sha256').update(password).digest('hex');
            if (providedHash !== poolData.passwordHash) {
                throw new https_1.HttpsError("permission-denied", "Incorrect password.");
            }
        }
    }
    // Add to members subcollection (to track who has joined/viewing rights)
    // This allows us to query "my pools" efficiently and check permissions.
    await db.collection("users").doc(uid).collection("joinedPools").doc(poolId).set({
        poolId,
        joinedAt: firestore_1.Timestamp.now().toMillis(),
        role: 'MEMBER'
    });
    // Also add to pool participants subcollection or count?
    // For now, let's just track in user profile for "My Pools" list logic.
    // Ideally we increment a counter on the pool safely.
    await poolRef.update({
        participantCount: admin.firestore.FieldValue.increment(1)
    });
    return { success: true };
});
//# sourceMappingURL=bracketPools.js.map