// `pool.publishedWeeks.{week}` — the immutable per-week publication marker
// (PLAN-REALTIME-SCORING §3a/§4).
//
// Set-once by the scorer the first time it reveals a lock-closed result for a
// week, never cleared. It is the durable evidence that members have already seen
// that week's outcome, which is what makes a later deadline extension a
// retroactive break of the reveal guarantee rather than a harmless courtesy.
//
// It deliberately does NOT read `standings.current.lastScoredWeek` (codex r5):
// that field is OVERWRITTEN on every pass, so a late Week-1 correction resets it
// to 1 and a `lastScoredWeek >= week` test would then wrongly permit a Week-2
// extension even though Week 2 was already revealed.
//
// Pure: no firebase-admin, so the backfill and the guard can both be unit-tested.

/** Firestore map keys are strings, but callers hold numbers. Accept both. */
export function weekIsPublished(pool: Record<string, unknown> | undefined, week: number): boolean {
  const map = pool?.publishedWeeks as Record<string, unknown> | undefined;
  if (!map || typeof map !== 'object') return false;
  return map[String(week)] === true || (map as Record<number, unknown>)[week] === true;
}

/**
 * Which weeks a legacy pool must be treated as having already published.
 *
 * The cold-start problem (codex r23): a week scored MANUALLY before this rollout
 * has no marker, so the new `extendWeekDeadline` guard would accept an override
 * on a week whose results members have been looking at for days. Any already
 * scored week is conservatively treated as published — the failure direction is
 * "a commissioner is refused an extension they could safely have had", which is
 * recoverable, against "a revealed week is reopened", which is not.
 *
 * Sources, in order of trust:
 *  - `scoredWeeks` — the per-week marker a complete pass writes (out-of-order safe);
 *  - `scoredThroughWeek` — the high-water mark, for pools that predate `scoredWeeks`;
 *  - `standings.current.lastScoredWeek` is NOT used here for the reason above, and
 *    is redundant anyway: any pass that wrote it also wrote one of the two above.
 */
export function legacyPublishedWeeks(pool: Record<string, unknown> | undefined): number[] {
  const weeks = new Set<number>();

  const scoredWeeks = pool?.scoredWeeks as Record<string, unknown> | undefined;
  if (scoredWeeks && typeof scoredWeeks === 'object') {
    for (const [key, value] of Object.entries(scoredWeeks)) {
      const week = Number(key);
      if (value === true && Number.isInteger(week) && week > 0) weeks.add(week);
    }
  }

  const through = Number(pool?.scoredThroughWeek ?? 0);
  if (Number.isInteger(through) && through > 0) {
    for (let w = 1; w <= through; w++) weeks.add(w);
  }

  return [...weeks].sort((a, b) => a - b);
}

/**
 * The marker writes a backfill would perform for one pool: already-published
 * weeks are skipped so the migration is idempotent and a re-run reports zero.
 */
export function missingPublishedWeeks(pool: Record<string, unknown> | undefined): number[] {
  return legacyPublishedWeeks(pool).filter((w) => !weekIsPublished(pool, w));
}

export type ExtensionRefusal = 'WEEK_ALREADY_PUBLISHED' | 'SCORING_IN_PROGRESS';

/**
 * May a commissioner extend this week's deadline right now? Pure, so the two
 * refusals are unit-tested rather than inferred from a callable's transaction.
 *
 * Both are needed and they cover different halves of the race:
 *  - the MARKER stops an extension for a week whose result members have already
 *    seen — a reveal guarantee cannot be broken retroactively;
 *  - the LEASE stops an extension landing in the middle of a scoring pass, which
 *    the marker cannot see yet because that pass has not published.
 *
 * The caller must evaluate this INSIDE the transaction that writes the override
 * (codex r6): read-then-write leaves a window where the scorer publishes between
 * the check and the commit.
 */
export function extensionRefusal(
  pool: Record<string, unknown> | undefined,
  week: number,
  leaseIsLiveNow: boolean,
): ExtensionRefusal | null {
  if (weekIsPublished(pool, week)) return 'WEEK_ALREADY_PUBLISHED';
  if (leaseIsLiveNow) return 'SCORING_IN_PROGRESS';
  return null;
}
