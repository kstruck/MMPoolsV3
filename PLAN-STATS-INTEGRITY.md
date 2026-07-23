# PLAN — Stats integrity: exclude test pools, reset for the NFL season, add filters

**Status: DRAFT, awaiting Kevin's sign-off. No code written yet.**
Written 2026-07-22 evening. Covers Kevin's queued items **2** and **3**.

## Why this has a plan and the profile fix did not

`mmp-change-control` §1 (Kevin's ruling 2026-07-22) plan-gates a change that
touches **money, authorization, production data, or scoring**. This one hits
three of the four:

- **Production data** — it changes what gets written to `stats/global`, and the
  remediation includes overwriting that live document.
- **Money** — the figures are prize volume, charity raised and platform revenue.
- **Public surface** — `firestore.rules:470` grants `allow read: if true` on
  `stats/**`. These numbers are **world-readable**, not admin-only. Getting them
  wrong is not an internal reporting nit; it is publishing false money figures.

The profile header/footer fix, by contrast, touched none of the four and took
the ordinary gate. That contrast is the rule working as intended.

---

## 1. What Kevin reported

> Super Admin → Overview page: Stats seem off. Platform revenue, charity funds
> raised, prize volume, active pools, all seem high. Let's reset everything and
> start keeping track for the NFL season. Also, do not include test pools in
> these numbers.

And separately:

> Stats tab — it seems to be site wide, which is fine, but I also want to filter
> by sport, type of pool, etc.

---

## 2. What I found (verified by reading the code, not assumed)

### 2.1 There are TWO writers to `stats/global`, and NEITHER excludes test pools

| Writer | File | Behaviour |
|---|---|---|
| `onPoolLocked` | `functions/src/statsTrigger.ts:50` | Firestore trigger. On every unlocked→locked transition it does `FieldValue.increment(prizePot)` and `increment(charityAmount)`. |
| `recalculateGlobalStats` | `functions/src/statsTrigger.ts` (callable) | Queries **all** pools with `isLocked == true`, recomputes, and **overwrites** `stats/global`. |

Neither calls `isSimPool()`. So **every test pool that has ever been locked has
permanently added its fake pot to the public prize and charity totals** — and
the recalculate action, the thing an operator would reach for to "fix" it,
re-adds them all over again.

`isSimPool(pool, poolId)` already exists at `functions/src/nflFinalize.ts:228`
and checks `pool.simRunId`, a `sim-` season prefix, and a `sim-` id prefix. The
finalize sweep already uses it. This is a helper that exists and is simply not
applied here.

### 2.2 The good news: no manual reset is needed for prize/charity

Because `recalculateGlobalStats` **recomputes from source and overwrites**, the
fix is not a data migration. Add the exclusion, deploy, run the existing
Operations action, and the public numbers become correct in one step. The
accumulated error self-heals.

That matters because it means the risky option Kevin asked for — "reset
everything" by hand — is the option we should **not** take for these two
figures.

### 2.3 Platform Revenue is a different pipeline and may be genuinely fine

`admin_stats/revenue` is rolled up by `aggregateRevenueDaily`
(`functions/src/revenueAggregates.ts`) from the **`billingCharges`** collection —
real Stripe income, not pool pots. Test pools do not create Stripe charges
unless someone ran a real checkout against one.

**I cannot verify this without production access.** It is an open question for
Kevin in §5, not something I will guess at.

Note `admin_stats/**` is SUPER_ADMIN-only in the rules — unlike `stats/**`, this
one is not public.

### 2.4 Metrics I could NOT trace

`totalUsers`, `totalSquaresSold` and "active pools" are rendered by
`SuperAdminBentoDashboard.tsx` but I did not find their producers in
`functions/src`. They may be computed client-side or come from another doc.
**Stated as unknown rather than guessed** — §4 step 0 closes this before any
code is written.

---

## 3. Options considered for the "reset"

| Option | What it does | Verdict |
|---|---|---|
| **A. Exclude + recalculate** | Add `isSimPool` skip to both writers, deploy, run Recalculate Global Stats | **RECOMMENDED.** Self-healing, reversible (re-run recompute), no hand-edited money figures. |
| B. Zero the doc by hand, then accumulate | Manually set `stats/global` to 0 and let `onPoolLocked` rebuild | Rejected — discards real history, and without the exclusion fix the next test pool re-inflates it. |
| C. Season-scoped counters | Restructure `stats/global` into per-season buckets | Deferred. This is what "start keeping track for the NFL season" really implies, and it is a schema change — see §6. |

**A does not lose real history**: the recompute derives from the pools
themselves, so genuine locked pools keep contributing.

---

## 4. Proposed work, in order

**Step 0 — close the unknown (no code).** Find the producers of `totalUsers`,
`totalSquaresSold` and "active pools". If any also sweep pools without a sim
filter, they join step 1. *Nothing else starts until this is answered.*

**Step 1 — exclude test pools (PR, functions).**
Apply `isSimPool()` in both writers. Also skip `status === 'CANCELED'` in
`onPoolLocked` for symmetry with the sweep, **if** step 0 shows the recompute
already does so — otherwise leave it and say why.

Tests: extend the existing functions suite. A sim pool locking must NOT
increment; a real pool must. The recompute must exclude sim pools from its
total. Verified by reverting the exclusion and watching those tests fail.

**Step 2 — Kevin runs Recalculate Global Stats** (SuperAdmin → Operations)
after the deploy. Prod-data action, his. Expected: prize volume and charity drop
to the real figures.

**Step 3 — platform revenue**, only if §5 Q1 says it is contaminated.

**Step 4 — the Stats tab filters (item 3).** Deliberately last: filtering by
sport and pool type requires the stats model to *carry* those dimensions, and
today `stats/global` is a single flat document with four numbers. This is a
schema and aggregation change, not a UI change, and it should not start until
steps 1–2 have made the underlying numbers trustworthy. Filtering wrong numbers
faster is not progress.

---

## 5. Questions only Kevin can answer

1. **Has any real Stripe checkout ever run against a test pool?** Decides
   whether platform revenue needs remediation at all. Check
   SuperAdmin → Monetization, or the Stripe dashboard, for charges tied to
   `sim-` pools.
2. **Do you want all-time totals, or NFL-2026-season-scoped totals?** "Start
   keeping track for the NFL season" reads like the latter, which is option C
   and a bigger change. Recommendation: ship the exclusion fix now so the public
   numbers stop being wrong, then decide on season scoping separately.
3. **Should `stats/global` stay world-readable?** It currently is. If these
   figures are meant to be marketing numbers that is fine; if not, the rule
   should tighten. Out of scope here, but worth a decision.

---

## 6. Explicitly out of scope

- Season-scoped stat buckets (option C) — pending Q2.
- Any change to how pots are calculated. `calculatePoolPot` is untouched; this
  plan only changes **which pools are counted**.
- The Stats tab UI beyond step 4's data model.

---

## 7. Review log

| Round | Reviewer | Findings |
|---|---|---|
| 1 | codex | *(pending — this plan is reviewed before implementation, per Rule 3)* |
