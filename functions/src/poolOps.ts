import * as admin from 'firebase-admin';
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { writeAuditEvent } from './audit';

import { HttpsError } from 'firebase-functions/v2/https';
import { validated } from "./lib/validated";
import { createPoolPermissiveSchema, updatePoolSettingsSchema } from "./schemas/poolCore";
import { recalculatePoolWinnersSchema, toggleWinnerPaidSchema, fixParticipantIdsSchema } from "./schemas/poolOps";
import { assertPoolCreationAllowed } from './lib/systemGuards';
import { isPoolType, type PoolType } from './shared/poolTypes';
import {
    validateCreateInput,
    assertNotBanned,
    billingForLaunch,
    type LaunchBillingMode,
    writePoolCreationSideEffects,
} from './lib/poolCreation';
import { loadBillingConfig } from './billing';
import { buildPoolSettingsUpdate, flattenSettingsPatch, touchesLockSettings } from './lib/poolUpdate';
import { leaseIsLive, readScoringLease, readLockRevision, retryWhileScoring } from './lib/scoringLease';

// Helper to determine if user can manage pool
export const assertPoolOwnerOrSuperAdmin = (pool: any, uid: string, userRole?: string) => {
    // If Super Admin, allow
    if (userRole === 'SUPER_ADMIN') return;

    // Use createdByUid if available, fallback to ownerId / managerUid for legacy/migration
    const owner = pool.createdByUid || pool.ownerId || pool.managerUid;
    const isCoManager = pool.participantIds && pool.participantIds.includes(uid) && pool.coManagers && pool.coManagers.includes(uid);
    if (owner !== uid && !isCoManager) {
        throw new HttpsError('permission-denied', 'You do not have permission to manage this pool.');
    }
};

// Default per-period payout split for a new SQUARES pool (percent of pot).
// Matches the legacy SetupWizard default; must sum to 100.
export const DEFAULT_SQUARES_PAYOUTS = { q1: 25, half: 25, q3: 25, final: 25 } as const;

// Server-controlled / privileged fields a client must never set on pool creation.
// Billing, lifecycle, membership, and scoring state are set by the server only.
const PRIVILEGED_POOL_FIELDS = [
    'billing', 'status', 'isLocked', 'lockedAt',
    'participantIds', 'participantCount', 'entryCount', 'entries',
    'winners', 'winnerDetermined', 'isPaid', 'paidOut', 'payouts',
    'createdByUid', 'ownerId', 'managerUid', 'coManagers', 'role',
    'id', 'createdAt', 'updatedAt', 'poolCredits', 'simRunId',
    // Stats discriminator (PLAN-STATS-INTEGRITY §8.1 arm 3, codex r1). The create
    // envelopes are PERMISSIVE (ADR-0001) and spread the surviving payload
    // straight into the Admin SDK write, which firestore.rules never sees — so
    // without this line any authenticated creator could ship `isTestPool: true`
    // in their create call and keep their pool's money out of every published
    // figure. Only the server (console / Admin SDK) sets this field.
    'isTestPool',
];

// Sim harness trust anchor (PLAN-TEST-SUITE 8f): simRunId is stripped from
// every client payload above and re-stamped ONLY here — SUPER_ADMIN callers
// creating Test Pools. The sim-write/cleanup callables (simHarness.ts)
// authorize against this persisted field, never an ID or slug prefix.
export function simRunIdForCreate(rawData: Record<string, any>, claimRole: string | undefined): string | undefined {
    const raw = rawData?.simRunId;
    if (claimRole !== 'SUPER_ADMIN') return undefined;
    if (typeof raw !== 'string' || !/^[a-z0-9-]{4,64}$/.test(raw)) return undefined;
    return raw;
}

// Strip privileged fields from a client-supplied payload before it is spread
// into a pool document. Prevents clients from self-granting paid/active status.
export const stripPrivilegedPoolFields = <T extends Record<string, any>>(data: T): T => {
    const clean = { ...data };
    for (const field of PRIVILEGED_POOL_FIELDS) {
        delete (clean as any)[field];
    }
    return clean;
};

