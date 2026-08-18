import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { POOL_TYPES } from '../shared/poolTypes';
import { baseTopicId, buildRegistry, helpRegistry, normalizePath, resolveCopy, SEARCH_RESULT_LIMIT, staticCopy } from '../src/help/registry';
import { PAGES } from '../src/help/pages';
import { ROUTE_ALLOWLIST } from '../src/help/coverage-allowlist';
import { BANNED_IMPLEMENTATION_WORDS, BANNED_SELLING_WORDS, COPY_LIMITS, findBannedWords } from '../src/help/voice';
import type { HelpPage, HelpTopic } from '../src/help/types';

/**
 * Help registry invariants — PLAN-HELP-SYSTEM.md §3 D5, ticket T0.
 *
 * WHY THIS EXISTS. The reference implementation this feature is ported from
 * (Spectrum Price Intel) has the same "one source for tooltip and panel copy"
 * intention and does not hold it: its tooltip takes an inline `text=` override
 * and 191 of its 213 call sites use it, so the shared dictionary is decorative.
 * The rule that copy lives in exactly one place is therefore enforced here
 * rather than described in a comment — a `HelpTip` takes an id and nothing
 * else, and every id must resolve.
 *
 * Two halves:
 *   1. The registry MECHANISM (built over fixtures, so it is tested even while
 *      the real content is empty).
 *   2. The real content: route coverage against `src/App.tsx`, and the
 *      mechanically checkable voice rules.
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const APP = read('src/App.tsx');

/**
 * Every route declared in a source string, in source order.
 *
 * Deliberately tolerant of how the declaration is written — `path` need not be
 * the first prop, and the value may be a double-quoted, single-quoted or
 * braced string literal. The first version required `<Route path="…"` exactly,
 * so `<Route element={…} path="/x">` or `path={'/x'}` parsed as nothing and
 * that route would ship with neither a HelpPage nor an allowlist decision —
 * silently, because the ">30" plausibility check would still pass on the other
 * 38.
 *
 * The real protection is `parseRoutes` returning the count of `<Route`
 * openings it FAILED to parse; a scanner that quietly skips a declaration is
 * the failure this guard exists to prevent, so it is reported rather than
 * absorbed.
 */
export function parseRoutes(source: string): { paths: string[]; unparsed: string[] } {
  // Strip comments first: a commented-out <Route> is not a route, and its text
  // would otherwise be counted as an opening that failed to parse.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const paths: string[] = [];
  const unparsed: string[] = [];
  const open = /<Route\b/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(code)) !== null) {
    // Find where this tag ends. A plain `[^>]*` stops at the FIRST `>`, which
    // in this codebase is usually the one inside `element={<Foo />}` — so the
    // props string got truncated before `path=` and the route vanished. Walk
    // forward instead, tracking quotes and brace depth, and end the tag at the
    // first `>` that is outside both.
    let i = m.index + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (; i < code.length; i++) {
      const c = code[i];
      if (quote) {
        if (c === quote && code[i - 1] !== '\\') quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    const props = code.slice(m.index + m[0].length, i);
    open.lastIndex = i;

    const p = /\bpath\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)\s*\})/.exec(props);
    if (p) paths.push(p[1] ?? p[2] ?? p[3] ?? p[4] ?? p[5]);
    // A <Route> with no `path` is a layout/index route, not a missed parse.
    else if (/\bpath\s*=/.test(props)) unparsed.push(`<Route${props}>`.slice(0, 80));
  }
  return { paths, unparsed };
}

/** Every `path=` route in App.tsx, in source order. */
function appRoutes(): string[] {
  return parseRoutes(APP).paths;
}

const topic = (over: Partial<HelpTopic> = {}): HelpTopic => ({
  id: 'settings.entryFee',
  title: 'Entry fee',
  short: 'What each player pays you to join.',
  long: 'You collect it directly.',
  poolTypes: 'all',
  audience: ['member'],
  ...over,
});

const page = (over: Partial<HelpPage> = {}): HelpPage => ({
  id: 'site.home',
  route: '/',
  title: 'Home',
  summary: 'The front page.',
  poolTypes: 'all',
  audience: ['member'],
  ...over,
});

/**
 * Topics with no placement — nothing in the panel would ever show them.
 *
 * Matched on the BASE id: a scoped variant (`NFL_SURVIVOR:settings.entryFee`)
 * is placed under `settings.entryFee`, because both variants explain the same
 * setting in the same place. Comparing the qualified id would report every
 * scoped variant as an orphan and make the feature's own scoping model
 * unusable in real content.
 */
function orphanTopics(
  topics: readonly HelpTopic[],
  placements: readonly { topic: string }[],
): string[] {
  const placed = new Set(placements.map((p) => p.topic));
  return topics.filter((t) => !placed.has(baseTopicId(t.id))).map((t) => t.id);
}

