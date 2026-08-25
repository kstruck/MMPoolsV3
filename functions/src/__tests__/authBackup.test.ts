import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    AUTH_BACKUP_MAX_PAGES,
    authBackupObjectPath,
    backupStamp,
    liveRunBlockedReason,
    manifestPathFor,
    normalizeBucketName,
    readAuthBackupGate,
    runAuthBackupCore,
    toAuthImportRecord,
    toEpochMsString,
    runAuthBackupSchema,
    type AuthBackupDeps,
    type AuthBackupPage,
    type AuthUserLike,
} from "../authBackup";

/**
 * Firebase Auth export (PLAN-BACKUPS-PHASE3 item 18 / VCS audit F3).
 *
 * The two pieces of logic that must not break are the PAGINATION LOOP and the
 * DRY-RUN GATE: a loop that stops at page one produces a backup missing most of
 * the tenant and says nothing, and a broken dry-run gate ships a file of emails
 * and password hashes to a bucket nobody has locked down yet. Both are exercised
 * here against injected deps, no emulator required.
 */

const user = (uid: string, over: Partial<AuthUserLike> = {}): AuthUserLike => ({
    uid,
    email: `${uid}@example.com`,
    emailVerified: true,
    disabled: false,
    passwordHash: `hash-${uid}`,
    passwordSalt: `salt-${uid}`,
    metadata: { creationTime: "Tue, 22 Jun 2021 12:00:00 GMT", lastSignInTime: "Wed, 23 Jun 2021 12:00:00 GMT" },
    providerData: [{ providerId: "password", uid: `${uid}@example.com`, email: `${uid}@example.com` }],
    ...over,
});

/** Deps whose listUsers serves `pages` in order and whose upload records calls. */
function harness(pages: AuthBackupPage[]) {
    const uploads: Array<{ path: string; body: string; contentType: string }> = [];
    const listCalls: Array<{ maxResults: number; pageToken?: string }> = [];
    let i = 0;
    const deps: AuthBackupDeps = {
        listUsers: async (maxResults, pageToken) => {
            listCalls.push({ maxResults, pageToken });
            const page = pages[Math.min(i, pages.length - 1)];
            i++;
            return page;
        },
        upload: async (p, body, contentType) => {
            uploads.push({ path: p, body, contentType });
        },
        now: () => new Date(Date.UTC(2026, 7, 24, 7, 15, 30)),
    };
    return { deps, uploads, listCalls };
}

describe("pagination — the loop that decides whether the backup is whole", () => {
    it("follows nextPageToken across every page and accumulates all users", async () => {
        const { deps, listCalls } = harness([
            { users: [user("a"), user("b")], pageToken: "t1" },
            { users: [user("c")], pageToken: "t2" },
            { users: [user("d")] },
        ]);
        const r = await runAuthBackupCore(deps, { dryRun: true });
        expect(r.users).toBe(4);
        expect(r.pages).toBe(3);
        expect(r.complete).toBe(true);
        // The cursor from each page must actually be sent on the next call —
        // dropping it silently re-reads page one forever.
        expect(listCalls.map((c) => c.pageToken)).toEqual([undefined, "t1", "t2"]);
    });

    it("a single page with no token is a COMPLETE export", async () => {
        const { deps } = harness([{ users: [user("solo")] }]);
        const r = await runAuthBackupCore(deps, { dryRun: true });
        expect(r).toMatchObject({ users: 1, pages: 1, complete: true });
    });

    it("an empty tenant is complete, not an error", async () => {
        const { deps } = harness([{ users: [] }]);
        const r = await runAuthBackupCore(deps, { dryRun: true });
        expect(r).toMatchObject({ users: 0, pages: 1, complete: true });
    });

    it("stops at the page cap and reports the export as INCOMPLETE", async () => {
        // Every page hands back a fresh token, so only the cap ends this.
        let n = 0;
        const deps: AuthBackupDeps = {
            listUsers: async () => ({ users: [user(`u${n}`)], pageToken: `t${n++}` }),
            upload: async () => undefined,
            now: () => new Date(0),
        };
        const r = await runAuthBackupCore(deps, { dryRun: false, maxPages: 3 });
        expect(r.pages).toBe(3);
        expect(r.complete).toBe(false);
        // The filename itself has to say so — that is where an operator looks
        // during an incident, not at a heartbeat detail field.
        expect(r.objectPath).toContain("-PARTIAL");
    });

    it("breaks out when the API repeats a page token instead of looping forever", async () => {
        const deps: AuthBackupDeps = {
            listUsers: async () => ({ users: [user("stuck")], pageToken: "same" }),
            upload: async () => undefined,
            now: () => new Date(0),
        };
        const r = await runAuthBackupCore(deps, { dryRun: true, maxPages: 1000 });
        expect(r.pages).toBe(2); // first page sets the token, second sees it repeat
        expect(r.complete).toBe(false);
    });

    it("uses the 1000-user page size by default", async () => {
        const { deps, listCalls } = harness([{ users: [] }]);
        await runAuthBackupCore(deps, { dryRun: true });
        expect(listCalls[0].maxResults).toBe(1000);
    });

    it("the shipped cap is large enough to be a safety net, not a limit", () => {
        expect(AUTH_BACKUP_MAX_PAGES).toBeGreaterThanOrEqual(100);
    });

    it("clamps a zero page cap to one page rather than exporting nothing", async () => {
        // maxPages: 0 would skip the loop and upload an EMPTY users file — a
        // zero-account 'backup' indistinguishable from a genuinely empty tenant.
        const { deps } = harness([{ users: [user("a")] }]);
        const r = await runAuthBackupCore(deps, { dryRun: true, maxPages: 0 });
        expect(r.pages).toBe(1);
        expect(r.users).toBe(1);
    });

    it("never asks for more than the API's 1000-user page size", async () => {
        const { deps, listCalls } = harness([{ users: [] }]);
        await runAuthBackupCore(deps, { dryRun: true, pageSize: 99999 });
        expect(listCalls[0].maxResults).toBe(1000);
    });
});

