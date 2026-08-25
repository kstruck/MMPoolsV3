import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * NEXT-SESSION-AUDIT-FIXES item 17 / PLAN-AUDIT-BACKEND-RESIDUE §2.
 *
 * The behavioural half of this file is the `hasConfirmedRole` block: a hardening
 * ships with a test proving the gate NOW REFUSES WHAT IT USED TO ALLOW, and what
 * it used to allow was a `SUPER_ADMIN` JWT claim whose `users/{uid}.role` doc
 * disagreed — a demoted admin holding an un-expired token.
 *
 * The rest are source pins. They are deliberately narrow (each names one call
 * site) because the thing being pinned is "this exact bypass branch consults the
 * doc", which no unit test of the surrounding callable can see without an
 * emulator.
 */

const SRC = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
/** Blank comments so a sentence ABOUT the old code cannot satisfy or trip a pin. */
const code = (...p: string[]) =>
    read(...p)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(?<!:)\/\/[^\n]*/g, "");

// ---------------------------------------------------------------------------
// 17d — the behavioural proof. firebase-admin is stubbed so lib/confirmedRole
// can be imported and driven without an emulator (same shape as
// checkoutOwnership.test.ts / entitlements.test.ts).
// ---------------------------------------------------------------------------

/** What the next users/{uid} read returns: a role string, or a thrown error. */
let docRole: string | undefined | Error = undefined;
/** Every users/{uid} path the module actually read — empty proves a short-circuit. */
let reads: string[] = [];

vi.mock("firebase-admin", () => {
    const firestore: any = () => ({
        doc: (path: string) => ({
            get: async () => {
                reads.push(path);
                if (docRole instanceof Error) throw docRole;
                return { data: () => (docRole === undefined ? undefined : { role: docRole }) };
            },
        }),
    });
    firestore.FieldValue = { serverTimestamp: () => 0 };
    return { default: { firestore, apps: [], initializeApp: () => undefined }, firestore, apps: [], initializeApp: () => undefined };
});

import { hasConfirmedRole, confirmedAdminClaim } from "../lib/confirmedRole";

const asCaller = (claim?: string) => ({ auth: { uid: "u1", token: claim ? { role: claim } : {} } });

