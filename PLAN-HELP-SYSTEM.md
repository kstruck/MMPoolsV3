# PLAN — Tooltips + Dashboard Help panel (ported from Spectrum Price Intel)

> 🛑 **STATUS 2026-08-18: SIGNED AND PARTLY BUILT. This header is no longer
> "plan only" — do not read it as one.** §6 was signed by Kevin on 2026-08-17
> ("start building"), K1–K13 exactly as each Recommendation column reads. **T0
> (#472), T1 (#475) and T2 (#477) are merged; T2 is deployed and
> production-verified.** T3–T14 and T16 are unstarted; **T15 is PARTIALLY done —
> its deploy half happened, none of its four smoke checks has run** (gate status
> below). `HANDOFF.md` is the authority on
> live state and wins over anything below; this document is the DESIGN, and its
> §3 and §7 stay current and are what a ticket is built from. Where the design
> and the shipped code disagree, §3 D2 and D3 carry the measured corrections.

**Classification: ordinary, large.** Originally written as PLAN ONLY, awaiting
sign-off on §6; that sign-off has since been given — see the status box above.

Written 2026-08-16 on branch `claude/plan-help-system` (worktree
`.claude/worktrees/plan-help-system`, based on `origin/main` = `42906ecc`).
Every claim below carries a `file:line` cite measured in this worktree on that
date, or is marked UNVERIFIED. The reference implementation was read
**read-only** at `C:\Users\kevin\GRFR\website\spectrum-price-intel` (its
`.claude/worktrees/*` copies were ignored — cites are to `src/` in the main
checkout). Companion docs: `PLAN-HELP-SYSTEM-SWEEPS.md` (complete grep
inventories), `PLAN-HELP-SYSTEM-REVIEW-LOG.md` (codex rounds).

## Gate status

- [x] Act 1 — self-interview grill (Kevin unavailable; every question only he
      can answer is in §6, not guessed)
- [x] Sweeps written (`PLAN-HELP-SYSTEM-SWEEPS.md`)
- [x] Act 2 — codex adversarial review: 5 rounds run (cap), 34 findings, all
      verified and absorbed, 0 rejected; final verdict REVISE — the round-5
      fixes are un-reviewed. Status: **cap reached, all findings resolved,
      not APPROVED** (review log "Resolution"). Kevin decides whether to buy
      round 6 before signing.
- [x] Kevin's sign-off on §6 — **given 2026-08-17** ("start building"), K1–K13 as
      recommended. Round 6 was never bought; he signed on the round-5 state.
- [~] Implementation (T-tickets §7) — **T0, T1, T2 done and merged. T3–T14 and
      T16 unstarted.**
- [~] **T15 is PARTIALLY done, not unstarted.** Its definition is "Coolify deploy
      + prod smoke". The deploy half happened 2026-08-18: Kevin redeployed `www`,
      opened the panel with `?`, and verified the K13 privilege guard on a live
      props pool. **NONE of its four smoke checks has been run** — the checks
      Kevin did (`?` on `/create/pickem`, the K13 privilege guard, the Back button)
      are useful and are not on the list. All four are listed with expected results
      in `MORNING-2026-08-18-HELP.md` §7 step 7; the phone one is a HelpTip tap,
      not the header button, and the panel's mobile modal branch has been seen by
      nobody.
- [ ] **T16 is OVERDUE rather than pending** — a stated prerequisite of T15, and
      T15's deploy half was taken first knowingly, so the `?` shortcut is live in
      production on the CSS-class fallback for ~35 un-migrated overlay shells.

## 0. What Kevin asked for, verbatim, and what it means precisely

> "Tooltips + help system, ported from the Spectrum Price Intel site. FIRST
> review that codebase read-only — its tooltip pattern and its Dashboard Help
> panel. Then plan two things for March Melee Pools: (1) Tooltips for EVERY
> option in EVERY pool type (wizard steps, manager settings, member controls)
> explaining what each option is. (2) A help system that mimics the Spectrum one
> exactly in kind: a right-side 'Dashboard Help' panel opened by a '?' shortcut
> and a button, with a search box, a summary of the page the user is on, an 'On
> this page' section (anchors), expandable sections per feature, a Key Concepts &
> Glossary section, and an 'All pages' list linking every page/tab. Content
> should be authored per page and per pool type; CONTEXT.md is the glossary
> source of truth. Ordinary class (no money/auth/data/scoring) but large — plan
> the content model + component so the tooltip copy and help copy come from ONE
> source."

Precisely, that is three deliverables:

1. **A content model** — one typed registry that is the single home for every
   piece of help copy, from which BOTH the tooltip and the panel read.
2. **A tooltip component** wired to every option (wizard field, manager setting,
   member control) across all seven pool types.
3. **A Help panel** with the seven Spectrum features (shortcut+button, search,
   page summary, On-this-page anchors, expandable sections, Key Concepts &
   Glossary, All pages).

**Classification: ordinary** (`mmp-change-control` §1: no money, no
authorization, no production data, no scoring is touched — the feature is
read-only presentational copy plus one keyboard listener). It gets a plan anyway
because of **size**: it touches every page and every wizard, and the failure
mode of "help copy drifts from what the option actually does" is precisely a
content-model design problem, which is cheaper to get right on paper. Nothing in
this plan is a candidate for `firestore.rules`, callables, or Firestore writes.
`hasPlayableEntry`, `updatePoolSettings`, scoring — untouched. If any T-ticket
later finds it needs to change a schema default or a callable, that ticket
re-classifies and stops.

## 1. Reference: the Spectrum pattern (read-only, measured)

Spectrum is Next.js 16 / React 19 / Tailwind 4 with `@base-ui/react` and
`lucide-react` (`package.json` deps). Its help system is four files:

| File | Lines | Role |
|---|---|---|
| `src/lib/help-content.ts` | 1846 | **The content source.** Types + all copy + lookup helpers |
| `src/components/dashboard/HelpTooltip.tsx` | 141 | Inline `Info`-icon tooltip that reads the content source |
| `src/components/dashboard/HelpPanel.tsx` | 452 | The right-side "Dashboard Help" drawer + `?` shortcut |
| `src/components/dashboard/HelpPanel.components.tsx` | 242 | `TableOfContents`, `SectionAccordion`, `SearchResultItem`, `KeyConceptCard`, `FormattedContent`, `RelatedPageLink` |
| `src/components/ui/tooltip.tsx` | 66 | A shadcn-style base-ui Tooltip wrapper — used by exactly ONE file; NOT the help tooltip |

### 1a. Content model (`src/lib/help-content.ts`)

Three parallel data structures, all hand-authored TypeScript:

- `HelpSection { id, title, content, tips?, relatedPages? }` and
  `HelpEntry { id, title, description, sections: HelpSection[] }`
  (`help-content.ts:8-21`). `HELP_ENTRIES: HelpEntry[]` (`:380`) has **37**
  entries, one per dashboard route, keyed by pathname (`id: "/dashboard/…"`).
  `description` is the page summary; `sections` are the expandable per-feature
  blocks; each section `id` doubles as the "On this page" anchor.
- `KEY_CONCEPTS: Record<string, { term, short, long }>` (`:25`) — 8 glossary
  terms, hand-written, not derived from any doc.
- `INLINE_TOOLTIPS: Record<string, string>` (`:78`) — ~130 flat string tooltips
  keyed by a slug (`"kpi-devices-tracked"`, `"promo-top-threats"`, …).
- Helpers: `getHelpForPath(pathname)` (`:1756`, exact then longest-prefix
  match) and `searchHelpContent(query)` (`:1777`, case-insensitive substring
  over description + section title/content/tips + concepts, capped at 20, with
  `extractSnippet` window). Note the file header comment says the source is
  "Used by HelpPanel, HelpTooltip, and OnboardingTour" (`:1-4`).

**Finding that shapes this plan:** the tooltip and the panel do NOT actually
share copy in Spectrum. `INLINE_TOOLTIPS` and `HELP_ENTRIES` are separate
dictionaries with separate keys, and `HelpTooltip` accepts a `text` override
prop (`HelpTooltip.tsx:21,90`). Measured: **213** `<HelpTooltip>` usages in
`src/`, of which **191** pass inline `text=` and only ~22 use a `tooltipKey`
(187 pass `tooltipKey=""`). So the "one source" Kevin asked for is something
Spectrum aspired to and then routed around. MMP's model must make the override
impossible (§3 D1) rather than merely discouraged.

### 1b. Tooltip (`HelpTooltip.tsx`)

- Trigger: a `<span role="button" tabIndex={0} aria-label="More info">` wrapping
  a lucide `Info` icon (`:118-131`), shown on `onMouseEnter`/`onFocus`, hidden on
  leave/blur.
- Positioning: a `createPortal` to `document.body` with `position: fixed`,
  computed in `useLayoutEffect` from the anchor's `getBoundingClientRect()` —
  above the anchor, centred, flips below if `top < 4`, clamped to viewport
  (`:41-62`). Rationale in the header comment: never clipped by an
  `overflow:hidden` card (`:8-9`).
- Click: if `sectionId` is given, calls a global
  `window.__helpPanelOpenToSection(sectionId)` (`:96-103`) — the panel opens and
  scrolls to that section. This is the tooltip→panel bridge; the tooltip footer
  says "Click for more details" (`:73-77`).
- a11y gaps worth NOT porting: no `aria-describedby` linking trigger to tooltip
  text; the tooltip `div` has no `role="tooltip"`; the window-global bridge is
  untyped.

### 1c. Panel (`HelpPanel.tsx`, `HelpPanel.components.tsx`)

- Mounted once in `DashboardShell.tsx:404` (`<HelpPanel />`).
- **Trigger button:** a floating `fixed bottom-20 right-6` round FAB with
  `HelpCircle`/`X` and `title="Toggle help panel (press ? key)"`
  (`HelpPanel.tsx:155-175`), `data-help-trigger` so click-outside ignores it.
- **`?` shortcut:** a `document` `keydown` listener; ignores when
  `e.target.tagName` is `INPUT`/`TEXTAREA`/`SELECT`; toggles on `e.key === "?"`
  without ctrl/meta; `Escape` closes (`:96-112`). Note it does NOT guard
  `contentEditable`, and it does not return focus to the trigger on close.
- **Panel shell:** `fixed top-0 right-0 z-[60] h-full w-full md:w-[480px]`,
  slides via `translate-x-full`↔`translate-x-0`, `role="dialog"
  aria-label="Help panel"` (`:186-198`); mobile-only backdrop overlay
  (`:178-183`); click-outside closes (`:115-131`); open state persisted in
  `localStorage` (`:72-93`).
- **Body** is remounted with `key={pathname}` so per-page state
  (search, open sections, scroll target, concepts toggle) resets naturally
  (`:199-214`, comment `:200-206`); the search input autofocuses 300 ms after
  open (`:239-243`).
- **Sections rendered, in order** (`:286-440`): header "Dashboard Help" +
  close button (`:293,303`); search box `placeholder="Search help topics..."`
  (`:316`); when a query is active — a result list (`SearchResultItem`, click
  navigates to that page/section) replaces everything below; otherwise — page
  title + `description` (page summary, `:352-359`); `TableOfContents` = "On
  This Page" (`HelpPanel.components.tsx:88-120`, one button per section id,
  highlights open sections, `onJump` scrolls via `scrollIntoView` in
  `SectionAccordion` `:168`); the `SectionAccordion` list (expandable per
  feature); "Key Concepts & Glossary" collapsible (`:393-411`, `KeyConceptCard`
  per `KEY_CONCEPTS` showing `short`); "All Dashboard Pages" (`:414-437`, one
  button per `HELP_ENTRIES` entry, current highlighted, `router.push`); footer
  "Press ? to toggle • Esc to close" (`:443-450`).
