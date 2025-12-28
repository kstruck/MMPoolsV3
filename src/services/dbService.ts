import {
    collection,
    doc,
    setDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    where,
    or,
    Timestamp,
    orderBy,
    limit
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
export { db };
import type { GameState, User } from "../types";

export const dbService = {
    // --- POOLS ---
    onGlobalStatsUpdate: (callback: (stats: any | null) => void, onError?: (error: any) => void) => {
        return onSnapshot(doc(db, 'stats', 'global'), (doc) => {
            callback(doc.exists() ? doc.data() : null);
        }, (err) => {
            console.error("Global Stats Subscription Error:", err);
            if (onError) onError(err);
        });
    },

    createPool: async (pool: GameState): Promise<string> => {
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
        try {
            const poolRef = doc(db, "pools", poolId);
            await updateDoc(poolRef, {
                ...updates,
                updatedAt: Timestamp.now()
            });
        } catch (error) {
            console.error("Error updating pool:", error);
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


    // --- CLOUD FUNCTIONS ---
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

    lockPool: async (poolId: string): Promise<void> => {
        try {
            const lockPoolFn = httpsCallable(functions, 'lockPool');
            await lockPoolFn({ poolId });
        } catch (error) {
            console.error("Error calling lockPool function:", error);
            throw error;
        }
    },

    reserveSquare: async (poolId: string, squareId: number, customerDetails?: any, guestDeviceKey?: string, pickedAsName?: string): Promise<void> => {
        try {
            const reserveSquareFn = httpsCallable(functions, 'reserveSquare');
            await reserveSquareFn({ poolId, squareId, customerDetails, guestDeviceKey, pickedAsName });
        } catch (error) {
            console.error("Error calling reserveSquare function:", error);
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
    subscribeToPools: (callback: (pools: GameState[]) => void, onError?: (error: any) => void, ownerId?: string) => {
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
    subscribeToAllPools: (callback: (pools: GameState[]) => void, onError?: (error: any) => void) => {
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
    subscribeToPool: (poolId: string, callback: (pool: GameState | null) => void, onError?: (error: any) => void) => {
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
    subscribeToWinners: (poolId: string, callback: (winners: any[]) => void) => {
        const q = query(collection(db, "pools", poolId, "winners"));
        return onSnapshot(q, (snapshot) => {
            const winners = snapshot.docs.map(doc => doc.data());
            callback(winners);
        }, (error) => {
            console.error("Error subscribing to winners:", error);
            callback([]);
        });
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
    }
};
