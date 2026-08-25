import { describe, it, expect } from "vitest";
import {
    MAX_BODY_BYTES,
    MAX_REPORTS_PER_REQUEST,
    MAX_SIGNATURES,
    MAX_WRITES_PER_HOUR,
    hourKey,
    ingest,
    normalizeBlockedUri,
    normalizeDirective,
    normalizeDocumentPath,
    parseReports,
    sanitizeKey,
    signatureFor,
    takeWriteSlot,
    type BudgetState,
} from "../cspReport";

/**
 * The CSP collector is an UNAUTHENTICATED public endpoint — browsers post
 * violation reports with no credentials and no App Check token, so anything on
 * the internet can POST to it. Its safety is entirely in the normalisation and
 * the bounds, so those get assertions rather than comments.
 *
 * What each group is actually protecting against:
 *  - normalisation: attacker text becoming a Firestore FIELD PATH (a `.` in a
 *    signature key would write into a sibling field), or unbounded signature
 *    cardinality (one key per blocked URL instead of per blocked ORIGIN).
 *  - parsing: the two wire formats disagree on shape AND key casing, so a
 *    parser that handles only one silently drops a whole browser family — the
 *    same "absence reads as health" failure the CSP invariants file exists for.
 *  - the write budget: the only thing standing between this endpoint and an
 *    unbounded Firestore bill.
 */

