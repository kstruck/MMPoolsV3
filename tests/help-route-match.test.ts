import { describe, it, expect } from 'vitest';
import { hrefForPage, isPageOffered, pageSpecificity, resolveHelpPage } from '../src/help/route-match';
import { helpRegistry } from '../src/help/registry';
import type { HelpPage, HelpRouteContext } from '../src/help/types';

/**
 * Route → Help page matching — PLAN-HELP-SYSTEM.md §3 D3, ticket T2.
 *
 * The resolution order is the whole of "which screen am I on", and it is a pure
 * function, so it is tested here rather than through a rendered drawer. Every
 * assertion that could pass vacuously carries a discriminating fixture: the
 * repeated defect in this repo is a guard that matches nothing and reports
 * success (four so far, one of them T1's own coverage test).
 */

const page = (over: Partial<HelpPage> & Pick<HelpPage, 'id'>): HelpPage => ({
  route: '/pool/:id',
  title: over.id,
  summary: 'A summary.',
  poolTypes: 'all',
  audience: ['member', 'commissioner'],
  ...over,
});

const ctx = (over: Partial<HelpRouteContext> = {}): HelpRouteContext => ({
  pathname: '/pool/abc',
  ...over,
});

// The signature takes the AUDIENCE only — the pool type rides on the route
// context, so there is exactly one answer to "which pool type is this".
const MEMBER = 'member' as const;
const HOST = 'commissioner' as const;

describe('pageSpecificity', () => {
  it('rejects a page whose route is a different path', () => {
    expect(pageSpecificity(page({ id: 'a', route: '/create/pickem' }), ctx())).toBe(-1);
  });

  it('matches a parameterised route against a real path', () => {
    expect(pageSpecificity(page({ id: 'a' }), ctx())).toBe(0);
  });

  it('scores a tab page above the route page, and both above no match', () => {
    const route = pageSpecificity(page({ id: 'route' }), ctx({ tab: 'picks' }));
    const tab = pageSpecificity(page({ id: 'tab', tab: 'picks' }), ctx({ tab: 'picks' }));
    const sub = pageSpecificity(
      page({ id: 'sub', tab: 'manager', subTab: 'members' }),
      ctx({ tab: 'manager', subTab: 'members' }),
    );
    expect(tab).toBeGreaterThan(route);
    expect(sub).toBeGreaterThan(tab);
  });

  it('rejects a tab page when the reader is on a different tab', () => {
    expect(pageSpecificity(page({ id: 'a', tab: 'picks' }), ctx({ tab: 'rules' }))).toBe(-1);
  });

  it('keeps the route page as a candidate whatever the tab — that is what makes it the fallback', () => {
    expect(pageSpecificity(page({ id: 'a' }), ctx({ tab: 'anything-at-all' }))).toBe(0);
  });

  it('honours an explicit match predicate', () => {
    const p = page({ id: 'a', match: (c) => c.isManager === true });
    expect(pageSpecificity(p, ctx({ isManager: true }))).toBe(0);
    expect(pageSpecificity(p, ctx({ isManager: false }))).toBe(-1);
  });
});

describe('resolveHelpPage', () => {
  const pages: HelpPage[] = [
    page({ id: 'root' }),
    page({ id: 'picks', tab: 'picks' }),
    page({ id: 'manager', tab: 'manager', audience: ['commissioner'] }),
    page({ id: 'manager.members', tab: 'manager', subTab: 'members', audience: ['commissioner'] }),
    page({ id: 'wizard', route: '/create/pickem', poolTypes: ['NFL_PICKEM'] }),
  ];

  it('falls back to the route page when no tab matches', () => {
    expect(resolveHelpPage(pages, ctx({ tab: 'recaps' }), MEMBER)?.id).toBe('root');
  });

  it('prefers the tab page over the route page', () => {
    expect(resolveHelpPage(pages, ctx({ tab: 'picks' }), MEMBER)?.id).toBe('picks');
  });

  it('prefers the sub-tab page over its tab page', () => {
    const found = resolveHelpPage(pages, ctx({ tab: 'manager', subTab: 'members' }), HOST);
    expect(found?.id).toBe('manager.members');
  });

  it('falls back from the sub-tab page to the tab page when no sub-tab is published', () => {
    expect(resolveHelpPage(pages, ctx({ tab: 'manager' }), HOST)?.id).toBe('manager');
  });

  /**
   * The one that would be a live privacy bug rather than a missing summary: a
   * commissioner-only page must not become a member's current page merely
   * because it ranked higher on the same tab.
   */
  it('never returns a page the reader may not see, even when it is the most specific', () => {
    const found = resolveHelpPage(pages, ctx({ tab: 'manager', subTab: 'members' }), MEMBER);
    expect(found?.id).toBe('root');
    // Discriminating half: the same call for a commissioner DOES return it, so
    // the assertion above is about audience and not about a broken fixture.
    expect(resolveHelpPage(pages, ctx({ tab: 'manager', subTab: 'members' }), HOST)?.id)
      .toBe('manager.members');
  });

  it('drops a pool-type-scoped page for a reader with no pool in scope', () => {
    expect(resolveHelpPage(pages, ctx({ pathname: '/create/pickem' }), MEMBER)).toBeUndefined();
    expect(
      resolveHelpPage(pages, ctx({ pathname: '/create/pickem', poolType: 'NFL_PICKEM' }), MEMBER)?.id,
    ).toBe('wizard');
  });

  it('returns undefined when nothing covers the route', () => {
    expect(resolveHelpPage(pages, ctx({ pathname: '/privacy' }), MEMBER)).toBeUndefined();
  });
});

