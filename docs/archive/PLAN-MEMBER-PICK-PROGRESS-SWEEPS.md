# PLAN-MEMBER-PICK-PROGRESS — sweeps

Deterministic greps run 2026-08-21 on `origin/main` @ `49c8ff76`. Re-run each
command before implementing; the plan's decisions are derived from these, and
where a sweep corrected the plan it says so.

---

## S1 — Every consumer of `getPoolPicks`'s per-member `counts`

The point: the plan must not change what any of these show, and the new
aggregate must not contradict them.

```
grep -rn "\.counts\b|pickCounts" src --include=*.tsx --include=*.ts | grep -v test
```

**COMPLETE LIST — four render surfaces, one shared predicate, one wiring point.**

| Site | What it does with a count | After this plan |
|---|---|---|
| `src/components/NFLPoolDashboard/NFLPoolDashboard.tsx:1008` | passes `weekReveal?.counts` into `NFLManagerView` | unchanged |
| `src/components/NFLPoolDashboard/NFLPoolDashboard.tsx:1162` | passes `weekReveal?.counts` into `NFLStandings` | unchanged |
| `src/components/NFLPoolDashboard/NFLStandings.tsx:342-343` | renders `"{n} of {m} Picks Set"` **per member** | unchanged — still absent for a participant |
| `src/components/NFLPoolDashboard/NFLManagerView.tsx:449,958` | feeds the roster + "Remind all unpicked" | unchanged — commissioner surface |
| `src/components/NFLPoolDashboard/NFLManagerBentoDashboard.tsx:166` | roster completeness tiles | unchanged — commissioner surface |
| `src/components/NFLPoolDashboard/NFLPicksGrid.tsx:147` | `return wk?.counts?.[row?.id]` — the `Set` column | unchanged; the NEW chip sits in the header, not this cell |
| `src/utils/poolRoster.ts:319-321` | `hasCompletePicks` — **the completeness predicate** | **reused verbatim as the plan's definition (T2)** |

**This sweep decided T2.** `hasCompletePicks` is:

```ts
const need = poolType === 'NFL_PICKEM' ? weeklyGameIds.length : 1;
return (pickCounts[r.uid] ?? 0) >= need;
```

The plan's aggregate uses that expression rather than a new one, so the pool-wide
number cannot disagree with the per-member column a commissioner reads beside it.

⚠️ **Two of these surfaces are commissioner-only and two are shared.** The
`NFLManagerView` and `NFLManagerBentoDashboard` entries are behind the manager
tab; `NFLStandings` and `NFLPicksGrid` are rendered for members too and simply
degrade to a marker when `counts` is absent. **Nothing in this list breaks when
`counts` stays withheld**, which is what makes the plan additive.

---

## S2 — Where the reveal boundary is actually enforced

⚠️ **`stillAMember` IS PRINCIPAL-SPECIFIC AND `progress` MUST NOT INHERIT IT**
(codex r2, P1). Line 226 in full:

```ts
const roster: unknown = pool.participantIds;
const stillAMember: ((uid: string) => boolean) | null = isParticipant && Array.isArray(roster)
    ? (uid: string) => (roster as string[]).includes(uid)
    : null;
```

`isParticipant &&` is deliberate — the comment above it says a commissioner still
sees a departed player's entry, *"which is what they see today"*. An aggregate
that inherits this returns a different number to a participant than to a
commissioner.

🛑 **AND THE REPLACEMENT IS NOT `pool.participantIds`.** An earlier draft of
this sweep said it was; round 5 disqualified that array (a manager could
historically write arbitrary uids into it, and the K9 rules fix evicted nobody).
`progress` uses **`rosterSummary/current.playerUids`** for BOTH halves of the
fraction — see plan **D7** — and accumulates **before** the `stillAMember`
`continue` at :305.

```
grep -rn "counts\[memberUid\]|isParticipant" functions/src/nflPickReveal.ts
```

```
198:  const isParticipant = kind === 'PARTICIPANT';
226:  const stillAMember: ((uid: string) => boolean) | null = isParticipant && Array.isArray(roster) ...
319:  if (!isParticipant || reveal.weekRevealed) {
320:      counts[memberUid] = weekPickCount(pool.type, entry.picks as Record<string, unknown>, week, weekGameIds);
```

