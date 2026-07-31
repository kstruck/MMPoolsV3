# PRESEASON READINESS — checklist & schedule planner

**Written 2026-07-24. Target: Hall of Fame game, Thu 2026-08-06, 8:00pm ET —
13 days out.** First full preseason slate: 2026-08-13 (importer week 2; HOF
weekend is importer week 1).

**Purpose:** one place holding everything NOT yet done, so Kevin can plan his
schedule. Split by who moves it. ☐ = open, ☑ = done-but-verify. Each item cites
its source doc so the detail is one hop away. Gap analysis at the bottom —
items **G1–G5 were not on any list until now**.

---

## 1. KEVIN — prod arming gates (the critical path to a live preseason)

These are the reason the pilot exists. All code is deployed; each is a
config/console act with a verification step. Suggested order as listed.

- ☐ **K1 · Arm `nflFinalize` for preseason (NFL-6).** Check Admin Audit Log for
  `NFL_FINALIZE_SWEEP` entries with a `bySeasonType` breakdown (candidates
  under `"1"`, ZERO under `"2"`). If clean: `system/config.nflFinalize` →
  `enabled: true`, `dryRun: false`, **`liveSeasonTypes: [1]`** (int64 1 —
  `dryRun:false` alone deliberately does nothing). *Source: TOMORROW-TASKS
  NFL-6.* **Time-sensitive: needs ~2 days of dry-run reports watched before
  the HOF game — start now.**
- ☐ **K2 · Watch `nflDeepScoreSweepJob` dry-run reports, then arm.**
  `system/config.nflDeepSweep.enabled = true` (11:30 ET daily; dry-run already
  detects+reports, only suppresses writes). Watch a few days first. *Source:
  PICKUP §2.*
- ☐ **K3 · Confirm `lockNFLSpreadsJob` fires Tue 09:00 ET.** Ops Health shows
  `never-ran` until **2026-07-28** (cosmetic — its wrapping postdates the last
  Tuesday). After Tue 07-28, check the heartbeat; if it ran, decide whether to
  take it past dry-run. *Source: PICKUP "known cosmetic artifact".*
- ☐ **K4 · Enter + lock spreads for HOF/week 1** (or verify K3 does it):
  SuperAdmin → NFL Schedule → Spread Override Manager → set values → Lock All →
  Save. The HOF game had odds on ESPN (CAR -1.5). *Source:
  mmp-nfl-season-campaign §1.2.*
- ☐ **K5 · Delete the one mislabeled preseason game doc** left from the NFL-5
  import (62 writes → 50 docs, one mislabeled). *Source: TOMORROW-TASKS NFL-5
  "one cleanup outstanding".*
- ☐ **K6 · Create the preseason test pools** (the point of the pilot): at least
  one Pick'em, one Survivor, one Margin pool on season 2026 `seasonType 1`.
  Note: these are your TEST pools — per the stats ruling they will never count
  toward public stats.

## 2. KEVIN — business items (calendar-bound, no code)

- ☐ **K7 · A8 PRICING — DUE 2026-08-06.** Publish the 2026 regular-season price
  AND the free-preseason end date BEFORE the pilot starts. Free-with-known-price
  tests willingness to pay; free-with-no-price anchors at zero. **The only
  hard-deadline item on the board.** *Source: PLAN-NFL-PRESEASON-PILOT A8.*
- ☐ **K8 · A9 — Recruit ~10 commissioners** you personally support (not 100
  strangers). Needs lead time for them to create pools before 08-06/08-13.
- ☐ **K9 · A11 — Messaging check:** preseason cannot test brackets/conference
  tournaments (none exist in August) — don't claim it anywhere public.
- ☐ **K10 · A7 — Chaos drill (DURING a preseason week, not before):**
  deliberately skip one spread lock; verify the A3a tripwire pages you before a
  member notices. Runbook: TOMORROW-TASKS NFL-7.

## 3. KEVIN — infrastructure gates (block engineering work behind them)

