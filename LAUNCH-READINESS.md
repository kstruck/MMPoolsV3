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
survivor where applicable**. Both are GAPs: engineering work, not console flips.

| # | Item | What exists today (measured) | What Kevin asked for | Verdict |
|---|---|---|---|---|
| I1 | **Used confidence weights gray out** | `PickemPickEntry`'s per-game `<select>` renders the full `[17-N .. 16]` range in every dropdown regardless of what other games have taken; a duplicate is flagged *after* selection (`duplicateConfidenceValues`, gold border + "Duplicate value!") and blocks submit, but nothing stops the mistake up front | Once a weight is assigned to a game (e.g. 10), gray it out / disable it in the OTHER games' dropdowns so it cannot be picked again by mistake. Keep the existing duplicate detection as the backstop — a graying bug must not silently allow a duplicate through | **GAP** — confidence mode only; no server change (validation already exists server-side); frontend + tests + Coolify |
| I2 | **Wizard tie-breaker options for weekly/hybrid pools** | The MNF-combined-score tiebreaker is hardcoded: the pick sheet asks for it whenever a week has a Monday game (`showTiebreaker`), and scoring reads `weeklyTiebreakers[week]`. The setup wizard exposes **no tie-breaker choice at all** | Wizard options for how a weekly tie breaks — e.g. combined score of the Monday night game; if two MNF games, the LAST game (note: today's copy says *both* games combined, which is a different rule); other options as sensible. Applies to weekly/hybrid pick'em (incl. confidence); survivor **if applicable** — survivor has no weekly winner, so likely N/A, but say so explicitly rather than skipping silently | **GAP** — touches the wizard, `shared/` schema, pick sheet copy and the **scorer** → scoring trigger → **plan-gated** (`mmp-change-control` §1); functions deploy on ship |

⚠️ **I2 is a SCORING change and lands in a live scorer** — `nflAutoScoreJob` runs
`*/5`. Its plan must state how existing pools keep today's behaviour (default =
current rule, no migration) and how a mid-season settings change is refused or
handled, same as #399 did for survivor settings.

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
