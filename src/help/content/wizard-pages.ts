// The create-wizard Help pages — PLAN-HELP-SYSTEM.md §3 D1 / D3.
//
// TWO LEVELS, added in two tickets. T1 shipped the seven route-level pages
// (one per `/create/*` path), because the registry refuses a topic that
// nothing places and a placement needs a page. T2 adds a page PER STEP and
// moves the placements onto them, so the panel describes the step the reader
// is actually on rather than the whole wizard.
//
// A wizard step is held in memory by `WizardShell` — there is no `?step=` — so
// `WizardShell` publishes it with `useHelpRoute({ tab: step.id })` and the step
// pages carry `href: () => null`: listed in "All pages", not linkable from
// elsewhere, because a link could not put the reader on that step. The
// route-level page stays linkable and is the fallback when no step matches.

import type { HelpPage } from '../types';
import type { PoolType } from '@shared/poolTypes';

/**
 * The steps of one wizard, in order, EXACTLY as its `WizardStepDef[]` names
 * them — `tests/help-ui-coverage.test.ts` reads the wizard sources and fails
 * when the two lists disagree, so a step renamed in the wizard cannot leave a
 * help page pointing at nothing.
 */
export interface WizardDef {
  id: string;
  route: string;
  poolType: PoolType;
  title: string;
  /** Used to prefix the step pages, so "All pages" reads as a short list. */
  shortName: string;
  summary: string;
  /** Wizard step ids, in order. */
  steps: readonly string[];
}

export const WIZARDS: readonly WizardDef[] = [
  {
    id: 'wizard.pickem',
    route: '/create/pickem',
    poolType: 'NFL_PICKEM',
    title: "Create an NFL Pick'em pool",
    shortName: "Pick'em wizard",
    summary:
      'Set up a pool where players pick a winner in every game each week. Six steps: the basics, the rules, the entry fee, the prize split, your branding, and launch.',
    steps: ['basics', 'rules', 'fee', 'payouts', 'branding', 'launch'],
  },
  {
    id: 'wizard.survivor',
    route: '/create/survivor',
    poolType: 'NFL_SURVIVOR',
    title: 'Create an NFL Survivor pool',
    shortName: 'Survivor wizard',
    summary:
      'Set up a pool where players pick one team a week and are out when that team loses. Six steps: the basics, the rules, the entry fee, the prize split, your branding, and launch.',
    steps: ['basics', 'rules', 'fee', 'payouts', 'branding', 'launch'],
  },
  {
    id: 'wizard.margin',
    route: '/create/margin',
    poolType: 'NFL_MARGIN',
    title: 'Create an NFL Margin pool',
    shortName: 'Margin wizard',
    summary:
      'Set up a pool scored on how much a chosen team wins by. Six steps: the basics, the rules, the entry fee, the prize split, your branding, and launch.',
    steps: ['basics', 'rules', 'fee', 'payouts', 'branding', 'launch'],
  },
  {
    id: 'wizard.playoff',
    route: '/create/playoff',
    poolType: 'NFL_PLAYOFFS',
    // NOT "picks lock at Wild Card kickoff". Nothing sets that — `lockDate` is
    // optional and the wizard default is empty. (qodo #12 on PR #475.)
    title: 'Create an NFL Playoff pool',
    shortName: 'Playoff wizard',
    summary:
      'Set up a pool played across the playoff rounds, with every pick locking at once on the date you choose. Seven steps, ending with reminders and launch.',
    steps: ['basics', 'details', 'fee', 'payouts', 'branding', 'reminders', 'launch'],
  },
  {
    id: 'wizard.bracket',
    route: '/create/bracket',
    poolType: 'BRACKET',
    title: 'Create a bracket pool',
    shortName: 'Bracket wizard',
    summary:
      'Set up a tournament bracket pool. Six steps: the basics, which tournament and how it scores, the entry fee, the prize split, your branding, and launch.',
    steps: ['basics', 'tournament', 'fee', 'payouts', 'branding', 'launch'],
  },
  {
    id: 'wizard.squares',
    route: '/create/squares',
    poolType: 'SQUARES',
    title: 'Create a squares pool',
    shortName: 'Squares wizard',
    summary:
      'Set up a hundred-square grid on one game. Five steps: the basics, the matchup and grid rules, what a square costs, your branding, and launch.',
    steps: ['basics', 'grid', 'fee', 'branding', 'launch'],
  },
  {
    id: 'wizard.props',
    route: '/create/props',
    poolType: 'PROPS',
    title: 'Create a props pool',
    shortName: 'Props wizard',
    summary:
      'Set up a card of questions players answer before one game. Five steps: the basics, the questions, what a card costs, your branding, and launch.',
    steps: ['basics', 'setup', 'fee', 'branding', 'launch'],
  },
];

