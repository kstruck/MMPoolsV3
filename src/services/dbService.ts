import {
    collection,
    doc,
    setDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    Timestamp
} from "firebase/firestore";
import { db } from "../firebase";
import type { GameState, User } from "../types";

export const dbService = {
    // --- POOLS ---
    createPool: async (pool: GameState) => {
        try {
            const poolRef = doc(db, "pools", pool.id);
            // Convert any non-serializable fields if necessary
            const cleanPool = JSON.parse(JSON.stringify(pool));
            await setDoc(poolRef, {
                ...cleanPool,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            });
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

    // Real-time listener for ALL public pools OR user's pools
    subscribeToPools: (callback: (pools: GameState[]) => void) => {
        const q = query(collection(db, "pools"));
        return onSnapshot(q, (snapshot) => {
            const pools = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as GameState));
            callback(pools);
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
    }
};
