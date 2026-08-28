import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  survivorModeRulesCopy,
  tieOutcomeRuleCopy,
  teamReuseRuleCopy,
  survivorRuleCopy,
  autoSurviveExemptionOn,
  autoSurviveRuleCopy,
  survivorRebuyRuleCopy,
  survivorRebuyJoinCopy,
} from '../src/utils/survivorRules';
import { survivorCreateInputSchema } from '@shared/schemas';
import { MAX_TEAM_USES, TIE_COUNTS_AS_VALUES, effectiveTieCountsAs } from '@shared/survivorReuse';

/**
 * PLAN-SURVIVOR-PARITY-SCORING — the member-facing rules copy.
 *
 * This exists because the copy was WRONG in production, in two places, and
 * nothing caught it: `SurvivorPickEntry` told members "If they win or tie, you
 * survive" in BOTH modes while `evaluateSurvivorWeek` has always struck a tie,
 * and `NFLPoolRules` stated flatly that a team can never be selected twice.
 *
 * So these assert the SUBSTANCE, not the wording: whether the copy says a tie
 * survives or strikes, and what limit it states. Rewording is free; reversing
 * the meaning is not.
 */
const survives = (copy: string) => /you survive that too|a tie counts as a win, so you survive/i.test(copy);
const strikes = (copy: string) => /tie is a strike|so it is a strike/i.test(copy);

describe('survivorModeRulesCopy — all four tieCountsAs × pickLosersMode cells', () => {
  it('DEFAULT (LOSS) + standard: pick a winner, a tie strikes', () => {
    const copy = survivorModeRulesCopy(false, 'LOSS');
    expect(copy).toMatch(/WIN their game/);
    expect(strikes(copy)).toBe(true);
    expect(survives(copy)).toBe(false);
  });

  it('DEFAULT (LOSS) + pick-losers: pick a loser, a tie STILL strikes', () => {
    // The half the old copy got wrong in the direction that costs a member
    // their season: it promised survival.
    const copy = survivorModeRulesCopy(true, 'LOSS');
    expect(copy).toMatch(/LOSE their game/);
    expect(strikes(copy)).toBe(true);
    expect(survives(copy)).toBe(false);
  });

  it('WIN + standard: the tie survives', () => {
    const copy = survivorModeRulesCopy(false, 'WIN');
    expect(copy).toMatch(/WIN their game/);
    expect(survives(copy)).toBe(true);
  });

  it('WIN + pick-losers: the tie strikes, because the picked team "won"', () => {
    const copy = survivorModeRulesCopy(true, 'WIN');
    expect(copy).toMatch(/LOSE their game/);
    expect(strikes(copy)).toBe(true);
    expect(survives(copy)).toBe(false);
  });
});

describe('tieOutcomeRuleCopy — the rules-page line', () => {
  it('states a strike at the default, in both modes', () => {
    expect(tieOutcomeRuleCopy(false, 'LOSS')).toMatch(/strike/i);
    expect(tieOutcomeRuleCopy(true, 'LOSS')).toMatch(/strike/i);
  });

  it('states survival only for WIN + standard', () => {
    expect(tieOutcomeRuleCopy(false, 'WIN')).toMatch(/you survive/i);
    expect(tieOutcomeRuleCopy(true, 'WIN')).toMatch(/strike/i);
  });
});

describe('teamReuseRuleCopy — the line that was unconditionally wrong', () => {
  it('keeps today wording at the default limit', () => {
    expect(teamReuseRuleCopy(1)).toBe('You cannot select the same team twice in a season.');
  });

  it('states the actual limit, and does NOT claim a team can never repeat', () => {
    expect(teamReuseRuleCopy(2)).toMatch(/up to 2 times/);
    expect(teamReuseRuleCopy(2)).not.toMatch(/cannot select the same team twice/);
  });

  it('describes unlimited as unlimited', () => {
    expect(teamReuseRuleCopy(0)).toMatch(/as many times as you like/i);
    expect(teamReuseRuleCopy(0)).not.toMatch(/cannot/i);
  });
});

