// Weekly tie-breaker contract (PLAN-WEEKLY-TIEBREAKERS §3–§4, Kevin 2026-08-13;
// PLAN-WEEKLY-PRIZES B1 §2, signed 2026-08-15).
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

/**
 * How a weekly tie is broken. Absent ⇒ `MNF_COMBINED` — see below.
 *
 * `MNF_COMBINED` is LEGACY (PLAN-WEEKLY-PRIZES §0/D1): still honoured for every
 * pool that stored it or never stored anything, no longer offered to a
 * commissioner. `MNF_FIRST_GAME` is new (§2a).
 */
export type WeeklyTiebreaker = 'MNF_COMBINED' | 'MNF_LAST_GAME' | 'MNF_FIRST_GAME' | 'NONE';

/** Every value the resolver, the schema and the update gate ACCEPT. */
export const WEEKLY_TIEBREAKER_VALUES = ['MNF_COMBINED', 'MNF_LAST_GAME', 'MNF_FIRST_GAME', 'NONE'] as const;

/**
 * The values a commissioner may PICK (wizard + manager settings). `MNF_COMBINED`
 * is deliberately absent — unpickable, still honoured. A manager UI must still
 * RENDER a legacy pool's stored `MNF_COMBINED` (read-only) so an unchanged save
 * is not a change.
 */
export const PICKABLE_WEEKLY_TIEBREAKERS = ['MNF_LAST_GAME', 'MNF_FIRST_GAME', 'NONE'] as const;

/** What the wizard writes for a NEW pool (D1: written explicitly at create). */
export const DEFAULT_NEW_POOL_TIEBREAKER: WeeklyTiebreaker = 'MNF_LAST_GAME';

/**
 * The default for an ABSENT value is `MNF_COMBINED` and that is load-bearing,
 * not a taste.
 *
 * It is exactly what every pool created before this setting existed has been
 * playing — `computeMNFTiebreakerTotal` summed every Monday game, and the pick
 * sheet said so in as many words. Resolving absence to it here, at every read
 * site, is the whole no-migration story (#399's pattern): no backfill, no
 * script, nothing to run against production data. New pools do not rely on
 * it: the wizard writes `DEFAULT_NEW_POOL_TIEBREAKER` explicitly.
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
  return v === 'MNF_LAST_GAME' || v === 'MNF_FIRST_GAME' || v === 'NONE' ? v : 'MNF_COMBINED';
}

/** Does this rule ask the member for a prediction at all? */
export function tiebreakerAsksForPrediction(rule: WeeklyTiebreaker): boolean {
  return rule !== 'NONE';
}

/** The minimum a game must carry for the target to be resolved. */
export interface TiebreakTargetGame {
  id: string;
  startTime: number;
  isMonday?: boolean;
}

/**
 * Kickoff order — earliest `startTime` first, ties broken by `id` ascending.
 *
 * Kickoff order, not finish order: the sheet has to ask the question days
 * before anyone knows which game ends last, so finish order is not information
 * the member could have had. The `id` tiebreak exists because two games CAN
 * share a start time and Firestore query order is not a promise — without it
 * the same week could resolve to different games on two passes, and a tiebreak
 * target that moves is worse than one that is arbitrary.
 */
export function byKickoff<T extends TiebreakTargetGame>(games: ReadonlyArray<T>): T[] {
  return [...games].sort(
    (a, b) => (a.startTime - b.startTime) || String(a.id).localeCompare(String(b.id)),
  );
}

/**
 * The game id(s) whose combined score is this week's tiebreak TARGET, under a
 * rule, from a schedule. ONE function for the sheet (what it displays), the
 * submit path (the canonical list it freezes) and the scorer (what it sums when
 * nothing is frozen yet). PLAN-WEEKLY-PRIZES §2a–§2b.
 *
 *  - `MNF_LAST_GAME`  → the LAST Monday game to kick off; no Monday game →
 *    the last game of the whole week (§2b fallback).
 *  - `MNF_FIRST_GAME` → the FIRST Monday game to kick off; no Monday game →
 *    the last game of the whole week too — "first Monday game" of a Monday-less
 *    week is not a thing, and the week's first game would be a different
 *    question than the sheet asked (§2b).
 *  - `MNF_COMBINED`   → EVERY Monday game (legacy); no Monday game → `[]`.
 *    Deliberately NO fallback: this is the historical behaviour those pools
 *    are playing (§0 — nothing may change what an in-flight week means), and
 *    their sheet never asked the question on a Monday-less week.
 *  - `NONE`           → `[]`.
 *
 * Returns `[]` when the schedule is empty. Order of the returned ids is
 * kickoff order; callers compare lists as SETS-in-order (see `sameTargetIds`).
 */
