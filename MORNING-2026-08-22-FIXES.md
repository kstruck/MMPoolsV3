# MORNING 2026-08-22 — the six live-test findings. Four fixed, one answered, one unreproducible.

> **This continues `MORNING-2026-08-20-SPREADS.md`,** which stays the entry point
> for PLAN-NFL-SPREAD-FREEZE. Nothing in it is cancelled: its §4 (the Tuesday
> week-4 sequence) and §5 (the four questions) are carried into §5 and §7 below
> rather than left behind.

**One PR: [#495](https://github.com/kstruck/MMPoolsV3/pull/495) — MERGED
overnight as `eea00f57`. Frontend only.** No functions deploy, no rules deploy.
It owes **a Coolify rebuild of `www` and nothing else**.

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

---

## 2. Verdict on each of your six findings

| # | Your report | Verdict | Where |
|---|---|---|---|
| 1 | Per-game lock wording is misleading | **CONFIRMED — FIXED** | #495 |
| 2 | Does per-game reveal actually work? | **IT WORKS. Not a bug.** | §3 |
| 3 | Indicate that picks were made | **ALREADY EXISTS (the `Set` column). One question for you.** | §4 |
| 4 | Majority row has gaps | **CONFIRMED LIVE — FIXED.** Every gap was an exact 2–2 tie. | #495 |
| 5 | Stale "you have not entered your picks" | **NOT REPRODUCED. I need your steps.** | §6 |
| 6 | Back / Refresh / Home "not working anywhere" | **NOT REPRODUCED, twice.** | §6 |

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

## 4. Issue 3 — this already exists. One question.

The grid already has a **`Set`** column: it reads **`16/16`** for every player in
your screenshot, it is a server-side count that carries no pick content, and it is
available **before anything is revealed**. The legend says so. So "indicate that
picks were made even when hidden" is shipped.

**❓ QUESTION 1 — did you mean a per-CELL indicator instead?**

Today an unrevealed cell prints `?` whether that player picked that game or not.
Making the cell distinguish "hidden, but a pick exists" from "hidden, and none
made" is **a `functions/` change**: the server would have to send a per-game
has-a-pick flag for games it is deliberately not revealing, which widens what
`getPoolPicks` discloses. That is a reveal-boundary change and therefore
plan-gated — a PLAN doc, not a quick fix.

**Answer one of:**
- **(a)** "The `Set` column is enough" → I close this. *(My recommendation. The
  count answers "have they done their picks", which is the commissioner's actual
  question, and it costs no server change.)*
- **(b)** "Make `Set` more prominent" → frontend only, small, I do it next.
- **(c)** "I want the per-cell indicator" → I write the PLAN first.

---

## 5. Tuesday is unchanged — the week-4 freeze still needs you

Carried forward verbatim from `MORNING-2026-08-20-SPREADS.md` §4, because #495
changes none of it.

- **Mon 2026-08-24** — set `system/config.nflSpreadLock.dryRun` = **`false`** in
  the Firebase console (`system/config` → the `nflSpreadLock` map). Leave
  `enabled` at `true`. **Do not do this before reading a dry-run report.**
  Right now it is `{enabled: true, dryRun: true}` — deployed but held dry, and a
  LIVE click on 2026-08-21 correctly ran dry anyway. **Both gates must agree, and
  the report's own `dryRun` field is the truth, not the button label.**
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

## 6. The two I could not reproduce — what I need from you

### ❓ QUESTION 2 — issue 5, the stale "you have not entered your picks"

I read the whole path and could not find the staleness. `NFLPoolDashboard` uses
`dbService.subscribeToMyNFLEntry` — a **live** Firestore subscription on
`pools/{id}/entries/{uid}` — and `submitNFLPicks` writes exactly that document, so
the banner should flip within a second with no refresh. I could not reproduce it
live either: your ATS pool's week-4 sheet is currently blocked by the spread gate,
so there is no sheet to submit from, and I would not write picks into a live pool
to manufacture a test.

**Two candidates I can see in the code, and they need different fixes:**

1. **A PARTIAL sheet.** "Picks are in" requires **every** unlocked game answered.
   Save 15 of 16 and the banner correctly still says "not in yet" — which a tester
   would report exactly the way you did. If this is it, the fix is wording ("15 of
   16 saved"), not plumbing.
2. **A FUTURE week.** The banner only ever speaks about the *current* week. Submit
   picks for next week via the week selector and the banner keeps talking about
   this week, forever, refresh or not.

**Tell me, for one occurrence:** which pool, which week number, did they save
**every** game or only some, were they a plain member or a commissioner, and did
the *pick sheet itself* show its green "picks submitted at …" receipt while the
pool home still said not-in? That last one splits the two candidates immediately.

### ❓ QUESTION 3 — issue 6, Back / Refresh / Home

**I tested this directly against production in your signed-in browser and
everything worked.** On `/pool/0ybpLzY7fJ3NJbDj0j1l?tab=grid`: no service worker
registered, no `beforeunload` handler, `history.length` 2 on a fresh tab (no
history flood), clicking POOL HOME then STANDINGS grew history 2 → 3 → 4 and set
`?tab=dashboard` then `?tab=standings`, and `history.back()` twice restored both
the URL **and** the rendered content. `setActiveTab` pushes deliberately;
`setSelectedWeek` replaces. Both correct.

Also, plainly: **a web page cannot break the browser's Refresh or Home button.**
Those are browser chrome, outside the page's reach entirely.

**Before I spend more on this, please confirm:**
1. Does it still happen with the **Claude Chrome extension fully disabled** and
   after a **complete Chrome restart**? (It is an automation extension and it may
   be permitted in incognito, so incognito does not rule it out.)
2. Which **exact page** (paste the URL from the address bar), and what does "not
   working" look like — nothing happens at all, the URL changes but the page does
   not, or the page goes blank?

If it reproduces clean, I will dig. Until then I am not going to spend hours on a
phantom, and I would rather say that than quietly pretend to look.

---

## 7. Still open — carried forward, nothing lost

### Four help-system defects, all yours to schedule, all plan-gated

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

### PLAN-HELP-SYSTEM T4 not started

`NFLManagerView.tsx` still has **35 raw `<label>`** elements with no help topic.
The label→topic map is measured in `MORNING-2026-08-19-HELP.md` §6. T3, T5–T8 and
T10–T15 are also unstarted.

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
