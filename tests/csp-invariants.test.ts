import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Content-Security-Policy invariants.
 *
 * The CSP is declared FOUR times: three `add_header` directives in `nginx.conf`
 * (server block + the `/pool|join/` and `/` locations) and once in
 * `firebase.json`. The nginx repetition is NOT redundancy that can be deleted —
 * `add_header` does not inherit into a `location` that declares any `add_header`
 * of its own, so each location must re-assert the whole set or its responses ship
 * with no security headers at all. The comments at `nginx.conf` "Re-assert
 * security headers" say so.
 *
 * That makes divergence the real risk, and it has already cost something: the CSP
 * was hardened 2026-07-03 (e13f6c9, T11) and the Sentry frontend spine landed
 * 2026-07-16 (96811cf) without anyone adding Sentry's ingest host to
 * `connect-src`. Every browser-side error was silently refused for thirteen days
 * before anyone noticed, and the absence of reports read as health — the same
 * trap as the unbound COURIER_AUTH_TOKEN in #314.
 *
 * `SUPERADMIN-AUDIT-REPORT.md:200` had already named the duplication as hidden
 * coupling. Naming it did not stop it. These assertions do.
 *
 * 2026-08-25 (security audit item 24) added three things this file now also
 * guards, because each has a failure mode that is INVISIBLE rather than loud:
 *   - `frame-ancestors 'none'`, which must not drift apart from the
 *     `X-Frame-Options: DENY` it supersedes;
 *   - a REAL reporting pipeline. `report-to csp-endpoint` with no matching
 *     `Reporting-Endpoints` header, or pointed at a URL nothing serves,
 *     discards every violation silently and reads exactly like a clean policy;
 *   - `X-XSS-Protection: 0`. The legacy auditor is itself an XSS vector, and
 *     "restoring" it to `1; mode=block` looks like hardening.
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const exists = (p: string) => { try { read(p); return true; } catch { return false; } };

/** Every `Content-Security-Policy` value in a file, whitespace-normalized. */
function cspValues(src: string): string[] {
  const out: string[] = [];
  // nginx: add_header Content-Security-Policy "<value>" always;
  for (const m of src.matchAll(/Content-Security-Policy\s+"([^"]+)"/g)) out.push(m[1]);
  // firebase.json: "key": "Content-Security-Policy", "value": "<value>"
  for (const m of src.matchAll(/"Content-Security-Policy",\s*\n?\s*"value":\s*"([^"]+)"/g)) out.push(m[1]);
  return out.map(v => v.replace(/\s+/g, ' ').trim());
}

/**
 * Every value of an arbitrary security header in a file, whitespace-normalized.
 *
 * Covers both declaration shapes: nginx `add_header <Name> "<value>" always;`
 * (or single-quoted, which `Reporting-Endpoints` must use because its value
 * contains the double quotes the structured-field syntax requires) and
 * firebase.json's `{"key": "<Name>", "value": "<value>"}`. The firebase.json
 * value is JSON-unescaped so the two shapes are comparable as strings.
 */
function headerValues(src: string, name: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(new RegExp(`add_header\\s+${name}\\s+"([^"]*)"`, 'g'))) out.push(m[1]);
  for (const m of src.matchAll(new RegExp(`add_header\\s+${name}\\s+'([^']*)'`, 'g'))) out.push(m[1]);
  for (const m of src.matchAll(new RegExp(`"${name}",\\s*\\n?\\s*"value":\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g'))) {
    out.push(JSON.parse(`"${m[1]}"`) as string);
  }
  // functions/src/lib/httpHeaders.ts: `"<Name>": "<value>",` inside
  // COMMON_SECURITY_HEADERS (an object literal, so the key is followed by a
  // colon — which is what keeps this from also matching firebase.json's
  // `"key": "<Name>",` shape).
  for (const m of src.matchAll(new RegExp(`"${name}":\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g'))) {
    out.push(JSON.parse(`"${m[1]}"`) as string);
  }
  return out.map(v => v.replace(/\s+/g, ' ').trim());
}

/**
 * The fifth CSP copy: `SITE_CSP` in the Cloud Functions header helper, which
 * `joinPreview` puts on the SPA shell it proxies to human visitors. Declared as
 * a double-quoted string literal (the value contains only single quotes), so
 * one regex reads it back.
 */
function functionsSiteCsp(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/export const SITE_CSP =\s*\n?\s*"([^"]+)"/g)) out.push(m[1]);
  return out.map(v => v.replace(/\s+/g, ' ').trim());
}

