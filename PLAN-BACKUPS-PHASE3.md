# PLAN — Phase 3: Backup & recovery (Firestore + Auth)

Status: **not started** for the data that matters.

> **Correction 2026-07-21.** An earlier version of this document said the
> application had "no backup of any kind". That was too broad. The **VPS is
> backed up** — daily automatic snapshots of the Ubuntu/Coolify host, stored on
> separate infrastructure, currently four restore points going back ~10 days.
> The claim below is narrowed to what those snapshots genuinely do not cover.

**What IS protected:** the Coolify/nginx VPS — server config, environment, and
the built `www` assets. Note this is also the **reproducible** half: the
frontend is rebuilt from `main` by Coolify, and Cloud Functions,
`firestore.rules` and `firestore.indexes.json` all live in git. Losing the VPS
costs time, not data.

**What is NOT protected — the unreproducible half:**

| Asset | Backed up? | Consequence if lost |
|---|---|---|
| **Firestore** — pools, entries, picks, member records, billing charges, payout records | ✅ **PITR, 7-day window** (measured 2026-08-10) | Bad writes/corruption in the last 7 days are recoverable **while the database still exists** — PITR is historical reads/exports of a live database, not a restore after deletion or project loss. Deletion and >7-day corruption still need the scheduled/off-region exports (items 16/17). |
| **Firebase Auth** — user accounts, emails, password hashes | ⚠️ **code shipped, NOT YET ARMED** — `authBackupJob` (weekly) + `runAuthBackup` (on-demand, SUPER_ADMIN) export to GCS. Kill-switch OFF and dry-run by default; **the destination bucket does not exist yet.** See Step 6. | Until the bucket exists and the switch is flipped, this is still ❌ none in practice: every member loses access, even with a perfect Firestore restore. |

✅ **PITR IS ENABLED — measured 2026-08-10, not assumed.**
`npx firebase firestore:databases:get "(default)" --project gridiron-gamble-uzuqo --json`
returns `pointInTimeRecoveryEnablement: "POINT_IN_TIME_RECOVERY_ENABLED"`,
`versionRetentionPeriod: "604800s"` (7 days), `earliestVersionTime:
2026-08-04T04:26:00Z` — so it went on around 2026-08-04. The paragraph this
replaces said "No PITR, no scheduled backups, no exports, no Auth export"; the
first clause is now false and the other three are still true as far as this
repo can see (scheduled exports and the Auth export are console/Cloud Shell
state this machine cannot read — verify in the console before treating them as
absent OR present).

The recovery floor exists — with its limits stated: PITR reads a database that
is still there. It does not bring back a DELETED database or survive a
project-level loss; the recovery matrix below still requires the off-region
export for those. The remaining exposure is: database deletion / project loss
(items 16/17), corruption discovered more than 7 days late (item 16), and Auth
(item 18).

**Auth update (this change):** item 18's job now exists in code — weekly
`authBackupJob` plus a SUPER_ADMIN `runAuthBackup` callable, both writing an
`auth:import`-ready JSON to GCS, both kill-switched OFF and dry-run defaulted.
**That does not yet make Auth backed up.** The destination bucket has not been
created, the switch has not been flipped, and the password hash parameters that
make a restore work at all are console state nobody has captured. Until Steps
6a, 6b and 6d.0 are done by hand, Auth remains the un-recreatable half with
nothing behind it — the difference is that the remaining work is now four
console actions rather than an unwritten feature.

