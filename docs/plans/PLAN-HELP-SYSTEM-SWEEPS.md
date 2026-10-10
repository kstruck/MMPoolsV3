# Help system — Completeness Sweeps (2026-08-16)

Deterministic grep enumerations feeding `PLAN-HELP-SYSTEM.md` (§2, §7). Measured
in worktree `.claude/worktrees/plan-help-system` at `origin/main` = `42906ecc`.
Paths are relative to `src/components/` unless they start with `src/`, `shared/`
or `tests/`. Re-run commands are given per sweep; counts are point-in-time.

## Sweep A — every route / page / tab (feeds T2, T3, K4, K5)

### A1. Routes — `grep -n "<Route " src/App.tsx` (39)

- App.tsx:214 `/` — LandingPage
- App.tsx:231 `/gameday-squares` — landing
- App.tsx:248 `/march-madness` — landing
- App.tsx:258 `/nfl-playoffs` — landing
- App.tsx:268 `/custom-sports` — landing
- App.tsx:271 `/create/playoff` — wizard
- App.tsx:280 `/create/pickem` — wizard
- App.tsx:289 `/create/survivor` — wizard
- App.tsx:298 `/create/margin` — wizard
- App.tsx:307 `/create/bracket` — wizard
- App.tsx:316 `/create/squares` — wizard
- App.tsx:325 `/create/props` — wizard
- App.tsx:336 `/pricing`
- App.tsx:337 `/payment-success`
- App.tsx:338 `/about`
- App.tsx:339 `/charity`
- App.tsx:340 `/auth/action` — allowlist candidate (transient)
- App.tsx:342 `/browse`
- App.tsx:346 `/features`
- App.tsx:347 `/how-it-works` (4 view modes, HowItWorksPage.tsx:21)
- App.tsx:348 `/privacy`
- App.tsx:349 `/terms`
- App.tsx:350 `/support`
- App.tsx:351 `/contact`
- App.tsx:359 `/profile` — UserProfile
- App.tsx:368 `/scoreboard`
- App.tsx:369 `/odds/super-bowl-squares`
- App.tsx:376 `/articles/bracket-pool-guide`
- App.tsx:379 `/participant` — ParticipantDashboard
- App.tsx:388 `/dev/dashboards` — allowlist (dev)
- App.tsx:390 `/dev/profile-demo` — allowlist (dev)
- App.tsx:398 `/profile/:uid` — PlayerProfile
- App.tsx:407 `/pool/:id` — PoolRoute (dispatch by pool type)
- App.tsx:419 `/admin/:id` — AdminRoute (Squares → AdminPanel; others → same dashboards)
- App.tsx:431 `/super-admin`
- App.tsx:443 `/tournament-sim`
- App.tsx:448 `/create-pool` — CreatePoolSelection
- App.tsx:463 `/join/:poolId`
- App.tsx:472 `*` — allowlist (404)

Pool-type dispatch: `routes/PoolRoute.tsx:186` Bracket, `:214` Props, `:239`
Playoff, `:275` NFL (all three NFL types), Squares inline `Grid` — and
`routes/AdminRoute.tsx:96,116,132` + `AdminPanel` for Squares.

### A2. Tabs and sub-tabs (help "pages" below route level)

