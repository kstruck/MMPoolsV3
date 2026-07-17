import { describe, it, expect, vi, beforeEach } from "vitest";

const captureMessage = vi.fn();
const init = vi.fn();
vi.mock("@sentry/node", () => ({ init, captureMessage }));

describe("captureMonetizationAlert", () => {
    const prevDsn = process.env.SENTRY_DSN;

    beforeEach(() => {
        vi.resetModules();
        captureMessage.mockClear();
        init.mockClear();
    });

    it("no-ops without throwing when SENTRY_DSN is unset", async () => {
        delete process.env.SENTRY_DSN;
        const { captureMonetizationAlert } = await import("../lib/sentryServer");
        expect(() => captureMonetizationAlert("WEBHOOK_FAILED", { eventId: "evt_1" })).not.toThrow();
        expect(init).not.toHaveBeenCalled();
        expect(captureMessage).not.toHaveBeenCalled();
    });

    it("initializes once and forwards the alert when SENTRY_DSN is set", async () => {
        process.env.SENTRY_DSN = "https://fake@o0.ingest.sentry.io/0";
        const { captureMonetizationAlert } = await import("../lib/sentryServer");
        captureMonetizationAlert("DOUBLE_CHARGE_REVIEW", { poolId: "p1" });
        captureMonetizationAlert("REFUND", { chargeId: "c1" });
        expect(init).toHaveBeenCalledTimes(1);
        expect(captureMessage).toHaveBeenCalledTimes(2);
        expect(captureMessage.mock.calls[0][0]).toContain("DOUBLE_CHARGE_REVIEW");
        process.env.SENTRY_DSN = prevDsn;
    });

    it("never throws even if the Sentry SDK call itself throws", async () => {
        process.env.SENTRY_DSN = "https://fake@o0.ingest.sentry.io/0";
        captureMessage.mockImplementationOnce(() => {
            throw new Error("network down");
        });
        const { captureMonetizationAlert } = await import("../lib/sentryServer");
        expect(() => captureMonetizationAlert("PAYMENT_FAILED", {})).not.toThrow();
        process.env.SENTRY_DSN = prevDsn;
    });
});
