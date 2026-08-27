import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { helpRegistry } from '../src/help/registry';
import { SITE_PAGES } from '../src/help/content/site-pages';
import { ROUTE_ALLOWLIST } from '../src/help/coverage-allowlist';
import { canOpenPage, hrefForPage, isPageOffered, resolveHelpPage } from '../src/help/route-match';
import { AUDIENCES, type Audience, type HelpPage, type HelpRouteContext } from '../src/help/types';

/**
 * T3 content guard — PLAN-HELP-SYSTEM.md §7.
 *
 * `help-registry-invariants.test.ts` proves the content is WELL-FORMED (every
 * route exists in App.tsx, every summary is inside the length budget, no banned
 * word). This file proves the three things about T3 that nothing else can see,
 * each of which is a way for a page to look authored and help nobody:
 *
 *  1. **Every one of the twenty-one routes actually RESOLVES.** A page whose
 *     `poolTypes` or `audience` is wider or narrower than the scope its own
 *     route publishes is a search result the panel cannot open. Site routes
 *     publish no pool type and no audience, so the only reachable scope there
 *     is `poolTypes: 'all'` + a `member` audience — and a page scoped
 *     `['commissioner']`, which reads like the right answer for the pool
 *     picker, would be invisible to the commissioner standing on it.
 *
 *  2. **The tab-bearing surfaces are covered TAB BY TAB, from their own
 *     source.** The tab ids are parsed out of `ParticipantDashboard.tsx` and
 *     `Scoreboard.tsx` rather than restated here, so a tab added tomorrow fails
 *     this file until it has a summary.
 *
 *  3. **`hrefForPage` is either a working link or a deliberate `null`.** Three
 *     site pages cannot be linked to and one must not be; a fourth group
 *     (`/participant`) CAN be, and only because that surface adopts `?tab=`.
 *     The pins below are what keeps those two groups from swapping places.
 *
 * Every check that could pass vacuously carries a discriminating fixture.
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** The reader every site route actually produces — see rule 2 in site-pages.ts. */
const MEMBER: Audience = 'member';

/** A concrete pathname for a react-router pattern. */
function concretePath(route: string): string {
  return route.replace(/:([A-Za-z]+)/g, (_m, name: string) => `sample-${name}`);
}

const ctx = (over: Partial<HelpRouteContext> & Pick<HelpRouteContext, 'pathname'>): HelpRouteContext => over;

/** The twenty-one App.tsx routes this ticket owns. */
const T3_ROUTES: readonly string[] = [
  '/',
  '/gameday-squares',
  '/march-madness',
  '/nfl-playoffs',
  '/pricing',
  '/payment-success',
  '/about',
  '/charity',
  '/browse',
  '/features',
  '/how-it-works',
  '/privacy',
  '/terms',
  '/contact',
  '/profile',
  '/profile/:uid',
  '/scoreboard',
  '/odds/super-bowl-squares',
  '/participant',
  '/create-pool',
  '/join/:poolId',
];

describe('T3 — every site and account route resolves a page', () => {
  it('covers all twenty-one routes for the reader those routes produce', () => {
    const uncovered = T3_ROUTES.filter(
      (route) => resolveHelpPage(helpRegistry.pages, ctx({ pathname: concretePath(route) }), MEMBER) === undefined,
    );
    expect(uncovered).toEqual([]);
    // Discriminating half: the resolver still says "nothing here" for a route
    // T3 does not own, so the assertion above is about coverage and not about a
    // resolver that answers every path.
    expect(resolveHelpPage(helpRegistry.pages, ctx({ pathname: '/no/such/route' }), MEMBER)).toBeUndefined();
  });

  it('takes all twenty-one rows out of ROUTE_ALLOWLIST and leaves the rest alone', () => {
    const stillListed = T3_ROUTES.filter((route) => route in ROUTE_ALLOWLIST);
    expect(stillListed).toEqual([]);
    // T14's rows are not this ticket's to delete.
    expect(ROUTE_ALLOWLIST['/super-admin']).toBeDefined();
    expect(ROUTE_ALLOWLIST['/tournament-sim']).toBeDefined();
  });
});

/**
 * WHY THIS IS THE CENTRAL CHECK. A page declares a scope; the route it sits on
 * produces one. When the first is wider than the second the page is search-only
 * — it appears in results and nothing can open it — which is the defect a codex
 * round found on a sibling ticket.
 */
