import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  effectiveWeeklyTiebreaker,
  frozenTiebreakTargetFor,
  PICKABLE_WEEKLY_TIEBREAKERS,
  DEFAULT_NEW_POOL_TIEBREAKER,
  resolveTiebreakTargetIds,
  sameTargetIds,
  tiebreakTargetSentence,
  tiebreakerAsksForPrediction,
  tiebreakerCopy,
  WEEKLY_TIEBREAKER_VALUES,
} from '../shared/nflTiebreaker';
import { WEEKLY_TIEBREAKER_OPTIONS } from '../shared/nflTiebreakerOptions';

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
    // ...and the FROZEN target beside it (PLAN-WEEKLY-PRIZES §2b): the first
    // submission of a week pins the game(s) the sheet named, and the scorer
    // must judge against that pin, not the live schedule.
    expect(src).toContain('computeMNFTiebreakerTotal(games, tiebreakerRule, frozenTarget)');
    expect(src).toContain('frozenTiebreakTargetFor(');
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

  it('a VOID week publishes no winner', () => {
    // All games cancelled means everyone scores 0 and no Monday game reaches
    // FINAL, so the cascade produces a shared win over a week nobody played —
    // "pay everyone" on a WEEKLY pool. The cascade cannot see this; the caller
    // must. (Self-review, after codex round 3 came back clean.)
    const src = read('functions/src/nflPools.ts');
    expect(src).toContain('isVoidWeek(games) ? [] : computeWeeklyWinners(winnerCandidates)');
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

// ---------------------------------------------------------------------------
// PLAN-WEEKLY-PRIZES B1 (§2a–§2b, D1–D3; signed 2026-08-15)
// ---------------------------------------------------------------------------

describe('B1 — the option set (§2a)', () => {
  it('MNF_FIRST_GAME is a value; MNF_COMBINED is accepted but NOT pickable; the new-pool default is MNF_LAST_GAME (D1)', () => {
    expect(WEEKLY_TIEBREAKER_VALUES).toContain('MNF_FIRST_GAME');
    expect(WEEKLY_TIEBREAKER_VALUES).toContain('MNF_COMBINED');
    expect(PICKABLE_WEEKLY_TIEBREAKERS).not.toContain('MNF_COMBINED');
    expect(PICKABLE_WEEKLY_TIEBREAKERS).toEqual(['MNF_LAST_GAME', 'MNF_FIRST_GAME', 'NONE']);
    expect(DEFAULT_NEW_POOL_TIEBREAKER).toBe('MNF_LAST_GAME');
    expect(WEEKLY_TIEBREAKER_OPTIONS.map(o => o.value)).toEqual([...PICKABLE_WEEKLY_TIEBREAKERS]);
  });
  it('absent STILL resolves to MNF_COMBINED (D1 — nothing moves under an in-flight week); MNF_FIRST_GAME passes through', () => {
    expect(effectiveWeeklyTiebreaker({})).toBe('MNF_COMBINED');
    expect(effectiveWeeklyTiebreaker({ weeklyTiebreaker: 'MNF_FIRST_GAME' })).toBe('MNF_FIRST_GAME');
  });
  it('the wizard writes the default explicitly and offers only the pickable list; the manager select renders legacy MNF_COMBINED read-only', () => {
    const wizard = read('src/components/wizard/create/CreateNFLPickemPool.tsx');
    expect(wizard).toContain('weeklyTiebreaker: DEFAULT_NEW_POOL_TIEBREAKER');
    expect(wizard).toContain('options={[...WEEKLY_TIEBREAKER_OPTIONS]}');
    expect(wizard).not.toMatch(/value: 'MNF_COMBINED'/);
    const manager = read('src/components/NFLPoolDashboard/NFLManagerView.tsx');
    expect(manager).toContain("weeklyTiebreaker === 'MNF_COMBINED' && (");
    expect(manager).toContain('WEEKLY_TIEBREAKER_OPTIONS.map(');
  });
});

describe('B1 — resolveTiebreakTargetIds (§2b): one function for the sheet, the freeze and the scorer', () => {
  const sun = { id: 'sun', startTime: 100, isMonday: false };
  const mon1 = { id: 'mon1', startTime: 300, isMonday: true };
  const mon2 = { id: 'mon2', startTime: 400, isMonday: true };
  const wk = [mon2, sun, mon1]; // deliberately unordered

  it('LAST → last Monday game to kick off; FIRST → first; COMBINED → every Monday game in kickoff order; NONE → []', () => {
    expect(resolveTiebreakTargetIds(wk, 'MNF_LAST_GAME')).toEqual(['mon2']);
    expect(resolveTiebreakTargetIds(wk, 'MNF_FIRST_GAME')).toEqual(['mon1']);
    expect(resolveTiebreakTargetIds(wk, 'MNF_COMBINED')).toEqual(['mon1', 'mon2']);
    expect(resolveTiebreakTargetIds(wk, 'NONE')).toEqual([]);
  });
  it('same start time → id decides, deterministically (two passes cannot pick different games)', () => {
    const a = { id: 'a', startTime: 300, isMonday: true };
    const b = { id: 'b', startTime: 300, isMonday: true };
    expect(resolveTiebreakTargetIds([b, a], 'MNF_LAST_GAME')).toEqual(['b']);
    expect(resolveTiebreakTargetIds([b, a], 'MNF_FIRST_GAME')).toEqual(['a']);
  });
  it('Monday-less week: LAST and FIRST fall back to the FINAL game of the week; legacy COMBINED does NOT (§0: an in-flight legacy week keeps its meaning)', () => {
    const early = { id: 'early', startTime: 50, isMonday: false };
    expect(resolveTiebreakTargetIds([sun, early], 'MNF_LAST_GAME')).toEqual(['sun']);
    expect(resolveTiebreakTargetIds([sun, early], 'MNF_FIRST_GAME')).toEqual(['sun']);
    expect(resolveTiebreakTargetIds([sun, early], 'MNF_COMBINED')).toEqual([]);
  });
  it('empty schedule → []', () => {
    expect(resolveTiebreakTargetIds([], 'MNF_LAST_GAME')).toEqual([]);
  });
  it('sameTargetIds is order-sensitive equality; frozenTiebreakTargetFor reads the pool-week map and treats junk as absent', () => {
    expect(sameTargetIds(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameTargetIds(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameTargetIds(undefined, ['a'])).toBe(false);
    expect(frozenTiebreakTargetFor({ frozenTiebreakTargets: { 3: ['x'] } }, 3)).toEqual(['x']);
    expect(frozenTiebreakTargetFor({ frozenTiebreakTargets: { '3': ['x'] } }, 3)).toEqual(['x']);
    expect(frozenTiebreakTargetFor({ frozenTiebreakTargets: { 3: [] } }, 3)).toBeUndefined();
    expect(frozenTiebreakTargetFor({ frozenTiebreakTargets: { 3: 'x' } }, 3)).toBeUndefined();
    expect(frozenTiebreakTargetFor({}, 3)).toBeUndefined();
  });
  it('tiebreakTargetSentence names the actual game(s), and says so when the fallback is in play (§2b(2))', () => {
    const games = [
      { id: 'sun', isMonday: false, homeTeam: { abbreviation: 'MIA' }, awayTeam: { abbreviation: 'BUF' } },
      { id: 'mon1', isMonday: true, homeTeam: { abbreviation: 'DAL' }, awayTeam: { abbreviation: 'NYG' } },
      { id: 'mon2', isMonday: true, homeTeam: { abbreviation: 'SF' }, awayTeam: { abbreviation: 'SEA' } },
    ];
    expect(tiebreakTargetSentence(['mon2'], games)).toBe("This week's tiebreaker game: SEA at SF.");
    expect(tiebreakTargetSentence(['mon1', 'mon2'], games)).toBe("This week's tiebreaker games: NYG at DAL + SEA at SF.");
    expect(tiebreakTargetSentence(['sun'], games)).toBe('No Monday game this week — the tiebreaker is the final game of the week: BUF at MIA.');
    expect(tiebreakTargetSentence([], games)).toBeNull();
    expect(tiebreakTargetSentence(['gone'], games)).toBeNull();
  });
  it('the sheet, the submit path and the scorer all read the ONE resolver + the frozen map', () => {
    expect(read('src/components/NFLPoolDashboard/PickemPickEntry.tsx')).toContain('resolveTiebreakTargetIds(games, tiebreakerRule)');
    expect(read('src/components/NFLPoolDashboard/PickemPickEntry.tsx')).toContain('displayedTiebreakTargetIds: showTiebreaker ? tiebreakTargetIds : undefined');
    const fn = read('functions/src/nflPools.ts');
    expect(fn).toContain('resolveTiebreakTargetIds(games, tiebreakRule)');
    expect(fn).toContain('TIEBREAK_TARGET_STALE');
    expect(fn).toContain('frozenTiebreakTargets.' + '${week}');
    expect(read('functions/src/schemas/poolCore.ts')).toContain('displayedTiebreakTargetIds');
    expect(read('firestore.rules')).toContain("'frozenTiebreakTargets'");
  });
});
