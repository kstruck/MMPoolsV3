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

### The invariant this document holds itself to

⚠️ **Resolve a file against the SUBSECTION, not the top-level section**, when
checking this document by script: §6 covers two fields, so "appears in §6" does
not mean "has a verdict for the field you are checking". This is written down
because a checker without it reported a clean result on five unaccounted pairs
(see §6h).

**Every path those four commands print appears verbatim somewhere in §4, §5 or
§6** — no wildcards, no `{a,b}` brace shorthand, no `...` elision, and no path
written without its `functions/src/`, `src/` or `shared/` prefix. So the list is
checkable by string match rather than by reading. Verified at the T7 commit:
**0 missing across all four fields.**

⚠️ **The unit of verdict is a (FILE, FIELD) PAIR, not a file — and where one
verdict covers a file's readings of several fields, the other fields' sections
CROSS-REFERENCE it (§5e, §6h) rather than staying silent.** 106 distinct
files produce 121 pairs, because many read two or three of the four fields, and
those readings can deserve different verdicts — `functions/src/nflPools.ts`
carries three, one each in §4b, §5b and §6g, and that is correct rather than
duplication. A subsection's `(N verdicts)` is therefore a count of the pairs
written up there, and the per-field totals in the table below are grep totals of
FILES. The two are different units and do not add up to each other.

Two earlier drafts got this wrong in opposite directions: one claimed each
subsection's count equalled that field's reader count (false — a file's verdict
may sit under another field, codex r3), the next claimed one verdict per file
(false — `nflPools.ts` alone disproves it, codex r4). This is the version that
survives being checked.

Three things this document got wrong before review, all recorded in place rather
than quietly fixed, because a sweep that hides its own misses is the artifact it
is meant to replace: two omitted readers (§4a, §4d), a member-vs-entry
misclassification (§4c), and a read-only callable filed under WRITERS (§4c).

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

## 4. `paidStatus` — 45 files in the grep list

### 4a. WRITERS (7 verdicts) — the paths that must keep the derivation true

| File | What it reads / writes | Verdict |
|---|---|---|
| `functions/src/setPaidStatus.ts` | the whole per-entry cycle: reads `paidEntries`, writes the derived summary + ledger | ✅ **CHANGED by P2-T3.** The primary writer. |
| `functions/src/nflEntryDelete.ts` | reads the member record, re-derives after removing the entry, writes via `tx.update` | ✅ **CHANGED by P2-T4.** |
| `functions/src/lib/memberRecord.ts` | `liabilityRose` → writes `paidStatus: 'UNPAID'`; K11's reset DELETED | ✅ **CHANGED by P2-T2 (D6).** |
| `functions/src/migrations/reconcilePaymentTruth.ts` | reads the owner's whole entry set + the dues doc, writes `nextDues` + a **derived** summary | ✅ **CHANGED by this ticket (T7).** D1a's "the writer that will be missed" — it runs from Operations, sits in no hot path, and a summary-only write here would be un-paid by the next writer. |
| `functions/src/lib/poolDues.ts:46,64,82` | `poolRef.collection('private').doc(`dues__${uid}`)` (`:46`); `readPoolDues` returns `snap.data()?.paidEntries` (`:64`); `writePoolDues` takes a complete `paidEntries: PaidEntryMap` and `tx.set`s it **without merge**, so a removal is expressible (`:82`). | ✅ **NEW in P2-T3.** |
| `functions/src/shared/memberRecord.ts` · `shared/memberRecord.ts` | `derivePaidStatus`, `liableEntryIds`, `isPaidRow` — the derivation itself | ✅ **CHANGED by P2-T1.** Two copies, kept identical by the existing sync check. |

### 4b. NO-CHANGE — reads the member summary, and "paid in full" still means that (7 verdicts)

