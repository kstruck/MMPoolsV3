// Pick Distribution visibility — a commissioner setting (PLAN-SPLIT-POT-SETTLEMENT
// Part C, Kevin 2026-10-08: "turn that card off or only show it once the pool
// locks for the week").
//
// `settings.pickDistribution`:
//   'ALWAYS'      — today's behaviour and the default (Kevin's 2026-08-11 ruling:
//                   the live pool consensus is visible at all times).
//   'AFTER_LOCK'  — each game's split appears once THAT game's pick has locked in
//                   this pool. On a weekly-lock pool every game locks at the one
//                   deadline, so it reads as "once the week locks".
//   'OFF'         — the card and the Current Picks "Majority" row are hidden.
//
// ⚠️ A DISPLAY SETTING, NOT A SECRET. The pool consensus documents stay readable
// to members (PLAN-COMMISSIONER-BLIND-PICKS T5 was dropped). This hides the card
// and the row; the help text says so.
//
// Pure: both roots import it. The server validates the stored value
// (functions/src/lib/poolUpdate.ts); the client decides what to render.

import { isGameLockedFor, type NFLLockGame, type NFLLockPool } from './nflLockMode';

export const PICK_DISTRIBUTION_VALUES = ['ALWAYS', 'AFTER_LOCK', 'OFF'] as const;
export type PickDistributionVisibility = (typeof PICK_DISTRIBUTION_VALUES)[number];

export function isPickDistributionVisibility(v: unknown): v is PickDistributionVisibility {
  return typeof v === 'string' && (PICK_DISTRIBUTION_VALUES as readonly string[]).includes(v);
}

/** The stored value, or `ALWAYS` when absent or unrecognised — never throws. */
export function effectivePickDistribution(settings: { pickDistribution?: unknown } | null | undefined): PickDistributionVisibility {
  const v = settings?.pickDistribution;
  return isPickDistributionVisibility(v) ? v : 'ALWAYS';
}

/**
 * May this game's split be shown in this pool at `now`? `AFTER_LOCK` uses the
 * SAME per-game lock the pick sheet uses (`isGameLockedFor`), so the split can
 * never appear while that game's pick is still editable.
 */
export function distributionGameVisible<G extends NFLLockGame>(
  pool: (NFLLockPool & { settings?: { pickDistribution?: unknown } }) | null | undefined,
  week: number,
  game: G,
  weekGames: readonly G[],
  now: number,
): boolean {
  const mode = effectivePickDistribution(pool?.settings);
  if (mode === 'ALWAYS') return true;
  if (mode === 'OFF') return false;
  return isGameLockedFor(pool, week, game, weekGames, now);
}
