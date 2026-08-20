# MORNING 2026-08-20 — the spread freeze is BUILT. Nothing is deployed.

> **This is the entry point for PLAN-NFL-SPREAD-FREEZE.** It **supersedes**
> `MORNING-2026-08-19-HELP.md` as the top of the stack; that document is still
> the entry point for PLAN-HELP-SYSTEM, and its open items are carried into §6
> below rather than left behind.

🔴 **THREE PRs MERGED TO `main` OVERNIGHT AND NONE OF IT IS LIVE.** Functions,
rules and indexes all need a deploy; `www` needs a Coolify redeploy. Until then
production is exactly what it was yesterday.

⚠️ **THE ONE THING THAT CHANGES HOW YOU WORK:** there is no longer a "Lock
Spread" button. The weekly freeze commits a whole week at once, at a stated time,
into a collection no client can write. To make an ATS week playable you now type
any missing numbers in the Spread Manager and then **run the freeze** — §3 step 8
and §4 have the exact steps.

---

## 1. What merged

| PR | SHA | What |
|---|---|---|
| [#489](https://github.com/kstruck/MMPoolsV3/pull/489) | `0592b8f0` | The write-once store `nfl_frozen_spreads` + rules, the `frozen ?? working` precedence on every read AND display path, and the cutover backfill |
| [#490](https://github.com/kstruck/MMPoolsV3/pull/490) | `af638c0d` | The freeze pass — fetch at the instant, all or nothing, once per slate; the slate lease; `runNFLSpreadFreeze` |
| [#491](https://github.com/kstruck/MMPoolsV3/pull/491) | `4caa878d` | `overrideLockedSpread`, the frozen-store rescore/audit trigger, and the Spread Manager rework |

**23 codex rounds across the three, eleven P1s, every finding valid.** Five local
gates green on each, plus the emulator suite, plus CI. qodo stayed dormant
throughout, per your 2026-08-19 ruling.

---

## 2. What actually changed, in four sentences

The frozen line no longer lives on `nfl_games.spread` — a document the ESPN feed
owns and four writers rewrite wholesale. It lives in `nfl_frozen_spreads`, which
`firestore.rules` refuses **every** client write to, superadmin included, so only
two Cloud Functions can write it: the weekly freeze and `overrideLockedSpread`.
Every reader — pick submission, the ATS grader, the scorer's fingerprint, the
lock-watch tripwire, and the pick sheet itself — resolves `frozen ?? working`, so
the number a member is shown is the number they are graded on. `nfl_games.spread`
is now a **working** line: the Spread Manager still edits it, and the freeze reads
it as the per-game fallback when ESPN has no line.

---

## 3. Do these, in this order

Every command runs from `D:\march-melee-pools` unless it says otherwise.

### Step 1 — install function deps

```powershell
npm --prefix functions ci
```

**Expect:** it finishes with an `added N packages` line and no `ERR!`.
**If it fails:** `ci`, not `install` — `install` rewrites the lockfile and dirties
the tree that `firebase deploy` packages.

### Step 2 — deploy FUNCTIONS (before rules)

```powershell
npx firebase deploy --only functions
```

**Expect:** `Deploy complete!`, and in the list of updated functions you should
see `lockNFLSpreadsJob`, `runNFLSpreadFreeze`, `overrideLockedSpread`,
`nflFrozenSpreadTrigger` and `backfillFrozenSpreads`.
**If it fails on TypeScript:** run `npm --prefix functions run build` on its own
to see the error.

### Step 3 — deploy RULES AND INDEXES

```powershell
npx firebase deploy --only firestore:rules,firestore:indexes
```

**Expect:** `Deploy complete!`. The index build for `nfl_frozen_spreads`
(season + seasonType + week) may show as *Building* for a few minutes in the
console; that is normal and the freeze is not run until step 8 anyway.
**Why after functions:** `mmp-change-control` Rule 2. Rules land last so a
capability is never denied before the function that replaces it exists.

### Step 4 — Coolify redeploy for `www`

Coolify has no CLI from this machine, so this one is by hand.

1. Open the Coolify dashboard.
2. Select the `www` application.
3. Click **Redeploy**.
4. **Expect:** a build that ends healthy, on commit `4caa878d`.

**Why it matters:** the pick sheet's frozen-line rendering, the reworked Spread
Manager and the new Operations buttons are all frontend. Without this, step 5
onwards has no buttons to click. **This also finally ships T16 and the lock help
topics from 2026-08-19, which have been waiting on a redeploy since Wednesday.**

### Step 5 — turn the backfill kill-switch ON

Open the config document:

```
https://console.firebase.google.com/project/gridiron-gamble-uzuqo/firestore/databases/-default-/data/~2Fsystem~2Fconfig
```

Add a **map** field named `nflFrozenSpreadBackfill` with two boolean children:

- `enabled` = `true`
- `dryRun` = `false`

**Expect:** the document now lists `nflFrozenSpreadBackfill` beside
`nflSpreadLock`, `nflLockWatch` and the rest.
**Why both:** two gates have to agree before it writes. `dryRun: false` here only
*permits* a live run; the button you click in step 6 still asks for a dry one.

### Step 6 — run the backfill DRY, and read it

1. Go to `https://marchmeleepools.com/super-admin` → **Operations** tab.
2. Click **Backfill Frozen Spreads (dry run)**.
3. **Expect:** a report with `dryRun: true`, `written: 0`, and a `plannedWrites`
   list naming every game whose spread is locked today, with the value each would
   be frozen at.
4. **Read the values.** These are the numbers those weeks were actually played
   on. If one looks wrong, stop and tell me — this is the moment to catch it.
5. **If `enabled: false` comes back:** step 5 did not save. Re-check the field
   names, which are case-sensitive.

### Step 7 — run the backfill LIVE

1. Same tab, click **Backfill Frozen Spreads**.
2. **Expect:** `dryRun: false` and `written` equal to the `plannedWrites` count
   from step 6.
3. **If the report carries a `nextCursor`:** click it again until `nextCursor` is
   `null`.
4. **Then turn the switch back off.** In the same config document, set
   `nflFrozenSpreadBackfill.enabled` = `false`. A one-shot migration should not
   sit armed.

⚠️ **Why this is a precondition and not a tidy-up:** until it has run, a slate
locked the old way has no frozen record, so reads fall back to
`nfl_games.spread`. That is exactly today's behaviour and no worse — but it is
not the new invariant either, and the freeze should not run on top of it.

### Step 8 — rehearse the freeze (dry), and expect a refusal

1. Operations tab → **NFL Spread Freeze (dry run)**.
2. **Expect, today:** `ok: false` with a reason naming app week 4 and a `noLine`
   list of all sixteen games. **That is the correct answer.** I checked the live
   ESPN feed at 2026-08-20 00:5x ET: all 16 week-4 events are there and **0 of
   them carry a line.** Preseason lines land about 1.4 days before kickoff, so
   they should appear around 2026-08-26.
3. **Run it again on Sunday and Monday.** The moment ESPN publishes, the report
   turns into sixteen values with `from: "feed"` beside each. That is the
   rehearsal — it writes nothing.

---

## 4. The week-4 ritual (Kevin's preseason week 3), and how it differs

**Kickoff:** Thu 2026-08-27 23:00Z — PIT @ BUF.
**The freeze fires:** Tue 2026-08-25 09:00 ET, automatically.
**App week 4 = your preseason week 3.** ESPN counts the Hall of Fame game as
preseason week 1, so the app's number is always yours + 1 in preseason. Where a
dropdown asks for a week, use **4**.

Because the lines will probably not exist yet on Tuesday morning, expect the
scheduled run to refuse. The repair is now:

1. **Mon 2026-08-24** — set `system/config.nflSpreadLock.dryRun` = `false` in the
   Firebase console (same document as step 5). Leave `enabled` as `true`.
   **Do not do this before you have read a dry-run report from step 8.**
2. **Tue 2026-08-25, after 09:00 ET** — check Operations → the job's own report,
   or just run **NFL Spread Freeze (dry run)** to see the current state.
3. **If it refused for missing lines:** go to **NFL Schedule** tab → the Spread
   Manager. Select Preseason / Week 4 → **Fetch Games**. Type a number into every
   row that has none, then **Save Working Lines**.
4. **Then Operations → NFL Spread Freeze (LIVE).** It takes the feed value where
   there is one and your typed value where there is not, and freezes all sixteen
   in one transaction.
5. **Expect:** `frozen: 16`. Every row in the Spread Manager now shows a green
   **Frozen** value instead of an input box.
6. **Verify:** open an ATS Pick'em pool as a member and confirm the pick sheet
   loads and the spreads shown match the report.

⚠️ **A live freeze is refused before the slate's stated cutoff** (Tuesday 09:00
ET). That is deliberate — it is the promise members were given — so you cannot
freeze week 4 early, only repair it after Tuesday morning.

⚠️ **A week can be frozen exactly once.** After that, changing a line takes the
override: Spread Manager → the pencil button on a frozen row → it asks for the
new number and a reason of at least 10 characters, writes an audit record, and
re-scores the week.

---

## 5. Decisions I need from you

**Q1 — the lock button is gone. Confirm that is what you want.**
The per-row lock toggle and "Lock All Spreads" are removed, not re-routed. They
wrote a locked line straight onto `nfl_games` with no frozen record and nothing
the detector could see, and unlock → edit → re-lock fired no rescore at all. The
consequence is real: **you can no longer unblock an ATS week by hand without
freezing it.** Say the word and I will restore a lock path — but the invariant
that every submittable ATS slate is a frozen one goes with it.

**Q2 — `system/config.currentSeason` is `2025` while everything else is 2026.**
Still unexplained, still untraced, and I did not touch it. Worth an hour to find
out what reads it before something surprises us in September.

**Q3 — the job is still named `lockNFLSpreadsJob`.**
It now fetches and freezes rather than flipping a flag, so the name is narrower
than the job. I kept it deliberately: renaming a scheduled function replaces the
Cloud Scheduler entry and restarts the heartbeat history, and the config key
`nflSpreadLock` is already armed in production. Rename later, as its own change,
or leave it.

**Q4 — IAM on the prod project.**
The plan says this plainly and it is still true: a Firebase console or Admin-SDK
write bypasses `firestore.rules` entirely. The frozen store is *detected*, not
*prevented*, against that path — a hand edit fires the rescore and writes an
`UNAPPROVED_FROZEN_SPREAD_CHANGE` audit row, but nothing stops it. Reducing who
holds datastore-write on `gridiron-gamble-uzuqo` is the real control, and it is
your call.

---

## 6. Still open — carried forward, nothing lost

**Four help-system defects, all plan-gated, all yours to schedule.** Unchanged
from `MORNING-2026-08-19-HELP.md` §3:

- **a)** `settings.pointsPerPick` and `settings.primetimeBonus` are **inert**.
  `scorePickemEntry` (`functions/src/nflScoringEngine.ts:174-178`) awards exactly
  1 per correct pick and reads neither, while `NFLManagerView.tsx:1336,1345-1372`
  sets them and `NFLPoolRules.tsx:158-176,220` shows the numbers **to members** as
  what a pick is worth. Decide: honour them in the scorer, or drop the controls
  and the rules-page rows. This is the last open T9 coverage row.
- **b)** The **Pick'em commissioner proxy pick has never worked.**
  `NFLManagerView.tsx:841` keys the picks map by WEEK NUMBER;
  `poolExceptions.ts:340-344` reads the keys as GAME ids and throws
  `Game 3 not found in week 3`. Survivor and Margin are keyed by week and work.
