# PLAN-CO-COMMISSIONERS — sweeps

Deterministic greps run 2026-08-15 on `origin/main` @ `3574e54e`. Re-run each
command before implementing; the plan's Tables 1–2 are derived from these.

## S1 — Does `firestore.rules` know `coManagers`? Who calls `isPoolManager()`?

```
grep -c coManagers firestore.rules
→ 0
```

**The brief's "referenced in `firestore.rules`" is false.** The rules layer
knows only `ownerId` and `managerUid`.

```
grep -n "isPoolManager()" firestore.rules | grep -v function
→ 284 (comment), 328 (the pool `allow update` manager branch)
```

`isPoolManager()` has ONE real caller — the pool `update` rule. Every
subcollection read (`members` :492-498, `standings` :510-516, `payoutRecords`
:522-530, `payoutRecordsPrivate` :534-542, `rosterSummary` :545-553, `consensus`
:557-565, `squarePrivate` :367-374, `audit` :377-385, `shareClicks` :571-579,
`announcements` write :402-409) **inlines** `ownerId == uid || managerUid == uid`:

```
grep -c "managerUid == request.auth.uid" firestore.rules
→ 12
```

So widening `isPoolManager()` (D3) touches the `update` rule only; each of the
12 inline sites is decided row-by-row against §3 (T3). Consequence for the
design: a co-commissioner who is a member is **already inside**
`participantIds`, so `members`, `standings`, `payoutRecords`, `rosterSummary`
and `consensus` reads work for them today with no rules change; only the
owner/manager-ONLY blocks (`squarePrivate`, `audit`, `shareClicks`,
`announcements` write, `payoutRecordsPrivate` for other uids, pool `delete`,
pool `update`) need a decision.

## S2 — Every `coManagers` site in `functions/src` (non-test)

```
grep -rn "coManagers" functions/src --include=*.ts | grep -v __tests__
→ nflPickReveal.ts:95   (header comment: do NOT admit — quoted in the plan)
  poolOps.ts:32         assertPoolOwnerOrSuperAdmin: participantIds ∧ coManagers
  poolOps.ts:48         PRIVILEGED_POOL_FIELDS: stripped on client CREATE
  scoreUpdates.ts:1322  simulateGameUpdate: coManagers only (no participantIds)
  simLegacy.ts:144      simFillSquares: coManagers only
```

Two shapes (with/without the `participantIds` conjunct) — plan D3 collapses
them to one helper.

## S3 — `coManagers` in the client and shared contracts

```
grep -rn "coManagers" src shared | wc -l
→ 0
```

No UI reads it, no UI writes it, no zod schema or TS type carries it. There is
no wizard step, settings panel, or `dbService` call that could set it. **The
only way it could be set today is a raw `updateDoc` from a browser (permitted —
S4) or the Admin SDK.**

## S4 — Is `coManagers` client-writable? (`protectedFieldsUnchanged()`)

`firestore.rules:92-156` freezes: `managerUid, ownerId, createdAt, createdBy,
axisNumbers, squares, participants, participantIds, billing, hardLockByWeek,
publishedWeeks, autoScore, scoredWeeks, scoredThroughWeek, isTestPool, simRunId,
type`. **`coManagers` is absent**, so an owner/`managerUid` on a `DRAFT`/`OPEN`
pool can write it. That is plan T1's justification and it ships regardless of
the feature.

## S5 — Every callable behind `assertPoolOwnerOrSuperAdmin` (admits coManagers TODAY)

```
grep -rln "assertPoolOwnerOrSuperAdmin\|loadPoolAndAssertManager" functions/src --include=*.ts | grep -v __tests__
→ invites.ts (sendPoolInvites :73)
  manualReminders.ts (sendManualReminder :62)
  nflPickReveal.ts (comment only — it deliberately does NOT use it)
  nflPools.ts (scoreNFLWeek :1710)
  payoutRecords.ts (recordPoolPayouts :54)
  poolExceptions.ts (loadPoolAndAssertManager :56 → extendWeekDeadline, proxyPick, cancelPool, closePool)
  poolOps.ts (updatePoolSettings :419 — with the managerUid bypass :411-419; toggleWinnerPaid :658)
  poolParams.ts (lockPool :27)
  schemas/poolExceptions.ts (import only)
```

Gates that do NOT admit coManagers: `setPaidStatus.ts:102-106`
(ownerId ∨ managerUid ∨ createdByUid ∨ SA), `squares.ts:218-228`
`assertPoolManager` (ownerId ∨ managerUid ∨ SA via users doc),
`billing.ts:293` `redeemCoupon` (ownerId strict), `nflPickReveal.ts:158-160`
COMMISSIONER principal (ownerId ∨ managerUid).

