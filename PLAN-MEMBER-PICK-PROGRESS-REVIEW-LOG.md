# PLAN-MEMBER-PICK-PROGRESS — adversarial review log

Reviewer: `codex exec review` (OpenAI), per CLAUDE.md §2c. qodo is DORMANT
(§2b, Kevin 2026-08-19), so the stopping rule is **two** conditions: a clean
codex round **and** the author's own read agreeing. Cap 10 rounds.

Every finding is logged whether accepted or rejected, with the response.

---

## Round 1 — codex

**VERDICT: REVISE.** Three findings, **all three accepted**, and two of them
reversed a decision the plan had asserted.

### 1. (P2) Specify an empty-slate guard before applying completeness
> *"With the stated `weekPickCount(...) >= need` rule, an empty Pick'em slate has
> `need === 0`, so every iterated entry satisfies the predicate and the server
> returns `{ complete: N, total: N }`. Hiding only when `total` is zero will
> therefore display the exact `N of N in` result this decision says must not
> appear; add an explicit no-games branch or exclude empty slates from the
> accumulator."*

**ACCEPTED. D6 was self-contradicting and is rewritten.**

The decision named the failure mode — *"'3 of 3 in' on a week with no games would
be a lie"* — and then prescribed a guard that can never fire, because `total` is
`N`, not 0. `weekGameIds.length === 0` now short-circuits **before the loop**
and returns `{0, 0}`; the UI's `total === 0` check survives as a second and
now-reachable line of defence.

The rewrite also records why this is the one place the plan does NOT inherit
`hasCompletePicks`'s convention: that function deliberately calls an empty week
**complete**, so the commissioner is not sent chasing picks that do not exist.
"Everyone is done" and "there is nothing to do" are the same boolean and
different sentences.

### 2. (P2) Put response-boundary tests in the emulator suite
> *"`pickReveal.test.ts` only tests pure reveal/count helpers, so it cannot
> construct Firestore entries and roster state or call `getPoolPicks` as a
> participant and commissioner. The listed participant-equality, withheld-`counts`,
> and departed-member assertions would not exercise the callable's authorization
> branch or `stillAMember` filter; place them in the existing emulator callable
> tests instead."*

**ACCEPTED, and it changed the CODE shape, not just the test plan.**

Verified: `grep -rln getPoolPicks functions/src/__tests__` returns exactly one
file, `emulator/blindPicks.emulator.test.ts`. `pickReveal.test.ts` imports only
`revealMode`, `weekRevealFor`, `fullReveal` and `weekPickCount` — pure helpers,
no Firestore.

Writing the disclosure assertions where they cannot run would have been the
failure mode this repo has hit three separate times: **a guard that looks like it
guards and does not.** T4 is now split — the aggregate is extracted as a PURE
function so the arithmetic has a real unit test, and every claim about *who sees
it* is proved in the emulator suite where the callable is actually invoked as
different principals. Logged as sweep **S7**.

### 3. (P2) Reconcile the entry denominator with the grid row count
> *"This choice will diverge as soon as a player has multiple entries: the
> proposed server aggregate iterates entry documents, while the current
> `buildMemberStandings` de-duplicates rows by UID and `NFLPicksGrid` renders
> `entries.length` from those rows. The new chip can thus say, for example,
> `3 of 4 in` next to `3 Entries`; either make the grid header use the response
> total or include the multi-entry row-model work in this plan."*

**ACCEPTED. D1 IS REVERSED — the sweep was wrong and this is the most useful
finding of the round.**

Verified against the source: `src/utils/memberStandings.ts:92-113` builds rows
through a `seen: Set<string>` keyed by **uid**, and `NFLPicksGrid` prints
`entries.length` off those rows. **So the chip labelled `N Entries` is already
counting PLAYERS.**

S1 swept every consumer of `counts` and never opened `memberStandings.ts`,
because that file consumes no counts — and the plan then asserted "the grid's
rows … are entry-denominated" on the strength of a label. The unit is now
**distinct owner uids**, which is also Kevin's original wording ("12 of 16
players"). A player holding several entries counts once and is complete only when
every entry they own is. Logged as sweep **S6**, and the existing chip's
now-incorrect *label* is added to Out of scope — fixing that is
`PLAN-MULTI-ENTRY` §0b row-model work, not this plan's.

**Author's note.** Findings 1 and 3 are the same class: the plan asserting a
property of code it had not read, in a document whose whole job is to be read
before the code is written. Both were cheap here and would have been baked in
otherwise.

---

## Round 2 — codex

**VERDICT: REVISE.** Two findings, **both accepted**. The first is the most
serious of the cycle.

### 1. (P1) Apply departed-member filtering to the shared aggregate
> *"When a pool has a departed member with a retained entry, `stillAMember` is
> currently non-null only for the PARTICIPANT branch (`nflPickReveal.ts:226`);
> commissioners and super-admins intentionally retain that entry. A sibling
> accumulator that merely inherits this filter will therefore return different
> `progress` values to a participant and commissioner, contradicting both the
> ungated-response decision and the required byte-identical emulator assertion.
> Specify an unconditional membership filter for `progress` (without changing the
> existing response maps), or drop the equality/departure guarantee."*

**ACCEPTED. This would have broken the plan's central claim in implementation,
and the emulator test T4 asks for would have been the thing that found it — after
the code was written.**

