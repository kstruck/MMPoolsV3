// The frozen NFL spread — one line per game, written once, read everywhere.
//
// PLAN-NFL-SPREAD-FREEZE Revision 1. The frozen value does NOT live on
// `nfl_games.spread` any more. That document is owned by a live ESPN feed and
// rewritten wholesale by four writers (the importer, the score sync, the lock
// job, the Spread Manager), and fourteen of the twenty findings in that plan's
// review were one sentence: *a writer clobbered the freeze marker, or a path
// created a line without one.* Defending an immutability invariant on a shared
// document means defending it in every writer, forever, including ones nobody
// has written yet.
//
// So the frozen line moves to its own collection, `nfl_frozen_spreads/{gameId}`,
// which `firestore.rules` refuses EVERY client write to — superadmin included.
// Only two Cloud Functions may write it: the weekly freeze pass and
// `overrideLockedSpread`. `nfl_games.spread` stays exactly what it is today, a
// WORKING line the Spread Manager may edit and the feed may move.
//
// ⚠️ ONE PRECEDENCE RULE, AND IT COVERS THE DISPLAY PATH TOO: `frozen ?? working`.
// The pick sheet renders `game.spread.value` through `GameMeta`. Resolve only the
// grading path and the feed can move the working line after a freeze, so an ATS
// player is SHOWN one number and GRADED on another — which breaks the fairness
// requirement more directly than the bug the plan started from (codex round 1 on
// the revision). Every reader resolves through this file, and the way it is done
// is to resolve onto the game objects at the point they are loaded, so that
// `gradePickemGames`, `computeWeekFingerprint`, `evaluateSlate`, the
// SPREADS_NOT_LOCKED gate and `spreadLabel` all keep reading `game.spread` and
// cannot individually get the precedence wrong.
//
// Lives in `shared/` for the same reason `nflLockMode.ts` does: the client and
// `functions/` must not be able to disagree about it.

/** The collection the frozen line lives in. No client may write it. */
export const FROZEN_SPREADS_COLLECTION = 'nfl_frozen_spreads';

/**
 * Which writer produced this record.
 *
 * ⚠️ NOT OPTIONAL, on any write. The rescore trigger's approval table keys on it
 * (PLAN Revision 1, codex rounds 6-8), so a record written without a `source` is
 * filed as an unapproved change. Three separate times in that review a detector
 * ended up aimed at the mechanism it exists to protect; the generalisation the
 * plan settled on is *every writer declares itself*.
 */
export type FrozenSpreadSource = 'freeze' | 'override' | 'backfill';

/** One frozen line. The document id is the game id. */
export interface FrozenSpread {
  gameId: string;
  /** Home-relative, same convention as `nfl_games.spread.value`. */
  value: number;
  /** Epoch ms of the instant the line was committed to. */
  frozenAt: number;
  // The slate, stored FLAT rather than nested so both the client (`where season
  // ==`) and the freeze pass (the three-equality slate query) can filter on it,
  // and so a DELETE trigger can recover the slate key from `before` — a Firestore
  // delete has no `after` document at all (codex round 6).
  season: string;
  seasonType: number;
  week: number;
  source: FrozenSpreadSource;
  /** Minted by `overrideLockedSpread`; absent on a freeze or a backfill. */
  overrideId?: string;
  /**
   * Set by the cutover backfill only. Marks a record whose `frozenAt` is the
   * BACKFILL instant rather than a measured freeze instant, so the two are never
   * confused when reading provenance later.
   */
  legacy?: boolean;
}

/** The working line as stored on `nfl_games.spread`. */
export interface WorkingSpread {
  value: number;
  locked: boolean;
}

/**
 * Is this record usable as a line?
 *
 * A record whose value is missing or non-finite is treated as ABSENT rather than
 * thrown on: the read path this feeds includes pick submission and scoring, and
 * failing those closed over one corrupt document would be a worse outcome than
 * falling back to the working line. Callers log; nothing silently grades against
 * `NaN`.
 */
export function isUsableFrozenSpread(rec: unknown): rec is FrozenSpread {
  const r = rec as FrozenSpread | null | undefined;
  return !!r && typeof r.value === 'number' && Number.isFinite(r.value);
}

/** `season/seasonType/week` — the same slate key `nflLockWatch.slateId` uses. */
export function frozenSlateId(k: { season: string; seasonType: number; week: number }): string {
  return `${k.season}/${k.seasonType}/${k.week}`;
}

/**
 * The precedence rule, on one game: `frozen ?? working`.
 *
 * A frozen record is by definition locked — the collection only ever holds lines
 * that have been committed to — so the resolved shape reports `locked: true`.
 * That is what keeps `SPREADS_NOT_LOCKED`, `nflLockWatch` coverage and the pick
 * sheet's own block banner agreeing with each other without any of them learning
 * about the new collection.
 */
export function effectiveSpread(
  frozen: FrozenSpread | undefined,
  working: WorkingSpread | undefined,
): WorkingSpread | undefined {
  if (isUsableFrozenSpread(frozen)) return { value: frozen.value, locked: true };
  return working;
}

/**
 * Resolve a batch of games against the frozen store.
 *
 * ⚠️ RETURNS NEW OBJECTS AND NEVER MUTATES THE INPUT. Resolved games are read
 * models: writing one back to `nfl_games` would stamp the frozen value onto the
 * working line and re-create the shared-document problem this design exists to
 * remove. Nothing in the repo does that today, and this is the note for whoever
 * is tempted to.
 */
export function applyFrozenSpreads<G extends { id: string; spread?: unknown }>(
  games: G[],
  byGameId: Readonly<Record<string, FrozenSpread>>,
): G[] {
  return games.map((g) => {
    const frozen = byGameId[g.id];
    if (!isUsableFrozenSpread(frozen)) return g;
    // Cast: the shape written is exactly `WorkingSpread`, but `G['spread']` is
    // declared slightly differently by each consumer (the client type, the
    // functions type, and `WatchedGame`'s nullable variant), and widening the
    // generic to unify them would let a caller pass something with no `spread`
    // at all.
    return { ...g, spread: { value: frozen.value, locked: true } } as unknown as G;
  });
}
