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
