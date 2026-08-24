import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Source invariants from the 2026-08-23 backend audit (PR: backend quick wins).
 * These are grep-style guards so the three fixed defect classes cannot quietly
 * come back:
 *   1. Every HTTP (onRequest) endpoint rejects unexpected methods (405).
 *   2. No HttpsError is thrown with a raw error object as its 3rd arg —
 *      `details` is serialized to the client and a raw error leaks stacks.
 *   3. searchUsersByEmail returns an allowlist, never a spread of the raw
 *      user doc (phone / paymentHandles / socialLinks must not leave).
 */

const SRC = join(__dirname, "..");

function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (e.name === "__tests__" || e.name === "shared") return [];
        const p = join(dir, e.name);
        return e.isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
    });
}

describe("HTTP surface invariants", () => {
    const files = walk(SRC);

    it("every onRequest endpoint carries a method check", () => {
        const offenders: string[] = [];
        for (const f of files) {
            const text = readFileSync(f, "utf8");
            // Match bare `onRequest(` and qualified forms (`functions.https.onRequest(`,
            // `v1.https.onRequest(`) — codex r1: the bare-only match skipped testSmsHttp.
            if (!/export const \w+ = [\w.]*onRequest\(/.test(text)) continue;
            if (!/req\.method/.test(text)) offenders.push(f);
        }
        expect(offenders, `onRequest endpoints with no req.method check: ${offenders.join(", ")}`).toEqual([]);
    });

    it("no HttpsError passes a raw error object as the details arg", () => {
        const offenders: string[] = [];
        for (const f of files) {
            const text = readFileSync(f, "utf8");
            const matches = text.match(/new HttpsError\([^;]*,\s*(err|error|e)\s*\);/g);
            if (matches) offenders.push(`${f}: ${matches.join(" | ")}`);
        }
        expect(offenders, `raw error as HttpsError details: ${offenders.join(", ")}`).toEqual([]);
    });

    it("searchUsersByEmail does not spread the raw user doc", () => {
        const text = readFileSync(join(SRC, "userManagement.ts"), "utf8");
        const fn = text.slice(text.indexOf("searchUsersByEmail"), text.indexOf("sendUserEmail"));
        expect(fn).not.toMatch(/\.\.\.d\.data\(\)/);
        // The allowlist keeps sensitive fields out.
        for (const banned of ["phone", "paymentHandles", "socialLinks", "smsOptIn"]) {
            expect(fn, `searchUsersByEmail must not return ${banned}`).not.toContain(`${banned}:`);
        }
    });
});
