Overnight session, continuing from a previous one. Standard overnight rules: keep working past the current plan without asking me to approve each chunk. Deploys, production data mutations, config/kill-switch flips, merges, and Coolify rebuilds stay gated on me. Leave a morning takeover doc as the last thing you do.

Repo: D:\march-melee-pools. Read CLAUDE.md and HANDOFF.md first, load the matching `.claude/skills/mmp-*` skill before acting, follow §2b/§2c (qodo + codex on every PR) and §2d (one PR at a time). Work in an isolated worktree, branch from `origin/main` with `-b`. A fresh worktree has no `.env` (gitignored) — copy it from D:\march-melee-pools or the app boots blank.

**Deadline: Hall of Fame game Thu 2026-08-06 8:00pm ET (CAR @ ARI). First 16-game preseason slate Thu 2026-08-13.** Prioritise anything that blocks a real NFL pool over anything cosmetic.

A logged-in SUPER_ADMIN Chrome session is available (mcp__claude-in-chrome__*). Production is https://www.marchmeleepools.com. Use it read-only against prod. Note: extracting a Firebase auth token from the browser session is blocked by policy, so direct Firestore REST reads will fail — read through the app's own UI or ask me for a console screenshot.

---

## STATE — established last session, do not re-derive

**PR #365 is MERGED (`f27c8ec`) and the indexes are DEPLOYED.**
`enforceBillingStatus` had two missing composite indexes and had never completed a run in its life (`git log -S 'billing.trialEndsAt' -- firestore.indexes.json` returns no commits). Both indexes are now live in prod. **The job fires nightly at 23:00 ET and will have run by the time you read this — verify the outcome (see task 0).**

**Production `system/config` values, read 2026-08-04:**
```
autoClose      = { enabled: true,  dryRun: false }     LIVE
nflLockWatch   = { enabled: true,  dryRun: ... }       ARMED
nflSpreadLock  = { enabled: true,  dryRun: true }      dry-run, does NOT lock
nflFinalize    = { enabled: ...,   dryRun: true }      dry-run
nflAutoScore   = ABSENT                                 OFF
maintenanceMode = false
poolTypeFlags  = all seven FALSE  ← DELIBERATE, Kevin's "coming soon" posture. DO NOT FLIP.
currentSeason  = 2025  ← DEAD FIELD, no code reads it. Ignore. Do not "fix" it.
```

