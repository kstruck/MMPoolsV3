// Coverage allowlist — PLAN-HELP-SYSTEM.md §3 D1 / D5.
//
// The help coverage guards fail on anything a reader can meet that no help
// topic explains. This file is where an uncovered thing is declared, WITH ITS
// REASON, so that adding one is a reviewable diff line rather than silence.
//
// There are two kinds of row and the difference matters:
//
//   PERMANENT — the thing genuinely has no explanation to give: a legacy field
//   alias, a value the wizard sets from the route, a redirect that renders no
//   page. These rows stay.
//
//   PENDING (T…) — a real reader-facing thing whose copy has not been written
//   yet, named with the ticket that will write it. The ticket's "done when" is
//   the removal of its rows. T0 ships with every schema path pending, which is
//   what makes CI green from day one without the guard being a no-op: a NEW
//   field added tomorrow is in neither list and fails.
//
// A row for a path that no longer exists in any schema also fails, so this
// list cannot rot into a list of things that used to be true.

/**
 * Every leaf path of every pool type's create-input schema
 * (`shared/schemas/index.ts` → `getCreateInputSchema`), measured 2026-08-17:
 * 87 leaves across the seven types.
 *
 * `tests/help-schema-audit.test.ts` walks the schemas and asserts this set is
 * exactly {leaves} minus {paths a topic claims in `fields[]`}.
 */