| File:line | What it reads |
|---|---|
| `functions/src/lib/reminderTargets.ts:160` | selects reminder targets on `paidStatus !== 'PAID'`. A partially-paid member is still owed money, so reminding them is correct. |
| `functions/src/nflPools.ts:678,707,815,1038` | **seeds** `'UNPAID'` on create/join. Seeding the safe value is still right; the derivation takes over on the first payment. |
| `functions/src/poolExceptions.ts:382,402,407,497` | seeds `'UNPAID'` on an exception entry, and `:497` says in as many words it has no payment context. |
| `functions/src/nflEntryRename.ts:25` | a comment listing `paidStatus` among fields it **must not write**. Still true, and now more load-bearing. |
| `src/components/NFLPoolDashboard/NFLManagerBentoDashboard.tsx:621` | `player.paidStatus === 'PAID'` → `baseDuesPaid` badge. A partially-paid member shows unpaid, which is honest at member level. |
| `src/components/PaymentsPanel.tsx:73,101` | `(myMember?.paidStatus ?? myEntry?.paidStatus) === 'PAID'` — member summary, entry doc only as a legacy fallback. **This is the file the §1 rule is named after.** |
| `src/components/admin/OperationsPanel.tsx:346` | a `blastRadius` **string** describing `reconcilePaymentTruth`. Prose, not a read. |

### 4c. NO-CHANGE — reads an ENTRY document or another collection, not the member summary (5 verdicts)

Named explicitly because the field name collides, and telling the entry mirror
from the member summary is the distinction this whole sweep turns on. A future
sweep will grep these up; it should not have to re-derive which is which.

| File:line | What it reads |
|---|---|
| `functions/src/lib/commissionerAggregate.ts:19` | `w?.paidOut === true \|\| w?.paidStatus === 'PAID'` on a **payout/winnings** record with a `.amount` — not a Member Record. |
| `functions/src/statsTrigger.ts:132,155` | `:132` `data.paidStatus === 'PAID' \|\| data.paid === true` over `pools/{id}/entries` — **BRACKET entry docs**; `:155` the same predicate over the **`pool.entries` map** for NFL_PLAYOFFS. The NFL-season branch does not go through either; it calls `memberRecordsPot`. Filed under the member summary in an earlier draft, which its own row text contradicted (codex r4). |
| `functions/src/nflPoolDues.ts:136` | `if (data.paidStatus === 'PAID') paidMirrors.push(e.id)` over `pools/{id}/entries` — the **ENTRY document** mirror, gathered for the ledger. `:65,78` are doc comments, not reads. 🛑 The first draft of this sweep OMITTED this file entirely (codex r2), and the repair then filed it under **WRITERS** (codex r3) — `getPoolDues` is read-only and writes none of the four fields. Two wrong verdicts on one Phase 2 artifact; both recorded rather than quietly corrected. |
| `functions/src/nflScoringEngine.ts:855` | `if (e.paidStatus !== undefined) row.paidStatus = e.paidStatus` — copies an **entry document's** value into a standings row. (`:809` is the `StandingsRow` interface field, not the copy; the first draft cited the two together, which codex flagged as imprecise.) |
| `src/components/NFLPoolDashboard/NFLUserBentoDashboard.tsx:546,595,972` | **ENTRY documents, not the member record**: `:546,595` read `e.paidStatus` per standings row, `:972` reads `myEntry.paidStatus`. The first draft filed this under the member summary and was **wrong** (codex P2). Corrected here rather than quietly moved — the member/entry distinction is the one thing this sweep exists to keep straight, so a miss in it is worth recording. |

### 4d. NO-CHANGE — non-NFL pool types, types and simulators (22 verdicts)

In scope, checked, unaffected: per-entry dues are NFL-only, and `getPoolDues` /
`deleteNFLEntry` both refuse a non-NFL pool type. Written out one per line
because §2 promises the list is checkable by string match.

Each row names **the expression and the collection**, not the file's purpose —
codex r3 flagged the first draft of this table for doing the latter, which is
the exact failure mode §1 is written against.