describe("dry-run gate — nothing leaves the function on a dry run", () => {
    it("uploads NOTHING when dryRun is true, but still counts the tenant", async () => {
        const { deps, uploads } = harness([
            { users: [user("a")], pageToken: "t1" },
            { users: [user("b")] },
        ]);
        const r = await runAuthBackupCore(deps, { dryRun: true });
        expect(uploads).toEqual([]);
        expect(r.uploaded).toBe(false);
        expect(r.users).toBe(2);
        // It still reports the size and destination it WOULD have written, which
        // is the whole value of the rehearsal.
        expect(r.bytes).toBeGreaterThan(0);
        expect(r.objectPath).toMatch(/^auth\/auth-backup-.*\.json$/);
    });

    it("a dry run whose upload is somehow called fails LOUDLY", async () => {
        // Guards the belt-and-braces uploader: if the gate above ever breaks, the
        // failure must be an exception, not a silent PII upload.
        const deps: AuthBackupDeps = {
            listUsers: async () => ({ users: [user("a")] }),
            upload: async () => {
                throw new Error("upload attempted on a dry run");
            },
            now: () => new Date(0),
        };
        await expect(runAuthBackupCore(deps, { dryRun: true })).resolves.toMatchObject({ uploaded: false });
        await expect(runAuthBackupCore(deps, { dryRun: false })).rejects.toThrow(/dry run/);
    });

    it("a live run writes the users file FIRST and the manifest second", async () => {
        const { deps, uploads } = harness([{ users: [user("a")] }]);
        const r = await runAuthBackupCore(deps, { dryRun: false });
        expect(uploads.map((u) => u.path)).toEqual([r.objectPath, r.manifestPath]);
        expect(r.uploaded).toBe(true);
        expect(uploads.every((u) => u.contentType === "application/json")).toBe(true);
    });
});

describe("structural integrity — refuse to write an unrestorable export", () => {
    it("throws rather than exporting records with no localId", async () => {
        // UserRecord is mapped through an `as unknown as` cast, so an SDK field
        // rename would not be a type error — it would produce records with no
        // localId, i.e. a file that restores accounts owning nothing.
        const { deps } = harness([{ users: [{ uid: "" } as AuthUserLike] }]);
        await expect(runAuthBackupCore(deps, { dryRun: false })).rejects.toThrow(/localId/);
    });

    it("catches it on a DRY RUN too, before anyone arms the job", async () => {
        const { deps } = harness([{ users: [{ uid: undefined as unknown as string }] }]);
        await expect(runAuthBackupCore(deps, { dryRun: true })).rejects.toThrow(/unrestorable/);
    });

    it("an empty tenant is not an integrity failure", async () => {
        const { deps } = harness([{ users: [] }]);
        await expect(runAuthBackupCore(deps, { dryRun: true })).resolves.toMatchObject({ users: 0 });
    });
});

