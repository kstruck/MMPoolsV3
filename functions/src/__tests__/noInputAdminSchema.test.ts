import { describe, it, expect } from "vitest";
import {
    getAdminHealthSnapshotSchema,
    backfillPoolsSchema,
    refreshExpertPicksSchema,
    syncPlayoffPoolsSchema,
} from "../schemas/noInputAdmin";

// backfillPools is deliberately NOT in this table — it takes a dryRun flag now
// (see its own describe block below). The rest are true no-input callables.
const SCHEMAS = {
    getAdminHealthSnapshot: getAdminHealthSnapshotSchema,
    refreshExpertPicks: refreshExpertPicksSchema,
    syncPlayoffPools: syncPlayoffPoolsSchema,
} as const;

describe.each(Object.entries(SCHEMAS))("%s schema (no-input)", (_name, schema) => {
    it("accepts an empty payload", () => {
        expect(schema.safeParse({}).success).toBe(true);
    });

    it("normalizes a no-arg call (null/undefined) to {} — the httpsCallable(fn)() transport quirk", () => {
        expect(schema.safeParse(null).success).toBe(true);
        expect(schema.safeParse(undefined).success).toBe(true);
    });

    it("rejects any field", () => {
        expect(schema.safeParse({ dryRun: true }).success).toBe(false);
        expect(schema.safeParse({ uid: "u1" }).success).toBe(false);
    });
});

describe("backfillPoolsSchema (dryRun-gated)", () => {
    const parse = (d: unknown) => backfillPoolsSchema.parse(d);

    // The gate that matters: this backfill's historical-stats leg uses
    // FieldValue.increment(), so an accidental no-arg call must REPORT, not write.
    it("defaults a missing dryRun to true, including a no-arg (null) call", () => {
        expect(parse({})).toEqual({ dryRun: true });
        expect(parse(null)).toEqual({ dryRun: true });
        expect(parse(undefined)).toEqual({ dryRun: true });
    });

    it("honors an explicit dryRun on both sides", () => {
        expect(parse({ dryRun: true })).toEqual({ dryRun: true });
        expect(parse({ dryRun: false })).toEqual({ dryRun: false });
    });

    it("rejects a non-boolean dryRun and unknown fields", () => {
        expect(backfillPoolsSchema.safeParse({ dryRun: "yes" }).success).toBe(false);
        expect(backfillPoolsSchema.safeParse({ dryRun: false, force: true }).success).toBe(false);
    });
});
