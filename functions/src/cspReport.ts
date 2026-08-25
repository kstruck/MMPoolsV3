import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

/**
 * CSP violation collector — the ACTUAL endpoint behind the `report-uri` /
 * `report-to` directives in the four copies of the Content-Security-Policy
 * (nginx.conf ×3, firebase.json ×1).
 *
 * WHY THIS EXISTS. A `report-to csp-endpoint` directive with no matching
 * `Reporting-Endpoints` header — and no collector at the other end of it —
 * discards every report silently, which is indistinguishable from a policy
 * with no violations. That is the same failure shape as the thirteen days of
 * silently-refused Sentry traffic recorded in tests/csp-invariants.test.ts: the
 * absence of reports read as health. The CSP cannot be tightened (dropping
 * `'unsafe-inline'` from script-src) until there is real data about what the
 * live site actually violates, and there is no data without a sink.
 *
 * ── TRUST BOUNDARY ────────────────────────────────────────────────────────
 * This endpoint is UNAUTHENTICATED AND UNAUTHENTICATABLE. Browsers post CSP
 * reports with no credentials, no App Check token, and no Origin the endpoint
 * can trust, so anyone on the internet can POST anything here. It is therefore
 * built as a bounded counter, never as a log of what the caller said:
 *
 *  1. ONE DOCUMENT PER UTC HOUR. Every report folds into
 *     `system_logs/csp-violations-<YYYY-MM-DDTHH>`. Ceiling: 24 documents/day,
 *     forever, regardless of traffic. An attacker cannot create documents.
 *  2. BOUNDED DOCUMENT SIZE. At most MAX_SIGNATURES distinct violation
 *     signatures are stored per hour document; past that, further distinct
 *     signatures only bump `overflowCount`. A signature is
 *     `<directive>|<blocked origin>`, normalized and sanitized to
 *     `[A-Za-z0-9_-]` and length-capped — attacker-supplied text is never
 *     stored verbatim and never becomes a Firestore field path.
 *  3. BOUNDED WRITE RATE. Each instance accepts at most MAX_WRITES_PER_HOUR
 *     Firestore transactions per UTC hour; `maxInstances: 2` caps the fleet, so
 *     the whole endpoint can perform at most 2 × 120 = 240 writes/hour no
 *     matter how hard it is hit. Refused reports are counted in memory and the
 *     count is folded into the next accepted write as `droppedCount`, so the
 *     data says it is incomplete rather than quietly under-reporting.
 *  4. BOUNDED INPUT. Bodies over MAX_BODY_BYTES are dropped unparsed, and at
 *     most MAX_REPORTS_PER_REQUEST reports are taken from any one request.
 *  5. NEVER THROWS AT THE CALLER, always answers 204. A collector that returns
 *     errors teaches nothing to a browser and everything to an attacker.
 *
 * The helpers below are exported for functions/src/__tests__/cspReport.test.ts —
 * the bounds above are the security property, so they are asserted, not trusted.
 */

/** Largest request body parsed. Real reports are ~1KB. */
export const MAX_BODY_BYTES = 16 * 1024;
/** Reporting-API batches carry several reports; take a few, ignore the rest. */
export const MAX_REPORTS_PER_REQUEST = 5;
/** Distinct signatures retained per hour document before overflow counting. */
export const MAX_SIGNATURES = 25;
/** Firestore transactions one instance will run per UTC hour. */
export const MAX_WRITES_PER_HOUR = 120;

export interface Violation {
    directive: string;
    blockedUri: string;
    documentPath: string;
}

/** `2026-08-25T05` — the UTC hour bucket a report folds into. */
export function hourKey(nowMs: number): string {
    return new Date(nowMs).toISOString().slice(0, 13);
}

/**
 * Attacker-controlled text becomes a Firestore field-path segment, so it is
 * reduced to `[A-Za-z0-9_-]` (no dots, no slashes, no backticks) and capped.
 */
