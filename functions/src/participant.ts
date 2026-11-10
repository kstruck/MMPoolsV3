
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { validated } from "./lib/validated";
import { createClaimCodeSchema, claimByCodeSchema } from "./schemas/participantOps";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { claimMySquaresSchema } from "./schemas/participantOps";
import { randomInt } from "crypto";
import { guestKeyHashOrNull } from "./lib/guestKey";
import { assertNotBannedLive } from "./lib/systemGuards";
import { chargeAccessAttempt } from "./lib/poolAttempts";
import type { Square } from "./types";
import { effectiveSquareCap } from "./shared/squaresClaim";

/** A claim code: lets a guest move their squares to another device or an account. */
interface ClaimCode {
    claimId: string;
    claimCode: string;
    createdAt: number;
    /** After this the code is refused. Absent on codes minted before 2026-11. */
    expiresAt?: number;
    /** `sha256(poolId:key)` — the guest identity this code stands for. */
    guestKeyHash?: string;
    /**
     * LEGACY: the guest's RAW device key, as codes stored it before 2026-11.
     * Never read. A code that carries only this is refused — honouring a raw
     * key is the hole SECURITY-CLAIM-SQUARES.md describes.
     */
    guestClaimId?: string;
    poolId?: string;
    uses: number;
    /** When this code moved squares. Set once; a code that carries it is spent. */
    consumedAt?: number;
}

/**
 * A claim code is for moving squares NOW, not a standing credential.
 *
 * TWO BOUNDS. It expires a day after it is made, and it is SPENT THE FIRST TIME
 * IT MOVES A SQUARE (`isSpentClaim`). It used to count its uses and never look
 * at the count: a guest who redeemed a code and then reserved more squares on
 * the same device left those squares open, for the rest of the day, to anyone
 * who had seen the code (qodo, PR #761).
 */
const CLAIM_CODE_TTL_MS = 24 * 60 * 60 * 1000;

/** Already used to move squares. `uses` covers a code redeemed before `consumedAt` existed. */
function isSpentClaim(claim: ClaimCode | undefined): boolean {
    return !!claim && (typeof claim.consumedAt === 'number' || (typeof claim.uses === 'number' && claim.uses >= 1));
}

const SPENT_CLAIM_MESSAGE = 'This claim code has already been used. Generate a new one on the device that reserved the squares.';

/**
 * 8 characters from 32 — about 1.1 × 10¹² codes.
 *
 * It was 6 (1.07 × 10⁹), and `claimByCode` graded unlimited guesses against it.
 * A code is a BEARER credential: whoever types a live one takes the guest's
 * squares and joins the pool, with no device key. Two bounds now, because
 * neither is enough alone: a longer code, and a per-account limit on wrong
 * guesses in `claimByCode` (qodo, PR #758).
 *
 * No 0/O or 1/I: a person reads this off one screen and types it on another.
 */
const CLAIM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CLAIM_CODE_LENGTH = 8;

/** How many codes a mint will draw before giving up. One is enough in practice. */
const CLAIM_CODE_DRAWS = 5;

/** Not yet expired. A claim with no expiry predates 2026-11 and is never live. */
function isLiveClaim(claim: ClaimCode | undefined, now: number): boolean {
    return !!claim && typeof claim.expiresAt === 'number' && claim.expiresAt > now;
}

/** The throttle bucket for wrong claim codes — per ACCOUNT, across all pools. */
const CLAIM_CODE_ATTEMPT_SCOPE = "claim-code";

// 1. (removed 2026-09-11) `onUserCreated` / `createParticipantProfile` — this
// file used to export a SECOND Auth-create trigger that wrote `users/{uid}` with
// its own schema (`photoURL`, `provider`, numeric `createdAt`, and once upon a
// time `name: "New User"` — the 2026-09-10 standings bug). Two triggers on one
// event, two schemas, one document. userSync.ts `onUserCreated` is the single
// server-side creator now (`createUserProfileIfMissing`, transactional,
// never overwrites); its schema carries `provider`, the one field the client
// read from this one.

