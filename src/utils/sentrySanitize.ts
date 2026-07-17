/**
 * Pure Sentry-context sanitizer — deliberately imports nothing (no firebase,
 * no app modules) so it stays unit-testable without booting the app, mirroring
 * functions/src/lib/zodHelpers.ts's convention on the backend.
 *
 * Sentry is a third party — context sent there is a stricter privacy boundary
 * than the Firestore/logClientError path (which already caps/stringifies
 * server-side, functions/src/logClientError.ts). Redacts by key name at any
 * depth (call sites nest sensitive data under arbitrary keys, e.g.
 * `context: { operation: 'saveUser', user }` where `user.email` is 2 levels
 * deep) and bounds size/depth/array length as a belt-and-suspenders cap.
 */

const SENSITIVE_KEY_RE = /email|password|token|secret|phone|address|ssn|card|payment|iban|routing|dob|birth/i;
const MAX_DEPTH = 3;
const MAX_STRING_LEN = 200;
const MAX_ARRAY_ITEMS = 5;
const MAX_JSON_LEN = 2000;

function sanitizeValue(value: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH) return '[truncated: max depth]';
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
        return value.length > MAX_STRING_LEN ? `${value.slice(0, MAX_STRING_LEN)}…` : value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
        return value.slice(0, MAX_ARRAY_ITEMS).map((v) => sanitizeValue(v, depth + 1));
    }
    if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = SENSITIVE_KEY_RE.test(k) ? '[redacted]' : sanitizeValue(v, depth + 1);
        }
        return out;
    }
    return '[unsupported type]';
}

/** Sanitizes context before it leaves the app to Sentry. */
export function sanitizeForSentry(context: Record<string, unknown>): Record<string, unknown> {
    const sanitized = sanitizeValue(context, 0) as Record<string, unknown>;
    const json = JSON.stringify(sanitized);
    if (json.length <= MAX_JSON_LEN) return sanitized;
    return { note: '[context too large — omitted]', originalSize: json.length };
}
