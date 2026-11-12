import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { POOL_TYPES } from '../shared/poolTypes';
import type { PoolType } from '../shared/poolTypes';
import { helpRegistry, normalizePath, baseTopicId, staticCopy } from '../src/help/registry';
import { SCHEMA_PATH_ALLOWLIST, WIZARD_FIELD_ALLOWLIST } from '../src/help/coverage-allowlist';
import { SQUARES_PROPS_PLACEMENTS, SQUARES_PROPS_TOPICS } from '../src/help/content/squares-props';
import { squaresCreateInputSchema } from '../shared/schemas/squares';
import { propsCreateInputSchema } from '../shared/schemas/props';
import type { HelpTopic } from '../src/help/types';

/**
 * T13 content guard — PLAN-HELP-SYSTEM.md §7.
 *
 * The generic registry guards prove this content is well formed and the
 * coverage guards prove no row was deleted without copy replacing it. This
 * file proves the three things specific to T13 that nothing else can see:
 *
 *  1. **Scope.** `maxSquaresPerPlayer` and `numberSets` are squares-only,
 *     `props.maxCards` is props-only, and the matchup topic covers exactly the
 *     two one-game formats. `resolveTopic` is the tooltip's ONLY filter, so a
 *     topic authored `poolTypes: 'all'` would put grid rules in a Survivor
 *     reader's panel.
 *
 *  2. **Every default this copy names is the default the code has** — voice
 *     rule 5, pinned to the line that makes it true, the way
 *     `help-ui-coverage.test.ts` pins the Pick'em ones. Flip a wizard default
 *     and the copy fails here rather than going quietly stale.
 *
 *  3. **The `maxSquaresPerPlayer` copy and the wizard's label say the same
 *     thing, and the code makes both true.** Until 2026-11 they contradicted
 *     each other on purpose: the label read "(0 = no limit)" and the callable
 *     refused every first claim at 0. `effectiveSquareCap` is the one reader
 *     now; the pin below runs it, and the planner the callable uses, rather
 *     than grepping for a comparison.
 *
 * Each check is paired with a planted counter-example, so a guard that stopped
 * discriminating fails here rather than going quietly green.
 */

import { effectiveSquareCap, planClaim } from '../shared/squaresClaim';
import { computePeriodPayouts, squaresPot, type PayoutPool } from '../shared/squaresPayouts';
import { SQUARES_DEFAULT_PAYOUTS, squaresRules, squaresCharity } from '../shared/squaresDefaults';
import { buildSquaresPayload } from '../src/components/wizard/create/buildSquaresPayload';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

// The squares wizard is three files since PLAN-SQUARES-REOPEN C1/C2: the shell
// (step list and form defaults) and the two steps that are its own. Every pin
// below is about what the wizard renders or defaults, so it reads all three.
const SQUARES_WIZARD = [
  'src/components/wizard/create/CreateSquaresPool.tsx',
  'src/components/wizard/create/StepSquaresGame.tsx',
  'src/components/wizard/create/StepSquaresPayouts.tsx',
].map(read).join('\n');
const PROPS_WIZARD = read('src/components/wizard/create/CreatePropsPool.tsx');

const HOST = 'commissioner' as const;
const MEMBER = 'member' as const;

const resolveFor = (poolType: PoolType, id: string, audience: 'member' | 'commissioner' = HOST) =>
  helpRegistry.resolveTopic({ poolType, audience }, id);

const copyOf = (id: string): string => {
  const t = helpRegistry.getTopic(id);
  if (!t) throw new Error(`no topic ${id}`);
  return `${staticCopy(t.short)}\n\n${staticCopy(t.long)}`;
};

/**
 * The schema paths a reader of `poolType` finds explained — the same rule
 * `help-schema-audit.test.ts` credits coverage by, restated here so this file
 * asserts the OUTCOME (a path is explained for exactly the right types) rather
 * than the shape of the content that produces it.
 */
function explainedPathsFor(poolType: PoolType): Set<string> {
  return new Set(
    helpRegistry.topics
      .filter((t: HelpTopic) => t.poolTypes === 'all' || t.poolTypes.includes(poolType))
      .flatMap((t) => (t.fields ?? [baseTopicId(t.id)]).map(normalizePath)),
  );
}

