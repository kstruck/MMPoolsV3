# PLAN: auto-survive eligibility must not count FUTURE-week reservations

**Status:** IMPLEMENTING 2026-08-10 — design SIGNED OFF 2026-08-09 (Kevin). The
implementing session re-ran S1–S4 from scratch on 2026-08-10 against
`origin/main` @ `8a1d110` (shape-proofs included: 4 JSON fixtures, 3 TS seeds,
12 call sites all found by the published commands) and recorded the concrete
implementation decisions below. Review round 9 runs on this refreshed plan
before code.
**Classification:** Plan-gated — **SCORING** trigger. It changes how a week is
decided (whether a missed pick is a strike or an exemption). Not money, not
authorization, not prod data.
**Branch:** to be cut from `origin/main` @ `c7bdcf5`.
**Origin:** codex round 4 on PR #399, carried into that PR's body as a named
unresolved finding by deliberate decision. Kevin ruled 2026-08-09 that it gets
its own plan.

## The defect

`checkAutoSurviveExemption` grants a week an exemption — survive without a pick
— when **no team playing that week is still eligible**. "Eligible" is judged
against the entry's team-use history.

Both paths judge it against history **that includes weeks the entry has not
reached yet**:

| Path | Eligibility source | Includes future weeks? |
|---|---|---|
| default (`maxTeamUses` absent or `1`) | `entry.usedTeams` | **YES** — `submitNFLPicks` writes every submitted team into `usedTeams` whatever week it is for |
| configured (`maxTeamUses !== 1`) | `countTeamUses(picks, week)` | **YES** — excludes only the current week |

So when week 3 is scored, a pick the member pre-submitted for week 6 already
counts as a "use". If enough of week 3's slate is consumed that way, the member
who submitted nothing for week 3 is **excused instead of struck**.

`submitNFLPicksSchema` accepts `week` 1–23 (`functions/src/schemas/poolCore.ts:30`)
and survivor's weekly hard lock only closes the CURRENT week, so pre-submitting
later weeks is a supported member action, not an exotic state.

The repo already documents the timing half of this without drawing the
conclusion — `nflScoringEngine.ts:668` excludes `usedTeams` from the standings
projection precisely because it "is updated at SUBMIT time, so it reveals the
current week's un-scored pick".

### Why it is worth fixing, and why it is not urgent

**Worth fixing:** the exemption is a *benefit*. Over-counting uses makes it fire
more often than it should, and it fires exactly when a member did not show up.
A member can reach it deliberately: pre-submit later weeks until a thin slate is
exhausted, then skip that week and take an exemption instead of a strike.

**Not urgent:** the reachable surface is small. A full 16-game slate offers 32
teams and would need more uses than a season has weeks. It becomes reachable on
a **thin slate** — a 1–2 game week, a heavy bye week, or a preseason/postseason
week — where 2–4 reservations can exhaust it.

**Not a #399 regression.** The default path has had this property for as long as
`usedTeams` has been submit-time. #399 preserved it deliberately rather than
introducing it, because splitting the two paths is the specific hazard the
tri-mode byte-for-byte guarantee exists to prevent.

## Goal

Judge auto-survive eligibility on uses that had **actually occurred by the week
being scored** — i.e. weeks **strictly before** it — in **both** paths, so a
default pool and a configured pool continue to agree.

## Approach — one phase, one PR

### The change

`functions/src/nflScoringEngine.ts` `checkAutoSurviveExemption`:

- **Configured path** (`maxTeamUses !== 1`): eligibility counts weeks `< week`
  instead of "all weeks except `week`". A new `countTeamUsesBefore(picks, week)`
  in `shared/survivorReuse.ts` beside `countTeamUses`, sharing
  `normalizePickWeeks` so the week-key grammar has exactly one definition.
- **Default path**: `usedTeams` cannot express *when* a team was used, so it
  cannot answer this question at all. The exemption therefore stops reading
  `usedTeams` and reads `countTeamUsesBefore(picks, week)` with a limit of 1.

