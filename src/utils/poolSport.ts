// Pool → sport-bucket + lifecycle-state derivation, shared by the Super-Admin
// GameOps filter and grouping so the two never drift (they used to be two
// copies of the same switch, and NFL season pools fell through to "Other").

import { isSimPool } from '@shared/testPool';
import { NFL_SEASON_TYPES } from '@shared/poolTypes';

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
  if (isNFLSeasonPoolType(pool.type)) return 'NFL Football';
  // SQUARES and any legacy type: bucket by league.
  return getLeagueDisplayName(pool.league);
}

/**
 * String-safe form of `isNflSeasonType` from @shared/poolTypes, which narrows to
 * the PoolType union and so can't take a `string | undefined` straight off a
 * Firestore doc.
 */
export function isNFLSeasonPoolType(type: string | undefined): boolean {
  return (NFL_SEASON_TYPES as readonly string[]).includes(type ?? '');
}

/**
 * True for squares pools, including legacy docs written before `type` existed.
 * Every squares-only reader treats a missing type as SQUARES (server-side too:
 * `poolData.type || 'SQUARES'` in functions/src/poolParams.ts), so squares-only
 * UI must use this rather than an equality check that would drop those docs.
 */
export function isSquaresPoolType(type: string | undefined): boolean {
  return !type || type === 'SQUARES';
}

export type PoolLifecycleState = 'open' | 'locked' | 'live' | 'final' | 'closed';

/** What a pool's "how full is it" number actually counts, per type. */
export interface PoolEntrySummary {
  count: number;
  /** null when the type has no pool-wide ceiling (or it is set to unlimited). */
  capacity: number | null;
  /** Noun for `count`, so the UI never labels players as squares or vice versa. */
  unit: 'squares' | 'entries' | 'players';
}

/** Minimal shape needed to count entries/players across all pool types. */
export interface EntryCountable {
  type?: string;
  squares?: { owner?: string | null }[];
  entryCount?: number;
  entries?: Record<string, unknown>;
  participantIds?: string[];
  settings?: { maxEntriesTotal?: number };
}

/**
 * How full a pool is, in the unit that type actually uses. Every pool type
 * tracks participation in a different field, and the admin list used to run the
 * SQUARES branch for anything that wasn't BRACKET/PROPS/NFL_PLAYOFFS — so NFL
 * season pools counted a `squares` array they do not have and every one of them
 * reported "100 Left".
 *
 * NFL season pools have no maintained `entryCount` (only BRACKET and PROPS
 * increment it server-side), and their entries live in a subcollection the admin
 * list does not read. `participantIds` is the pool-doc membership list those
 * paths do maintain, so the honest count is players, not entries.
 */
export function getPoolEntrySummary(pool: EntryCountable): PoolEntrySummary {
  if (pool.type === 'BRACKET') {
    const max = pool.settings?.maxEntriesTotal;
    return {
      count: pool.entryCount ?? 0,
      capacity: typeof max === 'number' && max > 0 ? max : null,
      unit: 'entries',
    };
  }
  if (pool.type === 'PROPS') {
    return { count: pool.entryCount ?? 0, capacity: null, unit: 'entries' };
  }
  if (pool.type === 'NFL_PLAYOFFS') {
    // The `entries` map on the pool doc is authoritative here; `entryCount` is
    // declared on the type but no server path maintains it for playoff pools.
    return { count: Object.keys(pool.entries ?? {}).length, capacity: null, unit: 'entries' };
  }
  if (isNFLSeasonPoolType(pool.type)) {
    return { count: pool.participantIds?.length ?? 0, capacity: null, unit: 'players' };
  }
  // SQUARES and any legacy type: a 10x10 grid.
  return {
    count: (pool.squares ?? []).filter(s => s.owner).length,
    capacity: 100,
    unit: 'squares',
  };
}

const UNIT_SINGULAR: Record<PoolEntrySummary['unit'], string> = {
  squares: 'square',
  entries: 'entry',
  players: 'player',
};

/**
 * Display string for a pool's entry summary, e.g. "42/100 squares", "1 player".
 * A capacity is always a plural count, so only the uncapped form singularizes.
 */
export function formatEntryCount(summary: PoolEntrySummary): string {
  if (summary.capacity !== null) return `${summary.count}/${summary.capacity} ${summary.unit}`;
  const unit = summary.count === 1 ? UNIT_SINGULAR[summary.unit] : summary.unit;
  return `${summary.count} ${unit}`;
}

/**
 * A stored deadline. Firestore hands these back in all three shapes — autoLock
 * writes `lockAt: Timestamp.now()` on bracket auto-lock while the create paths
 * write epoch numbers, and older docs carry ISO strings — which is why
 * functions/src/autoLock.ts carries the same three-way normalizer server-side.
 */
export type StoredTime = number | string | { toMillis?: () => number };

/** Minimal shape needed to read a pool's lock/start time across all types. */
export interface LockTimeReadable {
  type?: string;
  lockAt?: StoredTime;
  lockDate?: StoredTime;
  reminders?: { lock?: { lockAt?: StoredTime } };
  scores?: { startTime?: StoredTime };
}

/**
 * Epoch 0 is the "no deadline set yet" sentinel, not a date: bracket pools are
 * created with `lockAt: 0` (functions/src/bracketPools.ts) and only get a real
 * value on publish. Anything at or below it is unset, never 1970.
 */
function toEpochMs(value: StoredTime | undefined | null): number | null {
  let ms: number;
  if (typeof value === 'number') ms = value;
  else if (typeof value === 'string') ms = Date.parse(value);
  else if (typeof value?.toMillis === 'function') ms = value.toMillis();
  else ms = NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/**
 * Epoch-ms lock/start time for a pool, or null when the type has none. Each
 * type keeps it somewhere else, matching what functions/src/autoLock.ts reads
 * when it actually locks the pool: brackets use a root `lockAt`, props pools
 * use the `reminders.lock` deadline the props wizard writes, and squares show
 * kickoff. (`lockDate` is declared on the props and playoff types but no write
 * path sets it, so it is only ever a fallback.)
 *
 * NFL season pools deliberately return null: they lock per game or per week off
 * the NFL schedule (GAME_LOCKED / WEEK_LOCKED in functions/src/nflPools.ts),
 * never at one pool-wide timestamp.
 */
export function getPoolLockTime(pool: LockTimeReadable): number | null {
  switch (pool.type) {
    case 'BRACKET':
      return toEpochMs(pool.lockAt);
    case 'PROPS':
      return toEpochMs(pool.reminders?.lock?.lockAt) ?? toEpochMs(pool.lockDate);
    case 'NFL_PLAYOFFS':
      return toEpochMs(pool.lockDate);
    case 'NFL_PICKEM':
    case 'NFL_SURVIVOR':
    case 'NFL_MARGIN':
      return null;
    default:
      return toEpochMs(pool.scores?.startTime);
  }
}

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
