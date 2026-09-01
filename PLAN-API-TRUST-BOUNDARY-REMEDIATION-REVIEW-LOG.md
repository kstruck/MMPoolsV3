# PLAN-API-TRUST-BOUNDARY-REMEDIATION — REVIEW LOG

Adversarial review per mmp-change-control Rule 3 step 2. Reviewer: codex
(`codex exec --sandbox read-only`), cap 10 rounds (CLAUDE.md §2c; qodo DORMANT).

## Round 1 — codex

VERDICT: REVISE. 7 findings.

> 1. **P1 — Claim-only SUPER_ADMIN bypasses remain outside the sweep.**
>    `assertPoolOwnerOrSuperAdmin` grants on `userRole === 'SUPER_ADMIN'`
>    (poolOps.ts:78). Raw JWT claim passed at invites.ts:73,
>    manualReminders.ts:62, poolParams.ts:27, poolOps.ts:505,
>    poolExceptions.ts:131/240/555. S3 grep only catches direct comparisons.
>    Fix: trace all helper callers; resolve `confirmedAdminClaim` before every
>    admin-bypass call; add a source invariant.
> 2. **P1 — Cursoring both repair jobs breaks the one-click admin workflow.**
>    OperationsPanel calls backfillPools/fixParticipantIds once with `{dryRun}`
>    (OperationsPanel.tsx:268/277/421/430); the plan changes "all pools" to one
>    page with no completion path. Fix: continuation design in the panel.
> 3. **P1 — "Bounded reads" not achieved: inner subcollection scans unbounded.**
>    backfill.ts:96, poolOps.ts:855. A 25-pool cap does not bound one large
>    pool's entries scan. Fix: per-entry cursor or explicit per-pool cap with
>    continuation contract.
> 4. **P2 — S4 incomplete.** getPoolQuote leaks caught `e.message`
>    (billing.ts:566); checkout quote too (stripe.ts:516). Invariant should
>    catch aliases like `msg = e.message`.
> 5. **P2 — D4 fail-closed switch makes the live button unusable with no
>    operator path.** Fix: defer, or explicit provisioning + admin-visible
>    state.
> 6. **P2 — Truncated site-average publishes incorrect data.** Frontend
>    renders `weekly` rows unchecked (PlayerProfile.tsx:145). Fix: keep last
>    complete aggregate on cap exhaustion; report unhealthy.
> 7. **P3 — `backfillProfileData` is a wrong precedent for bounded-read
>    safety** (its own inner scans are uncapped). Describe the contract
>    independently.

### Claude's response

All seven verified against source and ACCEPTED; plan + sweeps updated:

