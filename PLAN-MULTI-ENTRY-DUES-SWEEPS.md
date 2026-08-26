# PLAN-MULTI-ENTRY-DUES — the sweep pass

`mmp-change-control` Rule 3 step 3, and `PLAN-MULTI-ENTRY-DUES` §8. Owned by
ticket **P2-T7**.

A sweep is a **deterministic, grep-built, COMPLETE instance list** — it exists to
close the enumeration gap that per-finding review converges on too slowly. Four
fields changed meaning in Phase 2. This document names **every reader of each**,
outside tests, and gives each one a verdict.

---

## 1. The discipline this document is written under

Three rules, all of them written because the obvious shortcut is wrong.

**A verdict must state WHAT THE READER READS, not what the file is for.** "It is
the payments panel, so it is fine" is not a verdict — it is a category. The
verdict has to name the expression. This rule comes from the `PaymentsPanel`
incident: the file *sounds* like a per-entry payment surface, and it is not — it
reads `myMember?.paidStatus ?? myEntry?.paidStatus`, a member-level summary with
a legacy entry fallback, and the correct verdict follows from that line and from
nothing else.

**Bracket, Squares, Props and Playoffs readers are IN SCOPE for a NO-CHANGE
verdict, not for exclusion.** They read fields with the same names. An excluded
reader is one nobody checked; a NO-CHANGE reader is one somebody checked. The
difference matters the next time these fields move.

**A count is not a sweep.** Every row below carries a `file:line`, and the
`grep` that produced the list is in §2 so it can be re-run.

---

## 2. Method — the exact commands

Run from the repo root. Test files are excluded (`__tests__/`, `*.test.*`); they
are pinned by the suites the tickets shipped, not by this document.

⚠️ **The exclusions are PART OF THE COMMAND, not applied afterwards.** The first
draft printed the four bare greps and the counts below, which do not reproduce
from them — bare, they return 75/39/17/49 files (codex). A sweep whose stated
command does not produce its stated list is not an enumeration artifact.

```bash
for F in paidStatus feeOwed playableEntryCount entryCount; do
  echo "== $F"
  grep -rn --include=*.ts --include=*.tsx "\b$F\b" functions/src src shared \
    | grep -v '__tests__' | grep -v '[.]test[.]' \
    | cut -d: -f1 | sort -u
done
```

Both claims this document makes about itself are machine-checkable, and were
checked at the T7 commit: **every path the commands print appears verbatim in
§4, §5 or §6** (0 missing across all four fields), and **every subsection's
`(N files)` equals the number of distinct paths in it** — the counts were set
from that measurement, not typed.

**Every path those commands print is written out in full in §4, §5 or §6** — no
wildcards, no `{a,b}` brace shorthand, no `...` elision. The verdict lists are
therefore checkable by string match rather than by reading, which the first
draft was not: that is how the two omissions recorded in §4a and §4d survived
it.

Counts at the T7 commit — 121 file/field pairs across **106 distinct files**:

| Field | files | lines |
|---|---:|---:|
| `paidStatus` | 45 | 199 |
| `feeOwed` | 24 | 129 |
| `playableEntryCount` | 13 | 62 |
| `entryCount` | 39 | 146 |

---

## 3. What actually changed about each field

The verdicts below are all derived from this table, so it is the part to argue
with.