- Fallback copy when the route has no entry: "No specific help available for
  this page. Use the search bar above…" (`:384-389`).

That is the whole mechanism. It is ~700 lines of component and ~1850 lines of
content, no dependency beyond React + lucide + Tailwind. MMP can port it with no
new dependency (§3 D6).

## 2. What is true today in MMP — measured, not remembered

Stack (`package.json`): React 19.2, `react-router` 8.3 (not react-router-dom),
Tailwind 3.4, `lucide-react` 0.556, `framer-motion` 12 (used by only 5 files),
`zod` 4, Vite 7, Vitest 4. Two-mode theming via CSS vars (`--card`, `--line`,
`--text`) and `font-display`/`font-body` per `docs/UI-REVAMP-GUIDE.md:7-44`.

### 2a. Page / route inventory

39 `<Route>` elements in `src/App.tsx:214-472` (full list: SWEEPS §A1). The
ones that carry help-relevant UI:

- Wizards: `/create/{playoff,pickem,survivor,margin,bracket,squares,props}`
  (`App.tsx:271-325`) plus the picker `/create-pool` (`:448`).
- Pool surfaces: `/pool/:id` (`:407`, `PoolRoute.tsx` dispatches on type to
  `BracketPoolDashboard` `:186`, `PropsPoolDashboard` `:214`, `PlayoffDashboard`
  `:239`, `NFLPoolDashboard` `:275`, and inline Squares `Grid`), `/admin/:id`
  (`:419`, `AdminRoute.tsx` → `AdminPanel` for Squares, else the same
  dashboards), `/join/:poolId` (`:463`).
- Account: `/profile`, `/profile/:uid`, `/participant`, `/scoreboard`.
- Admin: `/super-admin` (`:431`), `/tournament-sim` (`:443`).
- Marketing/static: `/`, landings, `/pricing`, `/features`, `/how-it-works`,
  `/browse`, `/support`, `/about`, `/charity`, `/privacy`, `/terms`, `/contact`,
  `/resources`-style pages, `/odds/...`, `/articles/...`, `/dev/*`.

### 2b. Tab inventory (a "page" for help purposes = route + tab)

