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

    it("every HTML-serving onRequest endpoint applies the shared security headers", () => {
        // 2026-09-05 audit: the three HTML endpoints shipped with no security
        // headers at all because nginx/firebase.json only cover the hosting
        // origins. The allowlist below is PINNED, not derived: each entry is an
        // onRequest that sends plain text or JSON (or nothing), with the reason.
        // A new onRequest file must either call setSecurityHeaders or be added
        // here with a reason — the default is the headers.
        const PLAIN_TEXT_OR_JSON: Record<string, string> = {
            "cspReport.ts": "204/405 with empty body; browser report sink",
            "debug.ts": "SA-only diagnostic; res.send(text)/json",
            "readiness.ts": "OK/UNAVAILABLE probe text",
            "stripe.ts": "Stripe webhook; text acks only",
            "userManagement.ts": "testSmsHttp SA-only diagnostic; json",
        };
        const offenders: string[] = [];
        const seenAllowlisted: string[] = [];
        for (const f of files) {
            const text = readFileSync(f, "utf8");
            if (!/export const \w+ = [\w.]*onRequest\(/.test(text)) continue;
            const base = f.split(/[\\/]/).pop() as string;
            if (base in PLAIN_TEXT_OR_JSON) { seenAllowlisted.push(base); continue; }
            if (!/setSecurityHeaders\(res,\s*"(page|spa)"\)/.test(text)) offenders.push(base);
        }
        expect(offenders, `HTML onRequest endpoints without setSecurityHeaders: ${offenders.join(", ")}`).toEqual([]);
        // The allowlist must not go stale in the other direction either: an
        // entry for a file that no longer exports an onRequest is a dead reason.
        expect(seenAllowlisted.sort()).toEqual(Object.keys(PLAIN_TEXT_OR_JSON).sort());
    });

    it("the security-headers grep is reachable — a handler without the call fails it", () => {
        const withoutCall = 'export const x = onRequest(async (req, res) => { if (req.method !== "GET") return; res.send("<html>"); });';
        expect(/setSecurityHeaders\(res,\s*"(page|spa)"\)/.test(withoutCall)).toBe(false);
        const withCall = 'export const x = onRequest(async (req, res) => { setSecurityHeaders(res, "page"); res.send("<html>"); });';
        expect(/setSecurityHeaders\(res,\s*"(page|spa)"\)/.test(withCall)).toBe(true);
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

    it("no renderEmailHtml call site pre-escapes its title", () => {
        // 2026-09-06 (#671): renderEmailHtml escapes its `title` itself, so a
        // caller that escapes first double-encodes — `Smith & Sons` reaches the
        // host as `Smith &amp; Sons`. confirmPayment.ts did exactly this (found
        // by qodo). Multi-line aware: the first argument may sit on the line
        // after the call, which is how the first single-line sweep missed it.
        const PRE_ESCAPED_TITLE = /renderEmailHtml\(\s*escapeHtml\(/;
        const offenders: string[] = [];
        for (const f of files) {
            if (PRE_ESCAPED_TITLE.test(readFileSync(f, "utf8"))) offenders.push(f);
        }
        expect(offenders, `renderEmailHtml called with a pre-escaped title: ${offenders.join(", ")}`).toEqual([]);
        // Reachability: the pre-fix confirmPayment shape must match.
        const preFix = "const emailHtml = renderEmailHtml(\n            escapeHtml(`Payment Confirmation from ${x}`),\n            body";
        expect(PRE_ESCAPED_TITLE.test(preFix)).toBe(true);
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
