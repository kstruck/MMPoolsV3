/**
 * Security headers for the HTML-serving HTTP functions.
 *
 * WHY THIS EXISTS. The main site gets its headers from nginx (www) and from
 * `firebase.json` (the *.web.app fallback host). Neither reaches a Cloud
 * Function served from `*.cloudfunctions.net`: on 2026-09-05 the audit curled
 * `emailUnsubscribe`, `manageEmailPrefs` and `joinPreview` and each came back
 * with `content-type` and nothing else — no frame protection, no CSP, no
 * HSTS, no nosniff. Every HTML endpoint calls `setSecurityHeaders` FIRST, so
 * the 400/403/405 error pages carry the same set as the 200.
 *
 * Two CSP profiles, because the endpoints serve two different kinds of page:
 *
 *  - `page`: a self-contained server-rendered page (unsubscribe result, the
 *    preference form, the crawler Open Graph preview). Nothing external loads,
 *    so `default-src 'none'`. The templates style with inline `style=`
 *    attributes, hence `style-src 'unsafe-inline'`; `manageEmailPrefs` POSTs
 *    back to itself, hence `form-action 'self'`. No `script-src` at all: these
 *    pages ship no JavaScript and this policy makes sure none can be injected.
 *
 *  - `spa`: `joinPreview` proxies the real `index.html` to human visitors, so
 *    the app must run under EXACTLY the policy it runs under on www. `SITE_CSP`
 *    is therefore a fifth verbatim copy of the value in `nginx.conf` (×3) and
 *    `firebase.json` (×1); `tests/csp-invariants.test.ts` asserts all five are
 *    byte-identical, so a host added to one copy cannot be forgotten here.
 *
 * `COMMON_SECURITY_HEADERS` mirrors the non-CSP set nginx sends; the same test
 * pins each value to nginx's.
 */

export const SITE_CSP =
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://apis.google.com https://*.firebaseapp.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.espncdn.com https://*.espn.com https://a.espncdn.com https:; connect-src 'self' https://*.firebaseio.com https://*.googleapis.com https://*.firebase.com https://*.firebaseapp.com https://www.google-analytics.com https://site.api.espn.com https://generativelanguage.googleapis.com wss://*.firebaseio.com https://us-central1-gridiron-gamble-uzuqo.cloudfunctions.net https://*.ingest.us.sentry.io; frame-src 'self' https://*.firebaseapp.com https://accounts.google.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; report-uri https://us-central1-gridiron-gamble-uzuqo.cloudfunctions.net/cspReport; report-to csp-endpoint;";

export const SITE_REPORTING_ENDPOINTS =
    'csp-endpoint="https://us-central1-gridiron-gamble-uzuqo.cloudfunctions.net/cspReport"';

// No img-src either: none of the three page templates loads an image (the
// crawler preview's og:image is metadata a crawler fetches, not a page load).
export const PAGE_CSP =
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export const COMMON_SECURITY_HEADERS: Readonly<Record<string, string>> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "0",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

export type CspProfile = "page" | "spa";

/** The one method this helper needs from express's Response — structural, so
 *  no `express` import (it is a transitive dependency of firebase-functions,
 *  not a declared one) and so unit tests can pass a plain recorder. */
export interface HeaderSink {
    set(name: string, value: string): unknown;
}

/** Apply the full security-header set for one response. Call before any send. */
export function setSecurityHeaders(res: HeaderSink, profile: CspProfile): void {
    for (const [name, value] of Object.entries(COMMON_SECURITY_HEADERS)) res.set(name, value);
    if (profile === "spa") {
        res.set("Content-Security-Policy", SITE_CSP);
        res.set("Reporting-Endpoints", SITE_REPORTING_ENDPOINTS);
    } else {
        res.set("Content-Security-Policy", PAGE_CSP);
    }
}
