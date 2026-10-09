# PLAN-SPLIT-POT-SETTLEMENT — adversarial review log (Part A)

Reviewer: `codex exec -m gpt-5.6-terra` (default sandbox; the `-s read-only`
sandbox cannot start a process on this Windows host and fell back to GitHub,
which does not have the plan — that attempt was stopped and is not counted).
Scope: Part A only (§1.1, §2). Parts B and C are ordinary and get code review
on their own PRs.

---

## Round 1 — plan @ `6116ff8c` — CHANGES NEEDED (6 findings)

| # | Sev | Finding (codex) | Verified? | Verdict | Response |
|---|---|---|---|---|---|
| 1 | P0 | The pot ignores rebuys: `seasonPlacesPublication` prices from `pool.entryCount` (`nflFinalize.ts:304`), `potBreakdown` is `entryFee × entries` (`shared/prizePot.ts:56-62`), and a rebuy only raises `members/{uid}.rebuyOwed` + a `REBUY_DUE` ledger row (`nflPools.ts:1460-1491`), never `entryCount`. D6's "11 may be 3 rebuys" is therefore false. Fix: refuse settlement when rebuys exist, or extend the pot model. | **Yes** — read the rebuy path; it never touches `entryCount`. Measured on the live pool (read-only): `rebuysUsed` sum 0, `rebuyOwed` sum 0, 0 `REBUY_DUE` events, so this pool is not affected. | **ACCEPTED, fix modified** | The gap is **pre-existing**: a Survivor pool that reaches a natural season end publishes the same rebuy-blind pot today. Refusing settlement would make split-pot unusable on exactly the pools (rebuy Survivor) most likely to need it, while leaving the identical season-end path open. Instead: the settlement computes the rebuy dues from the Member Records (`Σ rebuyOwed`), records them as `settlement.rebuyDuesExcluded`, and the panel and email state plainly that the recorded prize is entry-fee money only and N rebuy dollars are not in it. D6 rewritten: `entryCount` counts LIABLE entries (PLAN-MULTI-ENTRY D8), not entry docs, so 11 vs 8 is not evidence of drift on its own — Kevin confirms the pot on the panel before clicking. Extending the pot model to include rebuys is named out of scope (§7). |
| 2 | P1 | `joinNFLPoolInternal` has no `assertNoScoringInProgress` (submit has it at `:644`, rebuy at `:1421`), so a join can commit while the settlement holds the lease; and `assertPoolAcceptsPlay` must read the transaction-fresh pool, not an earlier read. | **Yes** — join's transaction (`:386`) reads the pool but never checks the lease. Impact is narrower than stated: join creates no entry document (entries are created by the first pick, which IS lease-checked), so a mid-settlement join can only move `entryCount`, which the finalizer reads inside its own fenced transaction. | **ACCEPTED** | §2.3: all three cores call `assertNoScoringInProgress` and `assertPoolAcceptsPlay` on the pool as read **inside** the transaction; join gains `retryWhileScoring` like its two siblings. |
| 3 | P1 | Clients can forge `status: 'COMPLETED'` / `closedVia: 'SETTLED'` directly — neither is in the server-owned list (`firestore.rules:157-251`). Make `status`, `closedVia`, `closedAt`, `finalizedAt`, `firstFinalizedAt`, `settlement`, `settlementStartedAt` server-owned. | **Partly.** True that `status`/`closedVia` are client-writable. But the client legitimately writes `status` today: `BracketPoolDashboard.tsx:381`, `SuperAdmin.tsx:753`, the simulators via `simUpdatePool`. | **PARTLY ACCEPTED** | Server-owned now: `settlement`, `settlementStartedAt`, `finalizedAt`, `firstFinalizedAt` (grep found no client writer of the last two; they are finalizer stamps, same class as `seasonPlaces`). **Rejected for `status` / `closedVia` / `closedAt`:** locking them breaks the bracket and Super-Admin paths above, and forging them grants a manager nothing on their own pool that `cancelPool` does not already give — while the member-facing claim ("the pot was split between A and B") is rendered ONLY from the server-owned `settlement` record, never from `closedVia`. Locking NFL lifecycle fields is a reasonable follow-up, not part of this PR. |
| 4 | P1 | Audit + emails run after the flip; a crash after the flip makes the retry refuse, so they are lost. Needs a durable outbox. | **Yes** — guard 3 refuses a pool with `closedVia`. | **ACCEPTED, simplified** | Audit events move to BEFORE the flip (they record the settlement as performed; written on every attempt is harmless — a retried settlement producing two audit rows is honest). Emails stay after the flip, gated by `settlement.notifyMembers` and completed by stamping `settlement.emailedAt`. Guard 3 admits a pool with `closedVia: 'SETTLED'`, `settlement.notifyMembers === true` and no `emailedAt` and runs ONLY the email step. Delivery is at-least-once (a crash between the last send and the stamp re-sends), which is the right side to fail on. |
| 5 | P2 | No client/server types for `closedVia`, `finalizedAt`, `settlement`, `settlementStartedAt` on `NFLSurvivorPool`. | **Yes** — `src/types/nflPoolTypes.ts` and `functions/src/nflPoolTypes.ts` lack them. | **ACCEPTED** | §2.4: a `PoolSettlement` type in `shared/` (both roots import it), fields added to both NFL pool types. |
| 6 | P2 | "Finalize, then flip" is the only safe order (`maybeFinalizeNFLPool` and `checkFence` both refuse a voided pool); make it an explicit invariant with a test. | **Yes** — `nflFinalize.ts:347-353`, `scoringLease.ts:106-118`. | **ACCEPTED** | Stated in §2.2 and tested: a pool already COMPLETED before the finalizer runs is refused, not half-settled. |

