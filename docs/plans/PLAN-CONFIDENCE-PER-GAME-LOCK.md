# PLAN — confidence pools may lock per game; a started game's pick AND weight are immutable

> **STATUS: DRAFT FOR KEVIN'S REVIEW — 2026-09-10. No code written. No review
> log yet. No sweep yet.**
>
> **Provenance:** Kevin, 2026-09-10: *"As a rule that we made, if it is a
> confidence pool, that pool locks at the first game of the week. After some
> feedback, I want to change this. It is important that if we allow users to
> change picks of games that have already started, they are not able to change
> any confidence selection of a game that has already started. They should be
> allowed to change the team they picked and the confidence pick if that game
> has not started. Any confidence pick for a game that has started can not be
> changed under any circumstances."* Example pool: `ubHD4bgszL05oURYubrn`
> ("Donkeys 2026").
>
> **Class:** close to two Rule-3 triggers — it changes WHO may change a pick
> WHEN (competitive integrity, which decides weekly prizes and therefore money)
> and, for the Donkeys flip, it changes a live production pool's rules with a
> weekly pot riding on the week. Taken as **plan-gated** (`mmp-change-control`
> §1: "take the gate when in doubt"). Plan → review log → sweeps → Kevin
> sign-off → implement → deploy checklist.

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
> already frozen on locked games.

Three things do NOT change:

