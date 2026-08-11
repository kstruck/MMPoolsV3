# PLAN-COMMISSIONER-BLIND-PICKS — SWEEPS

Deterministic enumeration feeding `PLAN-COMMISSIONER-BLIND-PICKS.md`. Run from
the repo root. Every sweep states its command, a **known instance it must find**
(the S2 lesson from `PLAN-SURVIVOR-EXEMPTION-RESERVATIONS-SWEEPS.md`: a sweep
that finds nothing is worthless until you have proved it can find something),
and the complete result as of **2026-08-11, `origin/main` @ `d7f02d6`**.

A sweep here answers exactly one question: **who can see another member's pick
content, and through which door.**

---

## S1 — the rules door: who may read a raw entry document

```bash
grep -n "match /entries" -A 30 firestore.rules
```

**Must find:** the `ownerId == request.auth.uid` clause. If it does not, the
grep is wrong, not the rules.

**Result — `firestore.rules:394-417`.** Read is allowed to, in order:

| # | Principal | Line | Pre-lock pick access today |
|---|---|---|---|
| 1 | the entry's own owner (`resource.data.ownerUid`) | 396 | own picks only — **keep** |
| 2 | `pools/{id}.ownerId` | 397 | **EVERY member's picks, always** — the subject of this plan |
| 3 | `pools/{id}.managerUid` | 398 | same as #2 — same treatment |
| 4 | `isSuperAdmin()` | 399 | everything, always — **keep** (Kevin's ruling) |
| 5 | a participant, **NFL types** | 401-407 | only once pool `status` is `FINAL`/`COMPLETED` |
| 6 | a participant, bracket/playoff | 408-414 | once `LOCKED`/`LIVE`/`FINAL`/`COMPLETED`/`isLocked` |

`allow write: if false` (line 422) — entries are server-written only, so nothing
in this plan can be defeated by a client write.

**Conclusion:** rows 2 and 3 are the whole client-side commissioner door. There
is no second rules path to an entry document.

---

## S2 — client surfaces that read ANOTHER member's pick content

```bash
grep -rn "entry\.picks\|e\.picks\|\.entry?\.picks\|entry\.confidence\|entry\.usedTeams" \
  src/components src/pages src/utils --include=*.tsx --include=*.ts | grep -v "\.test\."
```

**Must find:** `NFLStandings.tsx:235` — the pick cell Kevin was looking at.

**Result: 63 hits.** Classified by what the surface is actually reading:

### (a) NFL — reads ANOTHER member's pick content. In scope.

| File:line | What it renders | Fed by |
|---|---|---|
| `NFLStandings.tsx:203` | `"{n} Picks Set"` per row | `entries` prop |
| `NFLStandings.tsx:235` | the pick cell (survivor) | `entries` prop |
| `NFLStandings.tsx:246` | the pick cell (margin) | `entries` prop |
| `NFLUserBentoDashboard.tsx:342` | weeks-picked count, all rows | `entries` prop |
| `NFLUserBentoDashboard.tsx:439` | "has this member picked" check | `entries` prop |

Every one is fed the same `entries` array from `NFLPoolDashboard`, which is raw
entries for a manager and the standings projection for a member (S3).

### (b) NFL — reads pick EXISTENCE only, never content. In scope, but only needs a boolean.

| File:line | What it computes |
|---|---|
| `NFLManagerView.tsx:225-228` | `picked` per roster row (drives the reminder buttons and `unpickedCount`) |
| `utils/poolRoster.ts:293` | the same merge, shared with the Bento buy-in ledger |
| `utils/nflPending.ts:42,45` | `isWeekComplete` — used for the caller's OWN entry |

**This is the finding that makes the plan cheap:** the commissioner's roster
does not need pick content at all. It needs one boolean per member per week.

### (c) NFL — reads the VIEWER'S OWN entry. Out of scope, must keep working.

`PickemPickEntry.tsx:85,97,169,179,180,325`, `SurvivorPickEntry.tsx:64,65,82`,
`MarginPickEntry.tsx:49,50,60,61` — all operate on the signed-in member's own
entry (`myEntry`), which rule S1 #1 always allows.

### (d) Bracket / playoff pools. Out of scope — see plan Q3.

`BracketAwards.tsx` (5), `BracketComparison.tsx` (2),
`BracketPoolDashboard.tsx` (5), `bracketScoring.ts` (1), `BracketShareCard.tsx`
(3), `EliminationTracker.tsx` (2), `PoolAnalytics.tsx` (6), `ReportsTab.tsx` (3),
`utils/bracketScoring.ts` (3). Single-lock pools whose post-lock full reveal is
deliberate (S1 row 6).

### (e) SUPER_ADMIN and harness surfaces. Out of scope — unchanged by design.

`SuperAdmin.tsx:3512,3555` (the raw pick viewer),
`TournamentSimulator.tsx:219,225`, `utils/testing/*` (3 files).

---

## S3 — how the client gets entries at all

```bash
grep -rn "subscribeToNFLEntries" src --include=*.ts --include=*.tsx
```

**Must find:** the `isManager` branch in `NFLPoolDashboard`.

**Result — 2 hits, one door:**

- `services/dbService.ts:1614` — the subscription itself, commented
  *"MANAGER/OWNER/ADMIN VIEWS ONLY"*.
- `NFLPoolDashboard.tsx:125` — called **only** inside `if (isManager)`. The
  member branch below it uses `subscribeToNFLStandings` + `subscribeToMyNFLEntry`.

So one component decides, on one flag, whether the downstream surfaces in S2(a)
receive raw entries or the pick-free projection. **The manager path is the only
client consumer of raw NFL entries outside SuperAdmin.**

---

## S4 — what the member-readable projection carries today

```bash
grep -n "interface StandingsRow" -A 30 functions/src/nflScoringEngine.ts
```

**Must find:** the deliberate-exclusions comment naming `picks`.

**Result — `nflScoringEngine.ts:663-694`.** `StandingsRow` is built by
**allowlist**, and the header states the exclusions explicitly: `picks`,
`confidence`, `weeklyTiebreakers`, `usedTeams` (excluded *because* it is written
at submit time and would reveal the current week's un-scored pick), and per-game
`weeklyResults` maps.

**Consequence for the "Hidden" marker:** there is no field here that says a pick
exists, and adding pick data to this row would defeat the allowlist. The marker
has to be a boolean carried somewhere else — see S5.

---

## S5 — who writes a member-readable document at SUBMIT time

```bash
grep -rn "ensureMemberRecord(" functions/src --include=*.ts | grep -v "__tests__"
grep -rn "'standings'" functions/src --include=*.ts | grep -v "__tests__"
```

**Must find:** the submit path's own call (`nflPools.ts:706`).

**Result — Member Record writers (7):**

| File:line | Path | Fires on |
|---|---|---|
| `lib/memberRecord.ts:135` | the function itself | — |
| `lib/poolCreation.ts:166` | pool creation | create |
| `nflPools.ts:183` | NFL pool creation (owner seed) | create |
| `nflPools.ts:265` | join, already-participant branch | join |
| `nflPools.ts:298` | join, new-participant branch | join |
| **`nflPools.ts:706`** | **`submitNFLPicksInternal`, inside the same transaction as the entry write** | **every submit** |
| `poolExceptions.ts:474` | `proxyPick` — ⚠️ guarded `if (existingMember && committedPick)` | proxy pick, **only when a Member Record already exists** |

**Result — `standings/current` writers (2):**

| File:line | Fires on |
|---|---|
| `nflPools.ts:1495` | `scoreNFLWeek` — **only when a week is scored** |
| `migrations/backfillProfileData.ts:176` | one-off backfill |

**Conclusion.** Kevin's catch is confirmed by the code: `standings/current` moves
only at scoring time, so it cannot carry a live "Hidden" state. The Member Record
**already** moves inside the submit transaction, and rule `members/{memberUid}`
(`firestore.rules:431-438`) is **already readable by every participant**. That is
where the boolean marker belongs — no new collection, no new rules surface, no
new writer, and it rides the transaction that writes the pick.

⚠️ `poolExceptions.ts:474`'s guard means a commissioner proxy-picking for a
member who has **no** Member Record writes no marker. That gap must be closed by
the implementation, or a proxy-picked member shows "No selection" forever.

---

## S6 — the inference channel that is NOT the entries collection

```bash
grep -n "match /consensus" -A 10 firestore.rules
grep -rn "recomputeWeekConsensus" functions/src --include=*.ts | grep -v __tests__
```

**Must find:** the pool-scoped `consensus/{gameId}` rule.

**Result — `firestore.rules:497-505`:** `pools/{id}/consensus/{gameId}` is
readable by **any participant, the owner and the manager**, with no lock
condition. Its rule comment calls it a *"post-lock aggregate"* — but
`recomputeWeekConsensus` is invoked from `submitNFLPicksInternal`
(`nflPools.ts:720`) on **every submit**, under the 2026-07-09 "fully-open live
consensus" decision. `PickDistribution.tsx` politely hides the numbers until the
game locks (`:31-34`), but the **document** is readable with the client SDK the
whole time.

**Why this belongs in this plan.** Counts are not picks — until the pool is
small. In a 4-member survivor pool, live per-team counts plus your own pick
narrow the others' picks to a guess or a certainty. Blinding the commissioner's
entry reads while leaving live counts readable to that same commissioner makes
the guarantee weaker than it reads. **Named here as a decision for Kevin (plan
Q4), not silently fixed** — the counts are also the feature.

---

## S7 — server-side readers of pick content (context, not a change surface)

```bash
grep -rn "collection('entries')" functions/src --include=*.ts | grep -v __tests__ | wc -l
```

**Result: server functions read entries with admin credentials, so Firestore
rules do not constrain them at all.** The scorer, the recap builder, `proxyPick`,
the reminder targeting and the sweep all keep working untouched by any rules
change in this plan. This sweep exists to record that fact, because "the rules
change will break scoring" is the first objection anyone raises.

The one place it matters: a callable that RETURNS pick content to a caller is a
new door, and this plan proposes exactly one (`getPoolPicks`, plan §4). Its
authorization is the plan's real security surface — not the rules edit.

---

## S8 — the proxy-pick UI's dependence on pick visibility

```bash
sed -n '1400,1470p' src/components/NFLPoolDashboard/NFLManagerView.tsx
```

**Must find:** the target-member `<select>`.

**Result — `NFLManagerView.tsx:~1421`:** the proxy control renders
`entries.map(entry => <option>{entry.userName}</option>)` — **names only**. It
never displays the target's current pick, and the submission goes to the
`proxyPick` callable, which reads and writes picks server-side with admin
credentials.

**Conclusion:** the planning note that *"proxyPick NEEDS pick visibility to
function"* is **wrong**, and the sweep is how we know. The proxy flow needs the
member LIST, which the Member Records already provide. This removes what looked
like the hardest constraint on the design.
