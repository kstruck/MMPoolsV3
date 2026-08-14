# PLAN — weekly prize lists, tiebreaker option change, tie prize-splitting

**Status: AWAITING KEVIN'S SIGN-OFF. No code written.**
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

⚠️ Whichever he picks, "no migration script" holds either way. Nothing in this
plan writes to an existing pool document.

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
3. **The fallback game must be frozen the same way the target is.** If the
   schedule moves after submissions, the game the member was told about must
   remain the game they are judged on. See D3.

### 2c. Season-prize ties broken by pick record

Kevin: tied season standings break first on **player pick records**, then split.

- **Pick'em**: most correct picks — `Σ weeklyResults[*].correct`. Explicitly NOT
  `totalScore`, which is what they are already tied on. Note this is a real
  discriminator only in confidence mode; in standard scoring points **are** the
  correct count, so the cascade falls straight through to the split. Say so on
  the rules page rather than implying a tiebreak that cannot fire.
- **Margin**: the plan proposes reusing the existing display cascade —
  `positiveWeeks` desc, then `bestWeek` desc — because it is already what
  `NFLStandings` sorts by and what the rules page describes. **Not**
  `negativeBurden`, which is the second step of that cascade but is a *penalty*
  count and reads strangely as a "record". **Decision D4.**
- Still tied after the cascade → the prize money splits by the §4 rules.

---

## 3. B2 — the Weekly Winners List

### 3a. Where the data must come from

`recap.weeklyWinners` (#421) holds only the **tied leaders** — `computeWeeklyWinners`
returns the top score's tied set and nothing else. The list needs the top **N
places**, N = `payouts.places.length`.

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
| `HYBRID` | `hybridSplit.weeklyPerEntry × entries ÷ weeksInSeason` |
| `WEEKLY` | `entryFee × entries ÷ weeksInSeason` — the whole fee is the weekly pot, by definition of the mode |
| `SEASON` | **no weekly pot; the list renders places and scores with no Prize column.** Not an error state — a season pool genuinely has no weekly prize, and printing a $0 column would read as one |

`entries` is the count of entries the pot is actually drawn from. **Decision D8:**
is that every entry, or only entries marked `PAID`? Recommendation: **every
entry**, matching how the pool's own money model already talks about the pot, and
say so on the page — the platform moves no money, so this is a stated assumption
rather than a transfer.

**There is no canonical weeks constant** (measured; `PLAN-HYBRID-SPLIT` §1), and
`18` must not be hardcoded — a preseason pool has four.

This plan already shipped the honest source in #427:
`poolSeasonWeeks(games, pool)` (`src/utils/nflPending.ts`) derives the distinct
weeks of the pool's season type from the loaded schedule. The server equivalent
is one query on `nfl_games` for `season` + `seasonType`.

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
splitPrizes({ places: [{place, percentage}], pot, ranked: [{id, place}] })
  -> Record<id, number>   // whole dollars
```

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
- No migration, backfill, or script against production data.
- No entry-document write.
- `weeklyWinners` keeps its exact current shape and meaning.
- The `recapWritten = !dryRun && !provisional` condition is unchanged — a prize list must never publish mid-Sunday.

---

## 6. DECISIONS NEEDED FROM KEVIN

| # | Question | Recommendation |
|---|---|---|
| **D1** | 🛑 §0 — does absent/`MNF_COMBINED` keep resolving to combined for pools that already exist (safe), or re-read as `MNF_LAST_GAME` (simpler, but changes what an in-flight prediction means)? | **Keep resolving to combined.** Write the value explicitly at create so new pools get `MNF_LAST_GAME`. Flip your test pools yourself. |
| **D2** | Does `NONE` survive the option change? | **Keep it.** The standings MNF column gating depends on it (#422/#423), and a commissioner who wants shared ties has no other way to say so. |
| **D3** | On a Monday-less week, must the fallback game be FROZEN at first submission, like the hard lock is? | **Yes.** Otherwise a schedule move re-targets a prediction already made — the same defect as D1, one week narrower. |
| **D4** | Margin season-tie cascade: reuse `positiveWeeks` → `bestWeek`? | **Yes**, and state it on the rules page. `negativeBurden` reads as a penalty, not a record. |
| **D5** | Weeks-in-season: freeze at creation, or derive at scoring time? | **Freeze at creation, derive as fallback.** A prize that moves after it was announced is the worse failure. |
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
- [ ] Adversarial review log (`PLAN-WEEKLY-PRIZES-REVIEW-LOG.md`)
- [ ] Sweep pass (`PLAN-WEEKLY-PRIZES-SWEEPS.md`) — complete instance lists for `MNF_COMBINED`, `weeklyTiebreaker`, `WEEKLY_TIEBREAKER_VALUES`, `showTiebreaker`, `payouts.places`
- [ ] **Kevin's sign-off on D1–D7**
- [ ] Implementation
