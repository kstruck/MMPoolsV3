/**
 * CLIENT MIRROR of `functions/src/nflScoringEngine.ts`'s `poolUsesSpreads`.
 *
 * Does this pool's SCORING actually consume `game.spread`? Only an ATS pick'em
 * pool does. Straight-up pick'em grades on the raw scores, and NFL_SURVIVOR
 * (pick a winner) / NFL_MARGIN (margin of victory) never read a spread under
 * any setting.
 *
 * ## Why this exists as a copy
 *
 * The server predicate lives in `functions/`, a separate and
 * module-incompatible TS root that the Vite bundle cannot import. Moving it to
 * `shared/` would work, but `shared/` is compiled INTO the functions bundle, so
 * that turns a frontend-only fix into a change that owes a functions deploy —
 * unacceptable the day of the first live NFL event. Duplicated deliberately,
 * exactly like `src/utils/featureFlags.ts`, and pinned against drift by
 * `tests/spread-gate-parity.test.ts`, which imports BOTH and compares them over
 * a matrix. Same pattern as `tests/feature-flags-parity.test.ts`.
 *
 * ## What it is for
 *
 * The three member pick sheets used to refuse to render at all unless every
 * game of the week had `spread.locked === true` — for EVERY pool type and mode.
 * The server stopped doing that in #214 (`8c8e9c5`), which scoped
 * `SPREADS_NOT_LOCKED` to `poolUsesSpreads`, and that commit is an ancestor of
 * the currently deployed functions build. The client was never updated, so it
 * has been the only thing blocking straight-up pick'em, Survivor and Margin on
 * a week with no betting lines — which is every preseason week (the 2026
 * preseason feed carries a line on 1 of 49 games).
 *
 * `settings.pickMode` is OPTIONAL and omitting it means STRAIGHT
 * (`shared/schemas/nfl.ts` types it `z.enum(['STRAIGHT','ATS']).optional()`), so
 * an unset pool correctly returns false here rather than coercing to a blocked
 * state. That direction matters: the NaN-style bug in #319 came from the
 * opposite default.
 */
export function poolUsesSpreads(
  pool: { type?: string; settings?: { pickMode?: string } } | null | undefined,
): boolean {
  return pool?.type === 'NFL_PICKEM' && pool?.settings?.pickMode === 'ATS';
}
