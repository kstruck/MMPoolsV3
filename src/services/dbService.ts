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
    addDoc,
    deleteField
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { poolRepository } from "./poolRepository";
import { userRepository } from "./userRepository";
import { errorHandler, ErrorSeverity } from "./errorHandler";
export { db };
import type { GameState, User, Winner, PoolTheme, PlayerDetails, PropSeed, PropCard, PlayoffTeam, Pool, BracketEntry, Tournament, BanterMessage, NFLGame, WeeklyRecap } from "../types";

/** Heartbeat written by the scheduled ESPN score sync (functions/src/scoreUpdates.ts) */
export interface ScoreSyncStatus {
    lastSyncAt: number;
    status: 'ok' | 'error';
    detail?: string;
}

/** Global statistics tracked across all pools */
export interface GlobalStats {
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
        await fn({ poolId, answers, tiebreakerVal, userName, cardName, email });
    },

    gradeProp: async (poolId: string, questionId: string, correctOptionIndex: number) => {
        const fn = httpsCallable(functions, 'gradeProp');
        await fn({ poolId, questionId, correctOptionIndex });
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
            const result = await fn({ poolId, ...data });
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
            const result = await fn({ poolId, entryId, picks, tieBreakerPrediction, name });
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
            const result = await fn({ poolId, entryId, picks, tieBreakerPrediction, name });
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
            const result = await fn({ poolId, entryId });
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

    updateBracketEntryPayment: async (poolId: string, entryId: string, paidStatus: 'PAID' | 'UNPAID', paymentMethod?: 'Cash' | 'Check' | 'Venmo' | 'Google Pay' | 'Cash.me' | 'Other'): Promise<void> => {
        const entryRef = doc(db, 'pools', poolId, 'entries', entryId);
        await updateDoc(entryRef, { paidStatus, paymentMethod: paymentMethod || deleteField(), updatedAt: Date.now() });
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
            await fn({ poolId, name: entry.name, email: entry.email });
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
            const result = await fn({ poolId, winnerId });
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
            const result = await syncFn();
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
            const result = await syncClaimsFn();
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
            await lockPoolFn({ poolId, forceAxis });
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
            await reserveSquareFn({ poolId, squareId, customerDetails, guestDeviceKey, pickedAsName });
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
            await fn({ poolId, originalName, details });
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
            await fn({ poolId, ...opts });
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
            const result = await fn({ poolId, guestDeviceKey });
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
            const result = await fn({ poolId, guestDeviceKey });
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
            const result = await fn({ claimCode });
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
    setUserRole: async (targetUid: string, role: string): Promise<void> => {
        const fn = httpsCallable<{ targetUid: string; role: string }, { success: boolean; role: string }>(functions, 'setUserRole');
        await fn({ targetUid, role });
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
            await fn({ poolId, winnerId });
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
            const result = await fn();
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
            const result = await fn({ poolId, entryId, action, value });
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
            const result = await fn({ poolId, squareIds, isPaid });
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

    submitNFLPicks: async (data: { poolId: string; week: number; picks: Record<string, string>; confidence?: Record<string, number>; tiebreakerPrediction?: number; requestId?: string }): Promise<void> => {
        try {
            const submitNFLPicksFn = httpsCallable(functions, 'submitNFLPicks');
            await submitNFLPicksFn(data);
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'submitNFLPicks', data }
            });
            throw error;
        }
    },

    executeSurvivorRebuy: async (poolId: string, week: number): Promise<void> => {
        try {
            const executeSurvivorRebuyFn = httpsCallable(functions, 'executeSurvivorRebuy');
            await executeSurvivorRebuyFn({ poolId, week });
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
            const scoreNFLWeekFn = httpsCallable<{ poolId: string; week: number }, { success: boolean; message: string }>(functions, 'scoreNFLWeek');
            const result = await scoreNFLWeekFn({ poolId, week });
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
    sendManualReminder: async (poolId: string, targetUids: string[] | undefined, kind: 'PICKS' | 'PAYMENT'): Promise<{ sent: number; skipped: number }> => {
        try {
            const sendManualReminderFn = httpsCallable<{ poolId: string; targetUids?: string[]; kind: 'PICKS' | 'PAYMENT' }, { sent: number; skipped: number }>(functions, 'sendManualReminder');
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
    proxyPick: async (poolId: string, week: number, targetUid: string, picks: Record<string | number, string>, reason: string): Promise<{ success: boolean }> => {
        try {
            const fn = httpsCallable<{ poolId: string; week: number; targetUid: string; picks: Record<string | number, string>; reason: string }, { success: boolean }>(functions, 'proxyPick');
            const result = await fn({ poolId, week, targetUid, picks, reason });
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

    importNFLSchedule: async (data: { season: string; seasonType: number; weeks?: number[] }): Promise<{ success: boolean; importedCount: number }> => {
        try {
            const importNFLScheduleFn = httpsCallable<{ season: string; seasonType: number; weeks?: number[] }, { success: boolean; importedCount: number }>(functions, 'importNFLSchedule');
            const result = await importNFLScheduleFn(data);
            return result.data;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'importNFLSchedule', data }
            });
            throw error;
        }
    },

    subscribeToNFLGames: (season: string, callback: (games: NFLGame[]) => void) => {
        const seasonStr = String(season);
        console.log("[dbService] subscribeToNFLGames initiated for season:", seasonStr);
        const q = query(collection(db, "nfl_games"), where("season", "==", seasonStr));
        return onSnapshot(q, (snapshot) => {
            const games = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as NFLGame));
            games.sort((a, b) => a.startTime - b.startTime);
            console.log(`[dbService] subscribeToNFLGames successfully loaded ${games.length} games:`, 
                games.map(g => ({ id: g.id, week: g.week, seasonType: g.seasonType, season: g.season }))
            );
            callback(games);
        }, (error) => {
            console.error("[dbService] subscribeToNFLGames subscription error:", error);
            logger.error("Error subscribing to NFL games:", error);
            callback([]);
        });
    },

    subscribeToNFLEntries: (poolId: string, callback: (entries: any[]) => void) => {
        const q = collection(db, "pools", poolId, "entries");
        return onSnapshot(q, (snapshot) => {
            const entries = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            callback(entries);
        }, (error) => {
            logger.error("Error subscribing to NFL entries:", error);
            callback([]);
        });
    },

    subscribeToWeeklyRecaps: (poolId: string, callback: (recaps: WeeklyRecap[]) => void) => {
        const q = query(collection(db, "pools", poolId, "weekly_recaps"), orderBy("week", "asc"));
        return onSnapshot(q, (snapshot) => {
            const recaps = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as WeeklyRecap));
            callback(recaps);
        }, (error) => {
            logger.error("Error subscribing to Weekly Recaps:", error);
            callback([]);
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

    async createCheckoutSession(params: {
        poolId: string;
        poolName: string;
        poolType: string;
        tier: string;
        price: number;
        couponCode?: string;
        referralCredits?: number;
    }): Promise<{ sessionUrl: string }> {
        try {
            const fn = httpsCallable<any, { sessionUrl: string }>(functions, 'createCheckoutSession');
            const result = await fn(params);
            return result.data;
        } catch (error: any) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { operation: 'createCheckoutSession', params }
            });
            throw error;
        }
    }
};

