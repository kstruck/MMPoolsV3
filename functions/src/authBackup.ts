import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { validated } from "./lib/validated";
import { withHeartbeat, configReadFailedVerdict, type HeartbeatVerdict } from "./lib/heartbeat";
import { writeAdminAudit } from "./lib/adminAudit";

/**
 * authBackup — Firebase Auth export to GCS (PLAN-BACKUPS-PHASE3 item 18,
 * VCS audit finding F3).
 *
 * WHY THIS EXISTS. Firestore PITR and Firestore scheduled backups do NOT
 * contain Firebase Auth. Losing the Auth tenant means every member loses
 * access to their pools even after a byte-perfect Firestore restore, because
 * every entry, member record and pick is keyed by `uid`. Auth was the one row
 * of PLAN-BACKUPS-PHASE3's recovery matrix that read "none".
 *
 * WHAT IT WRITES. Two objects per run, into the bucket named by config:
 *   auth/auth-backup-<UTC stamp>.json           -- `{ "users": [...] }`, the
 *       exact shape `firebase auth:import` consumes, so a restore is a single
 *       command with no transformation step.
 *   auth/auth-backup-<UTC stamp>.manifest.json  -- counts and completeness
 *       ONLY, no PII, so "did the backup run and was it whole" is answerable
 *       without opening a file full of emails and password hashes.
 * The users file is uploaded FIRST and the manifest second: a users object with
 * no sibling manifest is a run that died mid-flight, not a backup.
 *
 * SAFETY (Rule 1, mmp-change-control), matching autoClosePools / nflAutoScoreJob:
 *   - Kill-switch: nothing is written unless
 *     `system/config.authBackup.enabled === true`. Default OFF; a missing or
 *     unreadable config is treated as OFF (fail-safe), and an unreadable one
 *     reports `ok:false` rather than masquerading as "switched off".
 *   - Dry-run by default (`authBackup.dryRun !== false`): a dry run pages
 *     through every user and reports the counts, and uploads NOTHING.
 *   - The destination bucket must be named explicitly in
 *     `system/config.authBackup.bucket`. There is no default: a backup job that
 *     guesses its own destination is how you get an export nobody can find.
 *
 * PII. Every record carries a real email address and, for password users, the
 * scrypt hash and salt. That is not incidental — it is the thing that makes the
 * export restorable — so the controls are (a) the bucket's access posture, which
 * is Kevin's console action and is specified in PLAN-BACKUPS-PHASE3.md Step 6a,
 * and (b) this module NEVER logging a user record. Logs and audit metadata carry
 * counts and object paths only. `__tests__/authBackup.test.ts` enforces (b)
 * mechanically.
 *
 * NOT RECOVERABLE FROM THIS EXPORT ALONE: the project's password-hash
 * parameters (signer key, salt separator, rounds, memory cost). They live in the
 * Firebase console and must be captured separately or every restored password
 * is dead. See PLAN-BACKUPS-PHASE3.md Step 6d.0.
 */

/** listUsers' documented maximum page size. */
export const AUTH_BACKUP_PAGE_SIZE = 1000;

/**
 * Hard ceiling on pages per run (250 x 1000 = 250k users). It bounds a runaway
 * loop and the bill, and — the part that matters — a run that HITS it is
 * reported as INCOMPLETE rather than quietly filed as a backup. A truncated
 * export that looks whole is worse than no export at all, because it is only
 * discovered on the day it is needed.
 *
 * ⚠️ MEMORY IS THE REAL CEILING, NOT THIS NUMBER. The whole export is held in
 * memory twice — the mapped records, then the serialized JSON — so at ~600
 * bytes per account the 512MiB allocation runs out somewhere in the low
 * hundreds of thousands of users, i.e. in the same neighbourhood as this cap.
 * An OOM is a hard kill, so `withHeartbeat`'s catch does NOT run and the
 * failure surfaces as a STALE weekly heartbeat rather than a failing one —
 * slow, at a weekly cadence. Nowhere near either limit at this project's size,
 * but if the user base ever approaches six figures this job must stream to the
 * bucket instead of buffering, and that is a rewrite, not a config change.
 */
