# PLAN-WEEKLY-TIEBREAKERS — REVIEW LOG

Adversarial review of the plan itself, before any code exists. Reviewer:
`codex exec review` (OpenAI), per CLAUDE.md §2c. Rounds 1–3 ran `--uncommitted`
while the plan was a working-tree document; rounds 4 and 6 ran
`--base origin/main` once it was committed to a branch, as did round 8 — and
that difference mattered (see round 3).
Findings are quoted in substance and answered individually; a rejection is
recorded with its reasoning, same as an acceptance.

**codex on the PLAN: 10 rounds (the §2c ceiling), 9 findings, all valid, all absorbed.**
**codex on the CODE: 4 rounds, 2 findings, both valid, both absorbed; rounds 3 and 4 clean.**
**Self-review found a third defect between those two clean rounds (appendix 3).**
**qodo: 1 review of #421, 5 findings — 4 absorbed, 1 rejected with reasoning (appendix 2).**

Two of the seven hit the same clause — §5, the mid-season edit gate — and the
second is a hole the first one's fix opened. That is the pattern CLAUDE.md §2c
documents ("round 1 finds defects in the code, rounds 2+ find defects in the
fixes"), reproduced exactly, on a plan that had already copied a gate this repo
believed was correct. R4.1 is a different class — not a wrong design, an
incomplete touch list, and R8.1 is the same class one surface further out.
R7.1 (appendix) is a third kind: a wrong *classification* in the audit document
riding the same branch, which would have made a follow-up ticket look far
cheaper than it is.

⚠️ **Every finding after R2.1 arrived on a round that followed a clean one.**
Round 3 was clean and round 4 found R4.1; round 6 was clean and round 7 found
R7.1; round 7's absorption reviewed clean in substance and round 8 found R8.1;
rounds 9 and 10 each found two more. (Round 5 is the exception that proves
nothing: it was clean and so was round 6.) The counter is not the stopping rule;
the evidence is, and a clean round is a data point rather than a finish line.
*(qodo caught this sentence claiming more than the log below supports — it
originally said rounds 3, **5** and 6 were each followed by a round with
findings, and round 5 was followed by a clean round 6.)*

---

## Round 1

### R1.1 — the gate freezes too late (P1) — **ACCEPTED**

> The proposed `poolHasScoredWeek` gate still permits a commissioner to switch
> `MNF_COMBINED` to `MNF_LAST_GAME` after members have submitted predictions for
> the current, unscored week. The same stored number is then interpreted against
> a different target … Freeze this setting once the first relevant week's
> submissions/picks begin (or version the rule per week), not only after scoring
> publishes.

**Verdict: valid, and it holed the plan's one borrowed mechanism.** The draft
reused `poolHasScoredWeek` from `functions/src/lib/survivorSettingsGate.ts`
because #399 established it, and reused it without asking whether #399's line is
*this* setting's line. It is not. #399's parity settings are re-applied by the
scorer, so "has anything been scored" is exactly the right question there. This
setting changes **what a number a member already typed means**, and that harm
lands at submission, not at scoring — a whole weekend earlier.

**Absorbed** as the §5 box: the gate freezes on the first submitted prediction,
and `poolHasScoredWeek` demotes from the whole gate to a cheap early-out. The
per-week versioning alternative codex offered is recorded as **rejected** in §5
with its reasoning — strictly more capable, strictly more machinery (a second
frozen-per-week map beside `hardLockByWeek`, a freeze writer on the submission
path, a per-week resolver in the scorer), for a setting whose correct value is
known at pool creation.

**Lesson worth carrying past this plan:** copying a gate is copying its
*question*, not just its code. The question `poolHasScoredWeek` answers is "has
the scorer published anything", and that is only the right question for settings
the scorer re-applies.

---

## Round 2

### R2.1 — the round-1 fix is vacuous in the `NONE` direction (P1) — **ACCEPTED**

> When a pool starts with `NONE`, the proposed client deliberately stops sending
> `tiebreakerPrediction`, so submitted entries have no `weeklyTiebreakers` value.
> A manager can then switch to an MNF rule after picks are locked; members were
> never asked for predictions and scoring falls back to `0` for them. Gate
> changes on evidence of any Pick'em submission … not only on stored tiebreaker
> values.

**Verdict: valid, and it is a hole round 1 created.** Round 1's fix keyed the
freeze on `weeklyTiebreakers` being non-empty. §7 of the same plan says a `NONE`
pool's sheet stops sending `tiebreakerPrediction` at all — so on exactly the
pools where the switch is most damaging, the round-1 gate is satisfied by an
empty map and permits everything.

The consequence is worse than round 1's, not equal to it. Round 1's case
re-reads a number the member chose; this one **invents** one:
`entry.weeklyTiebreakers?.[week] ?? 0` ([nflPools.ts:1308](functions/src/nflPools.ts#L1308))
reads every member as having predicted **0** for a question they were never
asked, on picks they can no longer change.

**Absorbed** as the second §5 box: the freeze judges the **OR** of two
per-entry conditions — non-empty `picks` **or** any `weeklyTiebreakers` value —
and the refusal message changes to cover both ("they answered the old question,
or were never asked the new one").

---

## Round 3 — clean (against the working tree)

> The only untracked change is a planning document marked as awaiting sign-off;
> it makes no executable code or configuration changes.

No findings.

⚠️ **This round was run `--uncommitted` and it is the weaker of the two forms.**
Round 4 below, run `--base origin/main` once the plan was committed, found a P2
that round 3 did not — the branch diff gives the reviewer the repo to check the
plan's claims *against*, where the working-tree diff gives it the document
alone. Both forms were run deliberately; the branch-diff one is the one that
earned its keep.

---

## Round 4 — `--base origin/main`, on the committed branch

### R4.1 — the touch list omits two hand-duplicated type contracts (P2) — **ACCEPTED**

> When the wizard, manager UI, pick sheet, and scorer read
> `settings.weeklyTiebreaker`, both existing `NFLPickemPool.settings` interfaces
> (`src/types/nflPoolTypes.ts` and `functions/src/nflPoolTypes.ts`) lack that
> property. The plan only adds the Zod create schema and its touch list omits
> these types, so a typed implementation will fail both typechecks or require
> unsafe casts.

**Verdict: valid.** Verified — `src/types/nflPoolTypes.ts:83` and
`functions/src/nflPoolTypes.ts:86` each declare `NFLPickemPool.settings` by
hand, both carry `payoutMode` and `pickMode`, and neither carries
`weeklyTiebreaker`. A plan whose touch list is short by two files is a plan that
budgets wrong and invites an `as any` at implementation time — this repo already
carries `castPool = pool as any` in the pick sheet, so that is not a theoretical
failure mode.

Severity is right at P2, not P1: it would surface as a compile error on the
first implementation attempt, not as a live defect. But the point of writing the
plan first is that the touch list is the estimate.

**Absorbed** into §3 as a table of both files plus the instruction to add the
field to both.

**One half of codex's suggestion is REJECTED, with reasoning.** It offered "or
replace them with a shared type". Collapsing the two hand-maintained
`NFLPickemPool` interfaces into `shared/` is a repo-wide refactor of a contract
that predates `shared/` and is read by every NFL surface — strictly larger and
riskier than the feature it would be riding on, three weeks from kickoff. The
**tiebreaker enum** does go in `shared/` (§4), because the scorer and the client
must agree on it exactly; the surrounding interface stays duplicated. Recorded
in §3 so the next reader does not re-open it.

---

## Round 5 — clean, on the R4.1 absorption

`--uncommitted`, against the §3 and review-log edits that closed R4.1.

> The current changes only clarify the implementation plan and review log; they
> introduce no executable behavior or actionable defect.

No findings.

---

## Round 6 — clean, on the branch diff (and *not* the last word)

`--base origin/main`, after a further commit that the earlier rounds had never
seen (the runbook's open-PR table). §2c: new writing earns its own round, and
that applies to a commit made after the reviewer came back clean.

> The diff contains documentation and planning updates only; it introduces no
> executable code or configuration changes. **The documented implementation
> claims were consistent with the referenced current source locations.**

No findings on the plan. The second sentence is the one worth having: the whole
plan is a set of claims about file:line locations, and this is a reviewer with
the repo in hand saying they check out.

⚠️ **Round 7 then found a P2 in the audit document on the same branch** — see
the appendix. Round 6 being clean did not mean the branch was.

---

## Stopping rule

CLAUDE.md §2c's stopping rule is **evidence, not the counter**: a clean codex
round **and** qodo clean **and** my own read of the artifact agreeing.

- **codex:** rounds 5 **and** 6 clean. Round 6 is not a formality — it reviewed
  a commit written *after* round 5 came back clean, and it is the round that
  confirms the plan's file:line claims against the repo. ✅
- **own read:** agrees, with one reservation recorded in the plan rather than
  hidden — §2 is a scope question, not a specification, and the plan is
  deliberately not implementable until Kevin answers it. That is the intended
  state of a plan-gated artifact awaiting sign-off, not an open finding. ✅
- **qodo:** runs on the PR that carries these documents; its verdict is recorded
  in that PR. It could not run earlier — qodo reviews pull requests, and rounds
  1–3 predate the branch. It will run again on the PR that implements the plan,
  which is the review that matters more.

**No findings are carried open.**

---

## Round 8 — a P2 in the plan's touch list, after two clean rounds on it

### R8.1 — the standings "MNF Score" column is not gated on the rule (P2) — **ACCEPTED**

> When a pool selects `NONE`, this plan suppresses the input and stops new
> writes, but `NFLStandings.tsx` always renders the `MNF Score` column and reads
> `weeklyTiebreakers[week]`. New pools will therefore show an irrelevant all-dash
> column, while predictions submitted by an older client can still appear despite
> the pool having no tiebreaker.

**Verdict: valid, and it is the same class of miss as R4.1 — an incomplete touch
list, one surface further out.** §7 gated the pick sheet's input and its copy and
stopped there; the column that *displays* the number was never mentioned. The
second half of the finding is the sharper one: this is not merely an empty
column. A prediction stored before a commissioner flips to `NONE` keeps
rendering, so the standings would show a tiebreaker figure for a pool that has
no tiebreaker — the display contradicting the rules page.

The sweeps document had actually enumerated this surface (S2's consumer table
lists the MNF Score column as "display only, not a sort key"), and the plan's §7
still failed to act on it. **An enumeration is not a touch list**, and that is
worth remembering: S2 answered "who reads this number", §7 needed "who must
change when the number's meaning changes", and the second question was never
asked of the first question's own output.

**Absorbed** into §7 as a fifth bullet: gate the header *and* the cell on
`rule !== 'NONE'`, hiding rather than deleting, so a switch back before any
submission loses nothing.

---

## Round 9 — two P2s, one in each document

### R9.1 — Option A's heading contradicts the plan's own body (P2) — **ACCEPTED**

> The heading says Option A has "no scorer change," but the option changes
> `computeMNFTiebreakerTotal`, persists altered recap output, and requires a
> functions deployment. This is the scope-signoff section, so the contradictory
> label can cause the approver to choose A under an incorrect risk/deployment
> assumption.

**Verdict: valid, and it is the worst-placed error in the document.** §2 bullet
2 of Option A already said *"**Is** a scoring change … so it stays plan-gated and
owes a functions deploy"* — one line below a heading claiming the opposite. A
reader skimming to make the call reads headings.

Absorbed: the heading is now **"no weekly-winner computation — ⚠️ STILL a scorer
change"**, with a box saying so explicitly and the one-line summary that A and B
differ in **what** is computed, not **where**.

### R9.2 — a `bash`-fenced command that runs in no shell (P2) — **ACCEPTED**

> When this fenced `bash` command is run in Bash … `Select-String` is not
> available, so the documented post-deploy verification fails before locating the
> bundle.

**Verdict: valid, and worse than reported.** `curl -s … | Select-String` runs in
**neither** shell as written: bash has no `Select-String`, and PowerShell 5.1 —
Kevin's actual shell — does have the cmdlet but not that pipe's semantics. So the
runbook handed him a step that fails whichever way he ran it, in a section whose
whole job is verifying a deploy.

Absorbed: replaced with a single PowerShell command (no `&&`, per the standing
rule about PowerShell 5.1), fenced `powershell`, with the bash equivalent given
underneath for completeness.

**Lesson:** a fence label is a claim about which shell the command runs in, and
nothing in the gate set checks it. That is exactly the class of thing a
cross-model reviewer catches and self-review does not.

---

## Appendix — round 7, on the audit document rather than the plan

The same review pass covers `MORNING-2026-08-14.md`, since both ride the same
branch. Recorded here because there is nowhere better and a rejected-or-absorbed
finding must live somewhere.

### R7.1 — the audit misclassified gap G2 as frontend work (P2) — **ACCEPTED**

> G2 cannot be implemented as a frontend-only follow-up: the member-readable
> standings projection explicitly strips `weeklyResults[*].games` in
> `sanitizeWeeklyResults`, raw entries are not readable by other players, and
> `getPoolPicks` returns revealed picks but not their graded results … leaving it
> classified as frontend-only risks either an impossible implementation or
> reintroducing a protected entry read.

**Verdict: valid, and it is the most useful finding of the seven.** Verified all
three doors:

1. `sanitizeWeeklyResults` (`nflScoringEngine.ts:698-708`) destructures `games`
   and `game` out of every week before the row is written. `StandingsRow` is an
   **allowlist** — its own comment says per-game maps are deliberately excluded.
2. Raw entries have been unreadable by other members since #414 shipped
   2026-08-12.
3. `getPoolPicks` returns revealed picks, not grades.

The original wording ("the data exists and is never rendered") reads as an
afternoon of UI work. It is a server projection change plus a **new reveal-policy
decision**, and the cheap-looking version of it is exactly the one that would
reintroduce the entry read #414 removed.

**Absorbed** into `MORNING-2026-08-14.md` §4c as a correction box, and the G2
row's classification changed from *frontend* to *backend*. `LAUNCH-READINESS.md`
§I's summary paragraph corrected to match — it carried the same wrong claim.

**It strengthens the audit's recommendation rather than weakening it.** "G1 only
before launch, G2 after kickoff" was the call; this is a second reason for it.

---

## Appendix 2 — qodo on #421

qodo re-reviewed at the current head after a draft→ready toggle (CLAUDE.md §2b)
and reported **3 bugs + 2 skill insights**. Per-finding verdicts, since a
rejection needs its reasoning on the record as much as an acceptance does.

| # | Finding | Verdict |
|---|---|---|
| Q1 | Markdown lines exceed 100 characters | ❌ **REJECTED** |
| Q2 | An unverified checklist is not labelled `UNVERIFIED` | ✅ ACCEPTED |
| Q3 | `cd D:\march-melee-pools` inside a ```bash fence | ✅ ACCEPTED |
| Q4 | "`main` is at `d6bae3f4`" conflates a branch head with a deploy fact | ✅ ACCEPTED — the best of the five |
| Q5 | `](path.ts:698)` link targets 404 on GitHub | ✅ ACCEPTED |
| Q6 | The log's own clean-round summary contradicted the log | ✅ ACCEPTED |

**Q1 — rejected.** No line-length rule exists in this repo: there is no
markdownlint config, no CI step that checks it, and `HANDOFF.md`'s first line is
a single paragraph of several hundred characters by design. Wrapping the tables
in these documents would make them less readable, not more. This is the
style-finding class CLAUDE.md §2b's calibration note predicts (7/7 rejected on
the previous run), and it lands the same way.

**Q4 is the one worth reading.** `HANDOFF.md` said "`main` is at `d6bae3f4`" —
already false when this branch started, because #419 had moved `main` to
`0572babc`. The sentence conflated two things that must not be conflated: the
commit the **live bundle was built from** (a deploy fact, fixed until the next
rebuild) and where the **branch head points** (which moves on every merge). An
operator comparing the two would read ordinary forward progress as deploy drift.
Rewritten to state the build-from fact and to send the reader to
`git log origin/main` for the head. The runbook gained a three-row table naming
all three SHAs and what each one does.

**Q6 is the one that stings, and it is the argument for a second reviewer.** The
summary paragraph claimed rounds 3, 5 and 6 were each followed by a round that
found something — while the log two screens below records round 5 as clean and
round 6 as clean. Ten codex rounds did not catch a self-contradiction inside the
review log itself. qodo did, first look.

**Q3 and Q5 are the same shape as R9.2:** a fence label and a link target are
both claims about how text will be *executed* or *resolved*, and no gate in this
repo checks either. Three of the eleven findings across both reviewers were in
that class.


---

## Appendix 3 — reviewing the IMPLEMENTATION (Option B)

A fresh count: the plan's ten rounds reviewed a document, and the code is a
different artifact. Four rounds, two codex findings, one self-review finding.

### C1.1 — a member who did not play could win the week (P1) — **ACCEPTED**

> When an entry has no pick for the scored week, this unconditional push still
> gives it a zero-point weekly-winner candidate. Thus, in a `NONE` pool or a week
> with no usable tiebreak target, non-submitters can be named as shared winners
> alongside zero-point participants.

**Verdict: valid, and it is the plan's own rule the code failed to implement.**
§8c says in as many words that "entries with no submission for the week are not
candidates at all". The Margin branch gated its push on `pick`; the Pick'em
branch did not, and copying the neighbouring code would have been enough.

Worth noticing about the failure mode: it is invisible on a normal week, because
somebody who played always outscores 0. It surfaces exactly on the ugly weeks —
an all-zero week, or a pool with no tiebreak target — which is where a wrong
answer is least likely to be questioned.

**Absorbed**: gated on `picksThisWeek > 0`. The invariant added with it asserts
there are exactly TWO `winnerCandidates.push(` sites, so a third ungated one
cannot appear later.

### C2.1 — the UPDATE path did not validate the enum (P2) — **ACCEPTED**

> `updatePoolSettings` … the permissive update schema and settings flattener
> persist that value without validation. `effectiveWeeklyTiebreaker` then
> silently treats it as `MNF_COMBINED`, so an intended `NONE` pool can be changed
> to the combined-MNF behavior while its stored setting remains invalid.

**Verdict: valid.** The `z.enum` guard is on the CREATE schema only.
`updatePoolSettingsSchema` is permissive by design and `flattenSettingsPatch`
writes present keys as given.

The interesting half is the ORDERING, which the finding implies and the fix makes
explicit: the validity check has to run **before** the changed-value check.
Junk resolves to `MNF_COMBINED`, so on a pool already playing `MNF_COMBINED` a
junk write reads as "no effective change", returns null, and stores the garbage.
Validity first, then the change test.

Note this is a design tension resolved deliberately, not an inconsistency:
`effectiveWeeklyTiebreaker` **should** keep resolving junk to the default on
READ — a hand-edited pool must keep playing something — while the WRITE path
refuses to create that state in the first place.

### C-self.1 — a void week published a shared win over a week nobody played

Found by self-review **after codex round 3 came back clean**, which is the third
time this repo has recorded that sequence.

An all-cancelled week gives every Pick'em entry 0 points and leaves no Monday
game FINAL. So the cascade sees a perfect tie with no tiebreak target and does
exactly what it is supposed to do — returns a shared win — over a week nobody
played. On a `payoutMode: WEEKLY` pool the recap would have told the commissioner
to pay everyone.

The cascade cannot see this: it is handed points and diffs, and by that point a
void week is indistinguishable from a genuinely tied one. The caller has the
information (`isVoidWeek(games)`) and has to apply it. Gated there.

### Rounds 3 and 4 — clean

> No actionable correctness issues were identified in the changes relative to the
> specified merge base. Frontend and functions TypeScript checks pass.

⚠️ Round 3 was also clean, and C-self.1 was found after it. A clean round is
evidence, not a finish line — the same sentence this log's header has been
carrying since the plan.