| File | The expression, and what it is read off |
|---|---|
| `functions/src/bracketEntries.ts:96,225` | writes `paidStatus: "UNPAID"` onto a new **bracket entry doc**; `:225` gates on `entryData.paidStatus !== 'PAID'` for `lockUnpaid`. |
| `functions/src/bracketOps.ts:39` | writes `paidStatus: isPaid ? 'PAID' : 'UNPAID'` onto a **bracket entry doc**. |
| `functions/src/bracketScoring.ts:410-411` | `entriesSnap.docs...filter(e => e.paidStatus === 'PAID')` over `pools/{id}/entries` — **bracket entry docs**, for the bracket pot. |
| `functions/src/migrations/backfillMemberRecords.ts:88,274` | `:88` `add(e.ownerUid \|\| d.id, { userName: e.userName, paidStatus: e.paidStatus })` — harvests from the **`entries` subcollection**; `:274` writes `paidStatus: src.paidStatus === 'PAID' ? 'PAID' : 'UNPAID'` onto the Member Record, and never overwrites an existing one. (`:3,20` are a comment and the `PoolMemberSource` type — cited alone in an earlier draft, which named no read at all, codex r4.) |
| `functions/src/nflPoolTypes.ts:233,265,290` | `paidStatus: 'PAID' \| 'UNPAID'` — three **type declarations**, no read. |
| `functions/src/schemas/poolEngagement.ts:89` | `paidStatus: z.enum(["PAID","UNPAID"])` — the `setPaidStatus` **request schema**, no read. |
| `functions/src/types.ts:375` | `paidStatus: 'PAID' \| 'UNPAID'` — **type declaration**. |
| `src/types/index.ts:825` | `paidStatus: 'PAID' \| 'UNPAID'` — **type declaration**. |
| `src/types/nflPoolTypes.ts:318,337,356` | `paidStatus: 'PAID' \| 'UNPAID'` — **type declarations**. |
| `src/services/dbService.ts:771,777` | `paidStatus` is a **parameter** forwarded verbatim to the callable; the function reads nothing. |
| `src/components/BracketPoolDashboard/BracketPoolDashboard.tsx:433,582,636,909-910,1149-1150,1977,1981,2006,2012` | on **bracket entry docs**: `activeEntry?.paidStatus !== 'PAID'` for `lockUnpaid` (`:582,636`), `entries.filter(e => e.paidStatus === 'PAID').length * entryFee` for the collected/outstanding tiles (`:1977,1981`), badges and the toggle. **`:251` is NOT one of these** — it is `setViewingEntry({ ..., paidStatus: 'PAID' })`, an **in-memory synthetic "Master Bracket" print object** that is never persisted and never read back. Lumping it in with the entry-doc reads made the collection claim false (codex r4). |
| `src/components/BracketPoolDashboard/PaymentLedger.tsx:44,68,73,99,192,439,477,507,518,520,525` | the **BRACKET** payment ledger — `entry.paidStatus` on bracket ENTRY documents throughout, incl. the pot at `:68` and the toggle at `:518`. 🛑 **Omitted from the first draft** (codex P1). It is the closest structural analogue to `PaymentLedgerNFL`, which makes it the single most embarrassing file to have missed and the most important to have a verdict on: it is untouched because bracket pools have one entry-fee liability per entry document already, and no member-level per-entry map. |
| `src/components/BracketPoolDashboard/ChalkComparison.tsx:106` | writes a literal `paidStatus: 'PAID'` into a synthetic in-memory chalk **bracket entry**. Never persisted, never read back. |
| `src/components/BracketPoolDashboard/ExportControls.tsx:55,62` | `PaidStatus: e.paidStatus \|\| 'UNPAID'` — a CSV column off each **bracket entry doc**. |
| `src/components/BracketPoolDashboard/StandingsTable.tsx:199` | `entry.paidStatus === 'PAID'` on a **bracket entry doc**, for a badge. |
| `src/components/ParticipantDashboard.tsx:395` | `myBrackets.some(e => e.paidStatus === 'PAID')` then `entriesPaid += fee` — over the viewer's **bracket entries**, not any Member Record. |
| `src/components/ManagerDashboard.tsx:105,110,137,142` | `sq.squares?.filter(s => s.owner && s.paidStatus === 'PAID')` (the **squares array**) and `Object.values(anyP.entries).filter(e => e.paidStatus === 'PAID')` (the **playoff `entries` map on the pool doc**). Neither is a Member Record. |
| `src/components/SuperAdmin.tsx:208,2825-2832` | `entry.paidStatus === 'PAID'` on rows of `viewingPoolEntries` — **entry docs**; `:208` sets the new value locally after the toggle callable returns. |
| `src/components/TournamentSimulator/TournamentSimulator.tsx:229,286` | writes a literal `paidStatus: 'PAID'` onto simulated **bracket entries**. No read. |
| `src/utils/testing/simulators/bracketE2ESimulator.ts:191` · `src/utils/testing/simulators/bracketSimulator.ts:196` · `src/utils/testing/simulators/nflSeasonSimulator.ts:312` | each **writes** a literal `paidStatus: 'PAID'` when seeding a simulated entry. None reads the field, and none reads a Member Record. |

