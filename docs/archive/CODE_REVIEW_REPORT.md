# MMPoolsV3 — Architecture & Security Review

**Repo:** https://github.com/kstruck/MMPoolsV3
**Reviewed:** 2026-06-11
**Scope:** Business-logic correctness, payments, auth, data deletion, injection vectors, Firestore N+1 / performance. Architecture-level, not style.
**Stack:** React + Vite (`src/`), Firebase Cloud Functions v2 / TypeScript (`functions/src/`), Firestore, Stripe.

## How to use this report
Each finding is self-contained: severity, exact `file:line`, exploit scenario, and a concrete fix. Drop individual findings into Antigravity or Claude Code as remediation tasks. Findings are tagged:

- **[VERIFIED]** — I read the code and confirmed the issue directly.
- **[REPORTED]** — surfaced by a review agent; the pattern is real but confirm the exact line during remediation.

Confidence filter applied: speculative items were dropped. Items that turned out to be properly handled are listed in **Appendix B** so you know they were checked.

---

## Executive summary

The app is functionally broad (brackets, NFL pick'em/survivor/margin, squares, playoff, props) and the Firestore rules are **better than typical AI-generated output** — billing fields, participant indices, winners, and audit logs are all locked to Cloud Functions. Admin is a tamper-proof JWT claim, not a client field. That's the good news.

The bad news is concentrated in the **money path** and in **read-side data exposure**:

| # | Severity | Finding | Area |
|---|----------|---------|------|
| C1 | 🔴 Critical | Client controls checkout `price`; `price:0` self-activates a pool with no Stripe, no coupon | Payments |
| C2 | 🔴 Critical | Any authenticated user can read every other user's record and every pool's entries/picks | Auth / PII |
| C3 | 🔴 Critical | Stripe webhook has no idempotency → retries double-credit bundles | Payments |
| H1 | 🟠 High | Referral tokens are `btoa(userId)` — trivially forgeable; no self-referral block | Payments |
| H2 | 🟠 High | `redeemCoupon` doesn't verify caller owns the target pool | Payments |
| H3 | 🟠 High | `confirmPayment` doesn't verify caller owns the squares | Payments |
| H4 | 🟠 High | Bracket upset-bonus seed lookup differs client vs server → standings drift | Logic |
| H5 | 🟠 High | Unescaped user strings interpolated into HTML emails | Injection |
| H6 | 🟠 High | Pick-lock enforced client-side; server checks only pool-level `lockAt`, not per-game | Logic |
| H7 | 🟠 High | Score ingestion from ESPN is non-transactional → partial standings on failure | Logic |
| H8 | 🟠 High | Billing entitlement (BillingGate) enforced client-side only | Payments |

Full Medium/Low list below. **Top 3 to fix before any real money moves: C1, C3, H2/H3 (the authz gaps).**

---

## 🔴 CRITICAL

### C1 — Client controls price; `price: 0` fully bypasses Stripe `[VERIFIED]`
**File:** `functions/src/stripe.ts:54, 69, 76, 230`

`createCheckoutSession` reads `price` straight from `request.data` (line 54). The only validation is `price >= 0` (lines 69, 76). The server **never looks up the real price** from server-side config. Two distinct exploits:

1. **Underpay:** call with `price: 0.01` for a premium tier → Stripe session created for 1 cent → pay it → webhook activates the pool.
2. **Free activation (worse):** call with `price: 0`, no `couponCode`, no `usedCredit`. Execution reaches the `if (price === 0)` branch at line 230, which sets `billing.status: "active"` directly — **no Stripe call, no coupon check, no credit decrement.** Any authenticated user activates any pool they can create, for free.

```js
// Exploit (browser console, logged in):
firebase.functions().httpsCallable('createCheckoutSession')({
  poolId: 'myPool', poolName: 'x', tier: 'premium_tier', price: 0
}) // → pool is now "active"
```

**Fix:** Never trust client price. Derive it server-side from `settings/billing_config` by `tier`/`bundleType`, and gate the `price === 0` path on a verified coupon/credit:
```ts
const cfg = (await db.collection('settings').doc('billing_config').get()).data();
const serverPrice = resolvePrice(cfg, tier, bundleType, maxPlayersAllowed); // authoritative
// ignore request.data.price entirely for the charge amount
if (serverPrice === 0) {
  // ONLY allowed if a real 100%-off coupon was validated this call, OR usedCredit was verified+decremented
  if (!validatedFreeReason) throw new HttpsError('failed-precondition', 'No valid free-activation reason.');
}
const unitAmount = Math.round(serverPrice * 100);
```
Validate the coupon's existence, `active` flag, expiry, and remaining uses **before** taking the `$0` branch — currently the coupon is only *recorded* (line 260+), never *validated as authorizing free*.

---

### C2 — Cross-user / cross-pool read exposure in Firestore rules `[VERIFIED]`
**File:** `firestore.rules:144, 169, 24, 32`

Three over-broad reads:

1. **`entries` (line 144):** `allow read: if request.auth != null`. Any logged-in user can read **every entry in every pool** — i.e., all picks/brackets across the whole app, including before lock. A competitor can copy the field's picks, or scrape entrant PII (entry names, emails stored on entries).
2. **`users` (line 169):** `allow read: if request.auth != null`. Any logged-in user can read **any user document** — emails, `role`, `referralCredits`, `freePoolsAvailable`, phone numbers if present. Full user-table enumeration.
3. **`pools` get+list (lines 24, 32):** `allow get/list: if true`. Unauthenticated. The rationale comment is reasonable for slug lookup, but it means the entire pools collection (manager email/`contactEmail`, payment instructions, participant names embedded on the doc) is world-readable and enumerable.

**Fix:**
- `entries`: scope reads to the entry owner, the pool manager, or after lock. Minimum:
  ```
  allow read: if request.auth != null && (
    resource.data.ownerUid == request.auth.uid ||
    get(/databases/$(database)/documents/pools/$(poolId)).data.ownerId == request.auth.uid ||
    get(/databases/$(database)/documents/pools/$(poolId)).data.managerUid == request.auth.uid ||
    get(/databases/$(database)/documents/pools/$(poolId)).data.get('status','') == 'LOCKED' ||
    isSuperAdmin()
  );
  ```
- `users`: `allow read: if request.auth != null && (request.auth.uid == userId || isSuperAdmin());`. Anything other clients need (display name/avatar) should live in a separate public-profile doc.
- `pools`: if guest-link access is required, keep `get: if true` but **stop embedding PII** (manager email, payment instructions, full participant list) on the root pool doc — move sensitive fields to a Cloud-Functions-only subcollection. Constrain `list` to slug-equality queries only if feasible, or accept enumeration as a documented risk *after* removing PII.

---

### C3 — Stripe webhook has no idempotency → double-credit `[VERIFIED]`
**File:** `functions/src/stripe.ts:389, 414–423, 487–489`

Signature verification is correct (line 389, uses `req.rawBody`). But there is **no dedup on `event.id`**. Stripe delivers at-least-once and retries on any non-2xx or timeout. The `buy_3` bundle path does `freePoolsAvailable: increment(3)` (line 416) and `unlimited_1yr` extends expiry — a retried delivery credits again. The standard-pool path (line 489) computes `existingPricePaid + amount_total` via read-then-write, so a retry also double-counts `pricePaid`. The bundle handler returns 500 on a Firestore error (line 462), **guaranteeing** Stripe retries an event that may have partially applied.

**Fix:** Record processed event IDs and short-circuit:
```ts
const evtRef = db.collection('stripeWebhookEvents').doc(event.id);
const seen = await evtRef.get();
if (seen.exists) { res.status(200).send('duplicate'); return; }
// ... process ...
await evtRef.set({ type: event.type, processedAt: Date.now() });
res.status(200).send('ok');
```
Wrap the credit-grant + event-marker write in a transaction so they commit atomically. Prefer `increment` only when guarded by the idempotency key.

---

## 🟠 HIGH

### H1 — Forgeable referral tokens; no self-referral guard `[VERIFIED]`
**File:** `src/services/referralService.ts:8, 17`

`generateReferralLink` is `btoa(userId)` (line 8); `parseReferralToken` is `atob` (line 17). Base64 is encoding, not signing. Anyone can `atob` a link to read a referrer's UID, and `btoa('anyUID')` to forge a referral crediting any account. No self-referral check observed.

**Fix:** Issue opaque random tokens server-side and store `token → referrerId` in Firestore (Cloud Function). On signup, look up the token and reject when `referrerId === newUserId`. Cap credits per referrer and require the referred account to reach a real milestone (paid pool) before crediting. Note `firestore.rules:253` lets a client create a `referrals` doc with `referredUserId == self` and `status:'pending'` — keep credit *awarding* in a Cloud Function only (it already is via `update: if false`), but the referrer attribution must be server-validated.

### H2 — `redeemCoupon` missing pool authorization `[REPORTED]`
**File:** `functions/src/billing.ts` (`redeemCoupon`)
Function accepts `poolId` + coupon from any authenticated user without verifying the caller owns/manages that pool. Lets a user burn coupon uses against arbitrary pools or apply discounts to pools they don't control. **Fix:** after loading the pool, require `pool.ownerId === uid || pool.managerUid === uid` before applying. Also enforce per-pool (not just per-user) redemption limits — the agent traced a path where `perUserLimit:1` still allows reuse across multiple pools.

### H3 — `confirmPayment` doesn't verify square ownership `[VERIFIED]`
**File:** `functions/src/confirmPayment.ts:49–61`
Authenticated (good), but the loop explicitly skips ownership ("`// For now, we allow confirmation if they provide valid square IDs`", line 49). Any logged-in user can stamp `paymentConfirmedAt`/`paymentConfirmedByUid` on **any** claimed square in **any** pool and trigger a "payment received" email to that host. This is a manual peer-to-peer flow (host still verifies real receipt), so no money moves directly — but it's host-spam and data tampering. **Fix:** verify each square's `owner`/`guestDeviceKey`/`playerDetails.uid` maps to `request.auth.uid` before confirming; reject the call otherwise.

### H4 — Bracket upset-bonus seed lookup drifts client vs server `[VERIFIED]`
**Files:** `functions/src/bracketScoring.ts` (`getSeedForTeam`) vs `src/utils/bracketScoring.ts:30,82,100` and `src/components/BracketPoolDashboard/bracketScoring.ts:82,141,163` (both use `extractSeedFromTeamId`).

Round point values match across all three implementations (`CLASSIC [10,20,40,80,160,320]`, `FIBONACCI [10,20,30,50,80,130]`). **But:** the server resolves a team's seed via `getSeedForTeam` → `tournament.importedTeams[teamId].seed` (modern data: team IDs are display names like `"Arkansas Razorbacks"`). Both client files use only the **deprecated** `extractSeedFromTeamId` regex, which returns `null` for display-name IDs. Result: upset bonuses (which scale by seed difference) compute differently in the UI than on the server → users see standings/max-score that don't match the authoritative server total.

**Fix:** Port `getSeedForTeam(teamId, tournament)` into a single shared module imported by both client files and the server (or have the client read server-computed scores only and never recompute). Delete the two duplicate `extractSeedFromTeamId` definitions. This is the highest-risk **correctness** bug for payouts — fix before the next tournament.

### H5 — HTML email injection via unescaped user strings `[VERIFIED]`
**Files:** `functions/src/confirmPayment.ts:111,115,119` (`${result.playerName}`, `playerEmail` from `square.owner`, user-set); `functions/src/emailStyles.ts` (`renderEmailHtml` interpolates `bodyContent` raw); `functions/src/reminders.ts` `[REPORTED]` (pool name, manager name, payment instructions).
User-controlled values (square owner name, pool name, payment instructions) are interpolated into email HTML without escaping. A pool/square name like `"><img src=x onerror=...>` injects markup into every recipient's email — phishing and tracking-pixel exfil vector. **Fix:** add an `escapeHtml()` helper and apply it to every interpolated user value; or centrally escape in `renderEmailHtml` and pass structured data rather than pre-baked HTML.

### H6 — Pick lock enforced client-side; server check is pool-level only `[REPORTED]`
**Files:** `src/components/NFLPoolDashboard/PickemPickEntry.tsx:54–58` (client clock disables UI); `functions/src/bracketEntries.ts:143–144` (server checks `poolData.lockAt`).
The server validates a single pool-level `lockAt`, not per-game start times. In a multi-game week, a user can submit/edit a pick for a game that already kicked off as long as the pool-level lock hasn't passed. Client-side disabling relies on the user's clock. **Fix:** server-side, reject any pick whose `game.startTime <= serverNow` (or `game.status !== 'SCHEDULED'`), per game, using server time only. Never trust client timestamps for locking.

### H7 — ESPN score ingestion is non-transactional `[REPORTED]`
**File:** `functions/src/scoreUpdates.ts`
Scores are fetched and written without a transaction wrapping fetch+write. A mid-batch failure leaves some games updated and others stale, and a re-run may re-apply. **Fix:** fetch all game data first, then commit a single atomic batch/transaction; make scoring idempotent (recomputable from raw scores, not incremental) so an ESPN correction to a final score re-runs cleanly.

### H8 — Billing entitlement enforced client-side only `[REPORTED]`
**Files:** `src/components/billing/BillingGate.tsx`, `src/components/billing/PickSubmissionGuard.tsx`
These blur/disable UI when `billing.status === 'locked'`, but no Cloud Function or Firestore rule blocks writes to a locked pool's entries. A user can call the entry-submission function directly. (Note: `billing` *field* on the pool is protected from client writes — that part is fine. The gap is that *gameplay actions* aren't gated on billing status server-side.) **Fix:** in every entry/pick-mutating function, load the pool and reject when `billing.status` is `locked`/`grace_period`-expired; mirror in rules where entries are written.

