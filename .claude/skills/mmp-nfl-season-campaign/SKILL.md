---
name: mmp-nfl-season-campaign
description: "Executable, decision-gated campaign to make NFL pools (Pick'em / Survivor / Margin) production-ready for their FIRST live season (2026 — never operated live before). Use when: preparing for NFL kickoff, running preseason validation, importing the NFL schedule, locking spreads, scoring an NFL week (scoreNFLWeek), deciding whether to export lockNFLSpreadsJob or add a scheduled scorer, debugging SPREADS_NOT_LOCKED / ACTIVE_GAMES / WEEK_LOCKED errors, survivor strikes or eliminations look wrong, margin -14 penalties, confidence-mode validation failures, NFL reminder emails, or any question shaped like 'is NFL ready for week 1' / 'how do I run an NFL week' / 'why can't anyone submit picks'. Nouns in hand: nfl_games, seasonType, spread.locked, syncNFLScoresJob, importNFLSchedule, MNF tiebreaker, rebuy, weekLockOverrides."
---

# NFL 2026 First-Live-Season Campaign

Mission: take the NFL pool product (Weekly Pick'em, Survivor, Margin) from "code-complete, never operated live" to "surviving a real NFL season" for the 2026 season — the FIRST live season ever (as of 2026-07-06; owner-confirmed). This skill is an executable campaign: run the phases in order, stop at every decision gate, compare what you observe against the EXPECTED line, and take the branch if it doesn't match.

Every fact below was verified against the repo at `D:\march-melee-pools` on 2026-07-06 (branch `fix/superadmin-phase0-control`). File:line cites are your re-verification handles. Anything not verifiable from this machine is labeled UNVERIFIED with the command that would verify it.

## When NOT to use this skill

| You actually want | Go to |
|---|---|
| Deploy mechanics, Coolify www deploy, cron inventory in general | `mmp-deploy-and-operate` |
| Scoring math details for ALL pool formats (brackets, squares, playoffs) | `mmp-pools-domain-reference` |
| Change classification, plan/review/sweep gates, the 4 discipline rules | `mmp-change-control` |
| A live failure you're triaging right now (permission-denied, crash) | `mmp-debugging-playbook` |
| Kill-switches and config axes (system/config, feature flags) | `mmp-config-and-flags` |
| Test commands and evidence standards | `mmp-validation-and-qa` |
| Admin dashboard tabs / Operations conventions | `mmp-superadmin-surface` |

## Glossary (defined once)

- **NFL season pool**: a `pools` doc with `type` in `NFL_PICKEM | NFL_SURVIVOR | NFL_MARGIN` (types: `functions/src/nflPoolTypes.ts`). Distinct from `NFL_PLAYOFFS` (playoffPools.ts — different system, out of scope here) and NFL-themed SQUARES pools.
- **`nfl_games`**: top-level Firestore collection of game docs keyed `espn_{eventId}`, one per game, holding `season` (string, e.g. "2026"), `seasonType` (1=Preseason, 2=Regular, 3=Postseason), `week`, `startTime` (epoch ms), `status` (`SCHEDULED|IN_PROGRESS|FINAL|CANCELLED`), `scores`, `isMonday`, and optional `spread: {value, locked}`. Client-readable by anyone; writable only by SUPER_ADMIN (firestore.rules `match /nfl_games/{gameId}`).
- **Spread lock**: `spread.locked === true` on a game doc. Load-bearing ONLY as a pick-submission gate + UI display — no scoring engine reads spread values (verified: `scorePickemEntry`/`scoreMarginWeek` in `functions/src/nflScoringEngine.ts` never touch spread; `pickMode: 'ATS'` is declared "reserved for V2" in `src/types/nflPoolTypes.ts:61` and is unimplemented).
- **Week lock**: computed at submit time, never stored: `earliest kickoff of week − lockBufferMinutes (default 5)`, floored by any commissioner `weekLockOverrides[week]` from `extendWeekDeadline` (nflPools.ts:252-269).
- **MNF**: Monday Night Football — the last game(s) of an NFL week; gates when a week may be scored.
- **Kill-switch + dry-run house pattern**: the `autoClosePools` shape — scheduled job does NOTHING unless `system/config` doc field `<job>.enabled === true`, and only REPORTS (admin_audit summary, zero writes) until `<job>.dryRun === false` (functions/src/autoClosePools.ts:31-69). REQUIRED shape for any new NFL automation.

---

## 1. CURRENT STATE (verified 2026-07-06)

### 1.1 What runs automatically today (exported + scheduled)

| Job | Schedule | What it does for NFL | Evidence |
|---|---|---|---|
| `syncNFLScoresJob` | `*/5 * * * *` (no timezone — fine, interval cron) | Refreshes `nfl_games` scores/status from ESPN for weeks with games starting ≤2h from now or non-FINAL/recently-final; detects flex-schedule moves (audits `SCHEDULE_FLEX`); **preserves locked spreads** on merge | nflSchedule.ts:221-293; exported index.ts:39 |
| `runReminders` | every 5 minutes | NFL non-picker emails, two tiers: T-36h (30–36h before week lock) and T-4h (0–4h before); default ON, opt-out `pool.reminders.lock.enabled === false`; deduped via `notifications/NFL_NONPICK_{tier}:{poolId}:{uid}:{week}` | reminders.ts:132-144, 694-815; exported index.ts:16 |
| `autoLockPools` | every 1 min | **Nothing for NFL** — only SQUARES + BRACKET pools (autoLock.ts:49-60). NFL locks are computed per-submit, never stored |
| `autoClosePools` | daily 08:00 UTC, LIVE past dry-run as of 2026-07-06 | **Nothing for NFL** — candidates are `isFinal==true` or `scores.gameStatus=='post'` (autoClosePools.ts:51-52); NFL season pools never set either field. Season-end closure is manual `closePool` |

### 1.2 What is manual (the operator loop)

| Action | Who | Exact invocation | Evidence |
|---|---|---|---|
| Import schedule | SUPER_ADMIN | SuperAdmin dashboard → **NFL Schedule** tab (`{id:'nfl'}`, SuperAdmin.tsx:1137) → season year / season type / weeks → "Bulk Import ESPN NFL Schedule". Callable: `importNFLSchedule` `{season: string, seasonType: 1|2|3, weeks?: number[]}` (defaults: '2026', 2, weeks 1-18) | nflSchedule.ts:341-363; SuperAdmin.tsx:1003-1030 |
| Enter/override + lock spreads | SUPER_ADMIN | Same NFL Schedule tab → "NFL Spread Override Manager" (SuperAdminNFLSpreads mounted SuperAdmin.tsx:4373): Fetch Games → edit values → "Lock All Spreads" → **"Save Overrides & Locks"** (client `updateDoc` on `nfl_games`, allowed by rules `isSuperAdmin()`) | src/components/admin/SuperAdminNFLSpreads.tsx:85-103 |
| Score a week | pool owner or SUPER_ADMIN, **per pool per week** | Pool dashboard → manager view → select week → "Score Week N" button (confirm dialog) → callable `scoreNFLWeek` with exactly `{poolId: string, week: number}` (week MUST be a number — it is an equality filter against `nfl_games.week`) | NFLManagerView.tsx:169-188; dbService.ts:1159-1167; nflPools.ts:537 |
| Nudge non-pickers / non-payers | owner or SUPER_ADMIN | `sendManualReminder` `{poolId, targetUids?, kind: 'PICKS'|'PAYMENT'}`; 4-hour dedupe bucket per pool+target+kind | manualReminders.ts:51-120 |

There is **still no automated weekly scoring** (re-verified 2026-07-12). A live season with P pools requires P `scoreNFLWeek` clicks every week, each after MNF ends — 18+ weeks of Tuesday-morning ritual. Note: `nflFinalizeSweepJob` (nflFinalize.ts:230, deployed, scheduled daily 08:30) was added since this was first written — it is a backstop that finalizes pools `scoreNFLWeek` already scored but failed to finalize; it does NOT replace the weekly scoring click above, and it's currently kill-switched OFF/dry-run by default pending Kevin arming it.

### 1.3 What exists but is DARK (written, never deployed)

`lockNFLSpreadsJob` (nflSchedule.ts:301-336): scheduled `0 9 * * 2` pinned `America/New_York` (Tuesday 9:00 AM ET, DST-correct). Locks `spread.locked=true` on games starting within the next 7 days **that already have a `spread` field**. It is NOT exported from `functions/src/index.ts` (verified: index.ts:39-40 exports only `syncNFLScoresJob, importNFLSchedule, createNFLPool, joinNFLPool, submitNFLPicks, executeSurvivorRebuy, scoreNFLWeek, sendManualReminder`), therefore it has never deployed and never runs.

### 1.4 The load-bearing gate you must not miss

`submitNFLPicks` refuses ALL picks — every NFL pool type, every lock mode — until **every game of the week** has `spread.locked === true`:

```ts
// nflPools.ts:244-249
const allSpreadsLocked = games.every(g => g.spread?.locked === true);
if (!allSpreadsLocked) throw new HttpsError('failed-precondition', 'SPREADS_NOT_LOCKED: ...');
```

Two consequences, both verified:
1. With `lockNFLSpreadsJob` dark, the ONLY thing standing between the platform and "no member can submit any NFL pick, ever" is a human clicking "Lock All Spreads" + "Save" every single week.
2. Even if the job were deployed, ESPN sometimes omits odds — a game imported without odds has **no `spread` field at all** (nflSchedule.ts:144: spread only written `...(spreadFound ? ... : {})`), and `lockNFLSpreadsJob` skips games without a `spread` field (nflSchedule.ts:322). One odds-less game ⇒ the whole week stays blocked. **The manual Spread Override Manager is a required backstop under every option in the Solution Menu.**

### 1.5 Missing entirely (no code path)

| Gap | Detail | Evidence |
|---|---|---|
| G1: wizard cannot set `seasonType` | `buildNFLPayload.ts` never includes it; `shared/schemas/nfl.ts` has no field (zod is non-strict, so an extra key passes validation and, since `createNFLPool` spreads raw data and `seasonType` is not in `PRIVILEGED_POOL_FIELDS` (poolOps.ts:31-37), a hand-built payload WOULD land it). Preseason test pools are impossible from the UI — contradicts NFL_POOLS_README §6 | buildNFLPayload.ts:27-46 |
| G2: no scheduled scorer | see §1.2. Still true 2026-07-12; do not confuse with the new `nflFinalizeSweepJob` finalize backstop, which is a different mechanism |
| G3: no NFL close signal | NFL pools never become eligible for `autoClosePools`; season-end is manual `closePool` per pool |
| G4: `primetimeBonus` / `pointsPerPick` are UI theater | NFLManagerView saves them into settings (NFLManagerView.tsx:215-229) but `grep primetimeBonus\|pointsPerPick functions/src` → 0 hits. The engine scores 1 pt or confidence value, nothing else |
| G5: admin Test Suite has zero NFL scenarios | `POOL_TYPE_ORDER` lists NFL types but `src/utils/testing/scenarios/index.ts` defines none — the optgroups never render. **Preseason live validation (Phase 0) is the only end-to-end NFL test that exists** |
| G6: rebuy deadline is client-trusted | `executeSurvivorRebuy` compares caller-supplied `week` to `rebuyDeadlineWeek` (nflPools.ts:457-478) — a crafted call with `week:1` bypasses the deadline. Open issue; route a fix via `mmp-change-control`, do not fix ad hoc mid-season |

### 1.6 Docs lie — corrections table (code wins)

`docs/NFL_POOLS_README.md` describes automation and behavior that DOES NOT EXIST. Treat it as product intent, not operational truth:

| README claim | Reality (verified) |
|---|---|
| §4.5 Margin tiebreaker level 5 = "Coin Flip (Random)" | Deterministic `ownerUid.localeCompare` (nflScoringEngine.ts:300) |
| §5.4 auto-strikes "applied by the scoring engine only after the final game (MNF) concludes" | No automation applies anything. The only enforcement is `scoreNFLWeek`'s ACTIVE_GAMES guard (nflPools.ts:579-582), which **SUPER_ADMIN can bypass** |
| §5.5 two MNF games ⇒ tiebreaker uses combined total of both | Code uses `games.find(g => g.isMonday && g.status==='FINAL')` — the FIRST Monday game in unordered query results, one game only (nflPools.ts:616-617) |
| §6 "create test pools by setting seasonType=1 during pool configuration" | No wizard field exists (G1) |
| §3 confidence values "[1..16]" (also nflPoolTypes.ts:172 comment) | Validated range is `[17−N .. 16]` where N = games in week (nflScoringEngine.ts:75-77) — for a 16-game week that IS 1..16, for 13 games it is 4..16 |

---

## 2. THE WEEKLY OPERATING CYCLE (the thing you are automating)

This is what one live NFL week costs today (Option B in the menu — the fallback runbook). Learn it before choosing automation; it is also the manual recovery path when automation fails.

| When (ET) | Step | Command / click | EXPECTED |
|---|---|---|---|
| Tue AM | 1. Confirm last week fully final | NFL Schedule tab → Spread Manager → Fetch Games for LAST week | Every game shows FINAL scores. If a game shows IN_PROGRESS >12h after kickoff → ESPN status stuck; wait one `syncNFLScoresJob` cycle (5 min), then check function logs |
| Tue AM | 2. Score every NFL pool for last week | Each pool → manager view → select last week → "Score Week N" | Toast "Week N scored successfully." Repeat per pool. **Run exactly once per survivor pool** (see §4.1 idempotency) |
| Tue AM | 3. Verify standings | Pool dashboard leaderboards | Pick'em totals moved; survivor strike/elimination counts match losing picks; margin ranks re-sorted |
| Tue/Wed | 4. Lock spreads for THIS week | Spread Manager → Fetch Games (this week) → fill any missing spread values by hand → Lock All Spreads → Save | Every game shows the green lock. Count of games matches the week (16 minus byes ÷ 2… typically 13–16 games) |
| Wed | 5. Prove submission works | As a member, open a pool, submit a pick | Succeeds. If `SPREADS_NOT_LOCKED` → step 4 missed a game (fetch again, look for lock-less rows) |
| Thu–Mon | 6. Nothing | `syncNFLScoresJob` handles scores + flex moves | — |
| Mon night | 7. Wait for MNF final | — | Do NOT score before every game is FINAL/CANCELLED. The guard blocks owners; it does NOT block you as SUPER_ADMIN — bypassing it mid-week is Wrong Path #3 |

---

## 3. NUMBERED PHASES WITH DECISION GATES

Run in order. Each phase ends with a gate: EXPECTED observation, and a branch if you see something else. All multi-file code changes inside any phase go through `mmp-change-control` (plan → adversarial review log → sweep; deploy functions BEFORE rules; `npm --prefix functions install` first; always `npx firebase`, project `gridiron-gamble-uzuqo`).

### Phase 0 — Preseason validation window (seasonType=1, ~August 2026)

The 2026 NFL preseason (~4 weeks of REAL ESPN games, client treats seasonType 1 as a 4-week season — nflStatusService.ts:53-54) is the only full-stack rehearsal available before week 1. Everything in Phases 1–4 gets proven here first.

**0.1 Verify ESPN preseason feed shape** (external dependency check):
```powershell
curl.exe -s "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=1&season=2026&seasontype=1" | ConvertFrom-Json | Select-Object -ExpandProperty events | Measure-Object
```
EXPECTED: a nonzero event count once ESPN publishes the preseason slate (UNVERIFIED until run — external data). Also confirm the calendar endpoint resolves (the importer depends on it to avoid off-season fallback, nflSchedule.ts:26-53):
```powershell
curl.exe -s "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?season=2026" | ConvertFrom-Json | % { $_.leagues[0].calendar | % { $_.label } }
```
EXPECTED: segments including Preseason / Regular Season / Postseason. If the JSON shape drifted → fix `fetchNFLWeekSchedule` first (this is the NFL analog of the bracket runbook's ESPN field-drift check).

**0.2 Import the preseason schedule**: SuperAdmin → NFL Schedule tab → Season `2026`, Type `Preseason`, Weeks `All` → import.
EXPECTED: success toast with imported count ≈ 48–65 (16 games/wk × ~3-4 wks; HOF week may shift counts — do not hardcode). Verify in Spread Manager: Fetch Games for Preseason week 1 returns rows.
IF 0 imported → ESPN hasn't published, or calendar mapping failed — check function logs for `[nflSchedule] Resolved Week`.

**0.3 Create one test pool per NFL type — with the seasonType workaround (G1)**:
1. Create via the normal wizard (Pick'em with confidenceMode ON, Survivor with maxStrikes 1 + maxRebuys 1 + rebuyDeadlineWeek 3, Margin) — pools land with NO `seasonType` field, which the server reads as 2 (nflPools.ts:235,569).
2. In Firebase Console → Firestore → `pools/{poolId}` → add field `seasonType` = `1` (number) to each. This is an owner-console edit, not a client write, so rules don't apply. (Number vs string both survive the server's `Number(pool.seasonType || 2)` coercion, but use number 1 to match `nfl_games.seasonType`.)
3. Flag the real fix — a wizard seasonType field for SUPER_ADMIN + schema addition — as a candidate change through `mmp-change-control`. Do NOT ship it casually; it touches the shared zod contract.

GATE: open each pool dashboard. EXPECTED: week selector shows Weeks 1–4 (not 1–18) and preseason games render. IF 18 weeks/no games → the seasonType edit didn't take (check field type) or games weren't imported.

**0.4 Prove the spread gate end-to-end**: try submitting a pick BEFORE locking spreads.
EXPECTED: client shows "Spreads Not Yet Finalized" panel (PickemPickEntry.tsx:226-231), and a forced callable submit returns `SPREADS_NOT_LOCKED`. Then Spread Manager (Type=Preseason, Week 1) → note how many games arrived with NO spread (ESPN rarely posts preseason odds — expect many; enter values manually, 0 is fine) → Lock All → Save → resubmit.
EXPECTED: submit succeeds; entry doc appears at `pools/{id}/entries/{uid}`. This gate rehearses the exact failure mode most likely to burn week 1.

**0.5 Live-score rehearsal (during an actual preseason game)**: watch `nfl_games` docs while games play.
EXPECTED: within ~5 min of real events, `status` flips SCHEDULED→IN_PROGRESS→FINAL and `scores` populate (that's `syncNFLScoresJob`). IF stale >15 min → check `npx firebase functions:log --only syncNFLScoresJob --project gridiron-gamble-uzuqo`.

**0.6 Score the preseason week (the big one)**: after ALL week-1 preseason games are FINAL, click "Score Week 1" in each test pool.
EXPECTED, concretely:
- Pick'em: each entry gets `weeklyPoints.1` and `totalScore` = sum of weeklyPoints; a `weekly_recaps/week_1` doc exists with `sharpOfWeek`; confidence totals equal the sum of confidence values on correct picks.
- Survivor: entries whose team lost/tied show `strikesUsed` +1; with maxStrikes 1, a first loss stays ALIVE, a second loss shows ELIMINATED with `eliminatedWeek`; an audit event `SURVIVOR_AUTO_STRIKE` per strike.
- Margin: `weeklyScores.1` equals the signed final margin of the picked team; an entry that submitted nothing shows `-14`; `rank` fields present on all entries.
- Then test rebuy: as the eliminated survivor member, execute the rebuy. EXPECTED strikesUsed back to 0, rebuysUsed 1, status ALIVE, `REBUY_DUE` ledger event.
IF any number differs → STOP, this is an engine bug found for $0; write it up and fix via change control before week 1. Cross-check pure-logic expectations with `npx vitest run tests/nfl-scoring.test.ts` (10 tests) and `tests/nfl-integration.test.ts` (4 tests).

**0.7 Reminder rehearsal**: 30–36h before preseason week 2's first kickoff, entries without week-2 picks should receive the T-36h email.
EXPECTED: `notifications/NFL_NONPICK_36H:{poolId}:{uid}:2` docs + `mail` collection docs (Trigger Email extension; `delivery.state` semantics UNVERIFIED — check an actual doc). IF nothing → confirm pool isn't `status:'archived'` and `reminders.lock.enabled` isn't `false` (reminders.ts:698-700).

**PHASE 0 EXIT GATE**: all of 0.1–0.7 green, evidenced (screenshots/doc IDs in a dated note). Only then proceed to season automation decisions.

### Phase 1 — Spread-locking path (DECISION GATE → Solution Menu §4)

Decide how `spread.locked` gets set every week for 18+ weeks. Default recommendation: **Option C (hybrid)**. Whatever you choose:

GATE (rehearse in preseason, re-verify regular-season week 1): on the chosen lock day, every game of the upcoming week has `spread.locked === true` AND a member pick submission succeeds. Command to eyeball: Spread Manager → Fetch Games → count locked rows == total rows. IF any row unlocked → the odds-missing case (§1.4) — enter a value manually and lock. Record how many games needed manual backstop; that number decides how much you trust the job.

### Phase 2 — Scoring automation (DECISION GATE → Solution Menu §4)

Decide manual vs scheduled scoring. **Hard precondition for ANY scheduled scorer: fix survivor idempotency first (§4.1) — a scheduler that can double-fire will wrongly eliminate paying participants.** Manual scoring (Option B) is idempotency-tolerable only because a human runs it once.

GATE: whichever option, week-1-regular-season scoring must produce, for every NFL pool: a `weekly_recaps/week_1` doc, a `SCORE_FINALIZED` audit event, and zero survivor entries struck for games that were not FINAL. Count pools scored == count of live NFL pools.

### Phase 3 — Engine correctness under live data (weeks 1–3 heightened watch)

Live data will hit paths preseason couldn't. Standing checks for the first 3 regular-season weeks, each with a number:

| Check | EXPECTED | Branch if not |
|---|---|---|
| Flex/postponement | Any startTime change appears as a `SCHEDULE_FLEX` audit event and lock times move with it (locks derive from startTime at submit time) | If a game moved but no audit → syncNFLScoresJob failing; logs |
| Two-MNF week (check the schedule in advance) | KNOWN GAP: tiebreaker uses ONE Monday game, arbitrary pick (§1.6). Before that week: either fix via change control or announce to commissioners which game counts | — |
| Tie game | Pick'em: tie = incorrect for both sides; Survivor standard mode: tie = strike; pickLosersMode: tie = strike (nflScoringEngine.ts:47-49, 177-183) | Mismatch = engine bug |
| Cancelled game | Pick'em 0 pts (confidence points lost, not reassigned); Survivor survive; Margin 0 | — |
| Late entries (Margin/Survivor) | An entry doc that doesn't exist is NOT penalized −14 / struck — only existing entry docs are scored (scoreNFLWeek iterates `entries`). Someone who joined but never submitted anything has no entry doc and silently skates | Commissioner policy question; document, don't hotfix |
| Bye-week confidence | 13-game week validates range 4–16, completeness required | Member confusion ≠ bug; point at range rule |
| Survivor auto-survive exemption | Fires only when EVERY playing team is already used (checkAutoSurviveExemption) — rare before ~week 10; if you see it early, investigate `usedTeams` |

### Phase 4 — Comms (mostly already live — verify, don't build)

Automated: the two-tier non-picker reminders ride the existing `runReminders` (already deployed, §1.1) — nothing to deploy. Manual: `sendManualReminder` nudges from the manager view. Post-game recap emails for NFL season pools: NOT built (recap docs are written by scoreNFLWeek; `onWeeklyRecapCreated` (aiCommissioner.ts) reacts to recap docs — whether it emails or only writes AI blurbs is UNVERIFIED; read `functions/src/aiCommissioner.ts:365+` before promising recap emails to anyone).

GATE per week: reminder email count > 0 whenever non-pickers existed at T-36h; unsubscribe link works (`emailUnsubscribe` HTTP endpoint is deployed). Members who opted out of `reminders` category receive nothing.

### Phase 5 — Season-start checklist (run the week before 2026 regular-season week 1)

1. Import regular season: NFL Schedule tab → `2026` / Regular Season / All weeks. EXPECTED ≈ 272 games across 18 weeks (16×18 minus byes ÷ 2 per week — verify total in Spread Manager week by week or accept the import-count toast). **Import BEFORE any spreads are locked and BEFORE any real pool has picks — re-import deletes and recreates the season's games (Wrong Path #5).**
2. Confirm scheduled jobs live: `npx firebase functions:list --project gridiron-gamble-uzuqo` — must include `syncNFLScoresJob`, `runReminders`, plus whatever Phase 1/2 options you deployed. (Prod deploy state is per-run truth; never assume.)
3. Week-1 spreads locked per Phase 1 gate; a real member submit succeeds in every live pool type.
4. Every live NFL pool has: correct `season` ("2026" string), NO `seasonType` field or `seasonType:2` (a leftover preseason `1` makes the pool query preseason games — empty weeks), sane `lockBufferMinutes`, correct survivor settings (maxStrikes/maxRebuys/rebuyDeadlineWeek).
5. Commissioners briefed on the manual runbook (§2) — they own "Score Week N" unless you shipped Option A/C.
6. Frontend changes (wizard fields, dashboards) actually live on www: Coolify deploy is a MANUAL trigger by Kevin — pushing to main deploys nothing (as of 2026-07-06).
7. Dry-run any new scheduled job for ≥1 full week of preseason/week-0 before flipping `dryRun:false` (house pattern).

---

## 4. SOLUTION MENU (ranked for automation)

### 4.1 First, the idempotency verdict — READ THIS BEFORE CHOOSING

"Can `scoreNFLWeek` run twice safely?" — answered from the code, per pool type:

| Type | Idempotent? | Why (evidence) |
|---|---|---|
| Pick'em | **YES** | Recompute-style: `weeklyPoints[week] = points` overwrites; `totalScore` re-derived from the whole map (nflPools.ts:629-630). Recap doc is a fixed-ID overwrite |
| Margin | **YES** | Same shape: `weeklyScores[week]` overwrite; seasonTotal/negativeBurden/positiveWeeks/bestWeek all re-derived; ranks recomputed from a fresh re-read (nflPools.ts:710-749) |
| Survivor | **NO — DANGEROUS** | Incremental: `newStrikes = entry.strikesUsed + (strikeLogged ? 1 : 0)` (nflPools.ts:666). Re-running week N re-evaluates the same lost pick and strikes AGAIN → a 1-strike survivor becomes wrongly ELIMINATED on the second run. Also `exemptWeeks` appends duplicates (nflPools.ts:660). A re-run after a rebuy re-strikes the rebought player. There is no "week N already scored" marker anywhere |

Corollaries: (a) manual operation must enforce ONE click per survivor pool per week; (b) any scheduler MUST either write/check a per-pool-per-week scored marker (e.g. existence of `weekly_recaps/week_{N}` — already written by every successful run — or a dedicated `scoredWeeks` map) or refactor survivor scoring to recompute strikes from picks+games; (c) if a double-run ever happens, recovery is manual strike correction from the `SURVIVOR_AUTO_STRIKE` audit trail — there is no undo function.

Other theory obligations shared by all options:
- **Locking semantics**: NFL locks are computed, not stored (§ Glossary); the automation surface is only (1) `spread.locked` flags and (2) invoking scoring. Nothing needs to "lock the pool".
- **MNF-final detection**: a scheduled scorer must verify every game of the week is FINAL/CANCELLED before scoring — same predicate as the ACTIVE_GAMES guard — and must handle the "Tuesday game after postponement" case by simply not firing until the predicate holds, retrying next run.
- **Timezone**: pin `timeZone: 'America/New_York'` on any wall-clock cron (as `lockNFLSpreadsJob` already does). `every N minutes` interval crons need no pinning. The NFL week boundary is ET; UTC crons drift an hour across DST — that hour is exactly Tue 8 vs 9 AM ET, harmless for spreads, but be deliberate.
- **Batch limits**: scoreNFLWeek already chunks writes at 400 ops (nflPools.ts:589-608) — safe for >500-entry pools; keep that shape in any scheduled variant.

### Option A — Export `lockNFLSpreadsJob` + add a scheduled scorer (full automation)

- Spread half: add `export { lockNFLSpreadsJob } from "./nflSchedule";` to index.ts — BUT wrap it in the kill-switch + dry-run pattern first (the current code has neither: it writes unconditionally, nflSchedule.ts:316-335). Deploying it as-is violates discipline rule (a). Dry-run form: log/audit which games it WOULD lock.
- Scoring half: new `scoreNFLWeekScheduled` (e.g. Tuesday 08:00 ET) that finds the just-completed week, verifies all-FINAL, iterates NFL pools, and calls the same scoring internals — with the survivor idempotency fix (§4.1) as a hard precondition, a per-pool try/catch (scheduler-swallows-errors convention), and the kill-switch + dry-run shape.
- Cost: a real multi-file change → full `mmp-change-control` gate (PLAN, review log, sweep). Highest up-front effort, lowest weekly toil.
- Residual manual work even here: odds-missing games (§1.4) and spread value overrides — the Spread Manager stays in the loop.

### Option B — Fully manual weekly runbook (zero code change)

§2 is the complete runbook. Viable for a small pool count; the failure mode is human: one forgotten "Lock All Spreads" blocks every member's picks for days silently (members see "check back soon", nobody pages you). If you choose B, put a recurring Tuesday reminder in front of a human and treat §2 step 5 (prove a submit works) as non-optional. Zero idempotency exposure as long as "score once per pool" is respected.

### Option C — Hybrid: scheduled with kill-switch + dry-run, manual backstop (RECOMMENDED)

Ship Option A's two jobs, but: (1) both behind `system/config` flags (`nflSpreadLock.enabled/dryRun`, `nflScore.enabled/dryRun`), default OFF/dry-run — exactly the `autoClosePools` shape; (2) run dry-run through the remaining preseason weeks, reading the would-lock/would-score audit summaries every Tuesday; (3) flip `dryRun:false` only after ≥1 clean week and Kevin's sign-off; (4) keep §2 as the documented fallback — the kill-switch means one Firestore field-flip reverts to Option B mid-season with zero deploys. Same theory obligations as A (survivor idempotency fix is still a precondition for the scorer's live mode; dry-run mode is safe immediately).

**Ranking: C > A > B.** B is the launch floor (it works today); do not let automation ambition delay the season — B with a disciplined human beats a half-reviewed A.

---

## 5. WRONG PATHS — fenced off

1. **Per-minute schedulers for anything NFL.** Cost landmine: this project already runs two 1-minute jobs + `runReminders` doing an unfiltered full `pools` collection read every 5 min (reminders.ts:117, flagged in AUDIT-REPORT). NFL state changes on a ~weekly cadence; nothing NFL needs sub-5-minute polling. `syncNFLScoresJob`'s own query has no lower time bound (reads every past game doc each run, nflSchedule.ts:227-229) — don't add siblings with the same shape.
2. **Deploying rules before functions.** House incident: locking a collection to functions-only before the callable exists silently drops writes. Ritual is always: `npm --prefix functions install` → `npx firebase deploy --only functions --project gridiron-gamble-uzuqo` → then rules. See `mmp-change-control`.
3. **Scoring before the last game of the week is FINAL (SUPER_ADMIN bypass).** The ACTIVE_GAMES guard blocks owners but not SUPER_ADMIN (nflPools.ts:580). Scoring mid-week: strikes survivors for non-submission while PER_GAME-lock players could still legally pick a later game; breaks the rebuy window the README promises; margin entries with pending games score `null→0` for that week. If you must re-run after an early mistake, remember §4.1: survivor re-runs double-strike.
4. **Re-running `scoreNFLWeek` on a survivor pool "just to refresh".** See §4.1. Pick'em/margin refresh fine; survivor does not.
5. **Re-importing the schedule mid-season.** `importNFLSeason` DELETES all existing `nfl_games` for that season+type, then re-imports fresh (nflSchedule.ts:168-186) — fresh games carry `locked:false` (or no spread at all), so every locked spread and manual override for the season is destroyed; picks survive (game IDs are stable `espn_{eventId}`) but the submission gate re-closes for all future weeks until re-locked. Single-week re-import has the same blast radius (season+type-wide delete). Mid-season game-data repair belongs in the Spread Manager or a reviewed one-off, never the importer.
6. **Trusting NFL_POOLS_README automation claims.** §1.6 table. The README describes a scoring engine that runs itself after MNF; no such thing is deployed. Ops decisions based on the README instead of index.ts exports is how a week goes unscored.
7. **"Fixing" the spread gate by hand-editing `nfl_games` beyond the Spread Manager.** Rules allow any SUPER_ADMIN client write to `nfl_games`; ad-hoc console edits to scores/status fight `syncNFLScoresJob` (it re-syncs from ESPN every 5 min and will overwrite everything except locked spreads). Only `spread` survives (and only when `locked:true`).
8. **Assuming Stripe/entry fees are in scope.** Money: Stripe = commissioner hosting fees only; entry fees, rebuy costs, and pots are P2P honor-system bookkeeping (`REBUY_DUE` ledger events are records, not charges). Never build payment enforcement into the season plan.
9. **Assuming pushing to main deployed the frontend.** Prod www is Coolify/nginx, manually triggered by Kevin (as of 2026-07-06). A wizard fix "on main" is invisible to users until that button is pressed.

---

## 6. VALIDATION + PROMOTION

All promotions route through `mmp-change-control`: code changes need plan → adversarial review log → sweep; prod-data mutations and job enablement need kill-switch + dry-run with reviewed dry-run output; new work in its own worktree.

Per-phase success criteria (numbers, not vibes):

| Phase | Criterion |
|---|---|
| 0 | 3 preseason test pools (one per type) scored ≥1 real preseason week each with hand-verified numbers: pick'em totals match hand count, ≥1 survivor strike AND ≥1 elimination AND ≥1 rebuy exercised correctly, margin week scores equal real margins ±0, one −14 non-submission observed. ≥1 reminder email delivered. 0 unexplained discrepancies |
| 1 | Week-1 regular season: locked-game count == game count for the week; ≥1 successful member submit per pool type; 0 SPREADS_NOT_LOCKED reports after lock day |
| 2 | Week 1 scored for 100% of live NFL pools within 12h of MNF final; `weekly_recaps/week_1` + `SCORE_FINALIZED` audit exist per pool; 0 survivor strikes on non-FINAL games; if scheduled: ≥1 preseason dry-run report reviewed before enable |
| 3 | Weeks 1–3: 0 engine corrections needed, or every correction has a written incident note (symptom→cause→fix) filed per `mmp-docs-and-writing` |
| 4 | Every week with non-pickers at T-36h produced >0 reminder sends (check `notifications` prefix `NFL_NONPICK_`); 0 unsubscribe complaints ignored |
| 5 | Checklist items 1–7 each have dated evidence |

**You are season-ready when:** Phase 0 exit gate passed with evidence; a spread-locking path is chosen, rehearsed, and its backstop documented; the scoring path is chosen and — if scheduled — survivor idempotency is fixed and dry-run reviewed; the §2 manual runbook has been executed start-to-finish at least once by the human who owns Tuesdays; Phase 5 checklist is green; and every deviation discovered in preseason is either fixed through change control or written down as an accepted, commissioner-communicated limitation (the two-MNF tiebreaker and G4 theater settings at minimum).

---

## Provenance and maintenance

Written 2026-07-06 against branch `fix/superadmin-phase0-control`. Volatile fact classes and their one-line re-verification (run from `D:\march-melee-pools`):

| Fact | Re-verify with |
|---|---|
| `lockNFLSpreadsJob` still dark / NFL export set | `Select-String -Path functions\src\index.ts -Pattern "nfl" ` (expect syncNFLScoresJob, importNFLSchedule, createNFLPool…scoreNFLWeek; NOT lockNFLSpreadsJob) |
| What is actually deployed in prod | `npx firebase functions:list --project gridiron-gamble-uzuqo` |
| Spread submission gate still exists | `Select-String -Path functions\src\nflPools.ts -Pattern "SPREADS_NOT_LOCKED"` |
| Survivor scoring still non-idempotent | `Select-String -Path functions\src\nflPools.ts -Pattern "strikesUsed \+"` (a hit at the `newStrikes` line means still incremental) |
| Wizard still can't set seasonType | `Select-String -Path src\components\wizard\create\buildNFLPayload.ts,shared\schemas\nfl.ts -Pattern "seasonType"` (0 hits = gap remains) |
| Engine ignores primetimeBonus/pointsPerPick | `Get-ChildItem functions\src -Recurse -Filter *.ts | Select-String -Pattern "primetimeBonus|pointsPerPick"` (0 hits = still theater) |
| NFL reminder tiers wired | `Select-String -Path functions\src\reminders.ts -Pattern "NFL_NONPICK_"` |
| Kill-switch house pattern reference | `Select-String -Path functions\src\autoClosePools.ts -Pattern "enabled|dryRun"` |
| autoClose still can't touch NFL pools | `Select-String -Path functions\src\autoClosePools.ts -Pattern "isFinal|gameStatus"` (candidate queries unchanged = NFL excluded) |
| ESPN feed shape / preseason availability | the two `curl.exe` commands in Phase 0.1 |
| Engine unit expectations | `npx vitest run tests/nfl-scoring.test.ts tests/nfl-integration.test.ts` |

UNVERIFIED items carried in this skill (each labeled inline): App Check enforcement scope over callables; current prod contents of `nfl_games`; 2026 ESPN preseason calendar structure and game counts; Trigger-Email `delivery.state` contract; whether `onWeeklyRecapCreated` emails members or only writes AI blurbs (read `functions/src/aiCommissioner.ts:365+`).