Verified at `functions/src/nflPickReveal.ts:220-228`. `stillAMember` is
`isParticipant && Array.isArray(roster)`, and the comment above it is explicit
that this is deliberate: *"PARTICIPANT ONLY. Applying it to every principal would
silently narrow a privileged API and contradict `fullReveal`'s 'SUPER_ADMIN gets
everything, always'."* The plan said `total` "survives the `stillAMember` filter"
while also promising the number is identical for every principal. **Those two
sentences cannot both be true.**

Resolution: `progress` builds its **own unconditional predicate** off
`pool.participantIds` — already in memory, so it costs no read — and the existing
response maps keep `stillAMember` untouched. A legacy pool with no
`participantIds` falls back to counting everyone, which is still identical across
principals.

**And one thing the finding did not say, which falls out of it:** the accumulator
must run **before** the `stillAMember` `continue` at `:305`. That `continue`
skips the whole entry for participants only, so an accumulator placed after it is
principal-specific again by a second route. Recorded in T1 and in sweep S2.

### 2. (P2) Mark the entry-denominator conclusion as superseded
> *"This still presents entries as the decision from S5, even though S6 and the
> implementation plan explicitly reverse D1 to distinct players. A future
> implementer following this sweep can reintroduce the exact multi-entry
> denominator mismatch the review log found; replace this conclusion with the
> player-based result or explicitly mark it as superseded by S6."*

**ACCEPTED.** The sweeps' summary still carried the round-1 conclusion in its
"what these sweeps changed" list, so the document contradicted itself between §S6
and its own summary — and the summary is the part an implementer skims. It is now
struck through, labelled superseded, and points at S6, with the reason S1 got it
wrong (it read a LABEL as a unit and never opened `memberStandings.ts`).

**Author's note.** Round 1 found the plan asserting properties of code it had not
read. Round 2 found the same failure one level in: the plan had by then read
`nflPickReveal.ts:319` and still not read the eight lines above it. Both rounds
paid for themselves before a line of code existed.

---

## Round 3 — codex

**VERDICT: REVISE.** Two findings, **both accepted**. The first is the best
finding of the cycle: the plan was correct about authorization and wrong about
arithmetic, in the case the feature exists for.

### 1. (P1) Include rostered players who have no entry in `total`
> *"When a rostered player has joined but has not created an entry (explicitly
> listed in T4's proposed test cases), an aggregate accumulated solely in
> `getPoolPicks`' existing entries loop can never see that UID, so it will omit
> them from `total` and can report every existing entry complete (for example,
> `12 of 12 in` instead of `12 of 16`). Seed the denominator from `participantIds`
> (and treat absent entries as incomplete), rather than filtering only owner UIDs
> encountered in entry documents."*

**ACCEPTED, and it is the difference between a useful number and a reassuring
one.**

The plan had `total` accumulating inside the entries loop, so its denominator was
"players with an entry document". A player who joined and never picked has no
entry, is therefore invisible to that loop, and drops out of BOTH halves of the
fraction. The chip would read **"12 of 12 in"** on a pool where four people have
not started — reporting *everyone is done* at exactly the moment the feature is
supposed to say *four people have not started*. Worse, it fails silently and in
the direction nobody checks.

Its own citation is the sharpest part: T4 already listed "some with no entry at
all" as a test case, so the plan contained the disproof of its own design and did
not notice.

Resolution: **D7.** The denominator is the set of distinct rostered uids from
`pool.participantIds`; the entries loop only marks members of that set complete.
A rostered player with no entry counts toward `total` and never toward
`complete`. The T4 unit list gains it as a named regression guard, and D7 records
why `participantIds` rather than the `members` subcollection — the latter is an
O(roster) read this callable was deliberately made to stop doing, on a path every
member polls.

D7 also states the one thing that choice costs: `participantIds` is not the same
query as the proven Member Records the grid's rows come from, so the chip is
worded "12 of 16 **players** in" and does not reuse the neighbouring `N Entries`
number. Carried to Kevin as **Q4**.

### 2. (P2) Remove the superseded `stillAMember` aggregation guidance
> *"This sweep still instructs the implementer that `total` inherits
> `stillAMember`, but the implementation plan correctly explains that this filter
> is participant-only and would make commissioner and participant `progress` differ
> for departed entries. Leaving both directions in the committed planning material
> makes the central authorization guarantee ambiguous and can reintroduce the exact
> regression the review log says was fixed."*

**ACCEPTED, and the round-2 fix was half a fix.** Round 2 added a warning box
above sweep S2 and left the original sentence — *"`stillAMember` at :226 is the
filter the plan's `total` inherits"* — standing four lines below it. The document
then said both things, and the surviving sentence is the imperative one.

The sentence is now replaced outright rather than annotated. Two rounds in a row
on the same paragraph is the argument for replacing contradicted text instead of
appending to it.

**Author's note.** Rounds 1 and 3 both found the plan reasoning from a label
rather than from the code — "N Entries" in one case, "the entries loop is the
population" in the other. Round 2's finding and round 3's second finding are the
same defect at two depths: a correction that was written down beside the error
instead of over it.

---

## Round 4 — codex

**VERDICT: REVISE.** Two findings, **both accepted**. Neither changes the design;
both stop the plan claiming more than it delivers.