1. Accepted. Verified all 7 indirect call sites pass the raw claim. Phase 3
   gains a row (confirmedAdminClaim at each site + source pin banning raw
   `token.role` as the helper's third arg at call sites). Sweeps gain S3b with
   the complete helper-caller list and the command that derives it.
2. Accepted. Phase 4 now updates OperationsPanel in the same change: bounded
   sequential runner (loop pages until `hasMore` false, hard stop 100 pages,
   aggregated counts, per-page progress). One click still completes the job.
   Noted: frontend change ⇒ Coolify rebuild owed at deploy time.
3. Accepted, with a cap rather than a composite cursor: every per-pool
   subcollection read gets `.limit(ENTRY_SCAN_CAP+1)` (2000); an over-cap pool
   is skipped whole (never partially processed), reported in
   `oversizedPools`, and the outer cursor advances. Rationale: no legal pool
   can reach the cap, so it is an anomaly detector; a composite inner cursor
   adds resume complexity for a case that indicates corruption, not scale.
   This is a partial acceptance of the "per-entry cursor" fix — the
   continuation contract exists, but per-entry resumption is deliberately not
   built; the skip-whole-pool rule keeps idempotency intact.
4. Accepted. billing.ts:566 + stripe.ts:516 added to S4/Phase 1 (codes stay
   `invalid-argument`; text becomes the existing stable fallback). Alias
   shapes: acknowledged regex limit; each fixed alias site gets a per-file pin
   instead of pretending the invariant catches it.
5. Accepted as modified: kill-switch stays (Rule 1), but the refusal is a
   `failed-precondition` naming the config key — the operator path is
   self-describing in the panel output; absent key = disabled, no
   provisioning step. Remains flagged to Kevin as decision Q1/D4.
6. Accepted. Cap exhaustion now ABORTS without writing; last complete
   aggregate stays; run returns `{ok:false}` so the heartbeat goes unhealthy.
7. Accepted. Phase 4 now states the contract in full, independent of
   `backfillProfileData`, including the inner-scan bounds.

## Round 2 — codex

VERDICT: REVISE. 4 findings.

> 1. **P1 — The claimed legal-entry bound is false; the 2,000-entry cap would
>    break valid pools.** Entitlements permit `maxPlayersPerPool` 9,999
>    (entitlements.ts:181-186), package schema has no upper cap
>    (shared/schemas/billingConfig.ts:104-111), multi-entry ×10. A valid pool
>    can exceed 2,000 entries; getPoolPicks would fail and repair jobs would
>    permanently skip it. Fix: derive from an enforced bound or build real
>    inner pagination.
> 2. **P1 — Round-1 absorption #1 incomplete: `closePool` still passes the raw
>    claim** (poolExceptions.ts:614, destructive close). Fix: add to S3b +
>    Phase 3; invariant must enumerate every caller of BOTH helpers.
> 3. **P2 — The 100-page frontend stop contradicts the completion promise and
>    has no resume design.** Fix: persist/display the last cursor, offer
>    resume, report cap-hit as incomplete.
> 4. **P2 — The HTTP role-check helper is called "pure" but does I/O, and the
>    401 try/catch would swallow the doc read.** Fix: async helper, doc-read
>    failure → false (fail closed); keep verifyIdToken's 401 boundary
>    separate; unconfirmed verified caller → 403.

### Claude's response

1. Accepted. Cap raised to `ENTRY_SCAN_CAP = 10_000` and REFRAMED: it is an
   explicit worst-case work bound, not an "unreachable" claim. getPoolPicks
   overflow becomes `failed-precondition` (`ENTRY_SCAN_OVERFLOW`, stable
   message). Repair jobs still skip-whole-pool + report `oversizedPools`
   (dry-run reports it too). Per-entry resumption still deliberately not
   built — recorded as the escalation path, not silently.
2. Accepted. `poolExceptions.ts:614` (closePool) added to S3b and Phase 3;
   the source pin now enumerates every call site of BOTH gate helpers.
3. Accepted. Panel reports INCOMPLETE on error or page-stop, shows the last
   cursor, offers "Continue from cursor"; complete only on `hasMore:false`.
4. Accepted. Helper specified async (Firestore read), doc-read failure →
   false + log; 401 (token invalid) and 403 (verified but unconfirmed)
   boundaries separated in both endpoints.

## Round 3 — codex

VERDICT: REVISE. 6 findings (round-2 absorptions confirmed present).

> 1. **P1 — Authorization sweep still omits live raw-claim SUPER_ADMIN
>    bypasses**: coCommissioners.ts:44,54,68; nflEntryDelete.ts:100,427;
>    nflPools.ts:117-120,414-422,470,1029-1033; nflEntryRename.ts:92,195-200;
>    poolOps.ts:136-140,339-342.
> 2. **P1 — The 10,000-entry cap still breaks legal pools** (entitlements
>    allow 9,999 players × 10 entries). Enforce a real ceiling or build
>    continuation.
> 3. **P1 — Cursor continuation can silently convert a dry run into skipped
>    live work** (cursor not bound to dryRun mode).
> 4. **P1 — The page cap is not an executable timeout budget** (25 × 10,000
>    entries, 2 writes/entry; backfill.ts sets no options; default 60s).
> 5. **P2 — Risks R2 still repeats the disproven "far below 2,000" claim.**
> 6. **P2 — siteAveragesJob folds a `{ok:false}` recompute RETURN into a
>    success detail; cap exhaustion must throw to reach the heartbeat.**

### Claude's response

1. Accepted. Every site verified in source and added (S3c + Phase 3 row).
   Pure helpers (`simRunIdForCreate`, `assertNFLPickMembership`) stay pure;
   the resolved role is threaded from each callable's wrapper edge, before
   any transaction. `assertNotBanned(claimRole, …)` sites classified as ban
   checks, not privilege grants — no change, with reasoning in S3c.
2. Accepted as modified. The cap stays 10,000 but is REFRAMED as a documented
   product ceiling requiring Kevin's sign-off (new Q3, recommendation:
   approve), with a join-time aggregate entry ceiling named as follow-up
   work. Building reveal/repair continuation for a pool shape that has never
   existed on this site is complexity the plan deliberately declines; the
   failure mode is loud, never silent.