// =============================================================================
// Buy-flow launch mode + paid-ceiling enforcement (NOTES-WAVE2 A1/A2, PLAN 6b)
// Pure, firebase-free helpers so the create/join callables stay thin and the
// logic is unit-testable (mirrors billingForLaunch / buildPoolSettingsUpdate).
// =============================================================================

// The paid add-on flags a create payload can carry. Any one of these set truthy
// disqualifies a launch from the free plan (the server prices them; the pending
// snapshot / billing.paid.addons is the authority once paid).
const PAID_ADDON_KEYS = [
    'aiCommissioner',
    'smsNotifications',
    'whatIfSimulator',
    'customBranding',
] as const;

/** True if the create payload requests any paid add-on. Add-ons may arrive as a
 *  top-level `addons` object or as sibling flags; we accept both shapes so a
 *  bracket/nfl/squares payload is handled without a per-type schema here. */
export function payloadHasPaidAddon(data: Record<string, any> | null | undefined): boolean {
    if (!data || typeof data !== 'object') return false;
    const addons = (data.addons && typeof data.addons === 'object') ? data.addons : data;
    return PAID_ADDON_KEYS.some((k) => addons?.[k] === true);
}

/** Best-effort player estimate from a create payload. Different pool types name
 *  the cap differently (bracket/playoff: settings.maxEntriesTotal; some payloads:
 *  top-level maxPlayers / estimatedPlayers). Returns undefined when no estimate
 *  is present — the caller then defaults to 'free' (see computeLaunchMode). A
 *  cap of -1 / 0 means "unlimited/unset" and is treated as no estimate. */
export function estimatedPlayersFromPayload(data: Record<string, any> | null | undefined): number | undefined {
    if (!data || typeof data !== 'object') return undefined;
    const candidates = [
        data.estimatedPlayers,
        data.maxPlayers,
        data.maxEntriesTotal,
        data.settings?.maxEntriesTotal,
        data.settings?.maxPlayers,
    ];
    for (const c of candidates) {
        if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c;
    }
    return undefined;
}

/**
 * Launch billing mode (NOTES-WAVE2 A1, PLAN Phase 2 #5): 'free' when the player
 * estimate is at or below the free threshold AND no paid add-on is selected;
 * 'trial' otherwise. When the payload carries NO player estimate (many create
 * payloads don't — e.g. squares is a fixed 100-grid, NFL pools have no cap
 * field), a launch with no paid add-on defaults to 'free' — behavior-equivalent
 * to today's always-free launch. Any paid add-on always forces 'trial'.
 */
export function computeLaunchMode(
    data: Record<string, any> | null | undefined,
    freePlayerThreshold: number,
): LaunchBillingMode {
    const hasAddon = payloadHasPaidAddon(data);
    if (hasAddon) return 'trial';
    const estimate = estimatedPlayersFromPayload(data);
    if (estimate === undefined) return 'free'; // no estimate → free (unchanged behavior)
    return estimate <= freePlayerThreshold ? 'free' : 'trial';
}

/**
 * Join/enter paid-ceiling gate (NOTES-WAVE2 A2, PLAN 6b(iii)). Throws when a
 * PAID pool (billing.paid stamped at activation) is at or above its paid
 * participant ceiling. No-op for free/trial pools (they keep their existing
 * tier lock — the 10-player free-plan check that already lives at each site).
 */
export function assertPaidParticipantCeiling(
    billing: { paid?: { maxPlayersAllowed?: number } } | null | undefined,
    currentParticipantCount: number,
): void {
    const paid = billing?.paid;
    if (!paid || typeof paid.maxPlayersAllowed !== 'number') return;
    if (currentParticipantCount >= paid.maxPlayersAllowed) {
        throw new HttpsError(
            'failed-precondition',
            'This pool has reached its paid participant ceiling. Upgrade to add more.',
        );
    }
}

