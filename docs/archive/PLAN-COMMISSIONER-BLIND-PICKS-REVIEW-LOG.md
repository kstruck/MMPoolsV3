# PLAN-COMMISSIONER-BLIND-PICKS — REVIEW LOG

Adversarial review of the plan itself, before any code exists. Reviewer:
`codex exec review --base origin/main` (OpenAI), per CLAUDE.md §2c. Findings are
quoted in substance and answered individually; a rejection would be recorded with
its reasoning, same as an acceptance.

**Rounds: 9. Findings: 10 — all valid, all absorbed. Round 9 clean.**

The pattern is the one this repo has measured before: **round 1 found defects in
the design, and every later round found defects in the fixes.** Seven of the ten
are holes that existed only because of a previous round's correction (R2.1, R2.2,
R4.2, R6.1, R7.1, R8.1, R8.2). The design is materially different from the first
draft, and every difference is a hole somebody found.

---

## Round 1 — three P1s against the first draft

### R1.1 — the callable would leak un-kicked-off games (P1) — **ACCEPTED**

> For `NFL_PICKEM` pools using `PER_GAME`, the recommended boundary is each
> kickoff, but the proposed callable is authorized only by a requested week …
> a week-level response would reintroduce the exact pre-lock leak this plan is
> intended to close.

**Verdict: valid, and it holed the plan's central mechanism.** An entry document
holds the whole sheet; authorizing at week granularity hands back the un-kicked
games the moment the first one locks.

**Absorbed** in D2: the response is assembled by **allowlist of revealed game
ids**, and a mixed-locked-week negative test is a required acceptance criterion
for T2.

### R1.2 — "close the proxy gap" would corrupt dues (P1) — **ACCEPTED**

> the current proxy code deliberately must not create a Member Record because
> its create path seeds `paidStatus: 'UNPAID'` and can overwrite the roster's
> payment truth for legacy paid members.

**Verdict: valid, and verified in the code before acting on it** —
`poolExceptions.ts:462-474` carries the reasoning inline, from codex r3 on the PR
that added the guard: `buildPoolRoster` PREFERS a Member Record over entry
evidence, so minting an UNPAID one for a legacy paid member marks them unpaid and
adds their fee back to outstanding dues.

The first draft said "the implementation must close this", which would have led
straight into that. **Absorbed** in D1: the guard stands, T1 picks between
accept-and-pin and the membership backfill, and *turning the guard into a create*
is explicitly forbidden.

### R1.3 — the consensus channel is not optional (P1) — **ACCEPTED**

> it contradicts the canonical `CONTEXT.md` definition that Pool Consensus is
> revealed only after the game's effective lock. Make T5 part of the required
> implementation rather than a sign-off option.

**Verdict: valid.** `CONTEXT.md` §Pool Consensus already defines it as *"revealed
per game only after that game's effective lock … so a member cannot read other
members' picks before a game locks"*, and `CONTEXT.md` is canonical per
CLAUDE.md §1. Today only the UI enforces that (`PickDistribution.tsx:31-34`);
the rules do not. So this is code contradicting the glossary, not a product
choice.

**Absorbed:** Q4 is rewritten as a correction rather than a question, T5 is
REQUIRED, and the plan records that closing it does **not** disturb the
2026-07-09 "fully-open live consensus" decision — that decision is about
recompute cadence (`nflPools.ts:720`), not about who may read the document.

---

## Round 2 — two findings against round 1's fixes

### R2.1 — the consensus fix cannot be a rules edit (P1) — **ACCEPTED**

> `PickDistribution` subscribes to the entire collection, and Firestore queries
> must be authorized for every potential result rather than filtering out
> pre-lock documents … the collection query is still denied because it could
> return the unrevealed game.

**Verdict: valid, and it is Firestore semantics rather than a judgement call** —
a collection query must be provably authorized for every document it could
return, so a per-game lock condition denies the whole subscription for a mixed
week. The card would go blank precisely when the first game locks.

