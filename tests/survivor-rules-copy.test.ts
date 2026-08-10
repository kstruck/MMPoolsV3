import { describe, it, expect } from 'vitest';
import {
  survivorModeRulesCopy,
  tieOutcomeRuleCopy,
  teamReuseRuleCopy,
  survivorRuleCopy,
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
