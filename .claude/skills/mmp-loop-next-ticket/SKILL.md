---
name: mmp-loop-next-ticket
description: Formalizes the existing audit-to-ticket-to-phase workflow into a repeatable one-phase-at-a-time loop with a proceed-gate. Use when asked to run the next ticket/phase, or continue a multi-phase plan.
---

# Ticket/Phase Execution Loop

Loop 5 of 5 (build order per PLAN-LOOPS.md). Lowest new-build risk — this formalizes a
pattern already used successfully (memory: ticket-phase-execution-workflow), it doesn't
invent new machinery. Session-invoked, not scheduled.

## Steps

1. Identify the active ticket list (e.g. the T1...T14 tickets in an AUDIT-REPORT-style
   doc — check mmp-superadmin-surface / project memory for the current active plan).
2. Pick the next ticket that hasn't been started, in priority order.
3. Execute exactly one phase of that ticket — not the whole ticket, not multiple tickets.
4. **Verify (real gate):** run the relevant tests/build for what changed. A phase isn't
   done because the edit was made; it's done because it passes what it's supposed to
   pass.
5. Record progress (what was done, what verify step confirmed it, what's next) in the
   ticket's own tracking doc or memory — so the next invocation doesn't re-derive
   context from scratch.
6. **Stop at the proceed-gate.** Report what was done and what's next, then wait for
   Kevin's explicit go-ahead before starting the next phase. Never chain into the next
   phase automatically.

## Rules

- Model: default to the standard model for routine phases. For tickets already flagged
  complex in memory (e.g. T2/T8/T12 in the superadmin-overhaul-plan memory), use the
  heavier/more capable model — this is judgment-dense work, don't cheap it out. The
  "all-cheap = more retries and rework" lesson applies directly here.
- Batch same-tier tickets together where the existing workflow memory says to; don't
  reinvent sequencing per run.
- This loop touches real code — same worktree-isolation discipline as any other change
  in this repo applies (see mmp-change-control). It is not exempt just because it's
  "just formalizing an existing pattern."
- No activation concern here in the scheduling sense (it's not cron'd), but the
  proceed-gate IS the approval mechanism — never treat "loop completed a phase" as
  license to keep going without Kevin's sign-off.
