# PLAN — reopen Squares: playable, fair, correctly paid, and consistent with the NFL wizards

> **STATUS: IN PROGRESS under delegated authority (Kevin, 2026-11-10).**
>
> Kevin, 2026-11-10: *"Let's get this working fully. We have time. I want
> everything fixed and working properly and gaps identified and filled. Since I
> am away from my PC, you have authority to do anything that does not affect
> current running NFL pools. If something may touch code that has a blast radius
> of a running pool stop and let me know. Ensure a full backup is in place in
> case we need to quickly back out a change."*
>
> Target: Thanksgiving, 2026-11-26. Measured on `origin/main` @ `980efc94`.
>
> **Classification (`mmp-change-control` §1): PLAN-GATED** — money (who may buy
> a square, what a winner is paid), authorization (the claim gates), scoring
> (winner computation). No production-data migration (§2 D4).
>
> **Supersedes** `PLAN-SQUARES-ZERO-LIMIT.md` (branch
> `claude/squares-zero-limit-plan`, never merged) — its Option A is ticket A1
> here, unchanged. Closes `docs/backlog/SQUARES-BACKLOG.md` S1–S4 and
> `docs/backlog/SECURITY-CLAIM-SQUARES.md`.

---

## 0. Why nothing here can reach a running pool

Squares creation has been closed in code since 2026-08-28 (#637):
`SQUARES_CREATION_OPEN = false` on the client and `HARD_CLOSED_POOL_TYPES =
['SQUARES']` on the server. No squares pool has been created since, and every
squares pool that exists is a finished game.

So the work ships **dark**: PR-A, PR-B and PR-C change squares code paths that no
live pool exercises, and creation stays closed through all three. **Only PR-D
flips the two switches.** PR-D is the reopen and the rollback unit.

### Files this plan does NOT touch, and why

| File | Reason |
|---|---|
| `firestore.rules` | Shared by every running pool. One gap found here (§5 K1) is written up for Kevin, not changed. |
| `functions/src/reminders.ts` | Runs for NFL pools. The squares auto-release block is left as is; the new code tolerates what it leaves behind (§3 A3). |
| `participant.ts` → `syncParticipantIndices` | The trigger fires on every `pools/{id}` write, NFL pools included. Only the three squares-only callables in that file change. |
| `statsTrigger.ts`, `shared/memberRecord.ts`, every `nfl*` file | Not squares. |
| `lockPool` for BRACKET / PROPS / PLAYOFF | Only the `type === 'SQUARES'` branch changed; the others run the code they always ran (pinned by emulator tests). |
| Winner records of squares pools created before 2026-11-10 | History — see D14. No code path recomputes them. |

`functions/src/scoreUpdates.ts` IS touched. `syncGameStatus` skips every pool
with no `gameId` (`if (!pool.gameId) continue;`), and NFL season pools carry
none — they are scored by `nflAutoScoreJob`, which this plan does not touch.

### Rollback

1. **Anchor:** branch `backup/pre-squares-reopen-2026-11-10` = `980efc94`, the
   last commit before any of this.
2. **Instant, no deploy:** set `system/config.poolTypeFlags.SQUARES = false` in
   the Firebase console. Once PR-D removes the code-level closure, this runtime
   flag is what closes squares creation again, immediately.
   - **To stop winner records being written** (a payout looks wrong on a live
     game): set `system/config.squaresWinners.paused = true` in the Firebase
     console. Scores keep syncing; nothing is recorded, changed or drawn until
     it is cleared. Clear it (`false`) and the next sync run — within a
     minute — records everything that was held, including a game that
     finished days earlier. It applies to every road to the winner records:
     the scheduled sync, the simulator, "Fix Sync" and the commissioner's
     buttons. See D18.
3. **Code:** revert PR-D (one small commit) → redeploy functions → Coolify
   rebuild. Reverting D alone re-closes creation; A–C can stay.
4. **Data:** nothing in A–D writes production data on deploy, and the plan
   contains no migration.
5. **⛔ A DATA BACKUP IS NOT YET VERIFIED — it is step 1 of the deploy runbook,
   and Kevin's to run** (qodo, PR #758, finding 10). The code anchor above is in
   place; a data backup is not something this work could take or check — it has
   no credentials for the production project. Firestore PITR (7-day window) was
   measured enabled on 2026-08-10 (`PLAN-BACKUPS-PHASE3.md`) and has **not** been
   re-measured.

   **BOTH of these, before the first deploy of any of A–D. Neither stands in
   for the other** (qodo, PR #761, finding 10 — this section used to end "decide
   with PITR alone or create the bucket first", which let the rollout go ahead
   without the full backup it was asked to have):
   - **PITR is on.** The command that measured it in August:
     `npx firebase firestore:databases:get "(default)" --project gridiron-gamble-uzuqo --json`
     → `pointInTimeRecoveryEnablement` must read `POINT_IN_TIME_RECOVERY_ENABLED`.
     PITR reads back any bad write of the last seven days — while the database
     exists. It is the quick undo, not the backup.
   - **A full EXPORT has been taken and its location is written down here.**
     This is the copy that survives a deleted database and outlives seven
     days. It needs the off-region bucket from `PLAN-BACKUPS-PHASE3.md` Step 4,
     which that plan records as not created yet. **If the bucket does not
     exist, creating it is part of this step** (Step 4 there: one
     `gcloud storage buckets create` command, with the expected output and
     what to do if the name is taken). Then:
     `gcloud firestore export gs://$BACKUP_BUCKET/pre-squares-reopen-2026-11 --project gridiron-gamble-uzuqo`
     The export runs in the background: the command returning means it
     STARTED. **What shows it worked is the files:**
     `gcloud storage ls --recursive gs://$BACKUP_BUCKET/pre-squares-reopen-2026-11`
     If the listing is empty it is still running or it failed:
     `gcloud firestore operations list --project gridiron-gamble-uzuqo`.

     **UNVERIFIED — what those commands print.** None of the three was run
     for this plan; there are no credentials for the project here. What to
     expect is quoted from `PLAN-BACKUPS-PHASE3.md` Step 4, which is this
     repo's record of the same export, and is no better than that record:
     the export prints a line beginning
     `name: projects/gridiron-gamble-uzuqo/databases/(default)/operations/`;
     the listing shows a `.overall_export_metadata` file and one directory
     per collection (`all_namespaces/kind_pools/…`) with sizes that are not
     zero; the operations list has `done` and `error` on each entry. **If
     what you see differs, trust the screen, not this page** — a listing with
     real files in it is the proof, whatever they are called — and write
     down what it actually printed next to "Export taken" below.
     *(Round Q7 corrected a field name here that had been written from
     memory; round Q8 marks the rest for what it is.)*

   **Going ahead on PITR alone is not a choice this plan makes.** The
   instruction this work was given is "a full backup is in place". Only Kevin
   can waive it, and if he does, the waiver is recorded on this line with the
   date: _(none recorded)_.

   Do not deploy until both results are recorded here:
   - PITR confirmed on: _(date, by whom)_
   - Export taken: _(date, `gs://` path)_
6. **Merge precondition** (qodo, finding 6). The required `security-audit`
   check is red on `main` for 8 advisories in shared dependencies. None of
   A–D may be merged over it silently: either the dependency PRs (#750, #754,
   #755, #756, #746) land first and the check goes green, or Kevin records an
   explicit decision to merge with it red.

---

## 1. What is broken — verified against `980efc94`

Line references are to that commit. "NEW" = not in either backlog doc.

### Claim path

| # | Defect | Evidence |
|---|---|---|
| C1 | A pool left on the wizard default refuses every non-owner's first square (S1). | `squares.ts:94` `mySquares >= pool.maxSquaresPerPlayer`, wizard default `0` |
| C2 | Six readers give `0` six meanings; the client lets a selection through that the server then refuses. | `Grid.tsx:156` →100, `PoolRoute.tsx:439` →10, `:595`/`StatusCard.tsx:107` →"N/A", `:908` →"∞", server →refuse |
| C3 | The cap counts a display NAME. It is evaded by typing another name (S4) — and for a signed-in player it usually counts nothing at all: the count matches the TOKEN name, the square stores the TYPED name. **NEW** | `squares.ts:93` counts `s.owner === userName`; `:102` stores `pickedAsName \|\| userName` |
| C4 | A square held by a different person with the same name returns success without reserving anything. **NEW** | `squares.ts:85-88` |
| C5 | `reserveSquare` never stamps the caller's uid, so a signed-in player cannot use "I've paid" and sees zero squares on their dashboard. **NEW** | `confirmPayment.ts:59` and `ParticipantDashboard.tsx:225,386,942` require `reservedByUid`; only the claim-code flows write it |
| C6 | `guestDeviceKey` — the value that proves a guest owns a square — is published on the world-readable pool document. Anyone can mint a claim code for someone else's square. | `squares.ts:107`; `participant.ts:99,179`; SECURITY-CLAIM-SQUARES.md |
| C7 | Claiming N squares fires N parallel callables. A failure part-way leaves some reserved and reports "Reservation failed". **NEW** | `PoolRoute.tsx:442-449` |
| C8 | Three name-matching rules: server exact, grid case-insensitive, pool page exact-after-trim. **NEW** | `squares.ts:93`, `Grid.tsx:161`, `PoolRoute.tsx:438` |

### Money and lock

| # | Defect | Evidence |
|---|---|---|
| M1 | Charity is not deducted from recorded winner amounts. The wizard promises *"deducted from the Total Pot before winner payouts"*; the server pays percentages of the gross pot. **NEW** | `scoreUpdates.ts:226,264` vs `WizardStepPayouts.tsx:368`, `payouts.ts:43-45` |
| M2 | With reverse winners on, the prize is halved even when there is no second winner (same square, e.g. 14–24), so half the period's prize is paid to nobody. **NEW** | `scoreUpdates.ts:265` |
| M3 | "Roll over winnings" and both "final score unclaimed" options exist only in the client display. The server records an `Unsold` winner with the full amount, after which the client stops rolling it over. **NEW** | no reader of `quarterlyRollover` / `unclaimedFinalPrizeStrategy` in `functions/src`; `payouts.ts:120-126` |
| M4 | Every-Score-Pays "if winning square is unsold" (`rollover_next` / `split_winners` / `house`) is read by nothing. Every event gets an equal share and unsold shares are silently kept. **NEW** | no reader of `scoreChangeHandleUnsold`; `scoreUpdates.ts:1036-1038` |
| M5 | Two scoring steps in one sync (every TD + XP) record only the second in the score history. **NEW** | `scoreUpdates.ts:709` assigns `arrayUnion(newEvent)` inside the loop |
| M6 | A period that finalizes while the grid has no numbers gets no winner, ever — the "already finalized" guard then skips it. **NEW** | `scoreUpdates.ts:218` returns early; `:960` `!freshPool.scores?.q1` |
| M7 | The Final Prize Randomizer's "is the final square empty" check reads the transposed square. **NEW** | `AdminPanel.tsx:735-739` uses `home→row, away→col`; server and grid use `away→row, home→col` |
| L1 | `lockPool` regenerates the numbers every time it is called and is not transactional. "Unlock → Regenerate" works after kickoff. **NEW** | `poolParams.ts:19-80` |
| M8 | The admin **Payouts** tab works the winners out again for itself, looks up the transposed square (so it names the wrong person unless both digits match), and its "Mark Paid" toggles whether that player paid for their SQUARE — not whether the prize was paid out. **NEW** | `AdminPanel.tsx:855-857,928` |
| M9 | Scores entered by hand produce no winner record at all: "Mark Paid" fails with not-found and the winner email never sends. "Fix Sync" fails for every commissioner — it calls a SUPER_ADMIN-only callable. **NEW** | no server reader of client-written `scores`; `AdminPanel.tsx:410` → `fixPoolScores` (`role: SUPER_ADMIN`) |
| M10 | "Manual Score Override — disable auto-updates" is read by nothing; the next sync overwrites the typed scores. **NEW** | no reader of `manualScoreOverride` in `functions/src` |
| M11 | An Every-Score-Pays pool with no strategy set pays 20% + 40% to halftime and final AND 100% of the pot to scoring events — 160% of the money. **NEW** | `scoreUpdates.ts:263-268` (unset → hybrid) vs `:1022` (unset → `equal_split`) |
| M12 | Re-processing a finished Every-Score-Pays game ("Fix Sync") resets every event prize to $0 and re-decides each event's winner from the grid as it stands that day. **NEW** | `scoreUpdates.ts:786-800,885-899` re-`set` with `amount: 0`; `:1047` then sees the pre-read amount as unchanged |
| M13 | At the final whistle the feed's period scores overwrite the stored ones, but the winners never follow a corrected score. **NEW** | `scoreUpdates.ts:419-423` vs the `!freshPool.scores?.q1` guard at `:950` |
| L3 | `forceAxis` (numbers 0–9 in order, for the simulators) is open to any pool owner: buy the best squares for known numbers, then lock with them. **NEW** | `poolParams.ts:43` |
| L4 | Unlocking is a client write that leaves the drawn numbers on the grid while squares are back on sale. **NEW** | `AdminPanel.tsx:201` |
| L2 | A wizard-created pool is never auto-locked: `autoLockPools` selects on `reminders.lock.enabled`, which the wizard never sets. Unlocked at kickoff means still claimable during the game, and M6. **NEW** | `autoLock.ts:63-66` |

### Wizard and UI

| # | Defect | Evidence |
|---|---|---|
| W1 | The wizard has no game picker, so no `gameId`, so the scheduled score sync skips the pool. **NEW** | `scoreUpdates.ts` `if (!pool.gameId) continue;`; `buildSquaresPayload.ts:28` |
| W2 | The team labels are backwards: the wizard says home = rows; the grid and the scorer put home on the columns. | `CreateSquaresPool.tsx:25-26` vs `Grid.tsx:1037,1062` |
| W3 | No payouts step (every NFL wizard has one); plain `StepBranding` where the NFL wizards use `StepBrandingThemed`. | `CreateSquaresPool.tsx:74-78` |
| W4 | "Fuzzy matching active" describes the manual button and reads as a statement about live updates. | `AdminPanel.tsx:1003` |
| W5 | `calculateQuarterlyPayouts` logs at ERROR level on every render. | `payouts.ts:29` |
| W6 | `gridSize` is written and read by nothing (S2). | SQUARES-BACKLOG S2 |
| W7 | Unfinished design notes left as comments in the ownership code. | `participant.ts:44-66,113-128` |

---

## 2. Decisions

### Already ruled

- **D1 — `0` means unlimited.** Kevin, 2026-08-28, "approved as recommended".

### Taken under the 2026-11-10 delegation — each is Kevin's to veto

| # | Decision | Why |
|---|---|---|
| D2 | **Identity is the account for signed-in players and the device for guests.** `reserveSquare` stamps `reservedByUid` from the auth token. The cap counts squares held by the same identity OR under the same name (case-insensitive, trimmed). | Strictly tighter than today: a different name no longer evades it, a second device under the same name still counts. A guest who clears their browser AND changes name is a new person to the system; that is inherent to play without an account. |
| D3 | **Publish a hash of the guest key, never the key.** `guestKeyHash = sha256(poolId + ":" + key)`. | The security doc's fix, minus its pepper. The key is a `crypto.randomUUID()` (122 random bits) and the server refuses anything shorter than 32 characters, so the hash cannot be reversed by guessing. A pepper would add a functions secret every deploy depends on, for no added protection at that entropy. Per-pool salting also stops one device being linked across pools. |
| D4 | **Every guest key minted before this change is treated as compromised. No migration.** The browser mints a NEW key under a new storage name with a `g2_` prefix; the server gives a guest identity only to a key that carries it. | The raw key was published on every pool it was used in, and one browser reuses one key for every pool — so hashing the stored copies would not help against anyone who already read one. Ignoring un-prefixed keys closes that completely and needs no production write. The cost: guest squares on already-finished pools can no longer be claimed into an account (Kevin 2026-08-28: "Ignore any past pools as they are done"). |
| D5 | **Prize percentages apply to the pot after charity.** | What the wizard promises and what the pre-game display already shows. |
| D6 | **Reverse winners: two squares each claim half** — the winning square and the one with the digits swapped. When they are the SAME square (14–24) it holds both claims and takes the whole prize. A half whose square is unsold follows the unsold rule (D7) like any other prize. | Revised while building B1. The first wording gave an unsold reverse half to the regular winner, which is what the old client display did — but it means an unsold square changes what a different square is paid, and it cannot be squared with "roll over winnings". Halves that stand on their own are the rule a commissioner can explain. |
| D7 | **Rollover is implemented on the server as the wizard describes it.** Unsold with rollover on → prize moves to the next period; final unsold → `last_winner` (most recent paid winner) or `random` (the Randomizer). Rollover off → recorded `Unsold`, kept by the organizer. | The setting is offered today and does nothing reliable. |
| D8 | **Every-Score-Pays unsold handling is implemented as offered**: `rollover_next` (default), `split_winners`, `house`. | Same reason. |
| D9 | **Numbers are drawn once.** `lockPool` draws them only for a grid that has none and keeps them otherwise, in a transaction. The fixed test sequence (`forceAxis`) is honoured for a confirmed SUPER_ADMIN only. | A commissioner can currently re-roll after kickoff (L1), two concurrent locks can announce different sets, and L3. |
| D13 | **Reopening a grid discards its numbers, and is refused once the game has started.** New callable `unlockSquaresPool`; the admin page uses it. New numbers are drawn at the next lock. This IS the "explicit regenerate" D9 first described — there is no separate regenerate button. | L4. Nobody should be able to choose a square knowing which digits it carries. "Started" = feed says in/post, OR a period score exists, OR points are on the board, OR the scheduled kickoff has passed (the feed lags kickoff, and that minute is when a re-draw is worth having). |
| D14 | **A squares pool created before 2026-11-10 keeps its winner records exactly as recorded.** Record-keeping under the new rules applies only to pools created on or after that date (`SQUARES_RULES_SINCE_MS`); a pool with no readable `createdAt` counts as old. | Found in self-review: without it, opening the admin page of a finished pool would have re-derived its winners under the new rules and rewritten what was actually paid. Creation was closed from 2026-08-28, so every older pool is a finished game (Kevin 2026-08-28: "Ignore any past pools as they are done"). `createPool` is the only creation path and always stamps `createdAt`. |
| D15 | **The random draw for an unclaimed final prize is made once, by the server, among SOLD squares.** New callable `drawSquaresFinalPrize`. | K3, built rather than deferred. The old draw ran `Math.random()` in the commissioner's browser over all 100 squares, empty ones included, with a "reset" link beside the result. |
| D16 | **Winner records are reconciled on every score pass, not written once.** What the rules call for is compared with what is stored; only differences are written. "Paid" survives while the winner is unchanged and is cleared — with a CRITICAL audit line — if a corrected score moves the win. | M6, M12, M13 in one mechanism, with no marker to go stale. `recomputeSquaresWinners` runs the same reconcile for hand-entered scores (M9). |
| D17 | **A draw that has been made stands, whatever the unclaimed-prize rule is set to afterwards.** | qodo round 3 on #759. The rule decides who gets a prize that has NOT been awarded. With the draw honoured only while the rule still said "random", switching the rule moved a drawn — and possibly paid — prize to the last winner, and switching it back returned it to the drawn winner as unpaid. |
| D23 | **The prize pot keeps its cents; only the charity share is floored to a whole dollar.** `squaresPot` returns `net = gross − charity` to the cent. qodo asked twice (rounds Q6 and Q7) for `floor(gross − charity)`, the formula the domain reference gave before this plan — which described `statsTrigger.ts`'s site-wide display total, not what winners are paid. A fee may carry cents (the create contract allows it) and prizes are paid to the cent, so a floored pot would strand up to 99 cents that players paid in and nobody is paid out. PR-D rewrites the reference's squares section to say so. **This is Kevin's to confirm** — it is a money rule and qodo is right that it should not change on a code comment alone. *(Labelled D19 for one commit, which was already taken — round Q8.)* | qodo, PR #761 finding 5 and PR #760 re-review finding 4. *Recommendation: confirm. The worked case, which is a test (`tests/squares-payouts.test.ts`, "keeps the cents of a fee that has them"): 97 squares sold at $2.50 is a pot of $242.50; 10% to charity is $24.25, floored to $24; that leaves $218.50 for prizes. On "floor it instead" — one line in `squaresPot` and three tests updated — the same pool pays out $218 and 50 cents goes to nobody.* |
| D18 | **A pause switch for winner recording: `system/config.squaresWinners.paused`.** While set, scores are still kept; no quarter winner is recorded or changed and no prize amount is set; "Record winners" and the draw are refused in words. An Every-Score-Pays pool still notes each scoring event as it happens (at $0), because an event not noted then cannot be rebuilt. **Read inside the transaction that writes the winners** (round Q4), so every caller of the writer passes it and a pause set mid-run is seen. **A pool whose winners were held is marked (`squaresWinnersHeld`) and is recorded by the next sync run after the switch clears, however long it was set** (round Q4) — except a held pool since put on Manual Score Override, which waits for "Record winners" like every hand-typed score (review round Q2, finding 3). If the config cannot be read, nothing is written for that pool and the next pass retries: it neither fails open nor latches shut. | qodo rounds 3 and 4 on #759, and house rule 1 (`mmp-change-control`): a job that writes on a schedule needs a way to be stopped without a deploy. |
| D19 | **Every Score Pays cannot be chosen on a pool with no linked game.** It can always be switched off. | Each scoring event is recorded from the live feed as it happens; a hand-scored game has none, so that pool would end with nobody paid. Entering every score of a game by hand is K9(b). |
| D20 | **An old pool's finished quarter with no winner record is shown from the score, labelled as not recorded** — the owner of the square the score lands on, and that quarter's plain share. No reverse split, rollover or unclaimed-prize award is applied to it. | qodo round 3 on #759. A hand-scored pool recorded no winners before 2026-11, so there is no history to show; a blank card would be a worse account of that game than a labelled one, and today's rules were not its rules. |
| D21 | **"I've sent payment" covers the squares on the player's account and no others.** A square the organizer typed in for them is shown as the organizer's to mark paid. | qodo round 3 on #758. `confirmPayment` accepts only squares stamped with the caller's account and refuses the whole request otherwise. |
| D22 | **A claim code is the id of its own record.** Two live claims cannot share a code; a mint that cannot get a free one fails. | qodo round 3 on #758. The mint queried and then wrote under a random id. |
| D10 | **A pool linked to a game locks itself at kickoff.** The wizard sets `reminders.lock` when a game is picked. | L2. An unlocked grid at kickoff is the worst failure a squares pool has. |
| D11 | **One atomic claim.** A new `reserveSquares` callable takes the whole selection; all or nothing. `reserveSquare` stays for old bundles. | C7. |
| D12 | **Winner docs follow the scores, and freeze the owner.** Period winners are recomputed from one shared pure function whenever a period is final; a winner's recorded owner changes only if the winning SQUARE changes. | Fixes M1–M3 and M6 in one place, and keeps today's protection against assigning an unsold winning square after the fact. |

### Needs Kevin (work continues without them)

- **⛔ K7 IS THE ONE TO DECIDE FIRST** (it is listed in order below, but
  round Q5 changed its weight — read it before the others). **#761, the
  reopen, is not to be merged until K7 is decided and K1/K4 have been seen**
  (review log, round Q6: qodo marked both High on the reopen itself, and
  both are in files this work may not change).
- **K1 — `firestore.rules`: `quarterlyNumbers` is client-writable.** In a
  "new numbers each quarter" pool the commissioner can write the upcoming
  quarter's numbers before the server draws them; `axisNumbers` is protected but
  this is not. The fix is one entry in `protectedFieldsUnchanged` plus a rules
  test. **Not made** — `firestore.rules` is shared with running pools.
  *Recommendation: approve; it ships as its own two-line PR with a rules deploy.*
- **K2 — free-plan participant cap (S3).** NFL, bracket, playoff and props pools
  refuse the 11th participant on a free pool; `reserveSquare` does not.
  *Recommendation: leave squares exempt and say so in code and help — a
  100-square grid is one game, and a 10-person cap would make a free grid
  unfillable.* Unchanged until ruled.
- ~~**K3 — the Randomizer picks its winner in the commissioner's browser.**~~
  **Built in PR-B (D15)** — it is squares-only code, inside the delegation.
- **K6 — "auto-release unpaid squares" has never run, and still does not.**
  The job (`reminders.ts:494-540`) only acts on squares with a `reservedAt`,
  and nothing ever wrote one. PR-A first stamped it, which would have switched
  the job on — and the job is not safe to run: it picks its squares outside its
  transaction and releases them by id inside it, and it ignores "I've sent
  payment", so it can free a square that was paid during the run, re-bought by
  someone else, or is waiting on the commissioner (qodo, PR #758, finding 11).
  PR-A now records `claimedAt` instead and leaves the job dormant. **Not fixed**
  — `reminders.ts` also sends the NFL reminders. *Recommendation: approve a
  small PR that re-checks eligibility inside the transaction and reads
  `claimedAt`; until then PR-C labels the setting "not available yet".*
- **K7 — a second auto-lock for squares pools is live in `reminders.ts`, and its
  numbers are biased** (sweep SW1). `runReminders` → `checkLockReminders` →
  `executeAutoLock` locks any squares pool whose `lockAt` has passed and draws
  the numbers with `sort(() => Math.random() - 0.5)` — which leaves digits near
  where they started, and which `autoLock.ts`'s own header calls unacceptable
  for real-money numbers.
  **Why it matters more since PR-C (round Q5).** A pool linked to a game now
  locks at kickoff by default, so every such pool is in this copy's reach.
  And the earlier note here — "`autoLockPools` fires 30 seconds earlier, so
  this copy only acts when that job has missed a run" — was wrong: a job that
  runs every minute and locks grids due within 30 seconds reaches a given grid
  anywhere from 30 seconds before its lock time to 30 seconds AFTER it, and a
  `runReminders` pass in that second half would have drawn the numbers.
  **What is done about it without touching this file — in PR-C (#760, commit
  `2cf665a5`), NOT in the PR this document ships in:** there, `autoLockPools`
  locks a squares grid from 90 seconds before its lock time
  (`SQUARES_LOCK_LEAD_MS`), so it has always run before the lock time arrives.
  On PR-A's own branch `autoLock.ts` is unchanged and still uses 30 seconds:
  **the race is open until #760 is merged, and squares creation stays closed
  until after that** (PR-D). Even then it is closed only while the dedicated
  job is healthy — if that job is down or failing at that minute, this copy
  still decides the grid.
  **Not changed** — `reminders.ts` also sends the NFL reminders. *Recommendation:
  approve one small PR, before Thanksgiving, that makes `checkLockReminders`
  skip the auto-lock for squares pools (three lines) and leaves the lock
  REMINDER emails as they are; `autoLockPools` is the dedicated job. On
  approval: a squares grid can only ever be locked by the job that draws with
  `crypto.randomInt` and keeps numbers already drawn; if that job is down the
  grid stays open until it is back or the organizer locks it by hand, which
  the pool page already tells them how to do.*
- **K8 — the roster summary's "guest dues" reads a value nothing writes** (sweep
  SW4). `lib/rosterSummary.ts:31` counts squares with `reservedByUid ===
  'guest'`; a guest's square has no `reservedByUid`. So dues owed on guest
  squares are always $0 in the commissioner's totals. **Not changed** — that
  file feeds every pool type. *Recommendation: count squares with a
  `guestKeyHash` and no `reservedByUid`, in its own PR.*
- **K9 — two things about winner emails and hand scoring that this plan does
  not build** (qodo, PR #759, findings 2 and 11).
  (a) The winner email (`onWinnerComputed`, `reminders.ts`) announces every
  record on creation, whoever its owner is, and never on a change — so a
  rolled-over quarter is announced as "Rollover, $0" and the winner of the
  random draw is not announced at all. *Recommendation: skip records whose
  owner is not a player, and announce a draw; goes in the same small
  `reminders.ts` PR as K6 and K7.*
  (b) Every Score Pays needs the game linked to the live feed. A pool scored by
  hand has no scoring events, and they cannot be rebuilt from quarter scores.
  The admin page says so and blocks Manual Score Override on such a pool.
  *Recommendation: leave it — hand-entering every score of a game is not
  something a commissioner will do; revisit only if a game ever is not on the
  feed.*
- **K11 — a game link is taken on the commissioner's word.** Found by qodo
  (review log, round Q5, finding 2). `createPool` stores the game id, league,
  teams and kickoff the client sends, and linking from the manage page is a
  client write. A commissioner who crafted a request could link a pool to one
  game's scores under another game's teams and kickoff; they can already write
  `scores` and `isLocked` directly (K4), so it gives them nothing new, and the
  one way an honest commissioner could produce a mismatch (the picker keeping
  another league's results) is fixed. **Not built**, because the proper fix
  needs the rules change in K4. *Recommendation: when K4 is done, add one
  `linkSquaresGame` callable that looks the game up in the score feed and
  stores what the feed says; use it from the wizard and the manage page; and
  make the link fields server-only in `firestore.rules`.*
- **K10 — check that squares has pricing tiers before the first paid pool.**
  Found by the browser walk-through (review log, round W1). The launch step
  prices a pool from `settings/billing_config`. At ten players or fewer a pool
  is free and no tier is read; above ten, a format with no tiers cannot be
  priced and the commissioner sees "Unable to price this pool format" and
  cannot launch. Whether production has tiers under `pricing.squares` could not
  be read from here. **Not a code change** — it is a setting. *Recommendation:
  before the reopen, open Super-Admin → Monetization, confirm the Squares
  pricing tiers are filled in, and price one squares pool at 40 players on the
  launch step. If the tiers are empty, fill them in there; nothing deploys.*
- **K4 — `firestore.rules`: `isLocked`, `scores`, `payouts` and `randomWinner`
  are commissioner-writable.** PR-B makes the server paths correct and audited,
  but a commissioner using an old browser bundle (or the console) can still
  flip `isLocked` directly, bypassing D13. Closing that means adding fields to
  `protectedFieldsUnchanged` and moving the admin page's score entry behind a
  callable. **Not made** — shared rules file. *Recommendation: fold into the K1
  rules PR after Thanksgiving; the commissioner is the trusted party in a
  squares pool, so this is hardening, not a hole a player can use.*
- **K5 — the commissioner dashboard's "payouts" total reads `paidOut` /
  `paidStatus`, which nothing writes** (`lib/commissionerAggregate.ts:19`;
  `toggleWinnerPaid` writes `isPaid`). Squares payouts therefore always total
  $0 there. **Not changed** — that file feeds every pool type's dashboard.
  *Recommendation: one-line fix (`|| w.isPaid === true`) in its own PR.*

---

## 3. Tickets

### PR-A — the claim path (`claude/squares-claim-path`)

- **A1** `0` = unlimited: zero-guard in the callable; one shared reader
  (`shared/squaresCap.ts`) replacing all six; help copy; drift pins inverted.
- **A2** Identity: stamp `reservedByUid`, and `claimedAt` — **not** `reservedAt`
  (see K6); a square the commissioner enters under someone else's name carries
  the name and no identity; cap by identity ∪ name; same-name
  different-identity square is "already taken", not silent success; one
  name-normalizer shared by server and client.
- **A3** Guest key hash: reserve writes `guestKeyHash`, never the raw key;
  `createClaimCode` stores the hash and expires after 24 hours;
  `claimMySquares` / `claimByCode` compare hashes, ignore raw keys, and — now
  that the proof is real — add the claimant to `participantIds`. The pool page
  calls `claimMySquares` once when a signed-in player opens a grid that still
  holds an unclaimed guest square, so a guest who signs up keeps their squares. Squares with `owner: null` never match, so what
  `reminders.ts` auto-release leaves behind is inert.
- **A4** `reserveSquares` (atomic, whole selection); client uses it.
- **A5** ~~`migrateGuestKeyHashes`~~ — **dropped.** D4 makes it unnecessary: a
  legacy key identifies nothing once the server requires the prefix, so there
  is nothing to migrate and no production write to gate.
- **A6** `participant.ts` design-note comments replaced with what the code does.

### PR-B — money and lock (`claude/squares-money-lock`)

- **B1** `shared/squaresPayouts.ts`: one pure function from
  (sold squares, numbers per period, final period scores, score events, rules,
  cost) to period winners, event winners and amounts. D5–D8.
- **B2** `processGameUpdate` writes period winner docs from B1 (D12), preserving
  `isPaid` / `paidAt` / `paidByUid`; event payouts from B1; M5; M6.
- **B3** `calculateQuarterlyPayouts` delegates to B1; W5.
- **B4** `lockPool`: transactional, keeps existing numbers, `forceAxis` for a
  confirmed SUPER_ADMIN only. D9. (No `regenerate` flag — see D13.)
- **B5** M7 — superseded by B8: the admin page no longer has its own copy of
  the winner math to get wrong.
- **B6** `recomputeSquaresWinners` (M9); the admin page calls it after a score
  change, and "Fix Sync" uses it for a commissioner. `manualScoreOverride`
  honoured by the sync (M10).
- **B7** `unlockSquaresPool` (D13) and `drawSquaresFinalPrize` (D15).
- **B8** Admin Payouts tab rebuilt on the recorded winners, with
  `toggleWinnerPaid` (M8). Randomizer panel reads the recorded draw.
- **B9** D14 — old pools are left alone, on the server and in the display.

### PR-C — wizard and UI (`claude/squares-wizard`, on A + B)

- **C1** Game picker step: ESPN schedule → `gameId`, teams, logos, kickoff,
  `reminders.lock` at kickoff (D10). Manual entry stays for a game not listed.
- **C2** Payouts step (quarter percentages, charity) and the rule options that
  B1 implements; the server accepts validated squares payouts at create.
- **C3** W2 labels, `StepBrandingThemed`, help topics for every new control, W4,
  W6.
- **C4** Browser walkthrough on the emulators: create → claim as guest and as a
  signed-in player → lock → score → winners. Findings fixed or listed.

### PR-D — reopen

Flip `SQUARES_CREATION_OPEN` and `HARD_CLOSED_POOL_TYPES`; invert
`tests/squares-creation-closed.test.ts`; close the two backlog docs; HANDOFF.

---

## 4. Evidence required before each PR is called done

1. All seven gates (CLAUDE.md §2e) with the real numbers.
2. Every new guard mutation-tested: broken on purpose, red observed, restored.
3. Behaviour tests against the emulator for every callable changed — not source
   greps.
4. qodo's report read and every finding given a written verdict (§2b).
5. **`codex exec review` — OWED.** `codex` is not logged in on the machine this
   was written on (`codex login status` → `Not logged in`). Recorded in each PR
   body as an unmet §2c gate, not waived.

## 5. Out of scope

Bracket, playoff, props and every NFL pool type. The squares landing page copy.
The legacy nine-step settings flow in `AdminPanel` beyond the fixes named above.
