# PLAN — autopick limits and season-prize eligibility

**Status: AWAITING KEVIN'S SIGN-OFF ON THE DEFINITION. No code written.**
Classification: **money** (season-prize eligibility) → plan-gated
(`mmp-change-control` §1). Written 2026-08-14 (overnight).

Kevin's ask, verbatim:

> "Add a new option to the pool wizard that allows the pool commissioner to
> determine how many autopicks a user is allowed before they are disqualified
> from season prizes in hybrid pools or how many autopicks a user is allowed for
> the entire season. Users will complain if someone just uses autopick for the
> entire season and wins."

Reference-site markers to mirror: `*` = the week contains automatically
generated picks; `#` = ineligible for the season prize.

---

## 0. 🛑 LEAD FINDING — this site has no automatically generated picks

**The feature as described counts a thing that does not currently exist.**

Measured:

- **T-C — auto-pick for members who miss the deadline — was never started.** It
  is plan-gated and has no plan (`HANDOFF.md:133`, `MORNING-2026-08-12.md` §5:
  "Not started. No plan"). **Nothing in this codebase generates a pick
  ALGORITHMICALLY on a member's behalf.**

  ⚠️ An earlier draft said "nothing generates a pick on a member's behalf",
  full stop, and that is **false**: `proxyPick`
  (`functions/src/poolExceptions.ts:223`, exported at `index.ts:108`) is a
  commissioner-invoked callable that writes picks for a target user. It is not an
  *auto*pick — a human chose those teams, and the commissioner is accountable for
  them — but it IS a pick the member did not enter, which is close enough to the
  thing being counted that the plan must say where it lands rather than leave the
  boundary to an implementer. **Decision D6.** (qodo on PR #428.)
- **What exists is Quick Picks** (`src/components/NFLPoolDashboard/pickSheet/quickPicks.ts`,
  shipped #417) — four mechanical fills the MEMBER presses, on their own sheet,
  before saving. The member reviews the result and submits it themselves.

The consequence is the whole decision: **a Quick Picks submission is
byte-identical to a hand-made one.** It arrives through the same `submitNFLPicks`
callable, with the same shape, and carries no marker. There is no field to count,
and the server cannot tell the two apart after the fact.

So "how many autopicks before disqualification" needs Kevin to say **what an
autopick is**.

### The three readings

| | Definition | What it takes to count it | Honesty |
|---|---|---|---|
| **(a)** | **T-C system-generated picks only** — the server filled a sheet because the member missed the deadline | Nothing extra: whenever T-C ships, the server is the writer and stamps the week itself | **Trustworthy.** The server is the only author, so the count cannot be forged |
| **(b)** | **Quick-Picks-assisted submissions** — the member pressed the button | The client must FLAG the submission | **Honor-grade only** — see below |
| **(c)** | **Both** | Both of the above; two counters or one field with a source tag | Mixed: (a) trustworthy, (b) not |

⚠️ **(b) is spoofable and the plan must not pretend otherwise.** The flag would
be set by the client and sent to the server, so an old client, a modified client,
or anyone with the browser console omits it. The server cannot verify it —
detecting "these picks look mechanical" by re-running the Quick Picks algorithms
and comparing is a heuristic that would also flag a member who genuinely agreed
with the favourites, which is a **false accusation attached to prize money**.

If Kevin wants (b), it ships as an honest-but-soft signal: it catches the casual
case Kevin is actually worried about ("someone just uses autopick all season"),
and the rules page says plainly that it is self-reported. It must NOT be
described to members as an enforced rule.

**Recommendation: (a), with the setting shipping now.** It is the reading that
can be enforced, it is the one Kevin's own phrasing describes ("automatically
generated"), and the setting is useful the day T-C lands. (b) can be added later
without changing the stored shape, because §2 stores a per-week list with a
source tag rather than a bare count. **Decision D1.**

---

## 1. What is buildable TONIGHT regardless of the answer

The definition decides what *writes* the counter. It does not decide the setting,
the schema, the guard, or the rendering. All of that is definition-agnostic and
is the natural first PR.

### 1a. The setting

`settings.autopickLimit` — **absent means unlimited, which is exactly today's
behaviour.** No migration, no backfill, no change to any existing pool. Same
absent-means-today pattern as `weeklyTiebreaker` (#421) and `hybridSplit` (#423).

Kevin's sentence contains two different things, and they need two fields:

| Field | Meaning | Applies to |
|---|---|---|
| `autopickLimit` | How many autopicked weeks a member may have **before losing season-prize eligibility** | HYBRID and SEASON payout modes |
| `autopickMaxSeason` | A hard cap on autopicks for the whole season | any mode — see D2 |

The first is a *prize eligibility* rule; the second is a *participation* rule and
raises a question Kevin has not answered: what happens when a member hits the
hard cap — are they removed, frozen, or merely marked? **Decision D2. If he has
no answer, ship only `autopickLimit` and drop the second field**; a cap with no
defined consequence is not a feature.

### 1b. Schema and validation

- `pickemCreateInputSchema` etc. (`shared/schemas/nfl.ts`) — these are `z.object`, which **STRIPS unknown keys**, so an unlisted field is silently dropped at create and every new pool plays the default. That trap is documented in the file itself and has bitten twice (the survivor parity settings, the `weeklyTiebreaker` line). The field must be listed explicitly.
- ⚠️ **`updatePoolSettingsSchema` is permissive — validate in the GATE, not only the schema.** This is the #424 lesson; a create-side-only rule is not a rule.
- Coherence: non-negative integer; and `autopickLimit` is meaningless on a pool with no season prize, so it is rejected (or ignored, D3) on `payoutMode: WEEKLY`.
- ⚠️ **Validate the MERGED settings, not the submitted patch.** Rejecting `autopickLimit` only when it arrives *alongside* `payoutMode: WEEKLY` leaves a transition hole: set the limit while the pool is HYBRID, then switch `payoutMode` to WEEKLY in a later write, and the pool keeps a setting this plan calls meaningless — with a rules page that may still advertise it. The gate validates the post-merge document, and the mode switch either clears the field or is refused. This is the `flattenSettingsPatch` per-key-merge trap from `PLAN-HYBRID-SPLIT` (`hybridSplitNeedsClearing`) in a new costume, and it applies to **direct SUPER_ADMIN writes too**, not only the callable path. (codex P2, plan review r7.)

### 1c. The rules guard

Prize-affecting → the setting must be **callable-only**, so a commissioner cannot
move the bar by writing the pool document directly.

⚠️ **Callable-only is NOT enough — the threshold also needs a lifecycle rule.**
Eligibility counts every recorded prior week, so lowering `autopickLimit` in week
12 retroactively marks members `#` for weeks they played under a looser rule, and
raising it un-marks them. Callable-only access stops a commissioner writing the
field directly; it does nothing to stop them *legitimately editing the setting
mid-season* and moving season-prize eligibility under people who already played.

Two ways to close it, **Decision D7**:

| | Rule |
|---|---|
| **(i) Lock it** | `autopickLimit` becomes immutable once the season opens — the same shape as the tiebreaker freeze gate, which locks a setting once submissions exist |
| **(ii) Snapshot it** | Store the limit in force on the entry the first time an autopick is recorded, and judge that entry against the snapshot |

**Recommendation: (i).** It is simpler, it matches an existing gate in this repo,
and a commissioner who genuinely needs to change the rule mid-season is making an
announcement to their league anyway. (ii) is more permissive but leaves members in
the same pool judged by different thresholds, which is hard to explain on a rules
page. (codex P1, plan review r9.)

⚠️ **Two more measured traps, both from this repo's own history:**

1. `callableOnlySettingsUnchanged()` is the ONLY thing in `firestore.rules` that binds SUPER_ADMIN; everything inside the `isPoolManager()` branch is short-circuited. A new callable-enforced invariant must have its field added to **that nested list**, or the guard does not run for the principal it most needs to.
2. **Position in the expression IS the guard** (the S4 lesson). A term added in the wrong place is a guard that reads as a guard and is not.

### 1d. The markers

`*` (this week contains autopicks) and `#` (ineligible for the season prize) —
rendered on the standings and on the new Results pages (#427).

**These render from fields the enforcement will later write.** Until the
definition ships, the fields are simply absent and no marker appears — which is
correct, because today nothing IS an autopick. A marker that appeared before
anything could set it would be a lie on the leaderboard.

⚠️ `#` is a **money claim on a leaderboard**. It must render only from a stored,
server-written value, never from a client-side recomputation of "weeks × limit" —
those two can disagree, and the one the member screenshots is the wrong one.

### 1e. The counter's storage shape

On the entry document, **keyed by week**:

```
autopickWeeks?: Record<string, { source: 'SYSTEM' | 'QUICK_PICKS' }>
//              ^^^^^^ week number as the key — a MAP, not an array
```

⚠️ **A map, not `Array<{week, source}>`, and that is the whole point.** The first
draft of this plan specified an array while claiming in the next line that it was
idempotent because "a set keyed by week cannot double-count". An array has no set
semantics: a retry, a concurrent pass, or a later record for the same week
appends a second item, the count goes up, and a member crosses the limit and is
marked `#` — **ineligible for prize money** — on the strength of a duplicate
write. (codex P2, plan review r1.)

A map makes the de-duplication structural rather than a rule the writer has to
remember, and the write is a merge on `autopickWeeks.<week>`, so it is idempotent
by construction. Eligibility counts `Object.keys(...).length`, filtered by source
if D1 lands on (c).

Whatever the shape, the writer takes a **transaction or a field-path merge**, never
a read-modify-append.

Three reasons for a per-week record rather than a bare count:

- **Idempotent**, per the above — the key IS the deduplication.
- **Auditable.** "Which weeks?" is the first question a member will ask about a `#`, and an integer cannot answer it.
- **It makes (a)-now / (c)-later a non-breaking change.** Adding `QUICK_PICKS` entries later does not restate anything already stored.

⚠️ **Additive, and written only by whatever eventually authors an autopick.** No
migration; entries without the field have had no autopicks, which is true.

---

## 2. What is NOT buildable tonight

- The **counter's writer**, because it is the definition (D1).
- **Enforcement** — the actual exclusion from a season prize — because it is money, it belongs with the prize-splitting maths in `PLAN-WEEKLY-PRIZES.md` §4, and it needs D1 first. An ineligible player must be removed from the ranked set BEFORE places are consumed, or a `#` player silently absorbs a paid place and shrinks everyone else's prize.
- **T-C itself**, which remains unplanned and unstarted.

---

## 3. DECISIONS NEEDED FROM KEVIN

| # | Question | Recommendation |
|---|---|---|
| **D1** | 🛑 What counts as an autopick — (a) T-C system-generated only, (b) Quick-Picks-assisted, or (c) both? | **(a)**, with the setting shipping now and enforcement arriving with T-C. (b) is spoofable by any modified client and cannot be described to members as enforced. |
| **D2** | Does the hard season cap (`autopickMaxSeason`) ship, and what happens when a member hits it? | **Drop it** unless you have a consequence in mind. A cap with no defined outcome is not a feature. `autopickLimit` alone covers the complaint you described. |
| **D3** | `autopickLimit` on a `payoutMode: WEEKLY` pool — reject at validation, or accept and ignore? | **Reject.** A stored setting that does nothing is how a commissioner comes to believe a rule is in force when it is not. |
| **D4** | Is `#` (ineligible) visible to every member, or only to the commissioner and the member themselves? | **Everyone.** It changes who is competing for the season prize, and a prize rule that only some players can see is worse than no rule. |
| **D5** | Does an autopicked week still SCORE normally (points count, just not toward season-prize eligibility)? | **Yes.** Kevin's complaint is about *winning the season prize* on autopicks, not about the picks being worthless. This also keeps the weekly prizes untouched. |
| **D6** | Do **commissioner proxy picks** (`proxyPick`) count toward the limit? | **No, and the rules page should say so.** A human chose those teams and the commissioner is accountable for them — that is the opposite of the "just used autopick all season" behaviour you described. But it is a pick the member did not enter, so it must be ruled on explicitly rather than left to whoever implements the counter. |
| **D7** | When does `autopickLimit` stop being editable — **(i)** immutable once the season opens, or **(ii)** snapshotted onto the entry the first time an autopick is recorded? (§1c) | **(i) Lock it at season open.** Without a lifecycle rule, lowering the limit in week 12 retroactively marks members `#` for weeks they played under a looser rule. (i) is simpler and matches the existing tiebreaker freeze gate; (ii) is more permissive but leaves members in the same pool judged by different thresholds, which is hard to explain on a rules page. |

---

## 4. Build order once signed off

1. Setting + schema (create **and** update-gate) + rules guard + wizard/manager UI + rules-page copy. **No enforcement.** This is the definition-agnostic PR and it can go first.
2. `autopickWeeks` writer — whatever D1 selects.
3. Eligibility enforcement, in the ranked set that feeds the prize split (`PLAN-WEEKLY-PRIZES.md` §4).
4. `*` / `#` marker rendering on standings and Results.

## 5. Gate status

- [x] Plan written
- [ ] Adversarial review log
- [ ] Sweep pass — complete instance lists for `settings.` validation sites, `callableOnlySettingsUnchanged` field list, standings/Results row renderers
- [ ] **Kevin's sign-off on D1–D7**
- [ ] Implementation
