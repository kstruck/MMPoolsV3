# PLAN — pool-type icons (sport × type × variation, on every card and the Pool home)

> **STATUS: PLAN ONLY, AWAITING KEVIN'S SIGN-OFF ON §6. No code written. Classification: ordinary.**
> Ordinary under `mmp-change-control` §1 — no money, no authorization, no
> production data, no scoring. It carries a plan anyway because Kevin asked for
> the icon taxonomy and the component to be designed **before** any card is
> touched, and because the taxonomy is a cross-cutting UI contract that seven
> surfaces will read. Plan → adversarial review log
> (`PLAN-POOL-TYPE-ICONS-REVIEW-LOG.md`) → sweeps
> (`PLAN-POOL-TYPE-ICONS-SWEEPS.md`) → Kevin's sign-off on §6 → code.
>
> **Provenance (Kevin, verbatim):** *"Pool-type icons. A distinct icon for every
> sport, every pool type within that sport (Pick'em, Survivor, Margin, Squares,
> Bracket, Playoff, Props…), and every variation of those (Pick'em: ATS /
> straight-up / confidence; Survivor: winner vs loser ("pick losers") mode;
> etc.). Show them on every card in the pool list AND on the Pool home so users
> can tell pool types apart at a glance. Ordinary class, but plan the icon
> taxonomy + component first."*
>
> Written without Kevin in the room (self-interview grill). Every question only
> he can answer is in §6 with a recommendation; **nothing in §6 has been
> answered.** Codex Act 2 rounds are in the review log. Measured on branch
> `claude/plan-pool-type-icons` @ `42906ecc` (= `origin/main` at write time).

---

## 0. What Kevin asked for, and what that means precisely

Three axes, one glyph system, two surfaces:

| Axis | Kevin's words | What the data actually offers (§1) |
|---|---|---|
| **Sport** | "every sport" | NFL (four types + NFL Squares + Props), NCAA football (Squares only, `league: 'college'\|'ncaa'`), NCAA basketball (Bracket only). No other sport is persisted anywhere; NBA is a disabled "Soon" filter button (`BrowsePools.tsx:225`). |
| **Type** | "every pool type within that sport" | Exactly seven, closed enum: `POOL_TYPES` (`shared/poolTypes.ts:8-16`). |
| **Variation** | "ATS / straight-up / confidence; winner vs loser mode; etc." | Pick'em: `pickMode` × `confidenceMode` (a 2×2, not three values — §1.2). Survivor: `pickLosersMode`. Bracket: `tournamentType` + `gender`. Squares: `league`. Margin / Playoff / Props: **no play-rule variation field exists** (§1.2). |
| **Surfaces** | "every card in the pool list AND on the Pool home" | Six card/list surfaces (§3, S1–S6) + five Pool-home headers, one per dashboard (§3, H1–H5). "Pool list" is read broadly: My Entries, Commissioner Hub, Browse, Manage My Pools, Join page, and the Super-Admin pools table (K8 decides the last). |

**What "distinct icon for every variation" can honestly mean.** lucide 0.556.0
has no glyph for "against the spread", "confidence points", "straight-up" or
"pick losers" (§1.4). A variation is therefore rendered as a **composed badge** —
the type's glyph plus a 2–4 letter tag (`ATS`, `CONF`, `LOSE`) — and the tag is
what makes it distinct. Where a real glyph *does* exist for a variation
(`Skull` for pick-losers, `ListOrdered` for confidence, `Diff` for ATS) the
taxonomy lists it as an **optional glyph swap** and K3 decides whether the swap
or the tag is the primary carrier. The recommendation is tag-first: the type
glyph stays constant so a Survivor pool is recognisable as Survivor before the
reader parses the tag.

**What this plan does not do.** It does not add a sport field to any schema, does
not change any label wording that already ships (`poolTypeLabel.ts` is the
label source of truth), and does not touch `functions/` (the OG-preview labels in
`functions/src/joinPreview.helpers.ts:13-21` are server HTML copy, unaffected).

---

## 1. What is true today — measured, not remembered

### 1.1 The type enum and its shapes

| Fact | Where |
|---|---|
| Seven types, `as const`, "SINGLE source of truth" | `shared/poolTypes.ts:8-16`; mirrored `src/types/index.ts:26` (`PoolType`), `functions` consumes the shared one |
| Confidence is **not** a type — comment says so | `shared/poolTypes.ts:5-6` |
| `NFL_SEASON_TYPES` = PICKEM/SURVIVOR/MARGIN | `shared/poolTypes.ts:21-25`; string-safe `isNFLSeasonPoolType` at `src/utils/poolSport.ts:46-48` |
| Squares docs may have **no** `type` (legacy) — every squares reader treats missing as SQUARES | `src/utils/poolSport.ts:50-58` (`isSquaresPoolType`), `shared/schemas/squares.ts:7` |
| Bracket schema `type` is optional too | `shared/schemas/bracket.ts:34` |
| Zod create schemas per type: `pickemCreateInputSchema` `:40-62`, `survivorCreateInputSchema` `:64-80`, `marginCreateInputSchema` `:82-92` | `shared/schemas/nfl.ts` |
| Playoff `type: 'NFL_PLAYOFFS'` | `shared/schemas/playoff.ts:15` |
| Props `type: 'PROPS'`; the `z.enum(['standard','tiebreaker'])` at `:11` is a **prop-card** type, not a pool variation | `shared/schemas/props.ts:11,15` |

### 1.2 Per-type variation fields (the whole list — anything not here does not exist)

