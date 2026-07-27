// `nfl_rescore_queue` — the durable reconciliation tier (PLAN-REALTIME-SCORING §5b).
//
// WHY IT EXISTS. `nflAutoScoreJob`'s live tier only ever looks at slates inside the
// 24h `HOT_WINDOW_LOOKBACK_MS`. Three real events change a week's grades from
// OUTSIDE that window, and none of them would ever reach the scorer:
//   - an ESPN stat correction days later (`detectStatCorrections`, A5);
//   - a suspended/postponed game first going FINAL — or CANCELLED — more than 24h
//     after its scheduled kickoff (a CANCELLED one still carries a void, deferred
//     penalties and the week's completion);
//   - a manual locked-spread edit, which `detectStatCorrections` does not even
//     compare, but which ATS grading reads.
// Plus one that originates inside the scorer: a terminal game deferred solely
// because a `weekLockOverride` has not expired yet. Nothing terminal happens AT
// the expiry, so without a durable reminder the eligibility bit is never
// re-evaluated once the slate falls out of the window.
//
// SHAPE: append-only events, acknowledged individually (§5b, codex r25). The
// naive "read slate → process → clear marker" loses any event enqueued between
// the read and the clear, and outside the hot window nothing else repairs it.
// Each enqueue is a distinct auto-ID doc; the drain deletes exactly the ids it
// read, so an event written mid-drain is simply still there on the next run.
// Deliberately NOT a deterministic per-slate doc id: that would make an enqueue
// during a drain overwrite the doc the drain is about to delete — the same loss
// in a different costume.
//
// Server-only: `firestore.rules` has no `match` for this collection and no
// catch-all allow, so client access is denied by default. Nothing to add there.
import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';

export const RESCORE_QUEUE = 'nfl_rescore_queue';

/**
 * Why a slate was enqueued. The reason is load-bearing, not decoration: until the
 * Survivor reset-and-replay sub-PR ships, a `correction` cannot be safely applied
 * to a Survivor pool (re-scoring week N leaves later `strikeWeeks` in place and
 * skips later weeks once the entry is eliminated), while a `terminal` one — a
 * delayed first final — is a normal first score and is safe for every type.
 */
export type RescoreReason = 'correction' | 'terminal' | 'spread' | 'lockPending' | 'finalizeRetry';

export interface RescoreEvent {
  season: string;
  seasonType: number;
  week: number;
  reason: RescoreReason;
  /** ms epoch. Passed in rather than `serverTimestamp()` so it is readable by the drain and pinnable in tests. */
  enqueuedAt: number;
  /**
   * The instant this event becomes actionable — the closing of a deferred lock
   * for `lockPending`, and 0 (immediately) for everything else.
   *
   * ALWAYS STORED, never omitted, because the drain filters on it in the QUERY
   * (codex r3): with an in-memory filter, a `limit` page full of future
   * reminders starves a correction sitting behind them, and the only
   * reconciliation path for an out-of-window slate silently stalls until those
   * locks expire. A Firestore inequality omits docs missing the field, so a
   * defaulted 0 is what keeps ordinary events visible.
   */
  notBefore?: number;
  /**
   * `finalizeRetry` only, and REQUIRED there: finalization is per pool, not per
   * slate. Every other reason describes a change to the SLATE and applies to
   * whichever pools are playing it, which is why the drain groups those by slate
   * and this one does not.
   */
  poolId?: string;
}

export interface QueuedEvent {
  id: string;
  event: RescoreEvent;
}

export interface SlateGroup {
  season: string;
  seasonType: number;
  week: number;
  reasons: Set<RescoreReason>;
  ids: string[];
}

export function slateKeyOf(e: { season: string; seasonType: number; week: number }): string {
  return `${e.season}_${e.seasonType}_${e.week}`;
}

const REASONS: readonly RescoreReason[] = ['correction', 'terminal', 'spread', 'lockPending', 'finalizeRetry'];