3. Accepted. Response echoes `dryRun` beside `nextCursor`; the panel keys
   stored cursors by (operation, mode); live never continues a dry cursor.
   Tested.
4. Accepted. Both repair callables get
   `options: { timeoutSeconds: 300, memory: "512MiB" }` + a
   `MAX_WRITES_PER_RUN = 5_000` staged-write budget that stops at the last
   fully-processed pool and returns that cursor.
5. Accepted. R2 rewritten to state the real risk and point at Q3.
6. Accepted. `recomputeSiteAverages` THROWS on cap exhaustion; the job's
   existing catch yields `{ok:false}` (heartbeat unhealthy); the callable
   surfaces the framework generic internal.

## Round 4 — codex

VERDICT: REVISE. 2 findings (round-3 absorptions confirmed present).

> 1. **P1 — The 10,000-entry cap still breaks valid live pools** (entitlements
>    permit 9,999 players × 10 entries; the ceiling is unenforced Q3/follow-up).
>    Fix: enforce an aggregate admission limit or build resumable inner
>    pagination.
> 2. **P1 — The 5,000-write budget contradicts the whole-pool continuation
>    guarantee**: 2 writes/entry means a 2,500+-entry pool can never complete
>    under a hard mid-pool budget stop; retrying loops forever.

### Claude's response

1. **REJECTED, with counter-position.** The commissioning prompt for this
   remediation explicitly lists "a documented hard cap that is enforced
   server-side" as an accepted resolution for bounded reads, and that is what
   the plan implements: the cap is enforced (limit+1, loud
   `ENTRY_SCAN_OVERFLOW` / `oversizedPools`, never silent truncation),
   documented, and gated on Kevin's sign-off (Q3) with the join-time
   aggregate ceiling named as follow-up. Enforcing a new admission ceiling on
   the live join/entry-create money paths mid-season — or building resumable
   inner pagination for a pool shape three orders of magnitude beyond
   anything that exists — carries MORE live-caller risk than the theoretical
   gap it closes. Kevin rules on Q3; if he declines the cap, the follow-up
   work is the admission ceiling, not silent truncation.
2. **ACCEPTED.** Real internal contradiction. The budget is now a stopping
   threshold checked between pools only; a pool is never split; run total is
   bounded by budget + one inner-cap-bounded worst-case pool. Plan text
   rewritten (`WRITE_BUDGET_PER_RUN`).

## Round 5 — codex

