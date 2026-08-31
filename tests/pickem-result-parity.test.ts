import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gradePick } from '../src/utils/pickemResult';
import { picksGridCell } from '../src/utils/picksGrid';
import { gradePickemGames } from '../functions/src/nflScoringEngine';

/**
 * The pick sheet must colour a matchup the way the SCORER grades it.
 *
 * `PickemPickEntry` derived its green/red purely from the raw score. That is
 * correct for straight-up and WRONG for ATS: a pick that covered but lost
 * outright rendered RED while the server recorded a WIN, and a winner that
 * failed to cover rendered GREEN while the server recorded a loss. The member's
 * own sheet contradicted their standings.
 *
 * It was unreachable until the wizard gained a Straight/ATS control, because no
 * supported path could create an ATS pool — so enabling the mode is what made
 * the defect live, and it is fixed in the same change.
 *
 * This compares BEHAVIOUR against the REAL `gradePickemGames`, over a matrix, so
 * a drift in meaning fails. The two live in module-incompatible TS roots and
 * cannot import one another; moving the rule to `shared/` would make every
 * frontend tweak owe a functions deploy. Same arrangement, and same reasoning,
 * as `tests/spread-gate-parity.test.ts`.
 */

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });

function game(over: Record<string, unknown> = {}) {
  return {
    id: 'g1', season: '2026', seasonType: 1, week: 1,
    startTime: 0, status: 'FINAL', isMonday: false,
    homeTeam: T('ARI'), awayTeam: T('CAR'),
    scores: { home: 0, away: 0 },
    ...over,
  } as never;
}

// Home/away scores chosen to straddle every boundary the two rules can differ
// on: outright blowouts, one-point games, exact ties, and — for ATS — a spread
// that lands exactly on the margin (a PUSH).
//
// ⚠️ THE LAST TWO ENTRIES ARE THE ABSENCE OF A SCORE, NOT A SCORE.
//
// This matrix used to hold only games that HAD scores, so it could never see
// the one place the two rules disagreed: `gradePickemGames` skips a FINAL the
// feed reported no scores for (NFL7-3) and `gradePick` graded it off `?? 0`.
// Straight-up that reads as a harmless 0-0 PUSH — which is why five rows of
// real scores never caught it — but in ATS the spread moves the adjusted home
// score off the tie and the client announced a W or an L the scorer had not
// reached. `undefined` is the shape `nflSchedule.ts` actually emits (no
// `scores` object at all); `{ home: 24 }` is the belt-and-braces half-payload.
const SCORES: Array<{ home?: number; away?: number } | undefined> = [
  { home: 24, away: 17 }, // home wins by 7
  { home: 17, away: 24 }, // away wins by 7
  { home: 20, away: 20 }, // tie
  { home: 21, away: 20 }, // home by 1
  { home: 20, away: 21 }, // away by 1
  undefined,              // FINAL, feed reported nothing — engine skips it
  { home: 24 },           // FINAL, one side only — engine skips it too
];
const SPREADS = [undefined, -7, -6.5, -3, 0, 3, 7, 7.5];
const PICKS = ['ARI', 'CAR'];
const MODES = ['STRAIGHT', 'ATS', undefined];

