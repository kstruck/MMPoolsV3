/**
 * Sim harness callables (PLAN-TEST-SUITE Phase 2 items 8e/8f).
 *
 * The Test Suite runs as a SUPER_ADMIN browser session, and Firestore rules
 * allow SUPER_ADMIN writes on ANY pool/entry/tournament doc — so raw client
 * writes from simulators can corrupt real production data (one bug away from
 * overwriting a live pool). These callables are the ONLY sanctioned mutation
 * path for simulators:
 *
 *  - The trust anchor is the persisted `simRunId` field stamped on Test Pools
 *    by the create callables (server-side, SUPER_ADMIN callers only) — never
 *    an ID or slug prefix, because pool doc IDs are server-generated.
 *  - Every callable here re-verifies the target against that field before
 *    writing, and refuses anything outside the sim namespace.
 *  - Every attempt — success OR refusal — writes an admin_audit entry with the
 *    runId, targets, and outcome (the repo's forensic-trail contract).
 *
 * Synthetic NFL games live in the real `nfl_games` collection but under
 * `season = "sim-<runId>"` and doc IDs `sim-<runId>-g<n>` — values no real
 * ESPN import can produce, and which season/week-filtered production queries
 * (reminders, status service, scoring for real pools) never match.
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { writeAdminAudit, capMetadata } from './lib/adminAudit';
import { recomputeCommissionerAggregate } from './lib/commissionerAggregate';

const SIM_PREFIX = 'sim-';
const MAX_DOCS_PER_CALL = 300;

/** Season value for a run's synthetic NFL games. */
export function simSeason(runId: string): string {
    return `${SIM_PREFIX}${runId}`;
}

/** Run-scoped subject uid prefix (`sim-<runId>-`) — cross-run collisions on
 *  publicProfiles/seasonHistory/users state are impossible when every simulated
 *  subject carries the run id (PLAN-NFL-SIM-HARNESS Phase 0.6, Codex R1#6). */
export function simUidPrefix(runId: string): string {
    return `${SIM_PREFIX}${runId}-`;
}

/**
 * Run manifest (`simRuns/{runId}`) — the single source of truth for what a Sim Run
 * created. Cleanup and the stranded-run sweep delete FROM THE MANIFEST, never by
 * discovery from participantIds or surviving pool docs, so orphaned off-pool residue
 * stays recoverable after the pool doc is gone (Phase 0.7, Codex R1#7). The manifest
 * survives cleanup as the run record (status CLEANED); admin_audit is likewise exempt
 * from the zero-residue contract by design (Phase 0.8).
 */
function manifestRef(db: admin.firestore.Firestore, runId: string) {
    return db.collection('simRuns').doc(runId);
}

async function appendManifest(
    db: admin.firestore.Firestore,
    runId: string,
    patch: { poolIds?: string[]; simUids?: string[]; extra?: Record<string, unknown> },
): Promise<void> {
    const update: Record<string, unknown> = {
        runId,
        season: simSeason(runId),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(patch.extra || {}),
    };
    if (patch.poolIds?.length) update.poolIds = admin.firestore.FieldValue.arrayUnion(...patch.poolIds);
    if (patch.simUids?.length) update.simUids = admin.firestore.FieldValue.arrayUnion(...patch.simUids);
    await manifestRef(db, runId).set(update, { merge: true });
}

/**
 * Opens a run manifest. The simulator calls this FIRST, so even a run that dies on
 * its very next step is discoverable by the stranded-run sweep.
 */
