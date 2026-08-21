# PLAN — pool-wide pick progress: a count that names nobody

## Implementation status (2026-08-21)

**PLAN ONLY. NO CODE EXISTS. BLOCKED ON KEVIN'S SIGN-OFF** — see "Decisions
needed" at the end. Three questions, none of them large.

Kevin, 2026-08-21, choosing between three options offered in
`MORNING-2026-08-22-FIXES.md` §4: *"Go with both of these"* — option (ii), the
legend fix, **already shipped as [#497](https://github.com/kstruck/MMPoolsV3/pull/497)**,
and option (iii), this plan.

## The requirement

> **(iii) Pool-wide aggregate instead — "12 of 16 players have their picks in".
> Names nobody, same shape as the Majority row you already ruled always-visible.**

A member of an NFL pool has no way to tell whether the rest of the pool has done
their picks. The grid's `Set` column answers it for a commissioner and is
withheld from members by design (below). The ask is for the **aggregate** of that
same question: how many of the pool's players have a complete sheet for the week.

## What this plan does NOT do — K1 stands

🛑 **THIS DOES NOT REVERSE KEVIN'S K1 RULING OF 2026-08-14.** Per-member counts
stay commissioner-only. `functions/src/nflPickReveal.ts:319` is unchanged:

```ts
if (!isParticipant || reveal.weekRevealed) {
  counts[memberUid] = weekPickCount(...);
}
```

The ruling, quoted from the comment above that line: *"Handing it to participants
unchanged would let every member watch every other member's sheet fill in live:
'Kevin 14 of 16' ticking to 15 tells you he is still working, and nobody asked
for that."* Still true. A pool-wide total cannot express it: it carries no name
and no partial progress for any individual.

⚠️ **THE CODEBASE ALREADY DREW THIS DISTINCTION, IN THE SAME BREATH AS K1.**
`functions/src/lib/pickReveal.ts:135`, the header of `weekPickCount` itself:

> *"'picked 3 of 16' is a different question from 'has picked at all', and only
> the second is safe to tell the whole pool."*

That sentence is the premise of this plan, written by the change that closed the
door. This is the half it called safe, not a re-litigation of the half it shut.

## Approach — one PR, one number pair

### T1 — server: one aggregate on the existing response

`getPoolPicks` already loops every entry of the pool to build `counts`, `picks`,
`confidence` and `tiebreakers`. Add a fifth output derived in that same loop:

```ts
/**
 * How many of the pool's PLAYERS have a complete sheet for this week, out of how
 * many are playing. An aggregate: no name, no partial progress, no pick content.
 *
 * ⚠️ PLAYERS — distinct owner uids — NOT entry documents. See D1: the grid's
 * rows are already uid-deduplicated, so an entry-denominated total would print
 * "3 of 4 in" beside a table showing three rows. (codex r1.)
 */
progress: { complete: number; total: number };
```

- **Ungated.** Returned to every principal the callable already serves —
  SUPER_ADMIN, commissioner, and proven participant alike. One code path, one
  number; a second gate here would be a second definition of the boundary, which
  is the thing `PLAN-COMMISSIONER-BLIND-PICKS` exists to prevent.
- **A non-member still gets nothing**, because `assertPickReader` refuses them
  before any of this runs. This plan does not touch that door.
- 🛑 **`total` IS SEEDED FROM THE ROSTER, NOT FROM THE ENTRIES LOOP.** codex r3,
  P1: a player who has JOINED but never created an entry document is invisible to
  the entries scan, so an aggregate accumulated only inside that loop omits them
  from the denominator entirely — and reports **"12 of 12 in"** on a pool where
  four people have not started. That is precisely the number this feature exists
  to make meaningful, and it would have been silently wrong in the most common
  case: mid-week, before the stragglers pick.

  So the denominator comes from the ROSTER, not the loop, and the numerator is
  filtered by that same roster. **A rostered player with no entry counts toward
  `total` and is not complete; a departed player counts toward neither.** Which
  roster source — and why neither `participantIds` nor a bare count will do — is
  D7.

- **A player holding several entries counts once, and is complete only when
  EVERY entry they own is complete** — they owe all of them. Today an NFL entry
  id IS the uid, so this collapses to one entry per player and nothing changes;
  under `PLAN-MULTI-ENTRY` it is already right.

- 🛑 **`progress` USES ITS OWN MEMBERSHIP SET — IT MUST NOT INHERIT
  `stillAMember`, AND THAT SET IS NOT `participantIds`.** This is a P1 codex
  found in round 2 and it would have broken the plan's central claim in
  implementation. `nflPickReveal.ts:226` builds `stillAMember` as `isParticipant
  && Array.isArray(roster)`, deliberately: a commissioner and SUPER_ADMIN still
  see a departed player's entry, because narrowing a privileged API silently
  would contradict `fullReveal`. **So a `progress` that inherits it returns a
  DIFFERENT number to a participant than to a commissioner** — which contradicts
  the ungated-response decision above and would fail the byte-identical emulator
  assertion in T4.

  ⚠️ **AND THE REPLACEMENT IS NOT `pool.participantIds` EITHER.** Rounds 2 and 3
  reached for that array because it is already in memory; **round 5 disqualified
  it** — a manager could historically write arbitrary uids into it and the K9
  rules fix did not evict them. The set is
  **`rosterSummary/current.playerUids`** and nothing else. **D7 is the decision;
  read it before implementing this bullet.**

  ```ts
  // D7. Both halves of the fraction come from ONE set, which is why no clamp
  // is needed. Schema < 2, or no summary at all, means we cannot answer.
  const playerUids: string[] | undefined = summary?.playerUids;
  const onRoster = (uid: string) => !!playerUids?.includes(uid);
  ```

  ⚠️ **AND IT IS ACCUMULATED BEFORE THE `stillAMember` `continue`.** That
  `continue` (`nflPickReveal.ts:305`) skips the whole entry for participants only,
  so an accumulator placed after it is principal-specific again by a second
  route. The existing response maps keep `stillAMember` exactly as it is; this
  plan changes none of them.

### T2 — the completeness definition is the one that already exists

"Complete" is `weekPickCount(...) >= need`, where `need` is `weekGameIds.length`
for `NFL_PICKEM` and `1` for Survivor and Margin.

That is character-for-character the rule `hasCompletePicks` applies at
`src/utils/poolRoster.ts:319-321` for the commissioner's roster. **Deliberately
the same, so the pool-wide number can never disagree with the per-member column
a commissioner is reading beside it.** If the two ever need to differ, that is a
change to `hasCompletePicks`, not a second rule here.

⚠️ **THAT AGREEMENT GUARANTEE HOLDS ONLY WHILE ONE ENTRY PER UID — WHICH IS
TODAY, AND THE PLAN SAYS SO RATHER THAN CLAIMING MORE** (codex r4).
`nflPickReveal.ts:320` writes `counts[memberUid] = ...` **once per entry**, so
under multi-entry the LAST entry iterated wins and the commissioner's per-member
count silently describes one arbitrary entry. This plan's aggregate instead asks
that EVERY entry the uid owns is complete. Those two answers can differ the day
multi-entry ships.

The `counts` map is the half that is wrong there — last-write-wins is not a
semantic anyone chose — but fixing it is a change to the per-member count and row
model, which is `PLAN-MULTI-ENTRY` §0b work and is **out of scope here**. What
this plan owes is honesty about the boundary: **T2's "can never disagree" is
scoped to the current one-entry-per-uid invariant.** The aggregate's own semantics
("you are done when all your entries are done") is the one that stays correct
afterwards.

### T3 — client: one chip on the Current Picks grid, and the legend

**First, the client's copy of the response type.** `PoolPicksReveal`
(`src/services/dbService.ts:44`) is a HAND-WRITTEN MIRROR of the callable's
response — `getPoolPicks` does `res.data as PoolPicksReveal`, so nothing checks
the two against each other. `progress` must be added there as well as to
`PoolPicksResponse` in `functions/src/nflPickReveal.ts`, or the grid cannot read
it without an unsafe cast. (codex r4. Two hand-kept copies of one shape is a
standing hazard in this file; this plan adds a field to it and does not fix that.)

**Then the chip.** `NFLPicksGrid` already renders an `N Entries` chip in its
header. A second chip beside it: **`12 of 16 players in`**. The legend gains one
sentence naming what it counts and that it names nobody.

**One surface, deliberately.** Not the checklist strip, not the standings, not
the manager dashboard — those answer "what do *I* owe" and "who specifically is
missing", which are different questions with existing answers.

### T4 — tests, same PR

Per Kevin's standing rule of 2026-08-17, every feature ships with its test.

⚠️ **THE BOUNDARY TESTS GO IN THE EMULATOR SUITE, NOT THE UNIT SUITE, AND THE
FIRST DRAFT OF THIS PLAN PUT THEM IN THE WRONG ONE (codex r1).**
`functions/src/__tests__/pickReveal.test.ts` exercises PURE helpers — it cannot
build Firestore entries or roster state, cannot call `getPoolPicks`, and so
cannot touch the authorization branch or the `stillAMember` filter at all. The
existing home for exactly these questions is
`functions/src/__tests__/emulator/blindPicks.emulator.test.ts`, which already
calls this callable as different principals. CI runs the emulator suite.

**Split accordingly, and the split shapes the code:** the aggregate is extracted
as a PURE function beside `weekPickCount` so the arithmetic is unit-testable
without an emulator, and the callable's disclosure is proved where disclosure
actually happens.

*Unit* — `functions/src/__tests__/pickReveal.test.ts`, on the pure helper:
- a mixed pool: some complete, some partial, some with no entry at all;
- **a rostered player who has never created an entry counting toward `total` and
  NOT toward `complete`** — the codex r3 P1 regression guard, and the case that
  makes the whole number worth showing;
- 🛑 **the mixed case: a DEPARTED member holding a complete entry, alongside a
  CURRENT member with no entry.** The codex r6 P1 guard. A count-only denominator
  reports everyone complete here. The correct answer is `complete < total`;
- a `rosterSummary` at schema version 1 (no `playerUids`) returning `{0, 0}`;
- 🛑 **a NON-PLAYING HOST excluded from `total`, and — in the same fixture — an
  ordinary member who joined and has not picked INCLUDED in it.** The codex r8 P1
  guard, deliberately paired with round 3's, because both members carry
  `hasPlayableEntry: false` and a filter that cannot tell them apart breaks one of
  the two. A host who DOES play is included;
- **an unpicked CO-COMMISSIONER included in `total`** (codex r9) and **a host
  whose latch is UNDEFINED included too** — the two ways the r8 fix over-reaches;
- **a distinct `managerUid` who is a PLAYER included in `total`** even before
  they pick (codex r10) — the blind-picks emulator fixture already has this
  shape;
- **a forged member record with no `joinedAt` excluded from `total`** (codex
  r10);
- a Survivor / Margin week, where `need` is 1 rather than the slate length;
- **the empty slate returning `{0, 0}`** — the D6 regression guard;
- a player holding two entries counting ONCE, and counting complete only when
  both are.

*Emulator* — `functions/src/__tests__/emulator/blindPicks.emulator.test.ts`:
- 🛑 **SEED `rosterSummary/current` WITH `playerUids` IN THE FIXTURE AND ASSERT
  A NONZERO, EXPECTED `progress` THROUGH THE CALLABLE** — e.g. `{complete: 2,
  total: 3}`. codex r7: the existing fixtures carry no schema-2 summary, so
  without this the callable returns `{0, 0}` to everyone, **the equality
  assertion below passes vacuously, and nothing anywhere exercises the summary
  read or the response wiring.** That is precisely the guard-that-does-not-guard
  this repo has shipped three times. The nonzero assertion comes FIRST; equality
  is meaningless without it.
- **`progress` is byte-identical for a participant and for the commissioner** on
  the same pool and week — on that same nonzero fixture. That is the whole claim
  of this plan and it must fail loudly if a gate is ever added.
- **A schema-1 summary (no `playerUids`) returns `{0, 0}` through the callable**,
  so the hide-rather-than-guess branch is covered end to end and not only in the
  pure helper.
- The participant branch **still withholds per-member `counts`** — K1 must not be
  reversed by accident while this is being wired.
- **A departed member with a COMPLETE entry, alongside a current member with
  NO entry, yields `complete < total`** — the r6 P1 case, proved where the
  populations actually meet rather than only in the helper.
- A non-member is still refused outright.

## Key decisions and tradeoffs

**D1 — PLAYERS (distinct owner uids), not entry documents. REVERSED BY codex r1.**

The first draft said entries, reasoning that the grid's `N Entries` chip and
`pool.entryCount` are entry-denominated. **That was wrong about the grid, and the
sweep missed it.** `buildMemberStandings` (`src/utils/memberStandings.ts:92-113`)
builds its rows through a `seen: Set<string>` keyed by **uid**, and
`NFLPicksGrid` prints `entries.length` off those rows — so the chip labelled
"Entries" is already counting PLAYERS. An entry-denominated total would print
**"3 of 4 in" beside a table showing three rows** the moment anyone holds two
entries.

**Players, labelled "players"**, which is also Kevin's original wording. A player
with several entries counts once and is complete only when all of their entries
are. Today entry id == uid, so every number agrees and nothing is visible; under
multi-entry, mine stays right and the neighbouring `N Entries` label becomes the
thing that is wrong — noted below as out of scope. *(Q1 below.)*

**D2 — no small-pool suppression, and the leak is stated rather than hidden.**
In a two-entry pool, "1 of 2 in" plus knowledge of your own sheet tells you the
other person's state. That is real. It is also **the identical tradeoff Kevin
already accepted, in writing, for the Pick Distribution card**
(`src/components/NFLPoolDashboard/PickDistribution.tsx:29-31`): *"in a 2-person
pool the split identifies both picks. That is a known and accepted consequence of
the ruling, not an oversight."* A completion flag is strictly less than a pick.
Suppressing below a threshold would add a rule the sibling aggregate does not
have, and a member of a 3-person pool would then see a number that vanishes when
someone leaves. **Documented, not suppressed.** *(Q3 below.)*

**D3 — strict completeness, with a known edge.**
A member who joins after a game has locked can never reach `weekGameIds.length`
and so is never counted complete. `hasCompletePicks` has that edge today and the
commissioner's roster already shows it. **Inheriting it is the point** — one
definition. Fixing it is a change to `hasCompletePicks` and belongs to whoever
decides that closed games should be exempt, which is a real question this plan
deliberately does not answer.

**D4 — a pair of scalars, never a list.**
No per-entry structure crosses the boundary, not even an anonymised one. An array
of booleans in roster order would be trivially re-identified against the grid's
own rows.

**D5 — no new collection, no new rule, and ONE new document read. REVISED in
round 6, because D7 falsified the original wording.**

This decision used to read "no new read". **That is no longer true and leaving it
would have been two incompatible instructions in one document:** D7 reads
`rosterSummary/current` on every call. What is still true — and is the point — is
that nothing new is WRITTEN by this feature, no collection is created, and
`firestore.rules` is untouched: `rosterSummary` already exists, is already
server-written, and is already member-readable. The one write that changes is
`recomputeRosterSummary` adding a field to a document it already writes.

The alternative — deriving the number client-side from the pool consensus
aggregate — **does not work and was rejected**: consensus is per game, so the
minimum across games is a lower bound on "entries with every pick", not the
count. See sweep S4.

**D6 — an empty slate SHORT-CIRCUITS to `{complete: 0, total: 0}`. HOLED BY
codex r1 AND THE FIX IS IN THE SERVER, NOT THE UI.**

The first draft said the chip hides when `total` is 0, and that does not work:
with an empty slate `need` is **0**, `weekPickCount(...) >= 0` is true for
everyone, and the server returns `{complete: N, total: N}` — so the UI would
print exactly the **"16 of 16 in"** on a week with no games that this decision
exists to forbid. `total` is never 0, so the guard never fires.

`weekGameIds.length === 0` therefore returns `{0, 0}` **before the loop runs**,
and the UI hides on `total === 0` as a second, now-reachable line of defence.
`hasCompletePicks` has the opposite convention on purpose — it treats an empty
week as complete so the commissioner is not told to chase picks that do not exist
(`poolRoster.ts`, "the empty-slate answer here is complete") — and this is the
one place the plan deliberately does NOT inherit it, because "everyone is done"
and "there is nothing to do" are the same value and different sentences.

**D7 — the roster comes from `rosterSummary/current`, which gains a
`playerUids` array. ONE document read, and it must carry the UID SET, not just a
count.**

Three candidate sources, and codex knocked out two across rounds 3, 5 and 6:

| Source | Complete? | Trusted? | Cost |
|---|---|---|---|
| owners of entry documents | ❌ misses a player who joined and never picked (r3) | ✅ | free |
| `pool.participantIds` | ✅ | ❌ **a manager could historically add arbitrary uids; the K9 rules fix did not evict them** (r5) | free |
| `members` subcollection | ✅ canonical | ✅ | ❌ O(roster) doc reads **per poll, per member** |
| `rosterSummary/current` **+ `playerUids`** | ✅ | ✅ built from canonical Member Records | ✅ **one doc** |

🛑 **A COUNT ALONE IS NOT ENOUGH, AND ROUND 6 PROVED IT.** With `total =
memberCount` and `complete` counted from the entries scan, a **departed member
who kept a complete entry** is counted complete while a **current member with no
entry** is invisible — so `complete` reaches `total` on a pool where someone has
not picked, and the clamp makes it look tidy. The callable deliberately retains
departed entries for a commissioner (`nflPickReveal.ts:220-228`), so this is
reachable, not theoretical. **The numerator has to be filtered against the
canonical roster, which means the UID SET.**

**So `recomputeRosterSummary` gains one field.** It already holds `membersSnap`
AND the pool doc in memory (`functions/src/lib/rosterSummary.ts:36-42`); adding
the array is a few lines there plus the type in `shared/memberRecord.ts` and a
`ROSTER_SCHEMA_VERSION` bump (1 → 2). ~16 uids is under a kilobyte, and the
document is already member-readable — the roster's membership is not a secret from
members (`pools/{id}/members` is member-readable in `firestore.rules`), only their
picks are.

🛑 **THE FIELD IS `playerUids`, NOT `memberUids`, AND THE DIFFERENCE IS A HOST
WHO DOES NOT PLAY** (codex r8, P1). Pool creation seeds the owner's Member Record
with `hasPlayableEntry: false` — `functions/src/nflPools.ts:194-201`, *"Hosting is
not playing"*. A host who never enters is therefore on the roster, can never
have an entry, and so can never reach the numerator: every owner-hosted pool of
that shape would read **"3 of 4"** for ever.

```ts
// D7. Eligible PLAYERS, not every member record.
// Two narrowings, both of them found by review rather than by design:
//   1. CANONICAL records only — a forged pre-#344 member doc has no `joinedAt`.
//   2. The exception is the OWNER record only, and only when the latch is
//      EXPLICITLY false. Everything else stays in.
const host = pool.ownerId ?? pool.managerUid;   // legacy pools may carry only the latter
const playerUids = members
  .filter(isCanonicalMemberRecord)
  .filter(m => !(m.uid === host && m.hasPlayableEntry === false))
  .map(m => m.uid);
```

⚠️ **THE FILTER IS `hasPlayableEntry === false` AND *ALSO* BEING THE HOST —
NEVER EITHER CONDITION ALONE. BOTH HALVES WERE HOLED SEPARATELY, IN ROUNDS 3 AND
9.**

- **Not the latch alone (r3).** `hasPlayableEntry` is `false` for a non-playing
  host **and** for an ordinary member who joined and has not picked yet; the two
  are identical in the data. Filtering on the latch by itself drops the second
  population — the silent "12 of 12" round 3 removed.
- **Not every commissioner (r9).** `coManagers` are **canonical members promoted
  to co-commissioner**, not hosts — `setPoolCoCommissioner` only accepts an
  existing Member Record, so they joined as players. Excluding an unpicked
  co-commissioner would report everyone complete while that player has not
  started.
- **Not `managerUid` either, when an `ownerId` exists (r10).** A pool's
  `managerUid` can be **a distinct principal who is also a player** —
  `isPoolOwnerOrManager` treats the two separately, and the existing blind-picks
  emulator fixture makes `BOB` both a participant and the `managerUid`. Only the
  record seeded at creation is the non-playing host, and that record is the
  OWNER's. `managerUid` survives only as the legacy fallback for a pool with no
  `ownerId`.
- **And the population is CANONICAL records only (r10).** `members` can contain
  forged pre-#344 documents with no `joinedAt`; `isCanonicalMemberRecord`
  (`shared/memberRecord.ts:188`) is the repo's existing discriminator and every
  roster-truth consumer uses it. Without it, the next `recomputeRosterSummary`
  would promote a forged document into the supposedly trusted denominator and
  inflate the incomplete count permanently — the same defect round 5 rejected
  `participantIds` for, arriving by a different door.
- **`=== false`, not falsy (r9).** A legacy record with the latch UNDEFINED is not
  evidence of anything, and `lib/memberRecord.ts` keeps an explicit
  "unknown-is-not-false" discipline. An unknown latch keeps the member in the
  denominator.

**A host who does play flips the latch on their first submission and joins the
denominator by the normal route** — no special case, no manual list.

- **`total` = `playerUids.length`.**
- **`complete`** = distinct entry-owner uids **that appear in `playerUids`** and
  whose every entry is complete. A departed owner is filtered out of the
  numerator by the same set that defines the denominator, so the two halves can
  no longer describe different populations. **No clamp is needed and none is
  used** — a clamp was the round-5 design papering over exactly this.
- 🛑 **NO `rosterSummary/current`, OR ONE WITHOUT `playerUids` (schema < 2)
  ⇒ `{complete: 0, total: 0}` AND THE CHIP HIDES.** Falling back to
  `participantIds` reintroduces r5's forged uids; falling back to entry owners
  reintroduces r3's silent "12 of 12". **A number we cannot stand behind is not
  shown.** `recomputeRosterSummary` runs on every membership change, so a live
  pool self-heals on the next join, leave or payment edit; the chip simply
  appears when it does. **No backfill is required and none is proposed** — which
  keeps this plan clear of the prod-data-mutation gate.

**Cost: one document read per `getPoolPicks` call**, on a path members poll.
O(1), not the O(roster) scan qodo had this callable stop doing. *(Q4.)*

## Risks and open questions

**R1 — this is an authorization change and it is why the plan exists.** It widens
what `getPoolPicks` discloses to a participant. Small, but the trigger is the
concern, not the diff size (`mmp-change-control` §1). It deploys into
`functions/`, so it owes a **functions deploy**, not just a Coolify rebuild.

**R1b — it touches a shared projection.** `recomputeRosterSummary` feeds the
commissioner aggregate and the Payments surfaces as well as this chip. The change
is purely additive (one new field, schema version 1 → 2) and no reader is
required to consume it, but the schema bump must not be read by anything as
"recompute everything".

**R2 — it deploys into a live scorer.** `nflAutoScore` is `{enabled: true,
dryRun: false}` and runs `*/5`. This change touches no scoring path, but any
functions deploy restarts the whole set, so it should not go out mid-slate.
Preseason week 4's games start Thu 2026-08-27; deploy before then or after the
week finalizes.

**R3 — it will read as "who hasn't picked" in a small pool.** See D2. If Kevin
would rather members saw nothing than saw a deanonymisable number in a 2-person
pool, the answer is to drop this plan, not to add a threshold — the chip's whole
value is in a pool big enough for the aggregate to be anonymous anyway.

## Out of scope

- **Reversing K1.** Option (i) from the morning doc was not chosen.
- **A per-cell "they picked, but it is hidden" indicator.** Rejected in the same
  exchange; it would need per-game has-a-pick flags for games the server is
  deliberately withholding.
- **Any change to reveal TIMING.** `weekRevealFor` is untouched.
- **The checklist, standings and manager surfaces.** T3 is one chip in one place.
- **Fixing `counts`' last-write-wins behaviour under multi-entry** (T2's note).
  It is a real defect and it is not this plan's; `PLAN-MULTI-ENTRY` §0b owns the
  per-member count and row model.
