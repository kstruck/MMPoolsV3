# DECISION — Commerce model: one-time only (Option A)

**What this is.** The explicit product decision behind every paid surface in
March Melee Pools, plus the reasoning for three externally-suggested programs
that Kevin has ruled out. `DECISION-LOG.md` is the canonical index; this file is
the detail it points at, in the same relationship a `PLAN-*.md` has to its log
entry.

**Status: DECIDED.** Nothing here is a proposal. It records what the code
already does and closes the question so it stops being re-litigated by each new
external audit.

---

## 1. Option A — one-time commerce is the model

**The decision.** Every dollar the platform collects is a **one-time payment**.
Recurring billing — subscriptions, auto-renew, monthly or annual recurring
plans, seat-based pricing, metered billing — is **intentionally out of scope**.

### What is in scope (all one-time)

| Product | Shape | Where |
|---|---|---|
| Pool activation / hosting payment | one charge, one pool, forever | `functions/src/stripe.ts` `createCheckoutSession` |
| Credit Bundle (e.g. 3-Pool) | one charge → N Pool Credits that do not expire | `grantBundle`, `stripe.ts:790-792` |
| Unlimited Pass | one charge → a **fixed term** that simply ends | `termEndsAt = Date.now() + pkg.termDays * …`, `stripe.ts:792` |
| Per-pool add-ons / premium | one charge per pool | `PLAN-PER-POOL-PREMIUM` |
| Coupons | discount applied to one completed purchase | `CONTEXT.md` — Coupon |

### The evidence, not the assertion

- **Both Stripe Checkout sessions are created with `mode: "payment"`** —
  `functions/src/stripe.ts:609` and `functions/src/stripe.ts:689`. `mode:
  "subscription"` appears nowhere in `functions/`. A Stripe Subscription object
  is never created, so there is nothing to renew, prorate, or cancel.
- **The webhook handles no subscription event class.** `handleStripeWebhook`
  handles `checkout.session.completed`, `payment_intent.payment_failed`,
  and charge/dispute events (`stripe.ts:1242-1518`). There is no
  `invoice.payment_succeeded`, no `invoice.payment_failed`, no
  `customer.subscription.*` branch. Turning subscriptions on would be a new
  event surface, not a config flag.
- **The Unlimited Pass expires rather than renews.** `grantBundle` stamps
  `termEndsAt` once from `pkg.termDays` and never schedules anything
  (`stripe.ts:790-792`).
- **This was already written down as a non-goal.**
  `PLAN-BUYFLOW-OVERHAUL.md:143` — *"Subscription/recurring billing; everything
  stays one-time payments."* This file promotes that line from one plan's
  out-of-scope list to a standing product decision.

### Why — four reasons, in the order they bind

1. **The money boundary comes first.** Stripe is for **commissioner hosting
   fees only**; the platform never touches participant money, and Entry Fees
   move peer-to-peer on the honor system (`CONTEXT.md` — Entry Fee, Payment
   Handle, Billing; `DECISION-LOG.md` Era 0 and standing rule 7). A recurring
   relationship with a commissioner is not itself a boundary violation, but it
   is the doorway to every "just let us collect the entry fees too" request, and
   the boundary is the load-bearing legal posture of the whole product.
2. **The product is seasonal, not monthly.** A commissioner buys hosting for a
   pool, or for a year of pools. There is no ongoing service that stops when a
   month lapses — a scored, finished pool stays readable. A monthly charge would
   be billing for calendar time the product does not consume.
3. **Recurring billing is a machine, not a price field.** Dunning, proration,
   cancellation and refund windows, involuntary churn from expired cards, the
   subscription webhook event classes above, and the customer-facing "manage my
   subscription" surface. None of that exists here, and each piece is a place a
   commissioner's money can go wrong silently.
4. **There is one operator.** Solo-run product. Recurring revenue is also a
   recurring support obligation, and the failure mode of an unattended
   subscription is a charge nobody expected — the single worst outcome for a
   product whose trust story is *"we never touch your players' money."*

### Explicitly out of scope

Stripe Billing / Subscriptions in any form; auto-renew on the Unlimited Pass;
monthly or annual recurring plans; seat-based or per-player recurring pricing;
metered/usage billing; a customer billing portal for managing recurrences.

### One-time does not mean low-risk — a measured example