export function sanitizeKey(s: string): string {
    const cleaned = s
        .replace(/[^A-Za-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 120);
    return cleaned || "unknown";
}

/**
 * The CSP directives this policy can actually report on, plus the ones a browser
 * may name for a policy this site does not set.
 *
 * An ALLOWLIST, not a shape check: `/^[a-z-]+$/` would accept any lowercase word
 * an attacker cares to send, which is a directly attacker-controlled half of the
 * signature space. With the allowlist the directive half is a closed set of ~20
 * values, so total signature cardinality is bounded by construction and the
 * MAX_SIGNATURES cap only ever has to absorb the blocked-origin half.
 */
const KNOWN_DIRECTIVES = new Set([
    "base-uri", "child-src", "connect-src", "default-src", "font-src", "form-action",
    "frame-ancestors", "frame-src", "img-src", "manifest-src", "media-src",
    "object-src", "prefetch-src", "report-to", "report-uri", "require-trusted-types-for",
    "sandbox", "script-src", "script-src-attr", "script-src-elem", "style-src",
    "style-src-attr", "style-src-elem", "trusted-types", "upgrade-insecure-requests",
    "worker-src",
]);

/**
 * `violated-directive` can be a whole source list ("script-src 'self' ..."), so
 * only the first token is kept, and only if it is a real CSP directive name.
 */
export function normalizeDirective(raw: unknown): string {
    if (typeof raw !== "string") return "other";
    const first = raw.trim().toLowerCase().split(/\s+/)[0] ?? "";
    return KNOWN_DIRECTIVES.has(first) ? first : "other";
}

/**
 * Reduced to scheme + host (or the bare CSP keyword) so the signature space is
 * the set of ORIGINS a browser refused, not the set of URLs — a page with a
 * thousand blocked image URLs on one CDN is one signature, not a thousand.
 */
export function normalizeBlockedUri(raw: unknown): string {
    if (typeof raw !== "string" || raw === "") return "unknown";
    const v = raw.slice(0, 500);
    // CSP reports use bare keywords for non-URL sources.
    if (/^[a-z-]{1,30}$/.test(v)) return v;
    try {
        const u = new URL(v);
        // data:, blob:, javascript: have no host.
        if (!u.host) return u.protocol.replace(/:$/, "").slice(0, 100);
        return `${u.protocol}//${u.host}`.slice(0, 100);
    } catch {
        return "unknown";
    }
}

/** Path only — query strings on a document URL can carry personal data. */
export function normalizeDocumentPath(raw: unknown): string {
    if (typeof raw !== "string" || raw === "") return "unknown";
    try {
        return new URL(raw).pathname.slice(0, 100);
    } catch {
        return "unknown";
    }
}

export function signatureFor(v: Violation): string {
    return sanitizeKey(`${v.directive}|${v.blockedUri}`);
}

/**
 * Handles BOTH wire formats, because the policy uses both directives and
 * browsers disagree about which they honour:
 *  - `report-uri`  → `application/csp-report`, `{"csp-report": {...}}`, kebab
 *    keys. Firefox and Safari (and Chrome when `report-to` is absent).
 *  - `report-to`   → `application/reports+json`, a JSON ARRAY of
 *    `{type, url, body:{effectiveDirective, blockedURL, documentURL}}`, camel
 *    keys. Chrome. Chrome ignores `report-uri` when `report-to` is honoured, so
 *    the two directives do not double-report.
 */
export function parseReports(raw: string): Violation[] {
    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch {
        return [];
    }
    const out: Violation[] = [];
    const push = (directive: unknown, blocked: unknown, doc: unknown): void => {
        // A body with neither field is not a CSP report — do not record a
        // fully-synthesised "other|unknown" row for arbitrary JSON.
        if (typeof directive !== "string" && typeof blocked !== "string") return;
        out.push({
            directive: normalizeDirective(directive),
            blockedUri: normalizeBlockedUri(blocked),
            documentPath: normalizeDocumentPath(doc),
        });
    };

    if (Array.isArray(json)) {
        for (const item of json) {
            if (!item || typeof item !== "object") continue;
            const it = item as Record<string, unknown>;
            if (typeof it.type === "string" && it.type !== "csp-violation") continue;
            const body = (it.body && typeof it.body === "object" ? it.body : {}) as Record<string, unknown>;
            push(
                body.effectiveDirective ?? body.violatedDirective,
                body.blockedURL ?? body.blockedURI,
                body.documentURL ?? it.url,
            );
        }
        return out;
    }

    if (json && typeof json === "object") {
        const o = json as Record<string, unknown>;
        const inner = o["csp-report"];
        const r = (inner && typeof inner === "object" ? inner : o) as Record<string, unknown>;
        push(
            r["effective-directive"] ?? r["violated-directive"] ?? r.effectiveDirective,
            r["blocked-uri"] ?? r.blockedURL,
            r["document-uri"] ?? r.documentURL,
        );
    }
    return out;
}

export interface BudgetState {
    /** UTC hour the counters belong to; a new hour resets them. */
    hour: string;
    used: number;
    dropped: number;
}

/**
 * Per-instance write budget. Returns whether this report may cost a Firestore
 * transaction, and — when it may — how many refusals accumulated since the last
 * accepted write, so the stored document can admit to being incomplete.
 *
 * It RESERVES the refusal counter — takes the pending count and zeroes it in the
 * same synchronous step — and the caller hands it back with `restoreDropped` if
 * the write fails. Both halves are load-bearing:
 *   - reserving synchronously (codex r4) is what makes this safe under the v2
 *     default of 80 concurrent requests per instance. Reading the counter and
 *     zeroing it only after an `await` would let two overlapping requests both
 *     see the same pending count, both increment `droppedCount` by it, and
 *     overstate the total;
 *   - restoring on failure (codex r3) is what stops a Firestore outage from
 *     erasing the incompleteness signal, which would let the next successful
 *     report store `droppedCount: 0` and claim the aggregate is complete.
 */
export function takeWriteSlot(
    state: BudgetState,
    hour: string,
    limit: number = MAX_WRITES_PER_HOUR,
): { allowed: boolean; droppedToRecord: number } {
    if (state.hour !== hour) {
        state.hour = hour;
        state.used = 0;
        // `dropped` is deliberately NOT reset: refusals carry across the hour
        // boundary so they are eventually written down. Attributing them to the
        // hour they are RECORDED in is a small inaccuracy; losing them entirely
        // would make the stored counts silently wrong, which is worse.
    }
    if (state.used >= limit) {
        // Saturates rather than growing without bound over a long-lived instance.
        if (state.dropped < Number.MAX_SAFE_INTEGER) state.dropped += 1;
        return { allowed: false, droppedToRecord: 0 };
    }
    state.used += 1;
    const droppedToRecord = state.dropped;
    state.dropped = 0; // reserved by this caller — see the doc comment above
    return { allowed: true, droppedToRecord };
}

/** Hand a reservation back when the write that was carrying it did not persist. */
export function restoreDropped(state: BudgetState, n: number): void {
    if (n <= 0) return;
    if (state.dropped > Number.MAX_SAFE_INTEGER - n) return;
    state.dropped += n;
}

/** Module-scoped budget: one per warm instance, reset on cold start. */
const budget: BudgetState = { hour: "", used: 0, dropped: 0 };

/**
 * Spends the budget over one parsed batch.
 *
 * NOTE THE `continue`, NOT `break` (codex r1, P2): stopping at the first refusal
 * would leave the rest of the batch uncounted, so a five-report batch that
 * exhausts the budget on report one would be reported as ONE drop instead of
 * five — the collector would understate its own incompleteness, which is the
 * precise failure this whole file is built to avoid. Iterating the remainder is
 * free: the batch is already capped at MAX_REPORTS_PER_REQUEST and a refused
 * slot performs no I/O.
 *
 * Extracted from the handler so the bound is testable without a Firestore.
 */
export async function ingest(
    reports: Violation[],
    hour: string,
    state: BudgetState,
    write: (hour: string, v: Violation, dropped: number) => Promise<void>,
    limit: number = MAX_WRITES_PER_HOUR,
): Promise<void> {
    for (let i = 0; i < reports.length; i++) {
        const slot = takeWriteSlot(state, hour, limit);
        if (!slot.allowed) continue;
        try {
            await write(hour, reports[i], slot.droppedToRecord);
        } catch (e) {
            // Three things are owed back, and each was a separate finding:
            //  - the reservation, spent only by a write that landed (codex r3);
            //  - the report whose write failed (codex r5);
            //  - the rest of the batch, which the rethrow never reaches (codex r6).
            // `reports.length - i` is the last two together: this report plus its
            // untouched tail. Without it a Firestore outage loses reports with
            // nothing anywhere recording that it did.
            //
            // The write SLOT stays consumed on purpose: the budget exists to cap
            // Firestore cost, and a failed transaction cost as much as a good one.
            restoreDropped(state, slot.droppedToRecord + (reports.length - i));
            throw e;
        }
    }
}

async function record(hour: string, v: Violation, dropped: number): Promise<void> {
    const db = admin.firestore();
    const ref = db.collection("system_logs").doc(`csp-violations-${hour}`);
    const key = signatureFor(v);
    // Called through the namespace rather than detached into a local: a static
    // factory pulled off its class is the kind of thing that keeps working until
    // the SDK version where it does not.
    const inc = (n: number) => admin.firestore.FieldValue.increment(n);

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const now = admin.firestore.FieldValue.serverTimestamp();

        if (!snap.exists) {
            tx.set(ref, {
                type: "csp-violation",
                source: "csp-report",
                severity: "low",
                message: `CSP violations for ${hour}Z`,
                hour,
                timestamp: Date.now(),
                createdAt: now,
                updatedAt: now,
                totalCount: 1,
                overflowCount: 0,
                droppedCount: dropped,
                signatures: {
                    [key]: {
                        count: 1,
                        directive: v.directive,
                        blockedUri: v.blockedUri,
                        documentPath: v.documentPath,
                    },
                },
            });
            return;
        }

        const sigs = (snap.get("signatures") ?? {}) as Record<string, unknown>;
        const known = Object.prototype.hasOwnProperty.call(sigs, key);
        const update: Record<string, unknown> = {
            updatedAt: now,
            timestamp: Date.now(),
            totalCount: inc(1),
            droppedCount: inc(dropped),
        };
        if (known || Object.keys(sigs).length < MAX_SIGNATURES) {
            // Dotted keys are field PATHS here; `key` is sanitized to
            // [A-Za-z0-9_-] above so it can never escape into a sibling field.
            update[`signatures.${key}.count`] = inc(1);
            update[`signatures.${key}.directive`] = v.directive;
            update[`signatures.${key}.blockedUri`] = v.blockedUri;
            update[`signatures.${key}.documentPath`] = v.documentPath;
        } else {
            update.overflowCount = inc(1);
        }
        // Cast matches the repo's existing dynamic-update precedent
        // (bracketEntries.ts:185) — the keys are field paths built above, not a
        // literal whose shape the compiler can check.
        tx.update(ref, update as admin.firestore.UpdateData<admin.firestore.DocumentData>);
    });
}