/**
 * updatePoolSettings paid-ceiling gate (NOTES-WAVE2 A2(1), PLAN 6b(ii)). Given
 * the resolved settings patch, rejects a change that raises the player cap or
 * enables a paid add-on beyond the paid snapshot. Only enforces when
 * billing.paid exists — free/trial pools have no paid ceiling here (their cap is
 * enforced at join against the tier limit), so this is a no-op for them, per the
 * spec ("Do NOT block if billing.paid is absent").
 */
export function assertPaidCeilingForUpdate(
    billing: { paid?: { maxPlayersAllowed?: number; addons?: string[] } } | null | undefined,
    set: Record<string, unknown>,
): void {
    const paid = billing?.paid;
    if (!paid) return; // free/trial: no paid ceiling to enforce on edit

    // 1) Player-cap raise. The cap can arrive as a top-level key or nested in the
    //    settings blob (bracket/playoff use settings.maxEntriesTotal).
    const requestedCap = ((): number | undefined => {
        const top = set.maxPlayers ?? set.maxEntriesTotal;
        if (typeof top === 'number' && Number.isFinite(top)) return top;
        const s = set.settings;
        if (s && typeof s === 'object') {
            const nested = (s as any).maxEntriesTotal ?? (s as any).maxPlayers;
            if (typeof nested === 'number' && Number.isFinite(nested)) return nested;
        }
        return undefined;
    })();
    // A cap of -1/0 means "unlimited/unset" — treat as raising beyond any ceiling.
    if (requestedCap !== undefined && typeof paid.maxPlayersAllowed === 'number') {
        const raisesCap = requestedCap <= 0 || requestedCap > paid.maxPlayersAllowed;
        if (raisesCap) {
            throw new HttpsError(
                'failed-precondition',
                'Raising the player cap beyond the paid ceiling requires an upgrade payment.',
            );
        }
    }

    // 2) Enabling a paid add-on not already in the paid snapshot. Add-ons may be
    //    edited as top-level flags or under branding/featuresUnlocked.
    const paidAddons = new Set(Array.isArray(paid.addons) ? paid.addons : []);
    const requestedAddons = (set.featuresUnlocked && typeof set.featuresUnlocked === 'object')
        ? (set.featuresUnlocked as Record<string, unknown>)
        : set;
    for (const key of PAID_ADDON_KEYS) {
        if ((requestedAddons as any)?.[key] === true && !paidAddons.has(key)) {
            throw new HttpsError(
                'failed-precondition',
                'Enabling a paid add-on beyond the paid ceiling requires an upgrade payment.',
            );
        }
    }
}

