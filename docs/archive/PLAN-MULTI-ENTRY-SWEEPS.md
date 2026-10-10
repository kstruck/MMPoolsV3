# PLAN-MULTI-ENTRY — sweeps

Deterministic greps run 2026-08-15 on `origin/main` @ `3574e54e`. Every hit
below is a ticket line in the plan's §7. Re-run before T2 and again after T6;
the second run must return zero uid-keyed consumers on the NFL paths.

## S1 — Every place a uid is used as an entry identity

### S1a — server: `entries.doc(<uid>)`

```
grep -rn "collection('entries').doc(\|collection(\"entries\").doc(" functions/src --include=*.ts | grep -v __tests__
```

NFL paths (the plan's scope):

| file:line | what | ticket |
|---|---|---|
| `nflPools.ts:473` | `submitNFLPicksInternal` — the load-bearing line | T2 |
| `nflPools.ts:832` | `executeSurvivorRebuyInternal` | T2 |
| `nflPools.ts:1528` | Margin rank write-back `doc(r.ownerUid)` — **overwrites** | T3 |
| `poolExceptions.ts:240` | `proxyPick` `doc(targetUid)` | T2 |
| `setPaidStatus.ts:120`, `:204` | paid mirror onto `entries/{memberUid}` — with `${uid}_${n}` ids the mirror lands on entry #1 only; **decision: mirror to every entry of the member, or drop the mirror for NFL** (see plan D2; the ledger plan owns the mirror's future) | T2 |
| `simHarness.ts:197`, `:636` | forces `docId === ownerUid`; `:161` calls it an invariant | T3 |
| `userProfile.ts:24` | `entries.doc(uid)` read for the profile — becomes `where('ownerUid','==',uid)` | T3 |

Not in scope (already multi-entry, auto-id): `bracketEntries.ts:86,126,200,357,431,491,518`, `bracketOps.ts:24`.

### S1b — server: reveal maps keyed by uid

```
grep -n "Record<string" functions/src/nflPickReveal.ts
→ :63 counts, :65 picks, :67 confidence, :75 tiebreakers (type); :280-283 (locals)
```
Key assigned at `:292` `const memberUid = entry.ownerUid || doc.id;`. **T3.**

### S1c — client: `ownerUid ?? id` used as the ROW/REVEAL key

```
grep -rn "ownerUid ?? \|ownerUid ||" src --include=*.tsx --include=*.ts | grep -v test
```

| file:line | use | verdict under 0b |
|---|---|---|
| `NFLPicksGrid.tsx:117` `uidOf` | reveal lookup key | ❌ → `row.id` (T6 / Wave 2-3) |
| `NFLWeeklyPicksGrid.tsx:73` `uidOf` | reveal lookup key | ❌ → `row.id` |
| `NFLStandings.tsx:305-306` | `pickCounts?.[entry.ownerUid ?? entry.id]` | ❌ → `row.id` |
| `NFLStandings.tsx:236`, `NFLResults.tsx:107,117` | `isMyEntry` = `=== viewerUid` | ✅ correct (lights all my entries) |
| `NFLManagerView.tsx:237` `targetUidOf` | proxy-pick / remind TARGET is a person | ✅ uid is right; proxyPick gains `entryIndex` (T2) |
| `memberStandings.ts:73` `uidOf` + `:86-114` `scoredByUid`/`seen` | the fold | ❌ T4 |
| `poolRoster.ts:81` `uidOf`, `:419` `entryByUid` | dues per member | ✅ per-member is right; reads `feeOwed` (already the sum) |
| `RecordPayoutsCard.tsx:69,78` | payee uid | ✅ payee is a person; add `entryId` (contract already has it) |
| `ReportsTab.tsx:123` | Bracket | out of scope |

### S1d — client: the singular `myEntry`

```
grep -rn "entries.find(e => e.ownerUid" src --include=*.tsx
→ NFLPoolDashboard.tsx:489   myEntry            (T5: ownEntries[] + active)
  NFLUserBentoDashboard.tsx:197  myEntry         (T5: CTA from active entry)
  PaymentsPanel.tsx:57        myEntry            (T6: dues come from the Member Record; the entry is only a paidStatus fallback)
  RecordPayoutsCard.tsx:131   name lookup by uid (fine — payee)
```

### S1e — finalize

```
grep -n "seasonHistory').doc" functions/src/nflFinalize.ts
→ :307  db.collection('users').doc(entry.ownerUid).collection('seasonHistory').doc(poolId)
```
Collides for entry #2. **T3 (D9).**

## S2 — The setting does not exist for NFL

```
grep -rn "maxEntries" shared
→ shared/schemas/bracket.ts:17-18   maxEntriesTotal / maxEntriesPerUser
  shared/schemas/playoff.ts:22-23   same
```
Nothing in `shared/schemas/nfl.ts`; its schemas are `z.object` and strip
unknown keys (`nfl.ts:42-46`), so a wizard value would vanish at create. **T1**
adds `maxEntriesPerUser` to all three NFL create schemas, reusing the name.

## S3 — Rules: nothing asserts `entryId == uid`

`firestore.rules:456-484` — entries read is `request.auth.uid ==
resource.data.ownerUid`; `:491-504` members IS uid-keyed and stays so. **No
rules change for entries.** The one rules edit is the settings key in
`callableOnlySettingsUnchanged()` (T1).

## S4 — Tests that pin the current shape (change deliberately, name in PR)

- `tests/nfl-surface-invariants.test.ts:658-667` — reveal cache `{poolId, uid: viewerUid, byWeek}`; `:690-697,747` — `entries = useMemo(` deps `(entries, ownEntry, members, standingsRows)`. **T4/T5.**
- `functions/src/__tests__/emulator/fixtureMatrix.emulator.test.ts:104,274-308` — `uidFor(runId, userName)`, `uidToName` map. `src/utils/testing/scenarios/assertionRunner.ts:123,178,187,216` — entries addressed by `userName`. **T9.**
- `src/utils/memberStandings.test.ts` — uid-keyed fixtures. **T4.**
- `functions/src/__tests__/manualReminderTargets.test.ts:91` — the only existing multi-entry-aware test ("does not duplicate a member with MULTIPLE entries"). **T8 keeps it green.**
- `functions/src/__tests__/memberRecord.plan.test.ts`, `proxyPickLatch.emulator.test.ts`, `feeOwedAndPayouts.test.ts` — the latch/fee matrix. **T2 extends with the count.**

## Re-verification

After T6: S1c and S1d must return zero ❌ rows. After T3: S1a NFL rows must
all take an entry id.

## S5 — Every consumer of a "how many players/entries" count (D8's two counts)

```
grep -rn "participantIds\.length\|participantIds?\.length\|entryCount" src functions/src shared --include=*.ts --include=*.tsx | grep -v __tests__ | grep -v "\.test\."
```

Classification (run and paste the output before T2; the buckets are fixed by
D8, the line list is what the grep returns):

| Bucket | Meaning | Consumers |
|---|---|---|
| **members** (`participantIds`) | player cap, billing tier, "N players" copy | `functions/src/billing.ts`, `src/components/billing/BillingGate.tsx`, `src/utils/poolSport.ts`, global dashboard cards, `poolOps.ts:127-137` participant-cap resolution — **unchanged** |
| **entries** (`pool.entryCount`) | pot, prizes, hybrid split, "N entries" badge on the grids | `PayoutsPanel.tsx:301-303` (`entryFee × knownEntries`), `NFLPoolRules.tsx` (calls `PayoutsPanel` with no count today), the `#430/#432` grid header badge ("4 ENTRIES"), Bracket's existing `entryCount` writers (`bracketEntries.ts:98`, precedent) — **T2 writes it, T6 reads it** |

Any line the grep returns that is in neither bucket is a finding, not a
classification.

## S6 — Same-owner tie-breaks in ordering (codex r2)

```
grep -rn "ownerUid" functions/src/nflScoringEngine.ts | grep -i "sort\|localeCompare\|tie"
```
`sortMarginLeaderboard` breaks its final tie on `ownerUid`; T3 changes every
per-entry ordering's last resort to `entry.id`. Re-run: zero `ownerUid` in a
sort comparator.

---

## Re-verification — 2026-08-25, after T3/T4/T5/T6a and the flip

Re-run on `origin/main` @ `809384d4` (#591 merged). The rule the first run set
was: **after T3, S1a's NFL rows must all take an entry id; after T6, S1c and S1d
must return zero ❌ rows.**

### S1a — `entries.doc(<uid>)` on the NFL paths

```
grep -rn "collection('entries').doc(\|collection(\"entries\").doc(" functions/src --include=*.ts | grep -v __tests__ | grep -viE "bracket|playoff"
```

| Hit | Verdict |
|---|---|
| `nflPools.ts:1808` | ✅ **`doc(r.id)`** — the T3 fix. Was `doc(r.ownerUid)`, the line that overwrote entry #1's rank with entry #2's |
| ~~`lib/multiEntry.ts:214`~~ | ⚰️ **`applyPaidReset` NO LONGER EXISTS.** It iterated `ownedIds` — a doc per OWNED ENTRY, not a uid — and was correct on that axis. K11 was RETIRED by PLAN-MULTI-ENTRY-DUES D6 (P2-T3) and the function deleted, so the hit is gone rather than reclassified. Row kept struck through: a sweep that silently loses a line reads as a sweep that never covered it |
| `poolExceptions.ts:249`, `setPaidStatus.ts:134,225`, `userProfile.ts:47` | ✅ all the same shape: a deliberate probe for a LEGACY `entries/{uid}` document that carries no `ownerUid` and so cannot be found by the owned-entries query. Each sits beside that query, never instead of it |
| `simHarness.ts:207,646` | ✅ the harness fabricates entry #1 per simulated player; its header no longer claims this is a scorer invariant |

**Zero remaining uid-as-identity sites on the NFL scoring path.**

### S1c / S1d — the client

```
grep -rn "ownerUid ?? \|ownerUid || " src --include=*.tsx --include=*.ts | grep -v test
grep -rn "entries.find(e => e.ownerUid" src --include=*.tsx
```

Every ❌ row from the first run is gone:

| First run | Now |
|---|---|
| `NFLPicksGrid.tsx:117` `uidOf` (reveal key) | ✅ removed by T0 |
| `NFLWeeklyPicksGrid.tsx:73` `uidOf` | ✅ removed by T0 |
| `NFLStandings.tsx:305-306` `pickCounts?.[ownerUid ?? id]` | ✅ removed by T0 |
| `memberStandings.ts:73` `uidOf` + `scoredByUid`/`seen` | ✅ **T4** — `idOf` (`id ?? ownerUid`), `scoredByEntry`, one row per entry |
| `NFLPoolDashboard.tsx:489` singular `myEntry` | ✅ **T5** — the ACTIVE entry, `.filter` not `.find` |
| `NFLUserBentoDashboard.tsx:197` singular `myEntry` | ✅ **T5** — the active entry, with `pendingEntryLabel` for a draft |

What still matches the grep, and why every one is correct:

- `NFLPicksGrid:145`, `NFLWeeklyPicksGrid:87`, `NFLResults:143,153,274`,
  `NFLStandings:213` — all `=== viewerUid`, i.e. **"is this me"**, which §0b.2
  says *should* light up every one of the viewer's entries.
- `memberStandings.ts:283,315` — **membership and `pickedWeeks` are questions
  about the PERSON.** Asking `participantIds` for `e2:{uid}` would drop every
  extra entry of every member; `pickedWeeks` is the per-member union by design
  (D2), so it is written onto every row that owner holds.
- `poolRoster.ts:81` `uidOf` — dues are per MEMBER and read `feeOwed`, already
  the multiplied sum. Renamed by T6's remainder; still allow-listed.
- `NFLManagerView.tsx:865` `targetUid` — the proxy-pick/remind TARGET is a
  person. `proxyPick` takes an `entryIndex` alongside it (T2).
- `PaymentsPanel.tsx:58` singular `myEntry` — ✅ **CLOSED 2026-08-25, and the
  original classification here was WRONG.**

  🛑 This row said *"dues come from the Member Record; the entry is only a
  paidStatus fallback"* — and the file **never read the Member Record's fee at
  all.** It computed `(isPaid ? 0 : settings.entryFee) + rebuys`, the price of
  ONE entry, so a two-entry member was told they owed $25 while the
  commissioner's ledger correctly chased them for $50. Kevin hit it on the first
  live multi-entry pool, hours after this sweep was re-verified.

  **The lesson for the next sweep: a "✅ per-member is right" verdict is a claim
  about what the code READS, and it has to be checked against the code, not
  against what the file is for.** Both PaymentsPanel and `poolRoster.ts` were
  waved through on the same sentence; only one of them deserved it.

  Now calls the shared `memberOutstanding` / `duesRates`, so there is one
  definition of what a member owes and the two surfaces cannot disagree again.
  Its `.find` is a `.filter`, and its allow-list entry is deleted.
- `PaymentLedgerNFL.tsx:69` `entryOwner` — **new since the first sweep** and
  classified here: the ledger's payee is a person, so ✅.
- `ReportsTab.tsx:123` — Bracket, out of scope.

### S6 — same-owner tie-breaks

```
grep -rn "ownerUid" functions/src/nflScoringEngine.ts | grep -iE "sort|localeCompare|tie"
→ :490  return String(a.id ?? a.ownerUid).localeCompare(String(b.id ?? b.ownerUid));
```

✅ **Zero `ownerUid` in a comparator.** The one hit is the entry id with a
legacy fallback — the T3 fix. Two entries of one owner can no longer compare
equal and take Firestore iteration order for distinct ranks.

### The one thing this re-run does NOT prove

These are greps. The alias case (`const key = row.ownerUid`) is out of a
regex's reach, exactly as §0b.6 said. The compensating checks are behavioural
and are green: `memberStandings.test.ts`'s "one row per ENTRY" block (two rows
sharing an `ownerUid`), and the FLIP arc in `multiEntry.emulator.test.ts`
(three entries of one player carrying three distinct scores into the standings
projection).