- NFL (Pick'em/Survivor/Margin share one dashboard):
  `NFLPoolDashboard.tsx:67-68` `TabType = dashboard|picks|grid|standings|results|
  recaps|rules|payments|manager`, URL-reflected via `?tab=` (`:85`), gated by
  `tabOffered` (`:96-99`: `manager` needs `isManager`, `payments` needs a user,
  `results`/`grid` conditional). Manager tab has sub-tabs
  `NFLManagerView.tsx:75-81` `overview|members|scoring|settings` — and already
  carries a per-tab `hint` string (`COMMISH_TABS`, `:77-81`): existing copy to
  absorb into the registry.
- Bracket: `BracketPoolDashboard.tsx:39` `dashboard|standings|entries|brackets|
  reports|rules|manager|ledger`, `:40` bracket sub-tabs `poolwide|history|rootfor|
  whatif|compare|chalk|analytics|insights`, `?tab=` at `:54`.
- Props: `PropsPoolDashboard.tsx:34` `cards|leaderboard|stats|admin|grading|ai`
  (admin tab hosts the legacy `PropsWizard` edit flow, `:319`).
- Playoff: `PlayoffDashboard.tsx:124-152` `picks|leaderboard|rules|ai|
  commissioner`.
- Squares manager: `AdminPanel.tsx:74` `settings|reminders|players|scoring|game|
  payouts|communications|stats|props|grading` (labels `:575`; "settings" is the
  legacy Setup Wizard).
- Super-admin: `SuperAdmin.tsx:1160-1193` — **8 nav groups containing 17 tab
  ids** (`overview,stats | pools,tournament,playoffs,props,nfl | users,referrals,
  loyalty | operations | testing | billing | themes | system,settings`), a
  pool-detail sub-tab set `:3259-3262`, plus `SuperAdminBillingPanel.tsx:76` (7
  sub-tabs) and `MonetizationDashboard.tsx:19` (6). The `mmp-superadmin-surface`
  skill's "8-tab contract" is the group count, not the tab count.
- Global dashboards: `ParticipantDashboard.tsx:515-521` (6),
  `HowItWorksPage.tsx:21` (4 view modes; already has an FAQ per pool type,
  `:42-212`).

Total distinct help "pages" if every route+tab gets an entry: ~39 routes + ~70
tabs/sub-tabs. §6 K4 asks which of these are in scope for v1.

### 2c. Wizard option inventory (the unified wizard)

Seven `Create*Pool.tsx` files under `src/components/wizard/create/` each build a
`WizardStepDef[]` (`wizard/types.ts:8-19`: `{ id, title, fields?, Component,
ownsSubmit? }`) and hand it to `WizardShell` (`WizardShell.tsx:17,146-165`).
Steps per type (SWEEPS §B for every field with file:line):

| Pool type | Steps (`id`) | Type-specific fields |
|---|---|---|
| Bracket (`CreateBracketPool.tsx:87-95`) | basics, tournament, fee, payouts, branding, launch | `seasonYear`, `gender`, `tournamentType`, `settings.scoringSystem`, `settings.tieBreakers.closestAbsolute`, `.closestUnder` |
| NFL Pick'em (`CreateNFLPickemPool.tsx:163-171`) | basics, rules, fee, payouts, branding, launch | `seasonType`, `settings.lockMode`, `.payoutMode` (+`HybridSplitFields`), `.pickMode`, `.weeklyTiebreaker`, `.confidenceMode`, `MultiEntryFields` (`multiEntry`, `settings.maxEntriesPerUser`) |
| NFL Survivor (`CreateNFLSurvivorPool.tsx:100-108`) | same shape | `seasonType`, `settings.maxStrikes`, `.maxRebuys`, `.rebuyDeadlineWeek`, `.rebuyCost`, `.tieCountsAs`, `.maxTeamUses`, `.pickLosersMode`, `.autoSurviveExemptionEnabled`, multi-entry |
| NFL Margin (`CreateNFLMarginPool.tsx:86-94`) | same shape | `seasonType`, `settings.payoutMode` (+hybrid), multi-entry |
| Playoff (`CreatePlayoffPool.tsx:77-86`) | basics, details, fee, payouts, branding, **reminders**, launch | `lockDate`, `settings.scoring.roundMultipliers.{WILD_CARD,DIVISIONAL,CONF_CHAMP,SUPER_BOWL}` |
| Props (`CreatePropsPool.tsx:108-116`) | basics, setup, fee, branding, launch | `homeTeam`, `awayTeam`, `props.maxCards`, `props.questions[i].{text,options}`, fee = `props.cost` |
| Squares (`CreateSquaresPool.tsx:66-74`) | basics, grid, fee, branding, launch | `homeTeam`, `awayTeam`, `maxSquaresPerPlayer`, `numberSets`, fee = `costPerSquare` |

Shared steps: `StepBasics.tsx:8-11` (`name`, `managerName`, `contactEmail`,
`isPublic`), `StepFeeAndPayment.tsx:18-33` (fee field, five `paymentHandles.*`,
`paymentInstructions`), `StepPayouts.tsx:26-30` (`places[i].rank/percentage`),
`StepBranding.tsx:11-14`, `StepReminders.tsx:11-14`, `LaunchStep.tsx:323,340,408`
(`estimatedPlayers`, `addons.*`, `_tosAccepted`).

**Two facts that matter for the content model:**

1. Every wizard input goes through `src/components/wizard/fields.tsx`
   (`TextField`/`NumberField`/`SelectField`/`CheckboxField`/`TextAreaField`, all
   taking `name` and an optional `hint`, `:59-105`), except the raw `register()`
   inputs in `StepPayouts.tsx:27,30` and the checkbox at `LaunchStep.tsx:408`.
   So a `helpId` that defaults to `name` covers ~90% of wizard options at one
   choke point.
2. `hint=` is the existing per-field help copy — 18 usages (13 with a literal
   string, SWEEPS §C2), e.g. `CreateNFLPickemPool.tsx:67,79`. This copy must
   MOVE into the registry, not be duplicated beside it.

Schema fields exist that no wizard surfaces (`shared/schemas/nfl.ts:46`
`lockBufferMinutes`, `:60` `pointsPerPick`, `:25` `isListedPublic`) — the
manager settings form does surface some of them (`NFLManagerView.tsx:982` "Lock
Buffer", `:1084` "Base Points Per Correct Pick"). The coverage guard (§4) has to
walk the zod shape and demand either an entry or an explicit allowlist reason.

### 2d. Manager settings + member controls (the non-wizard options)

- NFL commissioner settings form: `NFLManagerView.tsx:835-1301` — 34 `<label>`
  elements, hand-rolled (not `fields.tsx`): Pool Name, Entry Fee, Entries per
  Player, Payment Instructions, Host Name, Contact Email/Phone/Link Options, Lock
  Mode, Lock Buffer, Payout Method, Weekly/Season pots, Weekly Tie-Breaker, Base
  Points, Primetime Bonus, Weekly Deadline, Strikes Limit, Max Rebuys, Rebuy
  Cutoff Week, Rebuy Fee, Tie Outcome, Team-Use Limit; plus one-off ops
  (deadline extension `:1613-1624`, proxy pick `:1668-1705`, `:1748`).
- Bracket manager tab: `BracketPoolDashboard.tsx` — 22 `<label>` elements.
- Squares manager: `AdminPanel.tsx` (10 tabs) and its legacy Setup Wizard steps
  `src/components/admin/WizardStep*.tsx` + `WizardStepBranding/Reminders.tsx`
  (101 `<label>`s across the legacy wizard files, SWEEPS §B2). Live: referenced
  from `AdminPanel.tsx` and `PropsWizard.tsx`.
- Props manager: `PropsWizard.tsx:22-27` six steps (Game Selection, Branding,
  Details, Props Setup, Reminders, Final) rendered inside the Props `admin` tab.
- Playoff manager: `PlayoffSettingsModal.tsx:86` (Pool Name + settings).
- Member controls: NFL pick sheets (`PickemPickEntry.tsx`, `SurvivorPickEntry.tsx`,
  `MarginPickEntry.tsx`, `pickSheet/*`), quick-picks dialog, entry switcher,
  payments claim (`PaymentsPanel.tsx`), Squares `Grid.tsx`, bracket
  `BracketBuilder`, props cards (`Props/PropCardForm.tsx`).
- Every other pool-owned interactive surface — the ones a "wizard + settings
  form" reading misses (codex R1-9): `Props/PropsManager.tsx` (21 controls),
  `PlayoffPool/RankingForm.tsx`, `PlayoffPool/PlayoffResultsManager.tsx`,
  `NFLPoolDashboard/RecordPayoutsCard.tsx`, `BracketPoolDashboard/PaymentLedger.tsx`,
  `InviteByEmail.tsx`, `AnnouncementManager.tsx`, `AICommissioner.tsx`,
  `NFLManagerBentoDashboard.tsx`, `BracketPoolDashboard/{DateTimePicker,
  WhatIfSimulator,ExportControls,PoolShareModal}.tsx`, `JoinPool.tsx`. The
  complete measured list with control counts is SWEEPS §E; T7 is driven by
  that list, each file getting topics or an explicit exemption.

### 2e. Existing tooltip / help affordances (nothing to build on)

- **No Tooltip component exists.** Every `Tooltip` identifier in `src/` is
  recharts' chart tooltip (8 files, SWEEPS §C4). Zero non-chart tooltip.
- Native `title=` attributes: 93 static + 59 dynamic across 52 files (SWEEPS
  §C1) — browser-native, no touch/keyboard, no styling; several are already
  help-like ("Toggle help panel"-style copy in `SuperAdmin.tsx` ×19,
  `WizardStepSummary.tsx` ×9).
- `pricing/UpgradeInfoPopover.tsx:56` — a click-to-open `role="tooltip"` popover
  with `Escape` handling (`:27`); explicitly replaced a hover tooltip (`:6`).
  Closest thing to a pattern; single-purpose.
- `HelpCircle` icon: 10 usages, all decorative or "View Full Rules" links
  (`PoolRoute.tsx:541,789`, `StatusCard.tsx:165,173`, `NFLPoolRules.tsx:74`,
  `BracketRulesPanel.tsx:60`, …). `Info`: 5, decorative.
- Existing copy constants that ARE help copy and must be absorbed, not
  duplicated: `shared/nflTiebreaker.ts:54` `tiebreakerCopy(rule) → {label,
  hint}` (used by `PickemPickEntry.tsx:369` and `NFLStandings.tsx:81`, with the
  comment "one definition shared with the sheet"), `BracketRulesPanel.tsx:12`
  `SCORING_SYSTEM_LABELS`, `NFLManagerView.tsx:77-81` `COMMISH_TABS[].hint`,
  the setting-dependent explainers `utils/survivorRules.ts:13,25,35,42`
  (`survivorModeRulesCopy`, `tieOutcomeRuleCopy`, `teamReuseRuleCopy`,
  `survivorRuleCopy` — rendered at `SurvivorPickEntry.tsx:152`) and
  `utils/recapHighlight.ts:54` `weeklyWinnerLabel` (these become topic
  `template`s, D1), `utils/pickHighlight.ts:47` `pickHighlightLabel`,
  `PaymentsPanel.tsx:31` `EVENT_LABELS`, the wizard `hint=` strings, and the
  FAQ arrays in `HowItWorksPage.tsx:63-212`.
- Rules pages that already explain settings in prose, per pool type:
  `NFLPoolRules.tsx`, `BracketRulesPanel.tsx`, Playoff `rules` tab
  (`PlayoffDashboard.tsx:425`), `PoolRoute.tsx:789` "Pool Rules & Payouts",
  and `PayoutsPanel.tsx` — which carries its own explanatory constants
  (`PAYOUT_MODE_COPY` `:38-51`, `UNSOLD_LABELS` `:32-36`, Squares rule copy
  `:147-271`) and is rendered on `/join` (`JoinPool.tsx:210`),
  `NFLPoolRules.tsx:304` and `BracketRulesPanel.tsx:148` (codex R4-3).
  These render the pool's ACTUAL settings; the help panel explains what a
  setting MEANS. Both must agree — the registry entry for a setting is the one
  place its meaning is written, and rules pages should read the same entry for
  the "what is this" sentence (T8).

### 2f. Existing keyboard / drawer / dialog infrastructure

- `document.addEventListener('keydown')` in 6 places (`AuthModal.tsx:21`,
  `PlayoffSettingsModal.tsx:28`, `ShareModal.tsx:24`, `QuickPicksDialog.tsx:75`,
  `UpgradeInfoPopover.tsx:27`, `ui/Toast.tsx:84`) — all Escape-to-close, none a
  global shortcut. There is no shortcut registry and no existing `?` binding.
- `role="dialog"`: 6 usages, all centred modals. **No right-side drawer exists**
  (`grep translate-x-full` hits only toggle-switch CSS, SWEEPS §C5). Component
  library: `src/components/ui/{Badge,Button,Field,LeaderboardTable,PoolCard,
  StatTile,Tag,ThemeToggle,Ticker,Toast,OfflineBanner}` — no Drawer, no
  Popover, no Tooltip.
- Header right cluster (candidate button home): `Header.tsx:123,194`
  (`<ThemeToggle />` desktop + mobile), `:214` logout.
- Tests: root `tests/*.test.ts` house the invariant guards
  (`docs-state-invariants.test.ts`, `admin-surface-invariants.test.ts`,
  `pool-schema-drift.test.ts`, `nfl-surface-invariants.test.ts`) — the exact
  shape the coverage guards in §4 extend.

## 3. Design

### D1 — ONE content source: a typed help registry

```
src/help/
  types.ts        HelpTopic, HelpPlacement, HelpPage, GlossaryTerm, PoolTypeScope, Audience
  registry.ts     buildRegistry() → frozen maps + helpers (resolveTopic(scope,id),
                  getPage, placementsForPage, search, glossary)
  scope.tsx       HelpScope (poolType, audience, route params, tab, subTab) — held by
                  HelpPanelProvider; published by WizardShell, PoolRoute, AdminRoute
                  (base) and the tab publishers; read by HelpTip AND the panel
  pages.ts        the page inventory (route pattern + tab + href → HelpPage)
  glossary.ts     GlossaryTerm[] mirrored from CONTEXT.md (see D4)
  coverage-allowlist.ts   path → reason, for schema paths / routes with no topic yet
  content/
    site.ts       marketing/static/account pages + global dashboards
    wizard-shared.ts   basics / fee / payouts / branding / reminders / launch
    nfl-pickem.ts  nfl-survivor.ts  nfl-margin.ts  nfl-shared.ts
    bracket.ts  playoff.ts  props.ts  squares.ts
    super-admin.ts
```

```ts
type Audience = 'member' | 'commissioner' | 'admin';       // who sees the control
type PoolTypeScope = PoolType[] | 'all';                     // @shared/poolTypes

// Copy is a static string, OR a template of the pool's settings with a static
// fallback for when no pool is in scope (the wizard, the site pages, search).
// This is how existing setting-dependent explanations
// (`utils/survivorRules.ts:13,25,35` survivorModeRulesCopy / tieOutcomeRuleCopy /
// teamReuseRuleCopy, `utils/recapHighlight.ts:54` weeklyWinnerLabel,
// `shared/nflTiebreaker.ts:54` tiebreakerCopy) become topics instead of
// side-channel copy (codex R3-5). The helper functions stay where they are
// and BECOME the topic's `template`; nothing else may call them directly
// (grep guard in help-ui-coverage).
type HelpCopyContext = { poolType?: PoolType; settings?: Record<string, unknown> };
type HelpCopy = string | { template: (ctx: HelpCopyContext) => string; fallback: string };

// The COPY. One per option/feature/concept, regardless of how many screens
// show it (entry fee appears in the wizard, the manager settings form, the
// rules page and the join page — ONE topic).
interface HelpTopic {
  id: string;            // stable slug. For a form option: the schema/RHF path
                         // with indices normalised to '*' —
                         // 'settings.weeklyTiebreaker', 'props.questions.*.text',
                         // 'settings.payouts.places.*.percentage'.
                         // A pool-type-specific variant is 'NFL_SURVIVOR:settings.entryFee'
                         // and wins over the unqualified id when the viewer's
                         // scope is that type (resolution rule below).
  title: string;         // human label, ≤ 40 chars
  short: HelpCopy;       // TOOLTIP copy: ≤ 160 chars, "what this option is"
  long: HelpCopy;        // PANEL copy: markdown-lite paragraphs — what it does,
                         // when to use it, what changes for members
  poolTypes: PoolTypeScope;
  audience: Audience[];
  fields?: string[];     // schema paths this topic EXPLAINS (coverage key;
                         // defaults to [id] when id is a path)
  terms?: string[];      // glossary term ids linked from the long copy
  tips?: string[];       // Spectrum's tips[] — optional bullets
  related?: string[];    // other topic ids
}

// WHERE the copy shows up in the panel. Many per topic.
interface HelpPlacement {
  topic: string;         // HelpTopic.id
  page: string;          // HelpPage.id
  section: string;       // REQUIRED grouping heading inside that page's
                         // "On this page" (registry normalises a missing value
                         // to the page's default section 'general' at build —
                         // codex R2-7)
  order?: number;
}

interface HelpPage {
  id: string;            // 'pool.nfl.picks', 'wizard.survivor.rules',
                         // 'super-admin.operations'
  route: string;         // react-router pattern: '/pool/:id', '/create/survivor'
  tab?: string;          // the ?tab= value (or in-memory tab id — see D3)
  href?: (ctx: HelpRouteContext) => string | null;
                         // how "All pages"/search NAVIGATE here; null = not
                         // navigable from another page (listed, not linked)
  match?: (ctx: HelpRouteContext) => boolean;   // e.g. poolType === 'NFL_SURVIVOR'
  title: string;
  summary: string;       // "summary of the page the user is on"
  poolTypes: PoolTypeScope;
  audience: Audience[];
}
```

Rules that make it ONE source (each is enforced by a test in §4, not by
convention):

- The tooltip component reads a topic's `short` by `helpId`. **It has no
  `text` prop.** (Spectrum's 191 overrides are the cautionary measurement,
  §1a.)
- The panel reads the same topic's `long` (and `title`, `tips`, `related`)
  through its placements. Topic and placement are separate so a shared
  setting is written once and placed many times (codex R1-1).
- **Scoped resolution:** `HelpTip` never receives a pool type; it reads the
  **global** `HelpScope { poolType?, audience, routeParams, tab?, subTab? }`
  that lives on `HelpPanelProvider` (App level) and is PUBLISHED by
  `WizardShell` (it already has `poolType`, `WizardShell.tsx:17`) and by
  `PoolRoute`/`AdminRoute` **for every dispatched pool type, including the
  inline Squares `Grid` and the pre-tab landing state** — that is the base
  publisher; the tab publishers (D3) refine it (codex R4-5). Lookup order:
  `${poolType}:${id}` → `${id}`. Missing both = the coverage test fails at
  build time AND the component throws in dev / renders nothing in prod (codex
  R1-2). **The panel resolves through the same scope**: `placementsForPage`
  maps each placement's base topic id through `resolveTopic(scope, id)`, so a
  placement written as `settings.entryFee` renders the
  `NFL_SURVIVOR:settings.entryFee` variant when the viewer is in a Survivor
  pool — tooltip and panel cannot disagree; a parity test asserts it for one
  scoped variant (codex R4-4).
- **Path normalisation:** `helpId` and `fields[]` are compared after replacing
  `.<digits>.` with `.*.`, so `props.questions.3.text` and the raw
  `register()` payout rows resolve to one topic (codex R1-3). **Every RHF
  control that bypasses the typed `fields.tsx` components** gets an explicit
  `helpId` — `Field` and `ReadOnlyField` gain a `helpId` prop for this
  (codex R4-2). Measured list: `StepPayouts.tsx:27,30` (`register`),
  `LaunchStep.tsx:408` (`register`), `CreatePropsPool.tsx:46` (`register`
  `props.questions.${i}.text` inside `Field "Prompt"`), `:48-58`
  (`Controller` `props.questions.${i}.options`), `CreatePlayoffPool.tsx:30-31`
  (`register('lockDate')` inside `Field "Lock date & time"`),
  `CreatePlayoffPool.tsx:29` (`ReadOnlyField "Season"`). The coverage test
  greps five forms: `name=`, `feeField=`/`payoutsField=`, `register('…')`,
  `` register(`…`) `` and `<Controller … name=`.
- Wizard `fields.tsx` components gain `helpId?: string` **defaulting to
  `name`**; the `hint` prop is removed in the same ticket and every existing
  `hint=` string moves into the topic's `short` (T1). A field with no topic
  fails the coverage test, not silently rendering nothing.
- Existing copy constants become thin readers of the registry where they are
  help copy (`tiebreakerCopy` hint, `COMMISH_TABS.hint`,
  `SCORING_SYSTEM_LABELS`), OR are declared out-of-scope in the allowlist with a
  reason (e.g. `pickHighlightLabel` is state wording, not option help).
- Content files are plain TS objects (like Spectrum), not markdown/JSON, so
  `poolTypes`, `fields`, `terms` are type-checked against `@shared/poolTypes`
  and the glossary ids at compile time.
- **Scope of the one-source invariant, stated precisely** (codex R2-3): the
  invariant covers *option and concept copy* — every explanation of what a
  setting, control, or glossary term IS lives in exactly one `HelpTopic` (or
  `GlossaryTerm`) and every surface that explains it (tooltip, panel, rules
  page row per T8, join-page setting summary) renders `topic.short`/`long`
  rather than handwritten text. It does NOT cover page-level framing —
  `HelpPage.title`/`summary` and `HelpPlacement.section` headings are
  per-page copy by design, and a topic placed on several pages carries the
  same wording on each; if a page needs page-specific framing it goes in the
  page `summary` or a section heading, never in a second copy of the topic.
  The `help-ui-coverage` test enforces the first half (no raw `<label`, no
  `hint=`); the T8 grep guard enforces the rules-page half.
- **Exemptions are a typed, central allowlist, not a free-text attribute**
  (codex R2-4): `data-help-exempt` carries an ID that must exist in
  `src/help/coverage-allowlist.ts` as `{ file, control, reason }`; the test
  fails on an exemption ID used in a file other than its declared one, on an
  allowlist row nothing references (stale), and on any raw reason string.
  Adding a row is a reviewable diff line, which is the point.

### D2 — Tooltip component: `src/components/ui/HelpTip.tsx`

> **Measured corrections from T1 (2026-08-18).** Four things this section
> asserted turned out to be wrong when the code was written against it.
>
> 1. **`ui/FieldLabel` is not new — it already exists**, exported from
>    `src/components/ui/Field.tsx` and used by `ContactPage`, `HowItWorksPage`,
>    `SupportPage` and `PlayoffSettingsModal`. Creating
>    `src/components/ui/FieldLabel.tsx` would collide with it in the `ui`
>    barrel. **T4–T6 must EXTEND that component** with `helpId` /
>    `data-help-exempt`, not add a second one. T1 did not touch it (nothing in
>    the wizard uses it, and adding an unused prop is speculation): the wizard's
>    own `fields.tsx` renders its label row internally, because the two have
>    different label styling and merging them is a visual change no help ticket
>    should smuggle in.
> 2. **There are 14 literal `hint=` strings, not 13** (§7 T1 says 13):
>    three seasonType notes, pickMode, weeklyTiebreaker, two season read-only
>    notes, props options, two on `LaunchStep`, multi-entry, contactEmail,
>    logoUrl, entry fee.
> 3. **`HelpTip` renders nothing for an unknown id in dev as well as prod** —
>    D1 says "throws in dev". Throwing would break the wizard for every field
>    whose copy lands in T9–T13, which is most of them, and a `?` that opens on
>    nothing is worse than no `?`. `tests/help-ui-coverage.test.ts` is the guard
>    instead: an id that is neither a topic nor an allowlist row fails there.
> 4. **The tooltip footer reads "More in Help", not "Tap for more" / "Click for
>    more".** Choosing between those two needs a `(hover: none)` media query at
>    render time, and this app is prerendered (`scripts/prerender.ts`), so the
>    two would disagree. It is shown only when a panel is mounted to open.


- Props: `{ helpId: string; side?: 'top'|'bottom'; size?: 'sm'|'md'; className? }`.
  Renders a lucide `HelpCircle` (14 px) trigger `<button type="button"
  aria-label={"About " + topic.title} aria-describedby={tipId}
  data-help-id={topic.id}>`; the bubble is a **non-interactive**
  `<div role="tooltip" id={tipId}>` (text only, `pointer-events-none`)
  portalled to `document.body`, positioned `fixed` from
  `getBoundingClientRect()` exactly as Spectrum (`HelpTooltip.tsx:41-62`), plus
  a `resize`/`scroll` re-measure. No new dependency; ~120 lines.
- Triggers: `mouseenter`/`focus` show the tooltip; `mouseleave`/`blur`/`Escape`
  hide it. **Click / tap / Enter / Space open the Help panel scrolled to this
  topic** via `useHelpPanel().openTo({ topicId: topic.id })` — a typed context, not
  Spectrum's `window.__helpPanelOpenToSection` global (`HelpTooltip.tsx:96-103`).
  So a pointer user gets the short copy on hover and the long copy on click; a
  touch user gets the panel (which shows short + long) on tap. The tooltip
  footer reads "Tap for more" / "Click for more". This is Spectrum's actual
  interaction (`HelpTooltip.tsx:6,73-77`) and it keeps `role="tooltip"`
  honest — no link inside a tooltip (codex R1-5). It also settles K2 without a
  click-toggle-tooltip mode.
- Where it lives per control type: `fields.tsx` renders it inside `Field`'s
  label row (one edit covers the unified wizard); hand-rolled `<label>` forms
  (`NFLManagerView.tsx`, `BracketPoolDashboard.tsx` manager tab, `AdminPanel.tsx`,
  legacy `admin/WizardStep*.tsx`, `PropsWizard.tsx`, `PlayoffSettingsModal.tsx`)
  are converted label-by-label to a new `ui/FieldLabel` (`<FieldLabel
  helpId=…>` renders a flex ROW containing a `<label htmlFor>` and, as a
  **sibling** — never inside the `<label>`, since the HelpTip trigger is a
  `<button>` and a labelable control must not nest in a label (codex R5-2) —
  the `HelpTip`; `data-help-exempt="<allowlist-id>"` for the rare label that
  is not an option). `fields.tsx`'s `Field` uses the same row (T4–T6); member
  controls listed in SWEEPS §E
  get it on the control group heading, not on every button (T7).
- Styling: `bg-[color:var(--card)] border border-line text-[color:var(--text)]
  font-body text-xs shadow-panel` per `UI-REVAMP-GUIDE.md`; `z-[70]` above the
  panel's `z-[60]`; `print:hidden`. Framer-motion NOT used (5 files use it; a
  150 ms CSS fade is enough and avoids pulling it into every page).

### D3 — Help panel: `src/components/help/HelpPanel.tsx` (+ `HelpPanelBody.tsx`,
`HelpPanel.components.tsx`, `useHelpPanel.ts`, `useHelpShortcut.ts`)

