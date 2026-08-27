import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { POOL_TYPES } from '../shared/poolTypes';
import type { PoolType } from '../shared/poolTypes';
import { helpRegistry, resolveCopy, staticCopy } from '../src/help/registry';
import {
  MANAGER_LABEL_ALLOWLIST,
  SCHEMA_PATH_ALLOWLIST,
  WIZARD_FIELD_ALLOWLIST,
} from '../src/help/coverage-allowlist';
import { NFL_SURVIVOR_PLACEMENTS, NFL_SURVIVOR_TOPICS } from '../src/help/content/nfl-survivor';
import { BANNED_IMPLEMENTATION_WORDS, BANNED_SELLING_WORDS, COPY_LIMITS, findBannedWords } from '../src/help/voice';
import {
  survivorModeRulesCopy,
  teamReuseRuleCopy,
  tieOutcomeRuleCopy,
} from '../src/utils/survivorRules';
import {
  DEFAULT_MAX_TEAM_USES,
  DEFAULT_TIE_COUNTS_AS,
  MAX_TEAM_USES,
  UNLIMITED_TEAM_USES,
} from '../shared/survivorReuse';
import type { TieCountsAs } from '../shared/survivorReuse';
import {
  checkAutoSurviveExemption,
  computeSurvivorWeekUpdate,
  updateSurvivorStatus,
} from '../functions/src/nflScoringEngine';
import {
  SURVIVOR_PARITY_SETTINGS_KEYS,
  survivorParitySettingsRefusal,
} from '../functions/src/lib/survivorSettingsGate';
import type { NFLGame, NFLSurvivorPool, SurvivorEntry } from '../functions/src/nflPoolTypes';

/**
 * T10 content guard — PLAN-HELP-SYSTEM.md §7.
 *
 * The generic registry guards prove the content is well-formed. This file
 * proves the three things specific to T10 that nothing else can see:
 *
 *  1. **THE ONE-DEFINITION GUARANTEE, MECHANICAL.** `settings.pickLosersMode`,
 *     `settings.tieCountsAs` and `settings.maxTeamUses` already had shipped
 *     member-facing copy in `src/utils/survivorRules.ts`, read by
 *     `SurvivorPickEntry` and `NFLPoolRules`. Voice rule 10 allows exactly one
 *     copy of a sentence explaining a setting, and `help/types.ts` names the
 *     resolution: the helper BECOMES the topic's `template`. So the test does
 *     not look for words in the source — it renders each topic against a
 *     settings blob and asserts the result is byte-for-byte what the live
 *     helper returns for that same blob. Fork the wording and this goes red;
 *     change the helper and the topic follows it with no edit here.
 *
 *  2. **Survivor copy does not leak to Pick'em or Margin.** `pool.nfl.*` is ONE
 *     set of Help pages shared by all three season formats, and scope is the
 *     only thing keeping them apart.
 *
 *  3. **Every default it names is the default the code actually has.** Voice
 *     rule 5 is the rule this effort keeps breaking, and every break so far was
 *     a sentence written from memory. `shared/schemas/nfl.ts` declares no
 *     defaults for these eight fields, so the wizard source and the shared
 *     constants are read here and the copy is held to them.
 *
 * Each check is paired with a planted counter-example, so a guard that stopped
 * discriminating fails here rather than going quietly green.
 */

const SURVIVOR: PoolType = 'NFL_SURVIVOR';
const MEMBER = { poolType: SURVIVOR, audience: 'member' } as const;
const HOST = { poolType: SURVIVOR, audience: 'commissioner' } as const;

/** The eight schema paths this ticket owns, in allowlist order. */
const T10_PATHS = [
  'settings.maxStrikes',
  'settings.maxRebuys',
  'settings.rebuyDeadlineWeek',
  'settings.rebuyCost',
  'settings.tieCountsAs',
  'settings.maxTeamUses',
  'settings.pickLosersMode',
  'settings.autoSurviveExemptionEnabled',
] as const;

/** The six manager-form labels this ticket closes. */
const T10_LABELS = [
  'Strikes Limit',
  'Max Rebuys',
  'Rebuy Cutoff Week',
  'Rebuy Fee ($)',
  'Tie Outcome',
  'Team-Use Limit',
] as const;

/** The three whose copy is `utils/survivorRules.ts` and must stay so. */
const HELPER_BACKED = ['settings.pickLosersMode', 'settings.tieCountsAs', 'settings.maxTeamUses'] as const;

const root = resolve(__dirname, '..');
const WIZARD_SRC = readFileSync(resolve(root, 'src/components/wizard/create/CreateNFLSurvivorPool.tsx'), 'utf8');
const MANAGER_SRC = readFileSync(resolve(root, 'src/components/NFLPoolDashboard/NFLManagerView.tsx'), 'utf8');

/**
 * A default value out of the create wizard's `defaultValues.settings`.
 *
 * Read from the source rather than typed in, so a wizard default that moves
 * fails this file instead of leaving the copy quietly wrong. `defaultValues` is
 * a module-level object literal, not exported, and importing the module would
 * pull React and the whole wizard shell into a content test for one number.
 */
