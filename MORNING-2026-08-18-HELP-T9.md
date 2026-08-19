# MORNING 2026-08-18 (help system, T9) — one ticket merged, five defects dug up

This file **continues** `MORNING-2026-08-18-HELP.md`, which covers T0–T2 and stays accurate.

`MORNING-2026-08-18.md` remains the entry point for the PLAN-PAYMENT-LEDGER work
and neither of these two touches it. Read whichever matches what you are doing;
this one covers `PLAN-HELP-SYSTEM.md` T9 only.

> 🔴 **READ §1 BEFORE THIS WEEK'S PICK'EM INVITES GO OUT.** Writing help copy for
> the lock settings turned into a product finding, and it is the most important
> thing on this page: **a `PER_GAME` Pick'em pool — the wizard default — locks its
> whole pick sheet at the week's first kickoff.** After the Thursday night game,
> nobody can touch their Sunday picks. The server would accept them; the browser
> will not let anyone try. Nothing else here is urgent.

---

## 1. 🔴 Per-game Pick'em pools lock like weekly ones

**What a member sees.** They open their pick sheet after the Thursday night game
has kicked off. Every game is greyed out, Sunday's included. They cannot pick,
cannot change a pick, and cannot submit.

**Why.** Two client files disagree with the server.

- `src/components/NFLPoolDashboard/NFLPoolDashboard.tsx:515-534` works out the
  week's lock from the **earliest kickoff of the week**, for every NFL pool type.
  It never reads `lockMode`.
- `src/components/NFLPoolDashboard/PickemPickEntry.tsx:138-141` then reports
  "locked" for **every** game the moment that flag is set. The per-game branch
  one line below it is unreachable.

The server does the opposite. `functions/src/nflPools.ts:568` treats a week as
weekly-locking only when `confidenceMode` is on or `lockMode === 'WEEKLY'`, and
`:618-624` refuses a locked game only when the pick actually **changed**.

**Two things fall out of it.**

1. `lockMode` is a wizard control with the default `PER_GAME`, and it does nothing
   a member can see.
2. A commissioner's week extension never reaches a member. `extendWeekDeadline`
   writes the override and the **server honours it** — `effectiveGameLockAt` takes
   `max(base, override)` — but the client's lock ignores it, so the sheet stays
   shut.

**How it was found.** codex, on round 7 of the T9 PR, checking one sentence of
help copy that promised per-game editing. Verified against all four files before
being written down.

**What it cost T9.** The `settings.lockMode` and `settings.lockBufferMinutes` help
topics were written, survived six review rounds, and were then **withdrawn**. Copy
for either would have described the setting (false on screen) or the screen
(documenting the bug, and wrong again the day it is fixed). Their coverage rows
carry the finding and a test pins the reason.

### Your options

| | Option | What you get | What you carry |
|---|---|---|---|
| **A** | **Fix the client lock next, as its own PR** (recommended) | `lockMode` does what the wizard says, extensions reach members, and the two withheld help topics land right after | One PR before T4. It changes when a member may edit a pick on a live scorer, so it wants its own codex rounds and a test that proves a per-game pool stays open after the first kickoff |
| **B** | Set your Pick'em pools to `lockMode: WEEKLY` for now | Members see exactly what the pool does, no code change at all | Every pick in the week closes at the Thursday kickoff. That is a real rules change for your players, and the opposite of the default you picked |
| **C** | Leave it and send the invites | Nothing to do tonight | Your players meet it on the first Sunday, and it reads as the app being broken — which on this point it is |

**I would take A, before T4.** It is a contained client change, it restores a
setting you already ship, and the invites are dated. **B** is a fair stopgap if
you want zero code risk before the weekend — but tell your players.

---

## 2. Four more defects. None fixed. All yours.

### 2a. `pointsPerPick` and `primetimeBonus` are inert, and members are shown the numbers

`scorePickemEntry` (`functions/src/nflScoringEngine.ts:174-178`) awards exactly
**1** point per correct pick on a non-confidence pool. It reads neither field, and
no file under `functions/` reads either one.

The manager settings form sets both (`NFLManagerView.tsx:1336`, `:1345-1372`) and
the rules page shows them **to members** as what a pick is worth
(`NFLPoolRules.tsx:158-176`, `:220`). A pool set to 3 points a pick tells its
members three and pays one.

**Decision needed: honour them in the scorer, or drop the controls and the
rules-page rows.** Both are scoring changes, so both are plan-gated. This is why
`settings.pointsPerPick` is the one T9 coverage row that could not be closed —
any copy would repeat the false claim or document the bug.

### 2b. The Pick'em commissioner proxy pick is broken

