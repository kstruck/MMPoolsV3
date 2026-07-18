import { describe, it, expect } from "vitest";
import { validateBillingAccessSchema } from "../schemas/billing";

const ok = (d: unknown) => validateBillingAccessSchema.safeParse(d).success;

describe("validateBillingAccessSchema", () => {
    // The exact payload the handler destructures: { poolId, feature? }.
    it("accepts a poolId with and without a feature", () => {
        expect(ok({ poolId: "p1" })).toBe(true);
        expect(ok({ poolId: "p1", feature: "aiCommissioner" })).toBe(true);
    });

    it("rejects a missing/empty poolId and an unknown field", () => {
        expect(ok({})).toBe(false);
        expect(ok({ poolId: "" })).toBe(false);
        expect(ok({ poolId: "p1", evil: 1 })).toBe(false);
    });

    it("rejects a non-string feature", () => {
        expect(ok({ poolId: "p1", feature: 5 })).toBe(false);
    });
});
