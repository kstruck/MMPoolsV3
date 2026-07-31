import { describe, it, expect } from 'vitest';
import {
  hasReportedScores, isVoidWeek, gradePickemGames, gradeSurvivorWeekGame, evaluateSurvivorWeek,
  gradeMarginWeekGame, scoreMarginWeek,
} from '../nflScoringEngine';
import { isTerminalTransition } from '../nflSchedule';
import type { NFLGame, NFLPickemEntry, NFLPickemPool, SurvivorEntry } from '../nflPoolTypes';

/**
 * The feed-integrity guards from PLAN-NFL7-CHAOS-FIXES, at the level where they
 * are actually reachable.
 *
 * WHY THIS FILE EXISTS, precisely. The chaos drill
 * (`emulator/hofChaosDrill.emulator.test.ts`) proves the SCORER never grades a
 * scoreless FINAL — but it proves it through `isTerminalGame`, which filters the
 * broken game out before any engine sees it. Mutation testing showed the
 * consequence: deleting the guard inside `gradePickemGames`, or inside
 * `gradeSurvivorWeekGame`, or the `games.length > 0` term in `isVoidWeek`, left
 * the entire 1181-test unit suite AND the whole drill green.
 *
 * Those guards are not belt-and-braces. `migrations/backfillProfileData.ts`
 * calls all three graders with the RAW week slate (`:109`, `:128`, `:139`) — no
 * `isTerminalGame` filter anywhere in that path — so a scoreless FINAL reaches
 * them directly, and the profile backfill would write a fabricated PUSH /
 * SURVIVED / net-0 into a member's permanent history.
 *
 * So: the drill covers the scorer, and this file covers the engine. Neither
 * subsumes the other.
 */

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr, logoUrl: '' });

const game = (over: Partial<NFLGame> = {}): NFLGame => ({
  id: 'g1', espnGameId: 'g1', week: 1, season: '2026', seasonType: 1,
  homeTeam: T('ARI'), awayTeam: T('CAR'),
  startTime: 1_000_000, status: 'FINAL', scores: { home: 20, away: 24 },
  clock: '0:00', period: 4, isMonday: false, spread: { value: -3, locked: true },
  ...over,
} as NFLGame);

/** The same game with the `scores` key absent — the shape the importer writes. */
const scoreless = (over: Partial<NFLGame> = {}): NFLGame => {
  const g = game({ ...over });
  delete (g as { scores?: unknown }).scores;
  return g;
};

const pickemPool = { type: 'NFL_PICKEM', settings: { pickMode: 'STRAIGHT', confidenceMode: false } } as unknown as NFLPickemPool;
const pickemEntry = { picks: { g1: 'CAR' } } as unknown as NFLPickemEntry;

describe('hasReportedScores — the feed actually delivered both numbers', () => {
  it('accepts a reported score, including a genuine 0-0', () => {
    expect(hasReportedScores({ scores: { home: 20, away: 24 } })).toBe(true);
    // The case the whole predicate exists to keep distinguishable from "missing".
    expect(hasReportedScores({ scores: { home: 0, away: 0 } })).toBe(true);
  });

  it('rejects a missing scores object and either half of a partial one', () => {
    expect(hasReportedScores({})).toBe(false);
    expect(hasReportedScores({ scores: undefined })).toBe(false);
    // Both halves asserted separately: a predicate that checked only one side
    // would pass one of these and is a mutation that survives otherwise.
    expect(hasReportedScores({ scores: { home: 20 } as never })).toBe(false);
    expect(hasReportedScores({ scores: { away: 24 } as never })).toBe(false);
  });
});

describe('isVoidWeek — nothing was playable, as distinct from nothing is known', () => {
  it('is true only when every game of a non-empty slate is cancelled', () => {
    expect(isVoidWeek([{ status: 'CANCELLED' }])).toBe(true);
    expect(isVoidWeek([{ status: 'CANCELLED' }, { status: 'CANCELLED' }])).toBe(true);
    expect(isVoidWeek([{ status: 'CANCELLED' }, { status: 'FINAL' }])).toBe(false);
    expect(isVoidWeek([{ status: 'SCHEDULED' }])).toBe(false);
  });

  it('is FALSE for an empty slate — no data is not the same as nothing played', () => {
    // The `games.length > 0` term. Without it an empty slate excuses every
    // non-submitter in the pool, which is defect NFL7-5 in a different costume:
    // a failed fetch would silently waive the no-show penalty for everyone.
    expect(isVoidWeek([])).toBe(false);
  });
});

