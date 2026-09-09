# PLAN — NFL spread freeze: one instant, one line, unchangeable

## Implementation status (2026-08-20)

**IN PROGRESS — Revision 1, PR 1 of 3.**

Kevin, 2026-08-20: *"Go with your recommendation for the freeze."* That is
Revision 1, the write-once store, and implementation follows it rather than the
original shape of Phases 1 and 2.

| PR | Scope | State |
|---|---|---|
| **1** | `nfl_frozen_spreads` + rules, the `frozen ?? working` precedence on every read AND display path, and the cutover backfill | **merged 2026-08-20, #489** |
| **2** | the fetch-and-freeze pass (1.1-1.6), the slate lease, and `runNFLSpreadFreeze` (1.5b) | **merged 2026-08-20, #490** |
| **3** | `overrideLockedSpread` (2.1), the Spread Manager rework (2.2), and the frozen-store rescore/audit trigger (2.4) | **built** |

⚠️ **THE BACKFILL IS A PRECONDITION OF THE READS AND MUST BE RUN, LIVE, BEFORE
PR 2.** Until it has, a slate locked the old way has no frozen record, so reads
fall back to `nfl_games.spread` — which is exactly today's behaviour and no
worse, but it is not the invariant either. See "Cutover" below.

⚠️ **READ "REVISION 1" BEFORE PHASES 1 AND 2.** It moves the frozen line off
`nfl_games` into a write-once collection and supersedes the shape of both
phases. The decisions in "The requirement" are unchanged.

## The requirement

Kevin, 2026-08-19, verbatim:

> It is important that the spreads for each pool lock at a specified day and
> time. To make the pool fair, it is critical that every player make their picks
> based on the same spread as everyone else. Spreads move throughout the
> day/week, so once the spreads are fetched for that week, they must be locked
> and remain unchanged no matter what.

Two decisions taken the same day, and they are settled — do not re-open them:

- **GLOBAL, NOT PER POOL (option A).** Spreads stay in `nfl_games`, one set per
  game, shared by every pool playing that week. One freeze instant per week
  covers every pool. Per-pool spread snapshots were the alternative and were
  rejected: they buy per-pool lock times nobody asked for, at the cost of a new
  data shape the scorer would have to read.
- **IMMUTABLE WITH AN AUDITED OVERRIDE.** A locked spread is refused by the
  rules layer. One explicit callable can change it, requires a reason, writes
  `admin_audit`, and lets the existing rescore handoff repair standings.
  Literal immutability was rejected because a wrong line would then be
  uncorrectable, and `nflSpreadRescoreTrigger` exists precisely because a human
  sometimes must correct one.

## Goal

At a stated day and time each week, every game of the target week gets the line
that is live **at that instant**, written and locked in one all-or-nothing pass.
After that instant, the application cannot change it: not the 5-minute score
sync, not a re-import, not the admin UI. The only application path that can is
a deliberate, audited override.

⚠️ **A DIRECT CONSOLE OR ADMIN-SDK WRITE IS NOT PREVENTED BY THIS PLAN, AND
CANNOT BE.** Firestore Security Rules do not apply to the Firebase console, to
the Admin SDK, or to any IAM principal with datastore write access — the same
bypass that lets the freeze job and the sync do their work. An earlier draft of
this section claimed "not a console edit" and that was false (codex round 1, P1).
What covers that path is operational, not technical: see Phase 2.4. Anyone
holding those credentials can still overwrite a locked line, silently as far as
the rules are concerned — though `nflSpreadRescoreTrigger` still fires on the
change, so standings repair, and the audit trail is the gap.

## What already holds, and exactly how far — do not rebuild it

`submitNFLPicks` refuses **every** pick for a week unless **every** game of that
week has `spread.locked === true` (`functions/src/nflPools.ts:469`,
`SPREADS_NOT_LOCKED`). So there is no window in which one player picks against a
frozen board and another against a moving one. That is the "same spread as
everyone else" half of the requirement, already enforced server-side, and this
plan must not weaken it.

⚠️ **BUT IT COVERS ATS PICK'EM POOLS ONLY.** The gate sits inside
`if (poolUsesSpreads(pool))` (`nflPools.ts:466`), and that predicate is
`pool.type === 'NFL_PICKEM' && pool.settings.pickMode === 'ATS'`
(`nflScoringEngine.ts:84-86`). A straight-up Pick'em, Survivor or Margin pool is
NOT blocked by an unlocked spread and never reads one. An earlier draft of this
plan said "every NFL pool" and was wrong (codex round 1, P2).

Two things follow, and the second is the one that decides the shape of this
plan:

- **The tripwire agrees.** `nflLockWatch`'s `poolIsBlockable`
  (`functions/src/lib/nflLockWatch.ts:91-93`) mirrors the same predicate on
  purpose — *"a tripwire that cries wolf is worse than no tripwire"*. So the two
  pools it named on 2026-08-19 are ATS pools and are genuinely blocked; the
  live report in defect 3 stands.
- **ATS IS LIVE, NOT V2.** `CreateNFLPickemPool.tsx:61` offers *"Against the
  spread (ATS) — picks graded against the line"* in the create wizard, and
  `gradePickemGames` grades it (`nflScoringEngine.ts:98-101`: an exact-spread
  cover is a PUSH; an ATS pool whose game is missing a spread falls back to
  straight-up). The `pickMode: 'ATS'` "reserved for V2" comment at
  `src/types/nflPoolTypes.ts:61` is stale and should be deleted — noted, not in
  scope here.

**So the fairness requirement bites exactly on ATS pools, which is where Kevin's
two blocked pools are.** The freeze itself stays global over `nfl_games`
(decision A): it costs nothing to freeze a line no straight-up pool reads, and a
uniform board is easier to reason about than a conditional one.

## Evidence — the confirmed defects

All line numbers verified at `e9f288ce`.

### 1. (Critical) "Locked" is not enforced anywhere — it is a convention

`firestore.rules:12-14`:

```
match /nfl_games/{gameId} {
  allow read: if true;
  allow write: if isSuperAdmin();
}
```

Any SUPER_ADMIN client write may replace `spread` on a locked game. Nothing
compares `request.resource.data.spread` to `resource.data.spread`, and nothing
consults `resource.data.spread.locked`.

This is not theoretical. `src/components/admin/SuperAdminNFLSpreads.tsx:93-94`
writes the whole object client-direct:

```ts
return updateDoc(ref, { spread: g.spread || { value: 0, locked: false } });
```

and `:66-68` is a per-row toggle whose whole purpose is
`locked: !(g.spread?.locked || false)` — one click **unlocks** a locked line
today.

What exists is DETECTION, not prevention: `nflSpreadRescoreTrigger`
(`functions/src/nflSpreadRescore.ts`) fires on a locked-spread change and
enqueues a rescore. It repairs standings afterwards; it does not stop the
change. Its own header says the quiet part — *"a locked value only ever changes
when a human sets it."* That is exactly the case the requirement is about.

### 1b. (Critical, LIVE TODAY) Unlock → edit → re-lock defeats the rescore handoff

`lockedSpreadChanged` (`functions/src/lib/rescoreQueue.ts:306-316`) opens with:

```ts
if (before?.locked !== true) return false;
```

so it only fires when a spread was locked **before** the write and its value
changed across it. Now walk the natural operator flow, which is what the Spread
Manager's own per-row toggle (`SuperAdminNFLSpreads.tsx:66-68`) invites:

| Step | before.locked | value changed | fires? |
|---|---|---|---|
| unlock | `true` | no | **no** |
| edit the number | `false` | yes | **no** — `before.locked !== true` |
| re-lock | `false` | no | **no** |

Three writes, no event. **`nflSpreadRescoreTrigger` never enqueues, and finalized
ATS standings stay graded against the old line permanently** — which is the
exact failure that trigger was built to prevent, reachable through the UI the
repo ships. Found by codex on round 4 of this plan; it is a defect in shipped
code, not only a gap in this design.

