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
