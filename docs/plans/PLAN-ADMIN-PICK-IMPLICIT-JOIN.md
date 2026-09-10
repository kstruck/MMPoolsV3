# PLAN — a pick that is accepted is a membership (the SUPER_ADMIN pick bypass must join)

> **STATUS: APPROVED BY KEVIN 2026-09-10 ("do both"). Classification: plan-gated (authorization + production data).**
> Plan-gated under `mmp-change-control` §1 because the change writes
> `pools/{id}.participantIds`, the array `firestore.rules` and every roster
> reader resolve membership from, and because the incident carries a one-off
> production repair. Plan → review log (`PLAN-ADMIN-PICK-IMPLICIT-JOIN-REVIEW-LOG.md`)
> → code, in the same PR: Kevin approved the fix in chat before the plan was
> written, so §6 records decisions already made, not questions still open.
>
> **Provenance (Kevin, verbatim):** *"I have an entry in this pool
> (https://www.marchmeleepools.com/pool/ubHD4bgszL05oURYubrn) but it is not
> listed in MY ENTRIES page."* Then, on the options in §5: *"do both"*.
>
> Measured on branch `claude/pool-entry-missing-my-entries-ffb057` from
> `origin/main` @ `59deb790`.

---

## 0. What went wrong, in one paragraph

Kevin is SUPER_ADMIN. The NFL pool page treats a super admin as a member and
shows the pick sheet without a Join button (`NFLPoolDashboard.tsx:759`), so the
client never called `joinNFLPool`. He submitted Week 1 picks; the server
admitted him through the SUPER_ADMIN branch of `assertNFLPickMembership`
(`functions/src/nflPools.ts`), wrote his entry and his Member Record — but the
only writer of `participantIds` is `joinNFLPoolInternal`, which never ran. The
commissioner then marked him PAID off the Member Record. My Entries filters on
`participantIds` (`ParticipantDashboard.tsx:498`), so the pool he is paid into
is invisible to him. Nothing a non-admin can do reproduces this.

## 1. What is true today — measured, not remembered

| Fact | Evidence |
|---|---|
| Pool `ubHD4bgszL05oURYubrn` ("Donkeys 2026", NFL_PICKEM, OPEN) has **22** `members/*` docs and **21** `participantIds` | read-only admin-SDK script, 2026-09-10 |
| The missing uid is `6C09waBoqiSavoBnPZrMkhxWt7x2` (Kevin). His Member Record: `role PARTICIPANT`, `joinedAt 2026-09-09T04:07:26Z`, `paidStatus PAID`, `hasPlayableEntry true`, `pickedWeeks [1]`. His entry doc holds 16 Week-1 picks. | same script |
| Across all 4 NFL pools in prod this is the **only** member absent from `participantIds` | census script, 4 pools scanned |
| `assertNFLPickMembership` admits (a) `participantIds` members, (b) owner / managerUid / createdByUid, (c) `tokenRole === 'SUPER_ADMIN'` | `nflPools.ts` |
| `submitNFLPicksInternal` writes the entry + `ensureMemberRecord` inside one transaction; **no `participantIds` write** | `nflPools.ts` |
| `ensureMemberRecord` never writes `participantIds`; only `reconcileMembership` does, and it has **no callers** | `lib/memberRecord.ts:376`; grep |
| `joinNFLPoolInternal` runs two seat gates before enrolling: free-plan cap (`FREE_PLAN_PARTICIPANT_CAP`) and paid ceiling (`assertPaidParticipantCeiling`) | `nflPools.ts` |
| `retryWhileScoring` re-runs the transaction **only** on the scoring-lease busy error | `lib/scoringLease.ts:278` |
| `participantIds` readers that would each see the drift: My Entries + All Pools tabs, `participantCount` on the dashboard, `reminderTargets`, `payoutRecords`, `userProfile`, `firestore.rules` `isPoolParticipant()` | grep |

## 2. Change

**Server.** In `submitNFLPicksInternal`'s transaction, after the pool read:

- `implicitJoin = !participantIds.includes(uid)`.
- If `implicitJoin` and the caller is **not** the host (owner / managerUid /
  createdByUid), run `assertJoinCapacity(poolInTx, participantIds.length)` —
  the same two gates `joinNFLPoolInternal` runs, hoisted into one exported
  helper so the two paths cannot drift.
- On the write side, `participantIds: arrayUnion(uid)` rides the **same**
  `poolRef` update as the `entryCount` patch, in the same transaction as the
  entry and the Member Record. `arrayUnion` is idempotent under retry.
- Also write `users/{uid}/participations/{poolId}`, the user-side mirror
  `joinNFLPoolInternal` writes, same shape.

**Client.** Nothing. The server is the only gate that matters; the client
already treats the admin as a member for display.

**Not changed.** `assertNFLPickMembership` still admits the bypass. The proxy
pick path (commissioner submitting for a member) is untouched — its subject is
already a member.

## 3. Production repair (one-off, dry-run first)

A one-off admin-SDK script mirroring what `joinNFLPoolInternal` writes for a
uid whose Member Record already exists: `participantIds arrayUnion(uid)`,
`users/{uid}/participations/{poolId}` with the Member Record's `joinedAt`, and
a `pools/{id}/audit` line naming the cause. Dry-run output was reviewed
(21 → would become 22, uid absent) before `--apply`. The write runs from Kevin's
shell — the session's auto-mode classifier refused to execute a production
write itself. No `entryCount` change: the submit path already moved it when
the Member Record's liability was stamped.

## 4. Tests (ship in this PR)

| Test | File | Guards |
|---|---|---|
| `assertJoinCapacity` — free cap, paid ceiling, trial, missing billing | `functions/src/__tests__/nflPickMembership.test.ts` | the hoisted helper is the gate `joinNFLPool` had |
| SUPER_ADMIN submit → `participantIds` gains the uid once, Member Record + participations written, resubmit does not duplicate | `functions/src/__tests__/emulator/adminImplicitJoin.emulator.test.ts` | the defect (fails on `origin/main`) |
| SUPER_ADMIN submit into a FULL free pool → refused with `FREE_PLAN_FULL_MESSAGE`, no entry / member / roster write | same | the bypass is not a way past the cap |
| an existing member of a full pool and a host absent from the roster both still submit | same | no regression on the ordinary and legacy-host paths |

## 5. Options Kevin was given

1. Data fix only. 2. Code fix only. 3. Both — recommended. **Chosen: 3.**

## 6. Decisions (recorded, already made)

| # | Decision | Recommendation taken | Why |
|---|---|---|---|
| D1 | Does the implicit join honour the seat gates? | **Yes** for the SUPER_ADMIN bypass; the host is exempt | A super admin submitting picks is a player, and a player takes a seat. Skipping the cap would make the bypass a way to over-fill a free pool. The host is never counted against their own ceiling (legacy pools may lack the owner in `participantIds`). Kevin can overrule; the change is one `if`. |
| D2 | Alternatively show the Join flow to super admins client-side? | **No** | The server is the gate. A client change would not fix an admin using an old bundle, and the server fix makes the client question moot. |
| D3 | Backfill every drifted pool with a job? | **No** — one-off script | The census found exactly one drifted uid across 4 NFL pools. A kill-switched job for one row is ceremony. |

## 7. Rollout

Functions deploy (`npx firebase deploy` after `git pull --ff-only` in the main
checkout, CLAUDE.md §3). No rules change, no frontend change. The NFL scorer is
live; this touches the submit path only, not the scoring engine.
