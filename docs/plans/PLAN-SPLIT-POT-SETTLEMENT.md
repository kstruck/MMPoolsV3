# PLAN — Survivor split-pot settlement, Current Picks "W-L / Max" columns, Pick Distribution visibility setting

> **STATUS: §6 APPROVED AS RECOMMENDED (Kevin, 2026-10-08: "approve as recommended, start PR-A"). Plan review log + sweeps in progress before PR-A code.**
>
> Three asks from Kevin on 2026-10-08, one plan so he can approve them together.
> They ship as THREE separate PRs (CLAUDE.md §2d: one PR at a time).
>
> | Part | Ask | Classification (`mmp-change-control` §1) |
> |---|---|---|
> | **A** | Close out an active Survivor pool after the remaining players agree to split the pot | **PLAN-GATED** — money (records who the pot goes to), production data (flips a live pool to COMPLETED), scoring-adjacent (runs the season finalizer early). Needs this plan → review log → sweeps → Kevin's sign-off → code. |
> | **B** | New column(s) on the Current Picks grid: picks right/wrong so far and the points still winnable | Ordinary — display only, no new read, no new write. |
> | **C** | Commissioner setting: Pick Distribution card off, or shown only once the week locks | Ordinary — one new settings key, display only. |
>
> **Provenance (Kevin, 2026-10-08, lightly condensed):** *"During the NFL season a Survivor pool might come down to the last remaining players deciding to split the pot. If they all agree, the pot is split and the pool is over. I need a way to close out an active pool after the players decide to split. This just happened in pool EJSGHCqc8Q8uv8godJKF — the two remaining players split the pot. / Add a column to the Current Picks page (example ubHD4bgszL05oURYubrn?tab=grid) showing the remaining points available to each player based on picks right and wrong and how many points they could still win from games not completed. / The Pick Distribution card on each pool home page — the commissioner should be able to turn it off or only show it once the pool locks for the week. Option in Commissioner Settings."*
>
> Measured on branch `claude/survivor-pool-features-plan-c4213f` @ `cc8a7a41` (= `origin/main` at write time). Live-pool facts in §1.0 were read from production with the read-only census key (no writes).

---

## 0. The one-paragraph version

**A.** A new owner-only callable `settlePool` ends a Survivor pool early with the ALIVE entries as co-champions. It reuses the existing season finalizer (`maybeFinalizeNFLPool`) with a `force` flag so season history, player profiles, Season Places, the frozen season prize and the commissioner's payout ledger all come out exactly as they would at a natural end of season — then flips the pool to COMPLETED with `closedVia: 'SETTLED'`, writes a `settlement` record, audits it, and (optionally) emails every member. A "End the pool — split the pot" panel on the Manager tab drives it. Separately, `submitNFLPicks` gains the terminal-pool refusal it is missing today.

**B.** The Pick'em Current Picks grid gets two columns after Week Pts: **W-L** (graded picks so far this week) and **Max** (points earned so far + the most still winnable from games not yet final). Computed client-side from data the grid already has; "?" wherever the reveal boundary makes the answer unknowable.

