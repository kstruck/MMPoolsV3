# PLAN: auto-survive eligibility must not count FUTURE-week reservations

**Status:** DRAFT — awaiting adversarial review (codex) + Kevin sign-off.
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
2. **Open question 1 (Kevin):** is that acceptable, or should the default path
   keep `usedTeams` and accept that a default pool and a configured pool then
   disagree? Recommendation: change both. A divergence between "the same pool
   with the setting written explicitly" and "without it" is the harder thing to
   explain, and #399's own test pins them equal.

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

**Deliverable:** a scoring-version term in `computeWeekFingerprint` — a constant
bumped by any change to grading logic — so a logic change invalidates every
stored fingerprint the way a settings change already does. With a test that pins
it: same pool, same games, same settings, bumped version ⇒ different hash.

This is a small addition with a wide blast radius (it forces a rescore of every
NFL pool on deploy, not just survivor), so the version term's scope — global vs.
survivor-only — is a review question in its own right, not a detail to settle at
implementation time.

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
   this is a plan and not a one-line edit — see open question 1.
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

1. **Does the default path change too?** See above. Kevin's call. This is the
   only question that changes the shape of the work.
2. **The autosurvive scenario fixtures must change with it (sweep S2).**
   `nfl-survivor-autosurvive.json` seeds `usedTeams: ['KC','BUF','SF','DAL']`
   with **no `picks` map at all**, so a picks-derived default path counts zero
   uses, every team stays eligible, and the scenario silently stops testing the
   exemption it exists to prove. Those scenarios are reachable from the live
   SuperAdmin Test Suite, not just CI. If open question 1 is "change both paths",
   the fixtures gain a `picks` map consistent with their `usedTeams` **in the
   same PR** — which is also the realistic state, since a real entry only
   acquires `usedTeams` by submitting picks.
3. **Do any live pools currently hold an exemption that this would revoke?**
   Answerable only against production. Preseason has been running, so it is not
   hypothetical. If yes, a rescore flips a member from ALIVE-by-exemption to
   struck — a member-visible reversal that needs a decision (and possibly a
   grandfather cutoff) before deploy, not after.
4. **Sequencing against reset-and-replay (the big one).** Given decision 4, there
   are two orders and Kevin picks:
   **(a) Fix-forward only** — ship the eligibility fix so no NEW wrong exemption
   is granted, and leave existing ones standing until reset-and-replay exists.
   Cheap, safe, leaves known-wrong history in place.
   **(b) Build reset-and-replay first**, then ship this behind it, correcting
   history in the same operation. Correct, materially larger, and it is a
   member-visible reversal (ALIVE-by-exemption → struck) that needs its own
   decision about notification and grandfathering.
   Recommendation: **(a) first**, with (b) tracked — the fix-forward half is what
   stops the exploit, and it does not depend on the replay machinery.
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

## Implementation status

| Item | Status |
|---|---|
| Plan drafted | ✅ 2026-08-09 |
| Sweeps (S1–S4) | ✅ 2026-08-09 — S1–S4 complete; **S2 corrected the plan** (fixtures carry `usedTeams` with no `picks`) |
| Codex adversarial review (log: PLAN-SURVIVOR-EXEMPTION-RESERVATIONS-REVIEW-LOG.md) | ⏳ 2 rounds, 4 findings, 100% accepted — NOT converged; round 3 owed |
| Kevin sign-off (open questions 1–5) | PENDING |
| Implementation | PENDING — dedicated session |
