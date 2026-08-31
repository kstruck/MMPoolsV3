import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyFrozenTarget,
  effectiveWeeklyTiebreaker,
  frozenTiebreakTargetFor,
  PICKABLE_WEEKLY_TIEBREAKERS,
  DEFAULT_NEW_POOL_TIEBREAKER,
  resolveTiebreakTargetIds,
  sameTargetIds,
  tiebreakTargetSentence,
  tiebreakerAskedButUnavailable,
  tiebreakerAsksForPrediction,
  tiebreakerCopy,
  WEEKLY_TIEBREAKER_VALUES,
  weekTiebreakTargetIds,
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

  it('ALL THREE asking rules name the Monday-less fallback — COMBINED was the one that did not, and its sheet asked for nothing', () => {
    // The copy half of PLAN-TIEBREAKER-MONDAYLESS. Two of the three hints
    // already carried this sentence; the third asserted the opposite behaviour
    // by omission, on the exact rule an unset pool resolves to.
    for (const rule of ['MNF_COMBINED', 'MNF_LAST_GAME', 'MNF_FIRST_GAME'] as const) {
      expect(tiebreakerCopy(rule)!.hint).toContain('no Monday game');
    }
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
    // No leading `{`: T10 put `!seasonOnly &&` in front of it, because the
    // column is week-scoped and the Season segment does not carry it. What this
    // guards is the RULE gate, which is still the last condition on the `<th>`.
    expect(src).toContain('showTiebreakerColumn && <th');
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
      expect(read(f)).toContain('weeklyWinners?: Array<{ entryId?: string; userId: string; userName: string; points: number; tiebreakDiff?: number }>');
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
  it('the rules page names every rule, including MNF_FIRST_GAME (codex r2 on #452)', () => {
    const rules = read('src/components/NFLPoolDashboard/NFLPoolRules.tsx');
    expect(rules).toContain("tiebreakerRule === 'MNF_FIRST_GAME' ? 'Closest to the FIRST Monday game total'");
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
  it('Monday-less week: EVERY asking rule falls back to the FINAL game of the week — legacy COMBINED included (PLAN-TIEBREAKER-MONDAYLESS, Kevin 2026-08-27)', () => {
    const early = { id: 'early', startTime: 50, isMonday: false };
    expect(resolveTiebreakTargetIds([sun, early], 'MNF_LAST_GAME')).toEqual(['sun']);
    expect(resolveTiebreakTargetIds([sun, early], 'MNF_FIRST_GAME')).toEqual(['sun']);
    // WAS `[]`, and that gap shipped a pool whose rules page promised a
    // tiebreaker while its pick sheet asked for nothing — absence of the
    // setting resolves to MNF_COMBINED, so every pre-2026-08-13 pool and every
    // simulator pool was on this branch. An in-flight week is protected by the
    // FREEZE instead (the next test), not by this returning nothing.
    expect(resolveTiebreakTargetIds([sun, early], 'MNF_COMBINED')).toEqual(['sun']);
    // NONE still asks nothing — the fallback is for rules that ask.
    expect(resolveTiebreakTargetIds([sun, early], 'NONE')).toEqual([]);
  });
  it('a Monday-FUL week is byte-identical under every rule — the reorder can only reach the Monday-less branch', () => {
    // The whole safety argument for the reorder, pinned rather than asserted in
    // a comment. If a future edit moves the COMBINED return back above the
    // fallback, the test above goes red; if it moves the fallback above a rule
    // that should have matched a Monday game, this one does.
    expect(resolveTiebreakTargetIds(wk, 'MNF_LAST_GAME')).toEqual(['mon2']);
    expect(resolveTiebreakTargetIds(wk, 'MNF_FIRST_GAME')).toEqual(['mon1']);
    expect(resolveTiebreakTargetIds(wk, 'MNF_COMBINED')).toEqual(['mon1', 'mon2']);
    // A single Monday game, the ordinary week: COMBINED must still return the
    // Monday game and NOT the week's final game, which is the same document
    // here only by coincidence in the multi-game case above.
    const oneMon = [{ id: 'sat', startTime: 10, isMonday: false }, { id: 'm', startTime: 20, isMonday: true }];
    expect(resolveTiebreakTargetIds(oneMon, 'MNF_COMBINED')).toEqual(['m']);
    // ...and when the Monday game is NOT last by kickoff, the two answers
    // differ, so the assertion above has teeth.
    const monThenLate = [{ id: 'm', startTime: 20, isMonday: true }, { id: 'tue', startTime: 99, isMonday: false }];
    expect(resolveTiebreakTargetIds(monThenLate, 'MNF_COMBINED')).toEqual(['m']);
    expect(resolveTiebreakTargetIds(monThenLate, 'MNF_LAST_GAME')).toEqual(['m']);
  });
  it('applyFrozenTarget / weekTiebreakTargetIds: ONE precedence rule — a frozen list wins, an EMPTY frozen list still wins, only undefined falls through', () => {
    const monLess = [{ id: 'early', startTime: 50, isMonday: false }, sun];
    // Nothing frozen → the rule decides.
    expect(applyFrozenTarget(undefined, monLess, 'MNF_COMBINED')).toEqual(['sun']);
    // A frozen list wins over the schedule.
    expect(applyFrozenTarget(['mon1'], wk, 'MNF_LAST_GAME')).toEqual(['mon1']);
    // 🛑 THE EMPTY ONE IS THE POINT. `[]` is not nullish, so a `??` reader gets
    // this right only by accident of the operator it reached for. A week that
    // froze "no target" before the fallback existed keeps no target — members
    // who already submitted hold no prediction and must not be beaten by one.
    expect(applyFrozenTarget([], monLess, 'MNF_COMBINED')).toEqual([]);
    // The pool-level wrapper reads the pool-week map and applies the same rule.
    expect(weekTiebreakTargetIds({ frozenTiebreakTargets: { 3: [] } }, 3, monLess, 'MNF_COMBINED')).toEqual([]);
    expect(weekTiebreakTargetIds({ frozenTiebreakTargets: { 3: ['x'] } }, 3, monLess, 'MNF_COMBINED')).toEqual(['x']);
    expect(weekTiebreakTargetIds({}, 3, monLess, 'MNF_COMBINED')).toEqual(['sun']);
    expect(weekTiebreakTargetIds(undefined, 3, monLess, 'MNF_COMBINED')).toEqual(['sun']);
    // Junk in the map reads as ABSENT, not as an empty freeze.
    expect(weekTiebreakTargetIds({ frozenTiebreakTargets: { 3: 'x' } }, 3, monLess, 'MNF_COMBINED')).toEqual(['sun']);
    // The returned array is a COPY — mutating it cannot corrupt the pool doc.
    const stored = ['x'];
    const got = weekTiebreakTargetIds({ frozenTiebreakTargets: { 3: stored } }, 3, monLess, 'MNF_COMBINED');
    got.push('y');
    expect(stored).toEqual(['x']);
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
    // An EMPTY list is a real frozen state ("no target this week"), not absence (qodo #9 on #452).
    expect(frozenTiebreakTargetFor({ frozenTiebreakTargets: { 3: [] } }, 3)).toEqual([]);
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
  it('D3 — the rules page cannot promise a tiebreaker the pick sheet never asks for', () => {
    // THE EXACT CONTRADICTION THAT SHIPPED, pinned as behaviour rather than as
    // a string match on either surface.
    //
    //   NFLPoolRules.tsx promises a tiebreaker whenever the rule is not NONE
    //   — i.e. whenever `tiebreakerAsksForPrediction` is true.
    //   PickemPickEntry.tsx renders the input only when the resolved target
    //   list is non-empty (`showTiebreaker`).
    //
    // If those two predicates can ever disagree on a real schedule, a member is
    // told a number decides tied weeks and is never asked for one. Under
    // MNF_COMBINED on a Monday-less week they disagreed, and that is the bug.
    const mondayLess = [
      { id: 'fri1', startTime: 100, isMonday: false },
      { id: 'fri2', startTime: 200, isMonday: false },
      { id: 'sat1', startTime: 300, isMonday: false },
      { id: 'sat2', startTime: 400, isMonday: false }, // the observed preseason slate
    ];
    const mondayFul = [{ id: 'sun', startTime: 100, isMonday: false }, { id: 'mon', startTime: 500, isMonday: true }];
    for (const schedule of [mondayLess, mondayFul]) {
      for (const rule of WEEKLY_TIEBREAKER_VALUES) {
        const target = resolveTiebreakTargetIds(schedule, rule);
        // The rules page promises ⇒ the sheet asks. No exceptions on a real slate.
        expect(tiebreakerAskedButUnavailable(rule, target)).toBe(false);
      }
    }
    // ...and where they genuinely CANNOT agree — a week frozen empty before the
    // fallback existed — the sheet must say so rather than fall silent. That is
    // the one case the D2 card exists for.
    expect(tiebreakerAskedButUnavailable('MNF_COMBINED', weekTiebreakTargetIds({ frozenTiebreakTargets: { 2: [] } }, 2, mondayLess, 'MNF_COMBINED'))).toBe(true);
    // NONE never triggers the card: that pool's rules page promises nothing.
    expect(tiebreakerAskedButUnavailable('NONE', [])).toBe(false);
  });

  it('D2 — the pick sheet renders the "no tiebreaker this week" card off that predicate', () => {
    const src = read('src/components/NFLPoolDashboard/PickemPickEntry.tsx');
    expect(src).toContain('tiebreakerAskedButUnavailable(tiebreakerRule, tiebreakTargetIds)');
    expect(src).toContain('tiebreakerUnavailable && (');
    expect(src).toContain('No tiebreaker this week');
  });

  it('the rules page states the Monday-less fallback for EVERY asking rule — it used to branch MNF_COMBINED away from it', () => {
    // The surface that lied. Its tie sub-line had a third branch whose only
    // difference was the missing fallback sentence, and that branch is the one
    // an unset `settings.weeklyTiebreaker` renders.
    const src = read('src/components/NFLPoolDashboard/NFLPoolRules.tsx');
    const fallback = 'On a week with no Monday game, the final game of the week is the target.';
    expect(src).toContain(fallback);
    // Exactly ONE copy of the sentence — a re-added COMBINED branch would need
    // a second, and this catches it.
    expect(src.split(fallback).length - 1).toBe(1);
    // ...and no MNF_COMBINED branch left in the tie-copy paragraph.
    expect(src).not.toContain("tiebreakerRule === 'MNF_COMBINED'");
    // 🛑 AND IT DEFERS THE PER-WEEK ANSWER TO THE SHEET (codex r2 P2). This
    // page gets no `week` and no schedule, so it cannot know that a week froze
    // an EMPTY target before the fallback existed — a week whose sheet shows
    // "No tiebreaker this week". Stating the fallback flatly would contradict
    // that sheet for one live week, which is this plan's own defect returning.
    expect(src).toContain('Your pick sheet names the game each week, and tells you when a week has none');
  });

  it('the sheet, the submit path and the scorer all read the ONE resolver + the frozen map', () => {
    // D1: the sheet no longer hand-rolls `frozen ?? resolved` — it asks the
    // shared wrapper, which is where the empty-list case is decided once.
    expect(read('src/components/NFLPoolDashboard/PickemPickEntry.tsx')).toContain('weekTiebreakTargetIds(castPool');
    expect(read('src/components/NFLPoolDashboard/PickemPickEntry.tsx')).toContain('displayedTiebreakTargetIds: showTiebreaker ? tiebreakTargetIds : undefined');
    const fn = read('functions/src/nflPools.ts');
    expect(fn).toContain('resolveTiebreakTargetIds(games, tiebreakRule)');
    expect(fn).toContain('TIEBREAK_TARGET_STALE');
    expect(fn).toContain('frozenTiebreakTargets.' + '${week}');
    expect(read('functions/src/schemas/poolCore.ts')).toContain('displayedTiebreakTargetIds');
    expect(read('firestore.rules')).toContain("'frozenTiebreakTargets'");
  });
});