| Type | Field | Values | Where | Play-rule variation? |
|---|---|---|---|---|
| NFL_PICKEM | `settings.pickMode` | `'STRAIGHT' \| 'ATS'` (absent ⇒ STRAIGHT) | `shared/schemas/nfl.ts:48`; `src/types/nflPoolTypes.ts:94`; wizard default `CreateNFLPickemPool.tsx:138` | **Yes** |
| NFL_PICKEM | `settings.confidenceMode` | boolean (absent ⇒ false) | `nfl.ts:44`; `nflPoolTypes.ts:90`; wizard `:81,:143` | **Yes** — and it **combines** with ATS: no schema or wizard rule forbids `ATS + confidence` (grep of `nfl.ts`, `functions/src/nflPools.ts`, wizard: no cross-check). So Pick'em is a 2×2: SU, SU+CONF, ATS, ATS+CONF |
| NFL_PICKEM | `settings.lockMode` | `PER_GAME \| WEEKLY` | `nfl.ts:45` | No — operational (weekly forced by confidence, `nflPoolTypes.ts:91`) |
| NFL_PICKEM / NFL_MARGIN | `settings.payoutMode` | `SEASON \| WEEKLY \| HYBRID` | `nfl.ts:47,86` | No — payout, not play. Already spelled by `poolOptionLabels` (`poolTypeLabel.ts:32-36,50,53`) |
| NFL_SURVIVOR | `settings.pickLosersMode` | boolean | `nfl.ts:72`; `nflPoolTypes.ts:165` ("true = pick team to LOSE") | **Yes** |
| NFL_SURVIVOR | `maxStrikes`, `maxRebuys`, `tieCountsAs`, `maxTeamUses`, `autoSurviveExemptionEnabled` | numbers / enum / bool | `nfl.ts:68-78` | No — options. `poolOptionLabels` already prints strikes/rebuys (`poolTypeLabel.ts:58-61`) |
| NFL_MARGIN | — | — | `nfl.ts:82-92` has only `payoutMode`/`hybridSplit` beyond the base | **None exists** |
| SQUARES | `league` | `'nfl' \| 'college' \| 'ncaa'` (absent ⇒ nfl per `getPoolTypeName`, `poolUtils.ts:18`) | `src/types/index.ts:351`; `getLeagueDisplayName` `poolSport.ts:9-19` | **Sport**, not variation |
| SQUARES | `seasonType`, `week`, `numberSets` (1\|4), `gridSize` | | `index.ts:357-358,363,366`; `getPoolTypeName` `poolUtils.ts:17-60` turns postseason week into "Super Bowl Squares" etc. | Naming/options — not a play variation. K6 |
| BRACKET | `tournamentType` | schema (create INPUT) `'ncaa' \| 'bigeast' \| 'big12'` (`shared/schemas/bracket.ts:40`); wizard sends `v.tournamentType \|\| 'ncaa'` (`buildBracketPayload.ts:20`); **the callable persists only `'conference' \| 'ncaa'`** plus `tournamentId` = `bigeast-{year}` / `big12-{year}` / `{gender}-{year}` (`functions/src/bracketPools.ts:54-62,83-84`); the client type matches the persisted shape (`src/types/index.ts:715`). `conferenceName` lives on the **tournament** doc (`index.ts:822`, `functions/src/conferenceTournaments.ts:155,335`), never on the pool | **Yes** (NCAA tourney vs conference tourney). Which conference is read from `tournamentId`'s prefix, not from a name field (codex r1 #1) |
| BRACKET | `gender` | `'mens' \| 'womens'` | `bracket.ts:39`; `index.ts:713,815` | **Yes** (K7) |
| BRACKET | `settings.scoringSystem` | `CLASSIC \| ESPN \| FIBONACCI \| CUSTOM \| UPSET` (schema `bracket.ts:12,22`; client type `index.ts:692` lacks `UPSET`; scorer `bracketScoring.ts:58-63`) | No — a **points schedule**, like Pick'em `payoutMode`/`pointsPerPick`: it changes how many points a correct pick earns, not what is picked or whether it is correct. Option, not play variation (codex r3 #1 → definition tightened in §8; **K13** lets Kevin overrule) |
| NFL_PLAYOFFS | `league: 'NFL'` (literal) | | `index.ts:57` | Sport only; **no variation** |
| PROPS | `gameId?`, `seasonType?` | optional NFL-schedule link | `props.ts:25,28`; `index.ts:150,153` | No play variation; sport is "NFL if linked to a game, else none" |

### 1.3 Existing type→label / type→icon mappings (the drift this plan collapses)

| Mapping | Where | Verdict |
|---|---|---|
| `TYPE_LABEL` + `poolTypeLabel()` + `poolOptionLabels()` — the newest, tested, honest-fallback ("Unknown type") | `src/utils/poolTypeLabel.ts:15-30,43-68`; test `poolTypeLabel.test.ts` | **Source of truth for label text.** Meta module wraps it, does not replace it |
| `POOL_TYPE_LABEL` (Playoffs plural, `t.replace(/_/g,' ')` fallback) | `GlobalCommissionerDashboard.tsx:14-23` | Duplicate → delete, read meta |
| Ternary `Pick'em / Survivor / Margin / 'Squares'` (wrong for Bracket/Playoff/Props — falls to "Squares") | `JoinPool.tsx:197-199` | Duplicate **and a defect** → replace |
| Ternary `Bracket Pool / Side Hustle / Playoff Challenge / 'Squares Pool'` (NFL season types fall to "Squares Pool") | `ManagerDashboard.tsx:725` | Duplicate **and a defect** → replace |
| `formatPoolMatchup` ("Weekly Pick'em", "Survivor Pool", …) | `poolSport.ts:230-251` | Subtitle helper, keep — it is a matchup line, not a type chip |
| `getPoolSport` (sport buckets for GameOps filter) | `poolSport.ts:32-39` | **Reuse** as the sport derivation seed (returns display strings; meta needs keys — §2.2) |
| `getPoolTypeName` (Squares-only, "Game Day Squares" / "Super Bowl Squares") | `poolUtils.ts:17-66` | Keep for Squares subtitle; not a type chip |
| `POOL_TYPE_LABELS` (Test Suite optgroups) | `SimpleTestingDashboard.tsx:17-25` | Admin/test wording ("Bracket (March Madness)") — K9 |
| `TYPE_LABEL` (OG preview copy) | `functions/src/joinPreview.helpers.ts:13-21` | Server HTML, unaffected |
| `HowItWorksPage` `POOL_TYPES[].icon` — Trophy/LayoutGrid/Zap/Star/Sparkles/Trophy/HelpCircle | `HowItWorksPage.tsx:25-33` | Ad-hoc glyphs, two types share Trophy, Star/Sparkles/Zap carry no meaning → read meta (K10) |
| `CreatePoolSelection` — `Grid3X3` for Squares/Props, `Trophy` for Pick'em/Survivor/Margin | `CreatePoolSelection.tsx:88,109,130,151,182` | Ad-hoc; three types share Trophy → read meta (K10) |
| Pool-home glyphs already hardcoded: Bracket `Trophy` (`BracketPoolDashboard.tsx:619`), Props `Dices` (`PropsPoolDashboard.tsx:71`), Playoff `<Tag sport="nfl">Playoff Challenge</Tag>` (`PlayoffDashboard.tsx:93-95`), Props `<Tag sport="props">Props Pool</Tag>` (`:77`) | | Call sites H2/H4/H5 |
| `Tag` — `SportType = 'nfl'\|'ncaa'\|'squares'\|'survivor'\|'margin'\|'props'` with colours + LABELS | `src/components/ui/Tag.tsx:4-26` | Design-system chip; its `SportType` mixes sports and types. **Reuse for the sport tag** (nfl/ncaa) — do not extend it into a type map |
| `PoolCard` (design-system card keyed by `Tag` sport, `HEADER_BG`) | `src/components/ui/PoolCard.tsx:6-13,31-91` | **Zero consumers outside `ui/`** (grep). Unaffected; not the card the app renders |

