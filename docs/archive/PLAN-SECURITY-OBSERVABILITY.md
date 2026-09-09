# Plan: Security, Observability, Payments & Backup Hardening
_Locked via grill-with-docs — by Claude + Kevin. Terms per CONTEXT.md. Rev 6 (post Codex ×5 + sweep absorption). Full inventory: PLAN-SECURITY-OBSERVABILITY-SWEEPS.md._

## Goal
Tighten march-melee-pools across three fronts without adding product surface: (1) make Cloud Function callables reject malformed/unexpected input at the trust boundary; (2) stand up real error/replay/tracing observability with alerting so we see failures before Members or Commissioners do; (3) close the payment silent-loss hole and the data-durability gaps. The LMS/LTI course rubric is **out of scope** — this product is not distributed through an LMS (audit scored 0/6 as a category mismatch, correct and intentional).

## Two payment planes (do not conflate — Codex #12)
- **Entry Fee / Member Payment Claim**: `confirmPayment` is a Member's honor-system self-report that they sent the P2P Entry Fee to a Commissioner (CONTEXT.md). No money moves through the platform. Advisory only.
- **Billing (Stripe)**: commissioner hosting fees + Bundles. This is the ONLY plane with real money, webhooks, ledgers, dead-letters. All payment *monitoring/dead-letter* work below is the Stripe/Billing plane only.

## Scope decisions from the grill (confirmed)
- **No LMS pivot.** All six LTI items dropped; audit is a one-time deliverable.
- **Supabase is N/A** — not used in application code; Firestore only.
- **Prod www is nginx/Coolify** (not Firebase Hosting) — reflected in the payload-limits table.
- Sequencing: **Phase 1 security → Phase 2 observability → Phase 3 backups**; Verify block is a parallel audit deliverable.

---

## Phase 1 — Trust-boundary hardening (callables)

