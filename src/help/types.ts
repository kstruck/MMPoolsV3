// The help content model — PLAN-HELP-SYSTEM.md §3 D1.
//
// ONE source for every piece of explanatory copy. A `HelpTopic` is the copy
// for one option/control/concept; a `HelpPlacement` says where in the Help
// panel it appears; a `HelpPage` is what the panel summarises. The tooltip
// (`HelpTip`, T1) reads `short`; the panel (T2) reads `long` — from the same
// topic, so the two can never disagree.
//
// WHY THERE IS NO `text` OVERRIDE. The Spectrum Price Intel implementation
// this is ported from lets its tooltip take an inline `text=` prop, and 191
// of its 213 call sites use it — the "one source" was routed around in
// practice (PLAN §1a). Nothing here accepts free copy at the call site: a
// `HelpTip` takes an id and nothing else.

import type { PoolType } from '@shared/poolTypes';

/** Who sees the control this copy explains. A commissioner is also a member. */
export type Audience = 'member' | 'commissioner' | 'admin';

export const AUDIENCES: readonly Audience[] = ['member', 'commissioner', 'admin'];

/** Which pool types a topic/page applies to. `'all'` means every type. */
export type PoolTypeScope = readonly PoolType[] | 'all';

/**
 * What a `template` copy function may read. Deliberately narrow: a topic
 * renders from the pool in scope, never from arbitrary app state.
 */
export interface HelpCopyContext {
  poolType?: PoolType;
  settings?: Record<string, unknown>;
}

/**
 * Copy is a static string, OR a template of the pool's own settings with a
 * static fallback for when no pool is in scope (the wizard, the site pages,
 * and search results, which are written before a pool exists).
 *
 * This is how the setting-dependent explainers that exist today
 * (`utils/survivorRules.ts` survivorModeRulesCopy / tieOutcomeRuleCopy /
 * teamReuseRuleCopy, `shared/nflTiebreaker.ts` tiebreakerCopy) become topics
 * rather than side-channel copy: the helper stays where it is and BECOMES the
 * topic's `template`.
 */
export type HelpCopy =
  | string
  | { template: (ctx: HelpCopyContext) => string; fallback: string };

/**
 * The copy for one option, control, or feature — regardless of how many
 * screens show it. The entry fee appears in the wizard, the manager settings
 * form, the rules page and the join page: ONE topic, four placements.
 */
export interface HelpTopic {
  /**
   * Stable slug. For a form option this is the schema / react-hook-form path
   * with array indices normalised to `*`:
   *   `settings.weeklyTiebreaker`, `props.questions.*.text`
   *
   * A pool-type-specific variant is written `NFL_SURVIVOR:settings.entryFee`
   * and wins over the unqualified id when the viewer is in that pool type
   * (`Registry.resolveTopic`).
   */
  id: string;
  /** Human label, <= 40 chars. */
  title: string;
  /** TOOLTIP copy: <= 160 chars, "what this option does". */
  short: HelpCopy;
  /** PANEL copy: what it does, when to change it, what members see. */
  long: HelpCopy;
  poolTypes: PoolTypeScope;
  audience: readonly Audience[];
  /** Schema paths this topic EXPLAINS. Defaults to `[id]` when id is a path. */
  fields?: readonly string[];
  /** Glossary term ids linked from the long copy. */
  terms?: readonly string[];
  /** Optional bullets shown under the long copy. */
  tips?: readonly string[];
  /** Other topic ids worth reading next. */
  related?: readonly string[];
}

/** WHERE a topic shows up in the panel. Many placements per topic. */
export interface HelpPlacement {
  /** `HelpTopic.id` — the UNQUALIFIED id; scope resolution happens at render. */
  topic: string;
  /** `HelpPage.id`. */
  page: string;
  /**
   * Grouping heading inside that page's "On this page". Optional at the call
   * site; `buildRegistry` normalises a missing value to `DEFAULT_SECTION`, so
   * every placement carries one by the time anything reads it.
   */
  section?: string;
  order?: number;
}

/** A placement after `buildRegistry` has filled in its defaults. */
export type ResolvedPlacement = HelpPlacement & { section: string; order: number };

