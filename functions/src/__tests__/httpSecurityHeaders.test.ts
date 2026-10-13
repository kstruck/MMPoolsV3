import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

/**
 * Frontend attack-surface audit, 2026-09-05 (PLAN-FRONTEND-SECURITY-AUDIT.md, PR A).
 *
 * Two findings, both confirmed live before this file existed:
 *
 *  1. The three HTML-serving Cloud Functions (`emailUnsubscribe`,
 *     `manageEmailPrefs`, `joinPreview`) answered with `content-type` and no
 *     security header at all — no frame protection, no CSP, no HSTS, no
 *     nosniff — because nginx and firebase.json only cover the hosting origins.
 *  2. `emailUnsubscribe` interpolated the `e=` query value into its 200 page
 *     unescaped. The HMAC gate does not make that value safe: a token for a
 *     hostile local-part is still a valid token.
 *
 * These tests drive the real handlers with a recording `res`, so they prove
 * the fix on the deployable code path rather than on a helper in isolation,
 * and they cover the ERROR branches (403) as well as the 200 — a header set
 * only on the success path is the shape of gap the audit found.
 */

// ── Module stubs ──────────────────────────────────────────────────────────
// The handlers read the unsubscribe secret from `config/internal` and write
// `email_optouts/{hash}`; joinPreview resolves pools. All three call
// admin.firestore() (joinPreview at module load), so the SDK is stubbed before
// import, same shape as adminHealthAiVolume.test.ts.

// vi.mock factories are hoisted above the static imports, and joinPreview calls
// admin.firestore() at module load — so everything the factory reaches must be
// hoisted with it (codex r1). Same pattern as entitlements.test.ts.
const h = vi.hoisted(() => {
    const SECRET = "unit-test-secret";
    const writes: Array<{ path: string; data: unknown }> = [];
    const poolDocs: Record<string, { name?: string; type?: string } | undefined> = {};
    function fakeDb() {
        const docRef = (path: string) => ({
            get: async () => {
                if (path === "config/internal") return { exists: true, data: () => ({ emailUnsubSecret: SECRET }) };
                const id = path.split("/").pop() as string;
                const d = poolDocs[id];
                return { exists: !!d, data: () => d };
            },
            set: async (data: unknown) => { writes.push({ path, data }); },
        });
        return {
            doc: (path: string) => docRef(path),
            collection: (name: string) => ({
                doc: (id: string) => docRef(`${name}/${id}`),
                where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
            }),
        };
    }
    return { SECRET, writes, poolDocs, fakeDb };
});
const { SECRET, writes, poolDocs } = h;

vi.mock("firebase-admin", () => {
    const firestore = () => h.fakeDb();
    return { default: { firestore, apps: [], initializeApp: () => undefined }, firestore };
});
vi.mock("firebase-admin/firestore", () => ({
    FieldValue: { serverTimestamp: () => "SERVER_TS" },
}));
import { emailUnsubscribe } from "../emailUnsubscribeHttp";
import { manageEmailPrefs } from "../emailPrefsPage";
import { joinPreview } from "../joinPreview";
// The announcement body builder lives in a dependency-light helper module so
// no internal module (reminders, squarePrivate) has to be mocked to test it.
import { buildAnnouncementBody } from "../announcements.helpers";
import { renderEmailHtml, escapeHtml } from "../emailStyles";
import {
    setSecurityHeaders,
    COMMON_SECURITY_HEADERS,
    PAGE_CSP,
    SITE_CSP,
    SITE_REPORTING_ENDPOINTS,
} from "../lib/httpHeaders";

// ── Recording response ────────────────────────────────────────────────────

function makeRes() {
    const headers: Record<string, string> = {};
    const r = {
        statusCode: 0,
        body: "",
        redirectedTo: "",
        set(name: string, value: string) { headers[name.toLowerCase()] = value; return r; },
        status(code: number) { r.statusCode = code; return r; },
        send(body: string) { r.body = body; return r; },
        redirect(code: number, url: string) { r.statusCode = code; r.redirectedTo = url; return r; },
        headers,
    };
    return r;
}

type Req = { method: string; query?: Record<string, string>; body?: Record<string, string>; headers?: Record<string, string>; path?: string };
// firebase-functions' onRequest returns the handler itself (with deploy
// metadata attached); no cors option is set on these three, so no middleware
// wraps it and a plain req/res pair drives it directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (fn: any, req: Req, res = makeRes()) => { await fn({ headers: {}, query: {}, body: {}, path: "/", ...req }, res); return res; };

const sign = (email: string) => createHmac("sha256", SECRET).update(email.trim().toLowerCase()).digest("hex").slice(0, 32);

