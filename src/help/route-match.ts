// Which Help page is the reader on — PLAN-HELP-SYSTEM.md §3 D3 (T2).
//
// A pure function over the page list and a `HelpRouteContext`, kept out of the
// components so the resolution order can be tested without a DOM.
//
// ORDER: `route + tab + subTab` → `route + tab` → `route`, each filtered by
// the page's own `match` and by what this reader may see. Spectrum falls back
// on the longest matching path PREFIX; that does not work here, because MMP's
// page identity depends on the pool type behind `/pool/:id` rather than on
// path depth — every pool of every type shares one route. So `match` carries
// the discrimination and the ranking below carries the specificity.

import { matchPath } from 'react-router';
import type { Audience, HelpPage, HelpRouteContext } from './types';
import { isEntryVisible } from './visibility';

/** Higher is more specific. `-1` means the page does not apply at all. */
export function pageSpecificity(page: HelpPage, ctx: HelpRouteContext): number {
  if (!onCurrentRoute(page, ctx)) return -1;
  // A page that names a tab is only that tab's page. A page that names none is
  // the route's page and stays a candidate whatever tab the reader is on —
  // that is what makes it the fallback rather than a competitor.
  if (page.tab !== undefined && page.tab !== ctx.tab) return -1;
  if (page.subTab !== undefined && page.subTab !== ctx.subTab) return -1;
  if (page.match && !page.match(ctx)) return -1;
  return (page.tab !== undefined ? 2 : 0) + (page.subTab !== undefined ? 1 : 0);
}

/**
 * The page for this reader at this location, or `undefined` when nothing
 * covers it — which is the honest answer while T3/T14 are unwritten, and is
 * what the panel renders its "nothing here yet" state from.
 *
 * Ties are broken by declaration order, so the page list reads top-down.
 */
export function resolveHelpPage(
  pages: readonly HelpPage[],
  ctx: HelpRouteContext,
  // AUDIENCE ONLY, not a whole scope. The pool type is already on `ctx`, and
  // taking it twice would let a caller pass two different answers to the same
  // question — the kind of split that this feature exists to stop.
  audience: Audience,
): HelpPage | undefined {
  const scope = { poolType: ctx.poolType, audience };
  let best: HelpPage | undefined;
  let bestScore = -1;
  for (const page of pages) {
    // Visibility is checked HERE and not after: a commissioner-only page must
    // never become the member's current page merely because it ranked higher.
    if (!isEntryVisible(page.poolTypes, page.audience, scope)) continue;
    const score = pageSpecificity(page, ctx);
    if (score > bestScore) {
      best = page;
      bestScore = score;
    }
  }
  return best;
}

/** Is this page on the route the reader is currently on? */
function onCurrentRoute(page: HelpPage, ctx: HelpRouteContext): boolean {
  return (
    matchPath(page.route, ctx.pathname) !== null ||
    (page.altRoutes ?? []).some((route) => matchPath(route, ctx.pathname) !== null)
  );
}

/**
 * Does the surface the reader is on actually offer this page's tab?
 *
 * ONE predicate, used by both "All pages" and `hrefForPage`, so a page cannot be
 * listed as reachable and then refuse to be reached (or the reverse). Judged
 * only for pages on the CURRENT route: a wizard step page has nothing to do with
 * whether a pool dashboard offers a Results tab.
 *
 * `offeredTabs` absent means the surface made no claim, so nothing is filtered —
 * a surface with no conditional tabs does not have to publish a list.
 */
export function isPageOffered(page: HelpPage, ctx: HelpRouteContext): boolean {
  if (page.tab === undefined) return true;
  if (!ctx.offeredTabs) return true;
  if (!onCurrentRoute(page, ctx)) return true;
  return ctx.offeredTabs.includes(page.tab);
}

/**
 * Where "All pages" and a search result navigate to, or `null` when the page
 * is listed but not linkable (K13: the super-admin sub-tabs, and the wizard
 * steps, whose position is held in memory by `WizardShell`).
 *
 * A page with no `href` at all is treated as unlinkable rather than as a bug —
 * the panel shows it and the click opens the topic in place.
 */
export function hrefForPage(page: HelpPage, ctx: HelpRouteContext): string | null {
  if (!isPageOffered(page, ctx)) return null;
  return page.href ? page.href(ctx) : null;
}