Codex also confirmed the `settlementStartedAt` recovery predicate as coherent:
"`finalizedAt` absent **or** this callable's durable `settlementStartedAt`
exists", with recovery passing `force: 'SETTLED'`.

## Round 2 — plan @ `602c4086` — CHANGES NEEDED (6 findings)

| # | Sev | Finding (codex) | Verified? | Verdict | Response |
|---|---|---|---|---|---|
| 1 | P1 | `proxyPick` is NOT covered by a guard in `submitNFLPicksInternal`: it has its own transaction (`poolExceptions.ts:300-310`). | **Yes** — read it; own `retryWhileScoring` transaction, own `poolInTx`. Sweep S2 was wrong on this row. | **ACCEPTED** | §2.3 adds `proxyPick` as a fourth guarded site; S2 corrected; emulator test covers it. |
| 2 | P1 | Phase table says `EMAIL_ONLY` = "step 8" and `FULL` = "steps 1–8"; email is step 10. | **Yes** — a renumbering left behind. | **ACCEPTED** | Phase table now names the steps by what they do, not by number. |
| 3 | P1 | Audit-before-flip can record a false `POOL_SETTLED`: `cancelPool` takes no lease, so it can win the gap and `checkFence` then refuses the flip. | **Yes** — `cancelPool` (`poolExceptions.ts:560-575`) is a plain `update`; `checkFence` refuses a voided pool (`scoringLease.ts:106-118`). | **ACCEPTED, different fix** | The pool audit event is written **inside the flip transaction** (`fencedWrite`'s `apply(tx)` — `scoringLease.ts:194-205` reads the pool first, then runs `apply`, then writes), so it exists if and only if the flip committed. `writeAdminAudit` (the Super-Admin log) and emails follow the flip and are recovered by the follow-up phase. |
| 4 | P1 | Leaving NFL `status` client-writable is NOT harmless: the manager update rule only checks the CURRENT status (`poolIsEditable`, `firestore.rules:480`), so one write moves `OPEN`→`FINAL`/`COMPLETED`, and the entry read rule (`firestore.rules:730-735`) then opens every member's entry — un-revealed picks included — to every participant. | **Yes**, and it is **pre-existing**: a commissioner can do this today on any NFL pool, independent of this plan. No NFL client path writes `status`/`closedVia`/`closedAt`/`isFinal` (grep in sweep S3: only bracket, Super-Admin-on-bracket and the sim callable). | **ACCEPTED** (round-1 rejection withdrawn) | §2.4b: new `nflLifecycleWriteBlocked()` in the manager branch, same shape as `nflSettingsWriteBlocked()` — an NFL pool's `status`, `closedVia`, `closedAt`, `isFinal` are callable-only for managers. The super-admin branch is unchanged. Rules tests for each field, and one proving a bracket manager can still lock their bracket. Flagged to Kevin as an authorization fix riding this PR. |
| 5 | P1 | Phase table refuses only `CANCELED`/`ARCHIVED`, but `isVoidedPool` also covers `COMPLETED`; and the finalizer returns `{finalized:false}` for a voided pool rather than throwing. | **Yes** — `autoScoreDecisions.ts:75`, `nflFinalize.ts:347-353`. | **ACCEPTED** | Refusal row is `isVoidedPool(pool)` (minus the SETTLED follow-up rows); the callable requires `outcome.finalized === true` before the flip and otherwise throws `FINALIZE_DECLINED: <reason>`. |
| 6 | P2 | "Sim pools unaffected" is too broad: the harness drives the same cores and `simFinalizePool` stamps `finalizedAt` (`simHarness.ts:782-795`), after which the guard blocks play. | **Yes.** The one scenario runner that finalizes (`nflSeasonSimulator.ts:211-213`) only `recordPayouts` after it, which is not a play path. | **ACCEPTED** | Claim corrected: after finalization, sim or not, play is refused — intended terminal behaviour. Gates will show whether any scenario plays after `finalize`. |

Codex confirmed the rebuy-disclosure response as "coherent if the product
accepts that the recorded prize excludes those dues", and `force` as
source-compatible (`nflFinalize.ts:329-333`), bypassing only completeness.

## Round 3 — plan @ `f8430158` + work in progress — design APPROVED; code not yet written

Two earlier round-3 attempts did not run (the default sandbox refused every
process: `CreateProcessAsUserW failed: 5`) and are not counted. This run used
`-s danger-full-access` with a read-only instruction; `git status` before and
after showed no file changed by the reviewer (it left one stray `$null` error
file from a PowerShell-style redirect, deleted).

Codex reviewed the plan AND the half-built working tree, so its three findings
are "not implemented yet" (rules predicate absent, four fields not yet
server-owned, callable absent) — true at the time, and exactly the plan's own
to-do list, not design defects. On the design questions it was asked:

* phase precedence in `lib/settlement.ts:33-46` — **correct**;
* `proxyPick` guard at `poolExceptions.ts:301-316` — **correct**;
* `nflLifecycleWriteBlocked()` — "I found no existing NFL manager client path
  that writes these fields, so this will not break a current NFL UI flow."

**Plan review closed.** Every finding across three rounds is accepted (some with
a different fix, reasoning above) or rejected with evidence; none open. Code
review continues on the PR diff (`codex exec review --base origin/main`).

---

# Code review (PR diff, `codex exec review --base origin/main`)

## Code round 1 — HEAD `61f4a123` — 2 findings

| # | Sev | Finding | Verified? | Verdict | Response |
|---|---|---|---|---|---|
| 1 | P1 | The panel derived the winners from the standings rows and dropped `unscored` ones; an ALIVE entry not yet scored is `unscored` there, so the server's `WINNERS_MUST_BE_ALIVE_SET` refused every settlement until the next scoring pass. | **Yes** — `buildMemberStandings` marks both an unscored entry and a roster-only member `unscored`, so the client cannot tell them apart. | **ACCEPTED** | `settlePool` gains a read-only `preview: true` mode: owner gate, phase check, then the ALIVE entries, pot, share and entry count computed by the finalizer's own `computeFinalRanks` + `seasonPlacesPublication`. The panel shows the preview and sends back exactly its ids. It also replaces the client-side pot math, so preview and write share one code path. Emulator test: preview equals the record and writes nothing. |
| 2 | P2 | Two overlapping FOLLOW_UP retries can both send every email before either stamps `emailedAt`. | **Yes**. | **ACCEPTED** | Each follow-up step is claimed in a transaction (`settlement.emailClaimedAt` / `adminAuditClaimedAt`, `followUpClaimable`); a claim older than 10 minutes counts as abandoned. Emulator test: two concurrent retries send 5 emails in total, split 5/0. |