| Field | Before Phase 2 | After Phase 2 | The question every reader must survive |
|---|---|---|---|
| `paidStatus` (Member Record) | STORED, written only by `setPaidStatus` | **DERIVED** from the per-entry map, still STORED, and now written by four paths (`setPaidStatus`, `deleteNFLEntry`, `ensureMemberRecord` on a liability rise, `reconcilePaymentTruth`) | Does it assume one writer? Does it assume the value means anything other than **paid in full**? |
| `paidStatus` (Entry doc) | a payment mirror | **unchanged**, now also a legacy divergence source | Does it confuse the entry mirror with the member summary? |
| `feeOwed` | monotonic in practice — entries were only added | **can DECREASE** (`deleteNFLEntry` lowers it by one entry's share) | Does it assume dues only go up? |
| `playableEntryCount` | monotonic — no delete path existed | **can DECREASE** | Same. |
| `entryCount` (pool doc) | monotonic for NFL — no delete path existed | **can DECREASE** (D4 pot decrement) | Same, and: does it cache the value across a delete? |

**The semantics of `paidStatus` did NOT change.** It meant "this member has paid
their dues in full" before and it means that now. That is why the great majority
of readers below are NO-CHANGE: they consume the meaning, not the mechanism.

**The one thing that DID change is what is now REPRESENTABLE.** Before Phase 2 a
partial payment could not be recorded at all — one checkbox, all or nothing. It
can be recorded now. §7 is about the aggregate surfaces that still cannot
express it.

---

## 4. `paidStatus` — 45 files

### 4a. WRITERS (8 files) — the paths that must keep the derivation true

| File | What it reads / writes | Verdict |
|---|---|---|
| `functions/src/setPaidStatus.ts` | the whole per-entry cycle: reads `paidEntries`, writes the derived summary + ledger | ✅ **CHANGED by P2-T3.** The primary writer. |
| `functions/src/nflEntryDelete.ts` | reads the member record, re-derives after removing the entry, writes via `tx.update` | ✅ **CHANGED by P2-T4.** |
| `functions/src/lib/memberRecord.ts` | `liabilityRose` → writes `paidStatus: 'UNPAID'`; K11's reset DELETED | ✅ **CHANGED by P2-T2 (D6).** |
| `functions/src/migrations/reconcilePaymentTruth.ts` | reads the owner's whole entry set + the dues doc, writes `nextDues` + a **derived** summary | ✅ **CHANGED by this ticket (T7).** D1a's "the writer that will be missed" — it runs from Operations, sits in no hot path, and a summary-only write here would be un-paid by the next writer. |
| `functions/src/lib/poolDues.ts` | the sealed store's read/write helpers | ✅ **NEW in P2-T3.** |
| `functions/src/nflPoolDues.ts:65,78,136` | the `getPoolDues` callable. `:136` reads the **ENTRY document's** `paidStatus` into `paidMirrors`; `:65,78` are doc comments on the count-not-set rule and on that mirror | ✅ **NEW in P2-T5a, extended by T6.** 🛑 **Omitted from the first draft of this sweep** (codex P1) — a Phase 2 artifact missing from Phase 2's own enumeration, which is why §2 now insists the list be machine-checkable. |
| `functions/src/shared/memberRecord.ts` · `shared/memberRecord.ts` | `derivePaidStatus`, `liableEntryIds`, `isPaidRow` — the derivation itself | ✅ **CHANGED by P2-T1.** Two copies, kept identical by the existing sync check. |

### 4b. NO-CHANGE — reads the member summary, and "paid in full" still means that (8 files)

| File:line | What it reads |
|---|---|
| `functions/src/statsTrigger.ts:132` | `data.paidStatus === 'PAID' \|\| data.paid === true` on **BRACKET entry docs** — not the NFL member summary. |
| `functions/src/lib/reminderTargets.ts:160` | selects reminder targets on `paidStatus !== 'PAID'`. A partially-paid member is still owed money, so reminding them is correct. |
| `functions/src/nflPools.ts:678,707,815,1038` | **seeds** `'UNPAID'` on create/join. Seeding the safe value is still right; the derivation takes over on the first payment. |
| `functions/src/poolExceptions.ts:382,402,407,497` | seeds `'UNPAID'` on an exception entry, and `:497` says in as many words it has no payment context. |
| `functions/src/nflEntryRename.ts:25` | a comment listing `paidStatus` among fields it **must not write**. Still true, and now more load-bearing. |
| `src/components/NFLPoolDashboard/NFLManagerBentoDashboard.tsx:621` | `player.paidStatus === 'PAID'` → `baseDuesPaid` badge. A partially-paid member shows unpaid, which is honest at member level. |
| `src/components/PaymentsPanel.tsx:73,101` | `(myMember?.paidStatus ?? myEntry?.paidStatus) === 'PAID'` — member summary, entry doc only as a legacy fallback. **This is the file the §1 rule is named after.** |
| `src/components/admin/OperationsPanel.tsx:346` | a `blastRadius` **string** describing `reconcilePaymentTruth`. Prose, not a read. |

### 4c. NO-CHANGE — reads an ENTRY document or another collection, not the member summary (3 files)

Named explicitly because the field name collides, and telling the entry mirror
from the member summary is the distinction this whole sweep turns on. A future
sweep will grep these up; it should not have to re-derive which is which.

| File:line | What it reads |
|---|---|
| `functions/src/lib/commissionerAggregate.ts:19` | `w?.paidOut === true \|\| w?.paidStatus === 'PAID'` on a **payout/winnings** record with a `.amount` — not a Member Record. |
| `functions/src/nflScoringEngine.ts:855` | `if (e.paidStatus !== undefined) row.paidStatus = e.paidStatus` — copies an **entry document's** value into a standings row. (`:809` is the `StandingsRow` interface field, not the copy; the first draft cited the two together, which codex flagged as imprecise.) |
| `src/components/NFLPoolDashboard/NFLUserBentoDashboard.tsx:546,595,972` | **ENTRY documents, not the member record**: `:546,595` read `e.paidStatus` per standings row, `:972` reads `myEntry.paidStatus`. The first draft filed this under the member summary and was **wrong** (codex P2). Corrected here rather than quietly moved — the member/entry distinction is the one thing this sweep exists to keep straight, so a miss in it is worth recording. |

### 4d. NO-CHANGE — non-NFL pool types, types and simulators (22 files)

In scope, checked, unaffected: per-entry dues are NFL-only, and `getPoolDues` /
`deleteNFLEntry` both refuse a non-NFL pool type. Written out one per line
because §2 promises the list is checkable by string match.

| File | What it reads |
|---|---|
| `functions/src/bracketEntries.ts` (7 lines) | BRACKET entry payment state. |
| `functions/src/bracketOps.ts:39` | writes `paidStatus` on a BRACKET entry. |
| `functions/src/bracketScoring.ts:410-411` | counts PAID **bracket entries** for the bracket pot. |
| `functions/src/migrations/backfillMemberRecords.ts` | copies an existing value, never overwrites. |
| `functions/src/nflPoolTypes.ts` | type declaration. |
| `functions/src/schemas/poolEngagement.ts` | schema declaration. |
| `functions/src/types.ts` | type declaration. |
| `src/types/index.ts` | type declaration. |
| `src/types/nflPoolTypes.ts` | type declaration. |
| `src/services/dbService.ts:771,777` | passes a caller-supplied value straight to the callable. |
| `src/components/BracketPoolDashboard/BracketPoolDashboard.tsx` (13 lines) | BRACKET entry payment UI, incl. the `lockUnpaid` gate at `:582,636`. |
| `src/components/BracketPoolDashboard/PaymentLedger.tsx:44,68,73,99,192,439,477,507,518,520,525` | the **BRACKET** payment ledger — `entry.paidStatus` on bracket ENTRY documents throughout, incl. the pot at `:68` and the toggle at `:518`. 🛑 **Omitted from the first draft** (codex P1). It is the closest structural analogue to `PaymentLedgerNFL`, which makes it the single most embarrassing file to have missed and the most important to have a verdict on: it is untouched because bracket pools have one entry-fee liability per entry document already, and no member-level per-entry map. |
| `src/components/BracketPoolDashboard/ChalkComparison.tsx:106` | builds a synthetic PAID chalk entry. |
| `src/components/BracketPoolDashboard/ExportControls.tsx:55,62` | exports `e.paidStatus` to CSV. |
| `src/components/BracketPoolDashboard/StandingsTable.tsx:199` | a PAID badge on a bracket entry. |
| `src/components/ParticipantDashboard.tsx:395` | sums PAID **brackets**. |
| `src/components/ManagerDashboard.tsx:105,110,137,142` | squares `.squares[]` and the playoff `entries` map. |
| `src/components/SuperAdmin.tsx:208,2825-2832` | bracket entry paid toggle. |
| `src/components/TournamentSimulator/TournamentSimulator.tsx` | simulator fixtures. |
| `src/utils/testing/simulators/bracketE2ESimulator.ts` · `src/utils/testing/simulators/bracketSimulator.ts` · `src/utils/testing/simulators/nflSeasonSimulator.ts` | admin Test Suite simulators. They seed the field; they do not read production payment truth. |

### 4e. CHANGED by earlier P2 tickets (2 files)

| File | What it reads |
|---|---|
| `src/components/NFLPoolDashboard/PaymentLedgerNFL.tsx` (17 lines) | per-entry rows off `dues` / `liable` / `paidMirrors` from `getPoolDues`. ✅ **P2-T5b + T6.** |
| `src/components/NFLPoolDashboard/NFLManagerView.tsx` (6 lines) | fetches and pool-stamps the dues payload. ✅ **P2-T5b + T6.** |

### 4f. 🔴 CARRIES A FINDING (2 files)

`src/utils/poolRoster.ts:387,432` and `shared/memberRecord.ts:487` — see **§7**.

### 4g. Not production code (1 file)

`src/pages/DevDashboardPreview.tsx` (12 lines) — mock fixtures for the dev
preview page. No read of live data.

---

## 5. `feeOwed` — 24 files

The change: it can now DECREASE. Every reader below was checked for a
monotonicity assumption; **none holds one**, because none of them caches the
value — they all read it fresh per render or per run.

### 5a. WRITERS (7 files)

| File | What it writes | Verdict |
|---|---|---|
| `functions/src/nflEntryDelete.ts` (6 lines) | lowers `feeOwed` by one entry's share, in the same transaction as the count | ✅ **P2-T4.** |
| `functions/src/lib/memberRecord.ts` (5) · `functions/src/shared/memberRecord.ts` · `shared/memberRecord.ts` (14 each) | `entryFee x memberLiableEntries` (D2) | ✅ **P2-T1/T2.** |
| `functions/src/poolOps.ts:679-684` | a fee-RATE change cascades `feeOwed: newFee * memberLiableEntries(rec)`, and `:680` keeps a seeded host at 0 | ✅ **NO-CHANGE, and deliberately so.** A rate change is not a liability rise, so it correctly does **not** unpay anybody. The per-entry map is untouched, so the derived summary is unchanged. |
| `functions/src/migrations/backfillProfileData.ts:177-187` | stamps `feeOwed` only where absent (`:181 if (rec.feeOwed !== undefined) continue`), marked `BACKFILL_ESTIMATE` | ✅ **NO-CHANGE.** Never rewrites a live stamp, so it cannot fight the T4 decrement. |
| `functions/src/expertProfiles.ts:106` | writes `feeOwed: 0` for a synthetic expert profile | ✅ **NO-CHANGE.** |

### 5b. NO-CHANGE — reads the stamp as the member's current total (12 files)

| File:line | What it reads |
|---|---|
| `functions/src/lib/profileBuild.ts:113,123` | `year.fees += p.feeOwed` / `feesOwed += p.feeOwed` — sums the CURRENT stamp across pools. A lowered stamp lowers the profile total, which is the correct new answer. |
| `functions/src/userProfile.ts:105,229,240` | `(Number(member.feeOwed) \|\| 0) + rebuyOwed`, with `:28` recording that the stamp is already multiplied (D2). |
| `functions/src/lib/reminderTargets.ts:161,235-241` | uses `rec.feeOwed === undefined` to tell an unstamped legacy record from a deliberate `feeOwed: 0` host. Unaffected: T4 lowers a stamp, it never removes one. |
| `functions/src/shared/profile.ts:154,157` · `shared/profile.ts:154,157` | type + `feesEstimated` flag. |
| `functions/src/statsTrigger.ts:31` | a comment: the per-record stamp wins over the pool fee. Still true. |
| `functions/src/nflPools.ts:216,330,867-886` · `functions/src/poolExceptions.ts:365` | the ADR-0005 seeded-host rules and the `0 -> fee` fill-on-touch upgrade. Unaffected — these raise liability, and the T2 rule already handles a rise. |
| `functions/src/nflEntryRename.ts:25` | lists `feeOwed` among fields it must not write. Still true. |
| `src/components/NFLPoolDashboard/NFLManagerBentoDashboard.tsx:238` | comment on the free-pool / seeded-host zero. |
| `src/components/admin/OperationsPanel.tsx:363-364` | `blastRadius` prose. |
| `src/components/PaymentsPanel.tsx:84,90,100,107` | `myRow.feeOwed ?? rates.entryFee` — the member's own outstanding total. |

### 5c. CHANGED by earlier P2 tickets (1 file)

`src/components/NFLPoolDashboard/PaymentLedgerNFL.tsx` (27 lines) — splits the
authoritative `feeOwed` across the liable rows so the rows sum to it exactly.
✅ **P2-T5b.**

### 5d. 🔴 CARRIES A FINDING (2 files)

`src/utils/poolRoster.ts:386-387,424,432` and `shared/memberRecord.ts:485-487` —
see **§7**.

---

## 6. `playableEntryCount` (13 files) and `entryCount` (39 files)

Both can now DECREASE. The sweep looked for exactly one thing — a reader that
assumes otherwise.

### 6a. The monotonicity hunt, and its result (1 file)

```bash
grep -rn 'Math.max(.*entryCount\|Math.max(.*feeOwed' functions/src src shared
grep -rn 'increment(' functions/src | grep -i entrycount
grep -rn 'entryCount ??\|entryCount ||'  functions/src src shared
```

**Result: no reader holds a monotonicity assumption.** The two `Math.max` hits
are `src/components/SuperAdmin.tsx:232,239`, and they are **optimistic UI after a
server delete** — the component calls `deleteBracketEntry` / `adminDeleteEntry`
and then decrements its own local copy. That is a decrement, not an assumption
that the value only rises. The `?? 0` / `|| 0` hits are all absent-field
defaults.

### 6b. The load-bearing one — the prize snapshot (7 files)

| File:line | What it reads | Verdict |
|---|---|---|
| `functions/src/nflFinalize.ts:304-305` | `freshPool.entryCount` (falling back to a live entry-doc count) → `computeSeasonPrizeSnapshot` | ✅ **NO-CHANGE, and this is why D3 is load-bearing.** A decrement here would change a payout. It cannot happen after scoring begins, because `deleteNFLEntry` refuses on D3 — tested on the **POOL**, not the entry. D3 is what makes D4's decrement safe; if D3 is ever weakened, this line is the first casualty. |
| `functions/src/shared/seasonPrizes.ts:39-84` · `shared/seasonPrizes.ts` · `functions/src/shared/weeklyPrizes.ts:45-106` · `shared/weeklyPrizes.ts` | `potBreakdown(settings, entryCount)`, with the source comment "every entry, not only PAID (**D8**)" | ✅ **NO-CHANGE.** Pure functions over a caller-supplied number. Already written against D8. |
| `functions/src/nflScoringEngine.ts:924` | comment: the pot/places/entryCount are **frozen** at snapshot time | ✅ **NO-CHANGE**, and it is the reason the above holds. |
| `src/components/NFLPoolDashboard/WeeklyWinnersList.tsx:79` | renders `prize.entryCount` from the **frozen snapshot**, not the live pool | ✅ **NO-CHANGE.** |

### 6c. Billing — checked because it is money (1 file)

`functions/src/billing.ts:386` — `count = after.entryCount || 0`, the paid-tier
ceiling check. ✅ **NO-CHANGE.** A decrement moves a pool **further below** a
ceiling, never above one, so the failure direction is "a pool stays allowed",
which is the direction that costs nobody anything. `bracketEntries.ts:46,53,80`
and `propBets.ts:75` read it for the same ceiling with the same direction.

### 6d. WRITERS (4 files)

| File | Verdict |
|---|---|
| `functions/src/lib/multiEntry.ts` (12 lines) | `entryCountWrite` / `entryCountAfterDelete`, clamped at 0, derived from Member Records when the field is absent. ✅ **P2-T2/T4.** |
| `functions/src/nflEntryDelete.ts` (7) | the D4 decrement. ✅ **P2-T4.** |
| `functions/src/bracketEntries.ts:106,389,527` · `functions/src/propBets.ts:99` | `FieldValue.increment(±1)` on **their own** pool types. ✅ **NO-CHANGE** — a pool has one type, so these never share a counter with the NFL path. |

### 6e. NO-CHANGE — display and capacity (7 files)

`src/components/BrowsePools.tsx:299,316` · `src/components/Dashboards/GlobalStandingsCard.tsx:33` ·
`src/components/ManagerDashboard.tsx:109,141,673,698` · `src/components/PayoutsPanel.tsx:10-13,329,350,514,517`
(falls back to `pool.entryCount` when no explicit count is passed) ·
`src/components/billing/BillingGate.tsx:273` · `src/components/admin/MembersTab.tsx:1221`
(a comment about a past bug) · `src/utils/poolSport.ts:75-106` (`:88` records that
NFL season pools have no maintained `entryCount` — **this comment is now stale for
NFL pools that have been through T2**; harmless, since `:97,103` already read
`?? 0` and the `entries` map stays authoritative on that path, but it is worth
knowing it is prose that has aged).

All render a filled/capacity figure fresh. A decrement simply renders the
smaller number.

### 6f. NO-CHANGE — types, sims, scenarios (12 files)

`functions/src/types.ts` · `src/types/index.ts` · `src/types/nflPoolTypes.ts` ·
`functions/src/nflPoolTypes.ts` · `functions/src/shared/simGen.ts` · `shared/simGen.ts` ·
`src/components/TournamentSimulator/TournamentSimulator.tsx` ·
`src/utils/testing/scenarios/assertionRunner.ts` · `src/utils/testing/scenarios/index.ts` ·
`src/utils/testing/simulators/bracketE2ESimulator.ts` ·
`src/utils/testing/simulators/bracketSimulator.ts` ·
`src/utils/testing/simulators/propsSimulator.ts`.

### 6g. `playableEntryCount` — remaining readers (6 files)

| File:line | What it reads | Verdict |
|---|---|---|
| `functions/src/nflPools.ts:566,881` · `functions/src/poolExceptions.ts:516` | writes `ownerState.playableEntryCount` from the derived owner state | ✅ **P2-T2.** |
| `functions/src/poolOps.ts:679` | reads it to multiply a fee-rate change | ✅ **NO-CHANGE** (see §5a). |
| `functions/src/userProfile.ts:29` | comment recording `entryFee x playableEntryCount` (D2) | ✅ **NO-CHANGE.** |
| `src/components/NFLPoolDashboard/PaymentLedgerNFL.tsx:423,430` | `played` for the delete-confirmation arithmetic | ✅ **P2-T6.** |
| `src/components/PaymentsPanel.tsx:85,114-115` | `entryFee x max(joinLiability, playableEntryCount)` for the viewer's own outstanding | ✅ **NO-CHANGE.** Reads fresh; a decrement lowers what it shows, correctly. |

---

## 7. 🔴 THE FINDING THIS SWEEP FOUND — and it is NOT fixed here

### What it is

**Three aggregate money surfaces treat a partially-paid member as having paid
nothing.** They read only the all-or-nothing summary, and Phase 2 made partial
payment representable for the first time.

| File:line | The expression |
|---|---|
| `shared/memberRecord.ts:487` (and the `functions/src/shared` copy) | `if (m.paidStatus === 'PAID') collected += fee;` |
| `src/utils/poolRoster.ts:387` | `const base = row.paidStatus === 'PAID' ? 0 : fee;` |
| `src/utils/poolRoster.ts:432` | `if (m.paidStatus === 'PAID') { ... }` |

`memberDues` (line 487) feeds `computeRosterSummary`, which feeds
**`statsTrigger.memberRecordsPot` → `stats/global.prizePot`, a WORLD-READABLE
document**, plus `lib/rosterSummary.ts` (the commissioner roster) and
`commissionerAggregate.duesCollected`.

### Demonstrated, not argued

A member owing $50 for two entries, with entry 1 marked paid:

```
liableEntryIds  -> ['e2:u1', 'u1']
derivePaidStatus -> 'UNPAID'          (correct — they are not paid in full)
memberDues       -> { expected: 50, collected: 0 }
                                   ^^ $25 was actually collected
```

Control, both entries paid: `collected: 50`. So the arithmetic is right at the
extremes and blind in the middle.

### Why it is new

Before Phase 2 the middle did not exist. One checkbox meant $0 or $50, and
`collected` was right in both cases. P2-T3 made the middle reachable.

### Direction, and how bad

**It UNDER-counts.** A published pot reads low, and the commissioner roster shows
a partially-paid member owing their full dues rather than the remainder. Nobody
is over-charged and no payout is inflated. It is the same failure direction as
the `rebuyPaid` gap already recorded at `functions/src/statsTrigger.ts:35-42`.

Reachable only on a multi-entry NFL pool where a commissioner marks **some but
not all** of a member's entries paid — which is precisely the workflow Phase 2
was built to enable, so it will be reached.

**The commissioner ledger itself is CORRECT.** `PaymentLedgerNFL` reads the
per-entry `dues` and `liable` from `getPoolDues` and shows entry-level truth.
This finding is confined to surfaces that read only the summary.

### Why T7 does not fix it

The honest figure needs a per-entry-aware number, and the per-entry map is
**sealed** by D1 (`private/dues__{uid}`, `allow read: if false`).
`computeRosterSummary` lives in `shared/` and runs on the client too, where the
map is unreadable by construction. So a fix is one of:

- **(a)** mirror a `paidEntryCount: number` onto the Member Record, and have
  `memberDues` use it. Consistent with D1's own reasoning — a *count* is already
  published as `playableEntryCount`; it is *which* entries that D1 seals. But it
  adds a field on a participant-readable document and a new write to every dues
  path.
- **(b)** teach only the server-side pot (`statsTrigger`, Admin SDK) to read the
  sealed map, and leave the client surfaces summary-only. Fixes the
  world-readable number, leaves the roster card inconsistent with the ledger
  beside it.
- **(c)** accept the under-count and pin it with a test, as the `rebuyPaid` gap
  already is.

Each changes a money figure and adds or refuses a field on a
participant-readable document. **That is a plan decision under `mmp-change-control`
Rule 3, not a sweep.** T7's job is to find this and name it; choosing is Kevin's.

**Status: OPEN. Carried, not silently held.**

---

## 8. What this sweep does NOT cover

Stated so the next reader knows the edges.

- **Test files.** Excluded from the grep. Covered by the suites each ticket
  shipped.
- **Firestore rules.** D11 says no rules change, and none was made — verified by
  `git diff origin/main...HEAD -- firestore.rules` being empty across P2.
- **Historical data.** A pool that has never been touched by a Phase 2 writer
  keeps its pre-P2 field values. Every reader above tolerates an absent field;
  `reconcilePaymentTruth` (§4a) is the deliberate repair path.
- **Field names other than these four.** `rebuyOwed`, `rebuyPaid`, `unitsPaid`,
  `memberReportedPaid` were not swept — Phase 2 did not change their meaning.
  `rebuyPaid` carries its own pre-existing gap, already recorded in
  `functions/src/statsTrigger.ts:35-42`.
