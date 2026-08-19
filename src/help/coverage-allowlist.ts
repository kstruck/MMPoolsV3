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

  // ---- PENDING: settings with no control in the create wizard -------------
  // Re-ticketed in T1: measured against the wizard sources, none of these three
  // has a control there, so T1 could not have written their copy. Each is edited
  // on the manager surface named below, and moves with that surface's ticket.
  contactPhone: 'T4: no create-wizard control. NFLManagerView.tsx:280 edits it on the NFL manager settings form.',
  'branding.backgroundColor': 'T5: the legacy branding step has a colour picker for it (admin/WizardStepBranding.tsx:97), reached from the squares manager and the props edit wizard. The unified wizard offers only primaryColor and secondaryColor.',
  'settings.payouts.bonuses.*.name': 'T6: no create-wizard control — StepPayouts edits places only. BracketPoolDashboard.tsx:1556 is the bonus-row editor.',
  'settings.payouts.bonuses.*.percentage': 'T6: no create-wizard control; same bonus-row editor as the name above.',

  // ---- PENDING: NFL Pick'em (T9) -----------------------------------------
  seasonType: 'T13: explained for the three NFL season types by the seasonType topic (T1). SQUARES and PROPS also carry the field and have no control for it, so the row stays until their content ticket accounts for it.',
  // T9 removed confidenceMode and isListedPublic. lockMode and
  // lockBufferMinutes were WITHDRAWN mid-review — see their rows.
  'settings.lockMode': 'T9-BLOCKED: withdrawn after codex found the claim false in the shipped client. NFLPoolDashboard.tsx:515-534 computes the week lock from the EARLIEST kickoff for every NFL type, ignoring lockMode, and PickemPickEntry.tsx:138-141 locks every game once that flag is set — so a PER_GAME pool (the wizard default) locks its whole sheet at the first kickoff while nflPools.ts:568,618-624 would still accept a later pick. Copy would describe either the setting (false on screen) or the screen (documenting the bug). Lands with the client fix; see MORNING-2026-08-18-HELP-T9.md.',
  'settings.lockBufferMinutes': 'T9-BLOCKED: withdrawn after codex found the claim false in the shipped client. NFLPoolDashboard.tsx:515-534 computes the week lock from the EARLIEST kickoff for every NFL type, ignoring lockMode, and PickemPickEntry.tsx:138-141 locks every game once that flag is set — so a PER_GAME pool (the wizard default) locks its whole sheet at the first kickoff while nflPools.ts:568,618-624 would still accept a later pick. Copy would describe either the setting (false on screen) or the screen (documenting the bug). Lands with the client fix; see MORNING-2026-08-18-HELP-T9.md.',
  // `settings.pointsPerPick` is the one row T9 could NOT close, and the reason
  // is a product defect rather than missing copy — see below.
  'settings.pointsPerPick': "T9-BLOCKED: the value is INERT. `scorePickemEntry` (functions/src/nflScoringEngine.ts:174-178) awards exactly 1 per correct pick on a non-confidence pool and never reads this field, while NFLManagerView.tsx:1336 lets a commissioner set 1-10 and NFLPoolRules.tsx:158,220 shows the chosen number to members as what a pick is worth. Any help copy here would either repeat that claim or document the bug. Kevin's call: honour it in the scorer, or drop the control. Raised in the T9 PR body and MORNING-2026-08-18-HELP-T9.md.",

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

  // ---- PENDING: Bracket and Playoff (T12) --------------------------------
  'settings.maxEntriesTotal': 'T12: the cap on entries in the whole pool. The bracket manager tab edits it (BracketPoolDashboard.tsx:109 editMaxTotal, written at :350); -1 means unlimited, which the copy has to say.',
  'settings.customScoring': 'T12: the bracket manager tab authors the per-round point values when the scoring system is CUSTOM (BracketPoolDashboard.tsx:112 editCustomScoring, written at :353).',
  seasonYear: 'T12: which tournament year a bracket pool covers.',
  gender: 'T12: mens or womens tournament.',
  tournamentType: 'T12: which tournament the bracket follows.',
  'settings.scoringSystem': 'T12: how bracket rounds are worth points. Its labels are SCORING_SYSTEM_LABELS in BracketRulesPanel today and become this topic.',
  'settings.tieBreakers.closestAbsolute': 'T12: tie-break on the closest total either way.',
  'settings.tieBreakers.closestUnder': 'T12: tie-break on the closest total without going over.',
  'settings.scoring.roundMultipliers.WILD_CARD': 'T12: playoff round weighting.',
  'settings.scoring.roundMultipliers.DIVISIONAL': 'T12: playoff round weighting.',
  'settings.scoring.roundMultipliers.CONF_CHAMP': 'T12: playoff round weighting.',
  'settings.scoring.roundMultipliers.SUPER_BOWL': 'T12: playoff round weighting.',

  // ---- PENDING: Squares and Props (T13) ----------------------------------
  maxSquaresPerPlayer: 'T13: cap on squares per person.',
  numberSets: 'T13: one set of numbers for the whole game, or a fresh set each quarter.',
  homeTeam: 'T13: the home team of the game a squares or props pool covers.',
  awayTeam: 'T13: the away team of the game a squares or props pool covers.',
  'props.maxCards': 'T13: cap on cards per person.',
});