const NGINX = read('nginx.conf');
const FIREBASE = read('firebase.json');
const FUNCTIONS_HEADERS = read('functions/src/lib/httpHeaders.ts');
const ALL_CSP = [...cspValues(NGINX), ...cspValues(FIREBASE), ...functionsSiteCsp(FUNCTIONS_HEADERS)];

describe('CSP — every declaration is identical', () => {
  it('nginx.conf declares it exactly three times', () => {
    // If this count changes, a location was added or removed. Whoever did that
    // must decide whether the new location needs the headers re-asserted, so the
    // count is pinned deliberately rather than read from the file.
    expect(cspValues(NGINX)).toHaveLength(3);
  });

  it('firebase.json declares it exactly once', () => {
    expect(cspValues(FIREBASE)).toHaveLength(1);
  });

  it('functions/src/lib/httpHeaders.ts declares SITE_CSP exactly once', () => {
    // 2026-09-05: joinPreview serves the real index.html from
    // *.cloudfunctions.net and (via the /join/** rewrite) from *.web.app. Before
    // this copy existed it served it with NO policy at all.
    expect(functionsSiteCsp(FUNCTIONS_HEADERS)).toHaveLength(1);
  });

  it('all five declarations are byte-identical', () => {
    expect(ALL_CSP).toHaveLength(5);
    expect(new Set(ALL_CSP).size).toBe(1);
  });

  it('the SITE_CSP grep is reachable — a drifted value is a second member of the set', () => {
    const drifted = [...cspValues(NGINX), "default-src 'self'; script-src 'self';"];
    expect(new Set(drifted).size).toBe(2);
  });
});

describe('security headers — the functions helper matches nginx, value for value', () => {
  // `COMMON_SECURITY_HEADERS` is what every HTML-serving Cloud Function sends.
  // Each value is pinned to nginx's so the two surfaces cannot drift: a
  // Referrer-Policy tightened on www but not on the unsubscribe page is exactly
  // the split the 2026-09-05 audit scored as a FAIL.
  const PINNED = [
    'X-Content-Type-Options',
    'X-Frame-Options',
    'X-XSS-Protection',
    'Referrer-Policy',
    'Permissions-Policy',
    'Strict-Transport-Security',
  ] as const;

  it.each(PINNED)('%s: functions helper equals nginx', (name) => {
    const fromFunctions = headerValues(FUNCTIONS_HEADERS, name);
    expect(fromFunctions, `${name} missing from httpHeaders.ts`).toHaveLength(1);
    const fromNginx = new Set(headerValues(NGINX, name));
    expect(fromNginx.size, `${name} differs between nginx locations`).toBe(1);
    expect(fromFunctions[0]).toBe([...fromNginx][0]);
  });

  it('Reporting-Endpoints in the helper is the same group + URL as nginx', () => {
    const fromFunctions = FUNCTIONS_HEADERS.match(/export const SITE_REPORTING_ENDPOINTS =\s*\n?\s*'([^']+)'/)?.[1];
    expect(fromFunctions).toBe(headerValues(NGINX, 'Reporting-Endpoints')[0]);
  });

  it('the object-literal grep is reachable and does not match firebase.json\'s shape', () => {
    expect(headerValues('"X-Frame-Options": "DENY",', 'X-Frame-Options')).toEqual(['DENY']);
    // firebase.json writes `"key": "X-Frame-Options", "value": "DENY"` — the
    // existing third regex reads that; the new fourth must NOT double-count it.
    expect(headerValues('{ "key": "X-Frame-Options", "value": "DENY" }', 'X-Frame-Options')).toEqual(['DENY']);
  });
});

