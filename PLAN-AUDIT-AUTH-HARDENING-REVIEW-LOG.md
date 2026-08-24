# Review log — PLAN-AUDIT-AUTH-HARDENING (Phase A)

Reviewer: `codex exec review --base origin/main` (plan + implementation in one
diff). CLAUDE.md §2c; qodo DORMANT — stopping rule is a clean round + own read.

## Round 1 — 2026-08-24

VERDICT: REVISE. 1 finding (P1), accepted:
1. (P1) The reset notice used `sendEmail` without `transactional: true`, so
   users who opted out of marketing email — exactly the privacy-conscious ones
   — silently got no takeover warning. Fixed; pinned by a test.

## Round 2

VERDICT: REVISE. 2 findings (P2), both accepted:
1. (P2) Public mail endpoint needed abuse controls beyond the per-email
   cooldown. Added: global hourly cap (20/hr) + uniform transaction work for
   existing and missing accounts (blunts the timing oracle). App Check enforce
   noted as the stronger gate, BLOCKED repo-wide (2026-07-30 outage).
2. (P2) The cooldown was consumed before the send; a transient queue failure
   suppressed the next genuine notice for an hour. Fixed: per-email
   reservation released when the outcome is not `queued`.

## Round 3

VERDICT: REVISE. 2 P1, 1 P2:
1. (P1) 20 made-up addresses could exhaust the global cap → DoS of the
   control. Accepted: global slot now charged only for existing accounts;
   per-email reservation still burns for any address.
2. (P1) The notice is a client callback, not an audit hook — an attacker
   redeeming the oobCode via the raw Auth REST API never calls it.
   **Partially accepted**: limitation now documented loudly in the code and
   plan; the real fix (Identity Platform blocking functions) is on Kevin's
   decision list. Removal REJECTED: the notice covers the common cooperative
   path, mirrors the existing client-initiated email-change alert, and
   best-effort beats nothing while the upgrade is undecided.
3. (P2) Outer-strict settings still persisted unknown NESTED keys (stripping
   z.objects + handler consuming the raw payload). Accepted: handler now
   consumes the zod parse OUTPUT — stripping is recursive in output.

## Round 4

VERDICT: REVISE. 2 P2:
1. (P2) Anyone can trigger a false "your password was just reset" email for a
   registered account (1/email/hr, 20/hr global). **Partially accepted**:
   copy re-hedged so a spoofed trigger asserts no false fact ("completed a
   reset, or received a report of one"), and the induced action (reset your
   password) is protective either way. Removal / server-proof requirement
   REJECTED for the round-3 reasons — no server-verifiable reset event exists
   without the platform upgrade, which is exactly the listed decision.
2. (P2) The r3 re-parse ran BEFORE validateCreateInput, so malformed settings
   surfaced as raw ZodError (`internal`) instead of the gate's
   `invalid-argument`. Accepted: parse moved after the gate.

## Round 5 — final

VERDICT: recorded after the run (below).
