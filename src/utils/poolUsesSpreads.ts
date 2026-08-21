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

/**
 * Is this week's PICK SHEET held shut because its lines are not frozen yet?
 *
 * Mirrors the server precondition (`nflPools.ts`: `games.every(g =>
 * g.spread?.locked === true)` over the whole week query) and — since #489 —
 * reads the line the client already resolved as `frozen ?? working` in
 * `dbService.subscribeToNFLGames`, so it asks about the canonical ATS line and
 * not the working one.
 *
 * EVERY game of the week counts, CANCELLED ones included, because that is what
 * the server counts. Exempting them rendered an editable sheet whose every
 * submission failed with `SPREADS_NOT_LOCKED`.
 *
 * ⚠️ TWO SURFACES ASK THIS, WHICH IS WHY IT IS A FUNCTION. The pick sheet uses
 * it to refuse to render; the dashboard's Lock Status card uses it to stop
 * saying "Picks are Open" beside a sheet that is shut. Measured live on
 * 2026-08-21 — preseason week 3 showed "Spreads Not Yet Finalized" and "PICKS
 * ARE OPEN / Make changes before kickoff" on the same screen.
 */
export function spreadsBlockWeek(
  pool: { type?: string; settings?: { pickMode?: string } } | null | undefined,
  weekGames: readonly { spread?: { locked?: boolean } }[],
): boolean {
  if (!poolUsesSpreads(pool)) return false;
  return !weekGames.every(g => g.spread?.locked);
}
