import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { POOL_TYPES } from '../shared/poolTypes';
import { baseTopicId, buildRegistry, helpRegistry, normalizePath, resolveCopy, staticCopy } from '../src/help/registry';
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

/** Every `<Route path="…">` in App.tsx, in source order. */
function appRoutes(): string[] {
  return [...APP.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
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

  it('rejects a topic linking an unknown glossary term', () => {
    expect(() => buildRegistry({ ...base, topics: [topic({ terms: ['nope'] })] })).toThrow(/unknown glossary term/);
  });

  it('rejects a topic linking an unknown related topic', () => {
    expect(() => buildRegistry({ ...base, topics: [topic({ related: ['nope'] })] })).toThrow(/unknown related topic/);
  });
});

describe('resolveTopic — one lookup for the tooltip and the panel', () => {
  const registry = buildRegistry({
    topics: [
      topic({ id: 'settings.entryFee', title: 'Entry fee' }),
      topic({ id: 'NFL_SURVIVOR:settings.entryFee', title: 'Entry fee and buy-backs' }),
    ],
    placements: [],
    pages: [],
    glossary: [],
  });

  it('prefers the pool-type variant when the viewer is in that type', () => {
    expect(registry.resolveTopic({ poolType: 'NFL_SURVIVOR' }, 'settings.entryFee')?.title)
      .toBe('Entry fee and buy-backs');
  });

  it('falls back to the unqualified topic for another pool type', () => {
    expect(registry.resolveTopic({ poolType: 'NFL_PICKEM' }, 'settings.entryFee')?.title).toBe('Entry fee');
  });

  it('falls back to the unqualified topic with no pool in scope', () => {
    expect(registry.resolveTopic({}, 'settings.entryFee')?.title).toBe('Entry fee');
  });

  it('honours an explicitly qualified id regardless of scope', () => {
    expect(registry.resolveTopic({ poolType: 'NFL_PICKEM' }, 'NFL_SURVIVOR:settings.entryFee')?.title)
      .toBe('Entry fee and buy-backs');
  });

  it('returns undefined rather than a wrong topic when nothing matches', () => {
    expect(registry.resolveTopic({ poolType: 'SQUARES' }, 'settings.nothing')).toBeUndefined();
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
        topic({ id: 'NFL_SURVIVOR:settings.entryFee', title: 'Entry fee and buy-backs' }),
      ],
      pages: [page({ id: 'pool.survivor', route: '/pool/:id' })],
      placements: [{ topic: 'settings.entryFee', page: 'pool.survivor' }],
      glossary: [],
    });
    const fromTooltip = scoped.resolveTopic({ poolType: 'NFL_SURVIVOR' }, 'settings.entryFee');
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

  it('renders a template when only the pool type is known', () => {
    expect(resolveCopy(templated.short, { poolType: 'NFL_PICKEM' })).toBe('Fee is undefined.');
  });

  /**
   * The wizard, the site pages and the search index have no pool. A template
   * run there would put the word "undefined" in front of a reader, which is
   * exactly what `fallback` exists to prevent.
   */
  it('falls back when no pool is in scope', () => {
    expect(resolveCopy(templated.short)).toBe('Your commissioner sets the fee.');
    expect(resolveCopy(templated.short, {})).toBe('Your commissioner sets the fee.');
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
        topic({ id: 'NFL_SURVIVOR:settings.entryFee', title: 'Entry fee and buy-backs', long: 'Dues wording plus buy-backs.' }),
      ],
      pages: [page({ id: 'pool.survivor', route: '/pool/:id' })],
      placements: [{ topic: 'settings.entryFee', page: 'pool.survivor' }],
      glossary: [],
    });
    const hit = scoped
      .search('buy-backs', { audience: 'member' })
      .find((h) => h.id === 'NFL_SURVIVOR:settings.entryFee');
    expect(hit?.pageId).toBe('pool.survivor');
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
  const topics = [...helpRegistry.topics.values()];

  it('every topic has at least one placement', () => {
    const placed = new Set(helpRegistry.placements.map((p) => p.topic));
    const orphans = topics.filter((t) => !placed.has(normalizePath(t.id))).map((t) => t.id);
    expect(orphans).toEqual([]);
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

  // T0 ships the mechanism and the glossary; the copy lands with the
  // components that read it. This asserts the SHAPE of that state rather than
  // letting an accidentally-empty registry look like a passing one later.
  it('T0 state: no topics or pages yet, and a full glossary', () => {
    expect(topics).toEqual([]);
    expect(PAGES).toEqual([]);
    expect(helpRegistry.glossary.length).toBeGreaterThan(30);
  });
});