- WEEKLY-lockMode pools (any Pick'em) behave exactly as today.
- Survivor and Margin are untouched (hard weekly lock from the TYPE).
- The scoring engine is untouched. `scorePickemEntry` already grades per game
  off `entry.confidence[gameId]`, and the scorer already decides gradability
  per game (`gameLockClosed`, `nflPools.ts:1496`). Lock mode is a SUBMISSION
  rule, not a scoring rule.

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
| User-facing copy says confidence forces weekly in 6 places | `nfl-pickem.ts:46`, `:63`; `glossary.ts:269`; `NFLPoolRules.tsx:121`; `NFLManagerView.tsx:1441`; `CreateNFLPickemPool.tsx:70`; `CONTEXT.md:149`; test `tests/help-content-nfl-pickem.test.ts:228` |

### The Donkeys pool, read from the live site 2026-09-10 09:05 MDT (Kevin's SUPER_ADMIN session, read-only)

| Fact | Value |
|---|---|
| Pool | "Donkeys 2026", host Jim Lenz, NFL Pick'em, **Confidence**, Straight-up, **Hybrid** (weekly + season), $50 entry = $25 weekly + $25 season |
| Size | 21 players, **22 entries** (pick-distribution rows say "22 picks") |
| Lock buffer | 10 min (Week 2 card: "locks Thu, Sep 17 · 6:10 PM MDT" for a 6:20 PM kickoff) |
| **Week 1 is ALREADY LOCKED** | Opener was **WED** Sep 9 6:20 PM MDT, NE at SEA, now **FINAL 10–13**. The whole sheet shows "Picks are locked for this week", 16 of 16 games `LOCKED`. Remaining: SF@LAR Thu 6:35 PM, 13 Sunday games, DEN@KC Mon 6:15 PM |
| Stored `lockMode` | **Unknown** — the manager UI always displays WEEKLY under confidence regardless of the stored value, and this session has no Firestore read credential. Must be read before the flip (see §7 step 1). |
| Week 1 weekly pot | $25 × 22 = **$550** rides on Week 1 |

---

## 2. Decisions needed from Kevin (each with a recommendation)

**D1 — How existing confidence pools keep today's behaviour.** The stored
`lockMode` on a confidence pool is a lie today (wizard default `PER_GAME`, plays
weekly). If the rule simply starts honouring `lockMode`, an unknown number of
live pools flip to per-game the moment functions deploy, with no commissioner
action. Two ways to stop that:

- **(a) RECOMMENDED — opt-in flag, no prod writes.** New
  `settings.confidencePerGameLock: boolean` (absent/false = legacy: confidence
  forces weekly). Rule becomes: hard-lock type → WEEKLY; `lockMode === 'WEEKLY'`
  → WEEKLY; `confidenceMode && !confidencePerGameLock` → WEEKLY; else
  PER_GAME. The wizard writes `true` for new confidence pools (D5). The manager
  UI's Lock Mode select, enabled under confidence, writes `lockMode` AND the flag
  together. No existing pool changes until its commissioner saves a lock mode.
  Cost: one more settings key, forever; codex will call it "two fields for one
  decision" — the answer is that the second field is the opt-in that makes the
  rollout safe without a migration.
- **(b) Backfill.** Stamp `lockMode: 'WEEKLY'` on every existing
  `NFL_PICKEM` + `confidenceMode` pool via a one-shot Operations-panel op, THEN
  deploy a rule that reads `lockMode` alone. Cleaner end state, but a prod-data
  migration (its own Rule-3 gate), a strict ordering requirement (backfill
  before functions deploy before frontend deploy), and a window where a pool
  created by the old wizard flips at deploy.

**D2 — A member who missed a game that has since locked.** Today completeness
requires a weight on all N games. Under per-game that would lock a late joiner
(or anyone who missed the Wednesday opener) out of the ENTIRE week, because
they can never weight a game they cannot pick. **RECOMMENDED:** a locked game
with no stored pick gets no pick and no weight (it scores 0, as it does today
for an unpicked game); the member must weight every game they DO pick, using
distinct values from the usual range `[17−N .. 16]`. One value goes unused —
their choice which (the rational choice is the lowest, which is what an
auto-assign would do anyway). The alternative — require all N — keeps today's
strictness but makes a missed Thursday fatal for the week.

**D3 — When the weekly tiebreaker prediction locks in a PER_GAME pool.**
Today it never locks (§1 pre-existing hole). **RECOMMENDED:** a CHANGED
prediction is refused once the tiebreak target game(s) are locked
(`frozenTiebreakTargets`, else the week's last game); WEEKLY pools keep the
week lock. This fixes the hole for straight per-game pools too and is in scope
because confidence pools moving to per-game widens its exposure.

**D4 — A guard against flipping lock mode while a week is in progress.**
Today a commissioner can flip `lockMode` mid-week. On a WEEKLY→PER_GAME flip
that REOPENS every not-yet-kicked-off game of a week whose full sheets every
member has already been shown (WEEK-mode reveal). **RECOMMENDED: add the
guard** — `updatePoolSettings` refuses a change to `lockMode` or
`confidencePerGameLock` while the pool's current week has passed its weekly
lock and is not yet entirely final (`LOCK_MODE_WEEK_IN_PROGRESS`). The flip is
allowed in the Tue→Thu window. **This is what decides the Donkeys question
(§6):** with the guard, Donkeys flips Tue Sep 15 – Thu Sep 17 before 6:10 PM
MDT and Week 2 plays per-game; Week 1 finishes weekly. Without the guard, the
flip can land now and reopens Week 1's 15 remaining games.

**D5 — New confidence pools' default.** **RECOMMENDED: per-game** (the wizard
default `lockMode: 'PER_GAME'` applies; the flag is written `true`; the
checkbox copy stops saying "forces weekly lock"). Alternative: weekly by
default, commissioner opts into per-game.

**D6 — Donkeys Week 1.** **RECOMMENDED: do not reopen.** See §6.

Two clarifying questions, not decisions: (i) Does Jim Lenz (the host) know and
agree? The flip is a commissioner action in his pool. (ii) This ships as a
feature for every commissioner, not a Donkeys-only switch — confirm.

---

## 3. Design

### 3.1 One rule, imported everywhere (kills the three hand copies)

`shared/nflLockMode.ts` is rewritten per D1(a). The three server sites
(`nflPools.ts:626`, `pickReveal.ts:71`, `poolExceptions.ts:338`) **import**
`nflLockMode` from `./shared/nflLockMode` (the copy-shared output) instead of
restating the expression. `tests/nfl-lockmode-invariants.test.ts` flips from
"the literal string is present" to "the literal string is ABSENT and the import
is present" in each of the three files — same purpose (no drift), stronger
guard (drift is now impossible rather than merely detected).

`NFLLockModeSettings` / `NFLLockPool` gain `confidencePerGameLock?: boolean`.
`shared/schemas/nfl.ts` gains the optional boolean; `LOCK_AFFECTING_SETTINGS_KEYS`
gains the key (a flip must serialize with the scoring lease and bump
`lockRevision`, same as `lockMode`).

### 3.2 Submit path (`submitNFLPicksInternal`, Pick'em branch)

```
mode = nflLockMode(type, settings)
if mode === WEEKLY:   unchanged (WEEK_LOCKED; validateConfidenceValues complete-N)
else (PER_GAME):
  for each submitted gameId:
    game must be in this week's slate            (existing)
    locked = isGameLockedAt(now, game.startTime, week, lockSettings)
    if locked && picks[gameId] !== stored.picks[gameId]          → GAME_LOCKED        (existing)
    if confidenceMode && locked
       && confidence[gameId] !== undefined
       && confidence[gameId] !== stored.confidence[gameId]        → CONFIDENCE_LOCKED  (new)
  if confidenceMode:
    merged = this week's slate × (submitted ?? stored) for picks and weights
    validatePerGameConfidence(merged, games):                      (new, pure, nflScoringEngine)
      every merged pick has a weight                 → INCOMPLETE_CONFIDENCE_SUBMISSION
      weights in [17−N .. 16]                        → OUT_OF_RANGE_CONFIDENCE
      weights distinct                               → DUPLICATE_CONFIDENCE_VALUES
      (no "all N" requirement — D2)
  tiebreaker (D3): if tiebreakerPrediction !== undefined
       && !== stored.weeklyTiebreakers[week]
       && tiebreakTargetLocked(now, games, frozenTarget, lockSettings)
                                                                  → TIEBREAK_LOCKED   (new)
```

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

`proxyPick` (`poolExceptions.ts`) → imports the rule. It still cannot set a
weight (pre-existing gap, **out of scope**, recorded in §8) — so a commissioner
proxying a team pick on a confidence pool leaves the weight as it was, which
the merged validator must tolerate: a proxied pick with no weight on an OPEN
game is allowed to exist (the member weights it when they next submit), and
`scorePickemEntry` already scores a missing weight as 0.

### 3.4 Client (`PickemPickEntry.tsx`)

- Locked row: team buttons AND weight select disabled (already true for the
  select — `:787`; the team buttons — `:732`, `:771`). Copy on the locked row
  gains "weight locked".
- `canSubmit`: weight required for every game that is open OR has a stored
  pick; no weight required for a locked unpicked game (D2).
- Before submit, drop a stale locked WEIGHT exactly as a stale locked pick is
  dropped (`dropStaleLockedPicks` gains a `confidence` sibling or a generic
  map variant; the toast text covers both).
- Payload `confidence`: the current week sheet including locked, unchanged
  weights (the server compares and keeps them; sending them costs nothing and
  keeps the payload a straight picture of the sheet — same reasoning as picks).
- `blockedReason` "Set a confidence weight for every game" → "…for every open
  game".

### 3.5 Manager UI and wizard

- `NFLManagerView`: remove the force-to-WEEKLY effect; Lock Mode select
  enabled under confidence; the select's value on load is the EFFECTIVE mode
  (`nflLockMode(...)`), not the raw stored `lockMode`, so a legacy confidence
  pool loads as WEEKLY and a save writes what the commissioner saw; choosing
  PER_GAME on a confidence pool writes `lockMode: 'PER_GAME'` +
  `confidencePerGameLock: true`; choosing WEEKLY writes `lockMode: 'WEEKLY'`.
  The "* Forced Weekly in Confidence Mode" line becomes a plain sentence: "In a
  per-game confidence pool each game's pick and weight lock at that game's
  kickoff." Surface `LOCK_MODE_WEEK_IN_PROGRESS` (D4) as a readable error.
- Wizard: checkbox copy drops "forces weekly lock"; `buildNFLPayload` writes
  `confidencePerGameLock: true` when confidence is on (D5).
- `NFLPoolRules.tsx:121`: derive the label from `nflLockMode`, drop
  'Strictly Weekly'.
- Help/glossary/CONTEXT copy in the six places listed in §1; the help test at
  `tests/help-content-nfl-pickem.test.ts:228` flips with the rule.

### 3.6 Settings-save guard (D4)

In `updatePoolSettings`' existing lock-affecting transaction: if the patch
touches `settings.lockMode` or `settings.confidencePerGameLock` AND the
effective mode would change, read the pool's current week slate (as
`extendWeekDeadline` does), and refuse with `LOCK_MODE_WEEK_IN_PROGRESS` when
`now >= weekLockAt(WEEKLY reference)` and any game is not terminal. Pure
predicate in `lib/`, unit-tested; emulator-tested through the callable.