**NFL readiness (verified, don't re-check):**
- HOF game IS imported: `CAR @ ARI, Thu Aug 6 6:00 PM`, seasonType 1 / week 1.
- Its spread IS locked and persisted: value `-1.5` (relative to home; ARI favored by 1.5). Verified by reload + fresh fetch from Firestore.
- The week-label relabel from #358 IS live in the prod bundle (`HOF Weekend / Preseason Week 1..3`).
- A parallel session ran a full prod E2E: 45/45 NFL scenarios passed.
- `syncNFLScoresJob` has NO config gate — it is on unconditionally, every 5 min.

**Billing pools:** 5 pools had `billing.status == "trial"`, all Kevin's. Kevin set **Kevin Struck's 2026 NFL Survivor Pool → `billing.status = "active"`** to immunise it. `BUYFLOW TEST` was deliberately left as `trial` as a live proof the job works. A pool named `BFT8` left the trial list mid-session, cause unknown — worth one look, not an investigation.

**Carried open finding (named on #365, deliberately deferred):** `enforceBillingStatus` has **no kill-switch and no dry-run**. Eleven files in `functions/src` gate on `system/config` (incl. `stripe.ts`, `monetizationAlerts.ts`); `billing.ts` is not one of them. Three independent reviewers converged on this. See task 4.

---

## TASK 0 — First: did the billing job run cleanly?

It fired at 23:00 ET. Confirm the fix actually worked.

1. SuperAdmin → Overview → Ops Health. `enforceBillingStatus` should no longer appear under STALE JOBS. Before the fix it was the only stale job.
2. Ask Kevin for a screenshot of `system/heartbeats` → `enforceBillingStatus` if you cannot read it (no UI renders that doc). Healthy is **`failedTransitions: 0`**. `trialToGrace` should be small (~4) and equals the number of commissioner emails sent.

Report the result at the TOP of the morning doc. If `failedTransitions > 0`, that is a money-path failure and outranks everything else in this list.

---

## TASK 1 — NEW, Kevin asked for this directly: "hosting fees paid" banner

**For any pool that is paid and active, show the pool manager a banner on the pool homepage confirming hosting fees are paid. Green background, white text. Simple.**

The insertion point is already identified: `src/components/billing/BillingGate.tsx:47`.

```js
if (!billing || status === 'active') {
    return <>{children}</>;      // 'active' short-circuits with NO banner today
}
```

That component already renders status-aware banners for `trial` (countdown), `grace_period` (amber warning) and `locked` (lock modal) — `active` is the one case with nothing. Add it there rather than inventing a second surface; a second definition of "is this pool paid" is exactly the class of bug this repo keeps hitting.

Notes:
- It already receives an `isCommissioner` prop. Kevin said "let the pool manager know", so gate on it — participants do not need to see hosting-fee state.
- Decide and state your reasoning on whether the condition is `status === 'active'` alone, or also requires evidence of payment (`billing.paidVia` / `billing.pricePaid > 0`). A pool activated by free allocation is `active` but paid nothing — Kevin said "paid and active", so a free-allocation pool arguably should not claim fees are paid. **Make the call, write the reasoning in the PR, and flag it for Kevin.**
- Match the existing banner markup/animation conventions in that file. Do not add a new styling system.
- Guard it in `src/__tests__/billingGate.test.tsx` (15 existing tests, uses `renderToStaticMarkup`, no jsdom).

⚠️ This touches `src/**` → **owes a Coolify rebuild**, which is Kevin's manual action. Put it in the morning doc.

---

## TASK 2 — Fix the dead "Activate Pool (Free Allocation)" button

**Confirmed reproduced on production.** `src/components/billing/BillingInvoiceCard.tsx:746-752`:

```js
disabled={ … || (total <= 0 && (!appliedCoupon || subtotal === 0) && !useCredit && !hasUnlimitedPass) || … }
```

For a genuinely free pool every term is true → **disabled**. But the label branch renders `total === 0 ? 'Activate Pool (Free Allocation)'`, and the greyed-out styling is attached to a *different* clause, so it renders in live red with a normal cursor. Measured on prod: `disabled: true`, `cursor-not-allowed: false`, red styling `true`.

**The free path is implemented and reachable server-side** — `handleCheckout` calls `createCheckoutSession`, the loading label is *"Activating pool..."* for `total === 0`, and the server returns a success URL for $0. The client blocks the only button that reaches it.

**Impact: no commissioner can self-activate a free pool.** Dead end on the monetization path for every user.

Scope the fix to that one clause. Add a guard test asserting a $0 / no-coupon / no-credit pool yields an **enabled** button labelled "Activate Pool (Free Allocation)" — the assertion that would have caught this.

⚠️ **This is the buy-flow: money. Plan-gated under `mmp-change-control` §1** — take the PLAN gate. Also `src/**`, so it owes a Coolify rebuild.

---

## TASK 3 — Dependency PRs

Open: **#366** (minor-and-patch group, 11 updates — dependabot recreated #361), **#354** lucide-react, **#353** @vitejs/plugin-react.

Check whether **#366 subsumes #354/#353** before spending rounds on them individually.

🛑 **DO NOT TOUCH #352 (vite 7→8), #302 (typescript 6→7), #300 (tailwindcss 3→4), #304 (firebase-admin 13→14).** Major bumps this close to the deadline are a bad trade. Kevin's standing instruction.

---

## TASK 4 — The kill-switch for `enforceBillingStatus` (design + PLAN only)

The job now runs live with no `enabled` flag and no `dryRun`. Every other risky scheduled job has `{enabled, dryRun}` in `system/config`.

Write `PLAN-BILLING-ENFORCEMENT.md` proposing the gate, following the shape of the existing gates (`readJobGate` in `nflSchedule.ts`, `readSweepGate` in `nflFinalize.ts` — note the latter refuses to arm without `liveSeasonTypes`, a good pattern).

**Do NOT implement it tonight.** It is a `functions/` change on a money path — it owes a functions deploy and the full plan gate, and the job is currently working correctly. Write the plan, let Kevin decide. `PLAN-BILLING-INDEX-DEPLOY.md` (already in the repo) has the context.

---

## TASK 5 — Lowest priority, only if the above are done

- The per-pool **Sim button** lives in the Pools tab while CONTEXT.md says the Test Suite is the sole home for simulation tooling. Queued task chip `task_1957c853`. Decide it, implement it, record the decision durably so the finding stops recurring on every PR touching those lines. The sibling **Fix button is by-design** per `mmp-superadmin-surface` §5 and is NOT in scope.
- `TEST-SUITE-BACKLOG.md` — parked simulator bugs, bracketSimulator 0-entries cluster the big one.

---

## DO NOT DO

- **Do not flip `poolTypeFlags`.** All seven false is Kevin's deliberate "coming soon" posture.
- **Do not arm `nflAutoScore`, `nflFinalize` or `nflSpreadLock`.** Kevin wants full auto-scoring (see morning doc task) but arming is a config flip and is his.
- **Do not deploy anything.** Functions, rules, indexes, Coolify — all his.
- **Do not merge any PR.**
- **Do not "fix" `currentSeason: 2025`.** Dead field, zero readers.
- **Do not run simulators against prod** — they write `sim-` pools.

---

## MORNING DOC

Write it as the last thing, into the repo. ⚠️ **Check whether a `MORNING-<date>.md` already exists before creating one** — a parallel session collided on exactly this last night and it cost a rebase. If one exists, append a clearly-marked addendum instead.

Must include, with exact commands and what-you-should-see:

1. **Task 0 result** — did the billing job run clean.
2. **Kevin's auto-scoring directive.** He said: *"I expect all games to be auto scored, nothing should be manual. The pool manager should never have to do anything manual."* Give him the full arming runbook. Verified values:
   ```
   nflAutoScore  = { enabled: true, dryRun: false }
   nflFinalize   = { enabled: true, dryRun: false, liveSeasonTypes: [1] }
   nflSpreadLock = { enabled: true, dryRun: false }
   ```
   ⚠️ `nflFinalize` **silently refuses to arm without `liveSeasonTypes`** — `readSweepGate` (`nflFinalize.ts:387`) forces dry-run and logs *"arm request refused; continuing dry"*. `[1]` = preseason only; must widen before the regular season.
   Recommend arming `nflAutoScore` in **dry-run first**, reading the heartbeat (`activeSlates`, `poolsScored`, `poolsFailed`; healthy is `poolsFailed: 0`), then flipping live. `nflAutoScoreJob` already has a fenced scoring lease, per-week fingerprint idempotency, provisional mid-week passes and a rescore queue — it was built for this. Flag that Survivor is the one type where ordering matters (`survivorAllowedForGroup`, `rescoreQueue.ts:255`).
3. **Every Coolify rebuild owed** — one is already outstanding from #358, plus anything you add in tasks 1 and 2.
4. What shipped, what is waiting on him with exact commands, what you found and did not fix, what you deliberately left alone, and any gate you stopped short of and why.

Do not report anything as done without evidence — command run plus output, or the file and value checked.