It also sinks the audit scheme in 2.4 if that scheme reuses the same predicate,
so the fix belongs to this plan rather than to a follow-up.

### 2. (Critical) The freeze instant does not exist — the job locks whatever is lying around

`lockSpreadsOnce` (`functions/src/nflSchedule.ts:1383-1424`) does not fetch
anything. It reads stored docs and flips a flag:

```ts
const upcomingSnap = await db.collection('nfl_games')
  .where('startTime', '>', now)
  .where('startTime', '<=', now + 7 * 24 * 60 * 60 * 1000)
  .get();
const eligible = upcomingSnap.docs.filter(doc => shouldLockSpread(doc.data()));
...
for (const doc of targets) batch.update(doc.ref, { 'spread.locked': true });
```

Three consequences:

- **It freezes a stale number.** The value was written whenever the schedule was
  imported. Nothing refreshes it in between: the 5-minute sync's window is
  `startTime <= now + 2h` (`:708-709`), so a game three days out is invisible to
  the only thing that fetches lines. Import a week early and you freeze a
  week-old line.
- **It is game-scoped, not week-scoped.** A rolling 7-day window over
  `startTime`, so it can lock part of a week and leave the rest — and a week
  straddling the boundary locks across two different instants.
- **`shouldLockSpread` requires the line to already exist** (`:1347-1350`:
  `!!spread && spread.locked !== true && spread.value != null`). A game imported
  before odds were published has no `spread` field at all and is skipped
  forever.

### 3. (Critical) Measured live, and it is the failure above

`nflLockWatchJob`, 2026-08-19T14:49Z, prod:

> Week 3 (season 2026, seasonType 1): **16/16 spreads unlocked 33.2h before
> kickoff.** Every member of **2 pool(s)** is blocked by SPREADS_NOT_LOCKED…
> Of those, 16 have NO spread value at all.
> Pools: `0ybpLzY7fJ3NJbDj0j1l`, `g3oUEisS7OmyEbmpRETR`

`lockNFLSpreadsJob`, 2026-08-18T13:00Z (Tuesday 09:00 ET, on schedule):

> `[lockNFLSpreadsJob] DRY-RUN: would lock 0 spread(s):`

And ESPN had all sixteen lines at the time of writing — `HOU -1.5`, `PIT -3`,
`DEN -6`, `TB -5.5`, and so on. The lines existed; nothing went and got them.

### 4. (High) Both freeze-relevant jobs are still in dry-run

`system/config.nflSpreadLock` is `enabled: true` (the job printed past its gate)
with `dryRun` not `false`. `system/config.nflLockWatch` is the same shape — the
tripwire that measured defect 3 logged *"would page for"* and told nobody.

### 5. (Known, owned elsewhere) The importer race

`functions/src/nflSchedule.ts:503-512`, in the repo's own words:

> 🛑 THIS NARROWS THE RACE, IT DOES NOT CLOSE IT. There is still a gap between
> this read and the commit. The real fix is the single atomic TRANSACTION
> specified in PLAN-IMPORTER-SAFETY.md §1.1/§1.5…

**This plan does not re-specify that.** `PLAN-IMPORTER-SAFETY.md` is locked and
NOT STARTED; its §1.1 and §1.5 already carry the transaction and the
locked-spread preservation across a re-key. Phase 3 below is a dependency
pointer, not a design.

## Sweeps

Measured 2026-08-19 against `e9f288ce` and against prod.

