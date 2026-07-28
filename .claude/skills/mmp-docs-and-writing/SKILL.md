---
name: mmp-docs-and-writing
description: "Use when creating, updating, or auditing any project document in march-melee-pools: writing a new PLAN-*.md, review log, sweep doc, ADR, audit report, or deploy checklist; updating CONTEXT.md, README.md, or docs/* after a semantics/behavior change; deciding WHERE a new document belongs; matching house style (ticket numbering T1..., severity labels, status markers, UNVERIFIED convention); or fixing a stale/wrong doc claim. Triggers: 'write the plan doc', 'update the docs', 'add an ADR', 'log the review round', 'is this doc still accurate', 'where should this be documented', 'the doc says X but code does Y'. Contains verified templates extracted from real repo docs and the list of known-stale claims (margin coin-flip, Gemini-leak, etc.)."
---

# MMP Docs and Writing — the docs-of-record system

Repo: `D:\march-melee-pools` (March Melee Pools / Gridiron Gamble). This skill tells you what document types exist, which file each kind of knowledge belongs in, the exact templates the house uses, the writing style, and which docs MUST be updated when. All file paths and line numbers below were verified against the repo on 2026-07-06 unless marked UNVERIFIED.

**Prime directive: wrong docs are worse than no docs.** This project has been burned repeatedly by stale documentation (see "Stale docs have caused real errors" below). Before you write any factual claim into a doc, verify it against code with Read/Grep. Before you rely on a doc, check its date and cross-check load-bearing claims.

**Audience for all new docs:** zero-context Sonnet-class Claude sessions and a solo owner (Kevin). Write in imperative runbook voice, dense tables, exact copy-pasteable commands, numbered steps. Do not write prose essays.

## Vocabulary (defined once)

