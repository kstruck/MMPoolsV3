# PICKUP — Trust-boundary + correlation-id SWEEP-LATER (unattended-friendly)

**New-session opener:** "Read PICKUP-CALLABLE-SWEEP.md and HANDOFF.md, then start the SWEEP-LATER work. Kevin is away — run autonomously per the overnight-autonomy protocol, stop only on the hard gates below, leave a morning takeover doc."

This is a durable kickoff for the next effort on `PLAN-SECURITY-OBSERVABILITY.md`. It is deliberately chosen to be **safe to run while Kevin is away from his desk**: pure code + tests, fully gate-able locally, **no GCP-console / prod-infra gating**. Deploy stays Kevin's gate (nothing ships unattended).

---

## Why THIS and not Phase 3 (backups)

Phase 2 (observability, #8–14) is **SHIPPED + DEPLOYED + prod-verified** (PRs #171 + #173, see HANDOFF.md). The plan's next *sequential* item is Phase 3 (backups #15–19) — **but Phase 3 is a poor fit for an unattended session**: most of #15–17 is `gcloud`/GCP-console infra against the prod project (enable Firestore PITR, create a cross-region GCS bucket, IAM, scheduled-backup config) that only Kevin can run and that can't be tested without touching prod. A Phase 3 session stalls on the console within ~20 minutes. **Do Phase 3 when Kevin is at his desk** — its ready-to-run command list is captured at the bottom of this doc so it's a quick guided session then.

The SWEEP-LATER callable work below is the opposite: bounded, classified, test-gated, and it never needs Kevin mid-flight (only at merge/deploy, which is normal).

---

## The effort — two sweeps, smallest-first

### Sweep A (warm-up, ~trivial): correlation-id on the remaining FE call sites (PLAN #9 tail)

Phase 2 wired `withCorrelationId(...)` into `dbService.ts`'s 27 `httpsCallable` sites. **13 other frontend files still call `httpsCallable(functions, …)` directly without it.** Find them:
```
grep -rL "withCorrelationId" $(grep -rl "httpsCallable(functions" src --include=*.ts --include=*.tsx)
```
For each: import `withCorrelationId` from `../utils/correlationId` (adjust depth) and wrap the data argument — `fn(withCorrelationId({ … }))`, or `fn(withCorrelationId(undefined))` for no-arg calls. This is **purely additive and mechanical** — the backend already strips `_correlationId` before schema validation (`validated()`), so it's safe on every callable including `.strict()` ones. This is the guaranteed-progress first chunk; do it first, one PR, get a green gate, build momentum.

### Sweep B (main): wrap the SWEEP-LATER callables in `validated()`

**Authority doc: `PLAN-SECURITY-OBSERVABILITY-SWEEPS.md`** — it has a complete per-callable matrix (Sweep 1). Columns: name, file:line, auth class, current validation (`ZOD`/`HAND`/`NONE`), shape (`SINGLE`/`MULTI:<discriminant>`), app-check target, and **phase1 class**. There are **51 rows classed `SWEEP-LATER`**. Do NOT invent scope — the matrix already decided each callable's shape and gates. Your job is to move `SWEEP-LATER` callables onto the same `validated()` wrapper the 41 TARGET-NOW callables already use.

**Per-callable recipe** (mirror the existing Phase 1 retrofit — read a few already-migrated callables first, e.g. `functions/src/confirmPayment.ts`, `adminClaims.ts`, `bracketOps.ts:updateTournamentData`, to match the house style exactly):
1. Write a zod schema in `functions/src/schemas/<name>.ts`. **Verify the real client payload first** — grep the FE call site (usually `src/services/dbService.ts` or a component) for the exact fields sent, so a `.strict()` schema doesn't reject a legitimate call. Use `nullish()` (from `functions/src/lib/zodHelpers.ts`) for optional fields that clients may send as `null`.
2. **Single-shape** callables → flat `.strict()` / `z.strictObject`. **`MULTI:<discriminant>`** callables (the matrix names the discriminant, e.g. `MULTI:op`, `MULTI:action`, `MULTI:type`) → `z.discriminatedUnion`, strict per variant — never one flat strict schema.
   - **NO-INPUT callables (matrix validation = `NONE`) MUST preprocess null→{}**, not a bare `z.strictObject({})`. A no-arg client call `httpsCallable(fn)()` (e.g. `useEnsureAdminClaims`, and any caller that doesn't route through `withCorrelationId`) delivers `request.data` as **`null`**, which a bare strict object rejects with invalid-argument — the callable never runs. Use the established pattern: `z.preprocess((v) => v ?? {}, z.strictObject({}))` (see `sendSecuritySMSAlertSchema` / `syncMyClaimsSchema`), and add a test asserting `null`/`undefined` are accepted. Several remaining no-input callables hit this: `getAdminHealthSnapshot`, `backfillPools`, `refreshExpertPicks`, `syncPlayoffPools`, etc.
3. Wrap: `export const foo = validated({ schema, label: "foo", auth: …, role: …, appCheck: "monitor" }, async (data, request) => { … })`. Auth/role come straight from the matrix's auth column (`AUTHED` → `auth:"required"`; `PUBLIC/ANON` → `auth:"public"`; `ROLE:SUPER_ADMIN` → `role:"SUPER_ADMIN"`; `+owner`/`+mgr` gates stay as in-handler checks unless a helper already exists).
4. **App Check stays `"monitor"`** for every callable. Do NOT flip any to `"enforce"` — that is PLAN #5, a separate coverage-gated effort, explicitly out of scope here.
5. Unit-test the schema in `functions/src/__tests__/` pinning the real client payload (accept-valid + reject-unknown-field + reject-wrong-type), following the existing schema tests.

**Respect these classifications — do NOT touch:**
- `PUBLIC-EXEMPT` rows (boot/crash/public-link paths) — leave as-is.
- `INTERNAL/NA` rows — not client-callable, skip.
- `TARGET-NOW-PERMISSIVE` (`createPool`, `createNFLPool`) — already wrapped, stay passthrough per ADR-0001; don't tighten.
- Anything already classed `TARGET-NOW` — already done in Phase 1, skip.

**Batch it:** group SWEEP-LATER callables by file (e.g. all of `bracketEntries.ts` together), one PR per logical group of ~3–8 callables. Gates green before each commit. This keeps PRs reviewable and lets qodo absorb per-batch.

---

## PROGRESS LEDGER (update this as you go — a resumed session reads it first)

**Sweep B: 10 of 51 SWEEP-LATER callables done, merged, and DEPLOYED (2026-07-18).**

| Batch | PR | File | Callables | State |
|---|---|---|---|---|
| 1 | #176 | `bracketEntries.ts` | `createBracketEntry`, `updateBracketEntry`, `deleteBracketEntry` | deployed |
| 2 | #177 | `bracketEntries.ts` | `updateEntryPayment`, `adminUpdateEntryOverrides`, `adminDeleteEntry` | deployed |
| 3 | #179 | `bracketPools.ts` | `publishBracketPool`, `joinBracketPool` | deployed |
| 4 | #180 | `adminClaims.ts` | `syncMyClaims`, `backfillUserRoles` | deployed |

Fully swept files: `bracketEntries.ts` (6/6), `adminClaims.ts` (4/4). `bracketPools.ts` 2/3.

**Next suggested batches:** `poolOps.ts` (`recalculatePoolWinners`/`toggleWinnerPaid`/`fixParticipantIds`) or `nflPools.ts` (`joinNFLPool`/`executeSurvivorRebuy`/`scoreNFLWeek`).

**DEFERRED — needs its own careful batch:** `createBracketPool` (row 7). Rich nested `settings` + a `...settings` passthrough spread stores arbitrary client fields; a flat `.strict()` schema would reject data it currently persists. Needs a passthrough envelope or a client cutover — same treatment as the ADR-0001 PERMISSIVE creates. Do NOT drive-by strict it.

**Sweep A (correlation-id tail): NOT STARTED** — still ~13 FE files calling `httpsCallable` without `withCorrelationId`. Independent of Sweep B; still a good warm-up chunk.

---

## Baselines (green on current `main` — verify with `git log -1` after `git pull`)

- root vitest **257**, functions unit **598**, emulator **89 pass / 10 skipped**, frontend `tsc -b` clean, functions `npm run typecheck` clean.
- Every chunk must keep these green (counts go UP as you add schema tests — never down).

## Gate set before EVERY commit (no "done" without counts)

- `npx tsc -b` (frontend) + `npm --prefix functions run typecheck` (functions) — both clean.
- `npm test` (root) — was 257.
- `npm --prefix functions test` — was 598.
- Emulator **only if you touch functions/rules** (you will): `JAVA_HOME=/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot npm --prefix functions run test:emulator` — was 89/10-skip.
- Run the **ROOT** suite too, not just functions (a `dbService.ts` change is a root-suite concern).

## Workflow conventions (follow exactly)

- **Branch + worktree per chunk**, off latest `origin/main`: `git checkout -b <name> origin/main` (main is checked out by the primary worktree, so branch off `origin/main`, don't `git checkout main`). Run `node functions/scripts/copy-shared.mjs` + `npm --prefix functions install` in a fresh worktree before building (the copy-shared step is why root tests fail with "cannot find module ../shared/schemas/quote" on a fresh checkout).
- **One PR per chunk**, push, let CI run. qodo posts placeholder → summary → inline findings; **validity-call each finding before fixing** (track record: real but low-severity; honor the severity stop rule). Fix real ones, reject false ones with evidence on the PR, re-run gates. qodo does NOT re-review after a fix push — give ~10 min then move on.
- **CI `security-audit` runs `npm audit --audit-level=high` at the REPO ROOT.** A functions-only dep change can pass locally and fail that gate — check root too.
- Commit messages: end with `Co-Authored-By: Claude <noreply@anthropic.com>`. PR bodies: end with the Claude Code footer.
- **VERIFY A MERGE LANDED before assuming anything downstream** — `gh pr view <N> --json state` == `MERGED` AND `git log origin/main` shows the merge commit.

## Overnight-autonomy expectations (Kevin is away)

- Keep working through chunks without per-chunk approval (standing grant — see auto-memory `overnight-autonomy-protocol`). Sweep A first, then Sweep B batches until done or blocked.
- **You MAY:** open PRs, push branches, run all gates, absorb qodo, iterate.
- **You MUST STOP and leave a note (don't guess) if:** a callable's real client payload is ambiguous and grepping the FE doesn't resolve it (guessing a `.strict()` schema can break prod calls — flag it, skip that one, keep going on the rest); a gate goes red and the fix isn't obvious; a change would touch `firestore.rules` write-paths (that's a *different* parked effort with its own risk profile — note it, don't fold it in here).
- Before ending the stretch, **leave a morning takeover doc**: fold status into HANDOFF.md + update this file (which SWEEP-LATER callables are done, which remain, any skipped-and-why, next concrete batch). Commit SHAs for everything pushed.

## Hard don'ts

- **Do NOT deploy.** Deploy is Kevin's gate (functions-first ritual, supervised). Everything you build waits in PRs.
- **Do NOT touch prod data or GCP console** — nothing in this effort requires it.
- **Do NOT flip App Check `monitor`→`enforce`** (PLAN #5, separate).
- **Do NOT blanket-wrap** — follow the SWEEPS matrix classification per callable; skip PUBLIC-EXEMPT / INTERNAL-NA / already-TARGET-NOW / PERMISSIVE.
- **Do NOT start Phase 3** (needs Kevin at the console — see below).

---

## Phase 3 (backups #15–19) — ready-to-run when Kevin IS at his desk (NOT this session)

Captured here so a future *supervised* session is fast. All `gcloud`/console, all Kevin-gated, mostly untestable without prod:
- **#15 PITR:** `gcloud firestore databases update '(default)' --enable-pitr` (7-day window, hard ceiling).
- **#16 Scheduled backups:** `gcloud firestore backups schedules create --database='(default)' --recurrence=DAILY --retention=…` + a WEEKLY one. Constraints: one daily + one weekly per db, retention ≤14 weeks, backups stay in the source location (NOT cross-region).
- **#17 Cross-region durability = export (not backup):** weekly `gcloud firestore export gs://<bucket>` to a GCS bucket **in a different region**, object versioning + lifecycle. This — not #16 — is the off-region copy. Include a **documented restore drill** (`gcloud firestore import`). The scheduled-export orchestration *could* be built as a Cloud Function (autonomous-buildable), but the buckets/IAM it needs are Kevin-gated, so pair it with him.
- **#18 Firebase Auth export:** `firebase auth:export` writes a local JSON/CSV — build a scheduled job that exports → uploads to the off-region GCS bucket (lifecycle + encryption) → restore drill (`auth:import`). Closes the identity-loss gap (Auth is not in Firestore backups). **This one has the most autonomous-buildable surface** if a future session wants a code-heavy start, but it still needs Kevin's bucket + IAM.
- **#19 Storage inventory first:** `firebase.ts` configures a `storageBucket` — enumerate real buckets/objects (`gsutil ls`) before excluding Storage from backup scope; if in use, add it to the export job.

---

_Delete this file once the SWEEP-LATER fleet is done; fold the outcome into HANDOFF.md. Update the "which remain" list as you go so a resumed session picks up mid-fleet cleanly._