**C.** `settings.pickDistribution: 'ALWAYS' | 'AFTER_LOCK' | 'OFF'` (absent = `ALWAYS`, today's behaviour). A three-way control in Commissioner Settings. `AFTER_LOCK` hides each game's split until that game has locked. The grid's Majority row follows the same rule.

---

## 1. What is true today — measured, not remembered

### 1.0 The live pool Kevin named (read-only, 2026-10-08)

| Field | `pools/EJSGHCqc8Q8uv8godJKF` |
|---|---|
| name / type | "2026 MarchMelee Multi-Entry Survivor Pool" / `NFL_SURVIVOR` |
| status / isLocked / closedVia / finalizedAt | `OPEN` / `false` / absent / `null` |
| season / seasonType / scoredWeeks | 2026 / 2 / weeks 1–4 scored |
| entries (docs) | **8**, of which **2 `ALIVE`** (both PAID), 6 `ELIMINATED` |
| `entryCount` on the pool doc | **11** — does not match the 8 entry docs (see D6; rebuys are a plausible explanation, not a verified one) |
| settings.entryFee / payouts | $25 / one place (`places: [{…}]`) |
| settings.maxStrikes | 0 (sudden death) |

So: the pool is live to every reader, the scorer still visits it every five minutes, and nothing anywhere records that the two survivors agreed to split.

### 1.1 Closing a pool today

| Fact | Where |
|---|---|
| `closePool` callable exists: owner / `managerUid` / SUPER_ADMIN, refuses co-commissioners (`assertPoolOwnerOrManagerNoCo`), refuses terminal pools | `functions/src/poolExceptions.ts:619-657` |
| It writes `adminCloseUpdate`: `status: COMPLETED, isLocked: true, isFinal: true, scores.gameStatus: 'post', closedVia: 'ADMIN_CLOSE', closedAt` | `functions/src/lib/lifecycle.ts:53-62` |
| `closedVia: 'ADMIN_CLOSE'` is **by design stats-free and email-free**: statsTrigger skips it (`statsTrigger.ts:375`), the client labels it `closed` not `final` (`src/utils/poolSport.ts:355`) | design comment at `poolExceptions.ts:611-618` |
| The only UI that calls it is **Super-Admin** (`SuperAdmin.tsx:697`). A commissioner has no close control — only Cancel (`NFLManagerView.tsx:1098`, emails everyone, voids the pool) | measured |
| The season finalizer `maybeFinalizeNFLPool` refuses to run unless **every game of the season is final** (`isSeasonComplete`) and refuses voided pools (`isVoidedPool` = CANCELED / COMPLETED / ARCHIVED) | `functions/src/nflFinalize.ts:340-360` |
| When it does run it writes, per entry, `users/{uid}/seasonHistory/{docId}` (`finalRank`, `isChampion: rank === 1`), then on the pool `finalizedAt`, `firstFinalizedAt`, `seasonPlaces[]` and the frozen `seasonPrize` snapshot, then refreshes each member's profile | `nflFinalize.ts:362-440` |
| **Survivor ranking already does what a split needs**: every `ALIVE` entry gets rank 1 (co-champions); eliminated entries rank by `eliminatedWeek` desc, strikes asc | `computeFinalRanks`, `nflFinalize.ts:186-230` |
| Tied places **share the prize**: `priceSeasonPlaces` → `splitPrizes` divides a place's money across every entry on that rank | `shared/seasonPrizes.ts:95-106` |
| `seasonPlaces` is read by **My Prizes** (`src/components/MyPrizes.tsx`) and the commissioner **payout ledger** (`PaymentLedgerNFL.tsx`) — both already know how to show a split prize | measured |
| The scorer skips retired pools (`isRetiredPool`: FINAL / CANCELED / COMPLETED / ARCHIVED) and `scoreWeekPass` refuses a voided pool inside its lease | `lib/autoScoreDecisions.ts:68-75`, `nflPools.ts:1771` |
| 🛑 **`submitNFLPicks` has NO terminal-status gate.** Its only refusals are the week locks (`WEEK_LOCKED` at `nflPools.ts:950,1156,1235`). A member of a COMPLETED pool whose week is still open can save a pick server-side today; only the client hides the sheet. | measured by grep — no `status`, `isVoidedPool` or `isRetiredPool` read in the submit path |

### 1.2 The Current Picks grid

| Fact | Where |
|---|---|
| `NFLPicksGrid` is **Pick'em only**; Survivor/Margin get `NFLWeeklyPicksGrid` (weeks across, deliberately no result colour) | `NFLPoolDashboard.tsx:1373-1400`, both component headers |
| Columns today: Player, **Set** (server `counts[row.id]`), **Week Pts** (`gridWeekValue` — the scorer's published number, `—` until scored), one column per game | `NFLPicksGrid.tsx:200-215` |
| Every game cell is `picksGridCell` → `HIDDEN` ("?"), `NO_PICK` ("—") or `PICK` with `result: 'W' \| 'L' \| 'PUSH' \| 'VOID' \| null` and, in confidence mode, the weight | `src/utils/picksGrid.ts`, `src/utils/pickemResult.ts` (client mirror of the engine's grading, pinned by `tests/pickem-result-parity.test.ts`) |
| The reveal (`PoolPicksReveal`) carries `mode: 'WEEK' \| 'PER_GAME'`, `revealedGameIds`, per-row `counts`, and pick/confidence content **only for revealed games** | `src/services/dbService.ts:158-181` |
| The viewer's OWN row is sourced from their entry doc and is always fully known once `ownEntryLoaded` | `NFLPicksGrid.tsx:60-75` |
| Confidence pools reveal the whole week at once (`WEEK`); standard pools in PER_GAME lock reveal game by game at each kickoff | caption logic `NFLPicksGrid.tsx:120-127`, `functions/src/lib/pickReveal.ts` |

What that means for "points still winnable":

* Own row: exact, always.
* Another row, `PER_GAME` reveal, standard scoring: a game not yet revealed has not kicked off, so it is undecided. The row's unrevealed-pick count is `Set − (revealed picks)`, each worth 1 point. **Exact.**
* Another row, `WEEK` reveal (every confidence pool): before the deadline nothing is revealed and the weights are unknown → **"?"**; after it everything is revealed → exact.
* A game in progress is revealed and undecided: its pick counts toward Max at its weight.
* `PUSH` / `VOID` earn nothing and are nobody's mistake — excluded from W-L, excluded from Max.

### 1.3 The Pick Distribution card

| Fact | Where |
|---|---|
| Rendered once, on the dashboard tab, under the Lock Status card | `NFLPoolDashboard.tsx:1359-1363` |
| Reads the pool consensus aggregate (`pools/{id}/consensus`) or the site-wide one; counts only, never names | `PickDistribution.tsx` header |
| **Kevin's ruling 2026-08-11 (PLAN-COMMISSIONER-BLIND-PICKS Q4): the live consensus is visible at all times.** The card *used to* hold each game's split behind that game's kickoff; the ruling removed that, and T5 (gating the consensus docs themselves) was dropped. The small-pool anonymity cost was accepted. | `PickDistribution.tsx:14-32`, CONTEXT.md §Pool Consensus |
| The grid's **Majority** row reads the same pool aggregate and is shown at all times for the same reason | `NFLPicksGrid.tsx:290-310` |
| The pick-sheet rows show the **site-wide** split per game (`useSiteConsensus` in `PickemPickEntry.tsx:236`), not the pool's | measured |
| The week lock the dashboard uses: `weekLock.locked` from `weekLockAtFor(pool, week, kickoffs)` honouring `lockMode`; `isWeekLocked` drives the Lock Status card | `NFLPoolDashboard.tsx:690-698` |

### 1.4 How a commissioner setting gets saved

| Fact | Where |
|---|---|
| Manager form posts `updatePoolSettings(poolId, { …top-level, settings: {whole object} })` | `NFLManagerView.tsx:942-951` |
| Server: `buildPoolSettingsUpdate` classifies each TOP-LEVEL key into a group (`settings` → group `settings`) and checks the group against the lifecycle phase. `settings` is editable in `draft` and `open`, **not** in `locked` (`isLocked: true`) or `archived` | `functions/src/lib/poolUpdate.ts:31-60`, `functions/src/shared/editability.ts:24-45` |
| NFL season pools sit at `isLocked: false` all season (§1.0 confirms it on a week-5 pool), so `settings` edits work mid-season — that is how `lockBufferMinutes` is edited today | measured |
| `flattenSettingsPatch` turns `settings.{k}` into dotted writes; it rejects keys failing `/^[A-Za-z0-9_]{1,100}$/` and the server-owned keys, and **validates no values** except `pinnedMessageId` | `poolUpdate.ts:152-180` |
| The create-time zod contracts live in `shared/schemas/nfl.ts` (`pickemCreateInputSchema` etc.) | measured |
| Every manager-form label needs a help topic or an allowlist entry — `tests/help-manager-label-coverage.test.ts`, `tests/help-content-manager-fields.test.ts`; topics live in `src/help/content/nfl-shared.ts` (pattern: `nfl.manager.cancelPool` at `:194`) | measured |

---

## 2. Part A — Survivor split-pot settlement (PLAN-GATED)

### 2.1 Design decision: reuse the finalizer, do not reuse `closePool`

`closePool` is the wrong tool and is kept as it is. It exists for Super-Admin housekeeping and is defined as producing **zero** stats and **zero** emails. A split pot is the opposite: a real competitive result with real money attached. Two survivors who split are co-champions and should show up as such in their season history, their profiles, My Prizes and the commissioner's ledger — all of which already read what the finalizer writes.

So the settlement is **"finalize now, with the ALIVE entries as the field, then retire the pool."**

### 2.2 Server — new callable `settlePool`

`functions/src/poolSettlement.ts` (new), exported from `index.ts`.

**Schema** (`functions/src/schemas/poolSettlement.ts`, strict):

```ts
settlePoolSchema = z.strictObject({
  poolId,
  outcome: z.literal('SPLIT'),             // the only outcome in v1 (D5)
  entryIds: z.array(z.string().min(1).max(100)).min(1).max(50),
  note: z.string().trim().max(500).optional(),
  notifyMembers: z.boolean().default(true),
});
```

**Guards, in order** (each is a `failed-precondition` with a code the client can show):

1. Principal: `loadPoolAndAssertManager(..., assertPoolOwnerOrManagerNoCo)` — owner or `managerUid`, SUPER_ADMIN, **never a co-commissioner** (same rule as cancel/close: it moves money).
2. `pool.type === 'NFL_SURVIVOR'` else `NOT_SURVIVOR` (D5).
3. Not voided (`isVoidedPool`), no `closedVia` of any kind, not a sim pool, else `ALREADY_SETTLED` / `SIM_POOL`. `finalizedAt` already set is refused (`ALREADY_FINALIZED` — the season ended on its own) **unless** `pool.settlementStartedAt` is present, which marks a settlement this callable began and did not finish (crash recovery, see Idempotence).
4. `entryIds` **equals the set of `ALIVE` entry ids** (order-free), else `WINNERS_MUST_BE_ALIVE_SET` (D3). Zero alive entries → `NO_SURVIVORS` (a pool where everyone is out finalizes on its own at season end; nothing to split).

**Writes**, all under the scoring lease (`withScoringLease`) so a 5-minute scorer pass can never interleave:

4b. Fenced write `settlementStartedAt: now` (only if absent). This is the crash-recovery marker for guard 3.

5. `maybeFinalizeNFLPool(db, poolId, { fence, force: 'SETTLED' })`. New option; the ONLY things it changes are (a) `isSeasonComplete` is skipped and (b) the audit reason. `computeFinalRanks` already ranks the ALIVE entries 1 and `priceSeasonPlaces` already splits place 1's money across them. Season history, profiles, `seasonPlaces`, `seasonPrize`, `finalizedAt` all land exactly as at a natural end.
6. Pool patch, a second fenced write after the finalizer: `status: 'COMPLETED'`, `closedVia: 'SETTLED'`, `closedAt`, and
   ```ts
   settlement: {
     kind: 'SPLIT', entryIds, settledAt, settledBy: uid, note,
     throughWeek: <highest scoredWeek>,
     // per-winner money, copied from the seasonPlaces this write just published —
     // null when the payout config was malformed (seasonPlacesError) — never computed twice
     perEntryPrize: number | null, pot: number | null,
   }
   ```
   `closedVia: 'SETTLED'`, not `ADMIN_CLOSE`: the client already maps any non-admin `closedVia` to the `final` label (`poolSport.ts:313,358`), and `isVoidedPool` retires it from the scorer by status.

   🛑 **NOT `isLocked` / `isFinal` / `scores.gameStatus`** — the three legacy fields `adminCloseUpdate` dual-writes. Sweep finding S1: `onPoolLocked` (`statsTrigger.ts:186`) fires on `isLocked` false→true and adds the pool's pot to `stats/global`, and `onGameComplete` (`postGameEmail.ts:37`) fires on `scores.gameStatus`→`post` and sends a **Squares** post-game email built from `squares[]`. Both skip only `isAdminCloseTransition` (`closedVia === 'ADMIN_CLOSE'`). NFL season pools never set those fields (§1.0: `isLocked: false` in week 5), and every NFL reader decides terminal-ness from `status` / `finalizedAt` / `closedVia` (`hasTerminalMarker`, `isRetiredPool`, `isVoidedPool`), so leaving them alone loses nothing and fires nothing.
7. Pool audit event `POOL_SETTLED` (new `AuditEventType`, `functions/src/types.ts:283` neighbourhood) + `writeAdminAudit('POOL_SETTLED')`.
8. If `notifyMembers`: one email per member via the same `resolveMemberEmails` + `sendEmail` path `cancelPool` uses, reason `pool_settled`: subject "<pool> is over — the pot was split", body naming the winners by display name, the per-winner amount **only when known**, the note, and the existing "run your own pool" footer.

**Idempotence:** a completed settlement has `closedVia` and COMPLETED, so a second call hits guard 3. A crash between 5 and 6 leaves a pool with `settlementStartedAt` and `finalizedAt` but status still OPEN; `finalizedAt` already retires it from the scorer (`isTerminalPool`), and re-running the callable is admitted by guard 3's `settlementStartedAt` exception, re-runs the finalizer (a documented re-runnable overwrite, `nflFinalize.ts:28`) and completes the flip. Both paths are tests.

### 2.3 Server — close the pick-submit hole (§1.1 last row)

One helper `assertPoolAcceptsPlay(pool)` → `if (isVoidedPool(pool) || pool.closedVia || pool.finalizedAt) throw failed-precondition 'POOL_OVER'`, called in the three shared cores (sweep S2), not the thin callables:

| Core | Callers it covers |
|---|---|
| `submitNFLPicksInternal` (`nflPools.ts:492`) | `submitNFLPicks`, `proxyPick` (`poolExceptions.ts:230`), the sim harness |
| `executeSurvivorRebuyInternal` (`nflPools.ts:1381`) | `executeSurvivorRebuy` |
| `joinNFLPoolInternal` (`nflPools.ts:355`) | `joinNFLPool`, admin add-member scripts |

Today none of the three reads `status` at all — a COMPLETED or CANCELED pool with an open week accepts a pick, a rebuy and a new member. It ships in PR-A because the settlement is what makes the hole reachable on a pool people are still looking at. Sim pools are unaffected unless voided (the sim harness never closes a pool mid-run).

### 2.4 Client

* **Manager tab → new "End the pool" section** beside the existing Cancel section (`NFLManagerView.tsx` ~`:2190`), **Survivor pools only, owner only** (co-commissioners see the explanation, not the button — same pattern as cancel at `:2193`). Contents: the ALIVE entries as a read-only list (D3: no checkboxes; the set is the set), the pot and per-winner amount **as the finalizer will compute them** (same `computeSeasonPrizeSnapshot` + `splitPrizes` the server runs — shared code, so the preview cannot disagree with the write), a note field, an "Email every member" checkbox (default on), and a danger button. Confirm via `ConfirmActionModal` with the sentence: *"This ends the pool now. N survivors share place 1. Picks close for everyone. It cannot be undone."*
* **Dashboard banner** for every member on a settled pool (new `SettledBanner` in `NFLPoolDashboard/`): "Pool over — the pot was split between A and B after week N" + the note. Rendered when `pool.settlement` exists.
* **Survivor pick sheet**: already hides for `ELIMINATED`; add the terminal-pool state ("This pool is over") so an ALIVE winner does not see a live sheet.
* **Standings**: the ALIVE rows read "Co-champion" instead of "Alive" when `pool.settlement` exists (one ternary at `NFLStandings.tsx:323`).
* My Prizes and the payout ledger need **no change** — they read `seasonPlaces`.
* `dbService.settlePool(poolId, input)`.

### 2.4b Rules

`settlement` and `settlementStartedAt` join the server-owned pool-field list in `firestore.rules` (beside `seasonPlaces`, `:218`). Sweep S3: without it a commissioner could write a fake `settlement` from the browser and the banner would announce a split nobody agreed to. Members already read the pool doc, so no read rule changes. Rules test in `test:rules`. Deploy order: functions, then rules (CLAUDE.md §3).

### 2.5 Docs

CONTEXT.md §Lifecycle: add `SETTLED` as a `closedVia` value and define "Settlement". HANDOFF.md entry with the deploy note (new callable → verify with `npx firebase functions:list | Select-String "settlePool"` per CLAUDE.md §3).

### 2.6 Tests (ship in the same PR)

| Test | Covers |
|---|---|
| `functions/src/__tests__/poolSettlementSchema.test.ts` | strict schema; outcome literal; entryIds bounds |
| `functions/src/__tests__/poolSettlement.test.ts` (unit, mocked db like `poolExceptions` tests) | guards 1–4 each; the exact pool patch; `settlement.perEntryPrize` null on `seasonPlacesError`; re-run after a crash between steps 5 and 6 |
| extend `nflFinalize.test.ts` | `force: 'SETTLED'` skips completeness, still refuses voided/sim, Survivor alive-set ranks 1 and prize splits evenly |
| `nflPools` submit test | `POOL_OVER` refusal on COMPLETED and on `finalizedAt` set |
| rules test (`test:rules`) | manager client write of `settlement` / `settlementStartedAt` denied |
| `nflPools` join + rebuy tests | `POOL_OVER` on COMPLETED / CANCELED / `finalizedAt` |
| `src/__tests__/settledBanner.test.tsx` | banner text with 1, 2, 3 winners; note shown; absent when no settlement |
| emulator: `poolSettlement.emulator.test.ts` | end-to-end on a seeded 3-entry survivor pool: seasonHistory docs, seasonPlaces, status flip, audit rows, scorer pass afterwards is a no-op |

### 2.7 Deploy / rollout

Functions deploy (new callable + the submit guard). Then Kevin settles `EJSGHCqc8Q8uv8godJKF` **from the UI** — no script, no admin write. Steps handed in chat at that time.

---

## 3. Part B — Current Picks: W-L and Max columns (ordinary)

### 3.1 Rule (pure helper `src/utils/picksGridMax.ts`)

```ts
export interface GridRowTally { wins: number; losses: number; earned: number; max: number | null }
export function tallyGridRow(args: {
  weekGames: NFLGame[];                     // the slate, kickoff order
  cells: Map<gameId, PicksGridCell>;        // what the grid already computed per cell
  setCount: number | undefined;             // the Set column's number (server counts / own count)
  revealMode: 'WEEK' | 'PER_GAME' | undefined;
  isOwnRow: boolean;
  confidenceMode: boolean;
}): GridRowTally
```

* `wins` / `losses`: count of `PICK` cells with `result === 'W'` / `'L'`. PUSH, VOID, null (undecided) do not count.
* `earned`: standard → `wins`; confidence → Σ weight over `W` cells.
* `remaining`: Σ over `PICK` cells with `result === null` and the game not final/cancelled (weight or 1), **plus** for a non-own row the unrevealed picks: `max(0, setCount − revealedPickCount)` × 1 in standard mode. In confidence mode an unrevealed pick's weight is unknowable → `max = null`. `setCount === undefined` (reveal not arrived) → `max = null`.
* `max = earned + remaining`.

Rendered as **W-L** (`3-1`, `—` when nothing graded yet) and **Max** (`12`, `?` when null, with a title explaining why). Both after Week Pts. The Majority row shows `—` in both.

### 3.2 Why Max is computed client-side and may differ from Week Pts for a few minutes

Week Pts is the scorer's published number (every 5 minutes). W-L / Max grade from the same client mirror the cells already use (`gradePick`, parity-pinned). Mid-game the two can disagree by one scorer cycle; the caption says so. Making Max wait for the scorer would mean "?" for most of Sunday, which defeats the column.

### 3.3 Scope

Pick'em only. Survivor has no points; Margin's points are unbounded (margin of victory), so "max remaining" has no meaning there. The weekly grid is untouched.

### 3.4 Tests

`src/__tests__/picksGridMax.test.ts`: own row standard; own row confidence; other row PER_GAME with 2 of 5 revealed; other row WEEK before/after reveal; PUSH and VOID excluded; `setCount` undefined → null; `setCount` smaller than revealed picks (stale count) clamps to 0. Grid render test asserting the two headers and a `?` cell. Caption text updated (the "#429 lesson": describe the columns on screen). Help: the grid's existing topic gets two sentences; `help-ui-coverage` will say whether the new headers need allowlisting.

---

## 4. Part C — Pick Distribution visibility (ordinary)

### 4.1 The setting

`settings.pickDistribution?: 'ALWAYS' | 'AFTER_LOCK' | 'OFF'`. Absent = `ALWAYS` = exactly today's behaviour, so no existing pool changes and Kevin's 2026-08-11 ruling stays the default. Added to the three NFL create schemas in `shared/schemas/nfl.ts` as optional, to `src/types/nflPoolTypes.ts`, and to the wizard's defaults (unset).

Server: `flattenSettingsPatch` gains a tiny value check for this key (enum or reject), the same way it checks `pinnedMessageId` — a free-text save must not be able to store `'OFFF'` and silently fall back to ALWAYS.

### 4.2 The rule (pure helper `src/components/NFLPoolDashboard/pickSheet/distributionVisibility.ts`)

```ts
export function distributionGameVisible(setting, game, now, pool): boolean
// ALWAYS → true; OFF → false; AFTER_LOCK → this GAME's pick lock has passed
export function distributionCardVisible(setting, weekGames, now, pool): boolean
// OFF → false; otherwise true if any game is visible (card renders only the visible games)
```

`AFTER_LOCK` is **per game**, using the same per-game lock the pick sheet uses (`lockMode` honoured). On a WEEKLY-lock pool every game locks at the one deadline, so it reads as "once the week locks". On a PER_GAME pool each bar appears at its own kickoff — which is precisely what this card did before the 2026-08-11 ruling, now opt-in per pool (D9).

### 4.3 Where it applies

* `PickDistribution` card: `OFF` → not rendered; `AFTER_LOCK` → renders only locked games, with an italic line "Splits appear once each game locks" while some are hidden.
* `NFLPicksGrid` Majority row: same rule per game (`—` while hidden); row hidden entirely on `OFF`.
* Applies to **every viewer including the commissioner** (D9) — one rule, no "but I can see it" split-brain.
* NOT applied to the pick-sheet rows' site-wide percentages (D10 — different data, different ruling).

### 4.4 Honest limit, stated on the control

The pool consensus documents stay readable to members (PLAN-COMMISSIONER-BLIND-PICKS T5 was dropped). This setting hides the card and the row; it does not hide the aggregate from someone reading Firestore in devtools. Same accepted posture as the ruling; the help text says "hidden from the pool home, not secret".

### 4.5 Commissioner Settings UI

A three-option control in the NFL manager settings form, section "Pool home": **Always** (default) / **After each game locks** / **Off**, with the help topic `nfl.manager.pickDistribution`. Saved with the existing settings save (`:942`), so it rides the merge-preserving dotted write.

### 4.6 Tests

`distributionVisibility.test.ts` (matrix: three settings × WEEKLY/PER_GAME × before/after lock); `poolUpdate.test.ts` value validation (accepts the three, rejects others, accepts absent); `PickDistribution` render test for OFF / partial; grid Majority row test; the help coverage suites for the new label and topic.

---

## 5. Sequencing, gates, and what each PR needs

| Order | PR | Why this order | Gates |
|---|---|---|---|
| 1 | **A — settlement** | It is the live need; the real pool is waiting. Plan-gated, so it carries the review log + sweeps. Functions deploy. | all 7 gate commands (CLAUDE.md §2e, it touches `functions/`), codex rounds, qodo cycle |
| 2 | **C — distribution setting** | Small; touches `functions/` only for the value check (needs the same deploy as A, or rides A's). | same 7 |
| 3 | **B — grid columns** | Frontend only, no deploy beyond Coolify. | root suite, `tsc -b`, build, lint; codex; qodo |

Each PR: branch from `origin/main` with `-b`, one at a time, codex before opening, qodo on the PR, three-condition stop rule.

---

## 6. DECISIONS NEEDED — restated in chat with recommendations

| # | Question | Recommendation | If "approve as recommended" |
|---|---|---|---|
| **D1** | Reuse the season finalizer (`force`) for the settlement, or write a plain close like `closePool`? | **Reuse the finalizer.** Season history, profiles, My Prizes and the payout ledger all come for free and agree with each other. | §2.2 steps 5–6 as written |
| **D2** | Who may settle? | **Owner or `managerUid` only, never a co-commissioner** — identical to cancel/close, because it records who the money goes to. | guard 1 |
| **D3** | Winners = exactly the ALIVE set, or let the commissioner pick a subset / add someone? | **Exactly the ALIVE set, no editing.** A split is "the remaining players agree"; anything else is a dispute the app should not adjudicate. | guard 4, read-only list in the UI |
| **D4** | Email every member when a pool is settled? | **Yes, default on, checkbox to skip.** Eliminated members deserve to hear the pool ended. | §2.2 step 8 |
| **D5** | Survivor only, or also Pick'em / Margin? | **Survivor only in v1.** The callable's shape (`outcome`, `entryIds`) leaves room; Pick'em/Margin splits would need a different ranking rule and nobody has asked. | guard 2 |
| **D6** | The live pool shows `entryCount: 11` but has 8 entry docs. The pot is `entryFee × entryCount` → **$275**, not $200. Is 11 right (3 rebuys?) | **Kevin to confirm before settling that pool.** The code trusts `entryCount` as the finalizer does today; the settlement panel shows the pot it will record so he can see the number before clicking. If wrong, he corrects `entryCount` in settings first. | no code change; a check in the runbook |
| **D7** | Max column: this week only, or also a "Season Max" (season total + this week's remaining)? | **Week only.** The grid is a week page; Standings carries season totals. Cheap to add later. | §3.1 as written |
| **D8** | Two columns (W-L and Max) or one? | **Two.** Kevin asked for both facts; folding them into one cell ("3-1 · 12") is harder to scan and to sort. | §3.1 as written |
| **D9** | `AFTER_LOCK` on a PER_GAME pool: per game, or all-at-once at the first kickoff? And does the commissioner see the same as members? | **Per game**, and **yes, same for everyone.** Per game is literally what the card did before the ruling, and one rule avoids a commissioner/member split-brain. | §4.2–4.3 as written |
| **D10** | Should the setting also hide the site-wide percentages on the pick-sheet rows? | **No.** Different data (site, not pool), covered by the 2026-08-27 scope ruling. Can be its own setting later. | §4.3 last bullet |

---

## 7. Out of scope, named so nobody wonders

* Undoing a settlement. It is terminal, like cancel. A wrong settlement is a Super-Admin repair.
* Recording who actually paid whom. That stays the commissioner's ledger (PaymentLedgerNFL), as today — the platform never moves participant money.
* Pick'em / Margin early settlement (D5).
* Hiding the consensus documents themselves (T5 stays dead).
* Sorting the grid by Max (not asked; one more toggle option if wanted).
