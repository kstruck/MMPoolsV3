// Manager-only fields with no create-wizard control — PLAN-HELP-SYSTEM.md T5, T6.
//
// Both tickets cover settings a pool can be created with, that the unified
// create wizard never offers, and that are edited only on a manager surface.
// That is why their rows sat in `SCHEMA_PATH_ALLOWLIST` after T1: the wizard
// tickets could not write copy for a control the wizard does not have.
//
// WHAT IS IN HERE:
//
//   T5  `branding.backgroundColor` — the colour picker on the legacy branding
//       step (`WizardStepBranding.tsx:93` and its admin twin
//       `admin/WizardStepBrandingAdmin.tsx:144`), reached from the squares
//       manager's Setup Wizard tab (`AdminPanel.tsx:675`, step 6) and from the
//       props edit wizard embedded in the props Manage tab
//       (`PropsPoolDashboard.tsx:352` → `PropsWizard.tsx:227`, step 1).
//
//   T6  `settings.payouts.bonuses.*.name` and `.percentage` — the bonus-row
//       editor in `BracketPoolDashboard.tsx:1638-1667`. `StepPayouts` edits
//       places only, so no wizard has ever offered a bonus.
//
// 🛑 AND THAT IS A SLICE OF T5/T6, NOT THE WHOLE OF EITHER (codex r5). The
// plan's rows (PLAN-HELP-SYSTEM.md:872-873) are much wider than those three
// schema paths, and everything in this list is STILL OUTSTANDING:
//
//   T5  `AdminPanel.tsx` and the rest of `admin/WizardStep*.tsx` converted to
//       `FieldLabel` (K12); `WizardStepReminders.tsx`; DELETE the two dead
//       legacy steps `WizardStepDetails.tsx` / `WizardStepSquaresDetails.tsx`,
//       which K12 records as having no importers.
//   T6  `BracketRulesPanel`'s `SCORING_SYSTEM_LABELS` moved into the registry;
//       the rest of the bracket manager tab; `PropsWizard.tsx` and its other
//       two child steps (`WizardStepGame`, `WizardStepReminders`);
//       `Props/PropsManager.tsx`; the three Playoff manager surfaces
//       (`PlayoffSettingsModal`, `RankingForm`, `PlayoffResultsManager`); and
//       the `PayoutGallery.tsx` delete-or-exempt decision.
//
// Neither ticket's "coverage green" bar is met by this file, and the T4 label
// guard's `MANAGER_FILES` list — which its own comment says "T5–T7 add theirs
// to this list as they land" — is still `NFLManagerView.tsx` alone. Anything
// here reading "CLOSED BY T5/T6" is about an ALLOWLIST ROW, never the ticket.
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
//   `PoolBranding` at all. So the TOPIC is scoped to squares and props and
//   stops there; see `COLOURED_TYPES`.
//
//   WHAT A BONUS PERCENTAGE IS A PERCENTAGE OF (voice rule 8). The pot, which
//   is entry fees the commissioner collects peer to peer — the platform holds
//   none of it. `payoutsSchema` (`shared/schemas/common.ts:78`) adds places and
//   bonuses together against one 100% ceiling, and the editor's own total does
//   the same sum. NOTHING awards a bonus: no scorer reads `bonuses`, so the
//   commissioner decides the winner and pays them.
//
//   ⚠️ "THE POT" IS NOT ALWAYS ONE POT (codex r4). An NFL pool may run
//   `payoutMode: 'HYBRID'`, and `PayoutsPanel` then prices every percentage off
//   BOTH pots — except where the pool also declares its own weekly place list.
//   `separateWeekly` (`PayoutsPanel.tsx:376`) is `HYBRID` plus
//   `settings.weeklyPayouts.places`, and under it a bonus renders as "% of the
//   season pot" and the weekly list is priced separately. So the copy is
//   written against the ONE thing true in every mode — a bonus and the places
//   it is listed BESIDE always share a pot, because both live on
//   `settings.payouts` — and then names the separate-weekly case outright.
//   "One pot" and "95% for the finishing places" were false there.
//
//   ⚠️ THE BONUS TOPICS ARE WRITTEN IN THE THIRD PERSON, ON PURPOSE (codex r6).
//   They are commissioner CONTROLS, but their audience is `EVERYONE` because
//   the value is on a member-facing rules page — so every "you" in them was
//   addressed to the commissioner and read as a lie to the member who met them
//   there ("you decide, and you pay them", "add as many rows as you want",
//   "remove one with the cross beside it"). The registry has no audience-keyed
//   copy — a variant may key on POOL TYPE only, and `buildRegistry` refuses a
//   variant whose audience differs from its base — so one wording has to serve
//   both readers, and the only wording that can is one that names the actor
//   instead of assuming it. The guard is mechanical: a topic here that members
//   can see may not use the second person at all.
//
//   The same is NOT true of `branding.backgroundColor`, which is `HOST_ONLY`.
//   Its "your pool page" is addressed to the only reader it has.
//
//   WHERE MEMBERS READ A BONUS. `PayoutsPanel.tsx:471` renders the bonus list
//   behind `!compact`, so the bracket rules panel and the NFL rules page show
//   it and the JOIN SCREEN (`JoinPool.tsx:223`, `compact`) does not. A playoff
//   pool never shows one — `PlayoffPayoutCard.tsx:36` lists places only.
//
//   ⚠️ THE COPY NAMES THE **RULES TAB**, NOT A "PAYMENT PAGE" (codex r3). The
//   help PAGE ids for those two screens are titled "Rules & payment", but the
//   pool's own tab bar says `Rules` (`BracketPoolDashboard.tsx:716`) and
//   `Rules & Rulesets` (`NFLPoolDashboard.tsx:129`) — and both dashboards ALSO
//   carry a separate payments screen (`pool.nfl.payments`, `pool.bracket.ledger`)
//   which renders the ledger and not this configuration. "Rules and payment
//   page" sent a member to the one screen that cannot show them a bonus.
//
// ⚠️ A TOPIC MUST NOT CLAIM A POOL TYPE ITS PLACEMENTS CANNOT SERVE (codex r1
// on this branch, two findings). The first draft scoped each topic to every
// type whose CREATE CONTRACT carries the path, so that the allowlist rows could
// be deleted outright — six types for the colour, five for the bonus rows —
// while the placements below cover only the surfaces that render each control.
// The gap is not cosmetic. `Registry.search` picks a result's page with
// `pageForResult`, which keeps only placements on a page THIS reader may see;
// with none it returns `pageId: undefined`, `useHelpPanel.pageForTopic` then
// falls back to `candidates[0].page`, and `canOpenPage` refuses it because the
// page belongs to another pool type. So an NFL commissioner searching Help for
// "background" got a result that could not be opened, and a playoff reader the
// same for a bonus.
//
// The scopes below are therefore the types that actually RENDER the control or
// the value, and the residual paths go back to `SCHEMA_PATH_ALLOWLIST` as
// PERMANENT rows — the same shape `seasonType` has carried since T1 and the
// same call T9 made on `settings.pointsPerPick`. A wider scope would have let
// the schema audit report a setting as explained for a type that shows nothing,
// which `registry.ts` already names as "the one way an allowlist row could be
// deleted while the option it covered stayed unexplained".
//
// `tests/help-content-manager-fields.test.ts` guards the class, not the three
// cases: every (pool type, audience) a topic here is visible to must have a
// placement on a page visible to that same reader.