### 1. (P2) Include the client response type in the implementation plan
> *"The grid can only read this new field through `PoolPicksReveal` in
> `src/services/dbService.ts`, which is a separate mirror of the functions
> response and currently has no `progress` property. Implementing T3 as written
> will fail type checking when it accesses `weekReveal.progress` (or require an
> unsafe cast); explicitly include updating that client interface alongside the
> server response type."*

**ACCEPTED.** Verified: `dbService.ts:44` declares `PoolPicksReveal` by hand and
`getPoolPicks` returns `res.data as PoolPicksReveal` — **a cast, so nothing checks
the two shapes against each other.** T3 now names both edits and says why the
hazard exists, and "reconciling the two hand-written copies" is added to Out of
scope so the next person is not surprised by it either.

A plan that leaves out a required edit is not merely incomplete: the implementer
hits a type error, reaches for `as any`, and the cast is what survives.

### 2. (P2) Reconcile multi-entry progress with the commissioner count
> *"When multi-entry exists, `getPoolPicks` currently assigns `counts[memberUid]`
> once per entry, so the last iterated entry determines the commissioner's
> `hasCompletePicks` result. The proposed aggregate instead requires every entry
> for that UID to be complete, so the two values can disagree despite T2's
> guarantee and this claim that it is already multi-entry correct. Include a
> compatible change to the per-member count/row model, or limit the plan's
> semantics to the current one-entry invariant."*

**ACCEPTED, and the plan takes the second option deliberately.**

Verified at `nflPickReveal.ts:320`: `counts[memberUid] = weekPickCount(...)`
inside the per-entry loop, so under multi-entry the last entry iterated wins and
the commissioner's per-member count describes one arbitrary entry. Meanwhile this
plan's aggregate asks that *every* entry the uid owns is complete. **T2 promised
those can never disagree and, post-multi-entry, they can.**

The plan does not fix `counts`. Last-write-wins is a real defect there and it
belongs to `PLAN-MULTI-ENTRY` §0b, which owns the per-member count and row model;
pulling it in here would drag the row model into a chip. What the plan owes is
**scope honesty**, and it now states it: T2's guarantee is scoped to the current
one-entry-per-uid invariant, and the aggregate's own semantics — *you are done
when all your entries are done* — is the one that stays correct afterwards. The
`counts` defect is written into Out of scope rather than left implied.

**Author's note.** Round 4 found no design error, only two overclaims. That is
the shape a converging review is supposed to take: 3 findings, then 2, then 2,
and the last two both of the form "say less".

---

## Round 5 — codex

**VERDICT: REVISE.** Two findings, **both accepted**. The first closed the
denominator question that rounds 3 and 5 had been squeezing from opposite sides.

### 1. (P2) Use a trusted roster source for the denominator
> *"For legacy pools, `participantIds` is not sufficient evidence that a UID is a
> player: the callable's own authorization comments document that managers could
> historically add arbitrary UIDs to this array and that the rules change did not
> repair existing arrays. Counting it unconditionally means an actual participant
> can see a permanently inflated `total` (and incomplete count) for forged/stale
> UIDs that never had a canonical membership record or entry. Specify a migration
> or a trusted membership source/filter for this aggregate rather than treating
> `participantIds` alone as the roster."*

**ACCEPTED, and it is right out of this callable's own header**, which says of
`participantIds`: *"that array was CLIENT-WRITABLE BY A MANAGER until this
change… a rule only governs FUTURE writes… locking the door does not evict who is
inside."* The plan cited that file for its authorization argument and then used
the array it distrusts as a source of truth.

**Rounds 3 and 5 together squeezed the denominator to one answer.** R3 killed
"owners of entry documents" — incomplete, misses the player who joined and never
picked. R5 killed `participantIds` — complete but forgeable. The `members`
subcollection is both complete and trusted and costs an O(roster) read per call,
which is the read qodo had this callable stop doing.

**Resolution: `pools/{poolId}/rosterSummary/current.memberCount`** — the
server-written, member-readable roster projection
(`functions/src/lib/rosterSummary.ts:35-45`) whose `memberCount` is literally
`members.length` over canonical Member Records (`shared/memberRecord.ts:305`).
**The O(roster) truth, already computed and cached, for one document read.**
`complete` stays in the entries loop, which is safe from forged uids because an
entry document only exists if a server submit path made one, and is clamped to
`total`.

**And the fallback is to show nothing.** No `rosterSummary/current` ⇒
`{0, 0}` ⇒ the chip hides. Falling back to `participantIds` reintroduces r5's
objection; falling back to entry owners reintroduces r3's silent "12 of 12". D7
now says outright: **a number we cannot stand behind is not shown.** Carried to
Kevin as **Q4**, because it costs one extra read on a polled path and that is his
call, not mine.

### 2. (P2) Remove the superseded entry-denominator instruction
> *"This sweep still tells implementers that D1 is entries rather than players,
> even though S6 and the main plan reverse that decision. The later summary only
> marks the S1 conclusion superseded, not this S5 conclusion, so following S5 can
> reintroduce the multi-entry denominator mismatch the plan is intended to
> avoid."*

**ACCEPTED. Third round in a row on this one class of defect, and the third
distinct copy of the same stale sentence.** Round 2 found it in the sweeps'
summary; round 3 found it in S2's body; round 5 found it in S5's body. Each fix
corrected the copy it was pointed at.

The lesson is now applied rather than re-learned: this round I searched every
section for the superseded conclusion instead of editing the one cited, and both
S5's body and the summary line are struck.

