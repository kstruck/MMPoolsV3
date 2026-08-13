# LAUNCH-READINESS — measured 2026-08-10 (overnight session)

**What this is:** the definition of "100% ready" for sending pool-hosting
invites THIS WEEK. One row per readiness item. Every row carries the VERIFY
command and what it actually returned **tonight** — measured, never asserted.
Rows marked **KEVIN-ACTION** are things only Kevin can do (console access or a
business decision); **GAP** means engineering work is owed; **READY** means the
evidence is in the row.

Companion doc: `MORNING-2026-08-10-LAUNCH.md` carries the numbered steps for
every KEVIN-ACTION row, ordered by what unblocks invites soonest.

## A. Deploy state

| # | Item | Verify | Measured tonight | Verdict |
|---|---|---|---|---|
| A1 | Functions deployed | `npx firebase functions:list --project gridiron-gamble-uzuqo` | ✅ **UPDATED 2026-08-12: functions are deployed from <!-- deploy-state:ignore --> `main` @ `c37bbd37`** (#414 + #415), replacing the `c7bdcf5` reading this row carried on 2026-08-10. Verified by the fleet listing returning **`getPoolPicks`** — the callable #414 adds, absent before. ⚠️ An all-`Skipped` certification pass was NOT run, so byte-identity to `c37bbd37` is not claimed; what is proven is that the new callable is live | **READY** — nothing owed |
| A2 | Rules deployed | `git log --oneline -1 -- firestore.rules` + the deploy output | ✅ **UPDATED 2026-08-12: rules deployed from `c37bbd37`.** ⚠️ The `c7bdcf5` reading this row carried is STALE and its reasoning is now FALSE — **#414 changed `firestore.rules`** (last commit touching it is `c59a41d4`), so "no rules change has merged since" no longer holds. Pre-deploy the working tree was clean on the file and the `entries` block was confirmed to carry only `ownerUid` + `isSuperAdmin()` + the participant branch; the deploy reported `released rules firestore.rules to cloud.firestore` | **READY** — nothing owed |
| A3 | Frontend live | `curl -s https://www.marchmeleepools.com/` → entry assets, then crawl the chunk graph for a marker unique to the change | ✅ **UPDATED 2026-08-13: rebuilt from `d6bae3f4` (#417); live bundle moved `index-Dv5RBrGq.js` → `index-BB2oOzrg.js`.** ⚠️ **The hash is not the evidence** — #417 is verified INSIDE the shipped JavaScript by a 106-asset chunk-graph crawl finding all five of its sentinel strings, each exactly once (`Quick Picks`, `no line yet`, `Nothing left to fill`, `games to submit`, `Two games share a confidence weight`). HANDOFF's 2026-08-13 box carries the reading and the ⚠️ that those sentinels are now live and must be swapped before the crawl is reused. The 2026-08-12 reading (`index-Dhm5WwL_.js` → `index-Dv5RBrGq.js`, from `c37bbd37`) is the previous link in the chain | **READY** — nothing owed |
| A4 | Indexes | `npx firebase firestore:indexes --project gridiron-gamble-uzuqo` | **17 composite indexes**, matching the 2026-08-05 count (both `pools` billing composites present) | **READY** |
| A5 | PR #405 (survivor exemption fix) | `gh pr checks 405` | ✅ **DONE — merged and deployed 2026-08-10.** Superseded twice since: `39d5702` (#408) then `c37bbd37` (#414 + #415) | **READY** — historical row, no action |

## B. Scoring pipeline (the launch-critical machinery)

Config lives in Firestore `system/config`, which cannot be read from this
machine tonight (see row E1 — the SA key file is gone, which is the good
direction). Each row cites its last verified reading and gives the 30-second
console check: Firebase console → Firestore → `system` → `config` → the named
field.

| # | Item | Last verified state | Verdict |
|---|---|---|---|
| B1 | `nflAutoScore` — the auto-scorer | `{enabled: true, dryRun: false}`, `nflAutoScoreJob` runs `*/5` — **LIVE** (HANDOFF top box, 2026-08-09) | **READY** — grading is automatic |
| B2 | `syncNFLScoresJob` — score ingestion | 5-min schedule with no kill switch is a CODE fact (`functions/src/nflSchedule.ts`, in tonight's 176-function fleet); "running in prod" is HANDOFF provenance (heartbeats since July), not re-measured tonight | **READY** |
| B3 | `nflDeepSweep` — late FINAL / correction re-reads | **unset** (HANDOFF 2026-08-09). While unset, a game reaching FINAL or corrected >24h after kickoff is never re-read from ESPN | **KEVIN-ACTION** — two-stage flip per `PLAN-AUTOSCORE-GOLIVE.md` §5 (morning doc). Dry-run stage is safe: it detects and reports, suppressing only the write |
| B4 | `nflFinalize` — finalize sweep | `{enabled: true, dryRun: true}`, `liveSeasonTypes` **unset** — `dryRun: false` alone keeps it dry (#210's deliberate two-key arming) | **KEVIN-ACTION** — NFL-6 in `TOMORROW-TASKS.md` (morning doc): read the audit-log candidate counts first, then set `liveSeasonTypes: [1]` |
| B5 | `nflLockWatch` — spread-lock pager | `{enabled: true, dryRun: true}` | **READY as-is** — Kevin's standing decision: stays dry. ⚠️ The parenthetical this row used to carry — *"1 of 49 preseason games has a line; arming it pages nightly about a known condition"* — is **wrong on both halves** and was corrected 2026-08-11: importer week 2 now carries odds on **16 of 16** games (measured against ESPN), and the watcher filters affected pools through `poolIsBlockable` (ATS pick'em only) and returns `no live pool on this slate` without paging when that set is empty (`lib/nflLockWatch.ts:91-93`, `:147`). Arming it today would be harmless and pointless alike. See `docs/nfl-spreads-runbook.md` §6 |
| B6 | `nflSpreadLock` — Tuesday spread lock | `{enabled: true, dryRun: true}`; the HOF game's spread was locked MANUALLY and verified 2026-08-05 | **READY for invites** — ATS pick'em is not required for the pilot's survivor/margin/straight-up pools; arm before any ATS pool's first live week. **Runbook: `docs/nfl-spreads-runbook.md`** — the flip is §4, and §5 records the sequencing gap that makes the weekly job insufficient on its own (values arrive from the sync ~2h before kickoff; the lock runs Tuesdays) |
| B7 | Survivor exemption correctness | PR #405 (tonight): future-week reservations no longer excuse a missed pick; fix-forward, both modes | **READY once A5 merges+deploys** — until then the deployed engine has the known #399-carried defect (small reachable surface: thin slates only) |

## C. Data safety

| # | Item | Verify | Measured tonight | Verdict |
|---|---|---|---|---|
| C1 | PITR | `npx firebase firestore:databases:get "(default)" --project gridiron-gamble-uzuqo --json` | **`POINT_IN_TIME_RECOVERY_ENABLED`**, `versionRetentionPeriod: 604800s` (7 days), `earliestVersionTime: 2026-08-04T04:26:00Z` | **READY** — ⚠️ `PLAN-BACKUPS-PHASE3.md`'s "No PITR" line is STALE; PITR went on ~2026-08-04. Doc updated this session |
| C2 | Scheduled Firestore exports | Console → Firestore → Disaster Recovery (or `gcloud firestore operations list`) | Not verifiable from this machine (no gcloud, no key) | **KEVIN-ACTION** — verify/enable per `PLAN-BACKUPS-PHASE3.md`. ⚠️ PITR (C1) covers bad writes on a LIVE database only — database deletion, project loss and >7-day corruption still need these exports, so this is the remaining real backup work, not belt-and-braces |
| C3 | Auth export | `PLAN-BACKUPS-PHASE3.md` step 6 | Never run (per plan doc; not verifiable tonight) | **KEVIN-ACTION** — one command in Cloud Shell; Auth is the un-recreatable half |
| C4 | VPS snapshots | Hostinger daily snapshot (deploy-topology memory) | Not re-verified tonight | **READY** (standing; frontend also rebuilds from git) |

## D. Invite path (what a stranger can actually do) — T3 evidence

| # | Item | Verify | Measured tonight | Verdict |
|---|---|---|---|---|
| D1 | Join is NOT gated by `POOLS_OPEN` | `src/config/season.ts:2` + its only consumers `src/utils/auth.ts:44,48` | `POOLS_OPEN = false` gates **pool CREATION only** (client entry points; SUPER_ADMIN bypass). Nothing in the join path reads it | **READY** — strangers can join; they cannot create pools, which is correct for a hosted-invite launch |
| D2 | Server join gates | `joinNFLPool` (`functions/src/nflPools.ts:324`) → `joinNFLPoolInternal` (`:233`) | Gates: maintenance mode, free-plan **10-participant cap**, paid ceiling. No invite token required — the link IS the invite | **READY** — ⚠️ know the 10-cap: a free-plan pool stops accepting joiner #11 with a clear upgrade message |
| D3 | Join → pick → visible, end to end | `functions/src/__tests__/emulator/invitePath.emulator.test.ts` (PR #406, this session) | **5/5 pass through the real callables**: ordinary host creates survivor pool → stranger joins with only the pool id → submits survivor pick → pick on the entry doc; no-join submit refused with no entry minted; free-plan cap refuses joiner #11. Full emulator suite 353 passed | **READY** — merge #406 (test-only, nothing to deploy); prod walkthrough in the morning doc |
| D4 | Pick submission requires membership | `assertNFLPickMembership` (`nflPools.ts:342`) + emulator suite | `NOT_POOL_MEMBER` thrown for non-members; suite green tonight | **READY** |

## E. Security / hygiene

| # | Item | Verify | Measured tonight | Verdict |
|---|---|---|---|---|
| E1 | SA key `C:\keys\gridiron-admin.json` | `ls C:\keys` | **The directory is empty/absent — the key FILE is gone from disk** | **KEVIN-ACTION** — confirm the key is also revoked in IAM (console → Service Accounts → keys); file-gone ≠ key-dead |
| E2 | App Check | HANDOFF top box | OFF, and turning it on is BLOCKED (4 known faults; the 2026-07-30 attempt took prod down). Do NOT set `VITE_RECAPTCHA_SITE_KEY` | **READY as accepted risk** — decision on record |
| E3 | `claimMySquares` timing hole | `SECURITY-CLAIM-SQUARES.md` | Unfixed, repo public | **READY as accepted risk** — Kevin's decision on record: accept through the pilot, fix before regular season |
| E4 | Dependency audit | CI `security-audit` job on #405 | **pass** tonight (`--audit-level=high` both trees); remaining moderates accepted per #390 | **READY** |
| E5 | Email templates still carry the OLD logo | **TWO** consumers, both pointing at the same asset: `functions/src/emailStyles.ts:6` (`LOGO_URL`, rendered at `height: 50px` — line 21/46) for server-sent mail, and `src/services/emailService.ts:110` for client-sent mail. Both resolve `/email-logo.png`, so **one file replace covers both** | Verified 2026-08-12 by reading both files. Not swapped | 🛑 **BLOCKED ON KEVIN** — replace `public/email-logo.png` + Coolify rebuild (~2 min), but the asset has not been chosen. Candidates present in `public/`: `mmp-logo-full.png`, `mmp_logo.png`, `mmp_logo_500x150_trans3.png`, `mmp-crest.png`, `logo.png` — all five confirmed to exist — or something not yet committed. **Nothing was changed**; Kevin's 2026-08-11 instruction was to hold until he decides. Every invite and reminder sent before the swap carries the old mark |

## F. Test estate (all measured tonight, this branch)

| Suite | Command | Tonight |
|---|---|---|
| Root vitest | `npm test` | **860/860** (60 files) |
| Functions vitest | `npm --prefix functions test` | **1432/1432** (99 files) |
| Emulator | `npm --prefix functions run test:emulator` | **348 passed / 2 expected-fail / 10 skipped** (24 files + 1 skipped file) |
| Root typecheck | `npx tsc -b` | clean |
| Functions typecheck | `npm --prefix functions run typecheck` | clean |
| CI on #405 | `gh pr checks 405` | 7/7 green |

## G. Open PRs

| PR | What | Disposition |
|---|---|---|
| #405 | Survivor exemption fix (this session) | Fully gated; merge + functions deploy — morning doc task 1 |
| #406 | Invite-path emulator journey (this session) | Fully gated (qodo's residue finding fixed); merge, nothing to deploy — task 2 |
| #400 | deps: minor-and-patch group (6 updates) | ✅ **MERGED tonight** (04:43Z) after green gates in an isolated worktree. Root `package.json`/lockfile only — no functions deploy; the client `firebase` 12.17.0→12.17.1 patch rides the next Coolify rebuild (owed, low urgency) |
| #401 | deps: vite 7→8 (major) | **BLOCKED UPSTREAM** — `@vitejs/plugin-react` peer-caps at vite ^7; `npm ci` cannot resolve. Leave open |
| #402 | deps: framer-motion 12→13 (major) | Gates all green (measured); needs a human visual smoke of animations before merging. Verdict on the PR |
| #403 | deps: lucide-react 0.556→1.29 (major) | **REAL BREAKAGE** — 7 build errors, brand icons removed (ShareModal, UserProfile). Needs a migration PR first |
| #380 | docs: README catch-up | 🛑 untouched per standing instruction |
| #304/#302/#300 | deps majors (firebase-admin, typescript, tailwind) | 🛑 untouched per standing instruction |

## H. Business items (Kevin only — none block the tech, all block the PITCH)

| # | Item | State | Verdict |
|---|---|---|---|
| H1 | **A8 — publish 2026 price + free-period end date** | Was DUE 2026-08-06 (before HOF); status unknown to this session | **KEVIN-ACTION, now overdue** — the board's 5–0: free-with-no-published-price anchors expectations at zero. Send it with (or before) the invites |
| H2 | A9 — recruit ~10 commissioners | The invites themselves | **KEVIN-ACTION** — this is the launch |
| H3 | A11 — "tests every pool type" overclaim | Quick copy pass | **KEVIN-ACTION** (5 min, alongside H1) |

## I. Product gaps Kevin declared launch-blocking (added 2026-08-13)

Kevin, 2026-08-13, on pick-entry UX — scoped to **confidence, pick'em and
survivor where applicable**. **Row status updated 2026-08-13 evening.**

| # | Item | What exists today (measured) | What Kevin asked for | Verdict |
|---|---|---|---|---|
| I1 | **Used confidence weights gray out** | ~~Full `[17-N .. 16]` range in every dropdown~~ — **BUILT**: each game's `<select>` renders `<option disabled>` on any weight another game holds, `(used)` suffix, own weight never disabled. The duplicate backstop (`duplicateConfidenceValues` → gold border, "Duplicate value!", blocked submit) is untouched and pinned by test | Once a weight is assigned to a game (e.g. 10), gray it out / disable it in the OTHER games' dropdowns so it cannot be picked again by mistake. Keep the existing duplicate detection as the backstop | ✅ **READY — [PR #420](https://github.com/kstruck/MMPoolsV3/pull/420) open.** All gates green (943 + 1463 tests, both typechecks, CI 7/7); codex r1 clean **and** qodo 0 findings. Owes **merge + one Coolify rebuild**, no functions/rules deploy. ⚠️ **No screenshot** — see the PR body; `MORNING-2026-08-14.md` §2b is the browser look-at list |
| I2 | **Wizard tie-breaker options for weekly/hybrid pools** | The MNF-combined-score tiebreaker is hardcoded, and — **measured 2026-08-13** — **it breaks no tie at all**: the number feeds one "closest guess" line on the weekly recap card. `buildStandingsRows` computes **no** Pick'em rank; standings sort by *season* `totalScore`. `payoutMode` (SEASON/WEEKLY/HYBRID) is stored and displayed only, and `PayoutsPanel` tells members to "ask your commissioner". **There is no weekly winner in the codebase** | Wizard options for how a weekly tie breaks — MNF combined; if two MNF games, the LAST game (today's copy says *both*, a different rule); other options as sensible. Survivor **if applicable** | 🛑 **PLAN AWAITING SIGN-OFF** — `PLAN-WEEKLY-TIEBREAKERS.md` + `-REVIEW-LOG` (3 codex rounds, 2 findings, both absorbed, r3 clean) + `-SWEEPS` (6 enumerations). **No code.** Blocked on the plan's §9 Q1: **Option A** (settings only, shippable) vs **Option B** (a real computed weekly winner, lands in the live scorer). Recommendation: A now, B after launch |
| I3 | **Survivor / Margin sheets show no Correct-Incorrect state** *(from the 2026-08-13 live-scoring audit, gap G1)* | Pick'em's own sheet colours each game card green/red the moment it goes FINAL — client-side `gradePick`, no scorer involved. **Survivor and Margin render a plain `border-line` card**: live score and clock, but no win/loss acknowledgement. Their entry-level state (ALIVE/ELIMINATED, week result) moves only after the weekly lock, by design | *(not a Kevin ask — surfaced by the audit he requested)* | **GAP, recommended before launch.** Pure frontend, no reveal risk (the member's own pick and the game's FINAL status are both already on screen), **not plan-gated**, no functions deploy. `MORNING-2026-08-14.md` §4c |

⚠️ **I2 is a SCORING change and lands in a live scorer** — `nflAutoScoreJob` runs
`*/5`. Its plan states how existing pools keep today's behaviour (absent field =
current rule, defaults at read sites, **no migration** — the #399 pattern) and
how a mid-season change is refused. ⚠️ **The refusal is TIGHTER than #399's**:
codex holed the first draft for copying `poolHasScoredWeek`, which would let a
commissioner change the rule after members had already typed a number. It freezes
at the **first submission**, not the first scored week.

**The live-scoring audit itself (Kevin's third 2026-08-13 ask) is answered in
`MORNING-2026-08-14.md` §4** — per pool type: when a pick becomes scored, where
each surface shows Correct/Incorrect with file:line evidence, and four ranked
gaps. Headline: Pick'em grades **per game as each game ends** (worst case ~10
min: ≤5 for ESPN's FINAL, ≤5 for the scorer's next pass), Survivor/Margin hold
until the weekly lock by design, and **no surface anywhere shows a per-pick ✓/✗
for other players** (gap G2 — the data exists in `weeklyResults[week].games` and
is never rendered).

## Accepted non-blockers (decision references)

The brief's "§C non-blockers" list — no literal §C section exists in any repo
doc (searched tonight); these are the standing accepted items with their
decision homes:

1. **App Check OFF** — blocked on 4 faults; decision + fault list in HANDOFF
   STOP-POINT box (2026-07-30 incident).
2. **`claimMySquares` hole through the pilot** — `SECURITY-CLAIM-SQUARES.md`,
   Kevin 2026-07-21.
3. **`nflLockWatch` stays dry-run in preseason** — HANDOFF 2026-07-22 standing
   decision. The "1 of 49 games has a line" rationale this entry used to give is
   **retired 2026-08-11**: coverage is 16/16 on importer week 2, and the watcher
   would not page with no ATS pool in existence anyway (row B5 above;
   `docs/nfl-spreads-runbook.md` §6). It stays dry on the decision, not the count.
4. **Moderate dep advisories** — root `@opentelemetry/core`, functions
   `ts-deepmerge`; accepted in #390, each needs a breaking major.
5. **Existing wrong survivor exemptions stay** — fix-forward ruling, Kevin
   2026-08-09, `PLAN-SURVIVOR-EXEMPTION-RESERVATIONS.md` Q4; repair needs the
   reset-and-replay sub-PR that does not exist yet.
6. **`usedTeams` remains submit-time everywhere** — display/guard role only
   after #405; sweep S1 proves no scored-time writer exists.

## Bottom line

**The platform is launch-ready for invite sends once #405 is merged+deployed
(one functions deploy) — nothing else in the stack blocks a stranger joining a
pool and playing.** The KEVIN-ACTION list is: merge/deploy #405, the two
scoring-config arms (B3 deep-sweep, B4 finalize sweep), backups verification
(C2/C3), SA-key revoke confirmation (E1), and the A8 price publish (H1) which
should accompany the invites themselves.