// The audit's reproduction: a local-part that is a script, with a VALID token.
const HOSTILE = '"<img src=x onerror=alert(1)>"@example.test';

function expectCommonHeaders(res: ReturnType<typeof makeRes>) {
    for (const [name, value] of Object.entries(COMMON_SECURITY_HEADERS)) {
        expect(res.headers[name.toLowerCase()], name).toBe(value);
    }
}

beforeEach(() => {
    vi.clearAllMocks();
    writes.length = 0;
    for (const k of Object.keys(poolDocs)) delete poolDocs[k];
});

// ── The helper ────────────────────────────────────────────────────────────

describe("setSecurityHeaders", () => {
    it("page profile: every common header plus the strict no-script CSP", () => {
        const res = makeRes();
        setSecurityHeaders(res, "page");
        expectCommonHeaders(res);
        expect(res.headers["content-security-policy"]).toBe(PAGE_CSP);
        expect(res.headers["reporting-endpoints"]).toBeUndefined();
    });

    it("spa profile: the SITE policy, with the reporting group it names", () => {
        const res = makeRes();
        setSecurityHeaders(res, "spa");
        expectCommonHeaders(res);
        expect(res.headers["content-security-policy"]).toBe(SITE_CSP);
        expect(res.headers["reporting-endpoints"]).toBe(SITE_REPORTING_ENDPOINTS);
    });

    it("the page CSP allows no script source at all and forbids framing", () => {
        // default-src 'none' with no script-src means script execution is
        // refused everywhere, inline or external. This is the layer under the
        // escaping fix: even a missed interpolation cannot run.
        expect(PAGE_CSP).toMatch(/^default-src 'none';/);
        expect(PAGE_CSP).not.toContain("script-src");
        expect(PAGE_CSP).toContain("frame-ancestors 'none'");
        // The prefs form POSTs to itself; anything else is a redirect target
        // an injected <form> could aim at.
        expect(PAGE_CSP).toContain("form-action 'self'");
    });

    it("common set carries the four headers the audit checked, plus DENY", () => {
        expect(COMMON_SECURITY_HEADERS["Strict-Transport-Security"]).toMatch(/^max-age=\d+; includeSubDomains$/);
        expect(COMMON_SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
        expect(COMMON_SECURITY_HEADERS["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
        expect(COMMON_SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
        expect(COMMON_SECURITY_HEADERS["X-XSS-Protection"]).toBe("0");
    });
});

// ── emailUnsubscribe ──────────────────────────────────────────────────────

describe("emailUnsubscribe", () => {
    it("escapes the email in the 200 page (the audit's reproduction)", async () => {
        const res = await call(emailUnsubscribe, { method: "GET", query: { e: HOSTILE, t: sign(HOSTILE) } });
        expect(res.statusCode).toBe(200);
        expect(res.body).not.toContain("<img");
        expect(res.body).toContain("&lt;img src=x onerror=alert(1)&gt;");
        // The opt-out itself still happened — escaping changed rendering, not behaviour.
        expect(writes).toHaveLength(1);
        expect(writes[0].path).toMatch(/^email_optouts\//);
    });

    it("the reproduction is real — the pre-fix template rendered the tag", () => {
        // Guards against the assertion above passing vacuously: the exact
        // pre-fix interpolation (`${email}`) must produce the live tag.
        const preFix = `<p>${HOSTILE.toLowerCase()} will no longer receive emails</p>`;
        expect(preFix).toContain("<img src=x onerror=alert(1)>");
    });

    it.each([
        ["200 success", { method: "GET", query: { e: "a@b.test", t: sign("a@b.test") } }, 200],
        ["403 bad token", { method: "GET", query: { e: "a@b.test", t: "nope" } }, 403],
        ["400 malformed", { method: "GET", query: { e: "not-an-email", t: "x" } }, 400],
        ["405 wrong method", { method: "POST" }, 405],
    ] as const)("%s carries the full header set", async (_label, req, status) => {
        const res = await call(emailUnsubscribe, req as Req);
        expect(res.statusCode).toBe(status);
        expectCommonHeaders(res);
        expect(res.headers["content-security-policy"]).toBe(PAGE_CSP);
    });
});

// ── manageEmailPrefs ──────────────────────────────────────────────────────

describe("manageEmailPrefs", () => {
    it.each([
        ["200 form", { method: "GET", query: { e: "a@b.test", t: sign("a@b.test") } }, 200],
        ["403 bad token", { method: "GET", query: { e: "a@b.test", t: "nope" } }, 403],
        ["400 malformed", { method: "GET", query: { e: "x", t: "y" } }, 400],
        ["405 wrong method", { method: "PUT", query: { e: "a@b.test", t: sign("a@b.test") } }, 405],
    ] as const)("%s carries the full header set", async (_label, req, status) => {
        const res = await call(manageEmailPrefs, req as Req);
        expect(res.statusCode).toBe(status);
        expectCommonHeaders(res);
        expect(res.headers["content-security-policy"]).toBe(PAGE_CSP);
    });

    it("keeps escaping the email in the form and result pages", async () => {
        const form = await call(manageEmailPrefs, { method: "GET", query: { e: HOSTILE, t: sign(HOSTILE) } });
        expect(form.statusCode).toBe(200);
        expect(form.body).not.toContain("<img");
        const saved = await call(manageEmailPrefs, { method: "POST", body: { e: HOSTILE, t: sign(HOSTILE), all: "on" } });
        expect(saved.statusCode).toBe(200);
        expect(saved.body).not.toContain("<img");
    });
});

// ── joinPreview ───────────────────────────────────────────────────────────

describe("joinPreview", () => {
    const CRAWLER = { "user-agent": "facebookexternalhit/1.1" };

    it("crawler preview: page profile, and the pool name is escaped", async () => {
        poolDocs["p1"] = { name: '<script>alert(1)</script>', type: "SQUARES" };
        const res = await call(joinPreview, { method: "GET", path: "/join/p1", headers: CRAWLER });
        expect(res.statusCode).toBe(200);
        expectCommonHeaders(res);
        expect(res.headers["content-security-policy"]).toBe(PAGE_CSP);
        expect(res.body).not.toContain("<script>");
        expect(res.body).toContain("&lt;script&gt;");
    });

    it("405 carries the header set too", async () => {
        const res = await call(joinPreview, { method: "POST", path: "/join/p1" });
        expect(res.statusCode).toBe(405);
        expectCommonHeaders(res);
    });

    it("human path: the SPA shell runs under the SITE policy, never the strict one", async () => {
        // The shell is fetched from the hosting origin; stub fetch so the test
        // has no network. What matters is the policy on the response.
        const realFetch = globalThis.fetch;
        globalThis.fetch = (async () => ({ text: async () => "<!doctype html><html><body>SPA</body></html>" })) as unknown as typeof fetch;
        try {
            const res = await call(joinPreview, { method: "GET", path: "/join/p1", headers: { "user-agent": "Mozilla/5.0", host: "www.marchmeleepools.com" } });
            expect(res.statusCode).toBe(200);
            expect(res.body).toContain("SPA");
            expectCommonHeaders(res);
            expect(res.headers["content-security-policy"]).toBe(SITE_CSP);
            expect(res.headers["reporting-endpoints"]).toBe(SITE_REPORTING_ENDPOINTS);
        } finally {
            globalThis.fetch = realFetch;
        }
    });
});

// ── Email templates ───────────────────────────────────────────────────────

describe("email templates escape commissioner- and user-typed text", () => {
    it("announcement body escapes pool name and message", () => {
        const html = buildAnnouncementBody('Pool <b>"X"</b>', '<a href="https://evil.test">click</a>\nline 2');
        expect(html).not.toContain("<b>");
        expect(html).not.toContain("<a href");
        expect(html).toContain("Pool &lt;b&gt;&quot;X&quot;&lt;/b&gt;");
        expect(html).toContain("&lt;a href=&quot;https://evil.test&quot;&gt;click&lt;/a&gt;");
        // pre-wrap keeps the raw newline; no <br> is injected.
        expect(html).toContain("click&lt;/a&gt;\nline 2");
    });

    it("renderEmailHtml escapes its title (announcement subjects land here)", () => {
        const html = renderEmailHtml('<img src=x onerror=alert(1)> & co', "<p>body</p>");
        // (The shell's own logo is a legitimate <img>; the injected one is not.)
        expect(html).not.toContain("<img src=x");
        expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; co");
        // Body is HTML by contract and passes through untouched.
        expect(html).toContain("<p>body</p>");
    });

    it("escapeHtml covers the five HTML metacharacters", () => {
        expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#039;");
        expect(escapeHtml("")).toBe("");
    });

    it("a title escaped once renders single-encoded — the confirmPayment regression", () => {
        // renderEmailHtml owns title escaping. A caller that escapes first
        // double-encodes: `Smith & Sons` would print `Smith &amp; Sons` to the
        // host (qodo on #671, confirmPayment.ts). The renderer must not be
        // "fixed" by skipping escaping; the CALLER must pass plain text.
        const html = renderEmailHtml("Payment Confirmation from Smith & Sons <Jr>", "<p>x</p>");
        expect(html).toContain("Payment Confirmation from Smith &amp; Sons &lt;Jr&gt;");
        expect(html).not.toContain("&amp;amp;");
        // The repo-wide source guard for this class lives with the other
        // functions/src invariants: httpSurfaceInvariants.test.ts.
    });
});
