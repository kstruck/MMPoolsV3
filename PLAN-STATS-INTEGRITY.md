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

### 2.4 THE OVERVIEW CARDS DO NOT READ `stats/global` AT ALL

This is the finding that reshaped the plan, and the first draft had it wrong.
Found by codex reviewing this document; verified in the source before accepting.

`SuperAdmin.tsx:1242` renders `<SuperAdminBentoDashboard stats={liveStats} />`.
`liveStats` (`SuperAdmin.tsx:335-370`) is a `useMemo` that aggregates **every
loaded pool, client-side, with no sim filter**:

- `totalPools: pools.length` — every pool, test pools included
- `totalUsers: users.length`
- `totalSquaresSold`, `totalRevenue`, `totalDonated` — summed per pool type

**So the numbers Kevin is looking at are computed in the browser, and fixing the
Cloud Functions writers would not have changed them by a single dollar.** The
first draft would have shipped a correct backend fix, had Kevin run the
recalculate, and left the Overview cards exactly as wrong as before.

`stats/global` is a *separate* surface — world-readable, also unfiltered, also
worth fixing — but it is not the symptom that was reported.

### 2.5 `calculatePoolPot` computes ZERO for NFL season pools

Also from codex, also verified. `statsTrigger.ts:17-33`:

- `BRACKET` and `NFL_PLAYOFFS` use `settings.entryFee` × paid entries
- **everything else** falls to the squares branch, `squaresSold × costPerSquare`

`NFL_PICKEM`, `NFL_SURVIVOR` and `NFL_MARGIN` have no `squares` array and no
`costPerSquare`; they carry dues in `settings.entryFee` with `entries`. They
therefore hit the squares branch and evaluate to **grossPot = 0**.

The server-side stats would record **nothing** for exactly the NFL pools this
season is about. The first draft said "`calculatePoolPot` is untouched; this
plan only changes which pools are counted" — wrong, and it would have produced a
confidently-reported zero.

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

**Step 1 — fix the Overview cards (PR, FRONTEND). This is the reported bug.**
Filter test pools out of `liveStats` in `SuperAdmin.tsx`. A shared predicate
rather than an inline check, because the same rule lands in three places —
`shared/` exists for exactly this, and `isSimPool`'s logic (`simRunId`, `sim-`
season, `sim-` id) should move there so client and server cannot drift.

`totalPools` and `totalUsers` need a decision, not just a filter: pool count
should clearly exclude test pools; user count probably should exclude sim-run
uids. See §5 Q4.

**Needs a Coolify rebuild to reach Kevin** — frontend changes do not deploy on
push.

**Step 2 — teach `calculatePoolPot` about NFL season pools (PR, functions).**
Route `NFL_PICKEM` / `NFL_SURVIVOR` / `NFL_MARGIN` to the entry-fee branch
instead of the squares fallback. Without this the server-side NFL numbers are
zero, so this MUST land before any recalculate — otherwise the recalculate
writes a confident zero over the live public document.

Tests: one per pool type asserting a non-zero pot from `settings.entryFee` ×
paid entries, plus a squares pool still using the squares path. Verified by
reverting the branch and watching them fail.

**Step 3 — exclude test pools server-side (PR, functions).**
Apply the shared predicate in BOTH `stats/global` writers — `onPoolLocked`'s
increment and `recalculateGlobalStats`'s recompute. Tests: a sim pool locking
must not increment; a real pool must; the recompute must exclude sim pools.

**Step 4 — Kevin runs Recalculate Global Stats** (SuperAdmin → Operations),
after steps 2 and 3 are deployed. Prod-data action, his. **Order matters** —
running it before step 2 overwrites the public doc with NFL volume of zero.

**Step 5 — platform revenue**, only if §5 Q1 says it is contaminated.

**Step 6 — the Stats tab filters (item 3).** Deliberately last: filtering by
sport and pool type requires the model to *carry* those dimensions, and today
`stats/global` is one flat document of four numbers while `liveStats` is a
single reduce over all pools. It should not start until steps 1-4 have made the
underlying numbers trustworthy — filtering wrong numbers faster is not
progress.

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
4. **Should `totalUsers` and `totalPools` exclude test data too?** Pool count
   almost certainly yes. User count is less obvious — sim runs create run-scoped
   uids (`sim-<runId>-alice`) so they are identifiable, but you may want the raw
   registered-user figure. Tell me which.

---

## 6. Explicitly out of scope

- Season-scoped stat buckets (option C) — pending Q2.
- ~~Any change to how pots are calculated.~~ **Reversed after review** — see
  §2.5. `calculatePoolPot` MUST learn NFL season pools (step 2), or the
  recalculate writes zero for them. The first draft had this exactly backwards.
- The Stats tab UI beyond step 4's data model.

---

## 7. Review log

| Round | Reviewer | Findings |
|---|---|---|
| 1 | codex | **3 findings, all valid, all accepted.** (a) The Overview cards read `liveStats` client-side, not `stats/global` — the original plan would not have fixed the reported symptom at all. (b) `calculatePoolPot` computes zero for NFL season pools, so the recalculate would have written zeros over live public figures. (c) Operator docs still claimed an empty deploy queue. Plan restructured from 4 steps to 6 and re-ordered so the recalculate runs last. |

**This is the plan gate earning its keep.** Two of those findings would
otherwise have shipped as working, tested, reviewed code that did not fix the
problem — one of them writing zeros over live public money figures. They were
caught by reviewing a document, before a line was written. The first draft was
confident and wrong in exactly the way §2.4 of the previous draft admitted it
might be ("metrics I could NOT trace"), which is the part I should have closed
before proposing steps rather than after.
