/**
 * WHEN another member's pick may be shown to a pool's commissioner.
 *
 * PLAN-COMMISSIONER-BLIND-PICKS D3: the reveal boundary is the SAME instant the
 * members' own lock uses — `weekLockDecision` / `effectiveGameLockAt` — so there
 * is exactly one definition of "locked" in the system and the commissioner is
 * never blind to something the members can already see.
 *
 * Pure and framework-free on purpose: this is the predicate the `getPoolPicks`
 * callable's authorization rests on, and it is the one thing in that callable
 * that can be unit-tested without an emulator.
 *
 * ⚠️ The unit of reveal is the GAME, not the week (Kevin's Q1 ruling, 2026-08-11).
 * An entry document bundles a member's whole sheet, so a callable authorized at
 * WEEK granularity would hand back the picks for games that have not kicked off
 * the moment the first one locks — the exact leak this plan exists to close,
 * reintroduced through the door built to close it. Callers assemble their
 * response by ALLOWLIST of the ids this module returns.
 */

import {
  effectiveLockSettings,
  effectiveGameLockAt,
  weekLockDecision,
  usesWeeklyHardLock,
  type LockSettings,
} from './effectiveLock';

export interface RevealPool {
  type?: string;
  settings?: LockSettings & { lockMode?: string; confidenceMode?: boolean };
  hardLockByWeek?: Record<string | number, unknown>;
}

export interface RevealGame {
  id: string;
  startTime: number;
}

export interface WeekReveal {
  /** 'WEEK' flips wholesale at one instant; 'PER_GAME' fills in game by game. */
  mode: 'WEEK' | 'PER_GAME';
  /** Game ids whose picks may be shown. The ALLOWLIST — never widen it downstream. */
  revealedGameIds: string[];
  /** Every game in the week is revealed. NOT a licence to skip the allowlist. */
  weekRevealed: boolean;
  /** The instant the whole week reveals (WEEK mode only; undefined for PER_GAME). */
  weekRevealAt?: number;
}

/**
 * Does this pool reveal a week all at once, or game by game?
 *
 * Survivor and Margin carry a HARD weekly lock derived from the pool TYPE (a
 * settings write cannot downgrade it), and a WEEKLY-lockMode pick'em pool has
 * opted into the same shape. Everything else is PER_GAME.
 *
 * ⚠️ `confidenceMode` COUNTS AS WEEKLY, and it is easy to miss because the pool's
 * `lockMode` may still read `'PER_GAME'`. `submitNFLPicksInternal` derives the
 * submission lock as `settings.confidenceMode || settings.lockMode === 'WEEKLY'`
 * (nflPools.ts) — a confidence sheet has to be ranked as a whole, so the whole
 * week freezes at the earliest deadline. Reading it per game would hold a
 * commissioner out of a sheet that has been immutable for hours, and withhold
 * the weekly tiebreaker until the last kickoff. This predicate must mirror that
 * expression exactly; if the submit path's definition moves, move this one with
 * it. (codex r4 on the commissioner-blind-picks PR.)
 */
export function revealMode(pool: RevealPool | undefined): 'WEEK' | 'PER_GAME' {
  if (usesWeeklyHardLock(pool?.type)) return 'WEEK';
  const s = pool?.settings;
  return (s?.confidenceMode || s?.lockMode === 'WEEKLY') ? 'WEEK' : 'PER_GAME';
}

/**
 * What of `week` is revealed to a commissioner at instant `now`.
 *
 * `games` must be the pool's slate for that week — the same set the submit path
 * and the scorer read. An empty slate reveals nothing: with no kickoffs there is
 * no deadline, and guessing one would open picks on games nobody has seen.
 */
export function weekRevealFor(
  pool: RevealPool | undefined,
  week: number,
  games: RevealGame[],
  now: number,
): WeekReveal {
  const mode = revealMode(pool);
  if (!games || games.length === 0) {
    return { mode, revealedGameIds: [], weekRevealed: false };
  }

  if (mode === 'WEEK') {
    // weekLockDecision folds in the earliest-ever freeze, so a commissioner
    // cannot widen the buffer to move their own reveal later either — the
    // reveal and the members' deadline are literally the same number.
    const { lockAt } = weekLockDecision(pool, week, games.map(g => g.startTime));
    const open = now >= lockAt;
    return {
      mode,
      revealedGameIds: open ? games.map(g => g.id) : [],
      weekRevealed: open,
      weekRevealAt: lockAt,
    };
  }

  const settings = effectiveLockSettings(pool?.settings, pool?.type);
  const revealedGameIds = games
    .filter(g => now >= effectiveGameLockAt(g.startTime, week, settings))
    .map(g => g.id);
  return {
    mode,
    revealedGameIds,
    weekRevealed: revealedGameIds.length === games.length,
  };
}

/**
 * The reveal a SUPER_ADMIN gets: everything, always (Kevin's ruling). Kept here
 * rather than as an `if` at the call site so both callers produce the identical
 * shape and the allowlist discipline holds on every path.
 */
export function fullReveal(pool: RevealPool | undefined, games: RevealGame[]): WeekReveal {
  return {
    mode: revealMode(pool),
    revealedGameIds: (games || []).map(g => g.id),
    weekRevealed: true,
  };
}