describe('orphanTopics', () => {
  it('accepts a scoped variant placed under its base id', () => {
    const topics = [topic({ id: 'NFL_SURVIVOR:settings.entryFee' })];
    expect(orphanTopics(topics, [{ topic: 'settings.entryFee' }])).toEqual([]);
  });

  it('still reports a topic nothing places', () => {
    expect(orphanTopics([topic({ id: 'settings.lonely' })], [])).toEqual(['settings.lonely']);
  });

  it('matches an indexed placement to its normalised topic', () => {
    expect(orphanTopics([topic({ id: 'props.questions.*.text' })], [{ topic: 'props.questions.*.text' }])).toEqual([]);
  });
});

describe('normalizePath', () => {
  it('collapses array indices so one topic covers every row', () => {
    expect(normalizePath('props.questions.3.text')).toBe('props.questions.*.text');
    expect(normalizePath('props.questions.0.text')).toBe('props.questions.*.text');
    expect(normalizePath('settings.payouts.places.11.rank')).toBe('settings.payouts.places.*.rank');
  });

  it('collapses a trailing index', () => {
    expect(normalizePath('props.payouts.2')).toBe('props.payouts.*');
  });

  it('leaves a path with no indices alone', () => {
    expect(normalizePath('settings.weeklyTiebreaker')).toBe('settings.weeklyTiebreaker');
  });

  // A pool-type prefix is not an array index and must survive untouched.
  it('leaves a pool-type-qualified id alone', () => {
    expect(normalizePath('NFL_SURVIVOR:settings.entryFee')).toBe('NFL_SURVIVOR:settings.entryFee');
  });
});

