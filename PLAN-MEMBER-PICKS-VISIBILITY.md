# PLAN — member-visible picks, and the grid for Margin and Survivor

> **STATUS: DRAFT — BLOCKED ON KEVIN'S SIGN-OFF (§6).** No code has been written.
> This is an **AUTHORIZATION** change (`mmp-change-control` Rule 3), so the plan,
> an adversarial review log and a sweep pass all come before implementation.
>
> **Provenance:** Kevin, 2026-08-14, after verifying #430 in production —
> *"Now, make it visible for all users if pool is locked. Add same to Margin and
> Survivor."*

---

## 0. What Kevin asked for, and what that means precisely

Two sentences, two changes, and they are **not** the same kind of change.

| # | Ask | Class | Why |
|---|---|---|---|
| **A** | *"make it visible for all users if pool is locked"* | 🛑 **PLAN-GATED — authorization** | It reverses `PLAN-COMMISSIONER-BLIND-PICKS` **Q5** (*"Does anything change for ordinary members? **No.**"*) and widens `assertPickReader`. Owes a **functions deploy into a LIVE scorer**. |
| **B** | *"Add same to Margin and Survivor"* | Ordinary (frontend) *for a commissioner* | The grid is a rendering of data `getPoolPicks` already returns for those pool types. It becomes member-facing only through A, which is why both live in one plan. |

### 🛑 The single most important line in this document

**"If pool is locked" is a statement about WHO, not about WHEN — and the WHEN
already exists and must not be touched.**

`weekRevealFor` (`functions/src/lib/pickReveal.ts`) already computes, per pool
type, exactly which of a week's picks are past their own lock. A commissioner
sees a pick the instant it is locked and not before. **Admitting participants to
that same computation *is* "visible when locked"** — with no new timing rule, no
new client-side gate, and no second definition of "locked" in the system.

So the implementation of A is, in essence, **one branch in one function**. Every
other line in this plan is about the things that ride along with it.

