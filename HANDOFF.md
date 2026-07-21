# HANDOFF — Session entry point (updated 2026-07-21: overnight work is in FOUR UNMERGED PRs — read the stop-point box first)

> ## STOP POINT 2026-07-21 (overnight session ended here)
>
> **Everything produced overnight is in OPEN, UNMERGED PRs. `main` does not
> contain it.** If you are a new session reading this file on `main`, the
> sections below are accurate but INCOMPLETE — four PRs are outstanding:
>
> | PR | What | Kind |
> |---|---|---|
> | #231 | `replayFeedSnapshot` — A5 part 2, snapshot replay callable | **code** |
> | #232 | `PLAN-BACKUPS-PHASE3.md` — the zero-backup gap, full runbook | docs |
> | #233 | `SECURITY-CLAIM-SQUARES.md` — open `guestDeviceKey` finding | docs |
> | #234 | `PICKUP-PRESEASON-PILOT.md` refresh + morning order of operations | docs |
>
> **Merge all four before doing anything else**, or you will re-derive work that
> is already done. #232/#233/#234 are documents and change no code.
>
> ### Where work stopped, and why
> It stopped at a real gate, not mid-task. Every remaining item needs Kevin:
> deploy, a GCP console/CLI action, or a decision. Nothing is half-finished and
> no branch is left dirty.
>
> - **#231 is complete and gated on review only.** All five gates green:
>   functions unit **852** (was 845), emulator **98 pass / 10 skipped**,
>   functions build clean, `npx tsc -b` clean, root vitest **257**.
> - **A5 is now finished end to end.** Part 1 stored raw ESPN payloads; nothing
>   could read them back. Part 2 replays a chosen snapshot into `nfl_games`.
> - **Backups: this application has NO BACKUP OF ANY KIND.** No PITR, no
>   scheduled backups, no exports, no Auth export. This is a bigger exposure
>   than anything on the preseason list, because every other risk on that list
>   is recoverable and this one is not. `--enable-pitr` is ONE command and buys
>   a 7-day floor. Two facts discovered while writing #232: **`gcloud` is not
>   installed** on this machine (and the Firebase CLI cannot configure PITR or
>   schedules), and **no region is pinned anywhere in the repo**, so the
>   database location must be READ, not assumed.
> - **`claimMySquares` hole is real** — verified against `firestore.rules`
>   (`pools/{poolId}` is `allow get: if true`; `poolClaims` is `if false`, which
>   is why `claimByCode` is NOT vulnerable). Confirmed **not preseason-blocking**
>   — Squares is not part of the NFL pilot. Deliberately not fixed: the repair
>   spans the reserve path, both claim callables, and a backfill over live pool
>   documents. Recommendation on file: accept through the pilot, fix before the
>   regular season as a supervised single-purpose PR.
>
> ### Kevin's order of operations
> 1. Merge #232, #233, #234. Review and merge #231.
> 2. Deploy the merged queue (#225-#231) — see the deploy section below.
> 3. **Enable PITR** — `PLAN-BACKUPS-PHASE3.md` steps 0-2.
> 4. **A8 pricing — due 2026-08-13.** The only calendar-bound item.
>
> Still open and needing a decision, not code: the `syncNFLScoresJob` 24h
> re-read window (now the top undecided engineering item), NFL-2 (synthetic pick
> probe — recommendation is skip for the pilot), and the `claimMySquares` timing
> call above. Leave `nflLockWatch.dryRun: true` — only 1 of 49 preseason games
> has a betting line, so arming it pages nightly about a known condition.


> ## DEPLOY STATE 2026-07-20 — ⚠️ SUPERSEDED, prod no longer matches `main`
>
> **Do not act on this box for deploy decisions.** It was accurate on
> **2026-07-20 at `5e481c0`**. PRs merged after that date are undeployed, so
> "prod matches `main`" is **no longer true**. The current queue and the deploy
> command live in **`PICKUP-PRESEASON-PILOT.md` §4**; that file wins on deploy
> state whenever it disagrees with this box.
>
> The rest of this box is kept because the *lessons* below it are still valid —
> only the "backlog is cleared" claim has expired.
>
> The long-standing "merged but NOT deployed" backlog was **CLEARED as of
> `5e481c0`**. A
> full-fleet `--only functions` deploy plus `--only firestore:indexes` landed
> everything: the 33 callable-sweep batches, sweep batch 17, the NFL pilot work
> (A2/A3a/A4/A5p1/A6/A10), the spread-gate fix, the importer season filter, and
> both missing composite indexes. A subsequent bare deploy reported *every*
> function "Skipped (No changes detected)" — that is the confirmation.
>
> **Armed in prod, all dry-run:** `nflSpreadLock`, `nflLockWatch`,
> `nflFeedSnapshots` (+ `retentionDays: 45`). `nflFinalize` is
> `enabled:true, dryRun:true` and still needs `liveSeasonTypes` — see NFL-6.
>
> **Prod data:** 49 preseason games (2026 / seasonType 1) imported.
>
> **Smoke test PASSED:** `recalculateGlobalStats` (batch 17 changed it from a
> soft-return to a thrown permission-denied) returns an identical result pre-
> and post-deploy — 35 pools, totalPrizes 5535, 0 errors.
>
> ### THE LESSON FROM 2026-07-19/20 — read before trusting any "armed" claim
> **Two features were armed, deployed, and completely dead, both from missing
> Firestore composite indexes, both silent:**
> 1. **A5 feed snapshots** — `nfl_feed_snapshots(slate, fetchedAt)` was missing;
>    the `catch` that stops a snapshot failure breaking score sync swallowed it
>    on every run.
> 2. **`nflFinalizeSweepJob`** — `pools(type, scoredThroughWeek)` was missing, so
>    its `in`+inequality candidate query threw FAILED_PRECONDITION **every day
>    from 2026-07-10 to 2026-07-20** and produced ZERO audit entries.
>
> Neither was findable by reading code. Both surfaced from asking *"has this
> actually produced anything?"* **Treat "armed" and "working" as separate
> claims.** Any scheduled job should write something on EVERY run so
> "never fired" and "never ran" cannot be confused — `nflLockWatchJob` does this
> by design, and #223 retrofitted it onto the finalize sweep. The other
> schedulers still lack it.
>
> **Deploy hygiene (three silent-success incidents in two days):**
> `--only functions:a,b,c` deploys ONLY `a` — repeat `functions:` per name, or
> use a bare `--only functions`. And ALWAYS `git log --oneline -1` plus confirm
> the change is in the file on disk before deploying; a stale checkout will
> deploy old config and still print "Deploy complete!".

**Start every new session with: "Review HANDOFF.md and pick up where we left off."**
This file + auto-memory carry the full state. Older narrative lives in git history.

---

## 🌅 MORNING TAKEOVER — overnight NFL preseason-pilot run (2026-07-18, ~03:50–05:00)

**Read `TOMORROW-TASKS.md` first — it has TWO halves.** The sweep session's
sections are numbered `1`-`10`; this session's are `NFL-1`-`NFL-8`, below the
divider. In the top half, §1 is done (prod audit, no damage) and §2/§6 are
superseded/done — banners are in place. Everything needing Kevin lives there
with full numbered steps; this section is the engineering state.

### What shipped — all 6 engineering items from `PLAN-NFL-PRESEASON-PILOT.md`

| Item | What | PR | State |
|---|---|---|---|
| **A2** | Kill-switch + dry-run gate on `lockNFLSpreadsJob`, then exported it from index.ts (it had **never been deployed**) | [#205](https://github.com/kstruck/MMPoolsV3/pull/205) `d3dba97` | merged |
| **A4** | New `emulator-tests` CI job — the 45-fixture NFL matrix now gates every PR | [#206](https://github.com/kstruck/MMPoolsV3/pull/206) `7b9e08b` | merged |
| **A3a** | Pre-kickoff spread-lock tripwire (`nflLockWatchJob`) that pages ops via the Phase 2 dispatcher | [#207](https://github.com/kstruck/MMPoolsV3/pull/207) `869911b` | merged |
| **A10** | Finalizer/postponed-game investigation + surfaced the blocked reasons | [#208](https://github.com/kstruck/MMPoolsV3/pull/208) `87c46bd` | merged |
| **A5** (part 1) | ESPN feed snapshots + stat-correction detection | [#209](https://github.com/kstruck/MMPoolsV3/pull/209) `7d842a3` | merged |
| **A6** | `liveSeasonTypes` scope guard so the finalize sweep can be armed **preseason-only** | [#210](https://github.com/kstruck/MMPoolsV3/pull/210) `a1f3569` | merged |
| **NFL-1** | scope `SPREADS_NOT_LOCKED` to spread-consuming pools (follow-up, 2026-07-18 daytime) | [#214](https://github.com/kstruck/MMPoolsV3/pull/214) `8c8e9c5` | merged |

**Baselines moved — re-measured on merged `main` @ `dd93629`, not summed from
PRs**: functions unit **685 → 771** (+86 tests), root vitest **257** (unchanged),
emulator **97 pass / 10 skipped** (unchanged), both typechecks clean. Every PR
ran all five gates before commit, and all five were re-run against merged main.

**qodo**: 16 findings across the run. 12 valid and absorbed, 4 rejected with
written evidence (a `firebase-tools` dependency-placement suggestion that
contradicted the repo's existing root-install pattern, an `: any`-count rule
aimed at pre-existing lines this PR only relocated, and snake_case naming twice —
which does not apply to this camelCase TypeScript codebase).

**Its best catch of the night, worth recording:** A5's snapshot query needed a
Firestore composite index that did not exist, and the `catch` that keeps a
snapshot failure from breaking score sync would have swallowed that error on
every run — the feature would have shipped silently dead, hidden by its own
safety net. Two other real saves: the finalize sweep applied its per-run cap
BEFORE the season-type scope filter (so a preseason-only arm could have
finalized nothing while reporting a full run), and `safeInt()` made "ESPN
dropped the score field" indistinguishable from "the team scored 0", which
would have paged a false `21-17 → 0-0` stat correction.

### Decisions: one resolved, one still open

1. ✅ **RESOLVED — the spread gate blocked pools that do not use spreads.**
   `SPREADS_NOT_LOCKED` ran unconditionally, 30 lines before the pool-type
   dispatch, so it blocked straight-up pick'em (the wizard's only mode — it
   hardcodes `pickMode: 'STRAIGHT'` with no ATS control), plus survivor and
   margin, none of which read a spread. Production was gating pick submission on
   data no production pool consumed; preseason (1 betting line across 49 games)
   merely exposed it. Fixed in **PR #214 (`8c8e9c5`, merged, NOT deployed)** by
   scoping the gate to `nflScoringEngine.poolUsesSpreads`, with the A3 tripwire
   scoped identically so it cannot page about pools that are no longer blocked.
   Zero behavior change for existing pools. qodo reviewed and raised no defects.
2. ⏳ **OPEN — alarm A3(b) (synthetic pick probe) was deliberately not built.**
   Doing it honestly needs a probe identity + probe pool in prod (Kevin's gate);
   doing it in-process would only duplicate A3(a)'s predicate. Recommendation
   and options in TOMORROW-TASKS **NFL-2**.

### Deploy state — NOTHING from tonight is deployed

Five functions change/appear: `lockNFLSpreadsJob` (**new**), `nflLockWatchJob`
(**new**), `syncNFLScoresJob`, `nflFinalizeSweepJob`, `submitNFLPicks` — **plus a Firestore index
deploy** (`firestore.indexes.json` gained a `nfl_feed_snapshots` composite
index; A5's snapshot writes fail silently without it). This queue sits **on top of**
the 33 undeployed callables below. Deploy command + verification steps are
TOMORROW-TASKS **NFL-4**. No frontend change tonight, so no Coolify trigger needed.

**Everything shipped is fail-safe OFF.** Three new config maps
(`nflSpreadLock`, `nflLockWatch`, `nflFeedSnapshots`) do nothing until armed —
console steps in TOMORROW-TASKS **NFL-3**.

### Behavior change worth knowing before you touch `nflFinalize`

A6 made arming **stricter**: setting `dryRun: false` *without* also setting
`liveSeasonTypes` now **keeps the sweep dry** and logs a refusal. There is no
unscoped way to arm the finalizer any more. This changes the long-standing open
loop "flip nflFinalize dryRun to false" — the flip now needs a third field.
See TOMORROW-TASKS **NFL-6**.

### Not built, deliberately (all recorded in TOMORROW-TASKS **NFL-8**)

- **A5 part 2**, the snapshot replay callable — prod-data mutator, wants its own PR.
- **The plan's "approve gate before payouts"** — already satisfied; finalization
  never touches money (`nflFinalize.ts:24-25`). The plan's premise was wrong here.
- **The "recalculated" banner** — frontend, and only meaningful once replay exists.
- **A7 chaos drill** — a runbook for Kevin to execute during a preseason week, not
  code. Written out in TOMORROW-TASKS **NFL-7**.

---

## ✅ SWEEP-LATER worklist CLOSED 2026-07-19 (batch 17, PR #220) — but read the caveat

The 10 callables HANDOFF listed as "actionable remaining" are wrapped. That
closes the SWEEP-LATER worklist **as written**.

⚠️ **It does NOT mean every callable is wrapped.** A grep of `main` still finds
**25 bare `onCall(`** exports: ~16 sim-harness (own `requireAuth`/SUPER_ADMIN
gates, never SWEEP-LATER rows), 3 aiTesting, `createBracketPool` (deliberately
deferred — `...settings` passthrough), plus `getServerTime`, `logClientError`,
`recordPoolPayouts`, `getProfilePoolDetail`, `refreshExpertProfiles`,
`backfillProfileData`, `simulateGameUpdate` (mix of PUBLIC-EXEMPT and rows
wanting re-classification). None is a regression. **Do not quote "the sweep is
complete" without this qualifier** — PR #220's own title overclaims it.

Batch 17 carries ONE deliberate behavior change: `recalculateGlobalStats` now
THROWS permission-denied instead of soft-returning `{success:false}`. Smoke-test
the SuperAdmin stats surface after deploying.

## Prior state: **11 SWEEP-LATER callables remain** (10 actionable + createBracketPool deferred) — batches 1-4 deployed, batches 5-13 + 3 fixes merged to main but UNDEPLOYED

The trust-boundary `validated()` sweep of the parked SWEEP-LATER callables is underway. Kickoff/recipe doc: `PICKUP-CALLABLE-SWEEP.md`; classification authority: `PLAN-SECURITY-OBSERVABILITY-SWEEPS.md`.

> **Count caveat — trust the grep, not the fraction.** The SWEEPS matrix header says 51 SWEEP-LATER rows, but 43 swept + 11 still-unwrapped = 54, so the header or the row classifications are off by ~3. Don't quote an "N/51" fraction. The authoritative check is:
> ```
> grep -rn "export const <name> = " functions/src --include=*.ts
> ```
> — `= onCall(` means unwrapped, `= validated(` means done. The 11 remaining are listed at the bottom of this section.

**Fully swept files:** `bracketEntries.ts` (6/6), `adminClaims.ts` (4/4), `poolOps.ts` (3/3), `nflPools.ts` (3/3 SWEEP-LATER; `calculatePlayoffScores`-style legacy noop N/A here), `billing.ts` (2/2 SWEEP-LATER), `couponTemplates.ts` (2/2 SWEEP-LATER; 3 others already TARGET-NOW), `espnBracket.ts` (5/5), the 4 no-input SUPER_ADMIN callables (`getAdminHealthSnapshot`/`backfillPools`/`refreshExpertPicks`/`syncPlayoffPools`, one each in 4 different files). `bracketPools.ts` at 2/3 (`createBracketPool` deliberately deferred, see below).

| Batch | PR | Callables | Deploy state |
|---|---|---|---|
| 1 | #176 | `createBracketEntry` / `updateBracketEntry` / `deleteBracketEntry` | deployed |
| 2 | #177 | `updateEntryPayment` / `adminUpdateEntryOverrides` / `adminDeleteEntry` (admin two upgraded claim-only → C5 claim+doc) | deployed |
| 3 | #179 | `publishBracketPool` / `joinBracketPool` | deployed |
| 4 | #180 | `syncMyClaims` / `backfillUserRoles` (+ null-input fix) | deployed |
| 5 | #183 | `poolOps.ts`: `recalculatePoolWinners` / `toggleWinnerPaid` / `fixParticipantIds` | **merged, NOT deployed** |
| 6 | #184 | `nflPools.ts`: `joinNFLPool` / `executeSurvivorRebuy` / `scoreNFLWeek` | **merged, NOT deployed** |
| 7 | #185 | `billing.ts`: `validateBillingAccess` / `getPoolQuote` | **merged, NOT deployed** |
| 8 | #186 | no-input quartet: `getAdminHealthSnapshot` / `backfillPools` / `refreshExpertPicks` / `syncPlayoffPools` | **merged, NOT deployed** |
| 9 | #187 | `couponTemplates.ts`: `deleteCouponTemplate` / `acknowledgeMonetizationAlert` | **merged, NOT deployed** |
| 10 | #188 | `espnBracket.ts`: `importTournamentFromESPN` / `adminInitTournament` / `syncBracketTournament` / `importConferenceTournamentFromESPN` / `syncPlayInPicks` (closes a C5 auth-fallback finding for all 5) | **merged, NOT deployed** |
| 11 | #191 | `bracketScoring.ts`: `scoreBracketEntries` / `finalizeTournamentPayouts` (both claim-only → C5 claim+doc) | **merged, NOT deployed** |
| 12 | #192 | `conferenceTournaments.ts`: `initializeBigEastTournamentHttp` / `initializeBig12TournamentHttp` (both were **doc-only** role checks — last two in the fleet) | **merged, NOT deployed** |
| 13 | #194 | `squares.ts`: `updatePlayer` / `releaseSquares` | **merged, NOT deployed** |
| — | #190 | `backfillPools` dry-run gate (defaults true, `plannedWrites` report, FE dry/live button pair) | **merged, NOT deployed** |
| — | #193 | `backfillPools` status-clobber fix + per-entry fold marker | **merged, NOT deployed** |
| — | #195 | squares lookup-key `.trim()` regression fix (follow-up to #194) | **merged, NOT deployed** |
| 14 | #197 | `propBets.ts`: `gradeProp` / `updatePropCard` | **merged, NOT deployed** |
| 15 | #199 | `referral.ts`: `generateReferralToken` / `resolveReferralToken` (public) | **merged, NOT deployed** |
| 16 | #200 | admin singles: `lockPool` / `logAdminAction` / `recomputeConsensus` / `recomputeRevenue` | **merged, NOT deployed** |

Batches 1-4 deployed 2026-07-17/18 (see prior narrative below). **Batches 5-13 plus the three fix PRs (2026-07-18) are merged to `main` but explicitly NOT deployed** — deploy is Kevin's gate per `mmp-change-control`; nothing has run `firebase deploy`. Before deploying, verify every merge landed (`git log origin/main --oneline -20`), then follow the functions-first ritual:

> ⚠️ **`functions:` MUST be repeated before EVERY name.** `--only functions:a,b,c`
> deploys **only `a`** — firebase-tools splits on `,` and silently discards any
> segment that does not start with `functions:` (`functionsDeployHelper.js`,
> `getEndpointFilters`). It then prints `✔ Deploy complete!`, so the failure is
> invisible. This bit us for real on 2026-07-18: a 33-name deploy shipped 1
> function and reported success.

```
npm --prefix functions install
npx firebase deploy --only functions:recalculatePoolWinners,functions:toggleWinnerPaid,functions:fixParticipantIds,functions:joinNFLPool,functions:executeSurvivorRebuy,functions:scoreNFLWeek,functions:validateBillingAccess,functions:getPoolQuote,functions:getAdminHealthSnapshot,functions:backfillPools,functions:refreshExpertPicks,functions:syncPlayoffPools,functions:deleteCouponTemplate,functions:acknowledgeMonetizationAlert,functions:importTournamentFromESPN,functions:adminInitTournament,functions:syncBracketTournament,functions:importConferenceTournamentFromESPN,functions:syncPlayInPicks,functions:scoreBracketEntries,functions:finalizeTournamentPayouts,functions:initializeBigEastTournamentHttp,functions:initializeBig12TournamentHttp,functions:updatePlayer,functions:releaseSquares,functions:gradeProp,functions:updatePropCard,functions:generateReferralToken,functions:resolveReferralToken,functions:lockPool,functions:logAdminAction,functions:recomputeConsensus,functions:recomputeRevenue --project gridiron-gamble-uzuqo
```

**The frontend also has undeployed changes** (`OperationsPanel.tsx` gained a "Backfill Pools (dry run)" button in #190) — that needs the manual Coolify trigger, which does NOT happen on push to `main`.

### ⚠️ `backfillPools` behavior change — read before running it
PR #190 changed `backfillPools` to **default to dry-run**. The existing "Backfill Pools" button now sends `dryRun: false` explicitly, so it still writes — but any *other* caller that omits the flag now reports instead of writing. PR #193 then fixed two real defects in it:
- It used to reset **COMPLETED pools to DRAFT** (it recomputed `status` from `isLocked`/`isFinal`, ignoring the existing value). If this backfill has ever been run against prod, **finished pools may already have been un-completed** — worth an audit query before running it again.
- The historical-stats fold (`FieldValue.increment` on `users/{uid}.historicalStats`) is now guarded per-entry so it can't double-count. **Limitation:** entries folded by a run predating that marker carry none and would fold again. Dry-run first and read `plannedWrites`.

### ✅ PROD backfillPools damage audit — RAN 2026-07-18, NO DAMAGE FOUND

Read-only Firestore queries against prod (Firebase console; nothing written).
The pre-#193 bug wrote `status = isLocked ? 'LOCKED' : (isFinal ? 'FINAL' : 'DRAFT')`.
The load-bearing claim is narrow and was re-verified after review: **`backfill.ts:55` is
the only production path that WRITES a pool `status: 'FINAL'`** — so that stored value is
a fingerprint for the bug. (It is NOT true that every other `'FINAL'` is an nfl_games
status: `'FINAL'` is in the pool status type unions and is read at `payoutRecords.ts:60`.
Nor are `'LOCKED'`/`'OPEN'` the only other writes — the create paths write `'DRAFT'`,
which is why the 28 DRAFT pools need no special explanation.)

`status=='FINAL'` → **0 pools**. `DRAFT`∩`isFinal:true` → **0**. `LOCKED`∩`isFinal:true` → **0**.
Positive control `status=='OPEN'` → 15 ✓. Verdict: the clobber never hit prod; the 28
DRAFT pools carry no finished-pool signals. PR #193 still ships as prevention, but there
is **no remediation task and no pool IDs to repair**. Detail in TOMORROW-TASKS §1.

⚠️ **Console-audit gotcha learned the hard way:** the Firestore filter panel reopens
COLLAPSED, so edits to the value box silently don't register and the PREVIOUS query
re-runs looking like a new one. Three readings were bogus before a positive control
caught it. Always verify the `.where(...)` preview string before Apply, and always
include a control query that must return rows.

### Backfill / migration audit (2026-07-18, report only — no fixes applied)

Ran after the `backfillPools` defects, to check whether the same two bug classes appear in sibling
batch operations. **Both classes turned out to be unique to `backfillPools`.** Nothing else needs fixing;
recorded so this isn't re-derived.

*Class A — deriving a field from inputs that cannot express all its states, ignoring the stored value.*
`grep -rn "isLocked ?.*'LOCKED'\|isFinal ?.*'FINAL'"` over `functions/src` + `src` returns exactly one
write site: `backfill.ts:55` (now guarded by `if (!pool.status)`). Every other hit is display-only JSX.

*Class B — non-idempotent `FieldValue.increment` in a re-runnable batch op.* Ten files use `increment`.
Classified:
- `backfill.ts` — was the only re-runnable batch offender; now guarded per entry (#193).
- `statsTrigger.ts` `recalculateGlobalStats` — **safe**: recomputes and writes ABSOLUTE totals (`set`, not
  increment), so re-running is idempotent by construction. This is the pattern the other backfills should
  copy.
- `bracketEntries.ts` / `bracketPools.ts` / `participant.ts` / `propBets.ts` / `billing.ts` — per-user-action
  counters (`entryCount` etc.), one increment per real event, not batch ops.
- `stripe.ts` — webhook path, already de-duped by event id (PR #166 durability work).

*One genuine pre-existing risk found, NOT fixed (needs a decision):* `statsTrigger.ts`'s
`onDocumentUpdated` trigger increments `stats/global.totalPrizes` / `.totalDonated` on the
`!before.isLocked && after.isLocked` edge. Cloud Functions triggers are **at-least-once**, so a duplicate
delivery of the same event re-runs the guard with identical before/after and increments twice. Low
probability, silent when it happens, and self-correcting only if someone runs `recalculateGlobalStats`
(which overwrites with absolute values). Options if it ever matters: stamp the pool with a
`statsFoldedAt` marker and check it in the trigger, or rely on periodic `recalculateGlobalStats` as the
reconciler. Not urgent — flagged so it's on record.

**Verify-before-strict lessons banked** (all now encoded in the PICKUP recipe):
1. `createBracketEntry` accepts a handler-*ignored* `tiebreakerScore` — must stay accepted or real calls break.
2. `updateEntryPayment`'s `paidAt`/`paymentNote` use explicit `null` to CLEAR the field → schema uses `.nullable()` NOT `nullish()` (nullish maps null→undefined and silently kills the clear feature). A test pins null-preservation.
3. **No-input callables must `z.preprocess((v) => v ?? {}, z.strictObject({}))`** — a no-arg `httpsCallable(fn)()` delivers `request.data` as `null`, which a bare strict object rejects. Shipped as a real bug in batch 4 (`syncMyClaims`), caught in review, fixed in #180. Batch 8 (#186) promoted this to a shared `noInputSchema` helper in `lib/zodHelpers.ts` (5th occurrence) and used it for all 4 remaining no-input callables — that gotcha is now fully closed across the fleet.
4. **A prod batch-mutation callable's `dryRun` flag must fail SAFE (default true) at the SCHEMA layer, not the handler.** qodo caught this on PR #183: `fixParticipantIds`'s pre-existing handler logic (`dryRunInput === true`) silently ran LIVE when the flag was omitted — contradicted the schema's own "default true" doc comment and the repo's dry-run-by-default convention (PRs #127/#129/#180). Fixed with `z.boolean().optional().default(true)` at the schema layer instead of a handler-side truthy check. Check any other dryRun-flag callable you retrofit for the same footgun. (`backfillPools` had NO dry-run at all — since fixed in #190, which also uncovered two real defects in it; see the warning box above.)
5. **Shared cross-boundary schemas (anything under `shared/schemas/`, generated into `functions/src/shared/`) are OUT OF SCOPE for `.strict()`-ifying** even when a SWEEP-LATER row uses one — `getPoolQuote`'s `poolQuoteInputSchema` was deliberately left non-strict (batch 7, PR #185): it's consumed by both the callable and the checkout flow, and the matrix documents its current shape as intentional. Move the auth+parse gate onto `validated()` using the existing schema as-is; don't tighten a shared contract on a drive-by.
6. **The C5 finding (some admin callables read a spoofable Firestore `users/{uid}.role` as a fallback when the JWT claim is absent) resolves for free** when you retrofit with `validated()`'s `role:` option — it calls `assertCallerRole`, which requires claim AND doc to agree, not claim-OR-doc. Batch 10 (#188, `espnBracket.ts`) closed 5 instances in one pass; batch 12 (#192, `conferenceTournaments.ts`) closed the last two, which were **doc-only** (weaker still — the JWT claim was never consulted at all). **No admin callable in the fleet now authorizes off a Firestore doc alone.**
7. **NEVER `.trim()` a string the handler uses as a LOOKUP KEY.** Regression shipped in batch 13 (#194), caught by qodo, fixed in #195. `updatePlayer.originalName` / `releaseSquares.ownerName` are matched with `===` against the stored `squares[].owner`; `reserveSquare` stores names untrimmed, so `" Alice "` is reachable. Trimming at the boundary made that player un-editable and silently un-releasable (released nothing, still returned success). Rule: `.trim()` is safe on server-generated identifiers (`poolId`, `tournamentId`), never on user-supplied strings used to match stored data. Normalizing at a trust boundary is only correct if the stored side was normalized identically.
8. **Some optional fields are load-bearing — omission can be a MEANING, not a mistake.** `scoreBracketEntries`'s `tournamentId` is optional because omitting it is the *global* form (score every pool-linked tournament), which is exactly what the OperationsPanel button does. A required schema would have broken it. Check what a *missing* field does in the handler before making it required.
9. **A callable can have more than one caller sending different shapes.** Batch 12's two callables are hit by OperationsPanel (`{}`) *and* TournamentManager (five fields, three of which those handlers ignore). Grep every call site, not the first one.
10. **An idempotency marker must be written in the SAME batch as the write it guards.** qodo caught this on #193: a per-pool marker written after the entry loop is not safe, because a pool with >400 entries flushes mid-loop and can commit increments before the marker exists. Marker moved per-entry, staged alongside its own increment, with the flush check after both — batch commits are atomic, so an applied increment can never be unmarked.
7. **A handler that soft-returns `{success:false, message}` instead of throwing on missing input** can still get a `.strict()`+required-field schema — just verify the FE always sends those fields (never omits them) and already wraps the call in try/catch, so a thrown `invalid-argument` surfaces the same way to the user as the old soft-return did. Two espnBracket.ts callables hit this in batch 10; both verified safe via the FE call site before tightening.

**Next on the fleet — 10 actionable remaining, grep-verified as still `= onCall(`:**

`markEntryPaidStatus` (bracketOps.ts), `calculatePlayoffScores` (playoffPools.ts, legacy noop),
`backfillMemberRecords` (migrations/), `importNFLSchedule` (nflSchedule.ts), `searchUsersByEmail`
(userManagement.ts — declared `functions.https.onCall`, a bare `grep onCall(` misses it),
`recomputeMyProfile` (userProfile.ts), `fixPoolScores` (scoreUpdates.ts), `syncAllUsers`
(userSync.ts), `recalculateGlobalStats` (statsTrigger.ts), `claimMySquares` (participant.ts).

Two carry a wrinkle worth knowing BEFORE you wrap them:

- `recalculateGlobalStats` — its SUPER_ADMIN check **`return`s a `{success:false}` object instead of
  throwing**, deliberately (a comment says it avoids CORS masking the message). `validated()`'s `role:`
  gate THROWS `permission-denied`. Wrapping it therefore changes the failure contract for that endpoint;
  check the SuperAdmin caller handles a thrown error before flipping it.
- `syncAllUsers` — **the matrix note claiming it has no role gate is STALE.** It already calls
  `assertCallerRole(request, "SUPER_ADMIN")` (the C4 sweep fixed it). Wrapping is a straight
  like-for-like; the in-handler call becomes redundant and can go.

Same recipe, runnable unattended.

### 🔴 Security finding: `claimMySquares` treats a readable field as a bearer secret (NOT fixed)

Found while triaging the remaining rows. **Not a schema problem — wrapping it in `validated()` will not
fix it, so it was left alone.**

`claimMySquares` (participant.ts) claims squares by matching a client-supplied `guestDeviceKey` against
`squares[].guestDeviceKey`. Knowing the key IS the proof of ownership. But `reserveSquare` stores that key
**on the square inside the pool document**, and `firestore.rules` has `allow get: if true` for
`/pools/{poolId}` — so anyone with a pool id can read every guest square's device key.

Net effect: any authenticated user who can read a pool can claim that pool's **unclaimed** guest squares
to their own uid. Partly mitigated — the handler refuses to take a square already bound to a different
`reservedByUid`, so registered owners can't be robbed; the exposure is guest-reserved squares that the
guest has not claimed yet (i.e. someone who paid but hasn't made an account).

Fixing it needs a data-model or rules change (move `guestDeviceKey` out of the public pool doc, or require
a different proof), not a drive-by — and firestore.rules write/read-path changes are a separate parked
effort per PICKUP's hard don'ts. Flagged for a decision.

**Deliberately deferred:** `createBracketPool` (SWEEPS row 7) — rich nested `settings` with a `...settings` passthrough spread that stores arbitrary client fields; a flat `.strict()` would reject data it currently persists. Needs a passthrough envelope or client cutover, same treatment as the ADR-0001 PERMISSIVE creates. Its own careful batch, not a drive-by.

Baselines measured on merged `main` at 0a7b9b6 (2026-07-18): root vitest **257** (unchanged all session), functions unit **685**, emulator **97 pass / 10 skipped**, frontend `tsc -b` clean. Counts rise with every batch — re-measure, don't trust a stale number.

---

## Phase 2 observability (#8–14) — SHIPPED, merged, deployed, prod-verified

PR [#171](https://github.com/kstruck/MMPoolsV3/pull/171) (all 7 plan items — Sentry FE spine, correlation id, business-failure→Sentry wiring, ops alert dispatcher, readiness endpoint, in-app Ops Health card, SLOs) merged `7b2a522`, functions + frontend deployed, qodo's 4 findings fixed pre-merge. **One post-deploy bug found+fixed**: `readiness` was configured at 128MiB and OOM'd at cold start (Admin SDK + Node 22 alone use ~131MiB) — Kevin's live GCP Uptime Check test caught it as a 503, fixed in a same-day follow-up PR #173 (bumped to 256MiB, merged, redeployed) — Uptime Check now green. Firestore `system/config.opsAlerts` populated (Kevin). Sentry confirmed live in prod (`window.__SENTRY__` present, real DSN baked into the bundle, verified via direct browser check against `marchmeleepools.com`).

**Not done (optional, not urgent):**
- GCP Cloud Monitoring SLO objects + burn-rate alerting policies (uptime check alone is done; the other 3 SLOs — checkout success, webhook error rate, latency p95 — still need console setup). Target numbers in `PLAN-SECURITY-OBSERVABILITY.md`'s Phase 2 SLO section.
- Cosmetic: the Sentry lazy-load (dynamic `import('@sentry/react')` in `src/sentry.ts`) didn't actually get code-split into its own chunk by Vite's bundler in the prod build — it got merged into the main bundle. Functionally harmless (Sentry works), just didn't achieve the "defer off initial load" perf intent. Kevin said fix "when it makes sense" — not urgent.
- `SENTRY_DSN` functions secret (optional — activates backend Sentry events for Stripe webhook failures; Firestore alerts + ops email/SMS already work without it).

Below this: prior narrative (sim harness — still COMPLETE, deployed, prod-verified; unrelated to Phase 2).

**NFL Sim Harness (PLAN-NFL-SIM-HARNESS.md) — ALL PHASES SHIPPED.**
Core (0/1/2/3/4-core/6) 2026-07-10 via PR #156 + qodo PRs #157-159. **Phase 4
(matrix, items 25-27) + Phase 5 (legacy migration + rules-backdoor removal, items
28-30) shipped 2026-07-11 via PRs #161/#162**, expectations human-verified
(PHASE4-EXPECTATIONS.md, signed-margin rule confirmed), qodo cycle absorbed (3
findings: 4 surviving raw entry writes migrated onto new `updateEntryPayment`/
`adminUpdateEntryOverrides`/`adminDeleteEntry` callables; slug fix; audit-comment
honesty). Functions (7 new) + **firestore.rules (both backdoors DROPPED)** +
Coolify deployed 2026-07-11 evening, functions-first. **Prod smoke: 45/45 NFL
scenarios + squares/playoff/props/bracket-E2E + Tournament Simulator + Fill Grid
all green through the migrated guarded-callable path.** 45-fixture matrix runs in
emulator CI; `simRuns` manifests carry per-assertion run history (`simReportRun`).
No client can raw-create pool docs or raw-write entries anymore — including
SUPER_ADMIN sessions.

## ⚡ Kevin's pending 5-minute item

**Arm the finalize sweep** (safe — deployed stack has all guards):
1. Firestore console → `system` collection → `config` doc.
2. Add field `nflFinalize`, type **map**, containing `enabled` (boolean) = `true` and
   `dryRun` (boolean) = `true`.
3. Sweep runs daily 08:30, REPORTS ONLY while dryRun. After 1-2 days check
   SuperAdmin → Admin Audit Log for `NFL_FINALIZE_SWEEP` entries; when candidate
   lists look sane, ask Claude for the flip-to-live step.

## Phase 2 observability — CLOSED 2026-07-17

PR #171 merged+deployed, PR #173 (readiness OOM fix) merged+deployed, Firestore
`opsAlerts` populated, GCP Uptime Check green, Sentry confirmed live in prod.
Remaining optional items (SLO objects, cosmetic chunk-splitting) listed in the
"Current state" section above — not blocking, not time-sensitive.

## Next-effort menu (pick one to start a session)

1. **Security/Observability plan — Phase 1 COMPLETE (callables + webhook durability) and DEPLOYED.**
   Webhook durability (PR #166, merge 6c87891, deployed 2026-07-17): handleStripeWebhook
   no longer deletes failure state — a failed event flips to status:"failed" + attemptCount,
   de-dupes on Stripe's retry, and alerts ops once (=== threshold) via monetization_alerts/
   WEBHOOK_FAILED_<id>; claimEvent() re-claims failed docs (set/merge, safe on raced delete);
   added handlers for checkout.session.async_payment_failed + payment_intent.payment_failed
   (were falling through the silent default). Pure decideEventClaim/shouldAlertOnFailure in
   lib/webhookDurability.ts, 9 unit tests. qodo: 3 findings (2 fixed, 1 rejected w/ evidence).
   NOTE (deploy gotcha, 2026-07-17): a first merge attempt silently didn't take — git pull
   said "Already up to date" and deploy skipped every function as "No changes detected"
   because main never advanced. ALWAYS verify `gh pr view <N> --json state` == MERGED and
   `git log origin/main` shows the merge commit BEFORE trusting a deploy; a no-op skip on a
   change you expect to ship means the merge/pull didn't land.
   CLOSED SECURITY ITEM: npm critical websocket-driver<=0.7.4 (GHSA-mp7j-qc5w-4988 +
   GHSA-xv26-6w52-cph6) — fixed PR #170 (merge c95edb4, 2026-07-17). Transitive via
   firebase-admin AND the root firebase client SDK → @firebase/database → faye-websocket.
   Added "websocket-driver":">=0.7.5" to the overrides block in BOTH package.json (root +
   functions) — the CI security-audit runs `npm audit --audit-level=high` at ROOT, so a
   functions-only fix left it red (qodo + CI both caught this). App is Firestore-only so the
   WS path never loads; low real risk, but it's a critical + blocked CI. Lockfiles regen'd
   --package-lock-only (only websocket-driver moved). NOT merged as a functions deploy — the
   change is a lockfile-only bump of an unused transitive; rides with the next functions deploy.
   REMAINING (low-pri backlog): 2 moderate npm advisories below the high gate —
   @opentelemetry/core (via @google-cloud/pubsub→firebase-tools, DEV) and morgan (log-forging).
   Neither blocks CI. firebase-admin pinned ^12.7.0 (latest 14.2.0) — a future major-bump task
   would clear these + the whole transitive chain naturally.

   Prior wave (callables): 
   Wave 1: PR #164 (16 callables, deployed 2026-07-11 night). Wave 2: PR #165
   (remaining 25, merged f4df975 + functions deployed by Kevin 2026-07-12 late
   night; functions:list + post-deploy log sweep clean — zero invalid-argument
   or Invalid-request rejections). Every TARGET-NOW callable now runs through
   validated() (App Check monitor → auth → role claim+doc → strict zod);
   schemas in functions/src/schemas/* with unit tests pinning real client
   payloads. qodo lifetime on this plan: 3 findings, 3 VALID, all absorbed.
   Baselines now: functions unit 545, root vitest 244, emulator 84+10 skipped.
   Note: root tests mock onCall in tests/mocks/firebase-functions-v2-https.ts
   — it now supports the two-arg onCall(options, handler) form validated()
   uses, and onboarding-flow assertions pin the NEW gate error messages.
   Phase 2 (observability, #8-14) is now SHIPPED+DEPLOYED — see "Current
   state" at the top of this file, PR #171 + #173.
   Remaining Phase-1-adjacent follow-ups (pick one): (a) App Check
   monitor→enforce flips per endpoint (PLAN #5) after a
   coverage-measurement window; (b) firestore.rules write-path sweep (the
   pools allow-update isSuperAdmin() rule + playoff/props raw writes
   deliberately parked for it); (c) SWEEP-LATER callable fleet (63, includes
   the correlation-id sweep's ~13 remaining direct-httpsCallable files);
   (d) tighten the two PERMISSIVE create envelopes (ADR-0001); (e) Phase 3
   (backups #15-19).
   Note from Phase 5: the general pools `allow update: isSuperAdmin()` rule + playoff/props
   pool-doc/propCards raw writes were deliberately left for THIS plan's write-path sweep.
2. **Player Profiles follow-ups** — flip `profileBackfill`/`nflFinalize` dry-runs after
   reports look right; Achievements engine requirements (Kevin gathering); Expert Picks
   UI surface (`nfl_games/{id}.expertPredictions` is ingesting, nothing displays it yet).
3. **Small follow-ups parked from Phase 4/5:** settingsMatrix test uses wrong key
   `autoSurviveExemption` (engine reads `autoSurviveExemptionEnabled`; inert, 1-line);
   `profileField` assertion implemented but unwired (needs a `simRecomputeProfile`
   callable if a browser golden ever wants profile asserts); optional margin/survivor
   "season teams strip" UI (all 32 teams, used ones crossed out — pick sheets already
   gray out used teams per game).

## Key documents

| Doc | What |
|---|---|
| `HANDOFF.md` | THIS FILE — session entry point |
| `PLAN-NFL-SIM-HARNESS.md` + `-REVIEW-LOG.md` | Locked harness plan + Codex trail |
| `TAKEOVER-NFL-SIM-HARNESS.md` | Overnight-build narrative + deploy runbook (historical) |
| `PLAN-SECURITY-OBSERVABILITY.md` + `-SWEEPS.md` + `-REVIEW-LOG.md` | Security/observability plan — Phase 1 + Phase 2 both shipped+deployed (PR #171, #173); Phase 3 not started |
| `PROMPT-GRILL-PLAYER-PROFILES.md` | Consumed — profiles shipped via PR #153 |
| `CONTEXT.md` | Glossary (Sim Run, Test Pool, Scenario, Golden Scenario, Scenario Oracle, …) |
| `docs/adr/0006-*.md` | Real-path fidelity via extracted internals |

## Environment / deploy facts (unchanged)

- Deploy: `npm --prefix functions install` first, then `npx firebase deploy --only functions:… --project gridiron-gamble-uzuqo`. Functions before rules. Frontend = Coolify — **manual trigger only**, pushing to `main` does NOT auto-deploy it (corrects a stale claim that lived here; matches CLAUDE.md + the mmp-deploy-and-operate skill).
- Emulator tests need Java on PATH: `JAVA_HOME=/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot`; run `npm --prefix functions run test:emulator`. Unit: `npm --prefix functions test` (410 tests; emulator suite 39).
- qodo.ai reviews PRs (14-day trial from 2026-07-10). Its findings have been 6/6 valid but severity is converging — validate before auto-fixing.
- Untracked strays at root: `PLAN-LOOPS.md`, `PLAN-SECURITY-OBSERVABILITY*.md` (copies of branch-committed files). Harmless; don't commit blindly.

## Do NOT re-do

Plans are locked + adversarially reviewed (Codex ×4 for the harness; ×5 for profiles/security). Don't re-grill. Don't author Phase-4 edge fixtures without Kevin verifying expectations. Don't arm `nflFinalize.dryRun:false` without dry-run reports. The `sim-` rules backdoors stay until Phase 5 (supervised).
