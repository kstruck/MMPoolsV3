import { describe, it, expect } from "vitest";
import { gradePropSchema, updatePropCardSchema } from "../schemas/propBets";

const okGrade = (d: unknown) => gradePropSchema.safeParse(d).success;
const okUpdate = (d: unknown) => updatePropCardSchema.safeParse(d).success;

describe("gradePropSchema", () => {
    // Exactly what dbService.gradeProp sends.
    it("accepts the real client payload", () => {
        expect(okGrade({ poolId: "p1", questionId: "q1", correctOptionIndex: 2 })).toBe(true);
        expect(okGrade({ poolId: "p1", questionId: "q1", correctOptionIndex: 0 })).toBe(true);
    });

    // questionId is matched with === against props.questions[].id, so it is a
    // lookup key and must survive verbatim.
    it("preserves whitespace in questionId (lookup key)", () => {
        const parsed = gradePropSchema.parse({
            poolId: "p1",
            questionId: " q1 ",
            correctOptionIndex: 1,
        });
        expect(parsed.questionId).toBe(" q1 ");
    });

    it("rejects missing fields, wrong types, and unknown keys", () => {
        expect(okGrade({ poolId: "p1", questionId: "q1" })).toBe(false);
        expect(okGrade({ poolId: "p1", questionId: "q1", correctOptionIndex: -1 })).toBe(false);
        expect(okGrade({ poolId: "p1", questionId: "q1", correctOptionIndex: 1.5 })).toBe(false);
        expect(okGrade({ poolId: "p1", questionId: "q1", correctOptionIndex: "2" })).toBe(false);
        expect(okGrade({ poolId: "p1", questionId: "q1", correctOptionIndex: 1, x: 1 })).toBe(false);
    });
});

describe("updatePropCardSchema", () => {
    it("accepts the shape the handler destructures", () => {
        expect(
            okUpdate({ poolId: "p1", cardId: "c1", answers: { q1: 0, q2: 3 } }),
        ).toBe(true);
        expect(
            okUpdate({
                poolId: "p1",
                cardId: "c1",
                answers: { q1: 1 },
                tiebreakerVal: 42,
                cardName: "My Card",
            }),
        ).toBe(true);
    });

    // The handler coerces with Number(), so a numeric string is legitimate.
    it("accepts a numeric-string tiebreakerVal and explicit nulls", () => {
        expect(okUpdate({ poolId: "p1", cardId: "c1", answers: {}, tiebreakerVal: "42" })).toBe(true);
        expect(
            okUpdate({ poolId: "p1", cardId: "c1", answers: {}, tiebreakerVal: null, cardName: null }),
        ).toBe(true);
    });

    it("rejects missing required fields, bad answers, and unknown keys", () => {
        expect(okUpdate({ poolId: "p1", cardId: "c1" })).toBe(false);
        expect(okUpdate({ poolId: "p1", answers: {} })).toBe(false);
        expect(okUpdate({ poolId: "p1", cardId: "c1", answers: { q1: "0" } })).toBe(false);
        expect(okUpdate({ poolId: "p1", cardId: "c1", answers: {}, evil: 1 })).toBe(false);
    });
});