⚠️ **Do NOT reach for `assertPoolOwnerOrSuperAdmin`, and do NOT add a
`pool.isLocked` check.** The first admits `createdByUid` and `coManagers` (the
trap `assertPickReader`'s own header warns about). The second is a *pool*-level
flag that has nothing to do with an individual game's kickoff, and reading it
would create the second reveal rule this plan exists to avoid.

---

## 1. What is true today — measured, not remembered

| Fact | Evidence |
|---|---|
| `getPoolPicks` throws `permission-denied` for anyone who is not `ownerId`, `managerUid` or SUPER_ADMIN | `functions/src/nflPickReveal.ts:106-108` |
| The reveal boundary is per GAME for `PER_GAME` pick'em, and whole-WEEK for Survivor, Margin and any `confidenceMode`/`WEEKLY` pick'em | `lib/pickReveal.ts` — `revealMode`, `weekRevealFor` |
| SUPER_ADMIN gets everything, always | `fullReveal`, and Kevin's ruling in the prior plan |
| **A participant can ALREADY read raw entries — but only once the pool reaches `FINAL` or `COMPLETED`** | `firestore.rules:441-447` |
| Members currently see `Hidden` / `No selection` / `—` in the standings pick cell, and a count they cannot see at all | `NFLStandings.tsx:255-264` |
| The commissioner grid ships and is live in prod | #430, verified by Kevin 2026-08-14 |

**Row 4 is the one that reframes the ask.** Member visibility is not a new
capability — it already exists, at the *end of the pool*. Kevin is asking to move
it **earlier**, to each game's own lock. That is a narrowing of a delay, not the
opening of a new door, and it makes A a smaller change than it first reads.

⚠️ It also means the rules block and the callable will disagree about *when* a
member may see a pick unless one of them moves. See **D4**.

---

## 2. Goal

1. Every **proven participant** of an NFL pool can see other members' picks for
   the games that are past their own lock — the same boundary the commissioner
   has had since #414, on the same code path.
2. The Current Picks grid exists for **Margin and Survivor**, in the shape those
   pool types actually store picks in.
3. **Nothing about the reveal TIMING changes for anyone**, including the
   commissioner, and no client re-derives it.

---

## 3. Key decisions and tradeoffs

### D1 — 🛑 `counts` PRE-LOCK IS THE REAL LEAK, AND IT IS NOT WHAT KEVIN ASKED FOR

This is the sharpest decision in the plan and the one most likely to be waved
through, because it is not in the sentence Kevin wrote.

`getPoolPicks` returns **`counts`** — per member, how many of this week's games
they have saved a pick for — **at any time, with no reveal gate at all**
(`nflPickReveal.ts:202`). It carries no pick content, which is why it was safe to
give a commissioner. The **previous plan deliberately refused to give it to
members**, and said why (`PLAN-COMMISSIONER-BLIND-PICKS` D1):

> `members/{uid}` is readable by **every participant**, so a per-week count there
> would tell the whole pool how far through their sheet each player is, and
> whether they are still changing it — strictly more than Kevin asked to reveal.

If participants are admitted to the callable **unchanged**, they get that count
pre-lock. Concretely, before kickoff, every member could watch *"Kevin 14 of 16"*
tick to *"15 of 16"* and know he is still working. Nobody asked for that, and it
is the kind of thing that is obvious only after it ships.

**Recommendation: withhold `counts` from participants until the week's reveal.**
A member sees `?` in the Set column pre-reveal — which is exactly what #430's grid
already renders for an unknown count, so no new UI is needed. The commissioner
keeps the live count, because chasing missing picks is their job.

**Cost:** a member cannot see who is behind on picks. That is a feature the
commissioner has and members do not, which is the existing shape of the product.

### D2 — The grid shape for Margin and Survivor is players × WEEKS, not × games

Pick'em stores picks keyed by `gameId`; **Survivor and Margin store one pick per
week, keyed by the week number** (`weekPickCount`, `lib/pickReveal.ts`). There is
no games-across axis to lay out — a Margin week has exactly one cell.

So the Margin/Survivor grid is **players down, WEEKS across**, one team
abbreviation per cell — which is also the more useful view for those formats,
because Survivor's whole strategy is which teams you have burned.

🛑 **A weekly-pool cell renders ONLY from the response for ITS OWN week.** The
pick key is the week number, and `weekRevealed` — not `revealedGameIds` — is what
admits it (`nflPickReveal.ts:145-150`). A grid that reads one selected week's
`weekRevealed` while drawing every column will render `row.picks["2"]` in the
week-2 column on a week where only week 1 has revealed. Concrete, reproducible,
and it is the reason T9 caches whole responses rather than allowlists.

⚠️ **This needs N callable round-trips, one per week, not one.** `getPoolPicks`
takes a single `week`. See **R2** — this is the main cost driver of B and the
reason B is not free.

### D3 — Grade the cells, but only where a grade exists

Pick'em cells are graded green/red by `gradePick`. Survivor has a
survived/eliminated outcome and Margin has a signed margin, and **neither is
derivable client-side from the game alone** the way a pick'em win is — Survivor
grading involves strikes, exemptions and `tieCountsAs`; Margin involves the -14
missed-pick penalty.

**Recommendation: render the pick, and do NOT invent a grade.** The scored
outcome already has a home in the Standings and Results tabs. A grid that colours
a Survivor cell green using a rule the scorer does not use is the exact defect
class `pickemResult.ts` exists to document.

### D4 — 🛑 Leave `firestore.rules` ALONE, and accept that it is now stricter than the callable

After A, a participant reaches pick content two ways with **different** timings:

| Path | When a participant sees another member's pick |
|---|---|
| `getPoolPicks` callable (after A) | past that game's / week's own lock |
| raw `entries` read (`firestore.rules:441-447`) | only at `FINAL` / `COMPLETED` |

The callable is strictly EARLIER, so the rules block grants nothing the callable
does not already. It is redundant, not contradictory — and **redundant-but-tighter
is the safe direction**.

**Recommendation: change no rules.** This keeps the change to `functions/` alone:
**a functions deploy, and no rules deploy.**

⚠️ An earlier draft also argued the predicate in D5 was safe *because the entries
rule already uses it*. That is circular and is deleted (review round 1, finding
6): the rule using a weak predicate is an argument about the rule. D4 now rests
only on the ordering above, which is independent of D5.

⚠️ **The tempting "cleanup" is to relax the rules block to match. Do not.** The
rules path serves the WHOLE entry document — every week, every field — and has no
way to express a per-game boundary. That is precisely why #414 built a callable
in the first place. Widening it would hand back the leak the callable exists to
prevent, while looking like tidying.

### D5 — Membership is proved by `isProvableMember`, and by nothing hand-rolled

**An earlier draft of this decision said to test `pool.participantIds` directly,
"never a Member Record". That was wrong twice over** (review round 1, finding 1):

1. `participantIds` **is client-writable by a pool manager** — it is absent from
   `protectedFieldsUnchanged()` (`firestore.rules:91-135`, which lists
   `participants` and not `participantIds`), and `allow update` admits
   `isPoolManager()` on an editable pool (`firestore.rules:300-310`). Verified
   directly, not taken from the reviewer.
2. It contradicts the repo's canonical predicate. `isProvableMember`
   (`shared/memberRecord.ts:166-187`) accepts **either** a canonical Member Record
   **or** the array, and its own header forbids re-deriving the rule in a caller:
   *"two doors with two copies is how one of them ends up wrong."*

**The new branch calls `isProvableMember` and adds no logic of its own.**

🛑 **THE RESIDUAL IS NOW K9, KEVIN'S CALL — an earlier draft dismissed it and
that dismissal is WITHDRAWN** (review round 2, finding 3).

A pool manager can client-write `participantIds` on a `DRAFT`/`OPEN` pool and
thereby grant an arbitrary account access to the revealed-pick feed. I argued
this was not an escalation because *"the manager could simply tell them"*. That
collapses two different things: a **one-time verbal disclosure** and a **durable,
self-service API capability** that keeps producing FUTURE reveals, on that
account's own polling schedule, long after the manager stops caring.

My other argument was circular. I cited `isProvableMember`'s comment as settling
it — but that comment was written about **roster and payment** surfaces, and a
comment cannot pre-authorise a read that did not exist when it was written.

⚠️ **Calling `isProvableMember` correctly needs data the callable does not read**
(round 2, finding 1). It takes `(pool, memberRecord, uid)`, and
`nflPickReveal.ts` loads only the pool and the entries. Passing `undefined` for
`memberRecord` **silently degrades it to a `participantIds`-only test** — i.e.
reproduces the hand-rolled check this decision exists to remove, while looking
fixed. T1 and T8 therefore share **one bulk `members` query**, read once. Cost is
O(roster) billed reads per call; see D6.

### D7 — 🛑 A DEPARTED MEMBER'S PICKS MUST NOT BE SERVED TO A CURRENT ONE

**The sharpest finding of review round 1, and nothing in the first draft came
near it.**

`getPoolPicks` builds every map by iterating the **entire `entries` collection**
(`nflPickReveal.ts:185-209`) with no filter against the current roster. But
removing a member deletes their Member Record and pulls them from
`participantIds` — **it does not delete their entry**
(`functions/src/lib/memberRecord.ts:186-190`).

Today this is invisible: the only readers are the commissioner and SUPER_ADMIN,
for whom seeing a departed player's entry is unremarkable. **Admitting
participants is exactly what converts it into one member's data being served to
another**, for someone the pool no longer lists.

It is also already a UI inconsistency: `buildMemberStandings` drops those players,
so the callable returns rows the grid does not render — and a players × weeks grid
would widen the gap.

**Recommendation: filter the response to uids the pool still recognises**, using
the same `isProvableMember` predicate as D5, and drop the rest before assembling
any map.

### D8 — Entry EXISTENCE is itself a disclosure, and it is the one to accept

Even with `counts` withheld (D1), the response's key set tells a member **which
uids have an entry document at all**. That is a much weaker fact than a count —
it is "this person is playing", not "this person is 14/16 done" — and the roster
is already readable by every participant (`firestore.rules:431-438`).

**Recommendation: accept it.** Suppressing it would mean returning a padded or
shuffled key set, which is more machinery than the fact is worth. Named so that
it is a decision rather than an oversight.

### D6 — Polling cadence must change, or this multiplies load by the roster

Today `NFLPoolDashboard` polls `getPoolPicks` **every 60 seconds**, and only a
commissioner does it. After A, **every member of every pool polls it**, and after
B a Margin/Survivor grid multiplies that by the number of weeks (D2).

A 30-person pool goes from 1 call/minute to 30, and a Survivor grid over an
18-week season could turn one open tab into 18 calls a minute.

**Recommendation:** poll only while the picks grid is the ACTIVE tab, back the
interval off to 5 minutes for members, and fetch the Margin/Survivor week columns
**once** rather than on the poll — a past week's reveal cannot change.

⚠️ **"Fetch once" is not a specification, and the state shape blocks it** (review
round 1, finding 8). The dashboard holds exactly ONE response,
`{poolId, data}`, and accepts it only when `data.week === selectedWeek` — the
single-slot guard **#430 added** to fix cross-pool staleness. A players × weeks
grid cannot consume N one-week responses through it.

So B requires generalising that guard to `{poolId, byWeek: Record<number, …>}`:
pool-scoped still, but week-keyed, with each week keeping **its own
`revealedGameIds`**. Merging the allowlists across weeks is precisely how one
week's reveal would open another's.

---

## 3a. Every field of `PoolPicksResponse`, audited for a participant

The first draft named `counts` and left the rest implied. A reviewer had to redo
the work to check, so the result lives here now (`nflPickReveal.ts:39-60`).

| Field | Pre-lock / partially revealed | Fully revealed | Verdict |
|---|---|---|---|
| `week` | caller supplied it | — | safe |
| `mode` | pool config; pool docs are already world-readable (`firestore.rules:61-63`) | — | safe |
| `revealedGameIds` | which games have crossed their lock — a clock fact, no selection | — | safe |
| `weekRevealed` | boolean timing metadata | — | safe |
| `weekGameIds` | the week's public slate | — | safe |
| **`counts`** | 🛑 **UNSAFE — returned regardless of reveal** (`:202`). The whole of D1. | identifies who made no pick / a partial one, which is the intended disclosure | **D1 / K1** |
| `picks` | empty pre-lock; per-game allowlisted on a partial pick'em week (`:145-150`) | intended | correctly guarded |
| `confidence` | follows the same allowlist; and `confidenceMode` forces `WEEK` mode, so it stays empty until the week lock (`lib/pickReveal.ts:68-72`) | intended | correctly guarded |
| `tiebreakers` | returned **only** if `weekRevealed` (`:218-220`) | intended | correctly guarded |
| *(the key set itself)* | reveals WHICH uids hold an entry | — | **D8 — accepted** |

**Conclusion: `counts` is the only field that crosses the boundary**, which is
what D1 already claimed — but the plan now shows its work instead of asserting it.

## 4. Risks

| # | Risk | Mitigation |
|---|---|---|
| **R1** | The change lands in `functions/`, which **deploys into a LIVE scorer** (`nflAutoScoreJob` `*/5`). | `nflPickReveal.ts` is read-only and is imported by nothing in the scoring path — to be **proved by a sweep**, not asserted. Deploy ritual per Rule 2. |
| **R2** | D2's per-week fetch turns one call into N. | D6. If N round-trips prove unacceptable, the alternative is a `weeks: number[]` parameter on the callable — a bigger change, named here so it is a decision and not a surprise. |
| **R3** | A member sees a pick the pool's own rules page implies is private. | `NFLPoolRules` / `CONTEXT.md` must be updated in the same PR. A product whose rules text contradicts its behaviour is the defect #429 and ADR-0004 both landed on. |
| **R4** | Widening the one door #414 built to close it. | The reveal computation is untouched; only the principal test changes. **Split oracle** — the REVEAL-BOUND fields (`picks`, `confidence`, `tiebreakers`, `revealedGameIds`, `weekRevealed`) must be identical for every principal on the same week; the PRINCIPAL-SPECIFIC field (`counts`) is asserted against its own spec. An earlier draft demanded "byte-identical" output, which flatly contradicted T2 and would have produced a test asserting the wrong thing (review round 1, finding 7). Plus: a NON-participant is still refused. |
| **R5** | Small pools de-anonymise. In a 2-person pool, seeing the other player's pick is total information. | Already true of the live consensus (Kevin's accepted consequence, Q4 2026-08-11). Named, not mitigated. |