Scope and corrected facts come from `PLAN-SECURITY-OBSERVABILITY.md` Phase 3
(items 15–19, already corrected by Codex review #10/#11). This document is the
executable version of those items.

---

## Who does what

**Almost all of Phase 3 is Kevin-only.** PITR, backup schedules, GCS buckets and
IAM are Google Cloud project operations — there is no code to write for items
15, 16, 17 and 19. Only item 18 (the Auth export job) is code.

**Item 18's code now EXISTS** (`functions/src/authBackup.ts`), and the reason it
was deferred is handled rather than ignored. The original objection was that "a
scheduled job that writes to a nonexistent bucket is a job that fails silently",
and this repo has been bitten four times by exactly that. So the job ships
**disabled and dry-run defaulted**, and its arming gate requires the operator to
name the bucket explicitly:

- `system/config.authBackup.enabled !== true` → the job logs and does nothing.
- `enabled: true` with no valid `bucket` → the job reports `ok:false` on its
  heartbeat and is visibly UNHEALTHY, which is the opposite of failing silently.
- A live run is only possible once both are set, and a dry run rehearses the
  whole path (including the `listUsers` permission) without writing a byte.

**Recommended order:** ~~15~~ → 19 → 17 → 16 → 18. Item 15 (PITR) is **done —
measured enabled 2026-08-10**; the remaining work starts at 19. Item 18's
**Kevin half** (bucket + IAM + flipping the switch) is Step 6a.

---

## Step 0 — how to run these commands (gcloud is NOT actually required for PITR)

**CORRECTION 2026-07-21.** An earlier version of this document called installing
gcloud a blocking prerequisite. That is wrong for the single highest-value item.

**PITR can be enabled entirely from the Google Cloud console — no install, no
CLI, about two minutes.** See Step 2. Do that FIRST; it is the 7-day recovery
floor and it is the reason this document exists.

`gcloud` is still needed for the *other* pieces — backup schedules, manual
exports, bucket creation — because the Firebase CLI cannot configure them. But
you have three ways to get it, and installing locally is the least convenient:

| Option | Install needed | Use when |
|---|---|---|
| **Google Cloud console** | none | Enabling PITR (Step 2). Enough on its own for the recovery floor. |
| **Cloud Shell** (recommended for the rest) | none | Everything else here. Browser-based shell with gcloud preinstalled and already authenticated. |
| Local gcloud install | yes | Only if you want this scriptable/repeatable later. |

### Cloud Shell — the no-install path for every gcloud command below

1. Go to `https://console.cloud.google.com/?project=gridiron-gamble-uzuqo`
2. Click the **Activate Cloud Shell** icon (a `>_` terminal symbol) in the top
   right toolbar. A terminal opens at the bottom of the browser.
3. Wait for the prompt. **Expect:** something like
   `kstruck@cloudshell:~ (gridiron-gamble-uzuqo)$` — the project name in
   parentheses confirms it is already pointed at the right project.
4. Verify:
   ```
   gcloud config get-value project
   ```
   **Expect:** `gridiron-gamble-uzuqo`. **If it prints something else**, run
   `gcloud config set project gridiron-gamble-uzuqo`.
5. Every `gcloud` command in this document works in that shell as-written.

⚠️ Cloud Shell home storage is ephemeral (deleted after ~120 days idle) and it
is NOT where the Auth export should live — Step 6 uploads to GCS and deletes the
local copy either way, which is the correct behavior in Cloud Shell too.

### Local install (optional — only if you want it scriptable)

1. Open a browser and go to:
   `https://cloud.google.com/sdk/docs/install#windows`
2. Download the **Google Cloud CLI installer** for Windows
   (`GoogleCloudSDKInstaller.exe`).
3. Run it. Accept the defaults. Leave **"Run gcloud init"** checked on the last
   screen.
4. When the init console opens, sign in with the Google account that owns the
   `gridiron-gamble-uzuqo` Firebase project — the same one you use for the
   Firebase console.
5. When it asks you to pick a cloud project, choose **`gridiron-gamble-uzuqo`**.
6. **Close PowerShell entirely and open a new window.** The installer edits
   `PATH`, and an already-open shell will not see it.
7. Verify, in a **new** PowerShell window:

   ```
   gcloud --version
   ```

   **Expect:** several lines beginning with `Google Cloud SDK 5xx.x.x`.
   **If instead** you get `gcloud : The term 'gcloud' is not recognized` — the
   new-window step was missed, or the installer did not update PATH. Close and
   reopen PowerShell once more; if it still fails, re-run the installer and
   tick "Add gcloud to PATH".

8. Confirm you are pointed at the right project:

   ```
   gcloud config get-value project
   ```

   **Expect:** `gridiron-gamble-uzuqo`.
   **If instead** it prints something else or `(unset)`, run:

   ```
   gcloud config set project gridiron-gamble-uzuqo
   ```

---

## Step 1 — Read the database's location (do not guess it)

Backups and scheduled backups **stay in the source database's location**. The
off-region copy in step 4 must go to a *different* region, so you need to know
the current one first. Nothing in this repo pins a region — there is no
`region` in `.firebaserc`, `firebase.json`, or any function definition — so it
must be read from the live database.

In PowerShell:

```
gcloud firestore databases describe --database="(default)" --project gridiron-gamble-uzuqo
```

**Expect:** a YAML block. Read two fields:
- `locationId:` — e.g. `nam5`, `us-central1`, `us-east1`. **Write this down.**
  (Measured 2026-07-21: it is `nam5`.)
- `pointInTimeRecoveryEnablement:` — **`POINT_IN_TIME_RECOVERY_ENABLED`**
  (measured 2026-08-10). If you see `..._DISABLED`, PITR has been turned OFF
  since that measurement — treat that as a finding, not a to-do, and step 2
  is how to turn it back on.

**If instead** you get `PERMISSION_DENIED`, your account lacks the
`datastore.databases.get` permission — check you signed in as the project owner
in Step 0.4.

Note: `nam5` and `eur3` are **multi-region** locations. If `locationId` is one
of those, the data is already replicated across regions within that multi-region,
which raises the durability floor — but it is still **one database**, so a
delete or a bad write is still fatal. Multi-region is not a backup. Proceed
with all steps regardless.

---

## Step 2 — Enable Point-in-Time Recovery (item 15)

✅ **ALREADY DONE — measured 2026-08-10** (`POINT_IN_TIME_RECOVERY_ENABLED`,
7-day window, versions back to 2026-08-04). **Skip the Enable steps; run only
the "Verify independently" check below if you want fresh evidence.** The
instructions are kept for the recovery case where PITR is ever found disabled
again.

PITR keeps a rolling **7-day** window. Firestore retains **one version per
minute** inside that window, and you read the database as-of a whole-minute
timestamp. This is the thing that turns "we wrote garbage over the whole slate
an hour ago" from unrecoverable into a short fix.

It is a **hard 7-day ceiling**, not an archive. It does not replace steps 3-5.

> **Correction 2026-07-21:** an earlier draft of this document said "any
> microsecond". That was wrong — the documented granularity is one version per
> minute. It also said the cost scales with write volume rather than database
> size; see the cost note below for the corrected model.

### Option A — Google Cloud console (no install, recommended)

1. Go to `https://console.cloud.google.com/firestore/databases?project=gridiron-gamble-uzuqo`
2. Click the **`(default)`** database in the list.
3. In the left navigation, click **Disaster Recovery**.
4. Click **Edit**.
5. Tick **Enable point-in-time recovery**.
6. Click **Save**.
7. **Expect:** the Disaster Recovery page now shows point-in-time recovery as
   enabled. **If the checkbox is greyed out**, billing is not enabled on the
   project — PITR requires a billing-enabled project and has no free tier.

### Option B — gcloud (Cloud Shell or local; see Step 0)

```
gcloud firestore databases update "(default)" --enable-pitr --project gridiron-gamble-uzuqo
```

**Expect:** an operation runs for a few seconds, then output containing
`pointInTimeRecoveryEnablement: POINT_IN_TIME_RECOVERY_ENABLED`.

### Verify independently — whichever option you used

Do not trust the console's own success state or the command's exit code. This
repo's recurring lesson is that "armed" and "working" are separate claims. From
Cloud Shell:

```
gcloud firestore databases describe --database="(default)" --project gridiron-gamble-uzuqo --format="value(pointInTimeRecoveryEnablement)"
```

**Expect exactly:** `POINT_IN_TIME_RECOVERY_ENABLED`.
**If instead** it says `DISABLED`, the change did not take — redo Option A and
read any error shown rather than retrying blindly.

### Cost — corrected

PITR data is billed at **$0.00020 per GiB-hour** in `us-central1`, which is
about **$0.146 per GiB-month**. It is billed separately from database storage
and does not change your database storage cost. Google's own guidance is that
PITR storage typically ends up **similar in cost to the database storage
itself**.

There is **no free tier for PITR**, and you can be charged up to one day of PITR
storage even if you disable it within a day of enabling it.

Reads against the PITR window — stale reads or exports — bill as normal document
reads.

Practical read for this project: at 35 pools the database is very likely well
under 1 GiB, which puts PITR in the range of cents per month. **Check the actual
number before committing** — Firestore console → **Usage** tab shows current
stored data size.

---

## Step 3 — Inventory Cloud Storage before excluding it (item 19)

`src/firebase.ts` configures a `storageBucket`, so Storage cannot be assumed
empty. Phase 3's scope only excludes Storage from backups **if confirmed
unused**.

```
gcloud storage ls --project gridiron-gamble-uzuqo
```

**Expect:** a list of bucket URLs, likely including
`gs://gridiron-gamble-uzuqo.appspot.com` and/or
`gs://gridiron-gamble-uzuqo.firebasestorage.app`.

For each bucket listed, check whether it actually holds anything:

```
gcloud storage ls --recursive gs://gridiron-gamble-uzuqo.appspot.com | Select-Object -First 20
```

**If it returns nothing** — Storage is unused. Record that here and skip it in
the backup scope.
**If it returns objects** — Storage IS in use (likely user-uploaded avatars or
pool images). Those files are **not** covered by any Firestore backup, and the
export job in step 4 must be extended to copy them. Note what you found and
flag it; that changes the scope of this plan.

Write the answer into this file under "Findings" at the bottom so the next
session does not have to re-derive it.

---

## Step 4 — Create the off-region export bucket (item 17)

This is the copy that survives a regional problem. Scheduled backups (step 5)
do **not** do this — they stay in the source database's location.

Pick a region **different from** the `locationId` you recorded in Step 1. If
`locationId` was `nam5` or any `us-*` region, use `us-east1`; if it was already
`us-east1`, use `us-west1`. Substitute your choice for `<REGION>` below.

0. **Set the bucket name once**, in the PowerShell window you will use for the
   rest of this section. Every command below reads `$BACKUP_BUCKET`, so if the
   name has to change in step 1 you change it here and nowhere else:

   ```
   $BACKUP_BUCKET = "mmpools-firestore-backups"
   ```

   ⚠️ This variable lives only in the current terminal. **If you close it or
   open a new one, re-run this line first** — otherwise the commands below will
   expand to `gs://` and fail with an unhelpful error.

1. Create the bucket:

   ```
   gcloud storage buckets create gs://$BACKUP_BUCKET --project gridiron-gamble-uzuqo --location <REGION> --uniform-bucket-level-access
   ```

   **Expect:** `Creating gs://<your bucket>/...` and no error.
   **If instead** you get `HTTPError 409: ... already own it`, the bucket
   exists — fine, continue.
   **If** you get `409 ... bucket names must be globally unique` and you do
   *not* own it, the name is taken by someone else. Pick a suffixed name and
   **re-run the step 0 assignment with it**, e.g.:

   ```
   $BACKUP_BUCKET = "mmpools-firestore-backups-gg"
   ```

   Then re-run this step. Because every later command reads the variable,
   nothing else needs editing.

2. Turn on object versioning, so an overwrite or delete does not destroy the
   only copy:

   ```
   gcloud storage buckets update gs://$BACKUP_BUCKET --versioning
   ```

3. Set a lifecycle rule so old exports are cleaned up automatically. Create the
   file first — in PowerShell, from `D:\march-melee-pools`:

   ```
   Set-Content -Path lifecycle.json -Value '{"lifecycle":{"rule":[{"action":{"type":"Delete"},"condition":{"age":180}}]}}'
   gcloud storage buckets update gs://$BACKUP_BUCKET --lifecycle-file=lifecycle.json
   Remove-Item lifecycle.json
   ```

   **Expect:** `Updating gs://<your bucket>/...` with no error.
   180 days is a deliberate choice: long enough to recover from a problem
   noticed a season later, short enough that storage cost stays trivial.

4. Run the first export manually, so the path is proven before it is automated:

   ```
   gcloud firestore export gs://$BACKUP_BUCKET/manual-first --project gridiron-gamble-uzuqo
   ```

   **Expect:** output with `name: projects/gridiron-gamble-uzuqo/databases/(default)/operations/...`
   and `done: true` may NOT appear immediately — the export is asynchronous.

5. Wait, then confirm it actually produced bytes — **this is the step that
   distinguishes "ran" from "worked"**:

   ```
   gcloud storage ls --recursive gs://$BACKUP_BUCKET/manual-first
   ```

   **Expect:** a listing including a `.overall_export_metadata` file and one
   directory per collection (`all_namespaces/kind_pools/...` etc.), with
   non-zero sizes.
   **If instead** the listing is empty, the export is still running or it
   failed. Check with:

   ```
   gcloud firestore operations list --project gridiron-gamble-uzuqo
   ```

   and read the most recent entry's `done` and `error` fields.

---

## Step 5 — Scheduled native backups (item 16)

These are Firestore's own managed backups with a native restore path. They are
**same-location** — that is why step 4 exists — but restore is much faster and
simpler than an import.

Constraints, all enforced by the API: **one daily and one weekly schedule per
database**, retention **≤ 14 weeks**.

Daily, 7-day retention:

```
gcloud firestore backups schedules create --database="(default)" --project gridiron-gamble-uzuqo --recurrence=daily --retention=7d
```

Weekly, 14-week retention:

```
gcloud firestore backups schedules create --database="(default)" --project gridiron-gamble-uzuqo --recurrence=weekly --retention=14w --day-of-week=SUN
```

**Expect** for each: a `name:` line ending in a schedule id.
**If instead** you get `ALREADY_EXISTS`, a schedule of that recurrence is
already configured — list them rather than fighting it:

```
gcloud firestore backups schedules list --database="(default)" --project gridiron-gamble-uzuqo
```

**Verify tomorrow, not today.** A schedule that exists has produced nothing yet.
In 24+ hours run:

```
gcloud firestore backups list --project gridiron-gamble-uzuqo
```

**Expect:** at least one backup with a recent `snapshotTime` and
`state: READY`. **An empty list 24 hours after creating the schedule means the
schedule is not working** — that is the same class of failure as the two silent
missing-index outages, and it should be treated as an incident, not a wait.

---

## Step 6 — Firebase Auth export (item 18) — CODE SHIPPED, BUCKET PENDING

Firestore backups do **not** contain Auth users. Losing Auth means every member
loses access to their pools even after a byte-perfect Firestore restore, because
every entry, pick and member record is keyed by `uid`. This was the one row of
the recovery matrix that read "none".

`npx firebase auth:export` writes a **local file** and has no direct-to-GCS mode,
so the automated version is a Cloud Function rather than a wrapped CLI call.

### What shipped (`functions/src/authBackup.ts`)

| | |
|---|---|
| `authBackupJob` | Scheduled weekly, **Sunday 03:15 ET** (`15 3 * * 0`, `America/New_York`), `timeoutSeconds: 540`, `memory: 512MiB`. Heartbeat-wrapped (`system/heartbeats.authBackupJob`). |
| `runAuthBackup` | On-demand callable, **SUPER_ADMIN** via the shared `assertCallerRole` claim+doc gate (through `validated({ role: "SUPER_ADMIN" })`). Input `{ dryRun?: boolean }`, **defaults to `dryRun: true`**. |
| Pagination | `admin.auth().listUsers(1000, pageToken)` in a loop that follows `nextPageToken` to exhaustion. Capped at 250 pages (250k accounts) and at a repeated cursor; a run that stops before the tenant is exhausted is reported `complete: false`, named `-PARTIAL` in the filename, and marked `ok:false` on the heartbeat. **A truncated export that looks whole is worse than no export**, because it is only discovered on the day it is needed. |
| Objects written | `auth/auth-backup-<YYYYMMDD-HHMMSSZ>-<runid>.json` — exactly `{"users":[…]}`, the shape `firebase auth:import` consumes, with no transformation step at restore time. Then `auth/auth-backup-<stamp>-<runid>.manifest.json` — counts, page count, byte size, completeness, run id, `passwordUsersMissingHash`, **and no PII**. Users file first, manifest second: **a users object with no sibling manifest is a run that died mid-flight, not a backup.** The six-character run id makes every run's objects unique, so the job only ever CREATES and never overwrites — which is what lets the bucket grant be create-only (see the PII section). Timestamp leads, so names still sort chronologically. |
| Import-shape fidelity | The record mapping is written against firebase-tools' actual validator (`lib/accountImporter.js`), not against the Admin SDK's shape, and a test transcribes that validator and runs every exported record through it. This is not pedantry: `auth:import` rejects the **entire file** on one bad record, and the Admin SDK's `providerData` carries a `password` entry the CLI does not accept — which every email/password account in this project has. Caught by codex R3. |
| Hash-readability signal | `passwordUsersMissingHash` counts accounts that have a `password` provider but no hash — the signature of a runtime service account that cannot read password hashes. Such an export **imports perfectly and leaves every member unable to sign in**, so any value above zero makes the run report `ok:false` and writes an `error` audit row. |
| Audit | One `admin_audit` row per run (`action: "AUTH_BACKUP"`), counts and object path only. |

### SAFETY posture (Rule 1 — kill switch + dry-run default)

The arming key is **`system/config.authBackup`**:

```
system/config.authBackup = {
  enabled: <boolean>,   // DEFAULT/absent = false. Nothing is written.
  dryRun:  <boolean>,   // DEFAULT/absent = true. Only an explicit false goes live.
  bucket:  "<name>"     // REQUIRED for a live run. No default — a backup job that
                        // guesses its own destination is one nobody can find.
}
```

- **Absent or unreadable config → disabled**, and an unreadable one reports
  `ok:false` rather than masquerading as "switched off".
- **`enabled: true` with no valid `bucket` → the job is visibly UNHEALTHY** on
  `system/heartbeats`, not quietly idle. That is the direct answer to the
  original objection to writing this job at all.
- **A dry run pages through every account and uploads nothing.** It is the
  rehearsal that proves the `listUsers` permission and the page loop before any
  byte reaches a bucket.
- The callable **refuses** an explicit `dryRun: false` while the switch is off or
  no bucket is set, rather than silently downgrading it to a dry run. An operator
  who asked for a backup and got a rehearsal has to be told.

### PII — what the bucket's access posture MUST be

**The export contains every user's email address and, for password accounts,
their scrypt hash and salt.** That is not incidental: it is precisely what makes
the export restorable. So the file is the single most sensitive artifact this
project produces, and the controls are:

1. **Uniform bucket-level access** (`--uniform-bucket-level-access`). Per-object
   ACLs are how a "private" bucket ends up with one world-readable object.
2. **Public access prevention ENFORCED** (`--public-access-prevention=enforced`).
   Not "not currently public" — structurally unable to become public.
3. **A dedicated bucket, not the Firestore export bucket.** Separate IAM
   boundary, separate lifecycle, and the function's service account can be
   granted create-only on this one without touching the other.
4. **Least privilege for the function: `roles/storage.objectCreator`, NOT
   `objectAdmin`.** The job only ever creates new objects — every run's object
   names carry a unique run id, so it never needs to overwrite one. A
   create-only grant means a compromised function cannot read back the archive
   of every previous export, cannot delete it, and cannot overwrite it. (This
   pairing is deliberate: without the run id, two runs in the same second would
   collide, and an overwrite against a create-only grant is a 403.)
5. **Object versioning ON**, so an overwrite or a delete does not destroy the
   only copy.
6. **Human access limited to the project owner.** Do not grant a group.
7. **No bucket retention LOCK.** A lock makes objects undeletable for the
   period, which is good against ransomware and bad against a user's deletion
   request — you would be unable to purge their hash from the archive.
   Versioning plus a lifecycle rule gives most of the durability without that
   trap. Stated as a deliberate tradeoff, not an oversight.
8. Encryption at rest is Google-managed by default and is fine at this scale;
   CMEK adds a key you can lose, which at one weekly JSON file is a net
   reduction in safety.
9. **The code never logs a user record** — logs and audit metadata carry counts
   and object paths only, enforced mechanically by
   `functions/src/__tests__/authBackup.test.ts`. Cloud Functions logs are
   readable by anyone with project viewer and are NOT covered by this bucket's
   access controls.

### Step 6a — Kevin: create the bucket and grant the function (does NOT exist yet)

⚠️ **These commands run in Google Cloud Shell (the browser terminal from Step 0),
NOT in PowerShell on your machine.** Bucket names are written out literally — no
shell variables — so nothing breaks if you close the tab and come back.

1. Open Cloud Shell and confirm the project:

   ```
   gcloud config get-value project
   ```

   **Expect:** `gridiron-gamble-uzuqo`.
   **If instead** it prints anything else, run
   `gcloud config set project gridiron-gamble-uzuqo` and repeat.

2. Create the bucket, off-region from the database (`locationId` is `nam5`,
   measured 2026-07-21, which is US multi-region — so `us-east1` is a single
   region inside the US but a distinct failure domain; that is the same choice
   Step 4 makes):

   ```
   gcloud storage buckets create gs://mmpools-auth-backups --project gridiron-gamble-uzuqo --location us-east1 --uniform-bucket-level-access --public-access-prevention
   ```

   **Expect:** `Creating gs://mmpools-auth-backups/...` and no error.
   **If instead** you get `409 ... already own it`, it exists — continue.
   **If** you get `409 ... bucket names must be globally unique` and you do not
   own it, pick `mmpools-auth-backups-gg` and **use that name in every command
   below and in the `bucket` config value in Step 6b.**

3. Turn on object versioning:

   ```
   gcloud storage buckets update gs://mmpools-auth-backups --versioning
   ```

4. Lifecycle: delete live objects after 365 days, and non-current versions after
   30. A year of weekly exports is ~52 files; the cost is pennies and the window
   covers "we noticed a season later".

   ⚠️ Two single-line commands on purpose. A heredoc written inside an indented
   list block copies with its leading spaces, and an indented terminator does not
   end a heredoc — bash then sits waiting for input forever.

   ```
   echo '{"lifecycle":{"rule":[{"action":{"type":"Delete"},"condition":{"age":365,"isLive":true}},{"action":{"type":"Delete"},"condition":{"daysSinceNoncurrentTime":30}}]}}' > ~/auth-lifecycle.json
   ```

   ```
   gcloud storage buckets update gs://mmpools-auth-backups --lifecycle-file=$HOME/auth-lifecycle.json
   ```

   **Expect:** `Updating gs://mmpools-auth-backups/...` with no error.

5. Find the runtime service account the v2 functions execute as:

   ```
   gcloud projects describe gridiron-gamble-uzuqo --format="value(projectNumber)"
   ```

   **Expect:** a 12-digit number. The service account is
   `<that number>-compute@developer.gserviceaccount.com`.

6. Grant it **create-only** on this bucket (substitute the number from step 5):

   ```
   gcloud storage buckets add-iam-policy-binding gs://mmpools-auth-backups --member=serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com --role=roles/storage.objectCreator
   ```

   **Expect:** the updated IAM policy printed, containing `storage.objectCreator`.

7. Confirm the bucket is not public:

   ```
   gcloud storage buckets describe gs://mmpools-auth-backups --format="value(iamConfiguration.publicAccessPrevention,iamConfiguration.uniformBucketLevelAccess.enabled)"
   ```

   **Expect:** `enforced` and `True`. **If either is missing**, re-run step 2's
   flags via `gcloud storage buckets update` before putting real data in it.

### Step 6b — Kevin: arm the job in two stages

⚠️ **Deploy first.** `authBackupJob` and `runAuthBackup` are new, so they do not
exist in prod until a functions deploy ships them. Follow CLAUDE.md §3
(`git -C D:\march-melee-pools pull --ff-only origin main` FIRST), then verify by
name in PowerShell:

```
npx firebase functions:list | Select-String "runAuthBackup"
```

**Expect:** a line naming `runAuthBackup`. **If it is absent**, the deploy shipped
the old code — this is the silent stale-checkout failure CLAUDE.md §3 describes;
pull and redeploy rather than retrying.

**Stage 1 — dry run, still disabled.** In the Firestore console, set
`system/config` field `authBackup` to a map:

```
authBackup: { enabled: false, dryRun: true, bucket: "mmpools-auth-backups" }
```

Then call `runAuthBackup` with `{ "dryRun": true }`. **Expect** a result whose
`users` count roughly matches the Firebase console's Authentication tab,
`complete: true`, `uploaded: false`, `passwordUsersMissingHash: 0` and
`problem: null`.

**If `passwordUsersMissingHash` is above 0**, the runtime service account cannot
read password hashes. Do NOT arm the job — an armed job in that state produces
weekly exports that import cleanly and lock every member out. Fix the service
account's Firebase Auth permissions and re-run the dry run first. **If `users` is 0** or the call fails
with a permission error, the runtime service account cannot read Auth — stop and
fix that before arming anything; a dry run failing here is the whole point of
running it.

**Stage 2 — arm.** Set `enabled: true` and `dryRun: false`. Then call
`runAuthBackup` with `{ "dryRun": false }` once, by hand, so the first live write
happens while you are watching:

```
gcloud storage ls --recursive gs://mmpools-auth-backups/auth/
```

**Expect:** two objects — `auth-backup-<stamp>-<runid>.json` with a non-zero size, and
its `.manifest.json`. **If only the users file is there**, the manifest upload
failed and the run did not finish; treat that as an incident, not a partial
success. **If the object name contains `-PARTIAL`**, the page loop stopped early
and the export is NOT whole.

**Verify the following Sunday, not the same day.** A schedule that exists has
produced nothing yet. After the first scheduled run, check
`system/heartbeats.authBackupJob` has a recent `at` and `ok: true`.

### Step 6c — Interim manual export (still worth running once)

Until Step 6a/6b are done there is no automated Auth backup at all, and this
takes one minute.

⚠️ **The export file contains every user's email and their password hashes.**
Write it **outside the repository**, so it cannot be caught by a stray
`git add .`. These commands put it in your temp directory and never in
`D:\march-melee-pools`. Run them from `D:\march-melee-pools` anyway, so `npx`
resolves the pinned CLI:

```
$AUTH_EXPORT = Join-Path $env:TEMP "auth-backup.json"
npx firebase auth:export $AUTH_EXPORT --format=json --project gridiron-gamble-uzuqo
```

**Expect:** `Exporting accounts to ...auth-backup.json` and a count of users.
Then confirm it is not an empty shell:

```
(Get-Content $AUTH_EXPORT -Raw | ConvertFrom-Json).users.Count
```

**Expect:** a number matching roughly the user count in the Firebase console
Authentication tab. **If it prints 0 or errors**, the export produced nothing
usable — stop and investigate rather than filing it as a backup.

Then upload it and delete the local copy. Use a timestamped object name so a
second run never silently overwrites the first:

```
gcloud storage cp $AUTH_EXPORT "gs://mmpools-auth-backups/auth/auth-backup-manual-$(Get-Date -Format yyyyMMdd-HHmmss).json"
Remove-Item $AUTH_EXPORT
```

**Expect:** a `Copying file://...` line, then no output from `Remove-Item`.
**Verify the local copy is really gone** — this is the step that matters:

```
Test-Path $AUTH_EXPORT
```

**Expect:** `False`. **If it prints `True`**, the delete did not happen; re-run
`Remove-Item $AUTH_EXPORT` and check again before moving on.

---

## Step 6d — THE RESTORE PROCEDURE (an export nobody can restore is not a backup)

### 6d.0 — Capture the password hash parameters NOW, before you need them

🛑 **THIS IS THE STEP THAT MAKES OR BREAKS THE WHOLE THING, AND IT IS NOT IN THE
EXPORT.** Firebase hashes passwords with a modified scrypt keyed by a
**project-specific signer key**. The export carries each user's hash and salt;
it does **not** carry the parameters needed to verify them. Import the users
without those parameters and every account exists with a password that can never
match — the members are locked out exactly as thoroughly as if you had no backup.

1. Go to
   `https://console.firebase.google.com/project/gridiron-gamble-uzuqo/authentication/users`
2. Click the **⋮** (three-dot) menu at the top right of the users table.
3. Click **Password hash parameters**.
4. Copy every value on that panel verbatim — all five: `algorithm` (SCRYPT),
   `base64_signer_key`, `base64_salt_separator`, `rounds`, `mem_cost`.
5. **Store them somewhere that is not this repository and not the backup
   bucket** — a password manager entry is right. The signer key is a credential;
   putting it beside the hashes it unlocks defeats having two places.

**If the menu item is missing**, you are not signed in as an Owner/Editor on the
project.

### 6d.1 — Find the right object (Cloud Shell)

⚠️ **Cloud Shell, not PowerShell.**

```
gcloud storage ls gs://mmpools-auth-backups/auth/
```

Pick a name **without** `-PARTIAL` in it, then read its manifest sibling and
confirm it says `"complete": true`:

```
gcloud storage cat gs://mmpools-auth-backups/auth/auth-backup-<stamp>-<runid>.manifest.json
```

**Expect:** a small JSON with `"complete": true`, `"passwordUsersMissingHash": 0`
and a `users` count.

**If the manifest is missing**, that run died mid-flight — the users object
beside it is not a finished backup. **A `-PARTIAL` file is a last resort, not a
restore.**

🛑 **If `passwordUsersMissingHash` is anything but 0, DO NOT restore from this
file expecting people to be able to sign in.** That count means the export was
taken by a service account that could not read password hashes, so those
accounts come back with no password at all. The accounts import fine — which is
exactly why this has to be checked here, before the import, rather than
discovered by a member who cannot log in. Take a fresh export (Step 6b) after
fixing the service account's Auth permissions.

### 6d.2 — Download it to your machine (PowerShell)

⚠️ **Everything from here runs in PowerShell on your Windows machine, from
`D:\march-melee-pools`** — that is where `npx` resolves the pinned Firebase CLI
and where you are already authenticated. No POSIX paths.

⚠️ **This puts a file of every member's email and password hash on the laptop.**
6d.5 deletes it and verifies the delete; do not skip that step.

```
cd D:\march-melee-pools
```

```
$AUTH_RESTORE = Join-Path $env:TEMP "auth-restore.json"
```

**If you have local gcloud installed** (Step 0's optional path):

```
gcloud storage cp "gs://mmpools-auth-backups/auth/auth-backup-<stamp>-<runid>.json" $AUTH_RESTORE
```

**If you do NOT have local gcloud**, download it through the browser instead:
go to
`https://console.cloud.google.com/storage/browser/mmpools-auth-backups/auth?project=gridiron-gamble-uzuqo`,
click the object, click **Download**, then move the file to the path
`$AUTH_RESTORE` prints:

```
$AUTH_RESTORE
```

Confirm it is real before importing it:

```
(Get-Content $AUTH_RESTORE -Raw | ConvertFrom-Json).users.Count
```

**Expect:** a number matching the manifest's `users`. **If it is 0 or errors**,
stop — you are about to import nothing over a live tenant.

### 6d.3 — Import (PowerShell)

The file is already in `firebase auth:import` shape (`{"users":[...]}` with
`localId`, `passwordHash`, `salt`, `providerUserInfo`), so there is no
conversion step. Substitute the four values you captured in 6d.0:

```
npx firebase auth:import $AUTH_RESTORE --project gridiron-gamble-uzuqo --hash-algo=SCRYPT --hash-key=<base64_signer_key> --salt-separator=<base64_salt_separator> --rounds=<rounds> --mem-cost=<mem_cost>
```

**Expect:** `Processing N account(s)` and a success count matching N.

**If instead** individual accounts fail, read the per-account reason before
re-running.

⚠️ **UNVERIFIED — what happens to a uid that ALREADY exists.** Whether
`auth:import` overwrites an existing account or skips it has never been tested
here, and getting it wrong on a live tenant is not recoverable by re-running.
**Treat an import into a tenant that still has users as a merge whose semantics
you have not established.** Restore into a tenant you know is empty or known
lost, or test the behaviour first in the throwaway project from 6d.7.

**If** the whole file is rejected for an unrecognised field, strip `mfaInfo`
first — that mapping is emitted only for users with enrolled second factors and
has never been proven against a live import (**UNVERIFIED**; the project has no
MFA today, so current exports contain no `mfaInfo` at all).

### 6d.4 — Verify the restore, do not assume it

1. Count:

   ```
   npx firebase auth:export (Join-Path $env:TEMP "auth-verify.json") --format=json --project gridiron-gamble-uzuqo
   ```

   then compare `.users.Count` against the manifest's `users` from 6d.1.
2. **Sign in as a real account with its real password.** This is the ONLY
   evidence that the hash parameters were right. A count match proves the
   accounts exist; it proves nothing about whether anyone can get in.
3. Spot-check that a restored uid still owns its pools — take a `localId` from
   the export and confirm `users/{uid}` and their entries resolve.

### 6d.5 — Delete the local copies and PROVE they are gone

```
Remove-Item $AUTH_RESTORE
```

```
Remove-Item (Join-Path $env:TEMP "auth-verify.json")
```

```
Test-Path $AUTH_RESTORE
```

**Expect:** `False`. **If it prints `True`**, the delete did not happen — re-run
`Remove-Item $AUTH_RESTORE` and check again before moving on. Two files of
password hashes on a laptop is how a good restore becomes a breach.

### 6d.6 — What is NOT recoverable from this export

State these before an incident, not during one:

- **Password hash parameters.** Covered above. Not in the export, by design.
- **Restoring into a DIFFERENT Firebase project** works only if you pass the
  ORIGINAL project's hash parameters to `auth:import`. Without them the hashes
  are inert. This is the documented migration path, but it is one more reason
  6d.0 is mandatory.
- **Sessions and refresh tokens.** Everyone is signed out. Expect a support wave
  on restore day; that is normal, not a failed restore.
- **Identity-provider CONFIGURATION.** `providerUserInfo` restores the *link*
  between a user and, say, Google — it does not restore the project's enabled
  sign-in methods, OAuth client ids/secrets, or authorized domains. Those are
  project settings and must be reconfigured by hand.
- **Email templates, action-URL settings, SMS/reCAPTCHA config, authorized
  domains, App Check registrations, custom SMTP.** All project configuration,
  none of it in this export.
- **`lastRefreshTime`.** Not exported; `lastSignedInAt` is.
- **The `password` and `phone` entries of `providerData`.** Deliberately dropped:
  `auth:import` accepts only the ten federated provider ids and rejects the whole
  file otherwise. Nothing is lost — a password account is reconstituted from
  `passwordHash`/`salt`, and `phoneNumber` is a top-level field.
- **`tenantId`.** Deliberately dropped for the same reason (not in the CLI's
  allowed keys). Single-tenant project, so nothing is lost.
- **Anything Firestore.** `users/{uid}` profile docs, roles, entries, picks and
  member records live in Firestore and come back through PITR / the Firestore
  export (Steps 2, 4, 5). The Auth export's job is to make the `uid`s match so
  those documents have owners again. **Restore Auth and Firestore as a pair, or
  you get accounts that own nothing / data nobody can log in to reach.**
- **The custom-claim role, if it drifts.** `customAttributes` carries the
  `SUPER_ADMIN` claim, and `users/{uid}.role` comes from Firestore. The repo's
  `assertCallerRole` requires the two to AGREE, so after a restore from two
  sources of different ages an admin may need `syncMyClaims` before admin
  callables work.

### 6d.7 — The Auth restore drill (never run yet)

The Firestore drill in Step 7 restores into a scratch database. **Auth has no
equivalent**: a Firebase project has exactly one Auth tenant, and there is no
`--database=restore-drill` for identity. Importing into production to "test" it
is not an option.

Realistic options, in order of preference:

1. **Create a throwaway Firebase project**, import the export into it with the
   PRODUCTION hash parameters, and sign in as a test account you created in prod
   beforehand and whose password you know. This is the only drill that proves
   the hash parameters end to end.
2. At minimum, **import one deliberately-deleted test account back into prod**
   and sign in as it.

Until one of those has been done, this backup is **untested** and should be
described that way. A backup that has never been restored is a hypothesis.

---

## Step 7 — The restore drill (the part that is usually skipped)

A backup that has never been restored is a hypothesis, not a backup. The drill
must **not** target the production database.

1. Create a scratch database in the same project:

   ```
   gcloud firestore databases create --database=restore-drill --location=us-east1 --type=firestore-native --project gridiron-gamble-uzuqo
   ```

2. Import the manual export from step 4 into it:

   ```
   gcloud firestore import gs://$BACKUP_BUCKET/manual-first --database=restore-drill --project gridiron-gamble-uzuqo
   ```

3. Confirm real data landed — check that the `pools` collection is populated:

   ```
   gcloud firestore documents list --database=restore-drill --collection-ids=pools --project gridiron-gamble-uzuqo --limit=5
   ```

   **Expect:** several pool documents.
   **If instead** it is empty, the export in step 4 did not contain what you
   assumed, and the whole backup story is unproven. That is the single most
   valuable possible outcome of this drill — better to learn it now.

4. Delete the scratch database when done, so it does not accrue cost:

   ```
   gcloud firestore databases delete --database=restore-drill --project gridiron-gamble-uzuqo
   ```

⚠️ **Never** pass `--database="(default)"` to `firestore import` or
`databases delete`. `(default)` is production. An import into production merges
old documents over current ones and cannot be undone.

---

## What each step actually protects against

| Failure | Covered by |
|---|---|
| Bad write / bad batch job / bad deploy corrupts data, noticed within a week | PITR (step 2) |
| Same, noticed after a week | Scheduled backups (step 5), up to 14 weeks |
| Database deleted, or project-level accident | Off-region export (step 4) |
| Regional outage at the database's location | Off-region export (step 4) |
| Auth users lost | `authBackupJob` weekly + `runAuthBackup` on demand (step 6) — **code shipped, NOT armed; bucket does not exist yet.** Until step 6a/6b are done, the only cover is the manual export in step 6c. |
| Auth users lost, restore attempted without the hash parameters | **Nothing.** Every account comes back with a password that can never match. Step 6d.0 is the mitigation and it is a Kevin action, not code. |
| User-uploaded files lost | **Nothing** — pending the step 3 inventory |

The honest current state is that **every row of that table reads "nothing"**
until step 2 is run.

⚠️ Two rows are load-bearing and NOT satisfied by merging the code: the Auth
bucket (step 6a) and the hash parameters (step 6d.0). Shipping a backup job is
not the same as having a backup.

---

## Findings (fill in as you go)

- Firestore `locationId`: _(step 1)_
- PITR enabled: _(step 2)_
- Cloud Storage in use? _(step 3)_
- Export bucket + region: _(step 4)_
- Backup schedules created: _(step 5)_
- Auth backup bucket created + IAM granted: _(step 6a)_
- `system/config.authBackup` armed (`enabled`/`dryRun`/`bucket`): _(step 6b)_
- Auth user count at first export: _(step 6b/6c)_
- Password hash parameters captured, and where: _(step 6d.0 — record WHERE, never the values)_
- Firestore restore drill outcome: _(step 7)_
- Auth restore drill outcome: _(step 6d.5 — **never run as of this writing**)_