/**
 * 2. createClaimCode — a guest turns "this browser" into a short code they can
 * type on another device.
 *
 * PUBLIC by design: a guest has no account. What makes that safe is that the
 * caller must present the DEVICE KEY ITSELF, and only its hash is ever stored
 * or published (lib/guestKey.ts). Before 2026-11 the raw key sat on the
 * world-readable pool document, so anybody could mint a code for somebody
 * else's squares. A hash read off the pool document cannot be presented here.
 */
export const createClaimCode = validated(
    { schema: createClaimCodeSchema, label: "createClaimCode", auth: "public", appCheck: "monitor" },
    async (input) => {
    const { poolId, guestDeviceKey } = input;

    const guestKeyHash = guestKeyHashOrNull(poolId, guestDeviceKey);
    if (!guestKeyHash) {
        // A key minted before the prefix existed has been published on every
        // pool it was used in. It identifies nobody.
        throw new HttpsError(
            'failed-precondition',
            "This browser's claim key is out of date. Reload the page and try again.",
        );
    }

    return mintClaimCode(admin.firestore(), { poolId, guestKeyHash, now: Date.now() });
    },
);

/**
 * Take a claim code nobody else holds, and file the claim under it.
 *
 * TWO LIVE CODES MUST NEVER SHARE A VALUE: whoever types one would take the
 * other guest's squares. So THE CODE IS THE DOCUMENT ID, and it is taken inside
 * a transaction — there is one document per code, and a concurrent mint of the
 * same code loses the transaction and draws again.
 *
 * This used to be "query for the code, then write under a random id". Two mints
 * could both pass the query before either wrote, and the last of the five draws
 * was never checked at all (qodo, PR #758). At 10¹² codes the odds were
 * negligible; the point is that it is now impossible rather than unlikely, and
 * that a mint which cannot get a free code FAILS instead of handing one out
 * unchecked.
 *
 * `draw` is a parameter so the tests can force the clash that chance will not.
 */
export async function mintClaimCode(
    db: FirebaseFirestore.Firestore,
    input: { poolId: string; guestKeyHash: string; now: number },
    draw: () => string = generateShortCode,
): Promise<{ claimCode: string; claimId: string }> {
    const { poolId, guestKeyHash, now } = input;
    for (let attempt = 0; attempt < CLAIM_CODE_DRAWS; attempt++) {
        const claimCode = draw();
        const ref = db.collection("poolClaims").doc(claimCode);
        // Codes minted before this change sit under a random id for up to their
        // 24 hours. A live one of those must not be shadowed either.
        const legacy = await db.collection("poolClaims").where("claimCode", "==", claimCode).limit(5).get();
        const legacyLive = legacy.docs.some((d) => d.id !== claimCode && isLiveClaim(d.data() as ClaimCode, now));

        const claimDoc: ClaimCode = {
            claimId: claimCode,
            claimCode,
            createdAt: now,
            expiresAt: now + CLAIM_CODE_TTL_MS,
            guestKeyHash,
            poolId,
            uses: 0
        };

        const taken = legacyLive || await db.runTransaction(async (t) => {
            const existing = await t.get(ref);
            // An EXPIRED claim under this code is dead and is replaced.
            if (existing.exists && isLiveClaim(existing.data() as ClaimCode, now)) return true;
            t.set(ref, claimDoc);
            return false;
        });
        if (!taken) return { claimCode, claimId: claimCode };
    }

    throw new HttpsError('unavailable', 'Could not create a claim code. Please try again.');
}

/**
 * Move every square held under `guestKeyHash` to `uid`. Runs inside the
 * caller's transaction; returns the ids moved and any it had to leave.
 *
 * A square is the guest's only while it still has an OWNER: a square that was
 * released keeps nothing worth claiming, and the squares auto-release in
 * `reminders.ts` clears the owner without clearing the hash.
 *
 * THE PER-PLAYER LIMIT APPLIES HERE TOO (qodo, PR #760). Reserving is refused
 * past the limit; this moved squares onto an account with no count at all, so
 * a player could fill the limit on one device, fill it again on another, and
 * merge both into one account. `cap` is the pool's limit (null = none, and
 * null for the pool's owner, who is exempt everywhere). The move is all or
 * nothing: over the limit, nothing moves and the squares stay exactly as they
 * were — reserved, under the guest's name, on the device that holds them.
 */
