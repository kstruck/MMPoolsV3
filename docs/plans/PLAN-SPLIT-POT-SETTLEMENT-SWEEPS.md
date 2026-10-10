# PLAN-SPLIT-POT-SETTLEMENT — sweeps (Part A)

Deterministic, grep-built instance lists for every class the plan claims to
cover. Measured on `claude/survivor-pool-features-plan-c4213f` (base
`origin/main` @ `cc8a7a41`), 2026-10-08. Re-run the command to re-verify; trust
the command over this table if they disagree.

## S1 — every reader of `closedVia` (does a new value `'SETTLED'` behave?)

```
rg -n "closedVia" functions/src src --glob '!**/__tests__/**' --glob '!*.test.*'
```

| Reader | Rule | `'SETTLED'` outcome | OK? |
|---|---|---|---|
| `src/utils/poolSport.ts:313` `hasTerminalMarker` | any truthy `closedVia` → terminal | terminal | ✅ |
| `src/utils/poolSport.ts:355` `getPoolLifecycleState` | `=== 'ADMIN_CLOSE'` → `closed` | falls through to `final` | ✅ intended (a settled pool is a real finish) |
| `functions/src/statsTrigger.ts:375` `recomputeGlobalStats` | skips `ADMIN_CLOSE` | counted (selected via `scoredThroughWeek`) — same as any finished NFL pool | ✅ |
| `functions/src/statsTrigger.ts:196` `onPoolLocked` | skips admin-close transition; fires on `isLocked` false→true | settlement writes no `isLocked` → never fires | ✅ **only because** the plan does not write `isLocked` |
| `functions/src/postGameEmail.ts:49` `onGameComplete` | skips admin-close; fires on `scores.gameStatus`→`post`, sends a **Squares** email | settlement writes no `scores.gameStatus` → never fires | ✅ **only because** the plan does not write it |
| `functions/src/scoreUpdates.ts:1145` `isDeadSyncPool` → `lib/scanBounds.ts:22-23` | terminal status or `ADMIN_CLOSE` → dead | `COMPLETED` → dead | ✅ |
| `functions/src/rosterAggregate.ts:30` | watches `status`, `closedVia`, `isFinal` | recomputes the commissioner aggregate on the flip | ✅ |
| `functions/src/lib/poolInclusion.ts:35-37` | `COMPLETED` or any `closedVia` → finished | finished (drops from active rosters / hub) | ✅ |
| `functions/src/lib/lifecycle.ts:34,74` | `ADMIN_CLOSE` only | not an admin-close transition; not auto-close eligible (`COMPLETED` is terminal) | ✅ |
| `scripts/syncScanCensus.mjs:72` | `ADMIN_CLOSE` | n/a (census only) | ✅ |

**Conclusion → plan §2.2 step 9:** write `status` + `closedVia` + `closedAt` +
`settlement` only. Writing `closePool`'s legacy trio (`isLocked`, `isFinal`,
`scores.gameStatus`) would fire `onPoolLocked` stats and a Squares post-game
email to an NFL pool's members.

## S2 — every server path that admits play on an NFL pool

```
rg -n "^export (const|async function) \w+" functions/src/nflPools.ts functions/src/poolExceptions.ts
rg -n "submitNFLPicksInternal|executeSurvivorRebuyInternal|joinNFLPoolInternal" functions/src --glob '!**/__tests__/**'
```

| Entry point | Core it calls | Lease-checked today | Terminal-status check today |
|---|---|---|---|
| `submitNFLPicks` (`nflPools.ts:1335`) | `submitNFLPicksInternal` (`:492`) | ✅ `:644` | ❌ |
| `proxyPick` (`poolExceptions.ts:230`) | **its own transaction** (`:300-310`) — NOT the submit core (corrected after review r2 #1) | ✅ `:309` | ❌ |
| sim harness (`simHarness.ts`) | `submitNFLPicksInternal` | ✅ (via core) | ❌ |
| `executeSurvivorRebuy` (`nflPools.ts:1499`) | `executeSurvivorRebuyInternal` (`:1381`) | ✅ `:1421` | ❌ |
| `joinNFLPool` (`nflPools.ts:450`) | `joinNFLPoolInternal` (`:355`) | ❌ | ❌ |

**Conclusion → plan §2.3:** one `assertPoolAcceptsPlay` in each of the three
cores and in `proxyPick`, on the transaction-fresh pool doc; join also gains the lease check.

## S3 — pool fields the settlement relies on, vs the rules' server-owned list

```
rg -n "'seasonPlaces'|'finalizedAt'|'settlement'" firestore.rules
rg -n "finalizedAt:|firstFinalizedAt:|settlement:" src --glob '!**/__tests__/**'
```

| Field | Server-owned today | Client writer found | Plan |
|---|---|---|---|
| `seasonPlaces`, `seasonPrize`, `seasonPlacesError` | ✅ `firestore.rules:218` | none | unchanged |
| `finalizedAt`, `firstFinalizedAt` | ❌ | none | **add** |
| `settlement`, `settlementStartedAt` | n/a (new) | none | **add** |
| `status`, `closedVia`, `closedAt`, `isFinal` | ❌ | bracket only: `BracketPoolDashboard.tsx:381`, `SuperAdmin.tsx:753` (`updateBracketPool`), simulators via `simUpdatePool` (server). **No NFL client writer.** | **block for NFL managers** (review r2 #4) |