// V2 Create Pool Function
export const createPool = validated(
    // TARGET-NOW-PERMISSIVE (ADR-0001): wrapper adds auth + App Check monitor +
    // an object envelope; the payload stays an open record — field-level work
    // remains with stripPrivilegedPoolFields + validateCreateInput below.
    { schema: createPoolPermissiveSchema, label: "createPool", appCheck: "monitor" },
    async (input, request) => {
    try {
        const uid = request.auth!.uid;
        const db = admin.firestore();
        // Sanitize data: remove undefined values by JSON cycle (simplest way for deep clean)
        const data = stripPrivilegedPoolFields(JSON.parse(JSON.stringify(input)));

        // Validate inputs
        if (!data.name) {
            throw new HttpsError('invalid-argument', 'Missing required field: name');
        }

        const isSquaresPool = !data.type || data.type === 'SQUARES';

        // Feature-flag + maintenance guard (server-authoritative).
        await assertPoolCreationAllowed(data.type || 'SQUARES');

        if (isSquaresPool && data.costPerSquare === undefined) {
            throw new HttpsError('invalid-argument', 'Missing required field: costPerSquare');
        }

        // Resolve + validate the pool type against the shared CreatePoolInput
        // schema (gate: throws on invalid; original payload is still persisted).
        const rawType = data.type || 'SQUARES';
        if (!isPoolType(rawType)) {
            throw new HttpsError('invalid-argument', `Unknown pool type: ${rawType}`);
        }
        const poolType: PoolType = rawType;
        validateCreateInput(poolType, data);

        const claimRole = request.auth!.token.role as string | undefined;
        assertNotBanned(claimRole, undefined);

        const poolsRef = db.collection('pools');
        const userRef = db.collection('users').doc(uid);

        // Generate ID
        const poolRef = poolsRef.doc();
        const poolId = poolRef.id;

        // Prepare Pool Data
        const now = Timestamp.now();

        // Launch billing mode (NOTES-WAVE2 A1): free when player estimate ≤ the
        // free threshold AND no paid add-on; trial otherwise. Config read fails
        // open to defaults inside loadBillingConfig, so this never stalls create.
        const billingConfig = await loadBillingConfig(db);
        const launchMode = computeLaunchMode(data, billingConfig.freePlayerThreshold);

        const newPool: any = {
            ...data,
            type: poolType, // server-authoritative; never trust/omit the client's
            id: poolId,
            createdByUid: uid,
            ownerId: uid,
            createdAt: now,
            updatedAt: now,
            status: 'DRAFT',
            isLocked: false,
            isPublic: data.isPublic !== undefined ? data.isPublic : true, // Explicitly set for rules
            // free or trial per server-computed launch mode (server-authoritative)
            billing: billingForLaunch(launchMode, billingConfig.trialDays, now.toMillis()),
        };

        // input is the pre-strip payload — simRunId is privileged and only honored per claimRole.
        const simRunId = simRunIdForCreate(input, claimRole);
        if (simRunId) newPool.simRunId = simRunId;

        // Initialize Squares-specific data
        if (isSquaresPool) {
            newPool.squares = Array(100).fill(null).map((_, i) => ({ id: i, owner: null }));
            newPool.scores = {
                current: null,
                q1: null,
                half: null,
                q3: null,
                final: null,
                gameStatus: 'pre'
            };
            // Quarterly payout percentages. `payouts` is a privileged field
            // (stripped from every client payload above), and the old
            // SetupWizard that used to seed 25/25/25/25 is gone — without this
            // default every new squares pool paid $0 per period
            // (scoreUpdates.ts getSafePayout returns 0 for a missing map).
            // Commissioners still tune these post-create in the AdminPanel
            // Payouts tab.
            newPool.payouts = { ...DEFAULT_SQUARES_PAYOUTS };
        }

        // Explicitly remove undefined for safety (though JSON.parse above handles most)
        if (newPool.gameId === undefined) delete newPool.gameId;
        if (newPool.startTime === undefined) delete newPool.startTime;

        // Transaction: create pool + uniform side-effect bundle (managedPools,
        // POOL_CREATED activity, role upgrade) + pool audit — all atomic.
        await db.runTransaction(async (t) => {
            const userDoc = await t.get(userRef);
            if (!userDoc.exists) {
                throw new HttpsError('not-found', 'User profile not found.');
            }

            const currentRole = userDoc.data()?.role as string | undefined;
            assertNotBanned(claimRole, currentRole);

            t.set(poolRef, newPool);

            writePoolCreationSideEffects(t, {
                uid,
                poolId,
                poolName: newPool.name,
                poolType,
                nowMs: now.toMillis(),
                currentRole,
                ownerName: userDoc.data()?.name || request.auth?.token?.name || 'Host',
            });

            await writeAuditEvent({
                poolId,
                type: 'POOL_CREATED',
                message: `Pool "${newPool.name}" (${poolType}) created by ${uid}`,
                severity: 'INFO',
                actor: { uid, role: 'ADMIN', label: 'Host' },
                payload: { type: poolType },
            }, t);
        });

        return { success: true, poolId };

    } catch (error: any) {
        console.error("createPool Failure:", error);
        // Re-throw HttpsErrors as is
        if (error.code && error.details) throw error;
        // Wrap unknown errors
        throw new HttpsError('internal', `Failed to create pool: ${error.message || 'Unknown error'}`, error);
    }
    },
);

