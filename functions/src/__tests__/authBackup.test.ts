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
    toRfc3339,
    runAuthBackupSchema,
    backupProblem,
    isPasswordUserMissingHash,
    countUnsupportedMfaFactors,
    toStandardBase64,
    IMPORTABLE_PROVIDER_IDS,
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

/**
 * Fixture hashes are REAL base64, because `auth:import` validates them as such
 * and a fixture that could never appear in a live export would let the
 * validator tests pass on data the CLI would reject.
 */
const hashOf = (uid: string) => Buffer.from(`hash-${uid}`).toString("base64");
const saltOf = (uid: string) => Buffer.from(`salt-${uid}`).toString("base64");

const user = (uid: string, over: Partial<AuthUserLike> = {}): AuthUserLike => ({
    uid,
    email: `${uid}@example.com`,
    emailVerified: true,
    disabled: false,
    passwordHash: hashOf(uid),
    passwordSalt: saltOf(uid),
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
        expect(manifest).not.toContain(hashOf("alice"));
        expect(manifest).not.toContain(saltOf("alice"));
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
        expect(r.passwordHash).toBe(hashOf("abc123"));
        expect(r.salt).toBe(saltOf("abc123"));
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

    it("emits mfaInfo for a PHONE factor", () => {
        const r = toAuthImportRecord(user("m", {
            multiFactor: { enrolledFactors: [{ uid: "f1", factorId: "phone", phoneNumber: "+15551234567" }] },
        }));
        expect(r.mfaInfo).toEqual([{ mfaEnrollmentId: "f1", phoneInfo: "+15551234567" }]);
    });

    it("converts enrollmentTime back to RFC 3339 for enrolledAt (codex R5)", () => {
        // firebase-admin builds enrollmentTime as new Date(enrolledAt).toUTCString(),
        // a DISPLAY string; the import API wants RFC 3339 back.
        const r = toAuthImportRecord(user("m", {
            multiFactor: { enrolledFactors: [{
                uid: "f1", factorId: "phone", phoneNumber: "+15551234567",
                enrollmentTime: "Tue, 22 Jun 2021 12:00:00 GMT",
            }] },
        }));
        expect((r.mfaInfo as Array<Record<string, unknown>>)[0].enrolledAt).toBe("2021-06-22T12:00:00.000Z");
    });

    it("drops an unparseable or null enrollmentTime rather than emitting it", () => {
        expect(toRfc3339("not a date")).toBeUndefined();
        expect(toRfc3339(null)).toBeUndefined();
        expect(toRfc3339(undefined)).toBeUndefined();
        const r = toAuthImportRecord(user("m", {
            multiFactor: { enrolledFactors: [{
                uid: "f1", factorId: "phone", phoneNumber: "+1555", enrollmentTime: "garbage",
            }] },
        }));
        expect((r.mfaInfo as Array<Record<string, unknown>>)[0]).not.toHaveProperty("enrolledAt");
    });

    it("never emits a TOTP factor as a phone-shaped record (codex R4)", () => {
        // auth:import's mfaInfo is phone-shaped; a TOTP factor has totpInfo and no
        // equivalent. Emitting it as a phone record with no phoneInfo would be
        // silently lossy and might be rejected at import.
        const r = toAuthImportRecord(user("t", {
            multiFactor: { enrolledFactors: [{ uid: "f9", factorId: "totp", totpInfo: {} }] },
        }));
        expect(r).not.toHaveProperty("mfaInfo");
    });

    it("emits only the phone factors of a mixed enrolment", () => {
        const r = toAuthImportRecord(user("mix", {
            multiFactor: { enrolledFactors: [
                { uid: "f9", factorId: "totp", totpInfo: {} },
                { uid: "f1", factorId: "phone", phoneNumber: "+15551234567" },
            ] },
        }));
        expect(r.mfaInfo).toEqual([{ mfaEnrollmentId: "f1", phoneInfo: "+15551234567" }]);
    });

    it("drops a phone factor with no number rather than emitting an empty one", () => {
        const r = toAuthImportRecord(user("p", {
            multiFactor: { enrolledFactors: [{ uid: "f1", factorId: "phone" }] },
        }));
        expect(r).not.toHaveProperty("mfaInfo");
    });

    it("drops undefined fields instead of emitting nulls", () => {
        const r = toAuthImportRecord({ uid: "bare" });
        expect(Object.keys(r).sort()).toEqual(["localId", "providerUserInfo"]);
    });
});

