import { describe, it, expect } from "vitest";
import {
    getAdminHealthSnapshotSchema,
    backfillPoolsSchema,
    refreshExpertPicksSchema,
    syncPlayoffPoolsSchema,
} from "../schemas/noInputAdmin";

const SCHEMAS = {
    getAdminHealthSnapshot: getAdminHealthSnapshotSchema,
    backfillPools: backfillPoolsSchema,
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