| Term | Meaning here |
|---|---|
| Doc of record | A repo markdown file that is the authoritative statement of something (semantics, a plan, findings). If it's not in a doc of record, it doesn't survive the session. |
| Locked plan | A `PLAN-*.md` that went through the grill + adversarial review loop and is frozen for sign-off; implementation tracks against it. |
| Grill / grill-with-docs | Act 1 interview/interrogation that produces the plan draft (plans open with "Locked via grill-with-docs"). |
| Review log | `PLAN-X-REVIEW-LOG.md` — verbatim record of adversarial Codex review rounds against a plan (judgement up to 10 rounds, Kevin's sign-off with a reason past that — CLAUDE.md §2c, 2026-07-27. Logs written before that date used MAX_ROUNDS=5). |
| Sweep | Deterministic grep-based complete-instance enumeration feeding plan items (`PLAN-X-SWEEPS.md`) — exists to kill the "reviewer finds one more instance every round" pattern. |
| ADR | Architecture Decision Record in `docs/adr/NNNN-slug.md`. |
| Ticket | `T1`, `T2`, ... numbered finding-to-work items from an audit (e.g., T1–T14 in AUDIT-REPORT-PRESEASON.md). |
| The clobber | The 2026-07 incident where merges PR #116/#117 silently reverted a merged overhaul; the reason anti-regression doc+test discipline exists. |
| CONTEXT.md | The ubiquitous-language glossary at repo root — canonical semantics for roles, money, lifecycle, the 8-tab admin contract. |

## 1. Document taxonomy as practiced (verified 2026-07-06)

### Repo root — product + change-control artifacts

| File | Type | Role |
|---|---|---|
| `README.md` | Living | Product/feature description (231 lines): pool types, scoring, stack, pricing. Marketing-adjacent; some claims are aspirational (see stale list). |
| `CONTEXT.md` | Living, canonical | Ubiquitous-language glossary (78 lines): Role enum, Activity Log event types, Entry Fee vs Billing separation, Pool Lifecycle State, the 8-tab Super-Admin contract, Operations/Test Suite sole-home rules. **This is the semantic authority — plans say "Terms per CONTEXT.md".** New glossary terms are added when a plan is locked (e.g., Pool Lifecycle State and Health Snapshot were added during the superadmin-control grill). |
| `PLAN-*.md` | Dated artifact (with a living status block) | Locked implementation plans. Current set: PLAN.md (master roadmap), PLAN-SUPERADMIN-CONTROL, PLAN-SUPERADMIN-OVERHAUL, PLAN-SUPERADMIN-RESTORE, PLAN-USER-MGMT, PLAN-UX-OVERHAUL, PLAN-WIZARD-UNIFICATION. |
| `PLAN-*-REVIEW-LOG.md` | Dated artifact | Adversarial review record per plan (PLAN-REVIEW-LOG.md is the wizard plan's log; the others are name-matched). |
| `PLAN-SUPERADMIN-CONTROL-SWEEPS.md` | Dated artifact | Grep-sweep enumeration lists feeding specific plan items. The only `*-SWEEPS.md` so far; the pattern is reusable. |
| `AUDIT-REPORT.md`, `AUDIT-REPORT-PRESEASON.md`, `SUPERADMIN-AUDIT-REPORT.md`, `CLOBBER-AUDIT.md`, `CODE_REVIEW_REPORT.md` | Dated artifacts | Findings of record from audits/walkthroughs. Each opens with a compiled-date + methodology statement. |
| `PHASE0-DEPLOY-CHECKLIST.md` | Living until superseded | Deploy runbook for a specific change wave: DONE list, ordered REMAINING steps with checkboxes, smoke tests, rollback section. |
| `FIX_INSTRUCTIONS.md` | Dated artifact | One-off fix spec (fixPoolScores rewrite). |
| `TEST-SUITE-BACKLOG.md` | Living backlog | Parked bugs from a live Test Suite run, split "Fixed — needs deploy" vs "Parked — not deploy-blocking". |

### docs/ — evergreen subsystem references + runbooks

| File | Role |
|---|---|
| `docs/adr/0001-unified-createpool-callable.md` | The only ADR. Format: title, Date, Status, Context, Decision (numbered), Alternatives considered, Consequences. |
| `docs/NFL_POOLS_README.md` | NFL pool suite reference (pick'em/survivor/margin/playoff semantics, preseason testing protocol). Contains a known-wrong claim (see stale list). |
| `docs/bracket-pool-architecture.md` | Bracket subsystem reference. Contains a known-stale seed-parsing section (see stale list). |
| `docs/annual-bracket-setup-runbook.md` | Annual NCAA import runbook (ESPN field mapping, "never break" rules, debug decision tree, yearly drift watchlist). |
| `docs/UI-REVAMP-GUIDE.md` | UI style recipe — constrains UI copy and visual work (see House style). |
| `docs/plans/2026-02-10-phase1-design.md` | Historical dated design doc — the only file there; the `docs/plans/` convention is superseded by root `PLAN-*.md`. Put new plans at root. |
| `docs/wizard-unification/PHASE-A-INVENTORY.md` | Workstream evidence doc: pre-change audit with file:line cites and "RESOLVED (date)" decision stamps. |

### Where does a new document go? (decision table)

| You are writing... | Put it at | Named |
|---|---|---|
| A plan-gated change (money / authz / prod data / scoring) | repo root | `PLAN-<SCOPE>.md` |
| Its adversarial review record | repo root | `PLAN-<SCOPE>-REVIEW-LOG.md` |
| Grep enumeration feeding that plan | repo root | `PLAN-<SCOPE>-SWEEPS.md` |
| Audit/walkthrough findings | repo root | `<SCOPE>-AUDIT-REPORT.md` or `AUDIT-REPORT-<QUALIFIER>.md` |
| A deploy runbook for a change wave | repo root | `<WAVE>-DEPLOY-CHECKLIST.md` |
| A load-bearing design decision | `docs/adr/` | `NNNN-kebab-slug.md` (next number: 0002) |
| Subsystem reference / seasonal runbook | `docs/` | descriptive name |
| A new/changed domain term or contract | edit `CONTEXT.md` | — |
| Pre-change evidence inventory for a workstream | `docs/<workstream>/` | e.g. `PHASE-A-INVENTORY.md` |

### Living docs vs dated artifacts — the correction rule

- **Living docs** (README, CONTEXT.md, docs/*.md refs and runbooks, active checklists): edit in place when reality changes. Stale text here is a bug — fix it.
- **Dated artifacts** (AUDIT-*, PLAN-*-REVIEW-LOG, CODE_REVIEW_REPORT): they record what was believed on a date. Do not silently rewrite history. When a claim in one is later proven wrong, append a dated correction line at the claim site, e.g. `> CORRECTION (2026-07-06): the Gemini key was never actually leaked — see owner confirmation; original finding stands as recorded but its premise was wrong.` (This correction-note convention is a recommended practice codified here, not yet observed in the repo — the observed practice was writing a whole superseding doc, e.g. CLOBBER-AUDIT re-baselining PLAN-SUPERADMIN-RESTORE.)
- **PLAN docs are hybrids**: the plan body is frozen at lock, but the top "Implementation status" block is living — it accumulates ✅ lines with commit hashes as phases land (see PLAN-SUPERADMIN-CONTROL.md:4-32).

## 2. Templates (extracted from real repo examples — copy these shapes)

### 2a. PLAN doc skeleton (model: PLAN-SUPERADMIN-CONTROL.md)

```markdown
# Plan: <Scope — one-line goal>
_Locked via grill-with-docs + N Codex rounds — by Claude + Kevin. Terms per CONTEXT.md.
Compiled <date> from <evidence sources: walkthrough / audits / code reviews>._

## Implementation status (<dates>, branch `<branch>`)
**DONE + verified locally (typecheck/build/tests green), NOT deployed — see <CHECKLIST>.md:**
- ✅ Phase 0.1 — <what> (commit <hash>)
- ✅ Phase 1.1 — <what> (commit <hash>)
**PENDING (needs product decisions, new callables, and/or deploy — left for sign-off):**
- Phase 2.2 — **DECISION NEEDED:** <the open product question, stated verbatim>

## Goal
<One paragraph: the end state, phrased as capabilities, referencing CONTEXT.md contracts.>

## Approach
<N phases. Phase 0 stops the bleeding. "Each phase is independently shippable.">

### Phase 0 — Stop the bleeding (Critical, small→medium)
0.1 **<Imperative title>.** <Evidence with file:line cites. The fix. Corrections folded in
    are attributed: "(broadened per Codex #6/#7)".>
0.2 **<...>**
### Phase 1 — <name> (High, small)
1.1 ...
<Number items PHASE.ITEM. Severity + size in the phase heading.>

## Key decisions & tradeoffs
- **<Decision>.** <Why; what was rejected.>

## Risks / open questions
- <Each risk names its mitigation or the decision needed.>

## Out of scope
- <Explicit exclusions, each pointing at where that work IS tracked.>
```

Rules observed in practice: every claim carries a `file.ts:line` cite; proceed-gates are explicit ("do not delete a legacy button until its verified Operations equivalent exists"; "DECISION NEEDED" markers block execution); sequencing constraints are stated as rules, not hints ("deploy functions BEFORE rules"); items broadened by review say which finding broadened them.

### 2b. Review-log entry shape (model: PLAN-SUPERADMIN-CONTROL-REVIEW-LOG.md)

```markdown
# Plan Review Log: <plan title>
Act 1 (grill-with-docs) complete — plan locked (<PLAN_FILE>), CONTEXT.md updated with
<new terms>. MAX_ROUNDS=10 (CLAUDE.md §2c — ask Kevin with a reason past 10; stop on evidence, not on the counter). PLAN_FILE=<PLAN_FILE>.

## Round 1 — Codex (thread <id>)
VERDICT: REVISE. N findings, all accepted (final arbiter: Claude). Summary:
1. (Critical) <finding — one paragraph with file:line evidence and the fix>.
2. (High) <...>
### Claude's response
<Which findings accepted/rejected and HOW the plan text changed, item by item.>

## Round 2 — Codex (resumed thread)
VERDICT: REVISE. Confirmed all round-1 fixes landed. N new findings...
### Claude's response
...

## Resolution — <CONVERGED (clean final round) | STOPPED WITH FINDINGS OPEN>
<N> rounds, <M> findings total, <acceptance stats>. <Trajectory: finding count/severity
falling; core flaws → adjacent nits.> <Open counter-positions, if any.>

Pick the label from EVIDENCE, not the counter (CLAUDE.md §2c): "CONVERGED" requires a
final round that came back clean AND your own read of the plan agreeing. If the last
round still produced findings or changed the plan, the honest label is "STOPPED WITH
FINDINGS OPEN" — name them here and in the PR body, and say plainly that the plan
carries them. Going past 10 rounds needs Kevin's sign-off and a stated reason; a
round-10 stop with findings open is a stop, not a convergence.
```

Rules: findings are severity-tagged `(Critical|High|Medium|Low)`, numbered, carry file:line evidence; every round ends with an explicit "Claude's response" stating accept/reject per finding; the Resolution section distinguishes APPROVED vs "cap reached, all findings resolved, not approved" vs deadlock with a recorded counter-position (PLAN-USER-MGMT-REVIEW-LOG round 5 has one).

### 2c. Sweep doc shape (model: PLAN-SUPERADMIN-CONTROL-SWEEPS.md)

```markdown
# <Scope> — Completeness Sweeps (<date>)
Deterministic grep sweeps to close the enumeration-gap pattern.
These are the COMPLETE instance lists that feed plan items <ids>.

## Sweep 1 — <what class of thing> (feeds <plan items>)
| Site | Write/Issue | What |
|---|---|---|
| `File.tsx:156` | updateDoc(...) | <plain-English> |
> **HARD DEPENDENCY:** <any cross-cutting discovery, in bold, with consequence>.
```

### 2d. ADR skeleton (model: docs/adr/0001-unified-createpool-callable.md)

```markdown
# ADR NNNN: <Imperative decision title>

Date: YYYY-MM-DD (revised same day after adversarial review)   <- note revisions
Status: Proposed | Accepted | Superseded by NNNN

## Context
<The forces. Include what is NOT a problem — 0001 explicitly corrects its own stale
premise: "there is no client-write hole. The actual problems are divergence:">

## Decision
<Numbered, each item a commitment with the mechanism. Bold the API/artifact names.>

## Alternatives considered
- **<Alternative>**: <why rejected, one line>.

## Consequences
- <Positive and negative, including cleanup obligations and CI verification hooks.>
```

Caution learned from 0001: `Status: Accepted` means the *decision* is accepted, not that the code landed. ADR-0001 is only PARTIALLY implemented as of 2026-07-06: the shared core (`functions/src/lib/poolCreation.ts`, zod schemas) and client cutover merged via PR #117 / commit 8291a0d, but the unified `createPool` envelope, generic `publishPool`, and thin delegates were never written. If an ADR's implementation lags, say so in the ADR or in the doc citing it — a reader of Status alone will over-assume.

### 2e. Audit finding shape (model: SUPERADMIN-AUDIT-REPORT.md)

Doc opens with a methodology stamp: date, who/what was walked through, "Toolchain ... actually executed — results are real, not estimated", "No destructive production action was executed". Then Executive Summary (one-line classification, e.g. "decent but needs cleanup — trending fragile in the admin surface"), Project Understanding, What Is Working Well, Biggest Risks (numbered), then per-category findings:

```markdown
**Finding: <one-line defect statement>.**
Evidence: <file:line cites, counts, live-reproduction note>.
Why it matters: <consequence in operator terms>.
Fix: <the recommended change>.
```

Audit house rules: mark what could not be checked — "Things this environment cannot verify are explicitly marked UNVERIFIED"; findings that were live-reproduced say so ("I reproduced that crash live"); scores/counts are point-in-time snapshots and drift (203/203 → 204/204 → 207 root tests across three days of docs — never copy a count forward without rerunning).

### 2f. Deploy checklist shape (model: PHASE0-DEPLOY-CHECKLIST.md)

Sections in order: title with PR/merge-commit/project id → `## ✅ DONE` (checked list of what already shipped) → warning callouts for transient inconsistent states (`> ⚠️ ...`) → `## ▶️ REMAINING — do in this order` (numbered Steps, each with checkboxes and the exact command or console click) → smoke tests as checkboxes → `## Rollback (if a smoke test fails)`. Steps only the owner can do are labeled ("your action — I can't").

## 3. House style

### Markers and numbering (as practiced in these docs)

| Convention | Usage |
|---|---|
| `✅` | Done items in plan status blocks and checklist DONE sections, always with commit hash where applicable |
| `⛔` / `⚠️` / `▶️` | Parked (TEST-SUITE-BACKLOG), warning callout, remaining-steps header (checklist) |
| `- [x]` / `- [ ]` | Checklist steps and smoke tests |
| `T1...T14` | Audit tickets (AUDIT-REPORT-PRESEASON) — number sequentially, never reuse |
| `0.1, 1.2, 5.6` | Plan items as PHASE.ITEM |
| `(Critical)/(High)/(Medium)/(Low)` | Finding severity, in parentheses before the finding text |
| `VERDICT: REVISE` / `APPROVED` | Review round outcome, all caps |
| `**DECISION NEEDED:**` | Blocks execution until the owner decides |
| `UNVERIFIED` | Explicit label for any claim not checked in-environment — never assert what you didn't verify |
| `file.ts:123` backticked cites | Every factual code claim carries one |
| `_italic underscore block_` | Plan/audit preamble (lock provenance, methodology) |

### Voice

- Imperative, dense, evidence-first. Findings state the defect in one sentence, then evidence, then consequence, then fix.
- Exact non-negotiable phrasings recur verbatim across docs — reuse them, don't paraphrase: "one capability lives in exactly one place"; "Operations is the single home for destructive actions"; "do not delete a legacy button until its verified Operations equivalent exists"; "No 'done' without this step's evidence"; "Data unavailable → the card shows 'unavailable', never a plausible-looking substitute".
- Premise corrections are recorded, not hidden: "My original exploration report was wrong; Codex caught it" (wizard review log round 1). Write your own corrections the same way.
- Repo markdown docs DO use a small emoji set as status markers (✅⚠️⛔▶️) and README uses section emoji — that is existing practice. Do not add decorative emoji beyond the status-marker set in new docs.

### UI copy rules that constrain any doc/text destined for the app UI

From `docs/UI-REVAMP-GUIDE.md` (verified): **"No emoji anywhere — replace with Lucide monoline icons. No new icon libs"** (line 46); UI conversions are **"Visual refactor only — never change business logic, data flow, handlers, props, or copy"** (line 5); red backgrounds forbidden except live/CTA/alerts/eliminations; every changeable number gets `tabular-nums`/`.num`; headings/buttons/labels use `font-display font-bold uppercase`; `npx tsc -b` must pass after any UI-touching change. If you are writing button labels, card text, tooltips, or confirm-modal blast-radius text, these rules apply to your words and their presentation.

### The four unwritten discipline rules (now written)

Canonical home: sibling skill **mmp-change-control**. Restated here because docs enforce them (as of 2026-07-06, owner-confirmed):
1. No prod-data mutation without kill-switch + dry-run-default first — the `autoClosePools` pattern (`functions/src/autoClosePools.ts:11-15`: does nothing unless `system/config.autoClose.enabled === true`, dry-run unless `dryRun:false`); verify dry-run output before enabling. As of 2026-07-06 autoClosePools is LIVE past dry-run.
2. Deploy ritual: always `npx firebase` (never global CLI); `npm --prefix functions ci` first (avoids stripe/fft TS2307); deploy functions BEFORE rules; project `gridiron-gamble-uzuqo`. Details: **mmp-deploy-and-operate**.
3. Plan→review-log→sweep gate: no change touching **money, authorization, production data, or scoring** without a `PLAN-*.md`, an adversarial review log, and a sweep pass. NOT triggered by file count (ruling 2026-07-22 — see `mmp-change-control` §1). This skill supplies the templates.
4. Worktree isolation: new parallel work in its own git worktree; never batch onto a branch another session may touch.

## 4. Update discipline — which doc MUST change when

| Event | Doc(s) that MUST be updated | Evidence this is real practice |
|---|---|---|
| Anything deploys to prod | The active `*-DEPLOY-CHECKLIST.md` (move steps to DONE, keep the checklist truthful) | Commit 365ae83 "docs: fix deploy checklist — add Phase 3.1 functions + deploy-all one-liner" |
| Domain semantics change (roles, money, lifecycle, tab contract, event types) | `CONTEXT.md` — and plans re-cite it | Pool Lifecycle State + Health Snapshot added at plan lock (review log line 2) |
| A plan phase lands | The plan's "Implementation status" block: ✅ + commit hash | PLAN-SUPERADMIN-CONTROL.md:6-22 |
| A review round completes | Append the round + "Claude's response" to the review log before touching the plan | All five rounds in PLAN-SUPERADMIN-CONTROL-REVIEW-LOG.md |
| An incident closes (root cause confirmed) | The archaeology record — sibling skill **mmp-failure-archaeology**; plus a correction note in any doc that carried the wrong premise | CLOBBER-AUDIT.md written when the clobber was understood; restore plan re-baselined on it |
| A load-bearing design decision is made | New `docs/adr/NNNN-*.md`; if it supersedes, mark the old one Superseded | ADR-0001 |
| Scoring/engine behavior changes | The matching `docs/*` reference (NFL_POOLS_README, bracket-pool-architecture) — these are what future sessions read as truth | The margin/seed-parsing failures below happened because this step was skipped |
| A Test Suite run surfaces parked bugs | `TEST-SUITE-BACKLOG.md` | Exists, dated per run |

### Stale docs have caused real errors — the case file

Cite these when someone asks why doc hygiene is non-negotiable:

1. **Margin tiebreaker contradiction.** `docs/NFL_POOLS_README.md:78` says level 5 is "Coin Flip (Random)"; `README.md:32` says "Deterministic ID comparison". Code truth: `functions/src/nflScoringEngine.ts:300` — `a.ownerUid.localeCompare(b.ownerUid)`, deterministic. NFL_POOLS_README is wrong; two docs of record disagreed about payout-relevant math.
2. **The Gemini-leak claim.** `CODE_REVIEW_REPORT.md:183` and `AUDIT-REPORT.md:147,278` state the Gemini API key was previously committed/leaked and demand rotation + history scrub. Owner ground truth (2026-07-06): **the Gemini key was NOT leaked** — any doc claiming so is wrong. A false security finding propagated through two audit generations. (The Stripe TEST-secret item in `functions/.env` is separate and real: rotation still PENDING as of 2026-07-06.)
3. **Stale seed-parsing spec.** `docs/bracket-pool-architecture.md:105` documents `extractSeedFromTeamId` parsing `E1-Duke`-style prefixed IDs; `docs/annual-bracket-setup-runbook.md:68` (post-2026-import postmortem) says team IDs are full ESPN display names and "The old regex ... does not work." The stale architecture doc describes a parser that returns null on real data — the exact client/server scoring-drift bug class (H4).
4. **Stale plan premise burned a whole review round.** PLAN-REVIEW-LOG.md round 1, finding 1: the wizard-unification plan targeted a "direct client write" hole that no longer existed — the ADR had to be rewritten around callable divergence instead. The exploration report that seeded the plan was out of date with the repo.
5. **Wrong restore baseline.** PLAN-SUPERADMIN-RESTORE's first draft assumed `setUserRole`/`adminOps` survived the clobber; they hadn't. Codex round 1 caught it; CLOBBER-AUDIT.md became the authority. Rule extracted: the Step-0 audit is the authority over the plan's assumed baseline.
6. **Deploy-topology claim wrong in the deploy runbook itself.** `PHASE0-DEPLOY-CHECKLIST.md:19` says "Coolify auto-builds `main` on push." Owner ground truth (2026-07-06): prod www frontend deploy is a **MANUAL trigger in the Coolify dashboard by Kevin** — pushing to main does NOT deploy www, and firebase.json hosting rewrites do not apply to www (nginx serves it). Following the checklist as written would leave you waiting for a deploy that never starts.

## 5. Known stale docs to fix (verified candidate list, as of 2026-07-06)

Each row: what to change, and the ground truth to change it to. These are edit-worthy living docs unless noted.

| # | File:line | Wrong claim | Correct to |
|---|---|---|---|
| 1 | `docs/NFL_POOLS_README.md:78` | Margin tiebreaker level 5 "Coin Flip (Random)" | Deterministic ownerUid comparison (`functions/src/nflScoringEngine.ts:300`) |
| 2 | `CODE_REVIEW_REPORT.md:183,241`; `AUDIT-REPORT.md:147,278` | Gemini key previously committed/leaked | Append dated correction note (dated artifacts — don't rewrite): key was never leaked (owner, 2026-07-06). Keep the Stripe TEST-secret rotation item — that one is real and still pending. |
| 3 | `docs/bracket-pool-architecture.md:105` | `extractSeedFromTeamId` parses `E1-Duke` prefix IDs via regex | Team IDs are full ESPN display names; seed lookup via `TeamDataContext` / `curatedRank.current` (runbook:64-68) |
| 4 | `PHASE0-DEPLOY-CHECKLIST.md:19` | "Coolify auto-builds `main` on push" | www deploy is a manual Coolify trigger by Kevin |
| 5 | `docs/adr/0001:18` and `docs/wizard-unification/PHASE-A-INVENTORY.md:108` | `POOL_CREATED` "has no writer at all" | Now stale — `CONTEXT.md:25` is CORRECT: the writer is merged on main at `functions/src/lib/poolCreation.ts:110-112` (`writePoolCreationSideEffects`), called by all three create callables (`poolOps.ts`, `nflPools.ts`, `bracketPools.ts`). Add dated correction notes to the ADR/inventory; do NOT annotate `CONTEXT.md`, and do not write a second (duplicate) writer. |
| 6 | `docs/adr/0001:4` (Status: Accepted) | Reads as if consolidation is live | Add a one-line implementation-status note: client cutover merged (PR #117, 8291a0d); server consolidation unmerged in worktree `feat/wizard-unification`; legacy `createBracketPool`/`createNFLPool` still full implementations (`functions/src/bracketPools.ts:20`, `functions/src/nflPools.ts:40`) |
| 7 | Test counts anywhere (SUPERADMIN-AUDIT-REPORT.md:11 "299", :38 "203/203 + 96/96"; PHASE0-DEPLOY-CHECKLIST.md:63 "207") | Point-in-time snapshots presented as current | Never copy forward; rerun `npm test` / `npm --prefix functions test` and restate with a date |
| 8 | `docs/annual-bracket-setup-runbook.md:163-167` | Heading says `NCAA_2026_BRACKET`, example declares `NCAA_2027_BRACKET` | Reconcile naming to the current-year map at next annual pass |
| 9 | `README.md:112-122` area (pricing/trial) | Implies enforced 14-day trial / tier locking | Reality (decided 2026-07-03): new pools stamp no billing, treated as free, no auto-lock; 10-participant free cap enforced at join time (docs/wizard-unification/PHASE-A-INVENTORY.md:69-92). Label pricing as target/marketing or align with reality. |

Additional context that must never be contradicted when editing docs (owner ground truth, 2026-07-06): Stripe is commissioner hosting fees ONLY — the platform never touches participant entry fees (P2P honor system); NFL pools have never operated a live season (2026 is the first; `scoreNFLWeek` is a manual per-pool/per-week callable; `lockNFLSpreadsJob` exists in code but was never exported/deployed — see **mmp-nfl-season-campaign**); App Check is ENFORCED in console; Phase 3.1 functions + tightened rules are deployed and the searchName backfill has run.

## 6. When NOT to use this skill

| You actually need... | Go to sibling skill |
|---|---|
| To classify/gate a change, run the review loop itself, or the 4 discipline rules with their incidents | **mmp-change-control** |
| What actually broke historically and why (incident chronicle) | **mmp-failure-archaeology** |
| To deploy (commands, ordering, Coolify) | **mmp-deploy-and-operate** |
| System design decisions and invariants (content, not doc format) | **mmp-architecture-contract** |
| Pool scoring math / lifecycle semantics themselves | **mmp-pools-domain-reference** |
| Test commands, evidence bar, e2e | **mmp-validation-and-qa** |
| The 8-tab admin contract's implementation | **mmp-superadmin-surface** |
| Flags/config axes documentation | **mmp-config-and-flags** |
| Open problems / research method | **mmp-product-frontier** |

This skill is only for: which document, what template, what style, what must be updated when, and which docs are known-stale.

## 7. Provenance and maintenance

All facts verified 2026-07-06 against `D:\march-melee-pools` plus owner interview of same date. Re-verify before relying:

| Fact class | Re-verification command (PowerShell, from `D:\march-melee-pools`) |
|---|---|
| Root doc inventory | `Get-ChildItem *.md | Select-Object Name` |
| docs/ inventory (incl. ADRs) | `Get-ChildItem -Recurse docs -Filter *.md | Select-Object FullName` |
| Margin tiebreaker code truth | `Select-String -Path functions\src\nflScoringEngine.ts -Pattern "localeCompare"` |
| Gemini-leak claim sites | `Select-String -Path *.md -Pattern "Gemini" | Select-String -Pattern "leak|rotate|commit"` |
| Coin-flip claim still present | `Select-String -Path docs\NFL_POOLS_README.md -Pattern "Coin Flip"` |
| Seed-parsing stale section | `Select-String -Path docs\bracket-pool-architecture.md -Pattern "E1-Duke"` |
| UI copy rules unchanged | `Select-String -Path docs\UI-REVAMP-GUIDE.md -Pattern "No emoji|Visual refactor only"` |
| ADR count / next number | `Get-ChildItem docs\adr` |
| Plan status blocks current | `Select-String -Path PLAN-SUPERADMIN-CONTROL.md -Pattern "^- ✅" | Measure-Object` |
| Current test counts (never copy old ones) | `npm test` then `npm --prefix functions test` |
| POOL_CREATED writer (merged on main, `lib/poolCreation.ts:110-112`) | `Select-String -Path functions\src\lib\poolCreation.ts -Pattern "POOL_CREATED"` |
| autoClosePools kill-switch pattern | `Select-String -Path functions\src\autoClosePools.ts -Pattern "dryRun|enabled"` |
| Wizard server consolidation merged? | `git log --oneline -5 main -- functions/src/poolOps.ts` and check whether `createNFLPool`/`createBracketPool` are thin delegates in `functions/src/nflPools.ts` / `bracketPools.ts` |

Drift-prone facts date-stamped in this file: deploy state (Phase 3.1 live, App Check enforced, backfill run, Stripe TEST rotation pending), autoClosePools live-past-dry-run, wizard worktree location `D:\mmp-wizard` (a fact about Kevin's machine, not a source of record), and everything in the stale-docs table (rows disappear as fixes land — prune them when they do).