function wizardDefault(key: string): string {
  const m = new RegExp(`\\b${key}:\\s*('[^']*'|[A-Za-z0-9.]+)`).exec(WIZARD_SRC);
  if (!m) throw new Error(`no wizard default found for ${key}`);
  return m[1].replace(/'/g, '');
}

const shortFor = (id: string, settings?: Record<string, unknown>) =>
  resolveCopy(helpRegistry.getTopic(id)!.short, settings ? { settings } : {});
const longFor = (id: string, settings?: Record<string, unknown>) =>
  resolveCopy(helpRegistry.getTopic(id)!.long, settings ? { settings } : {});

/** Topic ids visible on a page to a reader in `poolType` with `audience`. */
function visibleOn(pageId: string, poolType: PoolType, audience: 'member' | 'commissioner'): string[] {
  return helpRegistry
    .placementsForPage(pageId, { poolType, audience })
    .flatMap((s) => s.topics)
    .map((t) => t.id);
}

/** Every `<FieldLabel …>text</FieldLabel>` in the manager source. */
function fieldLabels(code: string): { helpId?: string; text: string }[] {
  const out: { helpId?: string; text: string }[] = [];
  const re = /<FieldLabel\b([^>]*)>([\s\S]*?)<\/FieldLabel>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    out.push({ helpId: /helpId="([^"]+)"/.exec(m[1])?.[1], text: m[2].trim() });
  }
  return out;
}

// ---------------------------------------------------------------------------