import type { HelpPlacement, HelpTopic } from '../types';
import type { PoolType } from '@shared/poolTypes';

/**
 * The types with a background-colour CONTROL and a page that paints with it.
 *
 * Six types carry `brandingSchema` (every one but Bracket), but only these two
 * ever meet the setting: `WizardStepBrandingAdmin` is reached from the squares
 * manager and `WizardStepBranding` from the props edit wizard, and those are
 * the only two colour pickers in the app — `StepBranding`, the unified create
 * wizard's step, writes `logoUrl`, `primaryColor` and `secondaryColor` and
 * nothing else. The two pages that read the value belong to the same two types.
 *
 * `branding.backgroundColor` therefore stays allowlisted for the other four:
 * nothing writes it there and nothing reads it, so there is no control for copy
 * to explain.
 */
const COLOURED_TYPES: readonly PoolType[] = ['SQUARES', 'PROPS'];

/**
 * The types that show a bonus to somebody: Bracket, whose commissioner tab is
 * the only bonus EDITOR in the app, and the three NFL season formats, whose
 * rules page renders the list through `PayoutsPanel` (`!compact`).
 *
 * Squares and Props are out because their payout settings carry no bonus list
 * at all — squares splits by quarter and the props array is a legacy per-place
 * list. NFL_PLAYOFFS carries the list in its create contract and is out for the
 * other reason: `StepPayouts` edits places only, no playoff surface edits
 * payouts at all, and `PlayoffPayoutCard.tsx:36` renders places only — so a
 * playoff pool's bonus list is always empty and never shown. Its two paths stay
 * allowlisted.
 */
const BONUS_TYPES: readonly PoolType[] = [
  'BRACKET',
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
      'Members see the new colour the next time they open the pool. Nothing else moves with it: your logo, the cards and the type on them stay exactly as they were.',
    ].join('\n\n'),
    poolTypes: COLOURED_TYPES,
    audience: HOST_ONLY,
    related: ['branding.primaryColor', 'branding.secondaryColor', 'branding.logoUrl'],
  },

  // ---- T6: the bonus rows on the payouts editor ---------------------------
  {
    id: 'settings.payouts.bonuses.*.name',
    title: 'Bonus prize name',
    short:
      'The label on a prize awarded for something the standings do not rank. It is what appears in the prize list beside the bonus’s share.',
    long: [
      'A bonus is a prize for something other than a finishing position — the biggest upset, the best opening round, last place. Nothing in the pool works out who won it: the commissioner decides, and pays the winner directly, the same way every other prize is paid.',
      'The name is the whole of what a player sees. A bonus left unnamed reaches the prize list as the bare word "Bonus", which says nothing about what to aim at, so it is worth naming for the thing being rewarded.',
      'A pool can carry any number of bonuses. When one is taken away its share is unassigned, and the prize list stops adding up to the whole pot until that share is given to a finishing place or to another bonus.',
    ].join('\n\n'),
    poolTypes: BONUS_TYPES,
    audience: EVERYONE,
    related: ['settings.payouts.bonuses.*.percentage', 'settings.payouts.places.*.rank'],
  },
  {
    id: 'settings.payouts.bonuses.*.percentage',
    title: 'Bonus prize share',
    short:
      'What share of the pot a bonus takes. It draws on the same pot as the finishing places beside it — the money collected from players.',
    long: [
      'The pot is the entry fees collected from players. Nothing is held here, so this share is a record of what the commissioner owes whoever wins the bonus rather than a transfer — the money goes from them to the winner directly.',
      'A bonus and the places listed beside it are added together against one 100% ceiling, so a 5% bonus leaves 95% for those places. If the pool pays separate weekly prizes off their own list, a bonus comes out of the season pot only and leaves the weekly prizes alone.',
      'Every bonus and its share is listed on the pool’s Rules tab, under the finishing places. The join screen leaves them out, so somebody deciding whether to join sees the finishing places and not this.',
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