Mirrors Spectrum's structure one-for-one, with the a11y gaps closed:

- Mounted **once** in `App.tsx` next to the router (inside the providers, so it
  can read auth + route), wrapped by `HelpPanelProvider` exposing
  `{ isOpen, open(), close(), toggle(), openTo(target) }` where
  `target: { topicId: string; pageId?: string }` is the ONE signature used by
  the tooltip, search results, "All pages" and the deep link (codex R2-2).
  Resolution: if `pageId` is given use it; else prefer a placement of the
  topic on the CURRENT page; else the topic's first placement. If the resolved
  page's `href(ctx)` is a different route, the provider stores a
  `pendingTarget`, calls `navigate(href)`, and consumes the target after the
  route (and its publisher, if any) has resolved — that is what makes
  cross-page results reliable. "All pages" uses a sibling `openPage(pageId)` (same pending-target
  navigation, no topic).
- **Route → page match:** `useLocation()` + `useSearchParams()` for `?tab=`
  (NFL/Bracket already use it, `NFLPoolDashboard.tsx:85`,
  `BracketPoolDashboard.tsx:54`; HowItWorks uses `?sport=&view=`,
  `HowItWorksPage.tsx:227-231`), plus a `HelpRouteContext` that surfaces with
  in-memory tabs publish through `useHelpRoute({ poolType, tab, subTab,
  isManager })`. **The complete publisher list is SWEEPS §A2, not "six"**
  (codex R1-8): Props (`PropsPoolDashboard.tsx:34`), Playoff
  (`PlayoffDashboard.tsx:124-152`), Squares `AdminPanel.tsx:74` (+`:140`
  playerTab), `NFLManagerView.tsx:120` sub-tabs, `SuperAdmin.tsx` `activeTab`
  + pool-detail sub-tabs `:3259` + `SuperAdminBillingPanel.tsx:76` +
  `MonetizationDashboard.tsx:19`, `ParticipantDashboard.tsx:515`,
  `Scoreboard.tsx:61` (`nfl|college|basketball`). `NFLUserBentoDashboard`'s
  nav (`:562-569`) sets the parent's tab, so it needs no publisher. Every
  `HelpPage` with a `tab` must be reachable either from the URL or from a
  publisher; T2's PR body lists each page and which of the two it uses.
  Resolution: exact `route+tab(+subTab)+match` → `route+match` → `route` → the
  site fallback page. Spectrum's longest-prefix fallback
  (`help-content.ts:1756-1764`) is replaced by explicit `HelpPage.match`
  because MMP's page identity depends on pool type, not on path depth.
