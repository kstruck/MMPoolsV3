import { describe, it, expect } from "vitest";
import "./setup";
import { readiness } from "../../readiness";

/** Minimal stub satisfying the subset of Express's Response the handler uses. */
function fakeRes() {
    const calls: { status?: number; body?: unknown } = {};
    return {
        status(code: number) {
            calls.status = code;
            return {
                send(body: unknown) {
                    calls.body = body;
                },
            };
        },
        calls,
    };
}

describe("readiness (emulator)", () => {
    it("responds 200 OK when Firestore is reachable", async () => {
        const res = fakeRes();
        await (readiness as unknown as (req: unknown, res: unknown) => Promise<void>)({}, res);
        expect(res.calls.status).toBe(200);
        expect(res.calls.body).toBe("OK");
    });
});