describe('gradePick parity (client sheet vs the real scorer)', () => {
  it('agrees with gradePickemGames on every score × spread × pick × mode', () => {
    let checked = 0;
    let sawServerSkip = false;
    let sawServerGrade = false;
    for (const scores of SCORES) {
      for (const spreadValue of SPREADS) {
        for (const pick of PICKS) {
          for (const pickMode of MODES) {
            const g = game({
              scores,
              spread: spreadValue === undefined ? undefined : { value: spreadValue, locked: true },
            });
            const pool = { settings: { pickMode } } as never;
            const entry = { picks: { g1: pick } } as never;

            const serverGrade = gradePickemGames(entry, [g], pool).g1?.result ?? null;
            const clientGrade = gradePick(g, pick, pickMode);
            if (serverGrade === null) sawServerSkip = true; else sawServerGrade = true;

            expect(
              clientGrade,
              `disagreement: ${JSON.stringify(scores)} spread=${String(spreadValue)} pick=${pick} mode=${String(pickMode)}`,
            ).toBe(serverGrade);
            checked++;
          }
        }
      }
    }
    // Guard the guard: an empty or collapsed matrix would pass vacuously, and a
    // matrix in which the server NEVER skipped would prove nothing about the
    // scoreless-FINAL rows added above — which is precisely how the gap
    // survived here until #568 found it from the other direction.
    expect(checked).toBe(SCORES.length * SPREADS.length * PICKS.length * MODES.length);
    expect(sawServerSkip, 'the matrix must include games the scorer refuses to grade').toBe(true);
    expect(sawServerGrade, 'and games it does grade — otherwise it agrees on null and nothing else').toBe(true);
  });

  it('grades nothing for a FINAL the feed reported no scores for (NFL7-3)', () => {
    // The exact shape codex named on #568: ATS, FINAL, no scores, a real line.
    // 0-0 is a PUSH straight-up, so only the ATS branch exposes it — the spread
    // moves the adjusted home score off the tie and decides a game the scorer
    // is still refusing to grade.
    const g = game({ scores: undefined, spread: { value: -6.5, locked: true } });
    const pool = { settings: { pickMode: 'ATS' } } as never;
    expect(gradePickemGames({ picks: { g1: 'ARI' } } as never, [g], pool).g1).toBeUndefined();
    expect(gradePick(g, 'ARI', 'ATS')).toBeNull();
    // Straight-up too, where the old rule's answer (PUSH) was merely harmless
    // rather than wrong: "no grade" and "a scored tie" are different facts.
    expect(gradePick(g, 'ARI', 'STRAIGHT')).toBeNull();
    // A half-payload counts as no payload: the importer writes a real `0` for
    // the missing side, so one finite score is not evidence the game was played.
    const half = game({ scores: { home: 24 }, spread: { value: -6.5, locked: true } });
    expect(gradePickemGames({ picks: { g1: 'ARI' } } as never, [half], pool).g1).toBeUndefined();
    expect(gradePick(half, 'ARI', 'ATS')).toBeNull();
  });

  it('still VOIDs a CANCELLED game that never had scores — the gate is FINAL-only', () => {
    // Order matters in both rules: the engine checks `hasReportedScores` only
    // on FINAL, so a cancelled game is VOID whatever its scores say (or do not).
    // Putting the new gate before the CANCELLED branch would have silently
    // turned every cancelled game into "no grade" and stopped refunding it.
    const g = game({ status: 'CANCELLED', scores: undefined });
    const pool = { settings: { pickMode: 'ATS' } } as never;
    expect(gradePick(g, 'ARI', 'ATS')).toBe('VOID');
    expect(gradePickemGames({ picks: { g1: 'ARI' } } as never, [g], pool).g1?.result).toBe('VOID');
  });

  it('agrees that a CANCELLED game is VOID, whatever the score says', () => {
    const g = game({ status: 'CANCELLED', scores: { home: 30, away: 0 } });
    const pool = { settings: { pickMode: 'ATS' } } as never;
    expect(gradePick(g, 'ARI', 'ATS')).toBe('VOID');
    expect(gradePickemGames({ picks: { g1: 'ARI' } } as never, [g], pool).g1?.result).toBe('VOID');
  });

  it('grades nothing for an unpicked or unconcluded game', () => {
    expect(gradePick(game(), undefined, 'STRAIGHT')).toBeNull();
    expect(gradePick(game({ status: 'SCHEDULED' }), 'ARI', 'STRAIGHT')).toBeNull();
    expect(gradePick(game({ status: 'IN_PROGRESS' }), 'ARI', 'STRAIGHT')).toBeNull();
  });

  it('proves the OLD rule really did disagree — this is the defect', () => {
    // ARI wins 24-17 but is a 10-point favourite, so ARI does NOT cover.
    const g = game({ scores: { home: 24, away: 17 }, spread: { value: -10, locked: true } });
    const oldRuleSaysCorrect = (g as never as { scores: { home: number; away: number } }).scores.home > 17; // raw winner
    expect(oldRuleSaysCorrect).toBe(true);
    expect(gradePick(g, 'ARI', 'ATS')).toBe('L');
    // Green under the old rule, a loss to the scorer. That contradiction is
    // what this parity test exists to prevent returning.
  });
});

