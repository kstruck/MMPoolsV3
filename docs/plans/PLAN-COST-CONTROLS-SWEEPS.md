# Cost Controls — Completeness Sweeps (2026-08-22)

Deterministic grep sweeps to close the enumeration-gap pattern. These are the
COMPLETE instance lists that feed PLAN-COST-CONTROLS.md Phases 0.5, 1, 2 and the
7.2 sweep gate. Run from repo root; every command is re-runnable and the sweep is
stale the moment its command's output changes. All outputs below captured
2026-08-22 on branch `claude/rate-limiting-cost-audit-9y1bvk`
(base `origin/main` = `5dab702c`). Test files (`__tests__/`) excluded throughout —
they call wrappers by design.

## Sweep 1 — Every Gemini call site (feeds Phase 0.5.2, 1, 3.4, 7.2)

```bash
grep -rn "generateAIResponse" functions/src src shared --include="*.ts" --include="*.tsx" | grep -v __tests__
grep -rn "generativelanguage.googleapis.com\|GoogleGenAI\|@google/genai" functions/src src shared --include="*.ts" --include="*.tsx" | grep -v __tests__
```

**Wrapper callers — 6, matching the plan's Phase 0.1 inventory exactly:**

| Site | Trigger | Entitlement today |
|---|---|---|
| `functions/src/aiCommissioner.ts:94` | `onWinnerUpdate` (server-only write) | ❌ none |
| `functions/src/aiCommissioner.ts:337` | `onAIRequest` (client-created doc) | ❌ none — the unbounded hole |
| `functions/src/aiCommissioner.ts:412` | `onWeeklyRecapCreated` (server-only) | ✅ `:390` |
| `functions/src/aiTesting.ts:113` | SUPER_ADMIN callable | role gate |
| `functions/src/aiTesting.ts:168` | SUPER_ADMIN callable | role gate |
| `functions/src/aiTesting.ts:220` | SUPER_ADMIN callable | role gate |

**Endpoint/SDK-level matches — all inside the wrapper or type-only:**

| Site | What |
|---|---|
| `functions/src/gemini.ts:2,69` | SDK import + `new GoogleGenAI` — the wrapper itself |
| `functions/src/gemini.ts:42` | discovery fetch, key in URL (Phase 3.4 deletes) |
| `functions/src/gemini.ts:124` | error-path list fetch, key in URL (Phase 3.4 deletes) |
| `functions/src/aiTesting.ts:9` | `Type` import only — no calls |

> **Verdict: the plan's Gemini inventory is CONFIRMED COMPLETE.** No caller
> outside `gemini.ts` touches the SDK or the endpoint. Zero hits in `src/` or
> `shared/` — the client never calls Gemini directly.

## Sweep 2 — Every Courier SMS call site (feeds Phase 0.5.3, 1, 7.2)

```bash
grep -rn "sendCourierSMS" functions/src src shared --include="*.ts" --include="*.tsx" | grep -v __tests__
grep -rn "api.courier.com" functions/src src shared --include="*.ts" --include="*.tsx" | grep -v __tests__
```

**Via `sendCourierSMS` (`smsService.ts:36`) — 4 call sites:**

| Site | Audience | 0.5.3 `audience` param |
|---|---|---|
| `functions/src/reminders.ts:291` (payment reminder) | members | `'member'` — kill-switch blocks |
| `functions/src/reminders.ts:757` (recap blast) | members | `'member'` — kill-switch blocks |
| `functions/src/userManagement.ts:174` (security alert) | one user | `'security'` — D4-exempt |
| `functions/src/userManagement.ts:219` (`testSmsHttp`) | SUPER_ADMIN | `'test'` — D4-exempt |

**Direct endpoint fetches — 2, and this is why 7.2 sweeps endpoints:**

| Site | What |
|---|---|
| `functions/src/notifications/smsService.ts:47` | the wrapper's own send |
| `functions/src/lib/opsAlertDispatcher.ts:126` | `sendOpsSMS` — deliberate distinct path (`:116` comment), same `COURIER_AUTH_TOKEN` secret, D4-exempt allowlist entry |

