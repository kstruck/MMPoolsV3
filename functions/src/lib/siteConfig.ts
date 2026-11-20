// Per-environment site identity for Cloud Functions (PLAN-AUTO-DEPLOY §4.10,
// Phase 1a; sweep S8).
//
// Before this module, the production site origin and Firebase project id were
// written as literals across `functions/src`. A staging project built from the
// same tree would then have sent its users to production: Stripe return URLs,
// email links and the join-preview redirect all pointed at the live site.
//
// PRODUCTION IS THE DEFAULT, AND ITS VALUES ARE BYTE-FOR-BYTE THE OLD LITERALS.
// Production sets nothing: `MMP_SITE_ORIGIN` is unset there, and
// `GCLOUD_PROJECT` is the production id, so every value below resolves to
// exactly what the literals were. `functions/src/__tests__/siteConfig.test.ts`
// pins that, and `tests/site-environment-invariants.test.ts` fails if a
// production literal is added anywhere else in `functions/src`.
//
// A staging project sets `MMP_SITE_ORIGIN` in `functions/.env.<projectId>`
// (Firebase loads that file at deploy). A malformed value, or an origin that
// does not match the project (see resolveSiteIdentity), THROWS at module load,
// which fails the deploy's function discovery rather than shipping a staging
// build whose links quietly fall back to production.

export const PRODUCTION_SITE_ORIGIN = "https://www.marchmeleepools.com";
export const PRODUCTION_PROJECT_ID = "gridiron-gamble-uzuqo";

/**
 * Every host that serves (or redirects to) production. A non-production
 * project may use none of them (qodo #2 on #796: comparing against the one
 * canonical origin let the apex through). Matches stripe.ts's allowlist.
 */
export const PRODUCTION_HOSTS: ReadonlySet<string> = new Set([
    "www.marchmeleepools.com",
    "marchmeleepools.com",
    "www.marchmelee.com",
    "marchmelee.com",
]);

/** True when an origin points at a production host, in any spelling URL accepts. */
export function isProductionOrigin(origin: string): boolean {
    const host = new URL(origin).hostname.toLowerCase().replace(/\.$/, "");
    return PRODUCTION_HOSTS.has(host);
}

/**
 * Resolves the public site origin (`protocol//host`, no trailing slash).
 * Unset or blank means production. Anything else must be a bare https origin
 * (http is accepted for localhost only), with no path, query, fragment or
 * credentials, so the value can be concatenated with a path safely.
 */
export function resolveSiteOrigin(raw: string | undefined): string {
    const value = (raw ?? "").trim();
    if (value === "") return PRODUCTION_SITE_ORIGIN;
    let u: URL;
    try {
        u = new URL(value);
    } catch {
        throw new Error(`MMP_SITE_ORIGIN is not a URL: ${JSON.stringify(value)}`);
    }
    const isLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(isLocal && u.protocol === "http:")) {
        throw new Error(`MMP_SITE_ORIGIN must be https: ${JSON.stringify(value)}`);
    }
    if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) {
        throw new Error(`MMP_SITE_ORIGIN must be a bare origin (no path, query, fragment or credentials): ${JSON.stringify(value)}`);
    }
    // A raw value with a trailing path such as "https://x.com/" normalises to
    // "https://x.com"; `URL.origin` drops the default port and lower-cases.
    return u.origin;
}

/**
 * Resolves the Firebase project id. Unset or blank means production. The
 * runtime (and the CLI during deploy discovery) sets `GCLOUD_PROJECT`.
 * A value that is not a valid project id throws rather than being
 * interpolated into a hostname.
 */
export function resolveProjectId(raw: string | undefined): string {
    const value = (raw ?? "").trim();
    if (value === "") return PRODUCTION_PROJECT_ID;
    // Google Cloud project ids: 6-30 chars, lower-case letters, digits and
    // hyphens, starting with a letter and not ending with a hyphen.
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value)) {
        throw new Error(`GCLOUD_PROJECT is not a valid project id: ${JSON.stringify(value)}`);
    }
    return value;
}

/**
 * True for a project that is not a real deployment: the emulator, or a
 * `demo-*` project (Firebase's convention for offline-only projects, used by
 * this repo's emulator suite and unit tests).
 */
export function isLocalProject(projectId: string, functionsEmulator: string | undefined): boolean {
    return functionsEmulator === "true" || projectId.startsWith("demo-");
}

/**
 * The origin and project must agree (qodo #1 on #796). A real non-production
 * project with MMP_SITE_ORIGIN unset would otherwise default to production's
 * origin and send staging users to the live site, which is exactly what this
 * module exists to prevent. So:
 *   - production's project must use production's origin;
 *   - a real non-production project must set its own, non-production origin;
 *   - the emulator and `demo-*` projects may use either.
 * A violation throws at module load, which fails the deploy.
 */
export function resolveSiteIdentity(env: {
    MMP_SITE_ORIGIN?: string;
    GCLOUD_PROJECT?: string;
    FUNCTIONS_EMULATOR?: string;
}): { origin: string; projectId: string } {
    const projectId = resolveProjectId(env.GCLOUD_PROJECT);
    const origin = resolveSiteOrigin(env.MMP_SITE_ORIGIN);
    if (isLocalProject(projectId, env.FUNCTIONS_EMULATOR)) return { origin, projectId };
    if (projectId === PRODUCTION_PROJECT_ID) {
        if (origin !== PRODUCTION_SITE_ORIGIN) {
            throw new Error(`MMP_SITE_ORIGIN=${origin} is not production's origin, but this is production's project`);
        }
    } else if (isProductionOrigin(origin)) {
        throw new Error(`Project ${projectId} is not production: set MMP_SITE_ORIGIN to its own site in functions/.env.${projectId}`);
    }
    return { origin, projectId };
}

const IDENTITY = resolveSiteIdentity({
    MMP_SITE_ORIGIN: process.env.MMP_SITE_ORIGIN,
    GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
    FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR,
});

/** The public site origin, e.g. "https://www.marchmeleepools.com". */
export const SITE_ORIGIN = IDENTITY.origin;

/** The site's host, e.g. "www.marchmeleepools.com". */
export const SITE_HOST = new URL(SITE_ORIGIN).host;

/**
 * The host as people type it in prose, without a leading "www.",
 * e.g. "marchmeleepools.com". Used in copy that intentionally has no link.
 */
export const SITE_DISPLAY_HOST = SITE_HOST.replace(/^www\./, "");

/** The Firebase project id this code is running in. */
export const PROJECT_ID = IDENTITY.projectId;
