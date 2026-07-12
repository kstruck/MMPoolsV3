import { describe, it, expect } from "vitest";
import { z } from "zod";
import { runGate, nullish } from "../lib/validated";

// Minimal request shape the pure gate needs.
const authed = { auth: { uid: "u1", token: { role: "MEMBER" } }, data: {} as unknown };
const anon = { auth: null, data: {} as unknown };

const schema = z.strictObject({
    poolId: z.string().min(1).max(200),
    squareIds: z.array(z.number().int()).min(1),
    note: nullish(z.string().max(50)),
});

async function code(fn: () => Promise<unknown>): Promise<string> {
    try {
        await fn();
        return "NO_THROW";
    } catch (e) {
        return (e as { code?: string }).code ?? "UNKNOWN";
    }
}

describe("runGate", () => {
    it("accepts a valid payload and returns parsed data", async () => {
        const out = await runGate({ schema }, { ...authed, data: { poolId: "p1", squareIds: [1, 2] } });
        expect(out.poolId).toBe("p1");
        expect(out.squareIds).toEqual([1, 2]);
    });

    it("rejects unknown/extra fields (strict)", async () => {
        expect(await code(() => runGate({ schema }, { ...authed, data: { poolId: "p1", squareIds: [1], evil: true } })))
            .toBe("invalid-argument");
    });

    it("rejects wrong types", async () => {
        expect(await code(() => runGate({ schema }, { ...authed, data: { poolId: 1, squareIds: "nope" } })))
            .toBe("invalid-argument");
    });

    it("rejects missing required fields", async () => {
        expect(await code(() => runGate({ schema }, { ...authed, data: { poolId: "p1" } })))
            .toBe("invalid-argument");
    });

    it("normalizes null -> undefined for optional fields (C2)", async () => {
        const out = await runGate({ schema }, { ...authed, data: { poolId: "p1", squareIds: [1], note: null } });
        expect(out.note).toBeUndefined();
    });

    it("throws unauthenticated when auth required and caller is anon (auth BEFORE schema, C3)", async () => {
        // data is INVALID too; must still fail on auth first, not invalid-argument.
        expect(await code(() => runGate({ schema, auth: "required" }, { ...anon, data: { evil: true } })))
            .toBe("unauthenticated");
    });

    it("allows anon when auth is public", async () => {
        const out = await runGate({ schema, auth: "public" }, { ...anon, data: { poolId: "p1", squareIds: [1] } });
        expect(out.poolId).toBe("p1");
    });
});