### 4e. CHANGED by earlier P2 tickets (2 verdicts)

| File | What it reads |
|---|---|
| `src/components/NFLPoolDashboard/PaymentLedgerNFL.tsx` (17 lines) | per-entry rows off `dues` / `liable` / `paidMirrors` from `getPoolDues`. ✅ **P2-T5b + T6.** |
| `src/components/NFLPoolDashboard/NFLManagerView.tsx:285,301,309,311-313` | reads **only callable output**, never a document: `duesPayload?.poolId === pool.id ? duesPayload.dues : undefined` and the same guard for `.liable` and `.paidMirrors` (`:311-313`), off `getPoolDues`. `:285,309` are comments recording that an absent payload makes the ledger fall back to the member-level `paidStatus`. ✅ **P2-T5b + T6.** |

### 4f. 🔴 CARRIES A FINDING (2 verdicts)

`src/utils/poolRoster.ts:387,432` and `shared/memberRecord.ts:487` — see **§7**.

### 4g. Not production code (1 verdict)

| File:line | The expression |
|---|---|
| `src/pages/DevDashboardPreview.tsx:130-133` (and 8 more) | object **literals** of the form `{ id: 'demo', ownerUid: 'demo', userName: 'Kevin Struck', totalScore: 34, paidStatus: 'PAID', ... }` — hard-coded standings-row fixtures in the file's own source. Nothing is read from Firestore, and no Member Record or entry document is involved. |

---

## 5. `feeOwed` — 24 files in the grep list

The change: it can now DECREASE. Every reader below was checked for a
monotonicity assumption; **none holds one**, because none of them caches the
value — they all read it fresh per render or per run.

### 5a. WRITERS (7 verdicts)

| File | What it writes | Verdict |
|---|---|---|
| `functions/src/nflEntryDelete.ts` (6 lines) | lowers `feeOwed` by one entry's share, in the same transaction as the count | ✅ **P2-T4.** |
| `functions/src/lib/memberRecord.ts` (5) · `functions/src/shared/memberRecord.ts` · `shared/memberRecord.ts` (14 each) | `entryFee x memberLiableEntries` (D2) | ✅ **P2-T1/T2.** |
| `functions/src/poolOps.ts:679-684` | a fee-RATE change cascades `feeOwed: newFee * memberLiableEntries(rec)`, and `:680` keeps a seeded host at 0 | ✅ **NO-CHANGE, and deliberately so.** A rate change is not a liability rise, so it correctly does **not** unpay anybody. The per-entry map is untouched, so the derived summary is unchanged. |
| `functions/src/migrations/backfillProfileData.ts:177-187` | stamps `feeOwed` only where absent (`:181 if (rec.feeOwed !== undefined) continue`), marked `BACKFILL_ESTIMATE` | ✅ **NO-CHANGE.** Never rewrites a live stamp, so it cannot fight the T4 decrement. |
| `functions/src/expertProfiles.ts:106` | writes `feeOwed: 0` for a synthetic expert profile | ✅ **NO-CHANGE.** |

### 5b. NO-CHANGE — reads the stamp as the member's current total (12 verdicts)

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

### 5c. CHANGED by earlier P2 tickets (1 verdict)

`src/components/NFLPoolDashboard/PaymentLedgerNFL.tsx` (27 lines) — splits the
authoritative `feeOwed` across the liable rows so the rows sum to it exactly.
✅ **P2-T5b.**

### 5d. 🔴 CARRIES A FINDING (2 verdicts)

`src/utils/poolRoster.ts:386-387,424,432` and `shared/memberRecord.ts:485-487` —
see **§7**.

---

### 5e. Cross-referenced — their `feeOwed` verdict is in §4 (3 verdicts)

These three read `feeOwed` too, but their whole Phase 2 story is one story and
splitting it across sections would create two places to drift. Listed here so
the field's 24 files are all accounted for rather than silently absent.

