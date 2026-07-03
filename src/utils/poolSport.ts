// Pool → sport-bucket + lifecycle-state derivation, shared by the Super-Admin
// GameOps filter and grouping so the two never drift (they used to be two
// copies of the same switch, and NFL season pools fell through to "Other").

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

export type PoolLifecycleState = 'open' | 'locked' | 'live' | 'final';

/** Minimal shape needed to read a pool's lifecycle state across all types. */
export interface LifecycleReadable {
  type?: string;
  status?: string;
  isLocked?: boolean;
  isFinal?: boolean;
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
  if (pool.type === 'SQUARES') {
    const gs = pool.scores?.gameStatus;
    if (gs === 'post' || pool.isFinal) return 'final';
    if (gs === 'in') return 'live';
    return pool.isLocked ? 'locked' : 'open';
  }
  // String-status types.
  const status = pool.status;
  if (status === 'COMPLETED' || pool.isFinal) return 'final';
  if (status === 'LIVE') return 'live';
  if (status === 'LOCKED' || pool.isLocked) return 'locked';
  return 'open';
}