// ============ UPDATE POOL SETTINGS ============
// Validated server-side edit path for pool settings. Replaces the rules-gated
// client dbService.updatePool for the wizard edit flow (Phase B shell edit
// mode). Enforces ownership + the per-type editability matrix by lifecycle
// phase, and reconciles payment handles. Other direct-updatePool consumers
// (dashboards, SuperAdmin, simulators) keep their current path for now.
export const updatePoolSettings = validated(
    // updates stays an open record: buildPoolSettingsUpdate enforces the
    // per-type editability matrix by lifecycle phase.
    { schema: updatePoolSettingsSchema, label: "updatePoolSettings", appCheck: "monitor" },
    async (input, request) => {
    const uid = request.auth!.uid;
    const { poolId, updates } = input;

    const db = admin.firestore();
    const poolRef = db.collection('pools').doc(poolId);
    const snap = await poolRef.get();
    if (!snap.exists) {
        throw new HttpsError('not-found', 'Pool not found.');
    }

    const pool = snap.data();
    const claimRole = request.auth!.token.role as string | undefined;
    assertNotBanned(claimRole, undefined);
    // `firestore.rules` isPoolManager() allowed `ownerId` OR `managerUid` to write
    // pool settings directly, and this callable is now the ONLY path for that write
    // on NFL pools — so it must accept the same principals or a DESIGNATED MANAGER
    // loses a capability they have today (codex r3). assertPoolOwnerOrSuperAdmin
    // resolves a single owner (`createdByUid || ownerId || managerUid`) and so
    // rejects a distinct managerUid whenever an owner is present. Preserving the
    // rules' principal set, not widening it.
    if ((pool as { managerUid?: string } | undefined)?.managerUid !== uid) {
        assertPoolOwnerOrSuperAdmin(pool, uid, claimRole);
    }

    // Pure gate: validates each key against the editability matrix for the
    // pool's lifecycle phase; throws failed-precondition on any disallowed key.
    const { set, clearLegacy } = buildPoolSettingsUpdate(pool, updates as Record<string, unknown>);

    // Paid-ceiling gate (NOTES-WAVE2 A2, PLAN 6b(ii)): a PAID pool cannot raise
    // its player cap or enable a paid add-on beyond the paid snapshot without a
    // re-quote + delta payment. No-op for free/trial pools (billing.paid absent).
    assertPaidCeilingForUpdate(pool?.billing as any, set);

    // Merge-preserving settings write (PLAN-REALTIME-SCORING §3a, PR-B′). The
    // manager UI sends a COMPLETE settings object, so a `{ settings: {...} }`
    // update would REPLACE the map and silently delete the server-owned fields it
    // omits — `weekLockOverrides` (reverting an accepted deadline extension) and
    // `lockRevision` (breaking the scoring concurrency protocol). Per-key dotted
    // writes carry them through untouched. Runs AFTER the paid-ceiling gate,
    // which reads the nested shape.
    const patch: Record<string, unknown> = {
        ...flattenSettingsPatch(set, pool?.type as string | undefined),
        updatedAt: Timestamp.now(),
    };
    for (const key of clearLegacy) {
        patch[key] = FieldValue.delete();
    }

    // A lock-affecting settings edit is a lock change, and must serialize with the
    // scoring fence exactly as `extendWeekDeadline` does (codex r3). Without this a
    // manager could save a new `lockBufferMinutes` mid-pass: the plain update would
    // land, the in-flight pass would still hold a matching `lockRevision`, and it
    // would publish grades — and `publishedWeeks` — computed against the OLD lock
    // while the new one keeps that week's picks open.
    if (touchesLockSettings(patch)) {
        await retryWhileScoring(() => db.runTransaction(async (tx) => {
            const current = (await tx.get(poolRef)).data() as Record<string, unknown> | undefined;
            if (leaseIsLive(readScoringLease(current), Date.now())) {
                throw new HttpsError(
                    'aborted',
                    'SCORING_IN_PROGRESS: this pool is being scored right now. Try again in a moment.',
                );
            }
            tx.update(poolRef, {
                ...patch,
                // Invalidates any pass that captured the old value — the backstop
                // for a scorer that acquired its lease between our read and here.
                'settings.lockRevision': readLockRevision(current) + 1,
            });
        }));
    } else {
        await poolRef.update(patch);
    }

    // ADR 0005 Phase 4: an entryFee edit (only possible pre-lock per the editability
    // matrix) cascade-updates feeOwed on this pool's FEE-LIABLE Member Records so the
    // base-dues truth never drifts from the pool fee. Seeded owners who haven't played
    // (feeOwed 0, role MANAGER) stay at 0 — hosting is not playing.
    const resolveFee = (p: Record<string, unknown> | undefined): number => {
        const settings = (p?.settings ?? {}) as Record<string, unknown>;
        return Number(settings.entryFee ?? (p as Record<string, unknown> | undefined)?.entryFee ?? 0);
    };
    const oldFee = resolveFee(pool as Record<string, unknown>);
    const newFee = resolveFee((await poolRef.get()).data() as Record<string, unknown>);
    if (newFee !== oldFee) {
        const membersSnap = await poolRef.collection('members').get();
        let batch = db.batch();
        let ops = 0;
        for (const m of membersSnap.docs) {
            const rec = m.data() as { role?: string; feeOwed?: number };
            const seededOwnerNeverPlayed = rec.role === 'MANAGER' && (rec.feeOwed ?? 0) === 0;
            if (seededOwnerNeverPlayed) continue;
            batch.update(m.ref, { feeOwed: newFee, feeOwedSource: 'LIVE' });
            if (++ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
        }
        if (ops > 0) await batch.commit();
    }

    await writeAuditEvent({
        poolId,
        type: 'POOL_STATUS_CHANGED',
        message: `Pool settings updated by ${uid}`,
        severity: 'INFO',
        actor: { uid, role: 'ADMIN', label: 'Host' },
        payload: { keys: Object.keys(set), ...(newFee !== oldFee ? { entryFeeCascade: { oldFee, newFee } } : {}) },
    });

    return { success: true };
    },
);

// ============ RECALCULATE POOL WINNERS ============
// Used to fix pools affected by the home/away reversal bug
// SuperAdmin only - re-fetches ESPN scores and recalculates all winners
export const recalculatePoolWinners = validated(
    { schema: recalculatePoolWinnersSchema, label: "recalculatePoolWinners", role: "SUPER_ADMIN", appCheck: "monitor" },
    async ({ poolId }, request) => {
    const db = admin.firestore();
    const uid = request.auth!.uid;

    // Get pool data
    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        throw new HttpsError('not-found', `Pool ${poolId} not found.`);
    }

    const pool = poolSnap.data() as any;

    // Delete existing winners subcollection
    const winnersRef = poolRef.collection('winners');
    const existingWinners = await winnersRef.get();
    const deleteBatch = db.batch();
    existingWinners.docs.forEach(doc => deleteBatch.delete(doc.ref));
    await deleteBatch.commit();
    console.log(`[RecalcWinners] Deleted ${existingWinners.size} existing winners for pool ${poolId}`);

    // Clear stored period scores to trigger recalculation on next sync
    await poolRef.update({
        'scores.q1': null,
        'scores.half': null,
        'scores.q3': null,
        'scores.final': null,
        '_winnersCleared': FieldValue.serverTimestamp(),
        '_winnersManualFix': true
    });

    // Log to audit
    await db.collection('pools').doc(poolId).collection('audit').add({
        type: 'WINNERS_RECALCULATED',
        message: `Winners cleared and pool queued for resync. ${existingWinners.size} winners deleted.`,
        severity: 'WARNING',
        actor: { uid, role: 'SUPER_ADMIN', label: 'Manual Fix' },
        timestamp: FieldValue.serverTimestamp(),
        payload: {
            clearedWinners: existingWinners.size,
            poolName: pool.name,
            espnGameId: pool.espnGameId || 'N/A'
        }
    });

    return {
        success: true,
        message: `Cleared ${existingWinners.size} winners for pool "${pool.name}". Pool will resync on next score update.`,
        clearedWinners: existingWinners.size
    };
    },
);