- `NFLPoolDashboard/NFLPoolDashboard.tsx:67-68` `TabType = dashboard|picks|grid|standings|results|recaps|rules|payments|manager`; `:85` `?tab=`; `:96-99` `tabOffered` (manager=isManager, payments=!!user, results/grid conditional); `:321` reveal-gated tabs
- `NFLPoolDashboard/NFLManagerView.tsx:75-81` `CommishTab = overview|members|scoring|settings` — `COMMISH_TABS` carries a `hint` string per tab (existing help copy)
- `NFLPoolDashboard/NFLUserBentoDashboard.tsx:562-569` nav `dashboard|rules`
- `BracketPoolDashboard/BracketPoolDashboard.tsx:39` `DashboardTab = dashboard|standings|entries|brackets|reports|rules|manager|ledger`; `:40` `BracketSubTab = poolwide|history|rootfor|whatif|compare|chalk|analytics|insights`; `:54` `?tab=`; `:665-670` labels
- `PropsPoolDashboard/PropsPoolDashboard.tsx:34` `cards|leaderboard|stats|admin|grading|ai` (in-memory state; admin hosts `PropsWizard`, `:319`)
- `PlayoffPool/PlayoffDashboard.tsx:124-152` `picks|leaderboard|rules|ai|commissioner` (in-memory)
- `AdminPanel.tsx:74` (Squares manager) `settings|reminders|players|scoring|game|payouts|communications|stats|props|grading`; labels `:575` ("Setup Wizard", "Smart Reminders", "Game Status", "Statistics", "Side Hustle", …); `:140` playerTab `grid|props`
- `SuperAdmin.tsx:1160-1193` `navStructure` — 8 groups / 17 tab ids: Overview{overview,stats} Pools{pools,tournament,playoffs,props,nfl} Members{users,referrals,loyalty} Operations{operations} Test Suite{testing} Monetization{billing} Themes{themes} System{system,settings}
- `SuperAdmin.tsx:3259-3262` pool-detail sub-tabs `overview|settings|participants|dangerous`
- `admin/SuperAdminBillingPanel.tsx:76` `AdminSubTab = tiers|features|packages|coupons|referrals|pools|monetization`
- `admin/monetization/MonetizationDashboard.tsx:19` `MoneyTab = accounting|coupons|bundles|user|alerts|templates`
- `ParticipantDashboard.tsx:515-521` `insights|entries|live|open|completed|all`
- `ManagerDashboard.tsx:496-585` filter chips (type / sport / status / fee) — filters, not tabs; one page
- `HowItWorksPage.tsx:21` `ViewMode = overview|strategy|faq|contact`
- `?tab=` handling exists in: BracketPoolDashboard, HowItWorksPage, NFLPoolDashboard, NFLUserBentoDashboard, src/pages/PlayerProfile

Re-run: `grep -rn --include=*.tsx -E "type [A-Za-z]*Tab[A-Za-z]* = |useState<'[a-z]+' \|" src/components`

## Sweep B — every wizard step + field per pool type (feeds T1, T9–T13, coverage test)

### B0. Step lists (`WizardStepDef[]`)

- `wizard/create/CreateBracketPool.tsx:87-95` basics · tournament · fee · payouts · branding · launch
- `wizard/create/CreateNFLPickemPool.tsx:163-171` basics · rules · fee · payouts · branding · launch
- `wizard/create/CreateNFLSurvivorPool.tsx:100-108` basics · rules · fee · payouts · branding · launch
- `wizard/create/CreateNFLMarginPool.tsx:86-94` basics · rules · fee · payouts · branding · launch
- `wizard/create/CreatePlayoffPool.tsx:77-86` basics · details · fee · payouts · branding · reminders · launch
- `wizard/create/CreatePropsPool.tsx:108-116` basics · setup · fee · branding · launch
- `wizard/create/CreateSquaresPool.tsx:66-74` basics · grid · fee · branding · launch
- Shell: `wizard/WizardShell.tsx:17,49,146-165`; step type `wizard/types.ts:8-19`

### B1. Fields — `grep -n -o 'name="…"|name={…}|feeField=|payoutsField=' src/components/wizard/**`

Shared steps
- steps/StepBasics.tsx:8 `name`
- steps/StepBasics.tsx:9 `managerName`
- steps/StepBasics.tsx:10 `contactEmail`
- steps/StepBasics.tsx:11 `isPublic`
- steps/StepBranding.tsx:11 `branding.logoUrl`
- steps/StepBranding.tsx:13 `branding.primaryColor`
- steps/StepBranding.tsx:14 `branding.secondaryColor`
- steps/StepFeeAndPayment.tsx:18 `{feeField}` (→ `settings.entryFee` | `props.cost` | `costPerSquare`)
- steps/StepFeeAndPayment.tsx:26-30 `paymentHandles.venmo|zelle|cashapp|paypal|googlePay`
- steps/StepFeeAndPayment.tsx:33 `paymentInstructions`
- steps/StepPayouts.tsx:27,30 raw `register()` `{payoutsField}.places.{i}.rank|percentage` (NOT via fields.tsx)
- steps/StepReminders.tsx:11-14 `reminders.auto24h|auto1h|autoLock|announceWinner`
- steps/StepReview.tsx:36 `_tosAccepted` (legacy review step)
- create/LaunchStep.tsx:323 `estimatedPlayers`; :340 `addons.${key}`; :408 `_tosAccepted` (raw checkbox)
- create/HybridSplitFields.tsx:43-44 `settings.hybridSplit.weeklyPerEntry|seasonPerEntry`
- create/MultiEntryFields.tsx:32 `multiEntry` (UI toggle); :35 `settings.maxEntriesPerUser`

