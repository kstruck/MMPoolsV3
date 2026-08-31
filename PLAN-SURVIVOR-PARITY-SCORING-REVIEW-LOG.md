# REVIEW LOG — PLAN-SURVIVOR-PARITY-SCORING

Reviewer: codex (codex-cli, `codex exec`, read-only sandbox). Cap: judgement up to 10 rounds (CLAUDE.md §2c).

## Round 1 — codex

VERDICT: REVISE. 7 findings (4×P1, 2×P2, 1×P3). All accepted.

1. **(P1) proxyPick would still enforce one-use-only.** `poolExceptions.ts:387-421` has its own `usedTeams.includes` guard; plan draft claimed only `checkAutoSurviveExemption` consumes `usedTeams`.
   **Response: accepted — independently found by sweep S1 minutes before this verdict landed; plan Phase 2 already updated** to route both guards through one `countTeamUses(picks, excludeWeek)` helper. Parity tests (normal + proxy submission, re-submit current week) added to Phase 2 test list.
2. **(P1) "existing pools untouched" fails for legacy entries whose `usedTeams` diverges from `picks`.** Exemption authority today is `usedTeams`; moving it to counted `picks` changes outcomes for entries with seeded/legacy `usedTeams` history (e.g. `nfl-survivor-autosurvive.json:26`) even with both settings absent.
   **Response: accepted.** At `maxTeamUses` absent/1, `checkAutoSurviveExemption` keeps `usedTeams` as its authority byte-for-byte. Counted-picks eligibility applies only when `maxTeamUses ≠ 1`. Plan decision 3 amended.
3. **(P1) No server-side validation of the new fields on the UPDATE path.** `updatePoolSettingsSchema.updates` is `z.record(unknown)` and `flattenSettingsPatch` forwards arbitrary settings; a negative `maxTeamUses` would act as unlimited.
   **Response: accepted.** Phase 3 gains: normalize/validate both fields in `functions/src/lib/poolUpdate.ts` (`flattenSettingsPatch`/`buildPoolSettingsUpdate`) — `tieCountsAs ∈ {WIN,LOSS}`, `maxTeamUses` int ≥ 0; invalid → reject, not coerce-to-unlimited.
4. **(P1) Retroactivity hazard covers `maxTeamUses` too, and UI-only gating is insufficient** (callable remains reachable; super-admin bypasses UI).
   **Response: accepted.** Decision 4 rewritten to cover both fields; recommendation to Kevin upgraded from UI-gating to server-side rejection of changes to either field once the pool has any scored week. Remains OPEN — Kevin decides.
5. **(P2) `shared/simOracle.ts:96-117` independently hard-codes tie=strike in both modes** and `settingsMatrix.emulator.test.ts` uses it for survivor expectations — sweep S2 called "exactly one site" and was wrong.
   **Response: accepted.** S2 corrected. Phase 1 gains: extend the oracle with `tieCountsAs` (kept independent of the engine), add tie fixtures both modes, extend the settings matrix.
6. **(P2) Plan's unlimited-reuse exemption claim factually wrong** — with `maxTeamUses: 0` the exemption can NEVER fire (all playing teams stay eligible; all-cancelled slate has `teamsPlaying.size === 0`); void-week survival is `isVoidWeek`'s job.
   **Response: accepted.** Plan wording corrected; test pinning "maxTeamUses 0 ⇒ exemption never granted" added.
7. **(P3) Week-key handling needs one canonical helper, not "loose comparison".** `picks` typed `Record<number,string>` but Firestore keys are strings; proxy already handles both.
   **Response: accepted.** `countTeamUses` iterates `Object.entries(picks)`, validates numeric week keys, excludes `String(currentWeek)`; used by submit, proxy, exemption, and client. Types documented at the normalization boundary (no type migration in this PR).

Plan and sweeps updated. Proceeding to round 2.

## Round 2 — codex

VERDICT: REVISE. Confirmed all 7 round-1 fixes landed. 4 new findings (1×P1, 2×P2, 1×P3). All accepted.

