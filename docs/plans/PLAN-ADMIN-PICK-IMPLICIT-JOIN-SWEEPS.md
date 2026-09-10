# PLAN-ADMIN-PICK-IMPLICIT-JOIN — sweeps

Companion to `PLAN-ADMIN-PICK-IMPLICIT-JOIN.md`. The plan changes who writes
`pools/{id}.participantIds` and when; this file is the grep-built inventory of
everything that writes or reads it, with the conclusion for each, plus the
production instances the change reaches. Measured 2026-09-10 on
`claude/pool-entry-missing-my-entries-ffb057`. Written to close qodo #6 on
PR #686.

## S1 — writers of `participantIds` (functions)

`grep -rn "participantIds: FieldValue\|participantIds: \[" functions/src --include=*.ts` (tests excluded)

| Site | What it does | Affected by this plan? |
|---|---|---|
| `nflPools.ts` createNFLPool (`participantIds: [uid]`) | owner seeded at create | No. Unchanged. Every pool created through the callable has its owner on the roster. |
| `nflPools.ts` joinNFLPoolInternal (`arrayUnion`) | explicit join | **Yes — refactored, same writes.** The seat gates moved into `assertJoinCapacity`; the roster slot + participation mirror moved into `stageEnrollment`. Both are called with the identical arguments the inline code used. |
| `nflPools.ts` submitNFLPicksInternal (`arrayUnion` via `stageEnrollment`) | **new** implicit join | **Yes — this is the change.** Fires only when the submitter is absent from the in-transaction roster AND is admitted by the in-transaction `assertNFLPickMembership` (host or confirmed SUPER_ADMIN). Seat gates apply to the SUPER_ADMIN case; the host is exempt. |
| `lib/memberRecord.ts` applyMembershipRemoval (`arrayRemove`) | removal | No. The removal path is untouched; the in-transaction re-assert (qodo #2) is what keeps a pick from undoing it. |
| `lib/memberRecord.ts` reconcileMembership (`arrayUnion`) | reconciliation helper | No, and **it has no callers** (grep). Noted; not this plan's problem. |
| `lib/reminderTargets.ts:224` | comment only (pre-backfill shape) | No. |
| `bracketEntries.ts`, `bracketPools.ts`, `playoffPools.ts`, `poolOps.ts:904` | other pool types' joins / admin add-members | No. NFL-only change; these paths already write the slot on their own joins. |

## S2 — readers of `participantIds` (what the drift broke, what the fix reaches)

`grep -rln participantIds functions/src src firestore.rules` (tests excluded)

| Reader | Why it matters here | Conclusion |
|---|---|---|
| `firestore.rules` `isPoolParticipant()` (`request.auth.uid in resource.data.participantIds`) | picks/feed/roster READ access | A SUPER_ADMIN reads via the admin claim regardless, so the drift did not lock Kevin out; after the fix an implicitly joined admin is also a rules-level participant, which is the correct state for someone holding an entry. |
| `src/components/ParticipantDashboard.tsx:498` (My Entries) and the `processPools` membership filter | **the reported symptom** | Fixed by the data repair for the one drifted pool; prevented by the implicit join. |
| `NFLPoolDashboard.tsx:818` participantCount | header count | Was 21 on a 22-member pool; correct after repair. |
| `lib/reminderTargets.ts`, `manualReminders.ts` | who gets pick reminders | A roster-less entry holder got no reminders. Fixed by repair + implicit join. |
| `payoutRecords.ts:223`, `userProfile.ts:201` | payout / profile roster | Same class: roster-less member skipped. |
| `billing.ts` (free-plan warning email, `count >= FREE_PLAN_WARNING_AT`) | seat count | An implicit join now COUNTS toward the cap and the warning — which is why the SUPER_ADMIN case runs `assertJoinCapacity` (§D1). |
| `nflEntryRename.ts` (uses `assertNFLPickMembership`) | rename gate | Inherits the `ownerId`-canonical precedence (qodo #3). A stale `createdByUid` on a pool with a different `ownerId` can no longer rename entries either — consistent with `poolOps.isPoolOwnerOrManager`, which the rules and client already follow. |
| `poolExceptions.ts`, `setPaidStatus.ts`, `nflPickReveal.ts`, `lib/pickReveal.ts`, `lib/poolDues.ts`, `simHarness.ts`, `squares.ts`, other pool types | read the roster for their own gates | Unchanged semantics; they now see the implicitly joined uid, as they would after an explicit join. |
| Client: `JoinPool.tsx`, `BillingGate.tsx`, `GlobalCommissionerDashboard.tsx`, `NFLManagerView.tsx`, `PaymentLedgerNFL.tsx`, `SuperAdmin.tsx`, `utils/poolRoster.ts`, `utils/memberStandings.ts` | display / counts | Read-only consumers; all become correct for the drifted uid once the slot exists. |

## S3 — production instances

Read-only admin-SDK census over every NFL pool (`type in NFL_PICKEM / NFL_SURVIVOR / NFL_MARGIN`), members vs `participantIds`, 2026-09-10:

| Pool | Members | participantIds | Missing |
|---|---|---|---|
| `ubHD4bgszL05oURYubrn` "Donkeys 2026" | 22 | 21 | `6C09waBoqiSavoBnPZrMkhxWt7x2` (Kevin, SUPER_ADMIN, PAID, Week-1 picks) |
| the other 3 NFL pools | — | — | none |

One row. Repaired by the one-off script in plan §3 (dry-run reviewed; applied
from Kevin's shell). Non-NFL pool types were not censused: their join paths are
not touched by this plan and their pick paths have no SUPER_ADMIN bypass.

## S4 — behaviour changes a reader should know about

1. A SUPER_ADMIN submitting picks into a pool they never joined becomes a
   participant (roster + Member Record + mirror), and is refused with
   `FREE_PLAN_FULL_MESSAGE` / the paid-ceiling message if the pool is full.
2. A stale `createdByUid` on a pool whose `ownerId` differs is no longer admitted
   to submit or rename (was admitted before; qodo #3).
3. A member removed while their submission is in flight is refused
   `NOT_POOL_MEMBER` instead of having the entry written (qodo #2).
4. A replayed request (same `requestId`) stays a no-op success regardless of
   roster state or capacity (qodo #8).

Nothing changes for an ordinary member, the owner, or any non-NFL pool.
