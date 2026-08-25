import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  pickemOutcome,
  survivorOutcome,
  marginOutcome,
  pickOutcomeCardClass,
  pickOutcomeLabel,
  type PickOutcome,
} from '../src/components/NFLPoolDashboard/pickSheet/pickOutcome';
import { gradePick } from '../src/utils/pickemResult';
import {
  evaluateSurvivorWeek,
  scoreMarginWeek,
  gradePickemGames,
} from '../functions/src/nflScoringEngine';

/**
 * The pick sheets now claim a VERDICT — a green tick means "you were right" and
 * a red cross means "you were wrong". A verdict that disagrees with the scorer
 * is worse than no verdict at all, so every grader here is compared against the
 * REAL engine over a matrix, the same discipline as
 * `tests/pickem-result-parity.test.ts`.
 *
 * `functions/` is a separate, module-incompatible TS root the Vite bundle cannot
 * import — which is why the sheets need a mirror, and why this file is the thing
 * holding the mirror honest.
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

// Straddles every boundary the rules below can differ on: both teams winning,
// an exact tie, and one-point games.
const SCORES = [
  { home: 24, away: 17 },
  { home: 17, away: 24 },
  { home: 20, away: 20 },
  { home: 21, away: 20 },
  { home: 20, away: 21 },
];
const PICKS = ['ARI', 'CAR'];

// ---------------------------------------------------------------------------
// Pick'em
// ---------------------------------------------------------------------------

const g0 = game();

describe("pickemOutcome — Pick'em, straight-up and ATS", () => {
  it('maps the scorer grade to a verdict and nothing else', () => {
    expect(pickemOutcome(g0, 'W')).toBe('CORRECT');
    expect(pickemOutcome(g0, 'L')).toBe('INCORRECT');
    // Both are SCORED and neither is a loss. Painting a refunded pick red would
    // contradict the member's own standings.
    expect(pickemOutcome(g0, 'PUSH')).toBeNull();
    expect(pickemOutcome(g0, 'VOID')).toBeNull();
    expect(pickemOutcome(g0, null)).toBeNull();
  });

  /**
   * ⚠️ THE SCORES LIST INCLUDES `undefined` ON PURPOSE (codex, round 1).
   *
   * `tests/pickem-result-parity.test.ts` used to compare `gradePick` to the
   * scorer over a matrix in which every game HAD scores, so it could never see
   * the one place they disagreed: `gradePickemGames` skips a FINAL the feed
   * reported no scores for, and `gradePick` graded it off `?? 0`. Straight-up
   * that reads as a harmless 0-0 PUSH; in ATS the spread pushes it off the tie
   * and the sheet announced a W or an L on a game the scorer will not grade.
   *
   * That gap is now closed at the root, and the parity matrix carries the
   * scoreless rows itself. This matrix stays: it drives the REAL
   * `gradePickemGames` through the SHEET's whole path (`gradePick` then
   * `pickemOutcome`), which is what proves the two layers compose to the
   * scorer's answer rather than each being right on its own.
   */
  it('never claims a verdict the real scorer has not reached', () => {
    let checked = 0;
    let sawServerSkip = false;
    for (const scores of [...SCORES, undefined, { home: 24 }]) {
      for (const spreadValue of [undefined, -7, -6.5, -3, 0, 3, 7]) {
        for (const pick of PICKS) {
          for (const pickMode of ['STRAIGHT', 'ATS', undefined]) {
            const g = game({
              scores,
              spread: spreadValue === undefined ? undefined : { value: spreadValue, locked: true },
            });
            const entry = { picks: { g1: pick } } as never;
            const pool = { settings: { pickMode } } as never;
            const serverGrade = gradePickemGames(entry, [g], pool).g1?.result ?? null;
            if (serverGrade === null) sawServerSkip = true;

            const outcome = pickemOutcome(g, gradePick(g, pick, pickMode));
            const expected: PickOutcome =
              serverGrade === 'W' ? 'CORRECT' : serverGrade === 'L' ? 'INCORRECT' : null;
            expect(
              outcome,
              `${JSON.stringify(scores)} spread=${String(spreadValue)} pick=${pick} mode=${String(pickMode)}`,
            ).toBe(expected);
            checked++;
          }
        }
      }
    }
    // Guard the guard: an empty matrix, or one where the server never skipped,
    // would pass vacuously and prove nothing about the case this test was added
    // for.
    expect(checked).toBe((SCORES.length + 2) * 7 * 2 * 3);
    expect(sawServerSkip).toBe(true);
  });

  it('stays silent on a scoreless FINAL — now from BOTH layers', () => {
    // The exact shape codex named: ATS, FINAL, no scores, a real line.
    const g = game({ scores: undefined, spread: { value: -6.5, locked: true } });
    // ⚠️ THIS ASSERTION FLIPPED, ON PURPOSE. It used to read `.toBe('L')` and
    // carried a note saying it would fail loudly if `gradePick` were ever fixed
    // at the root. That is exactly what happened: the root gate landed so the
    // Current Picks GRID — which calls `gradePick` with no `pickemOutcome` in
    // its path — would stop announcing a verdict the scorer has not reached.
    // The divergence this line pinned no longer exists, so pinning it would be
    // pinning a bug.
    expect(gradePick(g, 'ARI', 'ATS')).toBeNull();
    expect(gradePickemGames({ picks: { g1: 'ARI' } } as never, [g], { settings: { pickMode: 'ATS' } } as never).g1)
      .toBeUndefined();
    // `pickemOutcome`'s own gate is now belt-and-braces rather than the only
    // thing standing between the member and a false verdict. It is kept — the
    // signature lets any caller hand over a grade from elsewhere — and this
    // proves it still answers `null` when handed a decided grade for a game the
    // scorer skipped, which is the only case where it can still matter.
    expect(pickemOutcome(g, gradePick(g, 'ARI', 'ATS'))).toBeNull();
    expect(pickemOutcome(g, 'L'), 'the redundant gate still holds on its own').toBeNull();
    expect(pickemOutcome(g, 'W'), 'in both directions').toBeNull();
  });

  it('says nothing about a game that has not concluded, or was not picked', () => {
    const sched = game({ status: 'SCHEDULED' });
    const live = game({ status: 'IN_PROGRESS' });
    expect(pickemOutcome(sched, gradePick(sched, 'ARI', 'STRAIGHT'))).toBeNull();
    expect(pickemOutcome(live, gradePick(live, 'ARI', 'STRAIGHT'))).toBeNull();
    expect(pickemOutcome(g0, gradePick(g0, undefined, 'STRAIGHT'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Survivor
// ---------------------------------------------------------------------------

/** The engine's own week evaluator, driven with a one-game slate. */
function serverSurvivorStrike(
  g: ReturnType<typeof game>,
  pick: string,
  pickLosersMode: boolean,
  tieCountsAs: 'WIN' | 'LOSS',
): boolean {
  const entry = { status: 'ALIVE', picks: { 1: pick }, exemptWeeks: [] } as never;
  const pool = { settings: { pickLosersMode, tieCountsAs, maxStrikes: 0 } } as never;
  return evaluateSurvivorWeek(entry, 1, [g], pool).strikeLogged;
}

describe('survivorOutcome — mirrors evaluateSurvivorWeek per pick', () => {
  it('agrees with the engine on every score × pick × mode × tie rule', () => {
    let checked = 0;
    for (const scores of SCORES) {
      for (const pick of PICKS) {
        for (const pickLosersMode of [false, true]) {
          for (const tieCountsAs of ['WIN', 'LOSS'] as const) {
            const g = game({ scores });
            const struck = serverSurvivorStrike(g, pick, pickLosersMode, tieCountsAs);
            expect(
              survivorOutcome(g, pick, { pickLosersMode, tieCountsAs }),
              `${JSON.stringify(scores)} pick=${pick} losers=${pickLosersMode} tie=${tieCountsAs}`,
            ).toBe(struck ? 'INCORRECT' : 'CORRECT');
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(SCORES.length * 2 * 2 * 2);
  });

  it('folds a tie into a WIN only when the pool says so — both modes', () => {
    const tie = game({ scores: { home: 20, away: 20 } });
    const rules = (pickLosersMode: boolean, tieCountsAs: 'WIN' | 'LOSS') => ({ pickLosersMode, tieCountsAs });
    // Pick-a-winner: tie-as-WIN survives, the default strikes.
    expect(survivorOutcome(tie, 'ARI', rules(false, 'WIN'))).toBe('CORRECT');
    expect(survivorOutcome(tie, 'ARI', rules(false, 'LOSS'))).toBe('INCORRECT');
    // Pick-a-loser: a tie counting as a WIN for your team is a strike.
    expect(survivorOutcome(tie, 'ARI', rules(true, 'WIN'))).toBe('INCORRECT');
    expect(survivorOutcome(tie, 'ARI', rules(true, 'LOSS'))).toBe('INCORRECT');
  });

  const alwaysNull: Array<[string, ReturnType<typeof game>, string | undefined]> = [
    ['unpicked', game({ scores: { home: 24, away: 17 } }), undefined],
    ['still scheduled', game({ status: 'SCHEDULED' }), 'ARI'],
    ['in progress', game({ status: 'IN_PROGRESS', scores: { home: 7, away: 0 } }), 'ARI'],
    ['cancelled', game({ status: 'CANCELLED' }), 'ARI'],
    ['a team not in this matchup', game({ scores: { home: 24, away: 17 } }), 'KC'],
    // NFL7-3/NFL7-4: a FINAL with dropped scores reads 0-0, which is a real tie
    // and therefore a strike by default. The engine waits; so must the sheet, or
    // the card goes red on a game nobody played.
    ['a FINAL with no reported scores', game({ scores: undefined }), 'ARI'],
    ['a FINAL missing one score', game({ scores: { home: 24 } }), 'ARI'],
  ];
  it.each(alwaysNull)('says nothing on %s', (_label, g, pick) => {
    expect(survivorOutcome(g, pick, { pickLosersMode: false, tieCountsAs: 'LOSS' })).toBeNull();
  });

  it('says nothing on an exempt week — the pick could not strike', () => {
    const lost = game({ scores: { home: 17, away: 24 } });
    expect(survivorOutcome(lost, 'ARI', { pickLosersMode: false, tieCountsAs: 'LOSS' })).toBe('INCORRECT');
    expect(
      survivorOutcome(lost, 'ARI', { pickLosersMode: false, tieCountsAs: 'LOSS', exempt: true }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Margin
// ---------------------------------------------------------------------------

describe('marginOutcome — mirrors the SIGN of scoreMarginWeek', () => {
  it('agrees with the engine on every score × pick', () => {
    let checked = 0;
    for (const scores of SCORES) {
      for (const pick of PICKS) {
        const g = game({ scores });
        const net = scoreMarginWeek(pick, [g]);
        const expected: PickOutcome =
          net === null || net === 0 ? null : net > 0 ? 'CORRECT' : 'INCORRECT';
        expect(marginOutcome(g, pick), `${JSON.stringify(scores)} pick=${pick}`).toBe(expected);
        checked++;
      }
    }
    expect(checked).toBe(SCORES.length * 2);
  });

  it('a tie nets zero, which is neither right nor wrong', () => {
    const tie = game({ scores: { home: 20, away: 20 } });
    expect(scoreMarginWeek('ARI', [tie])).toBe(0);
    expect(marginOutcome(tie, 'ARI')).toBeNull();
  });

  it('a cancelled game nets zero and gets no mark', () => {
    const cancelled = game({ status: 'CANCELLED' });
    expect(scoreMarginWeek('ARI', [cancelled])).toBe(0);
    expect(marginOutcome(cancelled, 'ARI')).toBeNull();
  });

  it('waits on a FINAL with no reported scores rather than recording 0', () => {
    const scoreless = game({ scores: undefined });
    expect(scoreMarginWeek('ARI', [scoreless])).toBeNull();
    expect(marginOutcome(scoreless, 'ARI')).toBeNull();
  });

  it('says nothing when unpicked, unconcluded, or the team is not playing', () => {
    expect(marginOutcome(game({ scores: { home: 24, away: 17 } }), undefined)).toBeNull();
    expect(marginOutcome(game({ status: 'SCHEDULED' }), 'ARI')).toBeNull();
    expect(marginOutcome(game({ status: 'IN_PROGRESS', scores: { home: 7, away: 0 } }), 'ARI')).toBeNull();
    expect(marginOutcome(game({ scores: { home: 24, away: 17 } }), 'KC')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Presentation — theme safety and the non-colour channel
// ---------------------------------------------------------------------------

describe('pickOutcomeCardClass', () => {
  const correct = pickOutcomeCardClass('CORRECT');
  const incorrect = pickOutcomeCardClass('INCORRECT');
  const pending = pickOutcomeCardClass(null);

  it('gives an ungraded card the ordinary border and NO wash', () => {
    // Kevin's (e): a pending game gets neither a mark nor a highlight.
    expect(pending).toBe('border-line');
    expect(pending).not.toMatch(/\bbg-/);
  });

  it('tells the three states apart', () => {
    expect(correct).not.toBe(incorrect);
    expect(correct).not.toBe(pending);
    expect(incorrect).not.toBe(pending);
  });

  it('carries an explicit dark-mode pair for every colour it sets', () => {
    // A light-only wash inherits whatever the dark card happens to be, which is
    // how a "green" highlight ends up unreadable at night.
    for (const cls of [correct, incorrect]) {
      const light = cls.split(/\s+/).filter(c => !c.startsWith('dark:'));
      const dark = cls.split(/\s+/).filter(c => c.startsWith('dark:'));
      expect(light.length).toBeGreaterThan(0);
      expect(dark.length).toBe(light.length);
    }
  });

  it('uses green for correct and the brand red for incorrect', () => {
    expect(correct).toContain('#0F7B4A');
    expect(correct).toContain('#4CC38A');
    expect(incorrect).toContain('brandred');
    expect(incorrect).not.toContain('#0F7B4A');
  });
});

describe('pickOutcomeLabel — the state is never colour-only', () => {
  it('names both verdicts in words', () => {
    expect(pickOutcomeLabel('CORRECT')).toBe('Correct pick');
    expect(pickOutcomeLabel('INCORRECT')).toBe('Incorrect pick');
  });

  it('announces nothing for an ungraded game', () => {
    expect(pickOutcomeLabel(null)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Wiring — coarse source greps, same convention as tests/nfl-surface-invariants
// ---------------------------------------------------------------------------

const root = resolve(__dirname, '..');
const SHEETS = [
  'src/components/NFLPoolDashboard/PickemPickEntry.tsx',
  'src/components/NFLPoolDashboard/SurvivorPickEntry.tsx',
  'src/components/NFLPoolDashboard/MarginPickEntry.tsx',
];
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('the sheets actually use this — wiring, not logic', () => {
  it.each(SHEETS)('%s highlights the whole card from the shared helper', file => {
    const src = read(file);
    expect(src).toMatch(/\bpickOutcomeCardClass\s*\(/);
    // The pre-change Pick'em card inlined its own green/red pair. A re-inlined
    // copy would drift from the badge on the button inside it.
    expect(src).not.toContain("'border-[#BEE7D0] bg-[#0F7B4A]/5'");
  });

  it('that grep matches the string it was written to catch', () => {
    // A guard matching nothing is indistinguishable from a guard that passes.
    const removed = "className={`bg-card border rounded-xl ... 'border-[#BEE7D0] bg-[#0F7B4A]/5'";
    expect(removed).toContain("'border-[#BEE7D0] bg-[#0F7B4A]/5'");
  });

  it.each(SHEETS)('%s passes a graded outcome to TeamPickButton', file => {
    expect(read(file)).toMatch(/\boutcome=\{/);
  });

  it.each(SHEETS)('%s marks only the picked team, never both sides', file => {
    // Every `outcome=` prop must be conditional on the team abbreviation, or a
    // cross lands on the team the member did NOT pick.
    const props = read(file).match(/outcome=\{[^}]*\}/g) ?? [];
    expect(props.length).toBe(2);
    for (const p of props) expect(p).toMatch(/\?[^:]*:\s*null/);
  });

  it.each(SHEETS)('%s grades the SERVER\'s pick, never the local selection', file => {
    const src = read(file);
    // A verdict is a claim about the entry the pool holds. Grading the local
    // selection would put a tick on an unsubmitted draft (codex round 2).
    // Scoped to the CALL, not to any mention: `PickemPickEntry` documents the
    // removed expression in a comment, and a bare grep would trip on the
    // explanation of why it is gone.
    expect(src).not.toMatch(/gradePick\([^)]*savedForGame \?\? myPick/);
    expect(src).not.toMatch(/(?:survivor|margin)Outcome\([^)]*selectedTeam/);
  });

  it('that grep matches the call it was written to catch', () => {
    const removed = 'gradePick(game, savedForGame ?? myPick, castPool.settings?.pickMode)';
    expect(removed).toMatch(/gradePick\([^)]*savedForGame \?\? myPick/);
    const removedSurvivor = 'survivorOutcome(game, selectedTeam ?? undefined, rules)';
    expect(removedSurvivor).toMatch(/(?:survivor|margin)Outcome\([^)]*selectedTeam/);
  });

  it('TeamPickButton draws a check ONLY for a correct pick', () => {
    const src = read('src/components/NFLPoolDashboard/pickSheet/TeamPickButton.tsx');
    // The regression: a `<Check>` gated on `selected` alone is the badge testers
    // read as "I won this game".
    expect(src).not.toMatch(/\{selected && \(\s*<span[^]*?<Check/);
    expect(src).toMatch(/outcome === 'CORRECT'[^]*?<Check/);
    expect(src).toMatch(/<X\b/);
  });

  it('that grep matches the badge it was written to catch', () => {
    // Positive control for the negative assertion above — the literal
    // pre-change JSX, which must still trip the pattern.
    const removed = [
      '      {selected && (',
      '        <span',
      '          className={`absolute top-1.5 right-1.5 z-10 p-0.5 rounded-full ${',
      "            saved ? 'bg-[#0F7B4A] text-white' : 'bg-gold-500 text-navy-900'",
      '          }`}',
      '        >',
      '          <Check size={10} className="stroke-[4]" aria-hidden="true" />',
    ].join('\n');
    expect(removed).toMatch(/\{selected && \(\s*<span[^]*?<Check/);
  });

  it('TeamPickButton still distinguishes saved from unsaved, in WORDS', () => {
    const src = read('src/components/NFLPoolDashboard/pickSheet/TeamPickButton.tsx');
    // The state the old check badge carried has to survive its removal.
    expect(src).toContain('Not saved yet');
    expect(src).toContain("{saved ? 'Saved' : 'Unsaved'}");
  });

  it('every result badge carries screen-reader text', () => {
    const src = read('src/components/NFLPoolDashboard/pickSheet/TeamPickButton.tsx');
    expect(src).toMatch(/sr-only[^]*?pickOutcomeLabel\(outcome\)/);
  });

  it.each(SHEETS)('%s announces the card highlight as text too', file => {
    expect(read(file)).toMatch(/sr-only[^]*?pickOutcomeLabel\(outcome\)/);
  });
});
