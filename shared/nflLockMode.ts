// Does this pool lock the whole week, or each game on its own?
//
// ONE definition, because the answer decides whether a member can still edit a
// pick — and until this file existed the rule was written out by hand in six
// places (two client, four server) and two of the server copies had already
// drifted by dropping `confidenceMode`.
//
// ⚠️ THE CLIENT GOT THIS WRONG IN PRODUCTION, WHICH IS WHY THIS FILE EXISTS.
// `NFLPoolDashboard` computed a single week lock from the week's EARLIEST
// kickoff for every NFL pool type and never read `lockMode`, and
// `PickemPickEntry` then treated every game as locked once that flag was set.
// So a PER_GAME Pick'em pool — the wizard default — closed its whole sheet at
// the Thursday night kickoff, while `submitNFLPicks` would still have accepted
// a Sunday pick. Kevin's ruling, 2026-08-18: **the pool manager makes the
// decision on that option and the site must abide by that option selection.**
//
// Lives in `shared/` so the client and `functions/` cannot disagree about it.

import {
  usesWeeklyHardLock,
  normalizeLockBufferMinutes,
  resolveHardWeekLock,
  frozenHardLockFor,
  DEFAULT_LOCK_BUFFER_MINUTES,
} from './weeklyHardLock';

/** WEEKLY: one deadline for the whole week. PER_GAME: each game on its own. */
export type NFLLockMode = 'WEEKLY' | 'PER_GAME';

/** The settings this rule reads. Deliberately narrow. */
export interface NFLLockModeSettings {
  lockMode?: string;
  confidenceMode?: boolean;
  /** Server-written stamp (PLAN-CONFIDENCE-PER-GAME-LOCK). Absent = legacy rule. */
  lockRuleVersion?: number;
}

/**
 * The lock mode a pool actually plays.
 *
 * 1. **Survivor and Margin are always WEEKLY**, derived from the pool TYPE and
 *    never from stored settings, so no settings write (or missing field) can
 *    downgrade one to per-game locking. `shared/weeklyHardLock.ts` carries the
 *    reasoning: those formats make ONE pick a week and the submit path only
 *    checks the newly selected team's kickoff, so per-game locking there would
 *    let a member replace a locked Thursday selection after seeing the result.
 *
 * 2. **On a STAMPED Pick'em pool, `lockMode` decides — confidence or not.**
 *    Until PLAN-CONFIDENCE-PER-GAME-LOCK (Kevin, 2026-09-10) confidence mode
 *    forced WEEKLY here, and a confidence pool's stored `lockMode` was routinely
 *    a lie (the wizard default `PER_GAME` while the pool played weekly). That
 *    plan's backfill stamps `lockMode: 'WEEKLY'` + `lockRuleVersion: 2` onto
 *    every legacy confidence pool, and `createNFLPool` stamps 2 on every new
 *    Pick'em pool, so on a stamped pool the stored value is the truth. A
 *    PER_GAME confidence pool then locks each game's pick AND weight at that
 *    game's own deadline (`submitNFLPicks` enforces the weight half as
 *    `CONFIDENCE_LOCKED`).
 *
 * 3. **Legacy clause — a confidence pool NOT yet stamped still plays WEEKLY**,
 *    byte-for-byte the old behaviour. This is what makes the functions deploy
 *    safe before the backfill has run: no unstamped pool changes mode for any
 *    caller, UI or hand-crafted (codex r1 #3/#4 on the plan). Retire it once a
 *    census shows zero confidence pools with `lockRuleVersion !== 2`.
 *
 * The server IMPORTS this function (`functions/src/nflPools.ts`,
 * `functions/src/lib/pickReveal.ts`, `functions/src/poolExceptions.ts`) rather
 * than restating it; `tests/nfl-lockmode-invariants.test.ts` fails if a
 * hand-written copy ever comes back.
 */
export const LOCK_RULE_VERSION = 2;

/** True when the stamp is missing or stale — the pool plays the pre-plan rule. */
export function isLegacyLockRule(settings: NFLLockModeSettings | undefined | null): boolean {
  return settings?.lockRuleVersion !== LOCK_RULE_VERSION;
}