export const SCHEMA_PATH_ALLOWLIST: Readonly<Record<string, string>> = Object.freeze({
  // ---- PERMANENT: set by the wizard, never shown as an option -------------
  type: 'PERMANENT: the pool type comes from the /create/* route the reader chose; there is no control to explain.',
  season: 'PERMANENT: the current season is stamped at create. The reader is told which season on the basics step, but cannot set it.',
  gameId: 'PERMANENT: identifies the chosen game once a game is picked. The reader picks a game, not an id.',
  date: 'PERMANENT: derived from the chosen game.',
  gameTime: 'PERMANENT: derived from the chosen game.',
  week: 'PERMANENT: derived from the chosen game.',
  theme: "PERMANENT: legacy single-string theme, superseded by the branding fields. No control offers it — the squares and props wizards send the constant 'default' (CreateSquaresPool.tsx:41, CreatePropsPool.tsx:81).",

  // ---- PERMANENT: legacy aliases kept for older payloads ------------------
  venmo: 'PERMANENT: legacy top-level alias of paymentHandles.venmo, reconciled on write. One control, one topic — the nested path is the one readers meet.',
  zelle: 'PERMANENT: legacy top-level alias of paymentHandles.zelle.',
  cashapp: 'PERMANENT: legacy top-level alias of paymentHandles.cashapp.',
  paypal: 'PERMANENT: legacy top-level alias of paymentHandles.paypal.',
  'branding.logo': 'PERMANENT: legacy alias of branding.logoUrl.',
  'branding.bgColor': 'PERMANENT: legacy alias of branding.backgroundColor.',
  'settings.paymentHandles.venmo': 'PERMANENT: bracket-only nested duplicate of paymentHandles.venmo; the same control writes both.',
  'settings.paymentHandles.zelle': 'PERMANENT: bracket-only nested duplicate of paymentHandles.zelle.',
  'settings.paymentHandles.cashapp': 'PERMANENT: bracket-only nested duplicate of paymentHandles.cashapp.',
  'settings.paymentHandles.paypal': 'PERMANENT: bracket-only nested duplicate of paymentHandles.paypal.',
  'settings.paymentHandles.googlePay': 'PERMANENT: bracket-only nested duplicate of paymentHandles.googlePay.',
  'settings.paymentInstructions': 'PERMANENT: nested duplicate of paymentInstructions written by the same control.',

  // ---- PERMANENT: accepted by the schema, no surface at all ---------------
  'props.payouts.*': 'PERMANENT: legacy per-place prop payout array; the props wizard has no control for it.',
  'props.questions.*.id': 'PERMANENT: generated per question, never entered.',
  'props.questions.*.points': 'PERMANENT: accepted but not offered by the props wizard, which scores every question equally.',
  'props.questions.*.type': 'PERMANENT: accepted but not offered by the props wizard.',

  // ---- PENDING: shared wizard steps (T1 moves the existing hints) ---------
  name: 'T1: shared basics step — the pool name control.',
  managerName: 'T1: shared basics step — the host name shown to members.',
  contactEmail: 'T1: shared basics step — carries an existing hint= string to move.',
  contactPhone: 'T1: contact step control on the non-NFL types.',
  isPublic: 'T1: shared basics step — whether the pool is listed publicly.',
  paymentInstructions: 'T1: shared fee step — free-text instructions shown with the payment handles.',
  'paymentHandles.venmo': 'T1: shared fee step.',
  'paymentHandles.zelle': 'T1: shared fee step.',
  'paymentHandles.cashapp': 'T1: shared fee step.',
  'paymentHandles.paypal': 'T1: shared fee step.',
  'paymentHandles.googlePay': 'T1: shared fee step.',
  'branding.logoUrl': 'T1: shared branding step — carries an existing hint= string to move.',
  'branding.backgroundColor': 'T5: the legacy branding step has a colour picker for it (admin/WizardStepBranding.tsx:97), reached from the squares manager and the props edit wizard. The unified wizard offers only primaryColor and secondaryColor.',
  'branding.primaryColor': 'T1: shared branding step.',
  'branding.secondaryColor': 'T1: shared branding step.',
  'settings.entryFee': 'T1: shared fee step — carries an existing hint= string to move. Money copy, so voice rule 8 applies.',
  'settings.payouts.places.*.rank': 'T1: shared payouts step, written by a raw register() call that needs an explicit helpId.',
  'settings.payouts.places.*.percentage': 'T1: shared payouts step, same raw register() call.',
  'settings.payouts.bonuses.*.name': 'T1: payout bonus rows.',
  'settings.payouts.bonuses.*.percentage': 'T1: payout bonus rows.',

  // ---- PENDING: NFL Pick'em (T9) -----------------------------------------
  seasonType: 'T9: preseason / regular / postseason. Carries an existing hint= string on all three NFL wizards.',
  'settings.lockMode': 'T9: per-game or weekly lock.',
  'settings.pickMode': 'T9: straight up or against the spread. Carries an existing hint= string.',
  'settings.confidenceMode': 'T9: confidence points mode.',
  'settings.weeklyTiebreaker': 'T9: weekly tie-break rule. Its copy is tiebreakerCopy() in shared/nflTiebreaker.ts today and becomes this topic template.',
  'settings.pointsPerPick': 'T9: base points per correct pick — manager settings only, no wizard control.',
  'settings.lockBufferMinutes': 'T9: lock buffer — manager settings only, no wizard control.',
  'settings.isListedPublic': 'T9: whether an NFL pool appears in the public browse list.',

  // ---- PENDING: NFL Survivor (T10) ---------------------------------------
  'settings.maxStrikes': 'T10: how many wrong picks before elimination.',
  'settings.maxRebuys': 'T10: how many buy-backs a player may take.',
  'settings.rebuyDeadlineWeek': 'T10: last week a buy-back is allowed.',
  'settings.rebuyCost': 'T10: what a buy-back costs. Money copy, so voice rule 8 applies.',
  'settings.tieCountsAs': 'T10: whether a tied game survives. Its copy is tieOutcomeRuleCopy() today and becomes this topic template.',
  'settings.maxTeamUses': 'T10: how often one team may be picked. Its copy is teamReuseRuleCopy() today and becomes this topic template.',
  'settings.pickLosersMode': 'T10: pick the loser instead of the winner. Its copy is survivorModeRulesCopy() today and becomes this topic template.',
  'settings.autoSurviveExemptionEnabled': 'T10: whether a missed pick survives on an exemption.',

  // ---- PENDING: NFL Margin, hybrid split, multi-entry (T11) ---------------
  'settings.payoutMode': 'T11: season pot, weekly pot, or both. Money copy, so voice rule 8 applies.',
  'settings.hybridSplit.weeklyPerEntry': 'T11: the weekly share of each entry fee on a hybrid pool.',
  'settings.hybridSplit.seasonPerEntry': 'T11: the season share of each entry fee on a hybrid pool.',
  'settings.weeklyPayouts.places.*.rank': 'T11: the separate weekly place list a hybrid pool may carry.',
  'settings.weeklyPayouts.places.*.percentage': 'T11: the separate weekly place list a hybrid pool may carry.',
  'settings.maxEntriesPerUser': 'T11: how many entries one person may hold. The wizard control is behind MULTI_ENTRY_WIZARD_ENABLED, which is false; the topic is written anyway because the manager settings form shows it.',

  // ---- PENDING: Bracket and Playoff (T12) --------------------------------
  'settings.maxEntriesTotal': 'T12: the cap on entries in the whole pool. The bracket manager tab edits it (BracketPoolDashboard.tsx:109 editMaxTotal, written at :350); -1 means unlimited, which the copy has to say.',
  'settings.customScoring': 'T12: the bracket manager tab authors the per-round point values when the scoring system is CUSTOM (BracketPoolDashboard.tsx:112 editCustomScoring, written at :353).',
  seasonYear: 'T12: which tournament year a bracket pool covers.',
  gender: 'T12: mens or womens tournament.',
  tournamentType: 'T12: which tournament the bracket follows.',
  'settings.scoringSystem': 'T12: how bracket rounds are worth points. Its labels are SCORING_SYSTEM_LABELS in BracketRulesPanel today and become this topic.',
  'settings.tieBreakers.closestAbsolute': 'T12: tie-break on the closest total either way.',
  'settings.tieBreakers.closestUnder': 'T12: tie-break on the closest total without going over.',
  lockDate: 'T12: when playoff picks lock. Carries an existing hint= string.',
  'settings.scoring.roundMultipliers.WILD_CARD': 'T12: playoff round weighting.',
  'settings.scoring.roundMultipliers.DIVISIONAL': 'T12: playoff round weighting.',
  'settings.scoring.roundMultipliers.CONF_CHAMP': 'T12: playoff round weighting.',
  'settings.scoring.roundMultipliers.SUPER_BOWL': 'T12: playoff round weighting.',

  // ---- PENDING: Squares and Props (T13) ----------------------------------
  costPerSquare: 'T13: what one square costs. Money copy, so voice rule 8 applies.',
  maxSquaresPerPlayer: 'T13: cap on squares per person.',
  numberSets: 'T13: one set of numbers for the whole game, or a fresh set each quarter.',
  homeTeam: 'T13: the home team of the game a squares or props pool covers.',
  awayTeam: 'T13: the away team of the game a squares or props pool covers.',
  'props.cost': 'T13: what one card costs. Money copy, so voice rule 8 applies.',
  'props.maxCards': 'T13: cap on cards per person.',
  'props.questions.*.text': 'T13: the question a player answers.',
  'props.questions.*.options.*': 'T13: the answers on offer. Carries an existing placeholder-like hint= string.',
});