Bracket
- create/CreateBracketPool.tsx:31 `seasonYear`; :33 `gender`; :37 `tournamentType`; :43 `settings.scoringSystem`; :48 `settings.tieBreakers.closestAbsolute`; :49 `settings.tieBreakers.closestUnder`; :90/:100 fee=`settings.entryFee`; :91 payouts=`settings.payouts`

NFL Pick'em
- create/CreateNFLPickemPool.tsx:35 `seasonType`; :44 `settings.lockMode`; :52 `settings.payoutMode`; :61 `settings.pickMode`; :72 `settings.weeklyTiebreaker`; :81 `settings.confidenceMode`; :166/:176 fee; :167 payouts; + HybridSplitFields + MultiEntryFields

NFL Survivor
- create/CreateNFLSurvivorPool.tsx:31 `seasonType`; :40 `settings.maxStrikes`; :41 `settings.maxRebuys`; :42 `settings.rebuyDeadlineWeek`; :43 `settings.rebuyCost`; :47 `settings.tieCountsAs`; :54 `settings.maxTeamUses`; :56 `settings.pickLosersMode`; :57 `settings.autoSurviveExemptionEnabled`; :103/:113 fee; :104 payouts; + MultiEntryFields

NFL Margin
- create/CreateNFLMarginPool.tsx:31 `seasonType`; :40 `settings.payoutMode`; :89/:99 fee; :90 payouts; + HybridSplitFields + MultiEntryFields

Playoff
- create/CreatePlayoffPool.tsx:29 ReadOnly `Season`; :30 `lockDate` (Field+input); :35-38 `settings.scoring.roundMultipliers.WILD_CARD|DIVISIONAL|CONF_CHAMP|SUPER_BOWL`; :80/:91 fee; :81 payouts

Props
- create/CreatePropsPool.tsx:32 `homeTeam`; :33 `awayTeam`; :35 `props.maxCards`; :45 `props.questions.{i}.text` (Field "Prompt"); :50-52 `props.questions.{i}.options`; :111/:120 fee=`props.cost` (label "Cost per card ($)")

Squares
- create/CreateSquaresPool.tsx:23 `homeTeam`; :24 `awayTeam`; :27 `maxSquaresPerPlayer`; :28 `numberSets`; :69/:78 fee=`costPerSquare` (label "Cost per square ($)")

Schema paths with NO wizard control today (must be allowlisted or covered by
manager-settings entries): `shared/schemas/nfl.ts:25` `isListedPublic`, `:46`
`lockBufferMinutes`, `:60` `pointsPerPick`, `:13` `season`. Schemas to walk:
`shared/schemas/{common,nfl,bracket,playoff,props,squares}.ts` (exports at
common.ts:43,53,55,61,67,83,93,105; nfl.ts:40,64,82; bracket.ts:12,16,33;
playoff.ts:7,14; props.ts:6,14; squares.ts:6).

### B2. Legacy edit-wizard / settings surfaces (hand-rolled `<label>`s)

