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
