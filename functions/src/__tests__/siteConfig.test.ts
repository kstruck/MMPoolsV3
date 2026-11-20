// PLAN-AUTO-DEPLOY Phase 1a: the site origin and project id are per-environment,
// and PRODUCTION'S VALUES MUST BE EXACTLY THE LITERALS THEY REPLACED.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    PRODUCTION_PROJECT_ID,
    PRODUCTION_SITE_ORIGIN,
    resolveProjectId,
    resolveSiteIdentity,
    resolveSiteOrigin,
} from "../lib/siteConfig";

describe("resolveSiteOrigin", () => {
    it("defaults to production's literal origin when unset or blank", () => {
        expect(PRODUCTION_SITE_ORIGIN).toBe("https://www.marchmeleepools.com");
        expect(resolveSiteOrigin(undefined)).toBe("https://www.marchmeleepools.com");
        expect(resolveSiteOrigin("")).toBe("https://www.marchmeleepools.com");
        expect(resolveSiteOrigin("   ")).toBe("https://www.marchmeleepools.com");
    });

    it("accepts a bare https origin and normalises a trailing slash", () => {
        expect(resolveSiteOrigin("https://staging.example.com")).toBe("https://staging.example.com");
        expect(resolveSiteOrigin("https://staging.example.com/")).toBe("https://staging.example.com");
        expect(resolveSiteOrigin(" https://Staging.Example.com:8443 ")).toBe("https://staging.example.com:8443");
    });

    it("accepts http only for localhost", () => {
        expect(resolveSiteOrigin("http://localhost:5173")).toBe("http://localhost:5173");
        expect(() => resolveSiteOrigin("http://staging.example.com")).toThrow(/https/);
    });

    it.each([
        "staging.example.com",
        "https://staging.example.com/app",
        "https://staging.example.com/?x=1",
        "https://staging.example.com/#x",
        "https://user:pw@staging.example.com",
        "javascript:alert(1)",
        "ftp://staging.example.com",
    ])("refuses %s rather than building links from it", (raw) => {
        expect(() => resolveSiteOrigin(raw)).toThrow(/MMP_SITE_ORIGIN/);
    });
});

describe("resolveProjectId", () => {
    it("defaults to production's literal project id when unset or blank", () => {
        expect(PRODUCTION_PROJECT_ID).toBe("gridiron-gamble-uzuqo");
        expect(resolveProjectId(undefined)).toBe("gridiron-gamble-uzuqo");
        expect(resolveProjectId("")).toBe("gridiron-gamble-uzuqo");
    });

    it("passes a valid project id through", () => {
        expect(resolveProjectId("gridiron-gamble-uzuqo")).toBe("gridiron-gamble-uzuqo");
        expect(resolveProjectId("mmp-staging")).toBe("mmp-staging");
        expect(resolveProjectId("demo-mmp")).toBe("demo-mmp");
    });

    it.each(["Upper-Case", "a", "ends-with-", "has.dot", "x".repeat(31), "evil.com/#"])(
        "refuses %s rather than putting it in a hostname",
        (raw) => {
            expect(() => resolveProjectId(raw)).toThrow(/GCLOUD_PROJECT/);
        },
    );
});

