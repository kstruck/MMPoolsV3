# ADR 0001: Single createPool Cloud Function for all Pool types

Date: 2026-07-03
Status: Accepted

## Context

Pool creation is split across two paths. BracketWizard calls the `createBracketPool` callable; the Squares, Playoff, Props, and NFL wizards write directly to the `pools` collection from the client via `dbService.createPool()`. Consequences:

- `POOL_CREATED` Activity Log events are documented (CONTEXT.md) as written server-side by the pool creation function, so directly-written pools never log them.
- Billing defaults (`status: 'trial'`, `tier: 'free_tier'`, `maxPlayersAllowed`) are set client-side and are tamperable.
- Per-type validation and slug uniqueness are enforced inconsistently or not at all.

## Decision

All Pool creation goes through one callable Cloud Function, `createPool({ type, config })`, which:

1. Validates `config` against a per-type zod schema (schemas live in a shared folder consumed by both `src/` and `functions/`, so the wizard client and the callable validate against the same source of truth).
2. Enforces slug uniqueness and role authorization (COMMISSIONER or SUPER_ADMIN, not BANNED).
3. Stamps Billing defaults server-side.
4. Writes the pool doc and the `POOL_CREATED` Activity Log event atomically.

`createBracketPool` folds into this function (or becomes an internal delegate during migration). Firestore rules are tightened to deny client-side creates on `pools`.

## Alternatives considered

- **Per-type callables** (`createSquaresPool`, ...): same safety, N deploy surfaces and duplicated auth/billing/logging boilerplate.
- **Keep client writes + Firestore rules**: cannot write the Activity Log (Cloud-Function-only by design) and rules cannot express per-type schema validation well.

## Consequences

- Wizards become pure UI; a compromised client cannot forge billing state or skip activity logging.
- One more cold-start hop on launch (acceptable; creation is a rare, non-latency-critical action).
- Shared zod schema folder introduces a build-path dependency between `src/` and `functions/` that must be wired into both tsconfigs.
