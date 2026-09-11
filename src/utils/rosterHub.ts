import type { Pool, GameState, BracketPool } from '../types';
import { getPoolLifecycleState, isCanceledPool } from './poolSport';
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
 * Which of the Open / Live / Completed tabs a pool belongs to.
 *
 * Anything the shared lifecycle reader calls settled — canceled, completed,
 * admin-closed, archived, `isFinal`, or stamped `finalizedAt` by the NFL
 * finalizer — is Completed, for every pool type. Only then do the per-type
 * open-vs-live rules apply, unchanged from the component they came from.
 */
export function getPoolTabStatus(pool: Pool): RosterTabStatus {
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
        const bPool = pool as BracketPool;
        return bPool.lockAt > 0 && now() >= bPool.lockAt ? 'live' : 'open';
    }
    return 'open';
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
