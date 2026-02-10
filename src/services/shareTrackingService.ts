import { db } from '../firebase';
import { collection, addDoc, getDocs, query, orderBy, Timestamp } from 'firebase/firestore';

export interface ShareClick {
    platform: string;
    clickedAt: number;
    referrer?: string;
}

export interface ShareStats {
    total: number;
    byPlatform: Record<string, number>;
    last7Days: number;
}

export const shareTrackingService = {
    /**
     * Records a share click for a pool.
     * Called when a visitor lands on a pool page with utm_source in the URL.
     */
    recordClick: async (poolId: string, platform: string): Promise<void> => {
        try {
            const clicksRef = collection(db, 'pools', poolId, 'shareClicks');
            await addDoc(clicksRef, {
                platform,
                clickedAt: Timestamp.now().toMillis(),
                referrer: document.referrer || null,
            });
        } catch (err) {
            // Silently fail — tracking should never block UX
            console.warn('[ShareTracking] Failed to record click:', err);
        }
    },

    /**
     * Fetches share stats for a pool (aggregate clicks by platform).
     * Used by pool manager dashboard.
     */
    getStats: async (poolId: string): Promise<ShareStats> => {
        try {
            const clicksRef = collection(db, 'pools', poolId, 'shareClicks');
            const snap = await getDocs(query(clicksRef, orderBy('clickedAt', 'desc')));

            const byPlatform: Record<string, number> = {};
            let total = 0;
            let last7Days = 0;
            const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

            snap.forEach((doc) => {
                const data = doc.data() as ShareClick;
                total++;
                byPlatform[data.platform] = (byPlatform[data.platform] || 0) + 1;
                if (data.clickedAt >= sevenDaysAgo) {
                    last7Days++;
                }
            });

            return { total, byPlatform, last7Days };
        } catch (err) {
            console.warn('[ShareTracking] Failed to get stats:', err);
            return { total: 0, byPlatform: {}, last7Days: 0 };
        }
    }
};
