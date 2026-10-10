# PLAN-MEMBER-PICKS-VISIBILITY — adversarial review log

Reviewer: `codex` (OpenAI), read-only, pointed at the plan and told to attack it
rather than summarise it. Rounds are logged verbatim in substance, with the
author's accept/reject and what changed in the plan.

---

## Round 0 — `codex exec review --base origin/main`

**VERDICT: clean.** *"The change only adds a draft implementation plan and does
not modify runtime code… Its stated facts and proposed constraints align with the
referenced current implementation."*

**Author's response.** Recorded, but treated as a **weak signal and not a round**.
`codex exec review` reviews a DIFF; on a docs-only diff it checks that the prose
matches the code it cites, which is not the same as asking whether the plan is a
good idea or whether it has holes. Round 1 was run as an explicit adversarial
prompt for that reason. The distinction is worth keeping: a clean diff review of
a plan document means almost nothing.

---

## Round 1 — adversarial read (8 findings)

### 1. BLOCKER → **ACCEPTED IN REMEDY, SEVERITY REJECTED**

> D5 authorizes on a field the repo itself says is client-writable. `participantIds`
> is not in the protected-field list (`firestore.rules:91-135`) while a manager can
> update editable pools (`firestore.rules:300-310`). A manager could add an
> arbitrary UID to `participantIds`; T1 would then give that UID all currently
> revealed picks. The repository's actual shared predicate accepts either a
> canonical Member Record or the array, not the plan's "never Member Record"
> assertion.

**The factual half is CONFIRMED and I verified it independently rather than
taking it on trust.** `protectedFieldsUnchanged()` lists `participants` — it does
**not** list `participantIds`. A pool manager can write that array from the
client on an editable pool.

**The severity is rejected, with the repo's own reasoning as the evidence.**
`isProvableMember` (`shared/memberRecord.ts:181-187`) already considered exactly
this and ruled the other way, in a comment written for this purpose:

> *Evidence 2 — the pool's own cross-type membership set. Every join path writes
> it, and writing it needs `isPoolManager()`, so no self-add. **A manager listing
> someone as a participant IS membership.***

A manager adding a UID to their own pool is not an escalation — it is the
definition of adding a member. And the "attack" grants a confederate access to
picks **the manager can already see in full and could simply tell them**. There
is no privilege gained.

**But the finding is right that the plan was wrong**, in two ways worth fixing:

- D5 said "never a Member Record", which **contradicts the canonical predicate**.
  `isProvableMember` accepts either evidence, and `shared/memberRecord.ts:159-163`
  explicitly forbids re-deriving the rule in a caller: *"two doors with two copies
  is how one of them ends up wrong."* My D5 proposed being that second door.
- The justification was circular — see finding 6.

**Plan changed:** D5 now says **use `isProvableMember`**, the one definition, and
hand-roll nothing. The "never a Member Record" sentence is deleted. The residual
(a manager can extend membership, and that is by design) is written down rather
than left implied.

### 2. HIGH — **ACCEPTED**

> D1 incorrectly calls `counts` the only disclosure worth naming. [Full
> field-by-field audit of `PoolPicksResponse` supplied.] The plan never explicitly
> audits confidence ranks or the predicted-score secret. The unmentioned practical
> leak is also **which UIDs have entry documents**: every map is built by iterating
> the complete `entries` collection, not active membership.

**Accepted.** The audit's conclusions agree with D1 — `confidence` and
`tiebreakers` are already reveal-gated (`nflPickReveal.ts:211-221`), so `counts`
remains the only field that crosses the boundary. But "I checked and the rest are
fine" is a claim the plan never made and therefore never had to defend, and a
reviewer should not have to redo it.

**Plan changed:** the field-by-field audit is now **in the plan as §3a**, so the
next reviewer inherits it. The entry-existence disclosure is a new decision, D8.

### 3. HIGH — **ACCEPTED. The best finding of the round.**

> Former/voided members' picks can be disclosed early. The callable queries every
> entry and never filters against an active roster (`nflPickReveal.ts:185-209`).
> Removal deletes the Member Record and `participantIds` but **does not delete the
> entry** (`lib/memberRecord.ts:186-190`). An active participant can receive a
> departed player's revealed picks, counts, confidence and tiebreaker.

**Accepted, and nothing in the plan came close to this.** It is invisible today
because the only readers are the commissioner and SUPER_ADMIN, for whom seeing a
departed player's entry is unremarkable. Admitting participants is what turns it
into a disclosure of one member's data to another.