## S6 — Owner precedence disagreements (the plan's D3 fixes these by using a disjunction)

- `poolOps.ts:31`, `entitlements.ts:379` — `createdByUid || ownerId || managerUid` (first wins → `managerUid` is dropped when the others exist)
- `lib/reminderTargets.ts:211-219` — all three as a set, with a comment recording that `backfillMemberRecords` resolves `ownerId || createdByUid || managerUid`
- `billing.ts:66` `ownerId || managerUid`; `billing.ts:401` `ownerId || createdByUid || managerUid`
- `setPaidStatus.ts:104` — flat OR

## S7 — Tests that pin current owner/manager behaviour (must change deliberately or stay green)

- `functions/src/__tests__/emulator/blindPicks.emulator.test.ts:495-512` — `asCo.counts` is `{}` (co-manager ≠ commissioner on `getPoolPicks`); `:514-519` a distinct `managerUid` IS admitted. **Flips only if K4 = Yes (T4).**
- `functions/src/__tests__/emulator/bannedOwnerPath.emulator.test.ts` — banned owner across the four ownership fields; must stay green through T2.
- `functions/src/__tests__/manualReminderTargets.test.ts:458-462` — `it.each(["createdByUid","managerUid"])`.
- `tests/nfl-settings-lockdown.test.ts:109,182,228,233` — source-text invariants on `firestore.rules`; `:233` asserts `callableOnlySettingsUnchanged()` precedes `isPoolManager()` in the update statement. **T3 changes the helper body, not the statement.**
- `tests/nfl-surface-invariants.test.ts:621-641,702-717` — pins `isManager` lines in `NFLPoolDashboard.tsx`. **T5 does not touch that file.**
- `functions/scripts/participantIds.rules.test.mjs`, `entriesStandings.rules.test.mjs`, `survivorParitySettings.rules.test.mjs`, `simBackdoors.rules.test.mjs` — fixtures with `ownerId`/`managerUid`; the new `coManagers.rules.test.mjs` mirrors `participantIds`. All eight run in CI since #434.

## Re-verification

Before T1: re-run S1 (`grep -c coManagers firestore.rules` must still be 0 —
if not, someone touched it and this plan is stale), S3 (must still be 0), and
the census in the plan's R5.

## S8 — Every path that removes a member (where `coManagers` must also drop the uid)

```
grep -rn "arrayRemove" functions/src --include=*.ts | grep -v __tests__
→ functions/src/lib/memberRecord.ts:188   voidMemberRecord      participantIds: arrayRemove(uid)
  functions/src/lib/memberRecord.ts:210   reconcileMembership   participantIds: arrayRemove(uid)
grep -rn "export const \(removeParticipant\|leavePool\|removeMember\|removePoolMember\|kickMember\)" functions/src
→ (nothing)
```

**There is no live removal path today.** The only two functions that remove a
uid from `participantIds` are library helpers with no callable caller
(`memberRecord.ts`'s own header records that caller wiring is deferred), and
the client cannot remove either — `participantIds` is server-owned since #432.
So T1's obligation is: add `coManagers: arrayRemove(uid)` inside BOTH helpers
now, so that whichever removal callable is eventually wired inherits it, and
assert it in `memberRecord.emulator.test.ts`. Codex r1 was right that the plan
had asserted a transaction that did not exist; this is what exists.

## S9 — Owner/manager gates in OTHER formats (untouched in v1 — C13)

```
grep -n "assertPoolManager\|managerUid\|ownerId" functions/src/bracketPools.ts functions/src/bracketOps.ts functions/src/bracketEntries.ts functions/src/propBets.ts functions/src/squares.ts
→ bracketPools.ts:186     publish: managerUid only
  bracketOps.ts:34        managerUid ∨ ownerId
  bracketEntries.ts:373,380  delete entry: managerUid ∨ ownerId
  bracketEntries.ts:438   updateEntryPayment: ownerId ∨ managerUid ∨ createdByUid
  propBets.ts:131-132     grading: ownerId / managerUid
  squares.ts:218-228      assertPoolManager (updatePlayer, releaseSquares) — Squares PII
```

None of these read `coManagers`, none are changed by this plan, and T2b's
helper is NOT applied to them (plan D3 scope, codex r2). Re-run after T2b: the
line set above must be byte-identical.
