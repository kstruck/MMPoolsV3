# PLAN-LOOPS — the five autonomous loops, their verifiers, and their activation state

> **Status: LIVE for loop 1 (audit-sweep). Loops 2–5 remain parked.**
> Kevin, 2026-09-19: "Go with all recommendations."

## Why this file exists, and why it is in git

All five `mmp-loop-*` skills open with "Loop N of 5 (**build order per
PLAN-LOOPS.md**)". Until this commit **that file was not in the repository.**
`git log --all -- PLAN-LOOPS.md` returned nothing, and `HANDOFF.md` listed it as
an untracked stray at the root of `D:\march-melee-pools`.

So the document holding the build order, the risk tiers and — critically — the
**activation state of five autonomous loops** existed on exactly one Windows
checkout. Every worktree, every subagent and every cloud session read five
skills that pointed at a file they could not open. The skills were moved into
git precisely so subagents could read them; their governing doc was not.

**This file is a reconstruction** from the five skills' own contents, which are
tracked and therefore authoritative. If the untracked local copy at
`D:\march-melee-pools\PLAN-LOOPS.md` still exists, diff it against this one and
discard it — two copies of an activation ledger is the same failure again.

## The one rule these loops exist to satisfy

A loop is worth running only if something **other than the agent that did the
work** decides whether the work was good. Every loop below therefore names a
**verifier**: a command or condition that exits 0 or 1 without a judgement call.
"The command was run" is never the verifier. "The counts match 1:1" is.

Where a loop's verify step is a sentence rather than a command, that is a known
weakness of that loop, and it is marked.

## The ledger

| # | Loop | Skill | Mutates? | Verifier (the real gate) | Runs where | State |
|---|------|-------|----------|--------------------------|-----------|-------|
| 1 | Audit-trail integrity sweep | `mmp-loop-audit-sweep` | No — read-only | **TWO verdicts, see the note below.** Integrity (every admin action left an audit row) is **not evaluable today** — no correlatable action record exists — so it reports `INCONCLUSIVE` by construction. Self-consistency (rows well-formed, no action type silently producing none) is evaluable: `CLEAN`/`FINDING` with counts | Needs prod Firestore credentials — **Windows box** | 🟢 **ACTIVE 2026-09-19** |
| 2 | Stale PR pruner | `mmp-loop-pr-pruner` | Comments + closes PRs (reversible) | after a close, re-read the PR and confirm `state == CLOSED`. Never the close call's exit code | Cloud (GitHub MCP) | ⚪ Parked |
| 3 | Nightly e2e sweep | `mmp-loop-e2e-nightly` | No — beyond the test run | Playwright pass rate ≥ 95% | Needs Java + emulators — **Windows box** | ⚪ Parked |
| 4 | Dependabot babysitter | `mmp-loop-babysit-deps` | Can merge code (highest consequence) | build exit code AND test exit code, both 0 | Cloud (GitHub MCP) + a build host | ⚪ Parked. Auto-merge is a **second, separate** approval |
| 5 | Ticket/phase execution | `mmp-loop-next-ticket` | Yes — writes real code | the relevant tests/build for what changed | Session-invoked, not scheduled | ⚪ Parked (proceed-gate is its approval) |

Build order is risk order: read-only first, code-merging last. Loop 4 is built
last and trusted least on purpose.

## Where the loops run — the question that blocked all of them

**Two** of the five — the pruner and the dependabot babysitter, the only two
that touch GitHub at all — were written against the `gh` CLI, which **is not
installed in the Claude Code cloud container**; GitHub access there is through
the `mcp__github__*` tools only. Loops 1 and 3 need prod Firestore credentials
and a JDK respectively, which the cloud container does not have either. So
every one of the five had a host problem; only two of them had a `gh` problem.

The result was a deadlock nobody wrote down: the environment that is always on
could not run the loops as written, and the environment that could run them is a
desktop that is not always on. Scheduling was never the blocker. **Portability
was.**

Resolution (2026-09-19):

- **Loops 2 and 4 are rewritten for GitHub MCP** and target the cloud. Their
  skills now name the MCP tool beside each `gh` command rather than assuming a
  shell. A `gh` command in those skills is now the *fallback*, not the default.
- **Loops 1 and 3 stay on the Windows box.** Both need credentials or a runtime
  the container does not have, and faking either is worse than running less
  often. Loop 1 is invoked from a session on that box; it is not cron'd in the
  cloud, and a cloud session that loads the skill must say it cannot run it
  rather than reporting a clean sweep it never performed.

## The memory: `LOOP-LOG.tsv`

Each skill used to promise its own log file — `AUDIT-SWEEP-LOG.md`,
`E2E-SWEEP-LOG.md`, `PRUNE-LOG.md`. **None of the three was ever created**,
which is the cleanest available proof that no loop has ever run.

They are replaced by one append-only TSV at the repo root. One file, because
three files nobody writes to is not memory, and because the point of a log is to
be greppable across loops and across months:

```
date	loop	commit	verdict	metric	idea	lesson
```

- `date` — UTC `YYYY-MM-DD`.
- `loop` — the skill name without the `mmp-loop-` prefix (`audit-sweep`).
- `commit` — the repo SHA the run observed, or `-` when the run read only
  GitHub/Firestore state and no checkout was involved.
