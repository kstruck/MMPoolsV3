# PLAN-WIZARD-BUYFLOW-FIXES — adversarial review log

Per CLAUDE.md §2c (qodo DORMANT — two-condition stopping rule: clean codex
round + own read of the diff). Rounds are adversarial plan-content reviews
(`codex exec -m gpt-5.3-codex`), not stock diff reviews — a docs-only diff
makes the stock review vacuous (HANDOFF 2026-08-22).

## Round 1 — 2026-08-23, 8 findings

| # | Sev | Finding | Verdict |
|---|-----|---------|---------|
| 1 | P2 | Claimed `NFLPoolDashboard.tsx:609` reads `toHex(pool.branding?.primaryColor)` (with uses at :1286/:1390), so the plan's "primaryColor read nowhere" is false | **REJECTED with measurement.** No such code exists: `grep -rn 'toHex\|cardHex' src/components/NFLPoolDashboard/` matches nothing branding-related, and `branding.primaryColor` in all of `src/` appears only in `StepBranding.tsx:13` and `help/content/wizard-shared.ts:258,579`. Plan wording tightened to "no renderer reads it" anyway. |
| 2 | P1 | Persisting `billing.couponCode` leaks promo codes to pool readers | **ABSORBED.** Trade-off stated in T3 + D3: redemption caps (`validateCouponRules`) bound abuse; secrecy is a coupon-config matter. Kevin decides with the risk named. |
| 3 | P1 | Persisted coupon can go stale; no fallback defined | **ABSORBED.** T3 acceptance criterion added: the pricing page already revalidates via `getPoolQuote`; invalid preloaded code must show the server reason, price full, never block. |
| 4 | P1 | Trial unlock (T5) lets durable add-on output (AI recaps) be extracted without paying | **ABSORBED.** Risk named in D2; recommendation unchanged (that is what a trial is), Kevin rules. |
| 5 | P2 | T2 leaves the quote-failure dead end (Activate suppressed when quote null) unhandled | **ABSORBED.** T2 gains a "Try again" control mirroring `BillingInvoiceCard.quoteRetry`. |
| 6 | P2 | D5 scope ambiguity: T6 "scoped after sweep" vs D5 bundling T1–T5+T7 | **ABSORBED.** D5 rewritten once §2 triage exists: every T6 item is explicitly tagged weekend / after-Monday. |
| 7 | P2 | "No code anywhere checks that flag" overbroad (flag appears in tests/helpers) | **ABSORBED.** Reworded to "no runtime check gates it". |
| 8 | P3 | Line anchors brittle for a money plan-gate | **ACKNOWLEDGED.** Anchors measured at `925c6d7` (origin/main, 2026-08-23); drift is inherent, commit pinned here instead. |

## Round 2 — 2026-08-23, 5 findings (post-sweep, full doc pair)

| # | Sev | Finding | Verdict |
|---|-----|---------|---------|
| 1 | P2 | G2's "no auth modal" is overstated — claimed the anon /pricing CTA is "wired to `onLogin`" so auth UI opens | **REJECTED with measurement.** All three create CTAs navigate: `PricingPage.tsx:226,594,618` are each `onClick={canCreate ? () => navigate('/create-pool') : undefined}`; `onLogin` is passed to `Header` only. `/create-pool` requires `user && canAccessPoolCreation(user)` (`App.tsx:452-453`) → anonymous click after the G1 flip bounces to `/` with no modal. G2 stands as written. |
| 2 | P1 | §3 intro still framed T6 as "polish" while §2 calls G2–G5 blockers — release-order ambiguity | **ABSORBED.** §3 intro rewritten: T6a is blocker work, G3/G5 named as monetization-path; D5's explicit order (T6a third) is the authority. |
| 3 | P2 | D6 treats the POOLS_OPEN flip like a toggle; it is deploy-gated with a rebuild-shaped rollback | **ABSORBED.** D6 rewritten: ops-gated, Coolify rebuild, Sunday-night logged-out smoke pass (create one throwaway pool end-to-end) before invites. |
| 4 | P3 | G3/G5 core claims re-verified by codex (pricing filter `PricingPage.tsx:133`; `payment=success` unread client-side) | Confirmation, no change. |
| 5 | P3 | Round-1 edits (T2 retry, T3 staleness/visibility, D2 risk note) internally coherent | Confirmation, no change. |

## Round 3 — 2026-08-23 — CLEAN

Closing adversarial pass over the final doc pair, with focus on the
money-touching tickets (T3, T5, T6a): zero findings; codex explicitly
verified the round-2 absorptions landed (§3 intro, D6, this log's round-2
table).

## Stopping rule

Satisfied per CLAUDE.md §2c's two-condition rule (§2b DORMANT): round 3
clean AND own re-read of the doc pair agrees — the self-read re-verified the
$147 arithmetic against the default pricing bands (99+19+29), D1's
`computeAddonLines` non-premium drop (`quoteEngine.ts:110`), and T5's
"any paid add-on forces trial" (`poolOps.ts:221-226`). 3 rounds total,
13 findings: 11 absorbed, 2 rejected with measurements. No findings open.
