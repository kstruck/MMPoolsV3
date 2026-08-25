---
name: mmp-product-frontier
description: "Use when deciding WHAT to work on next in March Melee Pools, evaluating a new feature/refactor idea, asking 'what are the open problems', 'what should we build', 'is X worth doing', 'has this been tried before', or starting any investigation/experiment/spike. Contains (A) the research methodology that turns a hunch into an accepted change here (evidence bar, idea lifecycle, where good ideas historically came from) and (B) the ranked frontier of open problems — NFL automation, ADR-0001 completion, billing turn-on, SuperAdmin dashboard, backup/DR, test-pool hygiene, AI Commissioner — each with first steps and a falsifiable milestone. NOTHING in part B is committed roadmap; everything is candidate/open."
---

# MMP Product Frontier — open problems + how ideas become changes here

Repo: `D:\march-melee-pools` (March Melee Pools / Gridiron Gamble — React 19 + Firebase sports-pool platform, prod project `gridiron-gamble-uzuqo`). All volatile facts below are **as of 2026-07-06** unless stated otherwise.

Two halves:

- **Part A — Methodology.** The discipline that has actually worked in this repo. Follow it or your change will be rejected, reverted, or (worse) silently clobbered.
- **Part B — Ranked frontier.** Open problems worth working on. Every entry is labeled **CANDIDATE** — none is committed roadmap. **Do not start any of them without Kevin's explicit go-ahead.** A `PLAN-*.md` is additionally required when the item touches money, authorization, production data or scoring (`mmp-change-control` §1) — which is most of Part B, but not all of it, and file count is not the test (ruling 2026-07-22).

## When NOT to use this skill

| You actually need | Go to sibling skill |
|---|---|
| How to classify/gate a change; the 4 non-negotiable discipline rules | `mmp-change-control` (canonical home of the rules; Part A here cross-references them) |
| What already broke and why (incident chronicle) | `mmp-failure-archaeology` |
| Triage of a live symptom right now | `mmp-debugging-playbook` |
| Deploy commands, Coolify, scheduled jobs | `mmp-deploy-and-operate` |
| The executable NFL-season readiness campaign | `mmp-nfl-season-campaign` |
| PLAN/AUDIT/review-log templates and house style | `mmp-docs-and-writing` |
| Test commands, evidence bar for QA specifically | `mmp-validation-and-qa` |
| Admin 8-tab contract, sim- backdoor status | `mmp-superadmin-surface` |
| Load-bearing design decisions + invariants | `mmp-architecture-contract` |
| Pool scoring math and lifecycle semantics | `mmp-pools-domain-reference` |

---

# PART A — METHODOLOGY

## A1. The evidence bar

A hypothesis is accepted in this repo only when:

