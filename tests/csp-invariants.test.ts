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
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** Every `Content-Security-Policy` value in a file, whitespace-normalized. */
function cspValues(src: string): string[] {
  const out: string[] = [];
  // nginx: add_header Content-Security-Policy "<value>" always;
  for (const m of src.matchAll(/Content-Security-Policy\s+"([^"]+)"/g)) out.push(m[1]);
  // firebase.json: "key": "Content-Security-Policy", "value": "<value>"
  for (const m of src.matchAll(/"Content-Security-Policy",\s*\n?\s*"value":\s*"([^"]+)"/g)) out.push(m[1]);
  return out.map(v => v.replace(/\s+/g, ' ').trim());
}

const NGINX = read('nginx.conf');
const FIREBASE = read('firebase.json');

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

  it('all four declarations are byte-identical', () => {
    const all = [...cspValues(NGINX), ...cspValues(FIREBASE)];
    expect(new Set(all).size).toBe(1);
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
