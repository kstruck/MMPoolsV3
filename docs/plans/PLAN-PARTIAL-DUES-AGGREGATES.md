# PLAN — partial payment is invisible to every aggregate money surface

**Status: ✅ SIGNED 2026-08-27. Kevin ruled Option A on D1, then answered
D2–D5 with "go with recommendations for all". Every decision below is closed;
implementation may proceed.**

Classification: **money + a new field on a participant-readable document** →
plan-gated (`mmp-change-control` §1, Rule 3).
Written 2026-08-27. Carries forward finding #1 from the
[#609](https://github.com/kstruck/MMPoolsV3/pull/609) PR body and
`PLAN-MULTI-ENTRY-DUES-SWEEPS.md` §7.

---

## 1. The finding

Phase 2 made **partial payment representable for the first time**: a member with
three entries can have one paid and two not. Three aggregate money surfaces read
the all-or-nothing summary `paidStatus` and therefore treat that member as
having paid **nothing**.

| Site | Line (VERIFIED at `a85c6fbf`) | Code |
|---|---|---|
| `shared/memberRecord.ts` — `memberDues` | 495 | `if (m.paidStatus === 'PAID') collected += fee;` |
| `src/utils/poolRoster.ts` — `memberOutstanding` | 387 | `const base = row.paidStatus === 'PAID' ? 0 : fee;` |
| `src/utils/poolRoster.ts` — `rosterPotStats` | 432 | `if (m.paidStatus === 'PAID') { collected += fee; paid++; }` |

**Demonstrated:** a member owing \$50 who paid \$25 reports
`{ expected: 50, collected: 0 }`.

### The chain, verified end to end

```
memberDues
  → computeRosterSummary
    → functions/src/statsTrigger.ts:68  duesCollected
      → memberRecordsPot (statsTrigger.ts:61)
        → calculatePoolPot (statsTrigger.ts:123)
          → stats/global.prizePot / totalPrizes   ← WORLD-READABLE
```

plus `src/lib/rosterSummary.ts` (the commissioner's roster card) and
`commissionerAggregate`.

**Direction is an UNDER-count.** The platform reports less money collected than
was collected. That is the safe direction for a lie to point, and it is still a
lie on a world-readable document.

### Not affected

**SQUARES pools.** `memberDues`'s SQUARES branch already prices partial payment
correctly through `unitsPaid` / `unitsOwned`. Nothing in this plan touches it,
and the helper below must not change it.

---

## 2. Why the fix is not simply "read the per-entry map"

**D1 seals the map.** Per-entry dues live in
`pools/{poolId}/private/dues__{uid}` with `allow read: if false`, reachable only
through the `getPoolDues` callable. That is not incidental — the keys name
entries that have committed a pick, and a Member Record is readable by every
participant, so publishing the map would tell the whole pool which of another
player's entries is live.

**And `computeRosterSummary` / `memberDues` run CLIENT-SIDE.** They live in
`shared/` and are bundled into the browser. They can never read the sealed map,
under any amount of plumbing.

⇒ A mirrored **count** is the only shape that reaches these readers.

---

## 3. D1 — Option A, ruled: mirror `paidEntryCount: number`

Publishing a COUNT is already what `playableEntryCount` does
(`shared/memberRecord.ts:90`). D1 seals **which** entries are paid, not **how
many**. A count leaks the same class of fact the record already publishes.

### Non-negotiable constraints (all VERIFIED)

**C1 — every writer of the dues map writes the count in the SAME transaction.**
A count that can drift from the map is worse than no count. All three writers,
each holding the next map locally:

| # | Writer | Local | Note |
|---|---|---|---|
| 1 | `functions/src/setPaidStatus.ts:387` | `nextPaidEntries`, `liable` | |
| 2 | `functions/src/nflEntryDelete.ts:336` | `duesAfter` | ⚠️ writes only `if (storedDues)` — the count must follow the same condition, or a member with no dues doc gains a phantom field |
| 3 | `functions/src/migrations/reconcilePaymentTruth.ts:483` | `nextDues` | |

One test per writer, proving the pair moves together.

**C2 — count the LIABLE ids that are paid, via the exported `isPaidRow`.**
NOT `Object.keys(map).length`, which includes ids stranded by the D7a cleanup
path and would **over**-count. `isPaidRow` is what keeps the count agreeing with
`derivePaidStatus`.

```ts
const paidEntryCount = liable.filter(id => isPaidRow(nextDues, id)).length;
```

**C3 — the reader shape keeps the change provably non-regressive.** When
`paidStatus === 'PAID'`, collect the full fee **exactly as today**; use the
count only to add PARTIAL credit to members who are UNPAID. Collected can then
only ever go UP, never down. `Math.floor` for the partial share, matching
`calculatePoolPot`'s floor — **never over-report money.**

**C4 — ONE exported helper** in `shared/memberRecord.ts` that all three reader
sites call, so they cannot drift.

**C5 — absence tolerated everywhere.** Existing records have no such field.
Every reader falls back to today's all-or-nothing behaviour, so nothing
regresses before a backfill runs.

**C6 — `shared/memberRecord.ts` and `functions/src/shared/memberRecord.ts` stay
identical.** The latter is gitignored (`functions/.gitignore:3`) and regenerated
by `functions/scripts/copy-shared.mjs`.

**C7 — the scorer is LIVE.** `nflAutoScoreJob` runs `*/5` in production. Stated
in the PR body.

### The proposed helper

```ts
/**
 * The base dues COLLECTED from one member. `fee` is their whole base liability
 * (`feeOwed`, i.e. entryFee x liable entries).
 *
 * PAID → the full fee, byte-identical to what every site did before. UNPAID →
 * the mirrored count's share, floored. So this can only ever raise collected,
 * never lower it, and a record without the field behaves exactly as today.
 */
export function collectedBaseDues(
  m: Pick<MemberRecord, 'role' | 'feeOwed' | 'hasPlayableEntry'
      | 'playableEntryCount' | 'paidStatus' | 'paidEntryCount'>,
  fee: number,
): number {
  if (m.paidStatus === 'PAID') return fee;
  const liable = memberLiableEntries(m);
  const paid = m.paidEntryCount;
  if (liable <= 0 || typeof paid !== 'number' || !Number.isFinite(paid) || paid <= 0) return 0;
  const capped = Math.min(Math.floor(paid), liable);   // a stale count cannot over-report
  return Math.max(0, Math.min(fee, Math.floor((fee * capped) / liable)));
}
```

Both clamps are load-bearing: `capped` stops a count that outran its map, and
`Math.min(fee, …)` stops a `feeOwed` that shrank under a count written when it
was larger.

---

## 4. ✅ DECISIONS — ALL SIGNED (Kevin, 2026-08-27: "go with recommendations for all")

### D2 ✅ SIGNED → A — how does the count reach EXISTING records?

Every record written before this ticket lacks the field, so until something
stamps them the under-count persists for every pool already running.

| Option | What it means |
|---|---|
| **A (recommended)** | **`reconcilePaymentTruth` stamps the count** as part of its existing sweep. It ALREADY carries the kill-switch, the dryRun default and the per-run cap that Rule 1 demands, it already reads both the dues map and the liability set in a transaction, and it is already the operator-run repair tool for exactly this class of divergence. No new job, no new kill-switch, no new operator surface. |
| B | **A new backfill job**, modelled on `autoClosePools.ts`, with its own kill-switch + dryRun default + cap. More code, another thing to arm, another thing to forget is armed. |
| C | **No backfill — fix-forward only.** The count appears the next time anyone's payment status is touched. Zero prod-data risk; the under-count simply persists on quiet pools indefinitely. |

**Recommendation: A.** It is the smallest new surface and reuses safety
machinery that already exists and has been reviewed. ⚠️ Honest caveat: it widens
what an existing job writes, so its dryRun report must show count stamps
distinctly from payment repairs, or an operator reading "0 divergences" would
not learn that 40 records were about to gain a field.

### D3 ✅ SIGNED → A — `stats/global.prizePot` is world-readable and will VISIBLY change

Once the count lands, published pot figures go **up** for any pool with a
partially paid member. Nothing is wrong with the new number — the old one was
the wrong one — but it is a public figure moving without a user action.

| Option | What it means |
|---|---|
| **A (recommended)** | Ship it. The new number is the true one; a correction that stays hidden is the defect. |
| B | Ship the readers, defer the backfill (D2 = C) so the change arrives gradually as payments are touched. |
| C | Ship behind a config flag, flip after review. |

**Recommendation: A**, with the direction stated in the PR body so nobody reads
a rising pot as a scoring bug.

### D4 ✅ SIGNED → A — does `rosterPotStats`'s `paid` COUNTER move too?

`rosterPotStats` increments `paid++` in the same `if`. That counter feeds "N of
M paid" chips.

| Option | What it means |
|---|---|
| **A (recommended)** | **Leave `paid++` alone.** It counts fully-paid MEMBERS, which is what the chip says. A partially paid member is not a paid member. |
| B | Make it fractional or add a second "partially paid" count. |

**Recommendation: A.** Only the MONEY is wrong; the head count is right. B is a
UI change wearing a bugfix costume, and it is not in the finding.

### D5 ✅ SIGNED → A — is `memberOutstanding` in scope?

It is the mirror of the same defect: a partially paid member's Outstanding Due
shows their WHOLE fee.

| Option | What it means |
|---|---|
| **A (recommended)** | Fix it in the same PR, off the same helper. Leaving it means the Buy-In Ledger says a member owes \$50 while the pot says \$25 of it is collected — two surfaces contradicting each other about one member. |
| B | Separate PR. |

**Recommendation: A.** It is named at `poolRoster.ts:387` in the finding, and
splitting it creates the contradiction.

---

## 5. Out of scope

| Not doing | Why |
|---|---|
| Un-sealing the per-entry dues map | D1. The seal is the reason a count is needed. |
| Changing the SQUARES branch of `memberDues` | Already correct via `unitsPaid`. |
| A `paid: boolean` on the dues map rows | D1b — presence IS the paid signal. |
| Lowering `playableEntryCount` | One-way counter; K7. |

---

## 6. Risks

- 🔴 **The scorer is LIVE** (`nflAutoScoreJob`, `*/5`). Nothing here touches
  scoring, but the PR body must say so.
- **A new field on a participant-readable document.** It is a COUNT, the same
  class as `playableEntryCount`, and it names no entry.
- **Count/map drift** is the failure mode that would matter. C1 (same
  transaction, per-writer test) and C2 (`isPaidRow`, not `Object.keys`) are the
  whole defence.
- **Prod-data mutation** iff D2 resolves to A or B — Rule 1 applies either way.

---

## 7. Implementation status

**NOT STARTED.** Unblocked 2026-08-27 — D2–D5 signed as recommended, so the
shape is fully determined:

| Item | Decision |
|---|---|
| Mirror `paidEntryCount`, all three writers, same transaction | D1 = A |
| `reconcilePaymentTruth` stamps the count (no new job) | D2 = A |
| Ship the corrected public pot figure | D3 = A |
| `paid++` head count UNCHANGED | D4 = A |
| `memberOutstanding` fixed in the same PR | D5 = A |

⚠️ **The gate list this must be built against now includes
`npm --prefix functions run typecheck` and `npm --prefix functions run build`** —
see CLAUDE.md §2e. `npx tsc -b` at the root does not typecheck `functions/`, and
that gap let a build-blocking TS2345 sit green through every other gate on #612.
