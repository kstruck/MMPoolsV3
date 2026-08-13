// Weekly tie-breaker contract (PLAN-WEEKLY-TIEBREAKERS §3–§4, Kevin 2026-08-13).
//
// ONE definition of "what number is this week's tiebreaker measured against",
// shared by the pick sheet that ASKS for the prediction, the copy that explains
// it, the rules page that states it, and the scorer that JUDGES it. A drift
// here is silent and expensive: the sheet asks for a two-game total while the
// scorer sums one, and nobody finds out until a week is decided wrongly.
//
// Lives in `shared/` rather than being mirrored the way
// `src/utils/pickemResult.ts` mirrors `gradePickemGames`. That duplication is
// justified because the grading rule changes with frontend iteration; this one
// is a settings enum both sides must agree on EXACTLY, and the cost of the
// share is one functions deploy per change to a value that changes ~never.

/** How a weekly tie is broken. Absent ⇒ `MNF_COMBINED` — see below. */
export type WeeklyTiebreaker = 'MNF_COMBINED' | 'MNF_LAST_GAME' | 'NONE';

export const WEEKLY_TIEBREAKER_VALUES = ['MNF_COMBINED', 'MNF_LAST_GAME', 'NONE'] as const;

/**
 * The default is `MNF_COMBINED` and that is load-bearing, not a taste.
 *
 * It is exactly what every pool created before this setting existed has been
 * playing — `computeMNFTiebreakerTotal` summed every Monday game, and the pick
 * sheet said so in as many words. Resolving absence to it here, at every read
 * site, is the whole no-migration story (#399's pattern): no backfill, no
 * script, nothing to run against production data.
 *
 * Junk resolves to the default too. A settings map is not a type system, and a
 * pool holding `weeklyTiebreaker: "MNF_LASTGAME"` (a typo, a hand-edit, an
 * older client) must play the historical rule rather than crash the scorer or
 * silently become `NONE`.
 */
export function effectiveWeeklyTiebreaker(
  settings: { weeklyTiebreaker?: unknown } | null | undefined,
): WeeklyTiebreaker {
  const v = settings?.weeklyTiebreaker;
  return v === 'MNF_LAST_GAME' || v === 'NONE' ? v : 'MNF_COMBINED';
}

/** Does this rule ask the member for a prediction at all? */
export function tiebreakerAsksForPrediction(rule: WeeklyTiebreaker): boolean {
  return rule !== 'NONE';
}

/**
 * The member-facing sentence, in one place so the sheet, the rules page and any
 * future email cannot disagree about what the pool is playing.
 *
 * `NONE` returns `null` rather than a sentence: there is nothing to explain,
 * and a caller that renders a label must decide to render nothing rather than
 * be handed the empty string and print an orphaned heading.
 */
export function tiebreakerCopy(rule: WeeklyTiebreaker): { label: string; hint: string } | null {
  if (rule === 'NONE') return null;
  if (rule === 'MNF_LAST_GAME') {
    return {
      label: 'Tiebreaker: Predicted Combined Score of the LAST Monday Game',
      hint: 'Close counts: predict the combined final score of the last Monday game to kick off. If there is only one Monday game, that is the one.',
    };
  }
  return {
    label: 'Tiebreaker: Predicted Monday Night Football Combined Score',
    hint: 'Close counts: predict the combined final score of the MNF games. If there are 2 MNF games, we count the combined score of both games.',
  };
}