- ☐ **K11 · Backups Phase 3 (PLAN-BACKUPS-PHASE3):** enable PITR (~2 min,
  console — the 7-day recovery floor; DB is `nam5`, supported), then scheduled
  backups + GCS bucket + IAM. **Gap: the app currently has NO backup story and
  the season starts in 13 days.** Steps 0–5 are yours; step 6 unblocks E3.
- ☐ **K12 · Stats census (read-only)** — enumerate pools by
  type/seasonType/simRunId/createdAt to validate the isTestPool discriminator
  before the stats code ships. *Source: PLAN-STATS-INTEGRITY §8.2.*
- ☐ **K13 · Two stats sign-offs:** (a) drop the 2026-09-09 date cutoff for the
  isTestPool discriminator; (b) confirm Q3 = per-user profile-visibility
  toggle. *Source: PLAN-STATS-INTEGRITY §8.7.*

## 4. KEVIN — quick decisions parked without a deadline

- ☐ **K14 · NFL-2 / A3b:** synthetic pick probe — build a real authenticated
  prod probe (needs a probe user + credentials), or accept A3a-only coverage.
  My read: A3a + the chaos drill covers the risk for preseason; decide before
  regular season, not before HOF. *Source: TOMORROW-TASKS NFL-2.*
- ☑ **K15 · qodo: CLOSED 2026-07-25** — Kevin retired the check entirely. CLAUDE.md
  §2b now forbids checking it; codex (§2c — judgement up to 10 rounds, Kevin's
  sign-off with a reason past 10, per his 2026-07-27 ruling) is its temporary
  replacement. Restore path kept in a collapsed block in §2b.
- ☐ **K16 · NotebookLM sync habit:** add the repo/DECISION-LOG.md as a source in
  the MarchMeleePools notebook; re-sync after significant merges (no API — it's
  a 1-minute manual act).

## 5. ENGINEERING (me) — queued, in proposed order

- ☐ **E1 · Stats integrity build A–F** (after K12/K13): shared isTestPool →
  calculatePoolPot NFL+Props → recompute selection + scheduled recompute →
  apply filter server+Overview → Stats tab filters → profile-visibility
  toggle. Then Kevin runs Recalculate. One PR at a time, codex-reviewed.
  *Source: PLAN-STATS-INTEGRITY §8.6.*
- ☑ **E2 · sendEmail / sendCourierSMS outcome plumbing** — **BUILT 2026-07-28**,
  not yet merged or deployed. `DeliveryTally` counts queued/skipped/failed plus
  swallowed per-pool errors, and `reminderPassVerdict` marks the run unhealthy on
  a failed send or an un-evaluated pool. *Source: PICKUP "best next engineering
  work".*
- ☐ **E3 · Scheduled Auth export** (PLAN-BACKUPS-PHASE3 step 6) — code,
  blocked on K11's bucket+IAM.
