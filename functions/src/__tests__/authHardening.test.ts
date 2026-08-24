import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bracketSettingsSchema, bracketCreateInputSchema } from "../shared/schemas/bracket";
import { noticeAllowed, NOTICE_COOLDOWN_MS } from "../securityNotices";

/** PLAN-AUDIT-AUTH-HARDENING Phase A pins. */
const SRC = join(__dirname, "..");

describe("A2: bracket settings schema is strict", () => {
    it("rejects unknown settings keys (they used to ride the spread onto the pool doc)", () => {
        const r = bracketSettingsSchema.safeParse({ entryFee: 10, isLocked: true });
        expect(r.success).toBe(false);
    });

    it("accepts the full known field set, paymentHandles included", () => {
        const r = bracketCreateInputSchema.safeParse({
            name: "Test",
            seasonYear: 2027,
            settings: {
                maxEntriesTotal: 10,
                entryFee: 5,
                paymentInstructions: "venmo me",
                paymentHandles: { venmo: "@k" },
                scoringSystem: "CLASSIC",
                tieBreakers: { closestAbsolute: true },
                payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
            },
        });
        expect(r.success).toBe(true);
    });

    it("the handler no longer spreads raw settings into the pool doc", () => {
        const text = readFileSync(join(SRC, "bracketPools.ts"), "utf8");
        expect(text).not.toMatch(/\.\.\.settings,/);
    });
});

describe("A1: no claim-only SUPER_ADMIN checks remain in the two flagged files", () => {
    it.each(["siteAverages.ts", "expertProfiles.ts"])("%s uses assertCallerRole", (f) => {
        const text = readFileSync(join(SRC, f), "utf8");
        expect(text).toContain("assertCallerRole(request");
        expect(text).not.toMatch(/token\??\.role !== ['"]SUPER_ADMIN['"]/);
    });
});

describe("A3: password-reset notice rate limit", () => {
    const NOW = 1_000_000_000_000;
    it("first notice is allowed", () => {
        expect(noticeAllowed(undefined, NOW)).toBe(true);
    });
    it("a second notice inside the cooldown is refused", () => {
        expect(noticeAllowed(NOW - NOTICE_COOLDOWN_MS + 1, NOW)).toBe(false);
    });
    it("a notice after the cooldown is allowed", () => {
        expect(noticeAllowed(NOW - NOTICE_COOLDOWN_MS, NOW)).toBe(true);
    });
    it("the notice send is transactional (bypasses marketing opt-out — codex r1 P1)", () => {
        const text = readFileSync(join(SRC, "securityNotices.ts"), "utf8");
        expect(text).toMatch(/sendEmail\([^;]*transactional: true/);
    });

    it("the notice copy contains no links", () => {
        const text = readFileSync(join(SRC, "securityNotices.ts"), "utf8");
        const html = text.slice(text.indexOf("NOTICE_HTML"), text.indexOf("notifyPasswordReset ="));
        expect(html).not.toMatch(/https?:\/\//);
        expect(html).not.toContain("<a ");
    });
});
