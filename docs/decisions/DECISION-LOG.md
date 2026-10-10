# DECISION-LOG — March Melee Pools

**What this is.** The canonical, append-only record of decisions made and why,
important code changes and why, and completed work — so anyone (including us,
six months from now) can reconstruct *why the system is the way it is* without
re-deriving it from commits. Newest entries at the bottom of each era; add new
eras as they happen.

**How it's used.** This file is a NotebookLM source: add the repo (or this
file's GitHub URL) as a source in the MarchMeleePools notebook and re-sync
after significant merges. Then ask the notebook questions like "why is Stripe
commissioner-only?" and get a cited answer.

**Conventions.** Each entry: date · decision/change · **why** · evidence
(PR/commit/doc). "Kevin ruled" marks an owner decision; everything else is
engineering. Deeper detail always lives in the linked PLAN-*.md / PR.

---

## Era 0 — Origin (Dec 2025 – Jun 2026)

- **2025-12-06 · The app exists: React SPA + Firebase.** Initial commit;
  Dockerfile + nginx added the same day. Stack settled early: React/Vite/
  TypeScript frontend, Firestore + Cloud Functions backend, **no** Supabase/
  Postgres/Next.js. Evidence: first commits.
- **~Dec 2025 · Prod frontend serves from Coolify (self-hosted, nginx), NOT
  Firebase Hosting.** firebase.json hosting config remains but does not serve
  prod. Consequence that recurs all through this log: **pushing to `main` does
  NOT deploy the frontend — a manual Coolify trigger is required.** Evidence:
  Dockerfile/nginx.conf; mmp-deploy-and-operate skill.
- **Standing money model (predates the log): Stripe is for COMMISSIONER HOSTING
  FEES ONLY.** The platform never touches participant money; entry fees are
  peer-to-peer honor system. **Why:** keeps the platform out of money-
  transmitter territory. Every later billing/revenue feature honors this line.
- **Jan–Mar 2026 · First real seasons operated:** NFL playoff pools (Jan) and
  March Madness bracket pools (Mar). These are REAL pools with real users —
  which later (2026-07-24) becomes the reason stats can't use a date cutoff.

## Era 1 — The security + audit foundation (early Jul 2026)

- **2026-07-02 · #96 Critical payment-bypass, authz and scoring-integrity holes
  closed.** First of the big security passes. **Why:** an external-facing money
  product cannot ship the season with client-trusted paths.
- **2026-07-02 · #97 Player PII moved off the public pool doc** (H1) into
  `pools/{id}/squarePrivate/*` readable only by owner/manager/SUPER_ADMIN.
  **Why:** contact info was world-readable on public pools.
- **2026-07-02 · #102 Functions runtime → Node 22.**
- **2026-07-03 · #109/#110 UX overhaul phases 0–4** (pick safety, deadline
  honesty, money trust, season retention). Driven by a full UX audit whose
  verdict was "inconsistent".