describe('survivorRuleCopy — settings blob in, three lines out', () => {
  it('an untouched legacy pool reads exactly as today', () => {
    const copy = survivorRuleCopy(undefined);
    expect(copy.reuse).toBe('You cannot select the same team twice in a season.');
    expect(copy.tie).toMatch(/strike/i);
    expect(copy).toEqual(survivorRuleCopy({}));
  });

  it('reflects a configured pool', () => {
    const copy = survivorRuleCopy({ tieCountsAs: 'WIN', maxTeamUses: 3, pickLosersMode: false });
    expect(copy.tie).toMatch(/you survive/i);
    expect(copy.reuse).toMatch(/up to 3 times/);
  });
});

describe('MAX_TEAM_USES — create and update must agree on the bound', () => {
  // codex round 2: the create schema had no upper bound while the update
  // validator capped at 23, so a pool created with 24 could never save its
  // settings again — the manager UI resends the whole settings object,
  // persisted value included. One constant now; this pins that they share it.
  it('the create schema rejects exactly what the update validator rejects', () => {
    const settings = (maxTeamUses: number) => ({
      entryFee: 0, isListedPublic: true,
      maxStrikes: 1, maxRebuys: 0, rebuyDeadlineWeek: 4, rebuyCost: 0,
      maxTeamUses,
      payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
    });
    const create = (n: number) => survivorCreateInputSchema.safeParse({
      type: 'NFL_SURVIVOR', name: 'P', season: '2026', settings: settings(n),
    }).success;

    expect(create(MAX_TEAM_USES)).toBe(true);
    expect(create(MAX_TEAM_USES + 1)).toBe(false);
    expect(create(0)).toBe(true);
    expect(create(-1)).toBe(false);
  });
});

describe('tieCountsAs — the schema and the type share one value set', () => {
  // qodo, PR #399: the create schema hand-copied ['WIN','LOSS'] instead of
  // consuming the constant the engine reads, so adding a third outcome would
  // have left the schema silently rejecting it. Derived now; this pins that.
  it('the schema accepts exactly the declared values and nothing else', () => {
    const parse = (tieCountsAs: unknown) => survivorCreateInputSchema.safeParse({
      type: 'NFL_SURVIVOR', name: 'P', season: '2026',
      settings: {
        entryFee: 0, isListedPublic: true,
        maxStrikes: 1, maxRebuys: 0, rebuyDeadlineWeek: 4, rebuyCost: 0,
        tieCountsAs,
        payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
      },
    }).success;

    for (const value of TIE_COUNTS_AS_VALUES) expect(parse(value), value).toBe(true);
    expect(parse('PUSH')).toBe(false);
  });

  it('the effective-value reader agrees with the same set', () => {
    for (const value of TIE_COUNTS_AS_VALUES) {
      expect(effectiveTieCountsAs({ tieCountsAs: value })).toBe(value);
    }
  });
});

/**
 * THE PANEL AND THE SCORER MUST AGREE ON AN ABSENT `autoSurviveExemptionEnabled`.
 *
 * `NFLPoolRules.tsx` rendered the absent value as "Disabled" while
 * `nflScoringEngine.ts:704` reads `?? true`, so every survivor pool created
 * before the field existed showed its members the OPPOSITE of the rule the
 * scorer was applying. The wizard writes `true`
 * (`CreateNFLSurvivorPool.tsx:73`), which is what makes `?? true` the intended
 * half and the panel the wrong one.
 *
 * These assert the SUBSTANCE — on vs off — not the wording.
 */
