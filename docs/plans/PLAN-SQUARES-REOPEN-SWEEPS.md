# PLAN-SQUARES-REOPEN — sweeps

Deterministic greps, run 2026-11-10. S1–S5 are against the PR-A branch
(`claude/squares-claim-path`); S6–S9 are against the PR-B branch
(`claude/squares-money-lock`). Re-run each command before relying on a table:
these are point-in-time lists, and the commands are the source of truth.

Classification is per site: **changed** (a plan ticket edits it), **consistent**
(reads or writes the field in a way the plan's rule already covers — nothing to
edit), **dormant** (code that cannot run today, and why), **finding** (something
the sweep surfaced that review had not — each one is carried into the plan).

**What the sweeps found that review had not:**

| # | Finding | Where it went |
|---|---|---|
| SW1 | A SECOND auto-lock for squares pools is live in `reminders.ts`, and it draws the numbers with `sort(() => Math.random() - 0.5)` — the biased shuffle `autoLock.ts`'s own header calls "unacceptable for axis numbers that determine real-money payouts". | Plan K7 — `reminders.ts` is outside this work's authority. |
| SW2 | `autoLock.ts` re-draws the numbers of an unlocked grid that already has some, and draws with `Math.random`. | PR-C (it is already editing this file for L2). |
| SW3 | `scoreUpdates.ts` draws the 2nd–4th quarter numbers of a four-set pool with `Math.random`. The previous quarters' numbers are public, and that generator's state is recoverable from its outputs. | PR-B follow-up commit: `crypto.randomInt`. |
| SW4 | `lib/rosterSummary.ts:31` counts guest squares by `reservedByUid === 'guest'`. Nothing has ever written that value — a guest square's `reservedByUid` is absent/null — so "guest dues" is always $0. | Plan K8 — that file feeds every pool type's roster. |
| SW5 | `simFillSquares` (the sim tool) can be run by a pool's OWNER on a real pool and fills the grid with invented names marked paid. | Noted; not changed — the owner can already type any name onto their own grid. |

---

## S1 — every writer of `pools/{id}.squares`

```
git grep -n "squares: \|\.squares = " -- functions/src ':!functions/src/__tests__' ':!functions/src/shared'
grep -n "'squares'" firestore.rules
```