- ☐ **E4 · Bounded-query follow-up to #262** — composite index +
  orderBy(startTime).limit(1), a further ~10× on the reminder reads. Needs the
  index deployed AND built before code (the #223 lesson), and limit(1) changes
  min(week) semantics for postponed games — own argument. Low urgency now that
  reads dropped. *Source: PLAN-READS-RUNREMINDERS §4.*
- ☐ **E5 · #133 tailwindcss 4.x dependabot** — stale since 07-06; close or take
  deliberately (it's a major with real migration work). Low priority.
- ☐ **E6 · Commissioner settings-save UX — make saving findable and its result
  unmissable.** *(Kevin, 2026-07-25, while smoke-testing the #279 deploy.)*
  **DUE BEFORE 08-06** — every pilot commissioner meets this screen, and a save
  they cannot find or cannot confirm is the kind of friction that reads as "the
  app is broken" during the one week the pilot has to go well.

  The Manager tab's settings editor (`NFLManagerView.tsx`) is a long,
  multi-section form — General, Host Profile & Contact Links, Pick'em Rules,
  Scoring Configuration — with a **single "Save Pool Settings" button at the very
  bottom** and a success banner at the very top. On a laptop viewport the button
  is below the fold from most sections, and the confirmation banner is off-screen
  from the button, so a commissioner can save successfully and see nothing happen.

  Kevin's ask, verbatim in substance:
  1. **A save control in every section**, not just at the bottom.
  2. **Make it stand out** — dark green, or yellow that turns green on success.
  3. **Confirmation as a popup/modal as well as the banner** — "make it obvious".

  Notes for whoever builds it:
  - All sections submit the SAME payload through one `handleSaveSettings` →
    `dbService.updatePoolSettings`. Per-section buttons are a placement change,
    not N new save paths — do not fragment the payload.
  - `useToast` is already imported in this component (`toast.success` /
    `toast.confirm`), so the floating-confirmation half is close to free. Check
    whether `toast.success` is prominent enough before building a bespoke modal.
  - A **sticky save bar** is the obvious alternative to N buttons and is less
    code; if it tests better, propose it — but Kevin asked for per-section
    buttons, so that is the default unless he says otherwise.
  - Scope guard: this is presentation only. It must not change what
    `updatePoolSettings` sends, and must not reintroduce a client-direct
    `settings` write — `firestore.rules` denies those on NFL pools since #279.
  - Frontend-only ⇒ **needs the manual Coolify rebuild**, no functions deploy.
  - Classification: **ordinary change** — touches none of money / authorization /
    production data / scoring. No PLAN doc. Still takes all five gates + codex.

---

## 6. GAP ANALYSIS — not on any list until now

- ☐ **G1 · NOBODY SCORES A PRESEASON WEEK AUTOMATICALLY — still true, but the
  reason changed.** *(Updated 2026-07-25.)* A scheduled scorer now EXISTS:
  `nflAutoScoreJob` shipped in #276 and is deployed, and #279 added the
  concurrency + authorization guards §7 requires before arming it. **It is
  switched OFF** — `system/config.nflAutoScore` is unset and the gate is fail-safe.
  **Of the three prerequisites, ONE IS CLOSED and two remain** — HANDOFF's STOP
  POINT box carries the same count:
  1. **PR-B2 — BUILT AND DEPLOYED** (#311, 2026-07-27), but it must be WATCHED
     IN DRY RUN before live, **and the watch only counts if it SAW something**:
     arm `{ enabled: true, dryRun: true }` and read the heartbeat detail.
     `queuedEvents: 0` for a day — the normal case before the preseason starts —
     proves only that the scheduler wrapper runs and exercises none of the
     queue's read/group/no-ack path. The bar is **at least one event observed AND
     still in the queue afterwards** (a dry run acknowledges nothing, so it must
     survive). If none appears before the HOF game, flip `dryRun: false` only
     with this prerequisite explicitly named as unproven. Deployed is not
     proven.
  2. **`nflDeepSweep` live WITH WRITES** — a dry-run deep sweep does not write
     `nfl_games`, so a game finalizing >24h after kickoff is never observed.
     STILL OPEN.
  3. ✅ **The `publishedWeeks` cold-start backfill is CLOSED — and never needs
     running.** The prod dry run on 2026-07-27 returned
     `poolsScanned: 15, poolsChanged: 0, weeksMarked: 0, failures: []`. The
     migration queries ALL NFL-season-type pools with no season filter, so that
     zero covers the whole population: there are no legacy manually-scored weeks
     to stamp because the season has not started. **Do not click the destructive
     button — it is a no-op.** It stays closed on its own, because any pass that
     REVEALS a lock-closed result writes the marker — the manual "Score Week"
     button included, since it runs through the same `scoreNFLWeekInternal`. Note
     the precision: `publishedWeeks` is stamped only when `games.some(revealed)`
     is true, so a mid-week provisional click that reveals nothing does NOT mark
     the week. Scoring the completed HOF week does.

  So the pilot answer is unchanged: **Kevin clicks "Score Week N" per
  pool after each preseason slate**, and that must be ON the schedule (Sun/Mon).
  The regular-season decision is now "arm the scorer vs keep the manual ritual",
  not "build one".
  *Superseding: mmp-nfl-season-campaign §1.2's "still no automated weekly scoring,
  re-verified 2026-07-12" predates #276 and is stale.*
- ☐ **G2 · End-to-end reminder delivery has never been verified in prod.**
  We tuned cadence and windows, but no preseason pool with a real member has
  ever received a T-36h/T-4h email. Cheap test: K6's test pool with Kevin as a
  member, watch the `mail` collection + inbox at T-36h of week 1. (E2 makes
  failures *visible*; this verifies the happy path exists at all.)
- ☑ **G3 · App Check — DECIDED 2026-07-30: OUT for the season, accepted risk.**
  The decision was forced rather than deliberated. Someone set
  `VITE_RECAPTCHA_SITE_KEY` in Coolify to turn App Check on, and **production
  went down** — blank page, permanent spinner, confirmed from two independent
  machines and networks — until the variable was deleted and the site redeployed.
  ⛔ **Do not attempt this again before the pilot.** The warning
  `⚠️ SECURITY: App Check is NOT active` in the prod console is the SAFE state.
  ⚠️ **The set→dead, delete→alive correlation is solid; the CAUSAL STORY is not**
  — cross-model review showed the tracked `Dockerfile` has no build arg for that
  variable, so it has no known path into the bundle. That makes this a decision
  taken on an unexplained production kill, which is a *stronger* reason to defer,
  not a weaker one. HANDOFF's STOP POINT box carries the open question and the
  three candidate explanations.
  The accepted risk, stated plainly: App Check is enforced **nowhere** — 98
  `validated()` callables declare `appCheck: "monitor"` and zero declare
  `enforce`, plus 26 bare `onCall` sites that pass no App Check option at all —
  so the unauthenticated callables remain scriptable from outside the app by
  anyone holding the public Firebase config. That was already true all season;
  this decision does not add risk, it records that it is not being removed before
  08-06.
  Turning it on later needs **four** fixes, none of which is a console click:
  `nginx.conf` CSP is missing the reCAPTCHA hosts; `src/firebase.ts:27` wants a
  reCAPTCHA **Enterprise** key while the key that exists is **v3**; the web app
  was never registered in the Firebase console's App Check section; and the
  `Dockerfile` declares no build arg for the key, so the build cannot receive it.
  Full detail in HANDOFF's STOP POINT box. (`logClientError`'s
  `enforceAppCheck: false` from #142 stays off and is now consistent with
  everything else rather than an outlier.)
- ☐ **G4 · No load/limits check for game-day traffic.** Sunday load hardening
  exists from #101/aa67025, but nobody has stated expected preseason
  concurrency vs Firestore/functions quotas. Probably fine for a 10-commissioner
  pilot — say so explicitly rather than assume it. One paragraph in PICKUP
  after K8 sizes the pilot.
- ☐ **G5 · Restore has never been tested.** Even after K11 enables PITR, an
  untested backup is a hope, not a recovery plan. Schedule one dry-run restore
  of a single collection to a scratch project before the regular season
  (preseason optional but ideal).

---

## 7. Suggested calendar (working back from 08-06)

| When | What |
|---|---|
| **Now – Jul 26** | K1 start (watch dry-run reports) · K11 PITR click · K12 census · K13 sign-offs · K16 NotebookLM source · E1 begins after K12/K13 |
| **Jul 27 – Jul 30** | K1 arm · K2 watch→arm · K3 check Tuesday 07-28 · K5 doc cleanup · K6 create test pools · G2 reminder test rides on K6 · K8 recruit begins · E1 continues, E2 · **E6 settings-save UX** (small, frontend-only — land it before K6 so the test pools are created against the fixed screen) |
| **Jul 31 – Aug 4** | K4 spreads for HOF/wk1 · K7 pricing published · K9 messaging check · ~~G3 App Check decision~~ **(CLOSED 2026-07-30 — decided OUT, see §6 G3; do NOT reopen it this week)** · G4 sizing paragraph · E1 finishes → Kevin Recalculate |
| **Aug 6 (HOF)** | First live preseason game. Watch: heartbeats, lock tripwire, score sync. |
| **Aug 7–9** | **G1: score + finalize the HOF week** (manual clicks) · verify finalize sweep report |
| **Week of Aug 10** | K10 chaos drill during the 08-13 slate · G5 restore drill · K14 A3b decision for regular season |

---

*Maintenance: check items off here as they land; move durable decisions into
DECISION-LOG.md. This file dies after the preseason retro — the log is the
permanent record.*
