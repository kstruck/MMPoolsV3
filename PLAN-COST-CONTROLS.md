# Plan: Cost Controls — rate limits, spend caps, and usage attribution for paid providers

_Compiled 2026-08-22 from a Codex rate-limiting/cost audit (run by Kevin), re-verified
claim-by-claim against the repo by Claude, plus Kevin's answers of 2026-08-22.
Terms per CONTEXT.md. Plan-gated: touches **money** (billing entitlements, provider
spend) and **authorization** (`firestore.rules` `ai_requests`, new callables)._

## Gate status (2026-08-22)

- ✅ Phase 0 (this document): inventory, caps, config design — authored.
- ⛔ **Review log NOT run.** `codex` is unreachable from the cloud environment that
  authored this (network gateway denies `api.openai.com`; CLI absent; key unset —
  same state HANDOFF.md records for #504–#509). CLAUDE.md §2c requires a codex
  round on this plan before implementation — run it from Windows or from a cloud
  session started after Kevin's environment fix lands.
- ⛔ Sweeps (`PLAN-COST-CONTROLS-SWEEPS.md`) not built — required before Phase 1+.
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
| `reminders.ts:291` (payment reminder), `:757` (recap blast) | members | `pool.reminders?.smsEnabled` + `smsOptIn` + phone |
| `lib/opsAlertDispatcher.ts:116` (ops pages) | Kevin/ops | `system/config.opsAlerts` recipients, fail-silent |
| `userManagement.ts:174` (security alert), `:219` (`testSmsHttp`) | one user / SUPER_ADMIN | opt-in / SUPER_ADMIN |

**Stripe** — commissioner hosting fees ONLY (money invariant; P2P entry fees never
touch the platform). `createCheckoutSession` (`stripe.ts:191`) is
owner/manager-gated (#468, K17). Stripe *costs* are processing fees on revenue —
proportional, not runaway; risk is abuse hygiene, not spend.

**Firebase/GCP** — Firestore reads/writes, function invocations, egress. Same GCP
billing account as the Gemini key's project (**UNVERIFIED — Kevin confirms in
Phase 0.2**; determines whether one GCP budget covers both).

**Sentry** — client-side only (`src/sentry.ts`). Presumed free tier (UNVERIFIED).

**Email** — Trigger Email extension via `mail` collection (`reminders.ts` →
`sendEmail`). Provider behind the extension and its pricing: UNVERIFIED, Kevin
confirms in Phase 0.2.

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

- 0.5.1 Tighten `firestore.rules:497` create: require `isPoolParticipant()` AND
  `get(.../pools/$(poolId)).data.billing.featuresUnlocked.aiCommissioner == true`
  (same doc the participant check already `get`s — no extra read billed). Client
  already hides the tab for locked pools, so no user-visible change.
- 0.5.2 Add the entitlement check to `onAIRequest` and `onWinnerUpdate`, mirroring
  `onWeeklyRecapCreated` (`aiCommissioner.ts:390`) — defense in depth for 0.5.1 and
  it stops unmonetized winner-explanation spend on non-addon squares pools.
- 0.5.3 Add the `costControls.sms.enabled` kill-switch check at the top of
  `sendCourierSMS` (`smsService.ts:36`), default-deny, returning `'skipped'`.
  Scope: member-facing sends. **DECISION NEEDED (D4):** whether ops SMS
  (`opsAlertDispatcher`) and the security-alert SMS stay exempt (recommended: yes —
  Kevin's own alerts, tiny volume) or go dark too.
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

## Phase 2 — Enforce rate limits and spend controls

Codex's phase, amended:

- 2.1 Move AI request creation to an authenticated callable (matches the
  repo-wide "writes that matter are callables" contract); rules then deny direct
  `ai_requests` creates entirely. **Rollout order matters** (see Phase 7).
- 2.2 Quotas enforced atomically in a transaction, read from `costControls`:
  3/user+pool/hour, 15/user+pool/day, 60/pool/day as proposed — **plus a per-pool
  monthly quota (~400)**, which the Codex table lacked. Rationale: 60/day compounds
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
  and disputes; anything else returns the schema's headline "Out of scope for
  the AI Commissioner" with no other content;
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
- 7.2 Sweep-gated: grep sweeps proving no direct `generateAIResponse` /
  `sendCourierSMS` callers outside the wrappers (`PLAN-COST-CONTROLS-SWEEPS.md`).
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
