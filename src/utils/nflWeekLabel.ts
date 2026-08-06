/**
 * ONE label per NFL week, everywhere.
 *
 * The implementation moved to `shared/nflWeekLabel.ts` so the Cloud Functions
 * can render the same strings — `scoreNFLWeek`'s result messages said "Week 1"
 * where the UI said "HOF Weekend". This module re-exports it so the ~30 existing
 * `utils/nflWeekLabel` imports keep working unchanged; there is still exactly
 * one definition.
 *
 * Render nothing else. Preseason importer weeks are OFFSET from what fans call
 * them (importer week 1 is HOF Weekend, importer week 2 is "Preseason Week 1"),
 * and a surface that formats the raw number will disagree with every other one.
 */
export { nflWeekLabel, nflWeekChip } from '@shared/nflWeekLabel';