`NFLManagerView.tsx:841` calls `proxyPick` with a picks map keyed by the **week
number** — `{ [proxyWeek]: proxyTeam }` — and the `NFL_PICKEM` branch of the
callable (`functions/src/poolExceptions.ts:340-344`) looks every key up as a
**game id**. It fails with `Game 3 not found in week 3.`

Survivor and Margin are keyed by week and work. So on a Pick'em pool the proxy
pick has never worked, which also removes the one workaround §1 leaves you.

Found by codex on round 15, checking a sentence of help copy that told members to
ask their commissioner.

### 2c. The NFL manager's "List Pool Publicly" toggle does nothing

`handleSaveSettings` sends `settings.isListedPublic` and nothing else
(`NFLManagerView.tsx:665`, `:733-739`). Browse decides an NFL pool's listing from
the **top-level** `isPublic` (`src/utils/publicListing.ts:34`), which that save
never writes.

The create wizard writes both, so a pool is listed or not according to the box you
ticked at creation — only the later toggle is inert. Same family as the playoff
listing bug qodo caught on #475.

Not fixed here because `isPublic` is read by `firestore.rules`, which makes it
authorization work rather than content work.

### 2d. Setting-aware help copy cannot render

`HelpCopy.template` exists in the content model and `src/help/types.ts` names
`tiebreakerCopy` as its intended absorption — but `TopicScope` is
`Pick<HelpScope, 'poolType' | 'audience'>` and **no surface publishes a pool's
settings**. A template written today would render its `fallback` forever.

Four separate review findings on the T9 PR asked for setting-conditional copy and
none could be answered properly; each was answered by widening the static copy to
cover every configuration instead. That works, and the copy grows every time a
setting gains a case. Worth a small ticket to thread `settings` through
`HelpScopeProvider`.

### 2e. Two `functions/` hardening items, deferred from qodo

- `validateConfidenceValues` (`nflScoringEngine.ts:187-224`) checks range,
  uniqueness and completeness but never that a value is an **integer**. A
  fractional confidence weight passes. Only reachable by calling the submit path
  directly — the sheet renders a `<select>` of integers.
- A weekly-lock or confidence pool refuses an **identical** resubmission after the
  week locks, where a per-game pool accepts it (`nflPools.ts:601-604` vs
  `:618-624`). Inconsistent rather than harmful.

Both were valid qodo findings, both deferred: `PLAN-HELP-SYSTEM.md` §7 says no
ticket touches `functions/`.

---

## 3. What merged

**#480 — PLAN-HELP-SYSTEM T9.** NFL Pick'em help copy and the shared NFL pool
copy. Content only: no component, no schema, no rules, no `functions/`.

- `src/help/content/nfl-pickem.ts` — four topics scoped to Pick'em alone:
  confidence points, the pick sheet, quick picks, the tie-break prediction.
- `src/help/content/nfl-shared.ts` — four topics true for all three season
  formats: what you owe, the payment ledger, scoring a week, and which settings
  freeze when a pool locks.
- Placements on the wizard rules step, the pool rules page, the pick sheet,
  standings, results, recaps and the four commissioner sub-tabs.
- `settings.pickMode` and `settings.weeklyTiebreaker` (written in T1) are now
  placed on the pool surfaces, and both were rewritten to survive the
  configurations those surfaces expose them to.
- Two T2 page summaries narrowed where they claimed more than the code does.
- `tests/help-content-nfl-pickem.test.ts`, 16 cases. The load-bearing one proves
  Pick'em copy does not reach a Survivor or Margin reader on the shared pages;
  widening the scope constant makes it fail with the leaked topic ids named.

**Three of the seven coverage rows T9 was meant to close are still open**, each
carrying its reason in `src/help/coverage-allowlist.ts`: `settings.lockMode` and
`settings.lockBufferMinutes` (§1) and `settings.pointsPerPick` (§2a).

**This needs a Coolify redeploy** to reach production. It is help copy only —
nothing breaks if it waits, and nothing else on `main` is waiting behind it.

---

## 4. Review cost

**15 codex rounds, qodo's full report, and a qodo re-review after a draft toggle.**

Rounds 11–15 are over the cap of 10. `CLAUDE.md` §2b forced them: closing qodo's
findings produced code codex had never seen, and every round from 7 to 13 then
found a real defect in the copy written to close the round before it. 15 is
exactly the ceiling the exception allows, and it is recorded in the PR body.

Round 7 found §1 and round 15 found §2b, so the overage paid for itself twice.

