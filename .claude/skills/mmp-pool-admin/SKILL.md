---
name: mmp-pool-admin
description: "Use when Kevin brings a member or commissioner support request for a live March Melee Pools pool: a member paid but is not on the standings or members page, add a member (with a pick) after the lock, an entry missing from My Entries or Manage My Pools, a cancelled pool still showing, a member shows as 'New User' or the wrong name, the Delete entry button is greyed out, standings look blank, a logo does not show, duplicate Auth accounts for one email. Gives the read-only diagnosis order, which admin callable or UI already does the job, and the dry-run-first script pattern for the cases with no callable. Any production write still goes through mmp-change-control's prod-data gate."
---

# MMP pool admin (member and pool support)

Support requests cost 40 minutes to 2 hours each in Sept 2026, mostly from re-deriving the same facts: which collection drives which page, which callable exists, where the service-account key is, and that auto mode will not let Claude run a production write. This skill front-loads those facts.

## 0. Rules

- Diagnose read-only first. Report the cause before proposing any change.
- A production data write is a prod-data mutation under `mmp-change-control`: dry run by default, `--apply` only after Kevin approves, an audit event written, and a verify read afterwards.
- Auto mode blocks admin-SDK writes to prod. Write and dry-run the script yourself, show the dry-run output, then give Kevin the exact `--apply` command to run. Do not try to work around the block.
- Prefer an existing callable or Super-Admin Operations card over a script (`mmp-superadmin-surface` section 6 lists them).
- If the cause is a code bug, fix the data for the affected users and open a PR for the code; both, not one.
- Never print member emails or names into PRs or docs; say "the member".
- A missing callable is not proof a fix does not exist: check `git log --all -S <symbol>` and open PRs before saying so.

## 1. Credentials and running admin-SDK scripts

- Keys live outside the repo in `C:\keys\`. Sessions in Sept 2026 used `C:\keys\mmp-census.json`; `mmp-diagnostics-and-tooling` section 5 names `C:\keys\gridiron-admin.json`. Run `dir C:\keys` and use what is there. The older repo scripts expect keys inside the repo (`scripts/inspectPool.js`: `./service-account.json`; `functions/inspectPool.cjs`: `functions/service-account.json`); do not copy a key into the repo to satisfy them.
- In PowerShell: `$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\keys\<key>.json"` before `node`.
- A worktree has no `node_modules`. Either run `npm --prefix functions ci` there (and the root `npm ci` before any gate; it takes about 18 minutes cold), or borrow the main checkout's firebase-admin from a scratch script:

```js
import { createRequire } from 'node:module';
const require = createRequire('D:/march-melee-pools/functions/package.json');
const admin = require('firebase-admin');
```

- Put throwaway probes in the session scratchpad, not the repo. If a probe proved useful twice, commit it under `functions/scripts/` as a read-only tool (model: `functions/scripts/censusMembership.mjs`).

## 2. Which data drives which page