describe('buildRegistry — refuses invalid content', () => {
  const base = { topics: [], placements: [], pages: [], glossary: [] };

  it('rejects a duplicate topic id', () => {
    expect(() => buildRegistry({ ...base, topics: [topic(), topic()] })).toThrow(/duplicate topic id/);
  });

  it('rejects a duplicate topic id that differs only by array index', () => {
    expect(() =>
      buildRegistry({ ...base, topics: [topic({ id: 'a.0.b' }), topic({ id: 'a.1.b' })] }),
    ).toThrow(/duplicate topic id/);
  });

  it('rejects a placement pointing at a topic that does not exist', () => {
    expect(() =>
      buildRegistry({ ...base, pages: [page()], placements: [{ topic: 'nope', page: 'site.home' }] }),
    ).toThrow(/unknown topic/);
  });

  it('rejects a placement pointing at a page that does not exist', () => {
    expect(() =>
      buildRegistry({ ...base, topics: [topic()], placements: [{ topic: 'settings.entryFee', page: 'nope' }] }),
    ).toThrow(/unknown page/);
  });

  /**
   * `poolTypes: []` and `audience: []` type-check — an empty array is a valid
   * `readonly PoolType[]` — and both make an entry permanently unreachable.
   * It would sit in the registry looking authored, satisfy "every topic has a
   * placement", and render nowhere. Found by the codex round Kevin authorised
   * past the §2c cap.
   */
  it('rejects an entry no reader could ever reach', () => {
    expect(() => buildRegistry({ ...base, topics: [topic({ poolTypes: [] })] })).toThrow(/empty poolTypes/);
    expect(() => buildRegistry({ ...base, topics: [topic({ audience: [] })] })).toThrow(/empty audience/);
    expect(() =>
      buildRegistry({ ...base, pages: [page({ poolTypes: [] })] }),
    ).toThrow(/empty poolTypes/);
    expect(() =>
      buildRegistry({
        ...base,
        glossary: [{ id: 'g', term: 'T', short: 's', long: 'l', contextHeading: 'H', audience: [] }],
      }),
    ).toThrow(/empty audience/);
  });

  it('still accepts the reachable forms', () => {
    expect(() => buildRegistry({ ...base, topics: [topic({ poolTypes: 'all' })] })).not.toThrow();
    expect(() => buildRegistry({ ...base, topics: [topic({ poolTypes: ['SQUARES'] })] })).not.toThrow();
  });

  it('rejects a topic linking an unknown glossary term', () => {
    expect(() => buildRegistry({ ...base, topics: [topic({ terms: ['nope'] })] })).toThrow(/unknown glossary term/);
  });

  it('rejects a topic linking an unknown related topic', () => {
    expect(() => buildRegistry({ ...base, topics: [topic({ related: ['nope'] })] })).toThrow(/unknown related topic/);
  });

  /**
   * `related` accepts the same two spellings a placement does. A link to a
   * Survivor-only setting written as its base path must resolve, or the same
   * inconsistency that made scoped-only topics unplaceable reappears one code
   * path over.
   */
  it('accepts a related link by base id to a topic that exists only scoped', () => {
    expect(() =>
      buildRegistry({
        ...base,
        topics: [
          topic({ id: 'settings.entryFee', related: ['settings.maxStrikes'] }),
          topic({ id: 'NFL_SURVIVOR:settings.maxStrikes', poolTypes: ['NFL_SURVIVOR'] }),
        ],
      }),
    ).not.toThrow();
  });

  it('accepts a related link naming one exact variant', () => {
    expect(() =>
      buildRegistry({
        ...base,
        topics: [
          topic({ id: 'settings.entryFee', related: ['NFL_SURVIVOR:settings.maxStrikes'] }),
          topic({ id: 'NFL_SURVIVOR:settings.maxStrikes', poolTypes: ['NFL_SURVIVOR'] }),
        ],
      }),
    ).not.toThrow();
  });

  it('rejects a scoped variant naming a different pool type', () => {
    expect(() =>
      buildRegistry({
        ...base,
        topics: [topic({ id: 'NFL_SURVIVOR:settings.entryFee', poolTypes: ['NFL_PICKEM'] })],
      }),
    ).toThrow(/must be exactly/);
  });

  /**
   * A wider scope is a claim the registry never honours: resolveTopic selects a
   * qualified topic only for its own qualifier. Left accepted, the schema audit
   * would credit it as coverage for the other types it names and let their
   * allowlist rows be deleted while those readers still saw nothing.
   */
  it('rejects a scoped variant claiming more pool types than its qualifier', () => {
    for (const poolTypes of [['NFL_SURVIVOR', 'NFL_PICKEM'] as const, 'all' as const]) {
      expect(() =>
        buildRegistry({
          ...base,
          topics: [topic({ id: 'NFL_SURVIVOR:settings.entryFee', poolTypes })],
        }),
      ).toThrow(/must be exactly/);
    }
  });

  /**
   * The hole this closes: `resolveTopic` prefers the variant, then the panel
   * and search drop what the reader may not see. A commissioner-only variant
   * of a member topic therefore hides the member's help on every surface at
   * once instead of falling back. Refused at the door.
   */
  it('rejects a scoped variant whose audience differs from its base', () => {
    expect(() =>
      buildRegistry({
        ...base,
        topics: [
          topic({ id: 'settings.entryFee', audience: ['member'] }),
          topic({
            id: 'NFL_SURVIVOR:settings.entryFee',
            poolTypes: ['NFL_SURVIVOR'],
            audience: ['commissioner'],
          }),
        ],
      }),
    ).toThrow(/would hide the base/);
  });

  it('accepts a scoped variant with the same audience, in any order', () => {
    expect(() =>
      buildRegistry({
        ...base,
        topics: [
          topic({ id: 'settings.entryFee', audience: ['commissioner', 'member'] }),
          topic({
            id: 'NFL_SURVIVOR:settings.entryFee',
            poolTypes: ['NFL_SURVIVOR'],
            audience: ['member', 'commissioner'],
          }),
        ],
      }),
    ).not.toThrow();
  });

  /**
   * A Survivor-only setting has no unqualified topic to point a placement at.
   * Demanding one would make scoped-only content impossible to place, and
   * writing the placement qualified instead would stop it matching the base id
   * that the orphan check, the panel and search all join on. Both spellings
   * are accepted and stored as the base.
   */
  it('accepts a placement by base id for a topic that exists only scoped', () => {
    const built = buildRegistry({
      ...base,
      topics: [topic({ id: 'NFL_SURVIVOR:settings.maxStrikes', poolTypes: ['NFL_SURVIVOR'] })],
      pages: [page({ id: 'p' })],
      placements: [{ topic: 'settings.maxStrikes', page: 'p' }],
    });
    expect(built.placements[0].topic).toBe('settings.maxStrikes');
    const shown = built.placementsForPage('p', { poolType: 'NFL_SURVIVOR', audience: 'member' });
    expect(shown[0].topics.map((t) => t.id)).toEqual(['NFL_SURVIVOR:settings.maxStrikes']);
  });

  it('stores a placement written in qualified form under its base id', () => {
    const built = buildRegistry({
      ...base,
      topics: [topic({ id: 'NFL_SURVIVOR:settings.maxStrikes', poolTypes: ['NFL_SURVIVOR'] })],
      pages: [page({ id: 'p' })],
      placements: [{ topic: 'NFL_SURVIVOR:settings.maxStrikes', page: 'p' }],
    });
    expect(built.placements[0].topic).toBe('settings.maxStrikes');
  });

  it('shows nothing for a scoped-only topic outside its pool type', () => {
    const built = buildRegistry({
      ...base,
      topics: [topic({ id: 'NFL_SURVIVOR:settings.maxStrikes', poolTypes: ['NFL_SURVIVOR'] })],
      pages: [page({ id: 'p' })],
      placements: [{ topic: 'settings.maxStrikes', page: 'p' }],
    });
    expect(built.placementsForPage('p', { poolType: 'NFL_PICKEM', audience: 'member' })).toEqual([]);
  });

  it('still rejects a placement for a topic that does not exist in any form', () => {
    expect(() =>
      buildRegistry({
        ...base,
        topics: [topic({ id: 'NFL_SURVIVOR:settings.maxStrikes', poolTypes: ['NFL_SURVIVOR'] })],
        pages: [page({ id: 'p' })],
        placements: [{ topic: 'settings.nothing', page: 'p' }],
      }),
    ).toThrow(/unknown topic/);
  });

  it('accepts a scoped variant with no base topic of its own', () => {
    expect(() =>
      buildRegistry({
        ...base,
        topics: [topic({ id: 'NFL_SURVIVOR:settings.maxStrikes', poolTypes: ['NFL_SURVIVOR'] })],
      }),
    ).not.toThrow();
  });
});

