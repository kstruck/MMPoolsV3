// The PICKABLE weekly tie-breaker options, with their labels — one list for
// the wizard and the manager settings (PLAN-WEEKLY-PRIZES §2a). Kept apart
// from `nflTiebreaker.ts` so the scorer's module carries no UI copy.
import { DEFAULT_NEW_POOL_TIEBREAKER, PICKABLE_WEEKLY_TIEBREAKERS, type WeeklyTiebreaker } from './nflTiebreaker';

export { DEFAULT_NEW_POOL_TIEBREAKER };

const LABELS: Record<(typeof PICKABLE_WEEKLY_TIEBREAKERS)[number], string> = {
  MNF_LAST_GAME: 'Monday night — combined score of the LAST Monday game to kick off',
  MNF_FIRST_GAME: 'Monday night — combined score of the FIRST Monday game to kick off',
  NONE: 'None — tied weeks are shared',
};

export const WEEKLY_TIEBREAKER_OPTIONS: ReadonlyArray<{ value: WeeklyTiebreaker; label: string }> =
  PICKABLE_WEEKLY_TIEBREAKERS.map(value => ({ value, label: LABELS[value] }));
