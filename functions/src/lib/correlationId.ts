/**
 * Correlation id extraction + Cloud Logging trace echo (PLAN-SECURITY-OBSERVABILITY.md #9).
 *
 * Firebase's `httpsCallable` transport cannot forward custom `sentry-trace`/
 * `baggage` headers, so FE<->BE stitching for callable traffic uses a
 * client-generated correlation id carried in the callable DATA payload
 * instead — NOT a header. Because Phase 1 gave many callables `.strict()`
 * zod schemas (unknown keys rejected), the id must be stripped out of
 * `request.data` BEFORE schema validation runs, or every strict callable
 * would start rejecting real client calls the moment the FE started sending
 * this field. `validated()` is the single choke point that does the strip,
 * so no per-schema change is needed anywhere.
 */

const CORRELATION_KEY = "_correlationId";
// Client sends crypto.randomUUID() (hyphenated) or a short fallback — bound
// the shape so a malformed/hostile value can never land in a GCP resource
// path (the trace field below) or blow up log volume.
const CORRELATION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface CorrelationExtraction {
    /** Present + well-formed only when the client actually sent one. */
    correlationId?: string;
    /** `data` with `_correlationId` removed (same reference if nothing changed). */
    rest: unknown;
}

export function extractCorrelationId(data: unknown): CorrelationExtraction {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return { rest: data };
    }
    const obj = data as Record<string, unknown>;
    if (!(CORRELATION_KEY in obj)) {
        return { rest: data };
    }
    const raw = obj[CORRELATION_KEY];
    const { [CORRELATION_KEY]: _drop, ...rest } = obj;
    if (typeof raw === "string" && CORRELATION_ID_RE.test(raw)) {
        return { correlationId: raw, rest };
    }
    // Malformed value — still strip the key so schema validation doesn't see
    // it, but don't trust it as a correlation id.
    return { rest };
}

/**
 * Structured-log fields for this call. `logging.googleapis.com/trace` is a
 * Cloud Logging convention (not real Cloud Trace spans — no OTel here per
 * plan scope): Logs Explorer groups/filters on it, giving the "<60s trace"
 * lookup the plan calls for without a collector.
 */
export function traceLogFields(correlationId: string, label: string): Record<string, unknown> {
    const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
    const fields: Record<string, unknown> = { correlationId, endpoint: label };
    if (project) {
        fields["logging.googleapis.com/trace"] = `projects/${project}/traces/${correlationId}`;
    }
    return fields;
}
