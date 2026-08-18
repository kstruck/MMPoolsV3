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

function shallowEqual(a: PublishedRoute, b: PublishedRoute): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
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
  const { poolType, audience, tab, subTab, isManager } = value;

  useEffect(() => {
    store.publish(key, { poolType, audience, tab, subTab, isManager });
    // Depend on the PRIMITIVES, not on `value`: every caller passes an object
    // literal, so depending on the object would republish on every render.
  }, [store, key, poolType, audience, tab, subTab, isManager]);

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