// ============ TOGGLE WINNER PAID STATUS ============
export const toggleWinnerPaid = validated(
    // owner/SUPER_ADMIN check happens in-handler (assertPoolOwnerOrSuperAdmin
    // needs the pool doc's owner fields, unavailable at the role-gate stage).
    { schema: toggleWinnerPaidSchema, label: "toggleWinnerPaid", appCheck: "monitor" },
    async ({ poolId, winnerId }, request) => {
    // winnerId is the doc ID (e.g. 'q1', 'final')
    const db = admin.firestore();
    const uid = request.auth!.uid;
    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) throw new HttpsError('not-found', 'Pool not found');

    const pool = poolSnap.data();

    // Check permissions
    // Note: assertPoolOwnerOrSuperAdmin helper takes (pool, uid, role?), we might need user role.
    // For now, let's just check ownerId directly or fetch user claim if needed.
    // The helper is defined above: assertPoolOwnerOrSuperAdmin(pool: any, uid: string, userRole?: string)
    // We can fetch user role optionally or assume owner check is enough for most.

    // Fetch user role if we want to support SuperAdmin override properly
    const userRole = request.auth!.token.role || 'USER';
    assertPoolOwnerOrSuperAdmin(pool, uid, userRole);

    const winnerRef = poolRef.collection('winners').doc(winnerId);
    const winnerSnap = await winnerRef.get();

    if (!winnerSnap.exists) throw new HttpsError('not-found', 'Winner not found');

    const winnerData = winnerSnap.data();
    const isNowPaid = !winnerData?.isPaid;

    await winnerRef.update({
        isPaid: isNowPaid,
        paidAt: isNowPaid ? FieldValue.serverTimestamp() : null,
        paidByUid: isNowPaid ? uid : null
    });

    // Audit
    await writeAuditEvent({
        poolId,
        type: 'SQUARE_MARKED_PAID', // Generic payment type
        message: `Winner ${winnerId} marked as ${isNowPaid ? 'PAID' : 'UNPAID'} by ${uid}`,
        severity: 'INFO',
        actor: { uid, role: 'ADMIN', label: 'Host' },
        payload: { winnerId, isPaid: isNowPaid }
    });

    return { success: true, isPaid: isNowPaid, winnerId };
    },
);

