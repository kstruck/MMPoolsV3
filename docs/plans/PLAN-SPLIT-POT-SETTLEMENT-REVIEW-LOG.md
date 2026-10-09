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

## Code round 2 — HEAD `0f495d69` — 2 findings

| # | Sev | Finding | Verified? | Verdict | Response |
|---|---|---|---|---|---|
| 1 | P1 | `sendEmail` returns `'failed'` rather than throwing (`lib/deliveryTally.ts:42`), and the loop stamped `emailedAt` regardless, so a transient enqueue failure was recorded as delivered for ever. | **Yes**. | **ACCEPTED** | Delivery tracked per member by uid in `settlement.notifiedUids` (queued, or skipped for a reason a retry cannot fix). `emailedAt` only when nothing failed; on a failure the claim is released so a retry reaches only the missed members. Uids, never addresses, because the pool doc is member-readable — the test asserts no `@` lands there. The client reports failures instead of claiming everyone was told. |
| 2 | P2 | Recipients came from the first `pool` read, so a member who joined before the lease was missed. | **Yes**. | **ACCEPTED** | The roster is re-read after the flip. Test seeds a member added since, and asserts they are emailed. |

## Code round 3 — HEAD `71b677fd` — 2 findings

| # | Sev | Finding | Verified? | Verdict | Response |
|---|---|---|---|---|---|
| 1 | P2 | `writeAdminAudit` returns `false` instead of throwing (`lib/adminAudit.ts:120`), and `adminAuditedAt` was stamped regardless. | **Yes**. | **ACCEPTED** | Stamp only on `true`; otherwise release the claim. The callable returns `adminAuditFailed`. |
| 2 | P2 | After a failed send the follow-up stays owed, but the panel was hidden once the pool closed, so there was no product path to retry. | **Yes** — `NFLManagerView` gated the panel on `!poolIsOver`. | **ACCEPTED** | The panel also shows when `settlementFollowUpOwed(pool.settlement)`, in a "Finish up" mode whose Retry calls `settlePool` (FOLLOW_UP phase: only the owed steps, only un-notified members). |

## Code round 4 — HEAD `42c6a6c8` — 1 finding

| # | Sev | Finding | Verified? | Verdict | Response |
|---|---|---|---|---|---|
| 1 | P1 | `cancelPool` / `closePool` write without the scoring lease, so one landing between the finalizer's season-history writes and the settlement's flip leaves champion rows on a pool that reads cancelled/closed. | **Yes** — both were a plain `poolRef.update`. The same gap already existed against the regular scorer (the comment at `autoScoreDecisions.ts:80` names it). | **ACCEPTED** | Both now write in a transaction that runs `assertNoScoringInProgress` (wrapped in `retryWhileScoring`, as every other entry mutator is) and re-checks terminal status on the fresh read. A live lease bounces them with `SCORING_IN_PROGRESS`; a lifecycle write that commits first makes the settlement's next fenced write refuse before any history is written. Emulator tests for both directions. Behaviour change for site staff: a close attempted during a 5-minute scoring pass now asks them to retry instead of racing it. |

## Code round 5 — HEAD `036a2045` — 1 finding

| # | Sev | Finding | Verified? | Verdict | Response |
|---|---|---|---|---|---|
| 1 | P1 | `settlementStartedAt` was written before the winner check, so a refused attempt left a marker; after a later natural finalization the marker made `settlementPhase` treat the pool as an interrupted settlement and let it be force-settled. | **Yes**. A second path reaches the same state: a settlement that crashed AFTER the marker but BEFORE the finalizer, followed by a natural season end. | **ACCEPTED, broader fix** | The marker is gone. `maybeFinalizeNFLPool` with `force: 'SETTLED'` now stamps `finalizedVia: 'SETTLED'` in the SAME fenced write as `finalizedAt`, and the phase resumes a finalized pool only when `finalizedVia === 'SETTLED'`. Nothing is written before the winners are validated. `finalizedVia` replaces the marker in the rules' server-owned list. The plan's §2.2 step 5 (`settlementStartedAt`) is superseded by this row. |

## Code round 6 — HEAD after `58711e0b` — 1 finding

| # | Sev | Finding | Verified? | Verdict | Response |
|---|---|---|---|---|---|
| 1 | P2 | The join guard sat AFTER the already-a-participant branch, which can create a Member Record and move `entryCount` on a closed pool. | **Yes** — I had left that branch open on purpose, assuming it was a harmless backfill; it is not harmless (it moves `entryCount`). The only caller is the Join page (`JoinPool.tsx:79`), so refusing it costs nothing but a truthful error there. | **ACCEPTED** | Guard moved above the branch. Emulator test: an existing participant's join on a settled pool is refused and `entryCount` is unchanged. |

## Code round 7 — HEAD `c495111f` — 1 finding

| # | Sev | Finding | Verified? | Verdict | Response |
|---|---|---|---|---|---|
| 1 | P1 | A settlement interrupted after the finalizer and before the flip (`finalizedVia: 'SETTLED'`, no `settlement`) is resumable server-side, but `poolIsOver` hid the only panel that could resume it. | **Yes** — same family as round 3 #2, a state the server handles and the UI could not reach. | **ACCEPTED** | `settlementResumable(pool)` added to the panel's render condition; in that state the panel's preview and submit run the FULL phase as normal. Unit-tested. |

## Code round 8 — HEAD `0ce86a6b` — CLEAN ("No discrete correctness issues")

Then lint: +15 warnings on added lines (typed `any` casts, an unlinked checkbox
label, a React-compiler memo warning). Fixed to a delta of zero (1855 = the
`origin/main` baseline) in `1fd9fed7`; that new code earned another round.

## Code round 9 — HEAD `1fd9fed7` — 1 finding

| # | Sev | Finding | Verified? | Verdict | Response |
|---|---|---|---|---|---|
| 1 | P2 | The scheduled "you haven't picked" reminder (`checkNFLNonPickerReminders`) skipped only `status === 'archived'`, so members of a settled pool would still be told to pick. | **Yes** — `reminders.ts:936`; it is the only reminder path NFL pools run (`:226`). | **ACCEPTED** | Gate is `poolIsOver(pool)` (settled, cancelled, closed, finalized, any-case archived). Tests: no mail and no notification for each of the four. |
