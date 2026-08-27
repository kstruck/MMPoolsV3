import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { __resetAdminRegistry, loadAdminRegistry } from '../src/help/admin';
import { helpRegistry } from '../src/help/registry';
import type { Registry } from '../src/help/registry';
import { PAGES } from '../src/help/pages';
import { ADMIN_PAGES } from '../src/help/content/super-admin';
import { ROUTE_ALLOWLIST } from '../src/help/coverage-allowlist';
import { canOpenPage, hrefForPage, resolveHelpPage } from '../src/help/route-match';
import { BANNED_IMPLEMENTATION_WORDS, BANNED_SELLING_WORDS, COPY_LIMITS, findBannedWords } from '../src/help/voice';
import type { HelpRouteContext } from '../src/help/types';

/**
 * T14 content guard — PLAN-HELP-SYSTEM.md §6 K4 scope ii.
 *
 * T14's claim is that an admin standing on ANY `/super-admin` tab gets a
 * summary, and that `/tournament-sim` has one. The generic registry guards
 * cannot prove that: they check that a page's `route` exists in `App.tsx`, and
 * `/super-admin` is ONE route shared by sixteen tabs — a single page would
 * satisfy every one of them while fifteen tabs showed nothing.
 *
 * So this file resolves a page the way the panel does, for every tab id read
 * OUT OF `SuperAdmin.tsx` rather than restated here. A tab added to the
 * component tomorrow fails until it has a summary, which is the only version
 * of this guard that keeps working after the ticket ships.
 *
 * Every check is paired with a planted counter-example, because a guard that
 * has stopped discriminating looks exactly like a guard that passes.
 */

const root = resolve(__dirname, '..');
const SUPER_ADMIN_SOURCE = readFileSync(resolve(root, 'src/components/SuperAdmin.tsx'), 'utf8');

/**
 * The sub-tab ids `SuperAdmin.tsx` actually renders, read from `navStructure`.
 *
 * `navStructure` is what the tab BUTTONS are built from and what
 * `setActiveTab` is called with, so it — not a list in a doc — is the set of
 * values `HelpRoutePublisher` can ever publish.
 */
export function parseNavTabIds(source: string): string[] {
  const at = source.indexOf('const navStructure');
  if (at === -1) return [];
  // Start AFTER the type annotation: `Record<NavGroup, { id: string; ... }[]>`
  // contains the word `id:` but no quoted value, so it cannot match below —
  // this is belt and braces, and it keeps the slice honest if that changes.
  const open = source.indexOf('= {', at);
  if (open === -1) return [];
  const end = source.indexOf('\n    };', open);
  if (end === -1) return [];
  const block = source.slice(open, end);
  const ids: string[] = [];
  const re = /\{\s*id:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) ids.push(m[1]);
  return ids;
}

/** The `activeTab` union in the same component — the second list of the same set. */
export function parseActiveTabUnion(source: string): string[] {
  const m = /const \[activeTab, setActiveTab\] = useState<([^>]*)>/.exec(source);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((hit) => hit[1]);
}

const NAV_TABS = parseNavTabIds(SUPER_ADMIN_SOURCE);

/** An admin standing on `/super-admin`, on `tab`. */
const onTab = (tab: string): HelpRouteContext => ({ pathname: '/super-admin', tab });

let admin: Registry;

beforeAll(async () => {
  __resetAdminRegistry();
  admin = await loadAdminRegistry();
});