export function nflLockMode(
  poolType: string | undefined | null,
  settings: NFLLockModeSettings | undefined | null,
): NFLLockMode {
  if (usesWeeklyHardLock(poolType)) return 'WEEKLY';
  if (settings?.confidenceMode && isLegacyLockRule(settings)) return 'WEEKLY';
  return settings?.lockMode === 'WEEKLY' ? 'WEEKLY' : 'PER_GAME';
}

/**
 * Does this pool's lock stop at KICKOFF no matter what (Kevin, 2026-09-10: "any
 * confidence pick for a game that has started can not be changed under any
 * circumstances")? A commissioner extension or a shrunk buffer moves a
 * confidence game's deadline later only up to its kickoff, never past it.
 * Straight Pick'em keeps today's semantics — an extension there CAN reopen a
 * started game; that is the documented exception path ("Extend the deadline
 * first if an exception is warranted"). Pool type is irrelevant: Survivor and
 * Margin never reach an override in the first place.
 */
export function lockStopsAtKickoff(settings: NFLLockModeSettings | undefined | null): boolean {
  // STAMPED pools only (codex r14): an unstamped legacy confidence pool keeps
  // every old semantic — clock-only lock, extensions past kickoff — until the
  // backfill reaches it. That is the rollout guarantee `nflLockMode` makes,
  // and the ceiling and the status lock are part of the same guarantee.
  return settings?.confidenceMode === true && !isLegacyLockRule(settings);
}

/** Convenience for the many call sites that only ask the yes/no question. */
export function usesWeeklyLock(
  poolType: string | undefined | null,
  settings: NFLLockModeSettings | undefined | null,
): boolean {
  return nflLockMode(poolType, settings) === 'WEEKLY';
}

/**
 * A commissioner's `extendWeekDeadline` for this week, in epoch ms, or
 * `undefined` when there is none that applies.
 *
 * Hard-lock pools get `undefined` even when a value is stored: `extendWeekDeadline`
 * refuses those types outright (`HARD_WEEKLY_LOCK`) and `proxyPick` drops the
 * override for them, so honouring one here would open a sheet the server keeps
 * shut. Firestore map keys arrive as strings, so both spellings are read — the
 * same allowance `frozenHardLockFor` makes.
 */
