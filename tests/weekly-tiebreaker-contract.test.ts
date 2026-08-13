import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  effectiveWeeklyTiebreaker,
  tiebreakerAsksForPrediction,
  tiebreakerCopy,
  WEEKLY_TIEBREAKER_VALUES,
} from '../shared/nflTiebreaker';

/**
 * The weekly tie-breaker contract (PLAN-WEEKLY-TIEBREAKERS §3–§4).
 *
 * The unit half pins the DEFAULT, which is the entire no-migration story: every
 * pool created before this setting existed has no `weeklyTiebreaker` field, and
 * resolving absence to `MNF_COMBINED` at every read site is what keeps them
 * playing exactly what they played yesterday. If that default ever flips, every
 * existing pool silently changes rules mid-season.
 *
 * The source half pins the WIRING, the same way `nfl-surface-invariants` does:
 * a surface that reads `settings.weeklyTiebreaker` raw instead of through the
 * resolver would treat an unset pool as having no rule at all.
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('effectiveWeeklyTiebreaker — absence means the historical rule', () => {
  it.each([
    ['undefined settings', undefined],
    ['null settings', null],
    ['empty settings', {}],
    ['explicitly undefined field', { weeklyTiebreaker: undefined }],
  ])('%s resolves to MNF_COMBINED', (_label, settings) => {
    expect(effectiveWeeklyTiebreaker(settings as never)).toBe('MNF_COMBINED');
  });

  it.each(WEEKLY_TIEBREAKER_VALUES)('passes through the valid value %s', (v) => {
    expect(effectiveWeeklyTiebreaker({ weeklyTiebreaker: v })).toBe(v);
  });

  it.each([
    ['a typo', 'MNF_LASTGAME'],
    ['lowercase', 'none'],
    ['a number', 3],
    ['an object', {}],
  ])('resolves junk (%s) to the default rather than to NONE or a throw', (_label, v) => {
    // A settings map is not a type system. Falling back to the historical rule
    // keeps a hand-edited pool playing what its members expect; falling to NONE
    // would silently delete its tiebreaker.
    expect(effectiveWeeklyTiebreaker({ weeklyTiebreaker: v })).toBe('MNF_COMBINED');
  });
});

describe('tiebreakerAsksForPrediction', () => {
  it('asks under both MNF rules and not under NONE', () => {
    expect(tiebreakerAsksForPrediction('MNF_COMBINED')).toBe(true);
    expect(tiebreakerAsksForPrediction('MNF_LAST_GAME')).toBe(true);
    expect(tiebreakerAsksForPrediction('NONE')).toBe(false);
  });
});

describe('tiebreakerCopy — one sentence per rule, or none', () => {
  it('returns null for NONE rather than empty strings', () => {
    // A caller must decide to render nothing, not be handed "" and print an
    // orphaned heading.
    expect(tiebreakerCopy('NONE')).toBeNull();
  });

  it('the MNF_COMBINED hint still says BOTH games — the shipped wording', () => {
    expect(tiebreakerCopy('MNF_COMBINED')!.hint).toContain('both');
  });

  it('the MNF_LAST_GAME copy names the LAST game and does not claim both', () => {
    const copy = tiebreakerCopy('MNF_LAST_GAME')!;
    expect(copy.label).toContain('LAST');
    expect(copy.hint).toContain('last Monday game');
    expect(copy.hint).not.toContain('both');
  });
});

describe('wiring — no surface re-derives the rule or hard-codes the copy', () => {
  const SURFACES = [
    'src/components/NFLPoolDashboard/PickemPickEntry.tsx',
    'src/components/NFLPoolDashboard/NFLStandings.tsx',
    'src/components/NFLPoolDashboard/NFLPoolRules.tsx',
    'src/components/NFLPoolDashboard/NFLManagerView.tsx',
  ];

  it.each(SURFACES)('%s resolves the rule through effectiveWeeklyTiebreaker', (file) => {
    const src = read(file);
    expect(src).toContain('effectiveWeeklyTiebreaker');
  });

  it('the pick sheet takes its label and hint from the shared copy, not a literal', () => {
    const src = read('src/components/NFLPoolDashboard/PickemPickEntry.tsx');
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(code).toContain('tiebreakerCopy');
    // The old hard-coded label was true only under MNF_COMBINED and silently
    // wrong on a last-game pool. Copy that can disagree with the scorer is the
    // failure this setting exists to end.
    expect(code).not.toContain('Predicted Monday Night Football Combined Score');
    expect(code).not.toContain('we count the combined score of');
  });

  it('the scorer reads the rule and passes it to the target computation', () => {
    const src = read('functions/src/nflPools.ts');
    expect(src).toContain('effectiveWeeklyTiebreaker');
    expect(src).toContain('computeMNFTiebreakerTotal(games, tiebreakerRule)');
  });

  it('only entries that PLAYED the week become weekly-winner candidates', () => {
    // Without this gate every non-submitter enters at 0 points, and on a week
    // where the real players also finish at 0 the "winners" are everybody who
    // did not play. Margin has always gated its sharp line the same way.
    // (codex P1, round 1 on the implementation.)
    const src = read('functions/src/nflPools.ts');
    // Pick'em: gated on having picked something in this week's gradable slate.
    expect(src).toContain('if (picksThisWeek > 0) {');
    // Margin: gated on `pick`. Whitespace-insensitive — the assertion is about
    // the gate, and pinning indentation makes a formatter break a real guard.
    expect(src).toMatch(/if \(pick\) \{\s*winnerCandidates\.push\(/);
    // Exactly the two gated pushes, so a third ungated one cannot slip in.
    expect(src.match(/winnerCandidates\.push\(/g)).toHaveLength(2);
  });

  it('the standings MNF column is gated on the rule', () => {
    // Under NONE a prediction stored before the switch would otherwise keep
    // rendering, contradicting the rules page. (codex R8.1.)
    const src = read('src/components/NFLPoolDashboard/NFLStandings.tsx');
    expect(src).toContain('showTiebreakerColumn');
    expect(src).toContain('{showTiebreakerColumn && <th');
  });

  it('the create schema carries the field, or the wizard choice is stripped at create', () => {
    // `settings` is a z.object, which STRIPS unknown keys.
    const src = read('shared/schemas/nfl.ts');
    expect(src).toContain('weeklyTiebreaker: z.enum(WEEKLY_TIEBREAKER_VALUES).optional()');
  });

  it('both hand-duplicated pool types carry the settings field', () => {
    for (const f of ['src/types/nflPoolTypes.ts', 'functions/src/nflPoolTypes.ts']) {
      expect(read(f)).toContain('weeklyTiebreaker?: WeeklyTiebreaker');
    }
  });

  it('both hand-duplicated WeeklyRecap types carry weeklyWinners', () => {
    for (const f of ['src/types/nflPoolTypes.ts', 'functions/src/nflPoolTypes.ts']) {
      expect(read(f)).toContain('weeklyWinners?: Array<{ userId: string; userName: string; points: number; tiebreakDiff?: number }>');
    }
  });
});
