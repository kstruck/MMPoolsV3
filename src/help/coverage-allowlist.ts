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
  theme: "PERMANENT: legacy single-string theme, superseded by the branding fields. No control offers it — the squares and props wizards send the constant 'default' (CreateSquaresPool.tsx:43, CreatePropsPool.tsx:83).",

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

  // ---- settings with no control in the create wizard ----------------------
  // Re-ticketed in T1: measured against the wizard sources, none of these four
  // has a control there, so T1 could not have written their copy. Each is edited
  // on the manager surface named below, and moves with that surface's ticket.
  //
  // `contactPhone` CLOSED BY T4. It has no create-wizard control and never
  // will — the unified wizard collects an email and nothing else — so its copy
  // had to wait for the manager form that does edit it. The topic lives in
  // `content/wizard-shared.ts` beside `contactEmail` and is placed on
  // `pool.nfl.manager.settings`, alongside the `contactMethod` topic that says
  // whether either of them is ever shown.
  //
  // T5 and T6 wrote the other three, in `content/manager-fields.ts`, and each
  // is now explained for the types that actually render it: the squares Setup
  // Wizard tab and the props Manage tab for the background colour, the bracket
  // commissioner tab plus the bracket and NFL rules pages for the bonus rows.
  // The rows below are what is LEFT — the types whose create contract carries
  // the path with no control and no reader anywhere. They are PERMANENT for the
  // same reason `theme` and `props.questions.*.points` are, and they read the
  // way `seasonType` does: a real topic covers part of the field's reach and a
  // written reason covers the rest.
  'branding.backgroundColor': 'PERMANENT for NFL_PLAYOFFS / NFL_PICKEM / NFL_SURVIVOR / NFL_MARGIN, CLOSED BY T5 for SQUARES and PROPS. The only two colour pickers in the app are WizardStepBranding (props edit wizard) and admin/WizardStepBrandingAdmin (squares manager); the unified wizard\'s StepBranding writes logoUrl, primaryColor and secondaryColor and nothing else. The only two readers are PoolRoute.tsx:507 (squares) and PropsPoolDashboard.tsx:90 (props) — the playoff dashboard reads the legacy branding.bgColor and the NFL dashboards go through brandingStyles(), which has no backgroundColor branch. So on those four types the field is written by nothing and read by nothing, and there is no control for copy to explain.',
  'settings.payouts.bonuses.*.name': 'PERMANENT for NFL_PLAYOFFS, CLOSED BY T6 for BRACKET and the three NFL season formats. A playoff pool has no bonus editor — StepPayouts edits places only, and no playoff surface edits payouts at all — and no bonus reader: PlayoffPayoutCard.tsx:36 lists finishing places only, where the bracket and NFL rules pages render the list through PayoutsPanel. Its bonus list is therefore always empty and never shown. If a playoff surface ever renders one, this row goes and NFL_PLAYOFFS joins BONUS_TYPES in content/manager-fields.ts.',
  'settings.payouts.bonuses.*.percentage': 'PERMANENT for NFL_PLAYOFFS, CLOSED BY T6 elsewhere; same editor and same readers as the bonus name above.',

  // ---- PENDING: NFL Pick'em (T9) -----------------------------------------
  // SETTLED BY T13, and settled as PERMANENT rather than closed with copy.
  //
  // The three NFL season formats are explained by the `seasonType` topic
  // (`content/wizard-shared.ts`), which is scoped to those three. What was left
  // was SQUARES and PROPS, which accept the field. Measured against the
  // sources: NEITHER create wizard binds a control to it (nothing in
  // `CreateSquaresPool.tsx` or `CreatePropsPool.tsx`, and it is in no
  // WIZARD_FIELD_ALLOWLIST row because no binding exists to allow), neither
  // payload builder sends it (`buildSquaresPayload.ts`, `buildPropsPayload.ts`),
  // and no squares or props surface reads it — every `poolSeasonType` caller is
  // an NFL weekly-pool screen or the super-admin spreads tool. The ONE writer is
  // the legacy squares game picker, which stamps it from the chosen game
  // alongside `gameId` and `week` (`AdminPanel.tsx:371`), exactly as the
  // `week` row above describes.
  //
  // So widening the topic's poolTypes was refused: its copy names a default
  // ('2') that only the Pick'em wizard sets, and says members see the weeks
  // belonging to the part chosen — neither is true of a one-game pool. It would
  // have put a topic in the Help panel of a pool with no such control, which is
  // voice rule 5's failure mode with a different face.
  seasonType: 'PERMANENT: the three NFL season types are explained by the seasonType topic. SQUARES and PROPS accept the field but offer no control for it — neither create wizard binds it and neither payload builder sends it — and the only writer is the legacy squares game picker, which stamps it from the chosen game alongside gameId and week (AdminPanel.tsx:371). Derived from the chosen game, same as the week row above. (T13)',
  // T9 removed confidenceMode and isListedPublic. It WITHDREW lockMode and
  // lockBufferMinutes mid-review because the shipped client ignored lockMode;
  // 93f44bb2 (#482) fixed that, so both rows are gone and both topics are
  // authored in content/nfl-pickem.ts and content/nfl-shared.ts.
  // `settings.pointsPerPick` was the one row T9 could NOT close, because the
  // defect was a product one rather than missing copy. Kevin ruled on
  // 2026-08-22 and the row is SETTLED — see below.
  'settings.pointsPerPick': "PERMANENT (Kevin, 2026-08-22 — PLAN-DELETE-INERT-PICKEM-SCORING.md). The field is INERT: `scorePickemEntry` awards exactly 1 point per correct pick on a non-confidence pool and never reads it. Every control and every member-facing row that displayed it is DELETED — the manager's Scoring Configuration card, NFLPoolRules' Base Points row, and JoinPool's rules preview. No surface writes or shows it, so there is no control for help copy to explain; the path stays here because `shared/schemas/nfl.ts` still accepts the field, which is what keeps a stored value on an existing pool from being rejected. `settings.primetimeBonus` never had a row because it is not in that schema.",

  // ---- NFL Survivor (T10): all eight rows CLOSED --------------------------
  // The eight survivor settings are authored in `content/nfl-survivor.ts`, all
  // scoped to `NFL_SURVIVOR`. The three that already had shipped copy —
  // `tieCountsAs`, `maxTeamUses`, `pickLosersMode` — did NOT get a second
  // wording: their topics CALL `utils/survivorRules.ts` from the `template`,
  // exactly as the note above `HelpCopy` in `help/types.ts` prescribes, and
  // `tests/help-content-nfl-survivor.test.ts` holds every branch to the live
  // helper byte-for-byte.

  // ---- CLOSED BY T11 -------------------------------------------------------
  // `settings.payoutMode`, both `settings.hybridSplit.*` amounts and both
  // `settings.weeklyPayouts.places.*` paths are explained now. The first three
  // are topics in `content/nfl-margin.ts`, scoped to the two types that carry
  // them (Pick'em and Margin — Survivor has no payout mode). The weekly place
  // paths are claimed by the EXISTING `settings.payouts.places.*` topics'
  // `fields[]` rather than by a second pair: it is the same editor bound to a
  // second path, and both surfaces already point its `helpId` at those topics
  // (voice rule 10).

  // ---- Bracket and Playoff (T12) -----------------------------------------
  // T12 removed eleven rows: seasonYear, gender, tournamentType,
  // settings.scoringSystem, settings.customScoring, both tieBreakers and all
  // four roundMultipliers are authored in `content/bracket.ts`.
  //
  // `settings.maxEntriesTotal` is the one row T12 could not delete, and the
  // reason is the code rather than missing copy — so it is RE-SCOPED, not left
  // pending. It is now PERMANENT for the reader it was pending for.
  'settings.maxEntriesTotal':
    'PERMANENT for NFL_PLAYOFFS (T12, 2026-08-27). BRACKET is explained — `content/bracket.ts` covers the manager control (BracketPoolDashboard.tsx:112 editMaxTotal, written at :374) and the -1-means-no-limit gate (functions/src/bracketEntries.ts:75). The PLAYOFF create input accepts the same field and NOTHING reads it: the playoff wizard binds no control for it, submitPlayoffPicks caps on maxEntriesPerUser, the free-plan ten and the paid ceiling but never on this (functions/src/playoffPools.ts:205-217), and getPoolEntrySummary returns capacity null for a playoff pool on purpose (src/utils/poolSport.ts:105-108). There is no control to explain and no behaviour to describe, so a topic scoped to NFL_PLAYOFFS could only say something untrue. Same shape as settings.pointsPerPick above. Deleting this row needs a product decision — enforce it for playoff pools, or drop it from the playoff create input — not help copy.',

  // ---- Squares and Props (T13): CLOSED ------------------------------------
  // `maxSquaresPerPlayer`, `numberSets`, `props.maxCards` and the two team
  // names are authored in `content/squares-props.ts`. `homeTeam` and `awayTeam`
  // are one topic claiming both paths in `fields[]`, because they are one
  // explanation (voice rule 10).
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

  // PENDING — T14 (the two admin surfaces). T3 CLOSED the twenty-one site and
  // account rows: every one of them now has a page in
  // `content/site-pages.ts`, and two of the reasons written here were wrong
  // about the code, which is why they are gone rather than edited:
  //   - `/participant` had SEVEN tabs, not six (`ParticipantDashboard.tsx:67`
  //     — insights, all, open, live, completed, commissioner, entries), and
  //     the tab is NOT purely in memory: the surface adopts a valid `?tab=` on
  //     mount, so its tab pages are linkable where the scoreboard's are not —
  //     but only FROM `/participant`. The route redirects a signed-out visitor
  //     to Home and nothing in `HelpRouteContext` says whether the reader is
  //     signed in, so a link offered from anywhere else would be a dead one
  //     (codex R1; the reasoning is in `content/site-pages.ts`'s header).
  //   - `/join/:poolId` is not a "join and pay" screen. It takes no payment at
  //     all — it shows the fee, the format and the prize split, and joining is
  //     a single button. The fee is settled between the player and the host.
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
 * Manager-form labels that render with NO `?` beside them, keyed by the label
 * text exactly as it appears in the source.
 *
 * `tests/help-manager-label-coverage.test.ts` (T4) reads every `<FieldLabel>`
 * in the manager files and fails on one that neither carries a `helpId` nor
 * appears here. It ALSO fails on a raw `<label` in those files, and on a row
 * here that nothing references — a stale exemption is an exemption nobody
 * reviewed.
 *
 * The reason column names the ticket that will write the copy, so the count of
 * rows is the measure of what T4 left for T10 and T11. A row is a reviewable
 * diff line, which is the point.
 */