export function claimGuestSquares(
    squares: Square[],
    guestKeyHash: string,
    uid: string,
    cap: number | null,
): { squares: Square[]; claimed: number[]; warnings: string[]; overLimit: { cap: number; wouldHold: number } | null } {
    const claimed: number[] = [];
    const warnings: string[] = [];
    const next = squares.map((s) => {
        if (!s.owner || !s.guestKeyHash || s.guestKeyHash !== guestKeyHash) return s;
        if (s.reservedByUid && s.reservedByUid !== uid) {
            warnings.push(`Square ${s.id} is already owned by someone else.`);
            return s;
        }
        claimed.push(s.id);
        return {
            ...s,
            reservedByUid: uid,
            // The square belongs to the account now; the device no longer does.
            guestKeyHash: null,
            guestDeviceKey: null,
            guestClaimId: null,
        };
    });

    // What the account would hold afterwards — counted on the result, so a
    // square already on the account is counted once.
    const wouldHold = next.filter((s) => !!s.owner && s.reservedByUid === uid).length;
    if (cap !== null && claimed.length > 0 && wouldHold > cap) {
        return {
            squares,
            claimed: [],
            warnings: [...warnings, overLimitMessage(cap, claimed.length)],
            overLimit: { cap, wouldHold },
        };
    }
    return { squares: next, claimed, warnings, overLimit: null };
}

const overLimitMessage = (cap: number, moving: number): string =>
    `This pool allows ${cap} ${cap === 1 ? 'square' : 'squares'} per player, and moving ${moving === 1 ? 'this square' : `these ${moving} squares`} to your account would put you over. `
    + 'They are still reserved under the name they were entered with.';

/** The limit that applies to `uid` on this pool: none for the owner, the pool's otherwise. */
const claimCapFor = (pool: FirebaseFirestore.DocumentData | undefined, uid: string): number | null =>
    pool?.ownerId === uid ? null : effectiveSquareCap(pool?.maxSquaresPerPlayer);

/**
 * 3. claimMySquares — a guest who signs in on the SAME browser takes their
 * guest squares into their account.
 *
 * The caller presents the device key; the server hashes it and compares hashes.
 * No key, or a key from before the prefix, matches nothing and is not an error:
 * the pool page calls this speculatively for every signed-in visitor.
 *
 * A successful claim also makes the caller a member (`participantIds`). That
 * write was deliberately absent while the key was public — presenting it proved
 * nothing — and is correct now that only the key's holder can present it.
 */
export const claimMySquares = validated(
    { schema: claimMySquaresSchema, label: "claimMySquares", auth: "required", appCheck: "monitor" },
    async ({ poolId, guestDeviceKey }, request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in to claim squares');
    }
    const uid = request.auth.uid;
    await assertNotBannedLive(uid);

    const guestKeyHash = guestKeyHashOrNull(poolId, guestDeviceKey);
    if (!guestKeyHash) return { success: true, claimed: [] as number[], warnings: [] as string[] };

    const db = admin.firestore();
    const poolRef = db.collection("pools").doc(poolId);

    const result = await db.runTransaction(async (t) => {
        const poolDoc = await t.get(poolRef);
        if (!poolDoc.exists) throw new HttpsError('not-found', 'Pool not found');

        const squares = (poolDoc.data()?.squares || []) as Square[];
        // Over the limit nothing moves, and the reason comes back as a warning
        // rather than an error: the pool page calls this for every signed-in
        // visitor, and a refusal there is not something they did.
        const outcome = claimGuestSquares(squares, guestKeyHash, uid, claimCapFor(poolDoc.data(), uid));

        if (outcome.claimed.length > 0) {
            t.update(poolRef, {
                squares: outcome.squares,
                participantIds: FieldValue.arrayUnion(uid),
            });
        }
        return { claimed: outcome.claimed, warnings: outcome.warnings };
    });

    return { success: true, claimed: result.claimed, warnings: result.warnings };
});

