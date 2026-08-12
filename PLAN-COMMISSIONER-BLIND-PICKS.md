# PLAN — Commissioner-blind picks, and a "Hidden" marker in standings

**Status: ✅ SIGNED OFF 2026-08-11 (Kevin, on [#410](https://github.com/kstruck/MMPoolsV3/pull/410)) — IMPLEMENTED 2026-08-12.**
Plan-gated under `mmp-change-control` §1: this changes **who may read what**,
which is the *authorization* trigger. The gate is PLAN → adversarial review log →
sweeps → sign-off → implement, in that order, and all five steps are done.

**Evidence:** `PLAN-COMMISSIONER-BLIND-PICKS-SWEEPS.md` (S1–S8), measured
2026-08-11 against `origin/main` @ `d7f02d6`.

---

## 0. Kevin's rulings — the answers §5 was waiting for

Recorded verbatim from the PR, 2026-08-11. **Where a ruling contradicts the
recommendation this plan made, the ruling wins and the body below has been
corrected to match** — a plan carrying two live-looking answers is how the wrong
one gets built.

| # | Question | **Kevin's ruling** | Effect on this plan |
|---|---|---|---|
| **Q1** | PER_GAME pick'em: reveal per game, or hold the sheet to the last kickoff? | **Per game** | As recommended. `weekRevealFor` returns an allowlist of the game ids whose own lock has passed. |
| **Q2** | Does the commissioner keep the pre-lock "has picked / missing" roster marker? | **Yes** | As recommended. It is served by `getPoolPicks`' per-member COUNTS, which carry no pick content. |
| **Q3** | Bracket / playoff pools in scope? | **Out** | As recommended (D4). `getPoolPicks` refuses any non-NFL pool type. |
| **Q4** | Gate the live consensus channel to the reveal boundary? | ⚠️ **OVERRULED — "live consensus visible at all times, never hidden."** | **T5 IS DEAD.** The plan called T5 "REQUIRED"; it is now not to be built. `PickDistribution`'s `isGameLocked` gating is REMOVED, `pools/{id}/consensus` keeps its current rules, and **`CONTEXT.md` §Pool Consensus was corrected to match the ruling** — the glossary said post-lock reveal and is the thing that was wrong. `docs/adr/0004` carries a superseding note. |
| **Q5** | Anything change for ordinary members? | **No** | As recommended. `getPoolPicks` refuses participants outright. |
| **backfill** | Backfill `pickedWeeks` for entries that predate the field? | **Fix-forward, no backfill** | §8's open item is closed. `undefined` renders "—" (unknown), `[]` renders "No selection". The join path seeds `[]`, so the unknown state is confined to records written before 2026-08-12. Known cost, accepted: on such a record, weeks picked before its owner's next submit read "No selection" once that submit lands. |

**Why Q4 landing this way is coherent rather than a contradiction.** Consensus is
an AGGREGATE — it says what fraction of the pool took each side, never who. What
this plan protects is an INDIVIDUAL's pick, which an aggregate cannot express.
The one real cost is that a very small pool's split is close to identifying; that
is named, accepted, and Kevin's to reopen.

---

## 1. What Kevin asked for

> "Pool commissioners should not see picks until pool lock. Only superadmin
> should have the ability to see all picks at all times." — 2026-08-11

and, the same day:

> the standings pick cell for OTHER players should read **"Hidden"** when that
> player HAS submitted this week's pick, and **"No selection"** when they have
> not.

Two requirements that meet on the same screen. The second is the reason the
first cannot be done with a one-line rules edit: taking pick data away leaves the
cell with nothing to say, and "nothing" is itself information the pool wants
displayed accurately.

---

## 2. What happens today (measured, not remembered)

| Principal | Sees another member's picks pre-lock? | Door |
|---|---|---|
| SUPER_ADMIN | yes, always | `firestore.rules:399` |
| pool `ownerId` | **yes, always** | `firestore.rules:397` |
| pool `managerUid` | **yes, always** | `firestore.rules:398` |
| ordinary participant, NFL pool | no — only once the pool is `FINAL`/`COMPLETED` | `firestore.rules:401-407` |
| the member themselves | their own entry, always | `firestore.rules:396` |

The commissioner's client subscribes to the raw entries collection through
exactly one door — `NFLPoolDashboard.tsx:125`, inside `if (isManager)` (S3) — and
that array feeds the standings table, the Bento dashboard and the manager roster.
A member's client subscribes to `standings/current` plus their own entry instead.

Three facts from the sweeps decide the whole design:

1. **The commissioner's roster does not need pick content.** Every manager
   surface that reads `picks` outside the standings table reads it to compute one
   boolean — *has this member picked this week* (`NFLManagerView.tsx:225-228`,
   `utils/poolRoster.ts:293`). That boolean drives the reminder buttons and the
   `unpickedCount` badge (S2b).
2. **The proxy-pick flow never displays a pick.** It renders a `<select>` of
   member names and calls the `proxyPick` callable, which reads and writes picks
   server-side with admin credentials (S8). The planning note that proxy-pick
   *needs* pick visibility is wrong.
3. **`standings/current` only moves when a week is SCORED** (`nflPools.ts:1495`,
   S5). It cannot carry a live "Hidden" state. The **Member Record** already
   moves inside the submit transaction (`nflPools.ts:706`) and is **already**
   readable by every participant (`firestore.rules:431-438`).

---

## 3. Design decisions

### D1 — The marker lives on the Member Record, not the standings projection

Add `pickedWeeks: number[]` to `pools/{id}/members/{uid}` — the weeks this member
has saved **at least one** pick for. It says **that** a pick exists, never how
many and never which.

**Two readings are needed, and they do not belong in the same place.** Codex
round 3 holed a boolean-only design, and round 8 holed the count that replaced
it — the two findings together define the split:

| Reading | Who needs it | Where it lives | Why not the other place |
|---|---|---|---|
| *has this member picked at all this week* — drives the standings cell | every member (Kevin's "Hidden") | `pickedWeeks` on the Member Record | — |
| *has this member picked EVERY game this week* — drives the reminder buttons and `unpickedCount` | the commissioner only | returned by the `getPoolPicks` callable (D2), which may return **counts** to a manager at any time and **picks** only past the reveal boundary | `members/{uid}` is readable by **every participant** (`firestore.rules:431-438`), so a per-week count there would tell the whole pool how far through their sheet each player is, and whether they are still changing it — strictly more than Kevin asked to reveal, and more than Q5 promises |

Pick'em completeness genuinely is per game — the roster marks a member picked
only when `weeklyGames.every(g => !!picks[g.id])` (`NFLManagerView.tsx:225-228`)
and `submitNFLPicks` accepts a PARTIAL map — so a boolean alone would flip true
on the first partial save and silently stop reminding someone who had picked
three of sixteen games. That is why the count still exists; it just is not
readable by the other players.

Rejected alternatives:

- *Add it to `StandingsRow`.* The row is built by allowlist precisely so a new
  field is leak-safe by default (S4), but the doc it lands in is only rewritten
  at scoring time — so a member who picks on Tuesday would show "No selection"
  until Sunday night. Kevin named this catch; the code confirms it.
- *A new `standings/pickMarkers` document.* Works, but invents a collection, a
  rules block and a second writer for something the Member Record already carries
  in the same transaction as the pick.

**Cost of D1:** one field, written where `userName` and `hasPlayableEntry`
already are, in the transaction that writes the pick. The submit path has already
fetched the week's games (`nflPools.ts:399-405`), so the count is free to compute
there; the client compares it against the same `gamesForPoolWeek` set both
surfaces already use.

⚠️ **The proxy gap (S5), and why it must NOT be closed the obvious way.**
`poolExceptions.ts:474` only touches the Member Record
`if (existingMember && committedPick)`, so a commissioner proxy-picking for a
member who has no Member Record writes no marker, and that member reads
"No selection" for a pick that exists.

**Do not "fix" this by letting `proxyPick` create the record.** The guard is
deliberate and its reasoning is in the code above it (codex r3 on the PR that
added it): `planMembershipWrite`'s create branch seeds `paidStatus: 'UNPAID'`,
`proxyPick` has no payment context to seed it correctly, and `buildPoolRoster`
PREFERS a Member Record over entry evidence — so minting one for a legacy PAID
member silently marks them unpaid and adds their fee back to outstanding dues.
**Advancing a display latch must not be able to move money.**

T1 therefore picks ONE of:

- **(i) accept the gap**, and render the cell as "No selection" for the affected
  member until they submit for themselves or the membership backfill runs — the
  affected population is legacy members with an entry and no Member Record, i.e.
  pre-backfill pools only; or
- **(ii) close it through the existing membership backfill**, which does know the
  payment truth, and leave `proxyPick` exactly as it is.

Either way the outcome is written down and tested. What T1 may **not** do is
turn the guard into a create.

### D2 — Managers stop reading raw entries; pick content comes from ONE callable

Remove `ownerId` and `managerUid` from the `entries` read rule (rows 2 and 3 in
§2). `SUPER_ADMIN` and self-reads stay exactly as they are.

The manager UI then runs on the same **three** sources a member uses — the
standings projection, the Member Records, and **`subscribeToMyNFLEntry` for the
manager's own entry** — plus one new callable, `getPoolPicks(poolId, week)`,
which returns pick content only when the caller is:

⚠️ **The own-entry subscription is load-bearing, not a detail** (codex r6). Today
`NFLPoolDashboard` derives `myEntry` by searching the raw `entries` array
(`:174-177`), and that object is what the three pick-entry forms render and edit.
Remove the manager's raw read without adding `subscribeToMyNFLEntry` to that
branch and a commissioner who plays sees their own saved picks vanish — while
`getPoolPicks` correctly refuses to return them before the boundary. **A
commissioner is usually also a player; this is the most likely way to ship a
visible regression from this plan.**

- `SUPER_ADMIN` (any week, any time — Kevin's ruling), **or**
- the pool's owner/manager, **for the revealed part of the requested week only**
  — plus, at any time, the **per-member pick COUNTS** for that week, which carry
  no pick content and are what the roster's completeness column needs (D1).

⚠️ **"The revealed part", not "the week".** A PER_GAME pick'em week is revealed
game by game (D3), and an entry document holds the whole sheet — so a callable
authorized at week granularity would hand back the picks for games that have not
kicked off yet, the moment the first one locks. That is the leak this plan
exists to close, reintroduced through the door built to close it. The response
must therefore be assembled by **allowlist of revealed game ids**, the same
discipline `StandingsRow` uses (S4), and a mixed-locked-week negative test is a
required acceptance criterion for T2.

Why a callable rather than a cleverer rule: an entry document **bundles every
week's picks**, so no document-level rule can say "week 4 yes, week 5 no". That
is the same reason participants were moved to the projection in ADR 0005
Phase 2. The callable is one auditable door with a server-side clock; the rules
edit alone would be either too coarse or unenforceable.

### D3 — "Pool lock" means the WEEK's effective lock, per pool type

`weekLockDecision` / `resolveHardWeekLock` already compute a frozen per-week
deadline the engine and the submit path both honour, including the earliest-ever
freeze that stops a commissioner reopening a closed week by widening the buffer.

**Recommendation:** the reveal boundary is that same instant.

| Pool type | Reveal picks for week W when |
|---|---|
| `NFL_SURVIVOR`, `NFL_MARGIN` (hard weekly lock) | the week's frozen hard lock has passed |
| `NFL_PICKEM`, `lockMode: WEEKLY` (incl. confidence) | the week's weekly lock has passed |
| `NFL_PICKEM`, `lockMode: PER_GAME` | **Q1** — per game as each kicks off, or the whole sheet at the last kickoff |

Using the members' own lock instant means there is exactly one definition of
"locked" in the system, and the commissioner is never blind to something the
members can already see.

### D4 — Scope is the three NFL pool types

Bracket and playoff pools are single-lock and reveal everything post-lock by
design (S1 row 6, S2d). Pulling them in would change a shipped product decision
that nobody has complained about. **Q3** asks Kevin to confirm.

### D5 — Nothing changes server-side

Cloud Functions read entries with admin credentials, so the scorer, recap
builder, reminder targeting, sweeps and `proxyPick` are untouched by the rules
edit (S7). The only new server surface is the callable in D2, and its
authorization is the real security work in this plan.

### D6 — ❌ SUPERSEDED BY Q4. Kept as analysis, not as a decision.

> ⚠️ **Do not build any of this.** Kevin ruled 2026-08-11 that the live consensus
> is visible at all times, so there is nothing to gate and no revealed projection
> to write. The two rejected shapes below are still worth reading — they are the
> reason a lock-gated consensus is hard in Firestore at all — but Option A is
> **not** the plan of record any more.

### D6 (superseded) — Closing the consensus channel is a PROJECTION problem, not a rules one

Codex round 2 holed the obvious implementation of T5, and the objection is
Firestore semantics rather than an opinion: **a collection query must be provably
authorized for every document it could return.** `PickDistribution` subscribes to
the whole `pools/{id}/consensus` collection (`dbService.ts:465-472`), so a rule
of the form "allow read if THIS game is locked" denies the entire query for a
mixed week — one un-kicked-off game is enough — and the card goes blank exactly
when the first game locks and it should light up.

**Option A — a revealed projection.** A server-written document per
`(pool, week)` carrying counts **only** for games whose effective lock has
passed; members read that, and the raw `consensus/{gameId}` documents become
SUPER_ADMIN-only. It matches how members already get standings and is queryable
in one read. **Cost:** something must publish it when a game locks with no submit
to trigger a recompute — the natural home is `consensusRefreshJob`
(`consensus.ts:118-127`), which already runs every 10 minutes over the active
weeks and already owns this data.

**Option A is the only shape that survived review. Two others were tried and
rejected, and both are written down so the next reader does not re-propose
them:**

- ❌ *A pool-level gate opened by the week's first lock.*
  `pools/{id}/consensus/{gameId}` is one flat collection spanning **every week of
  the season**, and `projDoc` (`consensus.ts:33-40`) stores `gameId`, team
  abbreviations, tallies and `updatedAt` — **no `week`, no kickoff, no lock
  field**. A rule cannot scope a document to a week at all, so such a gate would
  immediately admit every later week's pre-kickoff aggregate (codex r7).
- ❌ *Per-document reads gated on the game's `startTime`.* Tempting, because the
  consensus document id **is** the game id, so a rule can `get()` the game it
  describes. But `startTime` is **not** the lock: the effective lock folds in
  `lockBufferMinutes` and the commissioner's `weekLockOverrides`
  (`lib/effectiveLock.ts`), and an override set later than kickoff would expose
  the aggregate between kickoff and the real deadline — reopening the very
  channel T5 closes (codex r8). Reimplementing the effective-lock rules in
  Firestore's rules language would put a second copy of the lock semantics in the
  one place nobody tests it.

Both rejections point the same way: **the boundary is a server-side computation,
so a server-written projection is the honest place for it.** Option A it is; T5
implements it, and the writer must be the surface that already owns the clock.

One consequence to size before building: the projection is per `(pool, week)`,
so the number of documents is pools × active weeks, refreshed on the existing
10-minute cadence. For `NFL_SURVIVOR` and `NFL_MARGIN` it flips wholesale at the
week's hard lock; only PER_GAME pick'em needs it to fill in game by game.

---

## 4. What the standings cell renders after this change

For a row that is **not** the viewer's own, for week W. **The reveal boundary is
not the same for every viewer, and the first draft of this table conflated them**
(codex r4) — an ordinary member's boundary is unchanged by this plan:

| Viewer | Sees the actual pick when | Otherwise sees |
|---|---|---|
| SUPER_ADMIN | always | — |
| pool owner / manager | week W is past **W's effective lock** (D3) | Hidden / No selection |
| ordinary participant | the pool is `FINAL`/`COMPLETED` — **unchanged**, `firestore.rules:401-407` | Hidden / No selection |
| the member themselves, own row | always — unchanged | — |

And in the "otherwise" case, for every viewer:

| Marker | Cell reads |
|---|---|
| `W` in `pickedWeeks` | **Hidden** |
| `W` absent from `pickedWeeks` | **No selection** |

So the cell's *copy* is shared by members and commissioners; the *boundary* at
which it turns into a real pick is not. A member never gains pick access from
this plan (**Q5**), and `getPoolPicks` refuses them by design — its authorization
is owner/manager/SUPER_ADMIN only, never "participant".

---

## 5. Open questions — ✅ ALL ANSWERED, see §0 for the rulings

⚠️ **The "Recommendation" column below is the plan's ORIGINAL proposal, kept for
the record. Q4's recommendation was OVERRULED.** §0 is authoritative.


| # | Question | Recommendation |
|---|---|---|
| **Q1** | For a PER_GAME pick'em pool, does a pick reveal to the commissioner **per game** at each kickoff, or is the whole sheet held until the last kickoff of the week? | **Per game.** It matches what the member's own lock does, and holding a sheet whose first games are already being played protects nothing. |
| **Q2** | Does the commissioner keep the pre-lock "has picked / missing" roster marker? | **Yes.** It is the whole point of the reminder buttons, and it is exactly what the "Hidden" cell tells every other member anyway. Removing it would break `unpickedCount` and the reminder targeting for no privacy gain. |
| **Q3** | Bracket / playoff pools — in or out? | **Out.** Single-lock pools with a deliberate post-lock reveal; no reported problem. |
| **Q4** | The live consensus channel (S6): `pools/{id}/consensus/{gameId}` is readable by the owner, manager and every participant with **no lock condition**, and it is recomputed on **every submit**. Gate reads to the reveal boundary? | **Not actually a question — T5 is REQUIRED, and this is a correction to the previous draft.** `CONTEXT.md` §Pool Consensus, the canonical glossary, already defines it as *"revealed per game only after that game's effective lock … so a member cannot read other members' picks before a game locks"*. The rules do not enforce that; only `PickDistribution.tsx:31-34` does, in the UI. So this is code contradicting the canonical definition, not a product choice to re-litigate. Closing it also does **not** touch the 2026-07-09 "fully-open live consensus" decision, which is about recompute CADENCE (refresh on every submit, `nflPools.ts:720`), not about who may read the document. Kevin can still overrule; the default is now "close it". |
| **Q5** | Does anything change for ordinary members? | **No.** They keep the current rule — raw entries only at `FINAL`/`COMPLETED` — and gain the Hidden/No-selection cell. |

---

## 6. Implementation tickets — ✅ SHIPPED 2026-08-12, except T5 which Q4 killed

| # | Ticket | Files | Gate |
|---|---|---|---|
| T1 | `pickedWeeks` on the Member Record: schema, submit-path write, **and the proxy path's EXISTING-record update** — `proxyPick` already updates a record it finds (`poolExceptions.ts:474`), and that update must carry the marker or every proxy-picked member reads "No selection". What stays untouched is the **create** branch (D1); the legacy no-record case is option (i), accept-and-pin, unless Kevin picks (ii) at sign-off | `lib/memberRecord.ts`, `nflPools.ts`, `poolExceptions.ts` (**update path only, never create**), `shared/` types | emulator tests: submit → marker; proxy-pick with an EXISTING record → marker; proxy-pick with NO record → **no marker, no Member Record created, no payment field touched** (the money-safety guard, pinned as behaviour rather than left as a gap nobody tests) |
| T2 | `getPoolPicks` callable + its authorization (SUPER_ADMIN any time; owner/manager only past the reveal boundary) | `functions/src/`, `index.ts` export | unit tests on the predicate; emulator test per pool type, before and after the boundary |
| T3 | `firestore.rules`: drop `ownerId` / `managerUid` from the `entries` read | `firestore.rules` | rules test: manager denied pre-lock, self and SUPER_ADMIN allowed |
| T4 | Client: manager path stops subscribing to raw entries **and gains `subscribeToMyNFLEntry`, merged the way the member branch already does it (`NFLPoolDashboard.tsx:137-141`)**; standings cell renders Hidden / No selection; roster boolean moves to the marker | `NFLPoolDashboard.tsx`, `NFLStandings.tsx`, `NFLManagerView.tsx`, `NFLUserBentoDashboard.tsx`, `utils/poolRoster.ts` | component/unit tests; the S2(a) list is the checklist |
| ~~T5~~ | ❌ **DEAD — Q4 was overruled.** The plan called this REQUIRED on the reasoning that the code contradicted `CONTEXT.md`. Kevin ruled the other way: the live consensus is never hidden, so it is the GLOSSARY that was wrong and it has been corrected. What shipped instead is the removal of `PickDistribution`'s `isGameLocked` gating, plus the `CONTEXT.md` and ADR-0004 corrections. **The server-written revealed projection (D6 Option A) was NOT built and must not be**; D6's analysis is kept below only so nobody re-derives it. | — | — |
| T6 | Docs: CONTEXT.md semantics, ADR-0002 for the reveal boundary, HANDOFF box | docs | `tests/docs-state-invariants.test.ts` |

**Deploy shape when it lands:** functions **and** rules (functions first — the
callable must exist before the rules that force traffic through it), plus a
Coolify rebuild. Ordering matters here for the same reason it did in #399: rules
first would lock the manager UI out of a door whose replacement is not deployed.

---

## 7. Risks

1. **A commissioner who is also a player.** Their own entry read is rule row 1
   and is untouched — but any code path that assumed "manager ⇒ has every entry"
   will now get one entry. T4's checklist is the S2(a) list precisely so none is
   missed.
2. **A pool mid-week at deploy time.** The rules edit takes effect instantly for
   every pool. A commissioner looking at the standings tab at that moment sees
   cells change under them. Harmless, but it should not be a surprise, and the
   deploy should not happen between a lock and a scoring pass.
3. **The marker is a new writer in the submit transaction.** It rides an existing
   `ensureMemberRecord` call rather than adding a write, so the transaction shape
   does not change — but the scoring-lease interaction (`retryWhileScoring`) must
   be re-read during T1 rather than assumed.
4. **`getPoolPicks` is a new door to pick data.** It is the one genuinely
   dangerous artifact in this plan. Its authorization needs its own adversarial
   review round, and its tests must include the negative cases (manager before
   the boundary, non-manager, non-member, wrong pool).

---

## 8. What this plan deliberately does NOT do

- It does not change what ordinary members see (Q5).
- It does not touch bracket or playoff pools (D4).
- It does not alter scoring, money or lock semantics — only who may read.
- It does not backfill `pickedWeeks` for existing entries. **Kevin's ruling at
  sign-off: fix-forward, no backfill** — one would itself be a prod-data mutation
  under Rule 1 (kill-switch + dry-run) for a display marker. What shipped instead
  is a three-state cell: a Member Record with NO `pickedWeeks` field renders "—"
  (unknown), not "No selection". The join path seeds `[]`, so the unknown state
  exists only on records written before 2026-08-12. **The residual, stated
  plainly:** once such a record's owner submits again, the field appears holding
  only that week, and the earlier weeks they really did pick then read
  "No selection". Accepted; the affected population is a handful of preseason
  pools days old.