> **Verdict: the plan's Courier inventory is CONFIRMED (5 sites), with one
> correction already folded into the plan during review round 2:**
> `opsAlertDispatcher` does NOT go through `sendCourierSMS` — it is its own
> `api.courier.com` fetch. A name-only sweep would have missed it; the
> endpoint sweep is the one that counts. Zero hits in `src/` or `shared/`.

## Sweep 3 — Every client write path to `pools/*/ai_requests` (feeds Phase 0.5.1, 2.1, 7.2)

```bash
grep -rn "ai_requests" src shared --include="*.ts" --include="*.tsx"
grep -rn "ai_requests" functions/src --include="*.ts" | grep -v __tests__
grep -n "ai_requests" firestore.rules
```

| Site | Kind |
|---|---|
| `src/components/AICommissioner.tsx:59` | `addDoc` — client CREATE (dispute/insight request) |
| `src/components/AICommissioner.tsx:80` | `addDoc` — client CREATE (second form path) |
| `src/components/AICommissioner.tsx:43` | `collection()` for a listener — read only |
| `functions/src/aiCommissioner.ts:120` | `onAIRequest` trigger binding — the consumer |
| `firestore.rules:497` | the rule 0.5.1 tightens (create: auth + own-uid only today) |

> **Verdict: exactly ONE component writes `ai_requests`, via two `addDoc`
> calls.** Phase 2.1's client cutover touches one file; Phase 7.5's
> "verify the deployed bundle uses the callable" has a single string to check.

## Sweep 4 — Every read of `billing.featuresUnlocked.aiCommissioner` (feeds Phase 0.5.2, 7.2)

```bash
grep -rn "featuresUnlocked" src functions/src shared firestore.rules --include="*.ts" --include="*.tsx" | grep -v __tests__
```

**Server-side enforcement reads — 1 (the gap the plan exists to close):**

| Site | What |
|---|---|
| `functions/src/aiCommissioner.ts:390` | `onWeeklyRecapCreated` — the ONLY provider-path entitlement check today; 0.5.2 clones it into `onAIRequest` + `onWinnerUpdate` |

**Client UX-gating reads (hide the AI tab/panels) — 11 across 5 surfaces:**

| Surface | Sites |
|---|---|
| `PropsPoolDashboard.tsx` | `:57, :147, :245` |
| `PlayoffDashboard.tsx` | `:50, :165, :295` |
| `NFLPoolDashboard.tsx` | `:841, :1033` |
| `BracketPoolDashboard.tsx` | `:842` |
| `WizardStepSummary.tsx:218` / `PricingPage.tsx:162` | invoice/calculator display |

**Writers (for orientation — writes are server-mediated):** the Stripe webhook
(`stripe.ts:369,782`) and pool-creation stamps (`lib/poolCreation.ts:95,102`,
explicit-false `LOCKED_FEATURES`); `firestore.rules:189` lists `billing` in the
client-update deny list, and pool creation is the `createPool` callable
(`dbService.ts:240`), so wizard-supplied addon flags pass through server pricing,
never a direct write.

> ⚠️ **Implementation trap found by this sweep — `lib/billingAccess.ts`.**
> `checkBillingAccess(billing, 'aiCommissioner')` looks like the obvious helper
> for 0.5.2, but its first branch is `if (!billing) return { allowed: true }` —
> a legacy no-billing pool is ALLOWED. The plan's chosen mechanism (mirror
> `aiCommissioner.ts:390`: missing ⇒ deny) is the one that matches Kevin's
> "paid addon" decision. **Do not swap in `checkBillingAccess` during 0.5.2
> without closing its legacy carve-out** — doing so would re-open the hole for
> exactly the pools most likely to lack a billing object.

## Sweep vs plan — reconciliation

Sweeps 1–4 **confirm the plan's Phase 0.1 inventory as amended in review round
2** (Gemini 6/6, Courier 5/5, one client writer, one server enforcement read).
No plan correction was forced by the sweeps themselves; the two corrections the
sweeps surface (`sendOpsSMS` being endpoint-direct, and the `billingAccess`
legacy carve-out) are recorded — the first is already in the plan's inventory
and 7.2, the second lives here as a 0.5.2 implementation constraint.