**Plan changed:** new decision **D7** and a new ticket. Recommendation is to
filter the response to rows the pool still recognises, which also fixes the
grid's row set — `buildMemberStandings` already drops those players, so today the
callable returns data for rows the UI does not render, and the two would diverge
further under B.

### 4. HIGH — **ACCEPTED. My plan contradicted itself.**

> T3 and T4 contradict each other. T3 says drop `isManager` but "keep the
> pool-type gate", which yields Pick'em-only member visibility and no route for
> the Margin/Survivor grid promised by T4.

**Accepted without reservation.** The gate is
`pool.type === 'NFL_PICKEM' && isManager`; T3 as written removes the wrong half.

**Plan changed:** T3 now states the gate explicitly — the tab is offered for all
three NFL types to any provable member, and the COMPONENT chosen depends on the
type. The invariant test that currently asserts the `isManager` gate is named as
something that must change deliberately.

### 5. MEDIUM — **ACCEPTED**

> D2's storage claim is correct, but the callable accepts weeks through 23
> (`schemas/pickReveal.ts:4-8`) while the dashboard clamps to 1–18. The planned
> multi-week grid has no stated postseason policy.

**Accepted.** A players × weeks grid has to decide its column set, and "18"
is a guess that the schema does not share.

**Plan changed:** new question **K7**. Recommendation: columns come from the
loaded SCHEDULE (`poolSeasonWeeks`, which `NFLResults` already uses for exactly
this), never a hardcoded count — a preseason pool has four.

### 6. MEDIUM — **ACCEPTED (conclusion stands, justification was circular)**

> "No `firestore.rules` change" is mechanically correct… However, the plan's claim
> that matching the entries rule's authority makes `participantIds` trustworthy is
> false. The existing rule is not validation for that predicate.

**Accepted.** D4's conclusion — change no rules — survives and is now
independently supported. Its supporting sentence did not: I argued the predicate
was safe *because the rules use it*, which is circular, and the rules using a weak
predicate is an argument about the rules, not about my callable.

**Plan changed:** the circular sentence is gone. D4 now rests only on the fact
that the callable is strictly earlier than the rules path, so the rules grant
nothing extra.

### 7. MEDIUM — **ACCEPTED**

> R4 requires participant output to be "byte-identical" to commissioner output
> while T2 requires their `counts` to differ pre-reveal. Both cannot be true.

**Accepted.** A flat contradiction, and the kind that produces a test asserting
the wrong thing.

**Plan changed:** R4's oracle is now split — the **reveal-bound** fields
(`picks`, `confidence`, `tiebreakers`, `revealedGameIds`, `weekRevealed`) must be
identical for every principal; the **principal-specific** field (`counts`) is
compared against its own spec.

### 8. MEDIUM — **ACCEPTED**

> D6's polling plan does not describe the required multi-week state model. The
> dashboard holds ONE `{poolId, data}` response and accepts it only when its week
> matches. A players × weeks grid cannot consume N one-week responses through that
> state shape. "Fetch once" is insufficient specification.

**Accepted, and it is sharper than it looks** — the single-slot state shape is
the one *I* built in #430 to fix the cross-pool staleness bug, so B is blocked on
generalising the very guard that PR added.

**Plan changed:** D6 now specifies a pool-scoped, **week-keyed** cache; the
existing `{poolId, data}` stamp becomes `{poolId, byWeek}`; each week keeps its
own `revealedGameIds`, because the allowlist is per week and merging them is how
one week's reveal would open another's.

---

## Resolution status after round 1

**8 findings, 8 accepted in remedy, 1 with its severity rejected on evidence.**
No disputes carried. The round changed the plan materially — three new decisions
(D7, D8), one new question (K7), two corrected contradictions, and one
authorization predicate replaced with the repo's canonical one.

⚠️ **NOT CONVERGED.** A round that changes this much is not a round to stop on,
and the plan's own history says so: round 1 finds defects in the plan, round 2
finds defects in the fixes. **Round 2 must run against the revised plan before
Kevin's sign-off is meaningful**, and the sweep (T7) has not been written at all.

---

## Round 2 — adversarial read of the ROUND-1 FIXES (4 findings)

The round-1 log predicted this round would find defects in the fixes. It did,
including one that **overturns a severity call I made in round 1**.

### 1. HIGH — **ACCEPTED**