**Author's note.** Findings by round: 3, 2, 2, 2, 2 — not converging on count,
but the SEVERITY is: two P1s in rounds 2–3, none since, and rounds 4–5 are
documentation integrity plus one sourcing question. Nothing in rounds 4 or 5
changed what gets built beyond where the denominator is read from.

---

## Round 6 — codex

**VERDICT: REVISE.** Two findings, **both accepted**. The P1 killed the round-5
design and replaced the clamp with an actual fix.

### 1. (P1) Filter completed owners against the canonical roster
> *"When a departed member retains a complete entry while a current roster member
> has no entry, counting distinct owners from the entries scan and using only
> `memberCount` for `total` can report everyone complete (then clamp it) even
> though a current player has not picked. The existing callable explicitly retains
> departed entries, and `rosterSummary/current` contains no UID set with which to
> exclude them; use canonical member UIDs (or extend a server-only projection with
> them) for the numerator and add this mixed departed/no-entry case to the
> regression tests."*

**ACCEPTED. The round-5 design was wrong and its clamp was the tell.**

Round 5 settled `total = rosterSummary.memberCount` and left `complete` counted
from the entries scan, with `Math.min` on top *"in case a legacy member with an
entry but no Member Record pushes the numerator past the denominator"*. That
clamp was doing more work than it was credited with: **the two halves were
counting different populations**, and the clamp made the symptom tidy rather than
fixing the cause.

The reachable case: a departed member keeps a complete entry (the callable
retains it deliberately, `nflPickReveal.ts:220-228`), a current member has no
entry. The departed player lands in the numerator; the current one lands only in
the denominator; **`complete` reaches `total` on a pool where someone has not
picked** — the exact false "everyone is done" that round 3 removed by the other
road.

Resolution: **`rosterSummary/current` gains `memberUids: string[]`**, and the
numerator counts only entry owners that appear in it. `recomputeRosterSummary`
already holds `membersSnap` in memory (`lib/rosterSummary.ts:37-42`), so it is one
line there, a field on the `RosterSummary` type, and
`ROSTER_SCHEMA_VERSION` 1 → 2. **The clamp is deleted, not adjusted** — with one
set defining both halves it cannot fire.

A schema-version-1 summary is treated exactly as a missing one: `{0, 0}`, chip
hidden, self-healing on the pool's next membership change. **So no backfill, and
the plan therefore still does not touch the prod-data-mutation gate.** The mixed
departed/no-entry case is added to T4 by name.

### 2. (P2) Remove the conflicting no-new-read decision
> *"D5 says this feature adds no new read, but D7 requires reading
> `rosterSummary/current` on every `getPoolPicks` call. These are incompatible
> implementation instructions for a polled callable; remove or revise D5 so the
> documented performance tradeoff consistently includes the additional document
> read."*

**ACCEPTED, and it is the same defect class as rounds 2, 3 and 5:** a decision
corrected in one place and left standing in another. D7 arrived in round 5 and
D5 was not revisited, so the plan said both "no new read" and "one document read
per call" three screens apart.

D5 now says what stayed true — no new collection, no new rule, nothing new
WRITTEN by the feature — and states the read cost where the tradeoff belongs.

**Author's note.** Four rounds out of six have found a superseded sentence left
standing beside its correction. The pattern is not carelessness about any one
edit; it is that **each fix was applied where the reviewer pointed instead of
everywhere the claim appears.** From round 5 onward the response to every finding
includes a search for the claim's other copies. Findings by round: 3, 2, 2, 2, 2,
2 — flat in count, falling in severity, and rounds 4 and 5 introduced no design
change at all beyond the denominator's source.

---

## Round 7 — codex

**VERDICT: REVISE.** Two findings, **both accepted**. The second is the most
valuable finding since round 6 and it is about a test, not the design.

### 1. (P2) Use the canonical summary set for progress membership
> *"This still directs the implementation to filter `progress` with
> `pool.participantIds`, while D7 explicitly rejects that array as
> legacy-forgeable and requires `rosterSummary/current.memberUids` for both
> numerator and denominator. In a legacy pool containing a stale or forged UID,
> following this T1 instruction can again count a non-roster entry or otherwise
> make the two halves use different populations; replace the stale predicate
> guidance (and the matching S2 text) with the schema-2 summary UID set."*

**ACCEPTED. Fifth round finding a superseded sentence standing beside its
correction** — and this one was the worst kind, because it was a **code block**.
T1 still carried the round-2 `onRoster` snippet built off `pool.participantIds`,
and an implementer working from the plan reads the code block, not the prose four
screens down.

Round 6's author's note promised to search for every copy of a claim before
declaring a finding closed. That promise was made about the *round-6* claim and
not applied to the round-5 one. This round I ran
`grep -n "participantIds|stillAMember|onRoster"` across both documents and fixed
every hit, in both files, rather than the cited line.

The snippet is replaced with the `memberUids` form, and both places carry an
explicit "**not `participantIds` either**" with the round-5 reason attached, so
the disqualified source cannot be re-derived from its own plausibility.

### 2. (P2) Assert a nonzero schema-2 progress response in the emulator
> *"The proposed emulator assertion only compares participant and commissioner
> responses. If the fixture has no schema-2 `rosterSummary` (as the existing
> fixtures do), or the callable always returns `{complete: 0, total: 0}`, both
> responses are byte-identical and the test passes; the pure-helper tests do not
> cover the callable's summary read or response wiring. Seed
> `rosterSummary/current` with `memberUids` and assert the expected nonzero
> progress value through `getPoolPicks`."*

