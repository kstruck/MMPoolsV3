import { describe, it, expect } from 'vitest';
import { assessSeasonCompleteness, STALLED_GAME_AFTER_MS, type CompletenessGame } from '../nflFinalize';

// PLAN-NFL-PRESEASON-PILOT A10 — "what does the finalize sweep do with a week
// that never completes?" These pin the answer so it stays the answer.
//
// Verified behavior: mapEspnGameStatus maps POSTPONED → SCHEDULED
// (nflSchedule.ts:25), SCHEDULED is neither FINAL nor CANCELLED, so the season
// never reads complete and the pool is never finalized. Waiting is INTENDED —
// finalizing partially would settle season history while a real game is still
// pending. The defect was that it waited silently and forever; stalledGameIds
// makes "blocked by a postponed game" distinguishable from "blocked by tonight's
// game", which is what the sweep now reports.

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

const g = (id: string, over: Partial<CompletenessGame> = {}): CompletenessGame => ({
  id, week: 1, status: 'FINAL', startTime: NOW - 48 * HOUR, ...over,
});

const allScored = { '1': true, '2': true };

describe('assessSeasonCompleteness — the happy path', () => {
  it('is complete when every game concluded and every week was scored', () => {
    const r = assessSeasonCompleteness([g('a'), g('b', { week: 2 })], allScored, NOW);
    expect(r.complete).toBe(true);
  });

  it('counts a CANCELLED game as concluded — it can never become FINAL', () => {
    const r = assessSeasonCompleteness([g('a'), g('dead', { status: 'CANCELLED' })], allScored, NOW);
    expect(r.complete).toBe(true);
  });

  it('is never complete with no games at all', () => {
    expect(assessSeasonCompleteness([], allScored, NOW)).toMatchObject({ complete: false, reason: 'no games for season' });
  });
});

describe('assessSeasonCompleteness — incomplete seasons', () => {
  it('blocks on a game that has not concluded', () => {
    const r = assessSeasonCompleteness([g('a'), g('live', { status: 'IN_PROGRESS', startTime: NOW - HOUR })], allScored, NOW);
    expect(r.complete).toBe(false);
    expect(r.unfinishedGameIds).toEqual(['live']);
    expect(r.reason).toContain('1 games not concluded');
  });

  it('blocks on an unscored week even when every game concluded', () => {
    const r = assessSeasonCompleteness([g('a'), g('b', { week: 2 })], { '1': true }, NOW);
    expect(r.complete).toBe(false);
    expect(r.unscoredWeeks).toEqual([2]);
    expect(r.reason).toBe('weeks not scored: 2');
  });

  it('reports unfinished games before unscored weeks — the more urgent blocker', () => {
    const r = assessSeasonCompleteness([g('live', { status: 'SCHEDULED', startTime: NOW + HOUR })], {}, NOW);
    expect(r.reason).toContain('not concluded');
  });
});

describe('assessSeasonCompleteness — A10: the postponed game', () => {
  const postponed = (over: Partial<CompletenessGame> = {}) =>
    // ESPN reports STATUS_POSTPONED, which nflSchedule maps to SCHEDULED, and
    // the game keeps its original kickoff time until ESPN reschedules it.
    g('ppd', { status: 'SCHEDULED', startTime: NOW - 5 * 24 * HOUR, ...over });

  it('never finalizes a season containing a postponed game — it waits, by design', () => {
    const r = assessSeasonCompleteness([g('a'), postponed()], allScored, NOW);
    expect(r.complete).toBe(false);
    expect(r.unfinishedGameIds).toEqual(['ppd']);
  });

  it('flags it as STALLED, so it is distinguishable from a game not yet played', () => {
    const r = assessSeasonCompleteness([g('a'), postponed()], allScored, NOW);
    expect(r.stalledGameIds).toEqual(['ppd']);
    expect(r.reason).toContain('STALLED');
    expect(r.reason).toContain('likely postponed');
  });

  it('does NOT flag a game that simply has not kicked off yet', () => {
    const r = assessSeasonCompleteness([g('a'), g('future', { status: 'SCHEDULED', startTime: NOW + 3 * 24 * HOUR })], allScored, NOW);
    expect(r.stalledGameIds).toEqual([]);
    expect(r.reason).not.toContain('STALLED');
  });

  it('does NOT flag a game still in progress inside the grace window', () => {
    const r = assessSeasonCompleteness([g('live', { status: 'IN_PROGRESS', startTime: NOW - 2 * HOUR })], allScored, NOW);
    expect(r.stalledGameIds).toEqual([]);
  });

  it('flags right after the grace window, not before', () => {
    const just = (delta: number) => assessSeasonCompleteness(
      [g('x', { status: 'SCHEDULED', startTime: NOW - STALLED_GAME_AFTER_MS - delta })], allScored, NOW,
    ).stalledGameIds;
    expect(just(-HOUR)).toEqual([]);   // inside the window
    expect(just(HOUR)).toEqual(['x']); // past it
  });

  it('self-heals: once ESPN reschedules and the game goes FINAL, the season completes', () => {
    const r = assessSeasonCompleteness([g('a'), g('ppd', { status: 'FINAL', startTime: NOW - HOUR })], allScored, NOW);
    expect(r.complete).toBe(true);
    expect(r.stalledGameIds).toEqual([]);
  });

  it('the manual escape hatch works: marking the game CANCELLED unblocks the season', () => {
    const r = assessSeasonCompleteness([g('a'), g('ppd', { status: 'CANCELLED', startTime: NOW - 5 * 24 * HOUR })], allScored, NOW);
    expect(r.complete).toBe(true);
  });

  it('tolerates a game with no startTime rather than treating it as stalled', () => {
    const r = assessSeasonCompleteness([g('x', { status: 'SCHEDULED', startTime: undefined })], allScored, NOW);
    expect(r.complete).toBe(false);
    expect(r.stalledGameIds).toEqual([]);
  });

  it('does NOT call a long-running IN_PROGRESS game postponed — different fix', () => {
    // A game stuck IN_PROGRESS for 12h is a stuck feed, not a postponement.
    // Labeling it "likely postponed" would send an operator to the wrong place.
    const r = assessSeasonCompleteness(
      [g('stuck', { status: 'IN_PROGRESS', startTime: NOW - 3 * 24 * HOUR })], allScored, NOW,
    );
    expect(r.complete).toBe(false);
    expect(r.unfinishedGameIds).toEqual(['stuck']);
    expect(r.stalledGameIds).toEqual([]);
  });
});

describe('assessSeasonCompleteness — malformed docs', () => {
  it('never emits NaN for a game with a missing week', () => {
    // nfl_games docs are read with `as any`, so a malformed doc is reachable.
    // Number(undefined) is NaN, which would render "weeks not scored: NaN" and
    // block finalization forever on a defect nobody can act on.
    const r = assessSeasonCompleteness([g('a', { week: undefined })], {}, NOW);
    expect(r.unscoredWeeks).toEqual([]);
    expect(r.reason ?? '').not.toContain('NaN');
    expect(r.complete).toBe(true); // concluded game, no actionable unscored week
  });

  it('still blocks on a real unscored week alongside a malformed sibling', () => {
    const r = assessSeasonCompleteness([g('a', { week: undefined }), g('b', { week: 2 })], { '1': true }, NOW);
    expect(r.unscoredWeeks).toEqual([2]);
    expect(r.reason).toBe('weeks not scored: 2');
  });
});
