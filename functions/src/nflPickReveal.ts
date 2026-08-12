/**
 * getPoolPicks — the ONE door a commissioner reads other members' picks through.
 *
 * PLAN-COMMISSIONER-BLIND-PICKS T2. Before this, a pool's owner and manager
 * could read every entry document in the pool at any time straight from
 * `firestore.rules`, which meant they saw everyone's picks before kickoff. T3
 * removes those two principals from the entries read rule; this callable is what
 * replaces them, and it is the one genuinely dangerous artifact in that plan.
 *
 * Why a callable and not a cleverer rule: an entry document bundles EVERY week's
 * picks, so no document-level rule can say "week 4 yes, week 5 no". Same reason
 * participants were moved to the standings projection in ADR 0005 Phase 2.
 *
 * Authorization, in words:
 *   - SUPER_ADMIN            → every pick, every week, any time (Kevin's ruling).
 *   - pool owner / manager   → pick CONTENT only for the games whose effective
 *                              lock has passed, plus per-member pick COUNTS at
 *                              any time (the roster's completeness column).
 *   - anyone else            → permission-denied. Ordinary participants are NOT
 *                              a principal here; nothing about member visibility
 *                              changes in this plan (Q5).
 *
 * ⚠️ The response is assembled by ALLOWLIST of revealed game ids, never by
 * filtering a copy of the entry. A mixed-locked pick'em week is the case that
 * matters: one game kicked off, fifteen not, and a week-granular answer would
 * leak all sixteen.
 */

import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { validated } from "./lib/validated";
import { getPoolPicksSchema } from "./schemas/pickReveal";
import { weekRevealFor, fullReveal, weekPickCount, type WeekReveal } from "./lib/pickReveal";
import type { NFLGame } from "./nflPoolTypes";

const NFL_TYPES = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'];

export interface PoolPicksResponse {
    week: number;
    mode: 'WEEK' | 'PER_GAME';
    /** Game ids whose picks are included below. The client renders nothing else. */
    revealedGameIds: string[];
    weekRevealed: boolean;
    /** Every game in the week's slate, so the client can size completeness. */
    weekGameIds: string[];
    /** uid → how many of this week's games they have saved a pick for. */
    counts: Record<string, number>;
    /** uid → { gameId|week → team }, revealed keys only. */
    picks: Record<string, Record<string, string>>;
    /** uid → { gameId → points }, revealed keys only. Pick'em confidence mode. */
    confidence: Record<string, Record<string, number>>;
    /**
     * uid → this week's MNF tiebreaker guess. Included ONLY once the whole week
     * is revealed: a predicted combined score is a per-week secret with no game
     * to attach it to, so a partly-locked week must not carry it. It is excluded
     * from the standings projection by allowlist for the same reason
     * (`buildStandingsRows`), which is why it has to come through this door.
     */
    tiebreakers: Record<string, number>;
}

/**
 * EXACTLY the principals the entries read rule used to name, and not one more:
 * `ownerId`, `managerUid`, `isSuperAdmin()`.
 *
 * ⚠️ Do NOT reach for `assertPoolOwnerOrSuperAdmin` here, tempting as it is.
 * That helper also admits `createdByUid` and a participant listed in
 * `coManagers` — neither of which the removed rule granted. Using it would make
 * this callable a WIDER door to pick data than the one it replaces, which is the
 * opposite of the point: a co-manager who could not read a single entry
 * yesterday would gain per-member completion counts before lock and revealed
 * picks after it. (codex r1 on this PR.)
 *
 * If co-managers should have this capability, that is a product decision that
 * changes the rule and this function together, deliberately.
 */
function assertPickReader(
    pool: { ownerId?: string; managerUid?: string },
    uid: string,
    role?: string,
): { isSuperAdmin: boolean } {
    if (role === 'SUPER_ADMIN') return { isSuperAdmin: true };
    if (pool.ownerId !== uid && pool.managerUid !== uid) {
        throw new HttpsError('permission-denied', 'Only this pool\'s commissioner can read the pool\'s picks.');
    }
    return { isSuperAdmin: false };
}

