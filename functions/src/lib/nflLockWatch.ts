/**
 * NFL spread-lock watch — the pre-kickoff tripwire (PLAN-NFL-PRESEASON-PILOT A3a).
 *
 * `submitNFLPicks` refuses every pick for a week unless EVERY game of that
 * week has `spread.locked === true` (nflPools.ts:351-355, thrown as
 * SPREADS_NOT_LOCKED). So one unlocked game silently blocks every member of
 * every pool on that season/seasonType — and today nobody finds out until a
 * commissioner emails. This module decides, from data alone, whether that
 * outage is about to happen.
 *
 * Pure: all Firestore IO lives in nflLockWatch.ts. These functions are the
 * decision, and they are what the unit tests pin.
 */

/** The minimum of an nfl_games doc this module reasons about. */
export interface WatchedGame {
  id: string;
  season: string;
  seasonType: number;
  week: number;
  startTime: number;
  status?: string;
  spread?: { value?: number | null; locked?: boolean } | null;
}

/** The minimum of a pool doc this module reasons about. */
export interface WatchedPool {
  id: string;
  type: string;
  season: string;
  seasonType?: number | string;
  status?: string;
  settings?: { pickMode?: string };
}

/** One (season, seasonType, week) slate — the exact scope of the submit gate. */
export interface SlateKey {
  season: string;
  seasonType: number;
  week: number;
}

export interface SlateCoverage extends SlateKey {
  /** Games in the slate that members can still be blocked by. */
  total: number;
  locked: number;
  /** Ids of games with an unlocked spread, capped by the caller for logging. */
  unlockedGameIds: string[];
  /** Ids of unlocked games that have no spread VALUE at all — the feed never delivered a line. */
  missingLineGameIds: string[];
  /** Earliest kickoff in the slate. */
  firstKickoffMs: number;
  /** Pool ids that would be blocked. */
  affectedPoolIds: string[];
}

export const slateId = (k: SlateKey) => `${k.season}/${k.seasonType}/${k.week}`;

/**
 * A game only gates pick submission while it can still be picked. A CANCELLED
 * game is excluded from the submit gate the same way it is excluded from
 * scoring, and a game already FINAL or IN_PROGRESS is past the point where an
 * alert helps. Mirrors the `games.every(g => g.spread?.locked === true)` scope.
 *
 * ponytail: kept as a predicate rather than a query filter because the submit
 * gate reads the whole week and filters in memory too — the two must agree.
 */
export function gatesSubmission(game: WatchedGame): boolean {
  return game.status !== 'CANCELLED';
}

/**
 * Does this pool sit on the same slate the gate is evaluated against?
 *
 * Must ALSO be a pool the gate can actually block. Since the SPREADS_NOT_LOCKED
 * precondition was scoped to spread-consuming pools (nflPools.ts, poolUsesSpreads),
 * a straight-up pick'em / survivor / margin pool is no longer blocked by an
 * unlocked spread — so paging about one would be a false alarm, and a tripwire
 * that cries wolf is worse than no tripwire.
 */
export function poolMatchesSlate(pool: WatchedPool, key: SlateKey): boolean {
  const onSlate = pool.season === key.season && Number(pool.seasonType ?? 2) === key.seasonType;
  return onSlate && poolIsBlockable(pool);
}

/**
 * Mirrors `poolUsesSpreads` in nflScoringEngine.ts — kept as a local predicate
 * because this module is pure and deliberately free of scoring-engine imports.
 * The two are pinned together by a test.
 */
export function poolIsBlockable(pool: WatchedPool): boolean {
  return pool.type === 'NFL_PICKEM' && pool.settings?.pickMode === 'ATS';
}

/**
 * Fold a week's games + the live pools into a coverage verdict.
 * `games` must be the FULL slate for one (season, seasonType, week).
 */
export function evaluateSlate(
  key: SlateKey,
  games: WatchedGame[],
  pools: WatchedPool[],
): SlateCoverage {
  const gating = games.filter(gatesSubmission);
  const unlocked = gating.filter((g) => g.spread?.locked !== true);
  return {
    ...key,
    total: gating.length,
    locked: gating.length - unlocked.length,
    unlockedGameIds: unlocked.map((g) => g.id),
    missingLineGameIds: unlocked
      .filter((g) => g.spread?.value === undefined || g.spread?.value === null)
      .map((g) => g.id),
    firstKickoffMs: gating.length ? Math.min(...gating.map((g) => g.startTime)) : 0,
    affectedPoolIds: pools.filter((p) => poolMatchesSlate(p, key)).map((p) => p.id),
  };
}

export interface AlertDecision {
  alert: boolean;
  reason: string;
  /** Hours until the slate's first kickoff, negative once it has started. */
  hoursToKickoff: number;
}

/**
 * Should this coverage page someone?
 *
 * Alert only when a real member would really be blocked:
 *  - at least one game still unlocked, AND
 *  - at least one live pool sits on the slate (an unlocked week nobody plays is
 *    not an outage), AND
 *  - kickoff is inside the warning window (far-out weeks legitimately have no
 *    lines yet — the lock job only runs the Tuesday before).
 *
 * Past kickoff still alerts: that is the outage actively happening, and it is
 * the case the whole tripwire exists for.
 */
export function decideAlert(
  coverage: SlateCoverage,
  nowMs: number,
  warnWindowHours: number,
): AlertDecision {
  const hoursToKickoff = (coverage.firstKickoffMs - nowMs) / 3_600_000;
  if (coverage.total === 0) return { alert: false, reason: 'no gating games', hoursToKickoff };
  if (coverage.unlockedGameIds.length === 0) return { alert: false, reason: 'all spreads locked', hoursToKickoff };
  if (coverage.affectedPoolIds.length === 0) return { alert: false, reason: 'no live pool on this slate', hoursToKickoff };
  if (hoursToKickoff > warnWindowHours) {
    return { alert: false, reason: `kickoff ${hoursToKickoff.toFixed(1)}h out, outside ${warnWindowHours}h window`, hoursToKickoff };
  }
  return {
    alert: true,
    reason:
      hoursToKickoff < 0
        ? `OUTAGE IN PROGRESS: kickoff was ${Math.abs(hoursToKickoff).toFixed(1)}h ago and ${coverage.unlockedGameIds.length}/${coverage.total} spreads are still unlocked`
        : `${coverage.unlockedGameIds.length}/${coverage.total} spreads unlocked ${hoursToKickoff.toFixed(1)}h before kickoff`,
    hoursToKickoff,
  };
}

/** Human-readable alert body. Kept here so a test can pin what gets paged. */
export function formatAlertMessage(coverage: SlateCoverage, decision: AlertDecision): string {
  const lines = [
    `Week ${coverage.week} (season ${coverage.season}, seasonType ${coverage.seasonType}): ${decision.reason}.`,
    '',
    `Every member of ${coverage.affectedPoolIds.length} pool(s) is blocked by SPREADS_NOT_LOCKED until every game of this week has spread.locked === true.`,
    `Unlocked: ${coverage.unlockedGameIds.slice(0, 20).join(', ')}`,
  ];
  if (coverage.missingLineGameIds.length > 0) {
    lines.push(
      `Of those, ${coverage.missingLineGameIds.length} have NO spread value at all — the ESPN feed never delivered a line, so re-running the lock job will not fix them; the line has to be set manually.`,
    );
  }
  lines.push('', `Pools: ${coverage.affectedPoolIds.slice(0, 20).join(', ')}`);
  return lines.join('\n');
}