**Signature decision (implementing session, 2026-08-10).** With both paths
picks-derived, the `usedTeams` parameter is DEAD — nothing inside the helper
reads it. It is REMOVED rather than kept as a decoy, and the reuse context
becomes REQUIRED:

```ts
checkAutoSurviveExemption(
  gamesInWeek: NFLGame[],
  autoSurviveEnabled: boolean,
  ctx: { maxTeamUses: number; picks: ...; week: number },
): boolean
```

Two consequences, both intended:
1. **The two modes collapse into ONE counting path** — `maxTeamUses === 0`
   short-circuits to eligible, everything else is
   `countTeamUsesBefore(picks, week)[team] < maxTeamUses` (the default resolves
   to `1` via `effectiveMaxTeamUses` at the caller). Default and configured
   pools cannot diverge because there is no second branch to diverge in.
2. **Every 3-arg call site is a compile error**, so TypeScript enumerates the
   collision list instead of a grep: `survivorRescore.test.ts` (the tri-mode
   describe block) and `tests/nfl-scoring.test.ts:272`. The engine's one
   production call site already passes the full context (#399).

⚠️ **That second bullet knowingly breaks the #399 byte-for-byte guarantee for
this one helper, and the plan must own it rather than bury it.** The guarantee
existed to protect legacy entries whose seeded `usedTeams` diverges from their
`picks` (`nfl-survivor-autosurvive.json` is one). Those entries change outcome
here. That is the *point* — the guarantee preserved a behaviour we have now
decided is wrong — but it means:

1. The blast radius is **entries whose `usedTeams` disagrees with `picks`**, not
   just entries with future reservations. Sweep S2 must enumerate every fixture
   and seeded entry in that state, and the plan must state the outcome change
   for each before implementation.
2. ✅ **RESOLVED 2026-08-09 (Kevin): change BOTH paths.** A divergence between
   "the same pool with the setting written explicitly" and "without it" is the
   harder thing to explain, and #399's own test pins them equal.

   ⚠️ **The knock-on is binding, and it is BIGGER than "add a `picks` map"**
   (codex r6). Measured against the actual fixture:
   - The scenario schema has **no `picks` field**. Entries carry `survivorPicks`,
     and `nflSeasonSimulator.ts:331` persists `picks: numKeys(e.survivorPicks)`.
     A `picks` map added to the JSON is **silently ignored**.
   - `nfl-survivor-autosurvive.json` has `scoreWeeks: [1]`, `nflGames` in week 1
     only, and `testEntries[0].survivorPicks` is `{}` — its exemption today comes
     entirely from the seeded `usedTeams`.

   So under strictly-prior counting there is no week before week 1 for a use to
   have happened in, and **no edit to the entry alone can preserve this
   scenario's exemption.** It has to be rebuilt: earlier weeks of `nflGames`,
   `survivorPicks` in those weeks, and `scoreWeeks` moved to the later week. That
   is real work and it belongs in the implementing PR's scope estimate, not in a
   footnote.

### Only the exemption changes

The **submit and proxy guards keep counting every other week, including future
ones**, and this is not an oversight:

- The guard answers *"may I pick this team now?"*. A team already reserved for
  week 6 genuinely has that use spent; letting week 3 take it too would put the
  entry over the limit with no later write to catch it.
- The exemption answers *"had this member run out of options by the time this
  week was graded?"*, which is a question about the past.

The two questions differ, so the two answers may. Stating it here so the sweep
can prove the guards were considered rather than missed.

### Fingerprint invalidation is REQUIRED, not optional (codex r2 #1)

The first draft guessed "none expected, confirm in review". Confirmed the other
way, and it is a hole big enough to make the whole change inert:

**For an already-scored week, this change moves NO fingerprint input.** Games are
unchanged, settings are unchanged, `entryRevisionSum` is unchanged — only the
*algorithm* changed, and the algorithm is not hashed. `nflAutoScoreJob` therefore
matches the stored fingerprint and takes its skip path, so every existing wrong
exemption stays wrong forever. That is exactly the "skipped FOREVER" failure the
contract at `autoScoreDecisions.ts:143` exists to prevent, arriving through the
one door that contract does not cover.

**NOT a deliverable — an explicit decision for the implementing session, and the
default is NO** (codex r6, correcting r2). Under fix-forward the version term has
no demonstrated benefit: a week first scored after deploy already runs the new
eligibility code without it, and an already-scored survivor week is rejected by
`survivorAllowedForGroup` BEFORE its fingerprint is ever computed. What a global
term would reliably do is invalidate stored fingerprints for every NFL pool and
trigger regrading nobody asked for.

The option remains on the table only for the narrow case below, and it should be
taken only if that case is shown to be real:

**If a future change ever does need it:** a scoring-version term in
`computeWeekFingerprint` — a constant bumped by any grading-logic change — with a
test pinning that the same pool, games and settings hash differently across a
bump. Not this PR.

⚠️ **SCOPE IT HONESTLY — it does NOT repair history** (codex r3), and under
fix-forward it may buy nothing at all (codex r6). Now that Kevin
has chosen fix-forward (question 4), this term must not be described as the
mechanism that corrects existing wrong exemptions, because it cannot be:
`scoreSlateOnce` calls `survivorAllowedForGroup` BEFORE computing the
fingerprint, so an already-scored survivor week is deferred regardless of what
the hash says, and weeks outside the active window are not candidates at all.

**And it buys nothing else either** (codex r8, retiring the last claim made for
it). The "re-graded for an unrelated reason" case does not need it: once any other
fingerprint input moves and the scorer runs, it executes the DEPLOYED eligibility
code regardless of whether a version is hashed. The term's only distinct effect is
to force regrades when nothing else changed.

**So the honest position is: under fix-forward, no version term. Do not add one.**
The section is kept — rather than deleted — because "we considered hashing the
algorithm and here is why it buys nothing" is the useful artifact; a future change
that DOES need historical regrading will want this reasoning and the
`survivorAllowedForGroup` constraint that shapes it.

It also has a wide blast radius (it invalidates stored fingerprints for every NFL
pool, not just survivor), so global-vs-survivor-scoped is a real implementation
question — and given it cannot repair history, "no version term at all, and
document that only future passes differ" is now a legitimate third option for the
implementing session to weigh.

### Tests

Extend the existing suites (no new suite, no coverage claims):

- `functions/src/__tests__/survivorRescore.test.ts` — **replace** the test added
  by #399 that pins the two paths EQUAL on future reservations. That test was
  written to stop a silent divergence; this plan is the sanctioned, non-silent
  change, so the assertion inverts: both paths now ignore future weeks.
- Exemption fires when the slate is exhausted by **past** weeks (unchanged
  behaviour — the case the feature exists for).
- Exemption does NOT fire when the slate is exhausted only by **future**
  reservations, at `maxTeamUses` absent, `1`, `2` and `0`.
- Mixed: some past, some future — only the past ones count.
- `maxTeamUses: 0` still never fires (#399's invariant, unchanged).
- Idempotency: `computeSurvivorWeekUpdate` on the same week twice is identical
  under the new eligibility.
- Legacy-divergence: an entry whose `usedTeams` disagrees with `picks` — assert
  the NEW outcome explicitly, so the change is recorded rather than discovered.
- Mutation-check every guard: delete it, prove the test goes red, restore.

## Key decisions & tradeoffs

1. **Strictly before, not "all but current".** The exemption is a judgement about
   a week that has been graded; a use that had not happened yet is not a use.
2. **Both paths move together.** #399's test pinning them equal is the reason
   this is a plan and not a one-line edit. RESOLVED — both paths change.
3. **Guards unchanged.** Different question, different answer (above).
4. **A one-time rescore of the affected week is NOT a safe repair** (codex r2 #2
   — this reverses the first draft, which claimed it was). `computeSurvivorWeekUpdate`
   is idempotent per (entry, week), but a survivor SEASON is not: re-running an
   earlier week keeps the later `strikeWeeks` while rewriting `eliminatedWeek` to
   the re-run week, after which every later week is skipped and the ledger is
   wrong. The repo already knows this and says so verbatim at
   `functions/src/nflAutoScore.ts:257-260`, which is why `scoreSlateOnce`
   DEFERS queued survivor rescores today (`survivorQueuedDeferred`) and lets only
   a delayed FIRST score of an unscored week through.

   So correcting a historical exemption requires **reset-and-replay from that week
   forward** — the path that comment calls "the reset-and-replay sub-PR" and which
   does not exist yet. **This makes the correction of EXISTING wrong exemptions a
   separate, sequenced piece of work, not a side effect of this change.** Open
   question 4 below is now the sequencing decision, and it is the biggest open
   item in this plan.

## Risks / open questions

**Kevin resolved the two shape-changing questions on 2026-08-09: change both
paths, and fix-forward first.** Both are recorded inline below rather than
deleted, so the reasoning survives.

1. ✅ **RESOLVED — the default path changes too.** See the decision above. The
   fixture work is now in scope by consequence, not by choice.
2. **The autosurvive scenario fixtures must change with it (sweep S2).**
   `nfl-survivor-autosurvive.json` seeds `usedTeams: ['KC','BUF','SF','DAL']`
   with **no `picks` map at all**, so a picks-derived default path counts zero
   uses, every team stays eligible, and the scenario silently stops testing the
   exemption it exists to prove. Those scenarios are reachable from the live
   SuperAdmin Test Suite, not just CI. Since question 1 resolved to "change both
   paths", the fixtures must be repaired **in the same PR** — and per codex r6
   that is NOT "add a `picks` map": the schema has no such field (entries carry
   `survivorPicks`, which `nflSeasonSimulator.ts:331` converts), and with
   `scoreWeeks: [1]` there is no earlier week for a prior use to live in. The
   scenario has to be REBUILT — earlier `nflGames`, `survivorPicks` in those
   weeks, `scoreWeeks` moved later.
3. **Do any live pools currently hold an exemption that this would revoke?**
   Answerable only against production. Preseason has been running, so it is not
   hypothetical. **No longer blocks THIS PR** now that question 4 is fix-forward —
   existing exemptions are deliberately left alone. It becomes the entry criterion
   for the reset-and-replay work, where flipping a member from ALIVE-by-exemption
   to struck needs its own decision about notification and grandfathering.
4. ✅ **RESOLVED 2026-08-09 (Kevin): FIX-FORWARD ONLY, this PR.** Ship the
   eligibility fix so no NEW wrong exemption is granted; leave existing ones
   standing until the reset-and-replay path exists. It stops the exploit and does
   not depend on machinery nobody has built.

   **Two obligations follow, and neither is optional:**
   - The PR must state plainly that it **knowingly leaves existing wrong
     exemptions in place**, and HANDOFF must carry the same, so a future session
     does not read a green PR as "history is correct now".
   - The fingerprint question is **decided: NO version term** (see the fingerprint
     section — r6 showed it cannot repair history, r8 retired the last remaining
     claim made for it). Ship without one.

   Reset-and-replay stays tracked as separate work. Question 3 becomes its
   entry criterion rather than a blocker for this PR.
5. **Rebuy interaction.** `lastRebuyWeek` short-circuits weeks at or before it;
   confirm eligibility counting is unaffected for the weeks that ARE recomputed.

## Out of scope

- The submit and proxy reuse guards (decision 3).
- Margin pools — no exemption exists there.
- Any change to `maxTeamUses` / `tieCountsAs` semantics from #399.
- Any prod-data mutation.

## Sweep obligations (`PLAN-SURVIVOR-EXEMPTION-RESERVATIONS-SWEEPS.md`, before implementation)

- **S1** — every writer of `usedTeams`, to prove it is submit-time everywhere and
  that no path makes it scored-time.
- **S2** — every fixture, scenario JSON and seeded entry whose `usedTeams`
  diverges from `picks`, with the outcome change stated per instance.
- **S3** — every consumer of `checkAutoSurviveExemption` and `exemptWeeks`.
- **S4** — every place that could pre-submit a future week (schema range, lock
  paths, proxy).

## Fixture rebuild design (implementing session, 2026-08-10)

The rebuilt `nfl-survivor-autosurvive.json` spans **three weeks** so the
exemption fires from genuinely PRIOR uses:

- **Games**: w1 `KC 27–24 BUF`, `SF 30–10 DAL`; w2 `BUF 21–14 MIA`,
  `DAL 28–7 NYJ`; w3 `KC 20–17 BUF`. `scoreWeeks: [1, 2, 3]`.
- **Alice**: `survivorPicks {"1":"KC","2":"BUF"}` — both win, she survives w1/w2.
  Week 3's slate is KC and BUF only, both used strictly before week 3 →
  **exempt week 3**. Her seeded `usedTeams` stays `['KC','BUF','SF','DAL']`
  DELIBERATELY divergent, proving the seeded ledger is no longer the authority.
- **Bob**: `survivorPicks {"1":"SF","2":"DAL","3":"KC"}` — the week-1 SF
  reservation is PRESERVED (sweep S2 requirement), all three win, he survives
  normally. His divergent `usedTeams ['KC']` also stays.
- Assertions move `exemptWeeks [1]` → `[3]`; Bob stays ALIVE.

`nfl-survivor-autosurvive-off.json` gets the SAME rebuild with the exemption
disabled: Alice has no week-3 pick, so the missing pick auto-strikes and
eliminates her in **week 3** (assertions move `eliminatedWeek 1` → `3`).

## Implementation status

| Item | Status |
|---|---|
| Plan drafted | ✅ 2026-08-09 |
| Sweeps (S1–S4) | ✅ **re-run from scratch 2026-08-10** against `8a1d110` with shape-proofs (one JSON fixture, one TS seed, one call site each found). One NEW file since the tables: `survivorParitySettings.emulator.test.ts` (#399) — seeds `usedTeams`+`picks` but exercises the settings-reduction validator via `updatePoolSettings`, never `checkAutoSurviveExemption`; unaffected. Line drift only otherwise: the tri-mode call sites are now `survivorRescore.test.ts:273–326` |
| Adversarial review (log: PLAN-SURVIVOR-EXEMPTION-RESERVATIONS-REVIEW-LOG.md) | ⏳ 9 rounds (8 codex, 1 qodo), 19 findings, 18 accepted / 1 rejected — **round 9 (2026-08-10, on the refreshed plan) came back CLEAN**; the code earns its own rounds on the PR. The log is authoritative; if this row disagrees with it, the log wins |
| Kevin sign-off | ✅ 2026-08-09 — Q1 (change both paths) and Q4 (fix-forward only) RESOLVED; Q3 deferred to the reset-and-replay work; Q2/Q5 are implementation detail |
| Implementation | ✅ 2026-08-10 `8ddfd86` — engine + shared helper + inverted tests + rebuilt fixtures. Gates: root tsc clean, functions typecheck clean, root vitest 860/860, functions vitest 1432/1432, emulator 348 passed / 2 expected-fail / 10 skipped, both autosurvive scenarios PASS through the real callables (verbose run). Mutations: 4 applied, 4 killed (old counting rule → 2 red; enabled-guard deleted → 1 red; `<`→`<=` → 4 red; unlimited short-circuit removed → 1 red) |