/**
 * The CLI's own validator, transcribed from firebase-tools 15.26.0
 * `lib/accountImporter.js`. Running the export through the real rules is the
 * only way to know a restore would actually work — codex R3 found a defect here
 * that made EVERY backup unrestorable, and reading the CLI source found three
 * more of the same class.
 */
const ALLOWED_JSON_KEYS = ["localId", "email", "emailVerified", "passwordHash", "salt", "displayName",
    "photoUrl", "createdAt", "lastSignedInAt", "providerUserInfo", "phoneNumber", "disabled",
    "customAttributes", "mfaInfo"];
const ALLOWED_PROVIDER_USER_INFO_KEYS = ["providerId", "rawId", "email", "displayName", "photoUrl"];
const ALLOWED_PROVIDER_IDS = ["google.com", "facebook.com", "twitter.com", "github.com", "apple.com",
    "microsoft.com", "gc.apple.com", "playgames.google.com", "linkedin.com", "yahoo.com"];

function isValidBase64(str: string): boolean {
    const expected = Buffer.from(str, "base64").toString("base64");
    if (str.length < expected.length && !str.endsWith("=")) str += "=".repeat(expected.length - str.length);
    return expected === str;
}

/** null when `auth:import` would accept this record, else the reason it rejects. */
function cliWouldReject(rec: Record<string, any>): string | null {
    const bad = Object.keys(rec).filter((k) => !ALLOWED_JSON_KEYS.includes(k));
    if (bad.length) return `unsupported keys: ${bad.join(",")}`;
    for (const p of rec.providerUserInfo ?? []) {
        if (!ALLOWED_PROVIDER_IDS.includes(p.providerId)) return `unsupported providerId: ${p.providerId}`;
        const pbad = Object.keys(p).filter((k) => !ALLOWED_PROVIDER_USER_INFO_KEYS.includes(k));
        if (pbad.length) return `unsupported provider keys: ${pbad.join(",")}`;
    }
    if (rec.passwordHash && !isValidBase64(rec.passwordHash)) return "passwordHash not base64";
    if (rec.salt && !isValidBase64(rec.salt)) return "salt not base64";
    return null;
}