export const MANAGER_LABEL_ALLOWLIST: Readonly<Record<string, string>> = Object.freeze({
  // ---- T10: NFL Survivor rules — all six rows CLOSED -----------------------
  // The six survivor labels now carry a `helpId` to their topic in
  // `content/nfl-survivor.ts`, so they are covered by the FieldLabel branch of
  // `help-manager-label-coverage.test.ts` rather than exempted here.

  // ---- CLOSED BY T11 -------------------------------------------------------
  // The payout-mode trio is rendered TWICE each — once on the Pick'em branch
  // and once on the Margin one — and this list is keyed by label text, so one
  // row covered both. BOTH render sites now carry the `helpId`, which is what
  // the removal of the row required: a single site would have left the other
  // label bare with nothing to fail on.

  // ---- PERMANENT: parts of an action, not options -------------------------
  // ONE topic per ACTION, placed on the form's FIRST field. A tooltip on every
  // input would be three or four restatements of the label (voice rule 2), and
  // "Week" or "Team" has no explanation of its own that the action's topic does
  // not already give.
  'Reason (emailed to members)': 'PERMANENT: an input on the extend-deadline and cancel-pool forms; both are explained by their action topic (nfl.manager.extendDeadline, nfl.manager.cancelPool) on the form\'s first field.',
  'Reason (audited)': 'PERMANENT: an input on the proxy-pick form, explained by nfl.manager.proxyPick on that form\'s first field.',
  Week: 'PERMANENT: an input on the proxy-pick form, explained by nfl.manager.proxyPick.',
  Team: 'PERMANENT: an input on the proxy-pick form, explained by nfl.manager.proxyPick.',
});

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

  // ---- NFL Pick'em (T9): the confidence and lock-mode controls both resolve
  // to topics in `content/nfl-pickem.ts`, so neither needs a row here.

  // ---- NFL Survivor (T10): all eight rows CLOSED --------------------------
  // Every control on `CreateNFLSurvivorPool.tsx`'s rules step resolves to a
  // topic in `content/nfl-survivor.ts` under the `NFL_SURVIVOR` scope the
  // wizard publishes, so none of them needs a row here.

  // ---- NFL Margin and the hybrid split (T11) ------------------------------
  // All three controls are explained by topics in `content/nfl-margin.ts`,
  // whose ids ARE the field paths — `SelectField` and `NumberField` default
  // `helpId` to `name`, so each control gets its `?` with no call-site prop.
  //
  // `settings.payoutMode` is bound in the two type-specific wizards, so it
  // satisfies this guard by RESOLVING there. The two split amounts are bound in
  // `HybridSplitFields`, which every wizard reaches through
  // `StepFeeAndPayment`, so they satisfy it by the topics' `fields[]` claim
  // instead — the control renders only while the payout mode is HYBRID, which
  // only Pick'em and Margin can set.
  //
  // The `settings.weeklyPayouts` and `*.places.*` rows above stay PERMANENT:
  // they are the second payouts PATH and the editor's prop-bound rows, not
  // controls of their own.

  // ---- Bracket and Playoff (T12): all ten rows closed --------------------
  // The three tournament controls and the scoring system resolve to topics of
  // their own in `content/bracket.ts`. The two tie-break boxes and the four
  // round multipliers carry an explicit `helpId` to a single topic each, for
  // the reason the payment-handle rows above give: one explanation, one place.

  // ---- Squares and Props (T13): CLOSED ------------------------------------
  // All five controls resolve to topics in `content/squares-props.ts`.
  // `homeTeam` and `awayTeam` carry an explicit helpId to the one
  // `matchup.teams` topic that claims both paths, so neither needs a row.
});
