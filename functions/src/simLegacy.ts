/**
 * Legacy-simulator guarded callables (PLAN-NFL-SIM-HARNESS Phase 5, items 28-29).
 *
 * The squares SimulationDashboard and the NCAA tournament tooling predate the
 * sim harness and mutated Firestore with raw client writes, kept alive by two
 * firestore.rules backdoors (the `sim-*` slug client-create exception and the
 * blanket SUPER_ADMIN entries write). These callables replace those writes so
 * the backdoors can be dropped:
 *
 *  - `simSetTournament` / `simDeleteTournament`: the tournament doc is SHARED
 *    TEST INFRASTRUCTURE, not a Test Pool (no simRunId anchor) — writes stay
 *    explicitly SUPER_ADMIN + audited, exactly as the plan calls out.
 *  - `simFillSquares`: server-side grid fill for the squares simulator.
 *    Authorization mirrors simulateGameUpdate (owner/manager/co-manager or
 *    SUPER_ADMIN) — the dashboard is used on demo pools the admin owns.
 *
 * Every AUTHENTICATED call — success OR refusal (wrong role, bad input,
 * missing target) — writes an admin_audit entry. Unauthenticated requests are
 * rejected up front WITHOUT an audit write: mirroring simHarness.ts, and
 * deliberate — auditing anonymous probes would let an unauthenticated client
 * flood admin_audit with docs (App Check + auth are the anti-abuse layer
 * there). Qodo PR #162 finding 3 requested unauth auditing; rejected for that
 * reason, comment corrected instead.
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { writeAdminAudit, capMetadata } from './lib/adminAudit';
import { assertNotBannedLive } from './lib/systemGuards';

const TOURNAMENT_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

function requireAuth(request: { auth?: { uid?: string; token?: Record<string, unknown> } | null }): { uid: string; role?: string } {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication required.');
    return { uid, role: request.auth?.token?.role as string | undefined };
}

async function auditLegacy(
    actorUid: string,
    action: string,
    targetId: string | undefined,
    status: 'success' | 'error',
    metadata: Record<string, unknown>,
    error?: string,
): Promise<void> {
    await writeAdminAudit({
        actorUid,
        action,
        targetType: 'sim-legacy',
        targetId,
        status,
        error,
        metadata: capMetadata(metadata),
    });
}

/**
 * Replaces the full tournaments/{tournamentId} doc with a client-built payload
 * (seedTestTournament, loadTournament2025/AtRound, simulateRound's read-modify-
 * write, the Tournament Simulator's reveal loop). SUPER_ADMIN only, audited.
 */
export const simSetTournament = onCall(async (request) => {
    const { uid, role } = requireAuth(request);
    const { tournamentId, tournament } = (request.data ?? {}) as {
        tournamentId?: string; tournament?: Record<string, unknown>;
    };

    try {
        if (role !== 'SUPER_ADMIN') {
            throw new HttpsError('permission-denied', 'Tournament test writes are SUPER_ADMIN only.');
        }
        if (typeof tournamentId !== 'string' || !TOURNAMENT_ID_RE.test(tournamentId)) {
            throw new HttpsError('invalid-argument', 'A valid tournamentId is required.');
        }
        if (!tournament || typeof tournament !== 'object' || Array.isArray(tournament)) {
            throw new HttpsError('invalid-argument', 'A tournament object is required.');
        }
        // Deep-clean (drops undefined) and pin the doc id to the addressed id.
        const clean = JSON.parse(JSON.stringify(tournament));
        clean.id = tournamentId;
        await admin.firestore().collection('tournaments').doc(tournamentId).set(clean);

        await auditLegacy(uid, 'SIM_SET_TOURNAMENT', tournamentId, 'success', {
            games: clean.games ? Object.keys(clean.games).length : 0,
        });
        return { success: true, tournamentId };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await auditLegacy(uid, 'SIM_SET_TOURNAMENT', tournamentId, 'error', {}, msg);
        throw e;
    }
});

