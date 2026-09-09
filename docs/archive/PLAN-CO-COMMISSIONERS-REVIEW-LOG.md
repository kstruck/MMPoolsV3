# PLAN-CO-COMMISSIONERS — adversarial review log

Act 1 (grill-with-docs) ran overnight 2026-08-15 **without Kevin** — the questions
it would have asked him are the plan's §6, each with a recommendation. Act 2 is
codex (`codex exec -s read-only`, fresh session per round; the `--json`/resume
path hung on this machine and was abandoned after 30 min at 0.1s CPU — noted so
nobody re-tries it). MAX_ROUNDS=5.

## Round 1 — codex (10 findings) — VERDICT: REVISE

| # | Sev | Finding | Verdict | What changed |
|---|---|---|---|---|
| 1 | Critical | Legacy `coManagers` values remain trusted; a census is not a remedy | **ACCEPTED** | D2: T1's deploy clears `coManagers` on every pool (Operations-tab action) before any widened gate reads it; census count in the PR body |
| 2 | High | Commissioner Hub `array-contains` query denied — `allow list` (`rules:70-77`) is inline, not `isPoolManager()` | **ACCEPTED** | D3 rules row + T3: `allow list` gains the predicate; the exact Hub query is a rules-test case |
| 3 | High | C8 says "No" but `cancelPool`/`closePool` go through `loadPoolAndAssertManager` → the widened helper | **ACCEPTED — the best finding of the round.** Exactly the "widen by helper" failure D4 warned about, and the plan did it itself | D3 functions row: `assertPoolOwnerStrict` gates C8/C9/C10; T2 lists `poolExceptions.ts` and an emulator test refusing a co-manager on cancel/close |
| 4 | High | Full-array toggle loses a revocation under two owner tabs | **ACCEPTED** | D2: callable takes `{uid, op: add\|remove}`, one uid per call, transaction with re-read; T1 test "remove wins over a concurrent stale add" |
| 5 | High | "Leave drops in the same transaction" — `reconcileMembership` never touches `coManagers` and has no callers | **ACCEPTED** | Sweeps S8 measured it: there is NO live removal path; both lib helpers gain `arrayRemove` now so any future removal callable inherits it |
| 6 | High | "Server-owned" is false for a SUPER_ADMIN client — `protectedFieldsUnchanged()` is inside the manager branch | **ACCEPTED as a statement, not a change** | D2 says so explicitly and pins it in the rules test, exactly as `participantIds.rules.test.mjs` case 3 does for that field. SA is god mode by CONTEXT.md §Role; moving the guard outside the disjunction would be a separate authorization change to every protected field |
| 7 | Medium | `createdByUid` makes three layers disagree on the principal | **ACCEPTED** | D3: `ownerId` canonical; `createdByUid` functions-only fallback when `ownerId` absent; census of disagreeing pools in T2's PR body, listed for Kevin if non-zero |
| 8 | Medium | New callable lacks live-ban check and audit event | **ACCEPTED** | D2: `assertNotBannedLive` after the strict-owner check; audit event with before/after |
| 9 | Medium | T1 tests miss the deploy window, malformed legacy data, races | **ACCEPTED** | T1 evidence column: malformed array cleared not honoured, concurrent revoke, each S8 path |
| 10 | Medium | Missing zod schema / index export / dbService wrapper / pool types | **ACCEPTED** | D2 + T1 files list |

10/10 accepted (one as a statement). No rejections this round.

### Claude's response
The plan's D4 was written to prevent widening-by-helper and finding 3 shows the
plan violated its own rule in the ticket table. Fixed by naming the strict
helper and the two callables. Round 2 requested on the revised plan.

## Round 2 — codex (8 findings) — VERDICT: REVISE

Codex confirmed round 1's ten changes landed (incl. S8), then:

| # | Sev | Finding | Verdict | What changed |
|---|---|---|---|---|
| 1 | Critical | Migration window: three gates honour `coManagers` TODAY, so "clear before the widened gates read it" is false and functions→rules order permits forged grants | **ACCEPTED — the best finding of the round.** | D2 now prescribes THREE deploys: (1) T2a functions ignore the field → (2) rules lock + audited clear (+ `coManagersRevision: 0`) → (3) callable + widened helper. Between (1) and (3) nothing trusts the field |
| 2 | High | Transaction does not give revocation priority — an `add` retried after a `remove` re-adds | **ACCEPTED** | D2: `coManagersRevision`; `add` presents the revision it saw and fails `failed-precondition` if moved; `remove` needs none and always wins; test named |
| 3 | High | T2 swapping `squares.ts` `assertPoolManager` grants `updatePlayer`/`releaseSquares` (Squares PII) — contradicts K7 | **ACCEPTED** | D3 scope paragraph: `squares.ts` untouched; T2b files list excludes it |
| 4 | High | Inventory is not "every commissioner capability" — Bracket/Props gates unlisted | **ACCEPTED as scope, not widening** | New row C13: co-commissioners are NFL-only in v1; sweeps S9 lists the other-format gates and asserts they stay byte-identical |
| 5 | High | Sim tools (`simulateGameUpdate`, `simFillSquares`) granted via the shared helper without a signed capability | **ACCEPTED** | They NARROW to strict owner/SUPER_ADMIN in T2a — removes a grant a forged array can reach today |
| 6 | Medium | D6 said "submit the full array", contradicting D2's singular callable | **ACCEPTED** | D6 rewritten: per-row `{uid, op}`, re-render from the snapshot |
| 7 | Medium | C6's private-ledger read (`payoutRecordsPrivate`) not ticketed | **ACCEPTED** | T3 gains the predicate iff K3 = Yes, with the emulator case both ways |
| 8 | Medium | Audit named the wrong store (`admin_audit`) and no event type | **ACCEPTED** | D2: `writeAuditEvent` typed `CO_COMMISSIONER_CHANGED` `{op, uid, before, after, revision}`; the clear is a separately audited, resumable admin action |