describe('parseNavTabIds — the reader of the component', () => {
  it('reads a plausible tab list out of SuperAdmin.tsx', () => {
    // Guards the parser itself. Every assertion below would pass vacuously on
    // an empty list, which is the shape this repo keeps shipping by accident.
    expect(NAV_TABS.length).toBeGreaterThanOrEqual(8);
    expect(NAV_TABS).toContain('overview');
    expect(NAV_TABS).toContain('operations');
    expect(new Set(NAV_TABS).size).toBe(NAV_TABS.length);
  });

  it('finds nothing when the block it reads is not there', () => {
    // The discriminating half: a renamed `navStructure` must produce an EMPTY
    // list, which the plausibility check above then fails on — rather than a
    // list that silently keeps matching some other object literal.
    expect(parseNavTabIds('const other = { a: 1 };')).toEqual([]);
  });

  /**
   * The component holds the same set twice — `navStructure` builds the buttons,
   * and the `activeTab` union types the state. A member of one and not the
   * other is a tab nothing can reach or a button that cannot be selected, and
   * either way the help page for it would be measuring the wrong list.
   */
  it('agrees with the activeTab union type beside it', () => {
    const union = parseActiveTabUnion(SUPER_ADMIN_SOURCE);
    expect(union.length).toBeGreaterThanOrEqual(8);
    expect([...NAV_TABS].sort()).toEqual([...union].sort());
  });
});

describe('T14 — every /super-admin tab resolves to a page', () => {
  it('resolves a page whose tab is the one the reader is on, for every tab', () => {
    const missing = NAV_TABS.filter((tab) => {
      const page = resolveHelpPage(admin.pages, onTab(tab), 'admin');
      return page?.tab !== tab;
    });
    expect(missing).toEqual([]);
  });

  /**
   * The check above would pass on a single tab-less page if it only asserted
   * "a page came back": the root `/super-admin` page is a candidate on every
   * tab and always resolves. Comparing `page.tab` is what makes it real, and
   * this is the proof that it does.
   */
  it('a tab with no page of its own falls back to the root and IS reported', () => {
    const planted = resolveHelpPage(admin.pages, onTab('no-such-tab'), 'admin');
    expect(planted).toBeDefined();
    expect(planted?.id).toBe('super-admin');
    expect(planted?.tab).toBeUndefined();
    // …which is exactly what the guard above treats as missing.
    expect(planted?.tab === 'no-such-tab').toBe(false);
  });

  it('gives every tab a DISTINCT page rather than one page reused', () => {
    const ids = NAV_TABS.map((tab) => resolveHelpPage(admin.pages, onTab(tab), 'admin')?.id);
    expect(new Set(ids).size).toBe(NAV_TABS.length);
  });

  it('resolves the tournament simulator page', () => {
    const page = resolveHelpPage(admin.pages, { pathname: '/tournament-sim' }, 'admin');
    expect(page?.id).toBe('tournament-sim');
  });

  it('resolves the dashboard itself when no tab is published', () => {
    const page = resolveHelpPage(admin.pages, { pathname: '/super-admin' }, 'admin');
    expect(page?.id).toBe('super-admin');
  });
});

describe('T14 — who the admin pages are for', () => {
  it('shows nothing to a commissioner, on the route and on every tab', () => {
    expect(resolveHelpPage(admin.pages, { pathname: '/super-admin' }, 'commissioner')).toBeUndefined();
    expect(resolveHelpPage(admin.pages, { pathname: '/tournament-sim' }, 'commissioner')).toBeUndefined();
    const leaked = NAV_TABS.filter((tab) => resolveHelpPage(admin.pages, onTab(tab), 'commissioner') !== undefined);
    expect(leaked).toEqual([]);
  });

  it('shows nothing to a member either', () => {
    expect(resolveHelpPage(admin.pages, onTab('operations'), 'member')).toBeUndefined();
  });

  it('every admin page names admin as its only audience', () => {
    const wrong = ADMIN_PAGES.filter((p) => p.audience.length !== 1 || p.audience[0] !== 'admin').map((p) => p.id);
    expect(wrong).toEqual([]);
  });
});

/**
 * The chunk is the point (`src/help/admin.ts`): these summaries are fetched
 * only once a super admin opens the panel. If they leaked into `PAGES` they
 * would be in every member's bundle, and the split — and the comment in
 * `content/super-admin.ts` explaining it — would be decorative.
 */