**ACCEPTED, and this is the finding worth the whole round.**

The plan's headline emulator assertion was "participant and commissioner get
byte-identical `progress`". **`{0, 0} === {0, 0}` satisfies it.** The existing
fixtures carry no schema-2 summary, so under D7's own hide-rather-than-guess rule
the callable would return `{0, 0}` to everyone and the test would pass green
against a feature that does nothing — while the pure-helper tests, by
construction, never touch the summary read or the response wiring at all.

**That is the exact failure this repo has shipped three separate times: a guard
that looks like it guards and does not.** CLAUDE.md §2c cites it as the reason
rounds 2+ exist.

T4 now requires the fixture to seed `rosterSummary/current` with `memberUids` and
to assert a **specific nonzero pair** through the callable *before* comparing
principals, plus an end-to-end schema-1 case proving the `{0, 0}` branch is
reached deliberately rather than by accident. The round-6 departed/no-entry case
moves into the emulator suite too, since that is where the two populations
actually meet.

**Author's note.** Both findings are about the plan describing something it had
not checked: a stale snippet, and an assertion that cannot fail. Neither changed
the design. Severity by round: P1s in 2, 3 and 6; rounds 4, 5 and 7 are P2-only.

---

## Round 8 — codex

**VERDICT: REVISE.** One finding, **accepted**. A P1, and it caught the plan
about to break its own round-3 fix from the opposite direction.

### 1. (P1) Exclude non-playing managers from the progress roster
> *"When a pool owner hosts but does not play, this plan will include them in
> `memberUids` and therefore `total`, even though pool creation explicitly seeds
> that manager with `hasPlayableEntry: false` because hosting is not playing
> (`functions/src/nflPools.ts:194-201`). Since they have no entry, they can never
> enter the numerator, so every such pool permanently reports one extra incomplete
> 'player' (for example, `3 of 4` instead of `3 of 3`). Define the projection as
> eligible players—excluding a manager until they have a playable entry—and add
> this case to the aggregate tests."*

**ACCEPTED.** Verified at `functions/src/nflPools.ts:194-201`, comment verbatim:
*"Hosting is not playing: owner feeOwed stays 0 until they submit an entry (ADR
0005)"*, seeding the owner's Member Record with `hasPlayableEntry: false`. A host
who never enters sits on the roster permanently, cannot ever have an entry, and
so is stuck outside the numerator. **Every owner-hosted, owner-not-playing pool
reads "3 of 4" for the rest of the season** — a chip that never reaches "everyone
is in" is worse than no chip.

**The trap in this finding is the obvious fix, and it would have undone round
3.** `hasPlayableEntry` is `false` for the non-playing host **and** for an
ordinary member who joined and has not picked yet — the two are identical in the
data. Filtering the roster on that latch alone drops the second population, which
is precisely the silent "12 of 12" that round 3's P1 removed. **Two accepted
findings in the same cycle, pulling in opposite directions on one field.**

Resolution: the projection field is **`playerUids`**, not `memberUids`, and the
filter is `hasPlayableEntry === true` **OR NOT A COMMISSIONER** —

```ts
const commissioners = new Set([pool.ownerId, pool.managerUid, ...(pool.coManagers ?? [])].filter(Boolean));
const playerUids = members.filter(m => m.hasPlayableEntry === true || !commissioners.has(m.uid)).map(m => m.uid);
```

The commissioner is the one uid the system puts on a roster for a reason other
than playing, so it is the only one the filter may drop, and only while its latch
is false. **A commissioner who does play flips the latch on their first
submission and rejoins the denominator by the normal route** — no special case,
no manual list.

T4 gains the two cases **in one fixture, deliberately paired**: a non-playing host
excluded from `total`, and a joined-never-picked member included in it. A filter
that cannot tell them apart fails one of the two assertions, which is the whole
point of putting them in the same test.

**Author's note.** Round 8's P1 and round 3's P1 are the same field read two
ways, and the plan could have satisfied either alone while breaking the other.
That is the argument for the review log being a log: without round 3 written down
verbatim, round 8's obvious fix looks correct.

---

## Round 9 — codex

**VERDICT: REVISE.** One finding, **accepted**. It narrowed round 8's fix, which
had over-reached in exactly the way round 8's own note warned about.

### 1. (P2) Keep unpicked co-commissioners in `playerUids`
> *"`coManagers` are canonical pool members, not hosts: `setPoolCoCommissioner`
> only permits an existing Member Record. A co-commissioner who has not yet
> submitted a pick has `hasPlayableEntry !== true`, so this predicate excludes
> them from the denominator and can report everyone complete while that player has
> not started. Limit the non-playing-host exception to the actual host/manager
> record (and preserve the unknown-latch fallback), rather than applying it to all
> co-commissioners."*

**ACCEPTED, on both halves.**

Round 8 wrote the exception as "is a commissioner", sweeping `coManagers` in
alongside the host. But a co-commissioner is a **member promoted to
co-commissioner** — `setPoolCoCommissioner` only accepts an existing canonical
Member Record, so they joined as a player and are playing. Excluding an unpicked
one reproduces the round-3 defect on a smaller population: *everyone complete*
while a real player has not started.