---

## 4. Tickets

| # | Ticket | Files | Gate |
|---|---|---|---|
| T1 | Rule rewrite + new setting + schema + LOCK_AFFECTING key | `shared/nflLockMode.ts`, `shared/schemas/nfl.ts`, `functions/src/lib/poolUpdate.ts` | unit |
| T2 | Server imports the rule; delete the three hand copies; rewrite the invariant test to assert import + absence | `nflPools.ts`, `lib/pickReveal.ts`, `poolExceptions.ts`, `tests/nfl-lockmode-invariants.test.ts`, `functions/src/__tests__/pickReveal.test.ts`, `poolUpdate.test.ts` | unit |
| T3 | `validatePerGameConfidence` (pure) + submit-path PER_GAME confidence branch + `CONFIDENCE_LOCKED` | `nflScoringEngine.ts`, `nflPools.ts` | unit + emulator |
| T4 | Tiebreaker lock in PER_GAME (D3) | `nflPools.ts` (+ `shared/nflTiebreaker.ts` helper) | unit + emulator |
| T5 | Settings-save week-in-progress guard (D4) | `lib/` predicate, `poolOps.ts` | unit + emulator |
| T6 | Client pick sheet (3.4) | `PickemPickEntry.tsx`, `shared/nflLockMode.ts` (drop-stale) | unit (shared) + vitest component where one exists |
| T7 | Manager UI + wizard + rules page + copy (3.5) | `NFLManagerView.tsx`, `CreateNFLPickemPool.tsx`, `buildNFLPayload*`, `NFLPoolRules.tsx`, `help/content/nfl-pickem.ts`, `help/glossary.ts`, `CONTEXT.md` | unit (help tests) |
| T8 | Emulator scenario: PER_GAME confidence pool with one locked game | `functions/src/__tests__/emulator/confidencePerGame.emulator.test.ts` (new) | emulator |
| T9 | Sweep doc: grep-complete lists of (a) every reader of `lockMode`/`confidenceMode`, (b) every copy string, (c) every test pinning the old rule | `PLAN-…-SWEEPS.md` | — |