const OTHER_TYPES = POOL_TYPES.filter((t) => t !== 'SQUARES' && t !== 'PROPS');

describe('T13 — the pages this copy is placed on exist', () => {
  const pageIds = new Set(helpRegistry.pages.map((p) => p.id));

  it('finds the squares and props pages', () => {
    // Without this, a rename in `pool-pages.ts` or `wizard-pages.ts` would
    // empty every visibility assertion below and they would pass on nothing.
    for (const id of [
      'wizard.squares.grid',
      'wizard.squares.payouts',
      'admin.squares.payouts',
      'wizard.props.setup',
      'pool.squares',
      'admin.squares.settings',
      'admin.squares.game',
      'pool.props.cards',
      'pool.props.admin',
    ]) {
      expect(pageIds.has(id), `${id} is missing from the registry`).toBe(true);
    }
  });

  it('every T13 placement names a page that exists', () => {
    const missing = SQUARES_PROPS_PLACEMENTS.filter((p) => !pageIds.has(p.page)).map((p) => p.page);
    expect(missing).toEqual([]);
  });

  it('the topics actually reach those pages', () => {
    const on = (page: string, poolType: PoolType, audience: 'member' | 'commissioner') =>
      helpRegistry
        .placementsForPage(page, { poolType, audience })
        .flatMap((s) => s.topics)
        .map((t) => t.id);

    expect(on('wizard.squares.grid', 'SQUARES', HOST)).toEqual(
      expect.arrayContaining(['matchup.teams', 'maxSquaresPerPlayer', 'numberSets']),
    );
    expect(on('wizard.squares.grid', 'SQUARES', HOST)).toContain('squares.game');
    expect(on('wizard.squares.payouts', 'SQUARES', HOST)).toEqual([
      'squaresPayouts',
      'charity',
      'ruleVariations.reverseWinners',
      'ruleVariations.quarterlyRollover',
      'ruleVariations.unclaimedFinalPrizeStrategy',
    ]);
    // A member reads the prize rules on the pool page, not only the host.
    expect(on('pool.squares', 'SQUARES', MEMBER)).toEqual(
      expect.arrayContaining(['squaresPayouts', 'charity', 'ruleVariations.reverseWinners', 'ruleVariations.quarterlyRollover']),
    );
    expect(on('wizard.props.setup', 'PROPS', HOST)).toEqual(
      expect.arrayContaining(['matchup.teams', 'props.maxCards']),
    );
    expect(on('pool.squares', 'SQUARES', MEMBER)).toEqual(
      expect.arrayContaining(['maxSquaresPerPlayer', 'numberSets']),
    );
    expect(on('pool.props.cards', 'PROPS', MEMBER)).toContain('props.maxCards');
    expect(on('admin.squares.game', 'SQUARES', HOST)).toContain('matchup.teams');
  });
});