describe('resolveTopic — one lookup for the tooltip and the panel', () => {
  const registry = buildRegistry({
    topics: [
      topic({ id: 'settings.entryFee', title: 'Entry fee' }),
      topic({ id: 'NFL_SURVIVOR:settings.entryFee', title: 'Entry fee and buy-backs', poolTypes: ['NFL_SURVIVOR'] }),
    ],
    placements: [],
    pages: [],
    glossary: [],
  });

  it('prefers the pool-type variant when the viewer is in that type', () => {
    expect(registry.resolveTopic({ poolType: 'NFL_SURVIVOR', audience: 'member' }, 'settings.entryFee')?.title)
      .toBe('Entry fee and buy-backs');
  });

  it('falls back to the unqualified topic for another pool type', () => {
    expect(registry.resolveTopic({ poolType: 'NFL_PICKEM', audience: 'member' }, 'settings.entryFee')?.title).toBe('Entry fee');
  });

  it('falls back to the unqualified topic with no pool in scope', () => {
    expect(registry.resolveTopic({ audience: 'member' }, 'settings.entryFee')?.title).toBe('Entry fee');
  });

  /**
   * A qualified id names WHICH variant; it does not grant permission to see
   * it. An earlier version returned it regardless of scope, on the reasoning
   * that a caller holding one (a ?help= deep link, a `related` entry) means
   * that exact variant — true, but it was quietly answering the second
   * question with the answer to the first, and this is the tooltip's path with
   * no filter after it.
   */
  it('honours an explicitly qualified id inside its own pool type', () => {
    expect(registry.resolveTopic({ poolType: 'NFL_SURVIVOR', audience: 'member' }, 'NFL_SURVIVOR:settings.entryFee')?.title)
      .toBe('Entry fee and buy-backs');
  });

  it('refuses a qualified id from another pool type', () => {
    expect(registry.resolveTopic({ poolType: 'NFL_PICKEM', audience: 'member' }, 'NFL_SURVIVOR:settings.entryFee'))
      .toBeUndefined();
  });

  /**
   * The audience half of the same hole. A member must not be handed
   * commissioner copy just because the control they hovered shares an id.
   */
  it('refuses a topic whose audience does not include the reader', () => {
    const gated = buildRegistry({
      topics: [topic({ id: 'settings.lockBufferMinutes', audience: ['commissioner'] })],
      placements: [],
      pages: [],
      glossary: [],
    });
    expect(gated.resolveTopic({ audience: 'commissioner' }, 'settings.lockBufferMinutes')).toBeDefined();
    expect(gated.resolveTopic({ audience: 'member' }, 'settings.lockBufferMinutes')).toBeUndefined();
    // A commissioner still reads member copy — K9's widening is unchanged.
    const shared = buildRegistry({
      topics: [topic({ id: 'settings.entryFee', audience: ['member'] })],
      placements: [],
      pages: [],
      glossary: [],
    });
    expect(shared.resolveTopic({ audience: 'commissioner' }, 'settings.entryFee')).toBeDefined();
  });

  it('returns undefined rather than a wrong topic when nothing matches', () => {
    expect(registry.resolveTopic({ poolType: 'SQUARES', audience: 'member' }, 'settings.nothing')).toBeUndefined();
  });

  /**
   * This is the TOOLTIP's path and nothing filters after it — the panel and
   * search apply visibility themselves, a HelpTip renders whatever it is
   * given. A topic limited to one pool type must not come back for another
   * just because the two share a field name.
   */
  it('does not hand a type-limited topic to another pool type', () => {
    const limited = buildRegistry({
      topics: [topic({ id: 'settings.lockMode', poolTypes: ['NFL_PICKEM'] })],
      placements: [],
      pages: [],
      glossary: [],
    });
    expect(limited.resolveTopic({ poolType: 'NFL_PICKEM', audience: 'member' }, 'settings.lockMode')).toBeDefined();
    expect(limited.resolveTopic({ poolType: 'SQUARES', audience: 'member' }, 'settings.lockMode')).toBeUndefined();
    // No pool in scope (the wizard picker, a site page) is not that pool type
    // either, so a type-limited topic stays hidden there too.
    expect(limited.resolveTopic({ audience: 'member' }, 'settings.lockMode')).toBeUndefined();
  });

  /**
   * The parity guard. The panel resolves placements through the SAME function
   * the tooltip uses, so a placement written unqualified renders the scoped
   * variant on both surfaces. If these two ever diverge, a Survivor member
   * reads one explanation on hover and a different one in the panel.
   */
  it('gives the panel and the tooltip the same topic for a scoped id', () => {
    const scoped = buildRegistry({
      topics: [
        topic({ id: 'settings.entryFee', title: 'Entry fee' }),
        topic({ id: 'NFL_SURVIVOR:settings.entryFee', title: 'Entry fee and buy-backs', poolTypes: ['NFL_SURVIVOR'] }),
      ],
      pages: [page({ id: 'pool.survivor', route: '/pool/:id' })],
      placements: [{ topic: 'settings.entryFee', page: 'pool.survivor' }],
      glossary: [],
    });
    const fromTooltip = scoped.resolveTopic({ poolType: 'NFL_SURVIVOR', audience: 'member' }, 'settings.entryFee');
    const fromPanel = scoped.placementsForPage('pool.survivor', {
      poolType: 'NFL_SURVIVOR',
      audience: 'member',
    })[0].topics[0];
    expect(fromPanel).toBe(fromTooltip);
    expect(fromPanel.title).toBe('Entry fee and buy-backs');
  });
});