describe('T10 — the eight survivor settings are explained', () => {
  it.each([...T10_PATHS])('%s resolves to a topic for a Survivor reader', (path) => {
    // BOTH audiences: the wizard and the manager form resolve as a
    // commissioner, the rules page as a member, and `resolveTopic` is the only
    // filter either surface has.
    expect(helpRegistry.resolveTopic(MEMBER, path)?.id).toBe(path);
    expect(helpRegistry.resolveTopic(HOST, path)?.id).toBe(path);
  });

  it('authors exactly those eight and nothing else', () => {
    expect(NFL_SURVIVOR_TOPICS.map((t) => t.id).sort()).toEqual([...T10_PATHS].sort());
  });

  it('every one of them is scoped to NFL_SURVIVOR alone', () => {
    const wrong = NFL_SURVIVOR_TOPICS.filter(
      (t) => t.poolTypes === 'all' || t.poolTypes.length !== 1 || t.poolTypes[0] !== SURVIVOR,
    ).map((t) => t.id);
    expect(wrong).toEqual([]);
  });

  it('so a Pick’em or Margin reader is shown none of it, on any shared page', () => {
    const survivorIds = new Set(NFL_SURVIVOR_TOPICS.map((t) => t.id));
    const nflPages = helpRegistry.pages
      .filter((p) => p.id === 'pool.nfl' || p.id.startsWith('pool.nfl.'))
      .map((p) => p.id);
    expect(nflPages.length).toBeGreaterThan(10);
    const leaked = nflPages.flatMap((page) =>
      (['NFL_PICKEM', 'NFL_MARGIN'] as const).flatMap((type) =>
        (['member', 'commissioner'] as const).flatMap((aud) =>
          visibleOn(page, type, aud)
            .filter((id) => survivorIds.has(id))
            .map((id) => `${type}/${aud} sees ${id} on ${page}`),
        ),
      ),
    );
    expect(leaked).toEqual([]);
  });

  it('nor a reader of any of the other four pool types', () => {
    const survivorIds = new Set(NFL_SURVIVOR_TOPICS.map((t) => t.id));
    const others = POOL_TYPES.filter((t) => t !== SURVIVOR);
    const leaked = others.flatMap((type) =>
      [...survivorIds]
        .filter((id) => helpRegistry.resolveTopic({ poolType: type, audience: 'commissioner' }, id))
        .map((id) => `${type} resolves ${id}`),
    );
    expect(leaked).toEqual([]);
  });

  it('a Survivor reader DOES see them — the checks above are not passing by emptiness', () => {
    expect(visibleOn('pool.nfl.rules', SURVIVOR, 'member')).toEqual(
      expect.arrayContaining([...T10_PATHS]),
    );
    expect(visibleOn('wizard.survivor.rules', SURVIVOR, 'commissioner')).toEqual(
      expect.arrayContaining([...T10_PATHS]),
    );
    expect(visibleOn('pool.nfl.picks', SURVIVOR, 'member')).toEqual(
      expect.arrayContaining([...HELPER_BACKED]),
    );
  });

  it('every T10 placement names a page that exists', () => {
    const pageIds = new Set(helpRegistry.pages.map((p) => p.id));
    expect(NFL_SURVIVOR_PLACEMENTS.filter((p) => !pageIds.has(p.page)).map((p) => p.page)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('T10 — the 22 allowlist rows it closed are closed', () => {
  it('the eight schema rows are gone', () => {
    expect(T10_PATHS.filter((p) => p in SCHEMA_PATH_ALLOWLIST)).toEqual([]);
  });

  it('the eight wizard-field rows are gone', () => {
    expect(T10_PATHS.filter((p) => p in WIZARD_FIELD_ALLOWLIST)).toEqual([]);
  });

  it('the six manager-label rows are gone, and each label carries a resolving helpId', () => {
    expect(T10_LABELS.filter((l) => l in MANAGER_LABEL_ALLOWLIST)).toEqual([]);

    const byText = new Map(fieldLabels(MANAGER_SRC).map((l) => [l.text, l.helpId]));
    const unwired = T10_LABELS.filter((text) => {
      const id = byText.get(text);
      return !id || !helpRegistry.resolveTopic(HOST, id);
    });
    expect(unwired).toEqual([]);
  });

  it('the six labels are wired to the topic that explains that control, not to any topic', () => {
    // A helpId that merely RESOLVES would pass the check above while pointing
    // at the wrong setting — a tooltip about strikes beside the rebuy fee.
    const byText = new Map(fieldLabels(MANAGER_SRC).map((l) => [l.text, l.helpId]));
    expect(byText.get('Strikes Limit')).toBe('settings.maxStrikes');
    expect(byText.get('Max Rebuys')).toBe('settings.maxRebuys');
    expect(byText.get('Rebuy Cutoff Week')).toBe('settings.rebuyDeadlineWeek');
    expect(byText.get('Rebuy Fee ($)')).toBe('settings.rebuyCost');
    expect(byText.get('Tie Outcome')).toBe('settings.tieCountsAs');
    expect(byText.get('Team-Use Limit')).toBe('settings.maxTeamUses');
  });
});

// ---------------------------------------------------------------------------

/**
 * THE HEART OF THIS TICKET.
 *
 * Not "the source mentions the helper" — that is a text match and this repo has
 * shipped three guards that looked like guards and were not. What is asserted
 * is the RENDERED STRING, against the same helper the live components call,
 * over every branch each helper has. A second wording anywhere in the topic
 * fails these, and a change to the helper's wording passes them without a
 * single edit to this file, which is what "one definition" means.
 */
describe('T10 — the three helper-backed topics ARE the helper', () => {
  const MODES: readonly { pickLosersMode: boolean; tieCountsAs: TieCountsAs }[] = [
    { pickLosersMode: false, tieCountsAs: 'LOSS' },
    { pickLosersMode: false, tieCountsAs: 'WIN' },
    { pickLosersMode: true, tieCountsAs: 'LOSS' },
    { pickLosersMode: true, tieCountsAs: 'WIN' },
  ];

  it.each([...HELPER_BACKED])('%s is a template on both short and long', (id) => {
    const topic = helpRegistry.getTopic(id)!;
    expect(typeof topic.short).not.toBe('string');
    expect(typeof topic.long).not.toBe('string');
  });

  it.each([...MODES])(
    'settings.pickLosersMode renders survivorModeRulesCopy exactly (%o)',
    (settings) => {
      const expected = survivorModeRulesCopy(settings.pickLosersMode, settings.tieCountsAs);
      expect(shortFor('settings.pickLosersMode', { ...settings })).toBe(expected);
      // The long copy OPENS with the same sentence and then adds what the
      // helper never had — when to change it, and what members see.
      expect(longFor('settings.pickLosersMode', { ...settings }).startsWith(expected)).toBe(true);
    },
  );

  it.each([...MODES])('settings.tieCountsAs renders tieOutcomeRuleCopy exactly (%o)', (settings) => {
    const expected = tieOutcomeRuleCopy(settings.pickLosersMode, settings.tieCountsAs);
    expect(shortFor('settings.tieCountsAs', { ...settings })).toBe(expected);
    expect(longFor('settings.tieCountsAs', { ...settings }).startsWith(expected)).toBe(true);
  });

  it.each([0, 1, 2, 23])('settings.maxTeamUses renders teamReuseRuleCopy exactly (%i)', (maxTeamUses) => {
    const expected = teamReuseRuleCopy(maxTeamUses);
    expect(shortFor('settings.maxTeamUses', { maxTeamUses })).toBe(expected);
    expect(longFor('settings.maxTeamUses', { maxTeamUses }).startsWith(expected)).toBe(true);
  });

  /**
   * An absent or unrecognised value must render the pool's EFFECTIVE rule, not
   * a blank. `effectiveTieCountsAs` and `effectiveMaxTeamUses` resolve junk to
   * the default on purpose (an Admin-SDK write must not flip semantics), and
   * the copy has to follow them there or it describes a rule the scorer is not
   * playing.
   */
  it('follows the effective-value fallbacks for an absent or junk setting', () => {
    expect(shortFor('settings.tieCountsAs', {})).toBe(tieOutcomeRuleCopy(false, DEFAULT_TIE_COUNTS_AS));
    expect(shortFor('settings.tieCountsAs', { tieCountsAs: 'win' })).toBe(
      tieOutcomeRuleCopy(false, DEFAULT_TIE_COUNTS_AS),
    );
    expect(shortFor('settings.maxTeamUses', {})).toBe(teamReuseRuleCopy(DEFAULT_MAX_TEAM_USES));
    expect(shortFor('settings.maxTeamUses', { maxTeamUses: -1 })).toBe(
      teamReuseRuleCopy(DEFAULT_MAX_TEAM_USES),
    );
    expect(shortFor('settings.pickLosersMode', {})).toBe(
      survivorModeRulesCopy(false, DEFAULT_TIE_COUNTS_AS),
    );
  });

  /**
   * The STATIC FALLBACK is what the create wizard shows, where no pool exists.
   * It carries the helper's sentence at the wizard's own starting values, so
   * even the branch written for "no pool in scope" is not a second copy of a
   * rule sentence.
   */
  it('the fallbacks are built from the same helpers, at the wizard defaults', () => {
    const modeTopic = helpRegistry.getTopic('settings.pickLosersMode')!;
    const tieTopic = helpRegistry.getTopic('settings.tieCountsAs')!;
    const reuseTopic = helpRegistry.getTopic('settings.maxTeamUses')!;

    expect(staticCopy(modeTopic.long)).toContain(survivorModeRulesCopy(false, DEFAULT_TIE_COUNTS_AS));
    expect(staticCopy(tieTopic.long)).toContain(tieOutcomeRuleCopy(false, DEFAULT_TIE_COUNTS_AS));
    expect(staticCopy(reuseTopic.long)).toContain(teamReuseRuleCopy(DEFAULT_MAX_TEAM_USES));

    // And the wizard really is what those values describe.
    expect(wizardDefault('pickLosersMode')).toBe('false');
    expect(wizardDefault('tieCountsAs')).toBe(DEFAULT_TIE_COUNTS_AS);
    expect(Number(wizardDefault('maxTeamUses'))).toBe(DEFAULT_MAX_TEAM_USES);
  });

  it('every branch is distinct — a template collapsing to one string would pass everything else', () => {
    expect(new Set(MODES.map((s) => shortFor('settings.pickLosersMode', { ...s }))).size).toBe(4);
    // `tieOutcomeRuleCopy` has THREE outcomes, not four: both LOSS arms return
    // the same sentence because a tie is a strike either way at the default.
    expect(new Set(MODES.map((s) => shortFor('settings.tieCountsAs', { ...s }))).size).toBe(3);
    expect(new Set([0, 1, 2, 23].map((n) => shortFor('settings.maxTeamUses', { maxTeamUses: n }))).size).toBe(4);
  });

  /**
   * THE COUNTER-EXAMPLE. The assertions above compare against the live helper,
   * so a forked wording — the shape voice rule 10 forbids and the shape this
   * ticket was most likely to produce — is what they catch.
   */
  it('a forked wording WOULD be caught', () => {
    const forked = 'A tie is a strike.'; // plausible, shorter, and NOT the shipped sentence
    expect(forked).not.toBe(tieOutcomeRuleCopy(false, 'LOSS'));
    expect(shortFor('settings.tieCountsAs', { tieCountsAs: 'LOSS' })).not.toBe(forked);
  });
});

// ---------------------------------------------------------------------------

/**
 * Voice rule 5, held to the code rather than to memory.
 *
 * `shared/schemas/nfl.ts` gives these eight fields NO defaults — `maxStrikes`
 * and `maxRebuys` are required and the rest are `.optional()` — so the default
 * a reader meets is the create wizard's, plus the read-site constant for the
 * three that have one. Both are read here.
 */
describe('T10 — every default the copy names is the default the code has', () => {
  it('the wizard reader itself is live', () => {
    // Without this, a regex that stopped matching would make every assertion
    // below throw rather than silently pass — but a typo'd KEY would simply
    // read the wrong number, so the shape is pinned once here.
    expect(() => wizardDefault('nosuchsetting')).toThrow();
    expect(Number(wizardDefault('maxStrikes'))).toBe(1);
  });

  it('one strike is the default, and the copy says so', () => {
    expect(Number(wizardDefault('maxStrikes'))).toBe(1);
    expect(shortFor('settings.maxStrikes')).toContain('One is the default');
  });

  /**
   * The arithmetic the copy describes: at the default of one, the FIRST strike
   * leaves a player alive and the SECOND ends them. `updateSurvivorStatus`
   * eliminates at `strikesUsed >= maxStrikes + 1`, which is easy to read as
   * "one strike and you are out" — and that reading is what the copy would
   * have said if it had been written from the label.
   */
  it('and one strike really does mean the SECOND one ends a season', () => {
    const pool = { settings: { maxStrikes: 1 } } as unknown as NFLSurvivorPool;
    const at = (strikesUsed: number) =>
      updateSurvivorStatus({ strikesUsed } as unknown as SurvivorEntry, pool).status;
    expect(at(0)).toBe('ALIVE');
    expect(at(1)).toBe('ALIVE');
    expect(at(2)).toBe('ELIMINATED');
    // Sudden death, which the copy names as "set it to none".
    const sudden = { settings: { maxStrikes: 0 } } as unknown as NFLSurvivorPool;
    expect(updateSurvivorStatus({ strikesUsed: 1 } as unknown as SurvivorEntry, sudden).status)
      .toBe('ELIMINATED');
    expect(longFor('settings.maxStrikes')).toContain('the second one ends their season');
    expect(longFor('settings.maxStrikes')).toContain('sudden death');
  });

  it('no buy-backs is the default, and the copy says so', () => {
    expect(Number(wizardDefault('maxRebuys'))).toBe(0);
    expect(shortFor('settings.maxRebuys')).toContain('None is the default');
  });

  it('week 4 is the buy-back cutoff default, and the copy says so', () => {
    expect(Number(wizardDefault('rebuyDeadlineWeek'))).toBe(4);
    expect(shortFor('settings.rebuyDeadlineWeek')).toContain('Week 4 is the default');
  });

  /**
   * THE OFF-BY-ONE THIS COPY HAD TO GET RIGHT. `executeSurvivorRebuyInternal`
   * refuses only `week > rebuyDeadlineWeek`, so the cutoff week ITSELF still
   * accepts a buy-back — while `NFLPoolRules.tsx` renders the same setting as
   * "before <week>", one week narrower. The code wins (CLAUDE.md), so the copy
   * says "during that week, and not after it", and this pins the reading to the
   * callable's own comparison.
   */
  it('the cutoff week itself still accepts a buy-back, and the copy says that', () => {
    const source = readFileSync(resolve(root, 'functions/src/nflPools.ts'), 'utf8');
    expect(source).toContain('if (week > settings.rebuyDeadlineWeek)');
    expect(source).not.toContain('if (week >= settings.rebuyDeadlineWeek)');
    const long = longFor('settings.rebuyDeadlineWeek');
    expect(long).toContain('during that week');
    expect(long).toContain('from the week after');
  });

  it('a free buy-back is the default, and the money copy obeys voice rule 8', () => {
    expect(Number(wizardDefault('rebuyCost'))).toBe(0);
    expect(shortFor('settings.rebuyCost')).toContain('Nothing is the default');
    const long = longFor('settings.rebuyCost');
    // Rule 8: say where the money is, and do not imply a balance exists here.
    expect(long).toContain('is ever held here');
    expect(long).toContain('between you and that player');
    // The entry-fee fallback the callable really has.
    expect(readFileSync(resolve(root, 'functions/src/nflPools.ts'), 'utf8'))
      .toContain('settings.rebuyCost ?? settings.entryFee ?? 0');
    expect(long).toContain('charges the entry fee');
  });

  it('a tie is a strike by default, in the wizard AND at the read site', () => {
    expect(DEFAULT_TIE_COUNTS_AS).toBe('LOSS');
    expect(wizardDefault('tieCountsAs')).toBe('LOSS');
    expect(staticCopy(helpRegistry.getTopic('settings.tieCountsAs')!.short))
      .toContain('A strike is the default');
  });

  it('one use per team is the default, zero is unlimited, and 23 is the ceiling', () => {
    expect(DEFAULT_MAX_TEAM_USES).toBe(1);
    expect(UNLIMITED_TEAM_USES).toBe(0);
    expect(MAX_TEAM_USES).toBe(23);
    expect(Number(wizardDefault('maxTeamUses'))).toBe(1);
    const fallback = staticCopy(helpRegistry.getTopic('settings.maxTeamUses')!.short);
    expect(fallback).toContain('One is the default');
    expect(fallback).toContain('zero means no limit');
    // The ceiling is named in the long copy, in BOTH branches.
    expect(longFor('settings.maxTeamUses')).toContain(`${MAX_TEAM_USES}`);
    expect(longFor('settings.maxTeamUses', { maxTeamUses: 2 })).toContain(`${MAX_TEAM_USES}`);
    // And the create form really does cap there.
    expect(WIZARD_SRC).toContain('max={MAX_TEAM_USES}');
  });

  it('picking to win is the default', () => {
    expect(wizardDefault('pickLosersMode')).toBe('false');
    expect(staticCopy(helpRegistry.getTopic('settings.pickLosersMode')!.short))
      .toContain('Picking to win is the default');
  });

  /**
   * `autoSurviveExemptionEnabled` is the one whose default is contradicted on
   * screen: the wizard writes `true`, the scorer reads `?? true`, and
   * `NFLPoolRules.tsx` renders an ABSENT value as "Disabled". The code wins, so
   * the copy says on by default — and the read site is pinned here so a change
   * in either direction has to come past this test.
   */
  it('the exemption is ON by default, in the wizard AND at the read site', () => {
    expect(wizardDefault('autoSurviveExemptionEnabled')).toBe('true');
    expect(readFileSync(resolve(root, 'functions/src/nflScoringEngine.ts'), 'utf8'))
      .toContain('pool.settings.autoSurviveExemptionEnabled ?? true');
    expect(shortFor('settings.autoSurviveExemptionEnabled')).toContain('On by default');
  });

  /**
   * And the claim that an unlimited pool never gets one. `checkAutoSurviveExemption`
   * keeps every playing team eligible at `maxTeamUses: 0`, so the exemption can
   * never fire there — which is the whole reason the copy says the setting does
   * nothing in a pool with no team-use limit.
   */
  it('an unlimited pool can never be granted the exemption, as the copy says', () => {
    const games = [
      { status: 'FINAL', homeTeam: { abbreviation: 'KC' }, awayTeam: { abbreviation: 'BUF' } },
    ] as unknown as NFLGame[];
    const usedBoth = { 1: 'KC', 2: 'BUF' };
    // Limit of one, both teams already used: exempt.
    expect(checkAutoSurviveExemption(games, true, { maxTeamUses: 1, picks: usedBoth, week: 3 })).toBe(true);
    // Same picks, no limit: not exempt.
    expect(
      checkAutoSurviveExemption(games, true, { maxTeamUses: UNLIMITED_TEAM_USES, picks: usedBoth, week: 3 }),
    ).toBe(false);
    // Turned off: never exempt.
    expect(checkAutoSurviveExemption(games, false, { maxTeamUses: 1, picks: usedBoth, week: 3 })).toBe(false);
    const long = longFor('settings.autoSurviveExemptionEnabled');
    expect(long).toContain('no team-use limit never reaches that state');
    expect(long).toContain('weeks before the one being scored');
  });

  /**
   * `autoSurviveExemptionEnabled` really is create-only: the manager form has
   * no control for it AND its settings save omits the key, so a stored value is
   * left alone. The copy tells the reader that rather than leaving them hunting
   * for a control that is not there — and the claim is MEASURED, because it
   * stops being true the day somebody adds the toggle.
   */
  it('the manager form has no auto-survive control, which is what the copy says', () => {
    expect(MANAGER_SRC).not.toContain('autoSurviveExemption');
    expect(longFor('settings.autoSurviveExemptionEnabled')).toContain('no control for it on the settings tab');
  });

  /**
   * THE CLAIM THIS TICKET GOT WRONG FIRST TIME, PINNED SO IT CANNOT COME BACK.
   *
   * `pickLosersMode` reads like a create-only choice — it sits beside
   * `autoSurviveExemptionEnabled` in the wizard and appears in neither coverage
   * allowlist. It is not: the manager form renders a "Pick-Loser Mode" toggle
   * and sends the key on every survivor save. The reason both guards miss it is
   * that its label is a `<p>`, not a `<FieldLabel>` and not a raw `<label>`.
   *
   * So the copy must NOT say there is no control, and must say what changing it
   * later does — `SURVIVOR_PARITY_SETTINGS_KEYS` covers only `tieCountsAs` and
   * `maxTeamUses`, so nothing refuses this edit after a week has been scored.
   */
  it('the manager form DOES have a pick-loser control, and the copy does not deny it', () => {
    expect(MANAGER_SRC).toContain('Pick-Loser Mode');
    expect(MANAGER_SRC).toMatch(/checked=\{pickLosersMode\}/);
    expect(MANAGER_SRC).toMatch(/^\s*pickLosersMode,$/m); // sent with the survivor save

    const long = longFor('settings.pickLosersMode');
    expect(long).not.toContain('no control for it on the settings tab');
    expect(long).toContain('from the settings tab later');
    expect(staticCopy(helpRegistry.getTopic('settings.pickLosersMode')!.long))
      .toContain('from the settings tab later');
  });

  it('and nothing refuses that edit after a week has been scored — which is why the copy warns off it', () => {
    const gate = readFileSync(resolve(root, 'functions/src/lib/survivorSettingsGate.ts'), 'utf8');
    expect(gate).toContain("SURVIVOR_PARITY_SETTINGS_KEYS = ['tieCountsAs', 'maxTeamUses']");
    expect(gate).not.toContain('pickLosersMode');
    // The two that ARE gated say so; the one that is not says what happens
    // instead. A copy-paste of the gated sentence onto this topic is the
    // mistake this pair of assertions exists to catch.
    expect(longFor('settings.tieCountsAs')).toContain('cannot be changed once a week has been scored');
    expect(longFor('settings.maxTeamUses')).toContain('once a week has been scored');
    expect(longFor('settings.pickLosersMode')).not.toContain('cannot be changed once a week has been scored');
  });
});

// ---------------------------------------------------------------------------

/**
 * THE REVIVAL PATHS, PINNED TO THE ENGINE (codex r1 on this ticket).
 *
 * The first draft of the strikes topic said an eliminated player "only comes
 * back if you allow buy-backs". The engine does not agree, and this block is
 * the measurement rather than the argument: it drives the real scorer through
 * an elimination and a revival, and holds the copy to the outcome.
 *
 * Two independent facts have to BOTH hold for the second path to exist, so both
 * are asserted, and each one is the future change that should force a copy edit:
 *
 *  1. `maxStrikes` is not in `SURVIVOR_PARITY_SETTINGS_KEYS`, so nothing refuses
 *     the edit after a week has been scored. Add it to the gate and this goes
 *     red — correctly, because the copy would then be describing a route the
 *     server has closed.
 *  2. `computeSurvivorWeekUpdate` recomputes status from the pool's CURRENT
 *     `maxStrikes` rather than from a stored verdict, and its ELIMINATED skip is
 *     `eliminatedWeek < week`, so the elimination week itself is re-evaluated.
 *     Make it read a stored verdict and this goes red for the same reason.
 *
 * Reachability is not assumed either: `scoreNFLWeek` and `updatePoolSettings`
 * gate on the same helper (`assertPoolOwnerOrSuperAdmin`), so this is a
 * commissioner route and not an admin-only escape hatch — which is why the copy
 * addresses it to "you" on the settings tab instead of describing something the
 * reader cannot reach.
 */
describe('T10 — a strikes revival is a real path, and the copy names it', () => {
  const KC_LOSES = [
    {
      id: 'g-kc-buf',
      status: 'FINAL',
      homeTeam: { abbreviation: 'KC' },
      awayTeam: { abbreviation: 'BUF' },
      scores: { home: 10, away: 20 },
    },
  ] as unknown as NFLGame[];

  const survivorPool = (maxStrikes: number) =>
    ({ settings: { maxStrikes } }) as unknown as NFLSurvivorPool;

  const aliveEntry = () =>
    ({
      status: 'ALIVE',
      strikesUsed: 0,
      strikeWeeks: [],
      exemptWeeks: [],
      picks: { 3: 'KC' },
    }) as unknown as SurvivorEntry;

  const applied = (entry: SurvivorEntry, week: number, pool: NFLSurvivorPool) => {
    const { update } = computeSurvivorWeekUpdate(entry, week, KC_LOSES, pool);
    return { ...entry, ...update } as unknown as SurvivorEntry;
  };

  it('raising the limit and re-scoring the elimination week puts the player back in', () => {
    // Sudden death: the week-3 loss is the end of them.
    const out = applied(aliveEntry(), 3, survivorPool(0));
    expect(out.status).toBe('ELIMINATED');
    expect(out.eliminatedWeek).toBe(3);

    // Same entry, same games, one more strike allowed, week 3 scored again.
    const back = computeSurvivorWeekUpdate(out, 3, KC_LOSES, survivorPool(1));
    expect(back.skipped).toBe(false);
    expect(back.alive).toBe(true);
    expect(back.update.status).toBe('ALIVE');
    expect(back.update.eliminatedWeek).toBeNull();
    // "with their strikes still on the record" — the strike is not forgiven,
    // which is what separates this from a buy-back (`maxRebuys` clears them).
    expect(back.update.strikeWeeks).toEqual([3]);
    expect(back.update.strikesUsed).toBe(1);
  });

  it('the verdict is recomputed from the current limit, never stored', () => {
    const out = applied(aliveEntry(), 3, survivorPool(0));
    const back = applied(out, 3, survivorPool(1));
    expect(back.status).toBe('ALIVE');
    // And it round-trips: lower the limit again and the same entry is out
    // again. A stored verdict could not do that in either direction.
    expect(computeSurvivorWeekUpdate(back, 3, KC_LOSES, survivorPool(0)).update.status)
      .toBe('ELIMINATED');
  });

  it('it has to be the elimination week — a later week is skipped', () => {
    const out = applied(aliveEntry(), 3, survivorPool(0));
    const later = computeSurvivorWeekUpdate(out, 4, KC_LOSES, survivorPool(1));
    expect(later.skipped).toBe(true);
    expect(later.update.status).toBe('ELIMINATED');
    // So the copy must name the week, not just the setting.
    expect(longFor('settings.maxStrikes')).toContain('elimination week');
  });

  it('and nothing refuses the limit change on a pool that has already scored', () => {
    expect(SURVIVOR_PARITY_SETTINGS_KEYS).not.toContain('maxStrikes');
    const scored = {
      type: 'NFL_SURVIVOR',
      publishedWeeks: { 3: true },
      settings: { maxStrikes: 0, tieCountsAs: 'LOSS', maxTeamUses: 1 },
    };
    expect(survivorParitySettingsRefusal(scored, { 'settings.maxStrikes': 1 }, [])).toBeNull();
    // The planted counter-example: the gate is not simply inert. The two fields
    // it DOES cover are refused on the very same scored pool.
    expect(survivorParitySettingsRefusal(scored, { 'settings.tieCountsAs': 'WIN' }, []))
      .toMatchObject({ code: 'SETTINGS_LOCKED_AFTER_SCORING', field: 'tieCountsAs' });
  });

  /**
   * A SETTING THE COMMISSIONER CAN CHANGE IS EXPLAINED WHERE THEY CHANGE IT
   * (codex r2 on this ticket).
   *
   * `settings.pickLosersMode` was placed on the wizard, the rules page and the
   * pick sheet, and NOT on the manager settings tab — while its own copy tells
   * the reader they can change it "from the settings tab later". The reason it
   * slipped is the same one the pick-loser test above records: the toggle's
   * label is a `<p>` rather than a `FieldLabel`, so it carries no `helpId` and
   * appears in none of the coverage allowlists either. Nothing was looking.
   *
   * So the placement list is not hand-checked here. The survivor branch of the
   * manager save is READ, and every key in it that T10 explains must have a
   * placement on that page. Add a control to the form and this fails until the
   * help follows it.
   */
  it('every survivor setting the manager form saves is placed on the settings tab', () => {
    const block = MANAGER_SRC.split("} else if (type === 'NFL_SURVIVOR') {")[1]
      ?.split('} else if (')[0];
    expect(block).toBeTruthy();
    // Bare shorthand keys only — `...updatedSettings` and any `x: y` pair are
    // not settings this form owns.
    const saved = [...(block as string).matchAll(/^\s{10}([a-zA-Z][a-zA-Z0-9]*),$/gm)]
      .map((m) => m[1]);
    expect(saved).toContain('pickLosersMode'); // the one that was missing
    expect(saved.length).toBeGreaterThanOrEqual(7);

    const placedOnSettingsTab = new Set(
      NFL_SURVIVOR_PLACEMENTS
        .filter((p) => p.page === 'pool.nfl.manager.settings')
        .map((p) => p.topic),
    );
    const explained = new Set(NFL_SURVIVOR_TOPICS.map((t) => t.id));
    const unplaced = saved
      .map((key) => `settings.${key}`)
      .filter((id) => explained.has(id) && !placedOnSettingsTab.has(id));
    expect(unplaced).toEqual([]);

    // The planted counter-example: the check really is reading the save block
    // and not just passing on an empty list. A setting the form CANNOT change
    // is absent from both sides, so it must not appear in `saved`.
    expect(saved).not.toContain('autoSurviveExemptionEnabled');
    expect(placedOnSettingsTab.has('settings.autoSurviveExemptionEnabled')).toBe(false);
  });

  it('so the copy gives both ways back, and claims neither is the only one', () => {
    const long = longFor('settings.maxStrikes');
    expect(long).toContain('Buy-backs are how that player gets themselves back in');
    expect(long).toContain('Raising this limit is the other way back');
    // Addressed to the commissioner in the third person, because this topic is
    // on the member-facing rules page too — a member must not read the second
    // path as something they can do.
    expect(long).toContain('that one is the commissioner’s');
    expect(long).not.toContain('only comes back');
    // The same claim in the template's fallback branch, not only the rendered one.
    expect(staticCopy(helpRegistry.getTopic('settings.maxStrikes')!.long))
      .toContain('that one is the commissioner’s');
    // The buy-back topic must not re-assert the absolute from the other side.
    expect(longFor('settings.maxRebuys')).not.toContain('the end of a player');
    expect(longFor('settings.maxRebuys')).toContain('no player can buy their way back in');
  });
});

// ---------------------------------------------------------------------------

describe('T10 — the voice rules, on every branch this content can render', () => {
  /**
   * The generic invariants measure `staticCopy`, i.e. a template's fallback.
   * `help-registry-invariants.test.ts` extends that to the rendered branches
   * through TEMPLATE_FIXTURES; this repeats it locally so T10's own branches
   * are guarded by T10's own file too, and adds the two rules a word list
   * cannot check: no field paths (rule 7) and one sentence in `short` (rule 3).
   */
  const BRANCHES: readonly Record<string, unknown>[] = [
    {},
    { pickLosersMode: false, tieCountsAs: 'LOSS', maxTeamUses: 1 },
    { pickLosersMode: false, tieCountsAs: 'WIN', maxTeamUses: 0 },
    { pickLosersMode: true, tieCountsAs: 'LOSS', maxTeamUses: 2 },
    { pickLosersMode: true, tieCountsAs: 'WIN', maxTeamUses: MAX_TEAM_USES },
  ];

  it('every title is inside the budget', () => {
    const over = NFL_SURVIVOR_TOPICS.filter((t) => t.title.length > COPY_LIMITS.topicTitle)
      .map((t) => `${t.id}: ${t.title.length}`);
    expect(over).toEqual([]);
  });

  it('every rendered short is one sentence inside the budget', () => {
    const problems = NFL_SURVIVOR_TOPICS.flatMap((t) =>
      BRANCHES.flatMap((settings) => {
        const rendered = resolveCopy(t.short, { settings });
        return rendered.length > COPY_LIMITS.topicShort
          ? [`${t.id} ${JSON.stringify(settings)}: short ${rendered.length} chars`]
          : [];
      }),
    );
    expect(problems).toEqual([]);
  });

  it('no rendered branch uses a banned word', () => {
    const violations = NFL_SURVIVOR_TOPICS.flatMap((t) =>
      BRANCHES.flatMap((settings) => {
        const copy = [t.title, resolveCopy(t.short, { settings }), resolveCopy(t.long, { settings }), ...(t.tips ?? [])].join('\n');
        const hits = [
          ...findBannedWords(copy, BANNED_SELLING_WORDS),
          ...findBannedWords(copy, BANNED_IMPLEMENTATION_WORDS),
        ];
        return hits.length ? [`${t.id} ${JSON.stringify(settings)}: ${hits.join(', ')}`] : [];
      }),
    );
    expect(violations).toEqual([]);
  });

  /**
   * Voice rule 7 has a half no word list covers: a dotted field path printed at
   * the reader. Every topic here is NAMED for one, which makes this the exact
   * content most likely to leak one into a sentence.
   */
  it('no rendered branch prints a field path at the reader', () => {
    const leaked = NFL_SURVIVOR_TOPICS.flatMap((t) =>
      BRANCHES.flatMap((settings) => {
        const copy = [resolveCopy(t.short, { settings }), resolveCopy(t.long, { settings })].join('\n');
        return /\bsettings\.[a-zA-Z]/.test(copy) ? [`${t.id} ${JSON.stringify(settings)}`] : [];
      }),
    );
    expect(leaked).toEqual([]);
    // Discriminating half: the check catches the shape it is looking for.
    expect(/\bsettings\.[a-zA-Z]/.test('Set settings.maxStrikes to 2.')).toBe(true);
  });

  it('no rendered short carries a second sentence bolted on with a semicolon (rule 3)', () => {
    const bad = NFL_SURVIVOR_TOPICS.flatMap((t) =>
      BRANCHES.filter((settings) => resolveCopy(t.short, { settings }).includes(';')).map(
        (settings) => `${t.id} ${JSON.stringify(settings)}`,
      ),
    );
    expect(bad).toEqual([]);
  });

  it('every topic addresses the reader, never "the user" or "participants" (rule 1)', () => {
    const thirdPerson = NFL_SURVIVOR_TOPICS.flatMap((t) =>
      BRANCHES.flatMap((settings) => {
        const copy = [resolveCopy(t.short, { settings }), resolveCopy(t.long, { settings })].join('\n').toLowerCase();
        return /\bthe user\b|\bparticipants?\b/.test(copy) ? [`${t.id} ${JSON.stringify(settings)}`] : [];
      }),
    );
    expect(thirdPerson).toEqual([]);
    expect(/\bthe user\b|\bparticipants?\b/.test('the user picks')).toBe(true);
  });
});
