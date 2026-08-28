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
 *  3. **The `maxSquaresPerPlayer` copy contradicts the wizard's own label on
 *     purpose, and only while the code says so.** The label reads
 *     "(0 = no limit)"; `functions/src/squares.ts` refuses a claim whenever
 *     `mySquares >= pool.maxSquaresPerPlayer` with no zero guard, so on a grid
 *     stored at the wizard's own default of 0 a player is refused their FIRST
 *     square. The copy follows the code. The pin below fails the day the
 *     defect is fixed, which is the day the copy has to be rewritten.
 *
 * Each check is paired with a planted counter-example, so a guard that stopped
 * discriminating fails here rather than going quietly green.
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const SQUARES_WIZARD = read('src/components/wizard/create/CreateSquaresPool.tsx');
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
    expect(reason).toMatch(/AdminPanel\.tsx:371/);
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
    // The measurement the PERMANENT reason rests on, re-taken every run. A
    // control added to either wizard makes the row a lie, and this is the only
    // place that would notice.
    expect(SQUARES_WIZARD).not.toMatch(/seasonType/);
    expect(PROPS_WIZARD).not.toMatch(/seasonType/);
    expect(read('src/components/wizard/create/buildSquaresPayload.ts')).not.toMatch(/seasonType/);
    expect(read('src/components/wizard/create/buildPropsPayload.ts')).not.toMatch(/seasonType/);
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
 * THE DRIFT PIN.
 *
 * `CreateSquaresPool.tsx` labels the field "Max squares per player (0 = no
 * limit)". Nothing implements that. `functions/src/squares.ts` refuses a claim
 * whenever `mySquares >= pool.maxSquaresPerPlayer` and the claimer is not the
 * pool owner — at 0 that is every claim, on the player's first square — and
 * the three client readers each substitute a different number for 0
 * (`Grid.tsx` 100, `PoolRoute.tsx` 10 for the pre-check and "∞" for the
 * display). So the label is wrong on four counts and the copy follows the code.
 *
 * This test exists so the copy cannot outlive the defect. Fix the callable and
 * it fails, which is the signal to rewrite the sentence.
 */
describe('T13 — the "0 is not no limit" claim is true of the shipped code', () => {
  const SQUARES_FN = read('functions/src/squares.ts');

  it('the claim check has no zero guard', () => {
    expect(SQUARES_FN).toMatch(/mySquares >= pool\.maxSquaresPerPlayer/);
    // The three shapes a fix would take. Any of them means 0 now means "no
    // limit" and this copy has to change.
    expect(SQUARES_FN).not.toMatch(/pool\.maxSquaresPerPlayer\s*>\s*0/);
    expect(SQUARES_FN).not.toMatch(/pool\.maxSquaresPerPlayer\s*\|\|/);
    expect(SQUARES_FN).not.toMatch(/pool\.maxSquaresPerPlayer\s*\?\?/);
  });

  it('and the copy says so instead of repeating the label', () => {
    const copy = copyOf('maxSquaresPerPlayer');
    expect(copy).toContain('0 is not a way of saying no limit');
    expect(copy).toContain('refused their very first square');
    // The label's exact phrasing must NOT be echoed back at the reader.
    expect(copy).not.toMatch(/0\s*=\s*no limit/);
  });

  it('the label really does still say it — the contradiction is deliberate', () => {
    // If somebody fixes the LABEL instead of the callable, this fails and the
    // copy's framing has to be reconsidered rather than left half-true.
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
