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
import { hasConfirmedRole } from './lib/confirmedRole';
import { recomputeCommissionerAggregate } from './lib/commissionerAggregate';
import { joinNFLPoolInternal, submitNFLPicksInternal, executeSurvivorRebuyInternal } from './nflPools';
import { maybeFinalizeNFLPool } from './nflFinalize';

import { SIM_PREFIX, simSeason, simUidPrefix } from './lib/simNamespace';
export { simSeason, simUidPrefix };
const MAX_DOCS_PER_CALL = 300;



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
 * Liveness heartbeat: bumps ONLY the manifest's updatedAt. Every sim callable
 * that represents run activity must call this (or appendManifest) so the
 * sweep's RUNNING-grace-window signal stays truthful (qodo review of PR #157 —
 * simUpdatePool/simExecuteRebuy/simFinalizePool previously never touched the
 * manifest, silently aging an active run toward sweepability).
 */
async function touchManifest(db: admin.firestore.Firestore, runId: string): Promise<void> {
    await appendManifest(db, runId, {});
}

/**
 * Opens a run manifest. The simulator calls this FIRST, so even a run that dies on
 * its very next step is discoverable by the stranded-run sweep.
 */
export const simStartRun = onCall(async (request) => {
    const actor = await assertSuperAdmin(request);
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

async function assertSuperAdmin(request: { auth?: { uid?: string; token?: Record<string, unknown> } | null }): Promise<string> {
    // CLAIM+DOC (PLAN-API-TRUST-BOUNDARY Phase 3): the claim alone let a
    // demoted admin's un-expired token drive every sim callable. The claim
    // still short-circuits (a non-claimant pays no read); the users/{uid}.role
    // doc must agree; a read failure denies (hasConfirmedRole fails closed).
    const uid = request.auth?.uid;
    const confirmed = uid
        ? await hasConfirmedRole(
            { auth: { uid, token: (request.auth?.token ?? {}) as Record<string, unknown> } },
            'SUPER_ADMIN',
        )
        : false;
    if (!uid || !confirmed) {
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
 * `ownerUid` — which under PLAN-MULTI-ENTRY D1 is precisely the id of that
 * owner's ENTRY #1, so the harness fabricates one entry per simulated player.
 * ownerUids must be sim-namespaced so they can never collide with a real user.
 *
 * ⚠️ This used to be justified as "scoreNFLWeek writes ranks back to
 * entries/{ownerUid}". It no longer does — the Margin rank write-back keys on
 * the entry document id (D4) — so the forcing is a harness SIMPLIFICATION, not
 * a scorer invariant. A future harness that wants a two-entry player writes
 * `e{n}:{uid}` and stamps `entryIndex`; nothing here would have to change but
 * this comment and the id it builds.
 * Supports the subcollection entry model; the in-pool-doc entry arrays used by
 * playoff/props go through simUpdatePool with the same verification.
 */
export const simWriteEntries = onCall(async (request) => {
    const actor = await assertSuperAdmin(request);
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
            // docId === ownerUid: this owner's ENTRY #1 (PLAN-MULTI-ENTRY D1), not
            // a rank write-back invariant any more — see the header. simRunId
            // stamp lets the profile trigger short-circuit without a pool read
            // (Phase 0.3).
            batch.set(
                ref.collection('entries').doc(ownerUid),
                { ...entry, id: ownerUid, poolId, simRunId: runId },
                { merge: true },
            );
        }
        // Manifest BEFORE the mutation (qodo review of PR #158): fail-fast, and
        // over-inclusion is safe — the manifest drives cleanup, and cleaning a
        // doc that was never written is a no-op.
        await appendManifest(db, runId!, { poolIds: [poolId], simUids: uids });
        await batch.commit();

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
    const actor = await assertSuperAdmin(request);
    const db = admin.firestore();
    const { poolId, runId, patch } = (request.data ?? {}) as {
        poolId?: string; runId?: string; patch?: Record<string, unknown>;
    };

    try {
        if (!poolId || !validRunId(runId) || !patch || typeof patch !== 'object' || Array.isArray(patch)) {
            throw new HttpsError('invalid-argument', 'poolId, runId, and a patch object are required.');
        }
        for (const key of Object.keys(patch)) {
            // Firestore update() resolves dotted field paths, so 'billing.status'
            // mutates the forbidden 'billing' root without an exact-match hit —
            // validate the ROOT segment (qodo review of PR #156).
            const root = key.split('.')[0];
            if (SIM_PATCH_FORBIDDEN.has(root)) {
                throw new HttpsError('invalid-argument', `Field "${key}" cannot be patched via the sim harness.`);
            }
        }
        const { ref } = await getVerifiedSimPool(db, poolId, runId);
        // Heartbeat BEFORE the mutation (qodo review of PR #158): fail-fast — a
        // manifest-write failure aborts with nothing committed, so an error
        // response/audit is always truthful; and liveness covers the action window.
        await touchManifest(db, runId!);
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
    const actor = await assertSuperAdmin(request);
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
        // Track the (seasonType, week) pairs so cleanup can address the run's
        // site-wide consensus keys directly — the consensus PARENT docs are
        // phantom (only their subcollections are written), so no collection
        // query can ever discover them (Phase 0.7). Manifest BEFORE the commit
        // (qodo review of PR #158): fail-fast; over-inclusion is cleanup-safe.
        const stWeeks = [...new Set(games.map(g =>
            `${Number((g as any).seasonType ?? 2)}_${Number((g as any).week ?? 1)}`))];
        await appendManifest(db, runId!, { extra: {
            gamesCount: games.length,
            stWeeks: admin.firestore.FieldValue.arrayUnion(...stWeeks),
        } });
        await batch.commit();

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
    const actor = await assertSuperAdmin(request);
    const db = admin.firestore();
    const { poolId, runId, deleteGames } = (request.data ?? {}) as {
        poolId?: string; runId?: string; deleteGames?: boolean;
    };

    try {
        if (!poolId || !validRunId(runId)) {
            throw new HttpsError('invalid-argument', 'poolId and runId are required.');
        }
        const { ref, data } = await getVerifiedSimPool(db, poolId, runId);
        const users = await cleanupPoolTree(db, ref, data, poolId);

        // Run-is-done: purge manifest-tracked off-pool residue.
        let residue = { gamesDeleted: 0, subjectsPurged: 0, consensusDeleted: 0 };
        if (deleteGames) {
            residue = await purgeRunResidue(db, runId!, 'CLEANED');
        }

        await audit(actor, 'SIM_CLEANUP_POOL', runId!, poolId, 'success', { users, ...residue });
        return { success: true, ...residue };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await audit(actor, 'SIM_CLEANUP_POOL', String(runId), poolId, 'error', {}, msg);
        throw e;
    }
});

/** Per-pool cleanup core: user-side docs, pool tree, owner-aggregate self-heal. */
async function cleanupPoolTree(
    db: admin.firestore.Firestore,
    ref: admin.firestore.DocumentReference,
    data: FirebaseFirestore.DocumentData,
    poolId: string,
): Promise<number> {
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
            console.warn(`[simHarness] owner aggregate recompute failed for ${ownerId}:`, e);
        }
    }
    return uids.length;
}

/** Run-level residue purge: games, sim subjects, consensus; stamps the manifest. */
async function purgeRunResidue(
    db: admin.firestore.Firestore,
    runId: string,
    finalStatus: 'CLEANED' | 'SWEPT',
): Promise<{ gamesDeleted: number; subjectsPurged: number; consensusDeleted: number }> {
    const gamesSnap = await db.collection('nfl_games').where('season', '==', simSeason(runId)).get();
    const gamesBatch = db.batch();
    gamesSnap.docs.forEach(d => gamesBatch.delete(d.ref));
    await gamesBatch.commit();

    const manifest = (await manifestRef(db, runId).get()).data() as
        | { simUids?: string[]; stWeeks?: string[] }
        | undefined;
    const subjectsPurged = await purgeSimSubjects(db, runId, manifest?.simUids ?? []);
    const consensusDeleted = await purgeSimConsensus(db, runId, manifest?.stWeeks ?? []);

    await manifestRef(db, runId).set({
        status: finalStatus,
        cleanedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { gamesDeleted: gamesSnap.size, subjectsPurged, consensusDeleted };
}

const MAX_SWEEP_RUNS = 10;
const ACTIVE_RUN_GRACE_MS = 30 * 60 * 1000; // RUNNING + touched within 30min = live, never swept

/**
 * Stranded-run sweep (Phase 6, Codex R1#7): lists simRuns manifests not yet
 * CLEANED/SWEPT plus a safety net for pre-manifest pools that carry a simRunId
 * with no manifest. dryRun (default) only reports; execute cleans each stranded
 * run FROM ITS MANIFEST — pool trees that still exist, then subjects/games/
 * consensus — and marks it SWEPT. Manifest-driven, so orphaned off-pool docs
 * are recoverable even after their pool doc is gone.
 */
export const sweepSimRuns = onCall(async (request) => {
    const actor = await assertSuperAdmin(request);
    const db = admin.firestore();
    const { dryRun } = (request.data ?? {}) as { dryRun?: boolean };
    const isDry = dryRun !== false; // dry by default — Operations guardrail convention

    try {
        // Stranded manifests. A RUNNING manifest with RECENT activity is an ACTIVE
        // simulation, not a stranded one — sweeping it mid-flight would destroy a
        // live run (qodo review of PR #156). Every SIM callable bumps the manifest's
        // updatedAt (appendManifest on the mutators, touchManifest on
        // simUpdatePool/simExecuteRebuy/simFinalizePool — qodo PR #157 finding), so
        // recency is a faithful liveness signal for harness activity. Residual gap:
        // scoreNFLWeek is a PUBLIC callable (no runId) and does not heartbeat — a
        // run inside a scoring loop coasts on its last harness touch, which the
        // 30-minute grace window comfortably covers (scoring loops run seconds to
        // low minutes). A run whose last touch is older than the window is stuck.
        const now = Date.now();
        const stranded = new Map<string, { runId: string; scenarioId?: string; status?: string; poolIds: string[] }>();
        const skippedActive: string[] = [];
        const manifestsSnap = await db.collection('simRuns').limit(500).get();
        manifestsSnap.docs.forEach(d => {
            const m = d.data() as any;
            if (m.status === 'CLEANED' || m.status === 'SWEPT') return;
            const lastTouch = m.updatedAt?.toMillis?.() ?? m.startedAt?.toMillis?.() ?? 0;
            if (m.status === 'RUNNING' && now - lastTouch < ACTIVE_RUN_GRACE_MS) {
                skippedActive.push(d.id);
                return;
            }
            stranded.set(d.id, { runId: d.id, scenarioId: m.scenarioId, status: m.status, poolIds: m.poolIds ?? [] });
        });
        // Safety net: simRunId-marked pools (pre-manifest strays or missed appends).
        // Pools belonging to a skipped-active run stay untouched too.
        const strayPools = await db.collection('pools').where('simRunId', '>', '').limit(500).get();
        strayPools.docs.forEach(d => {
            const runId = String(d.data().simRunId);
            if (skippedActive.includes(runId)) return;
            const entry = stranded.get(runId) ?? { runId, poolIds: [] };
            if (!entry.poolIds.includes(d.id)) entry.poolIds.push(d.id);
            stranded.set(runId, entry);
        });

        const runs = [...stranded.values()];
        if (isDry) {
            await audit(actor, 'SIM_SWEEP_RUNS', 'sweep', undefined, 'success', {
                dryRun: true, stranded: runs.length, skippedActive: skippedActive.length,
                sample: runs.slice(0, 10).map(r => r.runId),
            });
            return { dryRun: true, stranded: runs.length, skippedActive: skippedActive.length, runs: runs.slice(0, 50) };
        }

        const capped = runs.slice(0, MAX_SWEEP_RUNS);
        let swept = 0;
        for (const run of capped) {
            for (const poolId of run.poolIds) {
                const ref = db.collection('pools').doc(poolId);
                const snap = await ref.get();
                if (!snap.exists) continue; // pool already gone — residue purge below still runs
                const data = snap.data()!;
                if (data.simRunId !== run.runId) continue; // never touch anything outside the run
                await cleanupPoolTree(db, ref, data, poolId);
            }
            await purgeRunResidue(db, run.runId, 'SWEPT');
            swept++;
        }

        await audit(actor, 'SIM_SWEEP_RUNS', 'sweep', undefined, 'success', {
            dryRun: false, stranded: runs.length, swept, skippedActive: skippedActive.length,
        });
        return { dryRun: false, stranded: runs.length, swept, skippedActive: skippedActive.length, remaining: runs.length - swept };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await audit(actor, 'SIM_SWEEP_RUNS', 'sweep', undefined, 'error', {}, msg);
        throw e;
    }
});

// ---------------------------------------------------------------------------
// Real-path member actions (ADR 0006 / PLAN-NFL-SIM-HARNESS Phases 2-3).
// These drive the SAME internals as the public callables — locks, membership,
// used-teams, spreads, consensus recompute all enforced — but as an explicit
// SIM SUBJECT. actorRole is deliberately NOT forwarded to the internals, so the
// SUPER_ADMIN membership bypass stays OFF and every gate binds to the subject.
// ---------------------------------------------------------------------------

function assertRunScopedUid(runId: string, subjectUid: unknown): string {
    if (typeof subjectUid !== 'string' || !subjectUid.startsWith(simUidPrefix(runId))) {
        throw new HttpsError(
            'invalid-argument',
            `Sim subject uid must start with "${simUidPrefix(runId)}" (got: ${String(subjectUid)}).`,
        );
    }
    return subjectUid;
}

/**
 * Enrolls simulated Members through the REAL join flow (participantIds, Member
 * Record, participations, name stamping) — the prerequisite for every real-path
 * action, because submit/payouts/profiles all key off real membership (Codex R1#1).
 */
export const simJoinMembers = onCall(async (request) => {
    const actor = await assertSuperAdmin(request);
    const db = admin.firestore();
    const { poolId, runId, members } = (request.data ?? {}) as {
        poolId?: string; runId?: string; members?: Array<{ uid?: string; name?: string }>;
    };

    try {
        if (!poolId || !validRunId(runId) || !Array.isArray(members) || members.length === 0) {
            throw new HttpsError('invalid-argument', 'poolId, runId, and a non-empty members[] are required.');
        }
        if (members.length > MAX_DOCS_PER_CALL) {
            throw new HttpsError('invalid-argument', `At most ${MAX_DOCS_PER_CALL} members per call.`);
        }
        await getVerifiedSimPool(db, poolId, runId);
        const uids = members.map(m => assertRunScopedUid(runId!, m?.uid));
        // Manifest BEFORE the joins (qodo review of PR #158): fail-fast; if a join
        // then fails midway, the manifest already names every subject cleanup must
        // consider (over-inclusion is cleanup-safe).
        await appendManifest(db, runId!, { poolIds: [poolId], simUids: uids });

        for (const m of members) {
            const uid = assertRunScopedUid(runId!, m?.uid);
            await joinNFLPoolInternal(db, { subjectUid: uid, subjectName: m?.name || uid }, poolId);
        }

        await audit(actor, 'SIM_JOIN_MEMBERS', runId!, poolId, 'success', { count: uids.length });
        return { success: true, joined: uids.length };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await audit(actor, 'SIM_JOIN_MEMBERS', String(runId), poolId, 'error', {}, msg);
        throw e;
    }
});

/**
 * Submits picks through the REAL submitNFLPicks validation/write path as a sim
 * subject. A green Golden Scenario therefore certifies locks, membership,
 * spread gating, used-team rules, and the post-submit consensus recompute.
 */
export const simSubmitPicks = onCall(async (request) => {
    const actor = await assertSuperAdmin(request);
    const db = admin.firestore();
    const { poolId, runId, subjectUid, week, picks, confidence, tiebreakerPrediction } = (request.data ?? {}) as {
        poolId?: string; runId?: string; subjectUid?: string; week?: number;
        picks?: Record<string, unknown>; confidence?: Record<string, unknown>; tiebreakerPrediction?: number;
    };

    try {
        if (!poolId || !validRunId(runId) || week === undefined) {
            throw new HttpsError('invalid-argument', 'poolId, runId, and week are required.');
        }
        await getVerifiedSimPool(db, poolId, runId);
        const uid = assertRunScopedUid(runId!, subjectUid);
        // Manifest BEFORE the submit (qodo review of PR #158): fail-fast +
        // heartbeat covers the action window; over-inclusion is cleanup-safe.
        await appendManifest(db, runId!, { poolIds: [poolId], simUids: [uid] });

        await submitNFLPicksInternal(db, {
            actorUid: actor,
            // actorRole intentionally undefined: membership must bind to the subject.
            subjectUid: uid,
            subjectName: uid.slice(simUidPrefix(runId!).length) || uid,
            // No browser bundle behind this call, so the tiebreak ROLLOUT guard
            // does not apply — it infers a stale client from a missing
            // `displayedTiebreakTargetIds`, and this path never sends one.
            // Without it every simulated Monday-less week would freeze an empty
            // tiebreak target forever (codex r2 P2). Grants nothing else: the
            // SUPER_ADMIN membership bypass keys off `actorRole`, still
            // deliberately undefined here (ADR 0006).
            serverSideCaller: true,
        }, { poolId, week, picks, confidence, tiebreakerPrediction });

        // Stamp simRunId on the entry the real path just wrote (Phase 0.3 contract).
        // Best-effort with a bounded retry: the trigger guard also keys on the
        // sim- uid prefix, so a failed stamp must not flip a genuinely-successful
        // submit into an error response (the qodo #158 misleading-outcome class) —
        // but the caller gets stampFailed in the RESPONSE, not just the audit, so
        // an orchestrator can retry or flag the run (qodo review of PR #159).
        let stampFailed = false;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                await db.collection('pools').doc(poolId).collection('entries').doc(uid)
                    .set({ simRunId: runId }, { merge: true });
                stampFailed = false;
                break;
            } catch (e) {
                stampFailed = true;
                console.warn(`[simSubmitPicks] simRunId stamp attempt ${attempt} failed for ${uid} in ${poolId}:`, e);
            }
        }

        await audit(actor, 'SIM_SUBMIT_PICKS', runId!, poolId, 'success', {
            subjectUid: uid, week, ...(stampFailed ? { stampFailed: true } : {}),
        });
        return { success: true, ...(stampFailed ? { stampFailed: true } : {}) };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await audit(actor, 'SIM_SUBMIT_PICKS', String(runId), poolId, 'error', { subjectUid, week }, msg);
        throw e;
    }
});

/** Survivor rebuy through the REAL path as a sim subject. */
export const simExecuteRebuy = onCall(async (request) => {
    const actor = await assertSuperAdmin(request);
    const db = admin.firestore();
    const { poolId, runId, subjectUid, week } = (request.data ?? {}) as {
        poolId?: string; runId?: string; subjectUid?: string; week?: number;
    };

    try {
        if (!poolId || !validRunId(runId) || week === undefined) {
            throw new HttpsError('invalid-argument', 'poolId, runId, and week are required.');
        }
        await getVerifiedSimPool(db, poolId, runId);
        const uid = assertRunScopedUid(runId!, subjectUid);
        // Heartbeat BEFORE the rebuy (qodo review of PR #158): a heartbeat failure
        // aborts with nothing committed instead of flipping a successful rebuy
        // into an error response + untruthful error audit.
        await touchManifest(db, runId!);

        await executeSurvivorRebuyInternal(db, {
            actorUid: actor,
            subjectUid: uid,
            subjectName: uid.slice(simUidPrefix(runId!).length) || uid,
        }, { poolId, week });

        await audit(actor, 'SIM_EXECUTE_REBUY', runId!, poolId, 'success', { subjectUid: uid, week });
        return { success: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await audit(actor, 'SIM_EXECUTE_REBUY', String(runId), poolId, 'error', { subjectUid, week }, msg);
        throw e;
    }
});

/**
 * Explicit Season Finalization for a Test Pool (Phase 3.21, Codex R2#1). The ONLY
 * caller that passes allowSim — inline scoring and the sweep never finalize a sim
 * pool (Phase 0.2). Runs the REAL finalize path: computeFinalRanks, seasonHistory
 * writes (to run-scoped sim uids, purged by cleanup), profile recomputes.
 */
/**
 * Finalizes a run manifest with the browser Test Suite's per-assertion results
 * (Phase 4 item 26) — `simRuns/{runId}` doubles as run history. simRuns has no
 * client rules (default deny), so this guarded callable is the only write path.
 * Size-capped: at most 200 assertion rows, strings truncated server-side.
 */
export const simReportRun = onCall(async (request) => {
    const actor = await assertSuperAdmin(request);
    const db = admin.firestore();
    const { runId, report } = (request.data ?? {}) as {
        runId?: string;
        report?: {
            scenarioId?: string; scenarioName?: string; passed?: boolean;
            passedCount?: number; failedCount?: number; durationMs?: number;
            cleanupStatus?: string;
            assertions?: Array<{ type?: string; message?: string; passed?: boolean }>;
        };
    };

    try {
        if (!validRunId(runId) || !report || typeof report !== 'object') {
            throw new HttpsError('invalid-argument', 'runId and a report object are required.');
        }
        const assertions = (Array.isArray(report.assertions) ? report.assertions : [])
            .slice(0, 200)
            .map(a => ({
                type: String(a?.type ?? '').slice(0, 64),
                message: String(a?.message ?? '').slice(0, 300),
                passed: a?.passed === true,
            }));
        await appendManifest(db, runId!, {
            extra: {
                report: {
                    scenarioId: String(report.scenarioId ?? '').slice(0, 128),
                    scenarioName: String(report.scenarioName ?? '').slice(0, 128),
                    passed: report.passed === true,
                    passedCount: Number(report.passedCount ?? 0),
                    failedCount: Number(report.failedCount ?? 0),
                    durationMs: Number(report.durationMs ?? 0),
                    cleanupStatus: String(report.cleanupStatus ?? 'unknown').slice(0, 32),
                    assertions,
                    reportedAt: admin.firestore.FieldValue.serverTimestamp(),
                },
            },
        });
        await audit(actor, 'SIM_REPORT_RUN', runId!, undefined, 'success', {
            scenarioId: report.scenarioId, passed: report.passed === true,
            passedCount: report.passedCount, failedCount: report.failedCount,
        });
        return { success: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await audit(actor, 'SIM_REPORT_RUN', String(runId), undefined, 'error', {}, msg);
        throw e;
    }
});

export const simFinalizePool = onCall(async (request) => {
    const actor = await assertSuperAdmin(request);
    const db = admin.firestore();
    const { poolId, runId } = (request.data ?? {}) as { poolId?: string; runId?: string };

    try {
        if (!poolId || !validRunId(runId)) {
            throw new HttpsError('invalid-argument', 'poolId and runId are required.');
        }
        await getVerifiedSimPool(db, poolId, runId);
        // Heartbeat BEFORE finalization (qodo review of PR #158): fail-fast, and
        // liveness covers the finalize's seasonHistory/profile write window.
        await touchManifest(db, runId!);
        const outcome = await maybeFinalizeNFLPool(db, poolId, { allowSim: true });

        await audit(actor, 'SIM_FINALIZE_POOL', runId!, poolId, 'success', { ...outcome });
        return outcome;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await audit(actor, 'SIM_FINALIZE_POOL', String(runId), poolId, 'error', {}, msg);
        throw e;
    }
});
