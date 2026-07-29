// Pool → sport-bucket + lifecycle-state derivation, shared by the Super-Admin
// GameOps filter and grouping so the two never drift (they used to be two
// copies of the same switch, and NFL season pools fell through to "Other").

import { isSimPool } from '@shared/testPool';

const NFL_SEASON_TYPES = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'];

/** Display bucket for a pool's `league` field (SQUARES + legacy fallback). */
export function getLeagueDisplayName(league: string | undefined): string {
  switch (league) {
    case 'nfl':
      return 'NFL Football';
    case 'college':
    case 'ncaa':
      return 'NCAA Football';
    default:
      return 'Other';
  }
}

/** Minimal shape needed to classify a pool; every real pool type satisfies it. */
export interface SportClassifiable {
  type?: string;
  league?: string;
}

/**
 * Canonical sport bucket for the GameOps sport filter. Must be the single
 * source of truth for both `filteredPools` and the `poolsBySport` grouping,
 * otherwise the dynamically-generated filter buttons don't match the groups.
 */
export function getPoolSport(pool: SportClassifiable): string {
  if (pool.type === 'BRACKET') return 'March Madness';
  if (pool.type === 'NFL_PLAYOFFS') return 'NFL Playoffs';
  if (pool.type === 'PROPS') return 'Props Pool';
  if (NFL_SEASON_TYPES.includes(pool.type ?? '')) return 'NFL Football';
  // SQUARES and any legacy type: bucket by league.
  return getLeagueDisplayName(pool.league);
}

export type PoolLifecycleState = 'open' | 'locked' | 'live' | 'final' | 'closed';

/** Minimal shape needed to render a pool's matchup label across all types. */
export interface MatchupReadable {
  type?: string;
  awayTeam?: string;
  homeTeam?: string;
  name?: string;
}

/**
 * Human matchup/subtitle label for a pool, per type. Prevents the
 * "undefined @undefined" bug that came from assuming every non-BRACKET pool is
 * a squares GameState with awayTeam/homeTeam (NFL season + PROPS pools have
 * neither). Single source of truth for every admin list/card that showed a
 * matchup string.
 */
export function formatPoolMatchup(pool: MatchupReadable): string {
  switch (pool.type) {
    case 'BRACKET':
      return 'Tournament Bracket';
    case 'NFL_PLAYOFFS':
      return 'NFL Playoff Challenge';
    case 'NFL_PICKEM':
      return "Weekly Pick'em";
    case 'NFL_SURVIVOR':
      return 'Survivor Pool';
    case 'NFL_MARGIN':
      return 'Margin Pool';
    case 'PROPS':
      return 'Prop Bet Pool';
    case 'SQUARES':
    default: {
      // Only squares pools carry a real away/home matchup.
      if (pool.awayTeam && pool.homeTeam) return `${pool.awayTeam} @ ${pool.homeTeam}`;
      return 'Squares Pool';
    }
  }
}

/** Minimal shape needed to read a pool's lifecycle state across all types. */
export interface LifecycleReadable {
  type?: string;
  status?: string;
  isLocked?: boolean;
  isFinal?: boolean;
  closedVia?: string;
  scores?: { gameStatus?: string };
}

/**
 * Lifecycle state for the GameOps status filter/chips, per pool type.
 * SQUARES tracks state via `scores.gameStatus`/`isLocked`; the string-status
 * types (BRACKET, NFL_PLAYOFFS, NFL season, PROPS) track it via `status`.
 * NOTE: terminal transitions for the string-status types are written by the
 * `closePool`/`autoClosePools` work (ticket T2); this reader is already
 * status-aware so those pools chip correctly the moment T2 ships.
 */
export function getPoolLifecycleState(pool: LifecycleReadable): PoolLifecycleState {
  // Admin-closed pools get a distinct `closed` state so the UI can show/filter
  // them separately from natural finals. Raw stored status stays COMPLETED —
  // this is a derived label only, not a status migration.
  if (pool.closedVia === 'ADMIN_CLOSE') return 'closed';
  // Terminal for every other type: canceled/completed/otherwise-closed pools are done (T2).
  if (pool.status === 'CANCELED' || pool.status === 'COMPLETED' || pool.closedVia || pool.isFinal) return 'final';

  if (pool.type === 'SQUARES') {
    const gs = pool.scores?.gameStatus;
    if (gs === 'post') return 'final';
    if (gs === 'in') return 'live';
    return pool.isLocked ? 'locked' : 'open';
  }
  // String-status types.
  const status = pool.status;
  if (status === 'LIVE') return 'live';
  if (status === 'LOCKED' || pool.isLocked) return 'locked';
  return 'open';
}

/**
 * Shared inclusion predicate for commissioner rosters / stats / hub.
 * A pool counts only if it is not finished, admin-closed, canceled, or archived,
 * and is not a `sim-*` test pool. Use this everywhere so aggregates never count
 * dead or fake pools (PLAN-COMMISSIONER-DASH.md step 13).
 */
export function isActiveManagedPool(
  pool: LifecycleReadable & { id?: string; slug?: string; simRunId?: string; season?: string },
): boolean {
  const state = getPoolLifecycleState(pool);
  if (state === 'final' || state === 'closed') return false;
  if (pool.status === 'archived') return false;
  // Test Pools: the persisted simRunId field (or sim- season) is the trust anchor —
  // callable-created sim pools have server-generated doc IDs, so the id/slug prefix
  // check alone excludes nothing (PLAN-NFL-SIM-HARNESS Phase 0.4).
  //
  // Delegated to `isSimPool`, the canonical predicate, rather than re-derived —
  // this file and functions/src/lib/poolInclusion.ts each carried their own copy,
  // and both copies predated the array-season hardening (codex r4 on #290).
  // `key` keeps the slug arm, which isSimPool takes as its single id argument.
  const key = pool.id || pool.slug || '';
  return !isSimPool(pool, key);
}