/**
 * Routes in `src/App.tsx` with no `HelpPage` yet.
 *
 * T0 shipped every route pending because `pages.ts` was empty. T1 took the
 * seven `/create/*` rows out; T2 takes `/pool/:id` and `/admin/:id` out. What
 * remains is T3 (the site and account pages) and T14 (the two admin surfaces),
 * plus the permanent rows. A route ADDED to `App.tsx` and not listed here fails
 * the registry invariant test, which is the guard: a new page cannot ship with
 * no help and no decision.
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
/**
 * Create-wizard form paths with no `HelpTopic` yet.
 *
 * `tests/help-ui-coverage.test.ts` reads every `name=`, `register(...)`,
 * `feeField=` and `payoutsField=` literal under
 * `src/components/wizard/**` and fails on one that neither resolves to a topic
 * nor appears here. That is the PRIMARY coverage guard — the schema audit
 * proves a setting is accounted for, this proves a rendered control is.
 *
 * A row here means the control renders with no `?` beside it. `HelpTip` returns
 * null rather than throwing on an unknown id, precisely so content can land
 * ticket by ticket without breaking the wizard in between; this list is what
 * stops that from being silent.
 */
export const WIZARD_FIELD_ALLOWLIST: Readonly<Record<string, string>> = Object.freeze({
  // ---- PERMANENT: not an option, or already covered by an explicit helpId --
  _tosAccepted: 'PERMANENT: the Terms gate. Its copy is the checkbox label itself and the linked Terms page; a tooltip would repeat it.',
  multiEntry: 'PERMANENT: the yes/no toggle for settings.maxEntriesPerUser. It carries an explicit helpId to that topic — one concept, one topic (voice rule 10).',
  'addons.*': 'PERMANENT: the four premium add-on checkboxes carry an explicit helpId to the launch.addons topic, which explains the group.',
  'settings.payouts': 'PERMANENT: the payouts object path passed to StepPayouts, not a control. Its two controls carry explicit helpIds.',
  'settings.weeklyPayouts': 'PERMANENT: the second payouts path a HYBRID pool binds the same editor to, not a control. Its two controls carry the same explicit helpIds.',
  '*.places.*.rank': 'PERMANENT: the payouts editor binds its rows to a path passed in as a prop, so this register() call cannot name a topic. It carries an explicit helpId to settings.payouts.places.*.rank.',
  '*.places.*.percentage': 'PERMANENT: same editor, same reason; explicit helpId to settings.payouts.places.*.percentage.',

  // ---- NFL Pick'em (T9): the confidence control resolves to a topic in
  // `content/nfl-pickem.ts`. The lock-mode row came back — see the schema
  // allowlist above for why.
  'settings.lockMode': 'T9-BLOCKED: withdrawn after codex found the claim false in the shipped client. NFLPoolDashboard.tsx:515-534 computes the week lock from the EARLIEST kickoff for every NFL type, ignoring lockMode, and PickemPickEntry.tsx:138-141 locks every game once that flag is set — so a PER_GAME pool (the wizard default) locks its whole sheet at the first kickoff while nflPools.ts:568,618-624 would still accept a later pick. Copy would describe either the setting (false on screen) or the screen (documenting the bug). Lands with the client fix; see MORNING-2026-08-18-HELP-T9.md.',

  // ---- PENDING: NFL Survivor (T10) ---------------------------------------
  'settings.maxStrikes': 'T10: how many wrong picks before elimination.',
  'settings.maxRebuys': 'T10: how many buy-backs a player may take.',
  'settings.rebuyDeadlineWeek': 'T10: last week a buy-back is allowed.',
  'settings.rebuyCost': 'T10: what a buy-back costs.',
  'settings.tieCountsAs': 'T10: whether a tied game survives.',
  'settings.maxTeamUses': 'T10: how often one team may be picked.',
  'settings.pickLosersMode': 'T10: pick the loser instead of the winner.',
  'settings.autoSurviveExemptionEnabled': 'T10: whether a missed pick survives on an exemption.',

  // ---- PENDING: NFL Margin and the hybrid split (T11) ---------------------
  'settings.payoutMode': 'T11: season pot, weekly pot, or both.',
  'settings.hybridSplit.weeklyPerEntry': 'T11: the weekly share of each entry fee on a hybrid pool.',
  'settings.hybridSplit.seasonPerEntry': 'T11: the season share of each entry fee on a hybrid pool.',

  // ---- PENDING: Bracket and Playoff (T12) --------------------------------
  seasonYear: 'T12: which tournament year a bracket pool covers.',
  gender: 'T12: mens or womens tournament.',
  tournamentType: 'T12: which tournament the bracket follows.',
  'settings.scoringSystem': 'T12: how bracket rounds are worth points.',
  'settings.tieBreakers.closestAbsolute': 'T12: tie-break on the closest total either way.',
  'settings.tieBreakers.closestUnder': 'T12: tie-break on the closest total without going over.',
  'settings.scoring.roundMultipliers.WILD_CARD': 'T12: playoff round weighting.',
  'settings.scoring.roundMultipliers.DIVISIONAL': 'T12: playoff round weighting.',
  'settings.scoring.roundMultipliers.CONF_CHAMP': 'T12: playoff round weighting.',
  'settings.scoring.roundMultipliers.SUPER_BOWL': 'T12: playoff round weighting.',

  // ---- PENDING: Squares and Props (T13) ----------------------------------
  homeTeam: 'T13: the home team of the game a squares or props pool covers.',
  awayTeam: 'T13: the away team of the game a squares or props pool covers.',
  maxSquaresPerPlayer: 'T13: cap on squares per person.',
  numberSets: 'T13: one set of numbers for the whole game, or a fresh set each quarter.',
  'props.maxCards': 'T13: cap on cards per person.',
});
