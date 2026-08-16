import * as admin from 'firebase-admin';
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { writeAuditEvent } from './audit';

import { HttpsError } from 'firebase-functions/v2/https';
import { validated } from "./lib/validated";
import { createPoolPermissiveSchema, updatePoolSettingsSchema } from "./schemas/poolCore";
import { recalculatePoolWinnersSchema, toggleWinnerPaidSchema, fixParticipantIdsSchema, clearLegacyCoManagersSchema } from "./schemas/poolOps";
import { writeAdminAudit } from "./lib/adminAudit";
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
import { parityEditNeedsEntries, survivorParitySettingsRefusal, touchesSurvivorParitySettings } from './lib/survivorSettingsGate';
import { tiebreakerEditNeedsEntries, touchesWeeklyTiebreakerSetting, weeklyTiebreakerRefusal } from './lib/weeklyTiebreakerGate';
import { hybridNoOpKeys, hybridSplitNeedsClearing, hybridSplitRefusal, touchesHybridSplitSettings } from './lib/hybridSplitGate';
import { maxEntriesNoOpKeys, maxEntriesRefusal, touchesMaxEntriesSetting } from './lib/multiEntryGate';
import { entryCountWrite } from './lib/multiEntry';
import { memberLiableEntries } from './shared/memberRecord';
import { leaseIsLive, readScoringLease, readLockRevision, retryWhileScoring } from './lib/scoringLease';

/**
 * Is `uid` the pool's owner or its legacy designated manager?
 *
 * `ownerId` is CANONICAL; `createdByUid` is a functions-only fallback used ONLY
 * when `ownerId` is absent (PLAN-CO-COMMISSIONERS D3 — rules and the client
 * never read `createdByUid`, so treating it as a coequal principal would keep
 * a phantom who can call callables but sees no Commissioner tab). `managerUid`
 * is a SEPARATE principal, or'd in — the old `createdByUid || ownerId ||
 * managerUid` chain resolved ONE owner and silently dropped a distinct
 * `managerUid` whenever an owner was present (Table 2 note 1).
 *
 * This is the DESTRUCTIVE / owner-only principal set (D4). It never reads
 * `coManagers` — see isPoolCommissioner for the widened one.
 */
export const isPoolOwnerOrManager = (pool: any, uid: string): boolean => {
    // `||`, not `??`: a legacy empty-string ownerId must still fall back (self-review).
    const owner = pool?.ownerId || pool?.createdByUid;
    return uid === owner || uid === pool?.managerUid;
};

/** The three pool types co-commissioners exist for in v1 (PLAN-CO-COMMISSIONERS C13). */
export const CO_COMMISSIONER_POOL_TYPES = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'] as const;
export const isCoCommissionerPoolType = (type: unknown): boolean =>
    (CO_COMMISSIONER_POOL_TYPES as readonly string[]).includes(String(type));

/**
 * Is `uid` a commissioner of this pool — owner, legacy manager, OR a named
 * co-commissioner? ONE definition for the functions layer (D3); firestore.rules
 * `isPoolManager()` and the client's `isNFLPoolCommissioner` mirror it.
 *
 * `coManagers` is read again here as of deploy step 3 of D2: the field is
 * server-owned (rules lock, #444) and the only writer is setPoolCoCommissioner,
 * which admits canonical members of NFL pools only. The type guard is NOT
 * implied — a `coManagers` array on a Squares/Bracket/Props/Playoff pool grants
 * nothing here, in the rules, or in the client (codex r3 on the plan).
 */
export const isPoolCommissioner = (pool: any, uid: string): boolean => {
    if (isPoolOwnerOrManager(pool, uid)) return true;
    return isCoCommissionerPoolType(pool?.type)
        && Array.isArray(pool?.coManagers)
        && pool.coManagers.includes(uid);
};

// Helper to determine if user can manage pool — the WIDENED set (co-commissioners in).
export const assertPoolOwnerOrSuperAdmin = (pool: any, uid: string, userRole?: string) => {
    // If Super Admin, allow
    if (userRole === 'SUPER_ADMIN') return;
    if (!isPoolCommissioner(pool, uid)) {
        throw new HttpsError('permission-denied', 'You do not have permission to manage this pool.');
    }
};