export const simStartRun = onCall(async (request) => {
    const actor = assertSuperAdmin(request);
    const db = admin.firestore();
    const { runId, scenarioId } = (request.data ?? {}) as { runId?: string; scenarioId?: string };

    try {
        if (!validRunId(runId)) {
            throw new HttpsError('invalid-argument', 'A valid runId is required.');
        }
        await appendManifest(db, runId!, {
            extra: {
                scenarioId: typeof scenarioId === 'string' ? scenarioId.slice(0, 128) : null,
                actorUid: actor,
                status: 'RUNNING',
                startedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
        });
        await audit(actor, 'SIM_START_RUN', runId!, undefined, 'success', { scenarioId });
        return { success: true, runId };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await audit(actor, 'SIM_START_RUN', String(runId), undefined, 'error', {}, msg);
        throw e;
    }
});

function assertSuperAdmin(request: { auth?: { uid?: string; token?: Record<string, unknown> } | null }): string {
    const uid = request.auth?.uid;
    const role = request.auth?.token?.role;
    if (!uid || role !== 'SUPER_ADMIN') {
        throw new HttpsError('permission-denied', 'Sim harness callables are SUPER_ADMIN only.');
    }
    return uid;
}

function validRunId(runId: unknown): runId is string {
    return typeof runId === 'string' && /^[a-z0-9-]{4,64}$/.test(runId);
}

async function audit(
    actorUid: string,
    action: string,
    runId: string,
    targetId: string | undefined,
    status: 'success' | 'error',
    metadata: Record<string, unknown>,
    error?: string,
): Promise<void> {
    await writeAdminAudit({
        actorUid,
        action,
        targetType: 'sim-harness',
        targetId,
        status,
        error,
        metadata: capMetadata({ runId, ...metadata }),
    });
}

/** Fetches the pool and refuses unless its persisted simRunId matches. */
async function getVerifiedSimPool(
    db: admin.firestore.Firestore,
    poolId: string,
    runId: string,
): Promise<{ ref: admin.firestore.DocumentReference; data: FirebaseFirestore.DocumentData }> {
    const ref = db.collection('pools').doc(poolId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new HttpsError('not-found', 'Pool not found.');
    }
    const data = snap.data()!;
    if (!data.simRunId || data.simRunId !== runId) {
        throw new HttpsError(
            'failed-precondition',
            'NOT_A_SIM_POOL: target pool does not carry this run\'s simRunId — refusing to touch it.',
        );
    }
    return { ref, data };
}

/**
 * Fabricates entries in a verified sim pool. Entry doc IDs are forced to
 * `ownerUid` (scoreNFLWeek writes ranks back to entries/{ownerUid}) and
 * ownerUids must be sim-namespaced so they can never collide with a real user.
 * Supports the subcollection entry model; the in-pool-doc entry arrays used by
 * playoff/props go through simUpdatePool with the same verification.
 */
export const simWriteEntries = onCall(async (request) => {
    const actor = assertSuperAdmin(request);
    const db = admin.firestore();
    const { poolId, runId, entries } = (request.data ?? {}) as {
        poolId?: string; runId?: string; entries?: Array<Record<string, unknown>>;
    };

    try {
        if (!poolId || !validRunId(runId) || !Array.isArray(entries) || entries.length === 0) {
            throw new HttpsError('invalid-argument', 'poolId, runId, and a non-empty entries[] are required.');
        }
        if (entries.length > MAX_DOCS_PER_CALL) {
            throw new HttpsError('invalid-argument', `At most ${MAX_DOCS_PER_CALL} entries per call.`);
        }
        const { ref } = await getVerifiedSimPool(db, poolId, runId);

        const batch = db.batch();
        const uids: string[] = [];
        for (const entry of entries) {
            const ownerUid = entry.ownerUid;
            // Run-scoped, not merely sim-prefixed: `sim-<runId>-…` (Phase 0.6).
            if (typeof ownerUid !== 'string' || !ownerUid.startsWith(simUidPrefix(runId!))) {
                throw new HttpsError(
                    'invalid-argument',
                    `Fabricated entry ownerUid must start with "${simUidPrefix(runId!)}" (got: ${String(ownerUid)}).`,
                );
            }
            uids.push(ownerUid);
            // docId === ownerUid: rank write-back invariant. simRunId stamp lets the
            // profile trigger short-circuit without a pool read (Phase 0.3).
            batch.set(
                ref.collection('entries').doc(ownerUid),
                { ...entry, id: ownerUid, poolId, simRunId: runId },
                { merge: true },
            );
        }
        await batch.commit();
        await appendManifest(db, runId!, { poolIds: [poolId], simUids: uids });

        await audit(actor, 'SIM_WRITE_ENTRIES', runId!, poolId, 'success', { count: entries.length });
        return { success: true, written: entries.length };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await audit(actor, 'SIM_WRITE_ENTRIES', String(runId), poolId, 'error', {}, msg);
        throw e;
    }
});

/**
 * Applies a field patch to a verified sim pool doc (status flips, in-doc entry
 * arrays for playoff/props models, injected results). Server-authoritative
 * fields that would change WHO owns or is billed for the pool stay untouchable.
 */
// season/seasonType/type are namespace-load-bearing: mutating them re-points scoring
// and consensus at a REAL namespace (PLAN-NFL-SIM-HARNESS Phase 0.5, Codex R1#4).
const SIM_PATCH_FORBIDDEN = new Set([
    'ownerId', 'createdByUid', 'managerUid', 'billing', 'simRunId', 'id',
    'season', 'seasonType', 'type',
]);
export const simUpdatePool = onCall(async (request) => {
    const actor = assertSuperAdmin(request);
    const db = admin.firestore();
    const { poolId, runId, patch } = (request.data ?? {}) as {
        poolId?: string; runId?: string; patch?: Record<string, unknown>;
    };

    try {
        if (!poolId || !validRunId(runId) || !patch || typeof patch !== 'object' || Array.isArray(patch)) {
            throw new HttpsError('invalid-argument', 'poolId, runId, and a patch object are required.');
        }
        for (const key of Object.keys(patch)) {
            if (SIM_PATCH_FORBIDDEN.has(key)) {
                throw new HttpsError('invalid-argument', `Field "${key}" cannot be patched via the sim harness.`);
            }
        }
        const { ref } = await getVerifiedSimPool(db, poolId, runId);
        await ref.update(patch);

        await audit(actor, 'SIM_UPDATE_POOL', runId!, poolId, 'success', { fields: Object.keys(patch) });
        return { success: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await audit(actor, 'SIM_UPDATE_POOL', String(runId), poolId, 'error', {}, msg);
        throw e;
    }
});

/**
 * Seeds synthetic NFL games for a run. Doc IDs and season are FORCED into the
 * sim namespace regardless of input, so a buggy caller cannot address a real
 * game doc.
 */
export const simSeedNFLGames = onCall(async (request) => {
    const actor = assertSuperAdmin(request);
    const db = admin.firestore();
    const { runId, games } = (request.data ?? {}) as {
        runId?: string; games?: Array<Record<string, unknown>>;
    };

    try {
        if (!validRunId(runId) || !Array.isArray(games) || games.length === 0) {
            throw new HttpsError('invalid-argument', 'runId and a non-empty games[] are required.');
        }
        if (games.length > MAX_DOCS_PER_CALL) {
            throw new HttpsError('invalid-argument', `At most ${MAX_DOCS_PER_CALL} games per call.`);
        }

        const batch = db.batch();
        games.forEach((game, i) => {
            const id = `${simSeason(runId!)}-g${i + 1}`;
            batch.set(db.collection('nfl_games').doc(id), {
                ...game,
                id,
                espnGameId: id,
                season: simSeason(runId!), // no real import produces this value
            });
        });
        await batch.commit();
        // Track the (seasonType, week) pairs so cleanup can address the run's
        // site-wide consensus keys directly — the consensus PARENT docs are
        // phantom (only their subcollections are written), so no collection
        // query can ever discover them (Phase 0.7).
        const stWeeks = [...new Set(games.map(g =>
            `${Number((g as any).seasonType ?? 2)}_${Number((g as any).week ?? 1)}`))];
        await appendManifest(db, runId!, { extra: {
            gamesCount: games.length,
            stWeeks: admin.firestore.FieldValue.arrayUnion(...stWeeks),
        } });

        await audit(actor, 'SIM_SEED_NFL_GAMES', runId!, undefined, 'success', { count: games.length });
        return { success: true, season: simSeason(runId!), written: games.length };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await audit(actor, 'SIM_SEED_NFL_GAMES', String(runId), undefined, 'error', {}, msg);
        throw e;
    }
});

/** Delete users/{uid} + publicProfiles/{uid} trees for run-scoped sim subjects. */
async function purgeSimSubjects(db: admin.firestore.Firestore, runId: string, simUids: string[]): Promise<number> {
    let purged = 0;
    for (const uid of simUids) {
        // Belt+braces: never recursive-delete outside the run's uid namespace.
        if (typeof uid !== 'string' || !uid.startsWith(simUidPrefix(runId))) continue;
        await db.recursiveDelete(db.collection('users').doc(uid));           // covers seasonHistory
        await db.recursiveDelete(db.collection('publicProfiles').doc(uid));  // covers achievements
        purged++;
    }
    return purged;
}

/**
 * Delete the run's site-wide consensus docs (keys `sim-<runId>_<seasonType>_<week>`).
 * The parent docs are PHANTOM — the consensus writer only sets subcollection docs —
 * so they are invisible to collection queries; we address them directly from the
 * manifest's tracked (seasonType, week) pairs and recursive-delete each key ref.
 */
async function purgeSimConsensus(db: admin.firestore.Firestore, runId: string, stWeeks: string[]): Promise<number> {
    let purged = 0;
    for (const stWeek of stWeeks) {
        if (typeof stWeek !== 'string' || !/^\d+_\d+$/.test(stWeek)) continue;
        const ref = db.collection('consensus').doc(`${simSeason(runId)}_${stWeek}`);
        const subcols = await ref.listCollections(); // works on phantom parents
        if (subcols.length === 0) continue;
        await db.recursiveDelete(ref);
        purged++;
    }
    return purged;
}

/**
 * Full cleanup for one sim pool: recursive delete of the pool tree (entries,
 * audit, weekly_recaps — subcollections client code cannot delete under rules)
 * plus the user-side docs pool creation/join wrote OUTSIDE the pool tree
 * (managedPools, participations, POOL_CREATED/POOL_ENTERED activity), plus a
 * forced owner commissioner-aggregate recompute (Phase 0.4).
 *
 * When `deleteGames` is set (the run-is-done signal), also purges the run's
 * MANIFEST-tracked off-pool residue: sim-subject users/publicProfiles trees,
 * synthetic nfl_games, and site-wide consensus docs — then marks the manifest
 * CLEANED. Manifest-driven, never discovery-driven (Phase 0.7, Codex R1#7).
 */
export const cleanupSimPool = onCall(async (request) => {
    const actor = assertSuperAdmin(request);
    const db = admin.firestore();
    const { poolId, runId, deleteGames } = (request.data ?? {}) as {
        poolId?: string; runId?: string; deleteGames?: boolean;
    };

    try {
        if (!poolId || !validRunId(runId)) {
            throw new HttpsError('invalid-argument', 'poolId and runId are required.');
        }
        const { ref, data } = await getVerifiedSimPool(db, poolId, runId);

        // User-side docs first (need participantIds before the pool doc dies).
        const participantIds: string[] = Array.isArray(data.participantIds) ? data.participantIds : [];
        const realUids = participantIds.filter(u => typeof u === 'string' && !u.startsWith(SIM_PREFIX));
        const ownerId = typeof data.ownerId === 'string' ? data.ownerId : undefined;
        const uids = [...new Set([...realUids, ...(ownerId ? [ownerId] : [])])];

        const batch = db.batch();
        for (const uid of uids) {
            const userRef = db.collection('users').doc(uid);
            batch.delete(userRef.collection('managedPools').doc(poolId));
            batch.delete(userRef.collection('participations').doc(poolId));
            const activitySnap = await userRef.collection('activity').where('poolId', '==', poolId).get();
            activitySnap.docs.forEach(d => batch.delete(d.ref));
        }
        await batch.commit();

        // Pool tree, including all subcollections.
        await db.recursiveDelete(ref);

        // The owner's cross-pool rollup counted this Test Pool if it predates the
        // simRunId-aware predicate; recompute unconditionally so cleanup self-heals.
        if (ownerId) {
            try {
                await recomputeCommissionerAggregate(db, ownerId);
            } catch (e) {
                console.warn(`[cleanupSimPool] owner aggregate recompute failed for ${ownerId}:`, e);
            }
        }

        // Run-is-done: purge manifest-tracked off-pool residue.
        let gamesDeleted = 0;
        let subjectsPurged = 0;
        let consensusDeleted = 0;
        if (deleteGames) {
            const gamesSnap = await db.collection('nfl_games').where('season', '==', simSeason(runId!)).get();
            const gamesBatch = db.batch();
            gamesSnap.docs.forEach(d => gamesBatch.delete(d.ref));
            await gamesBatch.commit();
            gamesDeleted = gamesSnap.size;

            const manifest = (await manifestRef(db, runId!).get()).data() as
                | { simUids?: string[]; stWeeks?: string[] }
                | undefined;
            subjectsPurged = await purgeSimSubjects(db, runId!, manifest?.simUids ?? []);
            consensusDeleted = await purgeSimConsensus(db, runId!, manifest?.stWeeks ?? []);

            await manifestRef(db, runId!).set({
                status: 'CLEANED',
                cleanedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        }

        await audit(actor, 'SIM_CLEANUP_POOL', runId!, poolId, 'success', {
            users: uids.length, gamesDeleted, subjectsPurged, consensusDeleted,
        });
        return { success: true, gamesDeleted, subjectsPurged, consensusDeleted };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await audit(actor, 'SIM_CLEANUP_POOL', String(runId), poolId, 'error', {}, msg);
        throw e;
    }
});