describe("what the export actually contains", () => {
    it("is exactly the { users: [...] } shape firebase auth:import consumes", async () => {
        const { deps, uploads } = harness([{ users: [user("a")] }]);
        await runAuthBackupCore(deps, { dryRun: false });
        const parsed = JSON.parse(uploads[0].body);
        expect(Object.keys(parsed)).toEqual(["users"]);
        expect(Array.isArray(parsed.users)).toBe(true);
        // No wrapper metadata: auth:import reads this file as-is, and every extra
        // top-level key is a bet on the CLI ignoring it.
        expect(parsed.users[0].localId).toBe("a");
    });

    it("the manifest carries counts only — NO PII", async () => {
        const { deps, uploads } = harness([{ users: [user("alice")] }]);
        const r = await runAuthBackupCore(deps, { dryRun: false });
        const manifest = uploads[1].body;
        expect(manifest).not.toContain("alice@example.com");
        expect(manifest).not.toContain("hash-alice");
        expect(manifest).not.toContain("salt-alice");
        expect(JSON.parse(manifest)).toMatchObject({ users: 1, complete: true, usersObject: r.objectPath });
    });

    it("the manifest names the run as incomplete when it is", async () => {
        let n = 0;
        const uploads: string[] = [];
        const deps: AuthBackupDeps = {
            listUsers: async () => ({ users: [user(`u${n}`)], pageToken: `t${n++}` }),
            upload: async (_p, body) => { uploads.push(body); },
            now: () => new Date(0),
        };
        await runAuthBackupCore(deps, { dryRun: false, maxPages: 2 });
        expect(JSON.parse(uploads[1])).toMatchObject({ complete: false });
    });
});

describe("toAuthImportRecord — the CLI's field names, not the SDK's", () => {
    it("maps uid->localId and passwordSalt->salt", () => {
        const r = toAuthImportRecord(user("abc123"));
        // localId is what makes the restored account own its Firestore data.
        expect(r.localId).toBe("abc123");
        expect(r.passwordHash).toBe("hash-abc123");
        expect(r.salt).toBe("salt-abc123");
        expect(r.uid).toBeUndefined();
        expect(r.passwordSalt).toBeUndefined();
    });

    it("converts UTC date strings to epoch-millisecond strings", () => {
        const r = toAuthImportRecord(user("t"));
        expect(r.createdAt).toBe(String(Date.parse("Tue, 22 Jun 2021 12:00:00 GMT")));
        expect(r.lastSignedInAt).toBe(String(Date.parse("Wed, 23 Jun 2021 12:00:00 GMT")));
    });

    it("drops an unparseable timestamp rather than emitting NaN", () => {
        expect(toEpochMsString("not a date")).toBeUndefined();
        expect(toEpochMsString(undefined)).toBeUndefined();
        const r = toAuthImportRecord(user("x", { metadata: { creationTime: "garbage" } }));
        expect(r.createdAt).toBeUndefined();
        expect(JSON.stringify(r)).not.toContain("NaN");
    });

    it("serializes custom claims into customAttributes", () => {
        const r = toAuthImportRecord(user("admin", { customClaims: { role: "SUPER_ADMIN" } }));
        expect(r.customAttributes).toBe('{"role":"SUPER_ADMIN"}');
    });

    it("maps providerData to providerUserInfo with rawId", () => {
        const r = toAuthImportRecord(user("g", {
            providerData: [{ providerId: "google.com", uid: "google-uid-1", email: "g@example.com" }],
        }));
        expect(r.providerUserInfo).toEqual([
            { providerId: "google.com", rawId: "google-uid-1", email: "g@example.com" },
        ]);
    });

    it("omits mfaInfo entirely when the user has no enrolled factors", () => {
        // This project has no MFA today; an untested field is a way to have the
        // whole file rejected by auth:import on the day it is needed.
        expect(toAuthImportRecord(user("a"))).not.toHaveProperty("mfaInfo");
        expect(toAuthImportRecord(user("a", { multiFactor: { enrolledFactors: [] } }))).not.toHaveProperty("mfaInfo");
    });

    it("emits mfaInfo when factors do exist", () => {
        const r = toAuthImportRecord(user("m", {
            multiFactor: { enrolledFactors: [{ uid: "f1", factorId: "phone", phoneNumber: "+15551234567" }] },
        }));
        expect(r.mfaInfo).toEqual([{ mfaEnrollmentId: "f1", phoneInfo: "+15551234567" }]);
    });

    it("drops undefined fields instead of emitting nulls", () => {
        const r = toAuthImportRecord({ uid: "bare" });
        expect(Object.keys(r).sort()).toEqual(["localId", "providerUserInfo"]);
    });
});