- `verdict` — `CLEAN` | `FINDING` | `INCONCLUSIVE` | `BLOCKED` | `ERROR`.
  **`INCONCLUSIVE` is a first-class outcome** and must be used whenever the
  verifier could not be evaluated. A loop that cannot check must never log
  `CLEAN`.
- `metric` — the number the verifier actually produced (`7/7`, `94%`,
  `0 gaps`), or `-`. A verdict with no metric is a claim with no evidence.
- `idea` — what this run was testing or doing, one clause.
- `lesson` — what the next run should do differently, or `-`.

Tabs separate, no quoting, no embedded tabs or newlines in a field. Append only:
a run never edits or deletes an earlier row. `tests/loop-engineering-invariants.test.ts`
enforces the shape.

### ⚠️ Loop 1's integrity verifier cannot run yet — DECISION PENDING

Loop 1 is the only ACTIVE loop, and the verifier the row above used to claim —
"admin-action count vs `admin_audit` count matches 1:1" — **cannot be evaluated
with today's instrumentation.** `admin_audit` cannot witness its own absence,
and there is no independent record of completed admin actions to compare it
against: `validated()` logs an invocation only when the caller supplied a
correlation ID (`functions/src/lib/validated.ts:112`), those fields carry no
target id, and raw `onCall` handlers log nothing uniform. Found by qodo and then
by codex on #699 — codex reviewing the first attempt at a fix, which prescribed
a correlation that reads as runnable and is not.

What the loop can still do unattended, read-only, is **audit-trail
self-consistency**; that is narrower than the name "integrity sweep" promises.
`mmp-loop-audit-sweep` now carries both verdicts separately and refuses to let
one stand in for the other.

**Kevin's call, not taken here:** leave loop 1 ACTIVE under the narrower
self-consistency claim (current state, since it is read-only and still finds
real things), or park it until the instrumentation lands. The unblocking change
— one unconditional invocation event per admin callable, carrying callable,
target and timestamp, written by something other than `writeAdminAudit` — is a
`functions/` change touching authorization-adjacent paths, so it needs its own
plan-gated PR and is deliberately not in this one.

### One row per INVOCATION, including the empty ones

**Every invocation writes exactly one row, even when it found nothing to do.** A
loop that lists zero candidate PRs, or sweeps a window with no actions in it,
still ran — and the charter calls this file the record of runs, so a run with no
row is a run with no evidence it happened. Log `CLEAN` with an explicit
zero-result metric (`0 PRs`, `0 stale`, `0 gaps`); that is a different and more
useful statement than silence, which is indistinguishable from the loop never
having fired.

Per-PR or per-action detail belongs in the `idea` field of that one row
(`3 PRs: 751, 768, 773`) or in the PR comments the loop already posts — not in
extra rows. The skills said "one row per PR" and "one row per action" until
2026-11-18, which both omitted the empty case and, on a busy run, buried the
invocation count (qodo's finding on #699).

### Where the row is written, and how it gets off the machine

🛑 **THE ROW IS WORTHLESS UNTIL IT IS COMMITTED AND PUSHED.** `LOOP-LOG.tsv` is
a tracked file at the repo root, so an append in an isolated worktree lands in
**that worktree's** working tree and nowhere else. Remove the worktree — which
`mmp-loop-babysit-deps` explicitly tells you to do — and the row goes with it.
An uncommitted append in the primary checkout is no better: the next session
reads `origin/main`, not somebody's dirty tree.

So, for every loop:

1. **Append in the PRIMARY checkout** (`D:\march-melee-pools`, or the cloud
   session's own checkout), never in a throwaway worktree. A loop that *works*
   in a worktree still *logs* in the primary checkout.
2. **Log BEFORE tearing anything down.** Worktree removal, branch deletion and
   cleanup come after the row exists.
3. **Commit the row and push it** — `git add LOOP-LOG.tsv && git commit -m
   "chore(loops): <loop> run <date>" && git push`. One commit per run is fine
   and expected; the file is append-only so these never conflict in content,
   and a conflict in the file means two runs raced, which is itself worth
   seeing.
4. A cloud run that cannot push (no branch, protected target) puts the row in
   its PR instead and says so in `lesson`. **It never silently drops it.**

## Activation decisions, with dates

- **2026-09-19 — loop 1 ACTIVATED.** Read-only, no mutation, worst case is a
  wrong line in a log file. It had been "awaiting Kevin's approval" since the
  five skills landed in **`a1152db9`, 2026-07-16** — **two months and three
  days** with no run in between. Watch it for two weeks before considering
  loop 2.

  *(This line first said `e5bca52` (#621, 2026-08-27). That commit touches no
  file with "loop" in its path. The error came from reading `git log` on a
  SHALLOW clone, where the oldest visible commit is the truncation point and
  not the commit that added the file — `--diff-filter=A` on a full clone gives
  `a1152db9`. Recorded rather than quietly corrected, because the charter's job
  is to be the reliable copy.)*
- **2026-09-19 — loops 2–5 stay parked**, and the parked state is now recorded
  here rather than only in each skill's prose.
- **Auto-merge on loop 4 is OFF** and is a separate approval from loop 4's own
  activation. Unchanged.

## What "activated" does and does not mean

Activated means: the skill may be invoked without asking first, and it may be
wired to a schedule. It does **not** suspend any other rule in this repo. A loop
that wants to change code still goes through `mmp-change-control`, still runs the
§2e gate list, and still takes a codex round and a qodo cycle before a PR. An
autonomous loop is a scheduling decision, never a review exemption.
