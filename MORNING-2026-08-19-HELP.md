# MORNING 2026-08-19 (help system) — T16 built, two topics released, and qodo is out of credits

This file **continues** `MORNING-2026-08-18-HELP-T9.md`, which continues
`MORNING-2026-08-18-HELP.md`. Both stay accurate; nothing here replaces either.

`MORNING-2026-08-18.md` remains the entry point for the PLAN-PAYMENT-LEDGER
work and this does not touch it.

> 🔴 **NOTHING MERGED TONIGHT, AND IT IS NOT BECAUSE THE WORK IS UNFINISHED.**
> **qodo ran out of credits partway through the night.** It reviewed #482
> normally at 03:33Z and by 05:04Z it was posting nothing but
> *"Qodo reviews are paused because your workspace is out of credits."* on
> every new PR. `CLAUDE.md` §2b makes qodo half of the mandatory joint gate, and
> a billing block is the strongest possible form of "did not report" — so two
> finished PRs are sitting open rather than merged. **Step 1 of the runbook is
> yours and takes five minutes.**

---

## 1. 🔴 qodo is out of credits — the one thing that needs you

**What happened.** qodo reviewed #482 at 03:33Z tonight. Every PR opened after
that got a single comment instead of a review:

> ⓘ **Qodo reviews are paused because your workspace is out of credits.** Ask
> your workspace admin to add credits to resume reviews.

**Why it stopped the night's work rather than slowing it.** `CLAUDE.md` §2b
says the stopping rule is joint — qodo clean **AND** codex clean **AND** my own
read of the diff. `.claude/skills/mmp-qodo-cycle/SKILL.md` §3 is explicit that a
billing notice is a FAILED check and must be reported to you as a subscription
problem, never counted as a pass. So both PRs below are complete and unmerged.

### Your options

| | Option | What you get | What you carry |
|---|---|---|---|
| **A** | **Add credits, then toggle each PR draft → ready** (recommended) | qodo re-reviews both within ~90 seconds, stamped at the current head. Absorb anything it finds and merge | Five minutes of your time, plus whatever the credits cost |
| **B** | Merge both on codex + CI + self-review, and say so on each PR | Both land this morning with no further work | Half the mandatory gate was unavailable on a 30-file change that touches every modal in the app. It is a judgement call you are making, not a rule the PRs satisfy |
| **C** | Leave both open until the subscription is sorted | Nothing to decide now | T16 has been overdue for three days and the `?` shortcut is in production without it |

**I would take A.** If the credits are not a quick fix, take **B** for #484
(five files, content only, seven codex rounds) and hold #483 until qodo can see
it — that one is the 30-file change.

⚠️ **One thing to fix in the watcher while you are there.** qodo's billing
notice has no `<h3>` heading, and `mmp-qodo-cycle`'s `summary()` filter matches
`NOISE` against the heading — so an empty heading passes the filter and the
notice is **counted as a qodo artifact**. The watcher on #483 therefore reported
`QODO PARTIAL` instead of `TIMEOUT`. PARTIAL is not a pass either, so nothing
was mis-gated, but the skill should treat a `qodo:billing-blocked` HTML comment
as noise regardless of heading. Not fixed tonight — it is a skill edit and it
wants your eye.

---

## 2. What was built

### #483 — PLAN-HELP-SYSTEM **T16**: every overlay shell registers with the overlay stack

**The ticket that was overdue three mornings running.** T16 is a prerequisite of
T15 (deploy) in the signed plan; T15 was taken first on purpose, so since
2026-08-18 the `?` shortcut has been live in production held up by a CSS-class
heuristic rather than by the mechanism meant to hold it.

Measured on `origin/main` at `93f44bb2`: **41 `fixed inset-0` elements, 6
carrying `role="dialog"`, 0 carrying `data-overlay-root`.** Every one of the 41
still carried the class pair the fallback matches, so nothing slipped through —
but nothing failed when one would, and that is the defect.

- `src/components/ui/OverlayRoot.tsx` is the backdrop element itself: it
  registers with the stack, carries `data-overlay-root`, and adds
  `role="dialog"` + `aria-modal` + an accessible name.
- **33 shells across 21 files** move to it; the six T2 registered by hand gain
  the marker.
- **Six of the 33 are not dialogs and say so** — the Squares randomiser and the
  playoff-results loading scrim, the full-bleed bracket editor, and the two
  Simulation Dashboard views. A `role="dialog"` an overlay has not earned lies
  to a screen reader.
- **One exemption with its reason in the test**: `ExportControls.tsx`'s
  `fixed inset-0` is an invisible click-away catcher behind a dropdown.