export const AUTH_BACKUP_MAX_PAGES = 250;

export const AUTH_BACKUP_CONFIG_KEY = "authBackup";

/** Structural view of a `UserRecord`; the real Admin SDK type satisfies it. */
export interface AuthUserLike {
    uid: string;
    email?: string;
    emailVerified?: boolean;
    displayName?: string;
    photoURL?: string;
    phoneNumber?: string;
    disabled?: boolean;
    passwordHash?: string;
    passwordSalt?: string;
    tenantId?: string;
    customClaims?: Record<string, unknown>;
    metadata?: { creationTime?: string; lastSignInTime?: string };
    providerData?: Array<{
        uid?: string;
        providerId?: string;
        email?: string;
        displayName?: string;
        photoURL?: string;
        phoneNumber?: string;
    }>;
    multiFactor?: {
        enrolledFactors?: Array<{
            uid?: string;
            factorId?: string;
            displayName?: string;
            enrollmentTime?: string;
            phoneNumber?: string;
        }>;
    };
}

/** Drop undefined values so the emitted JSON has no null-ish noise. */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined) out[k] = v;
    }
    return out;
}

/**
 * Admin-SDK timestamps are UTC date STRINGS; `auth:import` wants epoch
 * milliseconds as a string. An unparseable value is dropped rather than emitted
 * as NaN, which would make `auth:import` reject the whole file.
 */
export function toEpochMsString(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const t = Date.parse(value);
    return Number.isFinite(t) ? String(t) : undefined;
}

/**
 * One `UserRecord` -> one `firebase auth:import` record.
 *
 * The field names are the CLI's, not the Admin SDK's (`localId` not `uid`,
 * `salt` not `passwordSalt`, `photoUrl` not `photoURL`, `providerUserInfo` not
 * `providerData`). Emitting the SDK shape would produce a file that looks
 * plausible and imports nothing.
 *
 * `localId` is load-bearing above everything else here: it is what makes the
 * restored account the SAME uid, and every entry, pick and member record in
 * Firestore is keyed by that uid. Restore without it and you have accounts that
 * own nothing.
 *
 * `mfaInfo` is emitted only when the user actually has enrolled factors. This
 * project has no MFA today (Identity Platform upgrade is deferred), so the field
 * is absent from every current export — deliberately, because the mapping has
 * never been proven against a real `auth:import` and an untested field is a way
 * to have the whole file rejected on the day it is needed.
 */
export function toAuthImportRecord(u: AuthUserLike): Record<string, unknown> {
    const factors = u.multiFactor?.enrolledFactors ?? [];
    return compact({
        localId: u.uid,
        email: u.email,
        emailVerified: u.emailVerified,
        displayName: u.displayName,
        photoUrl: u.photoURL,
        phoneNumber: u.phoneNumber,
        disabled: u.disabled,
        passwordHash: u.passwordHash,
        salt: u.passwordSalt,
        tenantId: u.tenantId,
        customAttributes: u.customClaims ? JSON.stringify(u.customClaims) : undefined,
        createdAt: toEpochMsString(u.metadata?.creationTime),
        lastSignedInAt: toEpochMsString(u.metadata?.lastSignInTime),
        providerUserInfo: (u.providerData ?? []).map((p) =>
            compact({
                providerId: p.providerId,
                rawId: p.uid,
                email: p.email,
                displayName: p.displayName,
                photoUrl: p.photoURL,
                phoneNumber: p.phoneNumber,
            }),
        ),
        mfaInfo: factors.length
            ? factors.map((f) =>
                compact({
                    mfaEnrollmentId: f.uid,
                    phoneInfo: f.phoneNumber,
                    displayName: f.displayName,
                    enrolledAt: f.enrollmentTime,
                }),
            )
            : undefined,
    });
}

export interface AuthBackupGate {
    enabled: boolean;
    dryRun: boolean;
    /** Validated bucket name, or null when unset/malformed. */
    bucket: string | null;
}