**Absorbed** as a new decision **D6**, with two shapes and the requirement that
T5 pick one before any code: a server-written revealed projection
(recommended), or a coarse per-week gate with its weaker guarantee stated. T5's
gate now names the mixed-lock collection query as a required test.

### R2.2 — T1's acceptance test contradicted D1 (P2) — **ACCEPTED**

> the required acceptance test says proxy-picking a member with no record must
> write a marker, but D1 explicitly prohibits `proxyPick` from creating that
> Member Record.

**Verdict: valid** — the ticket still carried the pre-R1.2 acceptance criterion,
so T1 could not be satisfied without violating D1. **Absorbed:** the criterion is
now the accepted-gap behaviour, pinned as a test (no marker, **no record
created, no payment field touched**) rather than left as an untested gap.

---

## Round 3 — one finding against the marker's shape

### R3.1 — a boolean marker breaks Pick'em reminders (P2) — **ACCEPTED**

> the existing roster marks a member picked only when every game in the selected
> week has a saved pick … a partial save would now suppress reminders and
> decrement `unpickedCount` even though games remain unpicked.

**Verdict: valid.** `submitNFLPicks` accepts a partial picks map and the roster
uses `weeklyGames.every(...)` (`NFLManagerView.tsx:225-228`), so a week-level
boolean would flip true on the first partial save and silently stop reminding a
member who had picked three of sixteen games.

**Absorbed** in D1: the marker is `pickCountByWeek: Record<number, number>` — a
count, still no pick content — with the two readings tabulated ("Hidden" at
count > 0; roster-complete at count === the week's game count for Pick'em,
count > 0 for the one-pick types). The submit path has already fetched the
week's games, so the count is free to compute there.

---

## Round 4 — two findings against rounds 2–3

### R4.1 — the reveal table conflated viewers (P1) — **ACCEPTED**

> For an ordinary participant after a game/week reaches the reveal boundary but
> before the pool is `FINAL`, this table requires displaying the actual pick,
> while the following paragraph and Q5 explicitly say the member cannot call
> `getPoolPicks`.

**Verdict: valid, and dangerous in a plan about authorization** — §4's table read
as one boundary for everyone, which an implementer could satisfy by broadening
member access. **Absorbed:** §4 now has a viewer column. The commissioner's
boundary is the week's effective lock; the member's stays `FINAL`/`COMPLETED`
exactly as `firestore.rules:401-407` has it; `getPoolPicks` refuses participants
by design.

### R4.2 — ordinary proxy picks would show "No selection" (P2) — **ACCEPTED**

> the current `proxyPick` path only updates existing Member Records with
> `hasPlayableEntry`; it cannot write the proposed `pickCountByWeek` … Keep the
> no-create safeguard for legacy records, but include an existing-record marker
> update in the proxy path.

**Verdict: valid** — R1.2's fix over-corrected. Excluding `poolExceptions.ts`
from T1 protected the create branch but also skipped the **update** branch, which
is the normal case and is perfectly safe to extend. **Absorbed:** T1 now includes
the proxy path's existing-record update and states that only the *create* branch
stays untouched.

---

## Round 5 — clean (plan + sweeps)

> The patch adds draft planning and sweep documentation only; it makes no
> executable code, configuration, or authorization changes.

No findings.

---

## Round 6 — one finding, after this log was added to the diff

### R6.1 — the manager's OWN entry would disappear (P1) — **ACCEPTED**

> `NFLPoolDashboard` derives `myEntry` from that array and passes it to all three
> pick-entry forms. The proposed sources omit `subscribeToMyNFLEntry` … a
> manager's existing pre-lock selections will appear empty and cannot be safely
> reviewed or edited.

**Verdict: valid, and the most likely way to ship a visible regression from this
plan.** A commissioner is usually also a player. `myEntry` is found by searching
the raw `entries` array (`NFLPoolDashboard.tsx:174-177`), so removing the
manager's raw read without adding the own-entry subscription empties their own
pick forms — while `getPoolPicks` correctly refuses to hand the picks back before
the boundary.