| Site | What it writes | Classification |
|---|---|---|
| `functions/src/poolOps.ts:415` | `createPool` — 100 empty squares | consistent — the only creation path (`firestore.rules`: `allow create: if false`) |
| `functions/src/squares.ts:138` | `reserveSquare` / `reserveSquares` — `planClaim`'s output | **changed** (A1–A4) |
| `functions/src/squares.ts` `markSquaresPaid` | `isPaid`, `paidAt`, `paidByUid` on named squares | consistent — commissioner-only; does not touch identity |
| `functions/src/squares.ts` `updatePlayer` | renames `owner` on every square carrying `originalName` | consistent — by NAME, as it must be for hand-entered squares. Two players sharing a name are renamed together; pre-existing, out of scope |
| `functions/src/squares.ts` `releaseSquares` | clears owner + identity + payment marks | **changed** (A3: also clears `guestKeyHash`, `paymentConfirmedAt/ByUid`) |
| `functions/src/confirmPayment.ts:98` | `paymentConfirmedAt/ByUid` on squares where `reservedByUid === caller` | consistent — this is the check A2 makes satisfiable |
| `functions/src/participant.ts:162` | `claimMySquares` — moves guest squares to the account | **changed** (A3) |
| `functions/src/participant.ts:219` | `claimByCode` — same, via a code | **changed** (A3; qodo #2) |
| `functions/src/reminders.ts:530` | unpaid auto-release — clears `owner`, `guestDeviceKey`, `guestClaimId`, `reservedAt`, `reservedByUid` | **dormant** — acts only on a square with `reservedAt`, which nothing writes (K6). Leaves `guestKeyHash` and the payment marks behind; `planClaim` and `claimGuestSquares` are written to tolerate that |
| `functions/src/simLegacy.ts:164` | `simFillSquares` — `{id, owner, isPaid: true, timestamp}` | consistent — name-only squares, no identity. See SW5 |
| client | — | none: `squares` is in `protectedFieldsUnchanged` (`firestore.rules:162`) |

## S2 — every read and write of `squares[].reservedByUid`

```
grep -rn "reservedByUid" functions/src src shared --include=*.ts --include=*.tsx | grep -v "functions/src/shared/\|__tests__\|\.test\."
```

| Site | Read / write | Classification |
|---|---|---|
| `shared/squaresClaim.ts:241` (`planClaim`) | WRITE — the claimer's uid, or `null` for a guest or a commissioner-entered square | **changed** (A2; qodo #12) |
| `functions/src/participant.ts:143` (`claimGuestSquares`) | WRITE — the claimant's uid, on a hash match | **changed** (A3) |
| `functions/src/squares.ts:410` (`releaseSquares`) | WRITE `null` | consistent |
| `functions/src/reminders.ts:523` | WRITE `null` | dormant (S1) |
| `shared/squaresClaim.ts:98,105` | READ — `isHeldBy`, `hasIdentity` | **changed** — the one definition |
| `functions/src/participant.ts:136` | READ — refuses to move a square another account holds | consistent |
| `functions/src/participant.ts:289` (`syncParticipantIndices`) | READ — builds the per-user index | consistent — executable code unchanged; gated on the live roster |
| `functions/src/confirmPayment.ts:59` | READ — "is this square the caller's?" | consistent (S1) |
| `functions/src/migrations/backfillMemberRecords.ts:79` | READ | consistent — its `applySquareUnits` gate stays; comment updated in PR-D |
| `functions/src/lib/rosterSummary.ts:31` | READ `=== 'guest'` | **finding** SW4 |
| `src/components/Grid.tsx:86,1267` | READ — unclaimed-guest check; "my paid square" highlight | consistent |
| `src/components/ParticipantDashboard.tsx:225,386,942` | READ — "my squares" on the dashboard | consistent — this is what A2 makes work for a player who reserved while signed in |
| comments: `participant.ts:275,356,365`, `poolOps.ts:870`, `backfillMemberRecords.ts:71,101`, `shared/memberRecord.ts:531,534` | — | `poolOps.ts` and `backfillMemberRecords.ts` describe the pre-fix claim path; updated in PR-D |

## S3 — every read and write of the guest key and its hash

```
grep -rn "guestDeviceKey\|guestClaimId\|guestKeyHash" functions/src src shared --include=*.ts --include=*.tsx | grep -v "functions/src/shared/\|__tests__\|\.test\."
```

| Field | Writers | Readers | Classification |
|---|---|---|---|
| `squares[].guestKeyHash` | `planClaim` (guest only); cleared by `claimGuestSquares`, `releaseSquares` | `isHeldBy`, `hasIdentity`, `claimGuestSquares`, `Grid.tsx:86` | **changed** — the only stored form of the key |
| `squares[].guestDeviceKey` (RAW) | `planClaim` → `null`; `releaseSquares` → `null`; `reminders.ts:521` → `null` | none | **changed** — never written with a value again, never read |
| `squares[].guestClaimId` | `planClaim` → `null`; `reminders.ts:522` → `null` | none | consistent — legacy field, cleared |
| `poolClaims/{id}.guestKeyHash` | `createClaimCode` | `claimByCode` | **changed** |
| `poolClaims/{id}.guestClaimId` (RAW, legacy) | none | none — a code carrying only this is refused | **changed** |
| callable input `guestDeviceKey` | client (`Grid.tsx`, `dbService.ts`) | `guestKeyHashOrNull` only — hashed at the door | **changed** — the raw key exists in a request and in the browser's `localStorage`, nowhere else |
| browser | `src/utils/guestKey.ts` — mint, read, hash | — | **changed** (new storage name, `g2_` prefix; qodo #9) |

## S4 — every writer of `participantIds` reachable on a squares pool

```
git grep -n "participantIds" -- functions/src/squares.ts functions/src/participant.ts functions/src/simLegacy.ts functions/src/confirmPayment.ts functions/src/reminders.ts
```

| Site | Writes | Classification |
|---|---|---|
| `functions/src/squares.ts:139` | `arrayUnion(uid)`, or `arrayUnion("guest")` for a guest | consistent — pre-existing. `"guest"` is a sentinel entry, not a uid |
| `functions/src/participant.ts:163` (`claimMySquares`) | `arrayUnion(uid)`, only when something was claimed | **changed** (A3) |
| `functions/src/participant.ts:220` (`claimByCode`) | same | **changed** (A3) |
| `functions/src/participant.ts:353` | READ — the live-roster gate in `syncParticipantIndices` | consistent |

Not on the three-store invariant — see `CONTEXT.md` (Member Record) and review log Q1 #1.

## S5 — every reader of `maxSquaresPerPlayer`

```
grep -rn "maxSquaresPerPlayer" functions/src src shared --include=*.ts --include=*.tsx | grep -v "functions/src/shared/\|__tests__\|\.test\."
```

Before PR-A the same stored `0` meant six things (plan C2). After it:

| Site | How it reads the value | Classification |
|---|---|---|
| `shared/squaresClaim.ts:208` (`planClaim`) | `effectiveSquareCap` | **changed** — the definition |
| `functions/src/squares.ts:138` | passes the raw value to `planClaim` | **changed** |
| `src/components/Grid.tsx:186` | `effectiveSquareCap` | **changed** (was `\|\| 100`) |
| `src/components/routes/PoolRoute.tsx:446` | raw → `planClaim` | **changed** (was `\|\| 10`) |
| `src/components/routes/PoolRoute.tsx:607` | `squareCapSentence` | **changed** (was "N/A") |
| `src/components/routes/PoolRoute.tsx:920` | `effectiveSquareCap(...) ?? 'No limit'` | **changed** (was "∞") |
| `src/components/StatusCard.tsx:108` | `squareCapSentence` | **changed** (was "N/A") |
| `src/components/admin/WizardStepSummary.tsx:122` | `squareCapLabel` | **changed** |
| `src/components/admin/WizardStepRules.tsx:39-40` | the editing field; `parseInt(...) \|\| 0` | consistent — writes `0` for "no limit" |
| `src/components/wizard/create/CreateSquaresPool.tsx:29,43`, `buildSquaresPayload.ts:26` | the create field; default `0` | consistent |
| `shared/schemas/squares.ts:10` | `z.number().int().min(0).optional()` | consistent |
| `src/constants.ts:33` | legacy client default `10` (`createNewPool`) | consistent — a real cap, not a `0` |
| `PropsWizard.tsx:151`, `TournamentSimulator.tsx:193`, `utils/testing/simulators/*` | write `0` on non-squares / simulator pools | consistent — never read for those types |
| `src/help/content/squares-props.ts`, `src/help/coverage-allowlist.ts`, `src/config/season.ts` | prose | **changed** (help copy) |

No reader of the raw number remains outside `shared/squaresClaim.ts`.

---

## S6 — every writer of `pools/{id}/winners/*` (PR-B)

```
git grep -n "collection('winners')\|collection(\"winners\")\|winners.doc(" claude/squares-money-lock -- functions/src ':!functions/src/__tests__' ':!functions/src/shared'
grep -n "winners" firestore.rules
```

| Site | What | Classification |
|---|---|---|
| `functions/src/lib/squaresWinners.ts:227-233` (`applyWinnerPlan`) | create / merge-update / delete, from `planWinnerWrites` | **changed** — the one place period records and event AMOUNTS are written |
| `functions/src/scoreUpdates.ts:629,668,737,772` | creates scoring-event records at `amount: 0` as each score happens | **changed** — never re-writes a record that already exists (M12) |
| `functions/src/squaresAdmin.ts:180` (`drawSquaresFinalPrize`) | the drawn `final_rollover` record | **changed** (D15) |
| `functions/src/poolOps.ts:738-742` (`recalculatePoolWinners`) | deletes every record, nulls the period scores | consistent — SUPER_ADMIN repair. The next pass rebuilds from the grid as it stands; nothing to keep in step because there is no marker to go stale (D16). On an old pool (D14) the records are deleted and NOT rebuilt — that tool should not be run on one |
| `functions/src/poolOps.ts:805-812` (`toggleWinnerPaid`) | `isPaid`, `paidAt`, `paidByUid` | consistent — fields the reconcile never overwrites unless the winner changes |
| READ: `scoreUpdates.ts:264`, `squaresAdmin.ts:91,131`, `postGameEmail.ts:70`, `lib/commissionerAggregate.ts:15`, `debug.ts:51` | — | consistent. `commissionerAggregate` reads `paidOut` / `paidStatus`, which nothing writes — plan K5 |
| triggers: `reminders.ts` `onWinnerComputed` (create), `aiCommissioner.ts` `onWinnerUpdate` (write), `rosterAggregate.ts` `onWinnerWrite` (write) | — | consistent. A `Rollover` record and `final_rollover` are new ids those triggers will see; the winner email (if the commissioner enabled it) will announce "Winner Alert: Q1 - Rollover, $0" for a rolled-over quarter. Cosmetic; `reminders.ts` not edited |
| client | — | none: `allow write: if false` |

## S7 — every writer of `axisNumbers` / `quarterlyNumbers` (PR-B)

```
git grep -n "axisNumbers\s*[:=]\|quarterlyNumbers\s*[:=]" claude/squares-money-lock -- functions/src src ':!functions/src/__tests__' ':!functions/src/shared' ':!*.test.ts' ':!*.test.tsx' ':!src/utils/testing'
```

| Site | What | Classification |
|---|---|---|
| `functions/src/poolParams.ts:59-71` (`lockSquaresPool`) | draws ONLY when the grid has none; `crypto.randomInt` | **changed** (D9) |
| `functions/src/squaresAdmin.ts:240-241` (`unlockSquaresPool`) | deletes both, before kickoff only | **changed** (D13) |
| `functions/src/scoreUpdates.ts:815-820` | four-set pools: draws the next quarter's numbers when a quarter ends; rotates `axisNumbers` to the current set | **finding** SW3 — `Math.random` |
| `functions/src/scoreUpdates.ts:295,1190` | `simulateGameUpdate` — draws numbers for a pool that has none before simulating | consistent — owner/SUPER_ADMIN sim tool |
| `functions/src/autoLock.ts:150-158` | auto-lock at `reminders.lock.lockAt` — draws unconditionally | **finding** SW2 |
| `functions/src/reminders.ts:737-751` (`executeAutoLock`) | a second auto-lock, reached from `runReminders` → `checkLockReminders` when `lockAt` has passed and the pool is still unlocked | **finding** SW1 — biased shuffle; live |
| `src/components/SuperAdmin.tsx:1013-1014` | SUPER_ADMIN "reset pool" tool — client write of `null` | consistent — an admin tool on the admin bypass in the rules |
| `src/constants.ts:57` | default for a new client-side pool object | consistent |
| client, commissioner | — | `axisNumbers` is protected in `firestore.rules`; **`quarterlyNumbers` is NOT** — plan K1 |

## S8 — every writer of `isLocked` on a squares pool (PR-B)

```
git grep -n "isLocked: \|'isLocked'" claude/squares-money-lock -- functions/src src ':!functions/src/__tests__' ':!functions/src/shared' ':!*.test.ts' ':!*.test.tsx' ':!src/utils/testing'
```

| Site | What | Classification |
|---|---|---|
| `functions/src/poolOps.ts:395` | `createPool` — `false` | consistent |
| `functions/src/poolParams.ts:65` | `lockSquaresPool` — `true` | **changed** |
| `functions/src/poolParams.ts:131` | `lockPool`, non-squares types | consistent — untouched path |
| `functions/src/squaresAdmin.ts:238` | `unlockSquaresPool` — `false` | **changed** |
| `functions/src/autoLock.ts:139` | auto-lock — `true` | consistent (SW2 is about the numbers) |
| `functions/src/reminders.ts:743` | second auto-lock — `true` | finding SW1 |
| `functions/src/lib/lifecycle.ts:56` | closing a pool | consistent |
| `src/components/AdminPanel.tsx` | was `updateConfig({ isLocked: !isLocked })`; now `lockPool` / `unlockSquaresPool` | **changed** |
| `src/components/SuperAdmin.tsx:910,1010` | SUPER_ADMIN tools — client writes | consistent — admin tools |
| any commissioner with an OLD bundle or the console | client write | **not closed** — `isLocked` is not in `protectedFieldsUnchanged`. Plan K4 |

## S9 — every copy of "which square wins and what it is paid" (PR-B)

```
git grep -n "axis.away.indexOf\|axisNumbers.away.indexOf\|axisNumbers.home.indexOf\|\.home.indexOf(" claude/squares-money-lock -- functions/src src shared ':!functions/src/__tests__' ':!functions/src/shared' ':!*.test.ts' ':!*.test.tsx'
```

Before PR-B there were five copies and they disagreed (plan M1–M4, M7, M8).

| Site | What | Classification |
|---|---|---|
| `shared/squaresPayouts.ts` | `winningSquare`, `reverseSquare`, `computePeriodPayouts`, `computeEventPayouts` | **changed** — the definition |
| `functions/src/lib/squaresWinners.ts` | calls the definition | **changed** |
| `src/utils/payouts.ts` | calls the definition (was a second copy) | **changed** |
| `src/components/AdminPanel.tsx` — Payouts tab | was a third copy with the TRANSPOSED square; now reads the recorded winners | **changed** (M8) |
| `src/components/AdminPanel.tsx` — Randomizer | was a fourth copy with the transposed square; now reads the `final_rollover` record | **changed** (M7) |
| `functions/src/scoreUpdates.ts` — scoring-event loop | still looks up the event's square itself (`axis.away.indexOf(aDigit)`, `axis.home.indexOf(hDigit)`) | consistent — same orientation as the definition; the AMOUNT comes from the definition. Folding the lookup into `winningSquare` is a refactor with no behaviour change, left for after the reopen |
| `src/services/gameLogic.ts` `calculateWinners` | a fifth copy | **dormant** — exported, imported by nothing (`git grep calculateWinners`). `calculateScenarioWinners` in the same file (the "what if the next score is…" strip on the pool page) is live and has its own lookup: same orientation, display only, no amounts |
| `src/components/Grid.tsx` | highlights winning squares from the RECORDS | consistent |
