# PLAN-CHECKOUT-PRICING-TYPE — review log

Sweeps: `PLAN-CHECKOUT-PRICING-TYPE-SWEEPS.md`.

## Review rounds

### Round X1 — codex (`gpt-5.6-terra`), on `5a114012`

Clean. *"The normalization matches the server's checkout pricing behavior, and
both callers now submit valid canonical pool types for legacy or missing stored
values."*

### Round Q1 — qodo, on `5a114012` (0 bugs, 2 skill insights)

| # | Finding | Verdict |
|---|---|---|
| Q1.1 | A money-path change ships without a PLAN, review log or sweeps. | **Valid — fixed.** The change alters what is quoted and the add-on request's `poolType`, though not what is charged. The repo rule is to take the gate when in doubt (CLAUDE.md §4), so this plan, the log and the sweeps were added. |
| Q1.2 | The client copies the server's pricing-type logic, so a change to one must be made in both. | **Rejected, with reasoning (plan C2).** The parity test imports the server function itself and runs in the required `build-and-test` job on every PR, so a one-sided change cannot merge green. A shared module would make a frontend-only fix a functions deploy too. qodo's own high-level assessment on #794 recommended keeping the scoped helper. |
