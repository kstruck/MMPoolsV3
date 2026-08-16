# PLAN-COMMISSIONER-TRANSFER — sweeps

Deterministic greps run 2026-08-16 on `origin/main` @ `42906ecc`. Re-run each command before implementing; the plan's Tables 1–2 and D3 are derived from these. A line naming several fields appears in each per-field section, so section totals overlap. Classification is per line: **must change** (T1/T2/T3 touches it), **read-only consumer** (reads the owner from the pool doc and therefore follows the transfer automatically — nothing to edit, but it is the surface T1's emulator tests assert), **unaffected** (create-time write, type declaration, fixture, or a different `ownerId` — the bundle/entitlement owner).

⚠️ `ownerUid` is deliberately NOT swept: it is the entry document's / Member Record's uid (multi-entry), not the pool owner (plan §1). `grep -c ownerUid firestore.rules` → 1 (`:512`, the entries subcollection).

Commands (all from the repo root):
```
grep -n "ownerId\|managerUid\|createdByUid" firestore.rules
grep -rn "ownerId" functions/src --include=*.ts | grep -v __tests__
grep -rn "createdByUid" functions/src --include=*.ts | grep -v __tests__
grep -rn "managerUid" functions/src --include=*.ts | grep -v __tests__
grep -rn "ownerId\|managerUid\|createdByUid" src --include=*.ts --include=*.tsx
grep -rn "ownerId\|managerUid\|createdByUid" shared
grep -rn "ownerId\|managerUid\|createdByUid" tests functions/src/__tests__ | cut -d: -f1 | sort | uniq -c
```


## S1 — `firestore.rules`: every `ownerId` / `managerUid` / `createdByUid` site