describe("readAuthBackupGate — kill switch OFF and dry-run by default", () => {
    it("a missing config is disabled and dry", () => {
        expect(readAuthBackupGate(undefined)).toEqual({ enabled: false, dryRun: true, bucket: null });
        expect(readAuthBackupGate(null)).toEqual({ enabled: false, dryRun: true, bucket: null });
        expect(readAuthBackupGate({})).toEqual({ enabled: false, dryRun: true, bucket: null });
    });

    it("only the literal true enables it", () => {
        expect(readAuthBackupGate({ enabled: "true" }).enabled).toBe(false);
        expect(readAuthBackupGate({ enabled: 1 }).enabled).toBe(false);
        expect(readAuthBackupGate({ enabled: true }).enabled).toBe(true);
    });

    it("only the literal false leaves dry-run", () => {
        expect(readAuthBackupGate({ dryRun: "false" }).dryRun).toBe(true);
        expect(readAuthBackupGate({ dryRun: 0 }).dryRun).toBe(true);
        expect(readAuthBackupGate({ dryRun: false }).dryRun).toBe(false);
    });

    it("normalizes the bucket and rejects nonsense", () => {
        expect(normalizeBucketName("gs://mmpools-auth-backups/")).toBe("mmpools-auth-backups");
        expect(normalizeBucketName("  mmpools-auth-backups ")).toBe("mmpools-auth-backups");
        expect(normalizeBucketName("MMPools")).toBeNull();      // uppercase is invalid in GCS
        expect(normalizeBucketName("a")).toBeNull();
        expect(normalizeBucketName("")).toBeNull();
        expect(normalizeBucketName(undefined)).toBeNull();
        expect(normalizeBucketName(42)).toBeNull();
        expect(normalizeBucketName("bucket/with/path")).toBeNull();
    });
});

describe("liveRunBlockedReason — one definition of 'armed'", () => {
    it("blocks while the kill switch is off, naming the config key", () => {
        const reason = liveRunBlockedReason({ enabled: false, dryRun: false, bucket: "b-bucket" });
        expect(reason).toContain("authBackup.enabled");
    });

    it("blocks an armed job with no destination", () => {
        const reason = liveRunBlockedReason({ enabled: true, dryRun: false, bucket: null });
        expect(reason).toContain("authBackup.bucket");
    });

    it("allows a live run only when both are satisfied", () => {
        expect(liveRunBlockedReason({ enabled: true, dryRun: false, bucket: "b-bucket" })).toBeNull();
    });
});

describe("runAuthBackupSchema — dry by default, strict", () => {
    it("defaults dryRun to true, including a no-arg (null) call", () => {
        expect(runAuthBackupSchema.parse({})).toEqual({ dryRun: true });
        expect(runAuthBackupSchema.parse(null)).toEqual({ dryRun: true });
        expect(runAuthBackupSchema.parse(undefined)).toEqual({ dryRun: true });
    });

    it("honours an explicit flag on both sides", () => {
        expect(runAuthBackupSchema.parse({ dryRun: false })).toEqual({ dryRun: false });
    });

    it("rejects a non-boolean flag and unknown fields", () => {
        expect(runAuthBackupSchema.safeParse({ dryRun: "no" }).success).toBe(false);
        expect(runAuthBackupSchema.safeParse({ dryRun: false, bucket: "elsewhere" }).success).toBe(false);
    });
});