// ============ FIX PARTICIPANT IDS (Backfill) ============
export const fixParticipantIds = validated(
    { schema: fixParticipantIdsSchema, label: "fixParticipantIds", role: "SUPER_ADMIN", appCheck: "monitor" },
    async ({ dryRun }) => {
    const db = admin.firestore();
    let processed = 0;
    let updated = 0;

    const poolsSnap = await db.collection('pools').get();

    for (const doc of poolsSnap.docs) {
        const pool = doc.data();
        const participantIds = new Set<string>();

        // 1. Squares Pools
        if (pool.squares && Array.isArray(pool.squares)) {
            pool.squares.forEach((sq: any) => {
                if (sq.reservedByUid) participantIds.add(sq.reservedByUid);
            });
        }

        // 2. Playoff Pools (Legacy entries map)
        if (pool.entries && typeof pool.entries === 'object') {
            Object.values(pool.entries).forEach((entry: any) => {
                if (entry.userId || entry.ownerUid) participantIds.add(entry.userId || entry.ownerUid);
            });
        }

        // 3. Bracket Pools (Subcollection)
        if (pool.type === 'BRACKET') {
            const entriesSnap = await doc.ref.collection('entries').get();
            entriesSnap.docs.forEach(entryDoc => {
                const entryData = entryDoc.data();
                if (entryData.ownerUid) participantIds.add(entryData.ownerUid);
            });
        }

        // 3. Compare with existing
        const existing = new Set(pool.participantIds || []);
        const toAdd = [...participantIds].filter(id => !existing.has(id));

        processed++;

        if (toAdd.length > 0) {
            console.log(`Pool ${pool.name} (${doc.id}): Adding ${toAdd.length} participants.`);
            if (!dryRun) {
                await doc.ref.update({
                    participantIds: FieldValue.arrayUnion(...toAdd)
                });
                updated++;
            }
        }
    }

    return { success: true, processed, updated, dryRun };
    },
);
