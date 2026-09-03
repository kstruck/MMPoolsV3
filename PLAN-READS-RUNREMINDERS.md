# PLAN — the 1.4M/day Firestore reads: cause, fix, verification

Written 2026-07-23. Supersedes the premise of `docs/archive/MORNING-2026-07-23.md` §4.

## 0. Classification (mmp-change-control §1)

**Not plan-gated by the letter of the rule** — this touches neither money,
authorization, production data, nor scoring. It is a read-volume optimization
inside the reminder job.

It is written up anyway because it is *near* a trigger: the value being
optimized (`week`) selects which slate members get reminded about, and a wrong
`week` means a missed lock. So the fix is constrained to be **semantically
identical**, and §4 states how that is proven rather than asserted.

## 1. What the docs claimed, and why it was wrong

`docs/archive/MORNING-2026-07-23.md` §4 said the ~1.4M/day driver was "provably dead" after
the bracket-sync fix (#239), and that anything above ~200K/day would be a
*second* cause.

Kevin's 2026-07-23 screenshots show no drop at all: a step from ~0 to ~1.2M/day
on **Jul 2**, then a flat plateau at **~1.4–1.5M/day through Jul 23**, 28M total
over 30 days. Jul 22 and Jul 23 sit on the same plateau as Jul 9.

So the premise was false. The driver was never dead. What follows is measured,
not reasoned from code.

## 2. Two wrong hypotheses, both killed by evidence

Recorded because the *shape* of the graph pointed at both, and reading code
made each look certain. Neither survived one log query.

**H1 — `syncGameStatus` (every 1 minute).** Its first query is
`pools where scores.gameStatus != "post"`, unbounded. Reads are paid before the
in-loop `continue` optimizations, so it looked like a whole-collection scan
every 60s.

Killed: Cloud Logging, last hour, 60/60 runs logged
`[Sync] No active or recently completed pools found. Skipping score sync cycle.`
It reads **zero** pools.

**H2 — `autoLockPools` (every 1 minute).** Same shape.

Killed: 60/60 runs logged
`[AutoLock] Found 0 SQUARES pools, 0 BRACKET pools ready to lock`.

The lesson is PICKUP §1's, in the other direction: code-reading produces
confident, wrong causes. **Firestore Query Insights answered in one query what
two rounds of code-reading got backwards.**

## 3. The actual cause — measured

Firestore → Query Insights, 6-hour window, top queries by load:

| Query | Executions / 6h | Docs scanned each | Reads / 6h |
|---|---|---|---|
| `nfl_games WHERE (season = ? AND startTime > ?)` | 780 | 305 | **237,900** |
| `pools` (no filter) | 52 | 138 | 7,176 |

Both are [`runReminders`](functions/src/reminders.ts:115), scheduled
**`every 5 minutes`** (288 runs/day).

- [`reminders.ts:120`](functions/src/reminders.ts:120) —
  `db.collection("pools").get()`, unfiltered. 138 pools/run.
  → 138 × 288 ≈ **39.7K reads/day**.
- [`reminders.ts:725`](functions/src/reminders.ts:725) — inside
  `checkNFLNonPickerReminders`, i.e. **once per NFL season pool**:

  ```ts
  const futureSnap = await db.collection('nfl_games')
      .where('season', '==', pool.season)
      .where('startTime', '>', now)
      .get();
  ```

  It pulls the entire remaining season — 305 documents — to compute one integer:
  `week = min(week of future games of this seasonType)`.

The arithmetic closes: 780 executions ÷ 72 runs per 6h ≈ **10.8 NFL pools per
run**. 305 docs × 11 pools × 288 runs ≈ **966K reads/day**, plus the following
`weekSnap` (~16 docs, same loop) and the `/pools` scan. Against a graph reading
~1.4M/day, with Query Insights showing only the top 10 of 15 queries.

**The comment above that query calls it "the cheap bail-out path". It is the
single most expensive thing the application does.**

Why the Jul 2 step: that is when the season schedule was ingested and NFL pools
existed to iterate. Before it, `futureSnap` matched nothing. Nothing about the
query changed on Jul 2 — its *input* did. `git log` on
`functions/src/scoreUpdates.ts` and `autoLock.ts` across Jun 25–Jul 6 confirms
no query-shape change in that window.

## 4. The fix

**The result of both queries depends only on `(pool.season, seasonType)` and
`now` — never on the pool.** Every NFL pool in a run recomputes an identical
answer. Roughly 11 identical 305-document scans per run, 288 times a day.

**This PR: memoize per run.** Compute `{ week, weekGames }` once per distinct
`(season, seasonType)` and reuse it for every pool sharing that key.

- Semantically identical by construction — same queries, same `min(week)`, same
  inputs, fewer executions. No index, no schema, no delivery-path change.
- 11 executions/run → 1 (all live pools currently share one season/seasonType).
- **~966K → ~88K reads/day on the dominant query**, ~91%.

Projected: this removes **~920K reads/day** (futureSnap 966K→88K, weekSnap
50K→5K), landing the total around **475–575K/day**, down from ~1.4–1.5M.

⚠️ **An earlier draft of this section said "~133K/day". That was wrong.** It
summed only the contributors listed in §3, but Query Insights shows the **top 10
of 15** queries — so roughly **340–440K/day of the baseline is unattributed**,
and memoization does not touch it. Caught by codex review.

**The success signal is the size of the DROP (~920K), not an absolute total.**
Stating a 133K target would have made a completely successful deploy read as a
failure. The clean per-query signal is in §5 step 5.

### Deliberately NOT in this PR

- **Bounding `futureSnap` with a `(season, seasonType, startTime)` composite
  index + `orderBy(startTime).limit(1)`.** Takes the query from 305 reads to 1
  and would land the total near ~10K/day. Held back for two reasons: it needs an
  index deployed and *fully built* before the code ships — the exact
  FAILED_PRECONDITION trap that silently killed `nflFinalizeSweepJob` for ten
  days (PICKUP §1) — and `limit(1)` is **earliest-kickoff**, which is not
  identical to `min(week)` when a game is postponed and rescheduled after a
  later week's games. That is a real NFL occurrence and a real semantic change,
  so it gets its own PR and its own argument. ponytail: memoization alone is
  ~91% of the win at zero semantic risk.
- **The unfiltered `pools` scan** (~40K/day) — the largest remaining item after
  this PR. It is load-bearing: reminders must consider every pool. Narrowing it
  means a status filter that would silently skip pools missing `status`.
- **The `every 5 minutes` cadence.** The reminder tiers are T-36h and T-4h —
  hour-granularity windows polled every five minutes. Dropping to every 15
  minutes would cut everything above by 3× for free. **This changes delivery
  timing, so it is Kevin's call, not mine.**

## 5. How the fix is proven, not asserted

Per PICKUP §1 — a guard that looks like it guards and does not is the failure
mode this repo keeps hitting.

1. Unit test: two NFL pools sharing `(season, seasonType)` produce **one**
   `futureSnap` query, not two — asserted against a counting mock, on the count.
2. Unit test: two pools with **different** seasons produce **two** queries.
   Without this, a memo keyed on nothing passes test 1.
3. Unit test: the computed `week` and the reminder decisions are unchanged
   against the existing fixtures.
4. **Verify the guards bite** — reintroduce the per-pool query, confirm tests 1
   and 2 fail. Recorded in the PR body.
5. Post-deploy, by measurement not belief: Query Insights executions for
   `nfl_games WHERE (season = ? AND startTime > ?)` should fall from ~130/hour
   to ~12/hour, and the reads graph should drop within a day.

## 6. Review log

| Round | Reviewer | Findings |
|---|---|---|
| — | — | pending `codex exec review --base origin/main` |
