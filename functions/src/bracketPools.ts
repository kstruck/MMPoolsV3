
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { BracketPool } from "./types";
import { Timestamp } from "firebase-admin/firestore";
import * as crypto from "crypto";

const db = admin.firestore();

// ----------------------------------------------------------------------------
// Create Bracket Pool (Draft)
// ----------------------------------------------------------------------------
export const createBracketPool = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const { name, settings, seasonYear, gender } = request.data;
    const uid = request.auth.uid;

    // Debug logs
    console.log("createBracketPool called by:", uid);
    console.log("Request Data:", JSON.stringify(request.data, null, 2));

    if (!name || !seasonYear) {
        console.error("Missing required fields");
        throw new HttpsError("invalid-argument", "Missing required fields.");
    }

    // Create a base slug suggestion
    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const slug = `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}`;

    const poolRef = db.collection("pools").doc();
    const now = Timestamp.now().toMillis();

    console.log("Constructing new pool object...");
    const newPool: BracketPool = {
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
        settings: {
            maxEntriesTotal: settings?.maxEntriesTotal ?? -1,
            maxEntriesPerUser: settings?.maxEntriesPerUser ?? -1,
            entryFee: settings?.entryFee ?? 0,
            paymentInstructions: settings?.paymentInstructions ?? "",
            scoringSystem: settings?.scoringSystem ?? "CLASSIC",
            // Firestore doesn't like undefined. Use null or omit.
            customScoring: settings?.scoringSystem === 'CUSTOM' ? (settings.customScoring || null) : null,
            tieBreakers: settings?.tieBreakers ?? {
                closestAbsolute: true,
                closestUnder: false,
            },
            payouts: settings?.payouts ?? {
                places: [{ rank: 1, percentage: 100 }],
                bonuses: []
            },
            ...settings,
        },
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
export const publishBracketPool = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const { poolId, slug, password, isListedPublic } = request.data;
    const uid = request.auth.uid;

    if (!poolId || !slug) {
        throw new HttpsError("invalid-argument", "Missing poolId or slug.");
    }

    // Validate slug format
    const slugLower = slug.toLowerCase();
    if (!/^[a-z0-9-]+$/.test(slugLower)) {
        throw new HttpsError("invalid-argument", "Invalid slug format.");
    }

    // Run transaction to reserve slug
    await db.runTransaction(async (transaction) => {
        const poolRef = db.collection("pools").doc(poolId);
        const slugRef = db.collection("slugs").doc(slugLower);

        const poolDoc = await transaction.get(poolRef);
        if (!poolDoc.exists) {
            throw new HttpsError("not-found", "Pool not found.");
        }

        const poolData = poolDoc.data() as BracketPool;
        if (poolData.managerUid !== uid) {
            throw new HttpsError("permission-denied", "Not your pool.");
        }
        if (poolData.status !== "DRAFT") {
            throw new HttpsError("failed-precondition", "Pool already published.");
        }

        const slugDoc = await transaction.get(slugRef);
        if (slugDoc.exists) {
            throw new HttpsError("already-exists", "Slug is already taken.");
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
            lockAt = tournamentDoc.data()?.lockAt || 0;
        }

        transaction.set(slugRef, {
            poolId,
            createdAt: Timestamp.now().toMillis(),
        });

        transaction.update(poolRef, {
            slug: slugLower,
            slugLower,
            isListedPublic: !!isListedPublic,
            passwordHash: passwordHash || admin.firestore.FieldValue.delete(),
            status: "PUBLISHED",
            lockAt: lockAt,
            updatedAt: Timestamp.now().toMillis(),
        });
    });

    return { success: true, slug: slugLower };
});

// ----------------------------------------------------------------------------
// Join Bracket Pool
// ----------------------------------------------------------------------------
export const joinBracketPool = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const { poolId, password } = request.data;
    const uid = request.auth.uid;

    if (!poolId) {
        throw new HttpsError("invalid-argument", "Missing poolId.");
    }

    const poolRef = db.collection("pools").doc(poolId);
    const poolDoc = await poolRef.get();

    if (!poolDoc.exists) {
        throw new HttpsError("not-found", "Pool not found.");
    }

    const poolData = poolDoc.data() as BracketPool;

    // Check Password
    if (poolData.passwordHash) {
        if (!password) {
            throw new HttpsError("permission-denied", "Password required.");
        }

        // Support legacy SHA-256 (if any) and new PBKDF2
        if (poolData.passwordHash.includes(':')) {
            const [salt, originalHash] = poolData.passwordHash.split(':');
            const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
            if (originalHash !== verifyHash) {
                throw new HttpsError("permission-denied", "Incorrect password.");
            }
        } else {
            // Legacy SHA-256 fallback
            const providedHash = crypto.createHash('sha256').update(password).digest('hex');
            if (providedHash !== poolData.passwordHash) {
                throw new HttpsError("permission-denied", "Incorrect password.");
            }
        }
    }

    // Add to members subcollection (to track who has joined/viewing rights)
    // This allows us to query "my pools" efficiently and check permissions.
    await db.collection("users").doc(uid).collection("joinedPools").doc(poolId).set({
        poolId,
        joinedAt: Timestamp.now().toMillis(),
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
