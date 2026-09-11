import type { Pool, GameState, BracketPool } from '../types';
import { getPoolLifecycleState, getPoolLockTime, isCanceledPool } from './poolSport';
import { now } from './serverClock';

export { isCanceledPool };

/**
 * Pure helpers for the My Roster Hub page (ParticipantDashboard): which tab a
 * pool sorts into and whether it still counts as one of "my entries".
 *
 * Pulled out of the component on 2026-09-10 because the tab reader there knew
 * three lifecycle signals — `BracketPool.status`, `scores.gameStatus`, and
 * `isLocked` — and nothing else. A commissioner who canceled an NFL Pick'em
 * pool (`cancelPool` writes `status: 'CANCELED'`, nothing more) watched it
 * keep an "Open" badge, sit in the Open tab, count toward My Entries, and float
 * to the top as "picks due" (prod pool `RXCaFRqa1buTau8uYoda`). The
 * Commissioner Hub tab was already right, because it filters through
 * `isActiveManagedPool`; this file gives the other tabs the same reader.
 */

export type RosterTabStatus = 'open' | 'live' | 'completed';

/**
 * A bracket's lock deadline as epoch ms, or null when it has none or it is
 * unparseable. Goes through `getPoolLockTime` because a legacy bracket may
 * store `lockAt` as an ISO string or a Firestore Timestamp, which a numeric
 * compare silently rejects (qodo r3 on #688). Only the two fields the reader
 * needs are passed: `BracketPool.reminders` is a different shape from
 * `LockTimeReadable.reminders`, so the whole pool does not type-check.
 */
export function bracketLockAtMs(pool: Pool): number | null {
    if (pool.type !== 'BRACKET') return null;
    return getPoolLockTime({ type: 'BRACKET', lockAt: (pool as BracketPool).lockAt });
}

/**
 * Which of the Open / Live / Completed tabs a pool belongs to.
 *
 * Anything the shared lifecycle reader calls settled — canceled, completed,
 * admin-closed, archived, `isFinal`, or stamped `finalizedAt` by the NFL
 * finalizer — is Completed, for every pool type. Only then do the per-type
 * open-vs-live rules apply, unchanged from the component they came from.
 */
export function getPoolTabStatus(pool: Pool, nowMs: number = now()): RosterTabStatus {
    const lifecycle = getPoolLifecycleState(pool);
    if (lifecycle === 'final' || lifecycle === 'closed') return 'completed';
    // Kept from the component: a non-bracket pool whose game is over is
    // Completed even when it carries no `type` (legacy Squares docs), which
    // `getPoolLifecycleState` only checks under `type === 'SQUARES'` (codex r1).
    // Checked BEFORE the live/locked mapping below: such a doc is usually still
    // `isLocked`, which the reader reports as `locked`.
    if (pool.type !== 'BRACKET' && (pool as GameState).scores?.gameStatus === 'post') return 'completed';
    // The reader's `live` (status LIVE, or a squares game in progress) and
    // `locked` (status LOCKED any case, or `isLocked`) are both "Live Now" on
    // the roster — the roster has no separate locked tab. Consuming them here
    // instead of re-reading `status`/`isLocked` keeps the case-insensitive rule
    // in one place (qodo #5 on PR #688).
    if (lifecycle === 'live' || lifecycle === 'locked') return 'live';

    if (pool.type === 'BRACKET') {
        // A bracket whose lock time has passed is live even before the lock
        // job flips its status. Server-corrected clock, not the device's, so a
        // skewed phone does not move the pool between tabs (qodo #1 on PR #688).
        // `nowMs` is a parameter so a caller can hold it in React state and
        // re-evaluate once the clock sync resolves — `now()` alone returns the
        // device clock until then and the sync never re-renders anyone
        // (codex r3 on PR #688). The default keeps one-shot callers simple.
        const lockAt = bracketLockAtMs(pool);
        return lockAt !== null && nowMs >= lockAt ? 'live' : 'open';
    }
    return 'open';
}

/**
 * How long the roster should wait before re-reading the clock so a pool whose
 * deadline has just passed re-classifies (a bracket past `lockAt` is Live
 * before the lock job flips its status). One second past the deadline, never
 * negative, and clamped to the largest delay `setTimeout` honours — a value
 * over 2^31-1 ms fires immediately and would spin (codex r4 / qodo r2 on #688).
 */
export const MAX_TIMEOUT_MS = 2_147_483_647;
export function clockRefreshDelayMs(deadlineMs: number, nowMs: number): number {
    return Math.min(Math.max(0, deadlineMs - nowMs) + 1_000, MAX_TIMEOUT_MS);
}

/**
 * Does this pool belong on the My Entries tab for `uid`? Membership is the
 * `participantIds` array, and a canceled pool drops out: there is no entry
 * left to play, and the member has already been emailed that it is gone.
 * Completed pools stay — a finished season is still an entry the member had.
 */
export function isMyEntryPool(pool: Pool, uid: string): boolean {
    if (isCanceledPool(pool)) return false;
    return ((pool as { participantIds?: string[] }).participantIds ?? []).includes(uid);
}