---

## 🟡 MEDIUM

| ID | File:Line | Finding | Fix | Tag |
|----|-----------|---------|-----|-----|
| M1 | `functions/src/nflScoringEngine.ts:245–267` | Margin/ATS scoring never reads `game.spread`; pushes (exact spread) scored as wins | Decide MOV vs ATS; if ATS, subtract spread and treat 0 as push with configurable payout | REPORTED |
| M2 | `functions/src/nflScoringEngine.ts:177–183` | Survivor: a tie is always a strike; no `tiePolicy` setting | Add `tiePolicy: 'strike'\|'push'\|'reroll'` to pool settings | REPORTED |
| M3 | `src/utils/payouts.ts:44,91` | `Math.floor` truncation loses cents; no negative/NaN clamp; charity% >100 → negative pot | Round-to-nearest; `netPot = Math.max(0, ...)`; assert payouts+charity ≤ pot | REPORTED |
| M4 | `functions/src/reminders.ts:147,626` | N+1: per-uid `users/{uid}.get()` in a loop | `Promise.all` or `where(documentId(),'in',chunk)`; or denormalize email onto entry | REPORTED |
| M5 | `functions/src/reminders.ts:86` | Unbounded `pools.get()` every run | Filter `where('lockAt','<=',now)` / status ≠ FINAL | REPORTED |
| M6 | `functions/src/bracketScoring.ts:221,404` | N+1: per-pool `entries.get()` in a serial loop; risk of 120s timeout >15 pools | `collectionGroup('entries')` or `Promise.all`; batch | REPORTED |
| M7 | `functions/src/bracketScoring.ts:303–316` | `batch.update` loop with no 500-op cap | Split commits at ~400 ops | REPORTED |
| M8 | `functions/src/scoreUpdates.ts:~1023` | `every 1 minutes` scheduler scans all non-final pools, no recency filter | Add `lastScoreCheck` filter / flag active pools | REPORTED |
| M9 | `src/components/AICommissioner.tsx:31,44,361` | `onSnapshot` returned from `useEffect` without capturing unsubscribe → listener leak | `const unsub = onSnapshot(...); return () => unsub()` | REPORTED |
| M10 | `src/services/BaseRepository.ts:46–58` | `find()` / `getAllUsers()` unbounded, no pagination | Default `.limit()`, paginate admin lists | REPORTED |
| M11 | `functions/src/billing.ts` (`enforceBillingStatus`) | Status transitions only on daily 03:00 scheduler → up to 24h stale | Compute status on read, or hourly schedule | REPORTED |
| M12 | `functions/src/userManagement.ts` (`deleteUserAccount`) | Deletes auth + `users/{uid}` but not the user's entries across pools → orphans | Query+cascade entries (with audit), or soft-delete | REPORTED |
| M13 | `functions/src/poolOps.ts:~155` (`recalculatePoolWinners`) | Deletes `winners` via batch, not transaction → partial state on crash | Wrap in `runTransaction`; snapshot winners to audit first | REPORTED |
| M14 | `functions/src/userManagement.ts` `testSmsHttp`, `functions/src/debug.ts` `inspectPoolState` | Debug/test HTTP endpoints deployed to prod (SUPER_ADMIN-gated but still attack surface) | Remove from `index.ts` exports or gate behind env flag | REPORTED |
| M15 | `firestore.rules:213` | `system_logs` create `if request.auth != null` → any user can write/flood logs | Restrict create to Cloud Functions or rate-limit | VERIFIED |

