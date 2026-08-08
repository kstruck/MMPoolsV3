# PLAN: Survivor parity — tie outcome setting + team-reuse setting

**Status:** DRAFT — awaiting adversarial review (codex) + Kevin sign-off.
**Classification:** Plan-gated — SCORING trigger (changes how a winner is decided). Not money, not authz, not prod-data.
**Branch:** `claude/survivor-parity-scoring` off `origin/main` @ `62ff437`.
**Origin:** Competitor feature review (usafootballpools.com, 2026-08-07). These are the two survivor knobs they offer that we hard-code.

## Goal

Two new commissioner settings on `NFL_SURVIVOR` pools, both defaulting to today's exact behavior so every existing pool is untouched with no migration:

1. **`settings.tieCountsAs: 'WIN' | 'LOSS'`** (default `'LOSS'`). Today a tie is unconditionally a strike in both standard and pick-losers mode. Under `'WIN'`, the picked team's tie is treated as that team winning.
2. **`settings.maxTeamUses: number`** (default `1`; `0` = unlimited). Today each team is pickable exactly once per season. Under `N ≥ 2`, a team may be picked in up to N distinct weeks; `0` removes the restriction.

## Approach — three phases, each independently shippable, one PR total

### Phase 1 — engine + schema + types (the scoring change)