**ONE gate, one line.** The plan adds a sibling accumulator in the same loop and
**does not touch line 319**.

🛑 **`total` DOES NOT INHERIT `stillAMember`, AND AN EARLIER DRAFT OF THIS SWEEP
SAID IT DID** (codex r2 P1, restated r3 P2 and r7 P2). That filter is
participant-only by design. **Neither does it come from `pool.participantIds`**,
which round 5 disqualified as legacy-forgeable. Both halves come from
`rosterSummary/current.playerUids`, which is also the only source that sees a
rostered player who has never created an entry (codex r3 P1) and excludes a
departed one who kept a complete entry (codex r6 P1). **Plan D7 is the answer;
nothing in this sweep prescribes `stillAMember` or `participantIds`.**

```
grep -rn "weekPickCount" functions/src shared
→ functions/src/lib/pickReveal.ts:141   (definition)
→ functions/src/nflPickReveal.ts:320    (the only production call site)
→ functions/src/__tests__/pickReveal.test.ts:149-160  (its tests)
```

**One definition, one caller.** The plan's aggregate becomes the second caller
and reuses the function rather than re-deriving a count.

---

## S3 — What aggregates a member can ALREADY read

The plan's claim that "an aggregate is the safe half" has to be measured, not
asserted.

```
grep -n consensus firestore.rules
→ 53, 57   (global /consensus/{weekKey}[/{poolType}/{gameId}] — allow read: if true)
→ 666      (pool-scoped /pools/{poolId}/consensus/{gameId})
```

`firestore.rules:664-674`, verbatim:

```
// POOL CONSENSUS (ADR 0004) — server-written post-lock aggregate (counts only, no
// individual picks). Readable by the pool's members/owner/admin; write server-only.
match /consensus/{gameId} {
  allow read: if request.auth != null && (
    request.auth.uid in get(...).data.participantIds || ... ownerId ... || ... managerUid ... || isSuperAdmin()
  );
  allow write: if false;
}
```

**A member already reads a per-game aggregate of the pool's picks, at all
times** — Kevin's Q4 ruling of 2026-08-11, which the Pick Distribution card and
the grid's Majority row both render. The global `/consensus/{weekKey}` docs at
:53-58 are `allow read: if true` — **public, unauthenticated**.

**So the precedent is stronger than the plan needed it to be:** the pool already
discloses to members *which side* the pool took, in percentages. This plan
discloses only *how many finished*, which carries no pick content at all.

---

## S4 — Can the client derive it from consensus instead, with no server change?

Asked because a no-server-change option would skip this gate entirely.

**NO, and the sweep killed that alternative (plan D5).** `ConsensusSplit` is per
GAME (`src/utils/picksGrid.ts:110-114`): `{ awayPct, homePct, total }`. `total`
is how many entries picked *that game*.

`min(total)` across the week's games is a **lower bound** on "entries with every
pick", not the count: sixteen entries each missing a different single game give
`min(total) = 15` while the true complete count is `0`. There is no combination
of per-game totals that recovers per-entry completeness.

The aggregate has to be computed where whole entries are visible, which is the
server. **D5 records this.**

---

## S6 — What unit does the grid's own row count actually use?

**ADDED AFTER codex r1, WHICH REVERSED D1. S1 MISSED THIS FILE AND THE PLAN WAS
WRONG BECAUSE OF IT.**

`NFLPicksGrid`'s header chip prints `{entries.length} Entries`, and `entries` is
the array `buildMemberStandings` returns. So the question is what that function
counts.

```
grep -n "Map|seen|push(" src/utils/memberStandings.ts
→ 86:  const scoredByUid = new Map<string, any>();
→ 92:  const rows: any[] = [];
→ 93:  const seen = new Set<string>();
→ 113: rows.push(row);
```

`src/utils/memberStandings.ts:92-113` — one row per **uid**, guarded by a
`seen: Set<string>`.

**So the chip labelled "Entries" is already counting PLAYERS.** An
entry-denominated aggregate would print `3 of 4 in` beside a table showing three
rows the moment anyone holds two entries.