**Absorbed** in D2 and T4: the manager branch gains `subscribeToMyNFLEntry`,
merged the way the member branch already does it (`:137-141`).

---

## Round 7 — one finding against D6's option B

### R7.1 — the "coarse per-week gate" cannot be expressed at all (P1) — **ACCEPTED**

> `pools/{poolId}/consensus/{gameId}` is a single collection spanning weeks, the
> documents carry no week/lock field … a pool-level gate opened by one week's
> first lock would also admit pre-kickoff aggregate documents for later games.

**Verdict: valid, and checked against the writer before acting** — `projDoc`
(`consensus.ts:33-40`) stores `gameId`, team abbreviations, tallies and
`updatedAt`, and nothing else. There is no `week` and no kickoff on the document,
so a rule cannot even scope one to a week.

**Absorbed:** option B is replaced with a shape that does work — per-document
reads authorized one at a time, using the fact that **the consensus document id
is the game id**, so the rule can `get()` the game and compare `startTime` to
`request.time`. Its real costs (N reads + N billed rules `get()`s, client-side
fan-out) are stated, and the dead pool-level variant is written down as a
rejected shape so the next reader does not re-propose it.

---

## Round 8 — two P1s, both against earlier rounds' fixes

### R8.1 — the count told every player too much (P1) — **ACCEPTED**

> `members/{uid}` is readable by every participant, so this exposes each Pick'em
> player's exact number of saved game picks before lock … more information than
> the stated `Hidden`/`No selection` UI and contradicts Q5.

**Verdict: valid.** R3.1's fix moved a per-week COUNT onto a document every
participant can read (`firestore.rules:431-438`), which tells the pool how far
through their sheet each player is and whether they are still editing it. Kevin
asked for one bit; that shipped several.

**Absorbed** in D1, which now splits the two readings by audience: `pickedWeeks`
(a week list, one bit per week) on the participant-readable Member Record for the
standings cell, and the completeness COUNT returned by the manager-authorized
callable, which may return counts at any time and picks only past the boundary.
R3.1's actual defect — a partial Pick'em save suppressing reminders — stays fixed,
because the count still exists where the roster reads it.

### R8.2 — `startTime` is not the lock (P1) — **ACCEPTED**

> the authoritative lock includes `lockBufferMinutes` and can be extended by
> `weekLockOverrides`. In a pool with an override later than kickoff, this rule
> would expose the consensus document after kickoff but before the effective
> lock.

**Verdict: valid**, and it kills the remaining no-new-writer option. The
effective lock is a computation over pool settings and overrides
(`lib/effectiveLock.ts`); reimplementing it in the rules language would put a
second copy of the lock semantics in the one place with no test harness.

**Absorbed:** D6 now carries a single option — the server-written revealed
projection — with both rejected shapes recorded and the reason they died. The
projection's writer is named: `consensusRefreshJob` (`consensus.ts:118-127`),
which already runs every 10 minutes over the active weeks.

---

## Round 9 — clean

> The patch adds draft planning and sweep documentation only; it makes no
> executable code, configuration, or authorization changes.

No findings.

---

## Self-review, after round 5

Read independently of the reviewer, per CLAUDE.md §2c:

- The plan changes **who may read**, and it is a plan only — **no code, no rules
  edit, no deploy** rides on this PR. The dangerous artifact (`getPoolPicks`) does
  not exist yet and gets its own adversarial round when it does (plan §7 risk 4).
- The five open questions are genuinely open: each changes what gets built, and
  none can be answered from the code. Q4 was demoted from a question to a
  correction once `CONTEXT.md` settled it.
- One thing the reviewer never raised and the plan states plainly: existing
  members carry no `pickCountByWeek`, so a member who picked before the field
  exists reads "No selection" until their next submit. A backfill would be a
  prod-data mutation under Rule 1 and is Kevin's call at sign-off (§8).

**Stopping here is on evidence, not on the counter:** a clean codex round, a
self-read that agrees, and qodo's verdict recorded on the PR.
