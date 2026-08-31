# TICKET — the SuperAdmin NFL import button "did nothing", and nothing could say why

**Reported:** Kevin, <!-- hof-date:ignore --> 2026-08-07. He ran the NFL Schedule
import for week 1 from SuperAdmin. Nothing visibly happened, no error was shown,
and `importNFLSchedule` had **zero invocation logs**.

**Status:** the observability gap is FIXED and the UI failure modes are closed.
**The original root cause is NOT established** and, with the evidence available,
cannot be — see §3. This ticket says so rather than inventing one.

---

## 1. What the client code actually does

Read, not recalled. `SuperAdmin.tsx` → `handleImportNFLSchedule` →
`dbService.importNFLSchedule` → `httpsCallable(functions, 'importNFLSchedule')`.

There is **no swallow anywhere on that path**:

- the handler has no validation of its own and always calls the callable;
- `dbService.importNFLSchedule` catches, reports to `errorHandler`, and
  **re-throws**;
- the handler's `catch` sets `nflImportResult` to an error banner, and `finally`
  always clears the spinner.

So a click that reaches the handler must end in a green or a red banner. The
`BaseRepository.update` returns-false pattern (the usual suspect in this repo)
is not on this path — this is a callable, not a repository write.

That leaves exactly three ways it can present as "nothing happened", and this PR
closes all three as *presentation* problems regardless of which one occurred:

| # | mechanism | fixed by |
|---|---|---|
| 1 | The button was **disabled** and did not look it. `disabled:opacity-50` was the only cue, and `cursor-pointer` was applied unconditionally — so a disabled button still showed the hand cursor and silently ignored the click. `!nflSeason` (an emptied Season Year box) is the reachable case. | `disabled:cursor-not-allowed`, plus an explicit "Enter a Season Year — the import button is disabled without one." line |
| 2 | The banner rendered **off-screen**. It was at the TOP of the card, above a three-column form; the button is at the bottom. On a short window, the outcome of a click appears above the fold. | banner moved below the button |
| 3 | The call really did fail and the banner really did render, and was missed | — (1) and (2) make it much harder to miss |

## 2. Why "zero invocation logs" was not evidence of anything

This is the substantive finding, and it is bigger than one button.

`validated()` (`functions/src/lib/validated.ts`) is the trust-boundary wrapper
every hardened callable goes through. **All of its logging is conditional on a
correlation id being present in the payload:**

```ts
if (correlationId) logger.info(`[correlation] ${cfg.label} start`, …)
…
if (correlationId) logger.error(`[correlation] ${cfg.label} error`, …)
```

With no `_correlationId`, it emits nothing on entry, nothing on success, and —
the one that matters here — **nothing when it rejects the call at the auth, role
or schema gate.** `runGate` throws `HttpsError` before the handler runs, and the
handler is the only other place that logs.

So for such a callable, "no logs" is indistinguishable between:

- the call succeeded,
- the call was rejected as `permission-denied` by `assertCallerRole` (which
  requires the JWT claim **and** `users/{uid}.role` to agree — a stale token is a
  live possibility),
- the call never arrived.

`src/utils/correlationId.ts` exists exactly to close this, and **31 of the 66
callables in `dbService.ts` already used it. `importNFLSchedule` was not one of
them.** Neither was `scoreNFLWeek` — the commissioner's manual Score & Recap
button, i.e. the documented fallback for automated scoring, and so the worst
possible place to have no trace.

Both now attach one. Next time the question is asked, `[correlation]
importNFLSchedule start` proves arrival and `… error` carries the reason.

## 3. Why the original cause is still open

Diagnosing it now would need the Cloud Functions logs from
<!-- hof-date:ignore --> 2026-08-07, filtered to that minute. That is a
production read this session did not take, and the state before the fix is not
reproducible: the call left no trace by construction.

One observation cuts against "the click never left the browser".
📌 **UNVERIFIED — this is environment-dependent and was reasoned from the code,
not observed in production.** `importNFLSchedule` is declared
`appCheck: "monitor"`, and `validated()` emits its `[appcheck-monitor]` warning
whenever `request.app` is absent — before the auth/role/schema gate, so it does
not depend on the call being accepted. The environment half is the part to
re-check: App Check is believed OFF in the client (`VITE_RECAPTCHA_SITE_KEY`
unset, per HANDOFF), so no token is attached and the warning fires on every call.
**If App Check is ever turned on, this signal disappears** and the reasoning
below stops holding.

On that basis `validated()` emits `[appcheck-monitor] importNFLSchedule: call
WITHOUT a valid App Check token` for every call that arrives. If that line is absent
from the logs for that window, the request genuinely did not reach the function.
If it is present, it did, and the failure was downstream. **That single grep
settles it**, and it is the first thing to run if this recurs:

```
npx firebase functions:log --only importNFLSchedule
```

## 4. Also corrected: a doc claim about the import UI

`MORNING-2026-08-07.md` was corrected in #394 to say the importer "takes ONE week
at a time". **That is not right either**, and it is the same
quote-from-memory mistake it was correcting.

Read off the rendered JSX (`SuperAdmin.tsx`, Weeks Filter select), the control
has exactly two options:

- **"All 18 Weeks (Regular)"** — sends weeks 1–18;
- **"Specific Week Only"** — reveals a second select and sends exactly one week,
  its option list clamped to 4 entries for preseason.

So there is no way to select "weeks 1 and 2" in one run — the original claim
being corrected was wrong — but "one week at a time" understates it. It is one
week, or all eighteen. The correction is applied in this PR.

## 5. The rest of the gap, named rather than fixed

**35 of 66 callables in `dbService.ts` still attach no correlation id**, so the
same "did that actually run?" question is unanswerable for all of them. The
money- and authorization-adjacent cluster is the one worth doing next:
`adminAdjustUserCredits`, `adminSaveBillingConfig`, `setUserRole`,
`redeemCoupon`, `confirmPayment`, `createCheckoutSession`,
`adminGrantEntitlement`, `adminRevokeEntitlement`.

**Not done in one sweep, deliberately.** 25 callables in `functions/src` are
still bare `onCall(...)` rather than `validated(...)`, and a bare handler reads
`request.data` directly — so an unstripped `_correlationId` could fail a strict
schema or be persisted. Each removal needs its backend wrapper checked.

`tests/callable-correlation-coverage.test.ts` is the ratchet: it lists the 35 by
name, fails when a **new** untraced callable appears, and fails when an entry on
the list has been fixed but not removed. The number can only go down.
