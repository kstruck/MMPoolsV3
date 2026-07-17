import { describe, it, expect } from "vitest";
import { extractCorrelationId, traceLogFields } from "../lib/correlationId";

describe("extractCorrelationId", () => {
    it("extracts a well-formed uuid and strips it from rest", () => {
        const out = extractCorrelationId({ poolId: "p1", _correlationId: "abc-123_XYZ" });
        expect(out.correlationId).toBe("abc-123_XYZ");
        expect(out.rest).toEqual({ poolId: "p1" });
    });

    it("leaves data untouched (same reference) when no correlation key present", () => {
        const data = { poolId: "p1" };
        const out = extractCorrelationId(data);
        expect(out.correlationId).toBeUndefined();
        expect(out.rest).toBe(data);
    });

    it("strips a malformed correlation id without trusting it", () => {
        const out = extractCorrelationId({ poolId: "p1", _correlationId: "<script>evil</script>" });
        expect(out.correlationId).toBeUndefined();
        expect(out.rest).toEqual({ poolId: "p1" });
    });

    it("handles non-object data (primitives, null, arrays)", () => {
        expect(extractCorrelationId(null).rest).toBeNull();
        expect(extractCorrelationId("hello").rest).toBe("hello");
        expect(extractCorrelationId([1, 2]).rest).toEqual([1, 2]);
        expect(extractCorrelationId(undefined).rest).toBeUndefined();
    });

    it("does not choke on an oversized value — regex bounds length", () => {
        const long = "a".repeat(100);
        const out = extractCorrelationId({ _correlationId: long });
        expect(out.correlationId).toBeUndefined();
        expect(out.rest).toEqual({});
    });
});

describe("traceLogFields", () => {
    it("includes correlationId + endpoint always", () => {
        const fields = traceLogFields("abc-123", "myCallable");
        expect(fields.correlationId).toBe("abc-123");
        expect(fields.endpoint).toBe("myCallable");
    });

    it("builds the Cloud Logging trace resource path when a project id is set", () => {
        const prev = process.env.GCLOUD_PROJECT;
        process.env.GCLOUD_PROJECT = "demo-mmp";
        try {
            const fields = traceLogFields("abc-123", "myCallable");
            expect(fields["logging.googleapis.com/trace"]).toBe("projects/demo-mmp/traces/abc-123");
        } finally {
            if (prev === undefined) delete process.env.GCLOUD_PROJECT;
            else process.env.GCLOUD_PROJECT = prev;
        }
    });

    it("omits the trace field when no project id is resolvable", () => {
        const prevA = process.env.GCLOUD_PROJECT;
        const prevB = process.env.GOOGLE_CLOUD_PROJECT;
        delete process.env.GCLOUD_PROJECT;
        delete process.env.GOOGLE_CLOUD_PROJECT;
        try {
            const fields = traceLogFields("abc-123", "myCallable");
            expect(fields["logging.googleapis.com/trace"]).toBeUndefined();
        } finally {
            if (prevA !== undefined) process.env.GCLOUD_PROJECT = prevA;
            if (prevB !== undefined) process.env.GOOGLE_CLOUD_PROJECT = prevB;
        }
    });
});