describe('autoSurviveExemptionOn — absent means ON, same as the scorer', () => {
  const on = (copy: string) => /^Enabled\b/.test(copy);

  it('an absent value is ON', () => {
    expect(autoSurviveExemptionOn(undefined)).toBe(true);
    expect(autoSurviveExemptionOn({})).toBe(true);
    expect(on(autoSurviveRuleCopy({}))).toBe(true);
  });

  it('an explicit false is OFF, so the setting still does something', () => {
    expect(autoSurviveExemptionOn({ autoSurviveExemptionEnabled: false })).toBe(false);
    expect(autoSurviveRuleCopy({ autoSurviveExemptionEnabled: false })).toBe('Disabled');
  });

  it('an explicit true is ON', () => {
    expect(autoSurviveExemptionOn({ autoSurviveExemptionEnabled: true })).toBe(true);
    expect(on(autoSurviveRuleCopy({ autoSurviveExemptionEnabled: true }))).toBe(true);
  });

  it('the scorer really does read it as `?? true` — the claim above, measured', () => {
    // If the scorer's default ever flips, "absent means ON" stops being the
    // truth this helper is copying and this test is where that surfaces.
    const engine = readFileSync(
      resolve(__dirname, '..', 'functions/src/nflScoringEngine.ts'),
      'utf8',
    );
    expect(engine).toContain('pool.settings.autoSurviveExemptionEnabled ?? true');
  });

  it('survivorRuleCopy carries it, so the panel cannot read the raw field again', () => {
    expect(on(survivorRuleCopy({}).autoSurvive)).toBe(true);
    expect(survivorRuleCopy({ autoSurviveExemptionEnabled: false }).autoSurvive).toBe('Disabled');
  });
});

/**
 * THE BUY-BACK WINDOW IS INCLUSIVE OF THE CUTOFF WEEK.
 *
 * `executeSurvivorRebuyInternal` (`functions/src/nflPools.ts:1074`) refuses only
 * `week > settings.rebuyDeadlineWeek`. The rules page said "before <week>",
 * which refuses one week earlier than the callable does — shipped copy narrower
 * than the rule members are actually playing.
 *
 * The predicate is asserted against the SERVER'S OWN comparison, so the copy
 * cannot drift away from it without this going red.
 */