describe('T13 — scope: grid rules stay on the grid', () => {
  it.each(['maxSquaresPerPlayer', 'numberSets'])('%s resolves for SQUARES and no other type', (id) => {
    expect(resolveFor('SQUARES', id)?.id).toBe(id);
    for (const type of POOL_TYPES.filter((t) => t !== 'SQUARES')) {
      expect(resolveFor(type, id), `${id} leaked to ${type}`).toBeUndefined();
    }
  });

  it.each([
    'squares.game',
    'squaresPayouts',
    'charity',
    'ruleVariations.reverseWinners',
    'ruleVariations.quarterlyRollover',
    'ruleVariations.unclaimedFinalPrizeStrategy',
  ])('%s resolves for SQUARES and no other type', (id) => {
    expect(resolveFor('SQUARES', id)?.id).toBe(id);
    for (const type of POOL_TYPES.filter((t) => t !== 'SQUARES')) {
      expect(resolveFor(type, id), `${id} leaked to ${type}`).toBeUndefined();
    }
  });

  it('the game picker is a host control; the prize rules reach a member', () => {
    expect(resolveFor('SQUARES', 'squares.game', MEMBER)).toBeUndefined();
    for (const id of ['squaresPayouts', 'charity', 'ruleVariations.reverseWinners', 'ruleVariations.quarterlyRollover']) {
      expect(resolveFor('SQUARES', id, MEMBER)?.id, id).toBe(id);
    }
  });

  it('props.maxCards resolves for PROPS and no other type', () => {
    expect(resolveFor('PROPS', 'props.maxCards')?.id).toBe('props.maxCards');
    for (const type of POOL_TYPES.filter((t) => t !== 'PROPS')) {
      expect(resolveFor(type, 'props.maxCards'), `leaked to ${type}`).toBeUndefined();
    }
  });

  it('the matchup topic covers exactly the two one-game formats', () => {
    expect(resolveFor('SQUARES', 'matchup.teams')?.id).toBe('matchup.teams');
    expect(resolveFor('PROPS', 'matchup.teams')?.id).toBe('matchup.teams');
    for (const type of OTHER_TYPES) {
      expect(resolveFor(type, 'matchup.teams'), `leaked to ${type}`).toBeUndefined();
    }
  });

  it('the matchup topic is a host control and does not reach a member', () => {
    // It is a create/manage input; nobody else meets it. `resolveTopic` is the
    // tooltip's only filter, so this is the whole of the rule.
    expect(resolveFor('SQUARES', 'matchup.teams', MEMBER)).toBeUndefined();
    expect(resolveFor('PROPS', 'matchup.teams', MEMBER)).toBeUndefined();
    // ...and the three caps DO reach a member, so the check above is not
    // passing because members see nothing from this file.
    expect(resolveFor('SQUARES', 'maxSquaresPerPlayer', MEMBER)?.id).toBe('maxSquaresPerPlayer');
    expect(resolveFor('PROPS', 'props.maxCards', MEMBER)?.id).toBe('props.maxCards');
  });

  it('the scope filter discriminates: a widened topic WOULD leak', () => {
    // Reverting the fix in miniature — a `poolTypes: 'all'` topic authored in
    // T1 resolves for SQUARES, which is exactly what the assertions above
    // would catch if one of these were widened.
    expect(resolveFor('SQUARES', 'name')?.id).toBe('name');
    expect(resolveFor('NFL_SURVIVOR', 'numberSets')).toBeUndefined();
  });

  it('every topic in squares-props.ts names only SQUARES and/or PROPS', () => {
    const wrong = SQUARES_PROPS_TOPICS.filter(
      (t) =>
        t.poolTypes === 'all' ||
        !t.poolTypes.every((p) => p === 'SQUARES' || p === 'PROPS'),
    ).map((t) => t.id);
    expect(wrong).toEqual([]);
  });
});

describe('T13 — the schema paths are explained for exactly the types that carry them', () => {
  it('the two team names are explained for both one-game formats', () => {
    for (const path of ['homeTeam', 'awayTeam']) {
      expect(explainedPathsFor('SQUARES').has(path), `${path} unexplained for SQUARES`).toBe(true);
      expect(explainedPathsFor('PROPS').has(path), `${path} unexplained for PROPS`).toBe(true);
      // And not credited anywhere that does not carry the field, which is the
      // way a per-type audit can be fooled into reporting full coverage.
      expect(explainedPathsFor('NFL_PICKEM').has(path)).toBe(false);
    }
  });

  it('the squares grid rules are explained for SQUARES only', () => {
    for (const path of ['maxSquaresPerPlayer', 'numberSets']) {
      expect(explainedPathsFor('SQUARES').has(path)).toBe(true);
      expect(explainedPathsFor('PROPS').has(path)).toBe(false);
    }
  });

  it('the card cap is explained for PROPS only', () => {
    expect(explainedPathsFor('PROPS').has('props.maxCards')).toBe(true);
    expect(explainedPathsFor('SQUARES').has('props.maxCards')).toBe(false);
  });

  it('one topic claims BOTH team names — they are one explanation', () => {
    // Voice rule 10. Two near-identical topics would satisfy every coverage
    // guard above and still be the duplication this registry exists to stop.
    const matchup = helpRegistry.getTopic('matchup.teams')!;
    expect(matchup.fields).toEqual(['homeTeam', 'awayTeam']);
    expect(helpRegistry.getTopic('homeTeam')).toBeUndefined();
    expect(helpRegistry.getTopic('awayTeam')).toBeUndefined();
    // ...so both inputs must carry an explicit helpId, in BOTH wizards, or one
    // of the two fields renders with no `?` beside it.
    for (const source of [SQUARES_WIZARD, PROPS_WIZARD]) {
      expect(source).toMatch(/name="homeTeam"[^/]*helpId="matchup\.teams"/);
      expect(source).toMatch(/name="awayTeam"[^/]*helpId="matchup\.teams"/);
    }
  });
});

