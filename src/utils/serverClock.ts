import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { logger } from './logger';

/**
 * Server-corrected clock. Device clocks drift or are outright wrong; every
 * lock/countdown decision shown to the user should come from now(), not Date.now().
 * Server enforcement is unchanged — this only keeps the UI honest.
 *
 * Falls back to device time until the getServerTime callable is reachable,
 * so nothing breaks if functions aren't deployed yet.
 */

let offsetMs = 0;
let synced = false;
let syncPromise: Promise<void> | null = null;

const DRIFT_WARN_THRESHOLD_MS = 60_000;

async function doSync(): Promise<void> {
    try {
        const before = Date.now();
        const result = await httpsCallable<void, { serverTime: number }>(functions, 'getServerTime')();
        const after = Date.now();
        const rtt = after - before;
        // Assume symmetric latency; server timestamp was taken mid-round-trip
        offsetMs = result.data.serverTime + rtt / 2 - after;
        synced = true;
        if (Math.abs(offsetMs) > DRIFT_WARN_THRESHOLD_MS) {
            logger.warn(`Device clock is off by ${Math.round(offsetMs / 1000)}s from server time`);
        }
    } catch (err) {
        // Not deployed / offline — device time is the best we have
        logger.log('serverClock sync unavailable, using device time', err);
    }
}

/** Idempotent — safe to call from any component; syncs once per session. */
export function syncServerClock(): Promise<void> {
    if (!syncPromise) syncPromise = doSync();
    return syncPromise;
}

/** Server-corrected current time in epoch ms. */
export function now(): number {
    void syncServerClock();
    return Date.now() + offsetMs;
}

/** Positive = device clock is behind server. 0 until first successful sync. */
export function getDriftMs(): number {
    return synced ? offsetMs : 0;
}

/** True when drift exceeds a minute — UI should warn that displayed countdowns were corrected. */
export function hasSignificantDrift(): boolean {
    return synced && Math.abs(offsetMs) > DRIFT_WARN_THRESHOLD_MS;
}
