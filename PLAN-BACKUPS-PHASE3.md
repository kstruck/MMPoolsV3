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
| **Firestore** — pools, entries, picks, member records, billing charges, payout records | ❌ none | Permanent. Nothing anywhere else holds this. |
| **Firebase Auth** — user accounts, emails, password hashes | ❌ none | Every member loses access, even with a perfect Firestore restore. |

No PITR, no scheduled backups, no exports, no Auth export. If the Firestore
database were deleted or corrupted today, every pool, entry, pick, member record
and billing charge would be gone permanently — and the VPS snapshots would not
help, because none of that data has ever lived on the VPS.

That remains the largest unaddressed risk in the system, and it is larger than
any bug in the preseason list, because every other risk is recoverable and this
one is not.

Scope and corrected facts come from `PLAN-SECURITY-OBSERVABILITY.md` Phase 3
(items 15–19, already corrected by Codex review #10/#11). This document is the
executable version of those items.

---

## Who does what

**Almost all of Phase 3 is Kevin-only.** PITR, backup schedules, GCS buckets and
IAM are Google Cloud project operations — there is no code to write for items
15, 16, 17 and 19. Only item 18 (the Auth export job) is code, and it is
deliberately deferred until the bucket from item 17 exists, because a scheduled
job that writes to a nonexistent bucket is a job that fails silently. This repo
has already been bitten four times by exactly that failure mode.

**Recommended order:** 15 → 19 → 17 → 16 → 18. PITR first because it is one
command and immediately buys a 7-day floor.

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
- `pointInTimeRecoveryEnablement:` — almost certainly
  `POINT_IN_TIME_RECOVERY_DISABLED` today. That is what step 2 fixes.

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

**Do this first. It needs no install and takes about two minutes.**

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

## Step 6 — Firebase Auth export (item 18) — DEFERRED, and why

`npx firebase auth:export` writes a **local file**; it has no direct-to-GCS mode.
Firestore backups do **not** contain Auth users, so losing Auth means every
member loses access to their pools even with a perfect Firestore restore.

The intended shape is a scheduled function that exports, uploads to the step-4
bucket, and is kill-switched and dry-run defaulted like every other scheduled
job in this repo.

**It is deliberately not written yet.** It depends on the bucket from step 4
existing and on service-account permissions that do not exist today. Writing it
now would produce exactly the artifact this repo keeps getting burned by: a job
that is deployed, appears armed, and silently fails every night.

**Interim manual export** — worth running once before the pilot, and it takes
one minute.

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
gcloud storage cp $AUTH_EXPORT "gs://$BACKUP_BUCKET/auth/auth-backup-$(Get-Date -Format yyyyMMdd-HHmmss).json"
Remove-Item $AUTH_EXPORT
```

**Expect:** a `Copying file://...` line, then no output from `Remove-Item`.
**Verify the local copy is really gone** — this is the step that matters:

```
Test-Path $AUTH_EXPORT
```

**Expect:** `False`. **If it prints `True`**, the delete did not happen; re-run
`Remove-Item $AUTH_EXPORT` and check again before moving on.

Once step 4's bucket exists, the scheduled version of this becomes a small,
testable piece of work.

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
| Auth users lost | Manual export (step 6); no automation yet |
| User-uploaded files lost | **Nothing** — pending the step 3 inventory |

The honest current state is that **every row of that table reads "nothing"**
until step 2 is run.

---

## Findings (fill in as you go)

- Firestore `locationId`: _(step 1)_
- PITR enabled: _(step 2)_
- Cloud Storage in use? _(step 3)_
- Export bucket + region: _(step 4)_
- Backup schedules created: _(step 5)_
- Auth user count at first export: _(step 6)_
- Restore drill outcome: _(step 7)_