**This reversed D1** from entries to distinct owner uids — which is also Kevin's
original wording — and added the existing chip's label to the plan's out-of-scope
list, since fixing *that* is a `buildMemberStandings` row-model change.

---

## S7 — Where can the callable's DISCLOSURE actually be tested?

**ADDED AFTER codex r1**, which found the plan naming a suite that cannot do the
job.

```
grep -rln getPoolPicks functions/src/__tests__
→ functions/src/__tests__/emulator/blindPicks.emulator.test.ts
```

**One file, and it is in the emulator suite.**
`functions/src/__tests__/pickReveal.test.ts` imports only pure helpers
(`revealMode`, `weekRevealFor`, `fullReveal`, `weekPickCount`) — it cannot build
Firestore entries or roster state and never calls the callable, so it cannot
exercise the authorization branch or the `stillAMember` filter at all.

**This split T4 in two:** the aggregate is extracted as a pure function so the
arithmetic is unit-testable, and every claim about WHO SEES IT is proved in
`blindPicks.emulator.test.ts`, where the callable is actually invoked as
different principals. CI runs the emulator suite
(`npm --prefix functions run test:emulator`).

---

## S5 — Does any existing surface already claim a pool-wide completion?

Checked so the new chip cannot contradict an existing sentence.

```
grep -rn "of 16|have their picks|players in|entries in" src --include=*.tsx | grep -v test
```

Every hit is **per-member or per-viewer**, none pool-wide:

| Site | Claim | Scope |
|---|---|---|
| `NFLStandings.tsx:342` | `"{n} of {m} Picks Set"` | one member's row |
| `PickemPickEntry.tsx:294,792` | `"Picks Saved (8 of 16)"` | the viewer's own sheet |
| `pickSheet/StickySaveBar.tsx:23` | `"12 of 16 picked"` | the viewer's own sheet |
| `NFLPicksGrid.tsx:18` (comment) | describes the Standings count | n/a |

**No existing surface makes a pool-wide completion claim**, so the new chip
introduces the statement rather than duplicating or contradicting one.

🛑 **THIS SWEEP'S ORIGINAL CONCLUSION — that the `N Entries` chip is the
denominator the new one must agree with, "entries, not players" — IS SUPERSEDED
AND WRONG** (codex r2 P2, restated r5 P2). S6 shows that chip is already counting
uid-deduplicated ROWS, and D7 takes the denominator from
`rosterSummary/current.memberCount` instead. **Do not implement from this
paragraph; S6 and plan D7 are the answer.**

---

## What these sweeps changed in the plan

1. **S1 → T2.** The completeness rule is `hasCompletePicks`'s, not a new one.
2. ~~**S1 → D1.** Every neighbouring number is entry-denominated, so the chip is
   too.~~ 🛑 **SUPERSEDED BY S6 — THIS CONCLUSION WAS WRONG.** S1 never opened
   `memberStandings.ts`, because that file consumes no counts, and read the
   `N Entries` LABEL as if it were the unit. The rows are uid-deduplicated, so the
   unit is **players**. Do not implement from this line; **S6 is the answer.**
3. **S4 → D5.** The client-side-only alternative is impossible, not merely
   inconvenient; the plan says so rather than leaving it as an open option.
4. **S3 → the premise.** The "aggregates are already disclosed to members"
   argument is now cited to `firestore.rules:664-674` and the global
   `allow read: if true` at :53, instead of resting on the Majority row alone.
5. **S5 → nothing to reconcile.** No surface to keep in step with, which is why
   T3 is one chip in one place. ⚠️ Its *original* conclusion — "entries, not
   players" — is **superseded**, twice over, by S6 and by plan D7.
6. **S6 → D1 REVERSED.** The unit is players (distinct owner uids), not entry
   documents, because the grid's rows already are. S1 missed
   `memberStandings.ts` and the plan asserted the opposite until codex r1.
7. **S7 → T4 SPLIT.** Disclosure is proved in the emulator suite; only the
   arithmetic is a unit test. The first draft named a pure-helper suite that
   cannot call the callable at all.
