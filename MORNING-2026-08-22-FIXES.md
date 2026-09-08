# MORNING 2026-08-22 — the six live-test findings. Four fixed, one answered, one unreproducible.

> **This continues `MORNING-2026-08-20-SPREADS.md`,** which stays the entry point
> for PLAN-NFL-SPREAD-FREEZE. Nothing in it is cancelled: its §4 (the Tuesday
> week-4 sequence) and §5 (the four questions) are carried into §5 and §7 below
> rather than left behind.

**One PR: [#495](https://github.com/kstruck/MMPoolsV3/pull/495) — MERGED
overnight as `eea00f57`. Frontend only.** No functions deploy, no rules deploy.
It owes **a Coolify rebuild of `www` and nothing else**.

✅ **UPDATE 2026-08-21 — KEVIN RAN STEPS 1–5. THE REBUILD IS LIVE AND THE FIXES
ARE CONFIRMED IN PRODUCTION.** Issues 1, 2 and 4 verified by Kevin on the live
site. **Step 6 is now DONE too** — Kevin confirmed `nflFrozenSpreadBackfill`
reads `{enabled: false, dryRun: false}` and `nflSpreadLock` reads
`{enabled: true, dryRun: FALSE}` in the Firebase console on 2026-08-21, so the
freeze is **ARMED**. Nothing on this list is outstanding. Three
verdicts changed:

- **Issue 6 is CANCELLED, by Kevin.** *"Buttons still not working but only in
  Chrome. In Edge browser, they seem to be working. This is a Chrome issue since
  I am seeing this on other sites. Nothing to fix on the site."* That closes it —
  it matches both clean measurements taken here.
- **Issue 3 is REOPENED, and Kevin is right.** He answered **Q1 = (a) the `Set`
  column is enough**, and then found the `Set` column showing **nothing** on the
  ATS per-game pool. **I found the cause: the server deliberately withholds it
  from plain members.** See §4, which is rewritten — it needs a ruling from
  Kevin, because the fix reverses one of his own.
- **Issue 5 has a new leading cause and a defensive fix has shipped.** Kevin:
  *"the user said it was after all picks were in"*, in the Pick'em pool
  `0ybpLzY7fJ3NJbDj0j1l`. That eliminates the partial-sheet candidate. See §6.

**Both changes are in [#497](https://github.com/kstruck/MMPoolsV3/pull/497),
which owes ONE MORE COOLIFY REBUILD and nothing else.**

---

**Headline: five display defects, four of them measured against production in
your own pool, are fixed. Issue 6 (browser Back / Refresh / Home) I could not
reproduce — I need one answer from you before spending more on it.**

---

## 1. Do these, in this order

### Step 1 — #495 is already merged. Nothing to do. (10 seconds)

I merged it overnight under the standing grant, after all seven CI checks came
back **success** (CodeQL, build-and-test, Analyze, emulator-tests, nginx-validate,
lint, security-audit). It landed as `eea00f57` on `origin/main`.

Step 3 below proves it. To look: <https://github.com/kstruck/MMPoolsV3/pull/495>.

### Step 2 — pull `main` in the MAIN checkout (30 seconds, MANDATORY)

Not because this PR needs a deploy — it does not — but because the next thing
that *does* will silently ship a stale tree if you skip it. This is CLAUDE.md §3
step zero and it has already cost one whole deploy.

```powershell
git -C D:\march-melee-pools pull --ff-only origin main
```

**You should see:** `Fast-forward` and a file list including
`src/components/NFLPoolDashboard/WeekChecklist.tsx`.

**If you see `Already up to date` but the PR says Merged:** you are on a branch
other than `main` in that checkout. Run `git -C D:\march-melee-pools branch --show-current`
and tell me what it prints.

### Step 3 — verify the merge landed on `origin/main`

```powershell
git -C D:\march-melee-pools log origin/main --oneline -3
```

**You should see:** the top line is
`eea00f57 NFL dashboard: say which lock, say a tie is a tie, stop loading for ever (#495)`.

**If it is not there:** stop and tell me — something has reverted the merge.

### Step 4 — Coolify rebuild of `www` (the only deploy this needs)

There is no CLI path to Coolify from this machine, so this one is yours.

1. Open the Coolify dashboard in your browser.
2. Select the **`www`** application (the March Melee Pools frontend).
3. Click **Redeploy**.
4. **You should see:** a build log that ends with a success line, and the app's
   status returns to **Running**.
5. **If the build fails:** copy the last 20 lines of the build log and send them
   to me. Do not retry blindly — the previous build is still serving.

### Step 5 — confirm the fixes in production (3 minutes)

Do this AFTER the Coolify rebuild finishes, in a hard-refreshed tab
(**Ctrl+Shift+R**).

1. Open <https://www.marchmeleepools.com/pool/0ybpLzY7fJ3NJbDj0j1l?tab=grid&week=3>.
2. **You should see:** the **MAJORITY** row now reads **`Split 50%`** on
   **CAR/JAX**, **BUF/CLE**, **NYG/MIA** and **PHI/NE**. Before the rebuild all
   four were blank (`—`).
3. Open <https://www.marchmeleepools.com/pool/0ybpLzY7fJ3NJbDj0j1l?tab=picks&week=4>.
4. **You should see:** the **Pick Distribution** cards now read **NO PICKS YET**
   instead of **LOADING PICKS…**, and the card beside them reads **WAITING ON
   SPREADS** instead of **PICKS ARE OPEN**.
5. **If any of these still show the old text:** the browser is serving a cached
   bundle. Hard-refresh again, then check the Coolify build actually finished.

### Step 6 — ✅ DONE. Kevin confirmed `enabled: false` on 2026-08-21.

✅ **AND he also flipped `system/config.nflSpreadLock.dryRun` to `false` the same
day — three days ahead of §5's Mon 08-24 step. THE FREEZE IS ARMED.** Nothing
fires automatically before Tue 2026-08-25 09:00 ET (`0 9 * * 2` ET), but every
**Freeze this week now** and **Freeze Next Week (LIVE)** click writes for real
from now on, and a slate freezes exactly once. The dry-run safety net that caught
the 2026-08-21 LIVE click is gone. See the HANDOFF top box.

<details>
<summary>The original step, kept as the record</summary>

### Step 6 — confirm `nflFrozenSpreadBackfill` is disarmed (2 minutes, YOURS)

**I could not verify this and it is the one live-config item I am handing back.**
The Operations panel does not display flag values, and reading `system/config`
needs an auth token I am not permitted to extract. I deliberately did **not**
click an Operations button to probe it — that panel is where the wrong button of
four adjacent ones got clicked twice on 2026-08-21.

1. Open the Firebase console for **`gridiron-gamble-uzuqo`** → **Firestore
   Database**.
2. Open the document **`system/config`**.
3. Find the map field **`nflFrozenSpreadBackfill`**.
4. **You should see:** `enabled: false`.
5. **If it reads `enabled: true`:** click the pencil beside `enabled`, set it to
   **false**, click **Update**. The cutover migration is done (33 of 33 written on
   2026-08-21) and the backfill's non-dry leg has no remaining job.

</details>

---

## 2. Verdict on each of your six findings

| # | Your report | Verdict | Where |
|---|---|---|---|
| 1 | Per-game lock wording is misleading | **CONFIRMED — FIXED, verified by Kevin** | #495 |
| 2 | Does per-game reveal actually work? | **IT WORKS. Not a bug. Confirmed by Kevin.** | §3 |
| 3 | Indicate that picks were made | ⚠️ **REOPENED — cause found, needs your ruling** | §4 |
| 4 | Majority row has gaps | **CONFIRMED LIVE — FIXED, verified by Kevin.** Every gap was an exact 2–2 tie. | #495 |
| 5 | Stale "you have not entered your picks" | **NOT REPRODUCED — defensive fix shipped in #497** | §6 |
| 6 | Back / Refresh / Home "not working anywhere" | ❌ **CANCELLED by Kevin — Chrome-wide, not the site** | §6 |

And **two defects you did not report, which I found while checking yours**, both
fixed in the same PR:

| # | What | How I found it |
|---|---|---|
| 7 | Pick Distribution says **LOADING PICKS…** for ever | All 16 cards of preseason week 3 stuck, live, right now |
| 8 | **"Spreads Not Yet Finalized"** printed directly above **"PICKS ARE OPEN"** | Same screen, opposite claims |

### What #495 actually changes

**1 — the checklist banners now say WHICH lock their timestamp is.**
`weekDeadline` returns the *earliest* kickoff on a weekly pool and the *latest* on
a per-game one, and both banners printed `locks <ts>` over the top of it. So
*"Preseason Week 2 picks are in — locks Sun, Aug 23 · 5:55 PM"* on a per-game pool
read as "nothing shuts until Sunday evening" when the Friday pick froze on Friday.
A per-game week now reads **"each pick locks at its kickoff — last Sun, Aug 23 ·
5:55 PM"**. The same distinction the Lock Status card already drew with "Next pick
locks" vs "Locks in".

**4 — an exact tie is now printed as a tie.** `majorityFor` returned `null` for an
even split, and the grid renders `null` as `—` — **the same glyph the legend
spends on "the pick IS revealed and that player made none"**. One symbol, two
meanings, in one table. The four blanks in your screenshot (CAR/JAX, BUF/CLE,
NYG/MIA, PHI/NE) are all exact 2–2 splits; I confirmed that against the live cells
before changing anything. They now read **`Split 50%`**, and the legend says so.

**7 — Pick Distribution stops loading.** Its placeholder chose its text on
*"loaded AND this game has an entry in the aggregate"*, but a consensus document
is only written on a game's **first** pick — so an unpicked game never has one and
never leaves the spinner. Every card of preseason week 3 is stuck as I write this.

**8 — the Lock Status card knows about the spread gate now.** The ATS sheet
refuses to render until every line of the week is frozen; the card only knew about
the time lock, so it cheerfully said *"Picks are Open / Make changes before
kickoff"* underneath *"Spreads Not Yet Finalized"*. It now says **"Waiting on
Spreads"**. **You will be on this exact screen on Tuesday** when the freeze refuses
app week 4 for want of lines.

**Bonus — the checklist no longer offers "Make Picks" into a blocked sheet.** Same
dead end the "Pick next week →" button was removed for on 2026-08-05. The nag
stays (picks are still owed); the button that goes nowhere is gone.

---

## 3. Issue 2 answered — per-game reveal works, and it is deliberate

**Yes. On a PER_GAME pool, other players see your pick for a game whose own lock
has passed, while your later picks stay hidden.** That is the design, it is
enforced on the SERVER, and the client cannot widen it.

⚠️ **A game's lock is its KICKOFF MINUS THE LOCK BUFFER, not the kickoff.** The
default buffer is **5 minutes**, so the standard pool reveals each pick five
minutes BEFORE that game starts — a commissioner's week extension can push it
later, never earlier. Do not tell a member their pick stays hidden until kickoff;
it does not. (codex caught exactly this sentence in this document.)

`getPoolPicks` (`functions/src/nflPickReveal.ts`) assembles its response as an
**allowlist of revealed game ids** — `weekRevealFor` filters the week's slate to
the games whose own effective lock has passed and returns only those. The grid
prints `?` for everything else because it was never sent the answer. A
mixed-locked week is the case that machinery exists for.

**Two things that change the answer, and both are easy to trip over:**

- **A confidence pool reveals the WHOLE WEEK at once**, even though its stored
  `lockMode` still reads `PER_GAME`. A confidence sheet spends each weight across
  the week exactly once, so the week has to be answered — and revealed — as one
  unit. **Your `2026 NFL Weekly Pick'em` pool is a confidence pool**, so what you
  were looking at reveals weekly, not per game. If you want to *see* per-game
  reveal, you need the non-confidence ATS pool.
- The reveal is a **poll**, not a subscription. A lock passing is a clock event
  with no Firestore write behind it, so nothing can push it. A newly kicked-off
  game appears within the poll interval, not instantly.

**No action needed. Nothing to fix here.**

---

## 4. Issue 3 — REOPENED, then ANSWERED. Both options taken.

✅ **UPDATE 2026-08-21 evening.** Kevin: *"Go with both of these."* **(ii) shipped
in #497** and is live. **(iii) is now `PLAN-MEMBER-PICK-PROGRESS.md`** — written,
swept, ten review rounds absorbed, **no code**, and blocked on his sign-off of
Q1–Q4 plus a ruling on one over-cap round. The section below is the diagnosis that
produced both options and is kept as the record.

---

### The diagnosis — the `Set` column is withheld from members on purpose.

**You are right and my first answer was wrong.** I checked
`/pool/6P3vfEQ5KGK8ocPTURRi` (TEST ATS POOL) in your browser and found the cause.

**As SUPER_ADMIN the column works.** App week 3 reads `16/16` for all three
players; app week 4 reads `0/16` for all three, which is true — nobody has picked
a week whose lines are not frozen.

**As a plain member it reads `?` for everyone else, all week, by design.**
`functions/src/nflPickReveal.ts:319` is one line:

```ts
if (!isParticipant || reveal.weekRevealed) {
  counts[memberUid] = weekPickCount(...);
}
```

A **participant** gets no counts at all until the WHOLE week reveals. The comment
above it is your own ruling of 2026-08-14: *"Handing it to participants unchanged
would let every member watch every other member's sheet fill in live: 'Kevin 14 of
16' ticking to 15 tells you he is still working, and nobody asked for that."*

**That is why you saw nothing.** `TEST ATS POOL` is hosted by Kevin Struck, so
**Ron is a plain member of it** — the account in your screenshot. And on a
PER_GAME pool "the whole week is revealed" is the LAST kickoff, so a member sees
no indication for the entire week.

### ❓ QUESTION 1 (REPLACES the old one) — do you want to reverse that ruling?

Your answer of **(a) the `Set` column is enough** only holds if members can see
it. Two ways to make that true:

- **(i) Give members live counts too.** Delete the `!isParticipant ||` guard: one
  line, plus its tests and the CONTEXT.md sentence. **This reverses your
  2026-08-14 ruling in your own words, so I will not do it without you saying
  so.** It is a `functions/` reveal-boundary change — authorization — so it takes
  a PLAN doc and a functions deploy, not a Coolify rebuild.
- **(ii) Keep the ruling, fix the impression.** Shipped in #497 already: the grid
  legend now says plainly *"Other players' counts are shown to the pool's
  commissioner at any time — chasing missing picks is their job — and to everyone
  else once the whole week is revealed; until then they read `?`."* Before this,
  a member saw a wall of `?` with the legend claiming the count *"is available
  before anything is revealed"*, which was simply false for them. **That sentence
  was a lie to members and it is fixed either way.**

**My recommendation: (ii) alone.** The commissioner is the person whose job is
chasing missing picks, they already have the column, and "who has picked yet" is
a live feed of other people's behaviour that you deliberately closed nine days
ago. If you want (i) anyway, say so and I will write the PLAN.

**A third option if (ii) is not enough:** show members a POOL-WIDE count — "12 of
16 players have their picks in" — which is an aggregate that names nobody, the
same shape as the Majority row you already ruled visible at all times. That is
still a functions change but it does not reverse the K1 ruling. Say the word and
I will plan that instead.

---

## 5. Tuesday is unchanged — the week-4 freeze still needs you

Carried forward verbatim from `MORNING-2026-08-20-SPREADS.md` §4, because #495
changes none of it.

- ~~**Mon 2026-08-24** — set `system/config.nflSpreadLock.dryRun` = `false`.~~
  ✅ **DONE 2026-08-21, three days early. THE FREEZE IS ARMED.** Nothing fires
  before Tuesday either way, so the early flip costs nothing automatic — but the
  dry-run net that made a LIVE click harmless is gone, and **a slate freezes
  exactly once.** The report's own `dryRun` field is still the truth, not the
  button label.
- **Tue 2026-08-25, after 09:00 ET** — the freeze fires on **app week 4** (your
  preseason week 3). **Expect it to refuse:** ESPN carried **0 of 16** lines as of
  2026-08-21 and preseason lines land about 1.4 days before kickoff (Thu 08-27
  23:00Z). A refusal is the all-or-nothing rule working, not a fault.
- **The repair, in order:** NFL Schedule → Spread Manager → Preseason / **Week 4**
  → **Fetch Games** → type a number into every empty row → **Save Working
  Lines** → then **Freeze this week now**. ⚠️ **The save is not optional and the
  order is the trap** — the freeze reads the DATABASE, not the screen, and a slate
  freezes exactly once.
- **Wed 2026-09-09** is regular-season week 1. You want it frozen **early** via
  **Freeze this week now**, because no games precede it. ESPN already carries
  16/16 lines for regular weeks 1–4.

**Button names, so the wrong one is not clicked again:** Operations now reads
**Freeze Next Week (dry run)** and **Freeze Next Week (LIVE)** — I confirmed those
labels in the live panel tonight. The two backfill buttons are separate cards.

---

## 6. Issue 5 — new cause, defensive fix shipped. Issue 6 — closed.

### Issue 5 — a failed read of the member's own entry was reported as "no entry"

**Your new detail eliminates my first candidate.** *"It was the Pick'em pool
`0ybpLzY7fJ3NJbDj0j1l` and the user said it was after all picks were in."* So it
is not a partial sheet, and that pool is a **confidence** pool, which locks and
reveals as one week — the per-game candidate is out too.

**What is left fits the report exactly, including the refresh.**
`dbService.subscribeToMyNFLEntry` is the ONE source for the viewer's own picks.
Its success path already tells an absent document apart from a present one — and
its **error** path also called back with `null`. So a failed read was
indistinguishable from "you have not picked".

That is not cosmetic, because **Firestore's `onSnapshot` TERMINATES a listener on
error.** One errored snapshot — a token refresh landing mid-flight, a transient
rules `get()` failure — and the member reads **"picks not in yet" over a
completed sheet for the rest of that page's life.** Only a reload re-subscribes.
**That is the shape of the report: it does not fix itself, and a refresh fixes
it.**

**#497 stops the error path inventing state.** It logs the failure and keeps the
last known entry rather than overwriting it with a claim it cannot support. A
member who genuinely has no entry is still told so, by the success path, which is
the only path that knows. A source-grep invariant in
`tests/nfl-surface-invariants.test.ts` pins it.

⚠️ **I am NOT claiming this is proven to be your bug.** It is a real defect on its
own merits and it is the only remaining explanation I can find that produces
"stuck until refresh". **When you test it again, if it recurs after the #497
rebuild, open DevTools → Console first and look for
`Error subscribing to own NFL entry:` — that line now survives the failure and
will tell us in one look whether this was it.**

### Issue 6 — CLOSED. Your call, and it matches what I measured.

Kevin: *"Buttons still not working but only in Chrome. In Edge browser, they seem
to be working. This is a Chrome issue since I am seeing this on other sites.
Marked this as a cancelled issue. Nothing to fix on the site."*

Agreed, and it is consistent with both measurements taken here: no service
worker, no `beforeunload`, no history flood, and `history.back()` correctly
restored both the URL and the rendered content. **Nothing further owed.**

---

## 7. Still open — carried forward, nothing lost

> ## 🟢 RE-DERIVED 2026-08-28 against `origin/main` = `f161b51d` — **ALL FOUR HELP-SYSTEM DEFECTS BELOW ARE CLOSED, AND SO IS T4.**
>
> This section was written on 2026-08-22 and was believed to be the open list.
> An overnight triage checked every claim in it against the code rather than
> against the doc, and **five of the items it carries have shipped since.** They
> are struck through below with the evidence, rather than deleted, so this file
> stays readable as the record of what was true when it was written.
>
> | Item | Status on `f161b51d` | Evidence |
> |---|---|---|
> | **(a)** `pointsPerPick` / `primetimeBonus` inert | **CLOSED — deleted, not honoured** | Kevin ruled 2026-08-22 in `PLAN-DELETE-INERT-PICKEM-SCORING.md` (§ "SIGNED … DELETE THEM"). Every control and member-facing row is gone; `src/help/coverage-allowlist.ts:119` records the PERMANENT row and why the schema still accepts the field. |
> | **(b)** Pick'em commissioner proxy pick has never worked | **CLOSED** | `src/utils/proxyPickPayload.ts` builds the payload PER POOL TYPE and refuses a slate it cannot key against, BEFORE the confirm dialog. Tested in `src/utils/proxyPickPayload.test.ts` and pinned in `tests/nfl-surface-invariants.test.ts`. |
> | **(c)** "List Pool Publicly" writes `settings.isListedPublic`, Browse reads `isPublic` | **CLOSED** | `publicListingUpdate()` (`src/utils/publicListing.ts`) now returns BOTH halves from one call, with the comment naming this exact defect at `NFLManagerView.tsx` `handleSaveSettings`. Tested in `src/__tests__/browsePublicListing.test.ts`. |
> | **(d)** `HelpCopy.template` can never render | **CLOSED** | `TopicScope` carries `settings` (`src/help/registry.ts:55`), and `registry.ts:45` says so explicitly: *"Before it was here, `HelpCopy.template` could not fire anywhere."* |
> | **T4** — 35 raw `<label>` in `NFLManagerView.tsx` | **CLOSED AND GUARDED** | `grep -c '<label' src/components/NFLPoolDashboard/NFLManagerView.tsx` returns **0**, and `tests/help-manager-label-coverage.test.ts` fails the build if one comes back. |
>
> **What IS still open on the help plan** is T5–T8 (and T15/T16): the
> `FieldLabel` migration for the Squares/Bracket/Props/Playoff manager surfaces
> and the rules-page readers. **~270 raw `<label>` remain across `src/`** — that
> is T5–T7's scope, NOT T4's. The heaviest files are
> `BracketPoolDashboard.tsx` (23), `admin/SuperAdminBillingPanel.tsx` (20),
> `WizardStepReminders.tsx` (18) and `SuperAdmin.tsx` (18).
>
> One prerequisite for that half shipped overnight: the toggle switch now lives
> in `src/components/ui/Switch.tsx`, so four of T5's files no longer need a raw
> `<label>` for it. T5's remaining blocker is CONTENT, not markup — the Squares
> rule-variation and charity fields have no topics yet, unlike the basics fields,
> where 13 of 14 ids already resolve for a `SQUARES` commissioner.

### ~~Four help-system defects, all yours to schedule, all plan-gated~~ — ALL FOUR CLOSED, see the box above

- **(a) `settings.pointsPerPick` and `settings.primetimeBonus` are INERT.**
  `scorePickemEntry` (`functions/src/nflScoringEngine.ts:174-178`) awards exactly
  **1 point per correct pick** and reads neither field — while
  `NFLManagerView.tsx` lets you set them and `NFLPoolRules.tsx` shows those
  numbers **to members** as what a pick is worth. **Decision needed: honour them
  in the scorer, or delete the controls and the rules-page rows.** This is the
  last open PLAN-HELP-SYSTEM T9 coverage row, and it deploys into a live scorer.
- **(b) The Pick'em commissioner proxy pick has NEVER worked.**
  `NFLManagerView.tsx:841` keys the picks map by **week number**;
  `poolExceptions.ts:340-344` reads those keys as **game ids** and throws
  *"Game 3 not found in week 3"*. Survivor and Margin are keyed by week and work.
- **(c) The NFL manager's "List Pool Publicly" toggle writes
  `settings.isListedPublic`; Browse reads top-level `isPublic`
  (`src/utils/publicListing.ts:34`).** The toggle does nothing.
- **(d) `HelpCopy.template` can never render.** `TopicScope` is
  `Pick<HelpScope,'poolType'|'audience'>` and nothing publishes a pool's settings.
  Has already cost eight deliberately-widened sentences across #480 and #484.

### ~~PLAN-HELP-SYSTEM T4 not started~~ — T4 SHIPPED AND IS GUARDED (re-derived 2026-08-28)

~~`NFLManagerView.tsx` still has **35 raw `<label>`** elements with no help topic.~~
It has **zero**, and `tests/help-manager-label-coverage.test.ts` keeps it that
way — its headline assertion is `expect(code.match(/<label/g) ?? []).toEqual([])`
for that file, so one coming back fails the build.

~~T3, T5–T8 and T10–T15 are also unstarted.~~ **T3 and T10–T14 have all shipped**
since this was written — #619 (T10), #620 (T12), #621 (T13), #622 (T11), #623
(T3), #624 (a T5+T6 content slice), #625 (T14).

**Genuinely unstarted on 2026-08-28: T5, T6, T7, T8, T15, T16.** The label→topic
map in `MORNING-2026-08-19-HELP.md` §6 is still the reference for T5–T7.

### Smaller, known, unowned

- `src/types/nflPoolTypes.ts:61` says `pickMode: 'ATS'` is *"reserved for V2"*.
  **Stale** — ATS ships in the create wizard and `gradePickemGames` grades it.
- `ManagerDashboard.tsx` has no importer. Dead code, delete candidate.
- The `mmp-qodo-cycle` watcher counts qodo's **billing notice** as a real review
  artifact (the notice has no `<h3>` and the noise filter is heading-anchored).
  Fix before any restore. qodo is DORMANT and this is not urgent.
- `PLAN-IMPORTER-SAFETY.md` §1.1/§1.5 still owns the general importer race. #490
  closed the freeze's half; a concurrently **created** document still raises no
  Firestore conflict.

### Three Operations-panel defects from 2026-08-21

The button-naming one is **fixed** — the panel now reads "Freeze Next Week (dry
run)" / "(LIVE)", confirmed live tonight. The other two stand:

- `OperationsPanel.tsx:536` slices every result to **400 characters**, and its own
  line 79 says *"KEY ORDER IS LOAD-BEARING"*. `backfillFrozenSpreads` puts a
  33-entry `plannedWrites` array before `skipped`, `failures` and `nextCursor`, so
  those three can never be read. Move the scalar counts to the front.
- The backfill's `admin_audit` row is not the "reviewable evidence" its comment
  claims: `capMetadata` collapses every array to the literal `"[array]"`.

### The four questions from `MORNING-2026-08-20-SPREADS.md` §5

Q1 is **resolved** (option B, shipped as #494). Q2, Q3 and Q4 are still open and
still yours:

- **Q2 — `system/config.currentSeason` is `2025`** while everything else is 2026.
  **Still unexplained, still untraced, still untouched.** Worth an hour to find
  what reads it before September surprises us. **Do not change it blind.**
- **Q3 — the job is still named `lockNFLSpreadsJob`** though it now fetches and
  freezes. Kept deliberately: renaming a scheduled function replaces the Cloud
  Scheduler entry and restarts the heartbeat history.
- **Q4 — IAM on `gridiron-gamble-uzuqo`.** A console or Admin-SDK write bypasses
  `firestore.rules` entirely. The frozen store is **detected**, not **prevented**,
  against that path. Reducing who holds datastore-write is the real control.

---

## 8. Gate record for #495

Measured on `fc38ff0c`, 2026-08-21.

| Gate | Result |
|---|---|
| `npx tsc -b` | clean |
| `npx vitest run` | **99 files / 1604 tests, 0 failed** (baseline 98/1595) |
| `npm --prefix functions test` | **112 files / 1690 tests, 0 failed** (unchanged) |
| `npm run build` | built in 8.63s |
| `npm run lint` | **1331 problems, 0 errors — +0 delta from baseline** |

`npm --prefix functions run test:emulator` was **not** run locally: the diff
touches no file under `functions/`. CI runs it regardless.

**Review — 2 codex rounds.** qodo is DORMANT (CLAUDE.md §2b), so the stopping rule
is **two** conditions: a clean codex round **and** my own read of the diff. Round 1
found one valid P2 — the per-game caption is wrong on a week a commissioner has
**extended**, because `gameLockAt` is `Math.max(kickoff - buffer, override)` and an
extension stops each kickoff being that game's lock. Absorbed, with its own test.
Round 2 came back clean. My own read agrees. **No open findings.**

**One honest limit:** the four production observations above are of the
**defects**. The **fixes** are verified by `tsc`, the unit tests and the
source-grep parity tests only. A local dev server is a different origin from
`marchmeleepools.com` and carries no signed-in session, so it could not render any
of these pool surfaces. **The first real render of this code is your Coolify
rebuild — which is why step 5 above is a verification step and not a formality.**