describe('T13 — the eleven allowlist rows', () => {
  it('the five schema rows are gone', () => {
    for (const path of ['maxSquaresPerPlayer', 'numberSets', 'homeTeam', 'awayTeam', 'props.maxCards']) {
      expect(path in SCHEMA_PATH_ALLOWLIST, `${path} should no longer be allowlisted`).toBe(false);
    }
  });

  it('the five wizard-field rows are gone', () => {
    for (const path of ['homeTeam', 'awayTeam', 'maxSquaresPerPlayer', 'numberSets', 'props.maxCards']) {
      expect(path in WIZARD_FIELD_ALLOWLIST, `${path} should no longer be allowlisted`).toBe(false);
    }
  });

  /**
   * The sixth schema row was SETTLED, not closed with copy.
   *
   * `seasonType` was pending on T13 only for SQUARES and PROPS — the three NFL
   * season formats are explained by the topic in `content/wizard-shared.ts`.
   * Neither one-game wizard binds a control to it and neither payload builder
   * sends it; the only writer is the legacy squares game picker, which stamps
   * it from the chosen game alongside `gameId` and `week`. So it is PERMANENT
   * for the same reason `week` is, and the topic was NOT widened: its copy
   * names a default ('2') that only the Pick'em wizard sets and describes weeks
   * a one-game pool does not have.
   *
   * Turning a PENDING row PERMANENT is the one move that can make this guard
   * green while explaining nothing, so the reason is asserted rather than
   * trusted.
   */
  it('seasonType is settled PERMANENT, with the reason that makes it one', () => {
    const reason = SCHEMA_PATH_ALLOWLIST['seasonType'];
    expect(reason).toMatch(/^PERMANENT\b/);
    expect(reason).toMatch(/no control/);
    // Both writers are game pickers, and both stamp it from the game chosen.
    expect(reason).toMatch(/StepSquaresGame\.tsx/);
    expect(reason).toMatch(/AdminPanel\.tsx/);
    expect(reason).toMatch(/T13/);
  });

  it('and the topic was NOT widened to the one-game formats', () => {
    // The alternative close, refused. If a later edit widens it, this fails
    // and whoever widened it has to justify the copy for a pool with no
    // control and no weeks.
    const seasonType = helpRegistry.getTopic('seasonType')!;
    expect(seasonType.poolTypes).toEqual(['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN']);
    expect(resolveFor('SQUARES', 'seasonType')).toBeUndefined();
    expect(resolveFor('PROPS', 'seasonType')).toBeUndefined();
    // ...and it still reaches the three it was written for.
    expect(resolveFor('NFL_PICKEM', 'seasonType')?.id).toBe('seasonType');
  });

  it('no squares or props surface has a control for seasonType', () => {
    // The measurement the PERMANENT reason rests on, re-taken every run. An
    // INPUT bound to it in either wizard makes the row a lie, and this is the
    // only place that would notice. (The squares game picker SETS it from the
    // chosen game, which is what "derived" means — that is not a control.)
    expect(SQUARES_WIZARD).not.toMatch(/name="seasonType"/);
    expect(SQUARES_WIZARD).not.toMatch(/register\(['"`]seasonType/);
    expect(PROPS_WIZARD).not.toMatch(/seasonType/);
    expect(read('src/components/wizard/create/buildPropsPayload.ts')).not.toMatch(/seasonType/);
  });

  it('and the squares wizard sends it only as part of a game that was picked', () => {
    // Run, not grepped. A season type typed into the form state with no game
    // behind it is not sent; one that arrived with a picked game is.
    const base = { name: 'Grid', costPerSquare: 5, seasonType: '2', week: 12 };
    const unlinked = buildSquaresPayload(base);
    expect('seasonType' in unlinked).toBe(false);
    expect('week' in unlinked).toBe(false);
    const linked = buildSquaresPayload({ ...base, gameId: '401', gameTime: 1_800_000_000_000 });
    expect(linked.seasonType).toBe('2');
    expect(linked.week).toBe(12);
  });

  it('the three fields the picker stamps are PERMANENT rows, not copy', () => {
    for (const path of ['league', 'homeTeamLogo', 'awayTeamLogo']) {
      expect(SCHEMA_PATH_ALLOWLIST[path], path).toMatch(/^PERMANENT: derived from the chosen game/);
      // ...and nothing in the wizard binds an input to one.
      expect(SQUARES_WIZARD).not.toMatch(new RegExp(`name="${path}"`));
    }
    // The topic that explains the picker claims no schema path of its own.
    expect(helpRegistry.getTopic('squares.game')!.fields).toEqual([]);
  });
});

/**
 * Voice rule 5, pinned. Each claim names the line that makes it true.
 */
describe('T13 — copy that names a default matches the code', () => {
  it('maxSquaresPerPlayer — the wizard still starts it at 0', () => {
    expect(SQUARES_WIZARD).toMatch(/maxSquaresPerPlayer:\s*0/);
    expect(read('src/components/wizard/create/buildSquaresPayload.ts')).toMatch(
      /maxSquaresPerPlayer:\s*Number\(v\.maxSquaresPerPlayer \?\? 0\)/,
    );
    expect(copyOf('maxSquaresPerPlayer')).toContain('It starts at 0');
  });

  it('numberSets — the wizard still defaults to one set, and still offers two', () => {
    expect(SQUARES_WIZARD).toMatch(/numberSets:\s*'1'/);
    // The default is named with the option's own words, so both option labels
    // are pinned: renaming one in the wizard leaves the copy naming a choice
    // that is no longer in the list.
    expect(SQUARES_WIZARD).toContain("label: 'One set of numbers'");
    expect(SQUARES_WIZARD).toContain("label: 'New numbers each quarter'");
    const copy = copyOf('numberSets');
    expect(copy).toContain('One set of numbers is the default');
    expect(copy).toContain('New numbers each quarter');
  });

  it('props.maxCards — one card each is still the default and still the floor', () => {
    expect(PROPS_WIZARD).toMatch(/maxCards:\s*1/);
    expect(PROPS_WIZARD).toMatch(/name="props\.maxCards"[^/]*min=\{1\}/);
    expect(copyOf('props.maxCards')).toContain('One card each is the default');
  });

  /**
   * "there is no unlimited setting", proved rather than asserted.
   *
   * The bracket ticket has to say `-1` means unlimited; this one has to say the
   * opposite, and the difference is in the contract. A `min(1)` that became
   * `min(0)` or gained a sentinel would make this copy wrong.
   */
  it('the card cap has no unlimited value — 0 is refused, 1 is accepted', () => {
    const base = {
      type: 'PROPS' as const,
      name: 'Card pool',
      props: { cost: 5, maxCards: 1, questions: [] },
    };
    expect(propsCreateInputSchema.safeParse(base).success).toBe(true);
    expect(
      propsCreateInputSchema.safeParse({ ...base, props: { ...base.props, maxCards: 0 } }).success,
    ).toBe(false);
    expect(
      propsCreateInputSchema.safeParse({ ...base, props: { ...base.props, maxCards: -1 } }).success,
    ).toBe(false);
    expect(copyOf('props.maxCards')).toContain('there is no unlimited setting');
  });

  it('the squares cap DOES accept 0, which is why its copy warns about it', () => {
    // The asymmetry that makes the warning necessary: 0 is storable here and
    // is not storable on the card cap above.
    const base = { type: 'SQUARES' as const, name: 'Grid', costPerSquare: 5 };
    expect(squaresCreateInputSchema.safeParse({ ...base, maxSquaresPerPlayer: 0 }).success).toBe(true);
    expect(squaresCreateInputSchema.safeParse({ ...base, maxSquaresPerPlayer: -1 }).success).toBe(false);
  });
});

/**
 * The payouts step (PLAN-SQUARES-REOPEN C2). Every sentence that names a
 * default or describes what a rule pays is held to the code that decides it —
 * the wizard's defaults for the first, and `computePeriodPayouts`, RUN, for the
 * second. That function is the one that records winners.
 */
describe('C2 — the payouts copy names the defaults the wizard has', () => {
  const defaults = (key: string) => buildSquaresPayload({ name: 'Grid', costPerSquare: 5 })[key];

  it('the split starts at 25% each, in the wizard and on the server', () => {
    expect(SQUARES_WIZARD).toMatch(/squaresPayouts:\s*\{ q1: 25, half: 25, q3: 25, final: 25 \}/);
    expect({ ...SQUARES_DEFAULT_PAYOUTS }).toEqual({ q1: 25, half: 25, q3: 25, final: 25 });
    expect(copyOf('squaresPayouts')).toContain('It starts at 25% each');
  });

  it('a split that does not total 100 is refused, as the copy says', () => {
    const base = { type: 'SQUARES' as const, name: 'Grid', costPerSquare: 5 };
    const split = (q1: number, half: number, q3: number, final: number) =>
      squaresCreateInputSchema.safeParse({ ...base, squaresPayouts: { q1, half, q3, final } }).success;
    expect(split(25, 25, 25, 25)).toBe(true);
    expect(split(10, 20, 10, 60)).toBe(true);
    expect(split(25, 25, 25, 24)).toBe(false);
    expect(split(25, 25, 25, 26)).toBe(false);
    expect(split(-10, 60, 25, 25)).toBe(false);
    expect(copyOf('squaresPayouts')).toContain('must add up to exactly 100%');
  });

  it('charity starts off', () => {
    expect(SQUARES_WIZARD).toMatch(/charity:\s*\{ enabled: false/);
    expect(defaults('charity')).toEqual({ enabled: false, percentage: 0 });
    expect(squaresCharity(undefined).enabled).toBe(false);
    expect(copyOf('charity')).toContain('It is off to start with');
  });

  it('reverse winners starts off, rollover starts ON, and the final prize starts on the last winner', () => {
    expect(SQUARES_WIZARD).toMatch(/reverseWinners: false, quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'last_winner'/);
    expect(copyOf('ruleVariations.reverseWinners')).toContain('It is off to start with');
    expect(copyOf('ruleVariations.quarterlyRollover')).toContain('It starts on.');
    // The default is named with the option's own words; both labels are pinned.
    expect(SQUARES_WIZARD).toContain("label: 'Give it to the last player who won'");
    expect(SQUARES_WIZARD).toContain("label: 'Random draw among the squares that were sold'");
    const copy = copyOf('ruleVariations.unclaimedFinalPrizeStrategy');
    expect(copy).toContain('It starts on “Give it to the last player who won”');
    expect(copy).toContain('“Random draw among the squares that were sold”');
  });

  it('a stored pool that says nothing reads every rule as OFF — the wizard default is a choice, not a fallback', () => {
    // The copy says rollover "starts on" for a pool the wizard creates. A
    // document missing the field is a different thing and is read as off; if
    // these two ever merged, the page would show a rule the scorer does not run.
    expect(squaresRules(undefined).quarterlyRollover).toBe(false);
    expect(squaresRules({ quarterlyRollover: true }).quarterlyRollover).toBe(true);
  });
});

describe('C2 — the payouts copy describes what the scorer does', () => {
  const axis = { home: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], away: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
  // $10 a square, every square sold unless listed: a $1,000 pot, $250 a quarter.
  const pool = (over: Partial<PayoutPool> = {}, unsold: number[] = []): PayoutPool => ({
    costPerSquare: 10,
    squares: Array.from({ length: 100 }, (_, i) => ({ owner: unsold.includes(i) ? null : `P${i}` })),
    payouts: { q1: 25, half: 25, q3: 25, final: 25 },
    axisNumbers: axis,
    ...over,
  });
  const sq = (home: number, away: number) => away * 10 + home;
  const q = (home: number, away: number) => ({ home, away });

  it('reverse winners: two squares, half the prize each', () => {
    const [q1] = computePeriodPayouts(pool({ ruleVariations: { reverseWinners: true } }), { q1: q(7, 3) });
    expect(q1.claims.map((c) => [c.squareId, c.amount])).toEqual([[sq(7, 3), 125], [sq(3, 7), 125]]);
    expect(copyOf('ruleVariations.reverseWinners')).toContain('They take half the prize each');
  });

  it('reverse winners: matching digits leave one winner with the whole prize', () => {
    const [q1] = computePeriodPayouts(pool({ ruleVariations: { reverseWinners: true } }), { q1: q(7, 7) });
    expect(q1.claims.map((c) => [c.squareId, c.amount])).toEqual([[sq(7, 7), 250]]);
    expect(copyOf('ruleVariations.reverseWinners')).toContain('the one winner takes the whole prize');
  });

  it('reverse winners off: one square, the whole prize (the counter-example)', () => {
    const [q1] = computePeriodPayouts(pool(), { q1: q(7, 3) });
    expect(q1.claims.map((c) => [c.squareId, c.amount])).toEqual([[sq(7, 3), 250]]);
  });

  it('rollover on: an unsold prize is added to the next quarter', () => {
    const p = pool({ ruleVariations: { quarterlyRollover: true } }, [sq(7, 3)]);
    const [q1, half] = computePeriodPayouts(p, { q1: q(7, 3), half: q(4, 0) });
    const pot = squaresPot(p).net; // 99 sold
    expect(q1.claims[0]).toMatchObject({ sold: false, amount: 0, isRollover: true });
    expect(half.claims[0].amount).toBeCloseTo((pot * 0.25) * 2, 2);
    expect(copyOf('ruleVariations.quarterlyRollover')).toContain('added to the next quarter');
  });

  it('rollover off: an unsold prize is paid to nobody and the next quarter is unchanged', () => {
    const p = pool({ ruleVariations: { quarterlyRollover: false } }, [sq(7, 3)]);
    const [q1, half] = computePeriodPayouts(p, { q1: q(7, 3), half: q(4, 0) });
    const pot = squaresPot(p).net;
    expect(q1.claims[0]).toMatchObject({ sold: false, owner: 'Unsold', isRollover: false });
    expect(q1.claims[0].amount).toBeCloseTo(pot * 0.25, 2);
    expect(half.claims[0].amount).toBeCloseTo(pot * 0.25, 2);
    expect(copyOf('ruleVariations.quarterlyRollover')).toContain('is not paid to anyone');
  });

  it('an unsold final square: the last player who won takes it', () => {
    const p = pool({ ruleVariations: { quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'last_winner' } }, [sq(1, 1)]);
    const results = computePeriodPayouts(p, { q1: q(7, 3), half: q(4, 0), q3: q(4, 7), final: q(1, 1) });
    const extra = results[3].claims.find((c) => c.docId === 'final_rollover')!;
    // The third quarter's winner is the most recent one.
    expect(extra).toMatchObject({ sold: true, owner: `P${sq(4, 7)}` });
    expect(extra.amount).toBeCloseTo(squaresPot(p).net * 0.25, 2);
  });

  it('an unsold final square on a random-draw pool waits for the draw', () => {
    const p = pool({ ruleVariations: { quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' } }, [sq(1, 1)]);
    const results = computePeriodPayouts(p, { q1: q(7, 3), final: q(1, 1) });
    const extra = results[1].claims.find((c) => c.docId === 'final_rollover')!;
    expect(extra).toMatchObject({ sold: false, isRollover: true });
    expect(copyOf('ruleVariations.unclaimedFinalPrizeStrategy')).toContain('leaves the prize waiting');
  });

  it('nobody won anything all game: the final prize stays unsold', () => {
    const unsold = [sq(7, 3), sq(1, 1)];
    const p = pool({ ruleVariations: { quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'last_winner' } }, unsold);
    const results = computePeriodPayouts(p, { q1: q(7, 3), final: q(1, 1) });
    const extra = results[1].claims.find((c) => c.docId === 'final_rollover')!;
    expect(extra).toMatchObject({ sold: false, owner: 'Unsold' });
    expect(copyOf('ruleVariations.unclaimedFinalPrizeStrategy')).toContain('the prize stays unsold');
  });

  it('charity comes off first, rounded down to a whole dollar', () => {
    // 33 squares at $7 = $231; 10% is $23.10 → $23 to charity, $208 in prizes.
    const p: PayoutPool = {
      costPerSquare: 7,
      squares: Array.from({ length: 100 }, (_, i) => ({ owner: i < 33 ? 'x' : null })),
      charity: { enabled: true, percentage: 10 },
    };
    expect(squaresPot(p)).toMatchObject({ gross: 231, charity: 23, net: 208 });
    // ...and off means nothing comes off, whatever percentage is still stored.
    expect(squaresPot({ ...p, charity: { enabled: false, percentage: 10 } })).toMatchObject({ charity: 0, net: 231 });
    expect(copyOf('charity')).toContain('rounded down to a whole dollar');
  });
});

/**
 * THE PIN, INVERTED (PLAN-SQUARES-REOPEN A1).
 *
 * This block used to assert that the defect was still there — the callable
 * compared `mySquares >= pool.maxSquaresPerPlayer` with no zero guard, so a
 * pool on the wizard's default refused every first claim — and it was written
 * to fail the day that was fixed. It is fixed. What it holds now is the other
 * direction: the copy says 0 is no limit, so 0 has to BE no limit in the
 * function the callable runs.
 *
 * It RUNS that function. The old version grepped the source for a comparison,
 * which proved the text of a line and nothing about what a claim does.
 */
describe('T13 — "0 means no limit" is true of the shipped code', () => {
  const SQUARES_FN = read('functions/src/squares.ts');
  const grid = Array.from({ length: 100 }, (_, i) => ({ id: i, owner: null as string | null }));
  const claim = (max: unknown, squareIds: number[]) => planClaim({
    squares: grid,
    squareIds,
    identity: { uid: null, guestKeyHash: null },
    displayName: 'Alice',
    maxSquaresPerPlayer: max,
    exemptFromCap: false,
    now: 1,
  });

  it('a non-owner takes their first square on a pool stored at 0', () => {
    expect(effectiveSquareCap(0)).toBeNull();
    expect(claim(0, [5]).ok).toBe(true);
    // And the whole grid, which is what "no limit" means.
    expect(claim(0, grid.map((s) => s.id)).ok).toBe(true);
  });

  it('absent, negative and unreadable limits are no limit too — none may refuse a player', () => {
    for (const raw of [undefined, null, -1, 'abc', NaN]) {
      expect(effectiveSquareCap(raw), String(raw)).toBeNull();
      expect(claim(raw, [1, 2, 3]).ok, String(raw)).toBe(true);
    }
  });

  it('a real limit is still a limit (counter-example: the guard must discriminate)', () => {
    expect(effectiveSquareCap(2)).toBe(2);
    expect(claim(2, [1, 2]).ok).toBe(true);
    const over = claim(2, [1, 2, 3]);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.refusal.code).toBe('LIMIT');
  });

  it('the callable decides through that planner, not a comparison of its own', () => {
    expect(SQUARES_FN).toContain('planClaim(');
    expect(SQUARES_FN).toContain('maxSquaresPerPlayer: pool.maxSquaresPerPlayer');
    expect(SQUARES_FN).not.toMatch(/mySquares >= pool\.maxSquaresPerPlayer/);
  });

  it('and the copy says what the label says', () => {
    const copy = copyOf('maxSquaresPerPlayer');
    expect(copy).toContain('0 means no limit');
    expect(copy).not.toContain('0 is not a way of saying no limit');
    expect(SQUARES_WIZARD).toContain('Max squares per player (0 = no limit)');
  });
});

/**
 * The `numberSets` behaviour claim: a fresh set really is drawn per quarter.
 *
 * Only `autoLock` seeds `q1`; `q2`, `q3` and `q4` are generated by the score
 * sync as each quarter goes final. Every reader falls back to the single axis
 * when a quarter's set is missing, so if the generation were removed the copy
 * would describe numbers that never change and nothing would break loudly.
 */
describe('T13 — new numbers each quarter really are drawn', () => {
  it('the score sync generates a set for each of the last three quarters', () => {
    const src = read('functions/src/scoreUpdates.ts');
    expect(src).toMatch(/if \(freshPool\.numberSets === 4\)/);
    expect(src).toMatch(/handleGen\('q2'\)/);
    expect(src).toMatch(/handleGen\('q3'\)/);
    expect(src).toMatch(/handleGen\('q4'\)/);
  });

  it('the lock seeds the first set', () => {
    const src = read('functions/src/autoLock.ts');
    expect(src).toMatch(/currentPool\.numberSets === 4/);
    expect(src).toMatch(/quarterlyNumbers = \{\s*q1: axisNumbers/);
  });

  it('and each period is paid against its own set', () => {
    const src = read('src/services/gameLogic.ts');
    expect(src).toMatch(/period === 'q1' && state\.quarterlyNumbers\.q1/);
    expect(src).toMatch(/period === 'final' && state\.quarterlyNumbers\.q4/);
  });
});
