# RUNBOOK — NFL spreads: why none are showing, and how to arm the lock

**Written 2026-08-11 (ET). Everything below is measured, not remembered** — the
ESPN readings were taken 2026-08-11 against the live feed, and every code claim
carries a `file:line`. Nothing in this document has been executed; all of it is
Kevin's to run.

Kevin's report: *"not seeing the spreads in any pools… should be automatic every
Tuesday 9:00 AM ET."*

---

## 1. Headline — the flag is only one of three reasons, and it is not the main one

| # | Cause | Applies to Kevin's pools? |
|---|---|---|
| 1 | **No member surface ever renders a spread unless the pool is Pick'em in ATS mode.** `PickemPickEntry.tsx:447` gates the line on `settings.pickMode === 'ATS'`. Survivor never reads `game.spread` (`SurvivorPickEntry.tsx:223-234`) and neither does Margin (`MarginPickEntry.tsx:151`). | **YES — this is the whole explanation for a Survivor pool.** No amount of spread data will make a line appear there. |
| 2 | **`nfl_games` only carries a line if an import or a sync wrote one.** ESPN publishes preseason lines a few days out; if the last preseason import predates that, storage has nothing to show or lock. | Likely — needs the one measurement in §3, which needs prod access. |
| 3 | **`lockNFLSpreadsJob` has been armed-but-dry its entire life** — `system/config.nflSpreadLock` is `{enabled: true, dryRun: true}`, and `readJobGate` treats a missing/true `dryRun` as dry (`nflSchedule.ts:1301-1305`). It has therefore never written `spread.locked` for anything. | YES, but it changes nothing a member can see until #1 is also true. |

So: **flipping the flag is correct and worth doing, but it will not put a number
on any screen Kevin is currently looking at.** A spread becomes visible to
members only in an **ATS Pick'em** pool. The wizard does offer that mode
(`CreateNFLPickemPool.tsx:58-65`) behind a warning, and the warning is right —
an ATS pool on a line-less week locks every member out behind
`SPREADS_NOT_LOCKED`.

---

## 2. What the feed actually has, measured 2026-08-11

`site.api.espn.com/.../scoreboard?dates=2026&seasontype=1&week=N`:

| Importer week | Label in the app | Games | Carrying odds | First kickoff |
|---|---|---|---|---|
| 2 | Preseason Week 1 | 16 | **16 / 16** | Thu 2026-08-13 19:00 ET |
| 3 | Preseason Week 2 | 16 | 0 / 16 | Thu 2026-08-20 20:00 ET |
| 4 | Preseason Week 3 | 16 | 0 / 16 | Thu 2026-08-27 19:00 ET |

Weeks 3 and 4 are simply not priced yet — books post a few days out, so
**re-measure before concluding anything about them.** The "1 of 49" reading from
2026-08-05 was early, not broken.

### Importer week 2 — labelled **"Preseason Week 1"** — every line, as read 2026-08-11

The manager screen labels its input **"Spread (Rel. to Home)"**, so the
home-relative column is the one to compare against. The importer derives it the
same way — home favourite ⇒ negative, away favourite ⇒ positive
(`nflSchedule.ts:317-341`).

| # | Away @ Home | ESPN line | Home-relative value |
|---|---|---|---|
| 1 | DET @ CIN | CIN -6.5 | **-6.5** |
| 2 | GB @ PIT | GB -1.5 | **+1.5** |
| 3 | IND @ NE | IND -3 | **+3** |
| 4 | ARI @ LV | LV -1.5 | **-1.5** |
| 5 | LAC @ HOU | HOU -1.5 | **-1.5** |
| 6 | TEN @ SF | TEN -4.5 | **+4.5** |
| 7 | DEN @ ATL | DEN -5.5 | **+5.5** |
| 8 | TB @ NYJ | NYJ -6 | **-6** |
| 9 | MIA @ WSH | MIA -2.5 | **+2.5** |
| 10 | CAR @ BUF | BUF -1.5 | **-1.5** |
| 11 | CLE @ CHI | CLE -1.5 | **+1.5** |
| 12 | MIN @ NYG | MIN -1.5 | **+1.5** |
| 13 | LAR @ KC | KC -2.5 | **-2.5** |
| 14 | JAX @ NO | NO -3 | **-3** |
| 15 | PHI @ BAL | PHI -3 | **+3** |
| 16 | DAL @ SEA | SEA -3.5 | **-3.5** |

⚠️ **Lines move.** Use this table for the question step 2 actually asks — *is
this row a real number or a missing value showing as `0`?* — and for catching a
sign that points the wrong way. Do **not** treat a small numeric difference as a
fault; re-read the current numbers here:

```
https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2026&seasontype=1&week=2
```