---

## 5. Out of scope

- Bracket, playoff, squares and props pools — `getPoolPicks` refuses non-NFL types (D4 of the prior plan) and that stays.
- Any change to the reveal TIMING for any principal.
- Any change to SUPER_ADMIN's full reveal.
- The live consensus channel — settled by Q4, visible at all times.
- `proxyPick`'s own open ruling (`PLAN-AUTOPICK-LIMITS` D6).

---

## 6. 🛑 DECISIONS NEEDED FROM KEVIN — no code until these are answered

| # | Question | Recommendation |
|---|---|---|
| **K1** | **Do members get the pre-lock `counts` ("14 of 16 Picks Set") for other players?** See D1 — this is the one real leak in the naive change. | **No.** Members see `?` until the reveal; the commissioner keeps the live count. |
| **K2** | Should the Current Picks tab be **visible but empty** pre-lock for members (a grid of `?`), or **hidden entirely** until something is revealed? | **Visible.** A tab that appears and disappears is confusing, and `?` is honest. |
| **K3** | Margin/Survivor grid = players × **weeks** (D2). Confirm — the alternative is one week at a time, matching the Pick'em grid. | **Players × weeks.** It is the view that makes Survivor's used-teams legible. |
| **K4** | Do Survivor/Margin cells get a **result colour** (D3)? | **No colour.** The scorer's outcome lives in Standings/Results; a client-side guess would contradict it. |
| **K5** | Members poll at a **slower cadence** and only on the active tab (D6)? | **Yes.** 5 minutes for members, 60s for the commissioner, active tab only. |
| **K6** | Does a member who has **not submitted** for a week still see everyone else's revealed picks? | **Yes.** The lock has passed; there is nothing left to protect, and withholding it would punish a missed pick twice. |
| **K7** | Which weeks are columns in the Margin/Survivor grid? The callable accepts weeks up to **23** (`schemas/pickReveal.ts`), the dashboard renders 1–18, and a preseason pool has four. | **From the loaded SCHEDULE** (`poolSeasonWeeks`, which `NFLResults` already uses for exactly this), never a hardcoded count. Postseason weeks appear if and only if the pool's slate has them. |
| **K9** | 🛑 **Is a manager adding a UID to `participantIds` sufficient authority to read the pool's revealed picks?** The array is client-writable by a manager (absent from `protectedFieldsUnchanged()`), so after A that account gains a **durable, self-service** feed of every future reveal — not a one-time disclosure. Options: (a) accept it, membership is the manager's to grant; (b) require a CANONICAL Member Record (`joinedAt`, server-stamped) and ignore the array for this read; (c) protect `participantIds` in `firestore.rules`, which is a rules change and pulls D4 open. | **(b).** It costs nothing extra — T1 already reads the Member Records for D5 — and it is the only option that closes the hole without a rules deploy. It does mean a legitimately-added participant sees nothing until a server join path stamps their record. **This is the most consequential open question in the plan.** |
| **K8** | **A departed member's picks — hide or keep?** (D7) Their entry document survives removal, so today the callable would serve it to every remaining member. | **Hide.** Filter to uids the pool still recognises. It also makes the callable agree with `buildMemberStandings`, which already drops them. |

