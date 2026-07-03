# ADR 0001: Consolidate Pool creation into one validated Cloud Function

Date: 2026-07-03 (revised same day after adversarial review)
Status: Accepted

## Context

Pool creation already happens server-side, but through three divergent callables:

- `createPool` (functions/src/poolOps.ts) — Squares, Playoff, Props via `dbService.createPool`
- `createNFLPool` (functions/src/nflPools.ts) — Pick'em/Survivor/Margin; tier and maxPlayers are precomputed on the client and trusted
- `createBracketPool` (functions/src/bracketPools.ts) — Bracket

Firestore rules already deny client `pools` creates (except `sim-*` slugs), so there is no client-write hole. The actual problems are divergence:

- No shared input validation; each callable trusts different client-shaped payloads.
- Billing stamping is inconsistent (NFL trusts client-computed tier/maxPlayers).
- Side effects differ: pool audit entries are written inconsistently, and the `POOL_CREATED` Activity Log event documented in CONTEXT.md has no writer at all.
- Authorization checks differ and are mid-rename (`POOL_MANAGER` → `COMMISSIONER`).
- Two billing-config authorities exist (`config/billing_config` vs `settings/billing_config`).

## Decision

One family of validated pool-settings operations, centered on a unified `createPool` callable:

1. **`createPool`** accepts BOTH the current flat payloads (existing `dbService.createPool` callers keep working during migration) and the new `{ type, config }` envelope. Validates against a per-type `CreatePoolInput` zod schema from a shared folder consumed by both `src/` (RHF resolver) and `functions/` (packaged via a firebase.json predeploy step that copies `shared/` into `functions/src/shared/`; `src/` imports via tsconfig path alias). Create-input schemas are distinct from stored-doc shapes; no schema pretends to describe existing pool docs.
2. **`publishPool`** (successor to `publishBracketPool`) is a companion operation owning `slugs/{slug}` reservation, `slugLower`, pool-password hashing, `lockAt` derivation, and the draft→`OPEN` transition. `createPool` reuses the same shared helper for single-shot types.
3. **`updatePoolSettings`** is a companion operation validating per-type `UpdatePoolSettings` schemas against a per-type editability matrix (which fields are editable in which of that type's lifecycle states), replacing the rules-gated client `updatePool` path for pool settings.
4. All operations authorize with both new and legacy role values (`COMMISSIONER|POOL_MANAGER|SUPER_ADMIN`, deny `BANNED`), custom claim first, user-doc fallback.
5. `createPool` stamps all billing fields server-side from the single `settings/billing_config` authority (which `enforceBillingStatus` migrates to) and applies per-type lifecycle config (Squares `DRAFT`, Bracket draft→publish `OPEN`, Props `active`, NFL `OPEN`) rather than forcing one status model.
6. Creation emits a uniform side-effect bundle atomically: pool doc, pool audit entry, `POOL_CREATED` user Activity event, `users/{uid}/managedPools` index, plus the preserved per-type owner indexes (NFL `participations`, Bracket `joinedPools`) pending a repo-wide read audit.

`createNFLPool` and `createBracketPool` become thin delegates and are deleted once all wizards call the unified function; flat-payload compatibility is removed in the same cleanup.

## Alternatives considered

- **Keep three callables, share a validation library**: leaves side-effect and billing divergence in three places; deletion pressure never materializes.
- **Per-type callables with shared core**: same safety, N deploy surfaces, boilerplate.

## Consequences

- Wizards become pure UI; billing tier computation leaves the client.
- CONTEXT.md's documented `POOL_CREATED` activity event becomes true.
- Shared schema folder is packaged by predeploy copy (decided) — CI verifies the functions build contains the copied schemas.
- Legacy role acceptance must be removed in a later cleanup once claim/doc migration completes.