| Page or symptom | Reads | Notes |
| --- | --- | --- |
| My Entries / Manage My Pools | `pools.participantIds` (array of uids), `users/{uid}/participations/{poolId}`; tab status from `src/utils/rosterHub.ts` (`isCanceledPool`, `isMyEntryPool`, `getPoolTabStatus`) | Commissioner Hub filters with `isActiveManagedPool` |
| Pool members list | `pools/{id}/members/{uid}` | Member Record; has `userName` copied at join |
| Entries and picks | `pools/{id}/entries/*` | `userName` copied at join |
| Standings | `pools/{id}/standings/current` | Written by `nflAutoScoreJob` about every 5 minutes; blank right after a change is normal, wait one cycle before calling it a bug |
| Names everywhere | `users/{uid}.displayName`, propagated to member and entry docs by `onUserNameChanged` (`functions/src/userNameSync.ts`, PR #690) | Before #690 names were copied once at join and never followed edits |
| Audit | `pools/{id}/audit` (written by `functions/src/audit.ts`), `admin_audit` | `POOL_CANCELED`, `PROXY_PICK_SUBMITTED` and other constants in `functions/src` |
| Membership drift | `node functions/scripts/censusMembership.mjs` (add `--all-types` for every pool type) | Read-only; lists members missing from `participantIds`. Expected output: no rows |

## 3. Playbook by request

### Member paid but is not in the pool

1. Look the user up in Firebase Auth by email. More than one Auth record for the email is common (Google plus email/password); find which uid, if any, has a Member Record.
2. Read `pools/{id}` (`participantIds`, lock state such as `hardLockByWeek`, billing), `members`, `entries`.
3. Usual cause: they paid the commissioner (entry fees are person to person, never through the platform) but never joined. Fix: send them the join link if the pool is still open.
4. After the lock: there is no add-member callable. `proxyPick` refuses with `WEEK_LOCKED` once Survivor hard-locks at the first kickoff, and a member with no pick takes an auto-strike. The tested path was a dry-run-first script that calls the built `functions/lib` `joinNFLPoolInternal` (which handles `participantIds`, the participation doc, the Member Record and the join audit event), then writes the entry and pick with `pickedWeeks` and `hasPlayableEntry` and a `PROXY_PICK_SUBMITTED` audit event in one transaction, refuses any game that is FINAL or already kicked off, and prints a verify block. Rebuild it from `functions/src/nflPools.ts` and `functions/src/poolExceptions.ts` rather than from memory, run the dry run, and hand Kevin the `--apply`.

### Entry or pool missing from My Entries

1. Run `censusMembership.mjs`. A uid with a Member Record but missing from `participantIds` is drift.
2. Known cause: a SUPER_ADMIN is treated as a member on the pool page, so never sees Join; picks submitted that way wrote `members` and `entries` but not `participantIds`. PR #686 made an accepted pick an implicit join, so new cases should not appear; old ones need repair.
3. Repair (dry run first): `FieldValue.arrayUnion(uid)` on `participantIds`, write `users/{uid}/participations/{poolId}`, write an audit event. Re-run the census and expect no rows.

### Cancelled pool still showing

1. Read the pool: `status: CANCELED`, `cancelledAt`, and a `POOL_CANCELED` audit row mean `cancelPool` worked.
2. Then it is the frontend: check `getPoolTabStatus` in `src/utils/rosterHub.ts` (PR #688 fixed the original case).
3. After a frontend fix merges, the www site only changes after Kevin triggers the Coolify deploy, and open tabs keep the old bundle. Check the served bundle hash before calling it still broken (`mmp-deploy-and-operate` section 2).

### Member shows as "New User" or an old name

1. Check `users/{uid}.displayName` versus `members/{uid}.userName` and the entry docs.
2. Since #690, saving the profile name propagates. Members named before #690 need one more save to fire the trigger; if the name has not changed, the trigger does not fire, so change it and change it back. A backfill script would be the better fix if many members are affected.

### Delete entry is greyed out

By design. `deleteNFLEntry` (`functions/src/nflEntryDelete.ts`) refuses after any week is scored, on a paid entry, or with no picks. `adminDeleteEntry` (`functions/src/bracketEntries.ts`) covers bracket pools only. `voidMemberRecord` and `reconcileMembership` exist as helpers with no callable. Explain the rule to Kevin; removing a scored NFL entry is a plan-gated change.

### Logo not showing

A Google Drive `/view` share link is a web page, not an image. A direct image URL is `https://lh3.googleusercontent.com/d/<fileId>=w800` (verify with `curl -I`: `content-type: image/png`). The renderer-side fix (`resolveLogoUrl`, PR #660) is not on main as of `980efc9`; until it is, give the commissioner the direct URL. Check `git log --all -S resolveLogoUrl` before saying it does not exist.

### Pool or game state looks wrong

Read-only helpers already in the repo: `scripts/checkPoolGame.mjs`, `scripts/inspectPool.js`, `functions/inspectPool.cjs`, `functions/scripts/censusMembership.mjs`, `.claude/skills/mmp-diagnostics-and-tooling/scripts/firestore-census.mjs`. Scoring disputes go to `mmp-pools-domain-reference`; wrong data with no error goes to `mmp-debugging-playbook`.

## 4. Report to Kevin

1. What the member sees, and the cause in one sentence.
2. Evidence: the docs and fields read (no personal data).
3. Data fix: dry-run output, then the exact command for him to run, then the verify step.
4. Code fix, if any: PR link, or the plan doc if it is plan-gated.
5. What to tell the member.

## When NOT to use this skill

- Admin UI changes or new admin callables → **mmp-superadmin-surface** and **mmp-change-control**.
- Scheduled jobs failing → **mmp-debugging-playbook** section 2b.
- Scoring math or tiebreak disputes → **mmp-pools-domain-reference**.
- Bulk test-pool cleanup → **mmp-diagnostics-and-tooling** section 3.

## Provenance

Written 2026-10-30 from the Sept 2026 support sessions (add member with pick, pool cleanup, entry not showing, New User account, missing logo) and checked by grep against main `980efc9`. Re-verify before trusting:

| Fact | Command (repo root) |
| --- | --- |
| No add-member callable yet | `git grep -n "addMember" functions/src` (no output = still none) |
| Implicit join on accepted pick (#686) | `git grep -n "implicit one" functions/src/nflPools.ts` |
| Name propagation trigger (#690) | `git grep -n "onUserNameChanged" functions/src` |
| `resolveLogoUrl` merged | `git grep -n "resolveLogoUrl" src` (no output = still not on main) |
| Census script still read-only | `git grep -n "never writes" functions/scripts/censusMembership.mjs` |
