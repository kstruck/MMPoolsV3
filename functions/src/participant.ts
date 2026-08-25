
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

import * as v1 from "firebase-functions/v1";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { validated } from "./lib/validated";
import { createClaimCodeSchema, claimByCodeSchema } from "./schemas/participantOps";
import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { UserRecord } from "firebase-functions/v1/auth";
import { claimMySquaresSchema } from "./schemas/participantOps";

// Types derived from frontend (simplified for backend)
interface ClaimCode {
    claimId: string;
    claimCode: string;
    createdAt: number;
    guestClaimId: string;
    poolId?: string;
    uses: number;
}

// 1. onUserCreated: Create participant profile
// v1 trigger — setGlobalOptions (v2) does not reach it; cap instances inline.
export const onUserCreated = v1.runWith({ maxInstances: 10 }).auth.user().onCreate(async (user: UserRecord) => {
    const db = admin.firestore();
    const { uid, email, displayName, photoURL } = user;

    try {
        await db.collection("users").doc(uid).set({
            id: uid,
            email: email || "",
            name: displayName || "New User",
            photoURL: photoURL || null,
            role: "MEMBER", // Default role (T6 canonical)
            createdAt: Date.now(),
            provider: user.providerData[0]?.providerId || "unknown",
        });
        logger.info(`Created user profile for ${uid}`);
    } catch (error) {
        logger.error(`Error creating user profile for ${uid}`, error);
    }
});