**T8 scenarios (every feature ships with its test — Kevin 2026-08-17):**
1. Legacy confidence pool (flag absent), first kickoff passed → `WEEK_LOCKED` (unchanged behaviour proven).
2. Flagged PER_GAME confidence pool, Wed game locked: change a Sunday pick and weight → accepted; stored Wed pick/weight unchanged.
3. Same pool: change Wed weight only → `CONFIDENCE_LOCKED`. Change Wed pick → `GAME_LOCKED`.
4. Same pool: move the Wed game's 16 onto a Sunday game → `DUPLICATE_CONFIDENCE_VALUES` (merged uniqueness).
5. Late joiner, Wed game locked, no Wed pick: 15 picks with 15 distinct weights → accepted; entry has no Wed pick or weight (D2).
6. Same pool: `tiebreakerPrediction` changed after the target game locked → `TIEBREAK_LOCKED`; before → accepted (D3).
7. Flip `lockMode` WEEKLY→PER_GAME while the week is in progress → `LOCK_MODE_WEEK_IN_PROGRESS`; after all games final → accepted, `lockRevision` bumped (D4).
8. Reveal: `getPoolPicks` on the flagged pool reveals only the locked game's picks/weights to a member (PER_GAME reveal).
9. Scorer: `scoreNFLWeek` on the flagged pool produces the same points as the weekly pool with identical sheets (lock mode is not a scoring input).

Gates: all seven commands in CLAUDE.md §2e, lint delta zero against a measured
baseline, `codex exec review --base origin/main` (probe `-m gpt-5.6-terra`
first), qodo on the PR, three-condition stop.

---

## 5. Risks and how each is closed

| Risk | Closed by |
|---|---|
| Existing confidence pools silently flip to per-game at deploy | D1(a) flag default off; T8 #1 proves it |
| Server and client disagree about the rule (the 2026-08-18 production defect) | T2: server IMPORTS the shared rule; invariant test asserts no hand copy remains |
| A locked weight changes through any path | T3 `CONFIDENCE_LOCKED` + merged uniqueness; proxyPick cannot write weights at all; there is no other entry writer (rules block client entry writes) |
| Late joiner locked out of the week | D2 / T3 / T8 #5 |
| Tiebreaker edited after MNF kicks off (pre-existing) | D3 / T4 / T8 #6 |
| Commissioner reopens a revealed week by flipping mid-week | D4 / T5 / T8 #7 |
| Deploy-window skew (functions and www deploy separately, CLAUDE.md §3) | Flag default off → old client + new server: unchanged. New client + old server: the create schema is a plain `z.object` and STRIPS unknown keys (`shared/schemas/nfl.ts:61-64`), so a wizard-created pool plays legacy weekly until functions deploy; a manager save writes the key through `flattenSettingsPatch` but the old rule never reads it — no behaviour change until functions are live, then the commissioner's stated choice applies. Fail-closed both ways. Order: functions first, then Coolify. |
| Live scorer (`nflAutoScoreJob` */5) | Scorer code untouched; PR body still states the deploy lands in a live scorer per the G1 rule |
| Copy drift (six places say "forces weekly") | T7 + T9 sweep list + help tests |