describe('the sheet consults the shared rule rather than re-deriving it', () => {
  const src = readFileSync(
    resolve(__dirname, '..', 'src/components/NFLPoolDashboard/PickemPickEntry.tsx'),
    'utf8',
  );

  it('calls gradePick on the pick the SERVER holds', () => {
    expect(src).toMatch(/utils\/pickemResult/);
    // ⚠️ `savedForGame` alone. This assertion used to name
    // `savedForGame ?? myPick`, and the fallback was a defect (codex round 2 of
    // the pick-feedback change): `picks` is seeded from a local DRAFT as well as
    // from the entry, so a game that went FINAL with an unsubmitted draft still
    // in the browser graded the draft — and the sheet then showed a verdict on a
    // pick the pool never received. Survivor and Margin have always graded
    // `savedPick`; this is Pick'em joining them.
    expect(src).toMatch(/gradePick\(game, savedForGame, castPool\.settings\?\.pickMode\)/);
    expect(src).not.toMatch(/gradePick\([^)]*savedForGame \?\? myPick/);
  });

  it('that grep matches the expression it was written to catch', () => {
    const removed = 'const result = gradePick(game, savedForGame ?? myPick, castPool.settings?.pickMode);';
    expect(removed).toMatch(/gradePick\([^)]*savedForGame \?\? myPick/);
  });

  it('no longer colours from the raw score', () => {
    expect(src).not.toMatch(/const homeWon = game\.status === 'FINAL'/);
    expect(src).not.toMatch(/\(homeWon && homePicked\)/);
  });

  it('that grep matches the code it was written to catch', () => {
    const removed = "const homeWon = game.status === 'FINAL' && (game.scores?.home ?? 0) > (game.scores?.away ?? 0);";
    expect(removed).toMatch(/const homeWon = game\.status === 'FINAL'/);
  });

  it('does not paint a PUSH as a loss', () => {
    // ⚠️ THE GATE MOVED, IT DID NOT GO AWAY (2026-08-24, pick-feedback change).
    //
    // This used to assert an inline `isGraded = result === 'W' || result === 'L'`
    // ternary. The green/red pair now lives in `pickSheet/pickOutcome.ts`, which
    // all three sheets share, and `pickemOutcome` maps PUSH and VOID to `null` —
    // a STRONGER form of the same guarantee, because Survivor and Margin get it
    // too rather than Pick'em owning a private copy.
    //
    // The behaviour ("a PUSH renders neutral") is asserted directly in
    // `tests/pick-outcome.test.ts`; this stays a wiring check, so the sheet
    // cannot quietly re-derive a colour from the raw grade again.
    expect(src).toMatch(/pickSheet\/pickOutcome/);
    expect(src).toMatch(/const outcome = pickemOutcome\(game, result\)/);
    expect(src).toMatch(/pickOutcomeCardClass\(outcome\)/);
    // No hand-rolled W/L gate may come back alongside it.
    expect(src).not.toMatch(/result === 'W' \|\| result === 'L'/);
  });

  it("matches the server's spread gate exactly — cancelled games included", () => {
    // Server: `games.every(g => g.spread?.locked === true)` over the whole week
    // query. The client used to exempt CANCELLED, so a cancelled game with no
    // locked line rendered an editable sheet whose every submit failed.
    //
    // The expression MOVED to `src/utils/poolUsesSpreads.ts` (`spreadsBlockWeek`)
    // so the dashboard's Lock Status card can ask the identical question — one
    // copy, not two saying opposite things on one screen. The sheet must consult
    // it and must not re-derive it inline.
    expect(src).toMatch(/spreadsBlockWeek\(castPool, games\)/);
    expect(src).not.toMatch(/games\.every\(g => g\.spread\?\.locked\)/);
    const gate = readFileSync(resolve(__dirname, '..', 'src/utils/poolUsesSpreads.ts'), 'utf8');
    expect(gate).toMatch(/return !weekGames\.every\(g => g\.spread\?\.locked\);/);
    expect(gate).not.toMatch(/filter\(g => g\.status !== 'CANCELLED'\)/);
  });
});

/**
 * THE GRID TAB IS THE SECOND CONSUMER, AND IT WAS THE ONE LEFT BEHIND.
 *
 * #568 fixed the pick SHEET's scoreless-FINAL divergence in
 * `pickSheet/pickOutcome.ts`, because `src/utils/` belonged to another
 * workstream — so `picksGrid.ts`, which calls `gradePick` directly and has no
 * `pickOutcome` in its path, kept printing a W or an L on an ATS game the
 * scorer refuses to grade. The fix moved to the root; this is the assertion
 * that the grid actually inherited it, rather than the sheet being patched a
 * second time.
 */
describe('the Current Picks grid grades from the same rule as the scorer', () => {
  const cell = (g: unknown, pick: string, pickMode: string | undefined) =>
    picksGridCell({
      game: g as never,
      entry: { picks: { g1: pick } },
      isOwnRow: true,
      revealedGameIds: new Set(['g1']),
      pickMode,
    });

  it('agrees with gradePickemGames on every score × spread × pick × mode', () => {
    let checked = 0;
    for (const scores of SCORES) {
      for (const spreadValue of SPREADS) {
        for (const pick of PICKS) {
          for (const pickMode of MODES) {
            const g = game({
              scores,
              spread: spreadValue === undefined ? undefined : { value: spreadValue, locked: true },
            });
            const serverGrade =
              gradePickemGames({ picks: { g1: pick } } as never, [g], { settings: { pickMode } } as never)
                .g1?.result ?? null;
            const c = cell(g, pick, pickMode);
            expect(c.kind).toBe('PICK');
            expect(
              (c as { result: unknown }).result,
              `grid disagreement: ${JSON.stringify(scores)} spread=${String(spreadValue)} pick=${pick} mode=${String(pickMode)}`,
            ).toBe(serverGrade);
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(SCORES.length * SPREADS.length * PICKS.length * MODES.length);
  });

  it('renders the pick UNGRADED on a scoreless FINAL rather than red (the carried finding)', () => {
    const g = game({ scores: undefined, spread: { value: -6.5, locked: true } });
    // Still a PICK — the member did pick, and the game IS revealed. What must
    // not survive is a verdict attached to it.
    expect(cell(g, 'ARI', 'ATS')).toEqual({ kind: 'PICK', team: 'ARI', result: null });
  });
});
