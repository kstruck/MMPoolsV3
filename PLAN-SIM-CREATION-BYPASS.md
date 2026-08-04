# Plan: Sim-harness creation bypass — the Test Suite must survive the launch kill-switch

_Compiled 2026-08-04 from the failed E2E run of 2026-08-04 (all 45 NFL
scenarios refused with "New NFL_PICKEM pools are temporarily disabled by the
site administrator"). Terms per CONTEXT.md. Plan-gated under
`mmp-change-control` §1: the change touches an authorization guard
(`assertPoolCreationAllowed`). Implementation ships in the same PR as this
plan; the review log records the rounds._

## Goal

Running the 45-scenario prod E2E suite must not require flipping the public
pool-creation flags. The `poolTypeFlags` kill-switch stays authoritative for
every real user — including SUPER_ADMIN creating a REAL pool — and is
bypassed only when BOTH hold:

1. the verified caller role is `SUPER_ADMIN` (token claim, the authz
   authority per `mmp-architecture-contract`), AND
2. the creation payload is a sim pool by the existing shared predicate
   (`isSimPool` — `simRunId` present or `season` starting `sim-`,
   `shared/testPool.ts:34`).

Maintenance mode (`maintenanceMode: true`) continues to block EVERYTHING,
sims included — it means "no writes", not "no members".

## Evidence

- 2026-08-04: first E2E run failed 45/45 at pool creation; the suite only ran
  after temporarily enabling three flags in prod and restoring them after —
  a manual prod-config round-trip per E2E run, exactly what a kill-switch
  protecting a test path should not require.
- The simulator's payload already self-identifies:
  `season: 'sim-${runId}', simRunId: runId`
  (`src/utils/testing/simulators/nflSeasonSimulator.ts` — the
  `dbService.createNFLPool` call).
- Sim pools are already structurally excluded from every operational surface:
  jobs skip them (`isSimPool` in nflLockWatch/nflAutoScore/finalize),
  firestore.rules `seasonNotForgedSim()` blocks CLIENT forgery of sim seasons
  on real pools, and `cleanupSimPool`/`sweepSimRuns` purge them.

## Sweep — every `assertPoolCreationAllowed` call site (2026-08-04)

`grep -rn "assertPoolCreationAllowed" functions/src --include="*.ts"`:

| Site | Callable | Gets bypass? |
|---|---|---|
| `nflPools.ts:82` | `createNFLPool` | YES — the E2E path |
| `bracketPools.ts:42` | `createBracketPool` | YES — bracket E2E scenarios exist too |
| `poolOps.ts:257` | `createPool` (squares/props) | YES — same rule, same predicate |
| `lib/systemGuards.ts:25` | the definition | — |

## Design

`assertPoolCreationAllowed(type, opts?: { simBypass?: boolean })`:
- maintenance check FIRST, unconditional — a bypass never crosses it;
- pool-type-flag check skipped only when `opts.simBypass === true`.

Each call site computes the flag through ONE new pure predicate —
`simCreationBypassAllowed(role, payload)` in `lib/systemGuards.ts` — which
returns `normalizeRole(role) === 'SUPER_ADMIN' && isSimPool(payload)`.
Pure so it is unit- and mutation-testable without an emulator.

## Why this cannot open a hole

- **Non-admin with a forged `sim-` season:** predicate fails on role — the
  claim is server-verified, not client-supplied.
- **SUPER_ADMIN creating a real pool while types are disabled:** predicate
  fails on `isSimPool` — the payload has no sim marker, the flag still
  refuses. The kill-switch keeps meaning what it says even for Kevin.
- **A sim pool leaking into member view:** unchanged surface — sim pools were
  already creatable whenever flags were ON; every exclusion that protected
  members from them (job skips, `isPublic: false`, cleanup) is untouched.
- **Maintenance mode:** still blocks sims; asserted by test.

## Out of scope

- The importer-safety `purgeStale` machinery (PLAN-IMPORTER-SAFETY.md).
- Any change to `poolTypeFlags` semantics for real users.