---

## 🔵 LOW / HYGIENE

- **L1 `[VERIFIED]` `.env` Gemini key rotation** — root `.env` carries a self-warning that `GEMINI_API_KEY` was previously committed to git history. `.env` is gitignored *now*, but **rotate the key** and scrub history (`git filter-repo`) — a gitignore doesn't un-leak a past commit. Confirm `STRIPE_SECRET_KEY` in `functions/.env` (currently a `sk_test_…`) is rotated before going live and never committed.
- **L2 `[VERIFIED]` `git_superadmin.txt` is tracked** — it's a stray copy of `SuperAdmin.tsx` source committed at repo root. Not a secret, but delete it; stray source copies drift and confuse reviewers. (`functions/setUserAdmin.cjs` is untracked and hardcodes `projectId: 'pools-prod-uzuqo'` — fine as a local tool, keep it out of git.)
- **L3 `[VERIFIED]` `firestore.rules:104` `ai_requests`** — `create` validates `userId == auth.uid` but not field allow-list; a client can attach arbitrary fields. Add `request.resource.data.keys().hasOnly([...])`.
- **L4 `[VERIFIED]` Scoring-constant naming drift** — server `SCORING_Multipliers`, client util `SCORING_Multipliers`, dashboard `ROUND_VALUES_CLASSIC/FIBONACCI`. Same values today; consolidate into one shared export to prevent future drift (ties into H4).
- **L5 `[REPORTED]` `syncMyClaims` reads role from Firestore** (`functions/src/adminClaims.ts`) — mirrors `users/{uid}.role` into a JWT claim. **Mitigated** by `firestore.rules:174–176` blocking clients from changing their own `role`, so self-escalation requires a rules regression. Still, harden: require the caller to already hold the claim, or drive role changes only through an admin-only function with audit. Low because the mitigating control currently holds.