- **2026-07-03–05 · #111–#129 Super-admin overhaul (T1–T14).** Highlights and
  the durable decisions:
  - **Canonical role model + BANNED enforcement** (#114, T6): authz authority is
    the **custom claim**, not the user doc.
  - **Money-adjacent admin writes go through audited callables** (#122), and
    destructive admin actions write an **audit trail** (#125). **Why:** operator
    accountability; also becomes the substrate for later heartbeat/ops work.
  - **`closePool` + `autoClosePools` establish the HOUSE PATTERN for scheduled
    jobs: kill-switch (`system/config.<job>.enabled`) + dry-run default**
    (#126/#127). Every scheduled mutation added since follows it.
  - **Platform revenue ledger split honest** (#113): platform income (Stripe)
    reported separately from pool volume (P2P).
- **2026-07-04 · #116 Brand design system applied app-wide; #117 unified
  create-pool wizard** (one shell, 7 pool types) after a 5-round codex-reviewed
  plan. Old per-type wizards deleted.
- **2026-07-04 · #118 `admin.firestore.{Timestamp,FieldValue}` namespace bug
  swept — 79 sites / 28 files.** **Why:** v2 SDK namespace change broke writes.
- **2026-07-05 · #120 The clobber incident + guard.** A merge silently reverted
  the super-admin overhaul; restored and a **clobber-guard invariant test**
  added. **Lesson that stuck:** worktree isolation discipline; never trust a
  merge visually. (mmp-change-control rule 4.)

## Era 2 — Product build-out (Jul 6–12)

- **2026-07-07 · #144 Buy-flow overhaul** (pricing UX, coupons, bundles,
  monetization accounting). Decision closed: What-If stays Bracket-only.
- **2026-07-07–08 · #146–#152 In-app Test Suite made honest** (simulator steps
  surface failures; bracket runner field mismatch fixed).
- **2026-07-08 · #150 NFL Phase 2 engine wave:** membership gate, `seasonType`
  on pools, dual-MNF tiebreakers, idempotent rescore. ATS declared **V2 /
  unimplemented** — spreads gate submission but never affect scoring.
- **2026-07-09 · #153 Player Profiles** end-to-end: per-pick results, finalize
  lifecycle (`finalizedAt`, `scoredThroughWeek`), payouts/Profit surfaces,
  `publicProfiles/{uid}` projection. **Why "recorded figures":** money is P2P,
  so profit is *recorded*, not custodial.
- **2026-07-10–12 · #156–#163 NFL sim harness (Phases 0–6).** Synthetic
  `sim-`-namespaced pools/users/games exercise the REAL create/score/finalize
  paths; stranded-run sweep; **the firestore.rules `sim-` backdoor was REMOVED**
  (#162). **Why:** preseason confidence needs end-to-end rehearsal that cannot
  touch real data.
- **2026-07-12 · #164/#165 Security Phase 1: `validated()` trust-boundary
  wrapper, all 41 TARGET-NOW callables retrofitted** with zod schemas at the
  boundary. **Why:** every callable previously trusted client-shaped input.

## Era 3 — Observability + the callable fleet (Jul 16–19)

- **2026-07-16 · #166 Stripe webhook durability** — failure state persisted,
  async/PI failure events handled.
- **2026-07-17 · #171 Phase 2 observability (#8–14):** Sentry frontend spine,
  correlation ids, business-failure monitoring, ops alert dispatcher
  (email+SMS), `readiness` endpoint, Ops Health UI, SLOs. #173: readiness OOM
  at 128MiB → 256MiB.
- **2026-07-18–19 · #176–#220 The SWEEP-LATER fleet: 17 batches, all remaining
  callables behind `validated()`.** Gotcha recorded for posterity: **no-input
  callables must preprocess `null` → `{}`** (#181). Fleet complete per #220,
  with the overclaim corrected in #222.
- **2026-07-18 · #190/#193 `backfillPools` was dangerous** — now gated behind
  dry-run defaulting true, and no longer resets COMPLETED pools to DRAFT.
  2026-07-19 prod audit (#216): **no damage had occurred.**
- **2026-07-19 · #217/#218 Two silent-failure classes found:**
  `syncPlayInPicks` was defined but never exported (SuperAdmin button called a
  function that did not exist), and `--only functions:a,b,c` deploy syntax
  silently shipped 1 of 33 functions while printing success. **Standing rule:
  bare `--only functions`, never the comma list.**

## Era 4 — NFL preseason pilot hardening (Jul 18–21)

- **2026-07-18 · PLAN-NFL-PRESEASON-PILOT (A1–A12) locked.** A1 proved the ESPN
  2026 preseason feed viable (naive `?week=&seasontype=` silently falls back to
  2025 — importer guards by calendar date-range).
- **2026-07-18 · A2 #205 `lockNFLSpreadsJob` kill-switched, exported** (it had
  never deployed); **A3a #207 pre-kickoff spread-lock tripwire** that pages ops;
  **A4 #206 45-fixture emulator matrix gates every PR**; **A5p1 #209 ESPN feed
  snapshots + stat-correction detection**; **A6 #210 finalize sweep scoped so it
  can be armed preseason-only** (`liveSeasonTypes: [1]` required — `dryRun:
  false` alone deliberately does nothing); **A10 #208** postponed-game behavior:
  waits forever BY DESIGN, now says so instead of waiting silently.
- **2026-07-18 · #214 SPREADS_NOT_LOCKED scoped to pools whose scoring uses
  spreads.** **Why:** the gate was blocking pick submission for pools that
  never read spreads (NFL-1, the genuine pilot blocker).
- **2026-07-20 · #223 THE TEN-DAY SILENT FAILURE.** `nflFinalizeSweepJob` threw
  FAILED_PRECONDITION daily since 07-10 — a missing composite index — with zero
  audit entries. **Lessons institutionalized:** (1) an index must be deployed
  AND built before dependent code; (2) "armed" ≠ "working" — verify a job by
  what it PRODUCED. Led directly to:
- **2026-07-20–21 · #227/#245/#250 Heartbeats for the entire scheduled fleet**
  (`system/heartbeats`, per-job verdicts, "never ran" distinguishable from
  "ran and failed"), later refactored to pure tested verdict functions (#256).
  Cry-wolf calibration explicit: quiet windows are healthy, tolerance 3× the
  job interval.
- **2026-07-21 · #239 Dead tournaments synced every 10 minutes forever — fixed.**
  (First of the two big Firestore-reads fixes.)
- **2026-07-21 · Kevin ruled: the target is the HALL OF FAME GAME, 2026-08-06
  (Thu 8pm ET)** — not the 08-13 slate (#253). Cadence ruling with it: **one PR
  at a time**, all five gates, codex review each. **Why:** a 12-PR batch night
  had produced 12 self-inflicted defects, every one caught by external review
  and none by self-review → **cross-model review became a hard rule**
  (CLAUDE.md §2c). qodo went billing-blocked the same week; codex became the
  only reviewer.
- **2026-07-21 · #248 docs-state invariant:** operator docs must carry exactly
  one tagged deployed-SHA claim each, agreeing, real on origin/main. **Why:**
  "which SHA is deployed" had been wrong three separate times.

## Era 5 — Rulings, timezones, stats groundwork (Jul 22–23)

- **2026-07-22 · #255 BANNED-owner authz gap CLOSED in prod:**
  `recordPoolPayouts` / `simulateGameUpdate` / `simFillSquares` authorized from
  persisted pool ownership and never consulted role — all three now call
  `assertNotBannedLive`. (The one 07-21/22 finding that fired the new
  plan-gate.)
- **2026-07-22 · Kevin ruled: all wall-clock scheduled jobs pinned to
  America/New_York** (#259). Seven daily jobs had silently run in UTC — how the
  finalize sweep got documented at 08:30 while running 04:30 ET. Ratchet test
  enforces the pin.
- **2026-07-22 · Kevin ruled: the PLAN-*.md gate is scoped to BLAST RADIUS, not
  file count** (#260): a plan is required when a change touches **money,
  authorization, production data, or scoring** — and not otherwise. **Why:** the
  old "any 2+ file change" rule was systematically ignored (0/16 recent PRs
  complied); rules nobody can follow protect nothing.
- **2026-07-22/23 · Stats integrity investigation (PLAN-STATS-INTEGRITY §1–§5).**
  Kevin reported Overview stats "seem high". Two codex review rounds on the
  PLAN DOC (before any code) found five independent reasons the obvious fix
  writes wrong numbers over a world-readable money doc — among them: the
  Overview reads client-computed `liveStats`, not `stats/global`;
  `calculatePoolPot` returns **0** for NFL and Props pools; NFL "paid" truth
  lives in Member Records, not entry docs. **Nothing was built** — deliberate.
- **2026-07-23 · #261 The public profile was the only route with no
  header/footer** — fixed with a route-chrome invariant test.
- **2026-07-23 · #262 THE 1.4M-READS/DAY MYSTERY SOLVED — measured, not
  guessed.** The flat ~1.4M/day Firestore reads plateau since Jul 2 was
  `runReminders` pulling the whole remaining NFL season (305 docs) **once per
  NFL pool every 5 minutes** to compute one integer (~966K reads/day). Two
  confident code-reading hypotheses (`syncGameStatus`, `autoLockPools`) were
  killed by Cloud Logging first — both read ZERO pools. Query Insights named
  the real one. Fix: memoize per (season, seasonType) per run; codex caught two
  regressions in the fix itself (typed cache key — Firestore equality is
  type-sensitive; evict rejected promises). **Lesson: measure with Query
  Insights/logs before believing code-reading.**
- **2026-07-23 · Kevin answered stats Q1/Q5/Q6:** no real Stripe checkout ever
  hit a test pool (platform revenue clean); NFL "real volume" =
  `scoredThroughWeek >= 1`; count from 2026-09-09 (later revised — see Era 6).
  Preseason pools are **Kevin's testing only** and never count toward stats.

## Era 6 — Cadence, deploy fires, the final stats plan (Jul 23–24)

- **2026-07-23 · Kevin ruled: `runReminders` cadence 5min → 15min** (#265).
  Reminder tiers are hour-granularity windows; 5-min polling bought nothing and
  cost 3× the reads. **Codex caught a real regression in the change:** BRACKET
  lock reminders used 12-minute windows and fire exactly once (dedupe) — at
  15-min polling a window could fall between polls and the reminder would
  NEVER send. Windows widened to 24 min with a polling-simulation guard.
  **Rule recorded in code: every one-shot reminder window must be wider than
  the poll interval.**
- **2026-07-23 · Two deploy fires, both from `functions/.env`:** (1) stray
  todo-note lines broke dotenv parsing, blocking ALL deploys; (2)
  `STRIPE_SECRET_KEY` present as a PLAIN env var overlapped the `defineSecret`
  Secret-Manager secret → HTTP 400 on `createCheckoutSession` /
  `handleStripeWebhook`. **Resolution + rule:** `functions/.env` is comment-only;
  no `defineSecret` name may ever appear in it; each affected function needed an
  ISOLATED redeploy to clear the overlap (bulk deploys kept failing it).
  Payments were never down — the old good versions kept serving.
- **2026-07-23 · Reviewer outage both sides, then fixed:** qodo billing-blocked
  (since 07-21); codex hit its ChatGPT-plan rate limit, then after switching to
  API-key auth lost access to the configured `gpt-5.6-sol` model. **Kevin
  ruled 2026-07-24: codex uses `gpt-5.6-terra`** (cheaper, API-accessible) —
  config updated, verified working (it immediately caught 3 real findings on
  the morning doc).
- **2026-07-24 · Frontend caught up:** Coolify rebuild ran; profile fix
  verified live (header/footer render, bundle hash changed). Reads drop
  verified by Kevin on the usage graph. Functions and frontend both at
  `49c12a9`.
- **2026-07-24 · Kevin answered stats Q2/Q3/Q4 — and Q4 REVERSED the date
  cutoff.** All-time totals with per-season filtering (Q2); `stats/global`
  stays world-readable with a per-user "hide" (Q3 — interpreted as a profile
  visibility toggle, pending confirmation); totalUsers/totalPools NOT date-
  gated because playoffs + March Madness pools are real and predate 2026-09-09
  (Q4). **Consequence:** the discriminator is "is this a TEST pool"
  (`isSimPool` OR NFL `seasonType == 1`), not "when was it created".
  PLAN-STATS-INTEGRITY §8 is the approval-ready plan (PR #267): census first,
  then six PRs A–F, recalculate last.
- **2026-07-24 · Doc hygiene:** PLAN-LOOPS.md deleted (superseded — all 5
  loops became `mmp-loop-*` skills); HARNESS-MODEL-AUDIT-2026-07-16 harvested
  (2 stale memory files archived, model-tiering note retired) and archived.
- **2026-07-24 · Kevin directed: decisions/changes/tasks get housed for recall
  in the MarchMeleePools NotebookLM notebook.** This file is the mechanism:
  repo-canonical log, NotebookLM ingests it as a source (NotebookLM has no
  write API — verified; the installed `notebooklm` skill is query-only).

## Era 7 — Commerce model recorded, scope rejections written down (Aug 2026)

*This era is thin on purpose: the log went quiet after 2026-07-24 while the
work moved into `PLAN-*.md` files and `HANDOFF.md`. These are the decisions from
that stretch that belong here rather than in a plan, because they close
questions rather than open work.*

- **2026-08-24 · Option A recorded: commerce is ONE-TIME ONLY. Recurring
  billing is intentionally out of scope.** Every paid surface — pool
  activation, Credit Bundles, the Unlimited Pass, per-pool add-ons — is a
  single charge. **Why:** the money boundary (Stripe = commissioner hosting
  fees only) is the product's legal posture and recurring billing is the
  doorway away from it; the product is seasonal, not monthly; and dunning,
  proration, cancellation and the `invoice.*`/`customer.subscription.*` webhook
  classes are a machine a solo operator should not be running. **Evidence:**
  both Checkout sessions are `mode: "payment"` (`functions/src/stripe.ts:609`,
  `:689`), `mode: "subscription"` appears nowhere in `functions/`, the webhook
  has no subscription event branch, and the Unlimited Pass stamps a one-off
  `termEndsAt` that simply expires (`stripe.ts:790-792`). Already a non-goal in
  `PLAN-BUYFLOW-OVERHAUL.md:143`; promoted here to a standing decision.
  Detail: [DECISION-COMMERCE-MODEL.md](DECISION-COMMERCE-MODEL.md) §1.
- **2026-08-24 · Three external review suggestions REJECTED, with reasoning on
  the record.** (a) **Organizations / multi-org tenancy** — the Pool already IS
  the tenancy unit and `firestore.rules` enforces it (`:101-112` pool-read
  scoping, `:142-144` `isPoolManager`, `:411-416` `isPoolParticipant`,
  `:173-188` server-owned `participantIds`/`coManagers`); an org tier is a B2B
  pivot, not a hardening. (b) **Recipient-bound single-use invite tokens** —
  the invite email carries the *share* link, not a token
  (`functions/src/invites.ts:80-82`), that link is built to be re-shared and
  gets an OG preview for crawlers (`functions/src/joinPreview.ts:26-46`), and
  authorization lives on the gate (`isPublic` + PBKDF2 pool password) rather
  than in the forwardable artifact. (c) **A RateLimit HTTP headers program** —
  its useful half is absorbed by `PLAN-COST-CONTROLS.md` **Phase 2**
  (enforcement: per-user+pool and per-pool quotas, kill-switch, circuit
  breaker) on **Phase 1**'s attribution, at per-pool rather than per-org
  granularity; the header surface itself is wrong for a callable-based API.
  Detail: [DECISION-COMMERCE-MODEL.md](DECISION-COMMERCE-MODEL.md) §2.

---

## Standing rules distilled (the ones that keep earning their keep)

1. **Kill-switch + dry-run default** on every scheduled mutation; arming is a
   deliberate two-flag act (`enabled` + e.g. `liveSeasonTypes`).
2. **Verify by what a thing PRODUCED, not what it claims.** "Armed" ≠ "working";
   `✔ Deploy complete!` ≠ deployed; a green suite ≠ a guard that bites — every
   new guard is mutation-tested (revert the fix, watch it fail).
3. **Cross-model review before merge** (codex; expect multiple rounds; absorb
   or reject each finding with written evidence). Born from 12 defects in one
   night, all caught externally, none by self-review.
4. **PLAN-*.md gate fires on blast radius:** money, authz, prod data, scoring.
5. **Deploy ritual:** `npm --prefix functions ci` (never `install`), bare
   `--only functions`, explicit `--project`, functions before rules; frontend
   is a manual Coolify trigger.
6. **Measure before believing code-reading** — Query Insights and Cloud Logging
   have overturned confident hypotheses twice.
7. **Stripe = commissioner hosting fees only.** Participant money never touches
   the platform.
8. **docs-state invariant:** deployed-SHA claims are tagged, agreeing, and real.