| File | Where its verdict is |
|---|---|
| `functions/src/setPaidStatus.ts` | §4a — it writes `feeOwed`'s per-entry split alongside the derived summary. |
| `functions/src/lib/poolDues.ts` | §4a — `snap.data()?.paidEntries` off `private/dues__{uid}`; its `feeOwed` mention is the header comment at `:28` noting both fields must move in one transaction. |
| `src/components/NFLPoolDashboard/NFLManagerView.tsx` | §4e — reads callable output only, no document. |

---

## 6. `playableEntryCount` (13 files) and `entryCount` (39 files) in the grep list

Both can now DECREASE. The sweep looked for exactly one thing — a reader that
assumes otherwise.

### 6a. The monotonicity hunt, and its result (1 verdict)

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

### 6b. The load-bearing one — the prize snapshot (7 verdicts)

| File:line | What it reads | Verdict |
|---|---|---|
| `functions/src/nflFinalize.ts:304-305` | `freshPool.entryCount` (falling back to a live entry-doc count) → `computeSeasonPrizeSnapshot` | ✅ **NO-CHANGE, and this is why D3 is load-bearing.** A decrement here would change a payout. It cannot happen after scoring begins, because `deleteNFLEntry` refuses on D3 — tested on the **POOL**, not the entry. D3 is what makes D4's decrement safe; if D3 is ever weakened, this line is the first casualty. |
| `functions/src/shared/seasonPrizes.ts:39-84` · `shared/seasonPrizes.ts` · `functions/src/shared/weeklyPrizes.ts:45-106` · `shared/weeklyPrizes.ts` | `potBreakdown(settings, entryCount)`, with the source comment "every entry, not only PAID (**D8**)" | ✅ **NO-CHANGE.** Pure functions over a caller-supplied number. Already written against D8. |
| `functions/src/nflScoringEngine.ts:924` | comment: the pot/places/entryCount are **frozen** at snapshot time | ✅ **NO-CHANGE**, and it is the reason the above holds. |
| `src/components/NFLPoolDashboard/WeeklyWinnersList.tsx:79` | renders `prize.entryCount` from the **frozen snapshot**, not the live pool | ✅ **NO-CHANGE.** |

### 6c. Billing — checked because it is money (3 verdicts)

| File:line | What it reads |
|---|---|
| `functions/src/billing.ts:386` | `count = after.entryCount \|\| 0` — the paid-tier ceiling check. |
| `functions/src/bracketEntries.ts:46,53,80` | `poolData.entryCount \|\| 0` against `maxTotal` and `assertPaidParticipantCeiling`. |
| `functions/src/propBets.ts:75` | `poolData.entryCount \|\| 0` against the same ceiling. |

✅ **NO-CHANGE, all three.** A decrement moves a pool **further below** a ceiling,
never above one, so the failure direction is "a pool stays allowed" — the
direction that costs nobody anything. (The first draft named the latter two only
in prose without their `functions/src/` prefix, which defeated the machine check
and let the header say `(1 file)` while three were named — codex r3.)

### 6d. WRITERS (7 verdicts)

| File | Verdict |
|---|---|
| `functions/src/lib/multiEntry.ts` (12 lines) | `entryCountWrite` / `entryCountAfterDelete`, clamped at 0, derived from Member Records when the field is absent. ✅ **P2-T2/T4.** |
| `functions/src/nflEntryDelete.ts` (7) | the D4 decrement. ✅ **P2-T4.** |
| `functions/src/nflPools.ts:171,293-309,348,541-555,897-899,1209-1224` | writes `entryCount: 0` at pool creation (`:171`) and `entryCountWrite(poolData, membersForCount, stamp.liabilityDelta)` on join/pick (`:309,348,899`); reads `typeof poolData.entryCount === 'number'` to decide whether the D8 derivation read is needed (`:296,555`); `:1213` `Number.isInteger(freshPool?.entryCount) ? ... : entryDocCount` feeds `computeWeeklyPrizeSnapshot`. ✅ **P2-T2**, and `:1209-1224` is the WEEKLY twin of the season snapshot in §6b — same D3 protection. |
| `functions/src/poolExceptions.ts:323-324,525` | the same pair: the D8 derivation read guarded by `typeof poolInTx.entryCount === 'number'`, then `entryCountWrite(poolInTx, membersForCount, stamp...)`. ✅ **P2-T2.** |
| `functions/src/poolOps.ts:107,627-642` | `:635` `if (typeof current?.entryCount !== 'number')` then `entryCountWrite(current, members, 0)` — a **backfill to zero delta**, initialising the field on a legacy pool without moving it; `:107` lists `entryCount` among fields a client may not write. ✅ **NO-CHANGE.** A zero delta cannot fight the T4 decrement. |
| `functions/src/bracketEntries.ts:106,389,527` · `functions/src/propBets.ts:99` | `FieldValue.increment(±1)` on **their own** pool types. ✅ **NO-CHANGE** — a pool has one type, so these never share a counter with the NFL path. |

