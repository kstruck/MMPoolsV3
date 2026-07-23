# PLAN — Stats integrity: exclude test pools, reset for the NFL season, add filters

**Status: DRAFT, awaiting Kevin's sign-off. NO CODE WRITTEN — deliberately.**
Written 2026-07-22 evening. Covers Kevin's queued items **2** and **3**.

> ## ⛔ Read this first: it is not a filter, and I did not build it
>
> This looked like "add `isSimPool` and recalculate". Two rounds of adversarial
> review found **five** independent reasons that would have produced wrong
> numbers — including writing zeros over a world-readable money document. Any
> ONE of them defeats the naive fix:
>
> 1. The Overview cards Kevin is looking at don't read the document I was
>    planning to fix (§2.4).
> 2. `calculatePoolPot` returns **zero** for NFL season pools (§2.5).
> 3. **Legacy test pools carry no marker at all**, so no filter can find them
>    (§2.6).
> 4. The recompute's selection rule never visits NFL season pools (§2.7).
> 5. NFL "paid" state lives somewhere other than where the pot maths reads it
>    (§2.8).
>
> **I stopped here on purpose.** Shipping any part of this overnight would have
> produced confident, tested, reviewed code that made the public numbers worse.
> §4 is a proposal that needs your decisions in §5 before it becomes work.

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

### 2.6 Legacy test pools have NO durable marker — a filter cannot find them

The most damaging finding, because it defeats the entire premise.

`isSimPool` recognises `simRunId`, a `sim-` season, or a `sim-` doc id. The NFL
sim harness sets those. **The older Squares, Props and Playoff test runners do
not** — they create pools through the normal creation path, so the server
assigns a random document id and no `simRunId` is written. `simLegacy.ts:11`
says as much about the tournament docs: "TEST INFRASTRUCTURE, not a Test Pool
(no simRunId anchor)".

The squares runner then **locks** its pool, which is exactly what puts it into
both `liveStats` and the `isLocked == true` recompute.

So: adding the filter would exclude the NFL sim pools and leave the legacy ones
counted. The inflation Kevin reported would partly remain, and it would look
fixed. **This needs a durable marker written by every simulator path, plus a
one-off remediation pass over existing untagged test pools** — and that
remediation is a production-data mutation, i.e. Kevin's, and needs its own
dry-run.

### 2.7 The recompute's selection rule never visits NFL season pools

`recalculateGlobalStats` queries `isLocked == true`. Verified:
`functions/src/nflPools.ts:100` creates NFL season pools with
**`isLocked: false`** — they use per-week kickoff locks, and finalization stamps
`finalizedAt` rather than flipping the pool-level flag.

So even with §2.5 fixed, the recompute would still never see an NFL pool. The
selection rule has to change too, and "which NFL pools count as having real
volume" is a lifecycle question, not a one-line predicate.

### 2.8 NFL payment truth is in member records, not entry docs

`setPaidStatus` updates `pools/{poolId}/members/{uid}.paidStatus`. NFL entry
documents keep the `UNPAID` value seeded at first pick submission and are never
updated by that path.

So reusing the existing entry-fee branch — `entryFee × paid entries` — computes
**zero for legitimately paid NFL pools**. The calculation has to read Member
Records, and account for fee and rebuy fields, or it produces a plausible,
confidently-wrong number.

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

> **Steps 0a and 0b are new after review round 2 and are PREREQUISITES.**
> Without them the later steps produce wrong numbers confidently.

**Step 0a — give every simulator path a durable marker (PR, functions).**
Write `simRunId` (or an equivalent explicit flag) from the Squares, Props and
Playoff test runners, so a test pool is identifiable by data rather than by id
convention. Without this, no filter anywhere can find them (§2.6).

**Step 0b — remediate existing untagged test pools (KEVIN, prod data).**
A dry-run listing candidate pools, reviewed by Kevin, then a tagging pass.
Kill-switch + dry-run-default per Rule 1. This is the only genuine data
mutation in the plan, and it exists solely because §2.6 means history cannot be
reconstructed from the pools themselves.

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
Route `NFL_PICKEM` / `NFL_SURVIVOR` / `NFL_MARGIN` to an entry-fee calculation —
but read paid state from **Member Records**
(`pools/{poolId}/members/{uid}.paidStatus`), NOT from entry documents, which
keep `UNPAID` forever (§2.8). Include the rebuy fields for Survivor.

**And change the recompute's selection rule** so NFL season pools are visited at
all: they are created `isLocked: false` and finalize by stamping `finalizedAt`
(§2.7). "Which NFL pools have real volume" is a lifecycle decision — see §5 Q5.

Tests: one per pool type asserting a non-zero pot from member-record paid state,
a squares pool still using the squares path, and an NFL pool that is unlocked
but finalized still being counted. Verified by reverting each and watching them
fail.

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
5. **Which NFL season pools count as real volume?** They never set
   `isLocked: true` at the pool level (§2.7), so the recompute needs a different
   rule — candidates: `finalizedAt` present, or `scoredThroughWeek >= 1`, or any
   member marked paid. This decides what "prize volume" means for the season and
   I do not want to pick it for you.
6. **How far back should the test-pool remediation go?** Step 0b tags existing
   untagged test pools. If you would rather draw a line and only count pools
   created from a given date forward, that is simpler and I can propose it
   instead — it also happens to match "start keeping track for the NFL season".

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

| 2 | codex | **3 further findings, all valid, all accepted.** (d) Legacy Squares/Props/Playoff test pools carry NO marker, so no filter can exclude them — verified against `simLegacy.ts:11`. (e) `recalculateGlobalStats` selects `isLocked == true`, but NFL pools are created `isLocked: false` — verified at `nflPools.ts:100` — so the recompute never visits them. (f) NFL paid state lives in Member Records, not entry docs, so `entryFee × paid entries` yields zero for paid pools. Added steps 0a/0b as prerequisites and questions Q5/Q6. |

**This is the plan gate earning its keep, twice over.** Across two rounds,
review found five independent reasons the "obvious" fix would have produced
wrong numbers — two of them writing zeros or near-zeros over a world-readable
money document. Every one was caught by reviewing a DOCUMENT, before a line of
code existed.

The honest summary: what looked like a one-line filter is a marker scheme, a
production remediation, a pot-calculation change, a selection-rule change and a
frontend fix — with three decisions that are Kevin's to make. That is why
nothing was built overnight.