---

## 6. The Donkeys pool — risks of flipping THIS week, and the recommended path

Week 1 is already locked (Wed opener FINAL). Fifteen games remain. Flipping
Donkeys to per-game **now** would reopen all fifteen for team AND weight
changes (the Wed game stays frozen). What that means, concretely:

1. **Everyone has already seen everyone's full sheet.** WEEK-mode reveal
   showed all 22 entries' 16 picks and 16 weights to every member at Wed 6:10
   PM MDT (Current Picks grid, PLAN-MEMBER-PICKS-VISIBILITY). Reopening lets a
   member re-pick the 15 open games knowing exactly what the other 21 entries
   hold — fade the consensus, or copy the leader and out-weight them. This is
   not recoverable; the information is out.
2. **$550 weekly pot** (hybrid, $25 × 22) is decided by Week 1, under rules
   changed after picks locked. Anyone who loses a tiebreak or a place to a
   re-pick has a legitimate grievance.
3. **Members who do not check back are disadvantaged** against those who
   re-optimise after Thursday's result. That is inherent to per-game — but
   only unfair in Week 1 because the rule changed after they submitted.
4. Mechanically it is safe: the Wed pick and weight are immutable under
   `CONFIDENCE_LOCKED`/`GAME_LOCKED`, scoring is unaffected, the scorer has
   already published the Wed game and will publish the rest per game.
5. Timeline: there is no shipped code. Plan review today (Thu), implement +
   review rounds Fri–Sun at best, gates + qodo + codex + merge + two deploys
   Mon–Tue. **The earliest realistic production flip is Tue Sep 15**, by which
   point Week 1 has one game left (MNF) — so "this week" for Week 1 is mostly
   moot on calendar alone.

**Recommendation: flip Donkeys in the Tue Sep 15 → Thu Sep 17 6:09 PM MDT
window, after MNF is final and Week 1 is scored. Week 2 plays per-game; Week 1
finishes under the rules it was picked under.** With D4 the server enforces
that window. Kevin (SUPER_ADMIN) or Jim performs the flip from the Settings
section; step-by-step in §7.

If Kevin nonetheless wants Week 1 reopened: choose D4 = no guard, accept 1–3
above, and the flip is the same §7 procedure performed the moment both deploys
are live. A member-facing note from the host explaining the rule change before
the flip is strongly advised in that case.

---

## 7. Deploy and flip checklist (filled in at implementation; steps are for Kevin, full verbosity in the chat hand-off)

1. Read Donkeys' stored `settings.lockMode` and `settings.confidencePerGameLock` (read-only) before anything else — via the SuperAdmin Pools tab or the census script with a credential — and write the values into the PR.
2. `git -C D:\march-melee-pools pull --ff-only origin main` (CLAUDE.md §3 step zero).
3. `npm --prefix functions ci`, then `npx firebase deploy --only functions --project gridiron-gamble-uzuqo`. No new export, so verify by re-running and expecting `Skipped (No changes detected)` on every function.
4. Coolify manual redeploy of www; verify the new `index-*.js` hash and that the needle `confidencePerGameLock` is present in the crawled chunks (HANDOFF 2026-09-08 box: crawl, never the index chunk alone).
5. Donkeys flip (Tue Sep 15 after MNF scoring → Thu Sep 17 6:09 PM MDT): Settings → Pick'em Rules → Lock Mode → "Per-Game" → Save. Expect success; expect refusal `LOCK_MODE_WEEK_IN_PROGRESS` if attempted before MNF is final.
6. Verify on the W2 sheet as a member: each game shows its own lock time; after Thu 6:10 PM MDT the Thu game's row is locked and a Sunday weight can still be changed.

---

## 8. Out of scope (recorded, not forgotten)

- `proxyPick` cannot set a confidence weight (pre-existing). A commissioner
  proxying into a confidence pool sets the team only.
- `extendWeekDeadline` semantics are unchanged: an extension still applies to
  every game in the week (the `weekLockCaption` caveat stands).
- No change to Survivor, Margin, scoring, payouts, or `firestore.rules`.
- No backfill of any existing pool (D1(a)).