/**
 * Routes in `src/App.tsx` with no `HelpPage` yet.
 *
 * T0 ships every route pending because `pages.ts` is empty; T2 and T3 empty
 * this list down to the permanent rows. A route ADDED to `App.tsx` and not
 * listed here fails the registry invariant test, which is the guard: a new
 * page cannot ship with no help and no decision.
 */
export const ROUTE_ALLOWLIST: Readonly<Record<string, string>> = Object.freeze({
  // PERMANENT — these render no page a reader can be helped on.
  '/custom-sports': 'PERMANENT: redirect to /.',
  '/support': 'PERMANENT: redirect to /how-it-works?view=faq.',
  '/articles/bracket-pool-guide': 'PERMANENT: redirect to /how-it-works.',
  '*': 'PERMANENT: 404 catch-all, redirects to /.',
  '/auth/action': 'PERMANENT: transient email-link handler. Nothing to explain and nowhere to put a button.',
  '/dev/dashboards': 'PERMANENT: developer preview, not reachable by a reader.',
  '/dev/profile-demo': 'PERMANENT: developer preview, not reachable by a reader.',

  // PENDING — T2 (pool surfaces + wizards) and T3 (site + account).
  '/': 'T3: marketing landing.',
  '/gameday-squares': 'T3: marketing landing.',
  '/march-madness': 'T3: marketing landing.',
  '/nfl-playoffs': 'T3: marketing landing.',
  '/pricing': 'T3: pricing page.',
  '/payment-success': 'T3: post-checkout confirmation. Renders no Header, so it is shortcut-only.',
  '/about': 'T3: marketing page.',
  '/charity': 'T3: marketing page.',
  '/browse': 'T3: public pool list.',
  '/features': 'T3: marketing page.',
  '/how-it-works': 'T3: has four view modes and its own FAQ, which the panel links to rather than duplicating.',
  '/privacy': 'T3: legal page.',
  '/terms': 'T3: legal page.',
  '/contact': 'T3: contact form.',
  '/profile': 'T3: your own profile and its three sections.',
  '/profile/:uid': 'T3: another player’s public profile.',
  '/scoreboard': 'T3: scores page with three in-memory tabs.',
  '/odds/super-bowl-squares': 'T3: odds article page.',
  '/participant': 'T3: My Entries, with six in-memory tabs.',
  '/create-pool': 'T3: the pool-type picker.',
  '/join/:poolId': 'T3: the join and pay screen.',
  '/create/playoff': 'T2: wizard route; its per-step pages land with the wizard publisher.',
  '/create/pickem': 'T2: wizard route.',
  '/create/survivor': 'T2: wizard route.',
  '/create/margin': 'T2: wizard route.',
  '/create/bracket': 'T2: wizard route.',
  '/create/squares': 'T2: wizard route.',
  '/create/props': 'T2: wizard route.',
  '/pool/:id': 'T2: every pool dashboard and tab resolves through this one route.',
  '/admin/:id': 'T2: the squares manager panel and the redirect for the other types.',
  '/super-admin': 'T14: seventeen admin tabs get page-level summaries only (K4 scope ii).',
  '/tournament-sim': 'T14: admin simulation surface.',
});

/**
 * UI controls exempted from needing a help topic, keyed by the id a component
 * carries in `data-help-exempt`.
 *
 * Empty in T0 — nothing renders a `HelpTip` yet. T1 onwards adds a row per
 * exempted control. The guard in `help-ui-coverage.test.ts` (T1) fails on an
 * exemption id used in a file other than its declared one, and on a row
 * nothing references, so an exemption cannot be copied around or left behind.
 */
export const UI_EXEMPTIONS: Readonly<
  Record<string, { file: string; control: string; reason: string }>
> = Object.freeze({});