---

## 7. Implementation tickets — NOT STARTED, gated on §6

| T | What | Files | Evidence required |
|---|---|---|---|
| **T1** | `assertPickReader` gains a participant branch, tested against `participantIds` (D5). Returns a principal kind, not a boolean, so T2 can vary the response. | `functions/src/nflPickReveal.ts` | emulator: participant allowed; **non-participant still refused**; owner/manager/SUPER_ADMIN unchanged |
| **T2** | Withhold `counts` from participants until `weekRevealed` (D1/K1). | `functions/src/nflPickReveal.ts` | unit: same week, participant vs commissioner — picks identical, counts differ exactly as specified |
| **T3** | Frontend tab gate. The current gate is `pool.type === 'NFL_PICKEM' && isManager`, and an earlier draft said "drop `isManager`, keep the pool-type gate" — which removes the wrong half and leaves Margin and Survivor with no tab at all, contradicting T4 (review round 1, finding 4). **The gate becomes: offered on all three NFL types, to any provable member**; the pool type selects which COMPONENT renders. | `NFLPoolDashboard.tsx` | invariant test updated — `tests/nfl-surface-invariants.test.ts` currently ASSERTS `NFL_PICKEM && isManager`, so it must change deliberately, not incidentally |
| **T4** | The Margin/Survivor grid: players × weeks (D2/K3), no grade (D3/K4). | new component + `utils/picksGrid.ts` | unit tests on the cell rule, same shape as `picksGrid.test.ts` |
| **T5** | Polling cadence (D6/K5). | `NFLPoolDashboard.tsx` | — |
| **T6** | `NFLPoolRules` copy + `CONTEXT.md` + an ADR note (R3). | docs | `docs-state-invariants` still green |
| **T7** | **Sweep**: prove `nflPickReveal.ts` is not imported by any scoring path (R1), and enumerate every surface that renders another member's pick. | `PLAN-MEMBER-PICKS-VISIBILITY-SWEEPS.md` | deterministic greps, complete lists |
| **T8** | Filter the response to uids the pool still recognises (D7/K8), from the SAME bulk `members` read as T1. 🛑 **Scoped to the PARTICIPANT principal only** — owner, manager and SUPER_ADMIN keep today's unfiltered response, or this silently narrows a privileged API and contradicts `fullReveal` and the plan's own "SUPER_ADMIN gets everything, always" (round 2, finding 2). | `functions/src/nflPickReveal.ts` | emulator: a removed member's entry is absent from `picks`, `counts`, `confidence` AND `tiebreakers` **for a participant**, and still PRESENT for the commissioner and SUPER_ADMIN |
| **T9** | Week-keyed reveal cache: `{poolId, data}` → `{poolId, byWeek}`. 🛑 Each column carries its **own whole cached response**, not just its `revealedGameIds` — for Survivor and Margin the pick key is the WEEK NUMBER and `weekRevealed` is what authorises it, so a shared `weekRevealed` across columns leaks an unrevealed week (round 2, finding 4). | `NFLPoolDashboard.tsx` | the #430 cross-pool staleness invariants still pass, PLUS a new case: **week 1 revealed and week 2 open — the week-2 column must render `?`** |

---

## 8. What this plan does NOT do

- It does not change when anybody sees anything.
- It does not touch `firestore.rules` (D4).
- It does not touch the scoring engine, and T7 must prove that rather than assert it.
- It does not give members the commissioner's completeness view (D1), unless K1 says otherwise.