describe('T3 — no page is scoped wider than the readers who can reach it', () => {
  it('every site page is openable by every audience it declares, on its own route', () => {
    const unreachable = SITE_PAGES.flatMap((page) =>
      page.audience
        .filter((audience) => !canOpenPage(page, ctx({ pathname: concretePath(page.route) }), audience))
        .map((audience) => `${page.id} @ ${audience}`),
    );
    expect(unreachable).toEqual([]);
  });

  it('a commissioner-scoped site page would NOT be reachable — which is why none is', () => {
    // The discriminating fixture, and the reason `SITE_AUDIENCE` is `['member']`
    // even for the host-facing screens. Site routes publish no audience, so the
    // panel's reader is `member`, and `AUDIENCE_SEES.member` is `['member']`.
    const picker = helpRegistry.getPage('site.create-pool')!;
    const planted: HelpPage = { ...picker, id: 'planted', audience: ['commissioner'] };
    expect(canOpenPage(picker, ctx({ pathname: '/create-pool' }), MEMBER)).toBe(true);
    expect(canOpenPage(planted, ctx({ pathname: '/create-pool' }), MEMBER)).toBe(false);
    expect(resolveHelpPage([planted], ctx({ pathname: '/create-pool' }), MEMBER)).toBeUndefined();
  });

  it('a pool-type-scoped site page would NOT be reachable either', () => {
    // The other half of the same rule: `scopeIncludesPoolType` gives a reader
    // with no pool in scope only the `'all'` entries, and no site route
    // publishes a pool type.
    const home = helpRegistry.getPage('site.home')!;
    const planted: HelpPage = { ...home, id: 'planted', poolTypes: ['SQUARES'] };
    expect(canOpenPage(home, ctx({ pathname: '/' }), MEMBER)).toBe(true);
    expect(canOpenPage(planted, ctx({ pathname: '/' }), MEMBER)).toBe(false);
  });

  it('every site page declares the widest reachable scope, so no audience is shut out', () => {
    const wrong = SITE_PAGES.filter((p) => p.poolTypes !== 'all' || p.audience.join() !== 'member').map((p) => p.id);
    expect(wrong).toEqual([]);
    // And that scope really is the widest: an admin sees member copy too.
    const everyAudienceSees = AUDIENCES.filter((audience) =>
      canOpenPage(helpRegistry.getPage('site.home')!, ctx({ pathname: '/' }), audience),
    );
    expect(everyAudienceSees).toEqual([...AUDIENCES]);
  });
});

/**
 * The tab ids, PARSED FROM THE SURFACES rather than restated.
 *
 * Both components declare their tabs as a union on the `activeTab` state, which
 * is the one place a new tab cannot be added without touching. The default is
 * the `useState` argument, so voice rule 5 ("name the default, exactly") is
 * checkable here rather than taken on trust.
 */
function parseActiveTabState(source: string, file: string): { tabs: string[]; fallback: string } {
  const m = /const \[activeTab, setActiveTab\] = useState<([^>]+)>\('([^']+)'\)/.exec(source);
  if (!m) throw new Error(`could not find the activeTab state in ${file}`);
  const tabs = [...m[1].matchAll(/'([^']+)'/g)].map((hit) => hit[1]);
  if (tabs.length === 0) throw new Error(`the activeTab union in ${file} named no tabs`);
  return { tabs, fallback: m[2] };
}

/** Page ids on `route` that name `tab`, through the resolver rather than by id. */
function pageForTab(route: string, tab: string | undefined): string | undefined {
  return resolveHelpPage(helpRegistry.pages, ctx({ pathname: concretePath(route), tab }), MEMBER)?.id;
}