| Question | Answer |
|---|---|
| Writers that can change `nfl_games.spread` | 4: `importNFLSeason` (`:518-567`), `syncScoresWindow` (`:1157-1163`, preserves locked), `lockSpreadsOnce` (`:1417`, flag only), `SuperAdminNFLSpreads` client `updateDoc` (`:93`) |
| Which of them respect `locked` | Import and sync preserve it. The admin UI does not. Rules do not |
| Readers of `spread.value` | `computeWeekFingerprint`, and **`gradePickemGames` for ATS pools** (`nflScoringEngine.ts:98-101`). Straight-up Pick'em, Survivor and Margin never read it. ⚠️ An earlier draft of this row said the scorer does not read it at all, quoting the "reserved for V2" comment at `src/types/nflPoolTypes.ts:61` — that comment is stale, ATS ships in the create wizard (`CreateNFLPickemPool.tsx:61`) and the scorer grades it (codex round 1) |
| Readers of `spread.locked` | `submitNFLPicks` (`nflPools.ts:469`, **behind `poolUsesSpreads` — ATS Pick'em only**), `shouldLockSpread`, `nflLockWatch` (same ATS scoping), `nflSpreadRescore`, both import and sync preservation branches |
| Reusable single-week fetch | `fetchNFLWeekSchedule`, already injectable through `importNFLSeason(…, opts.fetchWeek)` (`:430`) |
| Per-run cap | `MAX_SPREAD_LOCKS_PER_RUN = 200` (`:1344`). A week is ~16 games; never binds |
| ESPN odds availability, preseason | Kevin's wk 2 (ESPN `2026/1/3`): 16/16 lines ~1.4 days before kickoff. Kevin's wk 3 (ESPN `2026/1/4`, kickoff 2026-08-27T23:00Z): **0/16 today** |
| ESPN odds availability, regular season | Regular wk 1 (kickoff 2026-09-10T00:20Z): **16/16 already published**, three weeks out |

The last two rows are the load-bearing ones for scheduling: **regular-season
lines are posted early enough for a Tuesday freeze; preseason lines are not.**

## Approach

### Phase 0 — Turn the alarm on (no code)

Flip `system/config.nflLockWatch.dryRun` to `false`. The tripwire already
detects the exact failure and is currently talking to a log nobody reads.
Read-only, reversible with one field, and it is the thing that would have caught
defect 3 on Monday instead of Wednesday.

**Done when:** an unlocked slate inside the kickoff window pages rather than
logging `DRY-RUN: would page`.

### Phase 1 — Make the freeze a real fetch-and-freeze

Replace `lockSpreadsOnce`'s flag-flip with a week-scoped fetch:

1.1 **Target ONE week per run**, not a rolling window of games. The target is
the earliest slate (`season`/`seasonType`/`week`) that has a kickoff in the
future **within the freeze horizon** (the next 7 days, so one run covers exactly
one upcoming slate) and in which **no game carries `frozenAt`**. Selecting a
slate rather than a `startTime` range is what makes "the whole week freezes
together" expressible at all.

⚠️ **THE HORIZON IS NOT DECORATION** (codex round 8). Without it, "earliest
future slate with no `frozenAt`" walks forward: the Tuesday after week N is
frozen, week N is excluded by its own marker, so the run selects week N+1 and
freezes it roughly nine days before kickoff — at a Tuesday that is not that
week's stated cutoff, on lines that will move all week. Every slate after the
first would be frozen a week early, and 1.1's once-only rule would make it
permanent. The horizon is what makes "the slate due for this run" a thing the
job can identify.

If no slate qualifies, the run does nothing and says so. That is the normal
state of a Tuesday in February.

⚠️ **"NOT ALREADY FULLY LOCKED" WAS THE WRONG TEST AND IT INVERTED THE WHOLE
PLAN** (codex round 7). A slate with fifteen games frozen and one late addition
unlocked is not fully locked, so that rule selects it — and 1.4 then writes all
sixteen fetched lines, re-freezing the fifteen at a second instant with whatever
ESPN says now. The job runs as a Cloud Function and bypasses the 2.3 rules
deny, so nothing downstream would stop it. That is precisely the outcome the
requirement forbids, arrived at by the mechanism meant to enforce it.

**A slate is freezable exactly once.** One game carrying `frozenAt` makes the
whole slate off-limits to this job, permanently. Anything after that is a
correction, and corrections go through the audited override — never through a
second freeze.

1.2 **Fetch that week's lines at the instant** via `fetchNFLWeekSchedule`, the
same function the importer uses. The frozen number is then the number that was
live at the stated time, not whatever the import happened to catch.

⚠️ **AMENDED IN PR 2 (2026-08-20): FILTER THE RESPONSE TO THE TARGET SLATE BEFORE
RECONCILING IT.** `parseScoreboardResponse` stamps each game
`week: eventWeekNumber(event, week)` — ESPN's own answer wins over the requested
week — and ESPN's scoreboard endpoint is unreliable about which slate it returns
for a given `week` param: an import of one week returned 20 events spanning two
slates, measured 2026-08-19. Reconciling the raw response against one stored slate
would report the neighbouring week's games as "a fetched id not stored" and
**refuse every single Tuesday.** The filter lives inside `planFreeze` so no caller
can forget it, and a test drives a response carrying a week-5 game against a week-4
slate.

1.3 **All-or-nothing, over the STORED slate — not over whatever ESPN returned.**
Before the transaction, reconcile the fetched event ids against the stored game
ids for the target slate. Refuse, writing nothing, if **either** set has a
member the other lacks:

- a stored id the fetch did not return — ESPN dropped an event, and writing the
  other fifteen leaves the sixteenth unlocked, which is a partially frozen week
  wearing the disguise of a complete one (codex round 9);
- a fetched id not stored — the slate changed under us and the freeze is not
  the right actor to reconcile that.

Only once the sets match exactly does the line check apply: if any game of the
target week has no line after the fetch, **write nothing** and return a failing
verdict naming the games.

A regression test drives a 15-of-16 response against a 16-game stored slate and
asserts nothing is written.

⚠️ **THE PREFLIGHT RECONCILIATION IS NOT ENOUGH ON ITS OWN** (codex round 11).
It runs before the transaction, so an importer or sync write that adds a game to
the slate in between commits happily alongside it: the sixteen originals freeze,
the seventeenth stays unlocked, and the all-or-nothing invariant is violated even
though the preflight sets matched.

Firestore transactions do not range-lock, so re-reading the query inside the
transaction does not close it either — a document created concurrently raises no
conflict. **Serialise the writers instead**, using the fenced-lease shape this
repo already runs for scoring (`nflPools.ts:913-951`):

- the freeze takes the slate's lease for the whole pass and releases it after
  the commit;
- `importNFLSeason` refuses a slate whose lease is held, the way a scoring pass
  already returns `leaseBusy` rather than writing;
- the transaction re-reads the target game refs by id (`getAll`) so a
  concurrent *modification* still conflicts, which is the half Firestore does
  give us.

⚠️ **AMENDED IN PR 2 (2026-08-20): THE LEASE COVERS THE IMPORTER, NOT THE SYNC**
(codex r3 on PR 2). `syncScoresWindow` takes no lease and deliberately is not
given one — the 5-minute poll is what keeps live scores moving, and parking it
behind a freeze would trade a narrow race for a real outage. But it CAN create a
spillover game inside a slate, and a manual retry of a refused freeze can
legitimately run inside its 2-hour window. So the freeze transaction **re-reads
the stored slate and refuses (`SLATE_CHANGED`) if the id set moved**, which
collapses the window from the whole ESPN fetch to the transaction's own
read-to-commit. It does not eliminate it, because Firestore does not range-lock —
and what is left is exactly R3's case, which is decided rather than open.

Residual, and named rather than implied away: a game added to the slate AFTER
the freeze commits is R3's case — page, never auto-freeze. A
partially frozen week is the thing the requirement forbids — some games frozen
at T, the rest at T+2 days. The submit gate keeps members out either way, so
refusing to write costs nothing and buys the invariant.

1.4 **One transaction for the week, and stamp `frozenAt`.** ~16 games is far
inside Firestore's limits, so the whole week commits or none of it does. Each
game's spread is written `{ value, locked: true, frozenAt }` — `frozenAt` is
what lets the detection in 2.4 recognise a line that has been committed to even
after somebody unlocks it (defect 1b).

**The transaction refuses outright if any game it is about to write already
carries `frozenAt`**, re-read inside the transaction. 1.1 should already have
excluded that slate; this is the belt to its braces, and it is what makes
"a spread is written once and then only overridden" true of the code rather
than only of the selection rule. Keep the per-run cap as a
guard and REFUSE rather than truncate if a slate ever exceeds it — truncating is
the partial-freeze failure wearing a different hat.

1.4b **THE SCORE SYNC MUST STOP REBUILDING THE SPREAD OBJECT.** As shipped,
`syncScoresWindow` preserves a locked spread by *reconstructing* it
(`nflSchedule.ts:1157-1163`):

```ts
freshGame.spread = { value: existingData.spread.value, locked: true };
```

Two fields, and only two. The moment `frozenAt` and `overrideId` exist, **every
sync run inside the 2-hour pre-kickoff window silently erases them** — the value
survives, the provenance does not, and 2.4's detector stops recognising the line
as one that was ever committed to. The freeze invariant would look intact and be
unenforceable (codex round 8).

Fix it the way the importer already does (`:535-536`): **delete the key from the
payload** and let `merge: true` keep whatever is stored, whole.

⚠️ **THE CONDITION IS `frozenAt` OR `locked` — THE UNION, NOT A REPLACEMENT.**
Two rounds pulled this in opposite directions and both were right:

- **`locked` alone is not enough** (round 11). The credential bypass this plan
  expects (2.4) can set `locked: false` first, and the very next sync then
  writes ESPN's fresh unlocked map over the top and drops `frozenAt` with it.
  The line stops being recognisable as one that was ever frozen, and neither the
  audit nor the rescore fires afterwards — the unlock would have laundered the
  game.
- **`frozenAt` alone is a live-data hazard at rollout** (round 12). Every spread
  locked before this ships — including the ones locked by hand on 2026-08-19 —
  carries no `frozenAt`. Preserving only on `frozenAt` would hand all of them
  back to the next ESPN payload, unlocked and revalued, by the very change meant
  to protect them. Cloud Functions bypass the 2.3 rules, so nothing downstream
  would stop it.

**So: preserve the stored spread when it carries `frozenAt` OR when
`locked === true`.** The union needs no migration to be safe on day one, and it
still closes the unlock-laundering path, because a frozen line keeps `frozenAt`
whatever happens to `locked`.

Backfilling `frozenAt` onto already-locked spreads at cutover is still worth
doing — see R4 — but it is now a tidy-up rather than a precondition.

⚠️ **AND THE SAME RULE GOES IN THE IMPORTER, NOT ONLY THE SYNC** (codex round
14). `importNFLSeason` has its own preservation branch (`:534-536`) and it also
tests `locked === true` alone. So the identical laundering works through an
import: unlock, then re-import the week, and ESPN's whole unlocked map lands with
`frozenAt` and `overrideId` gone. Two writers, one rule — **preserve on
`frozenAt` OR `locked` in both**, and a regression test drives each of them over
a spread that carries `frozenAt` with `locked: false`. That is strictly better than listing fields to preserve,
because the next field added to `spread` inherits the protection instead of
inheriting this bug.

A regression test seeds a locked spread carrying `frozenAt` and an `overrideId`,
runs a sync pass over it, and asserts both survive.

1.5 **Kill-switch + dry-run unchanged.** `nflSpreadLock.{enabled,dryRun}` keeps
its current shape and defaults. Dry-run logs the week, the sixteen values it
would write, and any missing lines.

1.5b **A manual invocation, because the schedule alone cannot rehearse itself**
(codex round 14). `0 9 * * 2` fires once a week, so the rollout in R2 asks
operators to read dry-run reports on Saturday, Sunday and Monday from a job that
does not run on any of those days. As written the preflight could not happen.

Add a SUPER_ADMIN callable — `runNFLSpreadFreeze({ dryRun })` — that invokes the
same `freezeSlateOnce` the scheduler does, subject to the same kill-switch. It
earns its place three times over: it makes R2's dry runs real, it is the
on-demand re-run when a Tuesday pass refuses (a missing line, a lease clash),
and it is the hook an emulator test drives end-to-end.

⚠️ **AMENDED IN PR 2 (2026-08-20): TWO GATES, AND BOTH MUST SAY LIVE.** This
paragraph originally read *"`dryRun` defaults to the config value; passing `false`
explicitly is what makes a manual live freeze deliberate rather than a slip"* —
and those two clauses contradict each other. If it defaults to the config value
then omitting it ALSO runs live the moment the config is armed, so passing `false`
is not what makes anything deliberate. Resolved toward `mmp-change-control`
Rule 1: **`dryRun` defaults TRUE at the schema layer, and the config can always
hold it dry but never force it live.** A live manual freeze therefore needs the
config armed AND an explicit `dryRun: false` — which is what the second clause was
asking for.

⚠️ **AMENDED IN PR 2 (2026-08-20): A LIVE MANUAL FREEZE MAY NOT RUN BEFORE THE
SLATE'S STATED CUTOFF** (codex r6 on PR 2). Once `nflSpreadLock.dryRun` is
`false`, this callable could otherwise commit a slate permanently on the Sunday
before — and the Tuesday job would then skip it as already frozen. The stated
instant would be quietly not honoured, by the tool built to repair it.

The rule needs no escape hatch, which is why it is a rule rather than a flag: a
live freeze is allowed at or after the slate's own stated cutoff, defined as the
latest Tuesday 09:00 ET strictly before its first kickoff. The scheduled job
fires exactly AT that instant so it always passes, and every legitimate repair —
Tuesday afternoon after a refusal, Wednesday, Saturday — is after it. **Dry runs
are unrestricted**, which is precisely what R2's Saturday-to-Monday rehearsal
needs. `statedCutoffBefore` handles the DST changeover (the November cutoff is
14:00Z, the August one 13:00Z) and a test pins both.

⚠️ **AMENDED 2026-08-21 (KEVIN): AN EXPLICIT EARLY FREEZE, `force` + a NAMED
SLATE.** The cutoff rule above is right for every week that follows another one,
and wrong for the week that does not. **Regular-season week 1 has no games before
it**, so the Tuesday cadence — which exists to let the previous week finish —
buys nothing there. Measured on the 2026 calendar: the opener is a WEDNESDAY, so
week 1's unforced pick window is **35.3 hours** against **~59** for every other
week.

Kevin, 2026-08-21: *"Go with B. Regular season Week 1 should freeze earlier as
there are no games prior to that week."*

| argument | what it skips | what it does NOT skip |
|---|---|---|
| `force: true` | the stated cutoff | the horizon, once-per-slate, all-or-nothing, the lease, first-kickoff-in-future, **and both dry-run gates** |
| `slate: {season, seasonType, week}` | the 7-day horizon | everything else, and it REQUIRES `force` |

**Both are needed and neither is enough alone.** The horizon is part of "is this
slate due", so `force` on its own could not reach regular week 1 until seven days
out — most of what makes that window short. And the horizon is NOT simply widened
under `force`, because "the earliest slate with no frozen record" over an
unbounded horizon walks forward and freezes the wrong week: that is codex round
8's defect, and an operator naming a week cannot trigger it by accident.

`force` **requires a written reason**, enforced at the schema layer, and it lands
in the `admin_audit` row. The justification for allowing it at all: **freezing
early does not break fairness** — every member still picks against an identical
line. It breaks PREDICTABILITY, which is a smaller harm than the one the cutoff
was protecting against, and unlike the removed lock button it leaves a record of
who did it and why.

Surfaced as **"Freeze this week now"** in the Spread Manager, where the week is
already selected, rather than as another argument-less Operations button.

1.6 **Schedule: `0 9 * * 2` `America/New_York`.** Tuesday 09:00 ET, decided by
Kevin on 2026-08-19 (R1) and unchanged from the existing job. This is the
"specified day and time" the requirement asks for — if it ever moves, it moves
deliberately and members are told, because the whole point is that they can
predict it.

**Done when:** on a slate whose lines ESPN carries, one run writes value +
`locked: true` for every game of that week and nothing else; on a slate missing
a line, the run writes nothing, returns `ok: false`, and the watcher pages.

### Phase 2 — Make locked mean locked

Order inside this phase matters, because the rules change removes Kevin's only
manual repair path.

2.1 **First, the override callable.** `overrideLockedSpread` — SUPER_ADMIN,
`{gameId, value, reason}` with `reason` required and non-trivial. Writes the new
value, keeps `locked: true`, **preserves the existing `frozenAt`**, and writes an
`admin_audit` event naming actor, game, old value, new value and reason.

⚠️ **`frozenAt` SURVIVES AN OVERRIDE, and the obvious spelling loses it** (codex
round 9). Writing `spread = { value, locked: true, overrideId }` drops the
marker, so the first legitimate override would blind 2.4's detector to every
unauthorised change on that game afterwards — an approved correction quietly
disarming the alarm for good. Same failure as 1.4b, one layer up: reconstructing
the object rather than amending it. Amend the stored spread; never rebuild it. `nflSpreadRescoreTrigger` already fires
on a locked-spread change, so standings repair rides the existing handoff.

⚠️ **2.2 WAS RESHAPED BY REVISION 1, AND PR 3 IMPLEMENTS THE REVISED FORM
(2026-08-20).** The original said every lock routes through the callable, because
`nfl_games.spread.locked` was the thing being protected. Under Revision 1 it is
not: the canonical line lives in `nfl_frozen_spreads` and no client can write it
at all, so the Spread Manager's job is simply to stop being able to lock.

**What shipped:** the per-row lock toggle and **Lock All Spreads** are REMOVED,
not routed. They wrote `{ value, locked: true }` straight to `nfl_games`, which
creates a line members can submit against with no frozen record, no audit, and
nothing the detector can see — the manual backstop quietly manufacturing lines
the scheme cannot watch. Unlocking was worse: unlock → edit → re-lock fires no
rescore at all (defect 1b), so finalized ATS standings stay on the old line
permanently.

The manager now shows two kinds of row. **Not frozen:** `nfl_games.spread` is a
WORKING line, editable and saved by dotted path, and the freeze reads it as the
per-game fallback — which is what keeps the manual backstop working. **Frozen:**
read-only, with one button that calls `overrideLockedSpread` and prompts for a
reason. Save writes only the rows that CHANGED; it used to write every game in
the fetched list, whole-map, every time.

⚠️ **RESOLVED 2026-08-21 (Kevin): option B.** The consequence below stood for one
day and was then softened deliberately — see the `force` + named-slate amendment
under 1.5b. There is still no way to unblock an ATS week WITHOUT freezing it (the
invariant holds), but an operator can now choose the instant, with a reason and an
audit row, instead of being held to the Tuesday cutoff.

⚠️ **THE CONSEQUENCE AS ORIGINALLY SHIPPED:** there is no
longer any way to unblock an ATS week by hand without freezing it. That is the
invariant — every submittable ATS slate is a frozen one — but it means the repair
path for a refused Tuesday is *type the missing numbers, then re-run the freeze*,
and a live freeze is refused before the slate's stated cutoff.

**The original 2.2, superseded:** the Spread Manager routes every lock through the
callable, not only edits to an already-locked row. A row whose spread is locked edits via the callable and
prompts for a reason. The unlock toggle (`:66-68`) is removed — unlocking is not
a repair, it is a hole.

⚠️ **AND SO IS "LOCK ALL"** (codex round 15). Leaving unlocked rows on the
current client write still lets the per-row lock toggle and the **Lock All
Spreads** button write `{ value, locked: true }` directly. The 2.3 rules only
protect a spread that was ALREADY locked, so those writes sail through and
create a newly locked line with **no `frozenAt` and no audit record** — outside
1.4b's preservation, outside 2.4's detector, and around R3's late-addition path.
The manual backstop would have been quietly manufacturing unprotected lines.

**Any action that sets `locked: true` goes through the callable**, which stamps
`frozenAt` and audits atomically (2.1's create shape). Client-direct writes to
`nfl_games.spread` remain only for a row that is neither locked nor frozen —
entering a value before freezing it — and 2.3 is what holds that line.

2.3 **Then the rules deny.** `nfl_games` write stays `isSuperAdmin()`, plus:
a write is refused when the stored `resource.data.spread.locked == true` and the
incoming `request.resource.data.spread` differs from it. Other fields stay
writable. Cloud Functions bypass rules, so the freeze job, the sync and the
override callable are unaffected.

⚠️ **Deploy order is functions before rules** (`mmp-change-control` Rule 2). The
rules change is the last thing that lands, and only after 2.1 and 2.2 are live —
otherwise a bad line becomes uncorrectable in production.

2.4 **The credential path, which rules cannot reach.** A console or Admin-SDK
write bypasses 2.3 entirely (see the Goal). This is closed operationally, not
technically:

- Write down, in `docs/`, that editing `nfl_games.spread` by hand in the Firebase
  console is not a supported repair — the override callable is. The Spread
  Manager is the only UI that should ever touch a line.
- Audit it rather than prevent it: `nflSpreadRescoreTrigger` already fires on any
  locked-spread change whatever wrote it, so add an `admin_audit` write to that
  trigger for changes that did not arrive through the override callable.

  ⚠️ **CORRELATE WITH AN ID CARRIED ON THE DOCUMENT, NOT BY LOOKING FOR A
  MATCHING AUDIT ROW** (codex round 3). The obvious version — trigger fires,
  goes looking for a recent `admin_audit` override record — is race-prone in
  both directions: `overrideLockedSpread` writing the game before the audit row
  lets the trigger fire in the gap and libel a legitimate override as an
  unapproved console edit, and `writeAuditEvent` deliberately swallows its own
  write failures, so the row may never appear at all.

  Instead: `overrideLockedSpread` mints an `overrideId`, and **one transaction**
  writes both the amended spread and the `admin_audit` record carrying the same
  id. **Amended, not rebuilt**: set `spread.value` and `spread.overrideId` on
  the stored map and leave `spread.frozenAt` where it is (2.1). An earlier draft
  of this line spelled the write as a whole map — the same mistake 2.1 had
  already been corrected for, in a second place that had not (codex round 10). The trigger then needs no read — a change where
  `after.spread.overrideId !== before.spread.overrideId` is an override, and a
  value change without a fresh id is not. Purely local, so there is no window to
  race.

  ⚠️ **AND THE PREDICATE HAS TO CHANGE, OR THE WHOLE SCHEME IS BYPASSED BY
  UNLOCKING FIRST** (defect 1b). `lockedSpreadChanged` returns false for every
  step of unlock → edit → re-lock, so keying the audit off it would miss the
  most natural way a line gets changed by hand. Replace it with a rule that does
  not depend on the *before* lock state:

  - Stamp `spread.frozenAt` at freeze time (1.4). It marks a line as one that
    has been committed to, durably, and it survives an unlock.
  - Fire on any write where **`before.spread.frozenAt` is already set** and
    **any** of the value, `locked`, or **`frozenAt` itself** changed — so the
    unlock is the alarm, and so is the marker going missing.

    ⚠️ **`frozenAt` REMOVAL HAS TO BE IN THE PREDICATE OR THE SCHEME HAS AN OFF
    SWITCH** (codex round 15). A whole-map console write can drop `frozenAt`
    while leaving value and `locked: true` exactly as they were. On the earlier
    predicate that fires nothing — no rescore, no audit — and 1.4b then happily
    preserves the now-markerless locked spread forever. One quiet write and the
    game is permanently outside the detector. Since the condition keys on
    `before.spread.frozenAt` being set, the freeze's own unset→set transition is
    still excluded (round 5).

    ⚠️ **`before`, not `after`, and this is not pedantry** (codex round 5). The
    freeze transaction in 1.4 is itself a write that adds `frozenAt` and changes
    `locked`, and it carries no `overrideId` — so a detector keyed on the
    post-write document would flag **every game of every weekly freeze** as an
    unapproved edit and enqueue a rescore for all sixteen. Keying on the prior
    state makes the freeze transition invisible to the detector by construction,
    which is what it should be: the freeze is the thing being protected, not a
    violation of it.
  - Treat it as a legitimate override only when `after.spread.overrideId`
    differs from `before.spread.overrideId`.

    ⚠️ **THAT EXEMPTS IT FROM THE ALARM, NOT FROM THE RESCORE — and collapsing
    the two would break the override path outright** (codex round 11). An
    approved override exists precisely to correct a line after results may
    already have been scored; `nflSpreadRescoreTrigger` is the only entry point
    that repairs those standings. Routing overrides away from it would leave
    finalized ATS standings graded against the old number *because the change
    was properly approved*, which is the opposite of the intent.

    So the predicate splits in two, and they are not the same question:

    | | Fires for |
    |---|---|
    | **Rescore enqueue** | ANY change to a frozen line — override or not |
    | **`admin_audit` "unapproved" row** | only a change with no fresh `overrideId` |

  `lockedSpreadChanged` is shared with the existing trigger, so this plan owns
  changing it, and owns a regression test for the three-step sequence above.

  This detects, it does not prevent: someone with console access could write an
  `overrideId` by hand. The point is that the ordinary slip — open the console
  or the Spread Manager, unlock, retype a number — leaves a trail and repairs
  the standings.

  ⚠️ **RAISED IN PR 3 (2026-08-20, codex r6): AN `overrideId` IS VERIFIED, NOT
  TRUSTED.** Round 3 of the original rejected "look for a matching `admin_audit`
  row" as race-prone in both directions, and it was right *at the time* — the
  spread and the row were separate writes. They are not any more: the callable
  commits both in ONE transaction, under an `admin_audit` id derived from the
  override id, so a real override always has a matching row and there is no window
  in which a legitimate one looks forged. The trigger does one `getDoc` on that id
  and only on the path that claims one, so a routine freeze costs nothing.

  **Partially absorbed, and the rest rejected with reasoning.** A console CREATE
  stamped `source: 'freeze'` still reads as approved, and closing that would mean
  an audit row per game per freeze — sixteen routine rows a week, which is the
  "log nobody reads" failure this plan warns about twice. The credential path is
  DETECTED, not prevented, exactly as the Goal says; IAM is the real control.
- Reducing who holds datastore-write IAM on the prod project is the real control
  and is Kevin's call; it is named here so the residual risk is written down
  rather than implied away.

**Done when:** a client-direct `updateDoc` changing a locked spread is refused
by the rules test suite; the override callable succeeds and leaves an audit
row; a re-import and a sync pass both leave a locked line untouched; and a
locked-spread change with no override record raises an audit event.

### Phase 3 — The importer race (dependency, not new design)

Blocked on `PLAN-IMPORTER-SAFETY.md` §1.1 / §1.5. Until that lands, a re-import
concurrent with a freeze can still clobber a locked line. Phase 2's rules deny
does NOT cover it — the importer is a Cloud Function and bypasses rules by
design.

**Interim mitigation, zero code:** do not run an import while a freeze may be
running. The freeze is a once-weekly instant; imports are deliberate operator
actions. Phase 0's alarm makes a clobbered week visible before kickoff.

## Key decisions & tradeoffs

**K1 — No separate odds-refresh job.** An earlier draft proposed
`nflOddsRefreshJob` polling every 6 hours to back-fill lines. **Retracted.**
Once the freeze fetches at its own instant (1.2), the "imported before odds
existed and never revisited" bug is closed by construction, and a background
poller that rewrites unlocked lines every 6 hours is a second writer on the
field this plan is trying to make single-writer. Fewer moving parts, and the
one that remains is the one with the stated time on it.

**K2 — Refuse rather than partially freeze (1.3).** The alternative is "lock
what you can, catch the rest next run", which is what the code does today. It
produces a week frozen across two instants. Refusing keeps the invariant exact,
and the cost is an alarm rather than an outage — but state the scope precisely,
because an earlier draft did not: **ATS pools are already blocked by
`SPREADS_NOT_LOCKED` whether or not this run writes**, so refusing changes
nothing for them; and straight-up, Survivor and Margin pools never consult a
spread, so refusing changes nothing for them either. There is no pool for which
"lock what you can" unblocks somebody sooner.

**K3 — Rules deny rather than a callable-only write path.** Making `nfl_games`
functions-only would also work and is stronger, but it breaks every unlocked-row
edit in the Spread Manager and turns a UI change into a rewrite. Denying only
the locked-spread mutation is the narrow cut.

**K4 — The override keeps `locked: true`.** An override sets a new value on a
still-locked line. It never unlocks. "Unlock, edit, re-lock" is the same hole
with three steps.

## REVISION 1 (2026-08-19) — the frozen line moves off the feed's document

**Kevin, 2026-08-19: "Go with your recommendation for all."** This section is
that recommendation. It supersedes the shape of Phases 1 and 2 below; the
decisions in "The requirement" are unchanged and A still stands.

### The finding that forced it

Reading the Spread Manager to plan Phase 2 turned up a twentieth defect, found
by hand rather than by codex, and it is the same shape as the previous thirteen
— but worse, because it is the operator's own tool:

`SuperAdminNFLSpreads.handleSave` (`:84-96`) writes **every game in the fetched
list**, not the modified ones, and writes the whole map:

```ts
const promises = games.map(g => updateDoc(doc(db, 'nfl_games', g.id), {
  spread: g.spread || { value: 0, locked: false }
}));
```

`handleLockToggle` (`:60-72`) and `handleLockAll` (`:74-83`) rebuild the object
as `{ value, locked }` from local state. So **every Save from the Spread Manager
would erase `frozenAt` and `overrideId` on all sixteen games** — the operator
wiping the freeze markers by using the tool the plan tells them to use.

### Why that settles the design question

Fourteen of twenty findings are now one sentence: *a writer clobbers the marker,
or a path creates a line without one.* The marker keeps being lost because it
lives on `nfl_games.spread` — a document a live feed owns, that four writers
rewrite wholesale, and whose next writer inherits an obligation nothing enforces.

Defending an immutability invariant there means defending it in every writer,
forever, including ones not written yet.

### The revision: a write-once store, still global

**Keep decision A.** Spreads stay global — one frozen set per slate, shared by
every pool. This is not decision B; nothing is snapshotted per pool and the
scorer's notion of scope does not change.

**Move the frozen line off `nfl_games`.** The freeze writes to its own
collection — `nfl_frozen_spreads/{gameId}` — carrying
`{ value, frozenAt, slate, overrideId? }`.

- `firestore.rules`: `allow read: if true; allow write: if false.` **No client
  can write it at all**, superadmin included. Not "refused when locked" —
  refused, full stop. Phase 2.3's conditional rule disappears, and with it the
  class of bug where the condition is subtly wrong.
- The score sync and the importer **never touch this collection**, so 1.4b's
  preservation rule, the `frozenAt || locked` union, and the matching importer
  rule all disappear. They cannot clobber what they do not write.
- The Spread Manager writes `nfl_games.spread` exactly as it does today for
  entering and adjusting a *working* line, and cannot affect a frozen one. Its
  Save no longer needs rewriting, and `handleLockAll` becomes "propose these
  values to the freeze" rather than a write.
- ⚠️ **AND THE FREEZE MUST CONSUME THAT PROPOSAL, OR THE MANUAL BACKSTOP DIES**
  (codex round 4). The freeze fetches ESPN; the override only corrects a record
  that already exists. So when the fetch refuses a slate for a missing line —
  the preseason case that actually happened on 2026-08-19 — the operator would
  enter values in the Spread Manager and **nothing in the design could turn them
  into frozen records.** ATS submissions would stay blocked indefinitely, with
  the backstop that has carried every week so far quietly removed.

  **Per game, the freeze takes the feed value when the fetch carries one, and
  the stored working value (`nfl_games.spread.value`) when it does not.**
  All-or-nothing (1.3) then applies over the union: refuse only when a game has
  neither. The normal week is unchanged and still frozen at the instant from the
  feed; the operator's job in a gap week goes back to being "type the missing
  numbers, re-run the freeze", which is what it is today.

  A regression test drives a slate where the feed carries 14 of 16 lines and the
  working line carries the other two, and asserts all sixteen freeze.
- `submitNFLPicks`, the ATS grader and `computeWeekFingerprint` read the frozen
  store when a frozen record exists, and fall back to `nfl_games.spread` when it
  does not — which is what makes the cutover a no-op for slates frozen the old
  way (R4).
- ⚠️ **`nflLockWatch` COUNTS COVERAGE TOO, AND IT WOULD CRY WOLF ON EVERY
  SUCCESSFUL FREEZE** (codex round 4). It derives coverage from
  `nfl_games.spread.locked`, which this revision stops being the source of
  truth — so a perfectly frozen ATS slate reads as 0 locked and pages inside the
  warning window, on every week that worked. The watcher resolves frozen records
  with the same precedence as submission and scoring, and a test asserts a
  successfully frozen slate does NOT fire. A tripwire that cries wolf is worse
  than no tripwire, which is the reasoning already written into that module.
- ⚠️ **AND SO DOES EVERY SCREEN THAT SHOWS A MEMBER A NUMBER** (codex round 1 on
  this revision). The pick sheet passes game documents straight to `GameMeta`,
  which renders `game.spread.value` off `nfl_games`. Leave that alone and the
  feed can move the working line after a freeze, so **an ATS player is shown one
  number and graded on another** — which breaks the requirement more directly
  than the bug this plan started from. One precedence rule, `frozen ?? working`,
  and it applies to the read path and the display path together. A component
  test pins it: a game whose frozen value differs from `nfl_games.spread` renders
  the frozen one.
- The only writers are the freeze pass and `overrideLockedSpread`, both Cloud
  Functions, both already specified.
- ⚠️ **AMENDED DURING PR 1 (2026-08-20): THE READER LIST WAS SHORT BY THREE.**
  This section named `submitNFLPicks`, the ATS grader, `computeWeekFingerprint`,
  `nflLockWatch` and the display path. Implementing it turned up three more paths
  that read `nfl_games.spread` and hand the number onward, and each is the same
  failure the plan is about — a member seeing or being graded on a line nobody
  froze:

  | Reader | Why it has to resolve |
  |---|---|
  | `backfillProfileData` (`:71-109`) | re-grades scored ATS weeks through `gradePickemGames`, so an unresolved read rewrites historical per-pick profile results against a drifted line, disagreeing with the standings (codex r1 on PR 1) |
  | `recomputeExpertPicks` (`expertPicks.ts:102-110`) | derives the "vegas" expert pick FROM the line and renders it on the same row as the line, so the row could read `CIN -6.5` beside `Vegas: DET` |
  | `aiCommissioner` NFL context (`:258`) | hands game documents to the model as facts, spread included, and the model quotes them back to a member |

  The generalisation, and it is the one this plan keeps re-learning: **the rule is
  every path that GRADES or SHOWS, not the paths that were listed.** The resolver
  is applied at the LOAD in all of them for exactly that reason — a load site is
  enumerable, a reader is not.
- ⚠️ **THE RESCORE HANDOFF HAS TO FOLLOW THE DATA — AS A TRIGGER, COVERING EVERY
  WRITER.** `nflSpreadRescoreTrigger` watches `nfl_games/{gameId}`, and under
  this revision the canonical value lives elsewhere, so a correction made after
  results were scored would never enqueue and finalized ATS standings would stay
  on the old value (codex round 1).

  An earlier draft answered this by enqueuing inside `overrideLockedSpread`'s
  transaction, arguing atomicity. **That was a downgrade and codex round 3 caught
  it**: the existing trigger's whole virtue is that it fires for *any* writer —
  its own header says so, *"it is the only mechanism that covers EVERY writer"* —
  and routing the enqueue through the callable covers exactly one. A console or
  Admin-SDK write to the frozen store would then change the canonical grading
  input and leave standings stale, which is a REGRESSION against the behaviour
  this plan inherited.

  So: **a trigger on `nfl_frozen_spreads`, `retry: true`, enqueuing on any
  change whatever wrote it** — the same shape and the same reasoning as the
  trigger it replaces. The override may also enqueue in its transaction; the
  drain groups by slate and acknowledges every id it read, so a duplicate is
  harmless.

  **DELETES COUNT, AND THEY NEED THE KEY OFF `before`** (codex round 6). Deleting
  a frozen record is a canonical-line change — reads fall back to the working
  spread, so finalized ATS standings may need repair — and a Firestore delete has
  no `after` document at all. The slate key lives only in the deleted record, so
  the trigger derives it from `before.slate` on a delete, and alerts rather than
  silently returning if that is missing or malformed. Without this, the
  credential-bypass path the plan explicitly supports has a variant that leaves
  old standings in place and says nothing.

  **Approval stays a separate question**: rescore for every change, audit
  exemption for approved ones. But *approved* cannot mean "carries a fresh
  `overrideId`" alone — **a normal freeze creates every record without one**, so
  that rule would file all sixteen games of every scheduled freeze as
  unauthorized edits and make the audit trail worthless within a month (codex
  round 6; the same mistake round 5 of the original made, which is twice now
  that a detector was pointed at the freeze it exists to protect). Each record
  therefore carries `source: 'freeze' | 'override' | 'backfill'`, written by the
  only callers that are supposed to exist, and **approval is judged per source,
  not by one rule for all of them** (codex round 7 — the first attempt at this
  still demanded an `overrideId` from writes that by design never carry one,
  which is the same false-alarm flood one paragraph further on):

  | Write | Approved when |
  |---|---|
  | CREATE, no prior record | `source` is `freeze` or `backfill`, **or `override` carrying an `overrideId`** |
  | AMEND an existing record | `source` is `override` AND `overrideId` is fresh |
  | DELETE | never — always unapproved, always enqueued |

  ⚠️ **THE CREATE ROW WAS AMENDED IN PR 3 (2026-08-20), AND IT IS THE FOURTH TIME
  THIS PLAN AIMED A DETECTOR AT THE MECHANISM IT PROTECTS.** As written the row
  approved a create only from `freeze` or `backfill` — while two paragraphs below,
  the plan says both override paths write `source: 'override'` *"because the
  approval table above would then have filed every legitimate override as an
  unapproved change"*. Read literally, it did exactly that: `overrideLockedSpread`
  keeps a CREATE shape on purpose (R3's remediation for a late-added game), and
  every use of it would have been filed as unauthorized. Found writing the tests
  for the table, not by a reviewer.

  Anything else is unapproved: it gets the `admin_audit` row as well as the
  rescore. A console write satisfies none of the rows, because nothing tells it
  to set `source`.

### Cutover: backfill first, or the fallback is a hole

⚠️ **THE FALLBACK IS SAFE ONLY ONCE NOTHING LIVE DEPENDS ON IT** (codex round 2
on this revision). For any slate locked before this ships — including the
sixteen Kevin locks by hand on 2026-08-19 — there is no `nfl_frozen_spreads`
document, so reads fall back to `nfl_games.spread`. And this revision
deliberately deletes the conditional rules deny, which leaves the Spread Manager
free to change that field. During the migration window an admin could therefore
alter a live slate's line at both pick time and grading — worse than today,
introduced by the change meant to prevent exactly that.

**So the backfill is a precondition, not a tidy-up** (this supersedes R4, which
had it the other way round):

1. A one-shot backfill writes an `nfl_frozen_spreads` record for **every game
   whose `nfl_games.spread.locked === true`**, carrying the stored value and a
   `frozenAt` of the backfill instant, `source: 'backfill'`, and a
   `legacy: true` marker so a backfilled record is never mistaken for a measured
   freeze instant. **`source` is not optional here** — the trigger's approval
   table keys on it, so a backfill without it files an unapproved-change event
   for every legacy game it writes (codex round 8).
2. It is a production-data mutation, so it takes the house shape: kill-switch,
   dry-run default, reviewed dry-run output before the live run
   (`mmp-change-control` Rule 1).
3. It runs **before** the read path ships. Order matters: reads that prefer the
   frozen store are harmless while the store is empty only if nothing can change
   the working line, which is precisely what is not true.
4. After it, the `nfl_games.spread` fallback covers only slates that were never
   locked at all — nothing live and nothing graded — so it is a legacy read
   rather than a live dependency.

### Two predicates that must follow the data

⚠️ **1.1's "already frozen" test reads the wrong document now** (codex round 5).
It asks whether a game carries `nfl_games.spread.frozenAt`, and this revision
writes that marker only to `nfl_frozen_spreads`. Left as written, the
once-per-slate invariant stops being enforced by the selection logic and a
manual re-run before kickoff re-freezes a slate that is already done — the round
7 defect, resurrected by moving the data. **A slate is "already frozen" when any
`nfl_frozen_spreads` record exists for it**, and the transaction re-reads that
before writing (1.4's belt to 1.1's braces).

⚠️ **The override keeps its CREATE shape, and the revision nearly dropped it**
(codex round 5). Once-per-slate stops the freeze re-running, so if the override
could only correct an existing record there would be no way to give a late-added
game a frozen line — R3's whole remediation path gone, the slate permanently
incomplete, ATS submissions blocked for good. `overrideLockedSpread` therefore
keeps both shapes against the new store, exactly as the original 2.1 had them:

| Frozen record | What the callable writes |
|---|---|
| exists | amend: new `value`, new `overrideId`, `source: 'override'`, `frozenAt` untouched |
| absent, **on a slate that already has other frozen records** | create: `{ value, frozenAt: now, slate, overrideId, source: 'override' }` |
| absent, on a slate with NO frozen records | **refused** |

⚠️ **THE THIRD ROW WAS ADDED IN PR 3 (2026-08-20, codex r1)** and it is load-bearing.
Without it the callable is a way to freeze one game of an untouched future week —
and 1.1's eligibility test reads *"any frozen record exists for this slate"*, so
that single record makes the weekly freeze **skip the slate permanently**. The
other fifteen games never freeze, every ATS pool on it stays blocked behind
`SPREADS_NOT_LOCKED`, and there is no path back. It would also be a manual freeze
before the stated cutoff, through the one door built to bypass that rule
legitimately. A sibling record is exactly the right test: present for R3's case
(the rest of the week froze days ago), absent for every other.

**Both paths write `source: 'override'`.** An earlier draft omitted it and the
approval table above would then have filed every legitimate override as an
unapproved change (codex round 8) — the third time in this plan a detector was
aimed at the mechanism it exists to protect. The pattern is worth naming: **every
writer must declare itself, and every payload spec in this document has to carry
that declaration**, or the detector reads silence as guilt.

**What survives from the original shape:** the once-per-slate rule (1.1), the
stated instant (1.6), the all-or-nothing transaction with stored-slate
reconciliation (1.3, 1.4), the lease (1.3), the dry-run and the manual invocation
(1.5, 1.5b), the audited override (2.1) and the alarm (Phase 0). The freeze
transaction gets simpler, not harder: it creates documents that do not exist
rather than amending ones four other writers share.

**What it costs.** A second place the number can live, and therefore a read path
that has to prefer the right one. That is a real risk and it is the same class
as the one being removed — but it is detectable rather than silent: a
reconciliation check can compare the two and alarm on divergence, which is
impossible today because there is only one copy and no record of what it should
have been.

### Consequence for defect 1b — it does NOT split out

I recommended lifting 1b into its own small PR. **After reading the code, that
was wrong, and the correction matters:**

- **The detection fix needs the durable marker.** After an unlock, an edit to
  the line is indistinguishable from routine ESPN sync traffic — which is
  exactly the exclusion `lockedSpreadChanged`'s comment says it exists to
  preserve. Telling them apart requires knowing the line had been frozen, and
  under this revision that knowledge is the presence of a
  `nfl_frozen_spreads` record. There is no cheaper marker available today.
- **Closing the exposure by removing the unlock button would strand the
  operator.** Without the override callable there would be no way to correct a
  mislocked line — on the same week Kevin is locking sixteen of them by hand.

So 1b is fixed by this revision rather than before it: once the frozen value
lives somewhere no client can write, unlock → edit → re-lock on
`nfl_games.spread` cannot change what anything grades against, and the whole
sequence stops being a correctness problem. `lockedSpreadChanged` then guards
the legacy path only.

## What fifteen rounds revealed about decision A

**Worth reading before implementation starts, because it is new information
about a decision already taken.**

Of the nineteen findings, thirteen from round 8 onward are the same shape:
*some writer clobbers the freeze marker, or some path creates a line without
one.* The sync rebuilt the map. The importer preserved on the wrong condition.
The override rebuilt it. "Lock All" created unmarked lines. A console write can
delete the marker. Each fix was correct and each one exposed the next.

That is not bad luck. It is the cost of defending an immutability invariant on a
**shared document that a live feed owns and four writers touch**. Every new
writer inherits the obligation, and nothing in the type system reminds them.

Decision B — snapshot the frozen lines into the pool at freeze time — makes most
of this class impossible by construction: the pool's copy is written once and no
feed, importer or sync ever touches it again. It was rejected on 2026-08-19 as
"a new data shape the scorer would have to read", and that cost is real. But the
comparison was made before the review priced option A, and A is more expensive
than it looked: two writers to keep in step forever, a rules layer, a detector
with four conditions, and a marker that anything with credentials can remove.

**This does not re-open the decision on its own** — A is still defensible, and
the plan as written is implementable. It is recorded so the choice is re-made
with the real numbers rather than left to inertia. **Kevin's call.**

## Risks / open questions

**R1 — DECIDED 2026-08-19 (Kevin): Tuesday 09:00 ET, option A.** The freeze
instant is `0 9 * * 2` `America/New_York`, unchanged from the existing
`lockNFLSpreadsJob` schedule. Regular-season lines are published weeks ahead so
Tuesday is comfortable there; preseason lines land ~1.4 days before kickoff, so
a preseason Tuesday run will often find nothing and falls back to the manual
Spread Manager with the alarm on. Three weeks of the year, covered by a backstop
that already works. The reasoning is kept below because the trade is worth
re-reading if preseason ever becomes a product rather than a rehearsal.

**R1 (resolved) — A Tuesday freeze may be too early for preseason.** Measured: preseason
lines appear ~1.4 days before kickoff, so a Tuesday 09:00 ET run on a Thursday
slate can find nothing. Regular-season lines are published weeks ahead, so
Tuesday is comfortable there. Options, for Kevin:

| | Option | Effect |
|---|---|---|
| **A** | Keep Tuesday 09:00 ET | Correct all regular season. Preseason needs the manual backstop, with the alarm on |
| **B** | Move to a later stated instant, e.g. Wednesday 09:00 ET | Catches preseason more often; still one stated time |
| **C** | Different stated instant per season type | Most accurate, most machinery |

**Recommended A, and Kevin took it** (2026-08-19). Preseason is three weeks of
the year and the alarm plus manual backstop covers it; the regular season is
what the invariant is for.

**R2 — One rehearsal window, and dry-run alone will not use it.** The last
preseason slate (ESPN `2026/1/4`, kickoff 2026-08-27T23:00Z) is the only
remaining slate that is imported, line-less today, and will gain lines inside
the build window. Tuesday 2026-08-25 09:00 ET is the single chance to watch the
real thing run against a real slate before the regular season.

⚠️ **A dry-run on 08-25 rehearses nothing that matters.** Dry-run writes
nothing by design (1.5), so it exercises the fetch, the slate selection and the
all-or-nothing decision — and never the transaction, the write, or the state the
slate is left in. Leave it in dry-run through Tuesday and **the first live lock
this code ever performs is regular-season week 1.** That is the wrong place to
find out.

So the sequence is dated, and the flip is part of it:

| When | Action |
|---|---|
| by Fri 2026-08-22 | Phase 1 deployed, `nflSpreadLock.dryRun: true`. Fetch and selection proven against a real slate, writing nothing |
| Sat–Mon | run `runNFLSpreadFreeze({ dryRun: true })` by hand each day (1.5b — the schedule fires Tuesdays only, so nothing happens on its own). It should report the sixteen values it would write, the moment ESPN publishes them |
| **Mon 2026-08-24** | **flip `nflSpreadLock.dryRun: false`** — before the Tuesday run, not after |
| Tue 2026-08-25 09:00 ET | the scheduled run performs a real transaction on a real slate. This is the rehearsal |
| same day | verify: 16/16 locked, values match what the dry runs reported, and an ATS submit succeeds |

Rollback if it goes wrong is one field (`enabled: false`) plus the manual Spread
Manager, which is the same backstop that carried 2026-08-19. Nothing about the
rehearsal is one-way.

**If ESPN has not published wk-4 lines by Monday**, the rehearsal cannot happen
on that slate — fall back to a fixture-driven end-to-end write test against the
emulator, and treat regular-season week 1 as the first live run with the
manual backstop staffed.

**R3 — A game added to a week after the freeze. RESOLVED, not open.** A flex or
a late addition leaves a frozen week containing an unlocked game, which re-blocks
ATS submission. The earlier draft left "auto-freeze the newcomer or page" as an
open question; codex round 7 showed that leaving it open was itself the hazard,
because the obvious slate-selection rule silently chose auto-freeze **and took
the other fifteen lines with it**.

**Decided: page, never auto-freeze.** 1.1 makes the slate off-limits once any
game in it carries `frozenAt`, and 1.4 refuses to write over one. The newcomer
is filled in by a human who can see that the rest of the week was frozen days
earlier and decide whether that is still fair — a judgement, not a job's
decision to make.

⚠️ **THAT PATH CREATES A FROZEN SPREAD; IT DOES NOT "OVERRIDE" ONE** (codex
round 12). A game added after the freeze has no `frozenAt` to preserve, so an
override that only ever amends an existing frozen map would leave the new line
unmarked — and 1.4b would then not preserve it, and 2.4 would not recognise
later edits to it. `overrideLockedSpread` therefore has two shapes:

| Stored spread | What the callable writes |
|---|---|
| carries `frozenAt` | amend: new `value`, new `overrideId`, `frozenAt` untouched |
| absent or never frozen | create: `{ value, locked: true, frozenAt: now, overrideId }` |

Both write the same audit record. The second is the manual backstop — the one
that carried 2026-08-19 — and it has to leave the line indistinguishable from
one the job froze, or the invariant has a hole shaped exactly like every
manually repaired game.

**R4 — Legacy locked spreads.** Games locked before this plan carry lines
frozen at import time, which may be stale. Phase 2's rules deny would make them
permanently so. Decide whether to re-freeze the current slate once at Phase 1
cutover.

## Out of scope

- **Per-pool spread snapshots.** Decision A, above.
- **Changing how ATS grades.** ⚠️ Not because ATS is inert — it is live, it is
  offered in the create wizard, and `gradePickemGames` reads `spread.value` to
  grade it. An earlier draft of this bullet said the opposite and it was wrong
  twice over (codex rounds 1 and 2). The line this plan freezes IS the number
  those pools are scored against, which is the whole reason the requirement
  exists.

  What is out of scope is the grading RULE — cover, push, the missing-spread
  straight-up fallback. What is emphatically IN scope is that Phase 1 must not
  change which value a week ends up graded on, so it ships with an ATS
  regression check: freeze a fixture week, grade it, and assert the results
  match the same week graded against the same values written the old way.
- **The importer transaction.** `PLAN-IMPORTER-SAFETY.md` §1.1/§1.5.
- **Automated weekly scoring.** Different gap (`mmp-nfl-season-campaign` G2).