describe('baseTopicId', () => {
  it('strips a pool-type qualifier', () => {
    expect(baseTopicId('NFL_SURVIVOR:settings.entryFee')).toBe('settings.entryFee');
  });

  it('leaves an unqualified id alone', () => {
    expect(baseTopicId('settings.entryFee')).toBe('settings.entryFee');
  });

  // Only a real pool type is a qualifier. A colon in a slug is not.
  it('does not treat an arbitrary prefix as a qualifier', () => {
    expect(baseTopicId('mystery:thing')).toBe('mystery:thing');
  });

  it('normalises array indices as well', () => {
    expect(baseTopicId('PROPS:props.questions.2.text')).toBe('props.questions.*.text');
  });
});

describe('copy resolution', () => {
  const templated = topic({
    short: { template: (ctx) => `Fee is ${ctx.settings?.entryFee}.`, fallback: 'Your commissioner sets the fee.' },
  });

  it('renders a template against the pool in scope', () => {
    expect(resolveCopy(templated.short, { settings: { entryFee: 20 } })).toBe('Fee is 20.');
  });

  /**
   * The wizard, the site pages and the search index have no pool settings. A
   * template run there would put the word "undefined" in front of a reader,
   * which is exactly what `fallback` exists to prevent.
   *
   * Knowing the pool TYPE is not enough, and this is the case that matters:
   * the wizard knows the type from the moment the format is chosen and has no
   * settings until the pool is created.
   */
  it('falls back when the pool settings are not in scope', () => {
    expect(resolveCopy(templated.short)).toBe('Your commissioner sets the fee.');
    expect(resolveCopy(templated.short, {})).toBe('Your commissioner sets the fee.');
    expect(resolveCopy(templated.short, { poolType: 'NFL_PICKEM' })).toBe('Your commissioner sets the fee.');
  });

  it('renders the template as soon as settings arrive, even an empty object', () => {
    expect(resolveCopy(templated.short, { settings: {} })).toBe('Fee is undefined.');
  });

  it('indexes the fallback', () => {
    expect(staticCopy(templated.short)).toBe('Your commissioner sets the fee.');
  });

  it('passes a plain string through either way', () => {
    expect(resolveCopy('flat')).toBe('flat');
    expect(staticCopy('flat')).toBe('flat');
  });
});

describe('placementsForPage — grouping and visibility', () => {
  const registry = buildRegistry({
    topics: [
      topic({ id: 'a', audience: ['member'] }),
      topic({ id: 'b', audience: ['commissioner'] }),
      topic({ id: 'c', audience: ['admin'] }),
      topic({ id: 'd', poolTypes: ['SQUARES'] }),
    ],
    pages: [page({ id: 'p' })],
    placements: [
      { topic: 'b', page: 'p', section: 'settings', order: 2 },
      { topic: 'a', page: 'p', section: 'settings', order: 1 },
      { topic: 'c', page: 'p', section: 'admin' },
      { topic: 'd', page: 'p', section: 'settings' },
    ],
    glossary: [],
  });

  it('groups by section and orders within a group', () => {
    const sections = registry.placementsForPage('p', { audience: 'commissioner' });
    expect(sections.map((s) => s.section)).toEqual(['settings']);
    expect(sections[0].topics.map((t) => t.id)).toEqual(['a', 'b']);
  });

  // K9: one registry with audience[]. A commissioner is also a member, so
  // member copy must reach them — otherwise every shared setting would need a
  // duplicate commissioner topic, which is what K9 rejected.
  it('shows member copy to a commissioner', () => {
    const ids = registry
      .placementsForPage('p', { audience: 'commissioner' })
      .flatMap((s) => s.topics.map((t) => t.id));
    expect(ids).toContain('a');
  });

  it('hides commissioner and admin copy from a member', () => {
    const ids = registry
      .placementsForPage('p', { audience: 'member' })
      .flatMap((s) => s.topics.map((t) => t.id));
    expect(ids).toEqual(['a']);
  });

  it('hides a topic scoped to another pool type', () => {
    const ids = registry
      .placementsForPage('p', { audience: 'admin', poolType: 'NFL_PICKEM' })
      .flatMap((s) => s.topics.map((t) => t.id));
    expect(ids).not.toContain('d');
  });

  it('shows it inside its own pool type', () => {
    const ids = registry
      .placementsForPage('p', { audience: 'admin', poolType: 'SQUARES' })
      .flatMap((s) => s.topics.map((t) => t.id));
    expect(ids).toContain('d');
  });

  it('defaults a placement with no section to the general section', () => {
    const r = buildRegistry({
      topics: [topic({ id: 'a' })],
      pages: [page({ id: 'p' })],
      placements: [{ topic: 'a', page: 'p' }],
      glossary: [],
    });
    expect(r.placementsForPage('p', { audience: 'member' })[0].section).toBe('general');
  });
});