/**
 * 4. claimByCode — a signed-in player types a code minted on another device
 * and takes that device's guest squares into their account.
 */
export const claimByCode = validated(
    { schema: claimByCodeSchema, label: "claimByCode", appCheck: "monitor" },
    async (input, request) => {
    const claimCode = normalizeClaimCode(input.claimCode);
    const db = admin.firestore();
    const uid = request.auth!.uid;
    await assertNotBannedLive(uid);

    // EVERY ATTEMPT IS CHARGED — ten in fifteen minutes per account, right or
    // wrong, taken before the lookup so a caller who hangs up mid-call still
    // pays. Per account, not per code: an attacker does not know the code, so
    // there is nothing to count against it.
    //
    // NOT refunded on a correct code, unlike the pool-password throttle this
    // reuses. There, a correct password ends the guessing. Here anyone can mint
    // a code of their own (`createClaimCode` is public), so a refund would let
    // an attacker redeem their own code every ninth guess and never run out.
    // Nobody moving their own squares needs ten codes in a quarter of an hour.
    await chargeAccessAttempt(db, CLAIM_CODE_ATTEMPT_SCOPE, uid);

    // The code is the document id (see createClaimCode). A code minted before
    // that change sits under a random id until it expires, so it is still
    // found by value — but only when no document is filed under the code.
    let claimDoc: FirebaseFirestore.DocumentSnapshot = await db.collection("poolClaims").doc(claimCode).get();
    if (!claimDoc.exists) {
        const legacy = await db.collection("poolClaims")
            .where("claimCode", "==", claimCode)
            .limit(1)
            .get();
        if (legacy.empty) {
            throw new HttpsError('not-found', 'Invalid claim code');
        }
        claimDoc = legacy.docs[0];
    }
    const claim = claimDoc.data() as ClaimCode;

    const targetPoolId = claim.poolId;
    if (!targetPoolId) throw new HttpsError('unimplemented', 'Global claims not supported yet');

    // A code with no hash was minted from a raw key, before 2026-11. A code
    // past its expiry is refused whatever it carries. Same answer for both: the
    // guest generates a fresh one on the device that holds the squares.
    const expired = typeof claim.expiresAt === 'number' && Date.now() > claim.expiresAt;
    const targetHash = claim.guestKeyHash;
    if (!targetHash || expired) {
        throw new HttpsError('failed-precondition', 'This claim code has expired. Generate a new one on the device that reserved the squares.');
    }

    const poolRef = db.collection("pools").doc(targetPoolId);

    const claimed = await db.runTransaction(async (t) => {
        const poolDoc = await t.get(poolRef);
        if (!poolDoc.exists) throw new HttpsError('not-found', 'Pool not found');

        // SPENT? Read HERE, in the transaction that would move the squares, so
        // two redemptions of one code cannot both pass: the second sees the
        // first one's mark. (The copy read above is only for finding the pool.)
        const liveClaim = await t.get(claimDoc.ref);
        if (isSpentClaim(liveClaim.data() as ClaimCode | undefined)) {
            throw new HttpsError('failed-precondition', SPENT_CLAIM_MESSAGE);
        }

        const squares = (poolDoc.data()?.squares || []) as Square[];
        const outcome = claimGuestSquares(squares, targetHash, uid, claimCapFor(poolDoc.data(), uid));
        // Typing a code is something the player DID, so over the limit it is
        // refused in words. Thrown before anything is written: the squares stay
        // where they are and the code is not used up.
        if (outcome.overLimit) {
            throw new HttpsError('failed-precondition', outcome.warnings[outcome.warnings.length - 1]);
        }

        if (outcome.claimed.length > 0) {
            // Membership follows the squares — see claimMySquares.
            t.update(poolRef, {
                squares: outcome.squares,
                participantIds: FieldValue.arrayUnion(uid),
            });
            // Spent — but only by a redemption that MOVED something. One that
            // was refused over the limit, or found nothing to move, leaves the
            // code as it was.
            const usedAt = Date.now();
            t.update(claimDoc.ref, {
                uses: FieldValue.increment(1),
                lastUsedAt: usedAt,
                consumedAt: usedAt,
            });
        }
        return outcome.claimed;
    });

    return { success: true, poolId: targetPoolId, claimed };
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

    // We need to Map<Uid, { count, ids }>
    const stats = new Map<string, { count: number, ids: string[], paid: number }>();

    afterSquares.forEach((s: any, idx: number) => {
        const ownerUid = s.reservedByUid || s.paidByUid;
        if (ownerUid) {
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

    // Nothing to index (every non-SQUARES pool, on every one of its writes) —
    // return BEFORE the transaction below, so a pool with no squares pays no
    // read. This trigger fires on `pools/{poolId}`, which on an NFL pool the
    // scorer writes every five minutes.
    if (stats.size === 0) return;

    const poolRef = db.collection("pools").doc(poolId);

    /**
     * 🛑 A UID THE POOL NO LONGER LISTS GETS NO INDEX DOC — CHECKED AGAINST THE
     * LIVE POOL, INSIDE A TRANSACTION, NOT AGAINST THIS EVENT'S SNAPSHOT.
     *
     * Two separate hazards, and only the transaction closes both.
     *
     * 1. THE TRIGGER FIRES ON THE REMOVAL'S OWN WRITE. `applyMembershipRemoval`
     *    (`lib/memberRecord.ts`) deletes `pools/{poolId}/participants/{uid}` and
     *    `users/{uid}/participations/{poolId}` — and it deletes them by updating
     *    the pool document, which wakes this trigger. Ungated, it rebuilt both
     *    from `squares[]` within the same second, and ONLY on SQUARES pools,
     *    which is exactly the data the cleanup targets. (codex r1.)
     *
     * 2. ⚠️ DELIVERY IS UNORDERED AND AT-LEAST-ONCE, SO THE EVENT'S OWN
     *    SNAPSHOT IS NOT EVIDENCE ABOUT THE PRESENT. The first fix read
     *    `event.data.after.participantIds`, which is the roster AS OF THAT
     *    WRITE. A square write made BEFORE the removal can be delivered AFTER
     *    it — or simply retried after it, since a failed invocation is
     *    redelivered carrying the same snapshot — and that snapshot still lists
     *    the departed uid. The removal's own event then correctly writes nothing
     *    while the stale event happily recreates both documents. A guard that
     *    consults the past cannot enforce a fact about the present.
     *    (codex, round on the rebased diff.)
     *
     * The read of `poolRef` puts it in the transaction's read set, so a removal
     * committing between this read and these writes forces a RETRY that re-reads
     * the new roster — which a bare non-transactional re-read would NOT do. That
     * is the whole reason this is a transaction and not just a fresher `get`.
     *
     * ⚠️ AN ABSENT ARRAY IS "UNKNOWN", NOT "NOT A MEMBER". A legacy pool with no
     * `participantIds` keeps the old behaviour rather than silently losing its
     * indexes — the same unknown-is-not-false discipline `lib/memberRecord.ts`
     * applies to `hasPlayableEntry`. Every removal writes the array
     * (`arrayRemove`), so the guard is always armed in the case it exists for.
     *
     * A MISSING POOL writes nothing: the document was deleted between the event
     * and now, and rebuilding an index into a pool that no longer exists is the
     * same resurrection this guard exists to stop.
     *
     * The guard also closes a laundering hop three other surfaces already refuse.
     * Until 2026-11 the only writers of `reservedByUid` were `claimMySquares`
     * and `claimByCode`, which proved ownership with a `guestDeviceKey` read
     * straight off the world-readable pool document (SECURITY-CLAIM-SQUARES.md).
     * Minting a membership index from that signal is what
     * `backfillMemberRecords` refuses (its `applySquareUnits` gate), what
     * `fixParticipantIds` refuses (its squares block was deleted), and what
     * `shared/memberRecord.ts` review round 5 removed. This trigger was the last
     * surface still doing it.
     *
     * Since PLAN-SQUARES-REOPEN A2/A3, `reserveSquare(s)` stamps `reservedByUid`
     * from the caller's auth token and adds that uid to `participantIds` in the
     * same transaction, and the claim paths compare key HASHES and add the
     * claimant to `participantIds` too. So every uid this trigger sees on a
     * square is listed by the time it runs — the guard is unchanged and still
     * decides, it just no longer has anything legitimate to turn away.
     *
     * WRITE BUDGET: a squares grid is 100 cells, so `stats` holds at most 100
     * owners and this transaction issues at most 200 writes plus 1 read — inside
     * Firestore's 500-write limit with room to spare.
     *
     * ⚠️ KNOWN, UNCHANGED, AND DELIBERATELY NOT FIXED HERE: the COUNTS written
     * below (`squaresCount` / `squareIds` / `paidCount`) still come from the
     * EVENT's `squares[]`, so an out-of-order delivery can still write an older
     * count over a newer one for a member who IS still listed. That is a
     * pre-existing lost-update in the squares index, not a membership bug, and
     * this change neither introduces nor worsens it — the guard above decides
     * WHO gets an index, not what it says. The fix would be to rebuild `stats`
     * from `poolSnap.data().squares` instead, which also changes what the
     * `stats.size === 0` early return means; that is a squares-subsystem change
     * with its own blast radius and it is named as an open item in
     * PLAN-MEMBER-REMOVAL-HARDENING rather than smuggled in here.
     */
    await db.runTransaction(async (tx) => {
        const poolSnap = await tx.get(poolRef);
        if (!poolSnap.exists) return;
        const current = poolSnap.data() as Record<string, unknown> | undefined;
        const roster: unknown = current?.participantIds;
        const isListed = Array.isArray(roster)
            ? (uid: string) => (roster as string[]).includes(uid)
            : () => true;
        // The pool NAME comes from the live document too. Taking it from the
        // stale snapshot would stamp a renamed pool's OLD name onto the index —
        // a smaller instance of the same bug.
        const poolName = (typeof current?.name === 'string' ? current.name : undefined) || "Unknown Pool";

        for (const [uid, data] of stats.entries()) {
            if (!isListed(uid)) continue;

            // 1. /pools/{poolId}/participants/{uid}
            tx.set(poolRef.collection("participants").doc(uid), {
                uid,
                squaresCount: data.count,
                squareIds: data.ids,
                paidCount: data.paid,
                lastActiveAt: FieldValue.serverTimestamp() // approximate
            }, { merge: true });

            // 2. /users/{uid}/participations/{poolId}
            tx.set(db.collection("users").doc(uid).collection("participations").doc(poolId), {
                poolId,
                poolName,
                squaresCount: data.count,
                squareIds: data.ids,
                role: "PARTICIPANT",
                // `merge: true` leaves a stored joinedAt in place only if we do
                // not send one; this re-stamps it on every write, as it always
                // has. Left as-is deliberately — changing it is a behaviour
                // change outside this fix.
                joinedAt: FieldValue.serverTimestamp()
            }, { merge: true });
        }
    });
});


/**
 * Six characters from an alphabet with no look-alikes (no I/O/0/1).
 *
 * `randomInt`, not `Math.random`: the code is what proves a claim, so it is
 * drawn from the system CSPRNG.
 */
function generateShortCode() {
    let res = "";
    for (let i = 0; i < CLAIM_CODE_LENGTH; i++) {
        res += CLAIM_CODE_ALPHABET.charAt(randomInt(CLAIM_CODE_ALPHABET.length));
    }
    return res;
}

/**
 * The code as it is compared: upper-cased, with the spaces and dashes a person
 * adds when reading one off another screen removed.
 */
export function normalizeClaimCode(raw: string): string {
    return raw.toUpperCase().replace(/[\s-]/g, "");
}