- **Navigating TO a page** (search results, "All pages", tooltip → panel on
  another page): a `HelpPage.href(ctx)` builds a URL. Pages whose tab is only
  in-memory today cannot be linked from elsewhere (codex R1-7). Two options,
  §6 K13: (a) adopt the NFL/Bracket `?tab=` convention in Props, Playoff,
  `AdminPanel`, and `NFLManagerView` sub-tabs (`?tab=manager&sub=settings`) as
  part of T2 — small, ordinary, and it also fixes browser Back on those tabs
  (the same reason NFL did it, CONTEXT.md "Pool Homepage"); or (b) list those
  pages with `href: () => null` — shown, not linked. **Recommend (a) for pool
  surfaces, (b) for super-admin sub-tabs** (admin can click the tab).
- **`?` shortcut** (`useHelpShortcut`): `document` `keydown`; ignore when
  `e.target` is `INPUT`/`TEXTAREA`/`SELECT`/`isContentEditable`, when a
  modifier other than Shift is held, when `e.defaultPrevented`, **or when
  another overlay owns the screen**. Measured (codex R3-1): only 6 modal
  shells render `role="dialog"`, but there are **41** `fixed inset-0` overlay
  backdrops in `src/` (e.g. `BracketPoolDashboard.tsx:2182`,
  `Props/PropsManager.tsx:168`, `PlayoffDashboard.tsx:556` — none has a role),
  so a `role="dialog"` selector alone does not hold. Design: a tiny
  **overlay stack** — `src/components/ui/overlayStack.ts` exporting
  `useOverlayOwner(id, { active, onEscape })` which pushes **while `active`
  is true** and pops when it turns false or on unmount (NOT on mount —
  `AuthModal.tsx:13-24` and `ShareModal.tsx:15-27` stay mounted while closed
  behind an `isOpen` prop and would otherwise own the stack forever; codex
  R5-1; a test renders a mounted-but-closed `ShareModal` and asserts `?`
  still opens Help) and installs ONE capture-phase `keydown` listener on `document`; the
  top-of-stack owner handles `Escape` and calls `stopImmediatePropagation()`
  (a plain `stopPropagation` does not stop sibling listeners on the same
  target — codex R3-3). The Help panel is an owner like any other; `?` is
  ignored whenever the stack top is not the Help panel or empty. A DOM
  fallback `document.querySelector('[role="dialog"]:not(#help-panel), [aria-modal="true"]:not(#help-panel), [data-overlay-root]:not(#help-panel), .fixed.inset-0:not(#help-panel)') !== null`
  (one selector string — codex R2-1; the last clause matches the literal
  Tailwind class pair every one of the 41 measured backdrops carries, so
  unmigrated overlays ARE covered in the interim — codex R4-1) covers
  overlays not yet migrated to the stack. Migration: T2 registers the six
  accessible modals; **T16** (new, ordinary a11y ticket) gives the remaining
  ~35 backdrop shells `role="dialog"` + `data-overlay-root` +
  `useOverlayOwner` — mechanical, one PR, and it fixes their missing
  Escape/focus semantics as a side effect. **T16 is a prerequisite of T15
  (deploy)** — the shortcut does not ship to prod on the class heuristic
  alone. Component tests: `?`
  with `ShareModal` open → panel stays closed; Escape with panel over a
  registered modal → only the panel closes. Spectrum guards only the tag
  names (`HelpPanel.tsx:99-102`). Match on `e.key === '?'`
  (layout-independent; Shift+/ produces it on US layouts, other layouts still
  emit `?`).
