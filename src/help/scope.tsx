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
import type { TopicScope } from './registry';

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
  children: ReactNode;
}) {
  const { poolType, audience, children } = props;
  // Memoised on the two primitives rather than on an object literal: without
  // this every render of a 900-line route hands every HelpTip below it a new
  // context value.
  const value = useMemo<TopicScope>(() => ({ poolType, audience }), [poolType, audience]);
  return <HelpScopeContext.Provider value={value}>{children}</HelpScopeContext.Provider>;
}

export function useHelpScope(): TopicScope {
  return useContext(HelpScopeContext);
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
  openTo(target: { topicId: string }): void;
}

export const HelpPanelContext = createContext<HelpPanelHandle | null>(null);

export function useHelpPanel(): HelpPanelHandle | null {
  return useContext(HelpPanelContext);
}