/** A stored doc is only usable if every field the drain needs survived the round trip. */
export function parseRescoreEvent(data: unknown): RescoreEvent | null {
  const d = data as Record<string, unknown> | undefined;
  if (!d) return null;
  const season = typeof d.season === 'string' ? d.season : '';
  const seasonType = Number(d.seasonType);
  const week = Number(d.week);
  const reason = d.reason as RescoreReason;
  if (!season || !Number.isFinite(seasonType) || !Number.isFinite(week) || week <= 0) return null;
  if (!REASONS.includes(reason)) return null;
  const notBefore = Number(d.notBefore);
  const poolId = typeof d.poolId === 'string' && d.poolId ? d.poolId : undefined;
  // A finalizeRetry names a POOL. Without one there is nothing to finalize, and
  // silently treating it as slate work would re-score a whole slate to chase a
  // finalization that failed on one pool.
  if (reason === 'finalizeRetry' && !poolId) return null;
  return {
    season,
    seasonType,
    week,
    reason,
    enqueuedAt: Number.isFinite(Number(d.enqueuedAt)) ? Number(d.enqueuedAt) : 0,
    notBefore: Number.isFinite(notBefore) && notBefore > 0 ? notBefore : 0,
    ...(poolId ? { poolId } : {}),
  };
}

/**
 * The stored shape of one event. Exposed separately from `enqueueRescore` so a
 * caller can put the event in the SAME batch as the write that caused it
 * (codex r2) — the enqueue and the change it describes must land together or not
 * at all. A separate write after a successful commit has a real losing
 * interleaving: the game is persisted as terminal/corrected, the queue write
 * fails, and no later sync ever sees a transition again, so once the slate
 * leaves the hot window its standings are stale permanently.
 */
