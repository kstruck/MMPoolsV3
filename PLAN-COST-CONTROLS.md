# Plan: Cost Controls — rate limits, spend caps, and usage attribution for paid providers

_Compiled 2026-08-22 from a Codex rate-limiting/cost audit (run by Kevin), re-verified
claim-by-claim against the repo by Claude, plus Kevin's answers of 2026-08-22.
Terms per CONTEXT.md. Plan-gated: touches **money** (billing entitlements, provider
spend) and **authorization** (`firestore.rules` `ai_requests`, new callables)._

## Implementation status

**Phase 0.5 — ✅ MERGED 2026-08-22 as
[#516](https://github.com/kstruck/MMPoolsV3/pull/516) (`00408e97`), and its
functions + rules ARE LIVE in prod.** Corrected 2026-08-24 by #557; this plan
said "NOT DEPLOYED" for two days and that was wrong.

**The evidence is behavioural, and it is strong** (MORNING-2026-08-25.md §1c,
from production Cloud Function logs): the AI Commissioner had never once run in
production, and it ran for the first time only after C1's toggle granted a pool
the `aiCommissioner` entitlement. Before 0.5 there was NO entitlement check on
the `onAIRequest` path at all — that is the unbounded hole this plan opened to
close — so a pre-0.5 deployment would have served any pool without a toggle.
The toggle mattering is the proof that 0.5's enforcement is live.

⚠️ **What that evidence does NOT cover: the index.** 0.5.5's
`ai_requests.createdAt` collection-group field override is a third deploy
surface, and nothing in the AI-commissioner postmortem touches the health
snapshot. Treat `firestore:indexes` as UNVERIFIED rather than done — the tell
is a `FAILED_PRECONDITION` on the AI-volume count in `adminHealth`.

| Item | State |
|---|---|
| 0.5.1 rules tighten (`ai_requests` create) | ✅ built — `firestore.rules`, + `functions/scripts/aiRequests.rules.test.mjs` (9 cases) |
| 0.5.2 entitlement in `onAIRequest` / `onWinnerUpdate` | ✅ built — `aiCommissioner.ts` |
| 0.5.3 SMS kill-switch + `audience` split | ✅ built — new `lib/costControls.ts` (fail-CLOSED, 60s TTL cache), `smsService.ts` + 4 call sites |
| 0.5.4 SMS unsellable | ✅ built — `shared/schemas/quote.ts` (`UNSELLABLE_ADDON_KEYS`), + the Stripe in-flight-session clamp |
| 0.5.5 AI volume on the health snapshot | ✅ built — `adminHealth.ts` + the `ai_requests.createdAt` COLLECTION_GROUP field override |

⚠️ **Deploy was THREE surfaces and only TWO are confirmed** (Rule 2): functions
→ rules → **indexes**. Functions and rules are live (see above). The index is
the one still unverified, and it is not optional: 0.5.5's collection-group count
throws `FAILED_PRECONDITION` without it, which is the `enforceBillingStatus`
failure mode this repo has already paid for once.

```
npx firebase deploy --only firestore:indexes --project gridiron-gamble-uzuqo
```

Cheap to re-run when it is already applied, so run it rather than reason about
it — and check the AI-volume tile on the health snapshot afterwards.

⚠️ **The SMS kill-switch defaulted OFF at that deploy, so member SMS is very
likely OFF in production right now.** `system/config.costControls` did not exist
and the reader is fail-closed — which is where Kevin wants it (decision #3, and
his "GO with recommendation" on 2026-08-24). Ops and security-alert SMS are
unaffected (D4). Set `costControls.sms.enabled = true` to re-enable member SMS.
This is written as a live-state fact, not a warning about a future deploy.

**Phase 1 — BUILT and reviewed, in [#518](https://github.com/kstruck/MMPoolsV3/pull/518).
NOT merged, NOT deployed.**

| Item | State |
|---|---|
| 1.3 usage events (tokens, model, latency, outcome, cost, catalog version) | ✅ built — new `lib/usageEvents.ts`, `provider_usage_events` |
| 1.4 daily aggregates per provider/feature/pool | ✅ built — `provider_usage_daily`, same atomic batch |
| 1.5 versioned price catalog in code | ✅ built — new `lib/priceCatalog.ts`, unpriced ⇒ NULL cost |
| wrapper attribution | ✅ built — required context on `generateAIResponse` + `sendCourierSMS`; all 7 AI call sites (the 7th, `ai.banter`, arrived with #530 mid-review), all 5 SMS return paths, and `sendOpsSMS` |
| rules | ✅ built — both collections append-only, SUPER_ADMIN read |

⚠️ **Phase 1 adds a THIRD manual step to the deploy: the TTL policy** (see the
Phase 1 section). Functions → rules → indexes covers the code; the TTL policy is
GCP-level and no deploy command creates it.

📌 **Phases 2, 3, 4, 6 and 7 are NOT started.** Phase 5 is deferred (D5).

## Gate status (2026-08-22, updated same day after the environment fix)

- ✅ Phase 0 (this document): inventory, caps, config design — authored.
- ✅ **CLAUDE.md §2c review RUN, 2026-08-22 (later session)** — Kevin's
  environment fix landed (api.openai.com allowed, `OPENAI_API_KEY` set), and
  the codex round this section previously flagged as unrunnable has now
  happened: 4 rounds, 9 findings (1 Critical / 3 High / 3 Medium / 2 Low),
  9 accepted, 0 rejected, all absorbed into this document —
  see `PLAN-COST-CONTROLS-REVIEW-LOG.md` for the verbatim record and the
  resolution status.
- ✅ Sweeps built (`PLAN-COST-CONTROLS-SWEEPS.md`, 2026-08-22): Gemini and
  Courier inventories CONFIRMED complete at endpoint level; one client
  `ai_requests` writer; plus the `lib/billingAccess.ts` legacy-carve-out trap
  recorded as a 0.5.2 implementation constraint.
- ✅ **Kevin signed off on D1–D5, 2026-08-22: all five approved as recommended.**
  Resolutions recorded inline in §Risks; his D2 follow-ups (cap strategy math,
  user-facing limit messaging, off-topic use prevention) are folded into
  Phase 0.3, Phase 2.2 and the new Phase 3.5.
- Nothing in this plan is implemented. No code changed in this PR.

## Kevin's decisions of record (2026-08-22)

1. **Total spend cap: never more than $100/month across all AI models combined.**
2. **AI Commissioner is a paid pool addon** — $20 for the season per pool.
   Operating budget: **≤ $5/month per addon-holding pool** so a 4-month season is
   covered by the $20. Use the cheapest model that gives a good experience.
3. **SMS is OFF until further notice** — Kevin will decide how it works and what
   it costs before re-enabling.
4. Retention: Kevin asked for a recommendation — see §Retention (carried as a
   DECISION NEEDED until he confirms).
5. Start with Phase 0 (this document).
6. **2026-08-22 (later): D1–D5 all approved as recommended.** Plus three D2
   follow-up rulings:
   - **Cap cadence is MONTHLY per pool**, not seasonal — a season-only cap
     could be burned in week 1 and leave the addon dead for four months.
   - **Users are told about limits at the limit, not in marketing** — a clear
     in-app "usage limit reached, resets <when>" message plus a fair-use line
     in the addon description; no advertised numbers.
   - **The AI feature must resist off-topic use** (e.g. a manager using the
     pool AI to build an app) — see Phase 3.5. Bounded-damage stance: no
     prompt guard is airtight, so the quotas and the $5/pool-month breaker are
     the real ceiling on what misuse can cost.

## Audit verification — what the Codex audit got right, and what it missed

Every claim below re-verified against the repo 2026-08-22 (cloud checkout of
`kstruck/MMPoolsV3` at `origin/main` = `5dab702`).

| Codex claim | Verdict | Evidence |
|---|---|---|
| Any signed-in user can create unlimited `ai_requests`; each triggers Gemini | ✅ CONFIRMED, and **worse than reported** | `firestore.rules:497-503` — create requires only auth + `userId == request.auth.uid`. It does **not** require pool participation (`read` does, create does not), and `onAIRequest` (`functions/src/aiCommissioner.ts:119`) never checks the entitlement. So any signed-in user can burn Gemini on **any pool**, including pools that never bought the addon. |
| Gemini helper makes a model-discovery API call before every generation; model selection unpredictable | ✅ CONFIRMED, plus two findings the audit missed | `functions/src/gemini.ts:42` — `fetch(".../v1beta/models?key=${apiKey}")` per request. (a) The API key rides in a **URL query string**, on the discovery call and again on the error path (`gemini.ts:124`) — URLs land in proxy/HTTP logs; header/SDK auth does not. (b) The hardcoded fallback is `gemini-1.5-flash` (`gemini.ts:37`), a **retired model family** — verify against Google's current model list in Phase 0.2, but if it no longer serves, the "fallback" is a guaranteed error, not a fallback. |
| No billing alerts / spend thresholds evidenced | ✅ CONFIRMED (source-level; provider consoles are Kevin's to check) | No alert-as-code anywhere; `adminHealth.ts` monitors availability/latency, not spend. |
| Debouncing: pass | ✅ CONFIRMED | 300 ms quote debounce (`BillingInvoiceCard.tsx`); AI is click-to-submit (`AICommissioner.tsx:59,80`). |
| No 429 retry/backoff on Gemini or Courier | ✅ CONFIRMED | `gemini.ts:118-131` converts every error to a throw (and fires **another** list-models call on the error path); `smsService.ts:73-76` logs non-OK and returns `'failed'`. |
| Secrets good, no dev/prod separation | ✅ CONFIRMED | Gemini/Stripe/Courier via `defineSecret` (Secret Manager); deploys pinned to `gridiron-gamble-uzuqo`. |
| No usage/cost telemetry, no per-feature cost | ✅ CONFIRMED | No token counts recorded anywhere; `generateAIResponse` discards usage metadata. |

**Findings the audit missed (all verified):**

1. **The entitlement is not enforced on the main AI path.** The client hides the AI
   tab unless `billing.featuresUnlocked.aiCommissioner` (`PropsPoolDashboard.tsx:57`,
   `PlayoffDashboard.tsx:50`) — UX only. Server-side, only `onWeeklyRecapCreated`
   checks it (`aiCommissioner.ts:390`); `onAIRequest` and `onWinnerUpdate` do not.
   Kevin's decision #2 makes this the top defect: **unpaid pools can consume the
   paid feature today.**
2. **`onWinnerUpdate` (squares) generates on every winner write with no entitlement
   check** (`aiCommissioner.ts:19-116`). Winner docs are functions-write-only
   (`firestore.rules:440-443`), so it is not user-triggerable spend, but it is
   unmonetized spend on every squares pool.
3. **Every AI request is TWO external calls** (discovery + generate), three on error.
   Pinning the model (Phase 3.4) halves Gemini API traffic for free.
4. **SMS has no global off switch.** Sends are gated per-pool
   (`pool.reminders?.smsEnabled`, `reminders.ts:289,756`) + user opt-in; the only
   global lever is the `COURIER_AUTH_TOKEN` secret being unset (→ `'skipped'`,
   `smsService.ts:38-41`). The `smsNotifications` addon is still purchasable in the
   quote flow (`shared/schemas/quote.ts:38`) while Kevin wants the feature off.

## Goal

No signed-in user can create unbounded paid-provider work; every optional paid
feature is entitlement-checked server-side, quota-limited, and kill-switchable;
monthly spend is capped at $100 total with an AI budget of ≤$5/pool-month; and an
operator can answer "what did AI cost last month, per pool?" from recorded usage
events rather than guesswork. SMS stays off until Kevin re-enables it.

## Phase 0.1 — Paid-service inventory (COMPLETE — this section)

**Gemini** (secret `GEMINI_API_KEY`, all calls via `generateAIResponse` in
`functions/src/gemini.ts:31`; each call = list-models + generateContent):

| Call site | Trigger | Entitlement check | Quota |
|---|---|---|---|
| `aiCommissioner.ts:94` `onWinnerUpdate` | Firestore write to `winners/` (server-only) | ❌ none | factsHash idempotency only |
| `aiCommissioner.ts:337` `onAIRequest` | **Client-created** `ai_requests` doc | ❌ none | ❌ none — the unbounded hole |
| `aiCommissioner.ts:412` `onWeeklyRecapCreated` | Firestore write to `weekly_recaps/` (server-only) | ✅ `:390` | none |
| `aiTesting.ts:113,168,220` (3 callables) | Super-admin test tools | SUPER_ADMIN role gate | none |

**Courier SMS** (secret `COURIER_AUTH_TOKEN`):

| Call site | Audience | Gating today |
|---|---|---|
| `reminders.ts:291` (payment reminder), `:757` (recap blast) — via `sendCourierSMS` | members | `pool.reminders?.smsEnabled` + `smsOptIn` + phone |
| `lib/opsAlertDispatcher.ts:119` `sendOpsSMS` (ops pages) — **its own direct `api.courier.com` fetch, NOT `sendCourierSMS`** (deliberate: "Distinct code path", `:116`), same `COURIER_AUTH_TOKEN` secret | Kevin/ops | `system/config.opsAlerts` recipients, fail-silent |
| `userManagement.ts:174` (security alert), `:219` (`testSmsHttp`) — via `sendCourierSMS` | one user / SUPER_ADMIN | opt-in / SUPER_ADMIN |

**Stripe** — commissioner hosting fees ONLY (money invariant; P2P entry fees never
touch the platform). `createCheckoutSession` (`stripe.ts:191`) is
owner/manager-gated (#468, K17). Stripe *costs* are processing fees on revenue —
proportional, not runaway; risk is abuse hygiene, not spend.

**Firebase/GCP** — Firestore reads/writes, function invocations, egress. Same GCP
billing account as the Gemini key's project (**UNVERIFIED — Kevin confirms in
Phase 0.2**; determines whether one GCP budget covers both).

**Sentry** — client-side (`src/sentry.ts`) **plus a backend module**:
`functions/src/lib/sentryServer.ts` (monetization-alert mirror, review round 2
correction — the first draft said "client-side only"). The backend half no-ops
until a `SENTRY_DSN` env/secret is configured, which Kevin has not wired, so it
is dormant today — but it is a provider surface and belongs in this inventory.
Presumed free tier (UNVERIFIED).

**Email** — Trigger Email extension via `mail` collection. `sendEmail` is
defined in `reminders.ts:34` but called from **17 functions files** (billing,
announcements, squares, bracket scoring, waitlist, …), and
`opsAlertDispatcher.ts` enqueues to `mail` directly (review round 2 correction —
the first draft implied reminders-only). Inventory-only this phase; the full
writer list is Phase 1 attribution work. Provider behind the extension and its
pricing: UNVERIFIED, Kevin confirms in Phase 0.2.

**ESPN** — free, no key; availability risk only (2026-08-15 403 incident), not a
cost surface. Out of scope here.

## Phase 0.2 — Provider facts to confirm before implementation (Kevin + next session)

- Current Gemini model list + pricing; pick the pinned model (recommendation:
  cheapest current Flash-Lite-class model; **DECISION NEEDED**). Confirm the API
  returns `usageMetadata` token counts on `generateContent` (expected: yes).
- Which GCP project/billing account the Gemini key bills to.
- Courier pricing (deferred — SMS off) and the email extension's provider/pricing.
- GCP Budget alerts: create one budget at $100/month with alert thresholds
  50/75/90/100% → email to Kevin (console action, Kevin only). Note: **GCP budgets
  alert, they do not stop spend** — automatic disablement is the internal circuit
  breaker (Phase 2.3), driven by our own estimated-spend counters, not by GCP.

## Phase 0.3 — Caps (✅ APPROVED as proposed — Kevin, 2026-08-22)

The unit economics behind the numbers (prices are Phase 0.2-verify targets, not
gospel): at Flash-Lite-class pricing (~$0.10/M input, $0.40/M output) a typical
request with this codebase's large facts payloads (10–25K tokens in, ~1K out)
costs **~$0.002–0.003**. The 400/pool/month quota therefore costs **~$0.80–1.20
worst case** — the quotas are the binding control and land the addon at roughly
**$4–5 cost per SEASON against $20 revenue (75–85% gross margin)**. The
$5/pool-month dollar breaker exists as a backstop for pricing surprises (model
price change, prompt bloat, a mis-pinned model), not as the day-to-day limiter.

| Provider | Monthly cap | Alert ladder | At 100% |
|---|---|---|---|
| Gemini (all AI) | **$50 estimated** internal breaker (headroom under the $100 total) | 50/75/90% ops alerts | AI features return "temporarily unavailable"; ops alert |
| Per addon pool (AI) | **$5 estimated** | — | that pool's AI disabled for the month |
| GCP total (Gemini + Firebase) | $100 GCP budget | 50/75/90/100% console alerts | Kevin decides manually |
| Courier | $0 — feature off | — | — |
| Stripe | no cap (fees track revenue); webhooks never rate-limited | — | — |
| Sentry / email | inventory only this phase | — | — |

**Cap precedence (added per review round 2 finding 7):** the per-pool $5 breaker
and the global $50 breaker are INDEPENDENT — whichever trips first disables its
own scope (that pool's AI vs all AI), and neither resets the other. The
single-band cost estimate above is deliberately rough; Phase 0.2 replaces it
with a low/base/high table (tokens in/out × verified $/M rates → $/request →
400/month projection) before any quota number is treated as final.

## Phase 0.4 — `system/config.costControls` (server-only config)

Follows the existing `system/config` kill-switch pattern (Rule 1;
`autoClosePools.ts` is the reference). Shape (all server-read; clients never read
it directly):

```
costControls: {
  ai:  { enabled: true, model: "<pinned>", monthlyCapUSD: 50, perPoolMonthlyCapUSD: 5,
         perUserPoolHourly: 3, perUserPoolDaily: 15, perPoolDaily: 60, perPoolMonthly: 400 },
  sms: { enabled: false },   // global kill-switch, new — closes missed-finding #4
  alerts: { thresholds: [0.5, 0.75, 0.9] }
}
```

**Fail-closed for optional paid features**: config missing/unreadable ⇒ AI and SMS
deny (opposite polarity from `autoClosePools`, which fails to *inaction* — here
inaction IS the safe state for spend). Stripe checkout and webhooks are **not**
behind this config — payment processing must not be disabled by a config read error.

**Exit gate for Phase 0:** every provider above has an owner (Kevin), a cap row, an
alert destination, and a feature mapping. Met by this document once Kevin signs off
on the DECISION NEEDED items.

## Phase 0.5 — Stop the bleeding (NEW — small, ships ahead of the big phases)

The full callable migration (Phase 2) is days of work; the unbounded hole is one
rules edit plus one trigger guard:

- 0.5.1 Tighten `firestore.rules:497` create to require ALL of (explicit list
  per review round 3 finding 1 — "tighten" must not read as "replace"): the
  existing `request.auth != null` AND the existing
  `request.resource.data.userId == request.auth.uid` (dropping it would let a
  participant forge `userId` — attribution poisoning and per-user quota framing
  once Phase 2 lands) AND `isPoolParticipant()` AND
  `get(.../pools/$(poolId)).data.billing.featuresUnlocked.aiCommissioner == true`
  (same doc the participant check already `get`s — no extra read billed). Client
  already hides the tab for locked pools, so no user-visible change.
- 0.5.2 Add the entitlement check to `onAIRequest` and `onWinnerUpdate`, mirroring
  `onWeeklyRecapCreated` (`aiCommissioner.ts:390`) — defense in depth for 0.5.1 and
  it stops unmonetized winner-explanation spend on non-addon squares pools.
- 0.5.3 Add the `costControls.sms.enabled` kill-switch to `sendCourierSMS`
  (`smsService.ts:36`), default-deny, returning `'skipped'`. **Mechanism
  (rewritten per review round 2 finding 1 — Critical):** a bare check at the top
  of `sendCourierSMS` cannot honor D4, because the D4-exempt security-alert SMS
  (`userManagement.ts:174`) and `testSmsHttp` (`:219`) flow through the SAME
  function as the member sends. So `sendCourierSMS` gains a required
  `audience: 'member' | 'security' | 'test'` parameter; the kill-switch blocks
  `'member'` only. Callers: `reminders.ts:291,757` pass `'member'`;
  `userManagement.ts:174` passes `'security'`; `:219` passes `'test'`. Ops SMS
  (`sendOpsSMS`, its own code path — see the inventory) is untouched, exempt per
  D4. A missing/unreadable config still fail-closes `'member'` sends.
- 0.5.4 Remove/disable `smsNotifications` from the purchasable addon set
  (`shared/schemas/quote.ts:38`) so nobody buys a feature that is off. (Money-path
  edit — covered by this plan's gate.)
- 0.5.5 Interim ops visibility: count `ai_requests` creates per day in the existing
  admin health snapshot so a spike is visible before Phase 6's dashboard exists.

Deploy order per Rule 2: functions (0.5.2/0.5.3) BEFORE rules (0.5.1).

## Phase 1 — Centralize paid-provider calls and attribution

As in the Codex plan (wrapper around `generateAIResponse` / `sendCourierSMS`;
no feature calls providers directly), with these repo-specific corrections:

- 1.3 usage events: record `usageMetadata` token counts from the `@google/genai`
  response (currently discarded, `gemini.ts:96`), model actually used, feature
  label, poolId/userId, outcome, latency, estimated cost, price-catalog version.
  Server-written, append-only (rules `allow write: if false`, like `admin_audit`).
- 1.4 daily aggregates per provider/feature/pool; no prompts, no phone numbers, no
  responses in telemetry.
- 1.5 versioned price catalog in code (`shared/` or `functions/src/lib/`), not in
  Firestore — prices change by deploy, with review.

**Exit gate:** every external paid call produces an attributable usage event.

⚠️ **A FIRESTORE TTL POLICY IS A MANUAL CONSOLE STEP AND NO DEPLOY COMMAND
CREATES IT** (codex round 2, finding 6). Phase 1 writes an `expiresAt` timestamp
on every raw event, but that field is **inert** until someone creates a TTL
policy naming it. Until then raw events — which carry the `userId`/`poolId`
attribution pair — accumulate for ever, which is both a storage cost and a
retention-promise the plan does not keep (D3 says 90 days). It cannot be
declared in `firestore.indexes.json`; TTL lives at the GCP/Firestore
configuration level, so nothing in this repo can assert it.

**Required after the Phase 1 deploy (Kevin, console or gcloud):**

```
gcloud firestore fields ttls update expiresAt \
  --collection-group=provider_usage_events \
  --enable-ttl --project=gridiron-gamble-uzuqo
```

Until that runs, treat the 90-day retention line in §Retention as ASPIRATIONAL,
not in force.

## Phase 2 — Enforce rate limits and spend controls

Codex's phase, amended:

- 2.1 Move AI request creation to an authenticated callable (matches the
  repo-wide "writes that matter are callables" contract); rules then deny direct
  `ai_requests` creates entirely. **Rollout order matters** (see Phase 7).
- 2.2 Quotas enforced atomically in a transaction, read from `costControls`:
  3/user+pool/hour, 15/user+pool/day, 60/pool/day as proposed — **plus a per-pool
  monthly quota (~400)**, which the Codex table lacked. **Enforcement point
  (added per review round 2 finding 2 — High): the quota transaction lives in
  `onAIRequest`, before the Gemini call — not only in the Phase 2.1 callable.**
  Rationale: 7.5's rollout order deliberately leaves direct `ai_requests`
  creates allowed until the client cutover is verified; a callable-only quota
  would be bypassed by every legacy direct write during that window. The
  callable may pre-check for a friendlier error, but the trigger is the
  enforcement of record; it marks over-quota requests
  `status: 'RATE_LIMITED'` without calling the provider. Rationale: 60/day compounds
  to 1,800/month; at Flash-class prices with this codebase's large facts payloads
  (60 entries with full picks, `aiCommissioner.ts:161-165`) that can breach the
  $5/pool-month budget. 400/month at a generous $0.01/request ≈ $4, inside budget
  with margin. Exact number finalized against Phase 0.2 pricing.
- 2.3 Kill-switch + monthly circuit breaker checked before every provider call
  (estimated-spend counters from Phase 1 aggregates). At cap: clear
  "temporarily unavailable" error + ops alert. Follows the audited-ops
  conventions (`admin_audit` row when a breaker trips).
- 2.4 Never rate-limit Stripe webhooks (signature + idempotency are the guard). ✅
  as Codex wrote it.
- AI test tools: already SUPER_ADMIN-gated (`aiTesting.ts:100`); add the 10/day
  quota as belt-and-braces, low priority.

**Exit gate:** no signed-in user can create unbounded Gemini work; every optional
paid feature has a server-side limit and an emergency off switch.

## Phase 3 — Request shaping

- 3.1–3.3 as Codex wrote (keep the 300 ms debounce; shared debounce utility for
  future type-ahead endpoints; disabled-state/cooldown on the AI submit button).
- 3.4 **Pin the model** from `costControls.ai.model`; delete dynamic discovery
  (`gemini.ts:39-63`) and the error-path list call (`gemini.ts:122-129`). This
  simultaneously: halves Gemini API calls, makes cost estimable, removes the
  key-in-URL exposure, and removes the retired-model fallback. Cap prompt size —
  bracket facts currently include 60 entries with full picks and 40+ games;
  trim to what the answer needs.

- 3.5 **Scope guard — keep the AI on pool business (Kevin, 2026-08-22).**
  Layered, cheapest first:
  (a) server-side cap on `question` length (~500 chars) in the Phase 2.1
  callable — long enough for any real pool question, hostile to "write me an
  app";
  (b) harden `COMMISSIONER_SYSTEM_PROMPT` (`gemini.ts:135`) with an explicit
  scope rule: answer ONLY questions about this pool's results, rules, standings
  and disputes; anything else returns the **schema-valid refusal shape**
  (corrected per review round 2 finding 6 — the schema at `gemini.ts:28`
  REQUIRES `summaryBullets`, `explanationSteps` and `confidence`, so "headline
  with no other content" is unproducible): headline "Out of scope for the AI
  Commissioner", empty `summaryBullets` and `explanationSteps` arrays,
  `confidence: 0` — pinned by a unit test in Phase 7.1;
  (c) keep the forced JSON output schema (`gemini.ts:7-29`) — headline/bullets/
  steps/confidence is a hostile format for code generation or general chat, and
  is itself a meaningful deterrent;
  (d) questions are already stored on the `ai_requests` doc and readable by
  pool participants (`firestore.rules:499`) — social visibility plus the audit
  trail discourages misuse; Phase 1 usage events make abusers findable.
  Explicitly NOT building: an LLM-based topic classifier (a second paid call to
  guard the first). Accepted residual risk: a determined user can phrase around
  (b), but quotas cap the damage at ~$0.05/user/day and the breaker at
  $5/pool/month — misuse is bounded, not merely discouraged.
- 3.6 **User-facing limit messaging (Kevin, 2026-08-22):** no advertised
  numbers; a fair-use sentence in the addon description; at the limit the UI
  says which window is exhausted and when it resets ("The AI Commissioner has
  reached its usage limit for today — resets at midnight ET"), distinct from
  error states per Phase 4.5.

**Exit gate:** no keystroke-driven route can invoke a paid provider; model and
input/output bounds are explicit.

## Phase 4 — 429 / transient-failure handling

As Codex wrote (shared error classifier; honor Retry-After; capped exponential
backoff with jitter, max 3 attempts; terminal `ERROR` state + alert; UI
distinguishes retrying / try-later / disabled), scoped to reality:

- Gemini paths are already async Firestore triggers — retry within the trigger
  invocation window; do not build a general job queue for this (over-engineering
  at current scale; revisit if AI volume grows).
- Courier retry work is **deferred while SMS is off** (D4). Never blind-retry
  payments (unchanged).

## Phase 5 — Secret/environment separation — **DEFER (recommendation)**

The audit's finding is real (one Firebase project, shared secrets), but a second
Firebase project is a heavyweight lift for a one-person shop mid-season (Coolify
build args, config split-brain history, the App Check incident shows how fragile
env plumbing is here). **Recommendation: defer to post-season; keep as a named
open item.** Emulators already cover local dev without touching prod secrets.
**DECISION NEEDED (D5):** accept the deferral or schedule it.

## Phase 6 — Alerts, dashboard, cost per feature

As Codex wrote, right-sized: GCP budget alerts (Phase 0.2, Kevin console); a Super
Admin cost card (month-to-date estimated spend vs caps, per-provider/per-feature
trend, 429/retry/breaker counts, top pools by AI spend, current limits +
kill-switch state) built on the Phase 1 daily aggregates — extend the existing
admin health surface rather than a new dashboard app. Per-feature monthly cost =
attributed usage + allocated overhead; show "insufficient provider data" rather
than inventing a number. Reconcile against invoices monthly (7.3).

## Phase 7 — Verification and rollout

- 7.1 Emulator tests: quota transactions, rules denial of direct `ai_requests`
  creates, entitlement checks, breaker trips, no-retry payment behavior.
- 7.2 Sweep-gated (`PLAN-COST-CONTROLS-SWEEPS.md`): grep sweeps proving every
  paid-provider call goes through the wrappers. **Widened per review round 2
  finding 3 (High): sweeping for `generateAIResponse` / `sendCourierSMS` callers
  alone misses direct-endpoint calls — `sendOpsSMS` already fetches
  `api.courier.com/send` itself (`opsAlertDispatcher.ts:126`).** The sweeps
  therefore match provider ENDPOINTS and SDK classes too
  (`generativelanguage.googleapis.com`, `GoogleGenAI`, `api.courier.com`)
  against an explicit allowlist: the wrapper modules plus the D4-exempt
  `opsAlertDispatcher.ts`. Any other hit fails the sweep.
- 7.3 Telemetry first, observe-only, ≥7 days vs provider dashboards.
- 7.4 Then enforcement, then breakers after alert delivery is verified.
- 7.5 **Phase 2.1 rollout order (corrects Codex's 7.5):** deploy the callable
  (functions) → ship the client cutover (Coolify, Kevin) → **verify the deployed
  bundle uses the callable** → only then deploy the rules deny. Rules-first would
  break AI submissions for every paying pool until the Coolify rebuild — the exact
  transient-window class the `logClientError` incident documented (Rule 2 §3).
  Phase 0.5.1's tightened-but-still-direct rule is the interim state, so this can
  wait for a calm week.

## Key decisions & tradeoffs

- **Fail-closed for optional paid features, fail-open for payments.** A config
  read error must never disable Stripe checkout, and must never enable AI/SMS.
- **Internal estimated-spend breaker, not provider-side caps.** GCP budgets don't
  stop spend and Gemini has no per-key hard cap; our own token-count × price-catalog
  counter is the only breaker that can act in real time. Reconciliation (7.3)
  bounds its drift.
- **Pin the model; give up "best available".** Determinism and cost-estimability
  beat auto-upgrade. Model changes become a config edit with review.
- **Phase 0.5 ships before the architecture phases.** The unbounded hole is live
  during an active season; a two-line rules fix should not wait on a usage-ledger
  design.
- **One config home.** All cost-control config lives in `system/config.costControls`
  — do not create a second location (the `settings/billing_config` vs
  `config/billing_config` split-brain is the cautionary tale).

## Retention (recommendation for Kevin's #4)

- **Raw usage events: 90 days**, auto-deleted via a Firestore TTL policy (set a
  `expiresAt` field at write). Covers reconciliation of 2–3 monthly invoices and
  any dispute window, then stops accumulating read/storage cost.
- **Daily aggregates: 24 months** — small, and enables season-over-season cost
  comparison. Revisit if storage cost ever registers.
- Acceptable estimate-vs-invoice variance to not investigate: **10% or $5,
  whichever is greater** (at $100/month scale, chasing smaller deltas costs more
  attention than it saves).

## Risks / open questions — D1–D5 ✅ RESOLVED (Kevin, 2026-08-22, "Go with
Recommendation" on all five)

- **D1 ✅:** Pin the cheapest current Flash-Lite-class model (Phase 0.2 confirms
  the exact id + price before implementation); upgrade only if answer quality
  disappoints.
- **D2 ✅:** Cap numbers approved as proposed (Gemini $50 internal / $100 GCP
  budget; per-pool quotas incl. 400/month). Follow-up rulings: monthly-per-pool
  cadence, limit messaging at the limit only, and the Phase 3.5 scope guard —
  see decision-of-record #6.
- **D3 ✅:** Retention as recommended — raw events 90 days (TTL), daily
  aggregates 24 months, 10%/$5 variance threshold.
- **D4 ✅:** Member-facing SMS off via the kill-switch; ops + security-alert SMS
  stay exempt. Zero-deploy stopgap remains available: Kevin unsets
  `COURIER_AUTH_TOKEN`, all SMS becomes `'skipped'` (`smsService.ts:38`).
- **D5 ✅:** Phase 5 (dev/prod project separation) deferred to post-season;
  stays a named open item.
- Risk: estimated-spend counters drift from invoices → bounded by 7.3
  reconciliation and the variance rule above.
- Risk: Phase 2.1's rules-deny before client cutover breaks paying pools →
  mitigated by 7.5's ordering; 0.5.1 is the safe interim.

## Out of scope

- ESPN availability/bot-blocking (not a cost surface; `mmp-failure-archaeology`
  has the 403 incident).
- Participant entry-fee money of any kind (P2P invariant — never platform-handled).
- App Check enforcement (its own STOP POINT in HANDOFF.md).
- A general background job queue (revisit only if AI volume outgrows trigger-scoped
  retries).
- Multi-region/deploy-topology changes.