1. **(P1) Once-scored rejection unresolved and named at the wrong seam.** `flattenSettingsPatch` receives only `set`+`poolType`; the callable writes after a non-transactional read (`poolOps.ts:400-466`); survivor outcomes can exist in `entries/*/weeklyResults` while the pool is lifecycle-open.
   **Response: accepted.** Server-side rejection promoted from recommendation to **plan of record** (Phase 3 deliverable): implemented in the `updatePoolSettings` write path inside a transaction reading the pool doc; "scored" := `publishedWeeks` ∪ `scoredWeeks` non-empty (`scoredWeeks` is withheld on provisional passes — `nflPools.ts:1455-1464` — so `publishedWeeks` covers provisional); reject only a **value change** to either field. Race + provisional tests added. Kevin's open question 1 becomes a veto (accept plan of record, or switch to per-week snapshotting) rather than a design blocker.
2. **(P2) `usedTeams` Set rewrite breaks under reuse.** Remove-current-then-re-add assumes single-use: KC in weeks 1+2, change week 1 → BUF strips KC despite the week-2 pick.
   **Response: accepted.** When `maxTeamUses ≠ 1`: build `nextPicks` (picks with current week replaced) and derive `usedTeams = new Set(values(nextPicks))` — identical in submit and proxy. Absent/1 keeps today's rewrite byte-for-byte (legacy authority per r1 #2). Duplicate-then-replace regression test on both paths.
3. **(P2) Week-key contract not actually normalized** — `"01"` counted instead of excluded for week 1; self-resubmit would consume a use.
   **Response: accepted.** `countTeamUses` contract: parse integer keys, validate NFL week range (1–23 per `submitNFLPicksSchema`), compare NUMERIC value to `excludeWeek`, skip malformed keys. Tests: `"1"`, numeric access, `"01"`, decimal, nonnumeric.
4. **(P3) Optionality not explicit in the mirrored interfaces.**
   **Response: accepted.** Plan now names `tieCountsAs?: 'WIN' | 'LOSS'` and `maxTeamUses?: number` as optional in BOTH `src/types/nflPoolTypes.ts` and `functions/src/nflPoolTypes.ts`; defaults live at read sites only.

Plan updated. Proceeding to round 3.

## Round 3 — codex

VERDICT: REVISE. Confirmed all 4 round-2 fixes landed. 4 new findings (3×P2, 1×P3). All accepted. Finding severity is falling (4×P1 → 0×P1).

1. **(P2) Sweep S2 missed a live client rules copy** — `SurvivorPickEntry.tsx:293-295` tells members ties SURVIVE in both modes. **That copy is wrong against today's engine already** (tie = strike), and wrong for half the new setting matrix.
   **Response: accepted.** Added to S2 and Phase 2: copy derived from `tieCountsAs × pickLosersMode`, all four combinations tested. Noted as a pre-existing prod defect this PR fixes in passing.
2. **(P2) "Same-value write passes" undefined for absent legacy fields** — NFLManagerView submits a complete settings object, so a scored legacy pool saving UI defaults would show `undefined → 'LOSS'` and be rejected.
   **Response: accepted.** The transaction compares **effective normalized values** (`current ?? default` vs `incoming ?? default`). Test: scored legacy pool saves defaults alongside an unrelated change — passes.
3. **(P2) Integer-parse contract too loose** — `parseInt`-style parsing accepts `"1.5"`→1, `"2junk"`→2, contradicting "skip malformed".
   **Response: accepted.** Exact grammar: key matches `/^\d+$/`, then `Number(key)` in 1–23, compare numerically. Test table: `"01"` (=1, excluded for week 1), `"1.5"`/`"2junk"`/whitespace/`"1e0"` (all skipped), `"1"` and numeric access (counted/excluded).
4. **(P3) Client gating must preserve current-week exclusion** — counting ALL picks would disable an already-selected team at its limit though the callable permits re-submit.
   **Response: accepted.** Client eligibility uses `countTeamUses(entry.picks, week)` (current week excluded, matching server); inclusive count only for the "N/N used" badge.

Plan and sweeps updated. Proceeding to round 4.

## Round 4 — codex

(Operational note: the first round-4 run was chained after a git commit in one background command and hung for 3.5h with no output; killed, re-run standalone foreground, completed in minutes. Codex runs are standalone from here on.)

VERDICT: REVISE. Round-3 fixes confirmed. 3 new findings (1×P1, 2×P2). All accepted.