describe('CSP — connect-src permits every origin the app actually calls', () => {
  const connectSrc = cspValues(NGINX)[0].match(/connect-src ([^;]+)/)?.[1] ?? '';

  // Each entry is a host the client calls at runtime. A missing one does not
  // throw — the browser refuses the request and logs to console only — so the
  // failure is invisible without a test like this.
  const REQUIRED = [
    ["Sentry ingest (src/sentry.ts)", 'https://*.ingest.us.sentry.io'],
    ['Firestore/Auth/Storage', 'https://*.googleapis.com'],
    ['Firestore realtime', 'wss://*.firebaseio.com'],
    ['callable functions', 'https://us-central1-gridiron-gamble-uzuqo.cloudfunctions.net'],
    ['ESPN scoreboard', 'https://site.api.espn.com'],
  ] as const;

  it.each(REQUIRED)('allows %s', (_label, host) => {
    expect(connectSrc).toContain(host);
  });

  // The opposite failure to guard: someone "fixes" a blocked request by opening
  // connect-src instead of naming the host. Each of these is a token that would
  // permit an arbitrary origin.
  const BLANKET = ['*', 'https:', 'http:', 'https://*', "'unsafe-eval'", 'data:'];

  it('permits no blanket origin token', () => {
    expect(connectSrc.split(/\s+/).filter(t => BLANKET.includes(t))).toEqual([]);
  });

  it('the blanket check is reachable — a widened value fails it', () => {
    // Without this, `permits no blanket origin token` would pass just as happily
    // against a value the check cannot see, and look identical while doing so.
    const widened = "'self' https://*.googleapis.com https:";
    expect(widened.split(/\s+/).filter(t => BLANKET.includes(t))).toEqual(['https:']);
  });

  it('the grep actually matches — the pre-fix value fails the Sentry assertion', () => {
    // A guard that matches nothing looks identical to a guard that passes. This is
    // the connect-src as it shipped from 2026-07-16 to 2026-07-29.
    const preFix =
      "connect-src 'self' https://*.firebaseio.com https://*.googleapis.com " +
      'https://*.firebase.com https://*.firebaseapp.com https://www.google-analytics.com ' +
      'https://site.api.espn.com https://generativelanguage.googleapis.com ' +
      'wss://*.firebaseio.com https://us-central1-gridiron-gamble-uzuqo.cloudfunctions.net;';
    expect(preFix).not.toContain('https://*.ingest.us.sentry.io');
  });
});

describe('CSP — no stale fifth copy', () => {
  it('src/nginx.conf is gone (it declared connect-src \'self\' and shipped nowhere)', () => {
    // Dockerfile copies root nginx.conf; ci.yml validates root nginx.conf. This
    // file was referenced by neither, contradicted the real one, and was already
    // flagged for deletion in PLAN-SUPERADMIN-CONTROL.md and
    // SUPERADMIN-AUDIT-REPORT.md.
    expect(() => read('src/nginx.conf')).toThrow();
  });

  it('index.html ships no competing CSP meta tag', () => {
    // CSP is intersective: a live meta tag missing a host would re-break Sentry
    // even with nginx correct. index.html's block is commented out — keep it that
    // way, or add the host to both.
    const html = read('index.html');
    const active = html.replace(/<!--[\s\S]*?-->/g, '');
    expect(active).not.toContain('Content-Security-Policy');
  });
});

