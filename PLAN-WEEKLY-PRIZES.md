# PLAN — weekly prize lists, tiebreaker option change, tie prize-splitting

**Status: ✅ SIGNED 2026-08-15 (D1–D8, "all recommendations"). Review log + sweeps written 2026-08-16; §9 carries the round-10 addenda. Implementation under way — see §8.**
Classification: **money + scoring** → plan-gated (`mmp-change-control` §1).
Written 2026-08-14 (overnight). Supersedes the scope notes in
`PROMPT-NEXT-SESSION-WEEKLY-PRIZES.md`, whose "state when written" section
predates #424–#427.

Kevin has already ruled on the **product behaviour** (see
`PROMPT-NEXT-SESSION-WEEKLY-PRIZES.md` §1–§3, verbatim). What this plan needs
from him is the list of open decisions in §6 — one of which is a **data-safety
conflict that must be settled before a line is written**.

---

## 0. 🛑 LEAD FINDING — the resolver change would move the goalposts under an in-flight week

**This is the one thing in this plan that can destroy something.**

The ask (B1) is: *absent* `weeklyTiebreaker` resolves to `MNF_LAST_GAME`, and a
*stored* `MNF_COMBINED` resolves to `MNF_LAST_GAME` too — "resolver-level
mapping, no migration script".

That instruction was written on 2026-08-13, when the stated assumption was
"invites NOT yet sent, so likely only Kevin's test pools". **Tonight's brief says
the opposite:** Kevin's test pools are IN PROGRESS for the current week and
testing continues tomorrow, and nothing may change what an in-flight week's
prediction means.

⚠️ **UNVERIFIED** — that pool state is Kevin's statement in the session brief,
not something this session measured. No production data was read. If the test
pools turn out to hold no submissions for the current week, D1 loses its urgency
and the simpler re-read becomes safe. **The state is worth re-checking before
acting on D1**, and the check is: does any entry in those pools carry a
`weeklyTiebreakers` value for the current week? (qodo on PR #428 — the repo's
UNVERIFIED convention, `mmp-docs-and-writing`.)

Here is the exact mechanism, measured:

- `effectiveWeeklyTiebreaker` (`shared/nflTiebreaker.ts:34`) resolves anything
  that is not `MNF_LAST_GAME` or `NONE` — **including absent** — to
  `MNF_COMBINED`.
- `computeMNFTiebreakerTotal` (`functions/src/nflScoringEngine.ts:509`) then sums
  **every** Monday game for `MNF_COMBINED`, versus **only the last** for
  `MNF_LAST_GAME`.
- A member who has already submitted a prediction this week did so against the
  copy `tiebreakerCopy('MNF_COMBINED')` printed on their sheet: *"If there are 2
  MNF games, we count the combined score of both games."*

So on a week with two Monday games, flipping the resolver changes the target that
an **already-submitted** prediction is judged against, after the fact. The freeze
gate does not save this: it prevents the *setting* from being changed on a pool
with submissions, and this change moves the meaning of *absence*, which no gate
watches.

### Recommended shape — the default moves, the resolver does not

| | Behaviour |
|---|---|
| **New pools** | `weeklyTiebreaker` is **written explicitly at create**, defaulting to `MNF_LAST_GAME`. |
| **Existing pools with a stored value** | Keep computing exactly what they stored. |
| **Existing pools with NO stored value** | Keep resolving to `MNF_COMBINED` — i.e. exactly what they have been playing. |
| **`MNF_COMBINED`** | Removed from the pickable list in the wizard and manager UI; **retained in the type, the resolver and the copy** as a legacy value. |

This gives Kevin everything he asked for at the point of choice — nobody can pick
"combined" again, and every new pool plays last-Monday-game — while no in-flight
week's target moves. Kevin can flip his own test pools himself from the manager
settings, deliberately, when he wants to.

The cost is honest and small: `MNF_COMBINED` lives on as a legacy branch in
`computeMNFTiebreakerTotal` and in `tiebreakerCopy`. That is one `if` and one
copy block, and it is the price of not rewriting the meaning of a prediction
somebody has already made.

**The alternative Kevin may prefer:** he accepts the re-read for his own test
pools (they are test pools, after all) and takes the simpler code. That is a
legitimate call — but it must be *his*, said out loud, because it silently
changes what an already-submitted prediction means. **Decision D1 in §6.**