/** Body bytes, preferring the raw buffer (Content-Type is not application/json). */
function bodyText(req: { rawBody?: unknown; body?: unknown }): string | null {
    const rb = req.rawBody;
    if (Buffer.isBuffer(rb)) return rb.length > MAX_BODY_BYTES ? null : rb.toString("utf8");
    const b = req.body;
    if (typeof b === "string") return Buffer.byteLength(b) > MAX_BODY_BYTES ? null : b;
    if (Buffer.isBuffer(b)) return b.length > MAX_BODY_BYTES ? null : b.toString("utf8");
    if (b && typeof b === "object") {
        try {
            const s = JSON.stringify(b);
            return Buffer.byteLength(s) > MAX_BODY_BYTES ? null : s;
        } catch {
            return null;
        }
    }
    return null;
}

export const cspReport = onRequest(
    // maxInstances overrides the repo-wide 10 (lib/globalOptions.ts): this is a
    // public, unauthenticated endpoint whose only job is counting, so the fleet
    // is capped hard rather than allowed to scale with abusive traffic.
    // 256MiB, not the 128MiB this shipped with. EVERY function in this codebase
    // shares ONE container image that loads the whole `index.ts` module graph —
    // firebase-admin, stripe, the lot — so the floor is set by the bundle, not by
    // what this handler does. At 128MiB the container never listened on PORT=8080
    // and the 2026-08-25 deploy failed it with "Container Healthcheck failed"
    // while all 190-odd other functions succeeded. 256MiB matches every other
    // HTTP endpoint here (joinPreview, readiness, emailUnsubscribeHttp,
    // emailPrefsPage, revenueAggregates) and is the Gen-2 default.
    { maxInstances: 2, memory: "256MiB", timeoutSeconds: 10 },
    async (req, res) => {
        // Reporting-API v1 endpoints are cross-origin (the site is on
        // marchmeleepools.com, this is on cloudfunctions.net), so Chrome sends a
        // CORS preflight before delivering a `report-to` batch. `report-uri`
        // needs no preflight. Reports carry no credentials, so `*` is correct.
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type");
        res.set("Access-Control-Max-Age", "86400");
        res.set("Cache-Control", "no-store");

        if (req.method === "OPTIONS") {
            res.status(204).send("");
            return;
        }
        if (req.method !== "POST") {
            res.status(405).send("");
            return;
        }

        try {
            const raw = bodyText(req);
            if (raw !== null) {
                const reports = parseReports(raw).slice(0, MAX_REPORTS_PER_REQUEST);
                await ingest(reports, hourKey(Date.now()), budget, record);
            }
        } catch (e) {
            // A collector that fails must never become the incident.
            logger.warn("cspReport failed to persist a violation report", e);
        }

        // Always 204, always after the same work: the response tells a caller
        // nothing about whether anything was stored.
        res.status(204).send("");
    },
);