The second half is subtler and also right: round 8's predicate was
`hasPlayableEntry === true || !commissioners.has(uid)`, which drops a host whose
latch is **undefined** — a legacy record that is not evidence of anything.
`functions/src/lib/memberRecord.ts` keeps an explicit "unknown is not false"
discipline for this field and the plan should not quietly break it.

The predicate is now **narrow on both axes** — the `ownerId`/`managerUid` record
only, and only when the latch is **explicitly `false`**:

```ts
const hosts = new Set([pool.ownerId, pool.managerUid].filter(Boolean));
const playerUids = members.filter(m => !(hosts.has(m.uid) && m.hasPlayableEntry === false)).map(m => m.uid);
```

The D7 warning box is rewritten as three bullets — not the latch alone (r3), not
every commissioner (r9), not falsy (r9) — each carrying the round that holed it,
so the next person cannot re-derive any of the three wrong forms from first
principles. T4 gains the unpicked co-commissioner and the undefined-latch host.

**Author's note.** Round 8's own note said its P1 and round 3's were "the same
field read two ways" and that either fix alone could break the other. Round 9
found a third reading of the same field. Three rounds on one boolean is the
strongest evidence in this log that the plan gate earned its cost here: none of
this would have been visible in a diff, because the predicate is one line and
every wrong version of it looks reasonable.

---

## Round 10 — codex — THE CAP

**VERDICT: REVISE.** Two findings, **both accepted**. Both narrow the same
one-line predicate, for the fourth and fifth time.

### 1. (P1) Exclude only the actual non-playing host
> *"When `managerUid` is a distinct participant, this removes that player from
> `playerUids` until they submit a pick, so the chip can report everyone complete
> while the manager has not started. This is a supported shape:
> `isPoolOwnerOrManager` explicitly treats `managerUid` as a separate principal,
> and the existing blind-picks emulator fixture makes `BOB` both a participant and
> a distinct `managerUid`; derive the host exception from the owner identity
> (including its legacy fallback), not every manager UID."*

**ACCEPTED.** Round 8 seeded the exception from `[ownerId, managerUid]` on the
assumption they name the same person. They do not: `isPoolOwnerOrManager` treats
them as separate principals, and **the repo's own blind-picks emulator fixture —
the very file T4 will add tests to — already has `BOB` as both a participant and
the pool's `managerUid`.** Under round 9's predicate that player leaves the
denominator until they pick, which is round 3's defect a fourth time.

Only the record **seeded at pool creation** is the non-playing host, and that
record is the OWNER's (`nflPools.ts:194-201`). `managerUid` survives only as the
legacy fallback for a pool carrying no `ownerId`: `pool.ownerId ?? pool.managerUid`.

### 2. (P2) Filter the projection to canonical member records
> *"This builds `playerUids` from every document in `members`, although the
> repository explicitly records historic forged member documents that lack
> `joinedAt` and provides `isCanonicalMemberRecord` for roster-truth consumers.
> After the next summary recomputation, such a document would be promoted into the
> supposedly trusted denominator and permanently inflate the incomplete-player
> count; filter canonical records before applying the host rule."*

**ACCEPTED, and it is round 5's finding arriving through a different door.** Round
5 rejected `participantIds` because a manager could historically forge entries
into it. The `members` subcollection has its own pre-#344 forgery history, and the
repo already carries the discriminator — `isCanonicalMemberRecord`
(`shared/memberRecord.ts:188`, `joinedAt` present), used by every roster-truth
consumer including `assertPickReader` in this very callable. The plan reached for
`members` as "the canonical source" and then did not apply the canonicality test.

`playerUids` now filters `isCanonicalMemberRecord` **before** the host rule.

**Author's note.** Five rounds — 3, 8, 9 and both of 10 — on a single-line
predicate over one boolean and one uid. Every wrong version was defensible in
isolation and each was found only by someone re-reading the source rather than the
plan. This is the clearest evidence in the log for why the plan gate exists: the
predicate is four lines of code, it would have looked correct in review, and the
failure mode in all five cases is a **silently reassuring number** — the chip
saying everyone is done when they are not.

---

## Round 11 — codex — FIRST OF THE FIVE KEVIN AUTHORISED

Kevin, 2026-08-21, on the over-cap question: *"Q5 - Go for additional (up to
15)."* Rounds 11–15 are authorised; the reason is the resolution status below.

**VERDICT: REVISE.** One finding, **accepted**. It struck a claim added in the
same edit that recorded his sign-off.

