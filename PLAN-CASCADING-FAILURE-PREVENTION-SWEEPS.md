# Cascading Failure Prevention — Completeness Sweeps (revalidated 2026-09-01; line refs re-checked 2026-09-03)

Deterministic source sweeps that define the current dependency boundary for `PLAN-CASCADING-FAILURE-PREVENTION.md`. Commands: `rg -n --glob '*.ts' --glob '*.tsx' '\bfetch\(' functions/src src` and `rg -n --glob '*.ts' 'new Stripe|new GoogleGenAI|sendCourierSMS|sendEmail\(' functions/src`.

## Sweep 1 — Direct outbound HTTP calls (feeds 1.1, 2.2, 3.1–3.3)

| Site | Dependency | Required migration |
|---|---|---|
| `functions/src/adminHealth.ts:47` | ESPN | `espn` probe policy and 5s child budget |
| `functions/src/espnBracket.ts:1157,1176` | ESPN | `espn` policy + cached tournament data |
| `functions/src/expertPicks.ts:86` | ESPN Core | `espn` policy + retain prior predictions |
| `functions/src/nflSchedule.ts:135,179,204` | ESPN | one shared caller budget across calendar + scoreboard |
| `functions/src/scoreUpdates.ts:107` | ESPN | replace local retry timeout with budget-aware `espn` policy |
| `functions/src/playoffPools.ts:414` | ESPN | `espn` policy + preserve stored results |
| `functions/src/winProbability.ts:18` | ESPN | `espn` policy + unavailable result, never invented probability |
| `functions/src/gemini.ts:53` and Google SDK call | Gemini | `gemini` policy; typed unavailable fallback |
| `functions/src/notifications/smsService.ts:73` | Courier member SMS | `courierMember` policy; non-blocking failed outcome |
| `functions/src/lib/opsAlertDispatcher.ts:134` | Courier ops SMS | `courierOps` policy; no recursive page attempt |
| `functions/src/joinPreview.ts:52` | own deployed site | remove self-fetch; bounded minimal preview until removal |
| `src/components/AdminPanel.tsx:317` | browser → ESPN | migrate to server/cached read |
| `src/components/WizardStepGame.tsx:86` | browser → ESPN | migrate to server/cached read |
| `src/components/Scoreboard.tsx:94` | browser → ESPN | migrate to server/cached read |
| `src/components/BracketPoolDashboard/LiveScoreTicker.tsx:25` | browser → ESPN | migrate to server/cached read |
| `src/services/scoreService.ts:49` | browser → ESPN | migrate to server/cached read |

`BracketShareCard.tsx` fetches an already-selected image asset, not a service API; it is excluded from vendor circuit scope.

## Sweep 2 — SDK/webhook boundaries (feeds 3.2–3.4)

| Site | Boundary | Required behavior |
|---|---|---|
| `functions/src/stripe.ts:300` | Stripe SDK construction/outbound calls | dedicated Stripe agent, semaphore, shared request budget |
| `functions/src/stripe.ts:1391` | inbound Stripe webhook | no breaker before signature verification; downstream failure remains retryable and idempotent |
| `functions/src/gemini.ts:76` | Gemini SDK generation | `gemini` policy and typed UI fallback |
| `functions/src/reminders.ts:34` | Trigger Email queue writer | bounded Firestore write; queue accepted is not delivery confirmation |
| `functions/src/lib/opsAlertDispatcher.ts:100` | direct Trigger Email queue writer | preserve non-blocking ops dispatch semantics |
| `functions/src/index.ts:7` plus all `admin.firestore()` call sites | Firebase Admin / Firestore | per-function concurrency + orchestration deadline; no unsupported per-query connection pool |

## Sweep 3 — Existing timeout and fan-out sites (feeds 2.1–2.3)

| Site | Current behavior | Required correction |
|---|---|---|
| `functions/src/adminHealth.ts:44-53` | independent 5s ESPN timeout | child of health request budget |
| `functions/src/scoreUpdates.ts:103-121` | independent 8s timeout plus retry | retry and backoff consume one parent budget |
| `functions/src/nflSchedule.ts:135-204` | calendar and scoreboard each have unbounded fetch | one slate budget shared by both |
| `functions/src/adminHealth.ts:188` | parallel ESPN/Firestore/email/AI fan-out | parent deadline applies to all branches |
| `functions/src/lib/opsAlertDispatcher.ts:206,229` | unbounded recipient `Promise.all` | bounded per-Courier/email queueing and parent deadline |
| `functions/src/reminders.ts:178` and `:316-321`, `:782-787` | fan-out reads and notifications | bounded queues; continue unaffected recipients |

## Sweep conclusion

There are **no app-owned HTTP agents, dispatchers, or connection-pool definitions** under `functions/src` today. Direct `fetch` calls use Node’s shared global dispatcher; Stripe and Firebase Admin own their SDK transports. The implementation must introduce named outbound policies rather than attempting to partition a non-existent application pool.

**Revalidation delta:** `functions/src/lib/globalOptions.ts` now sets `maxInstances: 10` for v2 functions; `nflSchedule.ts` now explicitly gives `syncNFLScoresJob` 270 seconds and `nflDeepScoreSweepJob` 540 seconds. Those are outer execution ceilings, not per-dependency bulkheads or request-level budgets, so every inventory row above remains in scope.