### 6e. NO-CHANGE — display and capacity (7 verdicts)

| File:line | The expression, and what it is read off |
|---|---|
| `src/components/BrowsePools.tsx:299,316` | `filled = bp.entryCount \|\| 0` / `filled = pp.entryCount \|\| 0` — the **pool document**, for a filled/capacity badge. |
| `src/components/Dashboards/GlobalStandingsCard.tsx:33` | `pool.entryCount \|\| (pool.participantIds?.length \|\| 0)` — the **pool document**, with a roster-length fallback. |
| `src/components/ManagerDashboard.tsx:109,141,673,698` | `anyP.entryCount \|\| (anyP.entries ? Object.keys(anyP.entries).length : 0)` — the **pool document**, falling back to the **`entries` map on that same document**; `:673,698` are `pool.entryCount \|\| 0` for a filled figure. |
| `src/components/PayoutsPanel.tsx:10-13,329,350,514,517` | `entryCount ?? (typeof anyPool.entryCount === 'number' ? anyPool.entryCount : undefined)` — a **prop first**, the **pool document** only as fallback. |
| `src/components/billing/BillingGate.tsx:273` | `count = pool.entryCount \|\| 0` — the **pool document**, for the tier gate. |
| `src/components/admin/MembersTab.tsx:1221` | a **comment** about a past pool-list bug. No read. |
| `src/utils/poolSport.ts:75,97,103,106` | `pool.entryCount ?? 0` — the **pool document** (`:97,103`); `:106` notes the **`entries` map is authoritative** on the playoff path. ⚠️ `:88` says NFL season pools have no maintained `entryCount` — **prose that has aged**: it is maintained now for any NFL pool touched by T2. Harmless, because the reads already default with `?? 0`, but worth knowing. |

All read fresh per render; none caches across a delete. A decrement simply
renders the smaller number.

### 6f. NO-CHANGE — types, sims, scenarios (12 verdicts)

A bare path list is an enumeration, not a review (codex r4). Each row names the
expression, so a future sweep can tell a declaration from a read.

| File:line | The expression |
|---|---|
| `functions/src/types.ts:211,556,679` | `entryCount?: number` — **type declarations**. No read. |
| `src/types/index.ts:162,205,474,795` | `entryCount?: number` — **type declarations**. No read. |
| `src/types/nflPoolTypes.ts:83,181,254,385` | `entryCount?: number`; `:385` a comment on the **frozen** prize snapshot. No read. |
| `functions/src/nflPoolTypes.ts:79,131,183,326` | the same declarations and the same frozen-snapshot comment, server side. No read. |
| `functions/src/shared/simGen.ts:9,88` · `shared/simGen.ts:9,88` | `entryCount: number` on the **sim spec object** (`:9`), then `for (let i = 0; i < spec.entryCount; i++)` — a loop bound over a caller-supplied spec, never a pool document. |
| `src/components/TournamentSimulator/TournamentSimulator.tsx:121,745,1186,1191,1216` | `useState(0)` **local component state** passed down as a prop and rendered. Never read off a pool. |
| `src/utils/testing/scenarios/assertionRunner.ts:83,381,433` | `pool?._propCards?.length \|\| pool?.entryCount` and `pool?._bracketEntries?.length \|\| pool?.entryCount` — a **test-scenario assertion** that prefers the actual document count and uses the field only as a fallback. |
| `src/utils/testing/scenarios/index.ts:167,232` | `entryCount` on a **scenario spec type**. No read. |
| `src/utils/testing/simulators/bracketE2ESimulator.ts:73,82,141` | `entryCount = 50` as a **default parameter**, and `entryCount: 0` **written** when seeding a simulated pool. |
| `src/utils/testing/simulators/bracketSimulator.ts:109` | writes `entryCount: 0` when seeding a simulated pool. |
| `src/utils/testing/simulators/propsSimulator.ts:80` | writes `entryCount: 0` when seeding a simulated pool. |

