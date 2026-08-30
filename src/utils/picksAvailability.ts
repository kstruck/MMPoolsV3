// When this week's pick sheet OPENS, in the members' words (Kevin, 2026-08-28).
//
// The pool page already told a member when the week LOCKS. It never told them
// when it opens — so on an against-the-spread pool, between one week's kickoff
// and the next Tuesday morning, the page showed "Waiting on Spreads" with no
// answer to the only question that state raises: waiting until when?
//
// ⚠️ THIS IS ONLY TRUE OF POOLS WHOSE SCORING READS A SPREAD.
// `functions/src/nflPools.ts` scopes its `SPREADS_NOT_LOCKED` precondition to
// `poolUsesSpreads(pool)` — ATS pick'em and nothing else. Straight-up pick'em,
// Survivor and Margin never wait on a line, and telling their members to wait
// for Tuesday would be a fabricated deadline. `poolUsesSpreads` in
// `./poolUsesSpreads` is the same predicate the sheet itself uses.
//
// The platform moves no money and this file states no rule of its own: it reads
// the schedule the freeze job actually runs on and says it in English.

import { spreadsBlockWeek, poolUsesSpreads } from './poolUsesSpreads';

/**
 * The cron `lockNFLSpreadsJob` is deployed on — mirrored from
 * `functions/src/nflSpreadFreeze.ts`, whose own comment reads: *"1.6 — the
 * stated day and time: Tuesday 09:00 ET. If it ever moves it moves deliberately
 * and members are told, because the whole point is that they can predict it."*
 *
 * Duplicated rather than imported for the reason `./poolUsesSpreads` gives:
 * `functions/` is a separate, module-incompatible TS root the Vite bundle
 * cannot reach, and moving it to `shared/` would owe a functions deploy for a
 * frontend-only change. `tests/picks-availability.test.ts` reads the functions
 * source and fails on drift, the same way `tests/spread-gate-parity.test.ts`
 * and `tests/feature-flags-parity.test.ts` do for theirs.
 */
export const SPREAD_FREEZE_CRON = '0 9 * * 2';
export const SPREAD_FREEZE_TIMEZONE = 'America/New_York';

/** The same schedule as a sentence. One definition, three surfaces. */
export const SPREAD_FREEZE_WHEN = 'Tuesdays at 9:00 AM ET';

export type PicksAvailability =
  /** The sheet takes picks now. */
  | { kind: 'OPEN'; notice: string }
  /**
   * An ATS week whose lines are not all frozen. The server refuses every
   * submission with SPREADS_NOT_LOCKED until they are.
   */
  | { kind: 'WAITING_ON_SPREADS'; notice: string }
  /** Past the deadline — the existing lock copy already covers this. */
  | { kind: 'LOCKED'; notice: null };

/**
 * What to tell a member about whether they can pick this week.
 *
 * `weekGames` is the week's slate as the client already resolved it
 * (`frozen ?? working`), which is what `spreadsBlockWeek` expects.
 *
 * AN EMPTY SLATE IS NOT "OPEN". `spreadsBlockWeek` delegates to
 * `weekGames.every(...)`, and `[].every()` is `true` — so a week whose games
 * have not loaded, or that has none, would otherwise report the sheet open. The
 * server would then refuse the submission with `No NFL games found`. Reported
 * as waiting, which is the honest state on both counts.
 */
export function picksAvailability(
  pool: { type?: string; settings?: { pickMode?: string } } | null | undefined,
  weekGames: readonly { spread?: { locked?: boolean } }[],
  opts: { weekLocked: boolean },
): PicksAvailability {
  if (opts.weekLocked) return { kind: 'LOCKED', notice: null };

  if (poolUsesSpreads(pool) && weekGames.length === 0) {
    return {
      kind: 'WAITING_ON_SPREADS',
      notice: `Picks open once this week's spreads are locked — ${SPREAD_FREEZE_WHEN}.`,
    };
  }

  if (spreadsBlockWeek(pool, weekGames)) {
    return {
      kind: 'WAITING_ON_SPREADS',
      notice: `Picks open once this week's spreads are locked — ${SPREAD_FREEZE_WHEN}.`,
    };
  }

  return { kind: 'OPEN', notice: 'Picks are available to make now.' };
}

/**
 * Is the "Make Picks" control something the member can actually use right now?
 *
 * A button that opens a sheet refusing every submission is worse than a
 * disabled one: the member fills it in and loses the work. Kevin asked for it
 * greyed out rather than hidden — a control that is present and explained beats
 * one that has silently vanished.
 */
export function picksBlockedReason(
  pool: { type?: string; settings?: { pickMode?: string } } | null | undefined,
  weekGames: readonly { spread?: { locked?: boolean } }[],
): string | null {
  if (poolUsesSpreads(pool) && weekGames.length === 0) {
    return `This week's spreads are not locked yet — picks open ${SPREAD_FREEZE_WHEN}.`;
  }
  return spreadsBlockWeek(pool, weekGames)
    ? `This week's spreads are not locked yet — picks open ${SPREAD_FREEZE_WHEN}.`
    : null;
}
