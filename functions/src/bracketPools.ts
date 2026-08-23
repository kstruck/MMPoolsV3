
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { BracketPool } from "./types";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import * as crypto from "crypto";
import { assertPoolCreationAllowed } from "./lib/systemGuards";
import { computeLaunchMode, estimatedPlayersFromPayload } from "./poolOps";
import { normalizeAddonSelection } from "./lib/launchFields";
import { loadBillingConfig, resolveCouponForQuote } from "./billing";
import { validLaunchCouponCode } from "./lib/launchCoupon";
import {
    validateCreateInput,
    assertNotBanned,
    billingForLaunch,
    writePoolCreationSideEffects,
} from "./lib/poolCreation";
import { validated } from "./lib/validated";
import { publishBracketPoolSchema, joinBracketPoolSchema } from "./schemas/bracketPools";



// ----------------------------------------------------------------------------
// Create Bracket Pool (Draft)
// ----------------------------------------------------------------------------
export const createBracketPool = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const { name, settings, seasonYear, gender, tournamentType } = request.data;
    const uid = request.auth.uid;

    // Debug logs
    console.log("createBracketPool called by:", uid);
    console.log("Request Data:", JSON.stringify(request.data, null, 2));

    if (!name || !seasonYear) {
        console.error("Missing required fields");
        throw new HttpsError("invalid-argument", "Missing required fields.");
    }

    // Feature-flag + maintenance guard (server-authoritative). NO sim bypass
    // here on purpose: bracket sims ride the createPool callable (which stamps
    // the simRunId trust anchor); this handler persists no sim marker, so a
    // bypass here would mint a REAL unmarked pool past the kill-switch
    // (codex r1, PLAN-SIM-CREATION-BYPASS).
    await assertPoolCreationAllowed("BRACKET");

    // Shared validation gate + ban check.
    validateCreateInput('BRACKET', request.data);
    const claimRole = request.auth.token.role as string | undefined;
    assertNotBanned(claimRole, undefined);

    // Resolve tournament ID based on type
    const isConference = tournamentType && tournamentType !== 'ncaa';
    let resolvedTournamentId: string;
    if (tournamentType === 'bigeast') {
        resolvedTournamentId = `bigeast-${seasonYear}`;
    } else if (tournamentType === 'big12') {
        resolvedTournamentId = `big12-${seasonYear}`;
    } else {
        resolvedTournamentId = `${gender || 'mens'}-${seasonYear}`;
    }

    // Create a base slug suggestion
    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const slug = `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}`;

    const db = admin.firestore();
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
        tournamentId: resolvedTournamentId,
        tournamentType: isConference ? 'conference' : 'ncaa',
        isListedPublic: false,
        isPublic: false, // Default to false for draft
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
    // Launch billing mode (NOTES-WAVE2 A1): free when the requested entry cap is
    // ≤ the free threshold AND no paid add-on; trial otherwise. A bracket create
    // with no cap / no add-on stays 'free' (unchanged behavior). Config read
    // fails open to defaults inside loadBillingConfig.
    const billingConfig = await loadBillingConfig(db);
    const launchMode = computeLaunchMode(request.data, billingConfig.freePlayerThreshold);
    // Remember the wizard's coupon (PLAN-WIZARD-BUYFLOW-FIXES T3) — validated
    // server-side, never redeemed here; redemption stays in createCheckoutSession.
    const launchCouponCode = await validLaunchCouponCode(
        (code) => resolveCouponForQuote(db, code, { userId: uid, poolType: "BRACKET", now }),
        (request.data as Record<string, unknown> | undefined)?.couponCode,
    );
    // Persist what the commissioner picked, so the upgrade page can pre-select it
    // (T3, codex r1 [P1]). The other two create callables get this for free by
    // spreading the payload; this one builds its document field by field.
    // Normalized server-side — an explicit `true` or nothing.
    const rawCreate = request.data as Record<string, unknown>;
    const poolExtras = newPool as unknown as Record<string, unknown>;
    poolExtras.addons = normalizeAddonSelection(rawCreate);
    const bracketEstimate = estimatedPlayersFromPayload(rawCreate);
    if (bracketEstimate !== undefined) poolExtras.estimatedPlayers = bracketEstimate;
    // free or trial per server-computed launch mode (server-authoritative)
    (newPool as any).billing = {
        ...billingForLaunch(launchMode, billingConfig.trialDays, now),
        ...(launchCouponCode ? { couponCode: launchCouponCode } : {}),
    };

    // Transaction: create pool + uniform side-effect bundle (managedPools,
    // POOL_CREATED activity, role upgrade). Bracket previously wrote no owner
    // index — managedPools is added here for cross-type consistency. No
    // participations (join-time only for bracket). Slug is finalized on publish.
    const userRef = db.collection("users").doc(uid);
    await db.runTransaction(async (t) => {
        const userDoc = await t.get(userRef);
        if (!userDoc.exists) {
            throw new HttpsError("not-found", "User profile not found.");
        }
        const currentRole = userDoc.data()?.role as string | undefined;
        assertNotBanned(claimRole, currentRole);

        t.set(poolRef, newPool);
        writePoolCreationSideEffects(t, {
            uid,
            poolId: poolRef.id,
            poolName: name,
            poolType: 'BRACKET',
            nowMs: now,
            currentRole,
            ownerName: userDoc.data()?.name || request.auth?.token?.name || 'Host',
        });
    });
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
export const publishBracketPool = validated(
    { schema: publishBracketPoolSchema, label: "publishBracketPool", appCheck: "monitor" },
    async (data, request) => {
    const { poolId, slug, password, isListedPublic } = data;
    const uid = request.auth!.uid;

    // Validate slug format (post-lowercase; the schema only length-bounds slug
    // so mixed-case input isn't rejected before this normalization step).
    const slugLower = slug.toLowerCase();
    if (!/^[a-z0-9-]+$/.test(slugLower)) {
        throw new HttpsError("invalid-argument", "Invalid slug format.");
    }

    // Run transaction to reserve slug
    const db = admin.firestore();
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
        const tournamentRef = db.collection("tournaments").doc(poolData.tournamentId || `mens-${poolData.seasonYear}`);
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
            isPublic: !!isListedPublic, // Sync for firestore rules
            passwordHash: passwordHash || FieldValue.delete(),
            status: "OPEN",
            lockAt: lockAt,
            updatedAt: Timestamp.now().toMillis(),
        });
    });

    return { success: true, slug: slugLower };
});

// ----------------------------------------------------------------------------
// Join Bracket Pool
// ----------------------------------------------------------------------------
export const joinBracketPool = validated(
    { schema: joinBracketPoolSchema, label: "joinBracketPool", appCheck: "monitor" },
    async (data, request) => {
    const { poolId, password } = data;
    const uid = request.auth!.uid;

    const db = admin.firestore();
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
        participantCount: FieldValue.increment(1),
        participantIds: FieldValue.arrayUnion(uid)
    });

    return { success: true };
});
