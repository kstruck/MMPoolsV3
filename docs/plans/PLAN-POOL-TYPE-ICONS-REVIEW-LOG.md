# Plan Review Log: PLAN-POOL-TYPE-ICONS

Act 1 (self-interview grill; Kevin not in the room) complete — plan written
(`PLAN-POOL-TYPE-ICONS.md`), sweeps written (`PLAN-POOL-TYPE-ICONS-SWEEPS.md`),
CONTEXT.md additions **proposed in plan §8, not applied**. MAX_ROUNDS=4 for this
plan (caller's cap; paid runs — stop on the first APPROVED). PLAN_FILE=PLAN-POOL-TYPE-ICONS.md.
Runner: `codex exec -s read-only` (codex-cli 0.144.5), fresh session per round,
`</dev/null` on stdin (memory: backgrounded/resumed codex hangs here).

## Round 1 — Codex (fresh session, output `plan-icons-round1.txt`)
VERDICT: REVISE. 9 findings; 8 absorbed (one of them partially), 1 rejected in
part. Summary (severity assigned by Claude — codex did not tag):

1. (High) Conference brackets cannot be labelled `BIG EAST`/`BIG 12` from a
   `conferenceName` field — the callable persists only `tournamentType:
   'conference'` and `tournamentId`, and `conferenceName` is not on the pool
   doc. Fix: derive from `tournamentId`.
2. (High) K4 "sport on every card" is not implemented by the call sites — most
   use `glyph`/`badge`, only `full` carries the sport tag.
3. (High) Several list rows use `glyph` only, so ATS/CONF/LOSE are invisible
   despite K1 "always visible".
4. (Medium) S1 prints rule information twice: the badge's tags and the existing
   `poolOptionLabels()` spans ("Against the spread", "Confidence", "Pick losers").
5. (Medium) H5 (Props Pool home) says `badge`, not `full` — contradicts the
   Pool-home contract.
6. (Medium) Sweep misses listings that display raw/derived types:
   `SuperAdminBillingPanel.tsx`, `PricingPage.tsx`, `admin/monetization/UserMoneyProfile.tsx`.
7. (Medium) X1 is underspecified: `HowItWorksPage` keys by marketing ids
   (`brackets`, `playoffs`), not `PoolType`, so it cannot "read `POOL_TYPE_GLYPH`" directly.
8. (Low) A duplicate client `POOL_TYPES` in `src/utils/featureFlags.ts` and the
   type literals X1 needs undermine "no hardcoded type mappings".
9. (Medium) Tests verify metadata but not that the required surfaces render it;
   a future card can silently bypass the component.

### Claude's response
1. **ABSORBED.** Verified: `functions/src/bracketPools.ts:54-62,83-84` persists
   `tournamentType: isConference ? 'conference' : 'ncaa'` and `tournamentId` =
   `bigeast-{y}`/`big12-{y}`/`{gender}-{y}`; `conferenceName` appears only on
   tournament docs (`conferenceTournaments.ts:155,335`, `TournamentManager.tsx:150-151`,
   `src/types/index.ts:822` is the Tournament type). My §1.2 row said the client
   type "disagrees with the schema" — wrong framing; the schema is the create
   INPUT, the client type is the persisted shape. Plan §1.2, §3.1 variation table,
   §3.2 signature (`tournamentId` in, `conferenceName` out), §3.5 test 6 and §4
   rewritten; sweeps S1b gained the `bracketPools.ts` row. Unknown conference
   prefix → generic `CONF TOURNEY`, never a guessed name.
2. **ABSORBED.** `badge` now includes the sport `Tag` by default (`showSport={false}`
   opts out); `full` = `badge` + long labels. §3.2 variant table rewritten.
3. **ABSORBED.** `glyph` is now restricted to the two avatar tiles that sit beside
   a `badge` (S3, S4), the type filter chips (S2c — a filter is by type), and
   dense table cells (S6/S8, K8). S2b Hub row → `badge`. §3.4 rewritten.
4. **ABSORBED.** New pure helper `poolOptionLabelsExcludingVariations()` in the
   meta module; S1 renders that instead of `poolOptionLabels()`; test 9 added.
5. **ABSORBED.** H5 → `full`, sport tag omitted only when `meta.sport === 'none'`
   (Props not linked to a game).
6. **ABSORBED for two of three, REJECTED for the third.** Verified
   `PricingPage.tsx:279` (`Format: {pool.type.toLowerCase().replace('_',' ')}` —
   commissioner-facing calculator list) → new **S7**; `SuperAdminBillingPanel.tsx:1578`
   (`<td>{pool.type}</td>`) → new **S8** under K8. `UserMoneyProfile.tsx`:
   `grep -n "type"` finds only its `import type` line — it renders no pool type;
   rejected and recorded in sweeps S2.
7. **ABSORBED.** X1 now specifies an explicit marketing-id → `PoolTypeGlyphKey`
   alias map for HowItWorks and direct glyph-key imports for CreatePoolSelection
   (which has no ids at all — one hardcoded card per type).
8. **ABSORBED as a stated risk, not as work.** `featureFlags.ts:10-18` is the
   feature-flag registry with its own consumer (`SuperAdmin.tsx:3075`); collapsing
   it onto `@shared/poolTypes` is a one-line follow-up PR outside this plan's
   scope. The exhaustiveness guard iterates the shared array, so a type added to
   one copy only fails a test. Recorded in §4. X1's per-page literals are the
   alias maps from #7 — presentation-only, documented as such.
9. **ABSORBED.** Root vitest has no DOM (`vite.config.ts:46-53`, no jsdom /
   testing-library in `package.json`), so a render test is not available. Added
   test 10: a pure call-site guard that reads each S/H file as text and asserts
   the `PoolTypeIcon` import (+ the My Entries `data-testid`). Precedent:
   `tests/docs-state-invariants.test.ts:193,354` greps repo files the same way.

Plan text after round 1: §1.2 (bracket row), §3.1 (bracket variation row),
§3.2 (signature, variant table), §3.4 (S1, S2b, S2c, S3, S4, S6, S7, S8, H5, X1),
§3.5 (tests 6, 9, 10), §4 (two risks). Sweeps: S1b (+3 rows), S2 (+3 rows).

## Round 2 — Codex (fresh session, output `plan-icons-round2.txt`)
VERDICT: REVISE. Confirmed round-1 #1–#7 landed, #8 recorded as a risk only, #9
partially addressed. 5 new findings; 4 absorbed, 1 rejected with evidence.

1. (Medium) The call-site test accepts an unused `PoolTypeIcon` import — a
   surface can still bypass the component. Fix: assert a `<PoolTypeIcon` use with
   the required variant per site.
2. (Low) The duplicate `src/utils/featureFlags.ts` enum remains a real drift path;
   its type can be extended without the shared taxonomy test failing. Fix: derive
   it from `@shared/poolTypes`.
3. (High) `badge` tags expose unexplained abbreviations (`ATS`, `CONF`, `LOSE`) to
   screen readers; only glyph-only mode gets a complete label. Fix: accessible
   expanded name per abbreviation.
4. (Medium) K1/K2 unresolved while the plan simultaneously specifies visible tags,
   tooltip-only tags, and tests accepting `SU` or no tag. Fix: one default as the
   sole acceptance criterion.
5. (Medium) The "pure" metadata test imports a React/lucide component with a
   fallback "if it fails". Fix: keep glyph keys in the pure module and test key
   parity there; let the component map keys to icons.

### Claude's response
1. **ABSORBED.** §3.5 test 10 now asserts a `<PoolTypeIcon` JSX use with
   `variant="<required>"` per file from a `{file, variant}` table; an import
   alone does not pass.
2. **REJECTED (evidence).** `src/utils/featureFlags.ts:1-7` declares itself a
   mirror of `functions/src/lib/featureFlags.ts`, and
   `tests/feature-flags-parity.test.ts:9-10` already fails CI when the client
   and server `POOL_TYPES` diverge. Both copies are therefore guarded (shared ↔
   this plan's exhaustiveness test; client-flags ↔ server-flags parity). Deriving
   the mirror from `@shared/poolTypes` is a separate one-line PR that must keep the
   parity test green; §4 risk row rewritten to say exactly this. Not this plan's
   work, and codex's "can be extended without a test failing" is false as stated.
3. **ABSORBED.** §3.3: every tag renders `<abbr title>` wrapping an
   `aria-hidden` short form + an `sr-only` long form (Tailwind `sr-only` already
   used at `WizardStepBasics.tsx:45`), so `badge`/`full` are complete for
   assistive tech, not only `glyph`.
4. **ABSORBED.** §3.1 Pick'em/Survivor default rows, §3.3 and §3.5 test 3 now
   encode the §6 recommendations (tags always visible; no tag for the default
   variation) as the single acceptance criterion; K1/K2 may change the expected
   arrays before T1 — the tests' shape does not depend on the answer.
5. **ABSORBED.** §3.5 test 1: the pure module exports `POOL_TYPE_GLYPH_KEYS`;
   parity is tested there, and the React `Record<PoolTypeGlyphKey, LucideIcon>`
   is exhaustive at compile time (`npx tsc -b`). The UNVERIFIED lucide-import
   fallback wording is withdrawn.

Plan text after round 2: §3.1 (two default rows), §3.3 (abbr/sr-only; visible
tags as the criterion), §3.5 (tests 1, 3, 10), §4 (featureFlags row).

## Round 3 — Codex (fresh session, output `plan-icons-round3.txt`)
VERDICT: REVISE. Confirmed all round-2 fixes present. 3 new findings; 2 absorbed,
1 absorbed as a decision row + definition fix (not as a tag).

1. (Medium) Bracket `settings.scoringSystem` (`CLASSIC/ESPN/FIBONACCI/CUSTOM/UPSET`)
   is persisted and changes scoring, which meets the plan's own "how a pick is
   judged" definition of a Play Variation. Fix: add scoring tags/tests/default.
2. (High) Legacy Squares (missing `type`) would get the Squares glyph but
   `poolTypeLabel()` returns "Unknown type" for a missing type — icon and label
   contradict. Fix: normalise to `SQUARES` before deriving label/aria; test it.
3. (Medium) S6/S8 specify "glyph + tags" / "glyph + typeLabel", which no variant
   renders; hand-assembly defeats the single-component contract and the guard
   only checks `glyph`. Fix: pick a supported variant or add one.

### Claude's response
1. **ABSORBED as K13 + a tightened definition, REJECTED as a tag.** Verified
   `bracket.ts:12,22`, `index.ts:692` (client type lacks `UPSET`),
   `bracketScoring.ts:58-63`. Codex is right that my §8 wording "how a pick is
   judged" would admit it — that wording was loose. Tightened: a Play Variation
   changes what is submitted or whether a pick is correct; scoring system changes
   how much a correct pick is worth (a points schedule, same class as `payoutMode`
   and `pointsPerPick`). Added §1.2 row and **K13** with the recommendation "no";
   if Kevin says yes it is one table row + one test.
2. **ABSORBED.** Verified `poolTypeLabel.ts:29` returns "Unknown type" for a
   falsy type. §3.2 now normalises `type` via `isSquaresPoolType` before every
   downstream call (glyph, sport, `poolTypeLabel({...pool, type})`, aria); test 5
   asserts `typeLabel: 'Squares'`; `poolTypeLabel`'s own contract (`null` →
   unknown) is untouched.
3. **ABSORBED.** S6 and S8 → `badge` (`sm`, `showSport={false}`); the `glyph`
   row of the variant table no longer lists table cells; the call-site guard
   checks `variant="badge"` there. No new variant.

Plan text after round 3: §1.2 (+scoringSystem row), §3.2 (normalisation, variant
table `glyph` row), §3.4 (S6, S8), §3.5 (test 5), §6 (+K13), §8 (Play Variation).

## Round 4 — Codex (fresh session, output `plan-icons-round4.txt`) — last budgeted round
VERDICT: REVISE. Confirmed all round-3 fixes landed. 2 new findings, both absorbed
AFTER the round (so this text has not been re-reviewed by codex).

1. (Medium) The call-site guard is `{ file, variant }`, so it cannot prove all
   uses in multi-use files (S2 needs `badge` + two `glyph` sites, S3/S4 `glyph` +
   `badge`, `SuperAdmin.tsx` two `badge` sites). Fix: per-file/per-variant
   expected counts.
2. (Medium) K8 still recommends "`glyph` sm only" while S6/S8 (after r3) require
   `badge` with the sport suppressed — the plan is internally non-executable
   until reconciled. Fix: reword K8.

### Claude's response
1. **ABSORBED.** §3.5 test 10 now keys the table as
   `{ file, expects: Record<variant, minCount> }` with the per-file counts spelled
   out (`GlobalCommissionerDashboard { badge:1, glyph:2 }`, `BrowsePools`/`ManagerDashboard
   { glyph:1, badge:1 }`, `SuperAdmin { badge:2 }`, H-files `{ full:1 }`) and asserts
   at-least-N uses per variant.
2. **ABSORBED.** K8 reworded to recommend `badge sm showSport={false}` on all
   three admin surfaces (S6/S8), with the reason (both tables already carry a
   sport filter/column). My miss — S6/S8 were changed in r3 and K8 was not.

## Resolution — STOPPED WITH FINDINGS ABSORBED BUT UNREVIEWED (cap of 4 reached)
4 rounds, 19 findings total: 16 absorbed, 1 rejected with evidence (r2 #2,
featureFlags parity), 1 rejected in part (r1 #6, `UserMoneyProfile.tsx`), 1
converted to a Kevin decision + definition fix (r3 #1, K13). Trajectory:
9 → 5 → 3 → 2 findings; core flaws (persisted bracket shape, variant/decision
contradictions, a11y of abbreviations) in rounds 1–2, consistency nits in rounds
3–4. Round 4 did not come back clean, so per CLAUDE.md §2c this is **not** labelled
CONVERGED: the two round-4 absorptions are small (a test-table shape and a K8
reword) but codex has not seen them. If Kevin wants a clean round before signing
§6, one more paid round on the current text is the honest way to get it; the
plan carries no open counter-positions.