describe('T3 — /participant is covered tab by tab', () => {
  const source = read('src/components/ParticipantDashboard.tsx');
  const { tabs, fallback } = parseActiveTabState(source, 'ParticipantDashboard.tsx');

  it('reads a plausible tab list out of the surface', () => {
    // Guards the parse itself: a regex that silently matched nothing would make
    // every loop below vacuous. Deliberately NOT an exact list — a tab added
    // tomorrow should fail the coverage check below (no summary), not this one.
    // Measured 2026-08-27: SEVEN tabs, not the six `ROUTE_ALLOWLIST` claimed.
    expect(tabs.length).toBeGreaterThanOrEqual(7);
    expect(tabs).toContain('commissioner');
    expect(tabs).toContain('entries');
    // Voice rule 5, checked rather than trusted: the root page's copy says the
    // surface opens on Empire Overview, which is this id.
    expect(fallback).toBe('insights');
  });

  it('every tab the surface can publish resolves to its own page', () => {
    const missing = tabs.filter((tab) => {
      const id = pageForTab('/participant', tab);
      return id === undefined || id === 'account.entries';
    });
    expect(missing).toEqual([]);
  });

  it('a tab with no page falls back to the route page rather than to nothing', () => {
    // Discriminating fixture: proves the check above is reading the TAB and not
    // merely finding the route page every time.
    expect(pageForTab('/participant', 'no-such-tab')).toBe('account.entries');
    expect(pageForTab('/participant', undefined)).toBe('account.entries');
  });

  /**
   * DRIFT PIN, and it is load-bearing rather than cosmetic: the `href` on every
   * `/participant` tab page is `?tab=<id>`, and that only lands the reader on
   * the tab because the surface adopts a valid `?tab=` on mount. If that
   * `valid` list stops agreeing with the union, some of those links quietly
   * start doing nothing.
   */
  it('the surface still adopts ?tab=, for exactly the tabs it declares', () => {
    expect(source).toContain("new URLSearchParams(location.search).get('tab')");
    const valid = /const valid = \[([^\]]+)\]/.exec(source);
    expect(valid).not.toBeNull();
    const accepted = [...valid![1].matchAll(/'([^']+)'/g)].map((hit) => hit[1]);
    expect(accepted.sort()).toEqual([...tabs].sort());
  });

  /**
   * CODEX R1 P2 — the Commissioner Hub tab is CONDITIONAL, and Help was
   * offering its page unconditionally.
   *
   * `ParticipantDashboard` renders that tab only for someone who owns or
   * co-runs a pool, so for everyone else the "All pages" row navigated to
   * `?tab=commissioner` — a tab their own strip does not have.
   * `HelpRouteContext.offeredTabs` exists for exactly this: the surface
   * publishes the list it just rendered. These two checks are the mechanism
   * (does the page respect the list) and the wiring (does the surface send it).
   */
  it('a tab the surface did not render is neither offered nor openable', () => {
    const hub = helpRegistry.getPage('account.entries.commissioner')!;
    const overview = helpRegistry.getPage('account.entries.insights')!;
    const withoutHub = tabs.filter((t) => t !== 'commissioner');

    expect(isPageOffered(hub, ctx({ pathname: '/participant', offeredTabs: withoutHub }))).toBe(false);
    expect(canOpenPage(hub, ctx({ pathname: '/participant', offeredTabs: withoutHub }), MEMBER)).toBe(false);
    expect(hrefForPage(hub, ctx({ pathname: '/participant', offeredTabs: withoutHub }))).toBeNull();
    // Discriminating half, twice over: an unconditional tab survives the same
    // filter, and the hub itself comes back the moment the strip carries it —
    // so this is measuring the published list and not simply refusing the page.
    expect(canOpenPage(overview, ctx({ pathname: '/participant', offeredTabs: withoutHub }), MEMBER)).toBe(true);
    expect(canOpenPage(hub, ctx({ pathname: '/participant', offeredTabs: tabs }), MEMBER)).toBe(true);
  });

  it('the surface publishes offeredTabs, built from the array it renders the strip from', () => {
    // DRIFT PIN. The whole value of the check above is that the published list
    // is the RENDERED list; a second copy of the ownership test would drift from
    // the strip and put the dead row straight back.
    expect(source).toContain('<HelpRoutePublisher tab={activeTab} offeredTabs={offeredTabs} />');
    expect(source).toMatch(/const offeredTabs = useMemo\(\(\) => tabStrip\.map\(t => t\.id\), \[tabStrip\]\);/);
    expect(source).toContain('{tabStrip.map(tab => (');
    // And the conditional member of that one array is the Commissioner Hub.
    expect(source).toMatch(/managed > 0 \? \[\{ id: 'commissioner'/);
  });

  it('each tab page links to its own tab', () => {
    const own = SITE_PAGES.filter((p) => p.route === '/participant' && p.tab !== undefined);
    expect(own.length).toBe(tabs.length);
    const wrong = own
      .filter((p) => hrefForPage(p, ctx({ pathname: '/participant' })) !== `/participant?tab=${p.tab}`)
      .map((p) => p.id);
    expect(wrong).toEqual([]);
  });
});

describe('T3 — /scoreboard is covered tab by tab', () => {
  const source = read('src/components/Scoreboard.tsx');
  const { tabs, fallback } = parseActiveTabState(source, 'Scoreboard.tsx');

  it('reads a plausible tab list out of the surface', () => {
    // Same shape as the /participant sanity check: a floor and two sentinels,
    // so a fourth tab fails the coverage assertion rather than this one.
    expect(tabs.length).toBeGreaterThanOrEqual(3);
    expect(tabs).toContain('college');
    expect(tabs).toContain('basketball');
    // Voice rule 5: the root page's copy says it opens on NFL.
    expect(fallback).toBe('nfl');
  });

  it('every tab the surface can publish resolves to its own page', () => {
    const missing = tabs.filter((tab) => {
      const id = pageForTab('/scoreboard', tab);
      return id === undefined || id === 'site.scoreboard';
    });
    expect(missing).toEqual([]);
    expect(pageForTab('/scoreboard', 'no-such-tab')).toBe('site.scoreboard');
  });

  /**
   * DRIFT PIN on the reason these three pages are UNLINKABLE while
   * `/participant`'s are not: this surface holds its tab in memory only. The
   * day it adopts `useUrlTab` or reads a query parameter, the `href: null`
   * below becomes a lie and these pages should gain real links.
   */
  it('the surface reads no query parameter, which is why its tab pages are unlinkable', () => {
    expect(source).not.toMatch(/useSearchParams|useUrlTab|searchParams/);
    const own = SITE_PAGES.filter((p) => p.route === '/scoreboard' && p.tab !== undefined);
    expect(own.length).toBe(tabs.length);
    expect(own.map((p) => hrefForPage(p, ctx({ pathname: '/scoreboard' })))).toEqual(own.map(() => null));
    // …and unlinkable is not the same as unreachable: the reader standing on
    // the tab still opens its page in place.
    expect(canOpenPage(helpRegistry.getPage('site.scoreboard.college')!, ctx({ pathname: '/scoreboard' }), MEMBER))
      .toBe(true);
  });
});

describe('T3 — your profile and a player profile are two screens', () => {
  it('resolves distinctly, and neither is an altRoute of the other', () => {
    const mine = resolveHelpPage(helpRegistry.pages, ctx({ pathname: '/profile' }), MEMBER);
    const theirs = resolveHelpPage(helpRegistry.pages, ctx({ pathname: '/profile/abc123' }), MEMBER);
    expect(mine?.id).toBe('account.profile');
    expect(theirs?.id).toBe('account.player-profile');
    expect(mine!.id).not.toBe(theirs!.id);
    expect(SITE_PAGES.flatMap((p) => p.altRoutes ?? [])).toEqual([]);
  });

  /**
   * DRIFT PIN on the evidence for that decision. They are two components under
   * two `<Route>`s; if one day both routes render the same screen, `altRoutes`
   * becomes the right answer and these two pages should collapse into one.
   */
  it('App.tsx still renders a different component under each', () => {
    const app = read('src/App.tsx');
    expect(app).toMatch(/path="\/profile"[\s\S]{0,400}<UserProfile/);
    expect(app).toMatch(/path="\/profile\/:uid"[\s\S]{0,400}<PlayerProfile/);
  });
});

describe('T3 — every link is a working path or a deliberate null', () => {
  /** The pages that CANNOT be linked to, with the reason, so the set is reviewable. */
  const UNLINKABLE: Readonly<Record<string, string>> = {
    'account.profile': 'signed-in only, and nothing in HelpRouteContext says whether the reader is',
    'account.entries': 'signed-in only, and a link from /participant to /participant is not a destination',
    'site.create-pool': 'signed-in only, and also gated on canAccessPoolCreation',
    'site.payment-success': 'renders no Header, so no Help button; nothing should link to a stale receipt',
    'site.join': 'the URL needs a pool id this file cannot know',
    'account.player-profile': 'the URL needs a player id this file cannot know',
    'site.scoreboard.nfl': 'the tab is held in memory and no query parameter selects it',
    'site.scoreboard.college': 'the tab is held in memory and no query parameter selects it',
    'site.scoreboard.basketball': 'the tab is held in memory and no query parameter selects it',
  };

  it('returns null for exactly the declared set, and a usable path for the rest', () => {
    const nulls: string[] = [];
    const bad: string[] = [];
    for (const page of SITE_PAGES) {
      const href = hrefForPage(page, ctx({ pathname: concretePath(page.route) }));
      if (href === null) nulls.push(page.id);
      else if (!href.startsWith('/')) bad.push(`${page.id} → ${href}`);
    }
    expect(bad).toEqual([]);
    expect(nulls.sort()).toEqual(Object.keys(UNLINKABLE).sort());
  });

  it('a linkable page links to a path that route actually matches', () => {
    const wrong = SITE_PAGES.filter((page) => {
      if (page.id in UNLINKABLE) return false;
      const href = hrefForPage(page, ctx({ pathname: concretePath(page.route) }))!;
      return href.split('?')[0] !== page.route;
    }).map((p) => p.id);
    expect(wrong).toEqual([]);
  });

  it('an unlinkable page is still openable where it lives, and not from elsewhere', () => {
    const receipt = helpRegistry.getPage('site.payment-success')!;
    expect(canOpenPage(receipt, ctx({ pathname: '/payment-success' }), MEMBER)).toBe(true);
    expect(canOpenPage(receipt, ctx({ pathname: '/' }), MEMBER)).toBe(false);
  });

  /**
   * CODEX R1 P2 (×2) — a page advertised to a reader who cannot open it.
   *
   * `/profile`, `/participant` and `/create-pool` all render
   * `<Navigate to="/" replace/>` for a signed-out visitor, and the panel has no
   * way to know whether the reader is signed in: `HelpRouteContext` carries
   * `pathname`, `search`, the published tab/pool-type/manager flag and nothing
   * about auth. The honest answer while that is true is to decline the link.
   *
   * The five checks below are the whole of that decision, in the order it was
   * made: the gate is really in `App.tsx`; there is really no auth axis to
   * read; the pages therefore offer no cross-route link; the `/participant`
   * tab links survive only from `/participant`; and that from-own-route branch
   * is used only where its exact path compare is sound.
   */
  it('App.tsx really turns a signed-out reader away from all three', () => {
    const app = read('src/App.tsx');
    // The gate itself. If any of these three stops redirecting, the `null`
    // above stops being the honest answer and these pages should get links.
    expect(app).toMatch(/path="\/profile"[\s\S]{0,500}\) : <Navigate to="\/" replace \/>/);
    expect(app).toMatch(/path="\/participant"[\s\S]{0,500}<Navigate to="\/" replace \/>/);
    expect(app).toMatch(/path="\/create-pool"[\s\S]{0,900}\) : <Navigate to="\/" replace \/>/);
    // …and the pool picker carries a second gate on top of the auth one.
    expect(app).toContain('user && canAccessPoolCreation(user) ? (');
  });

  it('the panel has no way to know whether the reader is signed in', () => {
    // The reason the fix is a declined link rather than a conditional one. If
    // an auth axis is ever added to `HelpRouteContext`, this fails and the three
    // pages above can become conditional links instead of dead ones.
    const types = read('src/help/types.ts');
    const ctxBlock = /export interface HelpRouteContext \{[\s\S]*?[\r\n]\}/.exec(types);
    expect(ctxBlock).not.toBeNull();
    expect(ctxBlock![0]).not.toMatch(/isSignedIn|isAuthenticated|signedIn|currentUser/);
    // And nothing hands one in: the provider takes `isAdmin` and children.
    expect(read('src/components/help/HelpPanel.tsx')).toContain(
      'export function HelpProvider({ isAdmin, children }: { isAdmin: boolean; children: ReactNode })',
    );
  });

  it('offers no signed-in-only page as a link from a route a visitor can be on', () => {
    // The defect in its live shape: a logged-out visitor on the front page opens
    // Help, searches, and is handed a button that lands them back on the front
    // page. Every page in the file is checked, so a new one cannot quietly
    // reintroduce it — the expectation names the three by id.
    const SIGNED_IN_ONLY = ['account.profile', 'account.entries', 'site.create-pool'];
    const linkableFromHome = SITE_PAGES.filter(
      (page) => page.route !== '/' && hrefForPage(page, ctx({ pathname: '/' })) !== null,
    ).map((p) => p.id);
    for (const id of SIGNED_IN_ONLY) expect(linkableFromHome).not.toContain(id);
    // Discriminating half: a page that is NOT gated still links from there, so
    // the check above is about the gate and not about `hrefForPage` returning
    // null off-route for everything.
    expect(hrefForPage(helpRegistry.getPage('site.pricing')!, ctx({ pathname: '/' }))).toBe('/pricing');
  });

  it('the /participant tab links are offered from that route and nowhere else', () => {
    // The one concession: standing on `/participant` PROVES the reader is signed
    // in, because the route redirects otherwise — so a `?tab=` switch offered
    // there is a link that works, while the same link from `/` is not.
    const tabPages = SITE_PAGES.filter((p) => p.route === '/participant' && p.tab !== undefined);
    expect(tabPages.length).toBeGreaterThan(0);
    expect(tabPages.map((p) => hrefForPage(p, ctx({ pathname: '/participant' })))).toEqual(
      tabPages.map((p) => `/participant?tab=${p.tab}`),
    );
    expect(tabPages.map((p) => hrefForPage(p, ctx({ pathname: '/' })))).toEqual(tabPages.map(() => null));
    expect(tabPages.map((p) => canOpenPage(p, ctx({ pathname: '/' }), MEMBER))).toEqual(tabPages.map(() => false));
  });

  it('the from-own-route link is only used where an exact path compare is valid', () => {
    // `hrefFor`'s third branch compares `ctx.pathname` to `spec.route` exactly
    // rather than matching the pattern. That is only sound on a route with no
    // parameters. Every page whose link appears on its own route but not on
    // another must therefore have a parameterless route.
    const conditional = SITE_PAGES.filter(
      (p) =>
        hrefForPage(p, ctx({ pathname: concretePath(p.route) })) !== null &&
        hrefForPage(p, ctx({ pathname: '/somewhere-else' })) === null,
    );
    expect(conditional.map((p) => p.id).sort()).toEqual(
      SITE_PAGES.filter((p) => p.route === '/participant' && p.tab !== undefined).map((p) => p.id).sort(),
    );
    expect(conditional.filter((p) => p.route.includes(':')).map((p) => p.id)).toEqual([]);
  });

  /**
   * DRIFT PIN on "shortcut-only". The whole of `site.payment-success`'s copy —
   * "This screen has no header, so Help opens here only with the ? key" — is
   * true only while that route renders no `Header`.
   */
  it('the payment-success route really renders no Header', () => {
    expect(read('src/App.tsx')).toContain('<Route path="/payment-success" element={<PaymentSuccess />} />');
    expect(read('src/pages/PaymentSuccess.tsx')).not.toMatch(/\bHeader\b/);
  });
});