⚠️ Whichever he picks, **"no migration script" holds either way** — no batch job,
no backfill, nothing swept across the pool collection.

⚠️ That is NOT the same as "nothing writes to an existing pool document", and an
earlier draft of this section wrongly claimed the stronger thing. §3b's
freeze-on-first-publish **does** write one previously-absent field
(`weeksInSeason`) to an existing pool, in the transaction that first publishes a
weekly prize for it. That is a production-data write and it takes the full Rule-1
treatment — kill-switch, dry-run default, dry-run output reviewed before enabling
(`mmp-change-control`). Leaving the blanket assurance in place is exactly how a
plan walks past that gate. (codex P2, plan review r2.)

---

## 1. Scope

Three interlocking asks. They are one plan because the tiebreaker defines the
diff column, the hybrid split defines the pot, and the tie-split defines the
prize column.

- **B1** — tiebreaker option change (`MNF_LAST_GAME` default, new
  `MNF_FIRST_GAME`, `MNF_COMBINED` unpickable, no-Monday fallback, season-tie
  cascade).
- **B2** — Weekly Winners List: Place / Player / Score / Tie Break Difference /
  Prize.
- **B3** — tie prize-splitting: k players tied at place p consume places
  p..p+k-1, their prizes sum and split evenly, whole dollars.

**Out of scope**, deliberately: anything that rewrites an existing
`weeklyPoints` / `weeklyResults` / `weeklyScores`. This plan adds fields; it
never restates a scored one.

---

## 2. B1 — the tiebreaker options

### 2a. The new option set

| Value | Meaning | Status |
|---|---|---|
| `MNF_LAST_GAME` | Combined total of the LAST Monday game to kick off | **new default** |
| `MNF_FIRST_GAME` | Combined total of the FIRST Monday game to kick off | **new** |
| `NONE` | No tiebreaker; ties are shared | kept — see D2 |
| `MNF_COMBINED` | All Monday games summed | **unpickable, still honoured** (§0) |

`lastMondayGame` (`nflScoringEngine.ts:538`) already sorts by `startTime` desc
with an `id`-desc tiebreak, and documents why kickoff order (not finish order) is
the only order a member could have known. `MNF_FIRST_GAME` is its exact mirror:
`startTime` **asc**, `id` **asc**. The `id` tiebreak is not optional — two Monday
games can share a start time, and Firestore query order is not a promise.

### 2b. No Monday game → the final game of the week

Today `computeMNFTiebreakerTotal` returns `null` when no game has `isMonday`,
which makes every tie unbreakable and shared. Kevin's rule: fall back to the last
scheduled game of the **whole week**.

Both options fall back — `MNF_FIRST_GAME` included, because "first Monday game"
of a Monday-less week is not a thing, and picking the week's *first* game would
be a different question than the one the sheet asked.

⚠️ Consequences that must ship together or the sheet and the scorer disagree:

1. **`showTiebreaker` must stop requiring `isMonday`.** It currently hides the
   input on a Monday-less week; under the new rule the question is always asked
   when a rule is set.
