# Plan Review Log: Security, Observability, Payments & Backup Hardening
Act 1 (grill-with-docs) complete — plan locked, LTI dropped, terms per CONTEXT.md. MAX_ROUNDS=5.

## Round 1 — Codex (VERDICT: REVISE)
Codex read the repo (dbService.ts, invitesService.ts, firebase.ts, adminHealth.ts, errorHandler.ts, logger.ts, ADR-0001) and returned 12 findings:
1. `.strict()` conflicts with intentionally-permissive shared schemas + ADR-0001 migration-era heterogeneous `createPool` payloads. Keep migration callables permissive until versioned client cutover.
2. Firebase callable serializer trap: client strips `undefined`; some call sites send `null` (invitesService). Normalize null→undefined before any strict rollout.
3. App Check not production-ready; `logClientError` must stay exempt (pre-auth crash reports). Per-endpoint kill switch + exempt boot/crash/public paths + coverage-by-app-version.
4. Single-doc sliding-window counter = hotspot/race. Use per-uid sharded/atomic buckets keyed uid+appId, targeted only.
5. Dead-letter-before-500 re-dead-letters every Stripe retry of same `event.id`; `markFailed()` deletes state. Keep failure state on existing `stripeWebhookEvents` doc (status/attemptCount/lastError); alert on age/attempt threshold.
6. Webhook ignores `payment_intent.payment_failed` / `checkout.session.async_payment_failed`. Add handlers or narrow the durability claim.
7. `smsService` texts end-users, not an on-call list. Define server-only ops-recipient config + real alert dispatcher.
8. "<60s trace" not delivered by stamping a traceId string; no Sentry in repo; callable traffic. Implement real `sentry-trace`/`baggage` propagation + Cloud Trace field, else downgrade to correlation IDs.
9. GCP Uptime needs an HTTP readiness endpoint; current health is callable + scheduler = new surface. Add a minimal 200/500 readiness endpoint or drop Uptime.
10. Firestore backup facts wrong: scheduled backups stay in source-DB location; 1 daily + 1 weekly schedule/db; retention ≤14 weeks; PITR 7 days. Cross-region = `gcloud firestore export` to GCS, NOT scheduled backups. Drop "3-2-1" overclaim.
11. `firebase auth:export` writes a LOCAL file; define upload/retention/encryption/restore. `storageBucket` IS configured (firebase.ts:11) → verify bucket inventory before excluding Storage.
12. Domain drift: `confirmPayment` = Member Payment Claim (P2P entry fee), distinct from Stripe Billing. Don't conflate the two payment planes in alerts/threat model.

### Claude's response — ALL 12 ACCEPTED (final arbiter)
Every finding is valid; several correct factual/design errors. Applied to PLAN-SECURITY-OBSERVABILITY.md: per-schema strict only post-normalization + migration callables stay permissive (1,2); App Check per-endpoint kill switch + explicit exemptions (3); per-uid sharded counter, not shared-doc (4); dead-letter state on existing `stripeWebhookEvents` doc + failed/async-failed handlers (5,6); server-only ops-recipient config + dispatcher (7); precise tracing story — Sentry trace as the <60s path, Cloud Logging correlation via `logging.googleapis.com/trace` field, no overclaim (8); minimal readiness HTTP endpoint acknowledged as new surface (9); corrected Firestore backup facts — scheduled=same-location, export=cross-region durability path + restore drill (10); Auth-export→GCS job w/ lifecycle+encryption+restore, verify Storage inventory (11); confirmPayment qualified as Member Payment Claim, separate plane (12).

## Round 2 — Codex (VERDICT: REVISE)
10/12 prior findings confirmed genuinely addressed (#1,2,3,5,6,7,9,10,11,12). Two reopened + one new:
- **#4 reopened (High)**: single per-uid rate-limit doc still hotspots/races + dropped `+appId`. Fix: sharded per-(uid,endpoint,appId,window) bucket docs.
- **#8 reopened (High)**: Firebase `httpsCallable` transport only injects auth/messaging/App-Check headers — cannot forward `sentry-trace`/`baggage` (verified in bundled SDK). Fix: correlation id in callable data payload → `logging.googleapis.com/trace`; header trace only if paths move to HTTP.
- **NEW (Medium)**: Session Replay on Payment Handle/PII/admin surfaces with no masking = privacy leak. Fix: `maskAllText`/`blockAllMedia`/selector redaction + low sampling before non-dev.

### Claude's response — ALL 3 ACCEPTED
Rev 3 applied: sharded per-(uid,endpoint,appId,window) counter with atomic increment (Phase 1 #5); tracing downgraded to correlation-id-in-payload + `logging.googleapis.com/trace`, Sentry trace FE-only for callables, HTTP-endpoint path noted as the only way to header-propagate (Phase 2 #8/#9); mandatory Replay PII masking before non-dev sampling (Phase 2 #8). Key-decisions updated.

## Round 3 — Codex (VERDICT: REVISE)
Tracing (b) + Session Replay (c) confirmed genuinely addressed. Rate limiter (a) still open + 2 more, all narrow:
- **High**: `createClaimCode` is unauthenticated (no `uid`) — `uid:...` key collapses all anon callers into one hotspot bucket (`participant.ts:43`).
- **Medium**: `joinWaitlist` — another anonymous hot-pool write (`waitlist.ts:56`) — missing from the abuse-prone set.
- **Low**: doc drift — header still "Rev 2"; risks section still "Per-uid rate-limit doc".

### Claude's response — ALL 3 ACCEPTED
Rev 4 applied: rate-limit identity is `uid` for authed callables but keys anon paths by `guestDeviceKey`/App-Check token + appId (createClaimCode/claimByCode); added `joinWaitlist` to the set keyed by App-Check token + poolId; fixed header (Rev 4) + risks-section stale text.

## Round 4 — Codex (VERDICT: REVISE — no findings)
Returned a bare `VERDICT: REVISE` with zero articulated findings. Non-actionable; treated as no concrete objection. Escalating to a final round forcing articulation.

## Round 5 — Codex (VERDICT: REVISE — cap reached) — 2 concrete findings, both ACCEPTED
- **High**: `claimByCode` misclassified as anonymous — it is auth-required and takes only `claimCode`; only `createClaimCode` takes `guestDeviceKey` (`participant.ts:157` vs `:43`). Fix applied: `createClaimCode` keyed by `guestDeviceKey`+AppCheck+appId; `claimByCode` moved to the authenticated (`uid`) set, optional `claimCode` sub-key.
- **Medium**: `createCheckoutSession` (bundle vs pool path, `stripe.ts:160`) and `adminBillingOps.*` (`op`/`action` branching) are multi-shape → blanket single-shape `.strict()` is wrong. Fix applied: use zod `discriminatedUnion` (strict per variant) or split callables; plan #1/#3 updated.

## Resolution — CAP REACHED (5/5), converged on substance
The loop hit MAX_ROUNDS. This is NOT a disagreement deadlock: across all 5 rounds Codex raised ~20 findings and **Claude accepted every one — zero rejected**. Each round's findings were genuine repo-grounded corrections (migration-payload/serializer traps, Stripe retry semantics, callable header-propagation impossibility, Replay PII, backup facts, identity keys, multi-shape schemas). Findings shrank in severity/scope over rounds (12 → 3 → 3 → 0-articulated → 2 narrow). No fabricated APPROVED. Plan Rev 5 is the deliverable; remaining risk is low and refinement-level. Handed to Kevin for sign-off.
