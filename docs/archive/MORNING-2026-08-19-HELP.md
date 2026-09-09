# MORNING 2026-08-19 (help system) — T16 shipped, the lock topics shipped, qodo turned off

This file **continues** `MORNING-2026-08-18-HELP-T9.md`, which continues
`MORNING-2026-08-18-HELP.md`. Both stay accurate; nothing here replaces either.

`MORNING-2026-08-18.md` remains the entry point for the PLAN-PAYMENT-LEDGER
work and this does not touch it.

> ✅ **ALL THREE PRs ARE MERGED AND THE qodo QUESTION IS CLOSED.** This page was
> written overnight saying the opposite, because at the time it was true: qodo
> had run out of credits and `CLAUDE.md` §2b made it half of a mandatory gate,
> so #483, #484 and #485 sat finished and unmerged. On 2026-08-19 Kevin ruled
> **"Turn off the Qodo reviews for now"** and merged all three. §1 records the
> ruling and what it changes; §7 is what is left, and it starts with a Coolify
> redeploy.

---

## 1. ✅ qodo is off, and all three PRs are in

**The ruling.** Kevin, 2026-08-19: *"Turn off the Qodo reviews for now."*

**What it changes — written into the rules rather than left on this page.**

- `CLAUDE.md` §2b now says **DORMANT** rather than "check it on every PR". The
  whole procedure is kept, folded into a `<details>` block, exactly as it was
  during the 2026-07-25 → 2026-07-30 pause. This is a pause, not a deletion.
- `CLAUDE.md` §2c's stopping rule is **two conditions, not three**: a clean
  codex round AND your own read of the diff. A PR is never held waiting for a
  review that cannot arrive.
- **The codex cap is 10, flat.** The "5 past the cap" exception exists only to
  serve a qodo finding, so with qodo off nothing can force one.
- `.claude/skills/mmp-qodo-cycle/SKILL.md` is marked DORMANT and says not to
  load it on a PR.

**What it does NOT change.** CI still gates independently — it was never part of
the qodo gate. And if the bot posts a real review anyway, read it: its defect
findings were 5 for 5 valid across #480–#482. It is simply not something to wait
for.

**Merged 2026-08-19 14:14Z:** `d4cad066` (#483, T16), `893e921e` (#484, the lock
topics), `33377543` (#485, this document's first version).

### The bot itself is still installed

Turning the gate off is a rules change and it is done. **Removing the qodo
GitHub App from the repository is a different thing and I cannot do it** — it
lives in your GitHub account settings and needs your sign-in. Until you do, qodo
will keep posting its billing notice on every new PR. That is noise now rather
than a gate, and nothing waits on it.

If you want it silent: **GitHub → your profile → Settings → Applications →
Installed GitHub Apps → Qodo → Configure**, then either remove `MMPoolsV3` from
its repository access or uninstall the app. **You should see** no new qodo
comment on the next PR you open.

### One bug this exposed, not fixed

qodo's billing notice carries **no `<h3>` heading**, and the watcher in
`mmp-qodo-cycle` §1 matches its `NOISE` filter against the heading — so an empty
heading passes the filter and the notice is counted as a genuine qodo artifact.
Measured on #483: the watcher reported `QODO PARTIAL` where it should have
reported `TIMEOUT`. PARTIAL is not a pass, so nothing was mis-gated. The fix is
one line — also reject a body containing `<!-- qodo:billing-blocked -->` — and it
is written into the skill's dormancy note so a restore does not inherit it.

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
   `MORNING-2026-08-13-PART2.md + docs/archive/MORNING-2026-08-13.md`.** That PART2 file is
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
- **The deploy.** All three PRs are merged, so `main` now carries T16 and the
  lock topics and **none of it is live until `www` is redeployed** — §7 step 1.
  Coolify has no CLI path from this machine, so it is Kevin's step.

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

Three steps of this were about qodo credits. They are gone: Kevin turned the
gate off and merged all three PRs, so the list starts at the deploy.

### Step 1 — redeploy `www` in Coolify

All three merged PRs change the shipped bundle. Nothing breaks while it waits,
but none of last night's work is live until this runs.

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

### Step 2 — check T16 in production, about two minutes *(after step 1)*

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

### Step 3 — fix your local test suite, one minute

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

### Step 4 — answer §3a when you have a minute

Not blocking, but it is the last open T9 coverage row and it is the one where
members are being shown a number the scorer does not use. Reply
**"honour them"** or **"drop the controls"** and I will write the plan.

---

## 8. Questions I stopped on

1. ~~**§1 — A, B or C on the qodo credits?**~~ **ANSWERED 2026-08-19: neither.**
   Kevin turned the qodo gate off and merged all three PRs.
2. **§3a — `pointsPerPick` and `primetimeBonus`: honour them in the scorer, or
   remove the controls?** Plan-gated either way, and it is the last open T9
   coverage row.
3. **§3b, §3c, §3d — their own tickets, or handled when their surfaces are next
   touched?** T4 touches `NFLManagerView.tsx`, where §3a and §3c live.
4. **§3d specifically — is it worth a small ticket now?** It cost four widened
   sentences on #480 and four more on #484. My answer is yes, before T10 and
   T11 add two more pool formats' worth of cases.
5. **Do you want the qodo GitHub App removed from the repo as well as the gate
   turned off?** §1 has the click-path. Leaving it installed costs nothing but a
   billing-notice comment per PR.
