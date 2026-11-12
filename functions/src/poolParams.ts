import { HttpsError } from "firebase-functions/v2/https";
import { validated } from "./lib/validated";
import { lockPoolSchema } from "./schemas/adminSingles";
import { Timestamp } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

import { assertPoolOwnerOrSuperAdmin } from "./poolOps";
import { confirmedAdminClaim } from "./lib/confirmedRole";
import { writeAuditEvent as writeAudit, computeDigitsHash } from "./audit";
import { isUsableAxis } from "./lib/squaresGame";

const IDENTITY_DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Fisher–Yates over the server's CSPRNG. */
const shuffledDigits = (): number[] => {
    const nums = [...IDENTITY_DIGITS];
    for (let i = nums.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [nums[i], nums[j]] = [nums[j], nums[i]];
    }
    return nums;
};

/**
 * Lock a squares grid and — only if it has none — draw its numbers.
 *
 * THE NUMBERS ARE DRAWN ONCE (D9). This used to draw a fresh set on every call,
 * outside a transaction, so "unlock, lock again" re-rolled the grid — after
 * kickoff too — and two concurrent calls could each announce a different set.
 * Now a grid that has numbers keeps them, whoever asks and however often. The
 * only way to get new numbers is `unlockSquaresPool`, which discards them and is
 * refused once the game has started.
 *
 * A grid with NO numbers is always given some, even mid-game: that is the
 * recovery for a pool that was never locked before kickoff, and the winner
 * records heal on the next score pass.
 *
 * `fixedNumbers` (0–9 in order, for the simulators) is honoured for a confirmed
 * SUPER_ADMIN only. It was open to any pool owner, who could buy the squares
 * that are best under known numbers and then lock with them.
 */
async function lockSquaresPool(
    poolRef: admin.firestore.DocumentReference,
    poolId: string,
    fixedNumbers: boolean,
    uid: string,
    callerName: unknown,
): Promise<{ success: true; axisNumbers: { home: number[]; away: number[] }; generated: boolean }> {
    const db = admin.firestore();
    const label = typeof callerName === 'string' && callerName ? callerName : 'Owner';

    return db.runTransaction(async (t) => {
        const snap = await t.get(poolRef);
        if (!snap.exists) throw new HttpsError("not-found", "Pool not found.");
        const pool = snap.data() as any;

        const kept = isUsableAxis(pool.axisNumbers) ? pool.axisNumbers : null;
        const axisNumbers = kept ?? (fixedNumbers
            ? { home: [...IDENTITY_DIGITS], away: [...IDENTITY_DIGITS] }
            : { home: shuffledDigits(), away: shuffledDigits() });
        const generated = !kept;

        const updates: Record<string, unknown> = {
            isLocked: true,
            lockGrid: true, // Legacy support
            updatedAt: Timestamp.now(),
        };
        if (generated) {
            updates.axisNumbers = axisNumbers;
            if (pool.numberSets === 4) updates.quarterlyNumbers = { q1: axisNumbers };
        }
        t.update(poolRef, updates);

        if (!pool.isLocked || generated) {
            await writeAudit({
                poolId,
                type: 'POOL_LOCKED',
                message: 'Pool locked by owner',
                severity: 'INFO',
                actor: { uid, role: 'ADMIN', label },
            }, t);
        }
        if (generated) {
            const digitsHash = computeDigitsHash({ home: axisNumbers.home, away: axisNumbers.away, poolId, period: 'q1' });
            await writeAudit({
                poolId,
                type: 'DIGITS_GENERATED',
                message: fixedNumbers ? 'Initial Axis Numbers set to the fixed test sequence' : 'Initial Axis Numbers Generated',
                severity: fixedNumbers ? 'WARNING' : 'INFO',
                actor: { uid: 'system', role: 'SYSTEM', label: 'Cloud RNG' },
                payload: { period: 'initial', commitHash: digitsHash, numberSets: pool.numberSets, fixed: fixedNumbers },
            }, t);
        }
        // Email notifications are handled by the onPoolLocked trigger (statsTrigger.ts).
        return { success: true as const, axisNumbers, generated };
    });
}


export const lockPool = validated(
    // Owner/SUPER_ADMIN gate stays in-handler (needs the pool doc).
    { schema: lockPoolSchema, label: "lockPool", appCheck: "monitor" },
    async ({ poolId, forceAxis }, request): Promise<{ success: true; axisNumbers?: { home: number[]; away: number[] }; generated?: boolean }> => {
    const db = admin.firestore();

    const poolRef = db.collection("pools").doc(poolId);
    const poolSnap = await poolRef.get();

    if (!poolSnap.exists) {
        throw new HttpsError("not-found", "Pool not found.");
    }

    const poolData = poolSnap.data() as any;


    // 2. Permission Check - Owner or Super Admin
    // Unconfirmed SUPER_ADMIN claims are stripped (Phase 3, PLAN-API-TRUST-BOUNDARY).
    const adminClaim = await confirmedAdminClaim(request);
    assertPoolOwnerOrSuperAdmin(poolData, request.auth!.uid, adminClaim);

    const type = poolData.type || 'SQUARES';

    // SQUARES locks through its own transactional path (PLAN-SQUARES-REOPEN B4).
    // Every other pool type falls through to the code below, unchanged.
    if (type === 'SQUARES') {
        return lockSquaresPool(poolRef, poolId, forceAxis === true && adminClaim === 'SUPER_ADMIN', request.auth!.uid, request.auth!.token.name);
    }

    const updates: any = {
        isLocked: true,
        updatedAt: Timestamp.now(),
    };

    if (type === 'BRACKET') {
        updates.status = 'LOCKED';
    }
    // PROPS and PLAYOFFS just use isLocked: true

    await poolRef.update(updates);

    // --- AUDIT LOGGING ---
    const { writeAuditEvent } = await import("./audit");

    // 1. Log Lock
    await writeAuditEvent({
        poolId,
        type: 'POOL_LOCKED',
        message: 'Pool locked by owner',
        severity: 'INFO',
        actor: { uid: request.auth!.uid, role: 'ADMIN', label: request.auth!.token.name || 'Owner' }
    });

    return { success: true };
    },
);