- **Button:** in `Header.tsx` right cluster next to `<ThemeToggle />` (`:123`
  desktop, `:194` mobile), `HelpCircle` icon, `aria-label="Help (?)"`,
  `aria-expanded`, `aria-controls="help-panel"`. §6 K3 offers Spectrum's
  floating FAB as the alternative. Routes that render no `Header`
  (`src/pages/PaymentSuccess.tsx` — 0 `Header` refs; the `*` 404) keep the `?`
  shortcut and get no button; they are transient and are allowlisted as
  "shortcut-only" in `pages.ts` (codex R1-12). If K3 picks the FAB, this row
  disappears.
- **Panel shell:** `<aside id="help-panel" role="dialog" aria-modal={isMobile}
  aria-labelledby="help-panel-title">`, `fixed inset-y-0 right-0 z-[60] w-full
  md:w-[440px]`, CSS `translate-x` transition, mobile backdrop, click-outside
  (ignoring `[data-help-trigger]` like Spectrum `:119`), focus moved to the
  search input on open, **focus returned to the invoking element on close**,
  focus trapped only when `aria-modal` (mobile). **When closed the panel is
  out of the accessibility tree and tab order**: the body is unmounted after
  the 300 ms exit transition and the `<aside>` carries `inert` +
  `aria-hidden="true"` and drops `role="dialog"` while closed (React 19
  supports the `inert` prop) — Spectrum keeps its off-canvas panel mounted and
  focusable (`HelpPanel.tsx:186-198`); codex R3-2. Open state NOT persisted in
  localStorage (Spectrum does, `:72-93`; a help panel that reopens on every
  reload is a nuisance on a phone — §6 K7).
- **Body** remounted with `key={pageId}` (Spectrum `:207-214`) — same reasoning.
- **Sections, in order** (same as Spectrum §1c): title row "Help" (§6 K6 asks
  whether the literal string is "Dashboard Help"), search box; when a query is
  active → results list; else → current page title + `summary`; **On this page**
  (one anchor per `HelpPlacement.section` group, each group listing its
  topics; every topic ALSO renders a stable `id="help-topic-<topicId>"`
  anchor, and `openTo({ topicId })` expands the containing accordion first, then
  `scrollIntoView` + moves focus to the topic heading — codex R1-4);
  expandable `SectionAccordion` per group with the topics' `long`, `tips`,
  `related`; **Key Concepts & Glossary** (collapsible, one card per
  `GlossaryTerm`, `short` shown, click to expand `long`, filtered to terms
  referenced by this page first, then "all terms"); **All pages** (grouped by
  audience: "This pool", "My account", "Create a pool", "Admin"; filtered by
  the viewer's role and — §6 K5 — the current pool's type); footer "Press ? to
  toggle · Esc to close".
- **Search:** case-insensitive substring over `title|short|long|tips` of every
  entry visible to this audience/pool type plus glossary `term|short|long`, ≤ 20
  results with a snippet — Spectrum's `searchHelpContent` (`help-content.ts:
  1777-1832`) verbatim in shape. Results click → `openTo({ topicId, pageId })`, and if
  the page is a different route, `navigate()` there first (Spectrum
  `router.push`, `HelpPanel.tsx:214`). Navigation stays inside the SPA; no
  external links.
- **Deep link:** `?help=<topicId>` opens the panel to that topic on load, so
  support emails and cross-page tooltip clicks can target a topic.
- **Admin content is a lazy chunk:** `content/super-admin.ts` is loaded with
  `import()` only when **the same predicate that gates the `/super-admin`
  route** is true — `isSuperAdmin(user)` (`App.tsx:200,423`), which is
  `SUPER_ADMIN` only (`utils/auth.ts:16-18`; MODERATOR is not included today —
  codex R5-3). If moderator access to that route ever lands, the gate follows
  the route's predicate, not a second one. So operational guidance is not shipped to
  every browser and the member bundle stays smaller (codex R1-13). Nothing in
  the registry is a secret — the rules and callables are the authority — but
  there is no reason to ship it.

### D4 — Glossary sync with CONTEXT.md — recommendation: hand-mirrored + invariant test

Two candidates:

(a) **Build-time import**: a Vite plugin or prebuild script parses
`CONTEXT.md` `### Term` headings + the paragraph under each into JSON, and
`glossary.ts` imports it. Pro: literally one source. Con: CONTEXT.md is written
for engineers ("Stored as a uid in the SERVER-OWNED `pools/{id}.coManagers`
array (max 3), written only by the `setPoolCoCommissioner` callable" —
`CONTEXT.md:42`); shipping that verbatim to members is wrong copy, and adding
"member-facing" fields to CONTEXT.md violates the grill skill's rule that
"CONTEXT.md stays a glossary only — no implementation details"
(`grill-with-docs-codex/SKILL.md:186`). It also introduces a build step and a
markdown parser where none exists.

(b) **Hand-mirrored `src/help/glossary.ts` + a docs-state-invariant test**:
each `GlossaryTerm { id, term, short, long, contextHeading }` names the exact
CONTEXT.md `###` heading it mirrors; `tests/help-glossary-invariants.test.ts`
parses CONTEXT.md headings (same `fs.readFileSync` pattern as
`docs-state-invariants.test.ts:193`) and fails when (1) a CONTEXT.md term has no
glossary entry and is not in a short allowlist of engineer-only terms with a
reason (`Scenario Oracle`, `Health Snapshot`, `Sim Run`, …), (2) a glossary
entry names a heading that no longer exists, or (3) a `HelpTopic.terms[]` id is
unknown. Copy stays member-voiced and reviewable in a PR diff.

**Recommend (b).** It keeps CONTEXT.md authoritative for MEANING (the test
forces every term to be represented and every mirror to point at a real
heading), while letting the shipped wording be written for the audience. It is
the same discipline the repo already uses for deploy-state claims. §6 K1.

### D5 — Coverage guards (tests, root `tests/`)

- `help-registry-invariants.test.ts`: every `HelpPlacement.page` and `.topic`
  exists; every topic has ≥ 1 placement; ids unique; `poolTypes` ⊆
  `POOL_TYPES`; every `terms[]` id exists; `short` ≤ 160 chars and the voice
  rules; every `HelpPage.route` is a `path=` present in `App.tsx` (regex over
  the source, like `admin-route-invariants.test.ts`); every `App.tsx` route
  has a page or an allowlist row.
