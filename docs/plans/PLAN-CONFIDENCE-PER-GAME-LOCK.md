# PLAN — confidence pools may lock per game; a started game's pick AND weight are immutable

> ## ✅ KEVIN RULED ON ALL SIX QUESTIONS — 2026-09-10 ~09:30 MDT
>
> | # | Ruling | Effect on this plan |
> |---|---|---|
> | **D1** | **Backfill**, not a flag — *"the commissioner wants it for this week for that pool, so backfill as long as it does not break the pool."* | §3.6: one-shot SUPER_ADMIN op stamps `lockMode: 'WEEKLY'` on every confidence Pick'em pool whose stored value is not already `WEEKLY`; the rule then reads `lockMode` alone. Ordering and the deploy window are in §5 and §7. |
> | **D2** | **A missed locked game forfeits the HIGHEST weight** — *"for a 16 game week, they would lose 16. For a week with 12 games, they would lose 12."* k missed games forfeit the top k values. | §3.2: the valid range for the games a member CAN pick is `[17−N .. 16−k]`, where k = locked games with no stored pick. |
> | **D3** | Tiebreaker locks with its target game (recommendation). | §3.2, T4. |
> | **D4** | **No mid-week guard** — *"Jim … wants to allow missed picks for this week's games."* | T5 dropped. A client-side confirm dialog on a mid-week flip stays (warning, not a gate). |
> | **D5** | New confidence pools default to per-game (recommendation). | §3.5. |
> | **D6** | **Reopen Week 1. Jim is aware.** | §6 restated as a consequences list, not a recommendation against. |
>
> **STATUS: RULED ON; codex round 1 absorbed (9 accept / 1 reject, see
> REVIEW-LOG). This is plan v3.** Implementation starts on v3.
>
> **v3 additions from round 1** — (a) `settings.lockRuleVersion: 2`, a
> server-written stamp: the rule keeps legacy weekly behaviour for any confidence
> pool NOT stamped 2, `createPool` stamps new Pick'em pools, the backfill stamps
> legacy ones — closes the deploy window and the new-vs-legacy predicate while
> keeping the backfill Kevin ruled for; (b) a **hard ceiling at kickoff** for a
> confidence PER_GAME game's lock, so neither a deadline extension nor a buffer
> edit can reopen a game that has started; (c) `proxyPick` refuses confidence
> pools; (d) confidence-key validation; (e) `confidenceMode` can no longer be
> flipped once anybody has submitted (T10).

> **Provenance:** Kevin, 2026-09-10: *"As a rule that we made, if it is a
> confidence pool, that pool locks at the first game of the week. After some
> feedback, I want to change this. It is important that if we allow users to
> change picks of games that have already started, they are not able to change
> any confidence selection of a game that has already started. They should be
> allowed to change the team they picked and the confidence pick if that game
> has not started. Any confidence pick for a game that has started can not be
> changed under any circumstances."* Example pool: `ubHD4bgszL05oURYubrn`
> ("Donkeys 2026", host Jim Lenz).
>
> **Class: plan-gated.** It changes WHO may change a pick WHEN (competitive
> integrity, which decides weekly prizes and therefore money); the D1 backfill
> **writes production data**; the Donkeys flip changes a live pool's rules with a
> weekly pot riding on the week. Plan → review log → sweeps → implement → deploy
> checklist (`mmp-change-control` Rules 1 and 3).

---

## 0. The rule, stated precisely

Today (`shared/nflLockMode.ts`, mirrored by hand in three server files):

> Survivor and Margin are always WEEKLY. **Confidence mode forces WEEKLY on
> Pick'em, whatever `lockMode` says.** Otherwise `lockMode` decides.

After this plan:

> Survivor and Margin are always WEEKLY. **On Pick'em, `lockMode` decides —
> confidence or not.** In a PER_GAME confidence pool each game's **team pick
> and confidence weight** lock together at that game's own deadline
> (kickoff − buffer, or a commissioner extension, exactly as straight Pick'em
> does today). A locked game's pick and weight can never be changed by anyone
> through any path. Open games stay fully editable — team and weight — subject
> to the week-wide "each weight used once" rule, which counts the weights
> already frozen on locked games. **A locked game the member never picked
> forfeits the highest remaining weight** (D2). **Kickoff is a hard ceiling:**
> no deadline extension and no buffer edit can move a confidence game's lock
> past its kickoff, so a game that has started is closed by every path
> (codex r1 #1/#2).

Three things do NOT change:

- WEEKLY-lockMode pools (any Pick'em) behave exactly as today.
- Survivor and Margin are untouched (hard weekly lock from the TYPE).
- The scoring engine code is untouched. `scorePickemEntry` already grades per
  game off `entry.confidence[gameId]`: a missing pick scores 0 and a pick with
  no stored weight scores 0 (`?? 0`, `nflScoringEngine.ts:175`) — today and
  after. The scorer already decides gradability per game (`gameLockClosed`,
  `nflPools.ts:1496`). Lock mode is a SUBMISSION rule, not a scoring rule. What
  this plan adds is the guarantee that no server path can CREATE a pick without
  a weight in a confidence pool any more (§3.2, §3.3); historical ones keep
  scoring exactly as they do today (codex r1 #9).

---

## 1. What is true today — measured, not remembered

| Fact | Evidence |
|---|---|
| ONE shared definition on the client, `nflLockMode()`; every client surface imports it | `shared/nflLockMode.ts:60-66`; importers: `NFLPoolDashboard`, `NFLUserBentoDashboard`, `PickemPickEntry`, `WeekChecklist`, `nflStatusService`, `nflPending` |
| THREE hand-written server copies of the same expression | `functions/src/nflPools.ts:626` (submit), `functions/src/lib/pickReveal.ts:71` (reveal), `functions/src/poolExceptions.ts:338` (proxyPick) |
| A source-grep guard pins the three copies to the literal string | `tests/nfl-lockmode-invariants.test.ts:111-139` |
| `functions/src/shared/` is a byte copy of `shared/` made by `copy-shared.mjs` before every build/test — so the server CAN import the shared rule | `functions/package.json:4-6`; `diff shared/nflLockMode.ts functions/src/shared/nflLockMode.ts` → identical |
| Server PER_GAME branch checks only the TEAM pick against the lock; confidence is validated only in the WEEKLY branch and requires ALL N games weighted | `nflPools.ts:730-755`; `validateConfidenceValues` `nflScoringEngine.ts:188-224` (`assignedValues.size !== N` → `INCOMPLETE_CONFIDENCE_SUBMISSION`) |
| The entry write merges `picks` per key and writes `confidence` as a nested map under `{ merge: true }` (Firestore deep-merges, so other weeks' weights survive) | `nflPools.ts:766-772` |
| **Pre-existing hole:** the PER_GAME branch never checks `tiebreakerPrediction` against any lock. A member of a straight per-game pool can submit `picks: {}` plus a new tiebreaker after MNF has kicked off and it is written | `nflPools.ts:743-755` (loop over `picks` only) and `:772-775` (unconditional write) |
| The client already renders the weight `<select>` disabled on a locked game, and already scopes the "value taken" audit to the week's games including locked ones | `PickemPickEntry.tsx:782-792`, `:221-247` |
| The client's `canSubmit` requires a weight on EVERY game (`games.every(g => !!confidence[g.id])`) — unreachable today only because the sheet is whole-week | `PickemPickEntry.tsx:279-283` |
| The client drops a stale locked TEAM pick before submit; it does not drop a stale locked weight (never needed to) | `dropStaleLockedPicks`, `PickemPickEntry.tsx:413-419` |
| Manager UI greys out Lock Mode and forces `WEEKLY` into state when confidence is on; the wizard does NOT force it — a confidence pool created by the wizard and never re-saved carries `lockMode: 'PER_GAME'` (the wizard default) while PLAYING weekly | `NFLManagerView.tsx:490-493`, `:1431-1441`; `CreateNFLPickemPool.tsx:39-46`, `:70`, `:125` |
| `confidenceMode`, `lockMode`, `lockBufferMinutes`, `weekLockOverrides` are LOCK_AFFECTING: a save touching them serializes with the scoring lease and bumps `lockRevision` | `lib/poolUpdate.ts:110-111`, `poolOps.ts:589-659` |
| A settings save has NO "week in progress" guard — a lock-mode flip lands mid-week | `grep weekIsPublished functions/src/poolOps.ts` → 0 hits |
| Reveal follows lock: WEEK mode reveals every member's whole sheet (picks AND weights) to every member at the week lock; PER_GAME reveals game by game | `lib/pickReveal.ts:71-110`, `nflPickReveal.ts:94-95`, PLAN-MEMBER-PICKS-VISIBILITY |
| `proxyPick` has NO confidence support at all (schema carries `picks` only) | `schemas/poolExceptions.ts:37-39`; `grep confidence functions/src/poolExceptions.ts` → the lock line only |
| The create-pool settings schema is a plain `z.object` and STRIPS unknown keys | `shared/schemas/nfl.ts:61-64` |
| Precedent for a SUPER_ADMIN paged, dry-run-default, audited backfill with an Operations-panel runner | `functions/src/migrations/backfillPublishedWeeks.ts`, `schemas/migrations.ts:66-75`, `OperationsPanel.tsx:211-228`, `:413-431`; pinned by `tests/ops-panel-report-coverage.test.ts` and `functions/src/__tests__/sweepBatch17Schema.test.ts` |
| User-facing copy says confidence forces weekly in 6 places | `nfl-pickem.ts:46`, `:63`; `glossary.ts:269`; `NFLPoolRules.tsx:121`; `NFLManagerView.tsx:1441`; `CreateNFLPickemPool.tsx:70`; `CONTEXT.md:149`; test `tests/help-content-nfl-pickem.test.ts:228` |

### The Donkeys pool, read from the live site 2026-09-10 09:05 MDT (Kevin's SUPER_ADMIN session, read-only)

| Fact | Value |
|---|---|
| Pool | "Donkeys 2026", host Jim Lenz, NFL Pick'em, **Confidence**, Straight-up, **Hybrid** (weekly + season), $50 entry = $25 weekly + $25 season |
| Size | 21 players, **22 entries** (pick-distribution rows say "22 picks") |
| Lock buffer | 10 min (Week 2 card: "locks Thu, Sep 17 · 6:10 PM MDT" for a 6:20 PM kickoff) |
| **Week 1 is ALREADY LOCKED** | Opener was **WED** Sep 9 6:20 PM MDT, NE at SEA, now **FINAL 10–13**. The whole sheet shows "Picks are locked for this week", 16 of 16 games `LOCKED`. Remaining: SF@LAR Thu 6:35 PM, 13 Sunday games, DEN@KC Mon 6:15 PM |
| Stored `lockMode` | **Unknown** — the manager UI always displays WEEKLY under confidence regardless of the stored value, and this session has no Firestore read credential. The backfill dry run reports it (§7 step 3). |
| Week 1 weekly pot | $25 × 22 = **$550** rides on Week 1 |

---

## 2. Decisions — RULED (kept for the record; the table at the top is authoritative)

**D1 — legacy pools: BACKFILL.** Stamp `lockMode: 'WEEKLY'` on every
`NFL_PICKEM` pool with `confidenceMode === true` and `lockMode !== 'WEEKLY'`
(covers the wizard-default `'PER_GAME'` and an absent field). Afterwards the
rule is `lockMode` alone and the stored value stops being a lie. The op is
idempotent; a second run reports zero. The flag alternative is rejected per
Kevin. What "does not break the pool" means mechanically: the backfill writes
`settings.lockMode`, `settings.lockRuleVersion: 2` and a `settings.lockRevision`
bump — dotted paths, nothing else on the doc, never entries, standings, or
leases.

**v3 (codex r1 #3/#4): the backfill is paired with a server-written version
stamp.** `nflLockMode` keeps today's behaviour — confidence forces WEEKLY —
for any pool whose `settings.lockRuleVersion !== 2`. `createPool` stamps 2 on
every new NFL_PICKEM pool; the backfill stamps 2 (with `lockMode: 'WEEKLY'`) on
every legacy confidence pool. So: between the functions deploy and the backfill
every legacy pool still plays weekly to EVERY caller including a hand-crafted
callable; a pool created after the deploy is never matched by the backfill
predicate; and once the backfill reports zero the legacy clause is dead code,
retired in a follow-up after `lockRuleVersion !== 2` is measured at zero pools.
This is not a commissioner-facing flag (rejected by Kevin): no person sets it,
no UI shows it, and the stored `lockMode` is still what decides the mode. For a pool that
plays weekly today it is a no-op in behaviour: it makes explicit what the pool
already does.

**D2 — missed locked game forfeits the HIGHEST weight.** k = number of locked
games in the week with no stored pick for this entry. The member's valid range
for the games they can pick is `[17−N .. 16−k]`; those N−k games must each
carry a distinct weight in that range. Worked examples: 16 games, missed the
Wednesday opener → 15 picks weighted 1..15, the 16 is gone. 12 games, missed
one → 11 picks weighted 5..15 (range is `[17−12 .. 16−1]`), the 16 is gone.
Missed two of 16 → 14 picks weighted 1..14. The scorer needs no change: the
missed game has no pick and scores 0, and the forfeited values simply never
appear on the sheet.

**D3 — tiebreaker locks with its target.** In a PER_GAME pool a CHANGED
`tiebreakerPrediction` is refused once the tiebreak target game(s) are locked
(`frozenTiebreakTargets` for the week, else the canonical target, else the
week's last game). WEEKLY pools keep the week lock. Fixes the pre-existing
hole for straight per-game pools as well.

**D4 — no server guard on a mid-week flip.** The client shows a confirm dialog
when the flip would land on a week whose weekly lock has passed ("This reopens
N games in Week W. Members have already seen each other's picks for this
week."). It is a warning. The save proceeds on confirm.

**D5 — new confidence pools default to per-game.** The wizard keeps
`lockMode: 'PER_GAME'` as its default and the checkbox copy stops saying
"forces weekly lock".

**D6 — Donkeys Week 1 reopens.** Consequences in §6; procedure in §7.

---

## 3. Design

### 3.1 One rule, imported everywhere (kills the three hand copies)

`shared/nflLockMode.ts`:

```ts
export const LOCK_RULE_VERSION = 2;
export function nflLockMode(poolType, settings): NFLLockMode {
  if (usesWeeklyHardLock(poolType)) return 'WEEKLY';
  // Legacy clause (retire when no pool is left unstamped): a confidence pool the
  // PLAN-CONFIDENCE-PER-GAME-LOCK backfill has not reached still plays weekly.
  if (settings?.confidenceMode && settings?.lockRuleVersion !== LOCK_RULE_VERSION) return 'WEEKLY';
  return settings?.lockMode === 'WEEKLY' ? 'WEEKLY' : 'PER_GAME';
}
```

For a stamped pool `confidenceMode` leaves the rule. The three server sites (`nflPools.ts:626`,
`pickReveal.ts:71`, `poolExceptions.ts:338`) **import** `nflLockMode` from
`./shared/nflLockMode` (the copy-shared output) instead of restating the
expression. `tests/nfl-lockmode-invariants.test.ts` flips from "the literal
string is present" to "the literal string is ABSENT and the import is present"
in each of the three files — same purpose (no drift), stronger guard (drift
becomes impossible rather than detected). `NFLLockModeSettings.confidenceMode`
stays in the type because the pick sheet and the validator still read it; the
rule just no longer does.

### 3.2 Submit path (`submitNFLPicksInternal`, Pick'em branch)

```
mode = nflLockMode(type, settings)
if mode === WEEKLY:   UNCHANGED — WEEK_LOCKED; validateConfidenceValues (complete N)
else (PER_GAME):
  for each submitted gameId:
    game must be in this week's slate                                    (existing)
    locked = isGameLockedAt(now, game, week, lockSettings, { kickoffCeiling: confidenceMode })
    if locked && picks[gameId] !== stored.picks[gameId]                 → GAME_LOCKED        (existing)
  if confidenceMode:
    every key of `confidence` must be in this week's slate              → invalid-argument   (r1 #7)
    for each gameId in the slate with a submitted weight:
      locked (as above) && confidence[gameId] !== stored.confidence[gameId]
                                                                         → CONFIDENCE_LOCKED  (new)
    merged = for each game in this week's slate (slate ids ONLY):
               pick   = submitted pick   ?? stored pick
               weight = submitted weight ?? stored weight
    every OPEN game must have a merged pick                              → INCOMPLETE_CONFIDENCE_SUBMISSION
    k = locked games with no merged pick
    validatePerGameConfidence(merged, N, k):                              (new, pure, nflScoringEngine)
      every picked game has a weight                                     → INCOMPLETE_CONFIDENCE_SUBMISSION
      weights in [17−N .. 16−k]                                           → OUT_OF_RANGE_CONFIDENCE
      weights distinct                                                   → DUPLICATE_CONFIDENCE_VALUES
  tiebreaker (D3): if tiebreakerPrediction !== undefined
       && tiebreakerPrediction !== stored.weeklyTiebreakers[week]
       && tiebreakTargetLocked(now, games, frozenTarget, rule, lockSettings) → TIEBREAK_LOCKED   (new)
```

### 3.2a Kickoff is a hard ceiling (codex r1 #1/#2)

`effectiveGameLockAt` is `max(kickoff − buffer, weekOverride)`, and
`extendWeekDeadline` / a `lockBufferMinutes` edit can move that LATER than
kickoff — on straight per-game pools that is the documented exception path
("Extend the deadline first if an exception is warranted"), and it stays so
there. In a **confidence PER_GAME pool** Kevin's rule is literal, so the shared
`gameLockAt` and the server `effectiveGameLockAt` take a `kickoffCeiling`
option: when set, the result is `Math.min(asToday, kickoff)`. Used by submit,
proxy (moot after §3.3), reveal, and every client surface through the shared
file. A game that has NOT started can still be reopened by an extension or a
buffer edit — Kevin's words draw the line at "has started", and that is where
this draws it.

Why "every OPEN game must have a merged pick" is required on the server in
confidence mode (it is not for straight per-game): the D2 range depends on k,
and k can only grow as games lock. If a member could leave an open game
unpicked while holding a 16 elsewhere, that game locking later would make
their stored sheet retroactively invalid. Requiring the open set to be
complete at every submit keeps every stored sheet valid under its own k
forever. The client already enforces exactly this (`allOpenPicked`).

Rejection, not silent override, for a locked weight: the only way a locked
weight changes is that the member moved it to an open game, which the merged
uniqueness check would refuse anyway. The client keeps it unreachable (3.4);
the server is the rule.

Idempotency, `lastRequestId`, `ENTRY_REVISION_FIELD`, the tiebreak-target
freeze, `committedPickForWeek`, and the entry write shape are untouched.

### 3.3 Reveal and proxy

`revealMode` (`pickReveal.ts`) → `nflLockMode(...) === 'WEEKLY' ? 'WEEK' : 'PER_GAME'`.
A PER_GAME confidence pool then reveals picks AND weights game by game, which
is what `nflPickReveal.ts:339` already does per revealed game id.

`proxyPick` (`poolExceptions.ts`) → imports the rule, and **refuses a
confidence pool outright** (`PROXY_CONFIDENCE_UNSUPPORTED`, codex r1 #6). Its
schema carries picks only, so on a confidence pool it could only ever write a
pick with no weight — an entry that is neither a ranked pick nor a D2 missed
game. That was already true on weekly confidence pools; it is now refused
rather than silently half-written. Adding a `confidence` map to the callable
(with the same merged validator and locked-weight checks) is the recorded
follow-up in §8.

### 3.4 Client (`PickemPickEntry.tsx`)

- Locked row: team buttons AND weight select disabled (already true — `:732`,
  `:771`, `:787`). Locked-row copy gains "weight locked".
- Range: top of the range becomes `16 − k` where k = locked games with no
  stored pick; the dropdown lists only that range. A note under the sheet
  explains the forfeit when k > 0 ("You missed 1 game this week, so the 16 is
  not available").
- `canSubmit`: every OPEN game picked and weighted; distinct; in range.
- Before submit, drop a stale locked WEIGHT exactly as a stale locked pick is
  dropped (a `dropStaleLockedWeights` sibling in `shared/nflLockMode.ts`); one
  toast covers both.
- Payload `confidence`: the current week sheet including locked, unchanged
  weights (the server compares and keeps them; sending them costs nothing and
  keeps the payload a straight picture of the sheet — same reasoning as picks).
- `blockedReason` "Set a confidence weight for every game" → "…for every open
  game".

### 3.5 Manager UI and wizard

- `NFLManagerView`: remove the force-to-WEEKLY effect; Lock Mode select
  enabled under confidence; the select's value on load is the EFFECTIVE mode
  (`nflLockMode(...)`) — after the backfill this equals the stored value, and
  before it (the deploy window) it still shows what the pool actually plays.
  The "* Forced Weekly in Confidence Mode" line becomes "In a per-game
  confidence pool each game's pick and weight lock at that game's kickoff. A
  game you miss forfeits the highest weight." Mid-week flip → confirm dialog
  (D4).
- Wizard: checkbox copy drops "forces weekly lock". No payload change (D5 is
  the existing default).
- `NFLPoolRules.tsx:121`: derive the label from `nflLockMode`, drop
  'Strictly Weekly'.
- Help/glossary/CONTEXT copy in the six places listed in §1; the help test at
  `tests/help-content-nfl-pickem.test.ts:228` flips with the rule.

### 3.6 Backfill op (D1) — `backfillConfidenceLockMode`

Modelled line-for-line on `backfillPublishedWeeks` (Rule 1: dry-run default at
the SCHEMA layer, per-run cap, `admin_audit` summary on every run, paged with
`startAfter`, Operations-panel dry + live buttons, counters aggregated by
`addReportPage`).

- Query: `pools` where `type == 'NFL_PICKEM'`, paged by document id.
- Predicate (pure, unit-tested, re-evaluated INSIDE the write transaction):
  `settings.confidenceMode === true && settings.lockRuleVersion !== 2`. A pool
  created after the release is stamped 2 by `createPool` and never matches
  (codex r1 #4). A legacy confidence pool that already stores `WEEKLY` still
  matches — it needs the stamp — and its `lockMode` write is a no-op.
- Write (live only), in a transaction per pool: `settings.lockMode = 'WEEKLY'`,
  `settings.lockRuleVersion = 2`, `settings.lockRevision = readLockRevision(pool) + 1`,
  `updatedAt`. Dotted paths only. The `lockRevision` bump is what a commissioner's own Lock Mode
  save does (`poolOps.ts:659`), so a scoring pass in flight re-reads rather
  than publishing against a stale lock; it is harmless here because the
  effective mode does not change, and omitting it would be the one way this
  write differed from the normal path.
- Report: `poolsScanned`, `poolsChanged`, `plannedWrites: [{poolId, name,
  storedLockMode}]` (capped 100), `failures`, `nextCursor`. The dry run is how
  Kevin reads Donkeys' stored value (§7 step 3).
- Audit action `BACKFILL_CONFIDENCE_LOCK_MODE`.
- Wiring: `index.ts` export; `schemas/migrations.ts`; `OperationsPanel.tsx`
  dry + live entries; `sweepBatch17Schema.test.ts` null-cursor case;
  `ops-panel-report-coverage.test.ts` derives the counter list from source.

---

## 4. Tickets

| # | Ticket | Files | Gate |
|---|---|---|---|
| T1 | Rule rewrite (3.1) — `confidenceMode` leaves `nflLockMode` | `shared/nflLockMode.ts` | unit |
| T2 | Server imports the rule; delete the three hand copies; rewrite the invariant test to assert import + absence | `nflPools.ts`, `lib/pickReveal.ts`, `poolExceptions.ts`, `tests/nfl-lockmode-invariants.test.ts`, `functions/src/__tests__/pickReveal.test.ts`, `poolUpdate.test.ts` | unit |
| T3 | `validatePerGameConfidence` (pure, D2 range) + submit-path PER_GAME confidence branch + `CONFIDENCE_LOCKED` + open-set completeness | `nflScoringEngine.ts`, `nflPools.ts` | unit + emulator |
| T4 | Tiebreaker lock in PER_GAME (D3) | `nflPools.ts` (+ helper beside `shared/nflTiebreaker.ts`) | unit + emulator |
| T5 | Backfill op (3.6) + panel wiring + schema tests | `migrations/backfillConfidenceLockMode.ts` (new), `schemas/migrations.ts`, `index.ts`, `OperationsPanel.tsx`, tests | unit + emulator |
| T6 | Client pick sheet (3.4) incl. D2 range and forfeit note | `PickemPickEntry.tsx`, `shared/nflLockMode.ts` (drop-stale weights), `utils/confidenceWeights.ts` | unit (shared/utils) |
| T7 | Manager UI (incl. D4 confirm) + wizard + rules page + copy (3.5) | `NFLManagerView.tsx`, `CreateNFLPickemPool.tsx`, `NFLPoolRules.tsx`, `help/content/nfl-pickem.ts`, `help/glossary.ts`, `CONTEXT.md`, help tests | unit (help tests) |
| T8 | Emulator scenario: PER_GAME confidence pool with one locked game | `functions/src/__tests__/emulator/confidencePerGame.emulator.test.ts` (new) | emulator |
| T10 | `confidenceMode` joins the once-anybody-submitted gate (`CONFIDENCE_MODE_LOCKED`), same transaction as `weeklyTiebreaker` (codex r1 #8) | `poolOps.ts`, `lib/` predicate, `NFLManagerView.tsx` (disable + reason) | unit + emulator |
| T11 | `createPool` stamps `settings.lockRuleVersion: 2` on every new NFL_PICKEM | `nflPools.ts` create path, `shared/schemas/nfl.ts` | unit + emulator |
| T9 | Sweep doc: grep-complete lists of (a) every reader of `lockMode`/`confidenceMode`, (b) every copy string, (c) every test pinning the old rule, (d) every `validateConfidenceValues` caller | `PLAN-CONFIDENCE-PER-GAME-LOCK-SWEEPS.md` | — |

**T8 scenarios (every feature ships with its test — Kevin 2026-08-17):**
1. Confidence pool, `lockMode: 'WEEKLY'`, first kickoff passed → `WEEK_LOCKED` (post-backfill behaviour proven unchanged).
2. Confidence pool, `lockMode: 'PER_GAME'`, Wed game locked: change a Sunday pick and weight → accepted; stored Wed pick/weight unchanged.
3. Same pool: change Wed weight only → `CONFIDENCE_LOCKED`. Change Wed pick → `GAME_LOCKED`.
4. Same pool: move the Wed game's 16 onto a Sunday game → `DUPLICATE_CONFIDENCE_VALUES` (merged uniqueness).
5. Late joiner, Wed game locked, no Wed pick: 15 picks weighted 1..15 → accepted, entry has no Wed pick or weight; the same sheet with a 16 anywhere → `OUT_OF_RANGE_CONFIDENCE` (D2).
6. Same pool, open Sunday game left unpicked while submitting others → `INCOMPLETE_CONFIDENCE_SUBMISSION` (open-set completeness).
7. `tiebreakerPrediction` changed after the target game locked → `TIEBREAK_LOCKED`; before → accepted (D3).
8. Backfill: seed three pools (confidence+PER_GAME, confidence+absent lockMode, confidence+WEEKLY, straight+PER_GAME); dry run reports exactly the first two with `storedLockMode`; live run writes `WEEKLY` + bumps `lockRevision` on those two only; second live run reports zero.
9. Reveal: `getPoolPicks` on the PER_GAME pool reveals only the locked game's picks/weights to a member.
10. Scorer: `scoreNFLWeek` on the PER_GAME pool produces the same points as the WEEKLY pool with identical sheets (lock mode is not a scoring input), and a missed-game entry scores 0 for that game.
11. **Kickoff ceiling — extension:** PER_GAME confidence pool, Wed game kicked off; commissioner `extendWeekDeadline` to Sunday → accepted for the week (Pick'em), but a changed Wed pick or weight is still `GAME_LOCKED` / `CONFIDENCE_LOCKED`; a Thursday game (not started) IS reopened by it (codex r1 #1).
12. **Kickoff ceiling — buffer:** same pool, buffer 60 → 0 after the Wed game started → Wed still locked (codex r1 #2).
13. **Proxy:** `proxyPick` on any confidence pool → `PROXY_CONFIDENCE_UNSUPPORTED`; on a straight PER_GAME pool unchanged (codex r1 #6).
14. **Legacy clause:** confidence pool with `lockMode: 'PER_GAME'` and NO `lockRuleVersion` → plays WEEKLY (`WEEK_LOCKED` after first kickoff, `revealMode` 'WEEK'); same pool after the backfill → stored WEEKLY, stamped 2, still WEEKLY; a pool created through `createNFLPool` after the release → stamped 2 (codex r1 #3/#4).
15. **confidenceMode gate:** toggling `confidenceMode` on a pool with one stored pick → `CONFIDENCE_MODE_LOCKED`; on an empty pool → accepted (codex r1 #8).
16. **Hard-lock regression:** Survivor and Margin, member submit and proxy, `WEEK_LOCKED` after the weekly deadline regardless of `lockMode`/`lockRuleVersion` (codex r1 #10).
17. **Backfill paging:** emulator seeds 3 legacy pools with `limit: 2` → first page returns `nextCursor`, second page finishes, aggregate `poolsChanged: 3` (codex r1 #5 clarification).

Gates: all seven commands in CLAUDE.md §2e, lint delta zero against a measured
baseline, `codex exec review --base origin/main` (probe `-m gpt-5.6-terra`
first — probed 2026-09-10 09:25, replied OK), qodo on the PR, three-condition
stop.

---

## 5. Risks and how each is closed

| Risk | Closed by |
|---|---|
| Existing confidence pools flip to per-game at functions deploy, before the backfill runs | **Closed by the `lockRuleVersion` stamp (codex r1 #3):** an unstamped confidence pool plays WEEKLY to every caller, UI or hand-crafted, until the backfill stamps it. T8 #14. |
| A deadline extension or a buffer edit reopens a started confidence game | Kickoff ceiling (§3.2a); T8 #11, #12 |
| A pick without a weight is created in a confidence pool | proxyPick refused (§3.3); confidence keys validated and every picked game must carry a weight (§3.2); T8 #13 |
| `confidenceMode` flipped mid-season changes scoring | T10 gate; T8 #15 |
| Server and client disagree about the rule (the 2026-08-18 production defect) | T2: server IMPORTS the shared rule; invariant test asserts no hand copy remains |
| A locked weight changes through any path | T3 `CONFIDENCE_LOCKED` + merged uniqueness; proxyPick cannot write weights at all; `firestore.rules` blocks direct client entry writes |
| A stored sheet becomes invalid when a later game locks (D2 k grows) | Open-set completeness at every submit (3.2); T8 #6 |
| Late joiner locked out of the week | D2 / T3 / T8 #5 |
| Tiebreaker edited after MNF kicks off (pre-existing) | D3 / T4 / T8 #7 |
| Backfill writes the wrong pools, or a pool created mid-rollout | Pure predicate on the stamp, re-checked in the transaction; new pools stamped at create; dry run lists `{poolId, name, storedLockMode}`; T8 #8, #14, #17; idempotent |
| Deploy-window skew (functions and www deploy separately, CLAUDE.md §3) | Old client + new server: old client computes WEEKLY for confidence → sheet locked → fail-closed. New client + old server: new client opens Sunday games, old server returns `WEEK_LOCKED` → error toast, no write → fail-closed. Order: functions → backfill → Coolify. |
| Live scorer (`nflAutoScoreJob` */5) | Scorer code untouched; PR body still states the deploy lands in a live scorer per the G1 rule |
| Copy drift (six places say "forces weekly") | T7 + T9 sweep list + help tests |
| Week 1 reopen consequences (D6) | Accepted by Kevin with Jim informed — §6 |

---

## 6. The Donkeys pool — what reopening Week 1 means (D6: accepted)

Week 1 is already locked (Wed opener FINAL). Flipping Donkeys to PER_GAME
reopens every remaining game for team AND weight changes; the Wed game stays
frozen. Recorded so nobody is surprised:

1. **Everyone has already seen everyone's full sheet.** WEEK-mode reveal
   showed all 22 entries' 16 picks and 16 weights to every member at Wed 6:10
   PM MDT (Current Picks grid). A member can re-pick the open games knowing
   what the other 21 entries hold. Not recoverable; the information is out.
2. **$550 weekly pot** is decided by Week 1 under rules changed after picks
   locked.
3. **Members who do not check back are disadvantaged** against those who
   re-optimise after each result — inherent to per-game, but in Week 1 only
   because the rule changed after they submitted.
4. Members who never submitted Week 1 can now submit the remaining games with
   the 16 forfeited (D2).
5. Mechanically safe: the Wed pick and weight are immutable under
   `CONFIDENCE_LOCKED`/`GAME_LOCKED`; scoring is unaffected; the scorer has
   already published the Wed game and publishes the rest per game.
6. **Calendar.** Remaining Week 1 games: Thu Sep 10 6:35 PM MDT (SF@LAR; lock
   6:25 PM), thirteen on Sun Sep 13 from 11:00 AM, DEN@KC Mon Sep 14 6:15 PM.
   Code does not exist yet. Realistic: implementation Thu–Fri, gates + review
   rounds Fri–Sat, merge + deploy + backfill + flip **Sat Sep 12** at best,
   which reopens the Sunday and Monday games. Tonight's game will have locked
   under the old rule either way.

A note from Jim to the members BEFORE the flip, saying what reopens and that a
missed game forfeits the 16, is strongly advised.

---

## 7. Deploy and flip checklist (filled in at implementation; handed to Kevin in chat at full verbosity)

1. `git -C D:\march-melee-pools pull --ff-only origin main` (CLAUDE.md §3 step zero).
2. `npm --prefix functions ci`, then `npx firebase deploy --only functions --project gridiron-gamble-uzuqo`. NEW export `backfillConfidenceLockMode` — verify by name: `npx firebase functions:list | Select-String "backfillConfidenceLockMode"`.
3. SuperAdmin → Operations → **Backfill Confidence Lock Mode (dry run)**. One click runs every page (the panel runner loops on `nextCursor`, `OperationsPanel.tsx:211-227`). Read `plannedWrites`: it lists every confidence pool whose stored lockMode is not WEEKLY, with the stored value. Donkeys should appear if its stored value is `PER_GAME`; if it is absent, Donkeys already stores WEEKLY and the live run will not touch it.
4. Operations → **Backfill Confidence Lock Mode** (live). Expect `poolsChanged` = the dry-run count. Run once more: expect 0.
5. Coolify manual redeploy of www; verify the new `index-*.js` hash and that the needle `CONFIDENCE_LOCKED` (a client-rendered error code) is present in the crawled chunks (HANDOFF 2026-09-08 box: crawl, never the index chunk alone).
6. Donkeys flip: pool → Manager → Settings → Pick'em Rules → Lock Mode → "Per-Game" → confirm the mid-week dialog → Save.
7. Verify on the W1 sheet as a member (or Kevin's own entry): Wed game row locked with its weight greyed; a Sunday game's team AND weight can be changed and saved; moving the Wed game's weight is impossible from the dropdown.

---

## 8. Out of scope (recorded, not forgotten)

- `proxyPick` cannot set a confidence weight (pre-existing); as of this plan it
  REFUSES confidence pools rather than writing a half entry. Follow-up: add a
  `confidence` map to the callable with the same validation.
- Retire the `lockRuleVersion !== 2` legacy clause in `nflLockMode` once a
  census shows zero unstamped confidence pools.
- Straight (non-confidence) per-game pools keep today's extension semantics: an
  extension CAN reopen a started game there. Only confidence pools get the
  kickoff ceiling.
- `extendWeekDeadline` semantics are unchanged: an extension still applies to
  every game in the week (the `weekLockCaption` caveat stands).
- No change to Survivor, Margin, scoring, payouts, or `firestore.rules`.
- No server-side guard on mid-week LOCK-MODE changes (D4 = no). (`confidenceMode`
  changes ARE gated — T10 — because they change scoring, which D4 did not rule on.)
