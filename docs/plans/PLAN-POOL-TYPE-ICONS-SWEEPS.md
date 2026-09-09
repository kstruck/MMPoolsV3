# PLAN-POOL-TYPE-ICONS — sweeps

Deterministic greps run 2026-08-16 on `claude/plan-pool-type-icons` @ `42906ecc`
(= `origin/main` at write time). Re-run each command before implementing; the
plan's §1 tables and §3.4 call-site list are derived from these. Classification
per row: **call site to change** / **source of truth** / **unaffected**.

## S1 — Every pool `type` literal / enum member (feeds plan §1.1, §3.5 test 1)

```
grep -rn "'NFL_PICKEM'\|'NFL_SURVIVOR'\|'NFL_MARGIN'\|'SQUARES'\|'BRACKET'\|'NFL_PLAYOFFS'\|'PROPS'" \
  shared/poolTypes.ts shared/schemas/*.ts src/types/index.ts src/types/nflPoolTypes.ts src/utils/featureFlags.ts
```

| Site | What | Class |
|---|---|---|
| `shared/poolTypes.ts:8-16` | `POOL_TYPES` as const — the seven members | **source of truth** (the exhaustiveness guard iterates this) |
| `shared/poolTypes.ts:21-25` | `NFL_SEASON_TYPES` | source of truth (sport derivation) |
| `shared/schemas/nfl.ts:41,65,83` | `z.literal` per NFL type | source of truth (variation fields live beside them) |
| `shared/schemas/playoff.ts:15` | `z.literal('NFL_PLAYOFFS')` | source of truth |
| `shared/schemas/props.ts:15` | `z.literal('PROPS')` (`:11` `standard\|tiebreaker` is a prop-card type — NOT a pool variation) | source of truth |
| `shared/schemas/squares.ts:7` | `z.literal('SQUARES').optional()` — missing ⇒ SQUARES | source of truth (legacy-doc rule) |
| `shared/schemas/bracket.ts:34` | `z.literal('BRACKET').optional()` | source of truth |
| `src/types/index.ts:26` | `PoolType` union (mirror of shared) | mirror — unaffected |
| `src/types/index.ts:56,135,329,679`; `src/types/nflPoolTypes.ts:59,130,193` | discriminant on each interface | unaffected |
| `src/utils/featureFlags.ts:10-18` | client `POOL_TYPES` (feature flags) | unaffected (a second copy already exists; not this plan's problem) |

Per-file count of `pool.type === '…'` comparisons in `src/components` + `src/utils`
(`grep -rc`), for scale — none of these change unless listed in S2/S3:
ManagerDashboard 43 · NFLUserBentoDashboard 29 · ParticipantDashboard 21 ·
SuperAdmin 17 · NFLPoolDashboard 9 · BrowsePools 9 · poolSport 7 · JoinPool 7 ·
PoolRoute 5 · AdminRoute 5 · PayoutsPanel 2 · poolUsesSpreads / SimulationDashboard /
PlayoffDashboard / WeekChecklist / NFLWeeklyPicksGrid 1 each.

### S1b — Variation fields (feeds plan §1.2)

```
grep -n "pickMode\|confidenceMode\|pickLosersMode\|payoutMode\|lockMode\|tournamentType\|gender\|league\|seasonType" \
  shared/schemas/nfl.ts shared/schemas/bracket.ts shared/schemas/squares.ts shared/schemas/props.ts src/types/index.ts src/types/nflPoolTypes.ts
```

| Site | Field | Class |
|---|---|---|
| `shared/schemas/nfl.ts:44` `confidenceMode`, `:48` `pickMode` | Pick'em play variations | source of truth |
| `shared/schemas/nfl.ts:45` `lockMode`, `:47,:86` `payoutMode` | options, not play variations | unaffected |
| `shared/schemas/nfl.ts:72` `pickLosersMode` | Survivor play variation | source of truth |
| `shared/schemas/nfl.ts:68-78` strikes/rebuys/tie/team-uses/exemption | options | unaffected (`poolOptionLabels` prints them) |
| `shared/schemas/bracket.ts:39` `gender`, `:40` `tournamentType` (`ncaa\|bigeast\|big12`) | Bracket variations | source of truth |
| `src/types/index.ts:715,821` `tournamentType?: 'ncaa' \| 'conference'`; `:822` `conferenceName` (on the **tournament** type, not the pool) | matches what the callable persists | source of truth for the persisted shape |
| `functions/src/bracketPools.ts:54-62,83-84` — `isConference = tournamentType !== 'ncaa'`; persists `tournamentType: isConference ? 'conference' : 'ncaa'` and `tournamentId` = `bigeast-{y}` / `big12-{y}` / `{gender}-{y}` | the create-input `bigeast`/`big12` never reaches the pool doc | **source of truth for the conference tag** (read `tournamentId` prefix) — codex r1 #1 |
| `functions/src/conferenceTournaments.ts:155,335`; `src/components/admin/TournamentManager.tsx:150-151` | `conferenceName` written on tournament docs only | evidence — unaffected |
| `src/types/index.ts:351` `league`, `:352` `sport?: string` (free text, never read for display) | Squares sport | source of truth (`league`); `sport` unaffected |
| `src/types/index.ts:357-358` `seasonType`/`week`, `:363` `numberSets`, `:366` `gridSize` | Squares options | unaffected (K6) |
| `src/types/index.ts:57` `league: 'NFL'` (Playoff) | sport constant | source of truth |
| `src/types/index.ts:150,153` `gameId`/`seasonType` (Props) | sport-if-linked | source of truth |
| `src/components/wizard/create/CreateNFLPickemPool.tsx:61-67,81,138,143` | wizard defaults STRAIGHT / confidence false; no ATS×confidence exclusion | evidence only — unaffected |
| `src/components/wizard/create/buildBracketPayload.ts:20` | `tournamentType: v.tournamentType \|\| 'ncaa'` | evidence only — unaffected |

## S2 — Every place a pool card or pool header is rendered (feeds plan §3.4)

```
grep -rn "key={pool.id}" src/components/ParticipantDashboard.tsx src/components/BrowsePools.tsx \
  src/components/ManagerDashboard.tsx src/components/Dashboards/GlobalCommissionerDashboard.tsx \
  src/components/SuperAdmin.tsx src/components/JoinPool.tsx
grep -rn "<h1[^>]*>{pool.name}\|<h1[^>]*>{squaresPool.name}" src/components
```

| Site | What renders | Class |
|---|---|---|
| `src/components/ParticipantDashboard.tsx:787` (card root), `:781-783` (`poolTypeLabel`/`poolOptionLabels`), `:813-818` (`data-testid="pool-card-type"` chip row) | **My Entries** card | **call site to change (S1 in plan)** |
| `src/components/Dashboards/GlobalCommissionerDashboard.tsx:100-131` `PoolRow`, `:169` map, `:146-148` type filter chips, `:164` type group header, `:14-23` local label map | **Commissioner Hub** | **call site to change (S2/S2b/S2c)** |
| `src/components/BrowsePools.tsx:339` (card root), `:352` (avatar: `Trophy` if bracket else initials), `:359` (subtitle) | **Browse Pools** | **call site to change (S3)** |
| `src/components/ManagerDashboard.tsx:706` (card root), `:716-718` (initials avatar), `:725` (ternary label — NFL season pools fall to "Squares Pool") | **Manage My Pools** | **call site to change (S4)** — includes a copy bug fix |
| `src/components/JoinPool.tsx:194-200` ("Pool Format" cell; ternary falls to "Squares" for Bracket/Playoff/Props) | **Join page** | **call site to change (S5)** — includes a copy bug fix |
| `src/components/SuperAdmin.tsx:1425` (`<th>Type / Matchup`), `:1441` (`formatPoolMatchup`), `:1459` (row), `:1492` (cell) | **Super-Admin pools table** | **call site to change (S6) — gated on K8** |
| `src/components/SuperAdmin.tsx:3775-3781` (user's pools card, `formatPoolMatchup` subtitle) | Super-Admin user detail | call site to change (S6) — gated on K8 |
| `src/components/PricingPage.tsx:279` (`Format: {pool.type.toLowerCase().replace('_',' ')}` in the pricing calculator's pool selector) | commissioner-facing pool list | **call site to change (S7)** — found by codex r1 #6 |
| `src/components/admin/SuperAdminBillingPanel.tsx:1578` (`<td>{pool.type}</td>`; `:427` search-by-type unaffected) | Super-Admin billing pools table | call site to change (S8) — gated on K8; codex r1 #6 |
| `src/components/admin/monetization/UserMoneyProfile.tsx` | named by codex r1 #6; `grep -n "type"` → only the `import type` line — renders no pool type | unaffected (codex finding rejected) |
| `src/components/NFLPoolDashboard/NFLPoolDashboard.tsx:565-570` (`h1` `pool.name`, logo, Host line) | **Pool home — Pick'em / Survivor / Margin** (one header, three types) | **call site to change (H1)** |
| `src/components/BracketPoolDashboard/BracketPoolDashboard.tsx:617-621` (`Trophy` + `h1`) | **Pool home — Bracket** | **call site to change (H2)** |
| `src/components/routes/PoolRoute.tsx:413-418` (`h1` `squaresPool.name`; `:419-420` "Fully Auditable" `Shield` button on the same row) | **Pool home — Squares** | **call site to change (H3)** |
| `src/components/PlayoffPool/PlayoffDashboard.tsx:91-96` (`h1` + `<Tag sport="nfl">Playoff Challenge</Tag>`) | **Pool home — Playoff** | **call site to change (H4)** |
| `src/components/PropsPoolDashboard/PropsPoolDashboard.tsx:69-78` (`Dices` tile fallback + `h1` + `<Tag sport="props">Props Pool</Tag>`) | **Pool home — Props** | **call site to change (H5)** |
| `src/components/BracketPoolDashboard/BracketPoolDashboard.tsx:2124` (`pool.name` in the print header portal) | print view | unaffected |
| `src/components/AdminPanel.tsx:558` (`h1` `gameState.name` "Admin Editor") | Squares admin editor, not the Pool home | unaffected (could take the glyph later; not in Kevin's ask) |
| `src/components/NFLPoolDashboard/NFLManagerBentoDashboard.tsx:743` (`pool.name` in "Roster Financials") | sub-heading | unaffected |
| `src/components/ui/PoolCard.tsx:31-91` (`HEADER_BG`, `Tag sport`) | design-system card, **zero consumers outside `ui/`** (`grep -rn "<PoolCard" src` → none) | unaffected |
| `src/pages/DevDashboardPreview.tsx` | dev-only preview | unaffected (UNVERIFIED whether it renders a pool card; not a prod surface) |

## S3 — Every existing type→label / type→icon mapping (feeds plan §1.3)

```
grep -rn "POOL_TYPE_LABEL\|TYPE_LABEL\b\|POOL_TYPE_LABELS\|poolTypeLabel(\|getPoolTypeName(\|formatPoolMatchup(\|getPoolSport(" \
  src functions/src --include=*.ts --include=*.tsx | grep -v "\.test\."
grep -rn "icon: \|<Tag sport=" src/components/HowItWorksPage.tsx src/components/CreatePoolSelection.tsx src/components/PlayoffPool/PlayoffDashboard.tsx src/components/PropsPoolDashboard/PropsPoolDashboard.tsx
```

| Site | Mapping | Class |
|---|---|---|
| `src/utils/poolTypeLabel.ts:15-30` `TYPE_LABEL` + `poolTypeLabel()`; `:32-68` `PAYOUT_LABEL` + `poolOptionLabels()`; test `poolTypeLabel.test.ts` | newest, tested, honest "Unknown type" fallback | **source of truth for label text** — meta delegates to it |
| `src/components/Dashboards/GlobalCommissionerDashboard.tsx:14-23` `POOL_TYPE_LABEL` ("Playoffs", `replace(/_/g,' ')` fallback) | duplicate | **call site to change** (delete, read `poolTypeLabel`) |
| `src/components/JoinPool.tsx:197-199` ternary | duplicate + wrong for 3 types | **call site to change** |
| `src/components/ManagerDashboard.tsx:725` ternary | duplicate + wrong for 3 types | **call site to change** |
| `src/components/SimpleTestingDashboard.tsx:17-25,133,186` `POOL_TYPE_LABELS` | admin/test wording | unaffected (K9 recommends leave) |
| `functions/src/joinPreview.helpers.ts:13-21,40` `TYPE_LABEL` | server OG-preview copy | unaffected |
| `src/utils/poolSport.ts:32-39` `getPoolSport` (display strings for GameOps filter, callers `SuperAdmin.tsx:1069,1125`) | sport buckets | **source of truth for the sport branch order** — reused as keys, function itself untouched |
| `src/utils/poolSport.ts:230-251` `formatPoolMatchup` (callers `SuperAdmin.tsx:1441,3780`) | subtitle helper | unaffected (stays beside the new glyph) |
| `src/utils/poolUtils.ts:17-66` `getPoolTypeName`/`Short` (caller `BrowsePools.tsx:359`) | Squares naming by season/week | unaffected (K6) |
| `src/utils/poolSport.ts:46-48` `isNFLSeasonPoolType`, `:56-58` `isSquaresPoolType` | predicates | source of truth (meta uses both) |
| `src/components/HowItWorksPage.tsx:25-33` `POOL_TYPES[].icon` — Trophy ×2, LayoutGrid, Zap, Star, Sparkles, HelpCircle | ad-hoc glyphs | call site to change **(X1, gated on K10)** |
| `src/components/CreatePoolSelection.tsx:88` `Grid3X3` (Squares), `:109,130,151` `Trophy` (Pick'em/Survivor/Margin), `:182` `Grid3X3` (Props) | ad-hoc glyphs, three types share Trophy | call site to change **(X1, gated on K10)** |
| `src/components/BracketPoolDashboard/BracketPoolDashboard.tsx:619` `Trophy` | hardcoded Bracket glyph | call site to change (H2) |
| `src/components/PropsPoolDashboard/PropsPoolDashboard.tsx:71` `Dices`, `:77` `<Tag sport="props">` | hardcoded Props glyph + tag | call site to change (H5) |
| `src/components/PlayoffPool/PlayoffDashboard.tsx:93-95` `<Tag sport="nfl">Playoff Challenge</Tag>` | hardcoded | call site to change (H4) |
| `src/components/ui/Tag.tsx:4` `SportType` (nfl/ncaa/squares/survivor/margin/props), `:10-26` styles + labels | design-system chip; mixes sports and types | **source of truth for the sport tag's colours** (`nfl`, `ncaa` members reused); the type members are unaffected |
| `src/components/ui/PoolCard.tsx:6-13` `HEADER_BG` | keyed by `Tag` sport | unaffected (no consumers) |
| `src/components/BrowsePools.tsx:166-172` type filter list (`squares/props/bracket/playoff` — no NFL season types), `:222-228` sport filter (`nba` disabled "Soon") | filter chrome | unaffected (could take glyphs later; not a card) |

## S4 — Icon availability (feeds plan §1.4)

```
node -p "require('D:/march-melee-pools/node_modules/lucide-react/package.json').version"   → 0.556.0
ls D:/march-melee-pools/node_modules/lucide-react/dist/esm/icons | wc -l                   → 3802
for i in trophy grid-3x3 list-checks shield-check ruler medal dices list-ordered diff skull circle-help git-fork network layout-grid crosshair target award; do test -f .../icons/$i.js && echo OK $i; done
ls .../icons | grep -i "football\|basket\|helmet\|stadium"                                → (none; only shopping-basket, volleyball, goal)
grep -o "Grid3x3\|Grid3X3" .../dist/lucide-react.d.ts | sort -u                           → both exported
```

All seventeen candidate glyphs present; no sport glyph exists. **Note:** the
plan worktree has no `node_modules` — the check ran against the main
checkout's install of the same `^0.556.0` range pinned in
`package-lock.json:20`.

## S5 — Test environment (feeds plan §3.5)

```
sed -n '46,53p' vite.config.ts        → test: { exclude: [...] } — no `environment`
grep -n "jsdom\|happy-dom\|testing-library" package.json → (none)
find src tests -name "*.test.tsx"     → src/__tests__/billingGate.test.tsx (its header says to install @testing-library if missing)
```

Root vitest is node-only, so the exhaustiveness guard is a pure-module test.

> **HARD DEPENDENCY:** none. Every row above is client-side and additive except
> the two ternary copy fixes (`JoinPool.tsx:197`, `ManagerDashboard.tsx:725`),
> which the PR body must call out as bug fixes under the UI guide's
> "never change copy" rule.
