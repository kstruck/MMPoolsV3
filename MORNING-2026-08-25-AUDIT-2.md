# MORNING 2026-08-25 — Overnight audit-remediation session 2

> **Same date, different effort:** this file neither supersedes nor continues [MORNING-2026-08-25.md](MORNING-2026-08-25.md).
> That one is the AI-commissioner / per-pool-premium close-out; the two workstreams do not overlap.
> Its owed deploy is subsumed by the four-step order below.
>
> Continues [MORNING-2026-08-24-AUDIT-FIXES.md](MORNING-2026-08-24-AUDIT-FIXES.md)
> (session 1 of this effort). The queued work list it produced is
> [NEXT-SESSION-AUDIT-FIXES.md](NEXT-SESSION-AUDIT-FIXES.md); this file records
> what session 2 did with it. Repo copy — the chat message is the delivery.

Kevin's brief: items 1–24 of the queued list, plus a new triaged codex
external-findings program, plus a repo markdown cleanup. Run the workstreams in
PARALLEL in separate git worktrees with a coordination ledger, keep MERGES
sequential, one file-ownership map so no two streams collide.

## Result — 17 PRs merged, every one on a green CI rollup

| PR | What | Codex |
|---|---|---|
| [#564](https://github.com/kstruck/MMPoolsV3/pull/564) | Dead wizard files (item 16) — audit claim was WRONG for 5 of 6 files | 1 round clean |
| [#565](https://github.com/kstruck/MMPoolsV3/pull/565) | e2e suite in CI as non-blocking `e2e-playwright` (item 3 / D4) | 1 round clean |
| [#566](https://github.com/kstruck/MMPoolsV3/pull/566) | Site + email logo from the master artwork (item 8 / D3) | 2 rounds clean |
| [#567](https://github.com/kstruck/MMPoolsV3/pull/567) | Scan-bounds Phase 2 decision gate — measured in prod, SKIP (item 4) | 3 rounds |
| [#568](https://github.com/kstruck/MMPoolsV3/pull/568) | Picks view: check = CORRECT, X = INCORRECT (item 11, Kevin request) | 4 rounds, 2 findings |
| [#569](https://github.com/kstruck/MMPoolsV3/pull/569) | Job sizing + backend residue (items 14, 17) | 3 rounds, 7 findings |
| [#570](https://github.com/kstruck/MMPoolsV3/pull/570) | **Stripe fail-closed (P0, claim CONFIRMED)** | 3 rounds, 1 finding |
| [#550](https://github.com/kstruck/MMPoolsV3/pull/550) | Dependabot minor-and-patch ×13, rebased (item 7) | n/a |
| [#571](https://github.com/kstruck/MMPoolsV3/pull/571) | a11y + perf residuals (items 15, 22) | 3 rounds clean |
| [#572](https://github.com/kstruck/MMPoolsV3/pull/572) | CSP: frame-ancestors, XSS 0, real report sink (item 24) | 7 rounds, 5 findings |
| [#573](https://github.com/kstruck/MMPoolsV3/pull/573) | Error tracking: Sentry args, global handlers, transition paging, PII (item 21) | 6 rounds, 6 findings |
| [#574](https://github.com/kstruck/MMPoolsV3/pull/574) | Commerce model + 3 rejections + 3 runbooks (2b, 2g, 23a, 23b, item 10) | 10 rounds, cap |
| [#575](https://github.com/kstruck/MMPoolsV3/pull/575) | Firebase Auth backup, kill-switched OFF (item 2) | 6 rounds, 5 findings |
| [#576](https://github.com/kstruck/MMPoolsV3/pull/576) | LF-normalise the checkout; first real lint report (2f) | 2 rounds clean |
| [#577](https://github.com/kstruck/MMPoolsV3/pull/577) | SuperAdmin split phase 1 — Members tab (item 6) | 2 rounds clean |
| [#578](https://github.com/kstruck/MMPoolsV3/pull/578) | Deferred sweep: commerce copy, QuickPicks trap, scoreless-FINAL root fix | 3 rounds |
| [#579](https://github.com/kstruck/MMPoolsV3/pull/579) | **Pool passwords, Option 2 full fix (items 1, 13a-c, 21d)** | 10 rounds, 17 findings |

`codex exec review` ran on every PR. Across the night: **~60 rounds, ~45 findings
absorbed, 4 rejected with written measurements, 0 carried unresolved.**

## The three findings that mattered most

**1. The Stripe P0 was real, and worse than reported (#570).**
`getStripe()` returned null on a missing or `placeholder`-prefixed key with **no
environment condition at all** — no production file under `functions/src/` even
referenced `FUNCTIONS_EMULATOR` or `FIRESTORE_EMULATOR_HOST`. Pool checkout's
`if (!stripe)` branch then called `finalizePoolPayment(...)`, the same function
the verified webhook calls: `billing.status: "active"`, `billing.paid`, coupon
reservation confirmed, immutable ledger row, `?payment=success` redirect. Bundle
checkout called `grantBundle(...)` — and **had no ownership gate at all**, so any
signed-in user could take it. Triage also found the webhook dereferenced a
possibly-null `stripe`, a 500 crash loop on the same config state.

**2. Pool passwords, sixteen fail-OPEN defects in ten rounds (#579) — and the
exposure is NOT closed yet.** NEWLY set passwords are hashed; EXISTING pools still
carry plaintext on the publicly readable parent document until the migration sweep
runs, and the sweep is kill-switched OFF and has not been run. Step 4 of the deploy
order is what actually closes it.
Round 1 came back clean; the stream's own read then found four, including a
literal NUL byte in source. Later rounds found publish deleting a draft's
password, a dotted key bypassing the choke point, rules that allowed *clearing* a
legacy password, an unlock that leaked across pools, and **a Props gate that never
existed**. Sixteen of the seventeen findings were fail-open.

**3. CI is green partly by accident (#576).**
Six suites import `../shared/...`. `functions/src/shared/` is a **gitignored
generated mirror** only `functions`' own scripts produce. Root `npm test` imported
it without generating it — `ci.yml` runs functions `typecheck` (line 45) before
root `npm test` (line 51), and **swapping those two lines turns CI red**. Root
`test` now generates it itself.

## Audit claims that did NOT survive verification

Recorded because a rejected claim is a result, not a gap.

- **Item 16 (dead wizard code)** — "six files, zero importers" was wrong for five
  of six. Every symbol is re-exported by the barrel and imported by seven create
  wizards; four are additionally pinned by existing tests. Only `StepReview.tsx`
  was dead. 176 lines removed, not 516.
- **Item 4 / item 14 (dead-pool read cost)** — the bounded query returns **0 docs
  in production**; p50 0 / p95 0 / max 1 across 1,559 recorded runs. Measured
  Phase 2 saving: **$0.00/yr**. Prod holds 23 pools; 17 have no `scores.gameStatus`
  field at all and Firestore `!=` never matches a missing field.
- **Item 17(e) (four non-strict schemas)** — all four modules' exported schemas
  already reject unknown keys. The only non-strict nodes are two nested stripping
  objects whose tightening would be a live regression.
- **Item 17(c) (stale schema header)** — could not be reproduced; the header
  accurately describes what the file exports. Needs the audit author's context.
- **Item 22(d) (compress og-image.png)** — PNG floors at 382,385 B for that
  gradient across PIL and all six ffmpeg predictors. A smaller square version was
  built and then reverted, because `index.html:55` declares 1200×630 while the
  file is square.
- **Finding 2e (member removal)** — all three claims rejected: **there is no wired
  member-removal path in this app.** `voidMemberRecord`/`reconcileMembership` have
  zero production callers, membership was never in a token (rules resolve it with a
  live `get()` per request), and `onSnapshot` already dies on permission-denied.
  Three uncleared reciprocal indexes were a real adjacent gap and are fixed.
- **Decision D3's premise** — the emblem's chopped bottom is **in the source
  artwork**: alpha coverage y=802 → 371px, y=803 → 290px, y=804 → 0. No crop fixes
  it; the artwork needs a re-export.

## Environment incidents (all recovered, all worth a rule)

1. **The shared `node_modules` was wiped mid-session** by a stream that ran an
   install against it despite the instruction not to. `.bin` gone, 394 of 849
   packages, `functions/node_modules` emptied. Restored; both lockfiles verified
   byte-identical to backup and git-clean.
2. **`jsdom` was left half-installed** and this one was worse, because it was
   silent: 8 jsdom suites failed to *start*, surfacing as "Unhandled Errors" rather
   than FAIL lines, so the files simply dropped out of the count. Several streams'
   "pre-existing failures" were this. Repaired and verified.
3. **`git stash` is shared across all ~20 worktrees.** It collided three separate
   times; each time one stream's uncommitted work landed in another's tree. Nothing
   was lost — every case was recovered from dangling stash commits or had already
   merged — but this is now a standing rule: **never `git stash` in this repo while
   other sessions are live.**

The true local baseline, measured on a clean detached worktree after the repairs:
**133 files, 2215 tests, 3 failures — all CRLF, all fixed by #576.**

## Deploy debt — see the runbook in the chat message

`functions/` changed by #569, #570, #572, #573, #575, #579.
`firestore.rules` changed by **#579 only** (+97 lines).
Frontend changed by #564, #566, #568, #571, #577, #578, #579.

Order is load-bearing: **functions → rules → Coolify → password sweep.** The
sweep last, or swept pools render ungated on the old bundle.

## Not done, and why

- **Repo markdown cleanup (brief item 3)** — HELD, not skipped. `D:\march-melee-pools`
  already carries 351 uncommitted changes from an earlier session doing exactly this
  work (a context-hygiene/archive pass). Building a second competing cleanup would
  collide. The inventory is built (192 root `.md`, 36 with zero inbound references).
  Kevin's decision.
- **PLAN-COST-CONTROLS Phase 1 (brief item 4)** — not started. Plan-gated money work
  and the night was spent on items 1–24 plus the codex program.
- **Design-system tokens (item 5)** — not started. ~360 call sites across the whole
  `src/` tree; it would have collided with five live streams.
- **Codex program 2c (billing hardening) and 2d (honest dashboard)** — not started.
  2d gained a concrete target tonight: #577 found the Loyalty "Execute Mock Campaign"
  button is a `setTimeout` and a toast with no backend.
- **Item 21(e)** — console.* → structured logger, deferred by design: it collides with
  four files other streams held open.
