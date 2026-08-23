import { logger } from '../utils/logger';
import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    where,
    or,
    Timestamp,
    orderBy,
    limit,
    arrayUnion,
    addDoc
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { poolRepository } from "./poolRepository";
import { userRepository } from "./userRepository";
import { errorHandler, ErrorSeverity } from "./errorHandler";
import { withCorrelationId } from "../utils/correlationId";

// Mirrors functions/src/schemas/coCommissioners.ts (discriminated on `op`; `revision` only on add).
export type SetPoolCoCommissionerInput =
    | { poolId: string; uid: string; op: 'add'; revision: number }
    | { poolId: string; uid: string; op: 'remove' };
import { stripEmptyCallableFields } from "./callableParams";
export { db };
import type { GameState, User, Winner, PoolTheme, PlayerDetails, PropSeed, PropCard, PlayoffTeam, Pool, BracketEntry, Tournament, BanterMessage, NFLGame, WeeklyRecap } from "../types";
import type { PoolQuoteInput, PoolQuote, AddonSelection } from "@shared/schemas/quote";
import { FROZEN_SPREADS_COLLECTION, applyFrozenSpreads, type FrozenSpread } from "@shared/frozenSpread";

/**
 * What `getPoolPicks` hands a commissioner (PLAN-COMMISSIONER-BLIND-PICKS T2).
 * Mirrors `PoolPicksResponse` in functions/src/nflPickReveal.ts.
 *
 * `picks` / `confidence` / `tiebreakers` carry only what the server decided was
 * revealed; `counts` is available at any time and carries no pick content.
 */
export interface PoolPicksReveal {
    week: number;
    mode: 'WEEK' | 'PER_GAME';
    revealedGameIds: string[];
    weekRevealed: boolean;
    weekGameIds: string[];
    counts: Record<string, number>;
    picks: Record<string, Record<string, string>>;
    confidence: Record<string, Record<string, number>>;
    tiebreakers: Record<string, number>;
    /**
     * The pool-wide completion fraction — "12 of 16 players have their picks in".
     * Same for every principal, unlike every other field here. `{0, 0}` means the
     * server could not answer (no schema-2 `rosterSummary`, or an empty slate) and
     * the UI must render nothing rather than "0 of 0".
     *
     * ⚠️ OPTIONAL because THIS INTERFACE IS A HAND-WRITTEN MIRROR of
     * `PoolPicksResponse` in `functions/src/nflPickReveal.ts` and `getPoolPicks`
     * CASTS the response — nothing checks the two against each other. A client
     * built ahead of the functions deploy would otherwise read `undefined` through
     * a non-optional field. (PLAN-MEMBER-PICK-PROGRESS T3, codex r4.)
     */
    progress?: { complete: number; total: number };
}

// --- Monetization dashboard read shapes (PLAN-BUYFLOW-OVERHAUL Phase 6) -------
// Firestore is untyped; these are the client-side views of the docs the
// Monetization tab reads. Kept permissive (optional fields) so a partially
// populated / legacy doc never throws.

/** billingCharges/{id} — one immutable ledger row (amounts in dollars). */
export interface MonetizationBillingCharge {
    id: string;
    userId?: string;
    kind?: 'pool' | 'bundle' | 'refund' | 'dispute';
    amount?: number;
    poolId?: string;
    bundleType?: string;
    tier?: string;
    couponCode?: string;
    stripeSessionId?: string;
    paymentIntentId?: string;
    chargeId?: string;
    relatedChargeId?: string;
    at?: number;
}

/** coupons/{id} — includes the reservation-aware usageLog. */
export interface MonetizationCouponUsage {
    reservationId?: string;
    userId?: string;
    poolId?: string;
    status?: 'pending' | 'confirmed' | 'released';
    reservedAt?: number;
    confirmedAt?: number;
    releasedAt?: number;
    sessionId?: string;
    usedAt?: number;
}
export interface MonetizationCoupon {
    id: string;
    code: string;
    discountType?: 'percentage' | 'flat';
    discountValue?: number;
    isActive?: boolean;
    maxUses?: number;
    usesCount?: number;
    expiresAt?: number;
    createdAt?: number;
    perUserLimit?: number;
    allowedPoolTypes?: string[];
    usageLog?: MonetizationCouponUsage[];
}

/** bundles/{id} — canonical entitlement doc (owner-scoped). */
export interface MonetizationBundle {
    id: string;
    ownerId?: string;
    productKind?: 'CREDIT_BUNDLE' | 'UNLIMITED_PASS';
    source?: string;
    productSnapshot?: { name?: string; price?: number; poolType?: string; maxPlayersPerPool?: number };
    creditsTotal?: number;
    creditsUsed?: number;
    termEndsAt?: number;
    status?: 'active' | 'revoked' | 'exhausted' | 'expired';
    stripeSessionId?: string;
    paymentIntentId?: string;
    createdAt?: number;
    revokedReason?: string;
    revokedAt?: number;
}

/** monetization_alerts/{id} — abuse/housekeeping + Wave-2 refund/dispute alerts. */
export interface MonetizationAlert {
    id: string;
    type?: string;
    couponCode?: string;
    couponId?: string;
    poolId?: string;
    userId?: string;
    sessionId?: string;
    chargeId?: string;
    paymentIntentId?: string;
    amount?: number;
    message?: string;
    detail?: Record<string, unknown>;
    status?: 'open' | 'acked';
    source?: string;
    createdAt?: number;
    updatedAt?: number;
    acknowledgedBy?: string;
    acknowledgedAt?: number;
}

/** couponTemplates/{id} — reusable coupon definition (never redeemable itself). */
export interface MonetizationCouponTemplate {
    id: string;
    name: string;
    notes?: string;
    discountType?: 'percentage' | 'flat';
    discountValue?: number;
    isActive?: boolean;
    maxUses?: number;
    expiresAt?: number;
    perUserLimit?: number;
    allowedPoolTypes?: string[];
    createdAt?: number;
    updatedAt?: number;
}

/** Heartbeat written by the scheduled ESPN score sync (functions/src/scoreUpdates.ts) */
export interface ScoreSyncStatus {
    lastSyncAt: number;
    status: 'ok' | 'error';
    detail?: string;
}

/** Global statistics tracked across all pools */
export interface GlobalStats {
    /** Entries on non-SQUARES pools. Separate from `totalSquaresSold` on purpose:
     *  the SuperAdmin Overview used to add both into one "Squares Sold" figure —
     *  two different units under one label. Optional because the stored
     *  `stats/global` document does not carry it; only the client aggregate does. */
    totalEntries?: number;
    /** What the server actually stores as prize volume in `stats/global`
     *  (`statsTrigger.ts`). The interface previously named only `totalRevenue`,
     *  which the recompute writes as a backwards-compat alias of the same figure —
     *  so the field the document is really keyed on was missing from the type. */
    totalPrizes?: number;
    totalPools: number;
    totalSquaresSold: number;
    totalRevenue: number;
    totalUsers: number;
    totalDonated?: number;
    lastUpdated?: number;
}