describe('offeredTabs — a tab this pool does not have is not a screen', () => {
  /**
   * codex R3. A Survivor pool has no Results tab (`NFLPoolDashboard.tsx`
   * `showResultsTab`), so listing "NFL pool — Results" for one produced a link
   * that changed the URL and landed back on the dashboard. The condition lives
   * in the dashboard, so the dashboard publishes the list rather than the help
   * content re-deriving it.
   */
  const results = () => helpRegistry.getPage('pool.nfl.results')!;
  const survivor = (over: Partial<HelpRouteContext> = {}) =>
    ctx({
      pathname: '/pool/abc',
      poolType: 'NFL_SURVIVOR',
      tab: 'dashboard',
      // What `NFLPoolDashboard` publishes for a Survivor pool: no `results`.
      offeredTabs: ['dashboard', 'picks', 'grid', 'standings', 'recaps', 'rules', 'payments'],
      ...over,
    });

  it('is not offered, and therefore not linkable', () => {
    expect(isPageOffered(results(), survivor())).toBe(false);
    expect(hrefForPage(results(), survivor())).toBeNull();
  });

  it('IS offered to a Pick’em pool, which has the tab', () => {
    const pickem = ctx({
      pathname: '/pool/abc',
      poolType: 'NFL_PICKEM',
      tab: 'dashboard',
      offeredTabs: ['dashboard', 'picks', 'standings', 'results', 'recaps', 'rules'],
    });
    expect(isPageOffered(results(), pickem)).toBe(true);
    expect(hrefForPage(results(), pickem)).toBe('/pool/abc?tab=results');
  });

  it('makes no claim when the surface published none', () => {
    // A surface with no conditional tabs does not have to publish a list, and
    // absence must not hide every tab page it has.
    expect(isPageOffered(results(), ctx({ pathname: '/pool/abc', poolType: 'NFL_PICKEM' }))).toBe(true);
  });

  it('does not judge a page on a DIFFERENT route by this surface’s tabs', () => {
    // A wizard step page has nothing to do with which tabs a pool dashboard
    // offers, and filtering it out here would empty "All pages" of everything
    // but the current surface.
    const step = helpRegistry.getPage('wizard.pickem.rules')!;
    expect(isPageOffered(step, survivor())).toBe(true);
  });

  it('never filters the page with no tab at all', () => {
    expect(isPageOffered(helpRegistry.getPage('pool.nfl')!, survivor())).toBe(true);
  });
});

describe('altRoutes — the same screen under a second App.tsx route', () => {
  /**
   * `/admin/:id` renders the very same dashboard as `/pool/:id` for NFL,
   * Playoff, Bracket and Props (`AdminRoute.tsx`). A commissioner who followed a
   * "manage" link must not be told there is no guide for a screen that has one.
   */
  it('matches a page on its altRoute as well as its route', () => {
    const found = resolveHelpPage(
      helpRegistry.pages,
      ctx({ pathname: '/admin/abc', tab: 'standings', poolType: 'BRACKET' }),
      HOST,
    );
    expect(found?.id).toBe('pool.bracket.standings');
  });

  it('does NOT lend its altRoute to a type that has its own panel there', () => {
    // Squares really does have a separate manager panel on `/admin/:id`, so its
    // `/pool/:id` grid page must not follow the reader there.
    const squaresGrid = helpRegistry.getPage('pool.squares')!;
    expect(squaresGrid.altRoutes).toBeUndefined();
    const found = resolveHelpPage(
      helpRegistry.pages,
      ctx({ pathname: '/admin/abc', tab: 'settings', poolType: 'SQUARES' }),
      HOST,
    );
    expect(found?.id).toBe('admin.squares.settings');
  });

  it('the fixture discriminates: a page with no altRoute does not match the other route', () => {
    const p = page({ id: 'a', route: '/pool/:id' });
    expect(pageSpecificity(p, ctx({ pathname: '/admin/abc' }))).toBe(-1);
    expect(pageSpecificity({ ...p, altRoutes: ['/admin/:id'] }, ctx({ pathname: '/admin/abc' }))).toBe(0);
  });
});

describe('hrefForPage', () => {
  it('is null for a page that declares no href', () => {
    expect(hrefForPage(page({ id: 'a' }), ctx())).toBeNull();
  });

  it('is null for a wizard STEP page — a URL cannot put the reader on a step', () => {
    const step = helpRegistry.getPage('wizard.pickem.rules');
    expect(step).toBeDefined();
    expect(hrefForPage(step!, ctx({ pathname: '/create/pickem', poolType: 'NFL_PICKEM' }))).toBeNull();
    // And the route-level page IS linkable, so the null above is a decision.
    expect(hrefForPage(helpRegistry.getPage('wizard.pickem')!, ctx())).toBe('/create/pickem');
  });
});

