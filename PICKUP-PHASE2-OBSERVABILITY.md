# PICKUP — Phase 2: Observability (Sentry FE spine + GCP BE + SLOs)

**New-session opener:** "Read PICKUP-PHASE2-OBSERVABILITY.md and HANDOFF.md, then start Phase 2 of PLAN-SECURITY-OBSERVABILITY.md."

This is the durable kickoff for Phase 2. Plan of record: `PLAN-SECURITY-OBSERVABILITY.md` (items **#8–14** are Phase 2). Full callable inventory is in `PLAN-SECURITY-OBSERVABILITY-SWEEPS.md`. Do NOT re-derive the plan — it's locked (grill-with-docs + 5 Codex rounds).

---

## Where things stand (all DONE + verified + deployed)

- **Phase 1 COMPLETE.** All 41 TARGET-NOW callables wrapped in `validated()` (auth → App Check monitor → role claim+doc → strict zod): PR #164 (16) + PR #165 (25), both merged + deployed. Stripe webhook durability (#6/#7): PR #166 merged (`6c87891`) + deployed — `handleStripeWebhook` persists failure state, de-dupes on retry, thresholded ops alert.
- **npm critical closed.** websocket-driver ≥0.7.5 override in BOTH root + functions (PR #170, `c95edb4`).
- **main HEAD at kickoff:** `cb104c2` (verify with `git log --oneline -1` — pull first).
- **Baselines (all green):** root vitest **244**, functions unit **554**, emulator **84 pass / 10 skipped**, 6 firestore.rules suites, 45-fixture NFL matrix, frontend `tsc -b` clean.
- App Check is fleet-wide **monitor** mode (logs token-less calls, does not block). Enforce flips are a **Phase 1 leftover (#5)**, NOT Phase 2 — leave them.

---

## Phase 2 scope — the seven items (#8–14)

Read the plan for the full locked wording. Summary + the decisions already baked in:

1. **#8 Sentry in the React app** — errors, **Session Replay**, rage-click, replay↔error linking, FE perf tracing. DSN via env. Sentry is **NOT installed yet** (`grep @sentry package.json` = 0). **PII masking is MANDATORY before any non-dev sampling**: `maskAllText: true`, `blockAllMedia: true`, explicit selector redaction for money/PII nodes (Payment Handles, emails, admin data). No Replay outside dev/staging until masking is verified.
2. **#9 Correlation, NOT header trace** — Firebase `httpsCallable` will NOT forward custom `sentry-trace`/`baggage` headers (verified in the bundled SDK). So: Sentry distributed trace is **frontend-only** for callable paths; backend correlation = client generates a **correlation id and passes it in the callable DATA payload** (not a header), function echoes it into structured logs via `logging.googleapis.com/trace` (+ span id). Only move a path to `onRequest` if true FE→BE header trace is later required. No standalone OTel collector.
3. **#10 Business-failure monitoring** — emit Sentry custom events (KEEP the Firestore `monetization_alerts` docs) for: Stripe webhook failure/threshold breach, `DOUBLE_CHARGE_REVIEW`, checkout error-rate spike, `async_payment_failed`/`payment_failed`, refund/dispute, App-Check/auth breakage, ESPN sync failure, email-send failure. **The webhook alerts already exist as `monetization_alerts` docs** (types `WEBHOOK_FAILED`, `ASYNC_PAYMENT_FAILED`, `PAYMENT_FAILED`, `DISPUTE`, `REFUND`, `DOUBLE_CHARGE_*`) — Phase 2 wires these to Sentry + the ops dispatcher, it does not re-invent them.
4. **#11 Ops alert dispatcher — server-only, SEPARATE from user notifications.** Add an **ops-recipient config** (env / Secret Manager: ops email list + on-call phone numbers) and a dedicated dispatcher. Do **NOT** reuse `sendCourierSMS` (the end-user SMS path). Email on all flagged issues; **high-priority ⇒ SMS to the on-call list**. High-pri set (tune at sign-off): webhook failure/dead-letter, site-down, auth/App-Check outage, checkout success-rate SLO breach.
5. **#12 In-app surface — NO new tab (preserve the 8-tab invariant).** Extend the Overview **"API Status Center"** + **System** tab with an "Ops Health" section surfacing alerts we already emit (`monetization_alerts`, failed `stripeWebhookEvents`, Health Snapshot history) + **deep-links to Sentry**. Sentry's own dashboard stays the real-time errors/replay/perf pane.
6. **#13 External health checks** — GCP Uptime Checks against the public site AND a **NEW minimal readiness HTTP endpoint** (returns only `200`/`503`, no internals). Current health is a **callable** (`getAdminHealthSnapshot`) + **hourly scheduler** (`scheduledHealthCheck`), NOT HTTP — the readiness endpoint is net-new (one small `onRequest` surface). Alerts route into Cloud Monitoring → the ops dispatcher.
7. **#14 SLOs (proposed defaults — TUNE AT SIGN-OFF, see open decisions):** availability ≥99.5%/30d; checkout success ≥99%; webhook durability ≥99.9% + zero `stripeWebhookEvents` stuck in `failed` past threshold; latency p95 (`createCheckoutSession` <2s, pick-submit <1.5s, `getServerTime` <500ms); error-budget burn-rate → SMS, sustained breach → freeze non-critical deploys.

---

## Verified codebase touchpoints (as of `cb104c2`)

- **Frontend Sentry init:** `src/main.tsx` (entry) + `src/firebase.ts` (App Check init here — `ReCaptchaEnterpriseProvider`, warns at line ~31 if `VITE_RECAPTCHA_SITE_KEY` missing). DSN via a new `VITE_SENTRY_DSN` env.
- **FE crash-report callable (already exists, App-Check-exempt by design):** `functions/src/logClientError.ts` — the plan calls out that this deliberately disables App Check enforcement to accept pre-auth crash reports; keep it exempt.
- **Health/canary:** `functions/src/adminHealth.ts` — `getAdminHealthSnapshot` (onCall, :159), `scheduledHealthCheck` (onSchedule 60min, :176). Canary: `getServerTime` (`functions/src/serverTime.ts:8`, onCall, cors). **No HTTP readiness endpoint yet** — add for #13.
- **Alerts source:** `functions/src/monetizationAlerts.ts` (+ the webhook alerts in `functions/src/stripe.ts` / `functions/src/lib/webhookDurability.ts`). Collection: `monetization_alerts`. Ack path: `acknowledgeMonetizationAlert` (couponTemplates.ts).
- **End-user SMS (DO NOT reuse for ops):** `functions/src/notifications/smsService.ts` → `sendCourierSMS`, secret `courierAuthToken`. Ops dispatcher (#11) needs its OWN recipient config + send path.
- **Admin in-app surface (#12):** `src/components/SuperAdminBentoDashboard.tsx` holds the "API Status Center" / Health Snapshot UI. Extend, don't add a tab.
- **Functions entry:** `functions/src/index.ts` (60 exports) — register any new function (readiness endpoint, ops dispatcher) here.

---

## OPEN DECISIONS — RESOLVED (Kevin, 2026-07-17 kickoff)

1. **Sentry account/DSN — RESOLVED (Kevin, 2026-07-17).** sentry.io project created (free tier), React platform. Decision: **errors + performance tracing ONLY to start; Session Replay OFF (or dev-only) until masking is proven and Kevin opts in** — because the app renders payment handles / emails / admin data and Replay is the metered/PII-sensitive feature. DSN is set locally in `D:\march-melee-pools\.env` as `VITE_SENTRY_DSN=...` (`.env` is gitignored, line 27 — do NOT commit it; read via `import.meta.env.VITE_SENTRY_DSN`). **Prod:** Vite bakes env at build time, so `VITE_SENTRY_DSN` must ALSO be added to Coolify's build env before the Sentry PR deploys, or the prod bundle won't have it. **Shipped** (commit `96811cf`, this branch, not yet merged): `@sentry/react` installed, init in `main.tsx`, errors + tracing on, Replay integration present with `maskAllText`+`blockAllMedia` but `replaysSessionSampleRate: 0` outside DEV (flip via `VITE_SENTRY_REPLAY_SAMPLE_RATE` — one env var, no code change) — wired into the existing `errorHandler.handleError` choke point so `logClientError` and Sentry both fire.
2. **Ops recipients (#11) — RESOLVED.** Store in Firestore `system/config` doc (new field), matching the existing kill-switch config pattern (`autoClose`, etc.) — not Secret Manager, not env.
3. **High-priority SMS set (#11) — RESOLVED.** All four of the plan's proposed defaults page via SMS: Stripe webhook failure/dead-letter, site-down (readiness endpoint), auth/App-Check outage, checkout success-rate SLO breach. Everything else flagged is email-only.
4. **SLO targets (#14) — RESOLVED.** Accept the plan's proposed defaults as-written (availability ≥99.5%/30d, checkout success ≥99%, webhook durability ≥99.9%, latency p95 caps as listed). Ship instrumentation against these now; retune from real data later if needed.

---

## Workflow conventions + hard-won lessons (follow these)

- **Branch + worktree per chunk.** `git worktree add .claude/worktrees/<name> -b feat/<name>` off `main`. Run `node functions/scripts/copy-shared.mjs` + `npm --prefix functions install` in a fresh worktree before building.
- **Gate set before every commit** (with counts, no "done" without proof): `npx tsc -p functions/tsconfig.json --noEmit` (functions) + `npx tsc -b` (frontend); `npm --prefix functions test` (baseline 554); `npm test` (root, baseline 244) — **run the ROOT suite too**, not just functions; emulator (`npm --prefix functions run test:emulator`, needs `JAVA_HOME` = Eclipse Adoptium jdk-21) if you touch functions/rules/sim surface (baseline 84/10-skip).
- **CI `security-audit` runs `npm audit --audit-level=high` at the REPO ROOT**, not functions. A functions-only dependency change can pass locally and fail that gate — fix root too. (Learned on PR #170.) Regenerate lockfiles with `npm install --package-lock-only` for a minimal diff; never hand-reformat package.json (JSON.stringify reindents the whole file → 8000-line noise diff).
- **qodo cycle** (skill `mmp-qodo-cycle`): after push + non-draft PR, qodo posts placeholder → summary → inline findings. Validity-call each BEFORE fixing; fix real ones, reject with evidence, reply on the PR; re-run gates; it does NOT re-review after a fix push (give one ~10-min window then close). Track record now 11/11-ish valid but low-severity — honor the severity stop rule.
- **VERIFY A MERGE ACTUALLY LANDED before deploying.** A phantom merge (GitHub click that didn't take) once made `git pull` say "Already up to date" and the deploy skip every function as "No changes detected" — a no-op against OLD code. ALWAYS: `gh pr view <N> --json state` must be `MERGED` AND `git log origin/main` shows the merge commit BEFORE trusting a deploy. A "Skipped/No changes" on a change you expect to ship = the merge/pull didn't land.
- **Deploy ritual** (Kevin runs deploys, supervised — functions-first): `npm --prefix functions install` (mandatory, else TS2307 stripe) → `npx firebase deploy --only functions --project gridiron-gamble-uzuqo`. Node 22-vs-24 EBADENGINE warning is expected/harmless. Rules deploy only if firestore.rules changed. **Give Kevin full numbered step-by-step instructions for every manual action** (his standing rule — see global CLAUDE.md).
- **Prod project:** `gridiron-gamble-uzuqo`. Frontend www is nginx/Coolify (auto-rebuilds from main push), NOT Firebase Hosting.

---

## Suggested sequencing within Phase 2

Independent, mergeable chunks (one PR each, smallest-first). Confirm with a plan-gate at session start:
1. **Sentry FE spine (#8)** — install `@sentry/react`, init in `main.tsx` with masked Replay (dev-sampled), rage-click, error+replay. Gated on the DSN decision.
2. **Correlation id (#9)** — client generates + threads a correlation id through callable payloads; functions echo to `logging.googleapis.com/trace`. Small shared helper both sides.
3. **Ops dispatcher + config (#11)** — server-only recipient config + email/SMS dispatcher (NOT `sendCourierSMS`). Then wire the existing `monetization_alerts` + webhook failures (#10) into it + Sentry custom events.
4. **Readiness endpoint + Uptime Checks (#13)** — one `onRequest` 200/503, then GCP Uptime Checks (console/gcloud — Kevin's action, give steps).
5. **In-app Ops Health surface (#12)** — extend `SuperAdminBentoDashboard.tsx`, no new tab.
6. **SLO definitions (#14)** — mostly config/docs + burn-rate alerts; gated on the targets decision.

Everything above is **out of scope** for Phase 3 (backups #15–19) and the Verify-block audit (#20–21) — those come after.

---

## SLO definitions (#14) — targets + what's actually instrumented

Kevin accepted the plan's proposed defaults as-written (kickoff 2026-07-17). Targets:

| SLO | Target | Instrumentation |
|---|---|---|
| Availability (site + `getServerTime` canary + readiness endpoint) | ≥99.5% / 30d | **GCP-native** — Cloud Monitoring already tracks per-function invocation/error counts automatically; the readiness endpoint (#13) exists for Uptime Checks to probe. No custom code needed for the metric itself. |
| Checkout success (`createCheckoutSession` non-error, excl. user cancel) | ≥99% | **GCP-native** — same Cloud Monitoring per-function error-rate metric, filtered to this function. |
| Webhook durability (`handleStripeWebhook` success) | ≥99.9% | **GCP-native** for the success-rate number (Cloud Monitoring). |
| Webhook durability — **zero stuck in failed past threshold** (hard objective, not a rate) | 0 | **Custom code, shipped tonight**: `functions/src/webhookDurabilitySweep.ts` — a daily `onSchedule` that scans `stripeWebhookEvents` where `status=="failed"` and pages ops (`dispatchOpsAlert` + `captureMonetizationAlert`) if any doc has sat there >24h. This is independent of the existing attempt-threshold alert (`shouldAlertOnFailure`, fires only while Stripe is actively retrying) — it's the backstop for an event that fails once and is never retried again. Read-only + alert-only, no kill-switch needed (nothing it does mutates data). Pure logic (`isWebhookStuck`, `WEBHOOK_STUCK_MS`) added to `functions/src/lib/webhookDurability.ts`. |
| Latency p95 | `createCheckoutSession` <2s; pick-submit callables <1.5s; `getServerTime` <500ms | **GCP-native** — Cloud Monitoring's per-function execution-time percentile metrics cover this without custom code. |
| Error-budget policy | Burn-rate → SMS; sustained breach → freeze non-critical deploys | **Policy, not code.** Burn-rate alerting on the availability/checkout/webhook-rate/latency SLOs above needs a GCP Cloud Monitoring **SLO object + alerting policy**, referencing the existing per-function metrics — that's console configuration (Kevin action, see below), not something this session can wire from the repo. "Freeze non-critical deploys on sustained breach" is a human process rule to follow when that alert fires, not automatable. |

**Why GCP-native for 3 of 4 numeric SLOs, custom code for the 4th:** Cloud Functions gen2 already emits invocation count, error count, and execution-time percentiles per function to Cloud Monitoring with zero app-code — duplicating that in Firestore/app code would be redundant and drift-prone. The "zero stuck in failed" objective is different: it's a business invariant over Firestore *data* (a doc's age in a specific status), not a Cloud Functions runtime metric, so it has no GCP-native equivalent and needed real code.

**Kevin action for the morning (or whenever there's GCP console time)** — not urgent, no deploy is blocked on this:
1. GCP Console → Monitoring → SLOs → Create SLO, for each of: availability (readiness endpoint / uptime check), `createCheckoutSession` error rate, `handleStripeWebhook` error rate, latency (per the p95 targets above). Target values are the table above.
2. GCP Console → Monitoring → Alerting → create a burn-rate alerting policy per SLO, notification channel = the ops email list (same list used in `system/config.opsAlerts`, so paging is consistent) + SMS for on-call.
3. This is independent of and can be done anytime after #13's Uptime Check setup (same GCP Monitoring console area).

---

_Delete this file once Phase 2 is complete; fold the outcome into HANDOFF.md (the durable state)._