describe('T3 — /how-it-works is linked to, not duplicated', () => {
  /**
   * The allowlist row asked for a page that "links to rather than duplicating"
   * the four view modes and the FAQ. So: ONE page for the route, no page per
   * view, and no second copy of the FAQ in help copy.
   */
  it('has one page for the route and none per view mode', () => {
    const own = helpRegistry.pages.filter((p) => p.route === '/how-it-works');
    expect(own.map((p) => p.id)).toEqual(['site.how-it-works']);
    expect(own[0].tab).toBeUndefined();
  });

  it('names the four views the surface actually has', () => {
    const source = read('src/components/HowItWorksPage.tsx');
    const m = /type ViewMode = ([^;]+);/.exec(source);
    expect(m).not.toBeNull();
    const views = [...m![1].matchAll(/'([^']+)'/g)].map((hit) => hit[1]);
    expect(views).toEqual(['overview', 'strategy', 'faq', 'contact']);
    // The summary points at the surface's own labels for those four views, so a
    // renamed view is caught here rather than leaving the panel naming a tab
    // that is gone. These are LABELS, read from the same file.
    const summary = helpRegistry.getPage('site.how-it-works')!.summary;
    for (const label of ['How it Works', 'Strategy Guide', 'FAQs & Rules', 'Contact Support']) {
      expect(source).toContain(`label: '${label}'`);
      expect(summary).toContain(label);
    }
  });

  it('the view is not in ?tab=, so a per-view page could never resolve', () => {
    // The reason the row's instruction is also the only workable answer: the
    // panel reads `?tab=`, and this surface spells its view `?view=`.
    const source = read('src/components/HowItWorksPage.tsx');
    expect(source).toContain("searchParams.get('view')");
    expect(source).not.toContain("searchParams.get('tab')");
  });
});