describe("cspReport — normalisation keeps attacker text out of field paths", () => {
    it("sanitizeKey emits only [A-Za-z0-9_-]", () => {
        const nasty = "script-src|https://evil.example/../../a.b.c ~*[]`${}";
        const key = sanitizeKey(nasty);
        expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
        // A dot would make `signatures.<key>.count` address a nested field the
        // caller chose. This is the assertion that stops that.
        expect(key).not.toContain(".");
    });

    it("sanitizeKey is length-capped and never empty", () => {
        expect(sanitizeKey("x".repeat(500)).length).toBe(120);
        expect(sanitizeKey("///")).toBe("unknown");
    });

    it("normalizeDirective keeps the first token of a source list", () => {
        // `violated-directive` is historically a whole source list.
        expect(normalizeDirective("script-src 'self' https://cdn.example")).toBe("script-src");
        expect(normalizeDirective("img-src")).toBe("img-src");
    });

    it("normalizeDirective buckets anything that is not a directive name", () => {
        for (const bad of ["", "  ", "DROP TABLE", "a".repeat(200), 42, null, undefined, {}]) {
            expect(normalizeDirective(bad as unknown)).toBe("other");
        }
    });

    it("normalizeBlockedUri collapses a URL to its origin", () => {
        // One CDN with a thousand blocked images must be ONE signature.
        expect(normalizeBlockedUri("https://cdn.example.com/a/b/c.png?x=1")).toBe("https://cdn.example.com");
        expect(normalizeBlockedUri("https://cdn.example.com/z.png")).toBe("https://cdn.example.com");
        expect(normalizeBlockedUri("wss://rt.example.com:443/socket")).toBe("wss://rt.example.com");
    });

    it("normalizeBlockedUri keeps CSP keywords and schemes without a host", () => {
        expect(normalizeBlockedUri("inline")).toBe("inline");
        expect(normalizeBlockedUri("eval")).toBe("eval");
        expect(normalizeBlockedUri("data:image/png;base64,AAAA")).toBe("data");
        expect(normalizeBlockedUri("")).toBe("unknown");
        expect(normalizeBlockedUri("not a url at all")).toBe("unknown");
        expect(normalizeBlockedUri(12345 as unknown)).toBe("unknown");
    });

    it("normalizeDocumentPath drops the query string", () => {
        // Document URLs can carry invite tokens / emails in the query.
        expect(normalizeDocumentPath("https://www.marchmeleepools.com/join/abc?e=a@b.com")).toBe("/join/abc");
        expect(normalizeDocumentPath("nonsense")).toBe("unknown");
    });

    it("signatureFor is directive + blocked origin, and is bounded", () => {
        const a = signatureFor({ directive: "img-src", blockedUri: "https://cdn.example.com", documentPath: "/x" });
        const b = signatureFor({ directive: "img-src", blockedUri: "https://cdn.example.com", documentPath: "/y" });
        // documentPath must NOT widen the signature space.
        expect(a).toBe(b);
        expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("hourKey buckets to the UTC hour", () => {
        expect(hourKey(Date.parse("2026-08-25T05:59:59.999Z"))).toBe("2026-08-25T05");
        expect(hourKey(Date.parse("2026-08-25T06:00:00.000Z"))).toBe("2026-08-25T06");
    });
});

describe("cspReport — parses both wire formats", () => {
    it("parses the legacy report-uri body (Firefox/Safari)", () => {
        const raw = JSON.stringify({
            "csp-report": {
                "document-uri": "https://www.marchmeleepools.com/pool/x?t=secret",
                "violated-directive": "script-src 'self'",
                "effective-directive": "script-src",
                "blocked-uri": "inline",
            },
        });
        expect(parseReports(raw)).toEqual([
            { directive: "script-src", blockedUri: "inline", documentPath: "/pool/x" },
        ]);
    });

    it("parses the Reporting-API batch (Chrome)", () => {
        const raw = JSON.stringify([
            {
                type: "csp-violation",
                url: "https://www.marchmeleepools.com/",
                body: {
                    effectiveDirective: "img-src",
                    blockedURL: "https://logos.example.com/a.png",
                    documentURL: "https://www.marchmeleepools.com/",
                },
            },
        ]);
        expect(parseReports(raw)).toEqual([
            { directive: "img-src", blockedUri: "https://logos.example.com", documentPath: "/" },
        ]);
    });

    it("ignores non-CSP report types in a Reporting-API batch", () => {
        // The same endpoint shape is used for deprecation/intervention reports.
        const raw = JSON.stringify([{ type: "deprecation", body: { effectiveDirective: "script-src" } }]);
        expect(parseReports(raw)).toEqual([]);
    });

    it("returns nothing for junk rather than recording a synthesised row", () => {
        for (const raw of ["", "not json", "null", "[]", "{}", '{"hello":"world"}', '"a string"']) {
            expect(parseReports(raw), raw).toEqual([]);
        }
    });

    it("the parser assertions are reachable — a camelCase-only parser fails the legacy body", () => {
        // Guards the guard: if parseReports were rewritten to read only the
        // Reporting-API key names, the legacy test above would be the only thing
        // that notices. Prove that body genuinely lacks the camel keys.
        const legacy = JSON.parse(
            '{"csp-report":{"effective-directive":"script-src","blocked-uri":"inline"}}',
        ) as Record<string, Record<string, unknown>>;
        expect(legacy["csp-report"].effectiveDirective).toBeUndefined();
        expect(legacy["csp-report"].blockedURL).toBeUndefined();
    });
});

describe("cspReport — the write budget is the cost bound", () => {
    const fresh = (): BudgetState => ({ hour: "", used: 0, dropped: 0 });

    it("allows up to the limit within one hour, then refuses", () => {
        const s = fresh();
        for (let i = 0; i < 3; i++) expect(takeWriteSlot(s, "2026-08-25T05", 3).allowed).toBe(true);
        expect(takeWriteSlot(s, "2026-08-25T05", 3).allowed).toBe(false);
        expect(takeWriteSlot(s, "2026-08-25T05", 3).allowed).toBe(false);
    });

    it("resets on a new UTC hour", () => {
        const s = fresh();
        takeWriteSlot(s, "2026-08-25T05", 1);
        expect(takeWriteSlot(s, "2026-08-25T05", 1).allowed).toBe(false);
        expect(takeWriteSlot(s, "2026-08-25T06", 1).allowed).toBe(true);
    });

    it("reports refusals to the next accepted write instead of hiding them", async () => {
        // The stored document must say it is incomplete. Silent under-counting is
        // the failure this whole area of the codebase exists to avoid.
        const s = fresh();
        const one = [{ directive: "img-src", blockedUri: "https://c.example", documentPath: "/" }];
        const seen: number[] = [];
        const ok = async (_h: string, _v: unknown, d: number) => { seen.push(d); };

        await ingest(one, "2026-08-25T05", s, ok, 1);
        expect(seen).toEqual([0]);
        takeWriteSlot(s, "2026-08-25T05", 1); // refused
        takeWriteSlot(s, "2026-08-25T05", 1); // refused
        expect(s.dropped).toBe(2);

        s.used = 0;
        await ingest(one, "2026-08-25T05", s, ok, 1);
        expect(seen).toEqual([0, 2]);
        // Consumed once the write landed, so it is not double-reported.
        expect(s.dropped).toBe(0);
    });

    it("keeps the refusal count when the write FAILS (codex r3)", async () => {
        // Clearing the counter at slot time meant a Firestore outage silently
        // erased the incompleteness signal: the next successful report would
        // store droppedCount 0 and claim the aggregate was complete.
        const s = fresh();
        const one = [{ directive: "img-src", blockedUri: "https://c.example", documentPath: "/" }];
        takeWriteSlot(s, "2026-08-25T05", 0); // refused (limit 0)
        takeWriteSlot(s, "2026-08-25T05", 0); // refused
        expect(s.dropped).toBe(2);

        s.used = 0;
        await expect(
            ingest(one, "2026-08-25T05", s, async () => { throw new Error("firestore down"); }, 1),
        ).rejects.toThrow("firestore down");
        // Still owed — AND the report whose write failed owes one too (codex r5):
        // it was accepted, never persisted, and nothing else would record that.
        expect(s.dropped).toBe(3);

        s.used = 0;
        const seen: number[] = [];
        await ingest(one, "2026-08-25T05", s, async (_h, _v, d) => { seen.push(d); }, 1);
        expect(seen).toEqual([3]);
        expect(s.dropped).toBe(0);
    });

    it("counts EVERY refused report in a batch, not just the first (codex r1)", async () => {
        // The handler used to `break` out of the batch at the first refusal, so a
        // five-report batch that exhausted the budget on report one recorded ONE
        // drop instead of five. Understating its own incompleteness is exactly the
        // failure this collector exists to avoid, so the fix gets an assertion.
        const s = fresh();
        const writes: Array<{ dropped: number }> = [];
        const batch = Array.from({ length: 5 }, () => ({
            directive: "img-src",
            blockedUri: "https://cdn.example.com",
            documentPath: "/",
        }));

        await ingest(batch, "2026-08-25T05", s, async (_h, _v, dropped) => {
            writes.push({ dropped });
        }, 1);

        expect(writes).toHaveLength(1);
        expect(writes[0].dropped).toBe(0);
        // 4 refusals recorded, not 1.
        expect(s.dropped).toBe(4);

        // ...and they surface on the next accepted write.
        s.used = 0;
        const later: number[] = [];
        await ingest(batch.slice(0, 1), "2026-08-25T05", s, async (_h, _v, d) => {
            later.push(d);
        }, 1);
        expect(later).toEqual([4]);
    });

    it("reserves the refusal count so overlapping requests cannot double-report it (codex r4)", async () => {
        // A v2 instance serves up to 80 concurrent requests off ONE module-scoped
        // budget. If the counter were only zeroed after the await, two overlapping
        // requests would both read the same pending count and both increment
        // droppedCount by it — an aggregate that overstates rather than understates.
        const s = fresh();
        const one = [{ directive: "img-src", blockedUri: "https://c.example", documentPath: "/" }];
        takeWriteSlot(s, "2026-08-25T05", 0);
        takeWriteSlot(s, "2026-08-25T05", 0);
        expect(s.dropped).toBe(2);
        s.used = 0;

        const seen: number[] = [];
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const slow = async (_h: string, _v: unknown, d: number) => { seen.push(d); await gate; };

        const a = ingest(one, "2026-08-25T05", s, slow, 5);
        const b = ingest(one, "2026-08-25T05", s, slow, 5);
        release();
        await Promise.all([a, b]);

        // Exactly one carries the debt; the other sees a clean slate.
        expect(seen).toEqual([2, 0]);
    });

    it("the declared bounds are finite and small", () => {
        // A change that removes a bound by setting it to Infinity/0 fails here
        // rather than at 3am on the billing dashboard.
        expect(MAX_WRITES_PER_HOUR).toBeGreaterThan(0);
        expect(MAX_WRITES_PER_HOUR).toBeLessThanOrEqual(1000);
        expect(MAX_SIGNATURES).toBeGreaterThan(0);
        expect(MAX_SIGNATURES).toBeLessThanOrEqual(100);
        expect(MAX_BODY_BYTES).toBeLessThanOrEqual(64 * 1024);
        expect(MAX_REPORTS_PER_REQUEST).toBeLessThanOrEqual(20);
    });
});