### Sweep-absorbed corrections (Rev 6 — from PLAN-SECURITY-OBSERVABILITY-SWEEPS.md, 108 callables audited)
- **Wrapper must run auth BEFORE schema** (Sweep C3): today `confirmPayment` validates input at `:19` before the auth check at `:24`, leaking shape errors to unauthenticated callers. `validated()` order = auth → App Check → schema → handler.
- **Multi-shape set is 10, not 3** (C1): discriminatedUnion also for `adminSaveBillingConfig` (kind), `adminManageCoupon` (op), `adminUpdatePoolBilling` (action), `managePlayoffEntry`, `adminGrantEntitlement`, `adminRevokeEntitlement`, `setPaidStatus`, plus permissive `createPool`/`createNFLPool` (type).
- **Anon rate-limit set expands** (C2): add `reserveSquare` (guest square, key `guestDeviceKey`), `purchasePropCard` (guest, key `guestDeviceKey`), `validateBillingAccess` (public read — C8), `resolveReferralToken` (anon). Rate-limit identity for these is non-uid.
- **Wave-1 TARGET adds the money/admin writes the plan omitted** (C6): `adminGrantEntitlement`/`adminRevokeEntitlement`, `createCouponTemplate`/`updateCouponTemplate`/`mintCouponFromTemplate`, `managePlayoffEntry`, `setPaidStatus`, `updateTournamentData` (raw merge, NONE today — C7-style), `submitBracketEntry` (NONE at head, delegates raw `request.data` — C7).
- **Standardize role checks on the JWT claim** (C5): `validated()` gates via `assertCallerRole` (tamper-proof `token.role`) and retires the mutable `users/{uid}.role` Firestore fallback in `updateTournamentData`, the ESPN/conference tournament callables, and `updateGlobalPlayoffResults`.
- **NEW authz fix — `syncAllUsers`** (C4, verified): `userSync.ts:58` requires only login, no role gate, then lists 1000 Auth users. Add a SUPER_ADMIN gate. (Sweep's other C4 flag, `simulateGameUpdate`, was a false positive — it IS gated inside its txn at `:1288-1297`; no change needed.)

1. **Shared validation wrapper, per-schema opt-in to strict.** Build `validated(schema, handler)` around `onCall` that runs the schema before the handler. **`.strict()` is applied per-schema, NOT blanket** (Codex #1): shared schemas in `shared/schemas/*` are intentionally permissive gates and **ADR-0001** requires `createPool` to accept heterogeneous flat vs `{type,config}` payloads during migration. So:
   - Migration-era / heterogeneous callables (`createPool`, anything reading mixed shapes in `poolOps.ts`) stay **permissive/passthrough** until a versioned client cutover normalizes their payloads.
   - New + money/admin callables get `.strict()` — but **multi-shape callables use a zod `discriminatedUnion` (strict per variant), not one flat strict schema**, or are split into separate callables. Known multi-shape (Codex R5): `createCheckoutSession` (bundle path vs pool-checkout path, `stripe.ts:160`), `adminManageCoupon`/`adminUpdatePoolBilling` (branch on `op`/`action`, `adminBillingOps.ts:67`). Only genuinely single-shape callables get a flat `.strict()`.
2. **Normalize `null`→`undefined` before any strict rollout** (Codex #2). Firebase's callable serializer + zod optionals already force the client to strip `undefined` (`dbService.ts` ~1555), while other call sites still send `null` (`invitesService.ts` ~29). Add a shared client `stripNullish` helper (or a schema `.preprocess` that maps `null`→`undefined`) so a `.strict()` schema doesn't reject legitimate calls.
3. **Coverage order — money/admin/write first.** After #1/#2 are in place:
   - Money/Billing: `createCheckoutSession` (discriminated-union strict: bundle vs pool), `redeemCoupon`, `redeemPoolCredit`, `adminBillingOps.*` (discriminated-union on `op`/`action`), `adminAdjustUserCredits`.
   - Member Payment Claim: `confirmPayment` — replace hand-rolled `if (!poolId…)` with a schema (still its own plane, not Stripe).
   - Admin/role: `setUserRole`, `setSuperAdminClaim`, `sendAdminPasswordReset`, `sendUserEmail`, `deleteUserAccount`.
   - Pool writes: `updatePoolSettings`, `reserveSquare`, `markSquaresPaid`, `submitBracketEntry`, `submitNFLPicks`, `submitPlayoffPicks`, `purchasePropCard`, `poolExceptions.*`.
4. **String bounds, not sanitization** (grill decision). Validate-in / encode-out: add `.max(n)` caps + reject control chars/NUL in zod string fields. Do NOT mutate input. Output encoding already exists (`escapeHtml`, React auto-escape) — audit sites, add no lossy input layer.
5. **Rate limiting for callables.**
   - **App Check, per-endpoint behind a kill switch** (Codex #3) — NOT flip-everything-at-once. Today the web app only warns when no site key is set (`firebase.ts:24`) and `logClientError` deliberately disables enforcement to accept pre-auth crash reports (`logClientError.ts:11`). So: roll out per callable, track verified-request coverage **by app version**, and keep **boot/crash/public-link paths exempt** (`logClientError`, `joinPreview`, `emailUnsubscribe`, public join paths) until coverage is proven.
   - **Sharded bucket docs keyed by caller identity, targeted** (Codex #4, R2/R3) — one bucket doc per `identity:endpoint:appId:window`, written with atomic `FieldValue.increment` (no read-modify-write race). **Identity is `uid` for authenticated callables, but the abuse-prone set includes unauthenticated paths** where there is no uid — for those, key by the request's stable non-uid identity to avoid collapsing all anonymous callers into one hotspot bucket:
     - `createClaimCode` (anon, only this one takes `guestDeviceKey`, `participant.ts:43`) → key by `guestDeviceKey` + App-Check token + `appId`.
     - `joinWaitlist` (anon hot-pool write, `waitlist.ts:56`) → key by App-Check token + `poolId` + `appId`.
     - Authenticated set → `uid`: `createCheckoutSession`, `sendPoolInvites`, SMS senders, `sendAdminPasswordReset`, `confirmPayment`, and **`claimByCode`** (auth-required, takes only `claimCode`, `participant.ts:157` — NOT anonymous; optionally sub-key by `claimCode`).
     A single per-uid doc is rejected — it hotspots/races under one identity's concurrent calls and drops `appId`. `// ponytail: doc-per-(identity,endpoint,appId,window) is the floor that avoids contention; Memorystore token buckets only if burst accuracy/cost demands it.`

## Phase 1 — Stripe webhook durability (the real gap)
6. **Persist failure state on the existing `stripeWebhookEvents` doc** (Codex #5), keyed by `event.id`. **Stop deleting state in `markFailed()`** — instead flip it to `{ status: "failed", attemptCount: increment, lastError }`. Stripe already retries the same `event.id`, so this de-dupes naturally; alert only on **age/attempt thresholds**, not on every retry. (No new `paymentDeadLetter` collection — reuse the doc that already exists.)
7. **Handle the failure events we currently ignore** (Codex #6): add explicit handlers for `checkout.session.async_payment_failed` and `payment_intent.payment_failed` (today only completed/expired/refund/dispute are handled, `stripe.ts:833`). Otherwise narrow the durability claim to exactly the handled events — no silent-loss overclaim.

---

## Phase 2 — Observability (Sentry FE spine + GCP BE)

8. **Sentry in the React app**: errors, **Session Replay**, **rage-click** detection, replay↔error linking, and FE performance tracing. DSN via env.
   - **Replay PII masking is mandatory before any non-dev sampling** (Codex R2, new): the app renders Payment Handles, emails, and admin data (`firestore.rules:144`, `AdminPanel.tsx`, `UserProfile.tsx`, `PoolRoute.tsx`). Enable Replay with `maskAllText: true`, `blockAllMedia: true`, explicit selector redaction for money/PII nodes, and low sampling. No Replay outside dev/staging until masking is verified.
9. **Correlation, NOT header trace propagation through callables** (Codex #8, reopened R2). Firebase's `httpsCallable` transport only injects auth/messaging/App-Check headers — it will **not** forward custom `sentry-trace`/`baggage` headers (verified in the bundled SDK). So:
   - Sentry's distributed trace is **frontend-only** for callable paths.
   - Backend correlation: the client generates a **correlation id and passes it in the callable *data payload*** (not a header); the function echoes it into structured logs via the **`logging.googleapis.com/trace`** field (+ span id) so Cloud Logging + Cloud Trace group by it. This is the `<60s trace` mechanism for callable traffic.
   - Only if true FE→BE header trace is later required: move those specific paths to `onRequest` HTTP endpoints where custom headers can be forwarded. Standalone OTel collector still skipped.
10. **Business-failure monitoring**: emit Sentry custom events (keep Firestore `monetization_alerts`) for: Stripe webhook failure/attempt-threshold breach, `DOUBLE_CHARGE_REVIEW`, checkout error-rate spike, `async_payment_failed`/`payment_failed`, refund/dispute, App-Check/auth breakage, ESPN sync failure, email-send failure.
11. **Ops alert dispatcher — server-only, separate from user notifications** (Codex #7). Add an **ops-recipient config** (env/Secret Manager: ops email list + on-call phone numbers) and a dedicated dispatcher. Do NOT reuse `smsService`'s end-user path (`userManagement.ts:164` texts users). Email on all flagged issues; **high-priority ⇒ SMS to the on-call list**. High-priority set (tune at sign-off): Stripe webhook failure/dead-letter, site-down (#13), auth/App-Check outage, checkout success-rate SLO breach.
12. **In-app surface (no new tab)**: extend the **Overview "API Status Center"** (per *Health Snapshot* in CONTEXT.md) + **System** tab with an "Ops Health" section surfacing alerts we already emit (`monetization_alerts`, failed `stripeWebhookEvents`, `Health Snapshot` history) + **deep-links to Sentry**. Sentry's own dashboard stays the real-time errors/replay/perf pane. Preserves the eight-tab invariant.
13. **External multi-region health checks**: **GCP Uptime Checks** against the public site AND a **new minimal readiness HTTP endpoint** (Codex #9) — returns only `200`/`503`, no internals (current health is a callable + hourly scheduler, `adminHealth.ts:117`, not HTTP). This is a small, acknowledged new surface (one endpoint). Alerts route into Cloud Monitoring → the ops dispatcher. `// ponytail: native + free tier; add BetterStack later only for a public status page.`

## Phase 2 — SLOs (proposed defaults — tune at sign-off)
14. Define + instrument:
   - **Availability** (site + `getServerTime` canary + readiness endpoint): ≥ 99.5% / 30 days.
   - **Checkout success**: `createCheckoutSession` non-error ≥ 99% (excl. user cancel).
   - **Webhook durability**: `handleStripeWebhook` success ≥ 99.9%; **zero `stripeWebhookEvents` stuck in `failed` past threshold** is a hard objective.
   - **Latency (p95)**: `createCheckoutSession` < 2s; pick-submit callables < 1.5s; `getServerTime` < 500ms.
   - **Error-budget policy**: burn-rate alert → SMS; sustained breach → freeze non-critical deploys.

**Phase 2 (#8–14) SHIPPED 2026-07-17** — PR #171 (all 7 items) + PR #173 (readiness
128MiB→256MiB OOM fix found via live Uptime Check test) merged, functions +
frontend deployed, prod-verified (Sentry confirmed live via `window.__SENTRY__`
+ baked-in DSN; GCP Uptime Check green against `/readiness`; Firestore
`system/config.opsAlerts` populated). Kevin's kickoff decisions: ops config →
Firestore doc not Secret Manager; SMS paging → all 4 proposed high-pri types
(webhook failure/dead-letter, site-down, auth/App-Check outage, checkout SLO
breach); SLO targets → accepted as written above.

SLO instrumentation split: availability/checkout-success/latency-p95 ride on
Cloud Functions gen2's built-in Cloud Monitoring per-function metrics (no app
code — just a GCP console SLO-object + alerting-policy setup, NOT yet done,
optional/not urgent). The "zero stuck-in-failed webhooks" hard objective got
real code: `functions/src/webhookDurabilitySweep.ts`, a daily backstop
independent of the existing attempt-threshold alert. Correlation id (#9) is
wired into `dbService.ts`'s 27 call sites only — ~13 other direct-`httpsCallable`
files are SWEEP-LATER, tracked under the general callable-fleet backlog, not
silently claimed complete.

Known follow-ups (optional, not urgent): GCP SLO objects/alerting policies for
the 3 non-webhook SLOs; `src/sentry.ts`'s dynamic `import('@sentry/react')`
didn't actually get code-split by Vite in the prod build (merged into the main
bundle — functionally harmless, just didn't achieve the lazy-load perf intent);
optional `SENTRY_DSN` functions secret to activate backend Sentry events
(Firestore alerts + ops email/SMS already work without it).

---

## Phase 3 — Backup & recovery (Firestore + Auth) — facts corrected (Codex #10/#11)

15. **PITR**: enable Firestore Point-in-Time Recovery — **7-day** window (hard ceiling, not archive). `gcloud firestore databases update '(default)' --enable-pitr`.
16. **Scheduled backups**: `gcloud firestore backups schedules create --database='(default)' --recurrence=DAILY --retention=…` and a second WEEKLY schedule. Constraints to respect: **one daily + one weekly schedule per database**, retention **≤ 14 weeks**, and backups **stay in the source database's location** (they are NOT a cross-region copy). Native restore via `gcloud firestore databases restore`.
17. **Cross-region durability = export, not scheduled backup**: weekly `gcloud firestore export gs://<bucket>` to a **GCS bucket in a different region**, with object versioning + lifecycle retention. This — not #16 — is the off-region copy. Include a **documented restore drill** (`gcloud firestore import`) so recovery is proven, not assumed. Drop the earlier "3-2-1" phrasing; state coverage precisely.
18. **Firebase Auth export** (Codex #11): `firebase auth:export` writes a **local JSON/CSV file** — so define a scheduled job that exports to a temp file, **uploads to the off-region GCS bucket** with lifecycle rules + encryption, and a restore drill (`auth:import`). This closes the identity-loss gap (Auth is not in Firestore backups).
19. **Verify Cloud Storage inventory before excluding it** (Codex #11): `firebase.ts:11` configures a `storageBucket`. Enumerate actual buckets/objects (`gsutil ls`); only exclude Storage from backup scope once confirmed empty/unused. If in use, add it to the export job.

---

## Verify block — audit deliverable (no code unless a fix is approved)
20. **Limits & ceilings table**:
   - **Cloud Functions (gen2)**: no `maxInstances` set ⇒ default cap (100/function); callable req/resp ≤ 10 MB; timeouts currently 15–300s.
   - **Firestore**: 1 MB/doc; ~1 sustained write/sec/doc; query/txn limits.
   - **Coolify/nginx (prod www)**: `client_max_body_size` (default 1 MB) — verify configured value.
   - **Stripe / Gemini**: API rate + token/payload limits.
21. **Runtime-vs-timeout audit**: flag functions whose worst-case runtime nears their timeout — `aiTesting.*` (300s/1GiB Gemini), `generateTestScenario`, `backfillPools`, `backfillMemberRecords`, scoring sweeps. Per candidate: keep, or **move to Cloud Tasks + webhook callback**. No `maxInstances` changes this pass (separate approved change).

---

## Key decisions & tradeoffs
- **LTI dropped** — product/rubric category mismatch, confirmed not pivoting.
- **Sanitization replaced by validate-in/encode-out** — blanket input sanitization corrupts data and duplicates existing output encoding.
- **`.strict()` is per-schema, gated on client normalization** — respects ADR-0001 migration payloads + the Firebase null/undefined serializer trap.
- **App Check rolls out per-endpoint with explicit public exemptions** — enforce-first would break boot/crash/public-link paths.
- **No new dead-letter collection or job queue** — reuse `stripeWebhookEvents` + Stripe's own retries; fix is state persistence + thresholded alerting + missing failure-event handlers.
- **Ops alerting is a server-only dispatcher**, not the end-user SMS path.
- **Tracing claim is precise** — Firebase callables can't forward `sentry-trace` headers, so FE→BE stitching uses a **correlation id in the callable data payload** echoed to `logging.googleapis.com/trace`; Sentry trace stays FE-side; header-based trace only if paths move to HTTP. No standalone OTel.
- **Session Replay is masked-by-default** — Payment Handles/PII/admin surfaces require `maskAllText`/`blockAllMedia`/selector redaction before non-dev sampling.
- **Backups**: scheduled backups are same-location/native-restore; the off-region durability copy is a GCS **export**, with a restore drill. No "3-2-1" overclaim.
- **No ninth admin tab** — Ops Health extends Overview API Status Center + System.

## Risks / open questions
- App Check per-endpoint rollout + coverage-by-version tracking is real work; mis-sequencing locks out clients.
- Sharded rate-limit bucket doc (`identity:endpoint:appId:window`) adds read+write per guarded call; ceiling named (Memorystore upgrade path). Anonymous paths key on `guestDeviceKey`/App-Check token, not `uid`.
- ~~SLO targets (#14) and high-priority SMS set (#11) await Kevin's confirmation~~ — RESOLVED 2026-07-17, see Phase 2 shipped note above.
- Adding `async_payment_failed`/`payment_failed` handlers (#7) requires deciding the Member/Commissioner UX on a failed async payment.

## Out of scope
- All LTI 1.3 / AGS grade passback / NRPS roster sync (no LMS pivot).
- Supabase anything (not used).
- Rebuilding Sentry's dashboard in-app.
- Full OpenTelemetry collector deployment.
- Setting explicit `maxInstances` (separate approved change).