- `shared/schemas/nfl.ts` `survivorCreateInputSchema.settings`: add `tieCountsAs: z.enum(['WIN','LOSS']).optional()`, `maxTeamUses: z.number().int().min(0).optional()`.
- Mirror in `src/types/nflPoolTypes.ts` `NFLSurvivorPool.settings` AND `functions/src/nflPoolTypes.ts` (kept in sync by hand — ADR 0005 comment at `weeklyResults`). Both fields are declared **optional in both interfaces** — `tieCountsAs?: 'WIN' | 'LOSS'`, `maxTeamUses?: number` — with defaults applied at read sites only (codex r2 #4); existing pool docs never carry them.
- `functions/src/nflScoringEngine.ts` `evaluateSurvivorWeek` (~line 300): fold the tie **before** the mode branch —
  ```ts
  if (teamTied) {
    if ((pool.settings.tieCountsAs ?? 'LOSS') === 'WIN') { teamWon = true; } else { teamLost = true; }
    teamTied = false;
  }
  ```
  so `pickLosersMode` semantics compose without a second matrix: tie-as-WIN in losers mode = your team "won" = strike, which matches the competitor's framing ("ties count as a win **for the picked team**").
- `maxTeamUses` touches no scoring math — elimination logic is per-week and never re-derives reuse. `checkAutoSurviveExemption` is the one engine consumer of reuse state, and it splits by setting (codex r1 #2 — legacy-entry safety):
  - `maxTeamUses` absent or `1`: authority stays `usedTeams`, **byte-for-byte today's code path** — legacy entries whose seeded `usedTeams` diverges from `picks` keep identical outcomes.
  - `maxTeamUses ≥ 2`: eligibility is `countTeamUses(picks, week)[t] < maxTeamUses`.
  - `maxTeamUses = 0` (unlimited): the exemption can NEVER fire — every playing team stays eligible, and an all-cancelled slate has `teamsPlaying.size === 0` so it cannot fire there either; void-week survival is `isVoidWeek`'s job (codex r1 #6). Pinned by test.
- `shared/simOracle.ts:96-117` independently hard-codes tie=strike in both modes and feeds `settingsMatrix.emulator.test.ts` survivor expectations (codex r1 #5): extend the oracle with `tieCountsAs` — kept independent of the engine, that independence is the point of an oracle — plus tie fixtures in both modes and settings-matrix rows for the new fields.
- **`computeWeekFingerprint` (`functions/src/lib/autoScoreDecisions.ts:188-193`) must hash both new fields** as normalized effective values (codex r6 #1): its contract (`:143`) is that every scoring-relevant setting affects the fingerprint; omitting them means an allowed pre-publication settings change never triggers a rescore. Fingerprint-difference tests included.
- One canonical helper `countTeamUses(picks, excludeWeek)` (codex r1 #7): iterates `Object.entries(picks)`, validates numeric week keys, excludes `String(excludeWeek)` — Firestore keys are strings while types say `Record<number, string>`; the helper is the single normalization boundary. Used by submit guard, proxyPick guard, exemption, and client gating.
- Tests: extend the existing engine suites (per mmp-validation-and-qa — no new suite, no coverage claims): tie×{LOSS,WIN}×{standard,losers}, defaults-absent = current behavior byte-for-byte, `computeSurvivorWeekUpdate` idempotency under both settings, auto-survive exemption with `maxTeamUses` 0/1/2.

### Phase 2 — submit guard + client pick entry

- **The tri-mode split governs EVERY reuse decision point** (codex r4 #1 — not just the exemption/write): at `maxTeamUses` absent/`1`, the submit guard, proxy guard, client gating, exemption, and `usedTeams` write are today's `usedTeams`-authority code **byte-for-byte** — an entry whose legacy `usedTeams` diverges from `picks` behaves identically on a default pool. `countTeamUses` is consulted only when `maxTeamUses ≠ 1`. Regression tests where `usedTeams` and `picks` disagree, for absent and explicit `1`.
- `functions/src/nflPools.ts` `submitNFLPicks` survivor branch (~line 570), when `maxTeamUses ≠ 1`: reject when `maxTeamUses > 0 && countTeamUses(picks, week)[team] >= maxTeamUses`. Error text gains the limit ("You have already picked the {team} {N} times"). Re-submit-own-pick stays safe (PR #384): the current week is excluded by construction.
- **`usedTeams` write splits by setting** (codex r2 #2 — the remove-current-then-re-add Set rewrite assumes single-use; under reuse, KC picked weeks 1+2 then week 1 changed to BUF would strip KC entirely):
  - `maxTeamUses` absent/`1`: today's rewrite, byte-for-byte.
  - `maxTeamUses ≠ 1`: build `nextPicks` (picks with the current week's pick replaced) and derive `usedTeams = Set(values(nextPicks))` — identically in submit and proxy. Duplicate-then-replace regression test on both paths.
- **`countTeamUses(picks, excludeWeek)` contract** (codex r2 #3; grammar r3 #3; dedupe r4 #2): first build `Map<weekNumber, team>` — a key participates only if it matches `/^\d+$/` AND `Number(key)` is in 1–23 (the `submitNFLPicksSchema` week range); on a spelling collision for the same logical week the canonical `String(week)` spelling wins, else first seen. Then count map entries with `week !== excludeWeek` whose team matches — **one use per logical week by construction**. Pinned by test: `"1"`, numeric access, `"01"` → week 1 (excluded when `excludeWeek` is 1); `"1"`+`"01"` same team = 1 use, different teams = collision rule; `"1.5"`, `"2junk"`, `" 1"`, `"1e0"` → skipped.
- **Client gating uses the same helper with the same exclusion** (codex r3 #4): eligibility from `countTeamUses(entry.picks, week)` — current week excluded, so an already-selected team at its limit stays re-submittable, matching the callable. The inclusive count feeds only the "N/N used" badge.
- **`SurvivorPickEntry.tsx:293-295` rules copy is wrong TODAY** (codex r3 #1 — it tells members ties survive in both modes; the engine strikes ties): rewrite the copy derived from `tieCountsAs × pickLosersMode`, all four combinations covered by test. Pre-existing prod defect fixed in passing; called out in the PR body.
- **Margin twin guard (~line 641) is explicitly NOT changed** — margin pools keep one-use-per-team. Named here so the sweep can prove the twin was considered, not missed.
- **`proxyPick` (`functions/src/poolExceptions.ts:~409-421`) carries a THIRD reuse guard** (found by sweep S1, missed by this plan's first draft): the commissioner proxy path does its own `usedTeams.includes` check and rewrite. Both guards move to one shared helper `countTeamUses(picks, excludeWeek)` — one definition, same reasoning as the PR #384 fix quoted in the submit path.
- `src/components/NFLPoolDashboard/SurvivorPickEntry.tsx` `usedTeams` memo: becomes a per-team use-count; a team disables at `count >= maxTeamUses` (with `0` = never disable). UI copy on the disabled chip shows uses ("2/2 used").
- Client gating stays advisory; the callable is the enforcement point (standing invariant: "Server-side flag/lifecycle checks are authoritative; UI checks are UX only").
- Tests: guard parity between `submitNFLPicks` and `proxyPick` (same team, same limit, both accept/reject identically), re-submit-own-current-week under reuse limits, string-vs-number week-key normalization through `countTeamUses`.

### Phase 3 — wizard + manager settings surface

- `CreateNFLSurvivorPool.tsx` `StepSurvivorRules`: select for tie outcome (default "Tie counts as loss"), number field for team-use limit (default 1, hint "0 = unlimited").
- `NFLManagerView.tsx` Settings tab: same two controls alongside `maxStrikes`/`pickLosersMode`, following the existing pre-season-editable pattern.
- **Rules/docs surfaces render effective settings** (codex r4 #3): `NFLPoolRules.tsx:224` currently states a team can never be selected twice — must render the pool's actual reuse limit (incl. unlimited) and tie outcome; `docs/NFL_POOLS_README.md:12,30,52-59` asserts tie=strike + single-use — update to document the settings and defaults.
- `functions/src/schemas/poolCore.ts` `updatePoolSettingsSchema`: sweep S3 — `updates` is `z.record(z.string(), z.unknown())`, permissive, no schema change. But permissive means UNVALIDATED (codex r1 #3): `functions/src/lib/poolUpdate.ts` (`flattenSettingsPatch`/`buildPoolSettingsUpdate`) must normalize/validate both fields server-side — `tieCountsAs ∈ {WIN,LOSS}`, `maxTeamUses` integer ≥ 0, invalid values REJECTED (a negative `maxTeamUses` must not slide through as "unlimited" under a `> 0` check). Conversely `survivorCreateInputSchema` is a `z.object` that STRIPS unknown keys, so the Phase 1 schema addition is mandatory, not cosmetic — without it the wizard silently drops both fields at create.

## Key decisions & tradeoffs

1. **Defaults preserve semantics with NO migration.** `tieCountsAs` absent ⇒ `'LOSS'`; `maxTeamUses` absent ⇒ `1`. Every read site uses `?? fallback`. Zero writes to existing pool docs.
2. **Tie folded into won/lost pre-mode-branch** rather than a 2×2 settings matrix in each mode arm — one branch, composes with `pickLosersMode`, and the losers-mode meaning is derivable instead of specified case-by-case.
3. **Guard authority moves to the `picks` map; `usedTeams` demoted to derived data.** A Set cannot represent "picked twice". Rewriting `usedTeams` as a multiset/array-with-dupes would change its meaning for every consumer at once; counting `picks` changes only the guard. `usedTeams` remains correct as "the set of teams ever picked" for display.
4. **Mid-season setting flips are a real retroactivity hazard — for BOTH fields** (codex r1 #4): `computeSurvivorWeekUpdate` recomputes past weeks with *current* settings, so flipping `tieCountsAs` after a tied week rewrites history on rescore, and changing `maxTeamUses` can add/remove auto-survive exemptions with the same effect. UI-only gating is insufficient — the callable stays reachable and super-admin bypasses the UI. **Plan of record (codex r2 #1, promoted from recommendation): server-side rejection is a required Phase 3 deliverable**, implemented in the `updatePoolSettings` write path inside a transaction that reads the pool doc (the current callable writes after a non-transactional read — `poolOps.ts:400-466` — and `flattenSettingsPatch` sees only `set`+`poolType`, so the check lives in the callable, not the flattener). "Scored" := any **true** marker in `publishedWeeks` OR `legacyPublishedWeeks(pool).length > 0` — the helper (`functions/src/lib/publishedWeeks.ts:34,50`) already folds in true `scoredWeeks` and the legacy `scoredThroughWeek` high-water mark; `false` markers mean UNSCORED and must not trip the gate (codex r5 #1). `scoredWeeks` is withheld on provisional passes (`nflPools.ts:1455-1464`), so `publishedWeeks` covers the provisional window; lifecycle status is NOT a proxy (a pool can hold scored survivor outcomes while lifecycle-open — `editability.ts:28-44`). Reject only a **value change** to either field, and evaluate each field **only when that property is present in the incoming settings patch** (codex r5 #2 — `flattenSettingsPatch` applies present keys only, so a partial `{maxStrikes: 2}` save on a scored `tieCountsAs:'WIN'` pool must not be rejected over an omitted field). When present, compare **effective normalized values** — `current ?? default` vs `incoming ?? default` — so a scored legacy pool saving UI defaults is not rejected over `undefined → 'LOSS'` (codex r3 #2). Tests: race, provisional-score, legacy-defaults-save, partial-unrelated-save on a scored non-default pool. Kevin may veto in favor of per-week snapshotting (question 1).
5. **`0 = unlimited`** rather than a separate boolean — one field, and the wizard hint carries the convention. (Open question 2 if review objects.)

## Risks / open questions

1. **OPEN — Kevin veto point:** decision 4's plan of record is server-side once-scored rejection of changes to `tieCountsAs`/`maxTeamUses` (details in decision 4). Alternative if vetoed: snapshot values per scored week (more code; allows forward-only mid-season flips). Codex r1+r2 both judged anything weaker insufficient; concur.
2. Any client-side duplicate of survivor evaluation (What-If simulator, sim harness scenario runners) asserting tie=strike or single-use — the sweep enumerates and updates them.
3. Rebuy interaction: rebuys retain `usedTeams` ([nflPools.ts](functions/src/nflPools.ts) "retain previously used teams") and count `picks` regardless — reuse counting is unaffected by rebuy. Test pins this.
4. `weekLockOverrides`-style stringified week keys: `picks` is `Record<number, string>` but Firestore keys are strings — the count must compare loosely or normalize keys (known repo pattern, see poolExceptions `String(weekNum)` fallback).

## Out of scope

- Margin-pool reuse setting; Pick'em anything.
- Server-side season-gating of settings edits OTHER than the two new fields (the once-scored rejection in decision 4 covers `tieCountsAs`/`maxTeamUses` only; extending it to `maxStrikes`/`pickLosersMode` is a follow-up, not this PR).
- The competitor's default-auto-pick, playoff extension, multi-entry (separate tasks #2–#5 + backlog).
- Any prod data write — this ships settings that only future pool docs carry.

## Sweep obligations (PLAN-SURVIVOR-PARITY-SCORING-SWEEPS.md before implementation)

- S1: every reader of `usedTeams` (grep `usedTeams` across `src/ functions/ shared/`) — table: site / role (guard, display, exemption, sim) / change required.
- S2: every site encoding tie semantics (grep `teamTied|tie|Tied` in engine + sims + tests + docs/articles).
- S3: every settings validator/allowlist that must admit the two new fields (`survivorCreateInputSchema`, `updatePoolSettingsSchema`, `buildNFLPayload`, any permissive-create schema).
- S4: every client copy of survivor evaluation logic (grep `evaluateSurvivorWeek|strikesUsed` in `src/`).

## Implementation status

| Item | Status |
|---|---|
| Plan drafted | ✅ 2026-08-07 |
| Codex adversarial review (log: PLAN-SURVIVOR-PARITY-SCORING-REVIEW-LOG.md) | PENDING |
| Sweeps | PENDING |
| Kevin sign-off (open question 1) | PENDING |
| Phase 1–3 implementation | PENDING |
