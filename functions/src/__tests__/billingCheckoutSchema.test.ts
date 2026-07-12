import { describe, it, expect } from "vitest";
import {
    redeemCouponSchema,
    redeemPoolCreditSchema,
    createCheckoutSessionSchema,
} from "../schemas/billingCheckout";

describe("redeemCouponSchema", () => {
    it("accepts the real { couponCode, poolId } payload", () => {
        expect(redeemCouponSchema.safeParse({ couponCode: "SAVE20", poolId: "p1" }).success).toBe(true);
    });
    it("rejects missing fields (old code threw) and unknown fields", () => {
        expect(redeemCouponSchema.safeParse({ couponCode: "SAVE20" }).success).toBe(false);
        expect(redeemCouponSchema.safeParse({ poolId: "p1" }).success).toBe(false);
        expect(redeemCouponSchema.safeParse({ couponCode: "S", poolId: "p1", force: 1 }).success).toBe(false);
    });
});

describe("redeemPoolCreditSchema", () => {
    it("accepts minimal and preferred-credit payloads (null optionals ok)", () => {
        expect(redeemPoolCreditSchema.safeParse({ poolId: "p1" }).success).toBe(true);
        expect(redeemPoolCreditSchema.safeParse({ poolId: "p1", bundleId: "b1", creditId: "c1" }).success).toBe(true);
        expect(redeemPoolCreditSchema.safeParse({ poolId: "p1", bundleId: null, creditId: null }).success).toBe(true);
    });
    it("rejects missing poolId (old code threw) and unknown fields", () => {
        expect(redeemPoolCreditSchema.safeParse({}).success).toBe(false);
        expect(redeemPoolCreditSchema.safeParse({ poolId: "p1", ownerId: "u2" }).success).toBe(false);
    });
});

describe("createCheckoutSessionSchema", () => {
    const poolPurchase = {
        poolId: "p1",
        poolName: "Family Squares",
        poolType: "SQUARES",
        estimatedPlayers: 25,
        addons: {},
    };
    it("accepts the bundle shape and the pool shape (the two pre-wrapper paths)", () => {
        expect(createCheckoutSessionSchema.safeParse({ bundleType: "five_pack" }).success).toBe(true);
        expect(createCheckoutSessionSchema.safeParse(poolPurchase).success).toBe(true);
        expect(createCheckoutSessionSchema.safeParse({ ...poolPurchase, couponCode: "SAVE20", usedCredit: true }).success).toBe(true);
    });
    it("bundle shape is strict — no pool fields alongside bundleType", () => {
        expect(createCheckoutSessionSchema.safeParse({ bundleType: "five_pack", poolId: "p1" }).success).toBe(false);
    });
    it("rejects an empty payload and a bad poolType", () => {
        expect(createCheckoutSessionSchema.safeParse({}).success).toBe(false);
        expect(createCheckoutSessionSchema.safeParse({ ...poolPurchase, poolType: "POKER" }).success).toBe(false);
    });
});