Each event's line is at `events[].competitions[0].odds[0].details` (favourite-
relative, e.g. `CIN -6.5`); `EVEN` means a genuine zero.

---

## 3. THIS WEEK — the catch-up Kevin has to run by hand

Do these in order. Steps 1–2 are read-only; nothing is written until step 4.

### Step 1 — open the Spread Override Manager

1. Go to **https://www.marchmeleepools.com/super-admin** (sign in as the
   SUPER_ADMIN account if prompted).
2. Open the **NFL** tab.
3. Scroll to the panel headed **NFL Spread Override Manager** ("Manually enter
   spreads or override ESPN lines before locking").

**You should see:** four controls — Season, Type, Week, and a **Fetch Games**
button. **If the panel is missing:** you are not on the NFL tab, or the account
lacks the SUPER_ADMIN claim — check the other tabs render admin content first.

### Step 2 — measure what is stored (READ-ONLY)

4. Set **Season** = `2026`, **Type** = `Preseason`, **Week** = the option
   labelled **`Preseason Week 1`**.

   🛑 **Preseason week numbers are OFFSET by one everywhere a human reads them.**
   Importer week 1 is `HOF Weekend`; importer **week 2** renders as
   **`Preseason Week 1`** (`shared/nflWeekLabel.ts:32-36`). Every dropdown, error
   string and button in the app uses the label, and every ESPN URL, Firestore
   `week` field and line of code in this document uses the number. **The slate
   this runbook is about is importer week 2 = the option reading "Preseason
   Week 1" = the games of Thu 2026-08-13.**
5. Click **Fetch Games**.

**You should see:** 16 rows, one per game, each with a spread input and a
lock toggle.

🛑 **A ROW SHOWING `0` DOES NOT MEAN THE LINE IS ZERO.** The input renders
`game.spread?.value || 0` (`SuperAdminNFLSpreads.tsx:208`), so a game with **no
stored spread at all** and a game with a genuine EVEN line look **identical**.
Do not read "every row has a number" off this screen. **Compare each row against
the ESPN table in §2 instead** — every line there is a real number
(CIN -6.5, GB -1.5, …) and none is zero, so for THIS week any row reading `0` is
a missing value, not an even line.

Then decide. **Open the live ESPN URL from §2 in another tab first** — a stored
line can be stale as well as missing, and the table in §2 is a snapshot of one
moment:

- **(a) Every row carries a real number and none is more than ~0.5 off the live
  feed** → the import already carried the lines. **SKIP step 3** and go straight
  to step 4.
- **(b) Any row reads `0` where the feed shows a real number** → storage predates
  the lines. **Do step 3.**
- **(c) "No games found for 2026 Preseason Week 1. Import schedule first."** →
  the week was never imported at all. **Do step 3.** Nothing else will fix this:
  the score sync builds its fetch list from stored `nfl_games` documents
  (`nflSchedule.ts:671-694`), so a week with no documents is never fetched.
- **(d) Any row carries a nonzero number that DISAGREES with the live feed —
  wrong value, or the sign pointing at the wrong team** → the stored line is
  stale or mis-oriented. **Do step 3**, then re-check. Locking a stale line is
  worse than locking none: an ATS pool would grade every pick against a number
  no book is offering. Never lock a row you have not just compared.

⚠️ **Never click Lock All on a week where any game has no line** (preseason
importer weeks 3 and 4 today — 0/16 priced). **Save writes `spread: g.spread || {value: 0,
locked: false}` for every row** (`SuperAdminNFLSpreads.tsx:91-96`), so saving a
line-less slate MATERIALISES a fabricated 0 spread on each game, and Lock All
then freezes it. An ATS pool would grade every pick against a number no book ever
published. This is the one destructive move on this screen.

Step 2 is the one measurement this session could not take: reading `nfl_games`
needs prod credentials, and no service-account key exists on this machine.

### Step 3 — ONLY IF step 2 read (b) or (c): re-import importer week 2

6. Still on the **NFL** tab, scroll to **NFL Schedule Bulk Importer**.
7. **Season Year** = `2026`.
8. **Season Type** = `Preseason`.
9. **Weeks Filter** = **`Specific Week Only`** — *not* "All 18 Weeks".
10. In the week dropdown that appears, choose **`Preseason Week 1`** (importer
    week 2 — see the offset warning in step 1).
11. Click **Bulk Import ESPN NFL Schedule**.

**You should see:** `Successfully imported 16 NFL games for the 2026 season!`

🛑 **The count is the check, not the word "Successfully".** `fetchNFLWeekSchedule`
swallows its own fetch/API failures and returns an empty slate
(`nflSchedule.ts:440-445`), and the importer then SKIPS that week and returns
success — so a total ESPN outage reads as a green
`Successfully imported 0 NFL games`. **Treat any count other than 16 as a failed
import**: re-run once, and if the count is still wrong, stop and report it.

**If you see an error: an import can fail PARTWAY, so the error tells you
nothing about what landed.** Some failures write nothing — the pre-read failing
closed (`nflSchedule.ts:424-430`), a week ESPN returns empty being skipped
(`:440-445`), or the per-week re-read or batch commit itself failing (`:478-531`).
Others land in full: the games are committed in their own batch (`:531`)
**before** the orphan deletion runs (`:542-547`), so an error raised after that
commit leaves them written. The message does not distinguish the cases, so do
**not** assume "it errored, therefore nothing happened":

- go back to the Spread Override Manager (step 2) and look at the slate first;
- if the 16 rows now carry §2's numbers, the import did its job — continue to
  step 4 and ignore the error message;
- if they do not, re-run the import once. If it fails a second time, **stop** and
  report the message rather than hand-entering 16 lines.

12. Go back to the Spread Override Manager and repeat step 2. The 16 rows should
    now carry ESPN's numbers.

**Why this is safe** (verified in code, not assumed):

- The importer's **deletion** pass is **scoped to the weeks you asked for**
  (`nflSchedule.ts:404-423`, `:535-547`), so importing importer week 2 cannot
  delete a game in importer weeks 1, 3 or 4 — including the already-played HOF
  game.
- ⚠️ Its **writes** are not week-scoped, and the doc used to claim they were.
  Every game ESPN returns is written under ESPN's own week number
  (`eventWeekNumber`, `:349`; write loop `:483-530`), so an overlapping response
  can refresh an unlocked game in a neighbouring week. That is a refresh from the
  live feed rather than damage — and a **locked** spread is still preserved
  whatever week it is in (`:498-500`) — but do not run an import believing other
  weeks are untouched.
- It **never clobbers a locked spread**: a stored `spread.locked === true` makes
  it drop the field entirely and let `merge: true` keep what is there
  (`:498-500`).
- A week ESPN returns nothing for is **skipped, not deleted** (`:440-445`), and
  the orphan sweep only runs for weeks that genuinely returned a slate
  (`:535-547`).
- One deliberate behaviour to know about: an **unlocked** stored line that ESPN
  has since withdrawn is **removed** (`:501-524`). That is intended — locking a
  withdrawn number is worse.

### Step 4 — lock this week's lines by hand

13. In the Spread Override Manager, with the 16 `Preseason Week 1` rows on
    screen, click
    **Lock All Spreads**.
14. Click **Save** (the button next to it — the lock toggles are local state
    until you save).

**You should see:** `Spreads successfully saved and updated.` and every row's
toggle showing locked. **If you see "Failed to save: …":** the writes are
per-document `updateDoc` calls from the browser
(`SuperAdminNFLSpreads.tsx:86-104`), so a permission error means the SUPER_ADMIN
claim is not on the session — sign out and back in, then retry.

**Why by hand and not by the job:** see §5. The Tuesday job already ran today
(dry) and does not run again until **Tue 2026-08-18**, which is after this
week's games have kicked off.

---

## 4. Arming the Tuesday job (fixes every FUTURE week)

This is a **config flip in the Firebase console**, not a deploy.

1. Open **https://console.firebase.google.com/project/gridiron-gamble-uzuqo/firestore/data**.
2. In the collection list, click **`system`**, then the **`config`** document.
3. Find the **`nflSpreadLock`** map field. It reads `{enabled: true, dryRun: true}`.
4. Click the pencil/edit icon on **`dryRun`** and change the boolean from
   **true** to **false**. Leave `enabled` at **true**.
5. Click **Update**.

**You should see:** `nflSpreadLock` now reading `{enabled: true, dryRun: false}`.
**If `nflSpreadLock` does not exist at all:** stop — do not create it by hand;
an absent config means the job stays disabled and fail-safe
(`readJobGate`, `nflSchedule.ts:1301-1305`), which is not an emergency. Report it.

### What a healthy armed run looks like

Next fire: **Tue 2026-08-18, 09:00 America/New_York** (`nflSchedule.ts:1389-1391`).

```bash
npx firebase functions:log --only lockNFLSpreadsJob --project gridiron-gamble-uzuqo
```

- **Armed and working:** `[lockNFLSpreadsJob] Locked spreads for N upcoming games.`
- **Still dry (flag not saved):** `[lockNFLSpreadsJob] DRY-RUN: would lock N spread(s): <game ids>`
- **Kill-switch off:** `[lockNFLSpreadsJob] disabled (system/config.nflSpreadLock.enabled !== true); nothing to do.`
- **Degraded:** the heartbeat marks the run unhealthy if any eligible game
  exceeded the 200-per-run cap (`:1417-1423`) — a real week is ~16 games, so
  this should never fire.

### What the job will and will not lock

`lockSpreadsOnce` (`nflSchedule.ts:1347-1387`) locks a game only when **all** of
these hold:

1. its `startTime` is **after now and within the next 7 days** (`:1355-1358`);
2. the doc has a `spread` object whose `value` is neither `undefined` nor `null`
   (`shouldLockSpread`, `:1311-1313`) — **a value of `0` counts** (a pick'em line
   is legitimate);
3. `spread.locked` is not already `true`.

It **fetches nothing**. It only freezes numbers already stored in `nfl_games`.
That is the crux of §5.

---

## 5. The sequencing gap — a standing issue, not a one-week problem

Three measured facts that do not line up:

1. **The lock job is weekly**, Tuesdays 09:00 ET (`nflSchedule.ts:1389-1391`).
2. **The lock job never fetches** — it can only freeze values already in
   `nfl_games` (`lockSpreadsOnce`, `:1347-1362`).
3. **The 5-minute sync only refreshes a slate once a game in it is inside
   `[now − 24h, now + 2h]`** (`syncScoresWindow`, `nflSchedule.ts:671-674`, with
   `HOT_WINDOW_LOOKBACK_MS` at `:579`). The upper bound is **+2 hours**, not
   −24 hours: for an untouched future week, the fresh lines land roughly **two
   hours before that week's first kickoff**, not a day ahead.

Put together: **for any week whose lines are not already stored by Tuesday
09:00 ET, nothing locks them before kickoff.** The sync will eventually write
the values — about two hours before the Thursday game — and the next lock pass
is five days later. That is precisely this week's situation, which is why §3 is
a manual path regardless of whether the flag in §4 is flipped.

⚠️ **And that "eventually" only applies to a week whose games are ALREADY stored.**
`syncScoresWindow` builds its fetch list from `nfl_games` documents inside the
window (`nflSchedule.ts:671-694`) — a week that was never imported has no
documents, so the sync never asks ESPN about it and nothing appears at any point.
That is the step 2(c) case above: **an absent slate is only recoverable by an
import.** Do not wait on the sync for it.

**Candidate fixes (NOT this session — for Kevin's prioritisation):**

- run `lockSpreadsOnce` **daily** rather than weekly (smallest change; it is
  already idempotent and capped);
- or have the sync lock at **T-minus the pool's lock buffer**, so values and
  locks arrive together;
- or widen the sync's forward window so a week's lines are pulled in a day or
  two ahead instead of two hours.

Each of these touches a scheduled writer, so each needs its own PR and gates.

**A second backlog item, found while writing step 2** — the Spread Override
Manager cannot express "no line": it renders an absent spread as `0`
(`SuperAdminNFLSpreads.tsx:208`) and **Save writes `{value: 0, locked: false}`
for every row it is showing** (`:91-96`), whether or not that game ever had a
spread. So the screen both hides the missing-line case and manufactures a zero
line for it on save. A fix would render an empty input for an absent spread, save
only rows the operator actually edited, and refuse Lock All on a slate with any
missing value. Not attempted here — it is admin-surface work with its own gates.

---

## 6. `nflLockWatch` stays dry

Per Kevin's standing decision, `system/config.nflLockWatch` is left in dry-run.
Nothing found here changes that, and one thing about it is worth stating
precisely, because the obvious reason to keep it dry is **wrong**:

- **It would not cry wolf.** The watcher already filters the affected pools
  through `poolIsBlockable` — `NFL_PICKEM` in `ATS` mode only, the deliberate
  local mirror of `poolUsesSpreads` (`lib/nflLockWatch.ts:91-93`) — and
  `decideAlert` returns `no live pool on this slate` without paging when that set
  is empty (`:147`). With no ATS pool in existence, an armed watcher would simply
  never page.
- So arming it today would be **harmless and pointless** in equal measure: there
  is nothing it could usefully warn about until the first ATS pool exists. It
  stays dry on Kevin's decision, not because it is dangerous.
- One genuinely stale thing: its header comment (`nflLockWatch.ts:17-19`) still
  describes the pre-#214 rule where an unlocked spread blocked **every** pool on
  the slate. **The comment is stale; the code is correctly scoped.**

Re-visit when the first ATS Pick'em pool is created, not before.

---

## 7. Two stale code comments found while verifying this (no behaviour impact)

- `nflPools.ts:422-430` says straight-up pick'em is "the wizard's only mode — it
  hardcodes pickMode 'STRAIGHT' and exposes no ATS control". The wizard **does**
  expose ATS now (`CreateNFLPickemPool.tsx:58-65`), behind an accurate warning.
- `nflLockWatch.ts:17-19` describes the pre-#214 unconditional
  `SPREADS_NOT_LOCKED` gate (see §6).

Both are comments only; neither changes what any code does.
