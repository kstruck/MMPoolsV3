---
name: mmp-change-control
description: >
  Use when making ANY change to the march-melee-pools repo and you need to know
  what gate it requires: classifying a change (ordinary vs plan-gated feature
  vs prod-data mutation vs deploy), starting a PLAN-*.md, running an adversarial
  review log, doing a sweep pass, deploying functions/rules, mutating production
  Firestore data, enabling a scheduled job past dry-run, creating a branch or
  worktree, or asking "is this safe to just do?". Canonical home of the four
  non-negotiable discipline rules (kill-switch+dry-run, deploy ritual,
  plan->review-log->sweep, worktree isolation) and the history behind them
  (the PR #116/#117 clobber incident, the bad-git-add drop). Symptoms that
  should load this: "should I make a plan first", "how do I deploy", "can I
  backfill/migrate prod data", "which branch do I work on", "why does this repo
  have PLAN and REVIEW-LOG files", "merge reverted my changes".
---

# mmp-change-control

## What this is

The rulebook for how changes land safely in `D:\march-melee-pools` (March Melee
Pools / Gridiron Gamble — React + Firebase sports-pool platform, Firebase
project `gridiron-gamble-uzuqo`). This repo has real users, real production
Firestore data, and a documented history of merges silently destroying merged
work. The rules below exist because each one was violated once and it cost days.

Jargon used below, defined once:

| Term | Meaning |
|---|---|
| SUPER_ADMIN | The platform-owner role (custom auth claim); Kevin. |
| callable | A Firebase `onCall` Cloud Function invoked from the client. |
| Coolify | Self-hosted deploy dashboard that builds/serves the prod www frontend (nginx container). NOT Firebase Hosting. |
| PLAN-*.md | A repo-root plan-of-record document for a plan-gated change (money / authz / prod data / scoring). |
| review log | `PLAN-*-REVIEW-LOG.md` — verbatim findings from adversarial review rounds + accept/reject responses. |
| sweep | `PLAN-*-SWEEPS.md` — deterministic grep-built COMPLETE instance lists for a plan item. |
| clobber | A merge that silently reverts previously-merged work without CI noticing. |
| worktree | `git worktree` — a second checkout of the repo on another branch in a separate directory. |
| kill-switch | A Firestore config field (e.g. `system/config.autoClose.enabled`) that a job checks before doing anything; default OFF. |

---

## 1. Change classification — what gate does my change need?

Classify FIRST. The gate is determined by blast radius, not effort.

| Class | Definition | Gate required |
|---|---|---|
| **Ordinary change** | Anything that touches none of the Rule-3 triggers below — **any file count**, from a one-line typo to a 14-file refactor | Own branch off `origin/main`, all five gates green, `codex exec review --base origin/main` (**judgement up to 10 rounds; past 10 ask Kevin with a reason** — CLAUDE.md §2c, his ruling 2026-07-27, which replaced the earlier 5-round cap. Stop on evidence — a clean round your own read of the diff agrees with — not on the counter; if you stop with findings still open, name them in the PR body), PR through CI. **qodo is LIVE again as of 2026-09-01 (Kevin: "Qodo back on, go ahead and start using for each PR going forward") — run it on EVERY PR and load `mmp-qodo-cycle`; CLAUDE.md §2b carries the ruling and the procedure.** So the stopping rule is THREE conditions: qodo clean AND a codex round clean AND your own read of the diff agrees. "qodo clean" means it REPORTED and every finding is fixed or rejected with reasoning on the PR — not that a fresh pass came back empty; it was observed not re-reviewing after a fix push, and the draft→ready toggle is how you force one. It was DORMANT 2026-07-25 → 2026-07-30 and again 2026-08-19 → 2026-09-01 (credits exhausted); during those windows the rule was two conditions. **No plan doc.** Own worktree if another session may be active (Rule 4). |
| **Plan-gated change** | Touches **money, authorization, production data, or scoring** — see the trigger list below | Rule 3: `PLAN-*.md` + adversarial review log + sweep pass, THEN implement. |
| **Prod-data mutation** | Any code or action that writes/migrates/backfills/deletes production Firestore data outside a user's own normal flow (backfills, sweeps, role migrations, `fix*`/`recalculate*` ops) | Rule 1: kill-switch + dry-run-default, review dry-run output before enabling. Prod data is itself a Rule-3 trigger, so new code here takes the plan gate too. |
| **Deploy** | Anything reaching prod: functions, firestore rules/indexes, www frontend | Rule 2 deploy ritual. Frontend additionally requires Kevin (Section 6). |

There is deliberately **no third, lighter class for one-file fixes.** An earlier
version had a "Trivial fix" row permitting a branch off local `main` with only
local tests — it overlapped **Ordinary change** while prescribing a weaker gate,
so the same one-line change could be classified either way and the looser
reading wins every argument. The five gates and a codex pass are cheap; a second
classification anyone can talk themselves into is not.

### Rule-3 triggers — money, authorization, production data, or scoring

**Kevin's ruling, 2026-07-22.** The gate used to be "touches 2+ files", and it
was not followed: none of the twelve PRs merged 2026-07-21 carried a PLAN, and
none of the four opened overnight 07-21/22 did either. A rule that is
systematically skipped is not a gate, it is a lie that makes every skip look
routine. It is now scoped to blast radius instead of file count.

**A change is plan-gated when it touches any of:**

| Trigger | Examples |
|---|---|
| **Money** | `functions/src/stripe.ts`, billing config, `payoutRecords.ts`, the payment ledger, quote/coupon engines, anything that decides what a user is charged or paid |
| **Authorization** | `firestore.rules`, `functions/src/index.ts` exports, `lib/systemGuards.ts`, `lib/assertRole.ts`, `adminClaims.ts`, anything deciding who may do what |
| **Production data** | backfills, migrations, sweeps, `fix*` / `recalculate*` ops — anything writing prod Firestore outside a user's own normal flow |
| **Scoring** | the scoring engines and finalization paths, because they decide winners and therefore money |

Everything else is an **ordinary change**, whatever its file count. A 14-file
refactor touching none of the four triggers takes the ordinary gate; a one-line
edit to `firestore.rules` that CHANGES WHO CAN READ OR WRITE SOMETHING takes the
full plan gate. Name all four when you classify: dropping one from the list is
how a scoring refactor talks itself into the ordinary lane.

Note the qualifier on that second example — it is doing work. A comment-only or
provably behaviour-preserving edit to `firestore.rules` is ordinary, by the same
rule that makes #256 ordinary. Classifying by filename is what the next section
exists to stop, so the examples must not do it either.

#### "Touches" means BEHAVIOUR, not the file

The trigger is a change to what the system DOES in one of those concerns — what
a user is charged or paid, who is allowed to do what, what gets written to
production, or how a winner is decided. Editing a file that happens to live on
such a path is not automatically a trigger.

This distinction is load-bearing and codex caught it missing: **PR #256**
refactored verdict logic out of `autoClosePools.ts` — the canonical prod-data
sweep — while changing no behaviour at all. Under a literal file reading it
would be plan-gated; under the behaviour reading it is ordinary, which is how it
was actually treated.

**The burden is on the author, and it is discharged with evidence, not
assertion.** A refactor inside one of these paths is ordinary only if you can
point at tests pinning the behaviour as unchanged — #256 extracted each verdict
and unit-tested it producing identical output, and separately verified the
guard fails when the logic is gutted. If you cannot demonstrate that, you do not
get the ordinary lane; classify it as plan-gated and move on. "I am fairly sure
this is just a refactor" is the sentence this rule exists to stop.

**Calibration, so this is not just an assertion.** Against the sixteen PRs
merged or opened 2026-07-21/22, this rule fires on exactly one — #255, the
BANNED-owner authorization fix — and exempts the rest, including the 14-file and
11-file feature work. That is the outcome that made the old rule unworkable and
the new one worth having: it selects the change where a plan would actually have
helped.

`src/components/SuperAdmin.tsx` is NOT a trigger. It is a 4,300-line god file
with a real collision risk, but that is a **worktree-isolation** problem (Rule
4), not a reason to write a plan-of-record. Conflating the two is part of why
the old rule felt arbitrary.

Money invariant (never route around it): Stripe is for commissioner hosting
fees ONLY. The platform never touches participant entry fees — those are P2P
honor system. No change may propose the platform handling participant money.

---

## 2. The four non-negotiable rules

This skill is the canonical home of these rules. Sibling skills cross-reference
them; do not re-derive or relax them elsewhere.

### Rule 1 — No prod-data mutation without kill-switch + dry-run-default

**The rule.** Any job or op that mutates production data ships with:
1. A kill-switch config it reads at runtime, default OFF, fail-safe (a read
   error = disabled).
2. Dry-run as the DEFAULT (`dryRun !== false`), where dry-run only REPORTS
   what it would do (to `admin_audit`), mutating nothing.
3. A human reviews the dry-run reports (the pattern: a week of daily reports)
   before explicitly flipping `dryRun: false`.
4. A safety cap per run (e.g. `MAX_PER_RUN = 200`).

**The reference implementation** is `functions/src/autoClosePools.ts` (verified
2026-07-06) — read its header comment before writing any new sweep. It checks
`system/config.autoClose.enabled === true` (default off, fail-safe on read
error), defaults `dryRun = cfg?.dryRun !== false`, writes an `admin_audit`
summary with `wouldClose` counts in dry-run, caps at 200/run, and closes via
the shared `adminCloseUpdate` so triggers/emails/stats are suppressed
identically to a manual close. As of 2026-07-06 `autoClosePools` is LIVE past
dry-run in prod — it actually closes pools daily. Same pattern in
`functions/src/adminClaims.ts:186` (role backfill, `dryRun` default true) and
`functions/src/poolOps.ts:363`.

**Why.** Prod data has no undo. The repo's own audits describe a "fleet of
`fix*`/`recalculate*` functions" compensating for past uncontrolled drift. The
plan-of-record phrasing (T2/T8): "sweep ships behind a config kill-switch and
dry-run first week"; "dry-run, then on a copy, then prod; keep the old map
untouched until verified." For migrations specifically: "Migration order:
grep-gate passes -> deploy -> run backfill -> verify. Do NOT run backfill
before the grep gate is clean" and "do NOT partially rename roles — canonical
queries would silently miss legacy docs."

**Historical incident.** Not one disaster — a pattern of near-misses the audits
kept finding: `simulateGameUpdate` processed any authed user's scores as ADMIN
(any user could rig real-money pools, AUDIT-REPORT 2026-07-01); the
transaction-retry score swap corrupted scores on retry; hand-rolled backfill
logic in `fixPoolScores` "tried to do all this manually and failed" and was
replaced with the proven `processGameUpdate` path. The lesson generalized:
mutation code must prove itself in report-only mode against real data first.

### Rule 2 — The deploy ritual

**The rule** (as of 2026-07-06, all commands from repo root `D:\march-melee-pools`):

1. Always `npx firebase` — there is no global Firebase CLI on this machine.
2. Install functions deps FIRST or the predeploy build fails with TS2307
   (cannot find module 'stripe' / 'firebase-functions-test'):
   ```powershell
   npm --prefix functions ci        # ci, NOT install (rewrites the lockfile)
   ```
3. Deploy functions BEFORE firestore rules. Rationale on record: "The new
   logClientError callable must exist before system_logs create is locked,
   else front-end error telemetry silently drops." Rules that lock a path to
   functions-only must never go live before the function exists.
   ```powershell
   npx firebase deploy --only functions --project gridiron-gamble-uzuqo
   npx firebase deploy --only firestore:rules --project gridiron-gamble-uzuqo
   ```
   To deploy a named subset (pattern from PHASE0-DEPLOY-CHECKLIST.md):
   ```powershell
   npx firebase deploy --only functions:logClientError,functions:scheduledHealthCheck --project gridiron-gamble-uzuqo
   ```
4. **If the change touched `firestore.indexes.json`, deploy indexes too — it is
   a THIRD surface and neither command above ships it:**
   ```powershell
   npx firebase deploy --only firestore:indexes --project gridiron-gamble-uzuqo
   ```
   Ordering is free: index deploys are independent of the functions-before-rules
   constraint in step 3, so run it whenever in the sequence.

   ⚠️ **This step was MISSING from this ritual until 2026-08-04**, and the cost
   is on record: `enforceBillingStatus` shipped with two composite queries whose
   indexes were declared nowhere, threw
   `9 FAILED_PRECONDITION: The query requires an index` every night for its
   entire life, and never moved a single expired trial to grace period. A
   surface that no documented command deploys is a surface that does not get
   deployed. Found by codex reviewing the fix for that job.

   **VERIFIED 2026-08-04, and re-checkable — do not take it on trust:**
   ```powershell
   git log -S 'billing.trialEndsAt' -- firestore.indexes.json   # no commits = never declared
   ```
   The live half was read off `/super-admin` → Overview → Ops Health, which
   showed `STALE JOBS: 1 — enforceBillingStatus — failing — 9 FAILED_PRECONDITION`
   as the only stale job. (qodo asked for these claims to be marked UNVERIFIED;
   they are the opposite — verified — so the evidence is cited here instead, which
   is what makes the label unnecessary.)

   ⚠️ **Read the prompt before confirming.** `--only firestore:indexes`
   reconciles prod against the file, so an index that exists in prod but NOT in
   `firestore.indexes.json` — e.g. one created by clicking the console link in a
   `FAILED_PRECONDITION` error — is offered for DELETION. Deleting an index that
   a live query depends on breaks that query immediately.
5. Project is always `gridiron-gamble-uzuqo`.
6. The www frontend does NOT deploy via Firebase. See Section 6 — it is a
   manual Coolify action by Kevin. `firebase.json` hosting rewrites do not
   apply to prod www (nginx serves it).

CAUTION: `package.json` has `deploy:backend` = `npx firebase deploy --only
functions,firestore:rules,firestore:indexes --project gridiron-gamble-uzuqo`
(single command). Prefer the two explicit commands above so the
functions-before-rules ordering is under your control.

The `npx` and the `--project` pin were both added 2026-08-04 (qodo, PR #365).
`--project` matters more than it looks now that the script deploys indexes: an
index deploy RECONCILES prod against the file, so an unpinned run can delete
indexes in whichever project happened to be active.

⚠️ `firestore:indexes` was ADDED to that script on 2026-08-04. It used to name
only `functions,firestore:rules`, so a release run through it declared indexes
in `firestore.indexes.json` and never created them — which is how
`enforceBillingStatus` could carry two missing composite indexes while looking
deployed. Found by codex reviewing the index fix, not by reading the script.

**Why.** Two independent failure modes actually happened: (a) skipping the
functions install produced TS2307 build failures mid-deploy; (b) the
rules-before-functions ordering risk was caught in review round 4 of the
control plan — deploying the `system_logs` lockdown before `logClientError`
existed would have silently destroyed the exact crash telemetry that had just
diagnosed a prod outage. The deploy checklist for PR #139 documents the real
transient window: "the new rules block the OLD frontend's direct system_logs
writes, so client error telemetry is broken until the new frontend is live."

Full deploy/operate detail (Coolify steps, scheduled jobs, seasonal ops) lives
in the sibling skill **mmp-deploy-and-operate**; this rule is the invariant.

**Sync step — do this every time you update HANDOFF.md.** Auto-memory is the
only state carrier that auto-injects into every session, which makes it the
one that must never go stale. Whenever a HANDOFF.md status edit lands
(deploy, PR merge, plan completion), also: (1) update the matching line in
`MEMORY.md` / the topic file it points to, and (2) update any mmp-* skill
that asserts a fact the change just falsified (search for the specific claim
— e.g. a "no scheduled scorer" or "backdoor open" sentence — across all 21
skills, since invariants are deliberately repeated in several). Skipping this
is exactly what let memory assert "2/41 retrofits, ON HOLD" for three days
after Phase 1 shipped 41/41 (audit finding, 2026-07-12) — the failure mode is
structural, not a one-off mistake, so treat this as part of the ritual, not
an afterthought.

### Rule 3 — Plan -> review-log -> sweep gate for money / authz / prod-data / scoring changes

**The rule.** No change touching money, authorization, production data, or
scoring is implemented without, in order:
1. A `PLAN-*.md` at repo root (goal, phased approach, key decisions +
   tradeoffs, risks/open questions, out-of-scope).
2. An adversarial review loop logged verbatim in `PLAN-*-REVIEW-LOG.md`
   (in practice: Codex as reviewer, judgement up to 10 rounds and Kevin's
   sign-off with a reason past that — CLAUDE.md §2c, 2026-07-27; it was
   MAX_ROUNDS=5, which the older logs in this repo were written under —
   each round's findings with
   severity + accept/reject + the author's response; explicit resolution
   status at the end).
3. A sweep pass (`PLAN-*-SWEEPS.md`): deterministic grep-built COMPLETE
   instance lists for anything the plan claims to cover ("close the
   enumeration-gap pattern Codex kept surfacing one-at-a-time").
4. User (Kevin) sign-off gate, then implementation phase-by-phase with
   evidence, then a deploy checklist.

See Section 4 for the worked example and Section 5 for what CI does and does
not enforce. Templates and house style are in sibling **mmp-docs-and-writing**.

**Why.** The review loop repeatedly caught plan-killing errors that
implementation would have baked in: a plan whose core premise was stale (the
wizard plan targeted a client-write hole that no longer existed — "My original
exploration report was wrong; Codex caught it"); a restore plan whose baseline
was factually wrong (it assumed `setUserRole` survived the clobber — it
hadn't); a "close the sim- rules backdoor" phase that would have broken the
entire admin Test Suite (every simulator depends on that rule — found by the
sweep, not by review). The sweep exists because per-finding review converges
too slowly: complete instance lists beat whack-a-mole.

**Historical incident.** The clobber (Section 3) is the strongest argument:
work that skipped no gates was still destroyed by a merge — and it was the
plan/review/audit apparatus (Step-0 CLOBBER-AUDIT.md as authority, restore
from git history rather than rewrite, invariant regression tests) that made
recovery tractable and prevented a third occurrence.

### Rule 4 — Worktree isolation

**The rule.** New parallel work goes in its own `git worktree` on its own
branch. Never batch commits onto a branch another session may be touching.
Before starting: `git worktree list` and `git branch --show-current` to see
what is active. If another session may be live on the main checkout, ask
before working there. Long-lived feature branches must merge latest `main`
and re-verify the admin surfaces before opening a PR (post-clobber process
rule on record).

As of 2026-07-06 `git worktree list` shows the main checkout plus
`.claude/worktrees/superadmin-restore` (`feat/superadmin-role-sweep` —
unmerged T6 write-path sweep) and a stale `.claude/worktrees/security-pii-h1`.
The historical `D:\mmp-wizard` worktree (branch `feat/wizard-unification`) is
GONE and nothing in it is lost: its content merged to `main` via PR #117
(2026-07-04) and the worktree was removed afterward — `origin/feat/
wizard-unification` at 0 commits ahead of `main` is the expected state of a
merged branch. The still-open ADR-0001 items (thin delegates, generic
`publishPool`) were never written anywhere; they are new work from `main` —
see mmp-build-and-env §6 (worktree how-to) and mmp-product-frontier B-2.

**Why / incident.** The clobber happened because two long-lived branches
(`feat/ui-revamp`, `feat/wizard-unification`) were cut BEFORE the T1–T14
overhaul merged, then merged AFTER it, taking their own (pre-overhaul) side of
conflicts. Parallel work on unsynchronized bases is exactly how merged work
gets silently reverted. Worktrees also prevent the cheaper failure: two
sessions committing to one checkout and clobbering each other's index — which
is a cousin of the `c8d7fa8` bad-git-add incident below.

---

## 3. The clobber incident — why Rules 3 and 4 are absolute

All commits below verified in `git log`/`git show` on 2026-07-06. Primary
sources in-repo: `CLOBBER-AUDIT.md`, `PLAN-SUPERADMIN-RESTORE.md`.

**What happened.** The super-admin overhaul (tickets T1–T14) was built, pushed,
and merged via PRs #111–#115 on 2026-07-03. Two follow-on merges then silently
reverted it — frontend AND parts of the backend:

- PR #116 (`feat/ui-revamp`, branch cut pre-overhaul): commit `2878ca5`
  restyled the OLD admin screens; merge `c7f46e5` ("Merge remote-tracking
  branch 'origin/main' into feat/ui-revamp") took the ui-revamp side.
- PR #117 (`feat/wizard-unification`): merge `d5cec46` ("Merge remote-tracking
  branch 'origin/main' into feat/wizard-unification") reverted overhaul
  function code. (#117 also legitimately landed the wizard client cutover,
  `8291a0d`.)

The clobber was invisible to CI twice — everything still built and all tests
passed, because the reverted code's tests were reverted with it. Symptom as
experienced: "nothing changed" — a merged, reviewed feature simply wasn't
there. Damage inventory (from CLOBBER-AUDIT.md, verified against `main` at
`77b51ae`): T6 role system FULLY reverted (files deleted, exports gone), T7
Operations tab both halves reverted (`adminOps.ts`, `OperationsPanel.tsx`
deleted), T3 fake dashboard cards resurrected; T14 revenue ledger and the T5
flag infra survived.

**The recovery** (branch `feat/superadmin-restore`): Step 0 was a file-by-file
clobber audit — "the authority" over what the restore plan assumed (review
round 1 had already caught the plan's baseline being wrong). Restoration was
from git history (`6c382cf`, `44666d6`, `c7f0da2`, `2865cac`) — "restore logic
verbatim first, restyle second, diff against the historical commit" — via
commits `a942657`, `d4cd700`, `5a0dcf4`, `b4a19be`, plus `97e5ae8`:
clobber-guard invariant vitest tests (8-tab registry present, OperationsPanel
rendered, fake-card strings absent, `index.ts` exports setUserRole /
logAdminAction / getAdminHealthSnapshot) running in required CI to prevent a
third clobber.

**The second bite — `c8d7fa8`** ("fix(admin): actually land setUserRole +
adminOps exports (dropped by bad git add)", 2026-07-04, verified via
`git show`): during the restore itself, the T6-backend commit's `git add`
aborted on an unrelated bad pathspec and silently dropped the modified
`adminClaims.ts` and `index.ts` from the commit — the branch shipped without
the very exports it existed to restore. The new clobber-guard CI test caught
it. Moral: even the recovery from a silent revert suffered a silent drop, and
only an automated invariant caught it. This is why "verify before done" means
checking the artifact (git show, deployed function list, grep), never the
intention.

**Standing obligations from this incident:**
- Merging any long-lived branch: merge latest `main` INTO it first, re-run the
  clobber-guard tests, and eyeball the merge diff for deletions of files you
  didn't delete.
- After committing: `git show --stat HEAD` and confirm every intended file is
  in the commit. A clean `git status` is NOT proof — `c8d7fa8`'s parent had a
  clean status too.
- Do not merge `feat/t6-roles` or `feat/t7-operations` if you find them — they
  sit on a pre-ui-revamp base (283 files of stale diff); their content was
  re-landed by the restore commits.

---

## 4. The plan -> review-log -> sweep workflow as practiced

Worked example: `PLAN-SUPERADMIN-CONTROL.md` + `PLAN-SUPERADMIN-CONTROL-REVIEW-LOG.md`
+ `PLAN-SUPERADMIN-CONTROL-SWEEPS.md` (all at repo root; read them before
writing your first plan). The actual step sequence extracted from that cycle:

1. **Evidence gathering.** A live prod walkthrough + parallel code reviews
   produced `SUPERADMIN-AUDIT-REPORT.md` (findings with file:line evidence).
2. **Plan authoring** ("Act 1 grill-with-docs"). `PLAN-SUPERADMIN-CONTROL.md`
   written with: Goal, phased Approach (Phase 0 "stop the bleeding" first;
   "each phase independently shippable"), Key decisions & tradeoffs,
   Risks/open questions, Out of scope. Header records provenance: "Locked via
   grill-with-docs + 5 Codex rounds — by Claude + Kevin."
3. **Adversarial review loop** (MAX_ROUNDS=5). Each round: reviewer verdict
   (REVISE/APPROVED), numbered findings with severity, then "Claude's
   response" stating what was accepted and exactly how the plan changed.
   Findings are logged even when rejected, with the counter-position. The log
   ends with an explicit resolution status — this cycle's:
   "CONVERGED (cap reached, not deadlocked). 5 rounds, 19 findings total,
   100% accepted, zero disputes. Finding count fell monotonically
   (11 -> 3 -> 1 -> 2 -> 2)." Other cycles ended "APPROVED" (wizard, round 5)
   or with an explicit deadlock counter-position (USER-MGMT round 5) — the
   status is honest, not aspirational.
4. **Sweep pass.** After review converged, deterministic grep sweeps built the
   COMPLETE instance lists the plan items depend on (e.g. Sweep 1: every
   privileged client write in `src/`, in a table of site/write/what; Sweep 3:
   every duplicated destructive op across tabs). The sweep CORRECTED the plan:
   it discovered all five simulators are prod-UI-reachable and depend on the
   `sim-` rules backdoor — "Closing that rule (naive Phase-0) BREAKS THE WHOLE
   TEST SUITE" — which resequenced Phase 0.3 into tighten-now/replace-later.
5. **Sign-off gate.** Open questions carried in the plan's Risks section for
   Kevin to resolve; decisions needing product judgment marked
   "DECISION NEEDED" and left unimplemented.
6. **Implementation phase-by-phase**, one commit per plan item, commit message
   carrying the phase marker (`feat(admin): Phase 3.1 — server-side name
   search`), and the plan's "Implementation status" section updated with
   per-item ✅/PENDING + commit SHAs — the plan doc is the live status ledger.
7. **Deploy checklist with evidence** (`PHASE0-DEPLOY-CHECKLIST.md`): exact
   commands, ordered steps, post-deploy smoke tests, rollback section.
   "No 'done' without this step's evidence."

**Anatomy of a review-log entry** (real, round 3, quoted so you can imitate the
shape — severity, file:line evidence, concrete fix, then a logged response):

> ## Round 3 — Codex (resumed thread)
> VERDICT: REVISE. Confirmed all round-2 fixes landed. 1 narrow finding, accepted:
> 1. (High) 0.3 API list missed the simulator's `handleLoadTournamentOnly`
>    (`TournamentSimulator.tsx:527`) and `handleLoadRound` (`:543`), which call
>    direct-write helpers (`tournamentTestUtils.ts:20/38`) and would break
>    after rule removal. Fix: add load-tournament-only + load-at-round-N
>    callables, or delete those controls in the same phase.
>
> ### Claude's response
> Accepted. 0.3 API scope extended... with an explicit rule: any simulator
> control not reimplemented server-side is removed in the same phase (no
> orphaned buttons post-rule-removal).

Non-negotiable phrasings preserved from these cycles (reuse verbatim):
- "one capability lives in exactly one place."
- "do not delete a legacy button until its verified Operations equivalent exists."
- "Data unavailable -> the card shows 'unavailable', never a plausible-looking substitute."
- "If the inventory is larger than expected, the schedule slips rather than the audit boundary."
- "Server-side flag/lifecycle checks are authoritative; UI checks are UX only."

---

## 5. What automation actually enforces — and what it does NOT

Verified against `.github/workflows/` and `.husky/` on 2026-07-06.

**Enforced by CI** (`.github/workflows/ci.yml` — runs on every PR and pushes
to main/master; token is contents:read only):

| Job | What it runs | Blocking? |
|---|---|---|
| `build-and-test` | `npm ci` (root + functions), `npm run build:static` (tsc -b + vite build + prerender), functions `npm run typecheck` (via the npm script — it mirrors `shared/` into `functions/src/shared/` first; bare tsc fails), root `npm test`, functions `npm test`. Node 20. | Intended as the REQUIRED check |
| `nginx-validate` | `nginx -t` on `nginx.conf` in a docker nginx:alpine — gates the Coolify container config | Yes (job fails on bad conf) |
| `lint` | `npm run lint` with `continue-on-error: true` | NO — advisory only, ~540-finding backlog |

`security-scan.yml` (same triggers): `npm audit --audit-level=high` + a Python
dependency scanner (`skills/skill-security-scanner/scripts/scanner.py`).

The clobber-guard invariant tests (Section 3) run inside `build-and-test` as
ordinary vitest tests — they are the anti-clobber automation.

**Enforced by husky:** exactly one hook. `.husky/pre-commit` runs
`python scripts/scan_secrets.py` (secret scanner). There is NO pre-push hook.

**NOT enforced by any automation in this repo** (know these; they are process,
not machinery):
- **Branch protection / required-check status**: a GitHub settings fact,
  NOT verifiable from the repo. UNVERIFIED whether `build-and-test` is
  actually marked required or whether direct pushes to `main` are blocked.
  Verify at github.com repo Settings -> Branches. Treat "CI is required" as a
  convention you must honor even if settings would let you bypass it.
- **No deploy workflow exists.** CI never deploys anything. Functions/rules
  deploys are manual CLI (Rule 2); www frontend is manual Coolify (Section 6).
  Corollary: green CI on main says NOTHING about what is running in prod.
  Deploy state must be verified, never assumed ("Functions are known stale"
  was a real finding).
- **Lint is non-blocking** (`continue-on-error: true`). A PR can merge with
  new lint errors.
- **Nothing enforces the plan/review-log/sweep gate** (Rule 3) or worktree
  isolation (Rule 4) — those are discipline.
- **Nothing prevents committing to someone else's active branch.**

---

## 6. What requires Kevin — the human-in-the-loop boundary

These cannot be completed by an agent session; produce the exact instruction
and hand off. All statuses as of 2026-07-06.

| Action | Why Kevin only | Status 2026-07-06 |
|---|---|---|
| **Prod www frontend deploy** | Manual trigger in the Coolify dashboard. Pushing to `main` does NOT deploy the frontend. (PHASE0-DEPLOY-CHECKLIST.md says "Coolify auto-builds main on push" — that is WRONG per owner statement 2026-07-06; the checklist itself hedges with "If it did NOT auto-deploy... trigger a manual redeploy." Treat manual as the truth.) | Routine; verify deployed commit SHA in Coolify against `main` HEAD |
| **Firebase console toggles** | App Check enforcement, function rollback via console, Cloud Scheduler job approval — console access | ⛔ **App Check: OFF, and turning it on is BLOCKED, not merely undone.** The 2026-07-30 attempt took prod down (blank page) and was rolled back by deleting `VITE_RECAPTCHA_SITE_KEY`. The old entry here claimed enforcement was "done"; it never was — 98 `validated()` callables are `monitor`, zero `enforce`, plus 26 bare `onCall` sites with no App Check option, zero `enforce`. Four faults must be fixed first (CSP hosts, Enterprise-vs-v3 key, app never registered, no Dockerfile `ARG`). See HANDOFF's STOP POINT box |
| **Secret rotation** | Stripe dashboard + Secret Manager access | Stripe TEST secret rotation PENDING (plaintext test key was in `functions/.env`; prod secrets already in Secret Manager) |
| **Coolify env vars** | Build args (`VITE_FIREBASE_*`) live in Coolify | Two known-malformed values (STORAGE_BUCKET, AUTH_DOMAIN doubled) flagged in checklist Step 6 — pending |
| **Kill-switch flips on live jobs** | Enabling a mutation job past dry-run is a Rule-1 human review (e.g. `system/config.autoClose.{enabled,dryRun}`) | `autoClosePools` is LIVE past dry-run — it actually closes pools daily |
| **Plan sign-off** | Rule 3 step 5 — plans with "DECISION NEEDED" items block on him | ongoing |

Prod state snapshot (owner-confirmed 2026-07-06, overrides any staler doc):
PR #139 merged (`53d9872`); all Phase 3.1 functions (`onUserCreated`,
`syncAllUsers`, `searchUsersByEmail`) + `adminHealth` deployed; tightened
`firestore.rules` deployed functions-first; `searchName` backfill run. Note:
~~the Gemini API key was NOT leaked~~ **CORRECTED 2026-08-23: it WAS leaked.**
`git show 3340fff0^:.env | grep -c VITE_API_KEY` (count-only — never reprint the value) in the PUBLIC repo shows `VITE_API_KEY` (a Gemini key,
per the Dockerfile:24 removal note), exposed since 2025-12-13. The 2026-07-06
owner statement was wrong. Rotation CLOSED 2026-08-24 (Kevin ruling, evidence-verified): the leaked value returns API_KEY_INVALID when tested live, and .env history contains no other private key — the live key ("New MarchMeleePoolsAPI2", Jan 2026) never touched git. Kevin had already rotated; no further action..

---

## When NOT to use this skill

- Executing a deploy step-by-step, Coolify mechanics, scheduled/seasonal ops
  -> **mmp-deploy-and-operate**
- Writing the PLAN/REVIEW-LOG/SWEEP documents themselves (templates, house
  style) -> **mmp-docs-and-writing**
- What tests exist, exact test commands, the clobber-guard invariants in
  detail, evidence bar for "verified" -> **mmp-validation-and-qa**
- Env vars, kill-switch inventory, feature flags, add-a-flag checklist
  -> **mmp-config-and-flags**
- Debugging a failure (not changing process) -> **mmp-debugging-playbook**;
  full incident chronicle -> **mmp-failure-archaeology**
- Why the system is designed the way it is -> **mmp-architecture-contract**
- Admin dashboard conventions (8-tab contract, Operations tab, sim- backdoor)
  -> **mmp-superadmin-surface**
- Recreating the dev environment -> **mmp-build-and-env**

---

## Provenance and maintenance

Facts here drift. Re-verify before relying (all from repo root
`D:\march-melee-pools`, PowerShell-compatible):

| Fact class | Re-verify with |
|---|---|
| CI jobs / what's blocking | `Get-Content .github/workflows/ci.yml` (look for `continue-on-error`) |
| Husky hooks | `Get-ChildItem .husky; Get-Content .husky/pre-commit` |
| Branch protection (UNVERIFIABLE from repo) | GitHub -> Settings -> Branches, or `gh api repos/{owner}/{repo}/branches/main/protection` |
| Kill-switch pattern still canonical | `Get-Content functions/src/autoClosePools.ts -TotalCount 50` |
| Live kill-switch values (`autoClose.enabled/dryRun`) | Firestore console doc `system/config` (or an admin script) — not in the repo |
| sim- rules state | `Select-String -Path firestore.rules -Pattern 'sim-'` |
| Deploy scripts | `Select-String -Path package.json -Pattern 'deploy'` |
| Deployed functions vs code | `npx firebase functions:list --project gridiron-gamble-uzuqo` vs `functions/src/index.ts` exports |
| Prod frontend build currency | Coolify dashboard deployed SHA vs `git rev-parse origin/main` (Kevin) |
| Clobber-incident evidence | `git show --stat c8d7fa8`; `git log --oneline d5cec46 c7f46e5 -1`; `Get-Content CLOBBER-AUDIT.md` |
| Active worktrees/branches | `git worktree list; git branch -a --sort=-committerdate | Select-Object -First 15` |
| Plan status ledger | "Implementation status" section at top of the newest `PLAN-*.md` |

UNVERIFIED items in this skill (labeled inline): branch-protection settings;
whether `build-and-test` is a GitHub-required check. Everything else was
verified against the repo, git history, or the owner interview of 2026-07-06.