export const getPoolPicks = validated(
    { schema: getPoolPicksSchema, label: "getPoolPicks", appCheck: "monitor" },
    async (input, request): Promise<PoolPicksResponse> => {
        const uid = request.auth!.uid;
        const role = (request.auth!.token as { role?: string })?.role;
        const db = admin.firestore();
        const { poolId, week } = input;

        const poolSnap = await db.collection('pools').doc(poolId).get();
        if (!poolSnap.exists) throw new HttpsError('not-found', 'Pool not found.');
        const pool = poolSnap.data() as any;

        // Scoped to the three NFL season types on purpose (D4). Bracket and
        // playoff pools are single-lock and reveal everything post-lock by
        // design; they never lost their raw read and must not gain a second door.
        if (!NFL_TYPES.includes(pool.type)) {
            throw new HttpsError('failed-precondition', 'getPoolPicks is only available for NFL season pools.');
        }

        const { isSuperAdmin } = assertPickReader(pool, uid, role);

        // The week's slate — same query the submit path and the scorer use, so
        // the reveal boundary is computed over exactly the games that count.
        const gamesSnap = await db.collection('nfl_games')
            .where('season', '==', pool.season)
            .where('seasonType', '==', Number(pool.seasonType || 2))
            .where('week', '==', week)
            .get();
        const games = gamesSnap.docs.map(d => d.data() as NFLGame)
            .map(g => ({ id: g.id, startTime: g.startTime }));

        const reveal: WeekReveal = isSuperAdmin
            ? fullReveal(pool, games)
            : weekRevealFor(pool, week, games, Date.now());

        // ALLOWLIST. Built once, consulted per key. For Survivor/Margin the pick
        // is keyed by the week number rather than a game id, so the week's own
        // key joins the allowlist only when the WHOLE week is revealed — a
        // single kicked-off game must not expose a weekly pick.
        const allowedKeys = new Set<string>(reveal.revealedGameIds);
        if (reveal.weekRevealed) allowedKeys.add(String(week));

        const weekGameIds = games.map(g => g.id);
        const entriesSnap = await db.collection('pools').doc(poolId).collection('entries').get();

        const counts: Record<string, number> = {};
        const picks: Record<string, Record<string, string>> = {};
        const confidence: Record<string, Record<string, number>> = {};
        const tiebreakers: Record<string, number> = {};

        for (const doc of entriesSnap.docs) {
            const entry = doc.data() as {
                ownerUid?: string;
                picks?: Record<string, unknown>;
                confidence?: Record<string, unknown>;
                weeklyTiebreakers?: Record<string, unknown>;
            };
            const memberUid = entry.ownerUid || doc.id;
            counts[memberUid] = weekPickCount(pool.type, entry.picks as Record<string, unknown>, week, weekGameIds);

            const revealedPicks: Record<string, string> = {};
            for (const key of allowedKeys) {
                const value = entry.picks?.[key];
                if (typeof value === 'string' && value) revealedPicks[key] = value;
            }
            if (Object.keys(revealedPicks).length > 0) picks[memberUid] = revealedPicks;

            const revealedConfidence: Record<string, number> = {};
            for (const key of allowedKeys) {
                const value = entry.confidence?.[key];
                if (typeof value === 'number') revealedConfidence[key] = value;
            }
            if (Object.keys(revealedConfidence).length > 0) confidence[memberUid] = revealedConfidence;

            if (reveal.weekRevealed) {
                const tb = entry.weeklyTiebreakers?.[String(week)];
                if (typeof tb === 'number') tiebreakers[memberUid] = tb;
            }
        }

        return {
            week,
            mode: reveal.mode,
            revealedGameIds: reveal.revealedGameIds,
            weekRevealed: reveal.weekRevealed,
            weekGameIds,
            counts,
            picks,
            confidence,
            tiebreakers,
        };
    },
);