/**
 * Accept `my-bucket` or `gs://my-bucket/`; reject anything that is not a
 * plausible GCS bucket name. Returning null rather than the raw string means a
 * fat-fingered config cannot become an upload to somewhere unintended — it
 * becomes a refusal to run live, which is the safe direction.
 */
export function normalizeBucketName(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const name = raw.trim().replace(/^gs:\/\//i, "").replace(/\/+$/, "");
    // GCS: 3-222 chars, lowercase letters/digits/dashes/underscores/dots, must
    // start and end alphanumeric. Dot-separated components have their own length
    // rules; this is a sanity filter, not a full validator — the API is the
    // authority and an invalid name fails the upload loudly.
    if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(name)) return null;
    return name;
}

/**
 * Read the `{enabled, dryRun, bucket}` gate out of system/config. Fail-safe:
 * missing or garbage config means disabled, and dry-run unless `dryRun` is
 * explicitly `false`. Mirrors `readJobGate` (nflSchedule.ts) plus the bucket.
 * Pure, so the matrix is unit-tested rather than discovered in production.
 */
export function readAuthBackupGate(
    cfg: { enabled?: unknown; dryRun?: unknown; bucket?: unknown } | undefined | null,
): AuthBackupGate {
    return {
        enabled: cfg?.enabled === true,
        dryRun: cfg?.dryRun !== false,
        bucket: normalizeBucketName(cfg?.bucket),
    };
}

/**
 * Why a LIVE (uploading) run cannot happen, or null when it can. One place, so
 * the scheduled job and the callable can never disagree about what "armed"
 * means.
 */
export function liveRunBlockedReason(gate: AuthBackupGate): string | null {
    if (!gate.enabled) {
        return `kill switch OFF (system/config.${AUTH_BACKUP_CONFIG_KEY}.enabled !== true)`;
    }
    if (!gate.bucket) {
        return `no destination (system/config.${AUTH_BACKUP_CONFIG_KEY}.bucket is unset or not a valid bucket name)`;
    }
    return null;
}