describe('CSP — clickjacking: frame-ancestors and X-Frame-Options agree', () => {
  // Verified 2026-08-25 before choosing 'none': nothing in this repo embeds the
  // site in a frame. `X-Frame-Options: DENY` already ships on every response
  // (confirmed live on https://www.marchmeleepools.com/), the SPA renders no
  // <iframe> of itself, and the one cross-origin surface — the joinPreview
  // crawler proxy — is a server-side proxy, not an embed. So `frame-ancestors
  // 'none'` is the value that MATCHES shipped behaviour rather than tightening it.
  it.each(ALL_CSP.map((v, i) => [i, v] as const))('copy %i declares frame-ancestors \'none\'', (_i, v) => {
    expect(v).toContain("frame-ancestors 'none'");
  });

  it('X-Frame-Options is DENY everywhere it is declared', () => {
    // frame-ancestors supersedes XFO in every browser that implements it, but
    // XFO is still what old browsers read. If one is loosened without the other,
    // the site's framing policy depends on which header the browser prefers.
    const xfo = [...headerValues(NGINX, 'X-Frame-Options'), ...headerValues(FIREBASE, 'X-Frame-Options')];
    expect(xfo.length).toBe(4);
    expect(new Set(xfo)).toEqual(new Set(['DENY']));
  });

  it('the frame-ancestors grep is reachable — a value without it fails', () => {
    // Guards against the assertion above passing vacuously if the directive is
    // ever renamed or the extraction stops matching.
    expect("default-src 'self'; object-src 'none';").not.toContain("frame-ancestors 'none'");
  });
});

describe('CSP — the reporting pipeline is real, not a directive pointing at nothing', () => {
  const REPORT_URL = 'https://us-central1-gridiron-gamble-uzuqo.cloudfunctions.net/cspReport';
  const GROUP = 'csp-endpoint';

  const reporting = [
    ...headerValues(NGINX, 'Reporting-Endpoints'),
    ...headerValues(FIREBASE, 'Reporting-Endpoints'),
  ];

  it('Reporting-Endpoints is declared beside every CSP copy', () => {
    // A `report-to` directive whose group is not defined by a
    // Reporting-Endpoints header on the SAME response is discarded by the
    // browser with no error anywhere. Per-copy, because add_header does not
    // inherit into a location that sets its own.
    expect(reporting).toHaveLength(4);
    expect(new Set(reporting).size).toBe(1);
  });

  it('the group named by report-to is the group Reporting-Endpoints defines', () => {
    for (const v of ALL_CSP) expect(v).toContain(`report-to ${GROUP};`);
    expect(reporting[0]).toContain(`${GROUP}=`);
  });

  it('report-uri and Reporting-Endpoints point at the same collector', () => {
    // Two directives, one endpoint: `report-uri` is what Firefox and Safari
    // honour, `report-to` is what Chrome honours (and Chrome ignores report-uri
    // when report-to resolves, so they do not double-report). If they drift, one
    // browser family reports into a black hole.
    for (const v of ALL_CSP) expect(v).toContain(`report-uri ${REPORT_URL};`);
    expect(reporting[0]).toBe(`${GROUP}="${REPORT_URL}"`);
  });

  it('the collector the report URL names actually exists and is deployed', () => {
    // THE POINT OF THIS FILE. A URL is not a pipeline. The endpoint must be a
    // real function AND be re-exported from index.ts, because Firebase deploys
    // only what index.ts exports — an unexported collector 404s every report
    // and the silence is indistinguishable from a clean policy.
    const fnName = new URL(REPORT_URL).pathname.replace(/^\//, '');
    expect(fnName).toBe('cspReport');
    expect(exists(`functions/src/${fnName}.ts`)).toBe(true);
    const index = read('functions/src/index.ts')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(?<!:)\/\/[^\n]*/g, ' ');
    const exported = new Set<string>();
    for (const m of index.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
      for (const spec of m[1].split(',')) {
        const local = spec.trim().split(/\s+as\s+/)[0].trim();
        if (local) exported.add(local);
      }
    }
    expect(exported.has(fnName)).toBe(true);
  });

  it('the collector keeps its unbounded-write guards', () => {
    // The endpoint is unauthenticated by construction (browsers send CSP reports
    // with no credentials), so its safety IS these bounds: one document per UTC
    // hour, a capped signature map, and a per-instance write budget under a
    // pinned maxInstances. Removing any of them turns a counter into a sink
    // anyone on the internet can fill.
    const src = read('functions/src/cspReport.ts');
    expect(src).toContain('MAX_SIGNATURES');
    expect(src).toContain('MAX_WRITES_PER_HOUR');
    expect(src).toContain('MAX_BODY_BYTES');
    expect(src).toContain('maxInstances: 2');
    // Doc id is derived from the hour bucket, never from anything the caller sent.
    expect(src).toContain('`csp-violations-${hour}`');
  });
});