// 2. createClaimCode: Generate a code for guest
export const createClaimCode = validated(
    // PUBLIC by design: guests (no auth) export their device identity as a
    // short code. Strict shape is the whole gate here.
    { schema: createClaimCodeSchema, label: "createClaimCode", auth: "public", appCheck: "monitor" },
    async (input) => {
    const { poolId, guestDeviceKey } = input;

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

    const claimDoc: ClaimCode = {
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
    },
);

// 3. claimMySquares: Claim guest squares for logged-in user
export const claimMySquares = validated(
    { schema: claimMySquaresSchema, label: "claimMySquares", auth: "required", appCheck: "monitor" },
    async ({ poolId, guestDeviceKey }, request) => {
    // claimIds removed for now until implemented

    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in to claim squares');
    }
    const uid = request.auth.uid;
    const db = admin.firestore();
    const poolRef = db.collection("pools").doc(poolId);

    // Run transaction to be safe
    const result = await db.runTransaction(async (t) => {
        const poolDoc = await t.get(poolRef);
        if (!poolDoc.exists) throw new HttpsError('not-found', 'Pool not found');

        const squares = poolDoc.data()?.squares || [];
        let updated = false;
        const warnings: string[] = [];

        const newSquares = squares.map((s: any) => {
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
                return {
                    ...s,
                    reservedByUid: uid,
                    // Clear guest keys to finalize ownership? Or keep for history?
                    // Prompt says "clears guestDeviceKey... after claiming"
                    guestDeviceKey: null,
                    guestClaimId: null,
                    // Update PII? "pickedAsName" likely stays what they typed.
                };
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
export const claimByCode = validated(
    { schema: claimByCodeSchema, label: "claimByCode", appCheck: "monitor" },
    async (input, request) => {
    const { claimCode } = input;
    const db = admin.firestore();
    const uid = request.auth!.uid;

    // 1. Find claim doc
    const claimsSnap = await db.collection("poolClaims")
        .where("claimCode", "==", claimCode)
        .limit(1)
        .get();

    if (claimsSnap.empty) {
        throw new HttpsError('not-found', 'Invalid claim code');
    }
    const claimDoc = claimsSnap.docs[0];
    const claim = claimDoc.data() as ClaimCode;

    // 2. Identify target scopes
    // Scope: specific pool?
    const targetPoolId = claim.poolId;
    const targetGuestKey = claim.guestClaimId; // This is the guestDeviceKey we want to claim

    if (!targetPoolId) throw new HttpsError('unimplemented', 'Global claims not supported yet');

    // 3. Claim squares in that pool
    const poolRef = db.collection("pools").doc(targetPoolId);

    await db.runTransaction(async (t) => {
        const poolDoc = await t.get(poolRef);
        if (!poolDoc.exists) return; // Should weirdly fail gracefully?

        const squares = poolDoc.data()?.squares || [];
        let updated = false;

        const newSquares = squares.map((s: any) => {
            // Check if matches the code's linked guest identity
            if (s.guestDeviceKey === targetGuestKey) {
                if (s.reservedByUid && s.reservedByUid !== uid) {
                    return s; // Conflict
                }
                updated = true;
                return {
                    ...s,
                    reservedByUid: uid,
                    guestDeviceKey: null, // Consumed
                };
            }
            return s;
        });

        if (updated) {
            // ⛔ Deliberately does NOT write participantIds.
            //
            // A previous revision of this change added it, on the reasoning that
            // claimByCode is the "vetted" cross-device flow. It is not vetted at
            // all: `createClaimCode` above is `auth: "public"` and accepts a
            // caller-supplied `guestDeviceKey`, and that key is readable from the
            // world-readable pool document. So a stranger can mint a code for
            // someone else's unclaimed guest square and redeem it here — writing
            // participantIds would have laundered that straight into membership,
            // restoring the exact escalation this change removes from the repair
            // jobs. (codex r3)
            //
            // The consequence is honest and unavoidable while `guestDeviceKey` is
            // public: the system CANNOT distinguish a legitimate guest-square
            // claimant from an attacker, because both present the same readable
            // key. Neither becomes a roster member. The root fix is the hash
            // migration in SECURITY-CLAIM-SQUARES.md.
            t.update(poolRef, { squares: newSquares });
            // Increment uses
            t.update(claimDoc.ref, {
                uses: FieldValue.increment(1),
                lastUsedAt: Date.now()
            });
        }
    });

    return { success: true, poolId: targetPoolId };
    },
);


// 5. syncParticipantIndices: Trigger
// "Whenever a square changes: If reservedByUid/paidByUid, ensure indices exist and update counts"
export const syncParticipantIndices = onDocumentWritten("pools/{poolId}", async (event) => {
    // Only care if 'squares' changed
    const after = event.data?.after.data();

    if (!after) return; // Deleted

    // Simple diff check (could be optimized)
    const afterSquares = after?.squares || [];

    /**
     * 🛑 A UID THE POOL NO LONGER LISTS GETS NO INDEX DOC.
     *
     * This trigger fires on EVERY pool-document write, including the one a
     * removal makes. Without this guard it would rebuild
     * `pools/{poolId}/participants/{uid}` and `users/{uid}/participations/{poolId}`
     * from `squares[]` immediately after `applyMembershipRemoval`
     * (`lib/memberRecord.ts`) deleted them — so removal's index cleanup would
     * be undone within the same second, and ONLY for SQUARES pools, which is
     * exactly the data it targets. (codex r1 on PLAN-MEMBER-REMOVAL-HARDENING.)
     *
     * It also closes a laundering hop that three other surfaces already refuse.
     * `reserveSquare` never writes `reservedByUid` at all — it stores a display
     * NAME — so the only writers are `claimMySquares` and `claimByCode` above,
     * which prove ownership with a `guestDeviceKey` read straight off the
     * world-readable pool document (SECURITY-CLAIM-SQUARES.md). Minting a
     * membership index from that signal is what `backfillMemberRecords` refuses
     * (its `applySquareUnits` gate), what `fixParticipantIds` refuses (its
     * squares block was deleted), and what `shared/memberRecord.ts` review round
     * 5 removed. This trigger was the last surface still doing it.
     *
     * ⚠️ AN ABSENT ARRAY IS "UNKNOWN", NOT "NOT A MEMBER". A legacy pool with no
     * `participantIds` keeps the old behaviour rather than silently losing its
     * indexes — same unknown-is-not-false discipline as `hasPlayableEntry` in
     * `lib/memberRecord.ts`. Every removal writes the array (`arrayRemove`), so
     * the guard is always armed in the case it exists for.
     */
    const roster: unknown = after?.participantIds;
    const isListed = Array.isArray(roster)
        ? (uid: string) => (roster as string[]).includes(uid)
        : () => true;

    // We need to Map<Uid, { count, ids }>
    const stats = new Map<string, { count: number, ids: string[], paid: number }>();

    afterSquares.forEach((s: any, idx: number) => {
        const ownerUid = s.reservedByUid || s.paidByUid;
        if (ownerUid && isListed(ownerUid)) {
            if (!stats.has(ownerUid)) {
                stats.set(ownerUid, { count: 0, ids: [], paid: 0 });
            }
            const entry = stats.get(ownerUid)!;
            entry.count++;
            // Format ID as "Row_Col"? Or just idx? Requirement says "7_4".
            // 7=Row, 4=Col. idx = row*10 + col.
            const row = Math.floor(idx / 10);
            const col = idx % 10;
            entry.ids.push(`${row}_${col}`);
            if (s.isPaid) entry.paid++;
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
            lastActiveAt: FieldValue.serverTimestamp() // approximate
        }, { merge: true }));

        // 2. /users/{uid}/participations/{poolId}
        const uRef = db.collection("users").doc(uid).collection("participations").doc(poolId);
        promises.push(uRef.set({
            poolId,
            poolName: after.name || "Unknown Pool",
            squaresCount: data.count,
            squareIds: data.ids,
            role: "PARTICIPANT",
            joinedAt: FieldValue.serverTimestamp() // This will update every time, maybe check existence?
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