Being subscription-free removes a whole class of billing machinery; it does not
make the remaining charge path safe by itself. Measured and closed the same
night this decision was recorded (**PR #570**): a missing or placeholder
`STRIPE_SECRET_KEY` let **both** the pool-activation checkout and the bundle
checkout grant full paid state **with no money taken**, and the bundle path
carried **no ownership gate at all**. Both now fail closed.

The relevance to this decision is direct: the argument for Option A is that the
one-time path is small enough to hold correct, and that argument only earns its
keep if the small path is actually held correct. A recurring model would have
had the same hole plus dunning and proration on top of it.

### What would reopen this

A commissioner-side product that genuinely runs continuously (e.g. a hosted
league identity that must stay live year-round) rather than per-pool or
per-term. That is a new product, and it takes its own plan under the
`PLAN-*.md` money gate — not an amendment here.

### The consequence for copy

**User-facing copy must not promise recurring billing.** A one-time purchase
described in subscription vocabulary is a refund request waiting to happen, in
either direction: a buyer who expects auto-renew and is not renewed, or a buyer
who expects one charge and fears a second. §3 is the sweep of the current
vocabulary against this rule.

---

## 2. Rejected with reasoning — three external suggestions

These arrived from external code review. Each is a reasonable thing to want in
the abstract; each is rejected against what this repo actually is. Rejections
are recorded rather than left silent so the next audit that raises them can be
answered with a citation instead of a re-derivation.

### 2.1 Organizations / teams / multi-org tenancy — REJECTED (product pivot)

**The suggestion.** Introduce an Organization entity above pools, with org
membership, org-scoped roles, and org-level isolation.

**Why not: the Pool already IS the unit of tenancy, and it is enforced in
`firestore.rules`, not merely in convention.**

- **The roles exist and are per-pool.** A Pool has one owner (`ownerId`),
  optionally a separate manager (`managerUid`), and — on the three NFL types —
  up to three named **Co-Commissioners** in `coManagers` (`CONTEXT.md` — Pool,
  Commissioner, Co-Commissioner). A Co-Commissioner is explicitly **not a
  Role**: the user keeps `MEMBER` and the grant is *per Pool*. That is
  tenancy scoped to the pool, deliberately.
- **The rules enforce the boundary at read time.** `firestore.rules:101-112`
  scopes a pool read to `ownerId`, `managerUid`, membership in `participantIds`,
  or membership in `coManagers`. `firestore.rules:411-416` (`isPoolParticipant`)
  is the same predicate for subcollections, and `firestore.rules:142-144`
  (`isPoolManager`) keeps destructive operations to owner/manager.
- **The authorization inputs are server-owned.** `firestore.rules:173-188`
  places `participantIds` and `coManagers` in the client-immutable field list,
  with a comment saying exactly why: a client that could write `coManagers`
  could grant itself co-commissioner. Squares PII is separately narrowed to
  owner/`managerUid`/SUPER_ADMIN (`firestore.rules:469-473`).

So the isolation an Organization would provide is already provided, one level
down, by rules that have been reviewed and tested. Adding an org tier would mean
a second authorization axis crossing the existing one on every rule, every
callable, and every membership write — while the product has exactly one global
role hierarchy (`SUPER_ADMIN` / `COMMISSIONER` / `MEMBER` / `BANNED`) and no
customer that is a company. It is a pivot to a B2B shape, not a hardening of
this one.

**What the underlying concern is worth.** If the real worry is "one
commissioner should manage many pools coherently", that already ships as the
**Commissioner Hub** and Commissioner Aggregate Stats (`CONTEXT.md`) — a
multi-pool management surface without a multi-tenant model underneath it.

### 2.2 Recipient-bound single-use invite tokens — REJECTED (contradicts the product)

**The suggestion.** Issue invites as tokens bound to one email address and
consumable once.

**Why not: the join link is deliberately a shareable URL, and three shipped
behaviours depend on that.**

- **The invite email contains no token — it contains the share link.**
  `functions/src/invites.ts:80-82` builds `joinUrl` as
  `${BASE_URL}/pool/${pool.slug || pool.urlSlug || poolId}`, with the comment
  *"Same join URL the share modal copies"*. Recipient-binding would fork the
  emailed link away from the copied one, so a commissioner who emails ten people
  and pastes the link in a group chat would be handing out two different things
  with two different failure modes.
- **The link is built to be re-shared into public surfaces.**
  `functions/src/joinPreview.ts:26-46` serves a per-pool Open Graph preview to
  social crawlers on `/join/**` and `/pool/**`, so the pool renders a card when
  pasted into a group chat or a social post. A recipient-bound token would
  either leak in that preview or make the preview meaningless.
- **Forwarding is the normal case, not the abuse case.** Pools are run for
  friends, family, and offices; the commissioner emails the addresses they have
  and expects those people to forward it to a spouse or a colleague. Single-use
  consumption breaks precisely that, and the person who loses is the invitee who
  clicks a link somebody else opened first.
- **Re-invites already work by design.**
  `functions/src/invites.ts:100-120` rate-limits by a 24-hour
  `INVITE:{poolId}:{emailHash}:{bucket}` dedupe key and returns
  `{sent, skipped, invalid}`. A skipped address can simply be re-invited in the
  next bucket. Single-use tokens would replace a soft, self-healing rate limit
  with a hard, stateful one that a commissioner has to administer.
- **Access control is not what the invite is doing.** Entry to a restricted pool
  is gated separately — `isPublic`, plus an optional pool password hashed with
  PBKDF2 (`functions/src/bracketPools.ts:234-239, 290-306`). The invite is a
  *notification*; the gate is a *gate*. Moving authorization into the invite
  would put it in the one artifact designed to be forwarded.

**What the underlying concern is worth.** If invite abuse ever becomes real, the
proportionate fix is on the gate, not the link — and Kevin's D1 ruling already
has the pool-password path being hardened in `PLAN-AUDIT-AUTH-HARDENING`.

### 2.3 A RateLimit HTTP headers program — REJECTED as its own program; FOLDED INTO PLAN-COST-CONTROLS

**The suggestion.** A standalone program adding `RateLimit-*` response headers
(limit / remaining / reset) across the API, with org-level quota accounting.

**Why not as written.** The org-level granularity is the multi-tenant model
rejected in §2.1 — this repo's natural quota subject is the **pool** and the
**user-in-a-pool**, not an organization. And the surface is wrong: the
expensive paths here are **callables**, not a public REST API, so
`RateLimit-*` response headers would decorate the wrong layer. Callable clients
in this app read an `HttpsError` code, not response headers.

**Where the useful part goes: `PLAN-COST-CONTROLS.md`, Phases 1 and 2.**

- **Phase 1 — "Centralize paid-provider calls and attribution"** supplies the
  accounting a rate limiter needs: every external paid call produces an
  attributable usage event with feature label, `poolId`/`userId`, outcome, and
  estimated cost, plus daily aggregates per provider/feature/pool
  (`PLAN-COST-CONTROLS.md` §Phase 1, items 1.3–1.4). That is the counter the
  headers program wanted, at per-pool granularity.
- **Phase 2 — "Enforce rate limits and spend controls"** is the enforcement:
  quotas enforced atomically in a transaction from `system/config.costControls`
  at **3/user+pool/hour, 15/user+pool/day, 60/pool/day, ~400/pool/month**, with
  the enforcement point in `onAIRequest` before the provider call, plus a
  kill-switch and a monthly circuit breaker (`PLAN-COST-CONTROLS.md` §Phase 2,
  items 2.1–2.3). Over-quota requests are marked `RATE_LIMITED` and a friendly
  error is returned.
- **Phase 2 also carries the one exemption the headers program would have got
  wrong:** `2.4 — never rate-limit Stripe webhooks`; signature verification and
  idempotency are the guard there.

So the answer is "already planned, better scoped" rather than "not needed".
**Phase 2 is the phase that absorbs it.**

---

## 3. Subscription-vocabulary sweep

Run against `src/`, `functions/`, and the repo's markdown for words that promise
recurring billing: *subscription, subscribe, monthly, recurring, per month, /mo,
renew, renewal, billing cycle,* and *plan* in a subscription sense.

**Categories.** (i) genuinely misleading user-facing copy · (ii) internal or
technical use that is fine · (iii) unrelated.

### Category (i) — misleading user-facing copy

| Hit | Why it misleads | Disposition |
|---|---|---|
| `src/components/PricingPage.tsx:947` — `billed annually` under the 1-Year Unlimited Pool Pass price | The Pass is a one-time charge granting a fixed 365-day term (`stripe.ts:689` `mode: "payment"`; `stripe.ts:792` `termEndsAt`). In pricing-page convention *"billed annually"* means an annually **recurring** charge. Suggested replacement: **`one-time · 365 days`** | **Deferred** — `src/` is owned by another workstream tonight |
| `src/components/billing/BillingInvoiceCard.tsx:1064` — `billed annually` on the same product in the invoice card | Same defect, second surface. Both must change together or the two prices disagree | **Deferred** — `src/` is owned by another workstream tonight |

Nothing in this workstream's owned files is category (i), so no copy was
changed here.

### Category (ii) — internal / technical, correct as-is

| Hit | Why it is fine |
|---|---|
| `src/services/dbService.ts` (~40 sites), `src/App.tsx:140-176`, `src/hooks/*`, `src/components/*` — `subscribeToX` / `unsubscribe` / `Subscription` | Firestore realtime listeners (`onSnapshot`). Nothing to do with billing, never rendered to a user |
| `functions/src/emailPrefs.ts`, `emailPrefsPage.ts`, `emailUnsubscribeHttp.ts`, `emailStyles.ts:66`, `reminders.ts` — `unsubscribe` / `subscribed` / `re-subscribe` | CAN-SPAM / GDPR email opt-out. Correct and legally required word for a mailing list; carries no billing meaning |
| `functions/src/lib/deliveryTally.ts:21-22`, `lib/heartbeatVerdicts.ts:202-203`, `lib/opsAlertDispatcher.ts:12,93` | Same email opt-out concept in monitoring code |
| `CONTEXT.md:63` — Billing defined as *"the commissioner-side **subscription** relationship"* | Internal glossary, not user-facing, and the same entry says the purchase is per Pool or per Bundle. **Noted for the coordinator**: the word is loose given this decision, and `commercial relationship` would read truer. `CONTEXT.md` is not this workstream's file |
| `src/components/PricingPage.tsx:324` — `14-day free trial` | Accurate: a pool launches on a trial and is then activated by a **one-time** payment. No charge follows the trial automatically, which is the thing a trial usually implies and here does not — worth watching, but the surrounding copy says "Upgrade anytime to unlock", not "converts to a plan" |
| `src/components/PricingPage.tsx:481,552,222-223` — `hosting plan`, `Free Tier`, `free-plan` | Tier/package names for one-time products, not recurring plans |
| `PLAN-BUYFLOW-OVERHAUL.md:52`, `PLAN-BUYFLOW-OVERHAUL-REVIEW-LOG.md:70`, `NOTES-WAVE3B.md:82` — *"after one clean billing cycle"* | Migration-safety language meaning "after a period of Stripe charges has settled cleanly". Not a product billing cycle |
| `PLAN-BACKUPS-PHASE3.md:246` — *"cents per month"* | GCP infrastructure cost estimate, not a customer price |

### Category (iii) — unrelated

| Hit | What it actually is |
|---|---|
| `functions/src/nflPools.ts:1450,1800`, `lib/slateLease.ts:38`, `lib/scoringLease.ts:34-171` — `renew` / `renewal` / `renews` | Distributed **lease** renewal in the scoring fence. No money |
| `src/components/AdminStatsDashboard.tsx:145,290,292` — `Monthly Trends (L12M)` | An internal admin chart axis |
| `src/components/articles/BracketPoolGuideArticle.tsx:267` — *"recurring problems"* | English usage in marketing prose |
| `src/components/NFLPoolDashboard/NFLPoolDashboard.tsx:341,349`, `PinnedMessageBand.tsx:18` — `renew` / `recurring` in comments | Cache invalidation and log-noise comments |
| `functions/src/__tests__/heartbeat.test.ts:507` — `// monthly` | A cron-expression test comment |
| `functions/src/__tests__/sweepBatch17Schema.test.ts:14` — *"recurring lesson"* | English usage in a comment |
| `src/pages/*`, `functions/src/winProbability.ts:4`, `migrations/backfillFrozenSpreads.ts:51`, `joinPreview.ts:12` | Firestore listener comments |

**Sweep verdict.** The codebase's commerce behaviour already matches Option A
exactly — one-time Checkout sessions, no subscription objects, no subscription
webhook branches. The only two user-visible strings that contradict it are the
two `billed annually` labels, and both sit in `src/`, deferred above.