describe('T14 — the admin pages stay in the lazily loaded chunk', () => {
  it('is not in the base registry', () => {
    expect(helpRegistry.getPage('super-admin')).toBeUndefined();
    expect(helpRegistry.getPage('super-admin.operations')).toBeUndefined();
    expect(resolveHelpPage(PAGES, onTab('operations'), 'admin')).toBeUndefined();
  });

  it('is in the admin registry, which is the base plus the chunk', () => {
    expect(admin.getPage('super-admin.operations')).toBeDefined();
    expect(admin.pages.length).toBe(helpRegistry.pages.length + ADMIN_PAGES.length);
  });
});

/**
 * K13: `SuperAdmin.tsx` keeps `activeTab` in memory and publishes it rather
 * than putting it in the URL, so no address opens a given tab. `href` must say
 * so — a page that claimed a link would be rendered as a button that goes to
 * the dashboard's default tab instead of the one it names.
 */
describe('T14 — K13 linkability', () => {
  const here = onTab('operations');
  const elsewhere: HelpRouteContext = { pathname: '/pool/abc123' };

  it('the route is linkable', () => {
    expect(hrefForPage(admin.getPage('super-admin')!, elsewhere)).toBe('/super-admin');
    expect(hrefForPage(admin.getPage('tournament-sim')!, elsewhere)).toBe('/tournament-sim');
  });

  it('no tab page is linkable, from the dashboard or anywhere else', () => {
    const linkable = NAV_TABS.filter((tab) => {
      const page = admin.getPage(`super-admin.${tab}`)!;
      return hrefForPage(page, here) !== null || hrefForPage(page, elsewhere) !== null;
    });
    expect(linkable).toEqual([]);
  });

  it('an unlinkable tab page still opens IN PLACE on the dashboard, and not from elsewhere', () => {
    const page = admin.getPage('super-admin.operations')!;
    expect(canOpenPage(page, here, 'admin')).toBe(true);
    expect(canOpenPage(page, elsewhere, 'admin')).toBe(false);
  });
});

describe('T14 — the copy', () => {
  it('obeys the length budget', () => {
    const over = ADMIN_PAGES.flatMap((p) => [
      ...(p.title.length > COPY_LIMITS.topicTitle ? [`${p.id}: title ${p.title.length} chars`] : []),
      ...(p.summary.length > COPY_LIMITS.pageSummary ? [`${p.id}: summary ${p.summary.length} chars`] : []),
    ]);
    expect(over).toEqual([]);
  });

  it('obeys the mechanically checkable voice rules', () => {
    const violations = ADMIN_PAGES.flatMap((p) => {
      const copy = `${p.title}\n${p.summary}`;
      const hits = [
        ...findBannedWords(copy, BANNED_SELLING_WORDS),
        ...findBannedWords(copy, BANNED_IMPLEMENTATION_WORDS),
      ];
      return hits.length ? [`${p.id}: ${hits.join(', ')}`] : [];
    });
    expect(violations).toEqual([]);
    // Discriminating half: rule 7 is the one this ticket is most likely to
    // break, and the check does catch it.
    expect(findBannedWords('Written by a callable, keyed by uid.', BANNED_IMPLEMENTATION_WORDS)).toEqual([
      'callable',
      'uid',
    ]);
  });

  it('says something specific on every page rather than repeating the title', () => {
    // Voice rule 2. Not a full check — a reviewer's job — but a summary that
    // is the title again, or is a stub, is caught mechanically.
    const thin = ADMIN_PAGES.filter((p) => p.summary.trim().length < 60 || p.summary.includes(p.title)).map((p) => p.id);
    expect(thin).toEqual([]);
  });
});

describe('T14 — the ticket is done when its allowlist rows are gone', () => {
  it('neither admin route is allowlisted any more', () => {
    expect('/super-admin' in ROUTE_ALLOWLIST).toBe(false);
    expect('/tournament-sim' in ROUTE_ALLOWLIST).toBe(false);
  });
});