/**
 * How many of this week's games a member has a saved pick for.
 *
 * NO LONGER COMMISSIONER-ONLY (Kevin, 2026-08-22 —
 * PLAN-MEMBER-SET-COLUMN.md). D1 restricted it on the reasoning that
 * "picked 3 of 16" is a different question from "has picked at all", and only
 * the second is safe to tell the whole pool. That distinction is real and the
 * ruling went the other way on it: the count carries no pick CONTENT, and
 * withholding it left members reading a blank Set column from Tuesday to the
 * last kickoff — the entire window in which it is useful.
 *
 * The function itself is unchanged. Only who receives its result changed, and
 * that decision lives at the call site in `nflPickReveal.ts`, where the
 * reveal boundary is.
 *
 * `picks` is the raw entry map: keyed by gameId for pick'em, by week number for
 * Survivor/Margin (numeric keys arrive as strings out of Firestore, hence the
 * String() lookup).
 */
export function weekPickCount(
  poolType: string | undefined,
  picks: Record<string, unknown> | undefined,
  week: number,
  gameIds: string[],
): number {
  const p = picks || {};
  if (poolType === 'NFL_PICKEM') {
    return gameIds.filter(id => !!p[id]).length;
  }
  // Survivor/Margin: one pick per week, keyed by the week number.
  return p[String(week)] ? 1 : 0;
}

/** The pool-wide completion fraction. An aggregate: no name, no partial progress. */
export interface PickProgress {
  /** Eligible players whose week is COMPLETE. */
  complete: number;
  /** Eligible players in the pool. `0` means "we cannot answer" — see below. */
  total: number;
}

/**
 * "12 of 16 players have their picks in" — `PLAN-MEMBER-PICK-PROGRESS`.
 *
 * Ungated: `getPoolPicks` returns this identically to a participant, a
 * commissioner and a SUPER_ADMIN. It was the aggregate half of the question K1
 * closed; the per-member half is ungated too as of 2026-08-22
 * (PLAN-MEMBER-SET-COLUMN.md), so the two now agree rather than the aggregate
 * being the only participation fact a member could read.
 *
 * This one is still the safer of the two and stays worth having on its own: it
 * names nobody at all, and the grid renders it in the header where a member
 * looks before scanning rows.
 *
 * 🛑 BOTH HALVES OF THE FRACTION COME FROM ONE SET, `playerUids`, AND THAT IS THE
 * WHOLE DESIGN. Fifteen rounds of adversarial review kept finding versions where
 * the numerator and the denominator described different populations — a departed
 * member's complete entry covering for a current member's missing one, a player
 * who joined and never picked missing from both halves, a non-playing host stuck
 * outside the numerator for ever. Every one of them reported that everyone was
 * done when somebody was not. There is deliberately **no clamp**: with one set
 * defining both halves, `complete > total` is unreachable.
 *
 * `shared/memberRecord.ts` `eligiblePlayerUids` builds that set and carries the
 * five predicates that were tried and rejected. Read it before changing this.
 *
 * ⚠️ TWO WAYS THIS ANSWERS `{0, 0}`, AND BOTH MEAN "DO NOT SHOW A NUMBER":
 *
 *   - **No `playerUids`** — the pool's `rosterSummary/current` is missing or
 *     predates schema 2. Falling back to `pool.participantIds` would count uids a
 *     manager could historically have forged; falling back to the entry owners
 *     would hide every player who has not started. A number we cannot stand
 *     behind is not shown, and `recomputeRosterSummary` heals the pool on its
 *     next membership change.
 *   - **An empty slate** — `need` would be 0, every entry would satisfy it, and
 *     the pool would read "16 of 16 in" on a week with no games. Short-circuited
 *     BEFORE `need` is computed, never left to the predicate.
 *
 * A player who owns several entries counts ONCE and is complete only when EVERY
 * entry they own is complete — they owe all of them. A player with no entry at
 * all counts toward `total` and never toward `complete`, which is the entire
 * point of taking the denominator from the roster rather than from the entries.
 */
export function pickProgressFor(args: {
  /** `rosterSummary/current.playerUids`. Absent ⇒ `{0, 0}`. */
  playerUids: readonly string[] | undefined;
  poolType: string | undefined;
  week: number;
  weekGameIds: readonly string[];
  /** Every entry document in the pool — NOT filtered by principal. */
  entries: readonly { ownerUid: string; picks?: Record<string, unknown> }[];
}): PickProgress {
  const { playerUids, poolType, week, weekGameIds, entries } = args;
  if (!playerUids || playerUids.length === 0) return { complete: 0, total: 0 };
  if (weekGameIds.length === 0) return { complete: 0, total: 0 };

  const roster = new Set(playerUids);
  const need = poolType === 'NFL_PICKEM' ? weekGameIds.length : 1;

  // uid → is EVERY entry this player owns complete? Absent = they own none, which
  // is not the same as owning an empty one, and neither is complete.
  const allDone = new Map<string, boolean>();
  for (const e of entries) {
    if (!roster.has(e.ownerUid)) continue;
    const done = weekPickCount(poolType, e.picks, week, weekGameIds as string[]) >= need;
    const prev = allDone.get(e.ownerUid);
    allDone.set(e.ownerUid, prev === undefined ? done : prev && done);
  }

  let complete = 0;
  for (const uid of roster) if (allDone.get(uid) === true) complete++;
  return { complete, total: roster.size };
}
