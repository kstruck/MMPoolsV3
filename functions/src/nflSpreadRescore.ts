// The third `nfl_rescore_queue` trigger: a manual LOCKED-spread edit
// (PLAN-REALTIME-SCORING §5b, codex r27).
//
// ATS Pick'em grades against `nfl_games.spread.value`, and `computeWeekFingerprint`
// includes it — but `detectStatCorrections` does not compare `spread` at all, so a
// line corrected after the 24h window changes every ATS result for the week and
// nothing would ever make the slate a candidate again. Finalized ATS standings
// would stay wrong permanently.
//
// WHY A TRIGGER, when §5b rejected `onDocumentUpdated` for the status→FINAL
// handoff. That rejection was about STAMPEDE: 16 games finalizing in an afternoon
// would fire 16 times against the same pools, which is why the terminal transition
// is enqueued from the sync path instead. This one has no such volume — the only
// writer is a superadmin editing a line by hand, a handful of times a week. And it
// is the only mechanism that covers EVERY writer: `SuperAdminNFLSpreads` writes
// `nfl_games` client-direct (rules allow `isSuperAdmin()`), so a callable would
// only cover our own UI and miss a console edit.
//
// ⚠️ THIS NOW GUARDS THE LEGACY PATH ONLY (PLAN-NFL-SPREAD-FREEZE Revision 1).
// The canonical ATS line moved to `nfl_frozen_spreads`, and
// `nflFrozenSpreadTrigger` in nflSpreadOverride.ts is the handoff for it — same
// shape, same reasoning, on the collection the value actually lives in. This one
// still earns its place: for a slate with NO frozen record, reads fall back to
// `nfl_games.spread`, so that field is still what such a week is graded on. It is
// not deleted, and it is not the main path any more.
//
// SCOPED TO LOCKED SPREADS, which is what keeps it quiet. `syncScoresWindow`
// rewrites the whole slate every 5 minutes and would trip an unconditional
// spread-value watcher on every ESPN line move; it explicitly PRESERVES a locked
// spread's value, so a locked value only ever changes when a human sets it.
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { enqueueRescore, lockedSpreadChanged, type SpreadShape } from './lib/rescoreQueue';
import * as admin from 'firebase-admin';

// `retry: true` is what makes the handoff durable (codex r1/P1). This trigger is
// the ONLY signal for a post-hot-window line correction: if the queue write fails
// transiently and the handler resolves anyway, the affected ATS standings stay
// wrong permanently with nobody told. Throwing under retry hands it to the
// platform's at-least-once redelivery instead. A duplicate event is harmless —
// the drain groups by slate and acknowledges every id it read.
export const nflSpreadRescoreTrigger = onDocumentUpdated({ document: 'nfl_games/{gameId}', retry: true }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  if (!lockedSpreadChanged(before.spread as SpreadShape, after.spread as SpreadShape)) return;

  const season = String(after.season ?? '');
  const seasonType = Number(after.seasonType);
  const week = Number(after.week);
  if (!season || !Number.isFinite(seasonType) || !Number.isFinite(week)) {
    console.warn(`[nflSpreadRescore] game ${event.params.gameId} has no usable slate key; not enqueued.`);
    return;
  }

  const ok = await enqueueRescore(admin.firestore(), {
    season, seasonType, week, reason: 'spread', enqueuedAt: Date.now(),
  });
  if (!ok) throw new Error(`[nflSpreadRescore] enqueue failed for ${season}/${seasonType}/wk${week}; retrying.`);
  console.log(`[nflSpreadRescore] locked spread changed on ${event.params.gameId}; enqueued ${season}/${seasonType}/wk${week}.`);
});