describe('search', () => {
  const registry = buildRegistry({
    topics: [
      topic({ id: 'settings.weeklyTiebreaker', title: 'Weekly tie-breaker', long: 'Decides who wins a week when two players score the same.' }),
      topic({ id: 'admin.only', title: 'Admin thing', long: 'Tiebreaker internals.', audience: ['admin'] }),
    ],
    pages: [page({ id: 'p', title: 'Standings', summary: 'Where the tiebreaker is applied.' })],
    placements: [{ topic: 'settings.weeklyTiebreaker', page: 'p' }],
    glossary: [
      { id: 'g', term: 'Tie-break', short: 'How a tie is settled.', long: 'Long form.', contextHeading: 'X', audience: ['member'] },
    ],
  });

  it('finds a topic by its long copy, not only its title', () => {
    const hits = registry.search('who wins a week', { audience: 'member' });
    expect(hits.map((h) => h.id)).toContain('settings.weeklyTiebreaker');
  });

  it('reports the page a topic result opens to', () => {
    const hit = registry.search('who wins a week', { audience: 'member' }).find((h) => h.kind === 'topic');
    expect(hit?.pageId).toBe('p');
  });

  it('is case-insensitive', () => {
    expect(registry.search('TIEBREAKER', { audience: 'member' }).length).toBeGreaterThan(0);
  });

  it('searches pages and glossary as well as topics', () => {
    const kinds = new Set(registry.search('tie', { audience: 'member' }).map((h) => h.kind));
    expect(kinds).toEqual(new Set(['topic', 'page', 'glossary']));
  });

  it('hides admin-only results from a member', () => {
    expect(registry.search('internals', { audience: 'member' })).toEqual([]);
    expect(registry.search('internals', { audience: 'admin' }).length).toBe(1);
  });

  it('returns nothing for an empty query rather than everything', () => {
    expect(registry.search('   ', { audience: 'member' })).toEqual([]);
  });

  /**
   * A scoped variant is PLACED under its base id, because both variants
   * explain the same setting in the same place. A search hit on the variant
   * must still know where to open, or the result renders with nowhere to go
   * while the panel resolves the same placement correctly.
   */
  it('gives a scoped variant the page its base id is placed on', () => {
    const scoped = buildRegistry({
      topics: [
        topic({ id: 'settings.entryFee', long: 'Dues wording.' }),
        topic({ id: 'NFL_SURVIVOR:settings.entryFee', title: 'Entry fee and buy-backs', long: 'Dues wording plus buy-backs.', poolTypes: ['NFL_SURVIVOR'] }),
      ],
      pages: [page({ id: 'pool.survivor', route: '/pool/:id' })],
      placements: [{ topic: 'settings.entryFee', page: 'pool.survivor' }],
      glossary: [],
    });
    // Searched from INSIDE a Survivor pool — the only scope in which the
    // variant is the one shown. With no pool in scope the unqualified topic is
    // the right answer and the variant is not listed at all.
    const hit = scoped
      .search('buy-backs', { poolType: 'NFL_SURVIVOR', audience: 'member' })
      .find((h) => h.id === 'NFL_SURVIVOR:settings.entryFee');
    expect(hit?.pageId).toBe('pool.survivor');
  });

  /**
   * Both variants are visible to a Survivor reader and both match a query on
   * the shared wording. Listing both hands the reader the same setting twice
   * with two different explanations — while the tooltip and the panel show
   * only one of them. Search lists the variant `resolveTopic` picks.
   */
  it('lists one variant per setting, the one the other surfaces show', () => {
    const scoped = buildRegistry({
      topics: [
        topic({ id: 'settings.entryFee', title: 'Entry fee', long: 'Dues wording.' }),
        topic({ id: 'NFL_SURVIVOR:settings.entryFee', title: 'Entry fee and buy-backs', long: 'Dues wording.', poolTypes: ['NFL_SURVIVOR'] }),
      ],
      pages: [page({ id: 'pool.survivor', route: '/pool/:id' })],
      placements: [{ topic: 'settings.entryFee', page: 'pool.survivor' }],
      glossary: [],
    });
    const survivor = scoped.search('dues wording', { poolType: 'NFL_SURVIVOR', audience: 'member' });
    expect(survivor.map((h) => h.id)).toEqual(['NFL_SURVIVOR:settings.entryFee']);

    const pickem = scoped.search('dues wording', { poolType: 'NFL_PICKEM', audience: 'member' });
    expect(pickem.map((h) => h.id)).toEqual(['settings.entryFee']);
  });

  /**
   * A topic placed on a commissioner page and a member page must send a member
   * to the member page, not to the one that happens to be listed first.
   */
  it('points a result at a page the reader can actually open', () => {
    const multi = buildRegistry({
      topics: [topic({ id: 'settings.entryFee', long: 'Dues wording.' })],
      pages: [
        page({ id: 'manager', route: '/pool/:id', title: 'Manager', audience: ['commissioner'] }),
        page({ id: 'join', route: '/join/:poolId', title: 'Join', audience: ['member'] }),
      ],
      placements: [
        { topic: 'settings.entryFee', page: 'manager' },
        { topic: 'settings.entryFee', page: 'join' },
      ],
      glossary: [],
    });
    expect(multi.search('dues', { audience: 'member' })[0].pageId).toBe('join');
    expect(multi.search('dues', { audience: 'commissioner' })[0].pageId).toBe('manager');
  });

  /**
   * Topics are found first, so concatenating and truncating at the end would
   * drop every page and glossary hit as soon as topic content is large enough
   * to fill the limit on its own — the glossary search would look broken while
   * working perfectly.
   */
  it('does not let a flood of topic matches starve pages and glossary', () => {
    const many = Array.from({ length: SEARCH_RESULT_LIMIT + 10 }, (_, i) =>
      topic({ id: `settings.field${i}`, title: `Field ${i}`, long: 'pool wording' }),
    );
    const flooded = buildRegistry({
      topics: many,
      pages: [page({ id: 'p', title: 'Pool page', summary: 'pool wording' })],
      placements: many.map((t) => ({ topic: t.id, page: 'p' })),
      glossary: [
        { id: 'g', term: 'Pool', short: 'pool wording', long: 'Long.', contextHeading: 'Pool', audience: ['member'] },
      ],
    });
    const hits = flooded.search('pool wording', { audience: 'member' });
    expect(hits.length).toBe(SEARCH_RESULT_LIMIT);
    expect(hits.some((h) => h.kind === 'page')).toBe(true);
    expect(hits.some((h) => h.kind === 'glossary')).toBe(true);
  });

  it('still returns every kind it has when under the limit', () => {
    const hits = registry.search('tie', { audience: 'member' });
    expect(hits.length).toBeLessThanOrEqual(SEARCH_RESULT_LIMIT);
    expect(new Set(hits.map((h) => h.kind))).toEqual(new Set(['topic', 'page', 'glossary']));
  });

  it('leaves pageId unset rather than naming a page the reader cannot open', () => {
    const hidden = buildRegistry({
      topics: [topic({ id: 'settings.entryFee', long: 'Dues wording.' })],
      pages: [page({ id: 'manager', route: '/pool/:id', title: 'Manager', audience: ['commissioner'] })],
      placements: [{ topic: 'settings.entryFee', page: 'manager' }],
      glossary: [],
    });
    expect(hidden.search('dues', { audience: 'member' })[0].pageId).toBeUndefined();
  });
});