describe('gradePickemGames — a scoreless FINAL is not gradable', () => {
  it('grades a properly reported final', () => {
    const grades = gradePickemGames(pickemEntry, [game()], pickemPool);
    expect(grades.g1.result).toBe('W');       // CAR won 24-20
  });

  it('omits a FINAL the feed reported no scores for, rather than calling it a PUSH', () => {
    // 0-0 would read as a straight-up tie, i.e. a PUSH for every entry in the
    // pool — a published result nobody played. Reachable from
    // backfillProfileData.ts:109, which passes the raw slate.
    expect(gradePickemGames(pickemEntry, [scoreless()], pickemPool)).toEqual({});
  });

  it('still grades a CANCELLED game as VOID — it has no scores by definition', () => {
    const grades = gradePickemGames(pickemEntry, [scoreless({ status: 'CANCELLED' })], pickemPool);
    expect(grades.g1.result).toBe('VOID');
  });
});

describe('gradeSurvivorWeekGame — no per-pick record off a scoreless FINAL', () => {
  const entry = { picks: { 1: 'CAR' } } as unknown as SurvivorEntry;

  it('records the outcome of a properly reported final', () => {
    expect(gradeSurvivorWeekGame(entry, 1, [game()], false)).toMatchObject({ result: 'SURVIVED' });
    expect(gradeSurvivorWeekGame(entry, 1, [game()], true)).toMatchObject({ result: 'STRUCK' });
  });

  it('records NOTHING for a scoreless FINAL', () => {
    // Otherwise the backfill writes SURVIVED into permanent history off a
    // payload that reported no scores at all.
    expect(gradeSurvivorWeekGame(entry, 1, [scoreless()], false)).toBeNull();
  });

  it('still records VOID for a cancelled game', () => {
    expect(gradeSurvivorWeekGame(entry, 1, [scoreless({ status: 'CANCELLED' })], false))
      .toMatchObject({ result: 'VOID' });
  });
});

/**
 * `evaluateSurvivorWeek` is reached from `computeSurvivorWeekUpdate`, and in the
 * scorer that path sits behind `weeklyPickReady` (nflPools.ts:1211), which
 * already drops a non-terminal game. So the drill cannot reach these two guards:
 * mutation-tested, deleting either leaves the whole chaos drill green because the
 * entry is skipped one layer earlier. They are pinned HERE, on the exported
 * function, which is the level at which they are reachable — `simOracle.ts` also
 * reimplements this contract and cites it by name.
 */
describe('evaluateSurvivorWeek — the two feed-integrity guards, at the engine level', () => {
  const pool = { settings: { maxStrikes: 0, pickLosersMode: false } } as never;
  const entry = (pick?: string) => ({ picks: pick ? { 1: pick } : {} } as unknown as SurvivorEntry);

  it('strikes the member whose team genuinely lost, and spares the winner', () => {
    // CAR 24, ARI 20.
    expect(evaluateSurvivorWeek(entry('CAR'), 1, [game()], pool)).toEqual({ survived: true, strikeLogged: false });
    expect(evaluateSurvivorWeek(entry('ARI'), 1, [game()], pool)).toEqual({ survived: false, strikeLogged: true });
  });

  it('does NOT strike on a scoreless FINAL — 0-0 would read as a tie, and a tie strikes', () => {
    expect(evaluateSurvivorWeek(entry('CAR'), 1, [scoreless()], pool))
      .toEqual({ survived: true, strikeLogged: false });
  });

  it('does NOT auto-strike a non-submitter when every game of the week was cancelled', () => {
    expect(evaluateSurvivorWeek(entry(), 1, [scoreless({ status: 'CANCELLED' })], pool))
      .toEqual({ survived: true, strikeLogged: false });
  });

  it('DOES auto-strike a non-submitter when a game was actually playable', () => {
    // The other side of the void-week rule: it must excuse a cancelled week
    // without quietly waiving the no-show penalty in general.
    expect(evaluateSurvivorWeek(entry(), 1, [game()], pool))
      .toEqual({ survived: false, strikeLogged: true });
    // ...including a week where only SOME games were cancelled.
    expect(evaluateSurvivorWeek(entry(), 1, [game(), scoreless({ id: 'g2', status: 'CANCELLED' })], pool))
      .toEqual({ survived: false, strikeLogged: true });
  });
});