| Site | Line (trimmed) | Classification | Why |
|---|---|---|---|
| `firestore.rules:73` | `resource.data.ownerId == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:74` | `resource.data.managerUid == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:90` | `request.auth.uid == resource.data.ownerId \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:91` | `request.auth.uid == resource.data.managerUid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:113` | `// deliberately inline ownerId/managerUid (C8: destructive stays owner-only).` | read-only consumer | comment |
| `firestore.rules:115` | `return request.auth.uid == resource.data.ownerId` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:116` | `\|\| request.auth.uid == resource.data.managerUid` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:124` | `'managerUid', 'ownerId', 'createdAt', 'createdBy',` | **must change** | D8/T3 — protectedFieldsUnchanged() gains previousOwnerId/ownershipTransferredAt/ownershipRevision (ownerId/managerUid already frozen here) |
| `firestore.rules:363` | `pool.ownerId == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:364` | `pool.managerUid == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:406` | `get(/databases/$(database)/documents/pools/$(poolId)).data.ownerId == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:418` | `// Squares PII stays owner/managerUid/SA — PLAN-CO-COMMISSIONERS K7 = No` | read-only consumer | comment |
| `firestore.rules:421` | `get(/databases/$(database)/documents/pools/$(poolId)).data.ownerId == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:422` | `get(/databases/$(database)/documents/pools/$(poolId)).data.managerUid == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:432` | `get(/databases/$(database)/documents/pools/$(poolId)).data.ownerId == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:433` | `get(/databases/$(database)/documents/pools/$(poolId)).data.managerUid == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:458` | `get(/databases/$(database)/documents/pools/$(poolId)).data.ownerId == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:459` | `get(/databases/$(database)/documents/pools/$(poolId)).data.managerUid == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:490` | `// ⚠️ THE POOL'S OWNER AND managerUid ARE DELIBERATELY NOT LISTED HERE` | read-only consumer | comment |
| `firestore.rules:549` | `get(/databases/$(database)/documents/pools/$(poolId)).data.ownerId == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:550` | `get(/databases/$(database)/documents/pools/$(poolId)).data.managerUid == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:566` | `get(/databases/$(database)/documents/pools/$(poolId)).data.ownerId == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:567` | `get(/databases/$(database)/documents/pools/$(poolId)).data.managerUid == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:579` | `get(/databases/$(database)/documents/pools/$(poolId)).data.ownerId == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:580` | `get(/databases/$(database)/documents/pools/$(poolId)).data.managerUid == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:591` | `get(/databases/$(database)/documents/pools/$(poolId)).data.ownerId == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:592` | `get(/databases/$(database)/documents/pools/$(poolId)).data.managerUid == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:603` | `get(/databases/$(database)/documents/pools/$(poolId)).data.ownerId == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:604` | `get(/databases/$(database)/documents/pools/$(poolId)).data.managerUid == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:615` | `get(/databases/$(database)/documents/pools/$(poolId)).data.ownerId == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:616` | `get(/databases/$(database)/documents/pools/$(poolId)).data.managerUid == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:628` | `get(/databases/$(database)/documents/pools/$(poolId)).data.ownerId == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:629` | `get(/databases/$(database)/documents/pools/$(poolId)).data.managerUid == request.auth.uid \|\|` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:803` | `&& (resource.data.ownerId == request.auth.uid \|\| isSuperAdmin());` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |
| `firestore.rules:811` | `get(/databases/$(database)/documents/bundles/$(bundleId)).data.ownerId == request.auth.uid` | read-only consumer | principal check reads the pool doc — follows the transfer; no principal set changes (D8) |

35 lines — must change 1, read-only consumer 34, unaffected 0. `grep -c createdByUid firestore.rules` → 0 (the rules layer never reads the creator).

## S2 — `functions/src` (non-test): `ownerId`

| Site | Line (trimmed) | Classification | Why |
|---|---|---|---|
| `functions/src/adminBillingOps.ts:173` | `ownerId: targetUid,` | unaffected | client fixture / create-payload shape (server strips privileged fields on create) |
| `functions/src/backfill.ts:36` | `const ownerId = pool.ownerId;` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/backfill.ts:39` | `if (!ownerId) continue;` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/backfill.ts:44` | `updates.createdByUid = ownerId;` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/backfill.ts:67` | `const indexRef = usersRef.doc(ownerId).collection('managedPools').doc(poolId);` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/billing.ts:61` | `* contactEmail, then falls back to users/{ownerId \|\| managerUid}.email.` | read-only consumer | comment |
| `functions/src/billing.ts:66` | `const commissionerUid = poolData.ownerId \|\| poolData.managerUid;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/billing.ts:293` | `if (pool.ownerId !== userId) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/billing.ts:400` | `if (!managerEmail && (after.ownerId \|\| after.createdByUid \|\| after.managerUid)) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/billing.ts:401` | `const managerUid = after.ownerId \|\| after.createdByUid \|\| after.managerUid;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/bracketEntries.ts:373` | `if (uid !== poolData.managerUid && uid !== poolData.ownerId) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/bracketEntries.ts:380` | `if (uid !== poolData.managerUid && uid !== poolData.ownerId) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/bracketEntries.ts:438` | `const isOwner = pool.ownerId === uid \|\| pool.managerUid === uid \|\| pool.createdByUid === uid \|\|` | **must change** | D3/T2 — creator admitted as owner; becomes `isPoolOwnerOrManager` |
| `functions/src/bracketOps.ts:34` | `if (poolData?.managerUid !== uid && poolData?.ownerId !== uid) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/bracketPools.ts:80` | `ownerId: uid, // Added for backward compatibility/rules` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/coCommissioners.ts:84` | `if (targetUid === (pool.ownerId \|\| pool.createdByUid) \|\| targetUid === pool.managerUid) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/entitlements.ts:55` | `ownerId: string;` | unaffected | `bundles.ownerId` / entitlement owner = the PERSON who bought credits, not the pool owner (S-f) |
| `functions/src/entitlements.ts:111` | `ownerId: input.ownerId,` | unaffected | `bundles.ownerId` / entitlement owner = the PERSON who bought credits, not the pool owner (S-f) |
| `functions/src/entitlements.ts:146` | `userId: input.ownerId,` | unaffected | `bundles.ownerId` / entitlement owner = the PERSON who bought credits, not the pool owner (S-f) |
| `functions/src/entitlements.ts:206` | `ownerId: targetUid,` | unaffected | `bundles.ownerId` / entitlement owner = the PERSON who bought credits, not the pool owner (S-f) |
| `functions/src/entitlements.ts:341` | `* Redeem one available Pool Credit owned by `ownerId` to activate `poolId`.` | unaffected | `bundles.ownerId` / entitlement owner = the PERSON who bought credits, not the pool owner (S-f) |
| `functions/src/entitlements.ts:356` | `ownerId: string;` | unaffected | `bundles.ownerId` / entitlement owner = the PERSON who bought credits, not the pool owner (S-f) |
| `functions/src/entitlements.ts:361` | `const { ownerId, poolId } = args;` | unaffected | `bundles.ownerId` / entitlement owner = the PERSON who bought credits, not the pool owner (S-f) |
| `functions/src/entitlements.ts:371` | `ownerId?: string;` | unaffected | `bundles.ownerId` / entitlement owner = the PERSON who bought credits, not the pool owner (S-f) |
| `functions/src/entitlements.ts:379` | `const poolOwner = pool.createdByUid \|\| pool.ownerId \|\| pool.managerUid;` | **must change** | D3/T2 — creator-first precedence; becomes `isPoolOwnerOrManager` |
| `functions/src/entitlements.ts:380` | `if (poolOwner && poolOwner !== ownerId) {` | **must change** | D3/T2 — same check |
| `functions/src/entitlements.ts:400` | `.where("ownerId", "==", ownerId)` | unaffected | `bundles.ownerId` / entitlement owner = the PERSON who bought credits, not the pool owner (S-f) |
| `functions/src/entitlements.ts:411` | `ownerId: string;` | unaffected | `bundles.ownerId` / entitlement owner = the PERSON who bought credits, not the pool owner (S-f) |
| `functions/src/entitlements.ts:417` | `if (bundle.ownerId !== ownerId) continue;` | unaffected | `bundles.ownerId` / entitlement owner = the PERSON who bought credits, not the pool owner (S-f) |
| `functions/src/entitlements.ts:472` | `ownerId: request.auth!.uid,` | unaffected | `bundles.ownerId` / entitlement owner = the PERSON who bought credits, not the pool owner (S-f) |
| `functions/src/lib/commissionerAggregate.ts:25` | `const snap = await db.collection('pools').where('ownerId', '==', ownerUid).get();` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/lib/commissionerAggregate.ts:46` | `return pool?.ownerId \|\| pool?.createdByUid \|\| pool?.managerUid;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/lib/reminderTargets.ts:194` | `ownerId?: string;` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/lib/reminderTargets.ts:211` | `// `createdByUid \|\| ownerId \|\| managerUid` and backfillMemberRecords resolves` | **must change** | D3/T2 — comment documenting the precedence disagreement; rewrite |
| `functions/src/lib/reminderTargets.ts:212` | `// `ownerId \|\| createdByUid \|\| managerUid` — the two disagree on precedence,` | **must change** | D3/T2 — same comment |
| `functions/src/lib/reminderTargets.ts:219` | `[pool.createdByUid, pool.ownerId, pool.managerUid].filter((u): u is string => !!u),` | **must change** | D3/T2 — creator in the commissioner target union; becomes ownerId-first |
| `functions/src/lib/reminderTargets.ts:224` | `// A pre-backfill pool can carry `participantIds: [ownerId]` with NO member` | read-only consumer | comment |
| `functions/src/migrations/backfillMemberRecords.ts:56` | `const ownerUid = pool.ownerId \|\| pool.createdByUid \|\| pool.managerUid;` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/nflPickReveal.ts:137` | `pool: { ownerId?: string; managerUid?: string; participantIds?: unknown },` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/nflPoolTypes.ts:66` | `ownerId: string;` | unaffected | type/schema declaration |
| `functions/src/nflPoolTypes.ts:118` | `ownerId: string;` | unaffected | type/schema declaration |
| `functions/src/nflPoolTypes.ts:170` | `ownerId: string;` | unaffected | type/schema declaration |
| `functions/src/nflPools.ts:146` | `ownerId: uid,` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/nflPools.ts:361` | `pool: { participantIds?: unknown; ownerId?: string; managerUid?: string; createdByUid?: string },` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/nflPools.ts:366` | `const isOwnerOrManager = pool.ownerId === uid \|\| pool.managerUid === uid \|\| pool.createdByUid === uid;` | **must change** | D3/T2 — creator admitted as owner/manager; becomes `isPoolOwnerOrManager` |
| `functions/src/nflPools.ts:806` | `role: existingMember?.role ?? (pool.ownerId === uid ? 'MANAGER' : 'PARTICIPANT'),` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/playoffPools.ts:287` | `const isManager = pool.ownerId === uid \|\| isAdmin;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/poolExceptions.ts:511` | `role: existingMember?.role ?? (pool.ownerId === targetUid ? 'MANAGER' : 'PARTICIPANT'),` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/poolExceptions.ts:609` | `// Principal: ownerId \|\| managerUid \|\| SUPER_ADMIN (loadPoolAndAssertManager).` | read-only consumer | comment |
| `functions/src/poolOps.ts:32` | `* `ownerId` is CANONICAL; `createdByUid` is a functions-only fallback used ONLY` | read-only consumer | comment |
| `functions/src/poolOps.ts:33` | `* when `ownerId` is absent (PLAN-CO-COMMISSIONERS D3 — rules and the client` | read-only consumer | comment |
| `functions/src/poolOps.ts:36` | `* is a SEPARATE principal, or'd in — the old `createdByUid \|\| ownerId \|\|` | read-only consumer | comment |
| `functions/src/poolOps.ts:44` | `// `\|\|`, not `??`: a legacy empty-string ownerId must still fall back (self-review).` | read-only consumer | comment |
| `functions/src/poolOps.ts:45` | `const owner = pool?.ownerId \|\| pool?.createdByUid;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/poolOps.ts:104` | `'createdByUid', 'ownerId', 'managerUid', 'coManagers', 'coManagersRevision', 'role',` | **must change** | D8/T3 — PRIVILEGED_POOL_FIELDS gains previousOwnerId/ownershipTransferredAt/ownershipRevision |
| `functions/src/poolOps.ts:359` | `ownerId: uid,` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/poolOps.ts:467` | `// `firestore.rules` isPoolManager() allows `ownerId` OR `managerUid` to write` | read-only consumer | comment |
| `functions/src/poolOps.ts:728` | `// For now, let's just check ownerId directly or fetch user claim if needed.` | read-only consumer | comment |
| `functions/src/poolOps.ts:863` | `// D3 census: pools whose ownerId and createdByUid both exist and DISAGREE.` | read-only consumer | comment |
| `functions/src/poolOps.ts:865` | `// Kevin, not reinterpreted — ownerId is canonical from this deploy on.` | read-only consumer | comment |
| `functions/src/poolOps.ts:868` | `const mismatchSamples: Array<{ poolId: string; ownerId: string; createdByUid: string }> = [];` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/poolOps.ts:883` | `if (typeof data.ownerId === 'string' && typeof data.createdByUid === 'string' && data.ownerId !== data.crea…` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/poolOps.ts:885` | `if (mismatchSamples.length < 20) mismatchSamples.push({ poolId: doc.id, ownerId: data.ownerId, createdByUid…` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/propBets.ts:131` | `const isOwner = poolData.ownerId === request.auth!.uid;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/referral.ts:22` | `const ownerId = after.ownerId \|\| after.createdByUid;` | unaffected | create-time referral credit (history) |
| `functions/src/referral.ts:23` | `if (!ownerId) return;` | unaffected | create-time referral credit (history) |
| `functions/src/referral.ts:27` | `.where('referredUserId', '==', ownerId)` | unaffected | create-time referral credit (history) |
| `functions/src/referral.ts:37` | `if (referrerId === ownerId) {` | unaffected | create-time referral credit (history) |
| `functions/src/referral.ts:38` | `console.warn(`Blocked self-referral credit attempt by ${ownerId}`);` | unaffected | create-time referral credit (history) |
| `functions/src/referral.ts:72` | `console.log(`Referral credit awarded to ${referrerId} for referred user ${ownerId}`);` | unaffected | create-time referral credit (history) |
| `functions/src/simHarness.ts:225` | `'ownerId', 'createdByUid', 'managerUid', 'billing', 'simRunId', 'id',` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/simHarness.ts:399` | `const ownerId = typeof data.ownerId === 'string' ? data.ownerId : undefined;` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/simHarness.ts:400` | `const uids = [...new Set([...realUids, ...(ownerId ? [ownerId] : [])])];` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/simHarness.ts:417` | `if (ownerId) {` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/simHarness.ts:419` | `await recomputeCommissionerAggregate(db, ownerId);` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/simHarness.ts:421` | `console.warn(`[simHarness] owner aggregate recompute failed for ${ownerId}:`, e);` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/squares.ts:71` | `if (pool.isLocked && pool.ownerId !== userId) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/squares.ts:93` | `if (mySquares >= pool.maxSquaresPerPlayer && pool.ownerId !== userId) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/squares.ts:124` | `const role = pool.ownerId === userId ? 'ADMIN' : (isAuthenticated ? 'USER' : 'GUEST');` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/squares.ts:177` | `let isAuthorized = pool.ownerId === userId;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/squares.ts:224` | `if (pool.ownerId === userId \|\| pool.managerUid === userId) return;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/stripe.ts:233` | `.where("ownerId", "==", userId)` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/stripe.ts:630` | `ownerId: userId,` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/types.ts:195` | `ownerId?: string; // ID of the user who owns this pool` | **must change** | T1 — pool type gains previousOwnerId?/ownershipTransferredAt?/ownershipRevision? (near here) |
| `functions/src/types.ts:468` | `ownerId: string;` | unaffected | type/schema declaration |
| `functions/src/types.ts:543` | `ownerId: string;` | unaffected | type/schema declaration |
| `functions/src/types.ts:615` | `ownerId?: string; // Back-compat / Rules` | unaffected | type/schema declaration |
| `functions/src/userProfile.ts:141` | `const isPoolStaff = pool.ownerId === caller \|\| pool.managerUid === caller;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |

88 lines — must change 9, read-only consumer 35, unaffected 44.

## S3 — `functions/src` (non-test): `createdByUid` — the D3 precedence sweep

| Site | Line (trimmed) | Classification | Why |
|---|---|---|---|
| `functions/src/backfill.ts:41` | `// 1. Backfill missing base fields (createdByUid, isPublic)` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/backfill.ts:43` | `if (!pool.createdByUid) {` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/backfill.ts:44` | `updates.createdByUid = ownerId;` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/backfill.ts:47` | `// createdByUid. This used to be nested inside the !createdByUid branch` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/backfill.ts:51` | `// pool that had createdByUid but no status. isLocked/isFinal cannot` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/billing.ts:400` | `if (!managerEmail && (after.ownerId \|\| after.createdByUid \|\| after.managerUid)) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/billing.ts:401` | `const managerUid = after.ownerId \|\| after.createdByUid \|\| after.managerUid;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/bracketEntries.ts:438` | `const isOwner = pool.ownerId === uid \|\| pool.managerUid === uid \|\| pool.createdByUid === uid \|\|` | **must change** | D3/T2 — creator admitted as owner; becomes `isPoolOwnerOrManager` |
| `functions/src/coCommissioners.ts:84` | `if (targetUid === (pool.ownerId \|\| pool.createdByUid) \|\| targetUid === pool.managerUid) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/entitlements.ts:370` | `createdByUid?: string;` | unaffected | `bundles.ownerId` / entitlement owner = the PERSON who bought credits, not the pool owner (S-f) |
| `functions/src/entitlements.ts:378` | `// Owner precedence mirrors poolOps.ts (createdByUid primary, then legacy fallbacks).` | unaffected | `bundles.ownerId` / entitlement owner = the PERSON who bought credits, not the pool owner (S-f) |
| `functions/src/entitlements.ts:379` | `const poolOwner = pool.createdByUid \|\| pool.ownerId \|\| pool.managerUid;` | **must change** | D3/T2 — creator-first precedence; becomes `isPoolOwnerOrManager` |
| `functions/src/lib/commissionerAggregate.ts:46` | `return pool?.ownerId \|\| pool?.createdByUid \|\| pool?.managerUid;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/lib/reminderTargets.ts:195` | `createdByUid?: string;` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/lib/reminderTargets.ts:211` | `// `createdByUid \|\| ownerId \|\| managerUid` and backfillMemberRecords resolves` | **must change** | D3/T2 — comment documenting the precedence disagreement; rewrite |
| `functions/src/lib/reminderTargets.ts:212` | `// `ownerId \|\| createdByUid \|\| managerUid` — the two disagree on precedence,` | **must change** | D3/T2 — same comment |
| `functions/src/lib/reminderTargets.ts:219` | `[pool.createdByUid, pool.ownerId, pool.managerUid].filter((u): u is string => !!u),` | **must change** | D3/T2 — creator in the commissioner target union; becomes ownerId-first |
| `functions/src/migrations/backfillMemberRecords.ts:56` | `const ownerUid = pool.ownerId \|\| pool.createdByUid \|\| pool.managerUid;` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/nflPickReveal.ts:106` | `* is untouched), and `createdByUid` on its own still buys nothing here.` | read-only consumer | comment |
| `functions/src/nflPools.ts:145` | `createdByUid: uid,` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/nflPools.ts:361` | `pool: { participantIds?: unknown; ownerId?: string; managerUid?: string; createdByUid?: string },` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/nflPools.ts:366` | `const isOwnerOrManager = pool.ownerId === uid \|\| pool.managerUid === uid \|\| pool.createdByUid === uid;` | **must change** | D3/T2 — creator admitted as owner/manager; becomes `isPoolOwnerOrManager` |
| `functions/src/poolOps.ts:32` | `* `ownerId` is CANONICAL; `createdByUid` is a functions-only fallback used ONLY` | read-only consumer | comment |
| `functions/src/poolOps.ts:34` | `* never read `createdByUid`, so treating it as a coequal principal would keep` | read-only consumer | comment |
| `functions/src/poolOps.ts:36` | `* is a SEPARATE principal, or'd in — the old `createdByUid \|\| ownerId \|\|` | read-only consumer | comment |
| `functions/src/poolOps.ts:45` | `const owner = pool?.ownerId \|\| pool?.createdByUid;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/poolOps.ts:104` | `'createdByUid', 'ownerId', 'managerUid', 'coManagers', 'coManagersRevision', 'role',` | **must change** | D8/T3 — PRIVILEGED_POOL_FIELDS gains previousOwnerId/ownershipTransferredAt/ownershipRevision |
| `functions/src/poolOps.ts:358` | `createdByUid: uid,` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/poolOps.ts:863` | `// D3 census: pools whose ownerId and createdByUid both exist and DISAGREE.` | read-only consumer | comment |
| `functions/src/poolOps.ts:868` | `const mismatchSamples: Array<{ poolId: string; ownerId: string; createdByUid: string }> = [];` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/poolOps.ts:883` | `if (typeof data.ownerId === 'string' && typeof data.createdByUid === 'string' && data.ownerId !== data.crea…` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/poolOps.ts:885` | `if (mismatchSamples.length < 20) mismatchSamples.push({ poolId: doc.id, ownerId: data.ownerId, createdByUid…` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/referral.ts:22` | `const ownerId = after.ownerId \|\| after.createdByUid;` | unaffected | create-time referral credit (history) |
| `functions/src/schemas/noInputAdmin.ts:22` | `*   1. Leg 1 rewrites `status` from isLocked/isFinal whenever `createdByUid` is` | read-only consumer | comment |
| `functions/src/simHarness.ts:225` | `'ownerId', 'createdByUid', 'managerUid', 'billing', 'simRunId', 'id',` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/types.ts:196` | `createdByUid?: string; // Required for RBAC` | unaffected | type/schema declaration |

36 lines — must change 7, read-only consumer 13, unaffected 16.

## S4 — `functions/src` (non-test): `managerUid`

| Site | Line (trimmed) | Classification | Why |
|---|---|---|---|
| `functions/src/billing.ts:61` | `* contactEmail, then falls back to users/{ownerId \|\| managerUid}.email.` | read-only consumer | comment |
| `functions/src/billing.ts:66` | `const commissionerUid = poolData.ownerId \|\| poolData.managerUid;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/billing.ts:400` | `if (!managerEmail && (after.ownerId \|\| after.createdByUid \|\| after.managerUid)) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/billing.ts:401` | `const managerUid = after.ownerId \|\| after.createdByUid \|\| after.managerUid;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/billing.ts:402` | `const userDoc = await db.collection("users").doc(managerUid).get();` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/bracketEntries.ts:373` | `if (uid !== poolData.managerUid && uid !== poolData.ownerId) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/bracketEntries.ts:380` | `if (uid !== poolData.managerUid && uid !== poolData.ownerId) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/bracketEntries.ts:438` | `const isOwner = pool.ownerId === uid \|\| pool.managerUid === uid \|\| pool.createdByUid === uid \|\|` | **must change** | D3/T2 — creator admitted as owner; becomes `isPoolOwnerOrManager` |
| `functions/src/bracketOps.ts:34` | `if (poolData?.managerUid !== uid && poolData?.ownerId !== uid) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/bracketPools.ts:79` | `managerUid: uid,` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/bracketPools.ts:186` | `if (poolData.managerUid !== uid) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/coCommissioners.ts:21` | `*   1. STRICT owner (`isPoolOwnerOrManager` — owner or legacy managerUid, never` | read-only consumer | comment |
| `functions/src/coCommissioners.ts:84` | `if (targetUid === (pool.ownerId \|\| pool.createdByUid) \|\| targetUid === pool.managerUid) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/entitlements.ts:372` | `managerUid?: string;` | unaffected | `bundles.ownerId` / entitlement owner = the PERSON who bought credits, not the pool owner (S-f) |
| `functions/src/entitlements.ts:379` | `const poolOwner = pool.createdByUid \|\| pool.ownerId \|\| pool.managerUid;` | **must change** | D3/T2 — creator-first precedence; becomes `isPoolOwnerOrManager` |
| `functions/src/lib/commissionerAggregate.ts:46` | `return pool?.ownerId \|\| pool?.createdByUid \|\| pool?.managerUid;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/lib/reminderTargets.ts:196` | `managerUid?: string;` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/lib/reminderTargets.ts:211` | `// `createdByUid \|\| ownerId \|\| managerUid` and backfillMemberRecords resolves` | **must change** | D3/T2 — comment documenting the precedence disagreement; rewrite |
| `functions/src/lib/reminderTargets.ts:212` | `// `ownerId \|\| createdByUid \|\| managerUid` — the two disagree on precedence,` | **must change** | D3/T2 — same comment |
| `functions/src/lib/reminderTargets.ts:219` | `[pool.createdByUid, pool.ownerId, pool.managerUid].filter((u): u is string => !!u),` | **must change** | D3/T2 — creator in the commissioner target union; becomes ownerId-first |
| `functions/src/migrations/backfillMemberRecords.ts:56` | `const ownerUid = pool.ownerId \|\| pool.createdByUid \|\| pool.managerUid;` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/nflPickReveal.ts:137` | `pool: { ownerId?: string; managerUid?: string; participantIds?: unknown },` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/nflPoolTypes.ts:67` | `managerUid: string;` | unaffected | type/schema declaration |
| `functions/src/nflPoolTypes.ts:119` | `managerUid: string;` | unaffected | type/schema declaration |
| `functions/src/nflPoolTypes.ts:171` | `managerUid: string;` | unaffected | type/schema declaration |
| `functions/src/nflPools.ts:147` | `managerUid: uid,` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/nflPools.ts:361` | `pool: { participantIds?: unknown; ownerId?: string; managerUid?: string; createdByUid?: string },` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `functions/src/nflPools.ts:366` | `const isOwnerOrManager = pool.ownerId === uid \|\| pool.managerUid === uid \|\| pool.createdByUid === uid;` | **must change** | D3/T2 — creator admitted as owner/manager; becomes `isPoolOwnerOrManager` |
| `functions/src/poolExceptions.ts:609` | `// Principal: ownerId \|\| managerUid \|\| SUPER_ADMIN (loadPoolAndAssertManager).` | read-only consumer | comment |
| `functions/src/poolOps.ts:35` | `* a phantom who can call callables but sees no Commissioner tab). `managerUid`` | read-only consumer | comment |
| `functions/src/poolOps.ts:37` | `* managerUid` chain resolved ONE owner and silently dropped a distinct` | read-only consumer | comment |
| `functions/src/poolOps.ts:38` | `* `managerUid` whenever an owner was present (Table 2 note 1).` | read-only consumer | comment |
| `functions/src/poolOps.ts:46` | `return uid === owner \|\| uid === pool?.managerUid;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/poolOps.ts:84` | `* reads `coManagers`. It keeps `managerUid`, which rules `:82` and `closePool`'s` | read-only consumer | comment |
| `functions/src/poolOps.ts:104` | `'createdByUid', 'ownerId', 'managerUid', 'coManagers', 'coManagersRevision', 'role',` | **must change** | D8/T3 — PRIVILEGED_POOL_FIELDS gains previousOwnerId/ownershipTransferredAt/ownershipRevision |
| `functions/src/poolOps.ts:467` | `// `firestore.rules` isPoolManager() allows `ownerId` OR `managerUid` to write` | read-only consumer | comment |
| `functions/src/poolOps.ts:470` | `// managerUid bypass because the helper resolved a single owner; the helper` | read-only consumer | comment |
| `functions/src/propBets.ts:132` | `const isManager = poolData.managerUid === request.auth!.uid;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/scoreUpdates.ts:1324` | `// sim tools narrow to owner / managerUid / SUPER_ADMIN; a forged` | read-only consumer | comment |
| `functions/src/simHarness.ts:225` | `'ownerId', 'createdByUid', 'managerUid', 'billing', 'simRunId', 'id',` | unaffected | one-off / sim tooling; note backfill.ts:67 writes the managedPools index T1 keeps consistent |
| `functions/src/squares.ts:176` | `// Permission Check: Owner only for now (managerUid is for BracketPool, not GameState)` | read-only consumer | comment |
| `functions/src/squares.ts:224` | `if (pool.ownerId === userId \|\| pool.managerUid === userId) return;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `functions/src/types.ts:129` | `managerUid?: string; // UID of the pool manager` | unaffected | type/schema declaration |
| `functions/src/types.ts:614` | `managerUid: string;` | unaffected | type/schema declaration |
| `functions/src/userProfile.ts:141` | `const isPoolStaff = pool.ownerId === caller \|\| pool.managerUid === caller;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |

45 lines — must change 7, read-only consumer 25, unaffected 13.

## S5 — `src/`: `ownerId` / `managerUid` / `createdByUid`

| Site | Line (trimmed) | Classification | Why |
|---|---|---|---|
| `src/components/Dashboards/GlobalCommissionerDashboard.tsx:50` | `// The tiles keep their PRE-co-commissioner scope (owner ∨ managerUid — what` | read-only consumer | comment |
| `src/components/Dashboards/GlobalCommissionerDashboard.tsx:56` | `// the server aggregate keys on `ownerId` alone, so a distinct `managerUid`` | read-only consumer | comment |
| `src/components/Dashboards/GlobalCommissionerDashboard.tsx:116` | `?tab=manager AFTER a strict owner/managerUid guard, which would refuse a` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/Grid.tsx:445` | `<BillingGate pool={gameState as any} isCommissioner={!!currentUser && (currentUser.id === (gameState as any…` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/NFLPoolDashboard/NFLManagerView.tsx:297` | `[(pool as any)?.createdByUid, (pool as any)?.ownerId, (pool as any)?.managerUid].filter(Boolean),` | **must change** | D3/T2 — client commissioner set ranks createdByUid first; drop it |
| `src/components/NFLPoolDashboard/NFLManagerView.tsx:391` | `// STRICT isPoolManager: owner / managerUid / SUPER_ADMIN — exactly the set the` | read-only consumer | comment |
| `src/components/NFLPoolDashboard/NFLManagerView.tsx:1436` | `owner, not a distinct managerUid (already a commissioner), and only` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/NFLPoolDashboard/NFLManagerView.tsx:1439` | `{viewerIsOwner && !row.isOwner && row.uid !== pool.managerUid && (row.hasMember \|\| coManagers.includes(ro…` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/NFLPoolDashboard/NFLManagerView.tsx:1734` | `{/* ── Cancel Pool ── owner/managerUid/SA ONLY (PLAN-CO-COMMISSIONERS C8/D4):` | read-only consumer | comment |
| `src/components/NFLPoolDashboard/NFLPicksGrid.tsx:25` | `* permission-denied for anyone who is not the pool's `ownerId`, `managerUid` or` | read-only consumer | comment |
| `src/components/ParticipantDashboard.tsx:142` | `// PLAN-CO-COMMISSIONERS D7: owner/managerUid OR NAMED NFL co-commissioner —` | read-only consumer | comment |
| `src/components/ParticipantDashboard.tsx:748` | `(pool.ownerId === user.id \|\| pool.managerUid === user.id) &&` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/PropsWizard/PropsWizard.tsx:55` | `ownerId: user?.uid,` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `src/components/PropsWizard/PropsWizard.tsx:147` | `ownerId: user.uid,` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `src/components/SuperAdmin.tsx:298` | `const isOwner = p.ownerId === u.id \|\| (p as any).managerUid === u.id;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/SuperAdmin.tsx:1101` | `((p as unknown as PoolLike).ownerId as string \|\| '').toLowerCase().includes(lowSearch);` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/SuperAdmin.tsx:1443` | `const ownerId = isBracket ? poolLike.managerUid as string : poolLike.ownerId as string;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/SuperAdmin.tsx:1444` | `const contact = users.find(u => u.id === ownerId)?.email \|\| (isBracket ? 'N/A' : (pool as GameState).cont…` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/SuperAdmin.tsx:3297` | `{users.find(u => u.id === (viewingPool.type === 'BRACKET' ? (viewingPool as unknown as PoolLike).managerUid…` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/SuperAdmin.tsx:3300` | `UID: {viewingPool.type === 'BRACKET' ? (viewingPool as unknown as PoolLike).managerUid as string : (viewing…` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/SuperAdmin.tsx:3733` | `const owner = p.type === 'BRACKET' ? (p as unknown as PoolLike).managerUid as string : (p as unknown as Poo…` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/SuperAdmin.tsx:3761` | `const owner = p.type === 'BRACKET' ? (p as unknown as PoolLike).managerUid as string : (p as unknown as Poo…` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/SuperAdmin.tsx:3770` | `const owner = p.type === 'BRACKET' ? (p as unknown as PoolLike).managerUid as string : (p as unknown as Poo…` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/admin/OperationsPanel.tsx:408` | `blastRadius: 'Read-only — no writes. Reports scanned / withField / nonEmpty / malformed + samples, plus the…` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/admin/monetization/BundleLiabilityPanel.tsx:79` | `<tr key={r.ownerId} className="border-t border-line/50">` | unaffected | admin monetization view; `pools.ownerId` filter follows the doc live, `bundles.ownerId` is the person |
| `src/components/admin/monetization/BundleLiabilityPanel.tsx:81` | `{r.ownerId.slice(0, 14)}` | unaffected | admin monetization view; `pools.ownerId` filter follows the doc live, `bundles.ownerId` is the person |
| `src/components/admin/monetization/BundleLiabilityPanel.tsx:122` | `{b.ownerId ? b.ownerId.slice(0, 12) : '—'}` | unaffected | admin monetization view; `pools.ownerId` filter follows the doc live, `bundles.ownerId` is the person |
| `src/components/admin/monetization/UserMoneyProfile.tsx:37` | `// that billingCharges.userId / bundles.ownerId reference.` | unaffected | admin monetization view; `pools.ownerId` filter follows the doc live, `bundles.ownerId` is the person |
| `src/components/admin/monetization/UserMoneyProfile.tsx:41` | `const userBundles = useMemo(() => bundles.filter((b) => b.ownerId === uid), [bundles, uid]);` | unaffected | admin monetization view; `pools.ownerId` filter follows the doc live, `bundles.ownerId` is the person |
| `src/components/admin/monetization/UserMoneyProfile.tsx:42` | `const userPools = useMemo(() => pools.filter((p) => p.ownerId === uid), [pools, uid]);` | unaffected | admin monetization view; `pools.ownerId` filter follows the doc live, `bundles.ownerId` is the person |
| `src/components/admin/monetization/monetizationCalcs.ts:217` | `ownerId: string;` | unaffected | admin monetization view; `pools.ownerId` filter follows the doc live, `bundles.ownerId` is the person |
| `src/components/admin/monetization/monetizationCalcs.ts:257` | `const owner = b.ownerId ?? 'unknown';` | unaffected | admin monetization view; `pools.ownerId` filter follows the doc live, `bundles.ownerId` is the person |
| `src/components/admin/monetization/monetizationCalcs.ts:260` | `row = { ownerId: owner, outstandingCredits: 0, dollarValue: 0, bundleCount: 0 };` | unaffected | admin monetization view; `pools.ownerId` filter follows the doc live, `bundles.ownerId` is the person |
| `src/components/billing/BillingInvoiceCard.tsx:220` | `where('ownerId', '==', usr.uid),` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/routes/AdminRoute.tsx:79` | `const isOwner = user?.id === currentPool.ownerId \|\| user?.id === (currentPool as any).managerUid;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/routes/PoolRoute.tsx:307` | `if (currentOwned + ids.length > limit && squaresPool.ownerId !== user?.id) return { success: false, message…` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/routes/PoolRoute.tsx:326` | `const p = pool as { ownerId?: string; managerUid?: string };` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `src/components/routes/PoolRoute.tsx:327` | `const ownerId = p.ownerId \|\| p.managerUid;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/routes/PoolRoute.tsx:341` | `ownerId,` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/routes/PoolRoute.tsx:391` | `if (squaresPool.gridPassword && !isUnlocked && user?.id !== squaresPool.ownerId) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/routes/PoolRoute.tsx:425` | `{user && (user.id === squaresPool.ownerId \|\| isSuperAdmin(user)) && (` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/components/wizard/create/buildPlayoffPayload.ts:7` | `// re-validates and stamps server-only fields (billing/status/ownerId/id), so we` | unaffected | client fixture / create-payload shape (server strips privileged fields on create) |
| `src/constants.ts:9` | `export const createNewPool = (name: string = 'New March Melee Pool', ownerId?: string, managerName: string …` | unaffected | client fixture / create-payload shape (server strips privileged fields on create) |
| `src/constants.ts:91` | `ownerId,` | unaffected | client fixture / create-payload shape (server strips privileged fields on create) |
| `src/constants.ts:92` | `managerUid: ownerId \|\| '',` | unaffected | client fixture / create-payload shape (server strips privileged fields on create) |
| `src/pages/DevDashboardPreview.tsx:89` | `id, name, type, status, ownerId: 'demo', managerUid: 'demo',` | unaffected | client fixture / create-payload shape (server strips privileged fields on create) |
| `src/pages/DevDashboardPreview.tsx:141` | `const rosterPool = { id: 'rp', name: "Kevin's Pick'em", type: 'NFL_PICKEM', status: 'OPEN', ownerId: 'demo'…` | unaffected | client fixture / create-payload shape (server strips privileged fields on create) |
| `src/services/dbService.ts:107` | `ownerId?: string;` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `src/services/dbService.ts:882` | `subscribeToPools: (callback: (pools: Pool[]) => void, onError?: (error: Error) => void, ownerId?: string) => {` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `src/services/dbService.ts:885` | `if (ownerId) {` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/services/dbService.ts:886` | `q = query(collection(db, "pools"), or(where("ownerId", "==", ownerId), where("managerUid", "==", ownerId)),…` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/services/dbService.ts:1063` | `const q = query(collection(db, 'bundles'), where('ownerId', '==', uid));` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/types/index.ts:59` | `ownerId: string;` | unaffected | type/schema declaration |
| `src/types/index.ts:60` | `managerUid: string;` | unaffected | type/schema declaration |
| `src/types/index.ts:137` | `ownerId: string;` | unaffected | type/schema declaration |
| `src/types/index.ts:138` | `managerUid: string;` | unaffected | type/schema declaration |
| `src/types/index.ts:340` | `managerUid: string; // User ID of the pool manager` | unaffected | type/schema declaration |
| `src/types/index.ts:424` | `ownerId?: string; // ID of the user who owns this pool` | **must change** | T1 — client pool type gains the three fields (near here) |
| `src/types/index.ts:709` | `managerUid: string;` | unaffected | type/schema declaration |
| `src/types/index.ts:710` | `ownerId?: string; // Back-compat / Rules` | unaffected | type/schema declaration |
| `src/types/nflPoolTypes.ts:62` | `ownerId: string;` | unaffected | type/schema declaration |
| `src/types/nflPoolTypes.ts:63` | `managerUid: string;` | unaffected | type/schema declaration |
| `src/types/nflPoolTypes.ts:133` | `ownerId: string;` | unaffected | type/schema declaration |
| `src/types/nflPoolTypes.ts:134` | `managerUid: string;` | unaffected | type/schema declaration |
| `src/types/nflPoolTypes.ts:196` | `ownerId: string;` | unaffected | type/schema declaration |
| `src/types/nflPoolTypes.ts:197` | `managerUid: string;` | unaffected | type/schema declaration |
| `src/utils/auth.ts:21` | `export const isPoolOwner = (user: User \| null \| undefined, pool: { ownerId?: string; managerUid?: string …` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `src/utils/auth.ts:23` | `return pool.ownerId === user.id \|\| pool.managerUid === user.id;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/utils/auth.ts:27` | `export const isPoolManager = (user: User \| null \| undefined, pool: { ownerId?: string; managerUid?: strin…` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `src/utils/auth.ts:56` | `pool: { ownerId?: string; managerUid?: string; type?: string } \| null \| undefined,` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `src/utils/auth.ts:94` | `export const canManageEntries = (user: User \| null \| undefined, pool: { ownerId?: string; managerUid?: st…` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `src/utils/poolRoster.test.ts:24` | `ownerId: 'owner',` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `src/utils/poolRoster.test.ts:668` | `pool: pool({ ownerId: 'owner', participantIds: ['owner', 'm2'] }),` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `src/utils/poolRoster.test.ts:683` | `pool: pool({ ownerId: 'owner', participantIds: ['owner', 'm2'] }),` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `src/utils/poolRoster.test.ts:700` | `pool: pool({ ownerId: 'owner', participantIds: ['owner', 'm2', 'm3'] }),` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `src/utils/poolRoster.test.ts:720` | `pool: pool({ ownerId: 'owner', participantIds: ['owner'] }),` | unaffected | create-time write (both slots from one uid — the reason D2 moves managerUid too) |
| `src/utils/poolRoster.ts:32` | `/** The pool doc. Only `participantIds`, `ownerId` and `settings` are read. */` | read-only consumer | comment |
| `src/utils/poolRoster.ts:219` | `const ownerId = pool?.ownerId;` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/utils/poolRoster.ts:230` | `isOwner: !!ownerId && r.uid === ownerId,` | read-only consumer | reads the owner from the pool doc per call/render — moves with the doc |
| `src/utils/testing/simulators/bracketE2ESimulator.ts:142` | `managerUid: 'test-admin-e2e',` | unaffected | client fixture / create-payload shape (server strips privileged fields on create) |
| `src/utils/testing/simulators/bracketSimulator.ts:113` | `managerUid: 'test-admin', // Shim for Partial<BracketPool>` | unaffected | client fixture / create-payload shape (server strips privileged fields on create) |

81 lines — must change 2, read-only consumer 35, unaffected 44.

## S6 — `shared/`

| Site | Line (trimmed) | Classification | Why |
|---|---|---|---|
| `shared/schemas/bundle.ts:92` | `ownerId: z.string().min(1),` | unaffected | `bundles.ownerId` = the PERSON who bought the bundle, never the pool (S-f) |

1 line — must change 0, read-only consumer 0, unaffected 1.

## S7 — `tests/` and `functions/src/__tests__` (counts + files only)

| File | Hits | Classification | Note |
|---|---|---|---|
| `functions/src/__tests__/billingCheckoutSchema.test.ts` | 1 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/bundleSchema.test.ts` | 2 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/autoScore.emulator.test.ts` | 2 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/backfillPools.emulator.test.ts` | 11 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/bannedOwnerPath.emulator.test.ts` | 3 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/blindPicks.emulator.test.ts` | 10 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/coCommissioners.emulator.test.ts` | 3 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/coManagersIgnored.emulator.test.ts` | 19 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/emptySubmissionFee.emulator.test.ts` | 1 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/fixtureMatrix.emulator.test.ts` | 1 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/goldenArc.emulator.test.ts` | 1 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/hofChaosDrill.emulator.test.ts` | 1 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/hofDressRehearsal.emulator.test.ts` | 2 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/invitePath.emulator.test.ts` | 1 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/manualReminders.emulator.test.ts` | 1 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/memberRecord.emulator.test.ts` | 11 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/multiEntry.emulator.test.ts` | 1 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/phase3Arc.emulator.test.ts` | 3 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/poolCreation.emulator.test.ts` | 1 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/proxyPickLatch.emulator.test.ts` | 3 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/resubmitSameTeam.emulator.test.ts` | 1 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/scenarioRunner.emulator.test.ts` | 1 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/settingsMatrix.emulator.test.ts` | 1 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/simHarness.emulator.test.ts` | 4 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/emulator/survivorParitySettings.emulator.test.ts` | 1 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/entitlements.test.ts` | 38 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/manualReminderTargets.test.ts` | 6 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/nflPickMembership.test.ts` | 3 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `functions/src/__tests__/refreshProjections.test.ts` | 2 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `tests/co-commissioner-client.test.ts` | 2 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `tests/nfl-scoring.test.ts` | 4 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |
| `tests/onboarding-flow.test.ts` | 9 | unaffected (fixtures) / extend | existing tests pin today's shape; T1/T2 add cases; `co-commissioner-client.test.ts` and `manualReminderTargets.test.ts` are the ones T2 must update deliberately |

Total: 150 lines across 32 files.

## S8 — Commissioner-personal fields on the pool doc (D4)

```
grep -rn "contactEmail\|managerName\|paymentHandles" functions/src --include=*.ts | grep -v __tests__
```

| Site | Line (trimmed) | Role after transfer |
|---|---|---|
| `functions/src/announcements.ts:35` | `if (pool.contactEmail) emails.add(pool.contactEmail);` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/billing.ts:61` | `* contactEmail, then falls back to users/{ownerId \|\| managerUid}.email.` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/billing.ts:65` | `if (poolData.contactEmail) return poolData.contactEmail as string;` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/billing.ts:399` | `let managerEmail = after.contactEmail;` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/confirmPayment.ts:107` | `hostEmail: pool.contactEmail,` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/invites.ts:77` | `const managerName = (managerDoc.exists && (managerDoc.data() as User).name) \|\| "Your pool commi…` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/invites.ts:83` | `const subject = `${managerName} invited you to join ${poolName}`;` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/invites.ts:92` | `<p><strong>${escapeHtml(managerName)}</strong> invited you to join their pool <strong>${escapeHtm…` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/lib/poolUpdate.ts:11` | `import { writePaymentHandles, CLEAR, LEGACY_TOP_LEVEL_HANDLE_KEYS } from '../shared/paymentHandles';` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/lib/poolUpdate.ts:26` | `* sanitized update plan. When nested `paymentHandles` are edited, legacy` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/lib/poolUpdate.ts:57` | `// Reconcile payment handles: when nested paymentHandles are edited, dual-write` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/lib/poolUpdate.ts:60` | `if (set.paymentHandles && typeof set.paymentHandles === 'object') {` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/lib/poolUpdate.ts:61` | `const patch = writePaymentHandles(set.paymentHandles as Record<string, string>);` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/lib/poolUpdate.ts:62` | `set.paymentHandles = patch.paymentHandles;` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/nflPoolTypes.ts:98` | `managerName?: string;` | type declaration |
| `functions/src/nflPoolTypes.ts:99` | `contactEmail?: string;` | type declaration |
| `functions/src/nflPoolTypes.ts:150` | `managerName?: string;` | type declaration |
| `functions/src/nflPoolTypes.ts:151` | `contactEmail?: string;` | type declaration |
| `functions/src/nflPoolTypes.ts:192` | `managerName?: string;` | type declaration |
| `functions/src/nflPoolTypes.ts:193` | `contactEmail?: string;` | type declaration |
| `functions/src/poolExceptions.ts:582` | `const managerName = pool.managerName \|\| "the pool commissioner";` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/poolExceptions.ts:588` | `<p>Contact ${escapeHtml(managerName)} about any dues already paid.</p>` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/reminders.ts:322` | `recipient: pool.contactEmail,` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/reminders.ts:330` | `<p>Hi ${escapeHtml(pool.managerName)},</p>` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/reminders.ts:334` | `await sendEmail(db, pool.contactEmail, `Action Needed: ${unpaidSquares.length} Unpaid Squares`, h…` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/reminders.ts:430` | `<p>Hi ${escapeHtml(pool.managerName)},</p>` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/reminders.ts:435` | `await sendEmail(db, pool.contactEmail, `${squaresToRelease.length} Squares Auto-Released: ${pool.…` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/reminders.ts:514` | `const contactEmail = pool.contactEmail;` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/reminders.ts:515` | `if (contactEmail) {` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/reminders.ts:518` | `await sendEmail(db, contactEmail, `Pool Locking in ${Math.round(minutesUntilLock / 60)} Hours`, h…` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/reminders.ts:571` | `if (pool.contactEmail && !uniqueEmails.includes(pool.contactEmail)) {` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/reminders.ts:572` | `uniqueEmails.push(pool.contactEmail);` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/squares.ts:135` | `console.log(`[reserveSquare] Grid Full Check - Pool: ${poolId}, IsFull: ${isGridFull}, Notify: ${…` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/squares.ts:136` | `return { isGridFull, poolName: pool.name, contactEmail: pool.contactEmail, notifyAdminFull: pool.…` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/squares.ts:139` | `if (result && result.isGridFull && result.notifyAdminFull && result.contactEmail) {` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/squares.ts:140` | `console.log(`[reserveSquare] Sending Grid Full email to ${result.contactEmail}`);` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/squares.ts:149` | `sendEmail(db, result.contactEmail, subject, html, { poolId, reason: 'GRID_FULL' }).catch(err => c…` | reader — will read the NEW owner's value once T1 rewrites it |
| `functions/src/types.ts:127` | `contactEmail: string;` | type declaration |
| `functions/src/types.ts:128` | `managerName: string; // Name of the pool manager` | type declaration |
| `functions/src/types.ts:490` | `managerName?: string;` | type declaration |
| `functions/src/types.ts:491` | `contactEmail?: string;` | type declaration |
| `functions/src/types.ts:545` | `contactEmail?: string; // Consistent with other pool types` | type declaration |
| `functions/src/types.ts:622` | `managerName?: string;` | type declaration |
| `functions/src/types.ts:623` | `contactEmail?: string;` | type declaration |

44 lines. Every reader keys on the pool doc value, so D4's rewrite in the transaction is sufficient — no reader changes.

## S9 — Per-user pool indexes T1 must keep consistent (S-i)

```
grep -rn "managedPools\|collection('participations')" functions/src src --include=*.ts --include=*.tsx | grep -v __tests__
```

| Site | Line (trimmed) | Note |
|---|---|---|
| `functions/src/backfill.ts:67` | `const indexRef = usersRef.doc(ownerId).collection('managedPools').doc(poolId);` | writer at create / backfill / sim cleanup — T1 adds set(new)+delete(old) |
| `functions/src/bracketPools.ts:119` | `// Transaction: create pool + uniform side-effect bundle (managedPools,` | writer at create / backfill / sim cleanup — T1 adds set(new)+delete(old) |
| `functions/src/bracketPools.ts:121` | `// index — managedPools is added here for cross-type consistency. No` | writer at create / backfill / sim cleanup — T1 adds set(new)+delete(old) |
| `functions/src/lib/poolCreation.ts:130` | `* transaction: the managedPools owner index (all types), a participations` | writer at create / backfill / sim cleanup — T1 adds set(new)+delete(old) |
| `functions/src/lib/poolCreation.ts:143` | `// managedPools — owner index for every pool type` | writer at create / backfill / sim cleanup — T1 adds set(new)+delete(old) |
| `functions/src/lib/poolCreation.ts:144` | `t.set(userRef.collection('managedPools').doc(opts.poolId), {` | writer at create / backfill / sim cleanup — T1 adds set(new)+delete(old) |
| `functions/src/lib/poolCreation.ts:153` | `t.set(userRef.collection('participations').doc(opts.poolId), {` | writer at create / backfill / sim cleanup — T1 adds set(new)+delete(old) |
| `functions/src/lib/roles.ts:12` | `* managedPools, participations — values MANAGER/PARTICIPANT) is a DIFFERENT` | writer at create / backfill / sim cleanup — T1 adds set(new)+delete(old) |
| `functions/src/nflPools.ts:178` | `// managedPools + participations + POOL_CREATED activity + role upgrade` | writer at create / backfill / sim cleanup — T1 adds set(new)+delete(old) |
| `functions/src/nflPools.ts:322` | `transaction.set(userRef.collection('participations').doc(poolId), {` | writer at create / backfill / sim cleanup — T1 adds set(new)+delete(old) |
| `functions/src/participant.ts:290` | `const uRef = db.collection("users").doc(uid).collection("participations").doc(poolId);` | writer at create / backfill / sim cleanup — T1 adds set(new)+delete(old) |
| `functions/src/poolOps.ts:398` | `// Transaction: create pool + uniform side-effect bundle (managedPools,` | writer at create / backfill / sim cleanup — T1 adds set(new)+delete(old) |
| `functions/src/simHarness.ts:352` | `* (managedPools, participations, POOL_CREATED/POOL_ENTERED activity), plus a` | writer at create / backfill / sim cleanup — T1 adds set(new)+delete(old) |
| `functions/src/simHarness.ts:405` | `batch.delete(userRef.collection('managedPools').doc(poolId));` | writer at create / backfill / sim cleanup — T1 adds set(new)+delete(old) |
| `functions/src/simHarness.ts:406` | `batch.delete(userRef.collection('participations').doc(poolId));` | writer at create / backfill / sim cleanup — T1 adds set(new)+delete(old) |
| `functions/src/userProfile.ts:61` | `const partSnap = await db.collection('users').doc(uid).collection('participations').get();` | writer at create / backfill / sim cleanup — T1 adds set(new)+delete(old) |
| `src/components/Dashboards/GlobalCommissionerDashboard.tsx:11` | `managedPools: Pool[];` | prop name only (not the subcollection) |
| `src/components/Dashboards/GlobalCommissionerDashboard.tsx:38` | `export const GlobalCommissionerDashboard: React.FC<GlobalCommissionerDashboardProps> = ({ user, m…` | prop name only (not the subcollection) |
| `src/components/Dashboards/GlobalCommissionerDashboard.tsx:43` | `const activePools = useMemo(() => managedPools.filter(isActiveManagedPool), [managedPools]);` | prop name only (not the subcollection) |
| `src/components/Dashboards/GlobalCommissionerDashboard.tsx:51` | `// `managedPools` was before PLAN-CO-COMMISSIONERS D7) and deliberately EXCLUDE` | prop name only (not the subcollection) |
| `src/components/ParticipantDashboard.tsx:549` | `<GlobalCommissionerDashboard user={user} managedPools={myPools.filter(p => isPoolOwner(user, p) \…` | reader — uses poolId only |
| `src/pages/DevDashboardPreview.tsx:184` | `<GlobalCommissionerDashboard user={mockUser} managedPools={mockPools} />` | reader — uses poolId only |

**Measured: no reader of `users/{uid}/managedPools` exists in `src/`** (the two `GlobalCommissionerDashboard.tsx` hits are a prop named `managedPools` fed by the Hub query). The index is kept consistent for the same reason `coManagers` was cleared before it was read: a stale owner index is a future authorization bug waiting for a reader.

## S10 — Existing operations named 'transfer/reassign owner'
```
grep -rn -i "transferOwner\|reassignOwner\|changeOwner\|setPoolOwner\|transferPool\|newOwner" functions/src src
→ (nothing)
```
There is no existing path; the callable in D1 is new.

---

**Totals across S1–S6 (S1 counted once: 1 must change / 34 read-only):** must change 26, read-only consumer 142, unaffected 118 — with the per-field overlap noted above. The 'must change' rows are exactly the plan's D3 table plus D8's two lists and the two type files.

