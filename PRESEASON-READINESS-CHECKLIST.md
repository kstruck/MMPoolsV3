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
  §2b now forbids checking it; codex (§2c, 5 rounds max) is its temporary
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
- ☐ **E2 · sendEmail / sendCourierSMS outcome plumbing** — runReminders cannot
  see delivery failures its helpers swallow; a run where every email failed
  still reports zero failed pools. Wants its own careful PR (member-paging
  path). *Source: PICKUP "best next engineering work".*
- ☐ **E3 · Scheduled Auth export** (PLAN-BACKUPS-PHASE3 step 6) — code,
  blocked on K11's bucket+IAM.
- ☐ **E4 · Bounded-query follow-up to #262** — composite index +
  orderBy(startTime).limit(1), a further ~10× on the reminder reads. Needs the
  index deployed AND built before code (the #223 lesson), and limit(1) changes
  min(week) semantics for postponed games — own argument. Low urgency now that
  reads dropped. *Source: PLAN-READS-RUNREMINDERS §4.*
- ☐ **E5 · #133 tailwindcss 4.x dependabot** — stale since 07-06; close or take
  deliberately (it's a major with real migration work). Low priority.

---

## 6. GAP ANALYSIS — not on any list until now

- ☐ **G1 · NOBODY SCORES A PRESEASON WEEK AUTOMATICALLY.** There is still no
  scheduled scorer: `scoreNFLWeek` is a manual per-pool button, and the finalize
  sweep only FINALIZES pools that were already scored. **For the pilot this is
  Kevin clicking "Score Week 1" per pool after HOF weekend — fine for a handful
  of test pools, but it must be ON the schedule** (Sun/Mon after each preseason
  slate), and the regular-season decision (build a scheduled scorer vs accept
  the Tuesday ritual for P pools × 18 weeks) should be made DURING preseason.
  *Evidence: mmp-nfl-season-campaign §1.2 ("still no automated weekly scoring,
  re-verified 2026-07-12").*
- ☐ **G2 · End-to-end reminder delivery has never been verified in prod.**
  We tuned cadence and windows, but no preseason pool with a real member has
  ever received a T-36h/T-4h email. Cheap test: K6's test pool with Kevin as a
  member, watch the `mail` collection + inbox at T-36h of week 1. (E2 makes
  failures *visible*; this verifies the happy path exists at all.)
- ☐ **G3 · App Check was disabled and never revisited** — enforcement on
  `logClientError` was turned OFF in #142 "until App Check is live" (2026-07-07)
  and nothing tracks turning it on. Decide: in or out for the season. If out,
  write it down as accepted risk; if in, it needs lead time (device attestation
  rollout breaks clients if rushed).
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
| **Jul 27 – Jul 30** | K1 arm · K2 watch→arm · K3 check Tuesday 07-28 · K5 doc cleanup · K6 create test pools · G2 reminder test rides on K6 · K8 recruit begins · E1 continues, E2 |
| **Jul 31 – Aug 4** | K4 spreads for HOF/wk1 · K7 pricing published · K9 messaging check · G3 App Check decision · G4 sizing paragraph · E1 finishes → Kevin Recalculate |
| **Aug 6 (HOF)** | First live preseason game. Watch: heartbeats, lock tripwire, score sync. |
| **Aug 7–9** | **G1: score + finalize the HOF week** (manual clicks) · verify finalize sweep report |
| **Week of Aug 10** | K10 chaos drill during the 08-13 slate · G5 restore drill · K14 A3b decision for regular season |

---

*Maintenance: check items off here as they land; move durable decisions into
DECISION-LOG.md. This file dies after the preseason retro — the log is the
permanent record.*
