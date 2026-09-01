import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * PLAN-API-TRUST-BOUNDARY-REMEDIATION — the four audit fixes, pinned.
 *
 *  Phase 1: no client response is built from a caught error message
 *           (safeError helper behavior + a source-wide invariant + per-site pins
 *           for the alias shapes the regex cannot see).
 *  Phase 2: named schemas kill the null-payload crash class.
 *  Phase 3: every migrated SUPER_ADMIN decision resolves claim+doc
 *           (behavioral tests for the new HTTP helper; source pins per site —
 *           the same style backendResidue.test.ts established for 17d).
 *  Phase 4: bounded reads — cursor/cap/budget/kill-switch behavior on
 *           backfillPoolsCore, siteAverages paging, reveal caps.
 */

const SRC = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
/** Blank comments so prose cannot satisfy or trip a pin. */
const code = (...p: string[]) =>
    read(...p)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(?<!:)\/\/[^\n]*/g, "");

function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (e.name === "__tests__" || e.name === "shared") return [];
        const p = join(dir, e.name);
        return e.isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
    });
}

// ---------------------------------------------------------------------------
// firebase-admin double (same shape as backendResidue.test.ts) — drives
// confirmedRole, and a queryable pools/users double for backfillPoolsCore and
// recomputeSiteAverages.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
    const state = {
        /** users/{uid} role the next read returns; Error => the read throws. */
        docRole: undefined as string | undefined | Error,
        roleReads: [] as string[],
        /** system/config payload for the kill-switch read; Error => throws. */
        systemConfig: {} as Record<string, unknown> | Error,
        /** pools fixture: ordered {id, data, entries[]} rows. */
        poolsFixture: [] as Array<{ id: string; data: Record<string, unknown>; entries?: Array<{ id: string; data: Record<string, unknown> }> }>,
        profilesFixture: [] as Array<{ id: string; data: Record<string, unknown> }>,
        committedBatches: 0,
        committedOps: 0,
        siteAveragesWrites: [] as Array<Record<string, unknown>>,
        entryQueryLimits: [] as number[],
    };

    function makeQuery(rows: Array<{ id: string; data: Record<string, unknown> }>, opts: { collection?: string } = {}) {
        const qs = { limit: Infinity, startAfter: undefined as string | undefined };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q: any = {
            orderBy: () => q,
            select: () => q,
            limit: (n: number) => { qs.limit = n; if (opts.collection === 'entries') state.entryQueryLimits.push(n); return q; },
            startAfter: (id: string) => { qs.startAfter = id; return q; },
            get: async () => {
                let filtered = rows;
                if (qs.startAfter !== undefined) {
                    const idx = rows.findIndex(r => r.id === qs.startAfter);
                    filtered = rows.slice(idx + 1);
                }
                const page = filtered.slice(0, qs.limit === Infinity ? undefined : qs.limit);
                return {
                    docs: page.map(r => ({
                        id: r.id,
                        data: () => r.data,
                        ref: makeDocRef(r.id),
                    })),
                };
            },
        };
        return q;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function makeDocRef(id: string): any {
        return {
            id,
            collection: (sub: string) => {
                const pool = state.poolsFixture.find(p => p.id === id);
                return makeQuery(pool?.entries ?? [], { collection: sub });
            },
            update: () => undefined,
            set: () => undefined,
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firestoreFactory: any = () => ({
        doc: (path: string) => ({
            get: async () => {
                if (path === "system/config") {
                    if (state.systemConfig instanceof Error) throw state.systemConfig;
                    return { data: () => state.systemConfig };
                }
                state.roleReads.push(path);
                if (state.docRole instanceof Error) throw state.docRole;
                return { data: () => (state.docRole === undefined ? undefined : { role: state.docRole }) };
            },
        }),
        collection: (name: string) => {
            if (name === "pools") {
                const q = makeQuery(state.poolsFixture);
                q.doc = (id: string) => makeDocRef(id);
                return q;
            }
            if (name === "publicProfiles") {
                const q = makeQuery(state.profilesFixture);
                q.doc = () => ({ set: async (v: Record<string, unknown>) => { state.siteAveragesWrites.push(v); } });
                return q;
            }
            // users etc. — only doc()/subcollection refs are used.
            return {
                doc: (id: string) => ({
                    collection: () => ({ doc: () => ({}) }),
                    id,
                    get: async () => {
                        state.roleReads.push(`${name}/${id}`);
                        if (state.docRole instanceof Error) throw state.docRole;
                        return { data: () => (state.docRole === undefined ? undefined : { role: state.docRole }) };
                    },
                }),
            };
        },
        batch: () => {
            let ops = 0;
            return {
                update: () => { ops++; },
                set: () => { ops++; },
                commit: async () => { state.committedBatches++; state.committedOps += ops; },
            };
        },
        runTransaction: async () => { throw new Error("not used here"); },
    });
    firestoreFactory.FieldPath = { documentId: () => "__name__" };
    firestoreFactory.FieldValue = { serverTimestamp: () => 0, increment: (n: number) => n };

    return { state, firestoreFactory };
});

vi.mock("firebase-admin", () => ({
    default: { firestore: h.firestoreFactory, apps: [], initializeApp: () => undefined },
    firestore: h.firestoreFactory,
    apps: [],
    initializeApp: () => undefined,
}));
vi.mock("firebase-admin/firestore", () => ({
    FieldValue: { serverTimestamp: () => 0, increment: (n: number) => n },
    Timestamp: { now: () => ({ toMillis: () => 0 }) },
}));

const S = h.state;
const firestoreFactory = h.firestoreFactory;

import { HttpsError } from "firebase-functions/v2/https";
import { GENERIC_INTERNAL_MESSAGE, internalError, rethrowOrInternal } from "../lib/safeError";
import { confirmedSuperAdminHttp } from "../lib/confirmedRole";
import { backfillPoolsCore, ENTRY_SCAN_CAP, MAX_POOLS_PER_RUN, WRITE_BUDGET_PER_RUN } from "../backfill";
import { recomputeSiteAverages, SITE_AVERAGES_MAX_PAGES, SITE_AVERAGES_PAGE_SIZE } from "../siteAverages";
import { simulateGameUpdateSchema } from "../schemas/scoreUpdates";
import { generateTestScenarioSchema, validateTestResultsSchema } from "../schemas/aiTesting";
import { refreshExpertProfilesSchema } from "../expertProfiles";
import { backfillPoolsSchema } from "../schemas/noInputAdmin";
import { fixParticipantIdsSchema } from "../schemas/poolOps";
import { REVEAL_ENTRY_CAP, REVEAL_RESPONSE_BYTE_BUDGET } from "../nflPickReveal";

beforeEach(() => {
    S.docRole = undefined;
    S.roleReads = [];
    S.systemConfig = {};
    S.poolsFixture = [];
    S.profilesFixture = [];
    S.committedBatches = 0;
    S.committedOps = 0;
    S.siteAveragesWrites = [];
    S.entryQueryLimits = [];
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

// ---------------------------------------------------------------------------
// Phase 1 — safe errors
// ---------------------------------------------------------------------------

describe("Phase 1: safeError", () => {
    it("an unexpected error becomes the ONE generic internal message, never its own text", () => {
        const err = internalError("x", new Error("SECRET: /etc/passwd stripe_sk_live"));
        expect(err).toBeInstanceOf(HttpsError);
        expect(err.code).toBe("internal");
        expect(err.message).toBe(GENERIC_INTERNAL_MESSAGE);
        expect(err.message).not.toContain("SECRET");
    });

    it("rethrowOrInternal passes an expected HttpsError through UNCHANGED", () => {
        const expected = new HttpsError("not-found", "Pool not found.");
        try {
            rethrowOrInternal("x", expected);
            expect.unreachable();
        } catch (e) {
            expect(e).toBe(expected); // same object — code AND message intact
        }
    });

    it("rethrowOrInternal wraps everything else generically", () => {
        try {
            rethrowOrInternal("x", new TypeError("Cannot destructure 'poolId' of null"));
            expect.unreachable();
        } catch (e: unknown) {
            expect((e as HttpsError).code).toBe("internal");
            expect((e as HttpsError).message).toBe(GENERIC_INTERNAL_MESSAGE);
        }
    });

    it("SOURCE INVARIANT: no HttpsError is built from a caught error's .message anywhere", () => {
        const offenders: string[] = [];
        for (const f of walk(SRC)) {
            const text = readFileSync(f, "utf8");
            // Direct shapes: HttpsError('code', `...${err.message}...`) and
            // HttpsError('code', err.message / e?.message). Zod `issue.message`
            // is validation copy, not a caught error, and is allowed. Alias
            // shapes are pinned per-file below (a regex cannot chase assignments).
            const m = text.match(/new\s+(?:functions\.https\.)?HttpsError\((?:[^)(]|\([^)]*\))*(?:\$\{\s*(?:error|err|e)\??\.message|,\s*(?:error|err|e)\??\.message)/g);
            if (m) offenders.push(`${f}: ${m.join(" | ")}`);
        }
        expect(offenders, `HttpsError built from a caught message:\n${offenders.join("\n")}`).toEqual([]);
    });

    it("alias-shape pins: the two known alias sites stay fixed", () => {
        // bracketScoring used `const msg = e.message` then HttpsError(..., msg).
        expect(code("bracketScoring.ts")).not.toMatch(/HttpsError\('internal',\s*msg/);
        // authBackup used `Auth backup failed: ${message}`.
        expect(code("authBackup.ts")).not.toMatch(/Auth backup failed: \$\{message\}/);
        expect(code("authBackup.ts")).toMatch(/rethrowOrInternal\("runAuthBackup", e\)/);
    });

    it("fixPoolScores reports a stable reason code, not error.message", () => {
        const src = code("scoreUpdates.ts");
        expect(src).toMatch(/reason: 'processing-error'/);
        expect(src).not.toMatch(/reason: error\.message/);
    });

    it("the quote paths keep their invalid-argument code with STABLE text", () => {
        for (const f of ["billing.ts", "stripe.ts"]) {
            const src = code(f);
            expect(src, `${f} leaks the quote error message`).not.toMatch(/invalid-argument",\s*e\?\.message/);
        }
    });
});

// ---------------------------------------------------------------------------
// Phase 2 — input validation
// ---------------------------------------------------------------------------

describe("Phase 2: schemas kill the null-payload crash class", () => {
    it.each([null, undefined, 7, "x", [], true])("simulateGameUpdate rejects %s", (v) => {
        expect(simulateGameUpdateSchema.safeParse(v).success).toBe(false);
    });

    it("simulateGameUpdate accepts the simulator's real shape and rejects a non-object scores", () => {
        expect(simulateGameUpdateSchema.safeParse({ poolId: "p1", scores: { current: { home: 7, away: 0 } } }).success).toBe(true);
        expect(simulateGameUpdateSchema.safeParse({ poolId: "p1", scores: null }).success).toBe(false);
        expect(simulateGameUpdateSchema.safeParse({ poolId: "p1", scores: "7-0" }).success).toBe(false);
        expect(simulateGameUpdateSchema.safeParse({ poolId: "", scores: {} }).success).toBe(false);
    });

    it("simulateGameUpdate parses BEFORE any use of request.data (source pin)", () => {
        const src = code("scoreUpdates.ts");
        const fn = src.slice(src.indexOf("export const simulateGameUpdate"));
        expect(fn.indexOf("simulateGameUpdateSchema.safeParse")).toBeGreaterThan(-1);
        expect(fn.indexOf("simulateGameUpdateSchema.safeParse")).toBeLessThan(fn.indexOf("parsed.data"));
        expect(fn).not.toMatch(/=\s*request\.data\s*;/);
    });

    it("createBracketPool guards the payload shape before destructuring (source pin)", () => {
        const src = code("bracketPools.ts");
        const fn = src.slice(src.indexOf("export const createBracketPool"));
        const guardAt = fn.indexOf("assertCreatePayloadIsObject(request.data)");
        const destructureAt = fn.indexOf("} = request.data");
        expect(guardAt).toBeGreaterThan(-1);
        expect(guardAt).toBeLessThan(destructureAt);
    });

    it("aiTesting schemas: null and junk are invalid-argument shapes, bounds hold", () => {
        expect(generateTestScenarioSchema.safeParse(null).success).toBe(false);
        expect(generateTestScenarioSchema.safeParse({ poolType: "SQUARES" }).success).toBe(true);
        expect(generateTestScenarioSchema.safeParse({ poolType: "x".repeat(65) }).success).toBe(false);
        expect(validateTestResultsSchema.safeParse({ scenario: { poolType: "SQUARES" }, testResult: {} }).success).toBe(true);
        expect(validateTestResultsSchema.safeParse({ scenario: {}, testResult: {} }).success).toBe(false); // poolType required
        expect(validateTestResultsSchema.safeParse({ scenario: [], testResult: {} }).success).toBe(false);
    });

    it("refreshExpertProfiles: NaN can no longer reach the recompute", () => {
        expect(refreshExpertProfilesSchema.safeParse({ season: "2026", seasonType: "x" }).success).toBe(false);
        const ok = refreshExpertProfilesSchema.safeParse({ season: 2026 });
        expect(ok.success && ok.data.season).toBe("2026");
        expect(ok.success && ok.data.seasonType).toBe(2);
        expect(refreshExpertProfilesSchema.safeParse({}).success).toBe(false); // season required
    });
});

// ---------------------------------------------------------------------------
// Phase 3 — authorization
// ---------------------------------------------------------------------------

describe("Phase 3: confirmedSuperAdminHttp (HTTP claim+doc)", () => {
    it("denies a non-admin claim with ZERO reads", async () => {
        S.docRole = "SUPER_ADMIN"; // even a doc that WOULD agree must not be read
        await expect(confirmedSuperAdminHttp({ uid: "u1", role: "MEMBER" })).resolves.toBe(false);
        await expect(confirmedSuperAdminHttp({ uid: "u1" })).resolves.toBe(false);
        expect(S.roleReads).toEqual([]);
    });

    it("denies a SUPER_ADMIN claim whose doc says MEMBER / BANNED / is missing", async () => {
        for (const role of ["MEMBER", "BANNED", undefined] as const) {
            S.docRole = role;
            await expect(confirmedSuperAdminHttp({ uid: "u1", role: "SUPER_ADMIN" })).resolves.toBe(false);
        }
    });

    it("FAILS CLOSED when the doc read throws", async () => {
        S.docRole = new Error("firestore unavailable");
        await expect(confirmedSuperAdminHttp({ uid: "u1", role: "SUPER_ADMIN" })).resolves.toBe(false);
    });

    it("admits claim+doc agreement", async () => {
        S.docRole = "SUPER_ADMIN";
        await expect(confirmedSuperAdminHttp({ uid: "u1", role: "SUPER_ADMIN" })).resolves.toBe(true);
    });
});

describe("Phase 3: source pins — every migrated site resolves claim+doc", () => {
    it("simHarness.assertSuperAdmin is async claim+doc, awaited at every callable", () => {
        const src = code("simHarness.ts");
        expect(src).toMatch(/async function assertSuperAdmin/);
        expect(src).toMatch(/hasConfirmedRole\(/);
        expect((src.match(/await assertSuperAdmin\(request\)/g) ?? []).length).toBe(11);
        expect(src).not.toMatch(/role !== 'SUPER_ADMIN'/);
    });

    it("simLegacy's three callables all confirm the claim against the doc", () => {
        const src = code("simLegacy.ts");
        expect((src.match(/hasConfirmedRole\(request, 'SUPER_ADMIN'\)/g) ?? []).length).toBe(3);
        expect(src).not.toMatch(/isSuper = role === 'SUPER_ADMIN';/);
    });

    it("setPaidStatus / bracketEntries / squares admin bypasses use hasConfirmedRole", () => {
        expect(code("setPaidStatus.ts")).toMatch(/await hasConfirmedRole\(request, 'SUPER_ADMIN'\)/);
        expect(code("setPaidStatus.ts")).not.toMatch(/token\?\.role === 'SUPER_ADMIN'/);
        expect(code("bracketEntries.ts")).toMatch(/const isConfirmedAdmin = await hasConfirmedRole\(request, 'SUPER_ADMIN'\)/);
        expect(code("bracketEntries.ts")).not.toMatch(/token\?\.role === 'SUPER_ADMIN'/);
        const squares = code("squares.ts");
        expect((squares.match(/await hasConfirmedRole\(request, 'SUPER_ADMIN'\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
        // the doc-only in-transaction role read is gone
        expect(squares).not.toMatch(/userDoc\.data\(\)\?\.role/);
    });

    it("bracketEntries resolves the admin flag BEFORE its transaction (retry-safety)", () => {
        const src = code("bracketEntries.ts");
        const fn = src.slice(src.indexOf("export const updateEntryPayment"));
        expect(fn.indexOf("hasConfirmedRole(request")).toBeLessThan(fn.indexOf("db.runTransaction"));
    });

    it("payoutRecords' two authority calls receive a CONFIRMED claim", () => {
        const src = code("payoutRecords.ts");
        expect((src.match(/assertPayoutAuthority\([^;]*await confirmedAdminClaim\(request\)\)/g) ?? []).length).toBe(2);
        expect(src).not.toMatch(/assertPayoutAuthority\([^;]*token\.role/);
    });

    it("no call site hands the pool-authority helpers a raw token.role", () => {
        const offenders: string[] = [];
        for (const f of walk(SRC)) {
            const text = readFileSync(f, "utf8");
            const m = text.match(/(?:assertPoolOwnerOrSuperAdmin|loadPoolAndAssertManager)\([^;]*token\.role/g);
            if (m) offenders.push(`${f}: ${m.join(" | ")}`);
        }
        expect(offenders, offenders.join("\n")).toEqual([]);
    });

    it("the r3 sites resolve at the wrapper edge (coCommissioners, entry delete/rename, submit, sim mint)", () => {
        expect(code("coCommissioners.ts")).toMatch(/const claimRole = await confirmedAdminClaim\(request\)/);
        expect(code("nflEntryDelete.ts")).toMatch(/actorRole: await confirmedAdminClaim\(request\)/);
        expect(code("nflEntryRename.ts")).toMatch(/actorRole: await confirmedAdminClaim\(request\)/);
        const nfl = code("nflPools.ts");
        expect(nfl).toMatch(/actorRole: await confirmedAdminClaim\(request\)/); // submitNFLPicks
        expect(nfl).toMatch(/const claimRole = await confirmedAdminClaim\(request\);\s*\n\s*const simRunId = simRunIdForCreate/);
        expect(code("poolOps.ts")).toMatch(/const claimRole = await confirmedAdminClaim\(request\);\s*\n\s*const simRunId = simRunIdForCreate/);
    });

    it("both privileged HTTP endpoints confirm the role and keep 401/403 boundaries separate", () => {
        for (const f of ["debug.ts", "userManagement.ts"]) {
            const src = code(f);
            expect(src, f).toMatch(/await confirmedSuperAdminHttp\(decoded\)/);
            expect(src, f).not.toMatch(/decoded\.role !== 'SUPER_ADMIN'/);
        }
    });
});

// ---------------------------------------------------------------------------
// Phase 4 — bounded reads
// ---------------------------------------------------------------------------

function pool(id: string, data: Record<string, unknown> = {}, entries: Array<{ id: string; data: Record<string, unknown> }> = []) {
    return { id, data: { ownerId: `owner-${id}`, name: id, type: "SQUARES", ...data }, entries };
}

describe("Phase 4: backfillPoolsCore paging / caps / kill-switch / dry-run", () => {
    const db = () => firestoreFactory() as unknown as import("firebase-admin").firestore.Firestore;

    it("pages deterministically: cap+1 fetch, nextCursor, second page disjoint", async () => {
        S.poolsFixture = Array.from({ length: MAX_POOLS_PER_RUN + 3 }, (_, i) => pool(`p${String(i).padStart(3, "0")}`));
        const r1 = await backfillPoolsCore(db(), { dryRun: true });
        expect(r1.hasMore).toBe(true);
        expect(r1.updatedCount).toBe(MAX_POOLS_PER_RUN);
        expect(r1.nextCursor).toBe(`p${String(MAX_POOLS_PER_RUN - 1).padStart(3, "0")}`);
        const r2 = await backfillPoolsCore(db(), { dryRun: true, afterPoolId: r1.nextCursor! });
        expect(r2.hasMore).toBe(false);
        expect(r2.nextCursor).toBeNull();
        expect(r2.updatedCount).toBe(3);
    });

    it("a dry run stages writes but commits NOTHING; a live (armed) run commits", async () => {
        S.poolsFixture = [pool("p1")];
        const dry = await backfillPoolsCore(db(), { dryRun: true });
        expect(dry.plannedWrites).toBeGreaterThan(0);
        expect(S.committedBatches).toBe(0);

        S.systemConfig = { backfillPools: { enabled: true } };
        const live = await backfillPoolsCore(db(), { dryRun: false });
        expect(live.plannedWrites).toBe(dry.plannedWrites); // identical staging
        expect(S.committedBatches).toBeGreaterThan(0);
        expect(S.committedOps).toBe(live.plannedWrites);
    });

    it("KILL-SWITCH: a live run refuses unless system/config.backfillPools.enabled === true, and FAILS CLOSED on a read error", async () => {
        S.poolsFixture = [pool("p1")];
        for (const cfg of [{}, { backfillPools: { enabled: false } }, { backfillPools: { enabled: "yes" } }, new Error("boom")] as const) {
            S.systemConfig = cfg as Record<string, unknown> | Error;
            await expect(backfillPoolsCore(db(), { dryRun: false })).rejects.toMatchObject({ code: "failed-precondition" });
        }
        expect(S.committedBatches).toBe(0);
        // dry runs are never blocked
        S.systemConfig = new Error("boom");
        await expect(backfillPoolsCore(db(), { dryRun: true })).resolves.toMatchObject({ success: true });
    });

    it("an over-cap pool's historical leg is skipped WHOLE and reported; the entries query itself is capped", async () => {
        const bigEntries = Array.from({ length: ENTRY_SCAN_CAP + 1 }, (_, i) => ({ id: `e${i}`, data: { ownerUid: `u${i}` } }));
        S.poolsFixture = [pool("pBig", { status: "COMPLETED" }, bigEntries)];
        const r = await backfillPoolsCore(db(), { dryRun: true });
        expect(r.oversizedPools).toEqual(["pBig"]);
        // no per-entry writes staged for the oversized pool — only base+index
        expect(r.plannedWrites).toBeLessThanOrEqual(3);
        expect(S.entryQueryLimits).toContain(ENTRY_SCAN_CAP + 1); // the read is bounded, not just the processing
        // idempotency markers still gate normal pools
        S.poolsFixture = [pool("pDone", { status: "COMPLETED" }, [{ id: "e1", data: { ownerUid: "u1", historicalStatsFoldedAt: 123 } }])];
        const r2 = await backfillPoolsCore(db(), { dryRun: true });
        expect(r2.oversizedPools).toEqual([]);
        // folded entry contributes NO writes (the marker guard held)
        expect(r2.plannedWrites).toBeLessThanOrEqual(3);
    });

    it("the write budget stops BETWEEN pools at the last completed pool", async () => {
        // each COMPLETED pool: ~2 base/index writes + 2×N entry writes
        const entriesPerPool = Math.ceil(WRITE_BUDGET_PER_RUN / 4);
        S.poolsFixture = Array.from({ length: 4 }, (_, i) =>
            pool(`p${i}`, { status: "COMPLETED" },
                Array.from({ length: entriesPerPool }, (_, j) => ({ id: `e${j}`, data: { ownerUid: `u${i}-${j}` } }))));
        const r = await backfillPoolsCore(db(), { dryRun: true });
        expect(r.hasMore).toBe(true);
        expect(r.nextCursor).not.toBeNull();
        expect(r.updatedCount).toBeLessThan(4); // stopped early
        // no pool was split: writes are a whole-pool multiple over the budget at most one pool over
        expect(r.plannedWrites).toBeLessThan(WRITE_BUDGET_PER_RUN + (2 * entriesPerPool + 3));
    });
});

describe("Phase 4: siteAverages paging aborts rather than truncates", () => {
    const db = () => firestoreFactory() as unknown as import("firebase-admin").firestore.Firestore;

    it("folds across page boundaries and writes ONE aggregate", async () => {
        S.profilesFixture = Array.from({ length: SITE_AVERAGES_PAGE_SIZE + 5 }, (_, i) => ({
            id: `u${String(i).padStart(6, "0")}`,
            data: { weekly: [{ season: "2026", week: 1, correct: 1, total: 2 }] },
        }));
        const r = await recomputeSiteAverages(db());
        expect(r.profiles).toBe(SITE_AVERAGES_PAGE_SIZE + 5);
        expect(S.siteAveragesWrites).toHaveLength(1);
        expect((S.siteAveragesWrites[0] as { profilesCounted?: number }).profilesCounted).toBe(SITE_AVERAGES_PAGE_SIZE + 5);
    });

    it("an EXACTLY-cap-sized collection still publishes (codex diff review — the pre-check threw at 50k flat)", async () => {
        S.profilesFixture = Array.from({ length: SITE_AVERAGES_MAX_PAGES * SITE_AVERAGES_PAGE_SIZE }, (_, i) => ({
            id: `u${String(i).padStart(7, "0")}`,
            data: {},
        }));
        const r = await recomputeSiteAverages(db());
        expect(r.profiles).toBe(SITE_AVERAGES_MAX_PAGES * SITE_AVERAGES_PAGE_SIZE);
        expect(S.siteAveragesWrites).toHaveLength(1);
    });

    it("hitting the page cap throws WITHOUT writing (last complete aggregate survives)", async () => {
        S.profilesFixture = Array.from({ length: SITE_AVERAGES_MAX_PAGES * SITE_AVERAGES_PAGE_SIZE + 1 }, (_, i) => ({
            id: `u${String(i).padStart(7, "0")}`,
            data: {},
        }));
        await expect(recomputeSiteAverages(db())).rejects.toThrow(/aborting WITHOUT writing/);
        expect(S.siteAveragesWrites).toHaveLength(0);
    });
});

describe("Phase 4: reveal caps (source + constants)", () => {
    it("constants hold the documented Q3 ceilings", () => {
        expect(REVEAL_ENTRY_CAP).toBe(2_000);
        expect(REVEAL_RESPONSE_BYTE_BUDGET).toBe(8_000_000);
    });

    it("the entries scan is limited and overflow fails LOUD (never truncates)", () => {
        const src = code("nflPickReveal.ts");
        expect(src).toMatch(/\.limit\(REVEAL_ENTRY_CAP \+ 1\)/);
        expect(src).toMatch(/ENTRY_SCAN_OVERFLOW/);
        expect(src).toMatch(/failed-precondition/);
    });

    it("the byte budget measures UTF-8 BYTES, not UTF-16 length (multibyte boundary)", () => {
        const src = code("nflPickReveal.ts");
        expect(src).toMatch(/Buffer\.byteLength\(JSON\.stringify\(response\), 'utf8'\)/);
        // the boundary fact the pin protects: é is 1 UTF-16 unit but 2 UTF-8 bytes
        expect(Buffer.byteLength("é", "utf8")).toBe(2);
        expect("é".length).toBe(1);
    });

    it("fixParticipantIds is paged with a capped inner scan", () => {
        const src = code("poolOps.ts");
        // Scoped to the function: other ops in this file have their own bounds.
        const fn = src.slice(src.indexOf("export const fixParticipantIds"), src.indexOf("export const clearLegacyCoManagers"));
        expect(fn).toMatch(/FIX_PARTICIPANTS_POOLS_PER_RUN \+ 1/);
        expect(fn).toMatch(/FIX_PARTICIPANTS_ENTRY_CAP \+ 1/);
        expect(fn).not.toMatch(/db\.collection\('pools'\)\.get\(\)/);
    });

    it("cursor schemas take null as first-page and reject junk", () => {
        for (const schema of [backfillPoolsSchema, fixParticipantIdsSchema]) {
            const r = schema.safeParse({ dryRun: true, afterPoolId: null });
            expect(r.success).toBe(true);
            expect(r.success && (r.data as { afterPoolId?: string }).afterPoolId).toBeUndefined();
            expect(schema.safeParse({ dryRun: true, afterPoolId: 7 }).success).toBe(false);
            expect(schema.safeParse({ dryRun: true, nuke: true }).success).toBe(false);
        }
        // response echoes dryRun so the panel can mode-bind cursors
        expect(code("backfill.ts")).toMatch(/return \{ success: true, updatedCount, plannedWrites, dryRun, nextCursor, hasMore, oversizedPools \}/);
    });
});