export function resolveTiebreakTargetIds(
  games: ReadonlyArray<TiebreakTargetGame>,
  rule: WeeklyTiebreaker,
): string[] {
  if (rule === 'NONE' || games.length === 0) return [];
  const ordered = byKickoff(games);
  const monday = ordered.filter(g => g.isMonday === true);
  if (rule === 'MNF_COMBINED') return monday.map(g => String(g.id));
  if (monday.length === 0) return [String(ordered[ordered.length - 1].id)];
  return [String(rule === 'MNF_LAST_GAME' ? monday[monday.length - 1].id : monday[0].id)];
}

/** Same ids in the same order — the handshake's equality (§9 A6). */
export function sameTargetIds(a: ReadonlyArray<string> | undefined, b: ReadonlyArray<string> | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

/**
 * The frozen target for a week, if the pool has one. `pool.frozenTiebreakTargets`
 * is a pool-week map `{ [week]: string[] }` written ONCE by the first
 * submission of the week and never rewritten (§2b) — server-only in
 * `firestore.rules`.
 *
 * An EMPTY array is a real frozen state — "this week has no target" (a legacy
 * `MNF_COMBINED` pool on a Monday-less week) — and must stay frozen: if a
 * Monday game were added to the schedule later, members who already submitted
 * had no chance to predict it (qodo #9 on #452). Only junk (not an array of
 * strings) reads as absent.
 */
export function frozenTiebreakTargetFor(
  pool: { frozenTiebreakTargets?: Record<string | number, unknown> } | null | undefined,
  week: number,
): string[] | undefined {
  const v = pool?.frozenTiebreakTargets?.[week] ?? pool?.frozenTiebreakTargets?.[String(week)];
  if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) return undefined;
  return v as string[];
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
      hint: 'Close counts: predict the combined final score of the last Monday game to kick off. If there is only one Monday game, that is the one. On a week with no Monday game, the final game of the week is used instead.',
    };
  }
  if (rule === 'MNF_FIRST_GAME') {
    return {
      label: 'Tiebreaker: Predicted Combined Score of the FIRST Monday Game',
      hint: 'Close counts: predict the combined final score of the first Monday game to kick off. If there is only one Monday game, that is the one. On a week with no Monday game, the final game of the week is used instead.',
    };
  }
  return {
    label: 'Tiebreaker: Predicted Monday Night Football Combined Score',
    hint: 'Close counts: predict the combined final score of the MNF games. If there are 2 MNF games, we count the combined score of both games.',
  };
}

/**
 * The sentence that names THIS week's actual target game(s) — required by §2b(2):
 * a member asked for "the Monday game" on a week with no Monday game will not
 * answer. `null` when there is nothing to name (no target, or a game the
 * caller cannot label).
 */
export function tiebreakTargetSentence(
  targetIds: ReadonlyArray<string>,
  games: ReadonlyArray<{ id: string; isMonday?: boolean; homeTeam?: { abbreviation?: string; name?: string }; awayTeam?: { abbreviation?: string; name?: string } }>,
): string | null {
  const named = targetIds
    .map(id => games.find(g => String(g.id) === id))
    .filter((g): g is NonNullable<typeof g> => Boolean(g))
    .map(g => `${g.awayTeam?.abbreviation ?? g.awayTeam?.name ?? '?'} at ${g.homeTeam?.abbreviation ?? g.homeTeam?.name ?? '?'}`);
  if (named.length === 0) return null;
  const allMonday = targetIds.every(id => games.find(g => String(g.id) === id)?.isMonday === true);
  const list = named.join(' + ');
  return allMonday
    ? `This week's tiebreaker game${named.length > 1 ? 's' : ''}: ${list}.`
    : `No Monday game this week — the tiebreaker is the final game of the week: ${list}.`;
}
