// How the Help panel learns where the reader is — PLAN-HELP-SYSTEM.md §3 D3.
//
// THE PROBLEM THIS SOLVES. The panel is mounted ONCE, next to the router in
// `App.tsx`, so it sits ABOVE every surface that knows what the reader is
// looking at: `PoolRoute` knows the pool type, `NFLPoolDashboard` knows the
// tab, `NFLManagerView` knows the sub-tab. React context only flows downward,
// so none of that reaches the panel by context. The pathname and `?tab=` come
// from the router, but the tabs held in memory (SWEEPS §A2) do not exist
// anywhere the panel can read.
//
// So surfaces PUBLISH. `useHelpRoute({ tab })` writes into a store held above
// the router and clears its own entry on unmount.
//
// EACH PUBLISHER OWNS DIFFERENT FIELDS. `NFLPoolDashboard` publishes `tab`,
// the manager view nested inside it publishes `subTab`, `PoolRoute` publishes
// `poolType`. Two live publishers writing the SAME field would be ambiguous —
// there is no meaningful order between a parent and a child effect to appeal
// to — so they do not: the field split is the contract, and
// `tests/helpRoutePublish.test.tsx` pins it.

import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { PoolType } from '@shared/poolTypes';
import type { Audience } from './types';

/** The facts a surface can publish about where the reader is. */
export interface PublishedRoute {
  poolType?: PoolType;
  audience?: Audience;
  tab?: string;
  subTab?: string;
  isManager?: boolean;
  /** See `HelpRouteContext.offeredTabs`. */
  offeredTabs?: readonly string[];
  /**
   * The pool's settings map, for `HelpCopy.template`. Published only by the
   * surfaces that HAVE a pool — the wizard and the site pages publish nothing
   * here, which is what keeps a template rendering its static fallback there
   * (`resolveCopy`).
   *
   * ⚠️ PUBLISH THE POOL DOCUMENT'S OWN OBJECT, BY REFERENCE. Building one
   * inline (`settings={{ ...pool.settings }}`) hands the store a new identity
   * on every render. `shallowEqual` compares this map one level deep for
   * exactly that reason, but a caller that rebuilds the NESTED objects too
   * would still set state on every render. The pool comes from a subscription
   * and its settings object is stable between snapshots — pass that.
   */
  settings?: Record<string, unknown>;
}

/**
 * A stable key for the one array-valued field.
 *
 * Callers build `offeredTabs` inline, so it is a new array on every render. The
 * store compares entries by value and the effect below depends on this string
 * rather than on the array, or a surface would republish for ever.
 */
/**
 * A separator no tab id can contain. Written as an ESCAPE, never as the byte
 * itself: an embedded NUL makes git classify this file as binary, and a source
 * file that cannot be diffed or blamed cannot be reviewed (codex R7).
 */
const SEPARATOR = '\u0000';

function tabsKey(tabs: readonly string[] | undefined): string | undefined {
  return tabs ? tabs.join(SEPARATOR) : undefined;
}

type Store = {
  publish(key: string, value: PublishedRoute): void;
  retract(key: string): void;
};

/**
 * The no-op store. A surface calling `useHelpRoute` outside the provider (a
 * unit test rendering one dashboard, a Storybook-style harness) must not
 * crash — it simply publishes into nothing, which is exactly what "no panel is
 * mounted" means everywhere else in this feature.
 */
const NO_STORE: Store = { publish: () => {}, retract: () => {} };

const PublishContext = createContext<Store>(NO_STORE);
const RouteStateContext = createContext<PublishedRoute>({});

