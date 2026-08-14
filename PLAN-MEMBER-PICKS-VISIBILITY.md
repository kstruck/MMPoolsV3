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

⚠️ **The tempting "cleanup" is to relax the rules block to match. Do not.** The
rules path serves the WHOLE entry document — every week, every field — and has no
way to express a per-game boundary. That is precisely why #414 built a callable
in the first place. Widening it would hand back the leak the callable exists to
prevent, while looking like tidying.

### D5 — Membership is proved by `participantIds`, never by a Member Record

A Member Record's existence proves nothing: the pre-#344 claim path was itself a
way to forge one, which is why `isProvableMember` tests `pool.participantIds`.
The new branch in `assertPickReader` must test `participantIds` — the same
authority the entries rule at `firestore.rules:441` already uses.

### D6 — Polling cadence must change, or this multiplies load by the roster

Today `NFLPoolDashboard` polls `getPoolPicks` **every 60 seconds**, and only a
commissioner does it. After A, **every member of every pool polls it**, and after
B a Margin/Survivor grid multiplies that by the number of weeks (D2).

A 30-person pool goes from 1 call/minute to 30, and a Survivor grid over an
18-week season could turn one open tab into 18 calls a minute.

**Recommendation:** poll only while the picks grid is the ACTIVE tab, back the
interval off to 5 minutes for members, and fetch the Margin/Survivor week columns
**once** rather than on the poll — a past week's reveal cannot change.

---

## 4. Risks

| # | Risk | Mitigation |
|---|---|---|
| **R1** | The change lands in `functions/`, which **deploys into a LIVE scorer** (`nflAutoScoreJob` `*/5`). | `nflPickReveal.ts` is read-only and is imported by nothing in the scoring path — to be **proved by a sweep**, not asserted. Deploy ritual per Rule 2. |
| **R2** | D2's per-week fetch turns one call into N. | D6. If N round-trips prove unacceptable, the alternative is a `weeks: number[]` parameter on the callable — a bigger change, named here so it is a decision and not a surprise. |
| **R3** | A member sees a pick the pool's own rules page implies is private. | `NFLPoolRules` / `CONTEXT.md` must be updated in the same PR. A product whose rules text contradicts its behaviour is the defect #429 and ADR-0004 both landed on. |
| **R4** | Widening the one door #414 built to close it. | The reveal computation is untouched; only the principal test changes. Pinned by tests asserting a participant gets **byte-identical** output to the commissioner for the same week, and that a NON-participant is still refused. |
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

---

## 7. Implementation tickets — NOT STARTED, gated on §6

| T | What | Files | Evidence required |
|---|---|---|---|
| **T1** | `assertPickReader` gains a participant branch, tested against `participantIds` (D5). Returns a principal kind, not a boolean, so T2 can vary the response. | `functions/src/nflPickReveal.ts` | emulator: participant allowed; **non-participant still refused**; owner/manager/SUPER_ADMIN unchanged |
| **T2** | Withhold `counts` from participants until `weekRevealed` (D1/K1). | `functions/src/nflPickReveal.ts` | unit: same week, participant vs commissioner — picks identical, counts differ exactly as specified |
| **T3** | Frontend: the Current Picks tab drops `isManager`, keeps the pool-type gate. | `NFLPoolDashboard.tsx` | invariant test updated — it currently ASSERTS the `isManager` gate, so it must change deliberately, not incidentally |
| **T4** | The Margin/Survivor grid: players × weeks (D2/K3), no grade (D3/K4). | new component + `utils/picksGrid.ts` | unit tests on the cell rule, same shape as `picksGrid.test.ts` |
| **T5** | Polling cadence (D6/K5). | `NFLPoolDashboard.tsx` | — |
| **T6** | `NFLPoolRules` copy + `CONTEXT.md` + an ADR note (R3). | docs | `docs-state-invariants` still green |
| **T7** | **Sweep**: prove `nflPickReveal.ts` is not imported by any scoring path (R1), and enumerate every surface that renders another member's pick. | `PLAN-MEMBER-PICKS-VISIBILITY-SWEEPS.md` | deterministic greps, complete lists |

---

## 8. What this plan does NOT do

- It does not change when anybody sees anything.
- It does not touch `firestore.rules` (D4).
- It does not touch the scoring engine, and T7 must prove that rather than assert it.
- It does not give members the commissioner's completeness view (D1), unless K1 says otherwise.
