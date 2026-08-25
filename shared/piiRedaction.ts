/**
 * PII redaction for the client-error telemetry path (error-tracking audit 21d).
 *
 * WHY IT LIVES IN shared/. The same redaction has to run on BOTH sides of the
 * trust boundary — in the browser before an error report leaves the tab, and in
 * `functions/src/logClientError.ts` before anything is persisted — and the two
 * builds cannot import each other (`functions/tsconfig.json` pins
 * `rootDir: "src"`; the client resolves `@shared/*` through a Vite alias).
 * `shared/` is the one directory both sides compile, via `@shared/*` on the
 * client and the predeploy `copy-shared.mjs` on the backend. Two copies of a
 * redaction regex is how one of them quietly stops matching.
 *
 * THE SERVER COPY IS THE AUTHORITATIVE ONE. The client is untrusted — anyone
 * can call `logClientError` with a hand-written payload — so the browser-side
 * pass is defence in depth (PII never leaves the device), not the control.
 *
 * WHAT THE KEY-BASED PASS ALONE MISSES, which is the whole reason the
 * pattern pass exists: `message`, `stack` and `url` are free-form strings under
 * perfectly innocent key names. A rejected fetch stringifies its request URL
 * (`...?email=kevin@example.com&token=eyJ...`), an auth error quotes the
 * account it failed for, and `window.location.href` carries whatever query
 * params the page was opened with. Redacting by key name would pass every one
 * of those straight through.
 */

/**
 * Key names whose VALUE is dropped wholesale, at any nesting depth. Kept
 * identical in spirit to `src/utils/sentrySanitize.ts` (the Sentry-bound
 * sanitizer) — call sites nest sensitive data under arbitrary keys, e.g.
 * `context: { operation: 'saveUser', user }` with `user.email` two levels down.
 */
export const SENSITIVE_KEY_RE =
    /email|password|passwd|pwd|token|secret|phone|address|ssn|card|payment|iban|routing|dob|birth|credential|authorization/i;

const MAX_DEPTH = 3;
const MAX_STRING_LEN = 500;
const MAX_ARRAY_ITEMS = 5;

/** Placeholders are distinct so a reader can tell WHAT was removed. */
const EMAIL_MASK = '[redacted-email]';
const TOKEN_MASK = '[redacted-token]';

/**
 * Strips the query string and fragment from a URL, keeping origin + path.
 *
 * Query params are where reset tokens, magic-link codes, email addresses and
 * `?token=` values live; the path is what makes the error diagnosable. Done by
 * hand rather than with `new URL()` so it works identically on a relative URL,
 * on a fragment of a URL inside a stack frame, and on a string that is not a
 * valid URL at all — all three occur in `stack`.
 */
export function stripUrlParams(url: string): string {
    const cut = Math.min(
        ...[url.indexOf('?'), url.indexOf('#')].filter((i) => i >= 0).concat([url.length]),
    );
    return url.slice(0, cut);
}

const URL_RE = /\bhttps?:\/\/[^\s"'<>)\]]+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+/g;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const GOOGLE_API_KEY_RE = /\bAIza[0-9A-Za-z_-]{20,}/g;
/**
 * `key=value` / `key: value` pairs whose KEY names a credential. The key list
 * is deliberately narrow: an earlier draft included bare `code` and `key`,
 * which redacted ordinary diagnostics like `code: POOL_NOT_FOUND` — a redactor
 * that eats the error code makes the log useless and gets turned off.
 */
const CREDENTIAL_PAIR_RE =
    /\b(api[_-]?key|apikey|access[_-]?token|id[_-]?token|refresh[_-]?token|token|secret|password|passwd|pwd|authorization|credential|otp)\b\s*[=:]\s*['"]?[A-Za-z0-9._~+/=%-]{4,}['"]?/gi;
/** Opaque high-entropy blobs (session ids, hex digests, raw keys). */
const LONG_HEX_RE = /\b[A-Fa-f0-9]{32,}\b/g;

/**
 * Sweeps a free-form string for anything that looks like PII or a credential.
 *
 * ORDER MATTERS. URLs are collapsed FIRST so a `?email=…&token=…` query string
 * is gone before the narrower patterns have to catch its pieces individually;
 * the later passes then handle the same values when they appear outside a URL.
 */
export function redactFreeText(text: string): string {
    if (!text) return text;
    return text
        .replace(URL_RE, (m) => stripUrlParams(m))
        .replace(JWT_RE, TOKEN_MASK)
        .replace(BEARER_RE, (_m, scheme: string) => `${scheme} ${TOKEN_MASK}`)
        .replace(GOOGLE_API_KEY_RE, TOKEN_MASK)
        .replace(CREDENTIAL_PAIR_RE, (m) => `${m.split(/[=:]/)[0].trim()}=${TOKEN_MASK}`)
        .replace(EMAIL_RE, EMAIL_MASK)
        .replace(LONG_HEX_RE, TOKEN_MASK);
}

/**
 * Key-based redaction + a free-text sweep of every surviving string, bounded in
 * depth, string length and array size.
 *
 * Both passes, not either: the key pass catches `{ user: { email } }` where the
 * value is not recognisable on its own, and the text pass catches the same
 * email sitting inside `{ note: 'failed for kevin@example.com' }` where the key
 * says nothing.
 */
export function redactDeep(value: unknown, depth = 0): unknown {
    if (depth > MAX_DEPTH) return '[truncated: max depth]';
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
        const redacted = redactFreeText(value);
        return redacted.length > MAX_STRING_LEN ? `${redacted.slice(0, MAX_STRING_LEN)}…` : redacted;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
        return value.slice(0, MAX_ARRAY_ITEMS).map((v) => redactDeep(v, depth + 1));
    }
    if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = SENSITIVE_KEY_RE.test(k) ? '[redacted]' : redactDeep(v, depth + 1);
        }
        return out;
    }
    return '[unsupported type]';
}

/** The shape `logClientError` accepts and persists, before redaction. */
export interface ClientErrorReport {
    message?: unknown;
    code?: unknown;
    stack?: unknown;
    url?: unknown;
    context?: unknown;
    severity?: unknown;
}

/**
 * Redacts a whole client-error report: the free-form strings by pattern, the
 * context by key AND pattern, and the URL by dropping its query and fragment
 * outright.
 *
 * Only the fields that are present come back, so callers can spread the result
 * without reintroducing `undefined` (Firestore rejects it).
 */
export function redactClientErrorReport(report: ClientErrorReport): ClientErrorReport {
    const out: ClientErrorReport = {};
    if (typeof report.message === 'string') out.message = redactFreeText(report.message);
    else if (report.message !== undefined) out.message = report.message;
    // `code` is a short machine token (e.g. `permission-denied`) — swept for
    // credentials but never structurally altered.
    if (typeof report.code === 'string') out.code = redactFreeText(report.code);
    else if (report.code !== undefined) out.code = report.code;
    if (typeof report.stack === 'string') out.stack = redactFreeText(report.stack);
    else if (report.stack !== undefined) out.stack = report.stack;
    if (typeof report.url === 'string') out.url = redactFreeText(stripUrlParams(report.url));
    else if (report.url !== undefined) out.url = report.url;
    if (report.context !== undefined) out.context = redactDeep(report.context);
    if (report.severity !== undefined) out.severity = report.severity;
    return out;
}