export function rescoreEventDoc(event: RescoreEvent): Record<string, unknown> {
  return {
    season: event.season,
    seasonType: event.seasonType,
    week: event.week,
    reason: event.reason,
    enqueuedAt: event.enqueuedAt,
    notBefore: event.notBefore ?? 0,
    ...(event.poolId ? { poolId: event.poolId } : {}),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/**
 * Append one event on its own. Returns false rather than throwing, so a caller
 * that must not be failed by a queue write can decide what to do — every current
 * caller either retries (the spread trigger, under `retry: true`) or withholds
 * the state that would make it skip the work next time.
 */
export async function enqueueRescore(db: Firestore, event: RescoreEvent): Promise<boolean> {
  try {
    await db.collection(RESCORE_QUEUE).add(rescoreEventDoc(event));
    return true;
  } catch (e) {
    console.error(`[rescoreQueue] enqueue failed for ${slateKeyOf(event)} (${event.reason}):`, e);
    return false;
  }
}

export interface QueueRead {
  /** Actionable now. */
  events: QueuedEvent[];
  /** Held back by `notBefore`; left in place, not read as work. */
  deferred: number;
  /** Ids of docs that could never be acted on. Cleared by a live drain so they cannot accumulate forever. */
  malformed: string[];
}

/**
 * Read the actionable part of the queue.
 *
 * The `notBefore <= now` filter is in the QUERY, not in memory (codex r3): a page
 * of future `lockPending` reminders would otherwise sit in front of a correction
 * and starve it, and outside the hot window that correction has no other path.
 * A range filter ordered by the same single field needs no composite index, so
 * this cannot die with the silent FAILED_PRECONDITION that took out A5 and the
 * finalize sweep.
 *
 * `deferred` is a count query rather than a fetch — it is heartbeat detail during
 * the dry-run watching period, not work.
 */
export async function readRescoreQueue(db: Firestore, now: number, limit = 500): Promise<QueueRead> {
  const snap = await db.collection(RESCORE_QUEUE)
    .where('notBefore', '<=', now)
    .orderBy('notBefore')
    .limit(limit)
    .get();
  const out: QueueRead = { events: [], deferred: 0, malformed: [] };
  for (const doc of snap.docs) {
    const event = parseRescoreEvent(doc.data());
    // Unusable, and it passed the actionable filter, so it would be re-read every
    // run forever. (A doc with no `notBefore` at all is invisible to the query
    // instead — inert rather than a poison pill, and nothing writes one.)
    if (!event) { out.malformed.push(doc.id); continue; }
    out.events.push({ id: doc.id, event });
  }
  out.deferred = (await db.collection(RESCORE_QUEUE).where('notBefore', '>', now).count().get()).data().count;
  return out;
}

/**
 * Split the queue into its two kinds of work.
 *
 * A `finalizeRetry` is pool-scoped and must NOT re-score anything — the week
 * scored fine, it was `maybeFinalizeNFLPool` that threw. Feeding it through the
 * slate path would re-score every pool on the slate to chase one pool's
 * finalization, and for Survivor the round-3 `scoredWeeks` gate would defer it
 * outright, so the retry would never actually run.
 */
export function partitionQueue(events: QueuedEvent[]): { slateWork: QueuedEvent[]; finalizeRetries: QueuedEvent[] } {
  const slateWork: QueuedEvent[] = [];
  const finalizeRetries: QueuedEvent[] = [];
  for (const e of events) (e.event.reason === 'finalizeRetry' ? finalizeRetries : slateWork).push(e);
  return { slateWork, finalizeRetries };
}

/** Collapse the events into one unit of work per slate, keeping every id for the ack. */
export function groupBySlate(events: QueuedEvent[]): SlateGroup[] {
  const groups = new Map<string, SlateGroup>();
  for (const { id, event } of events) {
    const key = slateKeyOf(event);
    let g = groups.get(key);
    if (!g) {
      g = { season: event.season, seasonType: event.seasonType, week: event.week, reasons: new Set(), ids: [] };
      groups.set(key, g);
    }
    g.reasons.add(event.reason);
    g.ids.push(id);
  }
  return [...groups.values()];
}

/**
 * May a Survivor pool be scored from this group, for this week?
 *
 * TWO conditions, and the second was the hole (codex r3). Re-running a week that
 * has ALREADY been scored is unsafe for Survivor whatever the reason:
 * `computeSurvivorWeekUpdate` keeps the later `strikeWeeks` while rewriting
 * `eliminatedWeek` to the re-run week, after which the
 * `status === 'ELIMINATED' && eliminatedWeek < week` early-return skips every
 * later week and the ledger and standings are wrong. So a `spread` or a delayed
 * `terminal` on some other game in a scored week is just as damaging as a
 * `correction` — repairing any of them needs the reset-and-replay sub-PR.
 *
 * What survives is the case the plan wanted to keep: a delayed FIRST score of a
 * week nobody has completed yet. `scoredWeeks.{week}` is written only by a
 * COMPLETE pass, so a provisionally-scored week still qualifies — it is not
 * finished, and a provisional pass writes no elimination it has to preserve.
 */
export function survivorAllowedForGroup(
  reasons: Set<RescoreReason>,
  pool: { scoredWeeks?: unknown } | undefined,
  week: number,
): boolean {
  let hasNonCorrection = false;
  for (const r of reasons) if (r !== 'correction') { hasNonCorrection = true; break; }
  if (!hasNonCorrection) return false;
  const scored = pool?.scoredWeeks as Record<string, unknown> | undefined;
  return !(scored && typeof scored === 'object' && scored[String(week)] === true);
}

export interface SpreadShape { value?: unknown; locked?: unknown }

/**
 * Does an `nfl_games` update need a rescore because a LOCKED spread moved?
 *
 * ATS Pick'em grades on `spread.value` and the fingerprint includes it, but
 * `detectStatCorrections` never compares `spread` — so a line corrected after the
 * 24h window leaves finalized ATS standings permanently wrong (codex r27).
 *
 * BOTH SIDES must be locked, and the value must have moved. Two exclusions, each
 * of which would otherwise fire on routine traffic:
 *  - an UNLOCKED line moving is every ESPN sync. `syncScoresWindow` rewrites the
 *    whole slate every 5 minutes and preserves locked values, so a locked value
 *    only ever changes when a human sets it.
 *  - `false → true` is `lockNFLSpreadsJob` doing its weekly job on every upcoming
 *    game (codex r1/P2). Treating that as a correction would queue a rescore for
 *    a slate whose games have not kicked off, days early. The case it gives up —
 *    edit while unlocked, then lock — is a line being SET before kickoff, which
 *    the live window already covers; it is not a post-final correction.
 *
 * Lives in lib/ so it is unit-testable without importing the trigger (and with it
 * firebase-functions and the admin module graph).
 */
export function lockedSpreadChanged(before: SpreadShape | undefined, after: SpreadShape | undefined): boolean {
  if (after?.locked !== true || before?.locked !== true) return false;
  return Number(before?.value ?? 0) !== Number(after?.value ?? 0);
}

/** Delete acknowledged events. Chunked: a batch commits at most 500 writes. */
export async function ackRescoreEvents(db: Firestore, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 400) {
    const batch = db.batch();
    for (const id of ids.slice(i, i + 400)) batch.delete(db.collection(RESCORE_QUEUE).doc(id));
    await batch.commit();
  }
}