describe("firebase auth:import would ACCEPT the export (codex R3 P1)", () => {
    it("strips the `password` provider entry every email/password user carries", () => {
        // THE defect: the Admin SDK's providerData includes a `password` entry
        // that the CLI's ALLOWED_PROVIDER_IDS does not accept, and one bad record
        // rejects the WHOLE file. Every account in this project is a password
        // account, so the backup was unrestorable for all of them.
        const r = toAuthImportRecord(user("kev"));
        expect(r.providerUserInfo).toEqual([]);
        expect(cliWouldReject(r)).toBeNull();
    });

    it("keeps federated links, and only the five keys the CLI allows", () => {
        const r = toAuthImportRecord(user("g", {
            providerData: [
                { providerId: "password", uid: "g@example.com", email: "g@example.com" },
                { providerId: "phone", uid: "+15551234567", phoneNumber: "+15551234567" },
                {
                    providerId: "google.com", uid: "gid", email: "g@example.com",
                    displayName: "G", photoURL: "http://x/y.png", phoneNumber: "+15551234567",
                },
            ],
        }));
        expect(r.providerUserInfo).toEqual([
            { providerId: "google.com", rawId: "gid", email: "g@example.com", displayName: "G", photoUrl: "http://x/y.png" },
        ]);
        // phoneNumber inside a provider entry is its own "unsupported keys" rejection.
        expect(cliWouldReject(r)).toBeNull();
    });

    it("never emits tenantId — absent from ALLOWED_JSON_KEYS", () => {
        const r = toAuthImportRecord(user("t", { tenantId: "tenant-1" }));
        expect(r).not.toHaveProperty("tenantId");
        expect(cliWouldReject(r)).toBeNull();
    });

    it("converts web-safe base64 hashes to standard base64", () => {
        // Identity Toolkit returns these web-safe; the CLI validates for STANDARD
        // base64 and does its own web-safe conversion on the wire. A single `-`
        // or `_` would fail the file with 'Password hash should be base64 encoded'.
        const raw = Buffer.from([0xff, 0xef, 0xbf, 0xfb, 0xef, 0xbe, 0xff, 0xff, 0x3f]).toString("base64");
        // The fixture must actually contain both characters, or this test passes
        // without exercising the conversion at all.
        expect(raw, "fixture no longer exercises + and /").toMatch(/\+/);
        expect(raw).toMatch(/\//);
        const webSafe = raw.replace(/\+/g, "-").replace(/\//g, "_");
        expect(webSafe).toMatch(/[-_]/);
        const r = toAuthImportRecord(user("h", { passwordHash: webSafe, passwordSalt: webSafe }));
        expect(r.passwordHash).not.toMatch(/[-_]/);
        expect(isValidBase64(r.passwordHash as string)).toBe(true);
        expect(cliWouldReject(r)).toBeNull();
        expect(toStandardBase64(undefined)).toBeUndefined();
    });

    it("every record of a realistic mixed tenant passes the CLI validator", () => {
        const users = [
            user("pw"),
            user("goog", { passwordHash: undefined, passwordSalt: undefined,
                providerData: [{ providerId: "google.com", uid: "gid", email: "g@example.com" }] }),
            user("adm", { customClaims: { role: "SUPER_ADMIN" } }),
            { uid: "minimal" } as AuthUserLike,
        ];
        for (const u of users) {
            const r = toAuthImportRecord(u);
            expect(cliWouldReject(r), `${u.uid}: ${cliWouldReject(r)}`).toBeNull();
        }
    });

    it("the allowlist in the source matches the CLI's", () => {
        expect([...IMPORTABLE_PROVIDER_IDS].sort()).toEqual([...ALLOWED_PROVIDER_IDS].sort());
    });
});

describe("redacted password hashes — the export that imports cleanly and locks everyone out", () => {
    it("counts password users whose hash came back empty", () => {
        expect(isPasswordUserMissingHash(user("ok"))).toBe(false);
        expect(isPasswordUserMissingHash(user("redacted", { passwordHash: undefined }))).toBe(true);
    });

    it("does NOT flag a federated-only account with no hash", () => {
        // A Google-only user legitimately has no password hash; flagging it would
        // make the signal cry wolf on every mixed tenant.
        expect(isPasswordUserMissingHash({
            uid: "g", providerData: [{ providerId: "google.com", uid: "gid" }],
        })).toBe(false);
    });

    it("reports the count and makes the run a PROBLEM, not a success", async () => {
        const { deps, uploads } = harness([{
            users: [user("a"), user("b", { passwordHash: undefined })],
        }]);
        const r = await runAuthBackupCore(deps, { dryRun: false });
        expect(r.passwordUsersMissingHash).toBe(1);
        expect(backupProblem(r)).toMatch(/cannot read password hashes/);
        expect(JSON.parse(uploads[1].body)).toMatchObject({ passwordUsersMissingHash: 1 });
    });

    it("a healthy complete run has no problem", async () => {
        const { deps } = harness([{ users: [user("a")] }]);
        expect(backupProblem(await runAuthBackupCore(deps, { dryRun: true }))).toBeNull();
    });

    it("truncation is reported ahead of the hash gap", () => {
        expect(backupProblem({ complete: false, passwordUsersMissingHash: 5, unsupportedMfaFactors: 3 })).toMatch(/truncated/);
    });
});

describe("unsupported second factors are counted, not silently dropped (codex R4)", () => {
    it("counts a TOTP factor and does not count a usable phone factor", () => {
        expect(countUnsupportedMfaFactors(user("a"))).toBe(0);
        expect(countUnsupportedMfaFactors(user("t", {
            multiFactor: { enrolledFactors: [{ uid: "f9", factorId: "totp", totpInfo: {} }] },
        }))).toBe(1);
        expect(countUnsupportedMfaFactors(user("p", {
            multiFactor: { enrolledFactors: [{ uid: "f1", factorId: "phone", phoneNumber: "+15551234567" }] },
        }))).toBe(0);
    });

    it("makes the run a PROBLEM and lands in the manifest", async () => {
        const { deps, uploads } = harness([{
            users: [user("a"), user("t", { multiFactor: { enrolledFactors: [{ uid: "f9", factorId: "totp" }] } })],
        }]);
        const r = await runAuthBackupCore(deps, { dryRun: false });
        expect(r.unsupportedMfaFactors).toBe(1);
        expect(backupProblem(r)).toMatch(/second factor/);
        expect(JSON.parse(uploads[1].body)).toMatchObject({ unsupportedMfaFactors: 1 });
    });

    it("a missing hash outranks an unsupported factor in the reported problem", () => {
        expect(backupProblem({ complete: true, passwordUsersMissingHash: 1, unsupportedMfaFactors: 1 }))
            .toMatch(/cannot read password hashes/);
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
