// Manager-only fields with no create-wizard control — PLAN-HELP-SYSTEM.md T5, T6.
//
// Both tickets cover settings a pool can be created with, that the unified
// create wizard never offers, and that are edited only on a manager surface.
// That is why their rows sat in `SCHEMA_PATH_ALLOWLIST` after T1: the wizard
// tickets could not write copy for a control the wizard does not have.
//
//   T5  `branding.backgroundColor` — the colour picker on the legacy branding
//       step (`WizardStepBranding.tsx:83` and its admin twin
//       `admin/WizardStepBrandingAdmin.tsx:136`), reached from the squares
//       manager's Setup Wizard tab (`AdminPanel.tsx:675`, step 6) and from the
//       props edit wizard embedded in the props Manage tab
//       (`PropsPoolDashboard.tsx:352` → `PropsWizard.tsx:227`, step 1).
//
//   T6  `settings.payouts.bonuses.*.name` and `.percentage` — the bonus-row
//       editor in `BracketPoolDashboard.tsx:1614-1640`. `StepPayouts` edits
//       places only, so no wizard has ever offered a bonus.
//
// Written against `docs/help-voice.md` (K8). Every claim below was read out of
// the source it describes:
//
//   DEFAULT COLOUR. `#0f172a`, named exactly (voice rule 5). Both branding
//   steps render `branding?.backgroundColor || '#0f172a'` and their "Reset to
//   Default" button writes that same literal.
//
//   WHERE THE COLOUR ACTUALLY LANDS, which is NOT everywhere the field is
//   accepted. Only two pages read it: the props pool page
//   (`PropsPoolDashboard.tsx:90`) and the squares pool page
//   (`PoolRoute.tsx:507`). The playoff dashboard reads the LEGACY
//   `branding.bgColor` instead (`PlayoffDashboard.tsx:101`), and the NFL
//   dashboards go through `brandingStyles()`, whose `page` background is the
//   legacy field or a tint of the primary colour — `backgroundColor` is not in
//   `PoolBranding` at all. So the copy says squares and props and stops there.
//
//   WHAT A BONUS PERCENTAGE IS A PERCENTAGE OF (voice rule 8). The pot, which
//   is entry fees the commissioner collects peer to peer — the platform holds
//   none of it. `payoutsSchema` (`shared/schemas/common.ts:78`) adds places and
//   bonuses together against one 100% ceiling, and the editor's own total does
//   the same sum. NOTHING awards a bonus: no scorer reads `bonuses`, so the
//   commissioner decides the winner and pays them.
//
//   WHERE MEMBERS READ A BONUS. `PayoutsPanel.tsx:471` renders the bonus list
//   behind `!compact`, so the bracket rules panel and the NFL rules page show
//   it and the JOIN SCREEN (`JoinPool.tsx:223`, `compact`) does not. A playoff
//   pool never shows one — `PlayoffPayoutCard.tsx:36` lists places only.

import type { HelpPlacement, HelpTopic } from '../types';
import type { PoolType } from '@shared/poolTypes';

/**
 * The types whose create contract carries `branding` — every one but Bracket,
 * which has no branding block (`shared/schemas/bracket.ts`).
 *
 * The topic has to name all six or the schema audit reports the path
 * unexplained for the four that get no placement, which is the state the
 * allowlist row was holding open.
 */
const BRANDED_TYPES: readonly PoolType[] = [
  'SQUARES',
  'PROPS',
  'NFL_PLAYOFFS',
  'NFL_PICKEM',
  'NFL_SURVIVOR',
  'NFL_MARGIN',
];

/**
 * The types whose payout settings carry a bonus list: everyone using
 * `payoutsSchema`. Squares and Props do not — squares splits by quarter and the
 * props payout array is a legacy per-place list with no bonuses in it.
 */
const BONUS_TYPES: readonly PoolType[] = [
  'BRACKET',
  'NFL_PLAYOFFS',
  'NFL_PICKEM',
  'NFL_SURVIVOR',
  'NFL_MARGIN',
];

/** Branding is a control only a host ever meets. */
const HOST_ONLY = ['commissioner'] as const;
/** A prize split members read on the rules page too. */
const EVERYONE = ['member', 'commissioner'] as const;