describe('parseRoutes — the scanner itself', () => {
  it('reads path as the first prop', () => {
    expect(parseRoutes('<Route path="/a" element={<A />} />').paths).toEqual(['/a']);
  });

  it('reads path after another prop', () => {
    expect(parseRoutes('<Route element={<A />} path="/b" />').paths).toEqual(['/b']);
  });

  it('reads single-quoted and braced literals', () => {
    expect(parseRoutes("<Route path='/c' />").paths).toEqual(['/c']);
    expect(parseRoutes("<Route path={'/d'} />").paths).toEqual(['/d']);
    expect(parseRoutes('<Route path={`/e`} />').paths).toEqual(['/e']);
  });

  it('treats a path it cannot read as UNPARSED, never as absent', () => {
    const out = parseRoutes('<Route path={ROUTES.home} element={<A />} />');
    expect(out.paths).toEqual([]);
    expect(out.unparsed).toHaveLength(1);
  });

  it('ignores a Route with no path at all', () => {
    const out = parseRoutes('<Route element={<Layout />}>');
    expect(out.paths).toEqual([]);
    expect(out.unparsed).toEqual([]);
  });

  it('ignores commented-out declarations', () => {
    expect(parseRoutes('// <Route path="/old" />').paths).toEqual([]);
    expect(parseRoutes('/* <Route path="/old" /> */').paths).toEqual([]);
  });
});

describe('the real registry — route coverage against src/App.tsx', () => {
  const routes = appRoutes();

  it('reads a plausible route list out of App.tsx', () => {
    // Guards the regex itself: if App.tsx's route syntax changes, every
    // assertion below would pass vacuously on an empty list.
    expect(routes.length).toBeGreaterThan(30);
    expect(routes).toContain('/pool/:id');
    expect(routes).toContain('*');
  });

  /**
   * The one that matters. A route the scanner cannot read is a route with no
   * help decision, and it would otherwise be indistinguishable from a route
   * that does not exist. Reported, never absorbed.
   */
  it('parses every route declaration it finds, with none skipped', () => {
    expect(parseRoutes(APP).unparsed).toEqual([]);
  });

  it('every HelpPage route exists in App.tsx', () => {
    const unknown = PAGES.filter((p) => !routes.includes(p.route)).map((p) => `${p.id} → ${p.route}`);
    expect(unknown).toEqual([]);
  });

  it('every App.tsx route has a HelpPage or an allowlist row', () => {
    const covered = new Set(PAGES.map((p) => p.route));
    const uncovered = routes.filter((r) => !covered.has(r) && !(r in ROUTE_ALLOWLIST));
    expect(uncovered).toEqual([]);
  });

  it('no allowlist row names a route App.tsx no longer has', () => {
    const stale = Object.keys(ROUTE_ALLOWLIST).filter((r) => !routes.includes(r));
    expect(stale).toEqual([]);
  });

  it('no route is both given a page and allowlisted', () => {
    const both = PAGES.filter((p) => p.route in ROUTE_ALLOWLIST).map((p) => p.route);
    expect(both).toEqual([]);
  });

  it('every allowlist row carries a reason naming a ticket or PERMANENT', () => {
    const vague = Object.entries(ROUTE_ALLOWLIST)
      .filter(([, reason]) => !/^(PERMANENT|T\d+)\b/.test(reason))
      .map(([route]) => route);
    expect(vague).toEqual([]);
  });
});