### 1. (P2) Do not infer production cardinality from a hidden UI
> *"`MULTI_ENTRY_WIZARD_ENABLED` only hides the settings controls; it does not
> prevent an authorized commissioner from calling `updatePoolSettings` with
> `maxEntriesPerUser > 1`, after which the shipped `submitNFLPicks` callable
> accepts `entryIndex: 2`. Thus pools can already contain multiple entries through
> the supported server APIs, making the asserted one-entry invariant (and the
> plan's 'cannot disagree today' premise) unsafe unless production data is checked
> or those callables are additionally gated."*

**ACCEPTED.** The plan had just written *"every pool in production is one entry
per player right now"* on the strength of a `false` constant that hides two form
controls. **A hidden button is not a gate.** T2 (#450) shipped the server half
deliberately: `updatePoolSettings` permits a raise of `maxEntriesPerUser` and
`submitNFLPicks` honours `entryIndex`, so the shape is reachable through the
supported callables by anyone who can call them.

It is the same error this log has now recorded five times in different clothes —
**reasoning from a label, a name or a UI instead of from the code that enforces
the thing.**

Resolution: the claim is struck and replaced with what is actually true — the
control is hidden, the server is not gated, and production cardinality is
**unmeasured**. Nothing in the design depended on it: `playerUids` is a set of
owners and a player is complete only when every entry they own is complete, which
is correct for one entry and for three. The only claim genuinely scoped to the
single-entry invariant is T2's "can never disagree with the commissioner's
column", and T2 already carries that scope in its own words (codex r4).

**Author's note.** The finding lands on a sentence written to ANSWER Kevin's
multi-entry question, which is the sentence most likely to be believed. Worth the
round on its own.

---

## Round 12 — codex

**VERDICT: REVISE.** One finding, **accepted**, and it is round 11's finding
surviving round 11's fix — for the sixth time in this log, a correction applied
where the reviewer pointed instead of everywhere the claim appears.

### 1. (P2) Qualify the claim that multi-entry cannot be switched on
> *"This directly contradicts the server-path explanation below it: a pool
> owner/manager can call `updatePoolSettings` to raise `maxEntriesPerUser`, and
> members can then submit `entryIndex: 2`. The UI toggle cannot be enabled today,
> but multi-entry itself can already be enabled through supported callables;
> leaving the unqualified statement risks repeating the production-state inference
> this edit is intended to correct."*

**ACCEPTED.** Round 11 struck *"every pool in production is one entry per
player"* and wrote a full box explaining that the flag hides a control rather
than gating a server — and left the section's own **bold heading** reading
*"Has it been done: NO, and it cannot be switched on today."* The heading is the
line a reader takes away; the box four paragraphs down is the line they do not
reach.

This round I again grepped for every phrasing of the claim rather than editing the
cited line, and found a third instance in T1's bullet ("today an NFL entry id IS
the uid, so this collapses to one entry per player") — fixed in the same pass,
uncited.

The heading now says what is true: **the server half is shipped, the member half
is not, and no UI offers it** — with the false clause named as false so it cannot
be reinstated by someone who remembers the old sentence.

**Author's note.** Six rounds of this log have found a superseded claim standing
beside its correction, and rounds 11 and 12 are the same claim twice. Grepping for
the claim is now the documented response to any finding of this class, and it is
what found the third instance here.

---

## Round 13 — codex

**VERDICT: REVISE.** One finding, **accepted**. Third round running on the same
paragraph, and each one has been correct.

### 1. (P2) Correct the manager-settings UI availability claim
> *"For a pool already raised through `updatePoolSettings`, the manager UI does
> offer this control: `NFLManagerView` renders the 'Entries per Player' input
> whenever `currentMaxEntries > 1`, even while `MULTI_ENTRY_WIZARD_ENABLED` is
> false. The plan's statement that both the wizard and manager form hide it (and
> the preceding 'no UI offers it' conclusion) is therefore inaccurate for the exact
> supported-callable scenario it describes."*

**ACCEPTED.** The two surfaces gate differently and the plan had flattened them
into one sentence:

```tsx
MultiEntryFields.tsx:29   if (!MULTI_ENTRY_WIZARD_ENABLED) return null;
NFLManagerView.tsx:1070   {(MULTI_ENTRY_WIZARD_ENABLED || currentMaxEntries > 1) && (
```

The wizard hides it unconditionally. **The manager form re-opens it for any pool
whose max is already above 1** — precisely the pool the round-11 and round-12
findings were about. So the flag keeps a door shut on new pools and does not lock
it: raise a pool once through the callable and its commissioner gets the control
back in the UI, with the raise-only gate letting them go further.

The conclusion is narrowed to what is true — **no UI offers it on a NEW pool** —
and the two gates are quoted rather than paraphrased, because paraphrasing them
into one clause is what produced three rounds of findings.

**Author's note.** Rounds 11, 12 and 13 are one paragraph, three wrong claims,
each written while fixing the previous one: *"production is single-entry"*, then
*"it cannot be switched on"*, then *"both surfaces hide it"*. Every one came from
reading a flag's NAME and not its call sites. The grep habit adopted in round 12
catches restatements of a claim; it does not catch a NEW wrong claim invented in
the fix. What would have: reading the two call sites before writing about them,
which is the whole thesis of this log.

---

## Round 14 — codex

**VERDICT: REVISE.** Two findings, **both accepted**.

### 1. (P2) Update the stale review-resolution status
> *"The newly authorized rounds 11–15 and completed rounds 11–13 leave the
> terminal status below asserting that the process stopped at round 10, round 10's
> fixes are unreviewed, and Kevin's sign-off is still the next gate. This gives
> implementers contradictory release guidance; update that resolution section and
> its counts/table to reflect the authorization and completed rounds."*

**ACCEPTED, and it is embarrassing in the right way.** The resolution status still
read *"STOPPED AT THE CAP … round 10's two fixes are UNREVIEWED … Next gate:
Kevin's sign-off"* while four further rounds had run, Kevin had answered all five
questions, and round 10's fixes had been reviewed three times over. **Every clause
of the document's release guidance was false.** It had also lost its own `##`
heading somewhere in the round-11/12/13 edits and was hanging off the end of round
13 — which is how it went unread while being edited around.

Same defect class as rounds 2, 3, 5, 7, 11, 12 and 13 — a correction made in one
place and not carried to the place that summarises it — landing this time on the
section whose only job is to say where the process stands.

### 2. (P2) Qualify the UI-reachability claim for multi-entry pools
> *"This says every UI-reachable pool is not configured for multi-entry, but the
> immediately preceding explanation establishes that once a pool is raised through
> the callable, its commissioner can access the manager UI and continue raising its
> entry limit. Restrict this to newly created pools/the wizard, otherwise the Q1
> decision text reintroduces the same false availability claim that round 13 just
> corrected."*

**ACCEPTED. Fourth instance of one claim, fourth consecutive round.** Round 13
corrected the box; the Q1 bullet three paragraphs below it still said *"every pool
reachable through the UI"*. It is now scoped to what the WIZARD can create and
**points at the box instead of restating it** — restating is what has gone wrong
all four times.

---

---

## Round 15 — codex — THE LAST AUTHORISED ROUND

**VERDICT: REVISE.** One finding, **accepted**.

### 1. (P2) Do not mark the plan signed before round 15 completes
> *"Round 15 is explicitly still required before implementation, and the review
> log says the artifact is signed only if that round is clean. Marking the
> implementation status as signed now contradicts that gate and can cause readers
> to treat the plan as build-ready before its final authorized review."*

**ACCEPTED, and the underlying mistake is a conflation worth naming.** The plan's
header said **"SIGNED 2026-08-21"** on the strength of Kevin answering Q1–Q5 —
but "signed" in this repo's gate means BOTH halves of Rule 3: the user's sign-off
**and** the adversarial review being spent. One word was doing two jobs, and it
read as build-ready while a required round was outstanding.

The header now states the two gates separately, each with its own status, so
neither can be inferred from the other. **Kevin's sign-off: given. Review: 15
rounds, the full authorisation, spent.**

⚠️ **THIS FIX IS ITSELF UNREVIEWED** — it was written after the fifteenth round
and no sixteenth has run. Recorded rather than glossed, which is the same
discipline round 10 applied at the previous cap. The change is a header's wording;
CLAUDE.md §2c leaves a further round to Kevin.

**Author's note.** Nine of fifteen rounds found a claim contradicted elsewhere in
the same document, and this is the ninth. It is also the first where the stale
claim was created by the act of recording a decision — the plan became wrong at
the moment it was told it was right.

---

## Resolution status — FINAL

**COMPLETE. 15 of 15 authorised rounds run. Converged on severity, never on
count.**

**15 rounds, 25 findings, 25 accepted, 0 rejected, 0 disputes.**

| Round | Findings | Severity | Subject |
|---|---|---|---|
| 1 | 3 | P2 ×3 | empty slate; wrong test suite; the denominator's UNIT |
| 2 | 2 | **P1**, P2 | `stillAMember` is principal-specific; a superseded conclusion |
| 3 | 2 | **P1**, P2 | joined-but-no-entry omitted from `total`; a superseded conclusion |
| 4 | 2 | P2 ×2 | the client's mirrored response type; a multi-entry overclaim |
| 5 | 2 | P2 ×2 | `participantIds` is forgeable; a superseded conclusion |
| 6 | 2 | **P1**, P2 | a count alone cannot exclude departed owners; D5 contradicted D7 |
| 7 | 2 | P2 ×2 | a stale code block; **a test that could not fail** |
| 8 | 1 | **P1** | the non-playing host inflates `total` for ever |
| 9 | 1 | P2 | co-commissioners are players; unknown-is-not-false |
| 10 | 2 | **P1**, P2 | `managerUid` can be a player; forged member records |
| 11 | 1 | P2 | a hidden UI is not a server gate |
| 12 | 1 | P2 | …and the heading still said it was |
| 13 | 1 | P2 | …and the two UI surfaces gate differently |
| 14 | 2 | P2 ×2 | the resolution status was stale; the same claim a fourth time |
| 15 | 1 | P2 | "signed" conflated Kevin's sign-off with the review being spent |

**Five P1s, all in rounds 2–10. Rounds 11–15 were P2-only** — documentation
integrity, not design.

**Kevin's rulings, 2026-08-21:** Q1 **players** — questioned by him, re-argued
against the measured state of multi-entry, and it held; Q2 **yes**; Q3 **yes**;
Q4 **yes**; Q5 **rounds up to 15 authorised**.

**What the fifteen rounds bought:**

- **Two design reversals**: the denominator's unit (r1) and its source (r3, r5,
  r6).
- **Five corrections to ONE four-line roster predicate** (r3, r8, r9, r10 ×2).
  Every wrong version was defensible alone; every one produced a **falsely
  reassuring** chip — "everyone is done" when they are not. None would have been
  visible in a diff, because the predicate is four lines.
- **One test that could not fail, caught before it was written** (r7): the
  headline emulator assertion was "participant and commissioner get identical
  `progress`", and `{0,0} === {0,0}` satisfies it.
- **Nine instances of a claim contradicted elsewhere in the same document**
  (r2, r3, r5, r7, r11, r12, r13, r14, r15) — the dominant failure mode here, and
  the whole yield of rounds 11–15.

⚠️ **ROUND 15'S FIX IS UNREVIEWED**, as round 10's was at the previous cap. It is
a header rewording. A sixteenth round is Kevin's to authorise and is **not**
recommended: rounds 11–15 returned no design finding, and the marginal value has
clearly flattened.

**NEXT GATE: IMPLEMENTATION**, against T1–T4 as written. No code exists yet.
