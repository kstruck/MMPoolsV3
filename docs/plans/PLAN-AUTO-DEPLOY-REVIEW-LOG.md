# PLAN-AUTO-DEPLOY: review log

Sweeps: `PLAN-AUTO-DEPLOY-SWEEPS.md`.

## Review rounds

### Round X1: codex (`gpt-5.6-terra`), on `6c74b43`

VERDICT: REVISE. 2 findings, both P1, both accepted.

| # | Finding | Verdict |
|---|---|---|
| X1.1 | The gate job reads the required checks once. `ci.yml` and `security-scan.yml` start at the same time as the deploy workflow, so the checks are still pending, the gate stops, and nothing retriggers it: green merges would never deploy. | **Valid, fixed.** §4.1 now has the gate poll every required context to a final state with a time limit, and treats a failure, a missing context or the time limit as a stop. |
| X1.2 | A staging image inherits `nginx.conf`, whose CSP allows only the production functions host and whose `/join` proxy is pinned to production. Staging's browser calls would be blocked and its join previews would hit production. | **Valid, fixed, and wider than reported.** Verified in `nginx.conf` (7 hits). The same sweep found the production domain in `functions/src` (including `stripe.ts`), `shared` and `src`. Added §4.10, sweep S8, Phase 1a (its own plan-gated change) and a risk entry. |