describe('security headers — the legacy XSS auditor stays retired', () => {
  it('every X-XSS-Protection declaration is exactly "0"', () => {
    // "1; mode=block" is not hardening. The filter was removed from Chrome and
    // Edge and was itself exploitable (it could be steered to disable a safe
    // inline script, and leaked cross-origin information). "0" disables it
    // explicitly instead of relying on a browser default. CSP is the control.
    const xss = [...headerValues(NGINX, 'X-XSS-Protection'), ...headerValues(FIREBASE, 'X-XSS-Protection')];
    expect(xss.length).toBeGreaterThanOrEqual(4);
    expect(new Set(xss)).toEqual(new Set(['0']));
  });

  it('the X-XSS-Protection grep is reachable — the pre-fix value fails it', () => {
    const preFix = 'add_header X-XSS-Protection "1; mode=block" always;';
    expect(headerValues(preFix, 'X-XSS-Protection')).toEqual(['1; mode=block']);
  });
});

describe('security headers — HSTS is declared identically everywhere', () => {
  // NOT preload-eligible as of 2026-08-25, deliberately: max-age=31536000 and
  // includeSubDomains are both present, but the `preload` token is absent, and
  // submission to hstspreload.org is effectively irreversible and is Kevin's
  // call, not a code change. Pinned here so that when the token IS added it
  // lands in all four copies at once rather than in one of them.
  it('all four Strict-Transport-Security values are identical', () => {
    const hsts = [
      ...headerValues(NGINX, 'Strict-Transport-Security'),
      ...headerValues(FIREBASE, 'Strict-Transport-Security'),
    ];
    expect(hsts).toHaveLength(4);
    expect(new Set(hsts).size).toBe(1);
    expect(hsts[0]).toMatch(/^max-age=(\d+); includeSubDomains(; preload)?$/);
    expect(Number(hsts[0].match(/max-age=(\d+)/)![1])).toBeGreaterThanOrEqual(31536000);
  });
});

describe('CSP — img-src keeps the bare https: source', () => {
  it("img-src still allows bare `https:`", () => {
    // LOAD-BEARING, NOT SLOPPINESS. Commissioner branding accepts any
    // web-hosted logoUrl (src/components/wizard/wizard-shared.ts), so narrowing
    // img-src to a host list breaks every pool whose logo is hosted somewhere
    // that list does not name — and it breaks as a blank image with a console
    // line, not as an error anyone is paged for. Remove this only together with
    // proxying or migrating branding images to a known origin.
    for (const v of ALL_CSP) {
      const imgSrc = v.match(/img-src ([^;]+)/)?.[1] ?? '';
      expect(imgSrc.split(/\s+/)).toContain('https:');
    }
  });

  it('the img-src grep is reachable — a narrowed value fails it', () => {
    const narrowed = "img-src 'self' data: blob: https://*.espncdn.com;";
    expect(narrowed.match(/img-src ([^;]+)/)?.[1].split(/\s+/)).not.toContain('https:');
  });
});