- `NFLPoolDashboard/NFLManagerView.tsx` — 34 `<label>` (settings form :835-1301; ops :1613-1748). Labels: Pool Name, Entry Fee, Entries per Player, Payment Instructions, Host Name, Contact Email, Contact Phone, Contact Link Options, Lock Mode, Lock Buffer, Payout Method, Weekly pots, Season pot, Weekly Tie-Breaker, Base Points Per Correct Pick, Primetime Game Bonus Points, Weekly Deadline, Strikes Limit, Max Rebuys, Rebuy Cutoff Week, Rebuy Fee, Tie Outcome, Team-Use Limit, Payout Method (survivor), Extra Minutes, Reason ×3, Entry/Member, Week, Team
- `BracketPoolDashboard/BracketPoolDashboard.tsx` — 22 `<label>`
- `admin/WizardStep{Advanced,Basics,Branding,BrandingAdmin,Finish,Matchup,Payouts,Reminders,Rules,SideHustle,Summary}.tsx` + root `WizardStep{Branding,Details,Game,Reminders,SquaresDetails}.tsx` + `PropsWizard/PropsWizard.tsx` + `modals/PlayoffSettingsModal.tsx` — 101 `<label>` total. Live references: `AdminPanel.tsx` (WizardStepBranding, WizardStepReminders, admin/*), `PropsWizard.tsx` (WizardStepGame/Branding/Reminders, admin/*), `PropsPoolDashboard.tsx:319` (PropsWizard). Dead: `WizardStepDetails.tsx`, `WizardStepSquaresDetails.tsx` (no importers) — allowlist, or delete in T5.
- `PropsWizard/PropsWizard.tsx:22-27` steps: Game Selection · Branding · Details · Props Setup · Reminders · Final

Re-run: `grep -c "<label" <file>`; `grep -rln "WizardStep" src --include=*.tsx`

## Sweep C — every existing tooltip / help affordance, classified (feeds T1, T4–T8)

### C1. Native `title=` attributes — 93 static + 59 dynamic, 52 files
Class: browser-native hover-only; NOT help copy in most cases (icon-button
labels). Keep as-is except where the copy explains an option (candidates
marked *). Per-file counts:
SuperAdmin.tsx 19* · admin/WizardStepSummary.tsx 9* · src/pages/PlayerProfile.tsx 8 · PricingPage.tsx 7 · PlayoffPool/PlayoffDashboard.tsx 7 · AdminPanel.tsx 7* · BracketBuilder/BracketBuilder.tsx 5 · TournamentSimulator/TournamentSimulator.tsx 4 · NFLPoolDashboard/NFLPicksGrid.tsx 4 · NFLPoolDashboard/NFLManagerView.tsx 4* · ManagerDashboard.tsx 4 · Header.tsx 4 · BracketPoolDashboard/BracketPoolDashboard.tsx 4 · NFLPoolDashboard/NFLWeeklyPicksGrid.tsx 3 · NFLPoolDashboard/NFLStandings.tsx 3 · NFLPoolDashboard/EntryWeekPicks.tsx 3 · LandingPage.tsx 3 · GamedaySquaresLanding.tsx 3 · BracketPoolDashboard/PaymentLedger.tsx 3 · admin/SuperAdminBillingPanel.tsx 3 · SuperAdminBentoDashboard.tsx 2 · StatusCard.tsx 2 · NFLPoolDashboard/SurvivorPickEntry.tsx 2 · NFLPoolDashboard/pickSheet/TeamPickButton.tsx 2 (pickHighlightLabel) · NFLPoolDashboard/PickemPickEntry.tsx 2 · NFLPoolDashboard/NFLUserBentoDashboard.tsx 2 · NFLPoolDashboard/NFLResults.tsx 2 · NFLPoolDashboard/NFLPoolDashboard.tsx 2 · NFLPoolDashboard/MarginPickEntry.tsx 2 · modals/ShareModal.tsx 2 · JoinPool.tsx 2 · GameScoreboard.tsx 2 · FeaturesPage.tsx 2 · Dashboards/GlobalCommissionerDashboard.tsx 2 · RouteSEO.tsx 1 (HTML title, not a tooltip) · routes/PoolRoute.tsx 1 · ResourcesPage.tsx 1 · Props/PropCardForm.tsx 1 · NFLPoolDashboard/pickSheet/GameMeta.tsx 1 · NFLPoolDashboard/NFLManagerBentoDashboard.tsx 1 · HowItWorksPage.tsx 1 · Grid.tsx 1 · BracketPoolDashboard/PoolShareModal.tsx 1 · BracketPoolDashboard/ExportControls.tsx 1 · BracketPoolDashboard/EliminationTracker.tsx 1 · admin/SuperAdminNFLSpreads.tsx 1 · admin/ProductionWatchdogCard.tsx 1 · admin/OperationsPanel.tsx 1 · admin/monetization/CouponTemplates.tsx 1 · admin/monetization/AlertCenter.tsx 1 · admin/monetization/AccountingView.tsx 1
Re-run: `grep -rn --include=*.tsx ' title="\| title={' src | cut -d: -f1 | sort | uniq -c | sort -rn`

### C2. Wizard `hint=` strings — 18 usages (13 literal) — class: OPTION HELP COPY → move to registry (T1)
- create/CreateNFLMarginPool.tsx:28 "Pools are created for the current NFL season. Pick preseason…"
- create/CreateNFLPickemPool.tsx:32 same
- create/CreateNFLPickemPool.tsx:67 "Straight up is the default and needs no betting lines. ATS g…"
- create/CreateNFLPickemPool.tsx:79 "Decides who wins a week when two players score the same. Pla…"
- create/CreateNFLSurvivorPool.tsx:28 same as :28 above
- create/CreatePlayoffPool.tsx:29 "Playoff pools belong to the current NFL season, whose postse…"
- create/CreatePlayoffPool.tsx:30 "Picks lock at Wild Card kickoff by default."
- create/CreatePropsPool.tsx:52 "e.g. Heads, Tails" (placeholder-like; allowlist)
- create/LaunchStep.tsx:327 "An estimate is fine. Small pools launch on the free plan; la…"
- create/LaunchStep.tsx:345 "Applied to the quote below and at checkout."
- steps/StepBasics.tsx:10 "Shown to members who need to reach you."
- steps/StepBranding.tsx:11 "Paste a link to your logo image."
- steps/StepFeeAndPayment.tsx:18 "Leave at 0 for a free pool."
- prop plumbing (not copy): wizard/fields.tsx:19,43,59,69,79,89 `hint?:`; MultiEntryFields.tsx (1 dynamic)

### C3. Copy constants that ARE help copy — class: ABSORB into registry (readers stay)
- `shared/nflTiebreaker.ts:54` `tiebreakerCopy(rule) → {label, hint}` — readers `NFLPoolDashboard/PickemPickEntry.tsx:369,657`, `NFLPoolDashboard/NFLStandings.tsx:81`
- `NFLPoolDashboard/NFLManagerView.tsx:77-81` `COMMISH_TABS[].hint`
- `BracketPoolDashboard/BracketRulesPanel.tsx:12-17` `SCORING_SYSTEM_LABELS`
- `HowItWorksPage.tsx:42,63-212` per-pool-type `faqs[]` — stays (marketing), panel may link
- Rules prose surfaces: `NFLPoolDashboard/NFLPoolRules.tsx:77`, `BracketRulesPanel.tsx`, `PlayoffPool/PlayoffDashboard.tsx:425`, `routes/PoolRoute.tsx:789`

Class: NOT help copy (state / event wording) — allowlist with reason
- `src/utils/pickHighlight.ts:47` `pickHighlightLabel` (WCAG state label)
- `PaymentsPanel.tsx:31` `EVENT_LABELS` (ledger event names)

### C4. `Tooltip` identifiers — 29 hits, ALL recharts chart tooltips (out of scope)
Files: AdminStatsDashboard.tsx, BracketPoolDashboard/PoolAnalytics.tsx, BracketPoolDashboard/ReportsTab.tsx, ManagerDashboard.tsx, NFLPoolDashboard/NFLManagerBentoDashboard.tsx, NFLPoolDashboard/NFLUserBentoDashboard.tsx, ParticipantDashboard.tsx, src/pages/PlayerProfile.tsx. Non-recharts mentions: Grid.tsx:682 (comment), pricing/UpgradeInfoPopover.tsx:6,56, src/utils/pickHighlight.ts:43 (comment).

### C5. Icons, popovers, dialogs, shortcuts (infrastructure inventory)
- `HelpCircle` (10): admin/WizardStepSideHustle.tsx:159 · AICommissioner.tsx:169 · AuditLog.tsx:121 · BracketPoolDashboard/BracketRulesPanel.tsx:60 · NFLPoolDashboard/NFLPoolRules.tsx:74 · pricing/UpgradeInfoPopover.tsx:51 · routes/PoolRoute.tsx:541 ("View Full Rules"), :789 · StatusCard.tsx:165,173 — all decorative/link icons
- `Info` (5): AuditLog.tsx:124 · BracketPoolDashboard/BracketComparison.tsx:106 · Grid.tsx:497,1020,1044 — decorative
- `pricing/UpgradeInfoPopover.tsx` — click-open `role="tooltip"` popover (:56), Escape (:27); replaced group-hover (:6). Only popover-like component.
- `role="dialog"` ×6, all centred modals; no right-side drawer (`translate-x-full` hits are toggle-switch CSS only: admin/WizardStepBasics.tsx:47, admin/WizardStepPayouts.tsx:326, admin/WizardStepSideHustle.tsx:58, AdminPanel.tsx:975,992, UserProfile.tsx:502)
- `document.addEventListener('keydown')` ×6 — modals/AuthModal.tsx:21, modals/PlayoffSettingsModal.tsx:28, modals/ShareModal.tsx:24, NFLPoolDashboard/pickSheet/QuickPicksDialog.tsx:75, pricing/UpgradeInfoPopover.tsx:27, ui/Toast.tsx:84 — Escape-only; no global `?`
- `src/components/ui/` = Badge, Button, cn, Field, LeaderboardTable, OfflineBanner, PoolCard, StatTile, Tag, ThemeToggle, Ticker, Toast — no Tooltip/Drawer/Popover
- Header button candidate slots: Header.tsx:123 (desktop `<ThemeToggle />`), :194 (mobile), :214 logout
- framer-motion used by 5 files (not required for this feature)

## Sweep E — every pool-owned interactive surface (feeds T6, T7; added after codex R1-9)

Files under the pool dashboards / builders / pool-scoped components with ≥ 1
`<input|<select|<textarea|<button` (count in parentheses). Each needs topics
or a written exemption in its ticket. Re-run (both greps — the second catches
shared `<Button>` / `onClick=` / `role="button"` controls that the first misses,
codex R3-4):

```
for f in $(git ls-files 'src/components/NFLPoolDashboard/**/*.tsx' 'src/components/BracketPoolDashboard/*.tsx' 'src/components/PropsPoolDashboard/*.tsx' 'src/components/PlayoffPool/*.tsx' 'src/components/Props/*.tsx' 'src/components/BracketBuilder/*.tsx' src/components/AdminPanel.tsx src/components/Grid.tsx src/components/InviteByEmail.tsx src/components/AnnouncementManager.tsx src/components/PaymentsPanel.tsx src/components/PayoutsPanel.tsx src/components/PayoutGallery.tsx src/components/AICommissioner.tsx src/components/JoinPool.tsx | grep -v test); do
  a=$(grep -c "<input\|<select\|<textarea\|<button" $f); b=$(grep -c "<Button\|onClick=\|role=\"button\"" $f); echo "$f native=$a semantic=$b"; done
```

Semantic-only files (zero native controls, ≥ 1 `<Button>`/`onClick`) found by
the second grep — added to T7:
- NFLPoolDashboard/SurvivorPickEntry.tsx (semantic=2; the "Rebuy / Buy-Back" `<Button>` at :324 is a member OPTION — needs a topic; also renders `survivorModeRulesCopy` at :152, a template topic per D1)
- BracketPoolDashboard/StandingsTable.tsx (semantic=1)
- Props/PropLeaderboard.tsx (semantic=1)

- BracketPoolDashboard/BracketPoolDashboard.tsx (76) — T6
- NFLPoolDashboard/NFLManagerView.tsx (49) — T4
- Grid.tsx (35) — T7 (Squares member grid)
- AdminPanel.tsx (32) — T5
- Props/PropsManager.tsx (21) — T6
- NFLPoolDashboard/NFLManagerBentoDashboard.tsx (16) — T7
- PlayoffPool/PlayoffDashboard.tsx (14) — T6/T7
- BracketPoolDashboard/PaymentLedger.tsx (13) — T7
- AICommissioner.tsx (13) — T7
- BracketPoolDashboard/DateTimePicker.tsx (10) — T6
- PropsPoolDashboard/PropsPoolDashboard.tsx (9) — T7
- NFLPoolDashboard/NFLPoolDashboard.tsx (9) — T7 (tab bar)
- Props/PropCardForm.tsx (8) — T7
- NFLPoolDashboard/RecordPayoutsCard.tsx (7) — T7
- BracketBuilder/BracketBuilder.tsx (7) — T7
- PlayoffPool/RankingForm.tsx (6) — T6
- NFLPoolDashboard/NFLUserBentoDashboard.tsx (5) — T7
- BracketPoolDashboard/PoolShareModal.tsx (5) — T7
- PlayoffPool/PlayoffResultsManager.tsx (3) — T6
- NFLPoolDashboard/PickemPickEntry.tsx (3) — T7
- NFLPoolDashboard/NFLResults.tsx (3) — T7
- InviteByEmail.tsx (3) — T7
- BracketPoolDashboard/WhatIfSimulator.tsx (3) — T7
- BracketPoolDashboard/ReportsTab.tsx (3) — T7
- BracketPoolDashboard/ExportControls.tsx (3) — T7
- BracketPoolDashboard/BracketShareCard.tsx (3) — T7
- BracketBuilder/ESPNBracket.tsx (3) — T7
- NFLPoolDashboard/pickSheet/QuickPicksDialog.tsx (2) — T7
- NFLPoolDashboard/NFLStandings.tsx (2) — T7
- BracketPoolDashboard/BracketComparison.tsx (2) — T7
- BracketPoolDashboard/BanterBoard.tsx (2) — T7
- AnnouncementManager.tsx (2) — T7
- one-control files (1 each) — Props/PropGradingDashboard, PaymentsPanel, NFLPoolDashboard/{WeekChecklist, pickSheet/TeamPickButton, pickSheet/StickySaveBar, NFLWeeklyPicksGrid, NFLPoolRules, NFLPicksGrid, NFLGameTicker, GridSortToggle}, JoinPool, BracketPoolDashboard/{WhoToRootFor, PickHistory, ChalkComparison}, BracketBuilder/{RegionTabs, MatchNode} — T7 (most will be exempt: navigation/toggle buttons, not options)
- Props edit-wizard child steps rendered by PropsWizard.tsx:219-227,452: root WizardStepGame.tsx, WizardStepBranding.tsx, WizardStepReminders.tsx — T6 (codex R2-5)
- PayoutGallery.tsx (2 controls: "Mark Paid" :96, "Undo" :87) — NO importers in src (measured `grep -rln PayoutGallery src`); dead code — delete or exempt in T6 (codex R2-6)
- Not pool-owned but member-facing forms: UserProfile.tsx (sections at :426 Basic Information, :513 Payment Info, :589 Social Links) — T3

## Sweep D — Spectrum reference cites (read-only, main checkout `src/`)
- `src/lib/help-content.ts` 1846 lines: types :8-21; `KEY_CONCEPTS` :25 (8); `INLINE_TOOLTIPS` :78 (~130); `HELP_ENTRIES` :380 (37 pages); `getHelpForPath` :1756; `searchHelpContent` :1777; `extractSnippet` :1834
- `src/components/dashboard/HelpTooltip.tsx` 141: portal+fixed positioning :41-62; window bridge :96-103; trigger :118-131; 213 usages in src, 191 with `text=` override
- `src/components/dashboard/HelpPanel.tsx` 452: localStorage :72-93; `?`/Esc :96-112; click-outside :115-131; global bridge :144-148; FAB :155-175; overlay :178-183; shell :186-198; body remount `key={pathname}` :207-214; header :293; search :316; results :330-345; summary :352-359; TOC + accordion :362-379; concepts :393-411; all pages :414-437; footer :443-450
- `src/components/dashboard/HelpPanel.components.tsx` 242: FormattedContent :15; RelatedPageLink :54; KeyConceptCard :69; TableOfContents :88-120; SearchResultItem :123; SectionAccordion :153 (scrollIntoView :168)
- `src/components/ui/tooltip.tsx` 66 (base-ui wrapper; 1 importer; not the help tooltip)
- mounted `src/components/dashboard/DashboardShell.tsx:404`
