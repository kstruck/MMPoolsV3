// The seven create-wizard Help pages — PLAN-HELP-SYSTEM.md §3 D1 (T1).
//
// WHY T1 AND NOT T2. The registry refuses a topic that nothing places, and a
// placement needs a page. T1 authors the first topics, so it authors the pages
// they sit on. T2 still owns everything a page is FOR — matching the reader's
// route to one, the panel that renders it, the per-step pages inside a wizard,
// and search. These are route-level, one per `/create/*` path.
//
// `href` is a plain string because a wizard route takes no parameters. `match`
// is unnecessary for the same reason: one route, one pool type.

import type { HelpPage } from '../types';
import type { PoolType } from '@shared/poolTypes';

function wizardPage(id: string, route: string, poolType: PoolType, title: string, summary: string): HelpPage {
  return {
    id,
    route,
    href: () => route,
    title,
    summary,
    poolTypes: [poolType],
    // The wizard is a host-only surface: nobody reaches `/create/*` for a pool
    // they are not about to run. A commissioner also sees member-scoped topics
    // (`AUDIENCE_SEES`), so the member copy on this page still renders.
    audience: ['commissioner'],
  };
}

export const WIZARD_PAGES: readonly HelpPage[] = [
  wizardPage(
    'wizard.pickem',
    '/create/pickem',
    'NFL_PICKEM',
    "Create an NFL Pick'em pool",
    'Set up a pool where players pick a winner in every game each week. Six steps: the basics, the rules, the entry fee, the prize split, your branding, and launch.',
  ),
  wizardPage(
    'wizard.survivor',
    '/create/survivor',
    'NFL_SURVIVOR',
    'Create an NFL Survivor pool',
    'Set up a pool where players pick one team a week and are out when that team loses. Six steps: the basics, the rules, the entry fee, the prize split, your branding, and launch.',
  ),
  wizardPage(
    'wizard.margin',
    '/create/margin',
    'NFL_MARGIN',
    'Create an NFL Margin pool',
    'Set up a pool scored on how much a chosen team wins by. Six steps: the basics, the rules, the entry fee, the prize split, your branding, and launch.',
  ),
  wizardPage(
    'wizard.playoff',
    '/create/playoff',
    'NFL_PLAYOFFS',
    'Create an NFL Playoff pool',
    'Set up a pool played across the playoff rounds, with picks locking once at Wild Card kickoff. Seven steps, ending with reminders and launch.',
  ),
  wizardPage(
    'wizard.bracket',
    '/create/bracket',
    'BRACKET',
    'Create a bracket pool',
    'Set up a tournament bracket pool. Six steps: the basics, which tournament and how it scores, the entry fee, the prize split, your branding, and launch.',
  ),
  wizardPage(
    'wizard.squares',
    '/create/squares',
    'SQUARES',
    'Create a squares pool',
    'Set up a hundred-square grid on one game. Five steps: the basics, the matchup and grid rules, what a square costs, your branding, and launch.',
  ),
  wizardPage(
    'wizard.props',
    '/create/props',
    'PROPS',
    'Create a props pool',
    'Set up a card of questions players answer before one game. Five steps: the basics, the questions, what a card costs, your branding, and launch.',
  ),
];
