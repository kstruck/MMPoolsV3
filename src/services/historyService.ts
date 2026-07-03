import { db } from '../firebase';
import { logger } from '../utils/logger';
import { collection, onSnapshot } from 'firebase/firestore';
import type { Unsubscribe } from 'firebase/firestore';

/**
 * A single completed-season record, written by the backend on pool completion.
 * Lives at users/{uid}/seasonHistory/{poolId}.
 */
export interface SeasonHistoryEntry {
    poolId: string;
    poolName: string;
    poolType: string;
    season: number;
    finalRank: number;
    totalEntries: number;
    points?: number;
    entryName?: string;
    isChampion: boolean;
    completedAt: number;
}

export const historyService = {
    /**
     * Subscribes to the user's season history subcollection.
     * Entries are sorted client-side by completedAt desc (newest first) to
     * avoid requiring a composite index. On error, the callback receives []
     * so the UI can fall back to its empty state.
     *
     * Returns the unsubscribe function.
     */
    subscribeToSeasonHistory: (
        uid: string,
        callback: (entries: SeasonHistoryEntry[]) => void
    ): Unsubscribe => {
        const historyRef = collection(db, 'users', uid, 'seasonHistory');
        return onSnapshot(
            historyRef,
            (snapshot) => {
                const entries = snapshot.docs
                    .map((doc) => doc.data() as SeasonHistoryEntry)
                    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
                callback(entries);
            },
            (error) => {
                logger.error('[History] Failed to load season history:', error);
                callback([]);
            }
        );
    },
};

export const subscribeToSeasonHistory = historyService.subscribeToSeasonHistory;
