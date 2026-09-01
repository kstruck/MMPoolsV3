# MORNING 2026-08-17 — takeover: THE PAYMENT LEDGER (PLAN-WEEKLY-PRIZES steps 1/2/4/5 + PLAN-PAYMENT-LEDGER T3/T4/T5) — six stacked PRs + one docs PR

> **SUPERSEDES `MORNING-2026-08-17.md`** (the multi-entry T2 takeover — #450 is merged AND deployed; that doc is history). This is the live one.

Overnight 2026-08-16 (session started from `origin/main` @ `42906ecc`, post-#450).
Nothing merged, nothing deployed, no prod data touched. Every PR is stacked on
the one before it, so **the merge order is fixed** and GitHub retargets each
PR to `main` as its base merges. **Merge nothing until you have read §3.**

## 1. What is waiting for you (merge in THIS order)

| # | PR | Branch | What | Deploy surface | codex | qodo |
|---|---|---|---|---|---|---|
| 1 | https://github.com/kstruck/MMPoolsV3/pull/451 | `claude/weekly-prizes` | WEEKLY-PRIZES review log (r1–9 reconstructed + **r10 live, REVISE, absorbed into plan §9**) + sweeps S1–S11; `shared/prizeSplit.ts` + `shared/prizePot.ts`; PayoutsPanel on the shared maths | Coolify | 3 rounds (r3 clean) | 1 bug absorbed, style rejected — verdict comment on PR |
| 2 | https://github.com/kstruck/MMPoolsV3/pull/452 | `claude/weekly-prizes-step2` | B1: `MNF_FIRST_GAME`, `MNF_COMBINED` unpickable, Monday-less fallback, **frozen per-pool-week tiebreak target + `displayedTiebreakTargetIds` handshake** (`TIEBREAK_TARGET_STALE`) | **functions (LIVE scorer) → rules → Coolify** | 4 rounds (r4 clean) | 3 bugs absorbed (empty freeze state, create-payload strip, docs), 1 rejected — verdict comment |
| 3 | https://github.com/kstruck/MMPoolsV3/pull/453 | `claude/weekly-prizes-step4` | scorer publishes **`weeklyPlaces`** (full entry-keyed ranking) + **frozen `weeklyPrize`** (or `null` = unpriced) on `weekly_recaps/week_N`; fail-closed `weeklyPlacesError`; `pool.weeksInSeason` set-once | **functions (LIVE scorer) → rules → Coolify** | 5 rounds (r3 clean; r5's only finding = "no UI yet", rejected as scope — it is #454) | 1 bug absorbed, docs absorbed, style rejected — verdict comment |
| 4 | https://github.com/kstruck/MMPoolsV3/pull/454 | `claude/weekly-prizes-step5` | **Weekly Winners List** on the recap card (Place / Player / Score / Tie Break Diff / Prize) | Coolify | 5 rounds (r5 clean) | 3 bugs absorbed, 1 rejected — verdict comment |
| 5 | https://github.com/kstruck/MMPoolsV3/pull/455 | `claude/payment-ledger-t4` | **T4**: `recordPoolPayouts` weekly PLACE awards bound to the recap (deterministic id, idempotent, re-record by supersession, reversal), per-award gating; **new callable `setPayoutSettled`**; `payoutRecords` composite index | **functions → indexes → Coolify** | 8 rounds (r5, r7, r8 clean) | 3 bugs (2 absorbed, 1 rejected as cross-cutting), rule absorbed, style rejected — verdict comment |
| 6 | https://github.com/kstruck/MMPoolsV3/pull/456 | `claude/payment-ledger-t5` | **T5: THE LEDGER** — `PaymentLedgerNFL` on the NFL manager view: fee status per member + every published weekly prize with a **Paid ☐**; STALE → Re-record / Reverse | **rules → Coolify** | **10 rounds = the cap** (r7 clean; r8/r9 post-qodo absorbed; r10 rejected with evidence — a co-commissioner is a member by construction) | 1 bug + 2 display findings absorbed, 2 rejected — verdict comment |
| docs | https://github.com/kstruck/MMPoolsV3/pull/457 | `claude/plans-transfer-icons-help` | PLAN-COMMISSIONER-TRANSFER / PLAN-POOL-TYPE-ICONS / PLAN-HELP-SYSTEM (unsigned) + logs + sweeps + **board memo** | none | plans reviewed 6/4/5 rounds each | not run (docs) |
| docs | this file + HANDOFF top box | `claude/handoff-ledger-2026-08-17` | — | none | — | — |

Older open docs PR unchanged: #448 (co-commissioners fully live).

## 2. What you get when all six are merged and deployed (30-second version)

- New Pick'em pools default to **last-Monday-game** tiebreaker; commissioners can pick **first Monday game**; legacy pools keep playing exactly what they stored (absent ⇒ combined). On a Monday-less week the last/first rules use the week's final game. **The tiebreak target is frozen per pool-week on the first submission** — a flex/postponement cannot re-point a prediction; a sheet rendered before a schedule change is refused (`TIEBREAK_TARGET_STALE`) until reload.
- Every complete scoring pass publishes the **full ranking + frozen weekly prize** on the recap; the recap card shows the **Weekly Winners List** (public — K10, stated on the page).
- The NFL manager view has the **Payment Ledger**: per member — entry fee + Paid/Unpaid (from the Member Record); per (entry, week) — the published prize with a **Paid checkbox** that RECORDS a settled Payout Record (idempotent, safe to double-click); un-tick flips it; after a rescore STALE lines Re-record (or Reverse to $0). Nothing is recorded until you tick it (K3). Season prizes still go through the Record Payouts card after finalization.
- Your HYBRID pool: prices from `hybridSplit.weeklyPerEntry × entries ÷ weeksInSeason` (net of charity) with your `payouts.places` applied to the weekly pot (T1/T2 `weeklyPayouts` — a separate weekly place list — is NOT built yet; absent ⇒ one list for both pots, today's behaviour).

## 3. Decisions / deviations you should know before merging

1. **PLAN-WEEKLY-PRIZES round 10 hit the §2c cap.** Its 10 findings were absorbed into a NEW plan §9 (entryId keys, full ranking, `entryCount`, `weeklyPayouts ?? payouts`, fail-closed, the handshake). §9 has NOT been codex-reviewed as text (would be r11 — past the cap, your call). Every §9 row was then reviewed as CODE in #452–#456.
2. **`weeksInSeason` is written to the pool by the scorer, set-once, at first priced publication** (D5). It rides `system/config.nflAutoScore`'s existing kill-switch/dryRun and the `!dryRun && !provisional` branch rather than a NEW flag — the plan asked for "kill-switch + dry-run" and this is the scorer's own; say if you want a separate flag before merge of #453.
3. **`MULTI_ENTRY_WIZARD_ENABLED` unchanged (false)** — not touched tonight.
4. **T0/T1/T2 (`weeklyPayouts` + wizard editors + moving the split control) deferred behind the ledger.** The ledger prices correctly without them. Build order after this: T6 (member "My prizes"), WEEKLY-PRIZES step 3 (season-tie cascade → season prize rows), T7 docs, then T0/T1/T2.
5. **Record Payouts card kept** (D5 said "replaces") — it is the plan's own BONUS/ADJUSTMENT override path and the only season-award path until step 3 lands.
6. **qodo #10 on #455 rejected as cross-cutting**: "SUPER_ADMIN claim trusted without re-reading `users/{uid}.role`" — same gate every commissioner callable uses; changing it is a repo-wide authorization plan, not a payouts PR. Worth a ticket.
7. **The board (PR #457) says: build NONE of the three new plans during the live weeks** — ship the two ICONS card mislabels + the `createCheckoutSession` ownership gate (`stripe.ts:189-193`, K17) as small standalone PRs, measure requests 3–4 weeks. Read the memo; it is a simulation and says so.

## 4. #456 — qodo DONE (absorbed, verdict comment on the PR); codex hit the 10-round cap

Nothing to wait for. Codex on #456 stopped at the §2c ceiling with its last finding REJECTED with evidence (co-commissioners must hold a Member Record — `coCommissioners.ts:93-95`); the residual it points at (a legacy Member Record without `participantIds` cannot read `members` as a co-commissioner) is a PLAN-CO-COMMISSIONERS follow-up affecting the whole manager view, not this PR. If you want an r11, say so — it is a paid run past the cap. The commands below are only if you want to re-check qodo yourself:

```powershell
gh api --paginate repos/kstruck/MMPoolsV3/pulls/456/comments
```
```powershell
gh api --paginate repos/kstruck/MMPoolsV3/issues/456/comments
```
```powershell
gh api --paginate repos/kstruck/MMPoolsV3/pulls/456/reviews
```

If it posted findings: absorb/reject with a verdict comment (pattern = the comments on #451–#455), re-run `codex exec review --base claude/payment-ledger-t4` from `D:\march-melee-pools\.claude\worktrees\weekly-prizes` on branch `claude/payment-ledger-t5`, push, then merge. If nothing after 20 min: toggle draft→ready (`gh pr ready 456 --undo` then `gh pr ready 456`) and wait 5 min once.

## 5. MERGE + DEPLOY RUNBOOK (PowerShell 5.1 — one command per block)

**Where:** `D:\march-melee-pools` (the MAIN checkout), unless a step says otherwise.

### 5.1 Merge, in order, waiting for CI each time

Step 1 — confirm CI is green on the next PR (repeat for 451, 452, 453, 454, 455, 456):
```powershell
gh pr checks 451
```
Expect every row `pass`. If any `fail`: stop, open the run link, tell the next session.

Step 2 — merge it (squash keeps `main` one commit per PR):
```powershell
gh pr merge 451 --squash --delete-branch
```
Expect `✓ Squashed and merged pull request #451`. GitHub then retargets #452 to `main` — refresh #452 in the browser and confirm the base now says `main` before running the next `gh pr checks`.

Step 3 — repeat steps 1–2 for **452 → 453 → 454 → 455 → 456**, one at a time. After each merge wait for the retargeted PR's CI to re-run (`gh pr checks <n>` shows `pending` for ~3 min, then `pass`).

Step 4 — the two docs PRs can merge any time, same two commands: `gh pr checks 457` / `gh pr merge 457 --squash --delete-branch`, then the handoff PR.

### 5.2 Deploy — functions FIRST (they read the new fields the rules protect)

Step 5 — update the main checkout:
```powershell
git checkout main
```
```powershell
git pull
```
Expect the log to end at the #456 squash commit (or later). If `git status` is not clean, stop.

Step 6 — install functions deps EXACTLY like this (`ci`, never `install`):
```powershell
npm --prefix functions ci
```
Expect no `package-lock.json` change (`git status --short` empty).

Step 7 — deploy functions:
```powershell
npx firebase deploy --only functions
```
Expect `Deploy complete!`; in the function list `submitNFLPicks`, `scoreNFLWeek`/`nflAutoScoreJob`, `recordPoolPayouts` show `Updated` and **`setPayoutSettled` shows `Created`**. If any function shows a build error, stop and paste the output to the next session.

Step 8 — deploy rules:
```powershell
npx firebase deploy --only firestore:rules
```
Expect `released rules firestore.rules to cloud.firestore`.

Step 9 — deploy the new composite index:
```powershell
npx firebase deploy --only firestore:indexes
```
Expect `firestore: deployed indexes in firestore.indexes.json successfully` (the `payoutRecords (entryId, week)` index may show `building` in the console for a few minutes; that is fine).

Step 10 — frontend: Coolify dashboard → the March Melee Pools app → **Redeploy** (pushing to `main` does NOT auto-deploy). Wait for the build to finish; hard-refresh the site.

### 5.3 Verify (10 minutes, on your HYBRID test pool)

Step 11 — as a member, open the Pick'em sheet for the current week: the tiebreaker block now names the target game ("This week's tiebreaker game: X at Y" or the Monday-less sentence). Submit a pick. In the Firebase console → Firestore → `pools/{poolId}`: field **`frozenTiebreakTargets`** exists with `{ "<week>": ["<gameId>"…] }`. If it does not appear after a successful submit on a rule that asks for a prediction: stop, tell the next session (do NOT hand-edit).
Step 12 — after the next complete scoring pass on a finished week (or `Score Week` from the manager view on a finished week), open Firestore → `pools/{poolId}/weekly_recaps/week_N`: **`weeklyPlaces`** (an array, one row per entry, `rank`, `prize` on paid rows) and **`weeklyPrize`** (`pot`, `places`, `entryCount`, `weeksInSeason`) — and `pools/{poolId}.weeksInSeason` now set. The Recaps tab shows the **Weekly Winners List** under the winner line.
Step 13 — as commissioner, Members & Payments: the **Payment Ledger** card shows every member with Entry fee / Fee status, and one line per weekly prize. Tick a **Paid** box → Firestore `payoutRecords/wk<N>-<entryId>-p<place>` + `payoutRecordsPrivate/...settled: true` appear. Un-tick → `settled: false`. Tick again → no new document (same id).
Step 14 — the scorer stays healthy: `npx firebase functions:log --only nflAutoScoreJob` shows passes without `weeklyPlacesError`; if a recap shows `weeklyPlacesError: PRIZE_SPLIT_DUPLICATE_RANK` that pool's payout places have duplicate ranks — fix in settings and rescore (the ledger says so too).

### 5.4 If anything is wrong

Functions rollback = redeploy from the previous commit (`git checkout 42906ecc -- functions shared` in a scratch branch, `npm --prefix functions ci`, `npx firebase deploy --only functions`); rules rollback = same for `firestore.rules`. Nothing tonight migrates data — the new fields (`frozenTiebreakTargets`, `weeksInSeason`, recap `weeklyPlaces`/`weeklyPrize`, `payoutRecords` with `week`) are additive.

## 6. Open after this (next session, one PR at a time)

1. Co-commissioners follow-up: `members` read rule + `isNFLCoManagerOf` `is list` guard for the legacy Member-Record-without-`participantIds` shape (codex r10 / qodo #11 on #456).
2. T6 — member "My prizes" in `PaymentsPanel` (own rows only, K7).
3. WEEKLY-PRIZES step 3 — season-tie cascade (Pick'em Σ correct, Margin full standings cascade) → season prize rows in the ledger; rules-page copy.
4. T7 — CONTEXT.md **Weekly Prize / Season Prize** entries, Payout Record "may name a week", ADR "displayed until recorded", fold Record Payouts into the ledger.
5. T0/T1/T2 — `weeklyPayouts` schema + validator + rules key + wizard second editor + moving the split control under Entry Fee (K8/K9 census first).
6. Kevin's calls: PLAN-WEEKLY-PRIZES r11 (§3.1); the SUPER_ADMIN stale-claim ticket (§3.6); §6 on the three new plans (#457) and whether to follow the board's "measure first".