/** `YYYYMMDD-HHMMSSZ`, UTC, so object names sort chronologically. */
export function backupStamp(now: Date): string {
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    return (
        `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
        `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`
    );
}

/**
 * Object path for a run. An incomplete export is named `-PARTIAL`, in the
 * filename, because that is the one place an operator reaching for a backup in
 * an emergency is guaranteed to look.
 */
export function authBackupObjectPath(stamp: string, complete: boolean): string {
    return `auth/auth-backup-${stamp}${complete ? "" : "-PARTIAL"}.json`;
}

/** Manifest sibling of a users object. */
export function manifestPathFor(objectPath: string): string {
    return objectPath.replace(/\.json$/, ".manifest.json");
}

export interface AuthBackupPage {
    users: AuthUserLike[];
    /** Present when more pages remain. */
    pageToken?: string;
}

export interface AuthBackupDeps {
    listUsers(maxResults: number, pageToken?: string): Promise<AuthBackupPage>;
    upload(objectPath: string, body: string, contentType: string): Promise<void>;
    now(): Date;
}

export interface AuthBackupResult {
    dryRun: boolean;
    /** Users enumerated across every page. */
    users: number;
    pages: number;
    /** false when the page loop stopped before the tenant was exhausted. */
    complete: boolean;
    /** Where the export went, or would have gone on a dry run. */
    objectPath: string;
    manifestPath: string;
    /** Size of the users JSON, computed on a dry run too. */
    bytes: number;
    /** false on a dry run, or when the loop was cut short before any upload. */
    uploaded: boolean;
}

/**
 * The whole job, with every side effect injected: page through the Auth tenant,
 * map each user to the import shape, and (unless dry) upload the users file and
 * then its manifest.
 *
 * Injecting `listUsers`/`upload`/`now` is what makes the two pieces of logic
 * most likely to break — the pagination loop and the dry-run gate — testable
 * without firebase-admin, an emulator, or a bucket.
 */
export async function runAuthBackupCore(
    deps: AuthBackupDeps,
    opts: { dryRun: boolean; maxPages?: number; pageSize?: number },
): Promise<AuthBackupResult> {
    // Clamped, not trusted. A maxPages of 0 would skip the loop entirely and
    // then upload an EMPTY users file — a zero-account "backup" that looks like
    // a successful run of an empty tenant. At least one page must always run.
    const maxPages = Math.max(1, opts.maxPages ?? AUTH_BACKUP_MAX_PAGES);
    const pageSize = Math.min(AUTH_BACKUP_PAGE_SIZE, Math.max(1, opts.pageSize ?? AUTH_BACKUP_PAGE_SIZE));

    const records: Array<Record<string, unknown>> = [];
    const seenTokens = new Set<string>();
    let pageToken: string | undefined;
    let pages = 0;
    let complete = false;

    while (pages < maxPages) {
        const page = await deps.listUsers(pageSize, pageToken);
        pages++;
        for (const u of page.users ?? []) records.push(toAuthImportRecord(u));

        const next = page.pageToken;
        // No token means the tenant is exhausted — the ONLY way this loop is
        // allowed to conclude the export is whole.
        if (!next) {
            complete = true;
            break;
        }
        // A repeated token means the API (or a mock) is handing back a cursor we
        // have already followed. Continuing would loop forever and duplicate
        // every user; stopping leaves `complete` false, which is reported.
        if (seenTokens.has(next)) break;
        seenTokens.add(next);
        pageToken = next;
    }

    // STRUCTURAL INTEGRITY, checked rather than assumed. The Admin SDK's
    // `UserRecord` is mapped through `as unknown as AuthUserLike`, so a field
    // rename in a future firebase-admin would not be a type error — it would
    // silently produce records with no `localId`, and a restore from that file
    // creates accounts that own none of their Firestore data. Every record must
    // carry one; refusing to write is the only safe response.
    const missingLocalId = records.filter((r) => typeof r.localId !== "string" || !r.localId).length;
    if (missingLocalId > 0) {
        throw new Error(
            `[authBackup] ${missingLocalId} of ${records.length} record(s) have no localId — ` +
            "the export would be unrestorable; refusing to write it.",
        );
    }

    const now = deps.now();
    const stamp = backupStamp(now);
    const objectPath = authBackupObjectPath(stamp, complete);
    const manifestPath = manifestPathFor(objectPath);

    // NOTE: `records` holds emails and password hashes. It is serialized to the
    // bucket and NEVER to a log line.
    const body = JSON.stringify({ users: records });
    const bytes = Buffer.byteLength(body, "utf8");

    const manifest = JSON.stringify(
        {
            kind: "FIREBASE_AUTH_EXPORT_MANIFEST",
            format: "firebase-auth-import-json",
            exportedAt: now.toISOString(),
            users: records.length,
            pages,
            complete,
            bytes,
            usersObject: objectPath,
            restore: "PLAN-BACKUPS-PHASE3.md Step 6d — password hash parameters are NOT in this export.",
        },
        null,
        2,
    );

    const result: AuthBackupResult = {
        dryRun: opts.dryRun,
        users: records.length,
        pages,
        complete,
        objectPath,
        manifestPath,
        bytes,
        uploaded: false,
    };

    if (opts.dryRun) return result;

    // Users file first, manifest second: the manifest's presence is what says
    // the run finished. The reverse order would advertise a complete backup
    // beside a users object that may never have landed.
    await deps.upload(objectPath, body, "application/json");
    await deps.upload(manifestPath, manifest, "application/json");
    result.uploaded = true;
    return result;
}

/** Page the real Auth tenant. */
function adminListUsers(): AuthBackupDeps["listUsers"] {
    return async (maxResults, pageToken) => {
        const res = await admin.auth().listUsers(maxResults, pageToken);
        return { users: res.users as unknown as AuthUserLike[], pageToken: res.pageToken };
    };
}

/** Upload to an explicitly named bucket. */
function gcsUploader(bucket: string): AuthBackupDeps["upload"] {
    return async (objectPath, body, contentType) => {
        await admin
            .storage()
            .bucket(bucket)
            .file(objectPath)
            .save(body, {
                contentType,
                resumable: false,
                metadata: { cacheControl: "no-store" },
            });
    };
}

/**
 * The uploader handed to a dry run. It cannot upload because there may be no
 * valid bucket to upload to — and if the dry-run gate is ever broken, this
 * throws loudly instead of silently shipping a PII file somewhere.
 */
function refusingUploader(): AuthBackupDeps["upload"] {
    return async () => {
        throw new Error("[authBackup] upload attempted on a dry run — the dry-run gate is broken");
    };
}

function depsFor(gate: AuthBackupGate, dryRun: boolean): AuthBackupDeps {
    return {
        listUsers: adminListUsers(),
        upload: !dryRun && gate.bucket ? gcsUploader(gate.bucket) : refusingUploader(),
        now: () => new Date(),
    };
}

/** Audit + log a finished run. Counts and paths only — never a user record. */
async function recordRun(
    result: AuthBackupResult,
    actor: { uid: string; email?: string },
    gate: AuthBackupGate,
): Promise<void> {
    console.log(
        `[authBackup] ${result.dryRun ? "DRY-RUN" : "LIVE"}: ${result.users} account(s) over ` +
        `${result.pages} page(s), ${result.bytes} bytes, complete=${result.complete}, ` +
        `uploaded=${result.uploaded}, object=${result.objectPath}`,
    );
    await writeAdminAudit({
        actorUid: actor.uid,
        actorEmail: actor.email,
        action: "AUTH_BACKUP",
        targetType: "authTenant",
        metadata: {
            dryRun: result.dryRun,
            accounts: result.users,
            pages: result.pages,
            complete: result.complete,
            uploaded: result.uploaded,
            bytes: result.bytes,
            object: result.objectPath,
            bucket: gate.bucket ?? "(unset)",
        },
        status: result.complete ? "success" : "error",
        error: result.complete ? undefined : "export truncated before the tenant was exhausted",
    });
}

/**
 * Audit a run that THREW. Without this, a failed backup leaves nothing in
 * `admin_audit` at all, and the durable record of "we tried and it did not
 * work" exists only in a heartbeat that the next run overwrites — the same
 * reasoning feedReplay.ts uses for auditing its failures.
 */
async function recordFailure(
    actor: { uid: string; email?: string },
    gate: AuthBackupGate,
    dryRun: boolean,
    message: string,
): Promise<void> {
    await writeAdminAudit({
        actorUid: actor.uid,
        actorEmail: actor.email,
        action: "AUTH_BACKUP",
        targetType: "authTenant",
        metadata: { dryRun, failed: true, bucket: gate.bucket ?? "(unset)" },
        status: "error",
        error: message,
    });
}

/**
 * Weekly Auth export. Sunday 03:15 ET — outside both DST hazard windows
 * (02:00-02:59 does not exist on spring-forward, 01:00-01:59 happens twice on
 * fall-back) and clear of the 03:00 and 03:30 daily jobs.
 *
 * 540s / 512MiB matches the peer daily sweeps (nflFinalizeSweepJob). Weekly
 * cadence means there is no run-overlap ceiling to respect the way
 * nflAutoScoreJob's 270s has, and paging a large tenant is the slow part.
 */
export const authBackupJob = onSchedule(
    { schedule: "15 3 * * 0", timeZone: "America/New_York", timeoutSeconds: 540, memory: "512MiB" },
    withHeartbeat("authBackupJob", async (): Promise<HeartbeatVerdict> => {
        let gate: AuthBackupGate = { enabled: false, dryRun: true, bucket: null };
        let configError: unknown = null;
        try {
            const cfg = (await admin.firestore().doc("system/config").get()).data()?.[
                AUTH_BACKUP_CONFIG_KEY
            ] as { enabled?: unknown; dryRun?: unknown; bucket?: unknown } | undefined;
            gate = readAuthBackupGate(cfg);
        } catch (e) {
            configError = e ?? new Error("unknown config read error");
        }
        // Falling back to disabled is the right fail-safe, but it makes an
        // unreachable config indistinguishable from a switch left off.
        if (configError) return configReadFailedVerdict("authBackupJob", configError);

        if (!gate.enabled) {
            console.log(
                `[authBackupJob] disabled (system/config.${AUTH_BACKUP_CONFIG_KEY}.enabled !== true); nothing to do.`,
            );
            return { detail: { enabled: false } };
        }

        // Armed but undeliverable. This is NOT a healthy no-op: somebody turned
        // the job on believing backups were happening.
        if (!gate.bucket) {
            const reason = liveRunBlockedReason(gate) ?? "no destination";
            console.error(`[authBackupJob] enabled but ${reason} — no backup was taken.`);
            return { ok: false, error: reason, detail: { enabled: true, bucketConfigured: false } };
        }

        try {
            const result = await runAuthBackupCore(depsFor(gate, gate.dryRun), { dryRun: gate.dryRun });
            await recordRun(result, { uid: "system" }, gate);
            return {
                ok: result.complete,
                error: result.complete ? undefined : "export truncated before the tenant was exhausted",
                detail: {
                    enabled: true,
                    dryRun: result.dryRun,
                    accounts: result.users,
                    pages: result.pages,
                    complete: result.complete,
                    uploaded: result.uploaded,
                    bytes: result.bytes,
                },
            };
        } catch (e) {
            // Caught rather than thrown so the heartbeat records WHY, and so a
            // bucket/IAM failure reads as a failing job instead of one that
            // merely stopped running.
            const message = e instanceof Error ? e.message : String(e);
            console.error("[authBackupJob] export failed:", message);
            await recordFailure({ uid: "system" }, gate, gate.dryRun, message);
            return { ok: false, error: message, detail: { enabled: true, dryRun: gate.dryRun } };
        }
    }),
);

/**
 * On-demand export. `dryRun` defaults to TRUE, and an explicit `dryRun:false`
 * is REFUSED while the kill switch is off or no bucket is configured — refused
 * rather than quietly downgraded to a dry run, because an operator who asked
 * for a backup and got a rehearsal has to be told.
 */
export const runAuthBackupSchema = z.preprocess(
    (v) => v ?? {},
    z.strictObject({
        dryRun: z.boolean().optional().default(true),
    }),
);

export const runAuthBackup = validated(
    {
        schema: runAuthBackupSchema,
        label: "runAuthBackup",
        role: "SUPER_ADMIN",
        appCheck: "monitor",
        options: { timeoutSeconds: 540, memory: "512MiB" },
    },
    async (input, request) => {
        let gate: AuthBackupGate;
        try {
            const cfg = (await admin.firestore().doc("system/config").get()).data()?.[
                AUTH_BACKUP_CONFIG_KEY
            ] as { enabled?: unknown; dryRun?: unknown; bucket?: unknown } | undefined;
            gate = readAuthBackupGate(cfg);
        } catch (e) {
            console.error("[runAuthBackup] config read failed:", e);
            throw new HttpsError("internal", "Could not read system/config; refusing to run.");
        }

        if (input.dryRun === false) {
            const blocked = liveRunBlockedReason(gate);
            if (blocked) {
                throw new HttpsError(
                    "failed-precondition",
                    `Live Auth backup refused: ${blocked}. Run with dryRun:true to rehearse.`,
                );
            }
        }
        const dryRun = input.dryRun !== false;

        const actor = {
            uid: request.auth?.uid ?? "unknown",
            email: request.auth?.token?.email as string | undefined,
        };
        let result: AuthBackupResult;
        try {
            result = await runAuthBackupCore(depsFor(gate, dryRun), { dryRun });
        } catch (e) {
            // Audited before rethrowing: an operator-triggered backup that failed
            // must leave a durable record, not just an error toast.
            const message = e instanceof Error ? e.message : String(e);
            console.error("[runAuthBackup] export failed:", message);
            await recordFailure(actor, gate, dryRun, message);
            // No third arg: HttpsError's `details` is serialized to the client.
            throw new HttpsError("internal", `Auth backup failed: ${message}`);
        }
        await recordRun(result, actor, gate);
        return {
            ...result,
            enabled: gate.enabled,
            bucket: gate.bucket,
        };
    },
);