describe('survivorRebuyRuleCopy / survivorRebuyJoinCopy — "through", never "before"', () => {
  const label = (w: number) => `Week ${w}`;
  const settings = (over: Record<string, unknown> = {}) => ({
    maxRebuys: 2, rebuyDeadlineWeek: 4, rebuyCost: 20, ...over,
  });

  it('the server admits the cutoff week itself', () => {
    const rebuy = readFileSync(resolve(__dirname, '..', 'functions/src/nflPools.ts'), 'utf8');
    expect(rebuy).toContain('if (week > settings.rebuyDeadlineWeek) {');
    const refuses = (week: number, deadline: number) => week > deadline;
    expect(refuses(4, 4)).toBe(false); // the cutoff week is INSIDE the window
    expect(refuses(5, 4)).toBe(true);
  });

  it('the rules-page line says through the cutoff week, and never "before"', () => {
    const copy = survivorRebuyRuleCopy(settings(), label);
    expect(copy).toContain('through Week 4');
    expect(copy).not.toMatch(/\bbefore\b/);
    expect(copy).toContain('2 rebuys');
    expect(copy).toContain('$20');
  });

  it('the join-page line says the same thing', () => {
    const copy = survivorRebuyJoinCopy(settings(), label);
    expect(copy).toContain('through Week 4');
    expect(copy).not.toMatch(/\bbefore\b/);
    expect(copy).toContain('2 rebuys');
  });

  it('no buy-backs allowed reads as off on both surfaces', () => {
    expect(survivorRebuyRuleCopy(settings({ maxRebuys: 0 }), label)).toBe('Disabled in this pool.');
    expect(survivorRebuyJoinCopy(settings({ maxRebuys: 0 }), label)).toBe('No rebuys/buy-backs allowed');
  });

  it('a cutoff below week 1 is stated as unusable, not as an open window', () => {
    // The create wizard's floor is 0 (`CreateNFLSurvivorPool.tsx:38`), and
    // `week > 0` is true of every real week — so a pool set there offers
    // buy-backs nobody can take. Both surfaces used to name a moment
    // ("the season starts" / "season start") that reads like an open window.
    //
    // `null` and `''` are in the list because the SERVER coerces them to 0 the
    // same way: `w > null` applies ToNumber to both sides. The helper must land
    // on the same side of the line the callable does.
    for (const deadline of [0, -3, null, '']) {
      const rules = survivorRebuyRuleCopy(settings({ rebuyDeadlineWeek: deadline }), label);
      const join = survivorRebuyJoinCopy(settings({ rebuyDeadlineWeek: deadline }), label);
      expect(rules, String(deadline)).toMatch(/none can actually be taken/);
      expect(join, String(deadline)).toMatch(/none can be taken/);
      expect(rules, String(deadline)).not.toMatch(/season starts/);
      expect(join, String(deadline)).not.toMatch(/season start/);
      expect(rules, String(deadline)).not.toContain('NaN');
      expect(join, String(deadline)).not.toContain('NaN');
      // The claim, measured against the server's own comparison: week 1 — the
      // earliest a buy-back can be asked for — is already past this deadline.
      expect(1 > (deadline as number), String(deadline)).toBe(true);
    }
  });

  /**
   * AN ABSENT CUTOFF IS THE OPPOSITE OF ZERO (codex round 1, P2).
   *
   * `rebuyDeadlineWeek` is `.optional()` in the create schema, and
   * `week > undefined` is `false` for every week — so a pool with nothing
   * stored has NO cutoff and buy-backs run all season. Telling those members
   * "none can be taken" would be the same defect this PR fixes, pointed the
   * other way.
   */
  it('an absent cutoff reads as no cutoff, because the callable never refuses one', () => {
    for (const deadline of [undefined, Number.NaN, 'not-a-week']) {
      const rules = survivorRebuyRuleCopy(settings({ rebuyDeadlineWeek: deadline }), label);
      const join = survivorRebuyJoinCopy(settings({ rebuyDeadlineWeek: deadline }), label);
      expect(rules, String(deadline)).toContain('no cutoff week set');
      expect(join, String(deadline)).toContain('no cutoff week set');
      expect(rules, String(deadline)).not.toMatch(/none can actually be taken/);
      expect(join, String(deadline)).not.toMatch(/none can be taken/);
      expect(rules, String(deadline)).not.toContain('NaN');
      expect(join, String(deadline)).not.toContain('NaN');
      // The server really does let every week through against this value.
      expect([1, 9, 18].some((w) => w > (deadline as number)), String(deadline)).toBe(false);
    }
  });

  /**
   * THE PRICE MUST BE THE PRICE THE CALLABLE CHARGES (codex round 1, P1).
   *
   * `rebuyCost` is `.optional()`, and `executeSurvivorRebuyInternal` charges
   * `settings.rebuyCost ?? settings.entryFee ?? 0`
   * (`functions/src/nflPools.ts:1079`). Copy reading `rebuyCost` alone would
   * tell a member with a legacy pool that a charged buy-back is free.
   */
  it('the price falls back to the entry fee, exactly as the callable does', () => {
    const rebuy = readFileSync(resolve(__dirname, '..', 'functions/src/nflPools.ts'), 'utf8');
    expect(rebuy).toContain('settings.rebuyCost ?? settings.entryFee ?? 0');

    // No rebuyCost stored: the entry fee is what gets charged, so it is what
    // gets shown.
    expect(survivorRebuyRuleCopy(
      { maxRebuys: 2, rebuyDeadlineWeek: 4, entryFee: 25 }, label,
    )).toContain('$25');
    // An explicit 0 is a free buy-back and must NOT fall through to the fee.
    expect(survivorRebuyRuleCopy(
      { maxRebuys: 2, rebuyDeadlineWeek: 4, rebuyCost: 0, entryFee: 25 }, label,
    )).toContain('$0');
    // A stored cost wins over the fee.
    expect(survivorRebuyRuleCopy(
      { maxRebuys: 2, rebuyDeadlineWeek: 4, rebuyCost: 15, entryFee: 25 }, label,
    )).toContain('$15');
    // Neither stored: zero, never "$undefined" or "$NaN".
    const bare = survivorRebuyRuleCopy({ maxRebuys: 2, rebuyDeadlineWeek: 4 }, label);
    expect(bare).toContain('$0');
    expect(bare).not.toContain('undefined');
    expect(bare).not.toContain('NaN');
  });

  it('the week label is asked for exactly once, with the cutoff week', () => {
    const seen: number[] = [];
    survivorRebuyRuleCopy(settings({ rebuyDeadlineWeek: 7 }), (w) => { seen.push(w); return `Week ${w}`; });
    expect(seen).toEqual([7]);
  });
});