**23 findings: 21 absorbed, 1 rejected with a measurement, 1 valid-but-deferred.**
qodo went 3 for 3 on validity, and its bug finding was **also** wrong in T1's
copy, which this PR newly placed on four more pages.

Once codex was wrong: it claimed the server ignores week overrides. It does not.
Its client half was right, which is what mattered.

The last commit on the PR is a claim deletion and did not get a 16th round —
past 15 needs your say-so, and spending a paid round on a sentence that got
*weaker* was not worth asking for. Stated on the PR rather than left silent.

### One measurement to stop re-deriving

**`npm run lint` on `origin/main` is 1333 warnings, 0 errors** — measured
2026-08-18 by stashing the whole T9 diff in a fresh worktree and re-running. The
older docs say 1315 and then 1322; both are stale. T9's delta was 0.

---

## 5. Still not started

T3, T4–T8, T10–T14, T16. The order after T9 is unchanged: **T4, T3, T10/T11**.

**T16 is still overdue**, and this is the third morning it has said so. It is a
prerequisite of T15 in the signed plan and T15 was taken first, so the `?` key is
live in production resting on a CSS-class fallback for ~35 overlay shells.
Measured again tonight: all 41 current backdrops carry the class pair that
fallback matches, so nothing slips through today. A new overlay written without it
would, and nothing fails when one is.

---

## 6. Runbook

### Step 1 — pull

Open a terminal. You do not need to be in any particular folder.

```bash
git -C D:/march-melee-pools pull
```

**You should see** either a list of updated files or `Already up to date.`

Then confirm T9 is in what you pulled:

```bash
git -C D:/march-melee-pools log --oneline --grep="PLAN-HELP-SYSTEM T9" -1
```

**You should see** one line ending `(#480)`. **If you see nothing**, the pull did
not bring T9 down — tell me before deploying. **If the pull errors** about local
changes, run `git -C D:/march-melee-pools status` and tell me what it says. Do not
force anything.

> ⚠️ Do not check for a specific commit hash. `main` has moved past T9 by the time
> you read this — this document is a later commit. What matters is that the
> revision being deployed CONTAINS T9, which is what the `--grep` above asks.

### Step 2 — answer §1, and it is the only thing that needs you

Reply with **A**, **B** or **C** from the table in §1. I recommend **A**.

Nothing below depends on your answer, so you can do steps 3 and 4 either way.

### Step 3 — redeploy `www` for T9's help copy

T9 changes the shipped bundle, so the new copy is not live until `www` is
redeployed. It is help copy: nothing breaks if this waits a day.

1. Open your browser and go to the **Coolify dashboard**.
2. Select the **`www` / march-melee-pools frontend** application — the same one
   you redeployed for T2, not a Firebase Function.
3. Confirm the branch shown is **`main`**. Do not try to match a commit; `main`
   moves and the newest commit on it is the right one. If the commit shown looks
   stale, click **Refresh** or reload the page first.
4. Click **Redeploy** (some versions label it **Deploy**).
5. **You should see** the build log start streaming, then finish with a success
   state after roughly 2–5 minutes.
6. **If the build fails**, copy the last ~30 lines of the log and send them to me.
   Do not retry more than once — the same failure twice is a real failure.

### Step 4 — see the new copy, about 60 seconds *(after step 3)*

1. Go to **https://marchmeleepools.com/create/pickem** and sign in if asked.
2. Walk to the **Pick'em rules** step.
3. **Press the `?` key.** The panel should open on **"Pick'em wizard — Pick'em
   rules"**, and under **On this page** you should see **Confidence points**.
4. **You should NOT see** entries for Lock mode or Lock buffer. Those are the two
   §1 withdrew, and their absence is correct, not a bug.
5. Open one of your own Pick'em pools, go to the **My picks** tab, and press `?`.
   You should see **Making your picks**, **Quick picks** and **Tie-breaker
   prediction**.
6. **If the panel opens but is empty below the title**, tell me — that means the
   content did not ship with the bundle.

### Step 5 — nothing else needs you

No `functions/` deploy, no `firestore.rules` deploy, no indexes, no production
data migration. T9 touched none of them.

## 7. Questions I stopped on

1. **§1 — which of A, B or C?** The only blocking one. My answer is A.
2. **§2a — `pointsPerPick` and `primetimeBonus`: honour them in the scorer, or
   remove the controls?** Either closes the last T9 coverage row. Scoring change,
   so it is plan-gated whichever way you go.
3. **§2b, §2c, §2d, §2e — do you want these as their own tickets** in the plan, or
   handled ad hoc when their surfaces are next touched? T4 touches
   `NFLManagerView.tsx`, which is where §2a and §2c live, so there is a natural
   moment coming for those two.