8/8 accepted.

### Claude's response
Round 2's lead finding is the second time this plan claimed a safety property
its own deploy order did not provide (round 1's finding 3 was the first). Both
were about ORDER, not intent — the tickets are now sequenced as three named
deploys and the review log is the place a future implementer should read first.
Round 3 requested.

## Round 3 — codex (4 findings) — VERDICT: REVISE

| # | Sev | Finding | Verdict | What changed |
|---|---|---|---|---|
| 1 | Critical | `coManagersRevision` is client-writable, so a co-manager can reset it and slip a stale add through | **ACCEPTED** | D2: revision joins `protectedFieldsUnchanged()` and `PRIVILEGED_POOL_FIELDS`; T1 test: revision-reset attempt denied |
| 2 | Critical | NFL-only scope (C13) not enforced in the setter, helper or rules | **ACCEPTED** | D2: setter refuses non-NFL types; helper branch and rules predicate carry the same `type in [...]` guard |
| 3 | High | Widening client `isPoolOwner` also widens `isPoolManager`/`canManageEntries` for Bracket/Playoff and contradicts D6's owner-only toggle | **ACCEPTED** | D3 client row: new type-scoped `isNFLPoolCommissioner`, used only at the NFL `isManager` gate; ownership helpers stay strict |
| 4 | High | C8's "strict owner" silently revokes `managerUid`'s existing delete/close authority | **ACCEPTED** | D3: helper renamed `assertPoolOwnerOrManagerNoCo` — today's destructive set minus `coManagers`; nothing legacy is revoked |

4/4 accepted. Round 4 requested — the plan is converging (10 → 8 → 4, all
about enforcement placement rather than intent).

## Round 4 — codex (3 findings) — VERDICT: REVISE

| # | Sev | Finding | Verdict | What changed |
|---|---|---|---|---|
| 1 | Critical | Step 2 shipped the co-manager-READING rules with the lock, so a forged legacy value gains rules access while the scrub runs | **ACCEPTED** | D2: step 2 is the lock ONLY + a verified-complete scrub; every reading predicate (T3) moves to step 3 |
| 2 | High | Rules `delete` moved to owner-only, revoking `managerUid` (rules `:79-84` admit it today) | **ACCEPTED** | D3/T3: `isPoolOwnerOrManagerNoCo()` for delete |
| 3 | High | T2b/T5 still said "`isPoolOwner` gains it", contradicting D3 | **ACCEPTED** | T2b/T5 reworded to `isNFLPoolCommissioner`; helpers-unchanged asserted by test |

3/3 accepted — all placement/wording. Round 5 (the cap) requested as the
convergence check; if it returns REVISE the remaining points are handed to
Kevin in the morning doc rather than argued further.

## Round 5 — codex (3 findings) — VERDICT: REVISE — **CAP REACHED**

| # | Sev | Finding | Verdict | What changed |
|---|---|---|---|---|
| 1 | Critical | §7's deploy-shape line still put T3 in step 2, contradicting D2 | **ACCEPTED — my inconsistency, third time this plan's prose lagged its own decision** | §7 corrected |
| 2 | High | `revision` optional in the D6 contract; type field missing | **ACCEPTED** | D2/T5: required for `add` in schema/wrapper/UI; `coManagersRevision?` on both type systems |
| 3 | Medium | Hub is `ParticipantDashboard` + `subscribeToPools` + two filters, not just a query | **ACCEPTED** | D7/T5 name all three |

3/3 accepted.

### Resolution — DEADLOCK AT THE CAP (5 rounds, 28 findings, 28 accepted, 0 rejected)

No round returned APPROVED. The trajectory is 10 → 8 → 4 → 3 → 3, and rounds
4–5 were entirely placement/wording of decisions already taken; the design
itself has been stable since round 3. **Claude's position:** the plan is
ready for Kevin's §6 sign-off; the round-5 items are absorbed; an implementer
starting T1 will run codex again on code, which is where the next real
findings will come from. **What Kevin should know:** this plan has three times
claimed a safety property its own ordering did not provide (r1 #3, r2 #1, r5
#1) — every one caught by the reviewer, none by self-review — so the deploy
order in D2/§7 must be treated as the load-bearing part of the plan and
re-read before each of the three deploys.