describe("17d: hasConfirmedRole — the claim alone is no longer enough", () => {
    beforeEach(() => {
        reads = [];
        docRole = undefined;
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    it("REFUSES a SUPER_ADMIN claim whose users doc says otherwise (this used to return true)", async () => {
        docRole = "MEMBER";
        await expect(hasConfirmedRole(asCaller("SUPER_ADMIN"), "SUPER_ADMIN")).resolves.toBe(false);
        expect(reads).toEqual(["users/u1"]);
    });

    it("REFUSES a SUPER_ADMIN claim whose users doc is missing entirely", async () => {
        docRole = undefined;
        await expect(hasConfirmedRole(asCaller("SUPER_ADMIN"), "SUPER_ADMIN")).resolves.toBe(false);
    });

    it("admits a SUPER_ADMIN whose claim AND doc agree (the real admin still works)", async () => {
        docRole = "SUPER_ADMIN";
        await expect(hasConfirmedRole(asCaller("SUPER_ADMIN"), "SUPER_ADMIN")).resolves.toBe(true);
    });

    it("a non-admin claim costs ZERO Firestore reads (the short-circuit is the cost story)", async () => {
        docRole = "SUPER_ADMIN"; // even a doc that WOULD say yes must not be consulted
        await expect(hasConfirmedRole(asCaller("MEMBER"), "SUPER_ADMIN")).resolves.toBe(false);
        await expect(hasConfirmedRole(asCaller(undefined), "SUPER_ADMIN")).resolves.toBe(false);
        expect(reads, "a doc read happened for a caller that never claimed the role").toEqual([]);
    });

    it("an unauthenticated request is false, and reads nothing", async () => {
        await expect(hasConfirmedRole({ auth: null }, "SUPER_ADMIN")).resolves.toBe(false);
        expect(reads).toEqual([]);
    });

    it("FAILS CLOSED when the users read throws — false, never true", async () => {
        docRole = new Error("firestore unavailable");
        await expect(hasConfirmedRole(asCaller("SUPER_ADMIN"), "SUPER_ADMIN")).resolves.toBe(false);
        expect(console.warn).toHaveBeenCalled(); // logged, not swallowed
    });

    it("normalizes legacy role values on both sides (MANAGER doc != SUPER_ADMIN)", async () => {
        docRole = "MANAGER"; // legacy -> COMMISSIONER
        await expect(hasConfirmedRole(asCaller("SUPER_ADMIN"), "SUPER_ADMIN")).resolves.toBe(false);
    });
});

describe("17d: confirmedAdminClaim — strips only an UNCONFIRMED SUPER_ADMIN", () => {
    beforeEach(() => {
        reads = [];
        docRole = undefined;
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    it("strips a SUPER_ADMIN claim the doc does not back, so the owner check decides", async () => {
        docRole = "MEMBER";
        await expect(confirmedAdminClaim(asCaller("SUPER_ADMIN"))).resolves.toBeUndefined();
    });

    it("keeps a SUPER_ADMIN claim the doc backs", async () => {
        docRole = "SUPER_ADMIN";
        await expect(confirmedAdminClaim(asCaller("SUPER_ADMIN"))).resolves.toBe("SUPER_ADMIN");
    });

    it("passes every other claim through untouched, with no read", async () => {
        await expect(confirmedAdminClaim(asCaller("COMMISSIONER"))).resolves.toBe("COMMISSIONER");
        await expect(confirmedAdminClaim(asCaller(undefined))).resolves.toBeUndefined();
        expect(reads).toEqual([]);
    });
});

describe("17d: every named bypass branch consults the doc", () => {
    const sites: Array<[string, string, RegExp]> = [
        ["playoffPools.ts", "managePlayoffEntry", /const isAdmin = await hasConfirmedRole\(request, 'SUPER_ADMIN'\)/],
        ["scoreUpdates.ts", "simulateGameUpdate", /const isSuperAdmin = await hasConfirmedRole\(request, 'SUPER_ADMIN'\)/],
        ["userProfile.ts", "recomputeMyProfile", /!\(await hasConfirmedRole\(request, 'SUPER_ADMIN'\)\)/],
        ["userProfile.ts", "getProfilePoolDetail", /const isAdmin = await hasConfirmedRole\(request, 'SUPER_ADMIN'\)/],
        ["nflPools.ts", "scoreNFLWeek", /const userRole = await confirmedAdminClaim\(request\)/],
        ["poolOps.ts", "toggleWinnerPaid", /const userRole = await confirmedAdminClaim\(request\)/],
    ];

    it.each(sites)("%s (%s) resolves the admin flag through the claim+doc helper", (file, _fn, re) => {
        expect(code(file)).toMatch(re);
    });

    it("none of the six files still decides admin from the raw claim in these branches", () => {
        for (const file of ["playoffPools.ts", "scoreUpdates.ts", "userProfile.ts", "nflPools.ts"]) {
            expect(
                code(file),
                `${file}: a bare token.role SUPER_ADMIN compare is back — that is the exact ` +
                "shape 17d removed (a demoted admin with an un-expired token passes it).",
            ).not.toMatch(/auth[!?]?\.token\??\.role\s*[!=]==\s*['"]SUPER_ADMIN['"]/);
        }
        // poolOps.ts keeps two raw compares INSIDE assertPoolOwnerOrSuperAdmin /
        // assertPoolOwnerOrManagerNoCo. Those are pure helpers shared with three
        // files outside this change; they receive a resolved role from this PR's
        // call sites and a raw one from the others (PLAN §5, open).
        const helperCompares = code("poolOps.ts").match(/userRole === 'SUPER_ADMIN'/g) ?? [];
        expect(helperCompares).toHaveLength(2);
    });

    it("scoreNFLWeek's ACTIVE_GAMES bypass reads the SAME resolved role (self-review r0, not in the audit list)", () => {
        // `userRole` has TWO consumers in scoreNFLWeek, and the audit named only the
        // first. The second exempts SUPER_ADMIN from the "all games must be FINAL"
        // gate — a SCORING bypass that applies Survivor strikes and Margin -14s
        // mid-week. Pinned because a future edit that re-derives userRole from the
        // raw claim for "just" this line would silently reopen it.
        const src = code("nflPools.ts");
        const fn = src.slice(src.indexOf("export const scoreNFLWeek"));
        const resolvedAt = fn.indexOf("const userRole = await confirmedAdminClaim(request)");
        const activeGamesAt = fn.indexOf("activeGamesCount > 0 && userRole !== 'SUPER_ADMIN'");
        expect(resolvedAt).toBeGreaterThanOrEqual(0);
        expect(activeGamesAt, "the ACTIVE_GAMES gate no longer reads userRole").toBeGreaterThan(resolvedAt);
        // and no second, unresolved binding shadows it
        expect(fn.slice(0, activeGamesAt).match(/const userRole =/g) ?? []).toHaveLength(1);
    });

    it("scoreUpdates resolves it OUTSIDE the transaction (a plain get() inside re-runs on retry)", () => {
        const src = code("scoreUpdates.ts");
        const fn = src.slice(src.indexOf("export const simulateGameUpdate"));
        expect(fn.indexOf("hasConfirmedRole(request")).toBeLessThan(fn.indexOf("db.runTransaction"));
    });
});

// ---------------------------------------------------------------------------
// 17a — the three Gemini callables
// ---------------------------------------------------------------------------

describe("17a: aiTesting.ts has no claim-only SUPER_ADMIN gate left", () => {
    const src = code("aiTesting.ts");

    it("all three callables go through assertCallerRole", () => {
        expect(src.match(/await assertCallerRole\(request, "SUPER_ADMIN"\)/g) ?? []).toHaveLength(3);
    });

    it("the raw claim compare is gone", () => {
        expect(src).not.toMatch(/token\??\.role !== ['"]SUPER_ADMIN['"]/);
    });

    it("there are still exactly three callables to gate (the count is not drifting)", () => {
        expect(src.match(/export const \w+ = onCall\(/g) ?? []).toHaveLength(3);
    });
});

// ---------------------------------------------------------------------------
// 17b / 17f — the two remaining bare onCall handlers
// ---------------------------------------------------------------------------

describe("17b: backfillProfileData is a validated() callable", () => {
    const src = code("migrations", "backfillProfileData.ts");

    it("is wrapped, SUPER_ADMIN-gated, and keeps its sizing", () => {
        expect(src).toMatch(/export const backfillProfileData = validated\(/);
        expect(src).toMatch(/role: "SUPER_ADMIN"/);
        expect(src).toMatch(/options: \{ timeoutSeconds: 540, memory: '1GiB' \}/);
    });

    it("no bare onCall and no hand-rolled claim check remain", () => {
        expect(src).not.toMatch(/onCall\(/);
        expect(src).not.toMatch(/token\??\.role !== 'SUPER_ADMIN'/);
    });

    it("reads its input from the PARSED data, not raw request.data", () => {
        expect(src).not.toMatch(/request\.data/);
    });
});

describe("17f: getProfilePoolDetail is a validated() callable", () => {
    const src = code("userProfile.ts");

    it("is wrapped with auth required", () => {
        expect(src).toMatch(/export const getProfilePoolDetail = validated\(/);
        expect(src).toMatch(/label: "getProfilePoolDetail", auth: "required"/);
    });

    it("no bare onCall remains in the file", () => {
        expect(src).not.toMatch(/= onCall\(/);
    });
});

// ---------------------------------------------------------------------------
// Schemas: the two new ones (17b, 17f) and the 17e strictness claim.
// ---------------------------------------------------------------------------

import { backfillProfileDataSchema } from "../schemas/migrations";
import { getProfilePoolDetailSchema } from "../schemas/userProfile";
import { getOpsHealthSummarySchema } from "../schemas/opsHealth";
import { getProdWatchdogSchema } from "../schemas/prodWatchdog";
import { reserveSquareSchema, markSquaresPaidSchema, purchasePropCardSchema } from "../schemas/squaresProps";
import {
    updateTournamentDataSchema,
    updateGlobalPlayoffResultsSchema,
    markEntryPaidStatusSchema,
} from "../schemas/tournamentAdmin";

describe("17b: backfillProfileDataSchema", () => {
    it("defaults dryRun TRUE at the schema layer (Rule 1 / the #183 lesson)", () => {
        const r = backfillProfileDataSchema.safeParse({});
        expect(r.success).toBe(true);
        expect(r.success && r.data.dryRun).toBe(true);
    });

    it("accepts the shape OperationsPanel actually sends", () => {
        expect(backfillProfileDataSchema.safeParse({ dryRun: false }).success).toBe(true);
        expect(backfillProfileDataSchema.safeParse({ dryRun: true }).success).toBe(true);
    });

    it("takes null as first-page for the cursor (the JS SDK undefined->null encoding)", () => {
        const r = backfillProfileDataSchema.safeParse({ dryRun: true, afterPoolId: null });
        expect(r.success).toBe(true);
        expect(r.success && r.data.afterPoolId).toBeUndefined();
    });

    it("does NOT trim the cursor — it is compared against a document id", () => {
        const r = backfillProfileDataSchema.safeParse({ afterPoolId: " pool-1 " });
        expect(r.success && r.data.afterPoolId).toBe(" pool-1 ");
    });

    it("rejects unknown keys and wrong types", () => {
        expect(backfillProfileDataSchema.safeParse({ dryRun: true, nuke: true }).success).toBe(false);
        expect(backfillProfileDataSchema.safeParse({ dryRun: "false" }).success).toBe(false);
    });
});

describe("17f: getProfilePoolDetailSchema", () => {
    it("accepts exactly what dbService sends (the correlation id is stripped upstream)", () => {
        expect(getProfilePoolDetailSchema.safeParse({ subjectId: "u1", poolId: "p1" }).success).toBe(true);
    });

    it("requires both ids", () => {
        expect(getProfilePoolDetailSchema.safeParse({ subjectId: "u1" }).success).toBe(false);
        expect(getProfilePoolDetailSchema.safeParse({ poolId: "p1" }).success).toBe(false);
        expect(getProfilePoolDetailSchema.safeParse({ subjectId: "", poolId: "p1" }).success).toBe(false);
    });

    it("rejects unknown keys and non-string ids (the old hand-rolled checks let extras through)", () => {
        expect(getProfilePoolDetailSchema.safeParse({ subjectId: "u1", poolId: "p1", x: 1 }).success).toBe(false);
        expect(getProfilePoolDetailSchema.safeParse({ subjectId: 1, poolId: "p1" }).success).toBe(false);
    });
});

/**
 * 17e was REJECTED — the four modules the audit called "non-strict" all already
 * reject unknown top-level keys. This block is the evidence, pinned so the claim
 * cannot be re-raised without measuring, and so a future edit cannot quietly
 * loosen one of them.
 */
describe("17e: the four flagged schema modules already reject unknown keys", () => {
    const cases: Array<[string, any, any]> = [
        ["getOpsHealthSummary", getOpsHealthSummarySchema, { x: 1 }],
        ["getProdWatchdog", getProdWatchdogSchema, { x: 1 }],
        ["reserveSquare", reserveSquareSchema, { poolId: "p", squareId: 1, x: 1 }],
        ["markSquaresPaid", markSquaresPaidSchema, { poolId: "p", squareIds: [1], isPaid: true, x: 1 }],
        ["purchasePropCard", purchasePropCardSchema, { poolId: "p", answers: { a: 1 }, x: 1 }],
        ["updateTournamentData", updateTournamentDataSchema, { tournamentId: "t", tournamentData: {}, x: 1 }],
        [
            "updateGlobalPlayoffResults",
            updateGlobalPlayoffResultsSchema,
            { results: { WILD_CARD: [], DIVISIONAL: [], CONF_CHAMP: [], SUPER_BOWL: [] }, x: 1 },
        ],
        ["markEntryPaidStatus", markEntryPaidStatusSchema, { poolId: "p", entryId: "e", isPaid: true, x: 1 }],
    ];

    it.each(cases)("%s rejects an unknown top-level key", (_name, schema, payload) => {
        const r = schema.safeParse(payload);
        expect(r.success).toBe(false);
        expect(JSON.stringify(r.error!.issues)).toContain("unrecognized_keys");
    });

    it("the no-input schemas both still accept a null payload (the syncMyClaims trap)", () => {
        // A zero-arg httpsCallable(fn)() delivers request.data as null. prodWatchdog's
        // noInputSchema normalizes it; opsHealth's bare strict object does not, and
        // that difference is deliberate — its only caller sends a correlation id.
        expect(getProdWatchdogSchema.safeParse(null).success).toBe(true);
    });
});

describe("17e: the two nested stripping objects are deliberate and STAY stripping", () => {
    it("squaresProps.customerDetails strips unknown keys instead of rejecting (public guest flow, PII doc)", () => {
        const r = reserveSquareSchema.safeParse({
            poolId: "p",
            squareId: 1,
            customerDetails: { name: "a", legacyField: "x" },
        });
        expect(r.success, "tightening this would refuse a PUBLIC purchase over an extra key").toBe(true);
        expect(r.success && (r.data.customerDetails as any)).toEqual({ name: "a" });
    });

    it("updateGlobalPlayoffResults.results strips a legacy round echoed back from the stored doc", () => {
        const r = updateGlobalPlayoffResultsSchema.safeParse({
            results: { WILD_CARD: [], DIVISIONAL: [], CONF_CHAMP: [], SUPER_BOWL: [], LEGACY_ROUND: [] },
        });
        expect(r.success, "tightening this would refuse a save on historical documents").toBe(true);
        expect(r.success && Object.keys(r.data.results).sort()).toEqual([
            "CONF_CHAMP",
            "DIVISIONAL",
            "SUPER_BOWL",
            "WILD_CARD",
        ]);
    });

    it("the tournamentAdmin comment no longer calls the strict envelope non-strict (17e partial)", () => {
        const src = read("schemas", "tournamentAdmin.ts");
        const header = src.slice(0, src.indexOf("export const updateGlobalPlayoffResultsSchema"));
        const lastBlock = header.slice(header.lastIndexOf("/**"));
        expect(lastBlock).toMatch(/ENVELOPE is strict/);
        expect(lastBlock).toMatch(/INNER `results` object is deliberately non-strict/);
    });
});