1. **(P1) Legacy-divergence protection must extend to ALL guards, not just the exemption.** The plan moved submit/proxy/client eligibility unconditionally to `picks` counting while keeping `usedTeams` authority only for the exemption at absent/1 — inconsistent, and an entry whose `usedTeams` diverges from `picks` would change submit behavior on a default pool.
   **Response: accepted.** The tri-mode split now governs EVERY reuse decision point: at `maxTeamUses` absent/`1`, submit guard, proxy guard, client gating, exemption, and the `usedTeams` write are all today's `usedTeams`-authority code byte-for-byte; `countTeamUses` is consulted only when `maxTeamUses ≠ 1`. Regression tests where `usedTeams` and `picks` disagree, for absent and explicit `1`.
2. **(P2) Duplicate logical weeks (`"1"` + `"01"`) would consume two uses.** Entry iteration counts spellings, not weeks.
   **Response: accepted.** `countTeamUses` builds a `Map<weekNumber, team>` first (canonical spelling `String(week)` wins a collision; otherwise first seen), then counts map entries — one use per logical week by construction. Test `"1"`+`"01"` same team (1 use) and different teams (collision rule pinned).
3. **(P2) Docs/rules surfaces missed by sweeps:** `docs/NFL_POOLS_README.md:12,30,52-59` asserts tie=strike + single-use; `NFLPoolRules.tsx:224` says a team can never be selected twice.
   **Response: accepted.** Both added to S1/S2 and Phase 3: Rules page renders effective settings (tie outcome, reuse limit incl. unlimited); README documents the new settings and their defaults.

Plan and sweeps updated. Proceeding to round 5.

## Round 5 — codex

VERDICT: REVISE. Round-4 fixes confirmed. 3 new findings (2×P1, 1×P2). All accepted.

1. **(P1) Once-scored gate misses legacy scoring evidence and treats `false` markers as scored.** Legacy pools carry `scoredThroughWeek` (`publishedWeeks.ts:34,50`); marker maps can hold `false` = unscored (`rescoreQueue.test.ts:145`).
   **Response: accepted.** "Scored" := any **true** `publishedWeeks` marker OR `legacyPublishedWeeks(pool).length > 0` (covers true `scoredWeeks` + legacy `scoredThroughWeek`). Legacy-high-water and false-marker tests added.
2. **(P1) Effective-value comparison undefined for PARTIAL settings updates.** `flattenSettingsPatch` applies only present keys; a scored pool with `tieCountsAs:'WIN'` saving `{settings:{maxStrikes:2}}` would falsely compare omitted `tieCountsAs` as `'LOSS'` and reject an unrelated save.
   **Response: accepted.** The gate evaluates each new field **only when that property is present in the incoming patch**; then compares normalized effective values. Partial-unrelated-save test on a scored non-default pool.
3. **(P2) More copy/comment surfaces asserting tie=strike or never-reuse:** `HowItWorksPage.tsx:98-104`, `simOracle.ts:14-18` contract comments (both mirrors), `NFL_POOLS_README.md:104`, `nflScoringEngine.ts:27` header, `CreatePoolSelection.tsx:133` marketing copy.
   **Response: accepted.** All added to S2 as default-vs-configurable copy updates; marketing copy qualified as "default rule".

Plan and sweeps updated. Proceeding to round 6.

## Round 6 — codex

VERDICT: REVISE. Round-5 fixes confirmed. 2 new findings (1×P1, 1×P2). All accepted.

1. **(P1) Auto-score week fingerprint omits both new settings.** `computeWeekFingerprint` (`autoScoreDecisions.ts:188-193`) hashes every scoring-relevant survivor setting by contract (`:143`); without the two new fields, an allowed pre-publication settings change would never trigger a rescore — skipped forever by the auto-scorer.
   **Response: accepted.** Phase 1 gains: add normalized effective values of `tieCountsAs`/`maxTeamUses` to the fingerprint + fingerprint-difference tests.
2. **(P2) `LandingPage.tsx:444` advertises unconditional "Used team lockouts".**
   **Response: accepted.** Added to S2; copy describes default one-use or configurable limits.

Plan and sweeps updated. Proceeding to round 7.

## Round 7 — codex

VERDICT: REVISE. Round-6 fixes confirmed. 2 new findings (1×P1, 1×P2). All accepted.

