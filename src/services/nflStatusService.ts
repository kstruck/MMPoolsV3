import { collection, getDocs, query, where, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { logger } from '../utils/logger';
import type { NFLGame, Pool } from '../types';
import { getWeekStatus, weekDeadline } from '../utils/nflPending';
import { now as serverNow } from '../utils/serverClock';

/**
 * Lightweight per-pool "does this member owe picks?" lookups for the
 * participant dashboard. Kept separate from dbService: dashboard-only reads.
 */

export interface PoolPendingStatus {
    poolId: string;
    dueWeek: number;
    deadline: number; // epoch ms
}

const NFL_TYPES = new Set(['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN']);

export function isNFLSeasonPool(pool: Pool): boolean {
    return NFL_TYPES.has(pool.type as string);
}

/** One-shot fetch of the caller's entry doc in an NFL pool (null if none). */
export async function getMyNFLEntry(poolId: string, uid: string): Promise<any | null> {
    try {
        const q = query(collection(db, 'pools', poolId, 'entries'), where('ownerUid', '==', uid), limit(1));
        const snap = await getDocs(q);
        return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    } catch (err) {
        logger.error('getMyNFLEntry failed', poolId, err);
        return null;
    }
}

/** Live subscription to a season's schedule (shared across all NFL pool cards). */
export function subscribeToSeasonGames(season: string, callback: (games: NFLGame[]) => void): () => void {
    const q = query(collection(db, 'nfl_games'), where('season', '==', String(season)));
    return onSnapshot(q, snap => {
        callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as NFLGame)));
    }, err => logger.error('subscribeToSeasonGames failed', season, err));
}

/**
 * Nearest upcoming week the member hasn't completed, or null when all caught up
 * (or eliminated, or no schedule yet).
 */
export function computePendingStatus(pool: Pool, entry: any, seasonGames: NFLGame[]): PoolPendingStatus | null {
    const castPool = pool as any;
    if (pool.type === 'NFL_SURVIVOR' && entry?.status === 'ELIMINATED') return null;

    const seasonType = Number(castPool.seasonType);
    const totalWeeks = seasonType === 1 ? 4 : 18;
    const lockBufferMinutes = castPool.settings?.lockBufferMinutes ?? 5;
    const now = serverNow();

    for (let week = 1; week <= totalWeeks; week++) {
        const weekGames = seasonGames.filter(g => g.week === week && Number(g.seasonType) === seasonType);
        if (weekGames.length === 0) continue;
        const status = getWeekStatus(pool.type as string, entry, weekGames, week, lockBufferMinutes);
        const deadline = weekDeadline(weekGames, lockBufferMinutes);
        if (status === 'due' && deadline !== null && deadline > now) {
            return { poolId: pool.id, dueWeek: week, deadline };
        }
    }
    return null;
}