export function weekLockOverrideFor(
  pool: { type?: string; settings?: { weekLockOverrides?: Record<string | number, unknown> } } | undefined | null,
  week: number,
): number | undefined {
  if (usesWeeklyHardLock(pool?.type)) return undefined;
  const raw = pool?.settings?.weekLockOverrides?.[week] ?? pool?.settings?.weekLockOverrides?.[String(week)];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

/**
 * When one game's pick closes, in epoch ms.
 *
 * The same arithmetic `functions/src/lib/effectiveLock.ts` `effectiveGameLockAt`
 * does: kickoff minus the buffer, and an override may only ever move it LATER.
 */
export function gameLockAt(
  gameStartTime: number,
  bufferMinutes: number,
  overrideMs?: number,
  /** Confidence pools: never later than kickoff (`lockStopsAtKickoff`). */
  kickoffCeiling = false,
): number {
  const base = gameStartTime - bufferMinutes * 60_000;
  const at = typeof overrideMs === 'number' ? Math.max(base, overrideMs) : base;
  return kickoffCeiling ? Math.min(at, gameStartTime) : at;
}

/** What the pool-aware helpers need off a game doc. Structural. */
export interface NFLLockGame {
  startTime: number;
  /** `'SCHEDULED' | 'IN_PROGRESS' | 'FINAL' | 'CANCELLED'` on `nfl_games`. */
  status?: string | null;
}

/**
 * Has this game left the SCHEDULED state? In a confidence pool that alone
 * locks it: `startTime` is feed data and can be corrected after real kickoff,
 * and a lock computed from the clock alone would reopen a live game (codex r2
 * #1 on the plan). Straight pools keep the clock-only rule they have today.
 */
export function gameStatusLocks(
  settings: NFLLockModeSettings | undefined | null,
  game: NFLLockGame,
): boolean {
  return lockStopsAtKickoff(settings) && typeof game.status === 'string' && game.status !== 'SCHEDULED';
}

/**
 * Has this game actually STARTED (live or over)? The predicate a WEEKLY
 * confidence week closes on. Deliberately narrower than `gameStatusLocks`: a
 * game CANCELLED before its kickoff is locked by itself (nothing to pick) but
 * is no evidence the week's first kickoff has happened — closing the whole
 * sheet on it would refuse every remaining pick and reveal every sheet early
 * (codex r11 on the diff).
 */
export function gameHasStarted(game: NFLLockGame): boolean {
  return game.status === 'IN_PROGRESS' || game.status === 'FINAL';
}

/**
 * When ONE game's pick closes in THIS pool, in epoch ms — buffer, override and
 * the kickoff ceiling folded in from the pool doc. The one helper every
 * per-game reader uses (pick sheet, Bento CTA, `nflPending`), mirrored on the
 * server by `effectiveGameLockAt`; `tests/nfl-lockmode-invariants.test.ts`
 * holds the two to one table of cases.
 */
export function gameLockAtFor(
  pool: NFLLockPool | undefined | null,
  week: number,
  game: NFLLockGame,
): number {
  return gameLockAt(
    game.startTime,
    lockBufferMinutesFor(pool),
    weekLockOverrideFor(pool, week),
    lockStopsAtKickoff(pool?.settings),
  );
}

/**
 * Is this game closed to edits in THIS pool at `now`? Folds in the mode: on a
 * WEEKLY pool every game closes at the week deadline, on a PER_GAME pool each
 * at its own. Status wins over the clock in a confidence pool (above).
 */
export function isGameLockedFor(
  pool: NFLLockPool | undefined | null,
  week: number,
  game: NFLLockGame,
  weekGames: readonly NFLLockGame[],
  now: number,
): boolean {
  if (nflLockMode(pool?.type, pool?.settings) === 'WEEKLY') {
    // WEEKLY: the week rule alone. A game's own status (a CANCELLED game before
    // the first kickoff) does not lock it individually — the server's weekly
    // validator still asks for every game in the slate, so the sheet must keep
    // it editable until the week closes (codex r15). A STARTED game closes the
    // week via `isWeekLockedFor`.
    return isWeekLockedFor(pool, week, weekGames, now);
  }
  if (gameStatusLocks(pool?.settings, game)) return true;
  return now >= gameLockAtFor(pool, week, game);
}

/**
 * Is the WEEK closed at `now`? Time rule from `weekLockAtFor`, plus — in a
 * confidence pool — any game that has left SCHEDULED closes a WEEKLY week
 * (its first kickoff has, by definition, happened).
 */
export function isWeekLockedFor(
  pool: NFLLockPool | undefined | null,
  week: number,
  weekGames: readonly NFLLockGame[],
  now: number,
): boolean {
  if (weekGames.length === 0) return false;
  if (nflLockMode(pool?.type, pool?.settings) === 'WEEKLY') {
    // A game that has STARTED closes a confidence week; a CANCELLED one does not.
    if (lockStopsAtKickoff(pool?.settings) && weekGames.some(gameHasStarted)) return true;
    const at = weekLockAtFor(pool, week, weekGames.map((g) => g.startTime));
    return at !== null && now >= at;
  }
  // PER_GAME: the week is closed when EVERY game is — the same per-game
  // predicate the sheet uses, so a status-locked last game whose feed time
  // moved later still closes the week (codex r8 on the diff).
  return weekGames.every((g) => gameStatusLocks(pool?.settings, g) || now >= gameLockAtFor(pool, week, g));
}

/** What the lock helpers need off a pool doc. Structural, so tests need no fixture. */
export interface NFLLockPool {
  type?: string;
  settings?: {
    lockMode?: string;
    confidenceMode?: boolean;
    lockRuleVersion?: number;
    lockBufferMinutes?: number;
    weekLockOverrides?: Record<string | number, unknown>;
  };
  hardLockByWeek?: Record<string | number, unknown>;
}

/** The buffer this pool actually enforces, snapped to a preset on hard-lock types. */
export function lockBufferMinutesFor(pool: NFLLockPool | undefined | null): number {
  return usesWeeklyHardLock(pool?.type)
    ? normalizeLockBufferMinutes(pool?.settings?.lockBufferMinutes)
    : (pool?.settings?.lockBufferMinutes ?? DEFAULT_LOCK_BUFFER_MINUTES);
}

/**
 * The instant this WEEK is closed — no pick in it can be edited afterwards.
 *
 * ⚠️ THE REFERENCE KICKOFF DEPENDS ON THE MODE, and taking it from the earliest
 * kickoff unconditionally was the production defect this module exists to fix.
 * A PER_GAME week is not over until its LAST game has started: the Thursday
 * game locking does not close Sunday.
 *
 * Hard-lock pools additionally honour the earliest deadline ever frozen for the
 * week, so a widened buffer cannot reopen one. Everything else honours a
 * commissioner's extension, which may only move the deadline later.
 */
export function weekLockAtFor(
  pool: NFLLockPool | undefined | null,
  week: number,
  gameStartTimes: readonly number[],
): number | null {
  if (gameStartTimes.length === 0) return null;
  const mode = nflLockMode(pool?.type, pool?.settings);
  const reference = mode === 'PER_GAME' ? Math.max(...gameStartTimes) : Math.min(...gameStartTimes);
  const computed = reference - lockBufferMinutesFor(pool) * 60_000;
  if (usesWeeklyHardLock(pool?.type)) {
    return resolveHardWeekLock(frozenHardLockFor(pool, week), computed);
  }
  const override = weekLockOverrideFor(pool, week);
  const at = typeof override === 'number' ? Math.max(computed, override) : computed;
  // Confidence pools: the week can be extended, but never past the kickoff it
  // is measured from (the first on WEEKLY, the last on PER_GAME).
  return lockStopsAtKickoff(pool?.settings) ? Math.min(at, reference) : at;
}

/**
 * The soonest lock still ahead of `now`, for a countdown.
 *
 * On a weekly pool this is the week deadline. On a PER_GAME pool the week
 * deadline is the LAST game's, which is right for "is the week over" and wrong
 * to count down to — it would tell a member they have until Sunday evening to
 * make a Thursday pick. Falls back to the week deadline once nothing is left.
 */
export function nextLockAtFor(
  pool: NFLLockPool | undefined | null,
  week: number,
  gameStartTimes: readonly number[],
  now: number,
): number | null {
  const weekLockAt = weekLockAtFor(pool, week, gameStartTimes);
  if (weekLockAt === null) return null;
  if (nflLockMode(pool?.type, pool?.settings) === 'WEEKLY') return weekLockAt;
  const buffer = lockBufferMinutesFor(pool);
  const override = weekLockOverrideFor(pool, week);
  const ceiling = lockStopsAtKickoff(pool?.settings);
  const upcoming = gameStartTimes
    .map((t) => gameLockAt(t, buffer, override, ceiling))
    .filter((at) => at > now);
  return upcoming.length > 0 ? Math.min(...upcoming) : weekLockAt;
}

/**
 * The picks a submission may carry, with stale locked ones removed.
 *
 * `submitNFLPicks` refuses a locked game whose pick CHANGED, and it refuses the
 * WHOLE submission when it does. So a member who selected a Thursday game,
 * never saved it, and returns on Sunday would have every open Sunday pick
 * rejected because of one selection they can no longer edit.
 *
 * A locked pick that MATCHES what the server already holds is kept — the server
 * compares rather than rejects, so sending it costs nothing and keeping it makes
 * the payload a straightforward picture of the sheet.
 *
 * Returns the ids that were dropped as well, because dropping one silently is
 * indistinguishable to the member from the app losing their pick.
 */
export function dropStaleLockedPicks(
  gameIds: readonly string[],
  picks: Readonly<Record<string, string>>,
  savedPicks: Readonly<Record<string, string>>,
  isLocked: (gameId: string) => boolean,
): { picks: Record<string, string>; droppedGameIds: string[] } {
  const r = dropStaleLockedValues(gameIds, picks, savedPicks, isLocked);
  return { picks: r.values, droppedGameIds: r.droppedGameIds };
}

/**
 * The same rule for a confidence WEIGHT map (PLAN-CONFIDENCE-PER-GAME-LOCK):
 * `submitNFLPicks` refuses a locked game whose weight CHANGED
 * (`CONFIDENCE_LOCKED`), and refuses the whole submission when it does.
 */
export function dropStaleLockedWeights(
  gameIds: readonly string[],
  confidence: Readonly<Record<string, number>>,
  savedConfidence: Readonly<Record<string, number>>,
  isLocked: (gameId: string) => boolean,
): { confidence: Record<string, number>; droppedGameIds: string[] } {
  const r = dropStaleLockedValues(gameIds, confidence, savedConfidence, isLocked);
  return { confidence: r.values, droppedGameIds: r.droppedGameIds };
}

function dropStaleLockedValues<T extends string | number>(
  gameIds: readonly string[],
  values: Readonly<Record<string, T>>,
  saved: Readonly<Record<string, T>>,
  isLocked: (gameId: string) => boolean,
): { values: Record<string, T>; droppedGameIds: string[] } {
  const droppedGameIds = gameIds.filter(
    (id) => isLocked(id) && values[id] !== undefined && values[id] !== saved[id],
  );
  if (droppedGameIds.length === 0) return { values: { ...values }, droppedGameIds };
  const dropped = new Set(droppedGameIds);
  return {
    values: Object.fromEntries(Object.entries(values).filter(([id]) => !dropped.has(id))) as Record<string, T>,
    droppedGameIds,
  };
}

/**
 * The confidence slate and range for ONE entry in a PER_GAME confidence pool
 * (PLAN-CONFIDENCE-PER-GAME-LOCK D2, codex r2 #5). Pure; shared with the
 * server's `validatePerGameConfidence` so the sheet and the callable agree on
 * which values a member may still use.
 *
 * - A CANCELLED game the member never picked leaves the slate: not pickable,
 *   not the member's miss, and nobody could have used its value.
 * - A locked game the member never picked is a MISS: it stays in N and adds
 *   one to k, and the member forfeits the top k values (Kevin: "for a 16 game
 *   week, they would lose 16") — the top k values NOT already frozen on a
 *   locked game they DID pick. A 16 locked in on Wednesday is theirs; a miss
 *   on Sunday then costs the 15 (codex r5 on the diff).
 * - `availableValues`: what an OPEN game may still be given, highest first —
 *   `[17 − N .. 16]` minus the frozen values, minus the top k of what is left.
 *   `minValue` is the floor of the week's range; `maxValue` the highest value
 *   still assignable (the old `16 − k` when nothing is frozen).
 */
export function confidenceSlateFor<G extends NFLLockGame & { id: string }>(
  games: readonly G[],
  storedPicks: Readonly<Record<string, string>>,
  isLocked: (game: G) => boolean,
  storedWeights: Readonly<Record<string, number>> = {},
): {
  slateIds: string[];
  missedIds: string[];
  /** Weights frozen on locked games the member picked — theirs, whatever the range does. */
  frozenValues: number[];
  availableValues: number[];
  minValue: number;
  maxValue: number;
} {
  const slate = games.filter((g) => !(g.status === 'CANCELLED' && storedPicks[g.id] === undefined));
  const missedIds = slate.filter((g) => isLocked(g) && storedPicks[g.id] === undefined).map((g) => g.id);
  const N = slate.length;
  const minValue = 17 - N;
  const frozen = new Set<number>();
  for (const g of slate) {
    if (isLocked(g) && storedPicks[g.id] !== undefined) {
      const w = storedWeights[g.id];
      if (typeof w === 'number') frozen.add(w);
    }
  }
  const unfrozen: number[] = [];
  for (let v = 16; v >= minValue; v--) if (!frozen.has(v)) unfrozen.push(v);
  const availableValues = unfrozen.slice(missedIds.length);
  return {
    slateIds: slate.map((g) => g.id),
    missedIds,
    frozenValues: [...frozen].sort((a, b) => b - a),
    availableValues,
    minValue,
    maxValue: availableValues.length > 0 ? availableValues[0] : minValue - 1,
  };
}
