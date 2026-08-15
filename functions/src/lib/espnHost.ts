/**
 * The ONE place the server-side ESPN "site API" host lives.
 *
 * Host is `site.web.api.espn.com`, NOT `site.api.espn.com`. Same service, same
 * JSON — but from 2026-08-14 the `site.api` host answered every server-side
 * fetch (Cloud Functions, Node `fetch`) with HTTP 403 (Akamai bot rule keyed on
 * the client fingerprint; browsers were unaffected), and the NFL score sync was
 * dark for a full game day. Measured host-wide: college-football and
 * mens-college-basketball paths 403'd too. Do not "normalise" this back.
 *
 * Every server module builds its ESPN URL from this constant so a future host
 * change (or rollback) is one edit — the first fix of this incident missed a
 * call site because the host was pasted in six files (codex r1, qodo #4).
 * `functions/src/__tests__/espnHost.test.ts` fails if a `site.api.espn.com`
 * literal comes back anywhere under `functions/src`.
 */
export const ESPN_SITE_API = 'https://site.web.api.espn.com/apis/site/v2/sports';