1. **One mechanism explains ALL observations — including the negatives.** If your theory explains the 8 failures but not why 2 tests pass, it is wrong or incomplete. Real repo example (`TEST-SUITE-BACKLOG.md`): a live Test Suite run showed 2 pass / 8 fail / 5 error right after a rules deploy. The lazy theory ("the tightened `sim-*` rules broke entry writes") was killed by a negative observation: `bracketE2ESimulator` passes — it creates AND scores entries under the same deployed rules — so the rule cannot be the mechanism. The failures split into two real mechanisms (schema drift, fixed in PR #141; a swallowed addDoc error in `bracketSimulator.ts:166-190`, parked with the discriminating next experiment written down).
2. **The hypothesis predicts numbers/behavior BEFORE the experiment runs.** Write down what you expect to see, then look. The `autoClosePools` pattern (`functions/src/autoClosePools.ts`) is this codified: the job runs in dry-run and REPORTS "would close N pools"; only after an admin reviews the predicted N against reality for a week does `dryRun:false` get set. The Phase-0 deploy runbook (`PHASE0-DEPLOY-CHECKLIST.md`) does the same for UI: each smoke test states the exact expected behavior ("no white-screen", "not 'undefined @undefined'") before anyone clicks.
3. **"Verified" means executed, not estimated.** House convention from the audits: mark what you could not check as UNVERIFIED explicitly ("Toolchain is green (all executed, not estimated)"). No "done" without the command + its output. A wrong runbook is worse than none.

Corollary that has bitten this repo twice: **check the premise before building on it.** The wizard-unification plan's round-1 premise (a client-write hole) turned out to be already fixed — the adversarial review caught it and the whole plan was rebased (`PLAN-REVIEW-LOG.md`, round 1). The SuperAdmin restore plan's assumed baseline ("setUserRole survived the clobber") was factually wrong — Step 0 became "re-audit the baseline before restoring anything" (`PLAN-SUPERADMIN-RESTORE.md` Step 0, `CLOBBER-AUDIT.md`).

## A2. The idea lifecycle

Every **plan-gated** change follows this pipeline — money, authorization, production data or scoring (`mmp-change-control` §1; file count alone does not trigger it, ruling 2026-07-22). Skipping stages is how the clobber incident happened (merged work silently reverted by two follow-on PRs, invisible to CI twice — see `mmp-failure-archaeology`).

| Stage | What you do | Artifact |
|---|---|---|
| 1. Hunch | State the claim + the observation that triggered it | a sentence, not code |
| 2. Archaeology | Read `mmp-failure-archaeology` + the `PLAN-*-REVIEW-LOG.md` files. **Do not re-fight settled battles** (list in A4). Check whether the premise is still true in current code — grep it, don't trust docs | notes with file:line cites |
| 3. Plan | Write `PLAN-<name>.md` at repo root: goal, approach, phases, per-phase evidence criteria. Terms per `CONTEXT.md`. Template conventions in `mmp-docs-and-writing` | `PLAN-*.md` |
| 4. Adversarial review | Run the plan through adversarial review rounds (Codex; judgement up to 10 rounds, Kevin's sign-off with a reason past that — CLAUDE.md §2c. Logs predating 2026-07-27 used MAX_ROUNDS=5); log every round verbatim with severity-ranked findings + accept/reject + how the plan changed | `PLAN-*-REVIEW-LOG.md` |
| 5. Sweep | Deterministic grep sweeps to close enumeration gaps (complete instance lists, not finding-by-finding whack-a-mole) | e.g. `PLAN-SUPERADMIN-CONTROL-SWEEPS.md` |
| 6. Proceed gate | Kevin signs off. No implementation before this | explicit go-ahead |
| 7. Implement | Own git worktree, own branch. Prod-data mutations ship behind a kill-switch, dry-run default (`autoClosePools` is the reference implementation). Deploy ritual per `mmp-deploy-and-operate` | commits, per-phase status checkmarks written back into the PLAN |
| 8. Verify + promote | State the evidence (command + output) per phase. Deploy checklist with expected outcomes. Flip the kill-switch only after dry-run output matches predictions | updated checklist, "DONE + verified" entries |
| 9. Or: documented retirement | If the idea dies or parks, write down WHY, with the discriminating evidence and the next experiment — so no future session re-derives it | e.g. `TEST-SUITE-BACKLOG.md` ("parked bugs" with sites + next steps), rejected-approaches entries in review logs |

The four non-negotiable discipline rules (kill-switch+dry-run, deploy ritual, plan→review-log→sweep gate, worktree isolation) are canonically documented in `mmp-change-control`. Rules 1, 2 and 4 apply to every frontier item below; Rule 3 (the plan gate) applies to those touching money, authorization, production data or scoring — see `mmp-change-control` §1 for the triggers.

### Worked example: the full lifecycle, end to end (autoClosePools, T2)

The one change that traversed every stage cleanly — use it as the template:

1. **Hunch** (audit observation): months-old pools stuck "open" in prod; nothing ever closes ANY pool type (`autoLockPools` handles only SQUARES/BRACKET).
2. **Archaeology**: discovered three coexisting status vocabularies (`DRAFT/OPEN/LOCKED/COMPLETED` vs `isLocked`/`scores.gameStatus` vs per-week NFL locks) — so a naive "set status=CLOSED" sweep would corrupt derived state.
3. **Plan**: ticket T2 in `AUDIT-REPORT-PRESEASON.md` → `PLAN-SUPERADMIN-OVERHAUL.md`.
4. **Adversarial review**: 5 Codex rounds hardened the design — dual-write legacy fields, `closedVia:'ADMIN_CLOSE'` marker, trigger suppression (`onPoolLocked`, `onGameComplete` must NOT fire on an admin close), `recalculateGlobalStats` exclusion, CANCELED-is-terminal precedence.
5. **Implement with a kill-switch + dry-run default**: `functions/src/autoClosePools.ts` — does nothing unless `system/config.autoClose.enabled === true` (default OFF, config-read failure = disabled); reports-only unless `dryRun` is explicitly `false`; conservative eligibility (requires an over-signal — `isFinal` or `scores.gameStatus === 'post'` — never a date guess); `MAX_PER_RUN = 200` safety cap; closes via the same shared `adminCloseUpdate` a manual close uses, so guards fire identically.
6. **Verified promotion**: dry-run reports reviewed against predictions, then enabled. **As of 2026-07-06 (owner interview): LIVE past dry-run — it actually closes pools daily.** Do not re-run its backfill logic manually; it owns that job now.

Contrast with the anti-example: the T1–T14 overhaul skipped no stages but was still destroyed post-merge by the PR #116/#117 clobber — which is why stage 8 verification now includes the admin-surface invariant regression test and the "long-lived branches merge latest main and re-verify before PR" rule. Process discipline protects the pipeline; the invariant tests protect the output.

## A3. Where good ideas historically came from: the AUDIT→PLAN pattern

Every major improvement cycle in this repo started as an **audit or live walkthrough of prod**, not a brainstorm. Verified doc pairs (all at repo root):

| Audit (evidence) | Plan it produced | Proof of pairing |
|---|---|---|
| `AUDIT-REPORT-PRESEASON.md` (2026-07-03, tickets T1–T14) | `PLAN-SUPERADMIN-OVERHAUL.md` | Plan header: "Full evidence in AUDIT-REPORT-PRESEASON.md; tickets T1–T14 defined there" |
| `CLOBBER-AUDIT.md` (what PRs #116/#117 silently reverted) | `PLAN-SUPERADMIN-RESTORE.md` | Plan Step 0: "Clobber audit (re-baseline before restoring anything)"; "Verified clobber inventory on `main` today" |
| `SUPERADMIN-AUDIT-REPORT.md` (2026-07-05 live prod walkthrough, reproduced the app-wide crash) | `PLAN-SUPERADMIN-CONTROL.md` | Plan header: "Compiled 2026-07-05 from a live production walkthrough + four parallel code reviews" |
| Full UX audit 2026-07-02 | `PLAN-UX-OVERHAUL.md` | Plan line 3: "Source: full UX audit (2026-07-02)" |

Implication for you: when asked "what should we improve," the highest-yield move is **a fresh audit of the actual prod surface** (walkthrough with real clicks, or code audit with file:line evidence), not ideation. The walkthrough that found the `SimulationDashboard .squares` app-wide crash was done by clicking around prod as a super admin.

## A4. Settled battles — do not re-fight without new evidence

Each of these was adjudicated in a review log. Re-proposing them without new facts wastes a review cycle.

- **Trial-default billing** — rejected mid-execution: stamping `trial` would switch on the dormant grace→lock funnel for every pool and email commissioners. Pools stamp `free` (`functions/src/lib/poolCreation.ts:57-59`).
- **Naive removal of the `sim-` rules branch** — breaks the Test Suite. Interim state (live): tightened to `isSuperAdmin()` (`firestore.rules:93`). Full removal is gated on a server-side simulator API (see B-2 dependency notes).
- **Partial role rename** — rejected repeatedly: canonical queries would silently miss legacy `PARTICIPANT`/`POOL_MANAGER` docs. One deliberate migration (plan 5.6) or nothing.
- **npm workspaces** for the shared/ folder — rejected ("Windows + Firebase deploy friction; boring over clever"). The predeploy copy (`functions/scripts/copy-shared.mjs`) is the accepted mechanism.
- **A single shared DEFAULT_FLAGS module** — impossible (incompatible TS roots); duplicated defaults + CI parity test is the accepted design.
- **Building real backends for the fake Overview cards** — rejected: "Delete fake cards rather than build real equivalents... honesty over feature count." The bento is now 2 real cards.
- **SSR/marketing-SSG migration** — rejected this cycle as unnecessary post-SEO-fixes.
- **Hand-rolled scoring backfill logic** — `fixPoolScores` originally duplicated `processGameUpdate` manually and failed (`FIX_INSTRUCTIONS.md`); the accepted pattern is: reuse the proven engine path, never re-implement it.
- **Platform touching participant money** — permanently settled, not a review-log matter: Stripe is for commissioner hosting fees ONLY; entry fees are P2P honor system between members and commissioners. Never propose otherwise.

---

# PART B — RANKED FRONTIER

Every entry: **status CANDIDATE / open problem.** Ranking reflects verified reality as of 2026-07-06 (first NFL live season imminent; PR #139 merged with functions + rules deployed; billing free-by-default BY DECISION 2026-07-03). Re-verify status with the commands in the Provenance section before acting — these go stale fast.

## Summary and dependency map

| # | Problem | One-line state (2026-07-06) | Gate |
|---|---|---|---|
| B-1 | NFL season automation | No scheduled scorer; `lockNFLSpreadsJob` written, never exported; first live season ever | Season clock — see `mmp-nfl-season-campaign` |
| B-2 | ADR-0001 server consolidation | Shared schemas + billing stamping live; thin delegates/`publishPool` NOT on main; worktree said to hold the rest is missing from this machine | Engineering only |
| B-3 | Billing turn-on | All create paths stamp `free`; enforcement scheduler reads a DIFFERENT config doc than the admin UI writes | Kevin's policy decision (the config unification is decision-independent but still gated via mmp-change-control — billing file) |
| B-4 | SuperAdmin dashboard rebuild | Overview bento: 2 real cards, theater deleted; `SuperAdmin.tsx` still a 4,380-line monolith with residual mocks in Loyalty/Playoffs | Engineering only |
| B-5 | Backup / DR | Nothing exists — no export job, no restore runbook, PITR state unknown | Console access (Kevin/gcloud) for step 1 |
| B-6 | Test-pool hygiene | No `isTestPool` flag; test data identifiable only by fragile name conventions in prod Firestore | Best done with/after B-2's simulator API |
| B-7 | AI Commissioner expansion | 3 live triggers + Test Suite callables; Squares-only explanations; stale `gemini-1.5-flash` fallback; usage unmeasured | Measure usage first |

Dependencies worth respecting when sequencing:
- **B-2 unblocks two others**: the Phase-2 simulator server API (which finally deletes the `sim-` rules branch) is planned around a unified create path, and B-6's flag stamping wants to land in those callables — doing B-6 before B-2 means stamping `isTestPool` in places that are about to be rewritten.
- **B-3 step 1 (config unification) is independent** of the policy decision and removes a landmine cheaply — but it touches a billing file, so it still goes through the mmp-change-control gate; steps 2-3 are paper-only until Kevin flips.
- **B-5 gets MORE urgent as B-1 goes live**: automated jobs mutating prod weekly with no backup is a worse position than manual ops with no backup.
- **B-1 outranks everything on the calendar**: it is the only item with an external deadline (2026 NFL season kickoff).

How to pick, given a free session: (1) anything Kevin explicitly asked for wins; (2) otherwise the cheapest step of the highest-ranked unblocked item — e.g. B-3 step 1 or B-5 step 1 are single-session, low-risk, high-information moves; (3) never start a frontier item that touches money, authorization, prod data or scoring without the A2 lifecycle (plan + review log + sign-off). When in doubt, run a fresh audit (A3) instead of guessing — audits are how every prior cycle found its real work.

## B-1. NFL season automation — CANDIDATE, rank 1

**This is a pointer entry: the full decision-gated campaign lives in `mmp-nfl-season-campaign`. Load that skill for any actual NFL-readiness work.**

Why it's rank 1 here: NFL pools have **never operated a live season** — the 2026 season is the first (owner interview 2026-07-06). Verified current state: `scoreNFLWeek` is a manual per-pool/per-week callable (`functions/src/nflPools.ts:537`, exported at `index.ts:40`); `lockNFLSpreadsJob` is written as a scheduled function (`functions/src/nflSchedule.ts:301`) but **never exported from `functions/src/index.ts`** (line 39 exports only `syncNFLScoresJob, importNFLSchedule`) — so it has never been deployed. Docs describe automated behavior (survivor auto-strikes after MNF, etc.); the code requires a human to score every pool every week. That gap is the project's hardest live problem.

**You have a result when:** a full NFL week (lock → play → score → standings) completes in prod with zero manual callable invocations, and the dry-run reports predicted the exact pools/weeks acted on. Defined properly in `mmp-nfl-season-campaign`.

## B-2. ADR-0001 server consolidation completion — CANDIDATE, rank 2

**Why it matters:** three divergent create callables means every create-path fix lands (or drifts) in three places, and the SuperAdmin Phase-2 simulator server API is planned around a single validated create path. Schema drift already caused live failures: PR #141 fixed `shared/schemas/squares.ts` (`gameId .optional()` rejected explicit null) and `bracket.ts` (scoringSystem enum missing ESPN/FIBONACCI) after the Test Suite failed against prod.

**Why current state fails (verified on `main`, 2026-07-06):** `docs/adr/0001-unified-createpool-callable.md` (Status: Accepted) calls for unified `createPool` + `publishPool` + thin delegates. Reality: partial. The shared zod `CreatePoolInput` schemas exist and gate all three paths, and all three stamp `billing: freeBilling()` server-side — but `createBracketPool` (`functions/src/bracketPools.ts:20`) and `createNFLPool` (`functions/src/nflPools.ts:40`) remain **full independent implementations** with `validateCreateInput` bolted on, and `publishBracketPool` (exported `index.ts:23`) has not become a generic `publishPool`.

**Merge state (corrected 2026-07-06):** `origin/feat/wizard-unification` has **0 commits ahead of `main`** — fully merged via PR #117 (client cutover `8291a0d` deleted the 4 old wizards; server shared core `lib/poolCreation.ts` and the Playwright e2e suite landed in the same merge). The `D:\mmp-wizard` worktree was removed after the merge; nothing survives outside `main` because nothing needed to. The thin-delegate/envelope/`publishPool` work was **never implemented** — this is greenfield work from `main`, not code recovery.

**The specific asset:** the shared schema registry (`shared/schemas/index.ts` — all seven types), the already-uniform side-effect helper (`functions/src/lib/poolCreation.ts` — `freeBilling`, creator-role upgrade, side-effect bundle), and a merged client that already routes every flow through one wizard shell — the hard client half is done.

**First 3 steps in this repo:**
1. Diff the three implementations: read `functions/src/poolOps.ts` (createPool, ~line 55+), `functions/src/bracketPools.ts:20-120`, `functions/src/nflPools.ts:40-110`; table every behavioral difference (status stamped DRAFT vs OPEN, slug handling, participations, side-effects).
2. Re-read `docs/adr/0001-unified-createpool-callable.md` end-to-end and mark which of its 6 decision points are already live on `main` vs missing (as of 2026-07-06: schemas+billing live; envelope/publishPool/delegates missing).
3. Write `PLAN-ADR0001-COMPLETION.md` proposing delegate-then-delete: make `createBracketPool`/`createNFLPool` thin wrappers that call the unified path, keep them one release for client compatibility, then delete. Run the review-log gate.

**You have a result when:** `createBracketPool` and `createNFLPool` bodies are ≤ ~20 lines each (pure delegation), all root + functions tests green, and one live pool of each of the 7 types is created in prod through the unified path with identical side-effect bundles (pool doc + audit + activity event + managedPools index) — verified by reading the actual docs, not the code.

## B-3. Billing / monetization turn-on — CANDIDATE, rank 3, decision-gated

**Why it matters:** it is the platform's only revenue lever (commissioner hosting fees via Stripe — NEVER participant money). Everything today is free.

**Frame correctly:** free-by-default is **BY DECISION (2026-07-03)**, not by accident. New pools are stamped `{status:'free', tier:'free_tier', pricePaid:0}` server-side on all three create paths (`functions/src/poolOps.ts:110`, `nflPools.ts:83`, `bracketPools.ts:103` — verified). This entry is pre-staging for **when Kevin flips the policy** — do not propose flipping it yourself, and never stamp `trial` (settled battle, A4).

**Why current state fails when the flip comes (verified):** split-brain billing config. The enforcement scheduler `enforceBillingStatus` (trial→grace→locked, daily 03:00) reads `config/billing_config` (`functions/src/billing.ts:40`), while checkout, the webhook, and the admin save-config callable all use `settings/billing_config` (`functions/src/stripe.ts:91,172,548`; `functions/src/adminBillingOps.ts:32`). An admin edits grace-period days in the dashboard → the enforcement job never sees it. Harmless today (nothing is ever `trial`, so the scheduler matches zero pools); a correctness landmine the day paid tiers turn on. Also: `checkBillingAccess` treats missing billing as free/always-allowed (`billing.ts:160-167`), and the free cap is a join-time count check (10 participants, `nflPools.ts:165-166`) — enforcement semantics for existing free pools at flip time are undesigned.

**The specific asset:** the whole Stripe machinery is built and hardened — server-authoritative pricing, webhook idempotency (`stripeWebhookEvents` markers), `billingCharges` platform-revenue ledger split from prize GMV, and the grace→lock funnel code. Turn-on is a config/unification problem, not a build problem.

**First 3 steps in this repo:**
1. Unify the config authority: `git grep -n "billing_config" functions/src` → migrate `billing.ts:40` to `settings/billing_config` (the direction ADR-0001 already chose), with a one-time read-both fallback. Independent of Kevin's policy decision (no policy change) — but it IS a prod-behavior change to a money job in a billing file, which is a Rule-3 trigger (money) even as a one-file change — see `mmp-change-control` §1: classify and gate it there before landing, and verify with a before/after read of the doc each side sees (mmp-config-and-flags §7).
2. Write the flip-day inventory: which code paths key off `billing.status` — `git grep -n "billing.status\|billing?.status\|checkBillingAccess" functions/src src` — and document what each does for `free|trial|grace_period|locked|active` in a `PLAN-BILLING-TURNON.md` (do not implement past step 1 without the policy decision).
3. Define grandfathering in that plan: what happens to every existing free pool (and the 10-cap) on flip day; predict the pool counts per status BEFORE flipping (evidence bar A1.2).

**You have a result when:** (pre-flip) both readers provably use one config doc and a test proves an admin config edit changes scheduler behavior; (post-flip, if/when decided) one real commissioner is charged by Stripe, the pool transitions trial→active, and no pre-existing free pool changed state — verified against the predicted counts.

## B-4. SuperAdmin dashboard rebuild — CANDIDATE, rank 4

**Why it matters:** the dashboard is where prod is operated; the 2026-07-05 walkthrough scored it 5/10 and an admin surface that lies (or crashes) is worse than none.

**Why current state fails (verified 2026-07-06):** better than the memory of "2 of 5 cards real" — the Overview bento is now **2 cards, both real** (Platform Ledger with live Stripe revenue split from prize GMV; API Status Center hydrating from the hourly-persisted `health/latest` snapshot — `src/components/SuperAdminBentoDashboard.tsx:54-90`); the 3 theater cards were deleted, not rebuilt. Remaining theater elsewhere: the Loyalty "Mock Promo Campaign Creator" whose Execute button just fires a success toast (`src/components/SuperAdmin.tsx:~2235`, search `Mock Promo`), and a hardcoded MOCK PlayoffTeam array in the Playoffs tab. Structural problem: `SuperAdmin.tsx` is **4,380 lines** (one component, ~68 useState) — the reason a single bug used to white-screen the whole app (now mitigated by per-tab ErrorBoundary, not solved). Zero component tests on the surface where mistakes are irreversible.

**The specific asset:** the ops backbone already exists and is real — `OperationsPanel` (explain-then-confirm + admin audit), `AdminAuditViewer`, `getAdminHealthSnapshot` + `scheduledHealthCheck`, the 8-tab contract in `CONTEXT.md`, and an anti-clobber invariant regression test. A rebuild is extraction and wiring, not invention.

**First 3 steps in this repo:**
1. Inventory what a real ops dashboard needs vs has: for each of the 8 tabs list (a) real backend-wired controls, (b) remaining mock/hardcoded elements (`git grep -in "mock\|hardcode" src/components/SuperAdmin.tsx`), (c) which known ops questions ("which pools are stuck open?", "did last night's jobs run?") have no card at all.
2. Extract one tab (Loyalty or Playoffs — the two with remaining theater) out of `SuperAdmin.tsx` into its own component; delete the mock campaign creator per the A4 "delete theater, don't fake it" precedent.
3. Add the first SuperAdmin component tests around the extraction, extending the existing admin-surface invariant test (8-tab registry, fake-string absence).

**You have a result when:** `SuperAdmin.tsx` is under ~1,500 lines with every tab a separately-tested component, `git grep -i "mock" src/components/SuperAdmin.tsx` returns zero UI theater, and a cold-start admin can answer "is the platform healthy and did the schedulers run last night" from the Overview alone.

## B-5. Backup / disaster recovery — CANDIDATE, rank 5, currently ABSENT

**Why it matters:** all pool state, entries, payments bookkeeping, and audit history live in one Firestore database in one project. A bad backfill, a wrong bulk delete (see B-6), or a hostile actor with the super-admin account = unrecoverable data loss. The platform never holds participant money, but it holds the *record* of who owes whom — losing that mid-season destroys the product's trust proposition during its first NFL season.

**Why current state fails (verified 2026-07-06):** there is **nothing**. `.github/workflows/` contains only `ci.yml` and `security-scan.yml`; no `gcloud firestore export`, no scheduled backup function, no backup script in `scripts/` or `functions/scripts/`, no documented restore procedure anywhere in the repo. Point-in-time recovery (a Firestore console setting) is UNVERIFIED — nobody has checked whether it is enabled on `gridiron-gamble-uzuqo`.

**The specific asset:** Firestore has managed export + PITR primitives; the repo already has the scheduled-function pattern (`autoClosePools`, `scheduledHealthCheck`) and a health card to surface "last successful backup" on. This is mostly configuration plus one small scheduled job.

**First 3 steps in this repo:**
1. Verify the console state (Kevin or a session with gcloud auth): is PITR enabled, and does a GCS bucket exist for exports? `gcloud firestore operations list --project gridiron-gamble-uzuqo` shows any past exports. Record findings in the plan doc — data unavailable = say unavailable.
2. Write `PLAN-BACKUP-DR.md`: daily `gcloud firestore export` (scheduled via Cloud Scheduler or a scheduled function) to a versioned GCS bucket + retention policy + the *restore* runbook (a backup you've never restored is a hope, not a backup).
3. Wire "hours since last successful export" into `computeAdminHealthSnapshot` (`functions/src/` — search `computeAdminHealthSnapshot`) so staleness is visible on the API Status Center card.

**You have a result when:** a test restore into a scratch project (or emulator import) reproduces a known pool byte-for-byte from yesterday's export, and the health card would have alerted if the export had silently stopped for >48h.

## B-6. Test-pool hygiene (`isTestPool` flag) — CANDIDATE, rank 6

**Why it matters:** the Test Suite and simulators create pools in **real prod Firestore**. They pollute global stats, pool listings, and any future billing/analytics query, and there is no safe way to bulk-clean them.

**Why current state fails (verified 2026-07-06):** `git grep -rn "isTestPool" src functions/src firestore.rules` → **zero hits**; no flag exists. Test data is identifiable only by fragile naming conventions: slug prefix `sim-` (`src/components/TournamentSimulator/TournamentSimulator.tsx:163`), pool name prefix `"AI Test - "` (`src/utils/testing/simulators/squaresSimulator.ts:49`), fake owner uids `test-user-*` / `sim-*` (`bracketSimulator.ts`, `TournamentSimulator.tsx:203`). Bulk-deleting by name is a data-loss gamble — a real pool could match; how many test pools have accumulated in prod is UNVERIFIED (only prod data knows).

**The specific asset:** every simulator create path is already enumerated (the Phase-2 sweep in `PLAN-SUPERADMIN-CONTROL-SWEEPS.md` lists the direct-write sites), and the `sim-*` create rule is already SUPER_ADMIN-only (`firestore.rules:93`) — the choke points for stamping a flag are known and few.

**First 3 steps in this repo:**
1. Design the flag in a short plan: `isTestPool: true` stamped server-side at creation on every simulator path; `firestore.rules` and `recalculateGlobalStats`/stats rollups exclude it; Pools tab gets a "test pools" filter. Coordinate with the Phase-2 simulator server API (B-2's dependency) so the flag lands in the callables, not sprinkled client-side.
2. Enumerate stamping sites: `git grep -n "sim-\|AI Test" src functions/src` and the sweep doc; stamp all of them.
3. Backfill + cleanup as a kill-switched dry-run op in OperationsPanel (the `autoClosePools` pattern): first run REPORTS the candidate list (match by slug/name/owner conventions) for human review; only then flag; deletion is a separate, second confirmed op.

**You have a result when:** the dry-run report's candidate list is human-verified (zero real pools in it), all new simulator pools carry `isTestPool:true` from birth, and `stats/global` recomputed with the exclusion changes by exactly the predicted delta.

## B-7. AI Commissioner expansion — CANDIDATE, rank 7

**Why it matters:** differentiating product surface — an AI that explains results and settles disputes is the kind of feature competitors' spreadsheet pools can't match. Ranked last because it is opportunity, not pain: nothing is broken, and every item above it protects an imminent live season.

**Verified current capability (2026-07-06):** three Firestore-trigger functions in `functions/src/aiCommissioner.ts` (425 lines), all exported (`index.ts:13`): `onWinnerUpdate` (Squares-only winner explanations, with facts-hash idempotency and audit-log context), `onAIRequest` (dispute/insight resolution on `pools/{poolId}/ai_requests`, PENDING→resolved status machine), `onWeeklyRecapCreated` (proactive weekly recap / trash talk). Plus `functions/src/aiTesting.ts` callables (`generateTestScenario`, `validateTestResults`, `generateTestReport`) powering the admin Test Suite. Core client is `functions/src/gemini.ts` (`generateAIResponse`: structured-output schema, dynamic model discovery, **fallback model `"gemini-1.5-flash"`** — a dated default worth refreshing). Key is `defineSecret("GEMINI_API_KEY")`; CORRECTED 2026-08-23: a Gemini key (`VITE_API_KEY`) WAS leaked in public git history (`git show 3340fff0^:.env | grep -c VITE_API_KEY` (count-only — never reprint the value)); Rotation CLOSED 2026-08-24 (Kevin ruling, evidence-verified): the leaked value returns API_KEY_INVALID when tested live, and .env history contains no other private key — the live key ("New MarchMeleePoolsAPI2", Jan 2026) never touched git. Kevin had already rotated; no further action.. Note: a `chore/remove-dead-gemini-client` branch exists (client-side Gemini usage in AdminPanel was dead code) — the AI surface is server-side only.

**Why current state fails (as an expansion base):** coverage is Squares-heavy (winner explanations are Squares-only); no cost/usage telemetry (Gemini spend is invisible to the health card); dispute resolution exists as a trigger but its client entry points and real-world usage are UNVERIFIED (check prod `ai_requests` docs); model fallback is stale.

**First 3 steps in this repo:**
1. Measure before expanding (evidence bar): count prod `ai_requests` / `weekly_recaps` / AI artifacts to learn whether anyone uses what exists. If usage is ~zero, the frontier problem is discoverability, not capability — a different plan entirely.
2. Read `functions/src/aiCommissioner.ts` + `gemini.ts` fully; refresh the model selection/fallback and add per-call token/cost logging into the audit or health pipeline.
3. Only then plan expansion (e.g. bracket/NFL result explanations reusing the per-type scoring engines as the facts source) via the full A2 lifecycle.

**You have a result when:** you have real usage numbers for the existing AI surface, and any expansion ships with cost telemetry and a per-pool-type explanation verified against the authoritative scoring engine's output (the AI must cite the same numbers the engine computed — no fabricated facts).

---

## Quick answers to common frontier questions

| Question a session arrives with | Answer / where |
|---|---|
| "What's the single most important thing to work on?" | B-1 (NFL automation) — the only deadline-bearing item. Load `mmp-nfl-season-campaign`. |
| "Can we start charging users?" | Not participants, ever (P2P rule). Commissioners: only when Kevin flips the 2026-07-03 free-by-default decision — B-3. The config split-brain fix is decision-independent but must go through the mmp-change-control plan gate (billing file — a money trigger, §1). |
| "Should we finish the wizard/createPool consolidation?" | Yes when capacity allows — B-2. The remaining pieces (thin delegates, envelope, publishPool) were never written; build fresh from main. |
| "Is the SuperAdmin dashboard done?" | Overview theater is gone (2 real cards); the monolith + residual mocks + zero component tests remain — B-4. |
| "What happens if Firestore data gets corrupted?" | Nothing recovers it. There is no backup, no export job, no restore runbook — B-5. |
| "Can I bulk-delete the sim-/AI-Test pools in prod?" | No — no `isTestPool` flag exists, name-matching risks real pools. Design the flag first — B-6, kill-switched dry-run only. |
| "Can the AI Commissioner do X?" | Today: squares winner explanations, dispute requests, weekly recaps, Test Suite scenario generation — all server-side triggers. Measure usage before expanding — B-7. |
| "Has idea X been tried/rejected?" | Check A4 here, then `mmp-failure-archaeology`, then the `PLAN-*-REVIEW-LOG.md` files. |
| "Where do new ideas come from here?" | Audits and live prod walkthroughs (A3). Propose an audit, not a brainstorm. |

# Provenance and maintenance

Facts here were verified against the repo on 2026-07-06 (branch state: PR #139 merged as `53d9872`; working tree was on `chore/remove-dead-gemini-client`). Owner-interview facts (2026-07-06) override repo docs where they conflict — notably: prod www deploys are a **manual Coolify trigger by Kevin** (even though `PHASE0-DEPLOY-CHECKLIST.md` says "Coolify auto-builds main on push" — treat the checklist as stale on that point), and the Gemini key was never leaked.

Re-verify before relying on any volatile fact:

| Fact class | Re-verification command (from `D:\march-melee-pools`) |
|---|---|
| NFL job export status (B-1) | `git grep -n "lockNFLSpreadsJob\|scoreNFLWeek" functions/src/index.ts functions/src/nflSchedule.ts functions/src/nflPools.ts` |
| Create-path consolidation state (B-2) | `git grep -n "export const createBracketPool\|export const createNFLPool\|validateCreateInput" functions/src/bracketPools.ts functions/src/nflPools.ts functions/src/poolOps.ts` |
| Wizard branch merge state (B-2) | `git fetch origin; git log main..origin/feat/wizard-unification --oneline` (0 lines = fully merged) |
| Billing config split-brain (B-3) | `git grep -n "billing_config" functions/src` (fixed when billing.ts and stripe.ts read the same collection) |
| Billing stamping + free default (B-3) | `git grep -n "freeBilling()" functions/src` and `git grep -n "No billing record" functions/src/billing.ts` |
| Dashboard theater remaining (B-4) | `git grep -in "mock" src/components/SuperAdmin.tsx` and `(Get-Content src/components/SuperAdmin.tsx | Measure-Object -Line).Lines` |
| Backup/DR absence (B-5) | `ls .github/workflows` + `git grep -rn "firestore export\|gcloud firestore" . -- ':!node_modules'` (still absent if no hits); console PITR state needs Kevin/gcloud |
| isTestPool absence (B-6) | `git grep -rn "isTestPool" src functions/src firestore.rules` |
| AI Commissioner surface (B-7) | `git grep -n "^export const" functions/src/aiCommissioner.ts` and `git grep -n "gemini-1.5-flash" functions/src/gemini.ts` |
| sim- rule tightening (B-6/A4) | `git grep -n "sim-" firestore.rules` |
| What's actually deployed to prod | `npx firebase functions:list --project gridiron-gamble-uzuqo` (after `npm --prefix functions install`); frontend build SHA only visible in the Coolify dashboard |
| Deploy checklist currency | `git log --oneline -3 -- PHASE0-DEPLOY-CHECKLIST.md` |

Maintain this skill when: a frontier item gets a locked PLAN (move it from CANDIDATE to a pointer at that plan), a settled battle is reopened with new evidence (update A4 with the new review-log cite), or a new AUDIT→PLAN pair lands (add it to the A3 table).