**Behaviour this changes on purpose:** Escape now closes these overlays (every
handler does exactly what that modal's own Cancel button does), and focus moves
into a dialog on open, wraps inside it, and returns to the opener on close.
`aria-modal="true"` claimed the rest of the page was inert and that claim was
false for 27 dialogs.

`?` behaves identically — every migrated shell already matched the fallback.

**Two guards, both watched to fail before being committed.**
`tests/overlay-stack-invariants.test.ts` reads the components as source and
fails when a `fixed inset-0` element is neither an `OverlayRoot`, nor marked,
nor exempt; `src/__tests__/overlayRoot.test.tsx` is eleven jsdom cases.

**Review: 7 codex rounds.** Round 1 came back clean and the review had not
started — rounds 2 to 6 each found a real defect, and four of them were in code
written to close the round before it. Escape dismissing a running delete; focus
capture racing `autoFocus`; the one shell that opens in place; an overlay
handing off to another; and a P1 for `aria-modal` with focus left outside.

### #484 — the two lock topics T9 withheld, released by #482

T9 wrote `settings.lockMode` and `settings.lockBufferMinutes`, carried both
through six codex rounds, and withdrew them on round 7 because the shipped
client ignored `lockMode`. **#482 fixed that**, so the copy is true and it
lands. **Two of T9's three open coverage rows close here** — the third,
`settings.pointsPerPick`, is §3a below and is still yours.

**Review: 7 codex rounds, and every single finding was the same shape** — copy
naming a behaviour nobody had re-read. That is voice rule 5. Worth reading the
PR body's table before writing any more help copy: three separate sentences
claimed the pick sheet shows the deadline (it shows kickoff times; the countdown
is on the pool home), one claimed a control is greyed out (true on the manager
form, false in the wizard where the same topic is placed), and two claimed a
mid-week buffer change moves a deadline in a direction that only holds half the
time.

---

## 3. Four defects still open, still yours, still unfixed

Unchanged from `MORNING-2026-08-18-HELP-T9.md` §2 — carried forward so they do
not get lost. All four are plan-gated; none was touched tonight.

### 3a. `pointsPerPick` and `primetimeBonus` are inert, and members are shown the numbers

`scorePickemEntry` (`functions/src/nflScoringEngine.ts:174-178`) awards exactly
**1** point per correct pick on a non-confidence pool and reads neither field.
The manager form sets both (`NFLManagerView.tsx:1336`, `:1345-1372`) and the
rules page shows them **to members** as what a pick is worth
(`NFLPoolRules.tsx:158-176`, `:220`). A pool set to 3 points a pick tells its
members three and pays one.

**Decision needed: honour them in the scorer, or drop the controls and the
rules-page rows.** Both are scoring changes, so both are plan-gated. This is the
last T9 coverage row.

### 3b. The Pick'em commissioner proxy pick has never worked

`NFLManagerView.tsx:841` calls `proxyPick` with a picks map keyed by the **week
number**; the `NFL_PICKEM` branch of the callable
(`functions/src/poolExceptions.ts:340-344`) reads every key as a **game id** and
fails with `Game 3 not found in week 3.` Survivor and Margin are keyed by week
and work.

### 3c. The NFL manager's "List Pool Publicly" toggle does nothing

`handleSaveSettings` sends `settings.isListedPublic`
(`NFLManagerView.tsx:665`, `:733-739`); Browse decides an NFL pool's listing
from the **top-level** `isPublic` (`src/utils/publicListing.ts:34`), which that
save never writes. The create wizard writes both, so only the later toggle is
inert. Authorization work, because `isPublic` is read by `firestore.rules`.

### 3d. Setting-aware help copy cannot render

`HelpCopy.template` exists but `TopicScope` is
`Pick<HelpScope, 'poolType' | 'audience'>` and **no surface publishes a pool's
settings**, so a template would render its `fallback` forever.

**This one got more expensive tonight.** Four review findings on #480 asked for
setting-conditional copy and were each answered by widening the static copy.
#484 hit it four more times: `settings.lockBufferMinutes` is now one topic
covering six different values across three pool formats, and three of its
paragraphs exist only to enumerate cases a template would resolve. A small
ticket to thread `settings` through `HelpScopeProvider` would let that copy
shrink instead of growing every time a setting gains a case.

---

## 4. Two things broken in YOUR checkout only — `main` and CI are green

Both were found before any work started tonight, so do not read them as
breakage from these PRs.

1. **`npx vitest run` in `D:\march-melee-pools` was failing ~5 files** with
   "Cannot find package 'jsdom'" and "@testing-library/react is not installed" —
   the checkout had not run `npm ci` since T2 added those devDependencies.
   **Fixed tonight**: `npm ci` was run there and jsdom is present.
2. **`tests/docs-state-invariants.test.ts` fails on
   `MORNING-2026-08-13-PART2.md + MORNING-2026-08-13.md`.** That PART2 file is
   **untracked** — a local scratch file that never got committed. The guard
   reads the working directory with `fs.readdirSync`, so any untracked
   `MORNING-*.md` breaks the suite locally while CI stays green. **Not touched**
   — it is your file. Commit it, delete it, or rename it out of the
   `MORNING-*.md` pattern; any of the three makes your local suite green.

You also have `NEXT-SESSION-PROMPT.md` and `PROMPT-NEXT-SESSION-OVERNIGHT.md`
untracked in that checkout. They do not match the guard's pattern and break
nothing.

---

## 5. What is NOT done

- **T4 itself.** The label migration is untouched: `NFLManagerView.tsx` still
  has **35** raw `<label>`, `COMMISH_TABS.hint` is still a string constant, and
  `tiebreakerCopy`'s hint is still side-channel copy. #484 is the part of T4's
  surface that #482 unblocked and that stands on its own; the rest is a content
  ticket of T9's size and it was not worth starting three hours in. The design
  work is written up in §6 so the next session does not re-derive it.
- **T3, T5–T8, T10–T15.** Unstarted. The order after T4 is unchanged: T3, then
  T10/T11.
- **No deploy.** Nothing merged, so there is nothing new to deploy. See §7
  step 4 — a Coolify redeploy is only needed once these PRs land.

---

## 6. T4, mapped out — do not re-derive this

Measured tonight against `origin/main` at `93f44bb2`.

**35 raw `<label>` in `NFLManagerView.tsx`**, and here is what each one binds
to. The plan's "34" predates the weekly-prize-places editor.

- Already have a topic, so the label just needs the `HelpTip`: Pool Name
  (`name`), Entry Fee (`settings.entryFee`), Entries per Player
  (`settings.maxEntriesPerUser`), Payment Instructions, Host Name
  (`managerName`), Contact Email, Weekly Tie-Breaker
  (`settings.weeklyTiebreaker`), Rank / % of the weekly pot
  (`settings.payouts.places.*.*`), Lock Mode and Lock Buffer (**new in #484**).
- Need copy written: Contact Phone, Contact Link Options, Payout Method,
  Weekly pots, Season pot, Weekly Deadline.
- Must NOT get copy: Base Points Per Correct Pick and Primetime Game Bonus
  Points — §3a, the field is inert.
- Belong to T10/T11, so allowlist rows pointing there: Strikes Limit, Max
  Rebuys, Rebuy Cutoff Week, Rebuy Fee, Tie Outcome, Team-Use Limit, the
  Margin payout method and its two split fields.
- Ops forms: Extra Minutes, Reason ×3, Entry/Member, Week, Team. The proxy-pick
  three must not describe a working feature — §3b.

**Two shape decisions worth keeping.**

1. **The `HelpTip` is a SIBLING of the label, never nested.** The wizard's
   `LabelRow` (`src/components/wizard/fields.tsx:37-47`) explains why: the tip's
   trigger is a `<button>`, and a control inside a `<label>` is activated by
   clicking the label text — so nesting makes "click the field name" open a
   tooltip. It also renders a `<span>` rather than a `<label>` when there is no
   `htmlFor`, because a label associated with nothing announces as a stray
   string. Every one of the 35 manager labels is in exactly that state today.
2. **`FieldLabel` already exists**, exported from `src/components/ui/Field.tsx`.
   Do not create `src/components/ui/FieldLabel.tsx`.

---

## 7. Runbook

### Step 1 — add qodo credits *(the only blocking one)*

1. Open **https://app.qodo.ai/account/billing/manage-subscription** in a
   browser and sign in.
2. Add credits to the workspace. **You should see** the workspace credit balance
   above zero when you are done.
3. **If the page says the subscription itself has lapsed** rather than the
   credits, that is a different problem — tell me and I will hold both PRs.

### Step 2 — make qodo re-review the two open PRs

Run these one at a time. **PowerShell 5.1 rejects `&&`, so there is one command
per box on purpose.**

```bash
gh pr ready 483 --undo
```

```bash
gh pr ready 483
```

**You should see** `✓ Marked pull request #483 as a draft` and then
`✓ Marked pull request #483 as ready for review`. Now the same for #484:

```bash
gh pr ready 484 --undo
```

```bash
gh pr ready 484
```

**You should see** a qodo review appear on each PR within about 90 seconds —
first a *"Qodo is busy working"* placeholder, then a **PR Summary by Qodo**
comment, and then a **Code Review by Qodo** comment which can land ten or more
minutes later. **The Code Review comment is the review**; the summary is not.

**If nothing appears within 20 minutes**, stop and tell me — do not merge on a
missing review.

### Step 3 — merge, once qodo has actually reported AND SETTLED

⚠️ **The first sight of a "Code Review by Qodo" comment is not the review.**
qodo EDITS that comment in place afterwards, and on #346 it went from
`Bugs (0)` to `Bugs (3)` minutes later — `created_at` never moved. Merging on
first sight would satisfy the gate against findings qodo had not finished
writing.

**The safe move is to hand it back to me.** Paste both PR links into a session
and say "run the qodo cycle" — the watcher in
`.claude/skills/mmp-qodo-cycle/SKILL.md` settles on the comment's `updated_at`
holding steady and will not report until it does.

**If you would rather do it yourself:** wait until at least **fifteen minutes**
after the Code Review comment first appears, reload the PR, and check the bug
count in that comment is the same number you saw before. Only then is it the
review.

Then, and only then, with its findings either fixed or answered:

1. Read the qodo findings on **#483** first — it is the 30-file change.
2. If it found nothing, merge it:

```bash
gh pr merge 483 --squash
```

3. Then #484:

```bash
gh pr merge 484 --squash
```

4. **If qodo found something on either**, do not merge that one — paste the
   finding to me and I will absorb it. Its defect findings have been 5 for 5
   valid across #480–#482.

### Step 4 — redeploy `www` in Coolify *(only after step 3)*

Both PRs change the shipped bundle. Neither breaks anything while it waits.

1. Open the **Coolify dashboard** in your browser.
2. Select the **`www` / march-melee-pools frontend** application — the same one
   you redeployed after #482, not a Firebase Function.
3. Confirm the branch shown is **`main`**. Do not try to match a commit; `main`
   moves and the newest commit on it is the right one. If it looks stale, click
   **Refresh** or reload the page first.
4. Click **Redeploy** (some versions label it **Deploy**).
5. **You should see** the build log stream and finish with a success state after
   roughly 2–5 minutes.
6. **If the build fails**, copy the last ~30 lines of the log and send them to
   me. Do not retry more than once — the same failure twice is a real failure.

### Step 5 — check T16 in production, about two minutes *(after step 4)*

1. Go to **https://marchmeleepools.com** and sign in.
2. Open one of your own pools and press the **`?`** key. The Help panel should
   open.
3. Now open any modal — the **Share** dialog on a pool is the easiest — and
   press **`?`** again. **The Help panel must NOT open.**
4. Press **Escape**. The modal should close, and only the modal.
5. Open that modal again and press **Tab** a few times. **Focus must stay inside
   the dialog** and wrap round rather than moving to the page behind it.
6. Close the modal. **Focus should return to the button you opened it with** —
   press Enter and the modal should open again.
7. **If any of 3, 5 or 6 misbehaves**, tell me which one and on which pool type.
   That is the whole point of T16 and I would rather hear it than not.

### Step 6 — fix your local test suite, one minute

Your untracked `MORNING-2026-08-13-PART2.md` breaks
`tests/docs-state-invariants.test.ts` locally (§4). Decide what it is:

```bash
git -C D:/march-melee-pools status --short
```

Then either commit it, delete it, or rename it so it does not start with
`MORNING-`. **You should see** the suite go green afterwards:

```bash
npx vitest run tests/docs-state-invariants.test.ts
```

### Step 7 — answer §3a when you have a minute

Not blocking, but it is the last open T9 coverage row and it is the one where
members are being shown a number the scorer does not use. Reply
**"honour them"** or **"drop the controls"** and I will write the plan.

---

## 8. Questions I stopped on

1. **§1 — A, B or C on the qodo credits?** The only blocking one. My answer is
   **A**.
2. **§3a — `pointsPerPick` and `primetimeBonus`: honour them in the scorer, or
   remove the controls?** Plan-gated either way.
3. **§3b, §3c, §3d — their own tickets, or handled when their surfaces are next
   touched?** T4 touches `NFLManagerView.tsx`, where §3a and §3c live.
4. **§3d specifically — is it worth a small ticket now?** It cost four widened
   sentences on #480 and four more on #484. My answer is yes, before T10 and
   T11 add two more pool formats' worth of cases.
5. **§1's watcher note — do you want the `mmp-qodo-cycle` skill fixed to treat
   `qodo:billing-blocked` as noise?** One-line change, but it is a skill edit.
