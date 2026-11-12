import { describe, it, expect } from "vitest";
import {
    reserveSquareSchema,
    reserveSquaresSchema,
    markSquaresPaidSchema,
    purchasePropCardSchema,
} from "../schemas/squaresProps";

describe("reserveSquareSchema", () => {
    const guest = {
        poolId: "p1",
        squareId: 42,
        customerDetails: { name: "Aunt Carol", email: "carol@example.com", phone: "555" },
        guestDeviceKey: "dev-1",
        pickedAsName: "Carol",
    };
    it("accepts guest and minimal authed payloads", () => {
        expect(reserveSquareSchema.safeParse(guest).success).toBe(true);
        expect(reserveSquareSchema.safeParse({ poolId: "p1", squareId: 0 }).success).toBe(true);
    });
    it("normalizes null optionals (Firebase serializer, C2)", () => {
        const r = reserveSquareSchema.safeParse({ poolId: "p1", squareId: 1, customerDetails: null, guestDeviceKey: null, pickedAsName: null });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.customerDetails).toBeUndefined();
    });
    it("STRIPS unknown customerDetails keys (they used to reach the PII doc)", () => {
        const r = reserveSquareSchema.safeParse({ ...guest, customerDetails: { name: "C", ssn: "123-45-6789" } });
        expect(r.success).toBe(true);
        if (r.success) expect("ssn" in (r.data.customerDetails as object)).toBe(false);
    });
    it("rejects a missing squareId (old code threw) and non-int ids", () => {
        expect(reserveSquareSchema.safeParse({ poolId: "p1" }).success).toBe(false);
        expect(reserveSquareSchema.safeParse({ poolId: "p1", squareId: 4.5 }).success).toBe(false);
        expect(reserveSquareSchema.safeParse({ poolId: "p1", squareId: "42" }).success).toBe(false);
    });
});

describe("reserveSquaresSchema — a whole selection", () => {
    const base = { poolId: "p1", squareIds: [1, 2, 3], customerDetails: { name: "Carol" }, pickedAsName: "Carol" };
    it("accepts a selection, with or without a device key", () => {
        expect(reserveSquaresSchema.safeParse(base).success).toBe(true);
        expect(reserveSquaresSchema.safeParse({ ...base, guestDeviceKey: "g2_" + "a".repeat(36) }).success).toBe(true);
        expect(reserveSquaresSchema.safeParse({ ...base, guestDeviceKey: null }).success).toBe(true);
    });
    it("accepts an old or malformed key — whether it is HONOURED is not the schema's call", () => {
        // A tab open across the deploy still sends the pre-prefix key. Refusing
        // it here would refuse the reservation; the server reserves the square
        // and simply gives that key no identity.
        expect(reserveSquaresSchema.safeParse({ ...base, guestDeviceKey: "dev-1" }).success).toBe(true);
    });
    it("bounds the selection to the 10x10 grid", () => {
        expect(reserveSquaresSchema.safeParse({ ...base, squareIds: [] }).success).toBe(false);
        expect(reserveSquaresSchema.safeParse({ ...base, squareIds: [100] }).success).toBe(false);
        expect(reserveSquaresSchema.safeParse({ ...base, squareIds: [-1] }).success).toBe(false);
        expect(reserveSquaresSchema.safeParse({ ...base, squareIds: [1.5] }).success).toBe(false);
        expect(reserveSquaresSchema.safeParse({ ...base, squareIds: Array.from({ length: 100 }, (_, i) => i) }).success).toBe(true);
    });
    it("rejects duplicate ids", () => {
        expect(reserveSquaresSchema.safeParse({ ...base, squareIds: [4, 4] }).success).toBe(false);
    });
    it("rejects unknown top-level keys and strips unknown customerDetails keys", () => {
        expect(reserveSquaresSchema.safeParse({ ...base, reservedByUid: "someone-else" }).success).toBe(false);
        const r = reserveSquaresSchema.safeParse({ ...base, customerDetails: { name: "C", ssn: "x" } });
        expect(r.success).toBe(true);
        if (r.success) expect("ssn" in (r.data.customerDetails as object)).toBe(false);
    });
});

describe("markSquaresPaidSchema", () => {
    it("accepts the real { poolId, squareIds, isPaid } payload", () => {
        expect(markSquaresPaidSchema.safeParse({ poolId: "p1", squareIds: [1, 2, 3], isPaid: true }).success).toBe(true);
    });
    it("caps at 100 ids and requires a boolean isPaid (old code trusted it raw)", () => {
        expect(markSquaresPaidSchema.safeParse({ poolId: "p1", squareIds: Array(101).fill(1), isPaid: true }).success).toBe(false);
        expect(markSquaresPaidSchema.safeParse({ poolId: "p1", squareIds: [1], isPaid: "yes" }).success).toBe(false);
        expect(markSquaresPaidSchema.safeParse({ poolId: "p1", squareIds: [], isPaid: true }).success).toBe(false);
    });
});

describe("purchasePropCardSchema", () => {
    const card = { poolId: "p1", answers: { q1: 0, q2: 1 }, tiebreakerVal: 45, userName: "Kevin", cardName: "Card 1", email: "k@x.com" };
    it("accepts authed and guest payloads (all optionals nullish)", () => {
        expect(purchasePropCardSchema.safeParse(card).success).toBe(true);
        expect(purchasePropCardSchema.safeParse({ poolId: "p1", answers: { q1: 2 }, tiebreakerVal: null, userName: null, cardName: null, email: null }).success).toBe(true);
    });
    it("accepts a string tiebreakerVal (handler runs Number())", () => {
        expect(purchasePropCardSchema.safeParse({ ...card, tiebreakerVal: "45" }).success).toBe(true);
    });
    it("rejects non-integer answer values and oversized maps", () => {
        expect(purchasePropCardSchema.safeParse({ ...card, answers: { q1: "A" } }).success).toBe(false);
        expect(purchasePropCardSchema.safeParse({ ...card, answers: { q1: -1 } }).success).toBe(false);
        const big: Record<string, number> = {};
        for (let i = 0; i < 201; i++) big[`q${i}`] = 0;
        expect(purchasePropCardSchema.safeParse({ ...card, answers: big }).success).toBe(false);
    });
    it("rejects missing answers (old code threw) and unknown fields", () => {
        expect(purchasePropCardSchema.safeParse({ poolId: "p1" }).success).toBe(false);
        expect(purchasePropCardSchema.safeParse({ ...card, score: 99 }).success).toBe(false);
    });
});