---

## Scoring implementation comparison (H4 detail)

| Aspect | `functions/src/bracketScoring.ts` (server, authoritative) | `src/utils/bracketScoring.ts` (client) | `src/components/BracketPoolDashboard/bracketScoring.ts` (client) | Match |
|--------|-----------|-----------|-----------|-------|
| CLASSIC / ESPN points | `[10,20,40,80,160,320]` | same | same | ✅ |
| FIBONACCI points | `[10,20,30,50,80,130]` | same | same | ✅ |
| Seed resolution | `getSeedForTeam` → `importedTeams[id].seed`, regex fallback | `extractSeedFromTeamId` (regex only) | `extractSeedFromTeamId` (regex only) | ❌ **drift** |
| Upset bonus formula | `(winnerSeed − loserSeed) × mult` | same formula, wrong seed input | same formula, wrong seed input | ⚠️ diverges via seed |

Net: identical point tables, but the two clients can't resolve seeds for modern display-name team IDs, so any seed-dependent bonus diverges from the server.

---

## Deletion-path map

| Path | Trigger | Authorizer | Cascades? | Audited? |
|------|---------|------------|-----------|----------|
| Pool delete | client `deleteDoc` | rules: owner/manager/superadmin | ❌ subcollections orphaned | ❌ |
| Entry delete (admin) | client `deleteDoc` | rules: superadmin only | ❌ participations not cleaned | ❌ |
| Entry delete (fn) | `deleteBracketEntry()` | owner, or manager+unlocked | partial (count updated) | ✅ inline |
| User account delete | `deleteUserAccount()` | SUPER_ADMIN | ❌ entries orphaned | ❌ console only |
| Coupon delete | client `deleteDoc` | rules: superadmin only | n/a | ❌ |
| Winners recalc | `recalculatePoolWinners()` | SUPER_ADMIN | batch delete (non-txn) | ✅ pool audit |
| Playoff entry delete | fn | owner/manager, unlocked | ❌ participant index | ❌ |
| NFL games purge | `nflSchedule.ts` | unclear | none | ❌ |