- `help-ui-coverage.test.ts` — **the primary coverage source is the UI, not
  the schema** (codex R1-10/11): (1) grep `src/components/wizard/**/*.tsx` for
  `name="…"`, `name={…}` templates, `feeField=`, `payoutsField=` → normalised
  paths → each must resolve to a topic in the wizard's pool-type scope or be
  allowlisted with a reason; (2) for the listed hand-rolled form files (SWEEPS
  §B2, §E), assert **zero raw `<label` open tags** — every label goes through
  `ui/FieldLabel` (which requires `helpId` or `data-help-exempt="reason"`) —
  and every `helpId`/`data-help-id` literal in those files resolves. Label
  counting is NOT used (a label may wrap several controls or none).
- `help-schema-audit.test.ts` — supplemental: for each `*CreateInputSchema`
  in `shared/schemas/*.ts`, walk the zod shape (nested objects, `.extend`,
  optionals; zod 4 — read `schema.shape` / `def.innerType`, and if that proves
  brittle, fall back to `z.toJSONSchema()`) to a flat set of dotted paths and
  assert each is either a topic's `fields[]` or in
  `src/help/coverage-allowlist.ts` with a reason (`'_tosAccepted': 'legal
  gate, copy lives on the checkbox'`, `'season': 'set by the wizard, never
  shown'`, `'lockBufferMinutes': 'manager-settings only — topic
  NFL:settings.lockBufferMinutes'`). This catches settings that exist but no
  screen explains; it does not prove a rendered control has help — the UI test
  does that.
- `help-glossary-invariants.test.ts` (D4).
- Component tests (`@testing-library/react`, existing e.g. `billingGate.test.tsx`):
  `?` toggles; `?` inside an `<input>` does not; Escape closes and returns focus;
  tooltip opens on focus and has `role="tooltip"` + `aria-describedby`; search
  finds an entry by `long`; "All pages" hides admin pages for a member.

### D6 — No new dependency

React + `react-router` + Tailwind + `lucide-react`, all present. No
`@radix-ui`, no `@floating-ui`, no `framer-motion` in the new files.

## 4. Risks

- **Copy volume.** ~150 wizard/settings options × (short+long) + ~110 pages ×
  summary + glossary. Writing is the long pole, not code; T9–T13 split it per
  pool type so it ships incrementally behind the coverage allowlist (an
  uncovered field fails CI only once its type's ticket lands and the allowlist
  row is removed).
- **Drift between "what the setting means" (help) and "what the setting does"
  (code).** Mitigation is D1's `fields[]` binding + coverage tests, and T8
  making rules pages read the same entries. Residual: a behaviour change PR
  must update the entry; add a line to the PR template checklist (T14).
- **Escape-key collisions** with six existing listeners (§2f). Panel registers
  Escape only while open and stops propagation; verified by a component test.
- **Tab identity is in-memory** on Props/Playoff/AdminPanel/SuperAdmin, so
  the "page you are on" needs `useHelpRoute` calls in each dashboard (T2 lists
  the six insertion points). Missing one = the panel shows the route-level page
  instead of the tab-level one — degraded, not broken.
- **Super-admin surface churn** (`mmp-superadmin-surface`): 17 tab ids across 8
  groups; content authored for it goes stale fastest. §6 K4 asks whether it is
  v1 scope; recommendation is page-level summaries only.
- **Portal + fixed positioning inside transformed ancestors** (a `transform`
  on an ancestor breaks `position: fixed`). Portalling to `document.body`
  avoids it for the tooltip; the panel is a body-level fixed aside anyway.
- **Bundle size:** the registry is static TS; ~2000 lines of strings ≈ 60–80 KB
  raw. Acceptable; lazy-load the panel body with `React.lazy` if the wizard
  route budget objects (measure in T1).

## 5. Out of scope

Onboarding tours; contextual help inside Cloud Functions error strings; a
"Contact support" form inside the panel (the `/support` page exists);
translating copy; the recharts chart tooltips (§2e); changing any setting's
behaviour, default, schema or callable; the marketing FAQ on `/how-it-works`
(it stays; the panel may link to it); rules-page redesign beyond reading the
shared entry (T8).

## 6. DECISIONS NEEDED FROM KEVIN — no code until answered