VERDICT: REVISE. 1 finding. (Round-4 #2 absorption confirmed; the rejected
round-4 #1 was NOT re-raised.)

> 1. **P1 — `getPoolPicks` caps documents, not its response size.** A
>    below-cap pool can still materialize per-entry maps too large for the
>    callable transport (poolCore.ts:84 allows ≤50 pick + 50 confidence keys,
>    100-char strings), bypassing the stable overflow path. Fix: derive the
>    cap from the worst-case returned shape (or enforce a byte budget) and
>    add boundary tests.

### Claude's response

Accepted. `getPoolPicks` gets its own `REVEAL_ENTRY_CAP = 2_000`, derived
from the worst-case masked response shape (≤4 KB/entry ⇒ well under the
transport limit with margin), arithmetic documented at the constant and
pinned by a test. Repair jobs keep `ENTRY_SCAN_CAP = 10_000` (count-shaped
responses). Q3 wording unchanged — the reveal cap is part of the same product
ceiling decision.

## Round 6 — codex

VERDICT: REVISE. 2 findings (both refinements of the round-5 absorption; the
round-4 rejection was not re-raised).

> 1. **The ≤4 KB/entry arithmetic contradicts the live response** (50 picks +
>    50 confidence + counts + entries maps; ~25 KB worst case per entry), so
>    a 2,000-doc cap is not demonstrably transport-safe. Add an enforced byte
>    budget or recompute.
> 2. **Q3 still says 10,000 "for reveal/repair surfaces"** while Phase 4 now
>    sets reveal at 2,000 — decision text out of sync.

### Claude's response

1. Accepted. Two layers now: `REVEAL_ENTRY_CAP = 2_000` (work bound) AND a
   measured `REVEAL_RESPONSE_BYTE_BUDGET = 8_000_000` on the assembled
   response (transport bound) — same stable overflow class, both constants
   documented + pinned.
2. Accepted. Q3 rewritten to name the two distinct ceilings explicitly.

## Round 7 — codex

VERDICT: REVISE. 1 finding (round-6 absorptions confirmed present).

> 1. `JSON.stringify(...).length` counts UTF-16 code units, not UTF-8 bytes;
>    non-ASCII strings could pass the check while exceeding the transport
>    limit. Use `Buffer.byteLength(json, 'utf8')` and pin a multibyte test.

### Claude's response

Accepted. Plan text updated; multibyte boundary test added to the test list.

## Round 8 — codex

VERDICT: APPROVED.

> No new defects found. Round 7's UTF-8 byte-measurement remedy is correctly
> specified and compatible with getPoolPicks' JSON-native response shape.
> (Codex also independently traced the live reveal response to confirm the
> 8 MB cap retains margin.)

## Resolution status (plan review)

CONVERGED — APPROVED at round 8 of 10 (cap). 23 findings across rounds 1–7;
22 accepted (several as-modified, each with reasoning), 1 rejected with a
written counter-position (round-4 #1 — the commissioning prompt explicitly
permits a documented, loud, server-enforced hard cap; Kevin rules on Q3).
Finding counts: 7 → 4 → 6 → 2 → 1 → 2 → 1 → 0.

---

# Implementation diff review (codex exec review --uncommitted)

## Diff round 1 — codex

VERDICT: 1 finding.

> [P2] Allow an exactly-full site-average scan (siteAverages.ts:68). With
> exactly MAX_PAGES × PAGE_SIZE documents the 50th full page reads fine but
> the NEXT iteration throws before checking whether another page exists — the
> job stops publishing at the documented capacity instead of only beyond it.
> Fetch a sentinel document or defer the cap check.

### Claude's response

Accepted. Rewritten with a PAGE_SIZE + 1 sentinel row: only a collection that
PROVABLY has more documents aborts; an exactly-cap-sized one publishes. New
test pins the boundary (`an EXACTLY-cap-sized collection still publishes`).

## Diff round 2 — codex

VERDICT: CLEAN. "No discrete correctness issues were identified in the
reviewed changes."

## Stopping rule

Satisfied per CLAUDE.md §2c (qodo DORMANT): codex diff round 2 clean AND the
author's own self-review of the final diff agrees (47 files,
+768/−202; verified against the plan's phase list; no unintended files).