Deletes are **authorization-safe** (gated to owner/manager/superadmin — the agents' "any user" framing was wrong; rules confirm gating). The real issues are **no cascade** (Firestore doesn't auto-delete subcollections, so pool/user deletes orphan entries, picks, invoices, audit) and **non-transactional multi-doc deletes**. Add cascade cleanup in Cloud Functions, wrap in transactions, and audit every delete.

---

## Anything else you should be checking (you asked)

1. **App Check** — none observed. Without Firebase App Check, your callable functions and Firestore are reachable by any script with your public config (which is in client `.env`, by design). App Check raises the bar against the C1/H1/H3 direct-call exploits. Add it.
2. **Rate limiting / abuse** — callables like `confirmPayment`, `createCheckoutSession`, AI endpoints have no per-user throttle. Add per-uid rate limits (Firestore counter or a lightweight middleware) — especially the Gemini/AI path (cost) and email-triggering functions (spam).
3. **Prompt injection on AI features** — `functions/src/gemini.ts` / `aiCommissioner.ts`: confirm user pool data fed to the model can't trigger privileged side effects (writes, emails) from model output. Treat model output as untrusted; never let it pick a Firestore path or recipient.
4. **PII inventory & retention** — emails, phone numbers, payment instructions live in Firestore. Given guest-link world-read on pools (C2), document what PII sits where and minimize it. Relevant if you have any CA/EU users (CCPA/GDPR deletion requests — and your delete paths don't cascade, M12).
5. **Stripe live-mode checklist** — `functions/.env` currently holds a test key. Before launch: live keys in Secret Manager (not `.env`), webhook endpoint signing secret rotated, `charge.refunded` / `customer.subscription.deleted` handled to *revoke* access (no refund/cancel handler observed → paid status sticks after refund).
6. **Backup / disaster recovery** — enable Firestore scheduled exports. With hard deletes and no cascade, an erroneous admin delete is currently unrecoverable.
7. **Dependency audit** — run `npm audit` in both root and `functions/`; pin and review the Stripe/Firebase/AI SDK versions.
8. **Money reconciliation test** — add a test asserting `sum(payouts) + charity == pot` across rounding (ties into M3) and that re-running scoring on a corrected final score is idempotent (ties into H7).

---

## Suggested remediation order

**Before any real money / public launch:**
1. C1 (server-side price) — single biggest exposure.
2. C3 (webhook idempotency).
3. C2 (lock down `users` + `entries` reads; strip PII from public pool docs).
4. H2 + H3 (pool/square authorization checks).
5. Rotate the Gemini + Stripe keys; scrub git history (L1).

**Before next tournament (correctness):**
6. H4 (shared seed lookup) — standings/payout accuracy.
7. H6 (per-game server-side lock), H7 (transactional scoring), M1/M2 (ATS push, survivor tie).

**Then:** H1, H5, H8, the Medium perf/N+1 batch, deletion cascades (M12/M13), App Check + rate limiting.

---

## Appendix A — what each finding's evidence is
VERIFIED findings were confirmed by reading: `functions/src/stripe.ts` (C1, C3), `firestore.rules` (C2, M15, L3), `src/services/referralService.ts` (H1), `functions/src/confirmPayment.ts` (H3, H5), both client `bracketScoring.ts` files vs server (H4), git status / `.env` contents (L1, L2). REPORTED findings came from focused review agents over `functions/src` and `src`; the patterns are real but re-confirm the exact line at fix time.

## Appendix B — checked and found OK (don't re-investigate)
- **Admin model:** SUPER_ADMIN is a JWT custom claim, not a client-writable field. Correct design.
- **`billing` field tampering:** protected by `firestore.rules:52` (`protectedFieldsUnchanged`) — clients cannot self-mark a pool paid. The earlier "user marks own invoice paid" hypothesis is **false**.
- **Winners / participants / audit / participations subcollections:** all `write: if false` (Cloud Functions only). Correct.
- **Webhook signature:** verified against `req.rawBody` (`stripe.ts:389`). Correct — the gap is idempotency (C3), not signature.
- **Standard-pool charge amount:** webhook records `session.amount_total` (real charged amount), not client price. Correct — the price gap is at *session creation* (C1), not at webhook recording.
- **Delete authorization:** gated to owner/manager/superadmin in rules. The gap is cascade + transactionality, not auth.
- **Game cancellation handling:** survivor/pickem/margin treat CANCELLED as no-strike / skip / 0. Looks correct.