/** Deletes a test tournament doc. SUPER_ADMIN only, audited. */
export const simDeleteTournament = onCall(async (request) => {
    const { uid, role } = requireAuth(request);
    const { tournamentId } = (request.data ?? {}) as { tournamentId?: string };

    try {
        if (role !== 'SUPER_ADMIN') {
            throw new HttpsError('permission-denied', 'Tournament test writes are SUPER_ADMIN only.');
        }
        if (typeof tournamentId !== 'string' || !TOURNAMENT_ID_RE.test(tournamentId)) {
            throw new HttpsError('invalid-argument', 'A valid tournamentId is required.');
        }
        await admin.firestore().collection('tournaments').doc(tournamentId).delete();

        await auditLegacy(uid, 'SIM_DELETE_TOURNAMENT', tournamentId, 'success', {});
        return { success: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await auditLegacy(uid, 'SIM_DELETE_TOURNAMENT', tournamentId, 'error', {}, msg);
        throw e;
    }
});

const DUMMY_NAMES = ['Abe', 'Barb', 'Carl', 'Deb', 'Ed', 'Fran', 'Gil', 'Hal', 'Ivy', 'Jon', 'Ken', 'Liz', 'Mac', 'Nan', 'Pat', 'Ron', 'Sam', 'Val', 'Wes', 'Zoe'];

/**
 * Fills a squares grid with dummy owners, leaving `blanksToLeave` empty —
 * server-side port of the old client fillGridWithBlanks (verbatim semantics).
 * Owner/manager/co-manager or SUPER_ADMIN, mirroring simulateGameUpdate.
 */
export const simFillSquares = onCall(async (request) => {
    const { uid, role } = requireAuth(request);
    const { poolId, blanksToLeave } = (request.data ?? {}) as { poolId?: string; blanksToLeave?: number };

    try {
        if (!poolId || typeof poolId !== 'string') {
            throw new HttpsError('invalid-argument', 'poolId is required.');
        }
        const blanks = Number(blanksToLeave ?? 0);
        if (!Number.isInteger(blanks) || blanks < 0 || blanks > 100) {
            throw new HttpsError('invalid-argument', 'blanksToLeave must be an integer 0-100.');
        }

        const ref = admin.firestore().collection('pools').doc(poolId);
        const snap = await ref.get();
        if (!snap.exists) throw new HttpsError('not-found', 'Pool not found.');
        const pool = snap.data() as Record<string, any>;

        const isSuper = role === 'SUPER_ADMIN';
        const owns = [pool.createdByUid, pool.ownerId, pool.managerUid].includes(uid);
        const isCoManager = Array.isArray(pool.coManagers) && pool.coManagers.includes(uid);
        if (!isSuper && !owns && !isCoManager) {
            throw new HttpsError('permission-denied', 'You do not have permission to fill this pool\'s grid.');
        }

        // The check above authorizes from PERSISTED POOL FIELDS and never reads
        // `users/{uid}.role`, so a BANNED owner or co-manager keeps the ability
        // to fill a real pool's grid. CONTEXT.md requires bans server-side; see
        // SECURITY-BARE-ONCALL-CLASSIFICATION.md. After the ownership check, so
        // a banned non-owner costs no extra read.
        await assertNotBannedLive(uid);

        let squares: Array<Record<string, unknown>> = [...(pool.squares || [])];
        if (squares.length < 100) {
            squares = Array(100).fill(null).map((_, i) => ({ id: i, owner: null }));
        }
        const currentFilled = squares.filter((s) => s.owner).length;
        const emptyIndices = squares.map((s, i) => (s.owner ? -1 : i)).filter((i) => i !== -1);
        const targetFilled = 100 - blanks;
        const needed = targetFilled - currentFilled;

        if (needed <= 0) {
            await auditLegacy(uid, 'SIM_FILL_SQUARES', poolId, 'success', { filled: 0, currentFilled, targetFilled });
            return { success: true, filled: 0, message: `Grid already has ${currentFilled} filled. Target was ${targetFilled}.` };
        }

        for (let i = emptyIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [emptyIndices[i], emptyIndices[j]] = [emptyIndices[j], emptyIndices[i]];
        }
        const selected = emptyIndices.slice(0, needed);
        for (const idx of selected) {
            const name = DUMMY_NAMES[Math.floor(Math.random() * DUMMY_NAMES.length)];
            squares[idx] = { id: idx, owner: `${name}-${Math.floor(Math.random() * 999)}`, isPaid: true, timestamp: Date.now() };
        }
        await ref.update({ squares });

        await auditLegacy(uid, 'SIM_FILL_SQUARES', poolId, 'success', { filled: selected.length, targetFilled });
        return { success: true, filled: selected.length, message: `Filled ${selected.length} squares. Grid now has ${targetFilled} filled.` };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await auditLegacy(uid, 'SIM_FILL_SQUARES', poolId, 'error', {}, msg);
        throw e;
    }
});