2. **The pick-sheet copy must name the actual game** on such a week ("Predict the
   combined score of *Buffalo at Miami*, the final game of the week"). A member
   asked for "the Monday game" on a week with no Monday game will not answer.
3. **The target game must be frozen — on EVERY week, not just Monday-less ones.**

⚠️ The first draft of this plan froze only the Monday-less fallback, and that is
too narrow. `MNF_LAST_GAME` and `MNF_FIRST_GAME` both resolve their target from
the CURRENT schedule at scoring time, so on an ordinary two-Monday-game week a
later schedule change — a flex move, a postponement, a game gaining or losing
`isMonday` — silently re-points an already-submitted prediction at a different
game. That is the §0 defect exactly, arriving through the schedule instead of
through the settings. (codex P1, plan review r1.)

So: **persist the resolved target at first submission of the week**, for every
rule that asks for a prediction, and judge against the stored value thereafter.
Same shape and same reasoning as `frozenHardLockFor`
(`shared/weeklyHardLock.ts`) — freeze the thing the member was told, at the
moment they act on it.

⚠️ **Freeze a game id LIST, not a single id.** `MNF_COMBINED` survives as a
legacy rule (§0) and its target is *every* Monday game, not one — so a singular
stored id would make a legacy combined prediction score a single game after the
freeze, silently changing the rule for exactly the existing pools §0 exists to
protect. The frozen value is therefore `string[]`: one element for
`MNF_LAST_GAME` / `MNF_FIRST_GAME` / the Monday-less fallback, and the whole
Monday set for `MNF_COMBINED`. The scorer sums the frozen list. (codex P1, plan
review r4.)

⚠️ **Freeze it ONCE PER POOL-WEEK, not per entry.** Storing the target on each
entry as that member submits means a schedule change between two members' submits
gives them **different targets for the same week** — the pick sheet would show one
game and the scorer would use another, and the two members' `tiebreakDiff` values
would be measured against different totals, which makes them incomparable in a
cascade that decides money.

So: a pool-week-level map (`pool.frozenTiebreakTargets.<week> = string[]`),
initialized **atomically on the first submission of that week** and never
rewritten, and **both** the pick-sheet copy and the scorer resolve from it
thereafter. One target per pool-week is the invariant; "what the member was told"
is only correct if every member was told the same thing. (codex P2, plan review
r5.)

⚠️ **The FIRST submitter still needs a handshake.** Freezing inside the first
submission does not protect that submitter: their sheet was rendered earlier, and
a schedule update between render and submit changes which game is first/last — so
the value that gets frozen is not the one they were shown. The submit payload
therefore **carries the target the sheet displayed**, and the server either (i)
stores it as the frozen value when nothing is frozen yet, or (ii) **rejects the
submission and asks the client to reload** when it differs from what is already
frozen. Rejecting is the right failure: the alternative is accepting a prediction
about a game the member never agreed to answer. (codex P2, plan review r7.)

Residual to state on the rules page: if the frozen game is later **cancelled**,
there is no combined score to compare against. Recommendation: the week's
tiebreak becomes unbreakable and the tie is shared, which is the same outcome as
"nobody answered" and needs no new concept. **Decision D3.**

### 2c. Season-prize ties broken by pick record

Kevin: tied season standings break first on **player pick records**, then split.

- **Pick'em**: most correct picks — `Σ weeklyResults[*].correct`. Explicitly NOT
  `totalScore`, which is what they are already tied on. Note this is a real
  discriminator only in confidence mode; in standard scoring points **are** the
  correct count, so the cascade falls straight through to the split. Say so on
  the rules page rather than implying a tiebreak that cannot fire.
- **Margin**: reuse the standings cascade **in full and in order** —
  `negativeBurden` asc, then `positiveWeeks` desc, then `bestWeek` desc.

  ⚠️ The first draft proposed skipping `negativeBurden` because it is a penalty
  count and "reads strangely as a record". That was a mistake with money attached:
  `NFLStandings.tsx` sorts tied season totals by `negativeBurden` FIRST, so
  dropping it would award the season prize to a different player than the
  leaderboard shows as leading — on any tie where the burdens differ. A prize
  order that contradicts the visible standings is the worst possible outcome
  here. (codex P1, plan review r3.)

  If Kevin genuinely wants `negativeBurden` out of the tiebreak, the standings
  sort, the rules page and the prize order change **together**, as one
  deliberate change. **Decision D4.**
- Still tied after the cascade → the prize money splits by the §4 rules.

---

## 3. B2 — the Weekly Winners List

### 3a. Where the data must come from

`recap.weeklyWinners` (#421) holds only the **tied leaders** — `computeWeeklyWinners`
returns the top score's tied set and nothing else. The list needs every **paid
place**.

⚠️ **N is NOT `payouts.places.length`**, and the first draft of this plan said it
was. `payoutPlaceSchema` (`shared/schemas/common.ts:55`) is
`{ rank: positive int, percentage }` in a plain array — **the ranks are sparse
and unordered by construction**. A pool configured `[{rank:1},{rank:3}]` has
`length === 2`, so ranking only the top two omits the third-place recipient
entirely and their configured payout can never be shown or split.

The correct depth is **`max(places[].rank)`**, and the ranking must be allowed to
run past it so a tie straddling the boundary is seen whole. (codex P1, plan
review r3.)

⚠️ **Running past the last paid rank does NOT mean the overflowing players miss
out** — an earlier draft said it did, contradicting §4. Worked example, payouts
to rank 3, three players tied at rank 2: they consume ranks 2, 3 and 4; the
**paid** ranks inside that span are 2 and 3; those two prizes sum and split
**three** ways. Nobody in the tie is dropped, and no earned payout is left
unallocated. Rank 4 has to be computed to know the tie ends there and the next
player starts at rank 5 — not to exclude anyone. (codex P2, plan review r5.)

Deriving places client-side is not possible and the reason is specific: the
client can rank on `weeklyPoints`, but it cannot break a tie, because breaking it
needs `tiebreakDiff`, which needs the **target** — and the target is a scored
figure the client never receives. A client-side list would therefore show a
different weekly winner than the recap does, which is the exact contradiction
#422's shared-rank work existed to remove.

**So the server publishes it.** Extend the recap document with a per-week
`weeklyPlaces` array. The recap is written only on complete passes
(`recapWritten = !dryRun && !provisional`), which is also the reveal-safety
argument — keep that, unchanged.

⚠️ **Additive only.** `weeklyWinners` stays exactly as it is and keeps its
current meaning; `weeklyPlaces` is a new key. Past recaps simply lack it and the
page renders "not published for this week" rather than a fabricated list.
Firestore `set()` throws on a literal `undefined`, so the field is **omitted**,
never written as undefined.

### 3b. The weekly pot — per payout mode

⚠️ **`hybridSplit` exists ONLY on `payoutMode: HYBRID`** — it is absent, and
invalid, on the others. D7 asks for the list on `WEEKLY` pools too, so a single
hybrid formula leaves that mode with no computable prize at all. Both modes are
therefore stated explicitly. (codex, plan review r1.)

| `payoutMode` | Weekly pot for one week |
|---|---|
| `HYBRID` | `hybridSplit.weeklyPerEntry × entries × charityFactor ÷ weeksInSeason` |
| `WEEKLY` | `entryFee × entries × charityFactor ÷ weeksInSeason` — the whole fee is the weekly pot, by definition of the mode |
| `SEASON` | **no weekly pot; the list renders places and scores with no Prize column.** Not an error state — a season pool genuinely has no weekly prize, and printing a $0 column would read as one |

⚠️ **`charityFactor` is not optional garnish — it is `1 - charity.percentage/100`
when charity is enabled, and 1 otherwise.** `PayoutsPanel.tsx:318` already takes
it off each pot BEFORE applying place percentages, because the PotBreakdown tells
members donations come out before payouts. Computing the weekly pot gross would
overstate every prize on a charity pool and, across the paid places, award money
that was promised to the charity. Match the panel exactly — including its
`Math.floor` convention — or the same pool prints two different prize figures on
two screens. (codex P1, plan review r8.)

### 🛑 3b-i. FREEZE THE COMPUTED RESULT, NOT ITS INPUTS ONE AT A TIME

This plan reached the right rule the slow way. Successive review rounds found
`weeksInSeason` unfrozen, then `entries` unfrozen, then `entryFee`,
`hybridSplit`, the charity settings and `payouts.places` all still live on a
rescore — every one of them editable by the commissioner while the pool is OPEN
(`shared/editability.ts`), and every one of them able to silently change a week's
award **after a winner was published**.

Freezing them individually is a losing game: the next input added to the formula
is unfrozen by default, and nobody notices until a prize moves.

**So the rule is: at first publication of a week's prize, persist the OUTPUT.**

Stored with the week's published prize, and read back verbatim on every later
pass (rescore included):

- the computed **pot** for that week, in whole dollars;
- the **payout schedule** applied to it (the `places` array as it stood);
- the **entry count** and **`weeksInSeason`** used, for auditability — so
  "why is this $40?" is answerable a month later.

A rescore then re-ranks **players** against a frozen pot, which is the only thing
a rescore should be able to change. A commissioner editing settings afterwards
affects future weeks and nothing already published.

⚠️ This is also the honest boundary for "the platform moves no money": the site
publishes a figure, and that figure must not move under the commissioner who read
it out to their league. (codex P1, plan review r7 and r9 — r9 is the
generalisation of r7's finding, and it is the one that closes the class.)

⚠️ **`weeklyPerEntry × entries` is the SEASON-LONG weekly total, which is why it
is divided.** A codex round argued the division understates every weekly prize,
on the reading that `weeklyPerEntry × entries` is already one week's pot. The
shipped UI says otherwise and is the evidence: `PayoutsPanel.tsx:334` renders
that figure labelled **"weekly total"**, and its own tooltip (`:382`) reads *"the
entry fee splits $X into the weekly prize **pots**"* — plural, i.e. the money set
aside for weekly prizes across the whole season. One week's pot is that total
divided by the number of weeks. **Finding rejected**; recorded here because it is
the kind of thing that will be re-raised.

`entries` is the count of entries the pot is actually drawn from. **Decision D8:**
is that every entry, or only entries marked `PAID`? Recommendation: **every
entry**, matching how the pool's own money model already talks about the pot, and
say so on the page — the platform moves no money, so this is a stated assumption
rather than a transfer.

**There is no canonical weeks constant** (measured; `PLAN-HYBRID-SPLIT` §1), and
`18` must not be hardcoded — a preseason pool has four.

⚠️ **DEPENDENCY, not an existing fact.** The client-side helper this plan leans
on — `poolSeasonWeeks(games, pool)` in `src/utils/nflPending.ts`, which derives
the distinct weeks of the pool's season type from the loaded schedule — is
**added by PR #427 and does not exist on `main` yet**. An implementer starting
from this plan before #427 merges will find an unresolved import. (codex P2, plan
review r1.)

So, explicitly:

- **Client display**: needs #427 merged, or the two-line derivation inlined —
  distinct `Number(g.week)` over games whose `Number(g.seasonType)` matches
  `poolSeasonType(pool)`, ascending.
- **Server**: has no equivalent helper at all and needs its own — one query on
  `nfl_games` for `season` + `seasonType`, distinct `week`. It is the server
  value that is authoritative for money, per §3b; the client helper is for
  display.

Two candidates, **decision D5**:

| Option | Pro | Con |
|---|---|---|
| **Derive at scoring time** from `nfl_games` | No new stored field, always matches the real schedule | The divisor can MOVE if the schedule import changes mid-season, silently re-pricing earlier weeks |
| **Store `weeksInSeason` on the pool at creation** | Frozen; a week's prize is decided once and stays decided | A pool created before the schedule was imported has nothing to freeze |

**Recommendation: store it at creation, and FREEZE-ON-FIRST-PUBLISH when it is
absent.**

⚠️ "Fall back to deriving" is NOT sufficient, and this plan said exactly that in
its first draft. Every pool that exists today lacks the field, and a pool created
before its schedule import lacks it too — so the fallback path is the *common*
path, not the edge case. Deriving it on every scoring pass leaves the divisor
floating for precisely those pools, and a later schedule import re-prices weekly
prizes that were already published. That is the very guarantee this section
claims to provide. (codex P1, plan review r1.)

So the rule is:

1. `pool.weeksInSeason` present → use it. Never recomputed.
2. Absent, and a weekly prize is about to be published for the first time → derive it from `nfl_games`, **write it to the pool in the same transaction**, and use the written value.
3. Absent and nothing is being published → derive for display only, and label the figure provisional.

Step 2 is a **server write to an existing pool document**, so it is a
prod-data-touching path: kill-switch + dry-run default, `mmp-change-control`
Rule 1. It writes one previously-absent field and never overwrites a present one.

This mirrors `frozenHardLockFor` (`shared/weeklyHardLock.ts`), which exists for
exactly this class of problem — freeze the number at the moment it first starts
mattering, not before.

### 3c. Rounding

Whole dollars. The page must state the rounding rule in words — "approximate;
the commissioner settles exact amounts" — because **the platform moves no money**
(`stripe-commissioner-only`: Stripe is commissioner hosting fees only, entry fees
are P2P honor system). The prize column is information, never an instruction to a
payment system.

---

## 4. B3 — tie prize-splitting

### 4a. The rule

k players tied at place p **consume places p..p+k-1**; those places' prizes are
summed and split evenly; the next player lands at place p+k.

- Two tied for 1st: (1st + 2nd) ÷ 2 each; next player is 3rd.
- Three tied for 1st: (1st + 2nd + 3rd) ÷ 3 each; next player is 4th.

This is the money counterpart of the competition ranking already on screen —
`rankByWeek` / `rankBySeason` (`src/utils/nflResults.ts`, #427) already produce
the 1,1,3 place numbering this consumes.

### 4b. Where it lives

`shared/prizeSplit.ts` — **pure**, no I/O, unit-tested to death, consumed by the
client display and any server-side publication alike. It is money; it gets one
implementation.

```
splitPrizes({
  places: [{ rank, percentage }],   // VERBATIM pool.payouts.places — see below
  pot,
  ranked: [{ id, rank }],           // competition ranks, ties sharing a rank
}) -> Record<id, number>            // whole dollars
```

⚠️ **The field is `rank`, not `place`.** The persisted shape is
`{ rank, percentage }` in both `payoutPlaceSchema` (`shared/schemas/common.ts:55`)
and the `PayoutSettings` type (`src/types/index.ts:774`). The first draft of this
plan invented a `place` key, which would have left an implementer passing
`pool.payouts.places` straight in and silently reading `undefined` for every
rank — awarding nothing, or awarding wrongly. The helper takes the stored shape
verbatim, with **no normalization step**, because a normalization step is one
more place the two can drift. (codex P2, plan review r3.)

⚠️ **Ranks must be UNIQUE, and nothing enforces that today.**
`payoutPlaceSchema` validates each array item independently, so
`[{rank:1,pct:50},{rank:1,pct:20}]` is a *valid* configuration. The helper would
then have two answers for rank 1 and no stated rule — sum them, take the first,
take the last — which is an ambiguous award on real money. **Enforce uniqueness in
create AND update validation** (the update gate, per the #424 lesson, not the
permissive schema alone) rather than teaching the helper to guess. A pool that
already holds duplicates is a pre-existing-data question: the helper should
**throw** rather than silently pick one, so it surfaces as an error the
commissioner can fix instead of a quietly wrong prize. (codex P2, plan review r8.)

### 4c. The invariants the tests must pin

Property-style, because these are the ones that will actually be got wrong:

1. **`Σ awarded ≤ pot`**, always. No arrangement of ties may award more than the pot.
2. **`Σ awarded === floor-consistent` with the pot** when percentages sum to 100 — and the **remainder from whole-dollar rounding is stated**, not silently dropped or silently handed to first place. (Decision D6: does the remainder go to the top place, or stay unallocated and be named on the page? Recommendation: **unallocated and named** — the platform is not moving this money, and inventing a rule for the last three dollars is worse than saying "$3 rounding remainder, commissioner's call".)
3. **A tie spanning the last paid place** consumes only the places that exist — three tied for 2nd in a two-place payout split 2nd alone, three ways.
4. **A tie entirely below the last paid place** awards nothing and must not throw.
5. **k = 1 reduces to the untied case**, exactly.
6. **Ordering independence** — the same ranked set in a different input order yields identical awards.
7. **No negative and no NaN**, ever, on an empty `places`, an empty `ranked`, or a zero pot.

### 4d. Where it is published

Kevin: the wizard (so the commissioner understands at creation), the pool rules
page, the prize page, and the standings. The wizard and rules-page copy is the
same sentence in one constant, for the same reason `tiebreakerCopy` is.

---

## 5. What this plan does NOT touch

Stated explicitly because the scorer is LIVE (`nflAutoScoreJob` `*/5`):

- No existing `weeklyPoints`, `weeklyResults`, `weeklyScores` value is read for rewriting or restated.
- No migration, backfill, or sweep script across the pool collection.
- No entry-document write.
- `weeklyWinners` keeps its exact current shape and meaning.
- The `recapWritten = !dryRun && !provisional` condition is unchanged — a prize list must never publish mid-Sunday.

⚠️ **One production write IS in scope and must not be lost in that list:** §3b's
freeze-on-first-publish sets `weeksInSeason` on a pool that lacks it. It writes
one previously-absent field, never overwrites a present one, and happens inside
the first weekly-prize publication for that pool — not as a sweep. It still takes
the Rule-1 kill-switch + dry-run gate, and its dry-run output is reviewed before
it is enabled.

---

## 6. DECISIONS NEEDED FROM KEVIN

> ✅ **SIGNED 2026-08-15 by Kevin — "all recommendations"** (asked and answered in the session that opened the T1 lock PR; every row below stands as recommended).

| # | Question | Recommendation |
|---|---|---|
| **D1** | 🛑 §0 — does absent/`MNF_COMBINED` keep resolving to combined for pools that already exist (safe), or re-read as `MNF_LAST_GAME` (simpler, but changes what an in-flight prediction means)? | **Keep resolving to combined.** Write the value explicitly at create so new pools get `MNF_LAST_GAME`. Flip your test pools yourself. |
| **D2** | Does `NONE` survive the option change? | **Keep it.** The standings MNF column gating depends on it (#422/#423), and a commissioner who wants shared ties has no other way to say so. |
| **D3** | Freeze the resolved target game id at first submission on EVERY week (not just Monday-less ones) — and if that frozen game is later cancelled, is the tie simply shared? | **Yes to both.** Without the freeze a flex move or a postponement re-targets a prediction already made, which is the §0 defect arriving through the schedule. A cancelled target has no score to compare against, and "shared" is the outcome the scorer already produces when nobody answered — no new concept needed. |
| **D4** | Margin season-tie cascade: reuse the standings cascade **in full**? | **Yes — `negativeBurden` → `positiveWeeks` → `bestWeek`, in that order**, and state it on the rules page. Skipping `negativeBurden` (the first draft's idea) would award the season prize to a different player than the leaderboard shows leading, on any tie where the burdens differ. If you want it out, the standings sort and the rules page change with it, as one deliberate change. |
| **D5** | Weeks-in-season: freeze at creation, or derive at scoring time? | **Freeze at creation; for pools that have no frozen value, derive ONCE and PERSIST it in the transaction that first publishes a weekly prize** (§3b). Not "derive as fallback" — every pool that exists today lacks the field, so a re-deriving fallback is the common path and re-prices published prizes when the schedule moves. The persist step writes production data and takes the kill-switch + dry-run gate. |
| **D6** | Whole-dollar rounding remainder: to first place, or unallocated and named? | **Unallocated and named.** The platform moves no money; naming the remainder is honest, inventing a rule is not. |
| **D7** | Is the Weekly Winners List shown on `payoutMode: WEEKLY` pools too, or HYBRID only? | **Both** (see §3b for each mode's pot). A WEEKLY pool is *entirely* weekly prizes; withholding the list there makes least sense. A SEASON pool gets the list with no Prize column. |
| **D8** | Is the pot drawn from every entry, or only entries marked `PAID`? | **Every entry**, stated on the page. The platform moves no money, so this is a printed assumption, not a transfer. |

---

## 7. Build order once signed off

1. `shared/prizeSplit.ts` + its test suite. Pure, no dependencies, provable before anything else moves.
2. B1 resolver + copy + wizard/manager option lists + freeze-gate value list (its tests **enumerate** the values — update them).
3. B1 season-tie cascade.
4. B2 server-side `weeklyPlaces` publication — **this is the `functions/` change and it deploys into a LIVE scorer; its PR body must say so.**
5. B2/B3 display: Weekly Winners List, prize column, standings and rules-page copy.

One PR at a time (§2d). Steps 1–3 and 4–5 are the natural PR seams; step 4 is the
one that owes a functions deploy.

## 8. Gate status

- [x] Plan written
- [x] Adversarial review log (`PLAN-WEEKLY-PRIZES-REVIEW-LOG.md`) — rounds 1–9 (2026-08-14, reconstructed from the inline citations) + round 10 live 2026-08-16 (REVISE, 10 findings, all absorbed into §9; the §2c cap of 10 is now spent — an r11 is Kevin's call)
- [x] Sweep pass (`PLAN-WEEKLY-PRIZES-SWEEPS.md`) — S1–S11
- [x] **Kevin's sign-off on D1–D8** — 2026-08-15, "all recommendations"
- [ ] Implementation — step 1 (`shared/prizeSplit.ts` + `shared/prizePot.ts`) in PR; steps 2–5 follow, one PR each

---

## 9. Round-10 addenda (2026-08-16, after #427–#450 merged) — these BIND the implementation

The live codex round on the signed plan found the multi-entry merges (T1/T2,
#449/#450) had moved the ground under three of the plan's nouns. Nothing here
re-opens D1–D8; each row is a specification the signed decisions already imply.

| # | Addendum | Why |
|---|---|---|
| A1 | **`weeklyPlaces` rows are keyed by `entryId`** (`entries/{docId}` — `{uid}` for entry #1, `e{n}:{uid}` for extras), and carry `ownerUid`, `entryName ?? userName`, `points`, `tiebreakDiff?`, `rank`, and (paid ranks only) `prize`. `WeeklyWinnerCandidate` gains `entryId`. | Post-T2 one owner can hold several entries; a uid-keyed list would merge them and mis-award. |
| A2 | **A pure full-ranking function** in `functions/src/nflScoringEngine.ts` (`rankWeeklyPlaces`) ranks EVERY scored entry: points desc → tiebreakDiff asc (undefined = no prediction, ranks BELOW any prediction, never coerced to 0 — the `computeWeeklyWinners` rule) → residual ties SHARE a rank, next rank skips (1,1,3). `weeklyWinners` stays = the rank-1 group, computed as today. Publishing the FULL ranking removes the "how deep" question (§3a's `max(rank)` is a subset of it) and lets an empty `places` list still publish places and scores (SEASON mode, D7). | Ambiguity in §3a about depth and about empty/zero-percent payout lists. |
| A3 | **`entries` in the pot formula = `pool.entryCount`** as it stands at first publication (server-maintained since T2; derived by counting entry docs in the transaction when the field is absent on a legacy pool), and it is FROZEN into the recap with the pot (§3b-i). | `entryCount` now has a precise meaning (liable/playable entries) and a maintainer; "entries" no longer does. |
| A4 | **HYBRID snapshot uses `settings.weeklyPayouts ?? settings.payouts`** for the weekly places list (PLAN-PAYMENT-LEDGER D1: absent `weeklyPayouts` ⇒ `payouts` applies to both pots — today's behaviour). WEEKLY uses `payouts`. The selector is one function in `shared/prizePot.ts` (`weeklyPlacesFor(settings)`); LEDGER T1 adds the field later without touching the scorer. | Two plans named two lists for the same pot. |
| A5 | **Publication fails CLOSED, never crashes the scorer.** Duplicate ranks / >100 % / a `splitPrizes` throw → the recap is written WITHOUT `weeklyPlaces`, with `weeklyPlacesError: '<CODE>'` (string), the week scores normally, and the manager surface shows the error. LEDGER K9's duplicate-rank census + update validation are prerequisites for the DISPLAY, not for the scorer. | `nflAutoScoreJob` is live; a throw inside it is an outage. |
| A6 | **The frozen-target handshake is a contract change on `submitNFLPicks`:** `submitNFLPicksSchema` (`functions/src/schemas/poolCore.ts:29`, strict) gains optional `displayedTiebreakTargetIds: string[]` (max 10, unique); the internal payload type (`nflPools.ts:382`), `dbService.submitNFLPicks` (`src/services/dbService.ts:1488`), `PickemPickEntry`, `proxyPick`, and the sim/harness callers are enumerated in sweeps S11 and ALL updated in the same PR. Server rule, in the transaction: compute the canonical target from the schedule read IN the transaction; if `pool.frozenTiebreakTargets[week]` exists → require the client list to equal it (else `TIEBREAK_TARGET_STALE`, reload); else require the client list to equal the canonical list (else `TIEBREAK_TARGET_STALE`), then freeze the canonical list. A submission that sends NO list (proxy, sim harness, a legacy client) is accepted and, when nothing is frozen yet, freezes the CANONICAL list — the client's list is never what gets stored, so an absent list cannot freeze a favourable game; the r7 render-vs-submit risk applies only to a client that displayed a target, and such a client sends its list. Only the `MNF_COMBINED`/`MNF_LAST_GAME`/`MNF_FIRST_GAME` rules freeze anything; `NONE` never does. | The plan's handshake trusted the client's list; a first submitter could freeze a favourable game. |
| A7 | Sweeps gain **S10** (entry identity — every weekly-place/payout key is `entryId`) and **S11** (every submit path — schema, payload, dbService, UI, proxy, sim). | Codex r10 on the sweeps. |