| # | Question | Recommendation |
|---|---|---|
| K1 | Glossary sync: (a) build-time import from CONTEXT.md, or (b) hand-mirrored `glossary.ts` + invariant test that fails on any CONTEXT.md term without a mirror? | **(b).** CONTEXT.md is engineer-voiced; the test keeps it authoritative for coverage while copy stays member-voiced (§3 D4). |
| K2 | Tooltip trigger: hover+focus show the tooltip and click/tap opens the Help panel to that topic (Spectrum's actual behaviour, D2), or click/tap toggles the tooltip itself? | **Hover/focus = tooltip, click/tap = panel.** Touch users (most members on game day) get the panel with short + long; the tooltip stays a non-interactive `role="tooltip"`. |
| K3 | Where does the "?" button live: Header right cluster beside the theme toggle, or Spectrum's floating bottom-right FAB? | **Header.** The FAB collides with the sticky save bar on pick sheets (`pickSheet/StickySaveBar.tsx`) and the mobile tab bars. |
| K4 | Scope of v1 pages: (i) pool surfaces + wizards + account only, (ii) plus super-admin page-level summaries, (iii) everything incl. per-super-admin-option tooltips? | **(ii).** Admin gets a summary per tab and glossary access; option-level admin tooltips are a follow-up because that surface churns fastest. |
| K5 | "All pages" filtering: show every page the viewer's role can reach, or filter to the current pool's type when inside a pool? | **Filter to current pool type inside a pool, with an "All pool types" expander.** A Survivor member never needs Bracket tabs listed. |
| K6 | Panel title string: literal "Dashboard Help" (Spectrum) or "Help"? | **"Help".** MMP has no single "dashboard"; the panel is site-wide. |
| K7 | Persist open state across reloads (Spectrum does, in localStorage)? | **No.** Reopening on every reload is hostile on mobile; the shortcut is one key. |
| K8 | Copy voice: second person, plain, no jargon ("You pick one team each week…"), matching `docs/UI-REVAMP-GUIDE.md` tone; or the existing rules-page voice? | **Second person, plain.** One `docs/help-voice.md` with 10 rules + 3 examples written in T0. |
| K9 | Member-facing and commissioner-facing help: one registry with `audience[]` filtering, or two registries? | **One registry, `audience[]`.** A commissioner is also a member; two registries duplicate every shared setting. |
| K10 | Should rules pages (`NFLPoolRules`, `BracketRulesPanel`, Playoff rules) start reading the setting's `short`/`long` from the registry (T8), or stay independent for v1? | **Yes in v1 for the "what is it" sentence only**; they keep rendering the pool's actual values. Otherwise the two drift immediately. |
| K11 | Deep link `?help=<entryId>` — include in v1? | **Yes.** Cheap, and it is how support emails and the tooltip's "More in Help" target a topic. |
| K12 | Legacy wizards (`admin/WizardStep*.tsx`, `PropsWizard.tsx`, root `WizardStep*.tsx`) get tooltips too, or are they on a deprecation path? | **Yes, tooltips added (T5/T6).** They are live in `AdminPanel` and Props admin today; if a deprecation is planned, say so and they move to the allowlist. `WizardStepDetails.tsx` / `WizardStepSquaresDetails.tsx` have no importers — delete in T5. |
| K13 | In-memory tabs (Props, Playoff, Squares `AdminPanel`, NFL manager sub-tabs, super-admin sub-tabs) — adopt the NFL/Bracket `?tab=` URL convention so search results and "All pages" can link to them (and Back works), or list them unlinked? | **Adopt `?tab=` for the pool surfaces in T2; leave super-admin sub-tabs unlinked.** It is the same fix NFL made for the same reason (CONTEXT.md "Pool Homepage"). Ordinary class — no state semantics change. |

## 7. Implementation tickets

Every ticket is one PR (`CLAUDE.md` §2d), each gated by codex + qodo + CI.
Content tickets (T9–T13) are the bulk of the work and can be split further.

| Ticket | Scope | Files | Done when |
|---|---|---|---|
> **T1 also added the seven `/create/*` `HelpPage` rows** (nominally T2's
> column). The registry refuses a topic nothing places, and a placement needs a
> page — so the ticket that authors the first topics has to author the pages
> they sit on. T2 still owns route→page MATCHING, the panel, the per-step pages
> inside a wizard, and search.

| T0 | Voice guide + registry types + empty registry + allowlist that lists EVERY schema path (so CI is green from day one) | `docs/help-voice.md`, `src/help/{types,registry,pages,glossary,coverage-allowlist}.ts`, `tests/help-registry-invariants.test.ts`, `tests/help-glossary-invariants.test.ts` (with the engineer-only allowlist) | Tests green; glossary mirrors every CONTEXT.md term not allowlisted; K1/K8 reflected |
| T1 | `HelpTip` + `ui/FieldLabel` components + `HelpScope` context (provided by `WizardShell`, `PoolRoute`, `AdminRoute`) + `fields.tsx` `helpId` (default `name`) + remove `hint` prop; move the 13 literal hints into `wizard-shared.ts` / per-type content; explicit HelpTips on the raw `register()` sites; component tests | `src/components/ui/{HelpTip,FieldLabel}.tsx`, `src/help/scope.tsx`, `wizard/{fields,WizardShell}.tsx`, `wizard/steps/*`, `wizard/create/*`, `routes/{PoolRoute,AdminRoute}.tsx` | Every unified-wizard field renders a HelpTip; `help-ui-coverage.test.ts` (wizard half) green with allowlist rows only for paths not yet authored |
| T2 | Panel shell: provider, `?` shortcut (with dialog guard), header button, drawer, route→page match, `useHelpRoute` publishers for EVERY in-memory tab surface in SWEEPS §A2 (+ `Scoreboard.tsx:61`), `?tab=` adoption per K13, search, On-this-page with topic anchors, accordion, glossary section, All pages (`href` per page), deep link, lazy admin chunk | `src/components/help/*`, `App.tsx`, `Header.tsx`, the publisher files | Component tests in §3 D5 green; PR body lists every `HelpPage` with a `tab` and whether it is URL- or publisher-resolved; keyboard walkthrough recorded in PR |
| T3 | Site + account pages content: summaries for every non-pool route in `App.tsx`, `ParticipantDashboard`, `ManagerDashboard`, `/profile`, `/scoreboard`, `/browse`, `/join` | `content/site.ts` | Every route in SWEEPS §A1 has a `HelpPage` or an allowlist row (`/dev/*`, `/auth/action`, `*`) |
| T4 | NFL manager settings → `FieldLabel` (`NFLManagerView.tsx` 34 labels) + `COMMISH_TABS.hint` → registry + `tiebreakerCopy` hint → registry | `NFLManagerView.tsx`, `shared/nflTiebreaker.ts` reader | `help-ui-coverage` (zero raw `<label`) green for the file |
| T5 | Squares manager: `AdminPanel.tsx` + legacy `admin/WizardStep*.tsx`, `WizardStepBranding/Reminders.tsx` → `FieldLabel` (K12); delete the two dead legacy steps | those files | coverage green |
| T6 | Bracket manager tab + `BracketRulesPanel` `SCORING_SYSTEM_LABELS` → registry; Props `PropsWizard.tsx` **and the three child steps it renders — root `WizardStepGame.tsx`, `WizardStepBranding.tsx`, `WizardStepReminders.tsx` (`PropsWizard.tsx:2-4,219-227,452`)** — + `Props/PropsManager.tsx`; Playoff `PlayoffSettingsModal.tsx`, `RankingForm.tsx`, `PlayoffResultsManager.tsx`; decide `PayoutGallery.tsx` (no importers, 2 controls "Mark Paid"/"Undo" — delete or exempt, SWEEPS §E) | those files | coverage green |
| T7 | Every remaining pool-owned interactive surface in SWEEPS §E: group-heading HelpTips on NFL pick sheets (lock/tiebreaker/confidence/quick picks), entry switcher, payments claim, `RecordPayoutsCard`, `PaymentLedger`, `InviteByEmail`, `AnnouncementManager`, `AICommissioner`, Squares grid legend, bracket builder toolbar, props card, `JoinPool` — each file gets topics or a written exemption in the ticket body | SWEEPS §E files | every §E file has a checked row in the PR body; `help-ui-coverage` green |
| T8 | Rules pages read the topic's `short` for each setting row (K10); `PayoutsPanel.tsx` `PAYOUT_MODE_COPY` / `UNSOLD_LABELS` / Squares rule copy become topic readers (it renders on `/join`, NFL rules, Bracket rules) | `NFLPoolRules.tsx`, `BracketRulesPanel.tsx`, Playoff rules, `PoolRoute.tsx:789` block, `PayoutsPanel.tsx` | no duplicated "what is it" sentence remains (grep guard: the named constants are gone and no new `*_COPY` record appears in those files) |
| T9 | Content: NFL Pick'em (wizard rules step, every `settings.*`, dashboard tabs, manager sub-tabs, pick sheet) | `content/nfl-pickem.ts`, `nfl-shared.ts` | allowlist rows for pickem removed |
| T10 | Content: NFL Survivor | `content/nfl-survivor.ts` | same |
| T11 | Content: NFL Margin + hybrid split + multi-entry | `content/nfl-margin.ts` | same |
| T12 | Content: Bracket (incl. 8 sub-tabs) + Playoff | `content/bracket.ts`, `content/playoff.ts` | same |
| T13 | Content: Squares + Props | `content/squares.ts`, `content/props.ts` | same |
| T14 | Super-admin page summaries (K4) + PR-template checklist line "changed a setting's behaviour? update its help entry" | `content/super-admin.ts`, `.github/PULL_REQUEST_TEMPLATE.md` (UNVERIFIED that the file exists — create if not) | 17 tab summaries present |
| T15 | Coolify deploy + prod smoke: `?` on `/pool/:id` for each type, tooltip on a phone, search "tiebreaker", `?` while a modal is open | — | Kevin's walkthrough |
| T16 | Overlay-stack migration: the ~35 `fixed inset-0` overlay shells without `role="dialog"` (SWEEPS §C5 count 41 total, 6 accessible) get `role="dialog"` + `data-overlay-root` + `useOverlayOwner` (Escape + focus return come free); test asserts every `fixed inset-0` shell in `src/components` carries `data-overlay-root` | the 35 files | grep-invariant green; `?`/Escape arbitration verified against a migrated modal |

Sequencing rules: T0 → T1 → T2 strictly; T3–T8 any order after T2; T9–T13 any
order after T1 (they only add content + remove allowlist rows); T14 late; T16
any time after T2 (independent a11y work, ordinary class) **but before T15**;
T15 after everything. No ticket touches `functions/`, `firestore.rules` or any
schema.

## 8. Proposed CONTEXT.md glossary additions (NOT applied — for Kevin)

To be added under `## Glossary` if §6 signs; the invariant test in T0 will
then require mirrors for them.

- **Help Topic** — One unit of explanatory copy for a single option, control,
  concept, or feature, authored once in the help registry with a short
  (tooltip) form and a long (help panel) form, and bound to the setting
  path(s) it explains. A Help Topic is placed on one or more Help Pages; the
  wording is the same wherever it is placed.
- **Help Page** — The unit the Help panel summarises: a route, or a route plus
  a tab, optionally scoped to a Pool type and an audience. A Help Page carries
  its own summary and lists the Help Topics placed on it.
- **Help Panel** — The site-wide right-side panel opened by the `?` key or the
  header button; shows the current Help Page's summary, its topics, the
  glossary, and the list of all Help Pages the viewer can reach.
- **Help Tip** (tooltip) — The inline `?` affordance next to an option that
  shows its Help Topic's short copy on hover or focus and opens the Help Panel
  to that topic on click or tap.
- **Glossary Term** — A member-voiced mirror of one CONTEXT.md glossary
  heading, shown in the Help panel's Key Concepts & Glossary section; CONTEXT.md
  remains the source of truth for meaning.

## 9. What this plan does NOT claim

- It does not claim the ~150-option / ~110-page counts are exact — they are
  the sums of the measured lists in SWEEPS and will move as tickets enumerate.
- It has not measured render cost of the panel on the wizard route
  (T1 measures).
- UNVERIFIED: whether `.github/PULL_REQUEST_TEMPLATE.md` exists (T14).
- UNVERIFIED: Spectrum's `OnboardingTour` (named in `help-content.ts:3`) — not
  read; out of scope.

---

## § Board memo (2026-08-16)

Simulated advisory board (`ask-the-board`, 6 seats + Chair, unanimous, medium confidence): **do not start this plan during the live season** — 17 tickets with "writing is the long pole", zero measured "what does this option mean" requests, and Duke's pre-mortem predicts a stalled empty skeleton; it re-opens (T0–T2 in a smaller shape) if support tickets asking what a setting means appear. §6 rows the board would overturn: **K4** → v1 scope smaller than (ii) — five seats, shape contested (wizard tooltips only / T0–T2 + ONE pool type with a kill point / (i) only / only fields commissioners ask about / glossary + summaries with no tooltips); **K12** → No — delete/deprecate legacy wizards first (Theo, Ras Mic); K13 → `?tab=` adoption is its own tiny PR, not this plan's (Ras Mic alone). Theo also flags "mimic Spectrum exactly" as an inherited constraint to re-test on a phone on game day. Full memo: [BOARD-MEMO-2026-08-16-transfer-icons-help.md](docs/archive/BOARD-MEMO-2026-08-16-transfer-icons-help.md). Simulation, not approval — Kevin decides.
