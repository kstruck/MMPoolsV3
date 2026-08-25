
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { BracketPool } from "./types";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { assertPoolCreationAllowed } from "./lib/systemGuards";
import { hashPoolPassword, hasSecret, verifyPoolPassword } from "./lib/poolPassword";
import { accessDocRef, publishPasswordPlan, readPoolSecret, rehashOnVerify, scrubUpdateArgs } from "./lib/poolAccess";
import { chargeAccessAttempt, refundAccessAttempt } from "./lib/poolAttempts";
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
import { bracketSettingsSchema } from "./shared/schemas/bracket";
import { publishBracketPoolSchema, joinBracketPoolSchema } from "./schemas/bracketPools";



// ----------------------------------------------------------------------------
// Create Bracket Pool (Draft)
// ----------------------------------------------------------------------------
export const createBracketPool = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const { name, settings: rawSettings, seasonYear, gender, tournamentType } = request.data;
    const uid = request.auth.uid;

    // Debug log. The FULL `request.data` dump that used to sit on the next line
    // is DELETED (NEXT-SESSION-AUDIT-FIXES item 21d): the create payload carries
    // the commissioner's contact email, payment handles and — until Phase B — a
    // pool password, all of which went to Cloud Logging in the clear on every
    // single create, with a default retention nobody had scoped for PII.
    console.log("createBracketPool called by:", uid);

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
    // AFTER the gate on purpose (codex r4 P2: parsing first surfaced a raw
    // ZodError as `internal` instead of the gate's `invalid-argument`).
    // Re-parse and consume the PARSED output (codex r3 P2): the outer schema
    // is strict, but nested objects (paymentHandles, payouts, tieBreakers)
    // are stripping z.objects — zod strips unknowns at every level of its
    // OUTPUT, which makes the unknown-key hardening recursive. `any` because
    // request.data.settings was already untyped here; the gain is the runtime
    // strip, not new static types.
    const settings: any = rawSettings === undefined ? undefined : bracketSettingsSchema.parse(rawSettings);
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
            // paymentHandles was the one schema'd field the enumeration above
            // missed — the reason a raw `...settings` spread used to sit here.
            // The spread is gone (A2): with bracketSettingsSchema now strict,
            // every accepted field is listed explicitly.
            ...(settings?.paymentHandles !== undefined ? { paymentHandles: settings.paymentHandles } : {}),
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
        // T5/D2 — a trial unlocks the selected add-ons (see billingForLaunch).
        // `poolExtras.addons` above is the same normalized selection.
        ...billingForLaunch(launchMode, billingConfig.trialDays, now, poolExtras.addons as Record<string, boolean>),
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

        // ALL READS BEFORE ANY WRITE (Firestore transaction rule).
        const accessRef = accessDocRef(db, poolId);
        const accessDoc = await transaction.get(accessRef);

        // Find Season Lock Time (Fetch from Tournament doc)
        const tournamentRef = db.collection("tournaments").doc(poolData.tournamentId || `mens-${poolData.seasonYear}`);
        const tournamentDoc = await transaction.get(tournamentRef);
        let lockAt = 0;
        if (tournamentDoc.exists) {
            lockAt = tournamentDoc.data()?.lockAt || 0;
        }

        // Password — PLAN-AUDIT-AUTH-HARDENING Phase B.
        //
        // The hash NO LONGER LANDS ON THE POOL DOCUMENT. `pools/{id}` is
        // `allow get: if true`, so a PBKDF2 record stored there was
        // offline-crackable material handed to anyone with a share link; it now
        // goes to `pools/{id}/private/access`, which rules close outright. The
        // public doc keeps only the non-secret boolean marker. Written inside
        // the SAME transaction as the slug reservation, so a pool can never be
        // published with a marker and no secret behind it.
        //
        // ⚠️ PUBLISH NEVER DELETES A PASSWORD (codex r2, P1). The decision and
        // the reasoning live in `publishPasswordPlan`, which is unit-tested;
        // this handler only turns the plan into writes.
        const existingHash = accessDoc.exists ? accessDoc.data()?.passwordHash : undefined;
        const hasExisting = typeof existingHash === "string" && existingHash.length > 0;
        const plan = publishPasswordPlan(
            password, hasExisting, poolData as unknown as Record<string, unknown>,
        );
        const newHash = plan.source === "supplied" || plan.source === "legacy-plaintext"
            ? hashPoolPassword(plan.plaintext)
            : plan.source === "legacy-hash" ? plan.hash : null;
        const willBeProtected = plan.willBeProtected;

        transaction.set(slugRef, {
            poolId,
            createdAt: Timestamp.now().toMillis(),
        });

        if (newHash) {
            transaction.set(
                accessRef,
                { passwordHash: newHash, updatedAt: Timestamp.now().toMillis() },
                { merge: true },
            );
        }

        // Varargs form, not an object: it is the only way to also delete a
        // top-level field literally NAMED `accessControl.password`, which a
        // pre-Phase-B draft can be carrying and which `publishPasswordPlan`
        // above may have just adopted. Leaving it behind would publish the pool
        // with the plaintext still readable (codex r6 P1). One write, so the
        // scrub, the marker and the publish fields cannot come apart.
        transaction.update(poolRef, ...scrubUpdateArgs(willBeProtected, {
            slug: slugLower,
            slugLower,
            isListedPublic: !!isListedPublic,
            isPublic: !!isListedPublic, // Sync for firestore rules
            status: "OPEN",
            lockAt: lockAt,
            updatedAt: Timestamp.now().toMillis(),
        }));
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

    // Check Password — PLAN-AUDIT-AUTH-HARDENING Phase B.
    //
    // The material is read from `pools/{id}/private/access` first and from the
    // legacy public fields only while the migration has not reached this pool.
    // Three formats verify: PBKDF2 `salt:hash` (canonical), a legacy bare
    // sha256 digest, and — for pools whose password only ever existed as
    // `gridPassword` / `accessControl.password` — the legacy PLAINTEXT.
    //
    // ⚠️ THE PLAINTEXT BRANCH IS NOT A NEW ACCEPTANCE. That value is what the
    // old squares gate compared against in the browser; refusing it here would
    // lock out every pool whose commissioner set a password before tonight,
    // without removing any exposure the migration does not already remove.
    const secret = await readPoolSecret(db, poolId, poolData as unknown as Record<string, unknown>);
    if (hasSecret(secret)) {
        if (!password) {
            throw new HttpsError("permission-denied", "Password required.");
        }
        // ⚠️ THROTTLED, SAME AS THE PUBLIC GATE (codex r4, P2). This endpoint
        // requires auth, but "authenticated" is a free account — so without a
        // cap it is the same unbounded online guessing oracle as
        // `verifyPoolAccess`, and each guess buys a PBKDF2 derivation, making it
        // a CPU amplifier too. Moving the hash off the public document
        // accomplishes nothing if either endpoint will grade unlimited guesses
        // against it. Per (pool, uid), failures only, refunded on success.
        await chargeAccessAttempt(db, poolId, uid);
        const verdict = verifyPoolPassword(password, secret);
        if (!verdict.ok) {
            throw new HttpsError("permission-denied", "Incorrect password.");
        }
        await refundAccessAttempt(db, poolId, uid);
        if (verdict.needsRehash) {
            // Item 13c — rehash-on-successful-join. This is the one moment the
            // plaintext is in hand, so the legacy form is upgraded to PBKDF2 in
            // the private doc and the public copies are deleted. Best-effort: a
            // failure here must not turn a correct password into a failed join.
            try {
                const outcome = await rehashOnVerify(db, poolId, password, secret.privateHash ?? null);
                logger.info("[bracketPools] legacy pool password rehash on join", {
                    poolId, from: verdict.matched, outcome,
                });
            } catch (err) {
                logger.error("[bracketPools] rehash-on-join failed", { poolId, error: String(err) });
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
