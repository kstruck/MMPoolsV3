// Who the reader is and where they are — PLAN-HELP-SYSTEM.md §3 D1 (T1).
//
// `HelpTip` never receives a pool type. It receives an ID and reads the scope
// from here, which is what stops a call site from deciding which variant of a
// topic a reader gets. The panel (T2) reads the SAME context, so the tooltip
// and the panel cannot resolve one topic two ways.
//
// The scope is published by the surfaces that know it: `WizardShell` (it holds
// `poolType` already), `PoolRoute` and `AdminRoute` (every dispatched pool
// type, including the inline Squares grid and the pre-tab landing state). T2's
// tab publishers refine it.

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { PoolType } from '@shared/poolTypes';
import type { Audience } from './types';
import { helpRegistry, resolveCopy, type TopicScope } from './registry';
import { useHelpRoute } from './publish';

/**
 * What a reader outside any pool sees: type-agnostic member copy.
 *
 * NOT an "everything" default. A missing provider must show LESS than the
 * truth, never more — the alternative would leak commissioner copy onto member
 * surfaces the day someone forgets a publisher, and nothing downstream filters
 * again (`resolveTopic` is the last gate).
 */
export const DEFAULT_HELP_SCOPE: TopicScope = Object.freeze({ audience: 'member' });

const HelpScopeContext = createContext<TopicScope>(DEFAULT_HELP_SCOPE);

export function HelpScopeProvider(props: {
  poolType?: PoolType;
  audience: Audience;
  /**
   * The pool's settings map, so `HelpCopy.template` can render against the
   * pool the reader is actually in.
   *
   * OMITTED ON PURPOSE by `WizardShell`, and that is the contract: a wizard
   * knows the pool type from the moment the format is chosen and has no
   * settings until the pool exists, so a template there must keep rendering
   * its static `fallback` (`resolveCopy`). The same goes for every site page,
   * which has no provider at all.
   *
   * Pass the pool document's own object, by reference — see `PublishedRoute`.
   */
  settings?: Record<string, unknown>;
  children: ReactNode;
}) {
  const { poolType, audience, settings, children } = props;
  // Memoised on the inputs rather than on an object literal: without this every
  // render of a 900-line route hands every HelpTip below it a new context
  // value. `settings` joins them by identity, which is stable between pool
  // snapshots.
  const value = useMemo<TopicScope>(
    () => ({ poolType, audience, settings }),
    [poolType, audience, settings],
  );
  // T2: the same facts go UPWARD as well. The Help panel is mounted above
  // the router and cannot read this context, so the surface that knows the
  // pool type is the surface that tells it — one publisher, not a second
  // derivation of "which pool type is this" inside the panel. `settings` rides
  // the same channel for the same reason: the panel renders the SAME topics
  // the tooltip does, and the two must not resolve one topic's copy two ways.
  useHelpRoute({ poolType, audience, settings });
  return <HelpScopeContext.Provider value={value}>{children}</HelpScopeContext.Provider>;
}

export function useHelpScope(): TopicScope {
  return useContext(HelpScopeContext);
}

/**
 * A topic's TOOLTIP copy, resolved against the reader's own scope.
 *
 * For the surfaces that render an explanation somewhere a `HelpTip` does not
 * fit — a column header's `title`, a hint line under an input — and that would
 * otherwise keep their own copy of the sentence. `tiebreakerCopy`'s `hint` was
 * exactly that: one definition shared between the pick sheet and the standings
 * column, but a SECOND definition from the registry's point of view, and the
 * one nobody would think to update when the topic changed (voice rule 10, T4).
 *
 * `undefined` when the topic does not resolve for this reader — the caller
 * renders nothing rather than a placeholder, the same contract `HelpTip` has.
 * Because it resolves through the scope, a `template` renders the branch for
 * the reader's own pool.
 */
export function useTopicShort(id: string): string | undefined {
  const scope = useHelpScope();
  const topic = helpRegistry.resolveTopic(scope, id);
  return topic ? resolveCopy(topic.short, scope) : undefined;
}

/**
 * The Help panel, as the tooltip needs to see it.
 *
 * A typed context, NOT Spectrum's `window.__helpPanelOpenToSection` global.
 * `null` means no panel is mounted — which is the whole of T1, since the panel
 * itself lands in T2. `HelpTip` reads the null and changes what a click does
 * rather than pretending; see the comment there.
 */
export interface HelpPanelHandle {
  /**
   * Open the panel on one topic. `pageId` names the page to show it on; with
   * none, the panel prefers a placement on the reader's CURRENT page and falls
   * back to the topic's first placement (D3).
   */
  openTo(target: { topicId: string; pageId?: string }): void;
  /** Open the panel on a page, with no topic selected ("All pages"). */
  openPage(pageId: string): void;
}

export const HelpPanelContext = createContext<HelpPanelHandle | null>(null);

export function useHelpPanel(): HelpPanelHandle | null {
  return useContext(HelpPanelContext);
}