describe("object naming", () => {
    it("stamps UTC so names sort chronologically", () => {
        expect(backupStamp(new Date(Date.UTC(2026, 7, 24, 7, 5, 3)))).toBe("20260824-070503Z");
    });

    it("puts exports under auth/ and pairs each with a manifest", () => {
        const p = authBackupObjectPath("20260824-070503Z", true, "a1b2c3");
        expect(p).toBe("auth/auth-backup-20260824-070503Z-a1b2c3.json");
        expect(manifestPathFor(p)).toBe("auth/auth-backup-20260824-070503Z-a1b2c3.manifest.json");
    });

    it("marks a partial export in the filename", () => {
        expect(authBackupObjectPath("20260824-070503Z", false, "a1b2c3")).toBe(
            "auth/auth-backup-20260824-070503Z-a1b2c3-PARTIAL.json",
        );
    });

    it("the stamp leads, so names still sort chronologically", () => {
        const early = authBackupObjectPath(backupStamp(new Date(Date.UTC(2026, 0, 1))), true, "zzzzzz");
        const late = authBackupObjectPath(backupStamp(new Date(Date.UTC(2026, 5, 1))), true, "000000");
        expect([late, early].sort()).toEqual([early, late]);
    });

    it("two runs in the SAME second get different object names (codex R2)", async () => {
        // The weekly schedule firing while an admin triggers a manual export, or
        // a Cloud Scheduler retry, would otherwise target identical paths — which
        // can pair one run's manifest with the other run's users object, and 403s
        // against the create-only bucket IAM.
        const at = () => new Date(Date.UTC(2026, 7, 24, 7, 15, 30));
        const mk = (): AuthBackupDeps => ({
            listUsers: async () => ({ users: [user("a")] }),
            upload: async () => undefined,
            now: at,
        });
        const a = await runAuthBackupCore(mk(), { dryRun: true });
        const b = await runAuthBackupCore(mk(), { dryRun: true });
        expect(a.objectPath).not.toBe(b.objectPath);
        expect(a.manifestPath).not.toBe(b.manifestPath);
    });

    it("the manifest records the run id it was named with", async () => {
        const uploads: Array<{ path: string; body: string }> = [];
        const deps: AuthBackupDeps = {
            listUsers: async () => ({ users: [user("a")] }),
            upload: async (path, body) => { uploads.push({ path, body }); },
            now: () => new Date(0),
        };
        const r = await runAuthBackupCore(deps, { dryRun: false, runId: "deadbe" });
        expect(r.objectPath).toContain("-deadbe.json");
        expect(JSON.parse(uploads[1].body)).toMatchObject({ runId: "deadbe", usersObject: r.objectPath });
    });
});

describe("PII — the module must never log a user record", () => {
    /**
     * The export deliberately contains every email and password hash; that is
     * what makes it restorable. The control is that those bytes go to the bucket
     * and NOWHERE else. Cloud Functions logs are read by anyone with project
     * viewer, are retained on their own schedule, and are not covered by the
     * bucket's access posture — so one interpolated user record undoes the whole
     * PII story. A source scan, because the alternative is vigilance.
     */
    const SRC = fs.readFileSync(path.join(__dirname, "..", "authBackup.ts"), "utf8");

    /** Strip comments: this file's own prose names every banned identifier. */
    const code = SRC
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
        .replace(/(?<!:)\/\/[^\n]*/g, (m) => " ".repeat(m.length));

    /** Every console.* call's argument text, by paren matching. */
    function consoleCalls(src: string): string[] {
        const out: string[] = [];
        for (const m of src.matchAll(/console\.\w+\(/g)) {
            let depth = 0;
            let i = m.index! + m[0].length - 1;
            for (; i < src.length; i++) {
                if (src[i] === "(") depth++;
                else if (src[i] === ")") {
                    depth--;
                    if (depth === 0) break;
                }
            }
            out.push(src.slice(m.index!, i + 1));
        }
        return out;
    }

    const calls = consoleCalls(code);

    it("found the console calls (guards against the scan matching nothing)", () => {
        expect(calls.length).toBeGreaterThanOrEqual(3);
    });

    it("no console call references a user field", () => {
        const banned = ["passwordHash", "passwordSalt", "salt", "localId", "customAttributes", "email", "records"];
        const offenders: string[] = [];
        for (const call of calls) {
            for (const b of banned) {
                if (call.includes(b)) offenders.push(`${b} in ${call.slice(0, 80)}`);
            }
        }
        expect(
            offenders,
            "authBackup.ts must log counts and object paths only — a user record in a log line " +
            "puts emails and password hashes somewhere the bucket's access controls do not reach.",
        ).toEqual([]);
    });

    it("the admin_audit metadata carries counts, not records", () => {
        // admin_audit is world-unreadable but SUPER_ADMIN-visible and permanent;
        // it is a summary trail, not a second copy of the export.
        const start = code.indexOf("metadata: {", code.indexOf("action: \"AUTH_BACKUP\""));
        const end = code.indexOf("status:", start);
        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);
        const metadata = code.slice(start, end);
        for (const b of ["passwordHash", "salt", "localId", "customAttributes", "email"]) {
            expect(metadata, `admin_audit metadata must not carry ${b}`).not.toContain(b);
        }
        // …and it must still say the things that make a run auditable.
        for (const k of ["dryRun", "accounts", "complete", "uploaded"]) {
            expect(metadata, `admin_audit metadata should record ${k}`).toContain(k);
        }
    });
});