1. **(P1) Settings gate can race a MANUAL scoring pass.** `updatePoolSettings` serializes only lock-affecting settings (`poolOps.ts:449`, `poolUpdate.ts:98`); the manual scorer re-reads after acquiring its lease (`nflPools.ts:986`), so a concurrent edit committing between that re-read and publication yields results published under settings they weren't computed with. Fingerprint recovery only rescues the scheduled scorer.
   **Response: accepted.** Changes to either field route through the `retryWhileScoring` transaction pattern: re-read pool in-transaction, reject on a live scoring lease, do the once-scored check there, then write. Interleaving test against `scoreNFLWeekInternal` specifically.
2. **(P2) Lowering `maxTeamUses` pre-publication can strand entries over the new limit** (unlimited/2 → 1 after an entry picked KC twice) with no later write to catch it.
   **Response: accepted.** Transition rule: a reduction to a positive limit is REJECTED when any entry's canonical `countTeamUses(picks)` exceeds it, validated by reading entries inside the same settings transaction. Tests: `0→1`, `2→1` (rejected when violated), increases always permitted.

Plan updated. Proceeding to round 8.

## Round 8 — codex

VERDICT: REVISE. Round-7 fixes confirmed ("correctly closes the race"). 1 new finding (P1). Accepted, narrowed.

1. **(P1) Once-scored gate bypassable by super-admin direct Firestore writes.** `firestore.rules:242-245` grants `isSuperAdmin()` pool updates that skip `nflSettingsWriteBlocked()` — a SA client write can flip either field post-scoring, the exact hazard the gate prevents.
   **Response: accepted, scope narrowed.** Codex proposed denying SA the whole NFL-settings write surface; this plan takes the two-field version: a rules check denying ANY client write (SA included) whose `diff().affectedKeys()` touches `settings.tieCountsAs` or `settings.maxTeamUses` — privileged edits route through the gated callable; Admin-SDK/console operational writes are documented as carrying the same invariant (rules cannot bind the Admin SDK). Emulator rules test: SA direct update of either field is DENIED. Narrowing rationale: a blanket SA lockout of NFL settings would change the SA repair surface for every other field, which is out of this plan's blast radius; the two-field deny closes the actual bypass. Deploy ordering note: callable (functions) deploys BEFORE the rules change — Rule 2.

Plan updated. Proceeding to round 9.

## Round 9 — codex

VERDICT: REVISE. Round-8 intentions confirmed present. 1 new finding (P1) — in the fix itself. Accepted.

1. **(P1) The proposed rule cannot detect nested fields as written.** Root `diff().affectedKeys()` reports only top-level `settings` — the repo documents exactly this at `firestore.rules:138` and `poolUpdate.ts:127` — so the round-8 deny would never fire and the SA bypass would stay open.
   **Response: accepted, with codex's mechanism verbatim:** nested map diff — `request.resource.data.get('settings', {}).diff(resource.data.get('settings', {})).affectedKeys()` contains bare `tieCountsAs`/`maxTeamUses` → deny, applied OUTSIDE the super-admin disjunction. Emulator coverage: dotted update, wholesale `settings` replacement, field deletion, and an unrelated SA settings update that remains ALLOWED.

Plan updated. Proceeding to round 10 (the cap).

## Round 10 — codex (cap)

VERDICT: REVISE. Round-9 fix confirmed ("correctly addresses" the diff limitation and SA disjunction). 1 new finding (P2). Accepted.

1. **(P2) Phase 2's client bullet contradicted the tri-mode guarantee** — it unconditionally replaced the client memo with pick-derived counts while line 40 promised absent/`1` stays `usedTeams`-authority byte-for-byte.
   **Response: accepted.** Client bullet now carries the identical tri-mode branch as the server guards; regression coverage for divergent `usedTeams`/`picks` at absent and explicit `1`.

## Resolution status

**CONVERGED (cap reached, not deadlocked).** 10 rounds, 28 findings total, 100% accepted, zero disputes. Severity trajectory: r1 4×P1 → r10 1×P2 (a plan-text consistency fix, not a design hole). Every round from r5 on confirmed the prior round's fixes had landed before finding new material. No open findings. The plan now awaits the Rule-3 step-5 gate: **Kevin's sign-off**, including open question 1 (once-scored rejection as plan of record vs per-week snapshotting).