describe("resolveSiteIdentity: origin and project must agree (qodo #1 on #796)", () => {
    const PROD = "https://www.marchmeleepools.com";

    it("production with nothing set is production", () => {
        expect(resolveSiteIdentity({})).toEqual({ origin: PROD, projectId: "gridiron-gamble-uzuqo" });
        expect(resolveSiteIdentity({ GCLOUD_PROJECT: "gridiron-gamble-uzuqo" })).toEqual({ origin: PROD, projectId: "gridiron-gamble-uzuqo" });
        expect(resolveSiteIdentity({ GCLOUD_PROJECT: "gridiron-gamble-uzuqo", MMP_SITE_ORIGIN: PROD })).toEqual({ origin: PROD, projectId: "gridiron-gamble-uzuqo" });
    });

    it("a staging project with its own origin is accepted", () => {
        expect(resolveSiteIdentity({ GCLOUD_PROJECT: "mmp-staging", MMP_SITE_ORIGIN: "https://staging.example.com" }))
            .toEqual({ origin: "https://staging.example.com", projectId: "mmp-staging" });
    });

    it.each([
        ["unset", undefined],
        ["blank", "  "],
        ["production's origin", PROD],
    ])("a real non-production project with the origin %s fails instead of linking to production", (_l, origin) => {
        expect(() => resolveSiteIdentity({ GCLOUD_PROJECT: "mmp-staging", MMP_SITE_ORIGIN: origin }))
            .toThrow(/not production: set MMP_SITE_ORIGIN/);
    });

    it("production's project with a non-production origin fails", () => {
        expect(() => resolveSiteIdentity({ GCLOUD_PROJECT: "gridiron-gamble-uzuqo", MMP_SITE_ORIGIN: "https://staging.example.com" }))
            .toThrow(/production's project/);
        // Unset GCLOUD_PROJECT resolves to production, so the same holds.
        expect(() => resolveSiteIdentity({ MMP_SITE_ORIGIN: "https://staging.example.com" })).toThrow(/production's project/);
    });

    it("the emulator and demo-* projects may use either origin", () => {
        expect(resolveSiteIdentity({ GCLOUD_PROJECT: "demo-mmp" }).origin).toBe(PROD);
        expect(resolveSiteIdentity({ GCLOUD_PROJECT: "mmp-staging", FUNCTIONS_EMULATOR: "true" }).origin).toBe(PROD);
        expect(resolveSiteIdentity({ GCLOUD_PROJECT: "demo-mmp", MMP_SITE_ORIGIN: "http://localhost:5173" }).origin).toBe("http://localhost:5173");
    });
});

describe("module-level values", () => {
    const saved = { origin: process.env.MMP_SITE_ORIGIN, project: process.env.GCLOUD_PROJECT, emu: process.env.FUNCTIONS_EMULATOR };
    afterEach(() => {
        if (saved.origin === undefined) delete process.env.MMP_SITE_ORIGIN;
        else process.env.MMP_SITE_ORIGIN = saved.origin;
        if (saved.project === undefined) delete process.env.GCLOUD_PROJECT;
        else process.env.GCLOUD_PROJECT = saved.project;
        if (saved.emu === undefined) delete process.env.FUNCTIONS_EMULATOR;
        else process.env.FUNCTIONS_EMULATOR = saved.emu;
        vi.resetModules();
    });

    it("production (nothing set) reproduces every literal the module replaced", async () => {
        delete process.env.MMP_SITE_ORIGIN;
        delete process.env.FUNCTIONS_EMULATOR;
        process.env.GCLOUD_PROJECT = "gridiron-gamble-uzuqo";
        vi.resetModules();
        const m = await import("../lib/siteConfig");
        expect(m.SITE_ORIGIN).toBe("https://www.marchmeleepools.com");
        expect(m.SITE_HOST).toBe("www.marchmeleepools.com");
        expect(m.SITE_DISPLAY_HOST).toBe("marchmeleepools.com");
        expect(m.PROJECT_ID).toBe("gridiron-gamble-uzuqo");
    });

    it("a staging project takes its own values", async () => {
        delete process.env.FUNCTIONS_EMULATOR;
        process.env.MMP_SITE_ORIGIN = "https://staging.example.com";
        process.env.GCLOUD_PROJECT = "mmp-staging";
        vi.resetModules();
        const m = await import("../lib/siteConfig");
        expect(m.SITE_ORIGIN).toBe("https://staging.example.com");
        expect(m.SITE_HOST).toBe("staging.example.com");
        expect(m.SITE_DISPLAY_HOST).toBe("staging.example.com");
        expect(m.PROJECT_ID).toBe("mmp-staging");
    });

    it("email links and the join preview follow the configured origin", async () => {
        process.env.MMP_SITE_ORIGIN = "https://staging.example.com";
        process.env.GCLOUD_PROJECT = "mmp-staging";
        vi.resetModules();
        const helpers = await import("../joinPreview.helpers");
        expect(helpers.SITE).toBe("https://staging.example.com");
        expect(helpers.DEFAULT_IMG).toBe("https://staging.example.com/og-image.png");
    });

    it("a malformed origin fails at load instead of falling back to production", async () => {
        process.env.MMP_SITE_ORIGIN = "staging.example.com";
        vi.resetModules();
        await expect(import("../lib/siteConfig")).rejects.toThrow(/MMP_SITE_ORIGIN/);
    });
});