export const dbService = {
    // --- POOLS ---
    async getPoolById(poolId: string): Promise<GameState | null> {
        return poolRepository.getById(poolId) as Promise<GameState | null>;
    },

    async getPoolBySlug(slug: string): Promise<Pool | null> {
        return poolRepository.getBySlug(slug);
    },

    async getPoolsByType(type: string): Promise<Pool[]> {
        const q = query(collection(db, 'pools'), where('type', '==', type), where('isPublic', '==', true));
        const snap = await getDocs(q);
        const pools: Pool[] = [];
        snap.forEach(doc => pools.push({ id: doc.id, ...doc.data() } as Pool));
        return pools;
    },

    onGlobalStatsUpdate: (callback: (stats: GlobalStats | null) => void, onError?: (error: Error) => void) => {
        return onSnapshot(doc(db, 'stats', 'global'), (doc) => {
            callback(doc.exists() ? doc.data() as GlobalStats : null);
        }, (err) => {
            logger.error("Global Stats Subscription Error:", err);
            if (onError) onError(err);
        });
    },

    /** Subscribe to the server score-sync heartbeat (system/scoreSync, world-readable). */
    subscribeToScoreSyncStatus: (callback: (status: ScoreSyncStatus | null) => void) => {
        return onSnapshot(doc(db, 'system', 'scoreSync'), (snap) => {
            callback(snap.exists() ? snap.data() as ScoreSyncStatus : null);
        }, (error) => {
            logger.error('[dbService] subscribeToScoreSyncStatus error:', error);
            callback(null);
        });
    },

    createPool: async (pool: Record<string, unknown>): Promise<string> => {
        try {
            const createPoolFn = httpsCallable<Record<string, unknown>, { success: boolean; poolId: string }>(functions, 'createPool');
            const result = await createPoolFn(pool);
            const { poolId } = result.data;
            return poolId;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'createPool', pool }
            });
            throw error;
        }
    },

    updatePool: async <T extends Pool>(poolId: string, updates: Partial<T> | Record<string, unknown>) => {
        const success = await poolRepository.update(poolId, {
            ...updates,
            updatedAt: Timestamp.now()
        } as Partial<Pool>);
        if (!success) {
            throw new Error(`Failed to update pool ${poolId}`);
        }
    },

    deletePool: async (poolId: string) => {
        const success = await poolRepository.delete(poolId);
        if (!success) {
            throw new Error(`Failed to delete pool ${poolId}`);
        }
    },

    archivePool: async (poolId: string, archive: boolean) => {
        try {
            const poolRef = doc(db, "pools", poolId);
            await updateDoc(poolRef, {
                status: archive ? 'archived' : 'active',
                updatedAt: Timestamp.now()
            });
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'archivePool', poolId, archive }
            });
            throw error;
        }
    },

    addToWaitlist: async (poolId: string, email: string, name: string) => {
        try {
            const poolRef = doc(db, "pools", poolId);
            const waitlistEntry = { email, name, timestamp: Date.now() };
            await updateDoc(poolRef, {
                waitlist: arrayUnion(waitlistEntry),
                updatedAt: Timestamp.now()
            });
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.LOW,
                context: { operation: 'addToWaitlist', poolId, email }
            });
            throw error;
        }
    },

    // --- PROP BETS ---
    purchasePropCard: async (poolId: string, answers: Record<string, number>, tiebreakerVal: number, userName: string, cardName?: string, email?: string) => {
        const fn = httpsCallable(functions, 'purchasePropCard');
        await fn(withCorrelationId({ poolId, answers, tiebreakerVal, userName, cardName, email }));
    },

    gradeProp: async (poolId: string, questionId: string, correctOptionIndex: number) => {
        const fn = httpsCallable(functions, 'gradeProp');
        await fn(withCorrelationId({ poolId, questionId, correctOptionIndex }));
    },

    getPropCards: async (poolId: string) => {
        const q = collection(db, 'pools', poolId, 'propCards');
        const snap = await getDocs(q);
        return snap.docs.map(d => d.data());
    },

    getBracketEntries: async (poolId: string) => {
        const q = collection(db, 'pools', poolId, 'entries');
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    // ===== BRACKET POOL METHODS =====
    subscribeToBanterMessages: (poolId: string, callback: (messages: BanterMessage[]) => void) => {
        const q = query(collection(db, 'pools', poolId, 'messages'), orderBy('timestamp', 'asc'), limit(150));
        return onSnapshot(q, (snapshot) => {
            const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BanterMessage));
            callback(messages);
        }, (error) => {
            logger.error('[dbService] subscribeToBanterMessages error:', error);
            callback([]);
        });
    },

    sendBanterMessage: async (poolId: string, message: Omit<BanterMessage, 'id'>) => {
        try {
            await addDoc(collection(db, 'pools', poolId, 'messages'), message);
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.LOW,
                context: { operation: 'sendBanterMessage', poolId, message }
            });
            throw error;
        }
    },

    /**
     * The banter feed NEWEST-FIRST (PLAN-WIZARD-BUYFLOW-FIXES T9).
     *
     * A separate reader from `subscribeToBanterMessages`, which is the bracket
     * chat transcript: that one is oldest-first and capped at 150 because a
     * chat log reads top-down. This is a feed — the last thing posted is the
     * thing to read — and `orderBy desc + limit` keeps a long-running pool from
     * pulling its whole history to show ten posts.
     */
    subscribeToPoolFeed: (poolId: string, callback: (messages: BanterMessage[]) => void, onError?: (e: unknown) => void) => {
        const q = query(collection(db, 'pools', poolId, 'messages'), orderBy('timestamp', 'desc'), limit(50));
        return onSnapshot(q, (snapshot) => {
            callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as BanterMessage)));
        }, (error) => {
            logger.error('[dbService] subscribeToPoolFeed error:', error);
            // ⚠️ Report rather than swallow. `onSnapshot` TERMINATES a listener on
            // error, so a permission-denied (a non-participant, or a rules
            // regression) means nothing ever arrives — and an empty array is
            // indistinguishable from "this pool has no banter yet". The caller
            // needs to be able to say which.
            if (onError) onError(error); else callback([]);
        });
    },

    /**
     * The requester's own BANTER requests (T9, codex r5 [P2]).
     *
     * Generation is ASYNCHRONOUS: the card gets an optimistic "it appears in a
     * few seconds" toast, and if the provider fails, the model returns nothing,
     * or authority was revoked between request and publication, `onAIRequest`
     * marks the request ERROR and NO post ever arrives. Without this the
     * commissioner would simply be left waiting for something that is not coming.
     *
     * Filtered by `userId` only and narrowed client-side, exactly as
     * `AICommissioner` does — a compound where() would need a composite index.
     */
    subscribeToMyBanterRequests: (poolId: string, userId: string, callback: (requests: { id: string; status: string; error?: string; createdAt: number }[]) => void) => {
        const q = query(collection(db, `pools/${poolId}/ai_requests`), where('userId', '==', userId));
        return onSnapshot(q, (snap) => {
            callback(
                snap.docs
                    .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as { id: string; status: string; error?: string; createdAt: number; category?: string })
                    .filter(r => r.category === 'BANTER')
                    .sort((a, b) => b.createdAt - a.createdAt),
            );
        }, (error) => {
            logger.error('[dbService] subscribeToMyBanterRequests error:', error);
            callback([]);
        });
    },

    /** Commissioner moderation (T9). Rules allow delete for owner/manager/co-commissioner only. */
    deletePoolMessage: async (poolId: string, messageId: string) => {
        await deleteDoc(doc(db, 'pools', poolId, 'messages', messageId));
    },

    /**
     * Ask the AI Commissioner for a banter post (T9).
     *
     * Writes an `ai_requests` doc, exactly like the dispute/insight paths — the
     * SAME collection `onAIRequest` triggers on, so this inherits the
     * four-condition create rule and the entitlement gate rather than opening a
     * second route to the paid provider. The generated post arrives in the feed
     * subscription above; nothing is returned here.
     */
    requestAIBanter: async (poolId: string, userId: string, prompt: string, mood: 'savage' | 'professional' | 'analyst') => {
        await addDoc(collection(db, `pools/${poolId}/ai_requests`), {
            userId,
            poolId,
            question: prompt,
            category: 'BANTER',
            mood,
            status: 'PENDING',
            createdAt: Date.now(),
        });
    },

    subscribeToBracketEntries: (poolId: string, callback: (entries: BracketEntry[]) => void) => {
        const q = query(collection(db, 'pools', poolId, 'entries'), orderBy('score', 'desc'));
        return onSnapshot(q, (snapshot) => {
            const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BracketEntry));
            callback(entries);
        }, (error) => {
            logger.error('[dbService] subscribeToBracketEntries error:', error);
            callback([]);
        });
    },

    getTournament: async (tournamentId: string): Promise<Tournament | null> => {
        try {
            const docRef = doc(db, 'tournaments', tournamentId);
            const snap = await getDoc(docRef);
            return snap.exists() ? { id: snap.id, ...snap.data() } as Tournament : null;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.LOW,
                context: { operation: 'getTournament', tournamentId }
            });
            return null;
        }
    },

    subscribeToBracketTournament: (tournamentId: string, callback: (tournament: Tournament | null) => void) => {
        const docRef = doc(db, 'tournaments', tournamentId);
        return onSnapshot(docRef, (snap) => {
            callback(snap.exists() ? { id: snap.id, ...snap.data() } as Tournament : null);
        }, (error) => {
            logger.error('[dbService] subscribeToBracketTournament error:', error);
            callback(null);
        });
    },

    createBracketEntry: async (poolId: string, data: { name: string; tiebreakerScore?: number }): Promise<{ success: boolean; entryId?: string; message?: string }> => {
        try {
            const fn = httpsCallable(functions, 'createBracketEntry');
            const result = await fn(withCorrelationId({ poolId, ...data }));
            return result.data as { success: boolean; entryId?: string; message?: string };
        } catch (error: unknown) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'createBracketEntry', poolId, data }
            });
            const msg = error instanceof Error ? error.message : 'Failed to create entry';
            return { success: false, message: msg };
        }
    },

    updateBracketPicks: async (poolId: string, entryId: string, picks: Record<string, string>, tieBreakerPrediction?: number, name?: string): Promise<{ success: boolean; message?: string }> => {
        try {
            const fn = httpsCallable(functions, 'updateBracketEntry');
            const result = await fn(withCorrelationId({ poolId, entryId, picks, tieBreakerPrediction, name }));
            return result.data as { success: boolean; message?: string };
        } catch (error: unknown) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'updateBracketPicks', poolId, entryId }
            });
            const msg = error instanceof Error ? error.message : 'Failed to update picks';
            return { success: false, message: msg };
        }
    },

    submitBracketEntry: async (poolId: string, entryId: string, picks: Record<string, string>, tieBreakerPrediction?: number, name?: string): Promise<{ success: boolean; message?: string }> => {
        try {
            const fn = httpsCallable(functions, 'submitBracketEntry');
            const result = await fn(withCorrelationId({ poolId, entryId, picks, tieBreakerPrediction, name }));
            return result.data as { success: boolean; message?: string };
        } catch (error: unknown) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'submitBracketEntry', poolId, entryId }
            });
            const msg = error instanceof Error ? error.message : 'Failed to submit bracket';
            return { success: false, message: msg };
        }
    },

    deleteBracketEntry: async (poolId: string, entryId: string): Promise<{ success: boolean; message?: string }> => {
        try {
            const fn = httpsCallable(functions, 'deleteBracketEntry');
            const result = await fn(withCorrelationId({ poolId, entryId }));
            return result.data as { success: boolean; message?: string };
        } catch (error: unknown) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'deleteBracketEntry', poolId, entryId }
            });
            const msg = error instanceof Error ? error.message : 'Failed to delete bracket entry';
            return { success: false, message: msg };
        }
    },

    updateBracketPool: async (poolId: string, updates: Record<string, unknown>): Promise<void> => {
        const poolRef = doc(db, 'pools', poolId);
        await updateDoc(poolRef, { ...updates, updatedAt: Date.now() });
    },

    // Server-side since Phase 5 (updateEntryPayment callable): the old raw
    // entry write depended on the dropped SUPER_ADMIN entries rule — and never
    // worked for ordinary commissioners at all. The callable authorizes
    // owner/manager/creator/SUPER_ADMIN and writes the audit trail.
    updateBracketEntryPayment: async (
        poolId: string, entryId: string, paidStatus: 'PAID' | 'UNPAID',
        paymentMethod?: 'Cash' | 'Check' | 'Venmo' | 'Google Pay' | 'Cash.me' | 'Other',
        details?: { paidAt?: number | null; paymentNote?: string | null },
    ): Promise<void> => {
        const fn = httpsCallable(functions, 'updateEntryPayment');
        await fn(withCorrelationId({
            poolId, entryId, paidStatus,
            ...(paymentMethod ? { paymentMethod } : {}),
            ...(details?.paidAt !== undefined ? { paidAt: details.paidAt } : {}),
            ...(details?.paymentNote !== undefined ? { paymentNote: details.paymentNote } : {}),
        }));
    },

    // Member Record roster (ADR 0003): every member who joined, incl. the commissioner and
    // members who have not yet submitted an entry. Empty until the backfill runs.
    subscribeToPoolMembers: (poolId: string, callback: (members: any[]) => void) => {
        const q = query(collection(db, 'pools', poolId, 'members'));
        return onSnapshot(q, (snapshot) => {
            callback(snapshot.docs.map(d => ({ uid: d.id, ...d.data() })));
        }, () => callback([]));
    },

    // Authoritative paid-status write via the setPaidStatus callable — works for members
    // with OR without an entry (writes the Member Record + ledger, and mirrors the display
    // fields onto the entry doc when one exists). Commissioner/owner only. The optional
    // details carry the Bento ledger's method/date/note (PLAN-PAYMENT-TRUTH P1).
    setPaidStatus: async (
        poolId: string, memberUid: string, isPaid: boolean,
        details?: { paymentMethod?: string; paidAt?: number | null; paymentNote?: string | null },
    ): Promise<void> => {
        const fn = httpsCallable(functions, 'setPaidStatus');
        await fn(withCorrelationId({
            poolId, memberUid, isPaid,
            ...(details?.paymentMethod ? { paymentMethod: details.paymentMethod } : {}),
            ...(details?.paidAt !== undefined ? { paidAt: details.paidAt } : {}),
            ...(details?.paymentNote !== undefined ? { paymentNote: details.paymentNote } : {}),
        }));
    },

    // The ONLY writer of pool.coManagers (PLAN-CO-COMMISSIONERS D2). ONE uid per
    // call, never an array — a full replacement would reinstate the stale-tab
    // race the revision fence closes. `add` presents the coManagersRevision the
    // caller SAW (absent = 0) and fails `failed-precondition` if it has moved;
    // `remove` presents nothing and always wins.
    setPoolCoCommissioner: async (input: SetPoolCoCommissionerInput): Promise<void> => {
        const fn = httpsCallable<SetPoolCoCommissionerInput & { _correlationId?: string }, { success: true; coManagers: string[]; coManagersRevision: number }>(functions, 'setPoolCoCommissioner');
        await fn(withCorrelationId(input));
    },

    // Rebuy settlement (PLAN-PAYMENT-TRUTH P3): commissioner marks a member's
    // rebuy dues settled (rebuyPaid := rebuyOwed) or reverses it. Same callable,
    // third exclusive mode.
    settleRebuys: async (poolId: string, memberUid: string, settled: boolean): Promise<void> => {
        const fn = httpsCallable(functions, 'setPaidStatus');
        await fn(withCorrelationId({ poolId, memberUid, settleRebuys: settled }));
    },

    // Pool Consensus (ADR 0004) — server aggregate, post-lock, keyed by gameId. Member-readable.
    subscribeToPoolConsensus: (poolId: string, callback: (byGame: Record<string, any>) => void) => {
        const q = query(collection(db, 'pools', poolId, 'consensus'));
        return onSnapshot(q, (snap) => {
            const map: Record<string, any> = {};
            snap.docs.forEach(d => { map[d.id] = d.data(); });
            callback(map);
        }, () => callback({}));
    },

    // Site-Wide Consensus (ADR 0004) — public aggregate per pool type + week.
    subscribeToSiteConsensus: (season: string, seasonType: number, week: number, poolType: string, callback: (byGame: Record<string, any>) => void) => {
        const key = `${season}_${seasonType}_${week}`;
        const q = query(collection(db, 'consensus', key, poolType));
        return onSnapshot(q, (snap) => {
            const map: Record<string, any> = {};
            snap.docs.forEach(d => { map[d.id] = d.data(); });
            callback(map);
        }, () => callback({}));
    },

    // Live Win Probability (ADR 0004) — per-game subcollection, best-effort.
    subscribeToWinProb: (gameId: string, callback: (data: any | null) => void) => {
        const ref = doc(db, 'nfl_games', gameId, 'winprob', 'current');
        return onSnapshot(ref, (snap) => callback(snap.exists() ? snap.data() : null), () => callback(null));
    },

    // Player Profile projection (ADR 0004/0005) — sanitized public stats.
    subscribeToPublicProfile: (uid: string, callback: (data: any | null) => void) => {
        const ref = doc(db, 'publicProfiles', uid);
        return onSnapshot(ref, (snap) => callback(snap.exists() ? { uid, ...snap.data() } : null), () => callback(null));
    },

    // Earned achievements (ADR 0005) — world-readable subcollection; engine is future work.
    subscribeToAchievements: (subjectId: string, callback: (rows: any[]) => void) => {
        const q = query(collection(db, 'publicProfiles', subjectId, 'achievements'));
        return onSnapshot(q, (snap) => {
            callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }, () => callback([]));
    },

    // Viewer-gated per-pool profile detail (ADR 0005 decision 7). Server enforces
    // subject/co-member-of-that-pool/admin; throws permission-denied otherwise.
    getProfilePoolDetail: async (subjectId: string, poolId: string) => {
        const fn = httpsCallable(functions, 'getProfilePoolDetail');
        const res = await fn(withCorrelationId({ subjectId, poolId }));
        return res.data as any;
    },

    // The signed-in viewer's own participations (own-readable). Used to discover which
    // pools the viewer might share with a profile subject.
    getMyParticipations: async (uid: string) => {
        const snap = await getDocs(collection(db, 'users', uid, 'participations'));
        return snap.docs.map(d => ({ poolId: d.id, ...d.data() })) as any[];
    },

    // Self-heal: materialize the caller's own publicProfiles doc on demand (used when
    // a member visits their profile before any scoring has ever written it).
    recomputeMyProfile: async () => {
        const fn = httpsCallable(functions, 'recomputeMyProfile');
        const res = await fn(withCorrelationId({}));
        return res.data as any;
    },

    // Site-wide weekly averages (publicProfiles/_siteAverages, daily job) — the real
    // "league average" line on the profile Performance Chart. Null until first computed.
    getSiteAverages: async (): Promise<any | null> => {
        try {
            const snap = await getDoc(doc(db, 'publicProfiles', '_siteAverages'));
            return snap.exists() ? snap.data() : null;
        } catch {
            return null;
        }
    },

    subscribeToPropCard: (poolId: string, userId: string, callback: (card: PropCard | null) => void) => {
        const docRef = doc(db, 'pools', poolId, 'propCards', userId);
        return onSnapshot(docRef, (doc) => {
            callback(doc.exists() ? doc.data() as PropCard : null);
        });
    },

    subscribeToPropCards: (poolId: string, callback: (cards: PropCard[]) => void) => {
        const q = query(collection(db, 'pools', poolId, 'propCards'));
        return onSnapshot(q, (snapshot) => {
            const cards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PropCard));
            callback(cards);
        });
    },

    subscribeToUserPropCards: (poolId: string, userId: string, callback: (cards: PropCard[]) => void) => {
        const q = query(collection(db, 'pools', poolId, 'propCards'), where('userId', '==', userId));
        return onSnapshot(q, (snapshot) => {
            const cards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PropCard));
            callback(cards);
        });
    },

    subscribeToAllPropCards: (poolId: string, callback: (cards: PropCard[]) => void) => {
        const q = collection(db, 'pools', poolId, 'propCards');
        return onSnapshot(q, (snapshot) => {
            const cards = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as PropCard);
            callback(cards);
        }, (error) => {
            logger.error("Error subscribing to all prop cards:", error);
            callback([]);
        });
    },

    deletePropCard: async (poolId: string, cardId: string) => {
        try {
            const cardRef = doc(db, 'pools', poolId, 'propCards', cardId);
            await deleteDoc(cardRef);
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'deletePropCard', poolId, cardId }
            });
            throw error;
        }
    },

    updatePropCard: async (poolId: string, cardId: string, updates: Partial<PropCard> | Record<string, unknown>) => {
        try {
            const cardRef = doc(db, 'pools', poolId, 'propCards', cardId);
            await updateDoc(cardRef, updates);
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'updatePropCard', poolId, cardId }
            });
            throw error;
        }
    },

    joinWaitlist: async (poolId: string, entry: { email: string; name: string; timestamp: number }) => {
        try {
            const fn = httpsCallable(functions, 'joinWaitlist');
            await fn(withCorrelationId({ poolId, name: entry.name, email: entry.email }));
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.LOW,
                context: { operation: 'joinWaitlist', poolId, entry }
            });
            throw error;
        }
    },

    // --- CLOUD FUNCTIONS ---
    toggleWinnerPaid: async (poolId: string, winnerId: string): Promise<{ success: boolean; isPaid: boolean }> => {
        try {
            const fn = httpsCallable(functions, 'toggleWinnerPaid');
            const result = await fn(withCorrelationId({ poolId, winnerId }));
            return result.data as { success: boolean; isPaid: boolean };
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'toggleWinnerPaid', poolId, winnerId }
            });
            throw error;
        }
    },

    syncAllUsers: async (): Promise<{ success: boolean; count: number }> => {
        try {
            const syncFn = httpsCallable(functions, 'syncAllUsers');
            const result = await syncFn(withCorrelationId(undefined));
            return result.data as { success: boolean; count: number };
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'syncAllUsers' }
            });
            throw error;
        }
    },

    syncMyClaims: async (): Promise<{ success: boolean; role: string; message: string }> => {
        try {
            const syncClaimsFn = httpsCallable(functions, 'syncMyClaims');
            const result = await syncClaimsFn(withCorrelationId(undefined));
            return result.data as { success: boolean; role: string; message: string };
        } catch (error) {
            console.error("Failed to sync my claims:", error);
            throw error;
        }
    },

    recalculateGlobalStats: async (): Promise<Record<string, unknown>> => {
        try {
            const recalcFn = httpsCallable<void, Record<string, unknown>>(functions, 'recalculateGlobalStats');
            const result = await recalcFn();
            return result.data;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'recalculateGlobalStats' }
            });
            throw error;
        }
    },

    lockPool: async (poolId: string, forceAxis: boolean = false): Promise<void> => {
        try {
            const lockPoolFn = httpsCallable(functions, 'lockPool');
            await lockPoolFn(withCorrelationId({ poolId, forceAxis }));
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'lockPool', poolId }
            });
            throw error;
        }
    },

    fixParticipantIds: async (dryRun: boolean = true): Promise<Record<string, unknown>> => {
        try {
            const fn = httpsCallable<{ dryRun: boolean }, Record<string, unknown>>(functions, 'fixParticipantIds');
            const result = await fn({ dryRun });
            return result.data;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'fixParticipantIds', dryRun }
            });
            throw error;
        }
    },

    reserveSquare: async (poolId: string, squareId: number, customerDetails?: PlayerDetails, guestDeviceKey?: string, pickedAsName?: string): Promise<void> => {
        try {
            const reserveSquareFn = httpsCallable(functions, 'reserveSquare');
            await reserveSquareFn(withCorrelationId({ poolId, squareId, customerDetails, guestDeviceKey, pickedAsName }));
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'reserveSquare', poolId, squareId }
            });
            throw error;
        }
    },

    // --- SQUARE PRIVATE (Player PII, audit H1) ---
    // Contact info lives in /pools/{poolId}/squarePrivate/{squareId}, readable
    // only by owner/manager/SuperAdmin. Returns a squareId -> details map.
    subscribeToSquarePrivate: (poolId: string, callback: (map: Record<number, PlayerDetails>) => void) => {
        const col = collection(db, 'pools', poolId, 'squarePrivate');
        return onSnapshot(col, (snap) => {
            const map: Record<number, PlayerDetails> = {};
            snap.forEach(d => {
                const data = d.data() as PlayerDetails & { squareId?: number };
                const id = typeof data.squareId === 'number' ? data.squareId : Number(d.id);
                if (!Number.isNaN(id)) map[id] = data;
            });
            callback(map);
        }, (error) => {
            // Non-owners are denied by rules — that's expected, not a real error.
            logger.error('[dbService] subscribeToSquarePrivate error:', error);
            callback({});
        });
    },

    // One-shot fetch of unique emails for a pool (SuperAdmin exports).
    getSquarePrivateEmails: async (poolId: string): Promise<{ email: string; name?: string }[]> => {
        const snap = await getDocs(collection(db, 'pools', poolId, 'squarePrivate'));
        const out: { email: string; name?: string }[] = [];
        snap.forEach(d => {
            const data = d.data() as PlayerDetails & { name?: string };
            if (data.email) out.push({ email: data.email, name: data.name });
        });
        return out;
    },

    updatePlayer: async (poolId: string, originalName: string, details: { name: string; email: string; phone: string; notes: string }): Promise<void> => {
        try {
            const fn = httpsCallable(functions, 'updatePlayer');
            await fn(withCorrelationId({ poolId, originalName, details }));
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'updatePlayer', poolId, originalName }
            });
            throw error;
        }
    },

    releaseSquares: async (poolId: string, opts: { squareIds?: number[]; ownerName?: string }): Promise<void> => {
        try {
            const fn = httpsCallable(functions, 'releaseSquares');
            await fn(withCorrelationId({ poolId, ...opts }));
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'releaseSquares', poolId }
            });
            throw error;
        }
    },

    confirmPayment: async (poolId: string, squareIds: number[]): Promise<{ success: boolean; squaresConfirmed: number }> => {
        try {
            const confirmPaymentFn = httpsCallable<{ poolId: string; squareIds: number[] }, { success: boolean; squaresConfirmed: number }>(functions, 'confirmPayment');
            const result = await confirmPaymentFn({ poolId, squareIds });
            return result.data;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'confirmPayment', poolId, squareIds }
            });
            throw error;
        }
    },

    createClaimCode: async (poolId: string, guestDeviceKey: string): Promise<{ claimCode: string; claimId: string }> => {
        try {
            const fn = httpsCallable(functions, 'createClaimCode');
            const result = await fn(withCorrelationId({ poolId, guestDeviceKey }));
            return result.data as { claimCode: string; claimId: string };
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'createClaimCode', poolId }
            });
            throw error;
        }
    },

    // --- Prop Seeds ---
    getPropSeeds: async (): Promise<PropSeed[]> => {
        try {
            const snapshot = await getDocs(collection(db, 'prop_questions'));
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PropSeed));
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.LOW,
                context: { operation: 'getPropSeeds' }
            });
            return [];
        }
    },

    createPropSeed: async (seed: Omit<PropSeed, 'id'>): Promise<void> => {
        try {
            await addDoc(collection(db, 'prop_questions'), seed);
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'createPropSeed', seed }
            });
            throw error;
        }
    },

    claimMySquares: async (poolId: string, guestDeviceKey: string): Promise<{ success: boolean; warnings: string[] }> => {
        try {
            const fn = httpsCallable(functions, 'claimMySquares');
            const result = await fn(withCorrelationId({ poolId, guestDeviceKey }));
            return result.data as { success: boolean; warnings: string[] };
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'claimMySquares', poolId }
            });
            throw error;
        }
    },

    claimByCode: async (claimCode: string): Promise<{ success: boolean; poolId: string }> => {
        try {
            const fn = httpsCallable(functions, 'claimByCode');
            const result = await fn(withCorrelationId({ claimCode }));
            return result.data as { success: boolean; poolId: string };
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'claimByCode' }
            });
            throw error;
        }
    },

    // Safety ceilings on pool subscriptions (T9). Chosen well above current
    // scale so no pool is hidden today; when a cap is hit we warn rather than
    // silently truncate (a future ticket adds real pagination).
    subscribeToPools: (callback: (pools: Pool[]) => void, onError?: (error: Error) => void, ownerId?: string) => {
        const CAP = 500;
        let q;
        if (ownerId) {
            q = query(collection(db, "pools"), or(where("ownerId", "==", ownerId), where("managerUid", "==", ownerId)), limit(CAP));
        } else {
            q = query(collection(db, "pools"), where("isPublic", "==", true), limit(CAP));
        }
        return onSnapshot(q, (snapshot) => {
            if (snapshot.size >= CAP) logger.warn(`subscribeToPools hit the ${CAP}-pool cap; results truncated. Add pagination.`);
            const pools = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Pool));
            callback(pools);
        }, (error) => {
            logger.error("Pool Subscription Error:", error);
            if (onError) onError(error);
        });
    },

    // Commissioner Hub feed for NFL co-commissioners (PLAN-CO-COMMISSIONERS D7).
    // ⚠️ SHAPE IS LOAD-BEARING: a Firestore LIST rule is proved from the QUERY.
    // `array-contains` alone is DENIED — the rule can only prove the caller is
    // a co-manager if the query also pins the NFL types. Both shapes are pinned
    // in functions/scripts/coManagers.rules.test.mjs; change one, change both.
    subscribeToCoCommissionedPools: (userId: string, callback: (pools: Pool[]) => void, onError?: (error: Error) => void) => {
        const CAP = 100;
        const q = query(collection(db, "pools"),
            where("coManagers", "array-contains", userId),
            where("type", "in", ["NFL_PICKEM", "NFL_SURVIVOR", "NFL_MARGIN"]),
            limit(CAP));
        return onSnapshot(q, (snapshot) => {
            if (snapshot.size >= CAP) logger.warn(`subscribeToCoCommissionedPools hit the ${CAP}-pool cap for a user; results truncated.`);
            callback(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Pool)));
        }, (error) => {
            logger.error("Co-commissioned Pool Subscription Error:", error);
            if (onError) onError(error);
        });
    },

    subscribeToParticipatingPools: (userId: string, callback: (pools: Pool[]) => void, onError?: (error: Error) => void) => {
        const CAP = 200;
        const q = query(collection(db, "pools"), where("participantIds", "array-contains", userId), limit(CAP));
        return onSnapshot(q, (snapshot) => {
            if (snapshot.size >= CAP) logger.warn(`subscribeToParticipatingPools hit the ${CAP}-pool cap for a user; results truncated.`);
            const pools = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Pool));
            callback(pools);
        }, (error) => {
            logger.error("Participating Pool Subscription Error:", error);
            if (onError) onError(error);
        });
    },

    subscribeToAllPools: (callback: (pools: Pool[]) => void, onError?: (error: Error) => void) => {
        const CAP = 500;
        const q = query(collection(db, "pools"), limit(CAP));
        return onSnapshot(q, (snapshot) => {
            if (snapshot.size >= CAP) logger.warn(`subscribeToAllPools hit the ${CAP}-pool admin cap; results truncated. Add pagination.`);
            const pools = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Pool));
            callback(pools);
        }, (error) => {
            logger.error("Admin Pool Subscription Error:", error);
            if (onError) onError(error);
        });
    },

    // Platform revenue rollup (T14) — admin_stats/revenue, SUPER_ADMIN read.
    subscribeToRevenueStats: (callback: (rev: Record<string, unknown> | null) => void, onError?: (error: Error) => void) => {
        return onSnapshot(doc(db, "admin_stats", "revenue"), (snap) => {
            callback(snap.exists() ? snap.data() : null);
        }, (error) => {
            logger.error("Revenue Stats Subscription Error:", error);
            if (onError) onError(error);
        });
    },

    // Change a user's canonical role (T6). Server (setUserRole) validates the
    // caller is SUPER_ADMIN, dual-writes claim + doc, and revokes tokens on demotion.
    // One-time role backfill (T6). Rewrites legacy stored roles → canonical in
    // doc + claim. dryRun=true reports counts without writing. SUPER_ADMIN only.
    backfillUserRoles: async (dryRun: boolean): Promise<{ dryRun: boolean; wouldMigrate?: number; migrated?: number; more: boolean }> => {
        const fn = httpsCallable<{ dryRun: boolean }, { dryRun: boolean; wouldMigrate?: number; migrated?: number; more: boolean }>(functions, 'backfillUserRoles');
        return (await fn({ dryRun })).data;
    },

    setUserRole: async (targetUid: string, role: string): Promise<void> => {
        const fn = httpsCallable<{ targetUid: string; role: string }, { success: boolean; role: string }>(functions, 'setUserRole');
        await fn({ targetUid, role });
    },

    // Admin one-off email to a user (step 6c). Server (SUPER_ADMIN/MODERATOR)
    // sends + dual-writes the user's activity log (EMAIL_SENT) + admin_audit.
    sendUserEmail: async (targetUid: string, subject: string, body: string): Promise<void> => {
        const fn = httpsCallable<{ targetUid: string; subject: string; body: string }, { success: boolean }>(functions, 'sendUserEmail');
        await fn({ targetUid, subject, body });
    },

    // Close a pool into its terminal COMPLETED state (T2). Server dual-writes the
    // canonical status + legacy fields + closedVia:'ADMIN_CLOSE', and the triggers
    // skip it — zero member emails, zero stats deltas. Principal enforced server-side.
    closePool: async (poolId: string): Promise<void> => {
        const fn = httpsCallable<{ poolId: string }, { success: boolean }>(functions, 'closePool');
        await fn({ poolId });
    },

    // Server-side user lookup by email prefix (step 6b) — indexed, paged; avoids
    // scanning the full user list. SUPER_ADMIN/MODERATOR only, enforced server-side.
    searchUsersByEmail: async (prefix: string, limit = 25): Promise<User[]> => {
        const fn = httpsCallable<{ prefix: string; limit: number }, { users: User[]; count: number }>(functions, 'searchUsersByEmail');
        const res = await fn({ prefix, limit });
        return res.data.users;
    },

    // Audited billing/monetization admin ops (step 2). Each is SUPER_ADMIN-only
    // server-side and writes admin_audit; replaces direct client Firestore writes.
    adminSaveBillingConfig: async (kind: 'billing' | 'referral', config: Record<string, unknown>): Promise<void> => {
        const fn = httpsCallable<{ kind: string; config: Record<string, unknown> }, { success: boolean }>(functions, 'adminSaveBillingConfig');
        await fn({ kind, config });
    },
    adminManageCoupon: async (payload: { op: 'create' | 'delete' | 'toggle'; couponId?: string; data?: Record<string, unknown> }): Promise<{ couponId?: string }> => {
        const fn = httpsCallable<typeof payload, { success: boolean; couponId?: string }>(functions, 'adminManageCoupon');
        const res = await fn(payload);
        return { couponId: res.data.couponId };
    },
    adminUpdatePoolBilling: async (payload: { poolId: string; action: 'override' | 'extendTrial' | 'resetGrace'; data?: Record<string, unknown> }): Promise<void> => {
        const fn = httpsCallable<typeof payload, { success: boolean }>(functions, 'adminUpdatePoolBilling');
        await fn(payload);
    },
    adminAdjustUserCredits: async (targetUid: string, referralCredits: number, freePoolsAvailable: number): Promise<void> => {
        const fn = httpsCallable<{ targetUid: string; referralCredits: number; freePoolsAvailable: number }, { success: boolean }>(functions, 'adminAdjustUserCredits');
        await fn({ targetUid, referralCredits, freePoolsAvailable });
    },

    // --- Canonical entitlements (Bundles + Pool Credits) — PLAN Phase 4 #14-17 ---

    /** SUPER_ADMIN: grant a CREDIT_BUNDLE or UNLIMITED_PASS to a user (audited). */
    adminGrantEntitlement: async (payload: {
        targetUid: string;
        productKind: 'CREDIT_BUNDLE' | 'UNLIMITED_PASS';
        reason: string;
        name?: string;
        price?: number;
        poolType?: string;
        maxPlayersPerPool?: number;
        creditsTotal?: number;
        termDays?: number;
    }): Promise<{ bundleId?: string }> => {
        const fn = httpsCallable<typeof payload, { success: boolean; bundleId?: string }>(functions, 'adminGrantEntitlement');
        const res = await fn(payload);
        return { bundleId: res.data.bundleId };
    },

    /** SUPER_ADMIN: revoke a whole bundle, a single credit, or expire a pass early (audited). */
    adminRevokeEntitlement: async (payload: {
        bundleId: string;
        scope: 'bundle' | 'credit' | 'pass';
        creditId?: string;
        reason: string;
    }): Promise<{ revokedCredits?: number }> => {
        const fn = httpsCallable<typeof payload, { success: boolean; revokedCredits?: number }>(functions, 'adminRevokeEntitlement');
        const res = await fn(payload);
        return { revokedCredits: res.data.revokedCredits };
    },

    /** Redeem one owned Pool Credit to activate a trial pool. */
    redeemPoolCredit: async (payload: { poolId: string; bundleId?: string; creditId?: string }): Promise<{ bundleId?: string; creditId?: string; bundleStatus?: string }> => {
        const fn = httpsCallable<typeof payload, { success: boolean; bundleId?: string; creditId?: string; bundleStatus?: string }>(functions, 'redeemPoolCredit');
        const res = await fn(payload);
        return { bundleId: res.data.bundleId, creditId: res.data.creditId, bundleStatus: res.data.bundleStatus };
    },

    /**
     * Subscribe to the current user's bundles (owner-scoped). Read-only display
     * for the "My Bundles & Credits" dashboard card. Client reads of bundles
     * require the firestore rules Wave 5 adds; until then the listener will hit
     * permission-denied — `onError` receives it and callers degrade gracefully
     * (the card hides rather than crashing).
     */
    subscribeToMyBundles: (
        uid: string,
        callback: (bundles: Array<Record<string, unknown>>) => void,
        onError?: (error: Error) => void
    ) => {
        const q = query(collection(db, 'bundles'), where('ownerId', '==', uid));
        return onSnapshot(
            q,
            (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
            (error) => {
                logger.warn('subscribeToMyBundles failed (bundles rules pending Wave 5?):', error);
                if (onError) onError(error);
            }
        );
    },

    // Record an admin_audit entry for an Operations-panel action (T7).
    logAdminAction: async (entry: { action: string; targetType?: string; targetId?: string; metadata?: Record<string, unknown>; status?: 'success' | 'error'; error?: string }): Promise<void> => {
        try {
            const fn = httpsCallable<typeof entry, { success: boolean }>(functions, 'logAdminAction');
            await fn(entry);
        } catch (err) {
            logger.warn('logAdminAction failed (non-fatal):', err);
        }
    },

    // Admin Audit Log reader (T7). Most-recent admin actions across the platform.
    subscribeToAdminAudit: (callback: (entries: Record<string, unknown>[]) => void, onError?: (error: Error) => void, max = 100) => {
        const q = query(collection(db, "admin_audit"), orderBy("at", "desc"), limit(max));
        return onSnapshot(q, (snapshot) => {
            callback(snapshot.docs.map(d => ({ ...d.data(), id: d.id })));
        }, (error) => {
            logger.error("Admin Audit Subscription Error:", error);
            if (onError) onError(error);
        });
    },

    subscribeToPool: (identifier: string, callback: (pool: Pool | null) => void, onError?: (error: Error) => void) => {
        const isLikelyDocId = identifier.length === 20;
        if (isLikelyDocId) {
            return onSnapshot(doc(db, "pools", identifier), (docSnap) => {
                if (docSnap.exists()) {
                    callback({ ...docSnap.data(), id: docSnap.id } as Pool);
                } else {
                    callback(null);
                }
            }, (error) => {
                logger.error("Single Pool Subscription Error:", error);
                if (onError) onError(error);
                else callback(null);
            });
        }
        const q = query(collection(db, "pools"), or(where("urlSlug", "==", identifier), where("slug", "==", identifier)), limit(1));
        return onSnapshot(q, (snap) => {
            if (!snap.empty) {
                const d = snap.docs[0];
                callback({ ...d.data(), id: d.id } as Pool);
            } else {
                getDoc(doc(db, "pools", identifier)).then((docSnap) => {
                    if (docSnap.exists()) {
                        callback({ ...docSnap.data(), id: docSnap.id } as Pool);
                    } else {
                        callback(null);
                    }
                }).catch(() => {
                    callback(null);
                });
            }
        }, (error) => {
            logger.error("Slug Subscription Error:", error);
            if (onError) onError(error);
            else callback(null);
        });
    },

    subscribeToWinners: (poolId: string, callback: (winners: Winner[]) => void) => {
        const q = query(collection(db, "pools", poolId, "winners"));
        return onSnapshot(q, (snapshot) => {
            const winners = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as unknown as Winner);
            const sorted = winners.sort((a, b) => {
                const periodOrder: Record<string, number> = { 'q1': 1, 'half': 2, 'q3': 3, 'final': 4 };
                if (a.period === 'Event' && b.period === 'Event') {
                    const getReq = (id: string = '') => {
                        const parts = id.replace('event_', '').split('_');
                        const h = parseInt(parts[0]) || 0;
                        const a = parseInt(parts[1]) || 0;
                        return { h, a, total: h + a };
                    };
                    const scoreA = getReq(a.id);
                    const scoreB = getReq(b.id);
                    if (scoreA.total !== scoreB.total) return scoreA.total - scoreB.total;
                    return (a.id || '').localeCompare(b.id || '');
                } else if (a.period !== 'Event' && b.period !== 'Event') {
                    return (periodOrder[a.period] || 99) - (periodOrder[b.period] || 99);
                } else {
                    return a.period === 'Event' ? 1 : -1;
                }
            });
            callback(sorted);
        }, (error) => {
            logger.error("Error subscribing to winners:", error);
            callback([]);
        });
    },

    getWinners: async (poolId: string): Promise<Winner[]> => {
        const q = query(collection(db, "pools", poolId, "winners"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as unknown as Winner);
    },

    updateWinnerPaidStatus: async (poolId: string, winnerId: string) => {
        try {
            const fn = httpsCallable(functions, 'toggleWinnerPaid');
            await fn(withCorrelationId({ poolId, winnerId }));
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'updateWinnerPaidStatus', poolId, winnerId }
            });
            throw error;
        }
    },

    // --- USERS ---
    saveUser: async (user: User) => {
        try {
            const success = await userRepository.save(user.id, {
                ...user,
                lastLogin: Date.now()
            });
            if (!success) throw new Error('Failed to save user via repository');
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'saveUser', user }
            });
        }
    },

    getUser: async (uid: string): Promise<User | null> => {
        return userRepository.getById(uid);
    },

    updateUser: async (uid: string, updates: Partial<User>) => {
        return userRepository.update(uid, updates);
    },

    getAllUsers: async (): Promise<User[]> => {
        return userRepository.find();
    },

    deleteUser: async (userId: string) => {
        return userRepository.delete(userId);
    },

    deleteUserAccount: async (targetUid: string): Promise<Record<string, unknown>> => {
        try {
            const fn = httpsCallable<{ targetUid: string }, Record<string, unknown>>(functions, 'deleteUserAccount');
            const result = await fn({ targetUid });
            return result.data;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.CRITICAL,
                context: { operation: 'deleteUserAccount', targetUid }
            });
            throw error;
        }
    },

    sendAdminPasswordReset: async (email: string): Promise<Record<string, unknown>> => {
        try {
            const fn = httpsCallable<{ email: string }, Record<string, unknown>>(functions, 'sendAdminPasswordReset');
            const result = await fn({ email });
            return result.data;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'sendAdminPasswordReset', email }
            });
            throw error;
        }
    },

    // --- SYSTEM LOGS ---
    getSystemLogs: async (limitCount = 50): Promise<Record<string, unknown>[]> => {
        try {
            const q = query(collection(db, "system_logs"), orderBy("timestamp", "desc"), limit(limitCount));
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.LOW,
                context: { operation: 'getSystemLogs' }
            });
            return [];
        }
    },

    fixPoolScores: async (poolId?: string): Promise<Record<string, unknown>> => {
        try {
            const fn = httpsCallable<{ poolId?: string }, Record<string, unknown>>(functions, 'fixPoolScores');
            const result = await fn({ poolId });
            return result.data;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'fixPoolScores', poolId }
            });
            throw error;
        }
    },

    // --- THEMES ---
    subscribeToThemes: (callback: (themes: PoolTheme[]) => void) => {
        const q = query(collection(db, "themes"), orderBy("name"));
        return onSnapshot(q, (snapshot) => {
            const themes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PoolTheme));
            callback(themes);
        }, (error) => {
            logger.error("Error subscribing to themes:", error);
            callback([]);
        });
    },

    getActiveThemes: async (): Promise<PoolTheme[]> => {
        try {
            const q = query(collection(db, "themes"), where("isActive", "==", true), orderBy("name"));
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PoolTheme));
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.LOW,
                context: { operation: 'getActiveThemes' }
            });
            return [];
        }
    },

    saveTheme: async (theme: Partial<PoolTheme> & { id?: string }): Promise<string> => {
        try {
            const themeId = theme.id || doc(collection(db, "themes")).id;
            const themeRef = doc(db, "themes", themeId);
            await setDoc(themeRef, {
                ...theme,
                id: themeId,
                updatedAt: Date.now()
            }, { merge: true });
            return themeId;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'saveTheme', theme }
            });
            throw error;
        }
    },

    deleteTheme: async (themeId: string): Promise<void> => {
        try {
            await deleteDoc(doc(db, "themes", themeId));
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'deleteTheme', themeId }
            });
            throw error;
        }
    },

    setDefaultTheme: async (themeId: string): Promise<void> => {
        try {
            const q = query(collection(db, "themes"), where("isDefault", "==", true));
            const snapshot = await getDocs(q);
            for (const docSnap of snapshot.docs) {
                if (docSnap.id !== themeId) {
                    await updateDoc(doc(db, "themes", docSnap.id), { isDefault: false });
                }
            }
            await updateDoc(doc(db, "themes", themeId), { isDefault: true });
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'setDefaultTheme', themeId }
            });
            throw error;
        }
    },

    // --- PROP SEEDS ---
    subscribeToPropSeeds: (callback: (seeds: PropSeed[]) => void) => {
        const q = query(collection(db, "prop_questions"), orderBy("createdAt", "desc"));
        return onSnapshot(q, (snapshot) => {
            const seeds = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PropSeed));
            callback(seeds);
        }, (error) => {
            logger.error("Error subscribing to prop seeds:", error);
            callback([]);
        });
    },

    savePropSeed: async (seed: Partial<PropSeed> & { id?: string }): Promise<string> => {
        try {
            const id = seed.id || doc(collection(db, "prop_questions")).id;
            const ref = doc(db, "prop_questions", id);
            await setDoc(ref, {
                ...seed,
                id,
                createdAt: seed.createdAt || Date.now()
            }, { merge: true });
            return id;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'savePropSeed', seed }
            });
            throw error;
        }
    },

    deletePropSeed: async (id: string): Promise<void> => {
        try {
            await deleteDoc(doc(db, "prop_questions", id));
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'deletePropSeed', id }
            });
            throw error;
        }
    },

    // --- GLOBAL PLAYOFF CONFIG ---
    subscribeToPlayoffConfig: (callback: (config: { teams: PlayoffTeam[] } | null) => void) => {
        return onSnapshot(doc(db, "config", "playoffs"), (docSnap) => {
            if (docSnap.exists()) {
                callback(docSnap.data() as { teams: PlayoffTeam[] });
            } else {
                callback(null);
            }
        });
    },

    savePlayoffConfig: async (teams: PlayoffTeam[]) => {
        try {
            await setDoc(doc(db, "config", "playoffs"), {
                teams,
                updatedAt: Date.now()
            });
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'savePlayoffConfig' }
            });
            throw error;
        }
    },

    syncPlayoffPools: async (): Promise<{ success: boolean; count: number; message: string }> => {
        try {
            const fn = httpsCallable(functions, 'syncPlayoffPools');
            const result = await fn(withCorrelationId(undefined));
            return result.data as { success: boolean; count: number; message: string };
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'syncPlayoffPools' }
            });
            throw error;
        }
    },

    managePlayoffEntry: async (poolId: string, entryId: string, action: 'togglePaid' | 'delete', value?: unknown): Promise<{ success: boolean; message: string }> => {
        try {
            const fn = httpsCallable(functions, 'managePlayoffEntry');
            const result = await fn(withCorrelationId({ poolId, entryId, action, value }));
            return result.data as { success: boolean; message: string };
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'managePlayoffEntry', poolId, entryId, action }
            });
            throw error;
        }
    },

    markSquarePaid: async (poolId: string, squareIds: number[], isPaid: boolean): Promise<{ success: boolean }> => {
        try {
            const fn = httpsCallable(functions, 'markSquaresPaid');
            const result = await fn(withCorrelationId({ poolId, squareIds, isPaid }));
            return result.data as { success: boolean };
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'markSquarePaid', poolId, squareIds }
            });
            throw error;
        }
    },

    // --- NFL POOLS ---
    createNFLPool: async (pool: Record<string, unknown>): Promise<string> => {
        try {
            const createNFLPoolFn = httpsCallable<Record<string, unknown>, { success: boolean; poolId: string }>(functions, 'createNFLPool');
            const result = await createNFLPoolFn(pool);
            const { poolId } = result.data;
            return poolId;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'createNFLPool', pool }
            });
            throw error;
        }
    },

    joinNFLPool: async (poolId: string): Promise<void> => {
        try {
            const joinNFLPoolFn = httpsCallable<{ poolId: string }, { success: boolean }>(functions, 'joinNFLPool');
            await joinNFLPoolFn({ poolId });
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'joinNFLPool', poolId }
            });
            throw error;
        }
    },

    /** `entryIndex` (1..max, default 1) + `entryName` — PLAN-MULTI-ENTRY T2; the server derives the entry id from the caller's uid. */
    submitNFLPicks: async (data: { poolId: string; week: number; picks: Record<string, string>; confidence?: Record<string, number>; tiebreakerPrediction?: number; requestId?: string; entryIndex?: number; entryName?: string; displayedTiebreakTargetIds?: string[] }): Promise<void> => {
        try {
            const submitNFLPicksFn = httpsCallable(functions, 'submitNFLPicks');
            await submitNFLPicksFn(withCorrelationId(data));
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'submitNFLPicks', data }
            });
            throw error;
        }
    },

    executeSurvivorRebuy: async (poolId: string, week: number, entryIndex?: number): Promise<void> => {
        try {
            const executeSurvivorRebuyFn = httpsCallable(functions, 'executeSurvivorRebuy');
            await executeSurvivorRebuyFn(withCorrelationId({ poolId, week, ...(entryIndex && entryIndex > 1 ? { entryIndex } : {}) }));
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'executeSurvivorRebuy', poolId, week }
            });
            throw error;
        }
    },

    scoreNFLWeek: async (poolId: string, week: number): Promise<{ message: string }> => {
        try {
            // Correlation id: this is the commissioner's manual Score & Recap
            // button, i.e. the documented FALLBACK for automated scoring. When it
            // is used, something has already gone sideways, so a call that leaves
            // no trace is exactly the wrong time to have no trace.
            const scoreNFLWeekFn = httpsCallable<{ poolId: string; week: number; _correlationId: string }, { success: boolean; message: string }>(functions, 'scoreNFLWeek');
            const result = await scoreNFLWeekFn(withCorrelationId({ poolId, week }));
            return { message: result.data.message };
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'scoreNFLWeek', poolId, week }
            });
            throw error;
        }
    },

    /** Commissioner nudge: email specific members (or all entries when targetUids is omitted) a picks/payment reminder. */
    sendManualReminder: async (poolId: string, targetUids: string[] | undefined, kind: 'PICKS' | 'PAYMENT'): Promise<{ sent: number; skipped: number; skippedNoEmail?: number; skippedRateLimited?: number; skippedNoBalance?: number }> => {
        try {
            // skippedNoEmail/skippedRateLimited are OPTIONAL: deployed functions older
            // than this change return neither, and the UI must not read `undefined`
            // as `0` and then assert a cause it was never told.
            const sendManualReminderFn = httpsCallable<{ poolId: string; targetUids?: string[]; kind: 'PICKS' | 'PAYMENT' }, { sent: number; skipped: number; skippedNoEmail?: number; skippedRateLimited?: number; skippedNoBalance?: number }>(functions, 'sendManualReminder');
            const result = await sendManualReminderFn({ poolId, targetUids, kind });
            return result.data;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'sendManualReminder', poolId, kind }
            });
            throw error;
        }
    },

    /**
     * Server-validated pool settings edit. REQUIRED for NFL pools — firestore.rules
     * denies a client-direct write to `settings` on them (PLAN-REALTIME-SCORING
     * §3a): a wholesale settings replacement is how a commissioner could otherwise
     * inject `weekLockOverrides` after a result was published, or wipe the
     * server-owned lock fields by simply omitting them. The callable merges per key
     * and carries the server-owned ones through untouched.
     */
    updatePoolSettings: async (poolId: string, updates: Record<string, unknown>): Promise<{ success: boolean }> => {
        try {
            const fn = httpsCallable<{ poolId: string; updates: Record<string, unknown> }, { success: boolean }>(functions, 'updatePoolSettings');
            const result = await fn({ poolId, updates });
            return result.data;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'updatePoolSettings', poolId }
            });
            throw error;
        }
    },

    /** Commissioner exception: extend a week's pick deadline by extraMinutes (capped at 24h server-side). Emails all members. */
    extendWeekDeadline: async (poolId: string, week: number, extraMinutes: number, reason: string): Promise<{ success: boolean; newLockTime: number; emailed: number }> => {
        try {
            const fn = httpsCallable<{ poolId: string; week: number; extraMinutes: number; reason: string }, { success: boolean; newLockTime: number; emailed: number }>(functions, 'extendWeekDeadline');
            const result = await fn({ poolId, week, extraMinutes, reason });
            return result.data;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'extendWeekDeadline', poolId, week, extraMinutes }
            });
            throw error;
        }
    },

    /** Commissioner exception: submit picks on behalf of a member. Picks shape matches submitNFLPicks (pick'em: gameId->team; survivor/margin: { [week]: team }). */
    proxyPick: async (poolId: string, week: number, targetUid: string, picks: Record<string | number, string>, reason: string, entryIndex?: number): Promise<{ success: boolean }> => {
        try {
            const fn = httpsCallable<{ poolId: string; week: number; targetUid: string; picks: Record<string | number, string>; reason: string; entryIndex?: number }, { success: boolean }>(functions, 'proxyPick');
            const result = await fn({ poolId, week, targetUid, picks, reason, ...(entryIndex && entryIndex > 1 ? { entryIndex } : {}) });
            return result.data;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'proxyPick', poolId, week, targetUid }
            });
            throw error;
        }
    },

    /** Commissioner exception: cancel a pool (status -> CANCELED). Emails all members with the reason and dues contact. */
    cancelPool: async (poolId: string, reason: string): Promise<{ success: boolean; emailed: number }> => {
        try {
            const fn = httpsCallable<{ poolId: string; reason: string }, { success: boolean; emailed: number }>(functions, 'cancelPool');
            const result = await fn({ poolId, reason });
            return result.data;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'cancelPool', poolId }
            });
            throw error;
        }
    },

    // withCorrelationId, added 2026-08-08. Kevin ran this import from SuperAdmin
    // on 2026-08-07 and reported it as a silent no-op with "ZERO invocation logs".
    // Without a correlation id, `validated()` emits NOTHING for a call it accepts
    // and NOTHING for one it rejects at the auth/role/schema gate — its
    // start/ok/error logging is entirely conditional on this key
    // (functions/src/lib/validated.ts). So an absent log was never evidence the
    // click failed to land; it is what a SUCCESSFUL call looks like too. Now the
    // question is answerable: `[correlation] importNFLSchedule start` proves
    // arrival, and `… error` carries the reason.
    // Safe on a strictObject schema — validated() strips the key before zod sees
    // it, which is why 29 other callables here already do this.
    importNFLSchedule: async (data: { season: string; seasonType: number; weeks?: number[] }): Promise<{ success: boolean; importedCount: number }> => {
        try {
            // Typed as the payload PLUS the correlation key, not widened to
            // Record<string, unknown>: `withCorrelationId` returns
            // `T & { _correlationId: string }`, so the callable keeps compile-time
            // checking of season/seasonType/weeks. The first version of this change
            // widened it and gave that up for nothing (qodo, PR #397).
            type ImportPayload = { season: string; seasonType: number; weeks?: number[] };
            const importNFLScheduleFn = httpsCallable<ImportPayload & { _correlationId: string }, { success: boolean; importedCount: number }>(functions, 'importNFLSchedule');
            const result = await importNFLScheduleFn(withCorrelationId({ ...data }));
            return result.data;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'importNFLSchedule', data }
            });
            throw error;
        }
    },

    /**
     * The season's games, with `spread` already resolved as `frozen ?? working`
     * (PLAN-NFL-SPREAD-FREEZE Revision 1).
     *
     * ⚠️ THE JOIN IS HERE, NOT IN THE COMPONENTS, AND THAT IS THE POINT. Once a
     * slate is frozen the canonical line lives in `nfl_frozen_spreads`, while
     * `nfl_games.spread` stays a WORKING line the feed and the Spread Manager may
     * still move. Every member-facing surface downstream of this subscription —
     * the pick sheet's `spreadLabel`, the "spreads not locked" banner, the picks
     * grid, the results view — reads `game.spread`. Resolve it once here and none
     * of them can show a member a number they will not be graded on; resolve it
     * per component and one of them eventually will not.
     *
     * The first emit WAITS for the frozen store's first snapshot. Emitting the
     * working line first and correcting it a beat later would render exactly the
     * wrong number, briefly, on the screen where it matters most. An empty
     * collection still fires immediately, and a read failure resolves the gate
     * too — so this can withhold the games at most as long as one snapshot takes,
     * never indefinitely.
     *
     * A frozen-store failure falls back to the working line rather than blanking
     * the slate: that is exactly today's behaviour, so a degraded read is no worse
     * than not having shipped this.
     */
    /**
     * PLAN-NFL-SPREAD-FREEZE 2.1 — the ONE path that may change a frozen line.
     *
     * A frozen record is refused to every client by `firestore.rules`, superadmin
     * included, so the Spread Manager cannot write one directly and must not try.
     * Also creates a frozen line for a game added to a slate after it froze, which
     * is the remediation path for a flex or a late addition.
     */
    overrideLockedSpread: async (payload: { gameId: string; value: number; reason: string }) => {
        const fn = httpsCallable(functions, 'overrideLockedSpread');
        const res = await fn(withCorrelationId(payload));
        return res.data as { success: true; overrideId: string; shape: 'amend' | 'create'; previousValue: number | null };
    },

    /**
     * PLAN-NFL-SPREAD-FREEZE 1.5b + the 2026-08-21 force option.
     *
     * Freeze a NAMED slate now, skipping the stated Tuesday-09:00-ET cutoff and the
     * 7-day horizon — and nothing else. Once-per-slate, all-or-nothing over the
     * whole week, the slate lease and "first kickoff still in the future" all still
     * apply, so this cannot half-freeze a week or re-freeze a done one.
     *
     * Requires a written reason, which lands in the `admin_audit` row. Freezing
     * early does not break fairness — every member still picks against an identical
     * line — but it does break the predictability members were promised, so it is a
     * decision somebody signs for.
     */
    runNFLSpreadFreeze: async (payload: {
        dryRun: boolean;
        force?: boolean;
        reason?: string;
        slate?: { season: string; seasonType: number; week: number };
    }) => {
        const fn = httpsCallable(functions, 'runNFLSpreadFreeze');
        const res = await fn(withCorrelationId(payload));
        return res.data as {
            enabled: boolean; ok: boolean; slate: string | null; dryRun: boolean;
            frozen: number; wouldFreeze: number; reason: string; noLine?: string[];
        };
    },

    /**
     * The frozen lines for a set of games, keyed by game id — what the Spread
     * Manager reads to know which rows it may still edit directly and which have
     * been committed to.
     *
     * ⚠️ BY GAME ID, NOT BY SLATE (codex r5 on PR 3). A game re-scheduled into
     * another week after its slate froze keeps the ORIGINAL slate on its frozen
     * record, deliberately — the override preserves it so `frozenAt` and the slate
     * stay as the freeze wrote them. A slate query therefore misses it from both
     * weeks: the manager would render it as an editable working line, saving would
     * not change the canonical value, and the Override button would be unreachable
     * from anywhere. Everything else in this design resolves a frozen line by game
     * id; so does this.
     */
    getFrozenSpreadsForGames: async (gameIds: string[]): Promise<Record<string, FrozenSpread>> => {
        // One `getDoc` each rather than an `in` query: a slate is ~16 games, and
        // `where(documentId(), 'in', …)` caps at 30 per query, so this avoids a
        // chunking rule that would only ever be wrong on the day it binds.
        const snaps = await Promise.all(gameIds.map(id => getDoc(doc(db, FROZEN_SPREADS_COLLECTION, id))));
        const out: Record<string, FrozenSpread> = {};
        for (const snap of snaps) {
            if (snap.exists()) out[snap.id] = { ...(snap.data() as FrozenSpread), gameId: snap.id };
        }
        return out;
    },

    subscribeToNFLGames: (season: string, callback: (games: NFLGame[]) => void) => {
        const seasonStr = String(season);
        console.log("[dbService] subscribeToNFLGames initiated for season:", seasonStr);

        let games: NFLGame[] | null = null;
        let frozen: Record<string, FrozenSpread> = {};
        let frozenReady = false;
        const emit = () => {
            if (!games || !frozenReady) return;
            callback(applyFrozenSpreads(games, frozen));
        };

        const q = query(collection(db, "nfl_games"), where("season", "==", seasonStr));
        const unsubGames = onSnapshot(q, (snapshot) => {
            const next = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as NFLGame));
            next.sort((a, b) => a.startTime - b.startTime);
            console.log(`[dbService] subscribeToNFLGames successfully loaded ${next.length} games:`,
                next.map(g => ({ id: g.id, week: g.week, seasonType: g.seasonType, season: g.season }))
            );
            games = next;
            emit();
        }, (error) => {
            console.error("[dbService] subscribeToNFLGames subscription error:", error);
            logger.error("Error subscribing to NFL games:", error);
            callback([]);
        });

        const frozenQ = query(collection(db, FROZEN_SPREADS_COLLECTION), where("season", "==", seasonStr));
        const unsubFrozen = onSnapshot(frozenQ, (snapshot) => {
            const next: Record<string, FrozenSpread> = {};
            for (const d of snapshot.docs) next[d.id] = { ...(d.data() as FrozenSpread), gameId: d.id };
            frozen = next;
            frozenReady = true;
            emit();
        }, (error) => {
            logger.error("Error subscribing to frozen NFL spreads (falling back to the working line):", error);
            frozenReady = true;
            emit();
        });

        return () => { unsubGames(); unsubFrozen(); };
    },

    // `subscribeToNFLEntries` — DELETED 2026-08-12 (PLAN-COMMISSIONER-BLIND-PICKS
    // T3/T4). It subscribed to the whole `pools/{id}/entries` collection for
    // manager/owner views, and firestore.rules serves that read to neither
    // principal any more. Left in place it would be a method whose comment
    // advertises a capability nobody has, swallowing the permission error into
    // `callback([])` — i.e. rendering a populated pool as an empty one.
    //
    // What replaced it: `subscribeToNFLStandings` + `subscribeToPoolMembers` +
    // `subscribeToMyNFLEntry` for the rows, and `getPoolPicks` below for pick
    // content past the reveal boundary. Do not reinstate it to fix a manager
    // surface — that reopens every week of the season to the commissioner.

    // Commissioner pick reads (PLAN-COMMISSIONER-BLIND-PICKS T2). Raw entry reads
    // by a pool's owner/manager are DENIED by firestore.rules as of 2026-08-12 —
    // an entry bundles every week's picks, so only a server-side clock can answer
    // "this week, these games". Returns per-member COUNTS at any time and pick
    // CONTENT only past the week's (or game's) effective lock. SUPER_ADMIN gets
    // everything. Never call this for a member view: it refuses participants.
    getPoolPicks: async (poolId: string, week: number): Promise<PoolPicksReveal> => {
        const fn = httpsCallable(functions, 'getPoolPicks');
        const res = await fn(withCorrelationId({ poolId, week }));
        return res.data as PoolPicksReveal;
    },

    // Standings projection (ADR 0005 Phase 2) — reveal-safe scored rows written by
    // scoreNFLWeek. What member views render instead of raw entries. Empty until the
    // pool's first scored week.
    subscribeToNFLStandings: (poolId: string, callback: (rows: any[]) => void) => {
        const ref = doc(db, 'pools', poolId, 'standings', 'current');
        return onSnapshot(ref, (snap) => {
            callback(snap.exists() ? ((snap.data() as any).rows || []) : []);
        }, (error) => {
            logger.error("Error subscribing to NFL standings:", error);
            callback([]);
        });
    },

    // Payout Records (ADR 0005 Phase 4) — who-won-what truth, participant-readable.
    // `onError` (optional): a caller that renders an empty state must be able to
    // tell "no records" from "could not read records" (qodo #2 on #465). Without
    // it the legacy behaviour stands: an error delivers [] to `callback`.
    subscribeToPayoutRecords: (poolId: string, callback: (records: any[]) => void, onError?: (error: unknown) => void) => {
        const q = query(collection(db, 'pools', poolId, 'payoutRecords'));
        return onSnapshot(q, (snap) => {
            callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }, (error) => {
            logger.error("Error subscribing to payout records:", error);
            if (onError) onError(error); else callback([]);
        });
    },

    // PLAN-PAYMENT-LEDGER T5: settlement state for the ledger. Rules admit the
    // commissioner/manager/co-commissioner/SA and the recipient of each doc; a
    // member's query is naturally limited to their own rows by `where uid`.
    // `onError` lets the ledger say "settlement state unavailable" instead of
    // rendering every award unpaid on a permission/offline error (qodo #10 on #456).
    subscribeToPayoutRecordsPrivate: (poolId: string, callback: (records: any[]) => void, uid?: string, onError?: (error: unknown) => void) => {
        const col = collection(db, 'pools', poolId, 'payoutRecordsPrivate');
        const q = uid ? query(col, where('uid', '==', uid)) : query(col);
        return onSnapshot(q, (snap) => {
            callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }, (error) => {
            logger.error("Error subscribing to payout records (private):", error);
            if (onError) onError(error); else callback([]);
        });
    },

    // Commissioner records who won what (server validates ownership + finalized pool).
    // PLAN-PAYMENT-LEDGER T4: a WEEKLY PLACE award carries `entryId` + `week` and
    // is bound server-side to the recap's published place + frozen prize
    // (deterministic id, idempotent); `staleAwardId` re-records after a rescore.
    recordPoolPayouts: async (poolId: string, awards: Array<{ uid: string; entryId?: string; amount: number; kind: string; place?: number; week?: number; settled: boolean; note?: string; supersedes?: string; staleAwardId?: string }>) => {
        const fn = httpsCallable(functions, 'recordPoolPayouts');
        const res = await fn(withCorrelationId({ poolId, awards }));
        return res.data as { success: boolean; awardIds: string[]; written?: number };
    },

    // PLAN-PAYMENT-LEDGER T4 (K5): the ledger's un-tick / re-tick. Flips
    // `settled` on the private record only; the amount is immutable.
    setPayoutSettled: async (poolId: string, awardId: string, settled: boolean) => {
        const fn = httpsCallable(functions, 'setPayoutSettled');
        const res = await fn(withCorrelationId({ poolId, awardId, settled }));
        return res.data as { success: boolean; changed: boolean };
    },

    // A member's own entry doc (NFL types key entries by uid). Own reads are always
    // allowed by rules; pairs with the standings projection for member views.
    // 🛑 A READ FAILURE IS NOT "YOU HAVE NO ENTRY", AND IT USED TO BE REPORTED AS
    // ONE. The success path already distinguishes the two — an absent document
    // calls back with `null` — so the error path calling back with `null` too
    // made a failed read indistinguishable from a member who has never picked.
    //
    // The consequence is not cosmetic. `NFLPoolDashboard` feeds this straight
    // into `WeekChecklist`, so one errored snapshot leaves the member reading
    // "picks not in yet" over a sheet they have completely filled in — and
    // Firestore's `onSnapshot` TERMINATES a listener on error, so it never
    // recovers on its own. Only a page reload re-subscribes, which is exactly
    // the shape of the report ("still says picks are not in until they
    // refresh", Kevin's testers, 2026-08-21).
    //
    // On error we now keep the last known state rather than overwriting it with
    // a claim we cannot support. A member who genuinely has no entry is still
    // told so, by the success path, which is the only path that knows.
    subscribeToMyNFLEntry: (poolId: string, uid: string, callback: (entry: any | null) => void) => {
        const ref = doc(db, 'pools', poolId, 'entries', uid);
        return onSnapshot(ref, (snap) => {
            callback(snap.exists() ? { ...snap.data(), id: snap.id } : null);
        }, (error) => {
            logger.error("Error subscribing to own NFL entry:", error);
        });
    },

    // `onError` (optional) — same reason as subscribeToPayoutRecords above.
    subscribeToWeeklyRecaps: (poolId: string, callback: (recaps: WeeklyRecap[]) => void, onError?: (error: unknown) => void) => {
        const q = query(collection(db, "pools", poolId, "weekly_recaps"), orderBy("week", "asc"));
        return onSnapshot(q, (snapshot) => {
            const recaps = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as WeeklyRecap));
            callback(recaps);
        }, (error) => {
            logger.error("Error subscribing to Weekly Recaps:", error);
            if (onError) onError(error); else callback([]);
        });
    },

    async redeemCoupon(poolId: string, couponCode: string): Promise<{
        valid: boolean;
        discountType?: 'percentage' | 'flat';
        discountValue?: number;
        message?: string;
    }> {
        try {
            const fn = httpsCallable<{ poolId: string; couponCode: string }, any>(functions, 'redeemCoupon');
            const result = await fn({ poolId, couponCode });
            return result.data;
        } catch (error: any) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'redeemCoupon', poolId, couponCode }
            });
            throw error;
        }
    },

    // Server is the single price authority (PLAN Phase 2): fetch an itemized,
    // coupon-inclusive quote. The client renders this verbatim — NO price math.
    async getPoolQuote(params: PoolQuoteInput): Promise<PoolQuote> {
        try {
            const fn = httpsCallable<Record<string, unknown>, PoolQuote>(functions, 'getPoolQuote');
            // MUST strip — see stripEmptyCallableFields. Both call sites set
            // `couponCode: … : undefined`, which reached the server as `null`
            // and failed `.optional()` on EVERY coupon-less quote. The card
            // renders `quote?.basePrice ?? 0`, so the failure displayed as a
            // FREE pool rather than as an error (PLAN-BUYFLOW-QUOTE-DEADEND).
            const result = await fn(stripEmptyCallableFields(params));
            return result.data;
        } catch (error: any) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { operation: 'getPoolQuote', params }
            });
            throw error;
        }
    },

    // Checkout hardened (PLAN Phase 2 #6): server prices the pool + validated
    // add-on booleans and derives redirect URLs from an allowlisted origin — the
    // client no longer sends `price`, `tier`, `successUrl`, or `cancelUrl`.
    // `bundleType` is still accepted for the multi-pool bundle store path.
    async createCheckoutSession(params: {
        poolId: string;
        poolName?: string;
        poolType?: string;
        estimatedPlayers?: number;
        addons?: AddonSelection;
        couponCode?: string;
        usedCredit?: boolean;
        customCreditId?: string;
        bundleType?: string;
    }): Promise<{ sessionUrl: string }> {
        try {
            const fn = httpsCallable<Record<string, unknown>, { sessionUrl: string }>(functions, 'createCheckoutSession');
            const result = await fn(stripEmptyCallableFields(params));
            return result.data;
        } catch (error: any) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'createCheckoutSession', params }
            });
            throw error;
        }
    },

    // ===================================================================
    // Monetization dashboard (PLAN-BUYFLOW-OVERHAUL Phase 6 #21-23).
    // SUPER_ADMIN-only reads (billingCharges/coupons/couponTemplates/
    // monetization_alerts) + template/ack callables. Reads are guarded: until
    // the Wave-5 firestore.rules land, some client reads return
    // permission-denied — every listener wires `onError` so the surface
    // degrades (shows an empty/locked state) rather than crashing.
    // ===================================================================

    /**
     * Subscribe to the immutable billingCharges ledger (SUPER_ADMIN read). The
     * accounting view derives ALL revenue numbers from these rows client-side.
     * Ordered newest-first; capped for safety.
     */
    subscribeToBillingCharges: (
        callback: (charges: MonetizationBillingCharge[]) => void,
        onError?: (error: Error) => void,
        max = 2000
    ) => {
        const q = query(collection(db, 'billingCharges'), orderBy('at', 'desc'), limit(max));
        return onSnapshot(
            q,
            (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) } as MonetizationBillingCharge))),
            (error) => {
                logger.warn('subscribeToBillingCharges failed (billingCharges rules require SUPER_ADMIN):', error);
                if (onError) onError(error);
            }
        );
    },

    /**
     * Subscribe to the coupons collection (SUPER_ADMIN read per ADR-0002). Feeds
     * the coupon-usage panel (per-coupon timelines, remaining uses, expiring).
     */
    subscribeToCoupons: (
        callback: (coupons: MonetizationCoupon[]) => void,
        onError?: (error: Error) => void
    ) => {
        const q = query(collection(db, 'coupons'), orderBy('createdAt', 'desc'));
        return onSnapshot(
            q,
            (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) } as MonetizationCoupon))),
            (error) => {
                logger.warn('subscribeToCoupons failed (coupons rules require SUPER_ADMIN):', error);
                if (onError) onError(error);
            }
        );
    },

    /**
     * Subscribe to all bundles (SUPER_ADMIN read all). Powers the bundle
     * liability panel — outstanding unredeemed credits across active bundles.
     */
    subscribeToAllBundles: (
        callback: (bundles: MonetizationBundle[]) => void,
        onError?: (error: Error) => void,
        max = 2000
    ) => {
        const q = query(collection(db, 'bundles'), limit(max));
        return onSnapshot(
            q,
            (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) } as MonetizationBundle))),
            (error) => {
                logger.warn('subscribeToAllBundles failed (bundles rules require SUPER_ADMIN read-all, pending Wave 5):', error);
                if (onError) onError(error);
            }
        );
    },

    /**
     * Subscribe to monetization_alerts (SUPER_ADMIN read). Surfaces the coupon
     * abuse / housekeeping alerts written by monetizationAlerts AND the Wave-2
     * refund/dispute/double-charge alerts. Newest-first.
     */
    subscribeToMonetizationAlerts: (
        callback: (alerts: MonetizationAlert[]) => void,
        onError?: (error: Error) => void,
        max = 200
    ) => {
        const q = query(collection(db, 'monetization_alerts'), orderBy('createdAt', 'desc'), limit(max));
        return onSnapshot(
            q,
            (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) } as MonetizationAlert))),
            (error) => {
                logger.warn('subscribeToMonetizationAlerts failed (rules require SUPER_ADMIN, pending Wave 5):', error);
                if (onError) onError(error);
            }
        );
    },

    /**
     * Subscribe to couponTemplates (SUPER_ADMIN direct client read; writes are
     * functions-only). Powers the template list in the Monetization tab.
     */
    subscribeToCouponTemplates: (
        callback: (templates: MonetizationCouponTemplate[]) => void,
        onError?: (error: Error) => void
    ) => {
        const q = query(collection(db, 'couponTemplates'), orderBy('createdAt', 'desc'));
        return onSnapshot(
            q,
            (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) } as MonetizationCouponTemplate))),
            (error) => {
                logger.warn('subscribeToCouponTemplates failed (couponTemplates rules require SUPER_ADMIN, pending Wave 5):', error);
                if (onError) onError(error);
            }
        );
    },

    /** SUPER_ADMIN: create a coupon template (also the "save as template" path). Audited. */
    createCouponTemplate: async (template: Record<string, unknown>): Promise<{ templateId?: string }> => {
        const fn = httpsCallable<Record<string, unknown>, { success: boolean; templateId?: string }>(functions, 'createCouponTemplate');
        const res = await fn(template);
        return { templateId: res.data.templateId };
    },

    /** SUPER_ADMIN: update an existing coupon template. Audited. */
    updateCouponTemplate: async (templateId: string, template: Record<string, unknown>): Promise<void> => {
        const fn = httpsCallable<{ templateId: string; template: Record<string, unknown> }, { success: boolean }>(functions, 'updateCouponTemplate');
        await fn({ templateId, template });
    },

    /** SUPER_ADMIN: delete a coupon template. Audited. */
    deleteCouponTemplate: async (templateId: string): Promise<void> => {
        const fn = httpsCallable<{ templateId: string }, { success: boolean }>(functions, 'deleteCouponTemplate');
        await fn({ templateId });
    },

    /** SUPER_ADMIN: mint a real coupon from a template (a fresh code + zero counters). Audited. */
    mintCouponFromTemplate: async (templateId: string, code: string): Promise<{ couponId?: string; code?: string }> => {
        const fn = httpsCallable<{ templateId: string; code: string }, { success: boolean; couponId?: string; code?: string }>(functions, 'mintCouponFromTemplate');
        const res = await fn({ templateId, code });
        return { couponId: res.data.couponId, code: res.data.code };
    },

    /** SUPER_ADMIN: flip a monetization alert open<->acked. Audited. */
    acknowledgeMonetizationAlert: async (alertId: string, status: 'acked' | 'open' = 'acked'): Promise<{ status?: string }> => {
        const fn = httpsCallable<{ alertId: string; status: 'acked' | 'open' }, { success: boolean; status?: string }>(functions, 'acknowledgeMonetizationAlert');
        const res = await fn({ alertId, status });
        return { status: res.data.status };
    }
};