> T1/T8 cannot use `isProvableMember` faithfully with the callable's current data.
> The predicate requires `(pool, memberRecord, uid)` and the callable has only the
> pool and the entries (`nflPickReveal.ts:118-120, 185-201`). Passing `undefined`
> for `memberRecord` **silently reduces it to `participantIds` only**, rejecting
> the canonical records it intentionally accepts. Cost: one extra read for T1 plus
> one per entry for T8; a bulk `members` query reduces it to ~one read per Member
> Record but still adds O(roster) billed reads to every invocation.

**Accepted.** D5's fix was "call the canonical predicate" and it did not notice
that calling it *correctly* needs data the callable never reads. Passing
`undefined` would have reproduced the exact hand-rolled `participantIds` check
D5 was written to remove — **while looking like it had been fixed**, which is the
worse failure.

**Plan changed:** T1/T8 now specify a single bulk `members` query, read once and
reused for the caller check and the row filter. The O(roster) read cost is stated
in D6 rather than discovered in a billing alert.

### 2. MEDIUM — **ACCEPTED**

> T8 filters before response assembly, so it also removes departed entries for
> commissioners and SUPER_ADMIN — contradicting `fullReveal` (`:141-143`) and the
> plan's own "SUPER_ADMIN gets everything, always".

**Accepted.** I wrote a global filter for a participant-shaped problem. No
current screen breaks (the reviewer checked: `buildMemberStandings` already drops
those rows), but it silently narrows a privileged API.

**Plan changed:** T8 is **scoped to the participant principal only**. Owner,
manager and SUPER_ADMIN keep today's unfiltered response.

### 3. HIGH — **ACCEPTED. This REVERSES my round-1 rejection.**

> The round-1 severity rejection is not sound. A manager can client-write
> `participantIds` on a `DRAFT`/`OPEN` pool and grant an arbitrary account
> **continuing, self-service** access to the revealed-pick feed. That account can
> poll independently and obtain FUTURE reveals without the manager making another
> disclosure. "A manager could simply tell them" is not equivalent to granting an
> authenticated principal a durable API capability. The shared predicate's comment
> establishes membership semantics for its existing roster/payment uses; it does
> not settle whether manager-controlled enrollment is sufficient authority for
> this newly sensitive read.

**Accepted, and the round-1 rejection is withdrawn.** The distinction is real and
I collapsed it: a one-time verbal disclosure and a durable, self-refreshing API
capability are different things, and only the second survives the manager losing
interest. My reasoning was also circular in a way I did not notice — I cited
`isProvableMember`'s comment as settling the question, but that comment was
written about **roster and payment** surfaces, and a comment cannot pre-authorise
a read that did not exist when it was written.

**Plan changed:** the residual in D5 is promoted from "accepted, written down" to
**K9 — a decision Kevin must make**, with the durable-capability framing stated
plainly. It is now the most consequential open question in the plan.

### 4. MEDIUM — **ACCEPTED. The sharpest finding of the round.**

> T9 protects only the easy half of the cross-week leak. For weekly pools the pick
> key is the WEEK NUMBER, admitted only when `weekRevealed` is true — `revealedGameIds`
> alone does not authorize it (`nflPickReveal.ts:145-150`). Concrete failure: cache
> week 1 revealed and week 2 open; a multi-week component reads a shared
> `weekRevealed` while rendering all columns and renders `row.picks["2"]` for the
> week-2 column, leaking week 2.

**Accepted.** T9 said "each week keeps its own `revealedGameIds`" and that is the
wrong field for exactly the pool types B exists to serve. Survivor and Margin key
picks by week number, so `weekRevealed` is their allowlist — and a single shared
copy of it across a multi-week grid is a leak with a concrete reproduction.

**Plan changed:** T9 now requires each column to carry **its own whole cached
response** — `revealedGameIds` AND `weekRevealed` — and D2 gains the rule that a
weekly-pool cell renders only from the response for ITS week. A test with week 1
revealed and week 2 open is named as required evidence.

---

## Resolution status after round 2

**4 findings, 4 accepted. One of them reversed a round-1 severity rejection**,
which is the single best argument in this log for not stopping at one round.

⚠️ **STOPPING HERE DELIBERATELY, AND NOT BECAUSE IT CONVERGED.** Round 2's
finding 3 turned the plan's central authorization question into an open product
decision (**K9**). Spending further paid review rounds on a plan whose main
question is unanswered reviews a moving target — the answer to K9 changes T1, D5
and the threat model together. **Round 3 runs after Kevin answers §6**, and the
sweep (T7) is still not written.

**Nine questions now block implementation. No code exists.**