/** Merge, ignoring `undefined` so a publisher can omit fields it knows nothing about. */
function mergeEntries(entries: readonly PublishedRoute[]): PublishedRoute {
  const merged: PublishedRoute = {};
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry)) {
      if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

export function HelpRouteStoreProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ReadonlyMap<string, PublishedRoute>>(() => new Map());

  const store = useMemo<Store>(
    () => ({
      publish(key, value) {
        setEntries((prev) => {
          const existing = prev.get(key);
          // Bail out when nothing changed. Publishers pass object literals, so
          // without this every render of a dashboard would set state and
          // re-render the whole tree under the provider — forever.
          if (existing && shallowEqual(existing, value)) return prev;
          const next = new Map(prev);
          next.set(key, value);
          return next;
        });
      },
      retract(key) {
        setEntries((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      },
    }),
    [],
  );

  const value = useMemo(() => mergeEntries([...entries.values()]), [entries]);

  return (
    <PublishContext.Provider value={store}>
      <RouteStateContext.Provider value={value}>{children}</RouteStateContext.Provider>
    </PublishContext.Provider>
  );
}

/**
 * One level deep, by value.
 *
 * `settings` is compared this way for the same reason `offeredTabs` is: a
 * publisher that hands over a fresh object with identical contents must not set
 * state, or the store re-renders the tree under it, the publisher re-renders,
 * and the effect publishes a fresh object again — for ever. One level is
 * enough for the callers this has: they pass the pool document's own settings
 * map, whose nested values are stable between snapshots.
 */
function settingsEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function shallowEqual(a: PublishedRoute, b: PublishedRoute): boolean {
  // `offeredTabs` is compared by VALUE: the effect that publishes it rebuilds
  // the array from a string key, so identity changes on every publish even when
  // the tabs did not — and an identity comparison would set state each time.
  if (tabsKey(a.offeredTabs) !== tabsKey(b.offeredTabs)) return false;
  if (!settingsEqual(a.settings, b.settings)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (key === 'offeredTabs' || key === 'settings') continue;
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
  }
  return true;
}

/**
 * Publish where the reader is, for as long as this component is mounted.
 *
 * Call it with ONLY the fields this surface owns — a tab strip publishes
 * `{ tab }`, the manager view nested under it publishes `{ subTab }`. The
 * entry is retracted on unmount, so leaving a pool takes its pool type with it
 * rather than leaving the panel describing a screen nobody is on.
 */
export function useHelpRoute(value: PublishedRoute): void {
  const store = useContext(PublishContext);
  const key = useId();
  const { poolType, audience, tab, subTab, isManager, settings } = value;
  const offeredKey = tabsKey(value.offeredTabs);

  useEffect(() => {
    store.publish(key, {
      poolType,
      audience,
      tab,
      subTab,
      isManager,
      offeredTabs: offeredKey === undefined ? undefined : offeredKey.split(SEPARATOR),
      settings,
    });
    // Depend on the PRIMITIVES, not on `value`: every caller passes an object
    // literal, so depending on the object would republish on every render.
    //
    // `settings` is the one non-primitive, and it is depended on by IDENTITY.
    // Re-running this effect is cheap — `store.publish` bails out when nothing
    // changed — so an unstable identity costs a comparison per render, not a
    // render loop. That bail-out is what has to hold, which is why
    // `shallowEqual` compares this map by value.
  }, [store, key, poolType, audience, tab, subTab, isManager, offeredKey, settings]);

  useEffect(() => () => store.retract(key), [store, key]);
}

/** What every publisher currently mounted adds up to. */
export function usePublishedRoute(): PublishedRoute {
  return useContext(RouteStateContext);
}

/**
 * The publisher as an ELEMENT rather than a hook.
 *
 * Every surface that needs to publish is a long component with early returns
 * (a loading state, a not-found state, a permission refusal) declared ABOVE the
 * line where the tab is known — `NFLPoolDashboard` has four. A hook call after
 * one of those is a hook-order violation, and a hook call before it cannot see
 * the tab. Rendering one line of JSX where the tab IS known avoids both, and it
 * unmounts with the branch that rendered it, which is exactly the lifetime the
 * published entry should have.
 */
export function HelpRoutePublisher(props: PublishedRoute) {
  useHelpRoute(props);
  return null;
}