/**
 * The DESTRUCTIVE principal set (PLAN-CO-COMMISSIONERS D4: owner-only by NAME,
 * not by omission) — cancel / close / delete and the simulation tools. Never
 * reads `coManagers`. It keeps `managerUid`, which rules `:82` and `closePool`'s
 * own doc already admit for delete/close (codex r3).
 */
export const assertPoolOwnerOrManagerNoCo = (pool: any, uid: string, userRole?: string) => {
    if (userRole === 'SUPER_ADMIN') return;
    if (!isPoolOwnerOrManager(pool, uid)) {
        throw new HttpsError('permission-denied', 'Only the pool owner or manager may do this.');
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
    'createdByUid', 'ownerId', 'managerUid', 'coManagers', 'coManagersRevision', 'role',
    'id', 'createdAt', 'updatedAt', 'poolCredits', 'simRunId',
    // Stats discriminator (PLAN-STATS-INTEGRITY §8.1 arm 3, codex r1). The create
    // envelopes are PERMISSIVE (ADR-0001) and spread the surviving payload
    // straight into the Admin SDK write, which firestore.rules never sees — so
    // without this line any authenticated creator could ship `isTestPool: true`
    // in their create call and keep their pool's money out of every published
    // figure. Only the server (console / Admin SDK) sets this field.
    'isTestPool',
    // Scorer-owned pool-week maps (PLAN-WEEKLY-PRIZES §2b / D5). Set by the
    // week's first submitNFLPicks and by the scorer; a creator who could seed
    // them in the create payload would pick which game(s) the server treats as
    // the tiebreak target, or the weeks divisor of every weekly prize. (qodo #10
    // on #452.) `hardLockByWeek` rides along for the same reason.
    'frozenTiebreakTargets', 'weeksInSeason', 'hardLockByWeek',
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

/**
 * A `sim-` SEASON is the second clause of isSimPool (shared/testPool.ts), which
 * means it is simultaneously (a) arm 1 of the stats test-pool discriminator and
 * (b) what nflAutoScore / nflLockWatch / the finalize sweep already skip on.
 *
 * The sim harness legitimately creates pools carrying one — through the real
 * create callables, as a SUPER_ADMIN caller with a well-formed run id
 * (PLAN-NFL-SIM-HARNESS Phase 5). Nobody else may: an ordinary creator who could
 * mint `season: 'sim-x'` would keep their own paid pool out of every published
 * money figure and out of automated scoring. Found by codex r2 on PR A; the
 * update-side half of the same hole is firestore.rules seasonNotForgedSim().
 *
 * Gated on the STAMPED simRunId, not on the raw claim — so it fails closed for a
 * SUPER_ADMIN whose run id was malformed and therefore not stamped.
 */
export function assertSeasonNotForgedSim(season: unknown, stampedSimRunId: string | undefined): void {
    if (!String(season ?? '').startsWith('sim-')) return;
    if (stampedSimRunId) return;
    throw new HttpsError('permission-denied', 'A "sim-" season is reserved for the simulation harness.');
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

        // Sim harness trust anchor, computed EARLY: the kill-switch bypass keys
        // on the STAMPED simRunId (codex r1, PLAN-SIM-CREATION-BYPASS) - input
        // is the pre-strip payload, simRunId honored only per claimRole.
        const claimRole = request.auth!.token.role as string | undefined;
        const simRunId = simRunIdForCreate(input, claimRole);
        // Feature-flag + maintenance guard (server-authoritative).
        await assertPoolCreationAllowed(data.type || 'SQUARES', { simBypass: simRunId !== undefined });

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

        // simRunId computed above the creation guard; stamped here.
        if (simRunId) newPool.simRunId = simRunId;
        assertSeasonNotForgedSim(newPool.season, simRunId);

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
    // `firestore.rules` isPoolManager() allows `ownerId` OR `managerUid` to write
    // pool settings directly, and this callable is the ONLY path for that write
    // on NFL pools — so it must accept the same principals. It used to carry a
    // managerUid bypass because the helper resolved a single owner; the helper
    // is a disjunction now (PLAN-CO-COMMISSIONERS D3), so the bypass is gone.
    assertPoolOwnerOrSuperAdmin(pool, uid, claimRole);

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
    // The survivor parity settings serialize for a DIFFERENT reason but need the
    // same machinery (PLAN-SURVIVOR-PARITY-SCORING decision 4): both regrade
    // already-scored weeks on the next rescore, so the once-scored refusal has to
    // be evaluated against a pool read INSIDE the transaction that writes, and a
    // live scoring lease has to bounce the edit. Without it a manager's save can
    // land between the manual scorer's post-lease re-read and its publication —
    // results published under settings they were not computed with.
    const parityTouched = touchesSurvivorParitySettings(patch);
    // The weekly tie-breaker rule joins the SAME transaction, for the same
    // reason and one extra one. Same reason: its refusal has to be evaluated
    // against a pool read inside the transaction that writes, or a save can
    // land between a scorer's post-lease re-read and its publication. Extra
    // reason: unlike the parity settings, this one is refused on evidence that
    // lives in the ENTRIES (has anybody submitted?), so a non-transactional
    // check could pass while a member's first submission commits behind it.
    // (PLAN-WEEKLY-TIEBREAKERS §5.)
    const tiebreakerTouched = touchesWeeklyTiebreakerSetting(patch);
    // The hybrid split joins the same transaction: its invariant spans three
    // fields (split, payoutMode, entryFee) and must be judged against the pool
    // as it stands at write time, not at the pre-transaction read.
    //
    // Trio keys whose value equals the pre-read pool are DELETED from the
    // patch, not merely used to skip the transaction. The manager UI re-sends
    // unchanged `entryFee`/`payoutMode` on every save, so presence-keying made
    // a contact-email edit pay for a transaction plus a scoring-lease check
    // (qodo #12, post-merge on the split PR) — and the obvious skip is UNSAFE
    // for sparse patches: a stale `{entryFee: 25}` matching the pre-read can
    // clobber a concurrent `$30 = $20+$10` commit into an invalid trio (codex
    // P1 on the first version of this fix). A key never written cannot clobber
    // anything; presence over the stripped patch IS the change test.
    for (const k of hybridNoOpKeys(pool as Record<string, unknown>, patch)) {
        delete patch[k];
    }
    const hybridTouched = touchesHybridSplitSettings(patch);
    // maxEntriesPerUser (PLAN-MULTI-ENTRY D8, K6): raise-only, judged inside
    // the transaction so two concurrent saves cannot land the smaller value
    // last. Same no-op stripping as the hybrid trio — the manager UI re-sends
    // the whole settings map, and a re-sent 1 on a legacy pool is not a change.
    for (const k of maxEntriesNoOpKeys(pool as Record<string, unknown>, patch)) {
        delete patch[k];
    }
    const maxEntriesTouched = touchesMaxEntriesSetting(patch);
    if (touchesLockSettings(patch) || parityTouched || tiebreakerTouched || hybridTouched || maxEntriesTouched) {
        const bumpsLockRevision = touchesLockSettings(patch);
        await retryWhileScoring(() => db.runTransaction(async (tx) => {
            const current = (await tx.get(poolRef)).data() as Record<string, unknown> | undefined;
            // The reduction invariant needs every entry — but ONLY that check
            // does, and only when the limit is actually moving down. The manager
            // UI submits a complete settings object on every save, so reading
            // them unconditionally would mean hundreds of transactional reads to
            // confirm that nothing changed. Sequential reads are fine; it is a
            // read AFTER a write that Firestore forbids.
            const needsEntries =
                (parityTouched && parityEditNeedsEntries({ ...current, id: poolId }, patch)) ||
                (tiebreakerTouched && tiebreakerEditNeedsEntries({ ...current, id: poolId }, patch));
            const entries = needsEntries
                ? (await tx.get(poolRef.collection('entries'))).docs.map((d) => d.data() as { picks?: Record<string, unknown>; weeklyTiebreakers?: Record<string, unknown> })
                : [];
            if (leaseIsLive(readScoringLease(current), Date.now())) {
                throw new HttpsError(
                    'aborted',
                    'SCORING_IN_PROGRESS: this pool is being scored right now. Try again in a moment.',
                );
            }
            if (parityTouched) {
                const refusal = survivorParitySettingsRefusal({ ...current, id: poolId }, patch, entries);
                if (refusal) throw new HttpsError('failed-precondition', refusal.message);
            }
            if (tiebreakerTouched) {
                const refusal = weeklyTiebreakerRefusal({ ...current, id: poolId }, patch, entries);
                if (refusal) throw new HttpsError('failed-precondition', refusal.message);
            }
            if (hybridTouched) {
                const problem = hybridSplitRefusal(current, patch);
                if (problem) throw new HttpsError('failed-precondition', problem);
            }
            let entryCountInit: Record<string, unknown> = {};
            if (maxEntriesTouched) {
                const problem = maxEntriesRefusal(current, patch);
                if (problem) throw new HttpsError('failed-precondition', problem);
                // D8 (codex r3 on the plan): the first time multi-entry is enabled
                // on a pool with no `entryCount`, initialise it from the Member
                // Records' liabilities in this same transaction — otherwise the
                // pot is unknown until somebody submits again.
                if (typeof current?.entryCount !== 'number') {
                    const members = (await tx.get(poolRef.collection('members'))).docs.map(d => d.data() as Record<string, unknown>);
                    entryCountInit = entryCountWrite(current, members, 0);
                }
            }
            tx.update(poolRef, {
                ...patch,
                ...entryCountInit,
                // Leaving HYBRID deletes the stored split in the SAME write —
                // the per-key merge would otherwise strand it, and the gate
                // above would then refuse every later save as "split on a
                // non-hybrid pool": a validation deadlock. (codex P2, plan r1.)
                ...(hybridTouched && hybridSplitNeedsClearing(current, patch)
                    ? { 'settings.hybridSplit': FieldValue.delete() } : {}),
                // Invalidates any pass that captured the old value — the backstop
                // for a scorer that acquired its lease between our read and here.
                // Scoped to lock edits: a parity-only save changes no deadline, and
                // bumping the revision would invalidate an in-flight pass for
                // nothing.
                ...(bumpsLockRevision ? { 'settings.lockRevision': readLockRevision(current) + 1 } : {}),
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
            const rec = m.data() as { role?: string; feeOwed?: number; hasPlayableEntry?: boolean; playableEntryCount?: number };
            const seededOwnerNeverPlayed = rec.role === 'MANAGER' && (rec.feeOwed ?? 0) === 0;
            if (seededOwnerNeverPlayed) continue;
            // PLAN-MULTI-ENTRY D2: `newFee × liable entries`, not `newFee` — a
            // member holding two playable entries owes two fees at the new price.
            batch.update(m.ref, { feeOwed: newFee * memberLiableEntries(rec), feeOwedSource: 'LIVE' });
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

        // 1. Squares pools are DELIBERATELY not scanned here.
        //
        // Square ownership is not a membership signal. `claimMySquares` sets
        // `reservedByUid` on proof of a `guestDeviceKey` that is readable from
        // the world-readable pool document (`firestore.rules` `allow get: if
        // true`) - the known, accepted-through-the-pilot finding in
        // SECURITY-CLAIM-SQUARES.md. Unioning it into `participantIds` turned
        // this repair job into a privilege escalation: the claimant lands in the
        // array that `setPaidStatus` and reminder targeting treat as membership.
        //
        // Removing it costs nothing legitimate. `reserveSquare` already adds an
        // authenticated reserver to `participantIds` at reserve time, so the only
        // uids this block ever ADDED were ones reserveSquare had not - which is
        // the guest-claim path.

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

// ============ CLEAR LEGACY coManagers (PLAN-CO-COMMISSIONERS D2, deploy step 2) ============
/**
 * One-off, audited, idempotent: delete the `coManagers` field from every pool
 * that carries one. Run AFTER the rules lock deploys and BEFORE anything reads
 * the field again (T2b/T3). Expected 0 non-empty arrays — the number goes in
 * the PR body. A re-run finds no NON-EMPTY array, which is what makes it
 * resumable: an interrupted run is simply run again. ⚠️ The invariant is
 * `nonEmpty === 0 && malformed === 0 && withRevision === 0`, NOT `withField === 0`: the S8 removal
 * helpers' `arrayRemove` legitimately materialises an EMPTY array on a pool
 * that had none (codex r2), and an empty array grants nothing anywhere.
 *
 * `coManagersRevision` was client-writable too, so a legacy value is as
 * untrusted as a legacy array: any pool carrying one has it DELETED (codex r3).
 * The T2b setter treats an absent revision as 0, so deletion IS the zero
 * baseline; stamping `0` onto every pool doc would buy nothing beyond that.
 */
// Per-run write cap (qodo #1 on the T1 PR; same convention as autoClosePools /
// PR #205 / #231). Expected 0 pools carry the field, so this never binds in the
// intended run — it exists so a surprise cannot become thousands of writes in
// one callable. `capped: true` in the result means: run it again.
export const CLEAR_CO_MANAGERS_MAX_WRITES = 200;

export const clearLegacyCoManagers = validated(
    { schema: clearLegacyCoManagersSchema, label: "clearLegacyCoManagers", role: "SUPER_ADMIN", appCheck: "monitor" },
    async ({ dryRun }, request) => {
    const db = admin.firestore();
    const actor = { actorUid: request.auth!.uid, actorEmail: request.auth!.token.email as string | undefined };
    let withField = 0;
    let nonEmpty = 0;
    let malformed = 0;
    let cleared = 0;
    let capped = false;
    let scanned = 0;
    // D3 census: pools whose ownerId and createdByUid both exist and DISAGREE.
    // Expected 0 (creation writes both from one uid). Any hit is listed for
    // Kevin, not reinterpreted — ownerId is canonical from this deploy on.
    let withRevision = 0;
    let ownerMismatch = 0;
    const mismatchSamples: Array<{ poolId: string; ownerId: string; createdByUid: string }> = [];
    const samples: Array<{ poolId: string; value: unknown; revision?: unknown }> = [];
    // `capMetadata` flattens arrays to "[array]", so the audit row carries the
    // pool ids as ONE string (qodo #5); the full samples go back to the UI.
    const auditMeta = () => ({
        dryRun, scanned, withField, withRevision, nonEmpty, malformed, cleared, capped, ownerMismatch,
        samplePoolIds: samples.map((x) => x.poolId).join(','),
        mismatchPoolIds: mismatchSamples.map((x) => x.poolId).join(','),
    });

    try {
        const poolsSnap = await db.collection('pools').get();
        scanned = poolsSnap.size;
        for (const doc of poolsSnap.docs) {
            const data = doc.data();
            if (typeof data.ownerId === 'string' && typeof data.createdByUid === 'string' && data.ownerId !== data.createdByUid) {
                ownerMismatch++;
                if (mismatchSamples.length < 20) mismatchSamples.push({ poolId: doc.id, ownerId: data.ownerId, createdByUid: data.createdByUid });
            }
            const hasRevision = data.coManagersRevision !== undefined;
            if (hasRevision) withRevision++;
            const raw = data.coManagers;
            if (raw === undefined && !hasRevision) continue;
            if (raw !== undefined) withField++;
            const isStringArray = raw === undefined || (Array.isArray(raw) && raw.every((v: unknown) => typeof v === 'string'));
            if (!isStringArray) malformed++;
            else if (Array.isArray(raw) && raw.length > 0) nonEmpty++;
            if (samples.length < 20 && (!isStringArray || (Array.isArray(raw) && raw.length > 0) || hasRevision)) {
                samples.push({ poolId: doc.id, value: raw, revision: data.coManagersRevision });
            }
            if (!dryRun) {
                if (cleared >= CLEAR_CO_MANAGERS_MAX_WRITES) { capped = true; continue; }
                await doc.ref.update({ coManagers: FieldValue.delete(), coManagersRevision: FieldValue.delete() });
                cleared++;
            }
        }
    } catch (err) {
        // A destructive one-off that dies mid-run must still leave a row saying
        // it was attempted and how far it got (qodo #4). Then rethrow.
        await writeAdminAudit({
            ...actor, action: 'CLEAR_LEGACY_CO_MANAGERS', targetType: 'pools',
            metadata: auditMeta(), status: 'error', error: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }

    await writeAdminAudit({ ...actor, action: 'CLEAR_LEGACY_CO_MANAGERS', targetType: 'pools', metadata: auditMeta(), status: 'success' });
    return { success: true, scanned, withField, withRevision, nonEmpty, malformed, cleared, capped, dryRun, samples, ownerMismatch, mismatchSamples };
    },
);
