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
3. **Code:** revert PR-D (one small commit) → redeploy functions → Coolify
   rebuild. Reverting D alone re-closes creation; A–C can stay.
4. **Data:** nothing in A–D writes production data on deploy, and the plan
   contains no migration. Firestore PITR (7-day window) was measured enabled on
   2026-08-10 (`PLAN-BACKUPS-PHASE3.md`); it has not been re-measured since.

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
| D10 | **A pool linked to a game locks itself at kickoff.** The wizard sets `reminders.lock` when a game is picked. | L2. An unlocked grid at kickoff is the worst failure a squares pool has. |
| D11 | **One atomic claim.** A new `reserveSquares` callable takes the whole selection; all or nothing. `reserveSquare` stays for old bundles. | C7. |
| D12 | **Winner docs follow the scores, and freeze the owner.** Period winners are recomputed from one shared pure function whenever a period is final; a winner's recorded owner changes only if the winning SQUARE changes. | Fixes M1–M3 and M6 in one place, and keeps today's protection against assigning an unsold winning square after the fact. |

### Needs Kevin (work continues without them)

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
- **A2** Identity: stamp `reservedByUid` and `reservedAt` (the squares
  auto-release reads `reservedAt`, and nothing ever wrote it); cap by identity ∪ name; same-name
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