- **Reconciling the two hand-written copies of the `getPoolPicks` response
  shape** (`PoolPicksResponse` in `functions/`, `PoolPicksReveal` in
  `dbService.ts`). This plan adds a field to both and leaves the hazard.
- **Relabelling the existing `N Entries` chip.** It counts uid-deduplicated rows,
  so under multi-entry its own label will be wrong (D1). Fixing it is a
  `buildMemberStandings` row-model change — `PLAN-MULTI-ENTRY` §0b territory, not
  this plan's. Recorded so the next person does not read the two chips as
  contradicting each other.

## Decisions needed — Kevin

**Q1 — confirm "players".** D1 now recommends **players**, which is your own
wording, after codex showed the grid's rows are already uid-deduplicated. Nothing
visible changes today either way — an NFL entry id is the uid — so this is a
question about which number stays right when multi-entry lands. Say "entries" and
I will count entry documents instead and accept that the chip and the table row
count can diverge.

**Q2 — does the commissioner see the chip too?** Recommend **yes** — same number,
one code path, and it costs them nothing they do not already have from the `Set`
column. Saying no means gating it, which is the second definition of the boundary
this repo keeps removing.

**Q4 — is "players in the pool" the roster, or the people with entries?** D7 uses
the roster (`rosterSummary/current.playerUids`), so a member who joined and never
picked is counted in the 16 and not in the 12. Recommend **yes, the roster** — the number
is meant to answer "is everyone done", and excluding the people who have not
started would make it answer "is everyone who started done", which is always
closer to yes. This costs **one extra document read per call**; say the word if
you would rather the chip not cost that.

**Q3 — small-pool deanonymisation: accepted, as it is for the consensus card?**
Recommend **yes, accepted and documented**, per D2. This is the only question
here with a real product answer rather than an engineering one.

---

*Review log: `PLAN-MEMBER-PICK-PROGRESS-REVIEW-LOG.md`.
Sweeps: `PLAN-MEMBER-PICK-PROGRESS-SWEEPS.md`.*
