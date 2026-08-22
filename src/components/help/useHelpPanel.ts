// The Help panel's state — PLAN-HELP-SYSTEM.md §3 D3 (T2).
//
// Kept out of the component so that "which page am I on", "what happens when a
// search result on another route is clicked" and "what does the `?help=` deep
// link do" are testable without rendering a drawer.
//
// OPEN STATE IS NOT PERSISTED (K7). Spectrum stores it in localStorage; a help
// panel that reopens on every reload eats half a phone screen for a reader who
// closed it once.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import type { Audience, HelpPage, HelpRouteContext } from '../../help/types';
import type { Registry, TopicScope } from '../../help/registry';
import { baseTopicId } from '../../help/registry';
import { baseRegistry, loadAdminRegistry } from '../../help/admin';
import { usePublishedRoute } from '../../help/publish';
import { canOpenPage, hrefForPage, resolveHelpPage } from '../../help/route-match';

/**
 * What the header button needs: whether the panel is open, and how to toggle
 * it. A SEPARATE context from `HelpPanelContext` (which the tooltip reads)
 * because the two have different consumers and different lifetimes — the
 * tooltip's handle must stay stable while `isOpen` changes on every toggle,
 * and merging them would re-render every HelpTip on the page each time the
 * panel opened.
 *
 * `null` means no panel is mounted, and the header renders no button.
 */
export const HelpPanelControlContext = createContext<{
  isOpen: boolean;
  open(): void;
  toggle(): void;
} | null>(null);

export function useHelpPanelControl() {
  return useContext(HelpPanelControlContext);
}

/** The query parameter that opens the panel on a topic (K11). */
export const HELP_DEEP_LINK_PARAM = 'help';

export interface HelpTarget {
  topicId?: string;
  pageId?: string;
}

export interface HelpPanelState {
  isOpen: boolean;
  open(): void;
  close(): void;
  toggle(): void;
  openTo(target: { topicId: string; pageId?: string }): void;
  openPage(pageId: string): void;
  /** The topic the panel should scroll to and expand, if any. */
  activeTopicId: string | undefined;
  /** Consumed by the body once it has scrolled, so a second open does not jump. */
  clearActiveTopic(): void;
  registry: Registry;
  scope: TopicScope;
  routeContext: HelpRouteContext;
  page: HelpPage | undefined;
}

/**
 * The registry this reader gets. An admin's registry arrives asynchronously,
 * so the base one is returned until it does — the panel is useful immediately
 * and gains the admin pages a moment later, rather than rendering nothing.
 */
function useRegistry(isAdmin: boolean, retryOn: boolean): Registry {
  // Only the LOADED registry is state, and it is only ever written from the
  // chunk's resolution. Which one a reader gets is then derived, so there is no
  // synchronous state write in the effect and losing admin rights mid-session
  // reverts to the base registry with no extra render.
  const [loaded, setLoaded] = useState<Registry | null>(null);
  // `retryOn` is the panel's open state (codex R8). `loadAdminRegistry` clears
  // its cache on failure precisely so that a flaky connection can be retried —
  // but an effect keyed on `isAdmin` alone never runs again, so that retry was
  // unreachable and an admin who lost the chunk once lost admin help for the
  // whole session. Every time the panel opens is the natural second chance.
  useEffect(() => {
    if (!isAdmin || loaded) return;
    let live = true;
    loadAdminRegistry()
      .then((next) => {
        if (live) setLoaded(next);
      })
      .catch(() => {
        // The base registry covers everything except admin-only copy. A failed
        // chunk must not blank the panel.
      });
    return () => {
      live = false;
    };
  }, [isAdmin, retryOn, loaded]);
  return isAdmin ? loaded ?? baseRegistry : baseRegistry;
}

