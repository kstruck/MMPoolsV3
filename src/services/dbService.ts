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
export { db };
import type { GameState, User, Winner, PoolTheme, PlayerDetails, PropSeed, PropCard, PlayoffTeam } from "../types";

/** Global statistics tracked across all pools */
export interface GlobalStats {
    totalPools: number;
    totalSquaresSold: number;
    totalRevenue: number;
    totalUsers: number;
    lastUpdated?: number;
}

export const dbService = {
    // --- POOLS ---
    async getPoolById(poolId: string): Promise<GameState | null> {
        const d = await getDoc(doc(db, "pools", poolId));
        return d.exists() ? (d.data() as GameState) : null;
    },
    onGlobalStatsUpdate: (callback: (stats: GlobalStats | null) => void, onError?: (error: Error) => void) => {
        return onSnapshot(doc(db, 'stats', 'global'), (doc) => {
            callback(doc.exists() ? doc.data() as GlobalStats : null);
        }, (err) => {
            console.error("Global Stats Subscription Error:", err);
            if (onError) onError(err);
        });
    },

    createPool: async (pool: any): Promise<string> => {
        try {
            const createPoolFn = httpsCallable(functions, 'createPool');
            const result = await createPoolFn(pool);
            const { poolId } = result.data as { success: boolean; poolId: string };
            return poolId;
        } catch (error) {
            console.error("Error creating pool:", error);
            throw error;
        }
    },

    updatePool: async (poolId: string, updates: Partial<GameState>) => {
        console.log('[dbService] updatePool called', { poolId, updates });
        try {
            const poolRef = doc(db, "pools", poolId);
            await updateDoc(poolRef, {
                ...updates,
                updatedAt: Timestamp.now()
            });
            console.log('[dbService] updatePool SUCCESS');
        } catch (error) {
            console.error("[dbService] Error updating pool:", error);
            throw error;
        }
    },

    deletePool: async (poolId: string) => {
        try {
            await deleteDoc(doc(db, "pools", poolId));
        } catch (error) {
            console.error("Error deleting pool:", error);
            throw error;
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
            console.error("Error archiving pool:", error);
            throw error;
        }
    },

    addToWaitlist: async (poolId: string, email: string, name: string) => {
        try {
            const poolRef = doc(db, "pools", poolId);
            const waitlistEntry = {
                email,
                name,
                timestamp: Date.now()
            };
            await updateDoc(poolRef, {
                waitlist: arrayUnion(waitlistEntry),
                updatedAt: Timestamp.now()
            });
        } catch (error) {
            console.error("Error adding to waitlist:", error);
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

    subscribeToPropCard: (poolId: string, userId: string, callback: (card: any | null) => void) => {
        const docRef = doc(db, 'pools', poolId, 'propCards', userId);
        return onSnapshot(docRef, (doc) => {
            callback(doc.exists() ? doc.data() : null);
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
        const q = query(
            collection(db, 'pools', poolId, 'propCards'),
            where('userId', '==', userId)
        );
        return onSnapshot(q, (snapshot) => {
            const cards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PropCard));
            callback(cards);
        });
    },

    subscribeToAllPropCards: (poolId: string, callback: (cards: any[]) => void) => {
        const q = collection(db, 'pools', poolId, 'propCards');
        return onSnapshot(q, (snapshot) => {
            const cards = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            callback(cards);
        }, (error) => {
            console.error("Error subscribing to all prop cards:", error);
            callback([]);
        });
    },

    deletePropCard: async (poolId: string, cardId: string) => {
        try {
            const cardRef = doc(db, 'pools', poolId, 'propCards', cardId);
            await deleteDoc(cardRef);
            console.log('[dbService] Prop card deleted:', cardId);
        } catch (error) {
            console.error("[dbService] Error deleting prop card:", error);
            throw error;
        }
    },

    updatePropCard: async (poolId: string, cardId: string, updates: Partial<PropCard> | any) => {
        try {
            const cardRef = doc(db, 'pools', poolId, 'propCards', cardId);
            await updateDoc(cardRef, updates);
            console.log('[dbService] Prop card updated:', cardId);
        } catch (error) {
            console.error("[dbService] Error updating prop card:", error);
            throw error;
        }
    },

    // Alias for Grid component compatibility - uses Cloud Function to bypass security rules
    joinWaitlist: async (poolId: string, entry: { email: string; name: string; timestamp: number }) => {
        try {
            const fn = httpsCallable(functions, 'joinWaitlist');
            await fn({ poolId, name: entry.name, email: entry.email });
        } catch (error) {
            console.error("Error joining waitlist:", error);
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
            console.error("Error calling toggleWinnerPaid:", error);
            throw error;
        }
    },

    syncAllUsers: async (): Promise<{ success: boolean; count: number }> => {
        try {
            const syncFn = httpsCallable(functions, 'syncAllUsers');
            const result = await syncFn();
            return result.data as { success: boolean; count: number };
        } catch (error) {
            console.error("Error calling syncAllUsers function:", error);
            throw error;
        }
    },

    recalculateGlobalStats: async (): Promise<any> => {
        try {
            const recalcFn = httpsCallable(functions, 'recalculateGlobalStats');
            const result = await recalcFn();
            return result.data;
        } catch (error) {
            console.error("Error calling recalculateGlobalStats:", error);
            throw error;
        }
    },

    lockPool: async (poolId: string, forceAxis: boolean = false): Promise<void> => {
        try {
            const lockPoolFn = httpsCallable(functions, 'lockPool');
            await lockPoolFn({ poolId, forceAxis });
        } catch (error) {
            console.error("Error calling lockPool function:", error);
            throw error;
        }
    },

    reserveSquare: async (poolId: string, squareId: number, customerDetails?: PlayerDetails, guestDeviceKey?: string, pickedAsName?: string): Promise<void> => {
        try {
            const reserveSquareFn = httpsCallable(functions, 'reserveSquare');
            await reserveSquareFn({ poolId, squareId, customerDetails, guestDeviceKey, pickedAsName });
        } catch (error) {
            console.error("Error calling reserveSquare function:", error);
            throw error;
        }
    },

    confirmPayment: async (poolId: string, squareIds: number[]): Promise<{ success: boolean; squaresConfirmed: number }> => {
        try {
            const confirmPaymentFn = httpsCallable<{ poolId: string; squareIds: number[] }, { success: boolean; squaresConfirmed: number }>(functions, 'confirmPayment');
            const result = await confirmPaymentFn({ poolId, squareIds });
            return result.data;
        } catch (error) {
            console.error("Error calling confirmPayment function:", error);
            throw error;
        }
    },

    createClaimCode: async (poolId: string, guestDeviceKey: string): Promise<{ claimCode: string; claimId: string }> => {
        try {
            const fn = httpsCallable(functions, 'createClaimCode');
            const result = await fn({ poolId, guestDeviceKey });
            return result.data as { claimCode: string; claimId: string };
        } catch (error) {
            console.error("Error creating claim code:", error);
            throw error;
        }
    },

    // --- Prop Seeds ---
    getPropSeeds: async (): Promise<PropSeed[]> => {
        try {
            const snapshot = await getDocs(collection(db, 'prop_questions'));
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PropSeed));
        } catch (error) {
            console.error("Error fetching prop seeds:", error);
            return [];
        }
    },

    createPropSeed: async (seed: Omit<PropSeed, 'id'>): Promise<void> => {
        try {
            await addDoc(collection(db, 'prop_questions'), seed);
        } catch (error) {
            console.error("Error creating prop seed:", error);
            throw error;
        }
    },

    claimMySquares: async (poolId: string, guestDeviceKey: string): Promise<{ success: boolean; warnings: string[] }> => {
        try {
            const fn = httpsCallable(functions, 'claimMySquares');
            const result = await fn({ poolId, guestDeviceKey });
            return result.data as { success: boolean; warnings: string[] };
        } catch (error) {
            console.error("Error claiming guest squares:", error);
            throw error;
        }
    },

    claimByCode: async (claimCode: string): Promise<{ success: boolean; poolId: string }> => {
        try {
            const fn = httpsCallable(functions, 'claimByCode');
            const result = await fn({ claimCode });
            return result.data as { success: boolean; poolId: string };
        } catch (error) {
            console.error("Error claiming by code:", error);
            throw error;
        }
    },

    // Real-time listener for ALL public pools OR user's pools
    subscribeToPools: (callback: (pools: GameState[]) => void, onError?: (error: Error) => void, ownerId?: string) => {
        let q;
        if (ownerId) {
            q = query(collection(db, "pools"), or(where("ownerId", "==", ownerId), where("managerUid", "==", ownerId)));
        } else {
            // Default: Fetch only PUBLIC pools (compliance with security rules)
            q = query(collection(db, "pools"), where("isPublic", "==", true));
        }
        return onSnapshot(q, (snapshot) => {
            const pools = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as GameState));
            callback(pools);
        }, (error) => {
            console.error("Pool Subscription Error:", error);
            if (onError) onError(error);
        });
    },

    // Admin: Fetch ALL pools (relies on SuperAdmin permissions)
    subscribeToAllPools: (callback: (pools: GameState[]) => void, onError?: (error: Error) => void) => {
        const q = query(collection(db, "pools"));
        return onSnapshot(q, (snapshot) => {
            const pools = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as GameState));
            callback(pools);
        }, (error) => {
            console.error("Admin Pool Subscription Error:", error);
            if (onError) onError(error);
        });
    },

    // Real-time listener for a SINGLE pool (Robust deep-linking)
    subscribeToPool: (poolId: string, callback: (pool: GameState | null) => void, onError?: (error: Error) => void) => {
        return onSnapshot(doc(db, "pools", poolId), (docSnap) => {
            if (docSnap.exists()) {
                callback({ ...docSnap.data(), id: docSnap.id } as GameState);
            } else {
                callback(null);
            }
        }, (error) => {
            console.error("Single Pool Subscription Error:", error);
            if (onError) onError(error);
            else callback(null);
        });
    },

    // Winners Subcollection Listener
    subscribeToWinners: (poolId: string, callback: (winners: Winner[]) => void) => {
        const q = query(collection(db, "pools", poolId, "winners"));
        return onSnapshot(q, (snapshot) => {
            const winners = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as unknown as Winner);

            // Sort winners chronologically for "Event" winners
            // Document IDs for events are in format "event_[home]_[away]" which naturally sorts chronologically
            const sorted = winners.sort((a, b) => {
                // Keep quarterly winners in their natural order (q1, half, q3, final)
                const periodOrder: Record<string, number> = { 'q1': 1, 'half': 2, 'q3': 3, 'final': 4 };

                if (a.period === 'Event' && b.period === 'Event') {
                    // For event winners, sort by document ID which contains scores
                    return (a.id || '').localeCompare(b.id || '');
                } else if (a.period !== 'Event' && b.period !== 'Event') {
                    // For quarterly winners, use period order
                    return (periodOrder[a.period] || 99) - (periodOrder[b.period] || 99);
                } else {
                    // Event winners come after quarterly winners
                    return a.period === 'Event' ? 1 : -1;
                }
            });

            callback(sorted);
        }, (error) => {
            console.error("Error subscribing to winners:", error);
            callback([]);
        });
    },

    // Fetch Winners Once (Promise-based)
    getWinners: async (poolId: string): Promise<Winner[]> => {
        const q = query(collection(db, "pools", poolId, "winners"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as unknown as Winner);
    },

    // Update winner paid status
    // Update winner paid status (via Cloud Function)
    updateWinnerPaidStatus: async (poolId: string, winnerId: string, _isPaid: boolean, _paidByUid?: string) => {
        try {
            const fn = httpsCallable(functions, 'toggleWinnerPaid');
            // Cloud function toggles based on current state, so isPaid arg is technically ignored but good for intent.
            // Actually, my CF is a toggle. UI passes !win.isPaid. So calling toggle is correct.
            await fn({ poolId, winnerId });
        } catch (error) {
            console.error("Error updating winner paid status:", error);
            throw error;
        }
    },

    // --- USERS ---
    saveUser: async (user: User) => {
        try {
            const userRef = doc(db, "users", user.id);
            await setDoc(userRef, {
                ...user,
                lastLogin: Timestamp.now()
            }, { merge: true });
        } catch (error) {
            console.error("Error saving user:", error);
        }
    },

    getAllUsers: async (): Promise<User[]> => {
        try {
            const snapshot = await getDocs(collection(db, "users"));
            return snapshot.docs.map(doc => doc.data() as User);
        } catch (error) {
            console.error("Error fetching users:", error);
            return [];
        }
    },

    updateUser: async (userId: string, updates: Partial<User>) => {
        try {
            const userRef = doc(db, "users", userId);
            await updateDoc(userRef, {
                ...updates,
                updatedAt: Timestamp.now()
            });
        } catch (error) {
            console.error("Error updating user:", error);
            throw error;
        }
    },

    deleteUser: async (userId: string) => {
        try {
            await deleteDoc(doc(db, "users", userId));
        } catch (error) {
            console.error("Error deleting user:", error);
            throw error;
        }
    },

    // --- SYSTEM LOGS ---
    getSystemLogs: async (limitCount = 50): Promise<any[]> => {
        try {
            const q = query(collection(db, "system_logs"), orderBy("timestamp", "desc"), limit(limitCount));
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        } catch (error) {
            console.error("Error fetching system logs:", error);
            return [];
        }
    },

    fixPoolScores: async (poolId?: string): Promise<any> => {
        try {
            const fn = httpsCallable(functions, 'fixPoolScores');
            const result = await fn({ poolId });
            return result.data;
        } catch (error) {
            console.error("Error fixing pool scores:", error);
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
            console.error("Error subscribing to themes:", error);
            callback([]);
        });
    },

    getActiveThemes: async (): Promise<PoolTheme[]> => {
        try {
            const q = query(collection(db, "themes"), where("isActive", "==", true), orderBy("name"));
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PoolTheme));
        } catch (error) {
            console.error("Error fetching active themes:", error);
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
            console.error("Error saving theme:", error);
            throw error;
        }
    },

    deleteTheme: async (themeId: string): Promise<void> => {
        try {
            await deleteDoc(doc(db, "themes", themeId));
        } catch (error) {
            console.error("Error deleting theme:", error);
            throw error;
        }
    },

    setDefaultTheme: async (themeId: string): Promise<void> => {
        try {
            // First, unset any existing default
            const q = query(collection(db, "themes"), where("isDefault", "==", true));
            const snapshot = await getDocs(q);
            for (const docSnap of snapshot.docs) {
                if (docSnap.id !== themeId) {
                    await updateDoc(doc(db, "themes", docSnap.id), { isDefault: false });
                }
            }
            // Set the new default
            await updateDoc(doc(db, "themes", themeId), { isDefault: true });
        } catch (error) {
            console.error("Error setting default theme:", error);
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
            console.error("Error subscribing to prop seeds:", error);
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
            console.error("Error saving prop seed:", error);
            throw error;
        }
    },

    deletePropSeed: async (id: string): Promise<void> => {
        try {
            await deleteDoc(doc(db, "prop_questions", id));
        } catch (error) {
            console.error("Error deleting prop seed:", error);
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
            console.error("Error saving playoff config:", error);
            throw error;
        }
    }
};
