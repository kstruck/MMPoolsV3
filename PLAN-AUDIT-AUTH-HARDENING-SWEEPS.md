# Sweeps — PLAN-AUDIT-AUTH-HARDENING

One entry per production-data pass this plan owns. Rule 1 (`mmp-change-control`
§1) governs every one of them: kill-switch OFF by default, dry-run DEFAULT at
the schema layer, a per-run cap, and an `admin_audit` row on every run — dry or
live — so a dry trial is reviewable evidence rather than a returned object
nobody kept.

---

## S1 — `migratePoolPasswords` (Phase B)

**Status: NOT RUN. Disarmed. Nothing in this PR mutates production data.**

### What it does

Moves every existing pool's password material off the world-readable
`pools/{id}` document and into `pools/{id}/private/access`, then deletes the
public copies and sets the non-secret `hasPoolPassword` marker.

Per pool, one of four outcomes (the planner is
`planForPool`, unit-tested in `functions/src/__tests__/poolPassword.test.ts`):

| Plan | When | Effect |
|---|---|---|
| `hash-plaintext` | the doc carries `gridPassword` or `accessControl.password`, and no private secret exists | PBKDF2-hash the plaintext into the private doc, scrub the public fields |
| `move-hash` | the doc carries only `passwordHash` | copy the hash VERBATIM into the private doc, scrub |
| `scrub-only` | a private secret already exists (or only the marker is wrong) | delete the public copies, fix the marker — **never restore** |
| *(none)* | nothing to do | skipped, not written |

The `scrub-only` precedence is the one that matters: a commissioner who changed
their password after the code shipped has a NEW private hash while the OLD
plaintext may still sit on the public doc. Honouring the plaintext on a re-run
would roll their password back.

### Safety gates (all four, verifiable in the source)

1. **Kill-switch**, OFF by default: `system/config.poolPasswordMigration`, read
   through `readJobGate` — `enabled !== true` returns immediately, and a config
   read that THROWS is not read as "enabled".
2. **Dry-run default at the SCHEMA layer** (`migratePoolPasswordsSchema`), not a
   handler `=== true`. The run is dry if EITHER the caller asks for dry OR the
   config still says dry — both have to be deliberately turned off.
3. **Per-run cap** (`limit`, default 100, max 500) with a `nextCursor`.
4. **`admin_audit` row on every run**, dry or live, carrying counts and the
   per-pool plan. The plan lines carry the pool id and the VERB only — never a
   password and never a hash.

Plus: SUPER_ADMIN with claim+doc agreement (`validated({ role: "SUPER_ADMIN" })`).

### Ordering — read this before arming

The sweep DELETES `gridPassword` from pool documents. A browser still running
the pre-Phase-B client reads that field to decide whether to render the gate at
all, so a pool swept while its visitors are on the old bundle renders **ungated**.

```
1. merge
2. npx firebase deploy   — functions BEFORE rules
3. Coolify manual redeploy of the frontend   ← the sweep is not safe before this
4. sweep, dry
5. sweep, live
```

Step 3 is not optional and is not a nicety. Nothing before it changes any
document, so stopping after step 2 is safe indefinitely.

### Arming procedure (Kevin, when he chooses to)

Every step below runs in **PowerShell 5.1** on Kevin's machine unless it says
otherwise. One command per block, no `&&`.

**Step 0 — confirm the deploy actually shipped the callable.** A stale checkout
deploys nothing and still says `Deploy complete!`.

```
npx firebase functions:list | Select-String "migratePoolPasswords"
```

Expect a row naming `migratePoolPasswords`. If it is absent, the deploy did not
include this code — `git -C D:\march-melee-pools pull --ff-only origin main`
and deploy again before going further.

**Step 1 — dry run with the kill-switch still OFF.** It should refuse.

Call `migratePoolPasswords` with `{}` from the SuperAdmin Operations panel.
Expect: `skipped: "kill-switch off …"`. That is the gate proving itself.

**Step 2 — arm the kill-switch in dry mode.** In the Firebase console, on
`system/config`, set:

```
poolPasswordMigration = { enabled: true, dryRun: true }
```

**Step 3 — dry run.** Call `migratePoolPasswords` with `{}`. Read
`plannedWrites` in full. Expect `dryRun: true` and `poolsChanged` to match the
number of pools you believe have passwords. **If a pool you did not expect
appears, stop and investigate before step 5.**

**Step 4 — page through.** If `nextCursor` is non-null, call again with
`{ "startAfter": "<that value>" }` until it comes back null. Keep every report.

**Step 5 — go live.** Set `poolPasswordMigration.dryRun = false`, then call with
`{ "dryRun": false }`. BOTH are required. Page through with `startAfter` as
before.

**Step 6 — verify.** Re-run step 3 (a dry run). A completed sweep reports
`poolsChanged: 0` on the pools already done. Then spot-check one migrated pool
in the console: `pools/{id}` must have no `gridPassword`, no
`accessControl.password`, no `passwordHash`, and `hasPoolPassword: true`;
`pools/{id}/private/access` must hold a `salt:hash` string.

**Step 7 — disarm.** Set `poolPasswordMigration.enabled = false`. Record the
run in this file (date, pools scanned/changed, the audit doc ids).

### Rollback

There is none for the deletions, and that is the point of the dry run. What
exists instead: the private doc keeps the hash, so a pool is never left gated
with nothing behind it; and `verifyPoolAccess` / `joinBracketPool` read the
private doc first, so a swept pool works the moment the callable is deployed. If
a sweep is halted mid-way, the swept and unswept pools both work — the code
handles either state, which is why the sweep is resumable rather than atomic.

### Evidence log

| Date | Mode | Pools scanned | Pools changed | audit doc | Notes |
|---|---|---|---|---|---|
| — | — | — | — | — | Not run. Disarmed at merge. |