/** The section a placement lands in when it names none. */
export const DEFAULT_SECTION = 'general';

/**
 * What the panel knows about where the viewer is. Route params and the tab
 * come from the URL where a surface uses `?tab=`, and from a `useHelpRoute`
 * publisher where the tab is only in memory (T2).
 */
export interface HelpRouteContext {
  pathname: string;
  routeParams?: Readonly<Record<string, string | undefined>>;
  tab?: string;
  subTab?: string;
  poolType?: PoolType;
  isManager?: boolean;
}

/**
 * The viewer's scope, held by `HelpPanelProvider` (T2) and read by BOTH the
 * tooltip and the panel — which is what stops the two from resolving a scoped
 * topic differently.
 */
export interface HelpScope {
  poolType?: PoolType;
  audience: Audience;
  routeParams?: Readonly<Record<string, string | undefined>>;
  tab?: string;
  subTab?: string;
  /** The pool's settings, for `template` copy. */
  settings?: Record<string, unknown>;
}

/** The unit the Help panel summarises: a route, or a route plus a tab. */
export interface HelpPage {
  /** e.g. `pool.nfl.picks`, `wizard.survivor.rules`, `super-admin.operations`. */
  id: string;
  /** react-router pattern, exactly as written in `src/App.tsx`. */
  route: string;
  /**
   * Other `src/App.tsx` routes that render THIS SAME screen.
   *
   * `/admin/:id` does not have a manager UI of its own for four of the seven
   * pool types: `AdminRoute` renders the very same dashboard `/pool/:id` does
   * (`AdminRoute.tsx:101,120,136` and the NFL branch). Without this, a
   * commissioner who followed a "manage" link would be told there is no guide
   * for a screen that has one. Squares is the exception — it really does have
   * its own panel there — so its pages name `/admin/:id` as their `route`.
   *
   * Checked against App.tsx by `tests/help-registry-invariants.test.ts` exactly
   * as `route` is, and it counts towards a route being covered.
   */
  altRoutes?: readonly string[];
  /** The `?tab=` value, or the in-memory tab id published by `useHelpRoute`. */
  tab?: string;
  subTab?: string;
  /**
   * How search results and "All pages" NAVIGATE here. `null` means the page is
   * listed but not linkable from elsewhere (K13: super-admin sub-tabs).
   */
  href?: (ctx: HelpRouteContext) => string | null;
  /** Extra condition, e.g. the pool type — page identity is not path depth. */
  match?: (ctx: HelpRouteContext) => boolean;
  title: string;
  /** The page summary shown at the top of the panel. <= 280 chars. */
  summary: string;
  poolTypes: PoolTypeScope;
  audience: readonly Audience[];
}

/**
 * A member-voiced mirror of exactly one `CONTEXT.md` glossary heading.
 *
 * K1: hand-mirrored, not generated. CONTEXT.md stays authoritative for
 * MEANING — `tests/help-glossary-invariants.test.ts` fails when a term there
 * has no mirror here — while the shipped wording is written for the reader
 * (`docs/help-voice.md`). CONTEXT.md is engineer-voiced and must stay that
 * way; shipping it verbatim would be the wrong copy.
 */
export interface GlossaryTerm {
  id: string;
  /** Member-facing name, <= 40 chars. May differ from the CONTEXT.md heading. */
  term: string;
  short: string;
  long: string;
  /** The exact `### ` heading in CONTEXT.md this mirrors. */
  contextHeading: string;
  audience: readonly Audience[];
  /** Other glossary ids worth reading next. */
  related?: readonly string[];
}

/** The hand-authored content `buildRegistry` validates and freezes. */
export interface HelpContentInput {
  topics: readonly HelpTopic[];
  placements: readonly HelpPlacement[];
  pages: readonly HelpPage[];
  glossary: readonly GlossaryTerm[];
}

/** One hit from `Registry.search`. */
export interface HelpSearchResult {
  kind: 'topic' | 'page' | 'glossary';
  id: string;
  title: string;
  /** The matched text, windowed around the query. */
  snippet: string;
  /** Where to open this result. Absent for glossary hits. */
  pageId?: string;
}