/**
 * Copy for the steps every wizard shares. Written once because the step IS the
 * same step — a different sentence per pool type for "name your pool" would be
 * five ways of saying one thing, which is what voice rule 10 refuses.
 */
const SHARED_STEP_COPY: Readonly<Record<string, { title: string; summary: string }>> = {
  basics: {
    title: 'Basics',
    summary:
      'Name the pool, say who is running it, and choose whether it shows up in the public pool list. The name is what players see on every screen and in every email.',
  },
  fee: {
    title: 'Fee & payment',
    summary:
      'Set what it costs to play and tell players how to pay you. Money moves between you and your players directly — this site never holds entry money and never moves it for you.',
  },
  payouts: {
    title: 'Payouts',
    summary:
      'Decide how the pot is split between the finishing places. Percentages, so the split still works whatever the pool ends up collecting.',
  },
  branding: {
    title: 'Branding',
    summary: 'Optional. Add a logo and two colours so the pool looks like yours.',
  },
  reminders: {
    title: 'Reminders',
    summary:
      'Choose which automatic emails go out — a nudge the day before, an hour before, a note when picks lock, and a winner announcement.',
  },
  launch: {
    title: 'Launch',
    summary:
      'Review the pool, tell us roughly how many players to expect, add any extras, accept the Terms, and create it. You can change most settings afterwards.',
  },
};

/** The one step whose copy is genuinely per pool type. */
const RULES_STEP_COPY: Readonly<Record<string, { title: string; summary: string }>> = {
  'wizard.pickem': {
    title: "Pick'em rules",
    summary:
      'How picks are scored, what breaks a tie at the top of a week, and how many entries one person may have. These are the rules players read before they join.',
  },
  'wizard.survivor': {
    title: 'Survivor rules',
    summary:
      'Which season the pool runs in and how many entries one person may have. The strike, buy-back and team-reuse rules are set on the manager screen after the pool exists.',
  },
  'wizard.margin': {
    title: 'Margin rules',
    summary:
      'Which season the pool runs in and how many entries one person may have. How the weekly margin is scored is fixed for every Margin pool.',
  },
  'wizard.playoff': {
    title: 'Playoff details',
    summary:
      'Which season the pool covers and the date every pick locks on. All picks are made in one go before the playoffs start, so there is one lock time for the whole pool.',
  },
  'wizard.bracket': {
    title: 'Tournament',
    summary: 'Which tournament the bracket follows, which year, and how each round is worth points.',
  },
  'wizard.squares': {
    title: 'Matchup & grid',
    summary:
      'Which game the grid covers, how many squares one person may take, and whether the numbers are drawn once or again each quarter.',
  },
  'wizard.props': {
    title: 'Questions',
    summary:
      'Write the questions players answer and the choices for each one. Everyone answers the same card, and the card is graded after the game.',
  },
};

/** The step id that carries the type-specific rules copy, per wizard. */
export const RULES_STEP: Readonly<Record<string, string>> = {
  'wizard.pickem': 'rules',
  'wizard.survivor': 'rules',
  'wizard.margin': 'rules',
  'wizard.playoff': 'details',
  'wizard.bracket': 'tournament',
  'wizard.squares': 'grid',
  'wizard.props': 'setup',
};

function stepCopy(wizardId: string, step: string): { title: string; summary: string } {
  if (RULES_STEP[wizardId] === step) return RULES_STEP_COPY[wizardId];
  const shared = SHARED_STEP_COPY[step];
  if (!shared) {
    throw new Error(`help: wizard step "${step}" of ${wizardId} has no page copy`);
  }
  return shared;
}

export const WIZARD_PAGES: readonly HelpPage[] = WIZARDS.flatMap((wizard): HelpPage[] => {
  const base: HelpPage = {
    id: wizard.id,
    route: wizard.route,
    href: () => wizard.route,
    title: wizard.title,
    summary: wizard.summary,
    poolTypes: [wizard.poolType],
    // The wizard is a host-only surface: nobody reaches `/create/*` for a pool
    // they are not about to run. A commissioner also sees member-scoped topics
    // (`AUDIENCE_SEES`), so the member copy on this page still renders.
    audience: ['commissioner'],
  };
  const steps = wizard.steps.map((step): HelpPage => {
    const copy = stepCopy(wizard.id, step);
    return {
      id: `${wizard.id}.${step}`,
      route: wizard.route,
      tab: step,
      // Not linkable: the step lives in `WizardShell`'s state, so a URL cannot
      // put the reader on it. Listed, and reachable by walking the wizard.
      href: () => null,
      title: `${wizard.shortName} — ${copy.title}`,
      summary: copy.summary,
      poolTypes: [wizard.poolType],
      audience: ['commissioner'],
    };
  });
  return [base, ...steps];
});
