import { describe, it, expect } from "vitest";
import {
    decideEventClaim,
    shouldAlertOnFailure,
    WEBHOOK_STALE_MS,
    WEBHOOK_ALERT_ATTEMPT_THRESHOLD,
    type WebhookEventDoc,
} from "../lib/webhookDurability";

const NOW = 1_700_000_000_000;

describe("decideEventClaim", () => {
    it("reclaims a raced/missing doc (create lost to a concurrent delete)", () => {
        expect(decideEventClaim(undefined, NOW)).toEqual({ take: true, reason: "no-doc" });
    });

    it("NEVER reclaims a completed event — that is a genuine Stripe duplicate", () => {
        const doc: WebhookEventDoc = { status: "completed", startedAt: NOW - WEBHOOK_STALE_MS * 10 };
        expect(decideEventClaim(doc, NOW)).toEqual({ take: false, reason: "completed" });
    });

    it("reclaims a failed event so Stripe's retry is reprocessed, not dropped", () => {
        // This is the core regression guard: failed docs used to be DELETED, so
        // the retry hit create() cleanly. Now they persist, so the retry MUST be
        // re-claimed here or it silently returns 'duplicate' and never runs.
        const doc: WebhookEventDoc = { status: "failed", attemptCount: 2, startedAt: NOW - 1000 };
        expect(decideEventClaim(doc, NOW)).toEqual({ take: true, reason: "failed-retry" });
    });

    it("takes over a stale processing doc (a prior invocation died mid-flight)", () => {
        const doc: WebhookEventDoc = { status: "processing", startedAt: NOW - WEBHOOK_STALE_MS - 1 };
        expect(decideEventClaim(doc, NOW)).toEqual({ take: true, reason: "stale-takeover" });
    });

    it("skips a fresh processing doc (a concurrent invocation owns it)", () => {
        const doc: WebhookEventDoc = { status: "processing", startedAt: NOW - 1000 };
        expect(decideEventClaim(doc, NOW)).toEqual({ take: false, reason: "concurrent" });
    });

    it("treats a processing doc with no startedAt as stale (epoch 0)", () => {
        expect(decideEventClaim({ status: "processing" }, NOW).take).toBe(true);
    });
});

describe("shouldAlertOnFailure", () => {
    it("stays quiet below the threshold (no alert on the first retries)", () => {
        expect(shouldAlertOnFailure(1)).toBe(false);
        expect(shouldAlertOnFailure(WEBHOOK_ALERT_ATTEMPT_THRESHOLD - 1)).toBe(false);
    });

    it("fires EXACTLY on the threshold attempt — not before, not after", () => {
        // === not >=: later retries must not re-write the alert doc (qodo PR #166).
        expect(shouldAlertOnFailure(WEBHOOK_ALERT_ATTEMPT_THRESHOLD)).toBe(true);
        expect(shouldAlertOnFailure(WEBHOOK_ALERT_ATTEMPT_THRESHOLD + 1)).toBe(false);
        expect(shouldAlertOnFailure(WEBHOOK_ALERT_ATTEMPT_THRESHOLD + 5)).toBe(false);
    });

    it("honours a caller-supplied threshold", () => {
        expect(shouldAlertOnFailure(1, 1)).toBe(true);
        expect(shouldAlertOnFailure(2, 1)).toBe(false);
        expect(shouldAlertOnFailure(1, 2)).toBe(false);
    });
});
