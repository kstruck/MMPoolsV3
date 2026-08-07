/**
 * ONE label per NFL week, everywhere — client AND server.
 *
 * Preseason (seasonType 1) importer weeks are OFFSET from what fans call them:
 * importer week 1 is HOF Weekend and importer week 2 is what ESPN/fans call
 * "Preseason Week 1". Every client surface has rendered these labels since the
 * fix that created this module, but `scoreNFLWeek`'s RESULT STRINGS did not —
 * they interpolated the raw importer number, so scoring HOF Weekend reported
 * "Week 1 scored successfully." while the button the commissioner had just
 * pressed said "Score & Recap HOF Weekend". On the one night of the year when
 * "Week 1" means two different slates, that is the worst possible place for the
 * two names to disagree.
 *
 * ## Why this moved into `shared/`
 *
 * It lived only in `src/utils/nflWeekLabel.ts`, which the functions bundle
 * cannot import. The alternative was a second copy under `functions/src/lib/`
 * plus a parity test — the arrangement used for `featureFlags` and
 * `poolUsesSpreads`, both of which are duplicated *specifically* to avoid making
 * a frontend-only change owe a functions deploy.
 *
 * That reason does not apply here: this change is already a functions change,
 * so `shared/` costs nothing extra, and a label rendered by both sides is
 * exactly what `shared/` is for. `src/utils/nflWeekLabel.ts` now re-exports from
 * here, so every existing client import keeps working unchanged.
 *
 * ⚠️ `shared/` is compiled INTO the functions bundle. Any change here is
 * deploy-coupled.
 */

/** Long form: "HOF Weekend", "Preseason Week 2", "Week 14". */
export function nflWeekLabel(seasonType: number | undefined, week: number): string {
  if (Number(seasonType) === 1) {
    return week === 1 ? 'HOF Weekend' : `Preseason Week ${week - 1}`;
  }
  return `Week ${week}`;
}

/** Chip form for tight UI: "HOF", "P2", "W14". */
export function nflWeekChip(seasonType: number | undefined, week: number): string {
  if (Number(seasonType) === 1) {
    return week === 1 ? 'HOF' : `P${week - 1}`;
  }
  return `W${week}`;
}