describe('the real registry — content rules', () => {
  const topics = [...helpRegistry.topics];

  it('every topic has at least one placement', () => {
    expect(orphanTopics(topics, helpRegistry.placements)).toEqual([]);
  });

  it('every topic pool-type scope names real pool types', () => {
    const bad = topics
      .filter((t) => t.poolTypes !== 'all' && t.poolTypes.some((p) => !POOL_TYPES.includes(p)))
      .map((t) => t.id);
    expect(bad).toEqual([]);
  });

  it('every topic names at least one audience', () => {
    expect(topics.filter((t) => t.audience.length === 0).map((t) => t.id)).toEqual([]);
  });

  // Reported as one list rather than one test per topic: `it.each` over an
  // empty array registers no test at all, so it would go quiet exactly while
  // T0's content is empty — the state this file has to keep honest.
  it('every topic obeys the length budget', () => {
    const over = topics.flatMap((t) => [
      ...(t.title.length > COPY_LIMITS.topicTitle ? [`${t.id}: title ${t.title.length} chars`] : []),
      ...(staticCopy(t.short).length > COPY_LIMITS.topicShort
        ? [`${t.id}: short ${staticCopy(t.short).length} chars`]
        : []),
    ]);
    expect(over).toEqual([]);
  });

  it('every topic obeys the voice rules', () => {
    const violations = topics.flatMap((t) => {
      const copy = [t.title, staticCopy(t.short), staticCopy(t.long), ...(t.tips ?? [])].join('\n');
      const hits = [
        ...findBannedWords(copy, BANNED_SELLING_WORDS),
        ...findBannedWords(copy, BANNED_IMPLEMENTATION_WORDS),
      ];
      return hits.length ? [`${t.id}: ${hits.join(', ')}`] : [];
    });
    expect(violations).toEqual([]);
  });

  it('every page obeys the length budget and the voice rules', () => {
    const violations = PAGES.flatMap((p) => {
      const problems: string[] = [];
      if (p.summary.length > COPY_LIMITS.pageSummary) problems.push(`summary ${p.summary.length} chars`);
      const copy = `${p.title}\n${p.summary}`;
      const hits = [
        ...findBannedWords(copy, BANNED_SELLING_WORDS),
        ...findBannedWords(copy, BANNED_IMPLEMENTATION_WORDS),
      ];
      if (hits.length) problems.push(hits.join(', '));
      return problems.length ? [`${p.id}: ${problems.join('; ')}`] : [];
    });
    expect(violations).toEqual([]);
  });

  // T1 ships the create wizard's copy and the seven wizard pages; T2/T3/T14
  // bring the rest. Asserted as a SHAPE, not a count, so it does not have to be
  // edited on every content ticket — but an accidentally-empty registry still
  // fails here rather than looking like a pass.
  it('T1 state: the create wizard has copy and pages, and the glossary is full', () => {
    expect(topics.length).toBeGreaterThan(20);
    expect([...PAGES].map((p) => p.route).sort()).toEqual([
      '/create/bracket',
      '/create/margin',
      '/create/pickem',
      '/create/playoff',
      '/create/props',
      '/create/squares',
      '/create/survivor',
    ]);
    expect(helpRegistry.glossary.length).toBeGreaterThan(30);
  });

  /**
   * The scoped-variant path, exercised on the REAL content rather than only on
   * fixtures. `wizard.season` exists twice — a shared NFL-season wording and a
   * playoff one — and both are placed under the one base id, so this is the
   * first live proof that a reader gets the variant their pool type is in.
   */
  it('resolves the pool-type variant of the season note on the playoff wizard', () => {
    const playoff = helpRegistry.resolveTopic({ poolType: 'NFL_PLAYOFFS', audience: 'commissioner' }, 'wizard.season');
    const pickem = helpRegistry.resolveTopic({ poolType: 'NFL_PICKEM', audience: 'commissioner' }, 'wizard.season');
    expect(playoff?.id).toBe('NFL_PLAYOFFS:wizard.season');
    expect(pickem?.id).toBe('wizard.season');
    // And the panel agrees with the tooltip, because both go through the same
    // function: the placement is written unqualified on both pages.
    const onPlayoffPage = helpRegistry
      .placementsForPage('wizard.playoff', { poolType: 'NFL_PLAYOFFS', audience: 'commissioner' })
      .flatMap((s) => s.topics);
    expect(onPlayoffPage).toContain(playoff);
    expect(onPlayoffPage).not.toContain(pickem);
  });
});