describe('Margin — "not ready" must stay null and never collapse to 0', () => {
  it('scores a reported final and returns 0 for a cancellation', () => {
    expect(scoreMarginWeek('CAR', [game()])).toBe(4);
    expect(scoreMarginWeek('CAR', [scoreless({ status: 'CANCELLED' })])).toBe(0);
  });

  it('returns null — not 0 — for a scoreless FINAL', () => {
    // 0 is a REAL margin. Returning it would write a fabricated result into
    // weeklyScores and the season total.
    expect(scoreMarginWeek('CAR', [scoreless()])).toBeNull();
  });

  it('records no per-pick game either, rather than a net of 0', () => {
    // gradeMarginWeekGame used `scoreMarginWeek(...) ?? 0`, which converted the
    // null straight back into a recorded 0 one layer up.
    expect(gradeMarginWeekGame('CAR', [scoreless()])).toBeNull();
    expect(gradeMarginWeekGame('CAR', [game()])).toMatchObject({ net: 4 });
    expect(gradeMarginWeekGame('CAR', [scoreless({ status: 'CANCELLED' })])).toMatchObject({ net: 0 });
  });
});

describe('isTerminalTransition — which syncs enqueue a rescore', () => {
  const final = { status: 'FINAL', scores: { home: 20, away: 24 } } as const;

  it('fires when a game first becomes terminal', () => {
    expect(isTerminalTransition({ status: 'SCHEDULED' }, final)).toBe(true);
    expect(isTerminalTransition({ status: 'IN_PROGRESS' }, final)).toBe(true);
    expect(isTerminalTransition({ status: 'SCHEDULED' }, { status: 'CANCELLED' })).toBe(true);
  });

  it('fires for a game with no stored doc that arrives already terminal', () => {
    expect(isTerminalTransition(undefined, final)).toBe(true);
    expect(isTerminalTransition(undefined, { status: 'CANCELLED' })).toBe(true);
  });

  it('fires when the SCORES arrive on a FINAL whose status never moved', () => {
    // The case the NFL7-3 fix creates and the original status-keyed predicate
    // could not see. Mutation-verified: dropping the terminal-ness half of the
    // "nothing moved" test leaves every other assertion in this file green.
    expect(isTerminalTransition({ status: 'FINAL' }, final)).toBe(true);
  });

  it('fires on CANCELLED ⇄ FINAL, where both sides are terminal', () => {
    expect(isTerminalTransition({ status: 'CANCELLED' }, final)).toBe(true);
    expect(isTerminalTransition(final, { status: 'CANCELLED' })).toBe(true);
  });

  it('fires when a terminal game is REINSTATED to a nonterminal state', () => {
    expect(isTerminalTransition({ status: 'CANCELLED' }, { status: 'SCHEDULED' })).toBe(true);
    expect(isTerminalTransition(final, { status: 'IN_PROGRESS' })).toBe(true);
  });

  it('does NOT fire on a nonterminal → nonterminal move, or on no move at all', () => {
    // SCHEDULED → IN_PROGRESS is every live game on every 5-minute run and
    // changes no grade; enqueueing it would drain the queue pointlessly forever.
    expect(isTerminalTransition({ status: 'SCHEDULED' }, { status: 'IN_PROGRESS' })).toBe(false);
    expect(isTerminalTransition({ status: 'IN_PROGRESS' }, { status: 'IN_PROGRESS' })).toBe(false);
    expect(isTerminalTransition(final, final)).toBe(false);
    expect(isTerminalTransition({ status: 'FINAL' }, { status: 'FINAL' })).toBe(false);
  });
});