export const MANAGER_FIELD_TOPICS: readonly HelpTopic[] = [
  // ---- T5: the legacy branding step's colour picker -----------------------
  {
    id: 'branding.backgroundColor',
    title: 'Pool page background',
    short:
      'The colour painted behind your pool page. The default is #0f172a, a near-black navy.',
    long: [
      'Pick a colour and the pool page is painted with it behind the cards and the text. Reset to Default puts it back to #0f172a.',
      'Change it when you want the pool to carry a team colour, or to match the event you are running it for. The cards and the text were drawn against a dark background, so a pale colour makes them hard to read.',
      'Members see the new colour the next time they open the pool. Squares and props pool pages are the only ones that use it — an NFL or playoff pool keeps the value you set and does not paint its page with it.',
    ].join('\n\n'),
    poolTypes: BRANDED_TYPES,
    audience: HOST_ONLY,
    related: ['branding.primaryColor', 'branding.secondaryColor', 'branding.logoUrl'],
  },

  // ---- T6: the bonus rows on the payouts editor ---------------------------
  {
    id: 'settings.payouts.bonuses.*.name',
    title: 'Bonus prize name',
    short:
      'Names a prize you award for something the standings do not rank. Members read this label beside its share.',
    long: [
      'A bonus is a prize for something other than a finishing position — the biggest upset, the best opening round, last place. Nothing here works out who won it: you decide, and you pay them the same way you pay every other prize.',
      'The box starts empty, and an empty name reaches members as the bare word "Bonus", which tells them nothing. Name it for the thing you are rewarding, so a player reading the prize list knows what to aim at.',
      'Add as many rows as you want, and remove one with the cross beside it. Removing a row leaves its share unassigned until you hand it to a place or to another bonus.',
    ].join('\n\n'),
    poolTypes: BONUS_TYPES,
    audience: EVERYONE,
    related: ['settings.payouts.bonuses.*.percentage', 'settings.payouts.places.*.rank'],
  },
  {
    id: 'settings.payouts.bonuses.*.percentage',
    title: 'Bonus prize share',
    short:
      'What share of the pot this bonus takes. It draws on the same pot as the finishing places — the money you collect from players.',
    long: [
      'The pot is the entry fees you collect. Nothing is held here, so this share is a record of what you owe whoever wins the bonus rather than a transfer — the money goes from you to them directly.',
      'Places and bonuses draw on that one pot and are added together, so a 5% bonus leaves 95% for the finishing places. The editor keeps a running total and marks it until the two lists come to 100%.',
      'Where members read it depends on the format. A bracket or NFL pool lists every bonus and its share on its rules and payment page. The join screen leaves bonuses out, and a playoff pool shows its finishing places only, so a bonus is worth announcing yourself as well.',
    ].join('\n\n'),
    poolTypes: BONUS_TYPES,
    audience: EVERYONE,
    terms: ['entry-fee'],
    related: ['settings.payouts.bonuses.*.name', 'settings.payouts.places.*.percentage'],
  },
];

export const MANAGER_FIELD_PLACEMENTS: readonly HelpPlacement[] = [
  // T5 — the two surfaces that render the legacy branding step. Deliberately
  // NOT the create-wizard branding steps: the unified wizard offers only the
  // primary and secondary colours, and a `?` there would explain a control the
  // reader cannot see.
  { topic: 'branding.backgroundColor', page: 'admin.squares.settings', section: 'branding', order: 0 },
  { topic: 'branding.backgroundColor', page: 'pool.props.admin', section: 'branding', order: 0 },

  // T6 — the editor, then the two rules surfaces that render a bonus to
  // members. One topic, placed where it is read (voice rule 10).
  { topic: 'settings.payouts.bonuses.*.name', page: 'pool.bracket.manager', section: 'payouts', order: 0 },
  { topic: 'settings.payouts.bonuses.*.percentage', page: 'pool.bracket.manager', section: 'payouts', order: 1 },
  { topic: 'settings.payouts.bonuses.*.name', page: 'pool.bracket.rules', section: 'payouts', order: 0 },
  { topic: 'settings.payouts.bonuses.*.percentage', page: 'pool.bracket.rules', section: 'payouts', order: 1 },
  { topic: 'settings.payouts.bonuses.*.name', page: 'pool.nfl.rules', section: 'money', order: 3 },
  { topic: 'settings.payouts.bonuses.*.percentage', page: 'pool.nfl.rules', section: 'money', order: 4 },
];
