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