None reads a live pool's `entryCount` to make a decision, so a decrement reaches
none of them.

### 6g. `playableEntryCount` — remaining readers (8 verdicts)

| File:line | What it reads | Verdict |
|---|---|---|
| `functions/src/lib/multiEntry.ts:166,184,191,195,217,222,227,231` | `let playableEntryCount = written.hasPick ? 1 : 0` then `if (entryHasPick(e.data)) playableEntryCount++` over the owner's entry documents — `ownerStateAfter` (`:184-195`) and `ownerStateWithout` (`:222-231`). ✅ **P2-T2/T4.** `:207` records why it is now a RECOUNT and no longer a one-way latch. |
| `functions/src/nflEntryDelete.ts:8,32,210` | writes a `playableEntryCount` **recounted from the surviving documents** (`:32`), and `:210` pins the `merge: false` write that deliberately omits it on the other limb. ✅ **P2-T4** — this is the path that made the field reversible. |
| `functions/src/nflPools.ts:881` · `functions/src/poolExceptions.ts:516` | `playableEntryCount: ownerState.playableEntryCount` — written onto the Member Record from the derived owner state. (`:566` is a **comment** saying the count is derived, not a write; citing it in a row claiming "writes" was inaccurate — codex r5.) | ✅ **P2-T2.** |
| `functions/src/poolOps.ts:679` | reads it to multiply a fee-rate change | ✅ **NO-CHANGE** (see §5a). |
| `functions/src/userProfile.ts:29` | comment recording `entryFee x playableEntryCount` (D2) | ✅ **NO-CHANGE.** |
| `src/components/NFLPoolDashboard/PaymentLedgerNFL.tsx:423,430` | `typeof mrec?.playableEntryCount === 'number' ? mrec.playableEntryCount : (...)` — off the **Member Record** in `membersByUid`, with a documented fallback limb for a legacy MANAGER carrying `feeOwed > 0`. Feeds the delete-confirmation arithmetic. | ✅ **P2-T6.** |
| `src/components/PaymentsPanel.tsx:85,114-115` | `entryFee x max(joinLiability, playableEntryCount)` for the viewer's own outstanding | ✅ **NO-CHANGE.** Reads fresh; a decrement lowers what it shows, correctly. |

---

### 6h. Cross-referenced — their verdict is in §4 or §5 (5 verdicts)

Same rule as §5e: these read `playableEntryCount` and/or `entryCount` as part of
the same derivation their §4/§5 verdict already covers. Listed so both fields'
grep lists are fully accounted for.

| File | Reads | Where its verdict is |
|---|---|---|
| `functions/src/shared/memberRecord.ts` · `shared/memberRecord.ts` | both | §4a / §5a — `memberLiableEntries`, `deriveEntryCount`, the derivation itself. |
| `functions/src/lib/memberRecord.ts` | both | §4a / §5a — the liability-rise rule that consumes both counts. |
| `functions/src/nflEntryRename.ts` | both | §4b / §5b — one comment listing all four as fields it must **not** write. |
| `functions/src/nflPoolDues.ts` | `playableEntryCount` | §4c — `:65`, a comment on the count-not-set rule. |

**With §5e and §6h, all 121 (file, field) pairs are accounted for** — each has a
verdict under its own field, or is cross-referenced in §5e / §6h to the verdict
that covers it. Verified mechanically, resolving `playableEntryCount` against
§6g/§6h and `entryCount` against the rest of §6.

⚠️ **That last clause is the whole lesson.** The first version of the check
resolved a file against the top-level section only, and §6 covers **two** fields
— so any file appearing anywhere in §6 was passed for both. It reported "0
unaccounted" while five pairs had no verdict (`nflPools.ts`, `poolExceptions.ts`,
`poolOps.ts` for `entryCount`; `lib/multiEntry.ts`, `nflEntryDelete.ts` for
`playableEntryCount`). A verification tool that shares the artifact's blind spot
confirms the blind spot. Found by codex r5, not by the checker.

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