export function useHelpPanelState(options: { isAdmin: boolean; defaultAudience?: Audience }): HelpPanelState {
  const { isAdmin, defaultAudience = 'member' } = options;
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const published = usePublishedRoute();

  const [isOpen, setIsOpen] = useState(false);
  const registry = useRegistry(isAdmin, isOpen);
  const [activeTopicId, setActiveTopicId] = useState<string | undefined>(undefined);
  const [forcedPageId, setForcedPageId] = useState<string | undefined>(undefined);
  // A target waiting for a route change to land. Held in a ref because it is
  // consumed by an effect that must not itself cause a render when there is
  // nothing to consume.
  const pending = useRef<{ target: HelpTarget; pageId: string } | null>(null);

  const scope = useMemo<TopicScope>(
    () => ({
      poolType: published.poolType,
      audience: published.audience ?? defaultAudience,
      // Only a pool surface publishes this. Absent on the wizard and the site
      // pages, where a `HelpCopy.template` must render its static fallback.
      // `search` reads the same scope, so a query inside a pool matches the
      // branch that pool's cards actually show, and a query outside one still
      // matches the fallback.
      settings: published.settings,
    }),
    [published.poolType, published.audience, published.settings, defaultAudience],
  );

  const routeContext = useMemo<HelpRouteContext>(
    () => ({
      pathname: location.pathname,
      search: location.search,
      // PUBLISHED WINS OVER THE URL. A surface that reads `?tab=` publishes the
      // tab it actually rendered, which is not always the one asked for — an
      // NFL pool opened on `?tab=results` shows the dashboard when the type
      // has no results tab. The panel must describe the screen, not the link.
      tab: published.tab ?? searchParams.get('tab') ?? undefined,
      // Two spellings, because the NFL dashboard already deep-links its
      // commissioner sections as `?tab=manager&section=members` (the member
      // Payments tab's "Open Payment Ledger" link) and renaming a live URL
      // parameter for tidiness would break every one already sent.
      subTab: published.subTab ?? searchParams.get('sub') ?? searchParams.get('section') ?? undefined,
      poolType: published.poolType,
      isManager: published.isManager,
      offeredTabs: published.offeredTabs,
    }),
    [
      location.pathname,
      location.search,
      published.tab,
      published.subTab,
      published.poolType,
      published.isManager,
      published.offeredTabs,
      searchParams,
    ],
  );

  const resolvedPage = useMemo(
    () => resolveHelpPage(registry.pages, routeContext, scope.audience),
    [registry, routeContext, scope.audience],
  );

  // A forced page (a search result on a page this route cannot resolve to)
  // wins until the reader moves, at which point the route speaks again.
  const page = useMemo(
    () => (forcedPageId ? registry.getPage(forcedPageId) ?? resolvedPage : resolvedPage),
    [forcedPageId, registry, resolvedPage],
  );

  const close = useCallback(() => setIsOpen(false), []);
  const open = useCallback(() => setIsOpen(true), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);
  const clearActiveTopic = useCallback(() => setActiveTopicId(undefined), []);

  /**
   * Which page to show a topic on: the caller's choice, else a placement on
   * the page the reader is already looking at, else the topic's first
   * placement. Preferring the current page is what stops a click on a tooltip
   * from navigating away from the form the reader is filling in.
   */
  const pageForTopic = useCallback(
    (topicId: string, requested?: string): string | undefined => {
      if (requested) return requested;
      const base = baseTopicId(topicId);
      const candidates = registry.placements.filter((p) => p.topic === base);
      if (page && candidates.some((p) => p.page === page.id)) return page.id;
      return candidates[0]?.page;
    },
    [registry, page],
  );

  const goToPage = useCallback(
    (pageId: string, target: HelpTarget) => {
      setIsOpen(true);
      const next = registry.getPage(pageId);
      if (!next || next.id === page?.id) {
        setActiveTopicId(target.topicId);
        return;
      }
      const href = hrefForPage(next, routeContext);
      if (href && href !== `${location.pathname}${location.search}`) {
        // Cross-route or cross-tab: the target is held until the new route (and
        // its publishers) have resolved, or the panel would render the old
        // page's topics under the new page's title for a frame.
        pending.current = { target, pageId };
        setActiveTopicId(undefined);
        setForcedPageId(undefined);
        navigate(href);
        return;
      }
      // Two ways a page must never be FORCED into view, both because the reader
      // cannot get to that screen and a guide for it would describe somewhere
      // they are not:
      //
      //   - its tab is not one this surface offers (codex R5), and
      //   - it belongs to another pool type or another audience (codex R7) —
      //     reachable in the list only through "Show all pool types", where it
      //     is now rendered unlinked.
      //
      // Stated here as well as in the list, so a caller that reaches this by any
      // other door (a `related` link, a `?help=` deep link someone pasted) gets
      // the same answer.
      if (!canOpenPage(next, routeContext, scope.audience)) {
        setActiveTopicId(undefined);
        return;
      }
      // Same route, or a page with no link (K13 — the super-admin sub-tabs and
      // the wizard steps, whose position is held in memory). Show it in place
      // rather than dead-ending the click.
      setForcedPageId(pageId);
      setActiveTopicId(target.topicId);
    },
    [registry, page, routeContext, location.pathname, location.search, navigate],
  );

  const openTo = useCallback(
    (target: { topicId: string; pageId?: string }) => {
      const pageId = pageForTopic(target.topicId, target.pageId);
      if (!pageId) {
        // A topic with no placement cannot exist — `buildRegistry` refuses
        // one — but a caller may still name an id that resolves to nothing.
        setIsOpen(true);
        setActiveTopicId(target.topicId);
        return;
      }
      goToPage(pageId, { topicId: target.topicId, pageId });
    },
    [pageForTopic, goToPage],
  );

  const openPage = useCallback((pageId: string) => goToPage(pageId, { pageId }), [goToPage]);

  // Consume a pending target once the route resolves to the page it was for.
  //
  // NOT ABANDONED ON THE FIRST MISS. The publishers under the new route settle
  // in an effect, so the first render after `navigate` still reports the old
  // tab; giving up there would force a page the reader was one frame away from
  // reaching properly. A target that never lands is dropped by the release
  // below when the reader moves again, so it cannot fire on an unrelated screen
  // later.
  useEffect(() => {
    const waiting = pending.current;
    if (!waiting || resolvedPage?.id !== waiting.pageId) return;
    pending.current = null;
    setActiveTopicId(waiting.target.topicId);
  }, [resolvedPage]);

  // A forced page is released, AND A DIVERTED PENDING TARGET IS DROPPED, as soon
  // as the ROUTE resolves somewhere else — the reader clicked a tab, so the route
  // speaks again.
  //
  // Keyed on the resolved page, NOT on `location`. The `?help=` deep link strips
  // its own parameter with a `replace`, which changes the location while the
  // reader has not moved at all; releasing on that would undo the very target
  // the deep link had just set.
  //
  // ⚠️ `pending.current = null` HERE IS THE WHOLE POINT (qodo #1). The consume
  // effect above runs first and clears `pending` on a match, so a target still
  // sitting here means the route resolved somewhere ELSE. An earlier version
  // skipped its cleanup whenever a pending target existed — on the reasoning that
  // the consumer would deal with it — and nothing else ever cleared one, so a
  // target the reader had navigated away from survived for the rest of the
  // session and fired the next time that page happened to resolve. The comment
  // one commit earlier claimed this effect dropped it. It did not.
  const lastResolved = useRef(resolvedPage?.id);
  useEffect(() => {
    if (lastResolved.current === resolvedPage?.id) return;
    lastResolved.current = resolvedPage?.id;
    pending.current = null;
    setForcedPageId(undefined);
  }, [resolvedPage]);

  // `?help=<topicId>` (K11). Consumed and stripped, so a reader who closes the
  // panel and reloads does not have it reopen — and so the URL they copy from
  // the address bar afterwards is the page, not the help state.
  useEffect(() => {
    const topicId = searchParams.get(HELP_DEEP_LINK_PARAM);
    if (!topicId) return;
    const next = new URLSearchParams(searchParams);
    next.delete(HELP_DEEP_LINK_PARAM);
    setSearchParams(next, { replace: true });
    openTo({ topicId });
  }, [searchParams, setSearchParams, openTo]);

  return {
    isOpen,
    open,
    close,
    toggle,
    openTo,
    openPage,
    activeTopicId,
    clearActiveTopic,
    registry,
    scope,
    routeContext,
    page,
  };
}