- **c)** The NFL manager's **"List Pool Publicly"** toggle writes
  `settings.isListedPublic`; Browse reads top-level `isPublic`
  (`src/utils/publicListing.ts:34`).
- **d)** `HelpCopy.template` **can never render** — `TopicScope` is
  `Pick<HelpScope,'poolType'|'audience'>` and nothing publishes a pool's settings.
  It has now cost eight widened sentences across #480 and #484.

**PLAN-HELP-SYSTEM T4 is not started.** `NFLManagerView.tsx` still has 35 raw
`<label>`. The label→topic map is measured in `MORNING-2026-08-19-HELP.md` §6, so
it does not need re-deriving. T3, T5–T8, T10–T15 also unstarted.

**Smaller things, unchanged:**

- `src/types/nflPoolTypes.ts:61` still says `pickMode: 'ATS'` is "reserved for
  V2". Stale — ATS ships in the create wizard and `gradePickemGames` grades
  against it. One-line cleanup when nearby.
- `ManagerDashboard.tsx` has no importer and is dead code. Delete candidate.
- The `mmp-qodo-cycle` watcher counts qodo's billing notice as a real artifact,
  because the notice has no `<h3>` and the NOISE filter is heading-anchored. Fix
  before any restore.

**Not in scope and still blocked:** `PLAN-IMPORTER-SAFETY.md` §1.1/§1.5. PR 2
closed the *freeze's half* of the importer race — the importer now takes the
slate lease and commits through a fenced transaction — but a document created
concurrently still raises no Firestore conflict, and that is the general case
that plan owns.