describe('the real page list, resolved as a reader would meet it', () => {
  it('an NFL member on the picks tab lands on the NFL picks page', () => {
    const found = resolveHelpPage(
      helpRegistry.pages,
      ctx({ pathname: '/pool/abc', tab: 'picks', poolType: 'NFL_PICKEM' }),
      MEMBER,
    );
    expect(found?.id).toBe('pool.nfl.picks');
  });

  it('a bracket member on the same path gets the bracket page, not the NFL one', () => {
    const found = resolveHelpPage(
      helpRegistry.pages,
      ctx({ pathname: '/pool/abc', tab: 'standings', poolType: 'BRACKET' }),
      MEMBER,
    );
    expect(found?.id).toBe('pool.bracket.standings');
  });

  it('a member on the NFL manager tab gets the pool root, not the commissioner page', () => {
    const found = resolveHelpPage(
      helpRegistry.pages,
      ctx({ pathname: '/pool/abc', tab: 'manager', poolType: 'NFL_PICKEM' }),
      MEMBER,
    );
    expect(found?.id).toBe('pool.nfl');
  });

  it('a commissioner in an NFL manager section gets that section page', () => {
    const found = resolveHelpPage(
      helpRegistry.pages,
      ctx({ pathname: '/pool/abc', tab: 'manager', subTab: 'scoring', poolType: 'NFL_MARGIN' }),
      HOST,
    );
    expect(found?.id).toBe('pool.nfl.manager.scoring');
  });

  it('a commissioner on a wizard step gets that step page', () => {
    const found = resolveHelpPage(
      helpRegistry.pages,
      ctx({ pathname: '/create/playoff', tab: 'details', poolType: 'NFL_PLAYOFFS' }),
      HOST,
    );
    expect(found?.id).toBe('wizard.playoff.details');
  });

  it('the squares manager panel resolves per tab on /admin/:id', () => {
    const found = resolveHelpPage(
      helpRegistry.pages,
      ctx({ pathname: '/admin/xyz', tab: 'payouts', poolType: 'SQUARES' }),
      HOST,
    );
    expect(found?.id).toBe('admin.squares.payouts');
  });

  /**
   * `href` builds from the path the reader is on, so a page belonging to
   * ANOTHER pool type must refuse rather than send them to a tab their pool has
   * never heard of. Reachable through the "Show all pool types" expander.
   */
  it('a pool page refuses to build a link from a different pool type’s path', () => {
    const bracketStandings = helpRegistry.getPage('pool.bracket.standings')!;
    expect(hrefForPage(bracketStandings, ctx({ pathname: '/pool/abc', poolType: 'BRACKET' })))
      .toBe('/pool/abc?tab=standings');
    expect(hrefForPage(bracketStandings, ctx({ pathname: '/pool/abc', poolType: 'NFL_PICKEM' }))).toBeNull();
  });

  /**
   * codex R11. A pool URL carries state Help knows nothing about — `?week=3` on
   * the NFL results tab, `?action=create` on the bracket dashboard — and the
   * dashboards' own tab setters preserve it. A help link that rebuilt the query
   * from scratch would silently reset the reader's week.
   */
  it('replaces the tab and keeps every other query parameter', () => {
    const standings = helpRegistry.getPage('pool.nfl.standings')!;
    const href = hrefForPage(
      standings,
      ctx({ pathname: '/pool/abc', search: '?tab=results&week=3', poolType: 'NFL_PICKEM' }),
    );
    expect(href).toContain('week=3');
    expect(href).toContain('tab=standings');
    expect(href).not.toContain('tab=results');
  });

  it('clears a sub-tab the destination does not have, so no section is deep-linked by accident', () => {
    const standings = helpRegistry.getPage('pool.nfl.standings')!;
    const href = hrefForPage(
      standings,
      ctx({ pathname: '/pool/abc', search: '?tab=manager&section=members', poolType: 'NFL_PICKEM' }),
    );
    expect(href).not.toContain('section=');
    // …and a page that DOES name one still sets it, so the clear is a decision.
    const members = helpRegistry.getPage('pool.nfl.manager.members')!;
    expect(hrefForPage(members, ctx({ pathname: '/pool/abc', search: '?tab=picks', poolType: 'NFL_PICKEM' })))
      .toContain('section=members');
  });

  it('the pool root link drops the tab but keeps the rest', () => {
    const root = helpRegistry.getPage('pool.nfl')!;
    const href = hrefForPage(root, ctx({ pathname: '/pool/abc', search: '?tab=results&week=3', poolType: 'NFL_PICKEM' }));
    expect(href).toBe('/pool/abc?week=3');
  });

  it('the NFL manager sections link with `section=`, the parameter already live in shared links', () => {
    const members = helpRegistry.getPage('pool.nfl.manager.members')!;
    expect(hrefForPage(members, ctx({ pathname: '/pool/abc', poolType: 'NFL_PICKEM' })))
      .toBe('/pool/abc?tab=manager&section=members');
  });
});