### 1.4 The icon library

- `lucide-react ^0.556.0` (`package.json:32`; installed `0.556.0` in the main
  checkout's `node_modules`, 3,802 glyph files). **No new dependency** — the UI
  guide forbids it (`docs/UI-REVAMP-GUIDE.md:46`, "No emoji anywhere — replace
  with Lucide monoline icons. No new icon libs").
- **Present** (verified by file in `dist/esm/icons/`): `trophy`, `grid-3x3`
  (`Grid3x3`, alias `Grid3X3` also exported), `list-checks`, `shield-check`,
  `skull`, `ruler`, `medal`, `award`, `dices`, `list-ordered`, `diff`,
  `git-fork`, `network`, `layout-grid`, `crosshair`, `target`, `scale`,
  `circle-help`, `volleyball`, `dribbble`.
- **Absent**: any American-football, basketball (other than the `dribbble`
  brand mark, which lucide deprecates), helmet, stadium, "ATS", "spread" glyph.
  **So a sport cannot be a lucide glyph** — it is a text tag (`Tag sport="nfl"`)
  or a colour ring (K4).
- Emoji: none used for pool types anywhere in `src/` (grep 🏈🏀🏆… → 0 hits).

### 1.5 Where cards and headers render (call sites — full list in the sweeps doc)

Cards: `ParticipantDashboard.tsx:781-819` (My Entries; already has the
`data-testid="pool-card-type"` chip row), `GlobalCommissionerDashboard.tsx:100-131`
(Hub `PoolRow`) + `:146-148` (type filter chips) + `:164` (group header),
`BrowsePools.tsx:350-361`, `ManagerDashboard.tsx:716-726`, `JoinPool.tsx:194-200`,
`SuperAdmin.tsx:1425,1492` (pools table "Type / Matchup") + `:3773-3781` (user's
pools cards).

Pool home headers: `NFLPoolDashboard.tsx:565-570` (Pick'em/Survivor/Margin —
one header for three types), `BracketPoolDashboard.tsx:617-621`,
`PlayoffDashboard.tsx:91-96`, `PropsPoolDashboard.tsx:69-78`,
`routes/PoolRoute.tsx:413-418` (Squares).

Test env: root vitest has **no DOM environment** (`vite.config.ts:46-53` sets
only `exclude`; no jsdom/testing-library in `package.json`), so the guard in
§5 must be a pure-module test, not a render test.

---

## 2. Goal

One module derives `{ sport, type, variations }` from a pool doc; one component
renders it at three sizes; every card surface and every Pool-home header calls
that component, so a Pick'em-ATS-confidence pool, a pick-losers Survivor pool
and a Big East bracket each look different at a glance and read the same
everywhere. Adding a pool type without adding its icon fails a test.

---

## 3. Design

### 3.1 Icon taxonomy — sport × type × variation

Sport row first (a tag, since no glyph exists), then the seven types, then
variations. Labels reuse `poolTypeLabel.ts` wording. Every glyph name below was
verified present in lucide 0.556.0 (§1.4).

**Sport (text tag via existing `Tag`; colour per `Tag.tsx:10-17`)**

| Sport key | Derived from | Tag text | Colour (existing) | `aria-label` fragment |
|---|---|---|---|---|
| `nfl` | type ∈ NFL_SEASON_TYPES ∪ {NFL_PLAYOFFS}; SQUARES with `league` nfl/absent; PROPS with `gameId` | `NFL` | `Tag sport="nfl"` navy-800 | "NFL" |
| `ncaa-fb` | SQUARES with `league` `college`/`ncaa` | `NCAA` | `Tag sport="ncaa"` gold-400 | "NCAA football" |
| `ncaa-bb` | BRACKET (all `tournamentType`s) | `NCAA` | `Tag sport="ncaa"` gold-400 | "NCAA basketball" |
| `none` | PROPS without `gameId` | *(no tag)* | — | "" |

(K4 decides whether the tag shows on every card or only where the sport is
ambiguous; K5 whether Bracket/Squares get sport-coloured type glyphs.)

**Type (lucide glyph — the constant per type)**

| `type` | Glyph | Why this one | Label (`poolTypeLabel`) | `aria-label` |
|---|---|---|---|---|
| `NFL_PICKEM` | `ListChecks` | a sheet of ticked picks; distinct from every other row | Pick'em | "Pick'em pool" |
| `NFL_SURVIVOR` | `ShieldCheck` | survive/still-standing; `Shield` alone is already the team-logo fallback (`ParticipantDashboard.tsx:797`), the check disambiguates | Survivor | "Survivor pool" |
| `NFL_MARGIN` | `Ruler` | margin of victory is a measured distance; nothing else in the app uses it | Margin | "Margin pool" |
| `SQUARES` | `Grid3x3` | already the Squares glyph on the create screen (`CreatePoolSelection.tsx:88`) | Squares | "Squares pool" |
| `BRACKET` | `Trophy` | already the Bracket glyph on its own header (`BracketPoolDashboard.tsx:619`), Browse (`:352`), How-it-works; March Madness heritage | Bracket | "Bracket pool" |
| `NFL_PLAYOFFS` | `Medal` | today it shares `Trophy` with Bracket in three places (§1.3) — that is exactly the collision Kevin is asking to end; a medal is a playoff prize without being the tournament trophy | Playoff | "Playoff pool" |
| `PROPS` | `Dices` | already the Props glyph on its own header (`PropsPoolDashboard.tsx:71`) | Props | "Props pool" |

Rejected: `GitFork`/`Network` for Bracket (reads as source control / org chart, and would break the three existing Trophy sites for no gain); `Target`/`Crosshair` for Pick'em (aim, not pick — and Crosshair reads as ATS); `Star`/`Sparkles`/`Zap` (How-it-works' current picks — decorative, carry no meaning); `Award` for Playoff (rosette; fine, `Medal` is one glyph and reads faster at 14px).

**Variation (tag, composed onto the type glyph; optional glyph swap in the last column — K3)**

| Type | Condition (from `settings`) | Tag | Long label (already in `poolOptionLabels`) | `aria-label` fragment | Optional glyph swap |
|---|---|---|---|---|---|
| NFL_PICKEM | `pickMode !== 'ATS'` | *(none — recommended default, K2)*; the long label "Straight-up" is spoken in `aria` and printed by `full` | Straight-up | "straight-up" | — |
| NFL_PICKEM | `pickMode === 'ATS'` | `ATS` | Against the spread | "against the spread" | `Diff` |
| NFL_PICKEM | `confidenceMode === true` | `CONF` | Confidence | "confidence points" | `ListOrdered` |
| NFL_PICKEM | ATS **and** confidence | `ATS` + `CONF` (two tags, fixed order) | both | "against the spread, confidence points" | `ListOrdered` wins the swap; ATS stays a tag |
| NFL_SURVIVOR | `pickLosersMode === true` | `LOSE` | Pick losers | "pick losers" | `Skull` |
| NFL_SURVIVOR | default | *(none)* (K2) | Pick winners | "pick winners" (aria only) | — |
| NFL_MARGIN | — | *(none)* | — | "" | — |
| SQUARES | `league` college/ncaa | sport tag `NCAA` carries it | — | (sport) | — |
| BRACKET | `tournamentType === 'conference'` (persisted) or `bigeast`/`big12` (create-input spelling, tolerated) | conference short name from **`tournamentId` prefix**: `bigeast-*` → `BIG EAST`, `big12-*` → `BIG 12`, any other conference id → `CONF TOURNEY` (codex r1 #1: `conferenceName` is not on the pool doc) — **never `CONF`**, which is confidence | Conference tournament | "conference tournament" | — |
| BRACKET | `gender === 'womens'` | `W` (K7) | Women's | "women's" | — |
| NFL_PLAYOFFS | — | *(none)* | — | "" | — |
| PROPS | — | *(none)* | — | "" | — |

Payout mode (`SEASON/WEEKLY/HYBRID`) is deliberately **not** a variation tag:
it is money-shape, not play-shape, and `poolOptionLabels` already prints it as
words on the My Entries card (`ParticipantDashboard.tsx:815-817`). K11 can
overrule.

### 3.2 Component design — one mapping module, one component

**`src/utils/poolTypeMeta.ts`** (pure; no React, no lucide; vitest-able)

```ts
export type PoolSportKey = 'nfl' | 'ncaa-fb' | 'ncaa-bb' | 'none';
export interface PoolVariation { tag: string; label: string; aria: string; glyph?: PoolTypeGlyphKey }
export interface PoolTypeMeta {
  type: PoolType | null;          // null ⇒ unknown, label 'Unknown type' (poolTypeLabel's rule)
  glyph: PoolTypeGlyphKey;        // 'pickem'|'survivor'|'margin'|'squares'|'bracket'|'playoff'|'props'|'unknown'
  sport: PoolSportKey;
  typeLabel: string;              // = poolTypeLabel(pool)
  variations: PoolVariation[];    // fixed order per §3.1
  ariaLabel: string;              // "Pick'em pool, NFL, against the spread, confidence points"
}
export function derivePoolTypeMeta(pool: PoolLike & { league?: string; gameId?: string; tournamentType?: string; tournamentId?: string; gender?: string }): PoolTypeMeta
export function poolOptionLabelsExcludingVariations(pool: PoolLike): string[]   // poolOptionLabels minus the strings the badge already shows as tags (codex r1 #4)
```

- **Normalises the type first**: `const type = isSquaresPoolType(pool.type) ? 'SQUARES' : pool.type`
  (`poolSport.ts:56-58`), and every downstream call — glyph, sport,
  `poolTypeLabel({ ...pool, type })`, aria — receives the normalised value. So a
  legacy squares doc without `type` gets glyph `squares` **and** label "Squares"
  (codex r3 #2: `poolTypeLabel` alone returns "Unknown type" for a missing type,
  `poolTypeLabel.ts:29`; its contract is left untouched — `null` is still unknown).
- Sport derivation reuses the branch order of `getPoolSport`
  (`poolSport.ts:32-39`) but returns keys, not display strings; `getPoolSport`
  is left alone (GameOps filter depends on its strings).
- `typeLabel` delegates to `poolTypeLabel()`; variation long labels reuse the
  strings in `poolOptionLabels()` so the card's words and the badge's tooltip
  never disagree.
- Unknown type ⇒ `glyph: 'unknown'` (`CircleHelp`), label "Unknown type" —
  the honest fallback rule from `poolTypeLabel.ts:25-27`, never a plausible
  substitute.

**`src/components/pool/PoolTypeIcon.tsx`** (the only file that imports the glyphs)

```ts
export const POOL_TYPE_GLYPH: Record<PoolTypeGlyphKey, LucideIcon> = { pickem: ListChecks, survivor: ShieldCheck, margin: Ruler, squares: Grid3x3, bracket: Trophy, playoff: Medal, props: Dices, unknown: CircleHelp };
export const VARIATION_GLYPH: Partial<Record<string, LucideIcon>> = { ATS: Diff, CONF: ListOrdered, LOSE: Skull };  // used only if K3 = swap

<PoolTypeIcon pool={pool} size="sm"|"md"|"lg" variant="glyph"|"badge"|"full" showSport? />
```

| Variant | Renders | Where |
|---|---|---|
| `glyph` | glyph only, wrapper `role="img" aria-label={meta.ariaLabel} title={…}` — the aria sentence carries sport + variations, so nothing is lost to a screen reader, but sighted users see only the type | **only** the two avatar tiles (Browse `:352`, Manage `:716`) that sit *beside* a `badge`, the Hub type-filter chips (S2c) and the Hub type-group header (`:164`) — places where the type is the whole message. Table cells (S6/S8) use `badge`, not `glyph` (codex r3 #3) |
| `badge` | glyph + `typeLabel` + variation tags **+ the sport `Tag`** (sport is on by default per K4; `showSport={false}` opts out) in one chip row — the existing My Entries chip style, `ParticipantDashboard.tsx:814` | **every card and list row** (S1–S5, S7). Codex r1 #2/#3: this is the variant that satisfies K1 ("always visible") and K4 ("every card"); `glyph` alone never satisfies either |
| `full` | `badge` + variation long labels as muted text (sport tag omitted only when `meta.sport === 'none'`) | **every Pool-home header** (H1–H5) |

Sizes: `sm` 14px glyph / 10px tags (cards), `md` 18px (Hub rows, table),
`lg` 24px (Pool-home `h1` row). Tags use the existing chip classes
(`font-display font-bold uppercase text-[10px] tracking-[0.06em] rounded-full
border border-line`) so they match the Hub filter chips.

Colour: none by type in v1 (K5). The glyph inherits `currentColor` from the
card text token; the sport `Tag` keeps its own navy/gold styling. Colour is
never the only carrier — the tag text is always present in `badge`/`full`, and
`glyph` carries `aria-label`.

### 3.3 Accessibility, dark mode, sizes

- Glyphs are `aria-hidden="true"` whenever a text label sits beside them
  (`badge`, `full`); in `glyph` variant the wrapper carries `role="img"` and
  the full `aria-label` (type, sport, variations) — screen readers get the same
  sentence a sighted user reconstructs.
- **Every abbreviation tag is expanded for assistive tech** (codex r2 #3):
  each tag renders as `<abbr title={label} className="no-underline">` wrapping
  `<span aria-hidden="true">ATS</span><span className="sr-only">Against the spread</span>`
  — sighted users see `ATS`, screen readers hear "Against the spread", hover
  shows the title. Tailwind's `sr-only` is already in use (`WizardStepBasics.tsx:45`).
  This applies to `badge` and `full`, so the aria sentence is complete in every
  variant, not only in `glyph`.
- `title` on the wrapper gives the hover tooltip. Variation tags are **visible**
  in every variant that shows tags — this is the recommendation in K1 and the
  single acceptance criterion the tests encode (§3.5 test 3); K1/K2 can change
  the expected arrays before T1, not after.
- All classes var-backed per the UI guide (`bg-card`, `border-line`,
  `text-muted`, `text-[color:var(--text)]`) — no hardcoded slate; the `Tag`
  already ships dark variants (`Tag.tsx:6-8`).
- Contrast: tags are text on `bg-card` at the existing chip sizes already in
  production on My Entries; no new colour pairs are introduced in v1.
- No emoji anywhere (UI guide line 46). `npx tsc -b` must pass (guide "Verify").

### 3.4 Call sites to change (exact; full grep in the sweeps doc)

| # | Site | Today | Change |
|---|---|---|---|
| S1 | `src/components/ParticipantDashboard.tsx:781-783, 813-818` | text chip `{typeLabel}` + `optionLabels` spans, `data-testid="pool-card-type"` | `<PoolTypeIcon variant="badge" size="sm">` replaces the chip; the option spans render `poolOptionLabelsExcludingVariations()` so "Against the spread"/"Confidence"/"Pick losers" are not printed twice beside `ATS`/`CONF`/`LOSE` (codex r1 #4); payout/strikes/rebuys words stay; keep the testid |
| S2 | `src/components/Dashboards/GlobalCommissionerDashboard.tsx:14-23` | local `POOL_TYPE_LABEL` | delete; `typeLabel = t => poolTypeLabel({type:t})` |
| S2b | same, `:100-131` `PoolRow` | name + players/dues, no type | add `badge` (`sm`) under the name (rows are already grouped by type at `:164`, so the group header gets the `glyph`; the row still needs the badge because variations differ within a group) |
| S2c | same, `:146-148` filter chips | text | prefix each chip with the glyph (`sm`) — a filter is by type, so glyph-only is correct here |
| S3 | `src/components/BrowsePools.tsx:352, 359` | avatar = `Trophy` if bracket else 2-letter initials; subtitle "March Madness Bracket" / `getPoolTypeName` | avatar = `glyph` (`md`) for every type **and** subtitle line = `badge` (`sm`); Squares keeps `getPoolTypeName` text after the badge |
| S4 | `src/components/ManagerDashboard.tsx:716-725` | initials avatar; ternary label that calls NFL season pools "Squares Pool" | avatar = `glyph`; label line = `badge` |
| S5 | `src/components/JoinPool.tsx:194-200` | `Trophy` + ternary that calls Bracket/Playoff/Props "Squares" | `full` variant, `md` |
| S6 | `src/components/SuperAdmin.tsx:1425, 1492` (pools table) and `:3773-3781` (user's pools) | "Type / Matchup" cell = `formatPoolMatchup` | table cell **and** user's-pools card: `badge` (`sm`, `showSport={false}` — the table already has a sport filter) above the matchup line. No hand-assembled "glyph + tags" (codex r3 #3: only the three variants exist; the guard checks `variant="badge"` here) — **K8** |
| S7 | `src/components/PricingPage.tsx:279` (pricing calculator's pool selector) | `Format: {pool.type.toLowerCase().replace('_',' ')}` — raw enum, and `replace` without `/g` leaves `nfl pickem`→ fine but `NFL_PLAYOFFS`→`nfl playoffs` only by luck of one underscore | `badge` (`sm`) — commissioner-facing list, so in scope (codex r1 #6) |
| S8 | `src/components/admin/SuperAdminBillingPanel.tsx:1578` (billing pools table `<td>{pool.type}</td>`; `:427` search-by-type stays) | raw enum | `badge` (`sm`, `showSport={false}`) — **K8** (codex r1 #6; r3 #3 removed the hand-assembled "glyph + typeLabel"). `admin/monetization/UserMoneyProfile.tsx` was also named by codex but renders no pool type (grep: `type` appears only in its import line) — rejected |
| H1 | `src/components/NFLPoolDashboard/NFLPoolDashboard.tsx:565-570` | logo + `h1` name; Host line | `full` (`lg`) between logo and `h1`; the Host `<p>` gains nothing (variation long labels ride in `full`) |
| H2 | `src/components/BracketPoolDashboard/BracketPoolDashboard.tsx:617-621` | hardcoded `<Trophy className="text-gold-500" size={24}/>` | replace with `full` (`lg`) — same glyph, now from the map, plus `NCAA` tag and conference/gender tags |
| H3 | `src/components/routes/PoolRoute.tsx:413-418` (Squares) | logo + `h1` | `full` (`lg`) before `h1` |
| H4 | `src/components/PlayoffPool/PlayoffDashboard.tsx:91-96` | `<Tag sport="nfl">Playoff Challenge</Tag>` | replace the `Tag` with `full` (`md`) — keeps the NFL tag, adds `Medal` |
| H5 | `src/components/PropsPoolDashboard/PropsPoolDashboard.tsx:69-78` | `Dices` fallback avatar + `<Tag sport="props">Props Pool</Tag>` | avatar reads `POOL_TYPE_GLYPH.props`; replace `Tag` with `full` (`md`) like every other Pool home — the sport tag appears only when the Props pool is linked to a game (`meta.sport !== 'none'`) (codex r1 #5) |
| X1 | `src/components/HowItWorksPage.tsx:25-33`, `src/components/CreatePoolSelection.tsx:88,109,130,151,182` | ad-hoc glyphs, Trophy ×3; How-it-works keys by marketing ids (`brackets`, `squares`, `survivor`, `pickem`, `margin`, `playoffs`, `props`), not `PoolType` | each site gets an explicit local alias map marketing-id → `PoolTypeGlyphKey` (`brackets→bracket`, `playoffs→playoff`, `pickem→pickem`, …) and reads `POOL_TYPE_GLYPH[key]`; CreatePoolSelection has no ids at all (one hardcoded card per type), so it imports the glyph by key directly. Not a "read the map by `pool.type`" — there is no pool doc on these pages (codex r1 #7). **K10** |

Squares Pool-home (`H3`) already carries a "Fully Auditable" `Shield` button on
the same row (`PoolRoute.tsx:419-420`) — the Squares glyph is `Grid3x3`, so no
visual collision.

### 3.5 Tests (root vitest, pure modules — no DOM available, §1.5)

`src/utils/poolTypeMeta.test.ts`:
1. **Exhaustiveness guard** — for every `t` of `POOL_TYPES` (`@shared/poolTypes`),
   `derivePoolTypeMeta({type:t}).glyph !== 'unknown'`, and the pure module's
   exported `POOL_TYPE_GLYPH_KEYS` (as-const array of `PoolTypeGlyphKey`) covers
   one key per type + `unknown`. The React side's
   `POOL_TYPE_GLYPH: Record<PoolTypeGlyphKey, LucideIcon>` is exhaustive **at
   compile time** (`Record` over the union — `npx tsc -b` fails on a missing or
   extra key), so the test never imports React or lucide (codex r2 #5; the
   round-1 "import the component map, with a fallback" wording is withdrawn).
2. Glyphs are **pairwise distinct** across the seven types (this is the test
   that would have caught Bracket/Playoff sharing `Trophy`).
3. Pick'em 2×2, written to the §6 **recommendations** as the single acceptance
   criterion (codex r2 #4 — if Kevin overrules K1/K2 the expected arrays change
   in T1, not the test's shape): `{}` → `[]`; `{pickMode:'ATS'}` → `[ATS]`;
   `{confidenceMode:true}` → `[CONF]`; both → `[ATS,CONF]` in that order.
   Every tag object carries `{tag:'ATS', label:'Against the spread', aria:'against the spread'}`.
4. Survivor `{pickLosersMode:true}` → `[LOSE]`; default → `[]`.
5. Legacy squares doc `{}` (no `type`) → glyph `squares`, **`typeLabel: 'Squares'`**, sport `nfl`, aria "Squares pool, NFL"; `{league:'college'}` → `ncaa-fb`. `derivePoolTypeMeta(null)` → unknown (matches `poolTypeLabel(null)`).
6. Bracket as **persisted** `{tournamentType:'conference', tournamentId:'bigeast-2026'}` → tag `BIG EAST`, sport `ncaa-bb`; `{tournamentType:'conference', tournamentId:'acc-2026'}` → `CONF TOURNEY`; create-input spelling `{tournamentType:'big12'}` (no id) → `BIG 12`; `{tournamentType:'ncaa', gender:'womens'}` → `[W]`, no conference tag.
7. `{type:'SOMETHING_NEW'}` → glyph `unknown`, label "Unknown type", aria says unknown.
8. `ariaLabel` composition for the ATS+CONF Pick'em case reads exactly
   "Pick'em pool, NFL, against the spread, confidence points".
9. `poolOptionLabelsExcludingVariations({type:'NFL_PICKEM', settings:{pickMode:'ATS', confidenceMode:true, payoutMode:'HYBRID'}})` → `['Hybrid (weekly + season)']` only; Survivor `{pickLosersMode:true, maxStrikes:1}` → `['1 strike']`. Extend `poolTypeLabel.test.ts` only if wording moves (it should not).
10. **Call-site guard** (codex r1 #9 / r2 #1 — a card can otherwise silently bypass the component, and there is no DOM to render-test): a pure test reads each file in a fixed table `{ file, expects: Record<variant, minCount> }` (e.g. `GlobalCommissionerDashboard.tsx: { badge: 1, glyph: 2 }`, `BrowsePools.tsx: { glyph: 1, badge: 1 }`, `ManagerDashboard.tsx: { glyph: 1, badge: 1 }`, `SuperAdmin.tsx: { badge: 2 }`, `ParticipantDashboard.tsx: { badge: 1 }`, each H-file `{ full: 1 }`) as text and asserts **at least that many `<PoolTypeIcon` JSX uses with `variant="<v>"`** per variant per file (an import alone does not count — r2 #1; one matching use in a multi-use file does not count either — r4 #1), and that `ParticipantDashboard.tsx` still contains `data-testid="pool-card-type"`. Brittle by design — it fails loudly when a surface is rewritten without the badge, which is the point. Precedent: `tests/docs-state-invariants.test.ts:193,354` greps repo files the same way (CLAUDE.md §2c). Sites gated on K8/K10 enter the table only if Kevin says yes.

Also required by the repo: `npx tsc -b`, `npm run lint`, `npx vitest run`
green; codex round on the diff; qodo on the PR (CLAUDE.md §2b/§2c).

---

## 4. Risks

- **Bracket `tournamentType` create-input vs persisted spelling**
  (`'bigeast'|'big12'` in, `'conference'` + `tournamentId` out, §1.2) — the meta
  reads both spellings and derives the conference from `tournamentId`'s prefix;
  a conference whose id prefix is unknown gets the generic `CONF TOURNEY` tag,
  never a guessed name. Reconciling the schema is out of scope.
- **`src/utils/featureFlags.ts:10-18` is a second copy of `POOL_TYPES`** on the
  client (codex r1 #8, r2 #2). Measured: it is a deliberate **mirror** of
  `functions/src/lib/featureFlags.ts` (header comment `:1-7`) and its drift is
  already guarded by CI — `tests/feature-flags-parity.test.ts:9-10` asserts the
  client and server `POOL_TYPES` sort-equal. So there are two guarded copies
  (shared ↔ this plan's exhaustiveness test; client-flags ↔ server-flags parity
  test), not an unguarded drift path. Re-pointing the flag mirror at
  `@shared/poolTypes` is a separate one-line PR that must keep the parity test
  green; it is not this plan's work.
- **Legacy squares docs without `type`** — covered by `isSquaresPoolType`;
  test 5 guards it.
- **Two labels for the same thing** if `poolTypeLabel.ts` and the meta module
  ever diverge — mitigated by delegation (meta calls `poolTypeLabel`, does not
  copy `TYPE_LABEL`).
- **`Tag`'s `SportType` mixes sports and types** (`Tag.tsx:4`) — the meta uses
  only its `nfl`/`ncaa` members; do not add `ncaa-bb` to `Tag` (design system
  chip is by colour family, not by sport). If K5 says "sport colours on
  Bracket", that is a `Tag` styling question, not a new member.
- **Card density on mobile** — `badge` at `sm` adds ~14px + tags to a chip row
  that already wraps (`flex-wrap`, `ParticipantDashboard.tsx:813`); K1 (tags on
  hover) is the relief valve.
- **UI-guide "visual refactor only"** — the JoinPool (`:197`) and
  ManagerDashboard (`:725`) ternaries are *wrong* today (§1.3); replacing them
  changes copy, which the guide's "never change copy" rule frowns on. It is a
  bug fix, stated as such in the PR body.

## 5. Out of scope

- Any schema change (no `sport` field, no `tournamentType` reconciliation).
- `functions/` — OG-preview labels stay (`joinPreview.helpers.ts:13-21`).
- `ui/PoolCard.tsx` — unused outside `ui/`; leave it.
- Payout-mode / strikes / rebuys as icons — remain words (`poolOptionLabels`).
- Per-sport colour system beyond the existing `Tag` palette (K5 may reopen).
- Wizard step icons, Header nav icons, marketing pages other than X1.

---

## 6. 🛑 DECISIONS NEEDED FROM KEVIN — no code until these are answered

| # | Question | Recommendation |
|---|---|---|
| **K1** | Variation tags (`ATS`/`CONF`/`LOSE`) on `sm` cards: **always visible**, or tooltip/`aria` only until hover? | **Always visible.** "At a glance" was the ask; hover does not exist on phones. |
| **K2** | Show a tag for the **default** variation (Pick'em `SU`, Survivor default) or only for the non-default (`ATS`, `LOSE`)? | **Non-default only** on cards; the Pool-home `full` variant spells the long label ("Straight-up") in text. Fewer chips, and the default is the common case. |
| **K3** | Is the variation carried by the **tag** (type glyph constant) or by a **glyph swap** (`Skull` for pick-losers, `ListOrdered` for confidence, `Diff` for ATS)? | **Tag.** The type glyph stays constant so Survivor is always the shield; swaps are kept in `VARIATION_GLYPH` for a later opt-in. |
| **K4** | Sport tag (`NFL`/`NCAA`) on **every** card, or only where the sport is ambiguous for the type (Squares) and on Pool home? | **Every card, `sm`**, since Kevin asked for sport as a first-class axis — and Squares/Bracket cannot express it otherwise. |
| **K5** | Colour-code type glyphs per sport (navy for NFL, gold for NCAA, as `Tag`/`PoolCard.HEADER_BG` already do)? Or monochrome (`currentColor`)? | **Monochrome v1.** Colour rides on the sport `Tag`; the glyph inherits card text. Revisit after the shapes are seen in prod. |
| **K6** | Squares: surface `seasonType`/`week` naming ("Super Bowl Squares") or `numberSets` (1 vs 4) as tags? | **No** — those stay in `getPoolTypeName` subtitle text; not play variations. |
| **K7** | Bracket `gender: 'womens'` gets a `W` tag? | **Yes** — it is a different tournament; one letter. |
| **K8** | Super-Admin pools table (`SuperAdmin.tsx:1425,1492`), the per-user pools cards (`:3773`) and the billing pools table (`SuperAdminBillingPanel.tsx:1578`) get the badge? | **Yes — `badge` `sm` with `showSport={false}`** on all three (S6/S8): variations matter operationally ("which of these is the ATS pool"), and both tables already carry a sport filter/column so the sport tag would repeat. (Reworded after codex r4 #2 — an earlier draft said "glyph only", which contradicted S6/S8.) |
| **K9** | Test Suite `POOL_TYPE_LABELS` (`SimpleTestingDashboard.tsx:17-25`) — collapse into `poolTypeLabel` too? | **No** — admin/test wording ("Bracket (March Madness)") is deliberately longer; leave. |
| **K10** | `HowItWorksPage` and `CreatePoolSelection` (X1) read `POOL_TYPE_GLYPH` in the same PR? | **Yes** — three types share `Trophy` there today; one import each, and consistency was the point. |
| **K11** | Payout mode (`WEEKLY`/`SEASON`/`HYBRID`) as a tag? | **No** — money-shape, already words on the card. |
| **K12** | Icon size on the Pool-home `h1` row: `lg` (24px) inline before the name, or a 40px avatar tile like Props' `Dices` tile (`PropsPoolDashboard.tsx:70-72`)? | **`lg` inline** — the NFL and Squares headers already stack a logo + `h1`; a second tile crowds it. |
| **K13** | Bracket `settings.scoringSystem` (`CLASSIC/ESPN/FIBONACCI/CUSTOM/UPSET`, `shared/schemas/bracket.ts:12`) as a tag (`UPSET`, `FIB`)? Codex r3 argued it "changes how a pick is judged". | **No** — it is a points schedule (how much a correct pick is worth), not what is picked or whether it is correct; same class as payout mode and Pick'em `pointsPerPick`. §8's Play Variation definition was tightened to say so. If Kevin wants it, it is one row in the variation table + one test, `UPSET` → `UPSET`, others → no tag. |

---

## 7. Implementation tickets (after §6 is signed)

- **T1** `src/utils/poolTypeMeta.ts` + `poolTypeMeta.test.ts` (tests 1–8, exhaustiveness guard). Pure module; no UI.
- **T2** `src/components/pool/PoolTypeIcon.tsx` (`POOL_TYPE_GLYPH`, `VARIATION_GLYPH`, three variants, three sizes, a11y per §3.3). `npx tsc -b`.
- **T3** Cards S1–S5 (+ S6 if K8). Delete the three duplicate label maps/ternaries (§1.3). Keep `data-testid="pool-card-type"`.
- **T4** Pool-home headers H1–H5.
- **T5** X1 if K10. Docs: CONTEXT.md glossary (§8), `docs/UI-REVAMP-GUIDE.md` component-library line gains `PoolTypeIcon`.

Each ticket independently shippable; T1+T2 can be one PR, T3+T4 the second.
Gates per CLAUDE.md §2b/§2c on each.

## 8. Proposed CONTEXT.md glossary additions (NOT applied — Kevin signs first)

```
### Pool Type Icon
The one glyph-plus-tags badge that identifies a Pool's sport, type and play
variation on every card and on the Pool Homepage. Derived from the Pool
document alone (`type`, `settings`, `league`, `tournamentType`, `gender`) by a
single module (`derivePoolTypeMeta`); every surface renders the same component,
so two Pools with the same rules always look the same. The sport is a text tag
(NFL / NCAA) because the icon set has no sport glyphs; the type is a lucide
glyph, one per `POOL_TYPES` value and never shared between two types; a
variation is a short tag (ATS, CONF, LOSE, BIG EAST, W). An unknown type is
shown as unknown, never dressed as a plausible type.

### Play Variation
A setting that changes what a Member submits, or whether a submitted pick
counts as correct — Pick'em straight-up vs against the spread (correctness is
judged against the line) and confidence points (the Member submits a ranking),
Survivor pick-winners vs pick-losers (the win condition inverts), Bracket NCAA
vs conference tournament and men's vs women's (a different field of teams).
Distinct from an Option, which changes the stakes, the schedule, or how many
points a correct pick is worth but not the pick itself or its correctness —
strikes, rebuys, payout mode, lock mode, Bracket scoring system
(CLASSIC/ESPN/FIBONACCI/CUSTOM/UPSET), Pick'em points-per-pick. Only Play
Variations earn a tag on the Pool Type Icon; Options stay words.
```

## 9. What this plan does NOT do

Change any schema, any server code, any label wording that ships today, or any
money/authorization/scoring path. It is a client visual contract plus one
pure derivation module and its test.

## Gate status

- [x] Act 1 — self-interview grill; measured against `42906ecc`
- [x] Sweeps doc written (`PLAN-POOL-TYPE-ICONS-SWEEPS.md`)
- [x] Act 2 — 4 Codex rounds run (cap); 19 findings, 16 absorbed, 2 rejected with evidence, 1 → K13. **Round 4 was REVISE (2 small findings), absorbed after the round and not re-reviewed** — see review log Resolution. Not labelled CONVERGED.
- [ ] §6 signed by Kevin (K1–K13)
- [ ] Code (T1–T5), each PR through codex + qodo + CI

---

## § Board memo (2026-08-16)

Simulated advisory board (`ask-the-board`, 6 seats + Chair, unanimous, medium confidence): **do not open T1 now** — ship the two §1.3 mislabels (`JoinPool.tsx:197`, `ManagerDashboard.tsx:725`) as ordinary one-file fixes this week, no taxonomy; ICONS is the plan the board would build FIRST if a trigger fires and no hand-over request has appeared (it is the only one of the three that deletes code, and the lowest-maintenance). §6 rows the board would overturn: **K8** → No in v1 (Theo, Ras Mic — adds render sites without deleting anything); K10 → No in v1 (Theo alone); K4 → not before the mislabels ship (Cuban alone); K1 → defer until members demonstrably confuse variants (Kapoor alone). All other rows left standing. Full memo: [BOARD-MEMO-2026-08-16-transfer-icons-help.md](docs/archive/BOARD-MEMO-2026-08-16-transfer-icons-help.md). Simulation, not approval — Kevin decides.
