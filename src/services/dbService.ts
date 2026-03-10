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
import type { GameState, User, Winner, PoolTheme, PlayerDetails, PropSeed, PropCard, PlayoffTeam, Pool, BracketEntry, Tournament, BanterMessage } from "../types";

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

    onGlobalStatsUpdate: (callback: (stats: GlobalStats | null) => void, onError?: (error: Error) => void) => {
        return onSnapshot(doc(db, 'stats', 'global'), (doc) => {
            callback(doc.exists() ? doc.data() as GlobalStats : null);
        }, (err) => {
            logger.error("Global Stats Subscription Error:", err);
            if (onError) onError(err);
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

    subscribeToPools: (callback: (pools: Pool[]) => void, onError?: (error: Error) => void, ownerId?: string) => {
        let q;
        if (ownerId) {
            q = query(collection(db, "pools"), or(where("ownerId", "==", ownerId), where("managerUid", "==", ownerId)));
        } else {
            q = query(collection(db, "pools"), where("isPublic", "==", true));
        }
        return onSnapshot(q, (snapshot) => {
            const pools = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Pool));
            callback(pools);
        }, (error) => {
            logger.error("Pool Subscription Error:", error);
            if (onError) onError(error);
        });
    },

    subscribeToParticipatingPools: (userId: string, callback: (pools: Pool[]) => void, onError?: (error: Error) => void) => {
        const q = query(collection(db, "pools"), where("participantIds", "array-contains", userId));
        return onSnapshot(q, (snapshot) => {
            const pools = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Pool));
            callback(pools);
        }, (error) => {
            logger.error("Participating Pool Subscription Error:", error);
            if (onError) onError(error);
        });
    },

    subscribeToAllPools: (callback: (pools: Pool[]) => void, onError?: (error: Error) => void) => {
        const q = query(collection(db, "pools"));
        return onSnapshot(q, (snapshot) => {
            const pools = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Pool));
            callback(pools);
        }, (error) => {
            logger.error("Admin Pool Subscription Error:", error);
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
    }
};
