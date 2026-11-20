import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * PLAN-AUTO-DEPLOY Phase 1a (§4.10, sweep S8): the Firebase project id and the
 * site origin become per-environment, with production's values as the defaults.
 *
 * The bar for this change is that PRODUCTION'S OUTPUT DOES NOT CHANGE. These
 * assertions hold that bar for the two places the values live outside
 * functions code (functions/src/__tests__/siteConfig.test.ts covers that):
 *
 *   1. the `www` container's start script, scripts/docker/40-mmp-environment.sh,
 *      which must touch NOTHING when no MMP_* variable is set, and on staging
 *      must rewrite every production project id and make the site unindexable;
 *   2. the functions source, where a production literal re-added outside
 *      lib/siteConfig.ts would quietly send a staging user to production.
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const SCRIPT = resolve(root, 'scripts/docker/40-mmp-environment.sh');
const PROD_PROJECT = 'gridiron-gamble-uzuqo';

describe('40-mmp-environment.sh (www container start)', () => {
    let dir: string;
    let conf: string;
    let html: string;
    let envDir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'mmp-env-'));
        conf = join(dir, 'default.conf');
        html = join(dir, 'html');
        envDir = join(dir, 'mmp-env');
        mkdirSync(html);
        writeFileSync(conf, read('nginx.conf'));
        writeFileSync(join(html, 'robots.txt'), read('public/robots.txt'));
        writeFileSync(join(html, 'sitemap.xml'), read('public/sitemap.xml'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const run = (env: Record<string, string>) =>
        spawnSync('sh', [SCRIPT], {
            encoding: 'utf8',
            // A clean environment: no MMP_* leaks in from the developer's shell.
            env: { PATH: process.env.PATH ?? '', MMP_NGINX_CONF: conf, MMP_HTML_ROOT: html, MMP_ENV_DIR: envDir, ...env },
        });

    it('production with nothing set changes no file at all', () => {
        const r = run({});
        expect(r.status, r.stderr).toBe(0);
        expect(readFileSync(conf, 'utf8')).toBe(read('nginx.conf'));
        expect(readFileSync(join(html, 'robots.txt'), 'utf8')).toBe(read('public/robots.txt'));
        expect(readFileSync(join(html, 'sitemap.xml'), 'utf8')).toBe(read('public/sitemap.xml'));
        expect(existsSync(envDir)).toBe(false);
    });

    it('production named explicitly changes no file either', () => {
        const r = run({ MMP_SITE_ENV: 'production', MMP_FIREBASE_PROJECT_ID: PROD_PROJECT });
        expect(r.status, r.stderr).toBe(0);
        expect(readFileSync(conf, 'utf8')).toBe(read('nginx.conf'));
        expect(existsSync(envDir)).toBe(false);
    });

    it('staging rewrites every production project id and nothing else', () => {
        const r = run({ MMP_SITE_ENV: 'staging', MMP_FIREBASE_PROJECT_ID: 'mmp-staging' });
        expect(r.status, r.stderr).toBe(0);
        const out = readFileSync(conf, 'utf8');
        expect(out).not.toContain(PROD_PROJECT);
        expect(out).toBe(read('nginx.conf').split(PROD_PROJECT).join('mmp-staging'));
        // The CSP report endpoint and the crawler proxy both moved.
        expect(out).toContain('csp-endpoint="https://us-central1-mmp-staging.cloudfunctions.net/cspReport"');
        expect(out).toContain('set $join_fn "us-central1-mmp-staging.cloudfunctions.net";');
    });

    it('staging is never indexable: noindex header, deny-all robots.txt, no sitemap', () => {
        const r = run({ MMP_SITE_ENV: 'staging', MMP_FIREBASE_PROJECT_ID: 'mmp-staging' });
        expect(r.status, r.stderr).toBe(0);
        expect(readdirSync(envDir)).toEqual(['noindex.conf']);
        expect(readFileSync(join(envDir, 'noindex.conf'), 'utf8')).toBe('add_header X-Robots-Tag "noindex, nofollow" always;\n');
        expect(readFileSync(join(html, 'robots.txt'), 'utf8')).toBe('User-agent: *\nDisallow: /\n');
        expect(existsSync(join(html, 'sitemap.xml'))).toBe(false);
    });

    it.each([
        ['staging with no project named', { MMP_SITE_ENV: 'staging' }],
        ["staging pointed at production's project", { MMP_SITE_ENV: 'staging', MMP_FIREBASE_PROJECT_ID: PROD_PROJECT }],
        ['a non-production project served as production', { MMP_FIREBASE_PROJECT_ID: 'mmp-staging' }],
        ['an unknown environment name', { MMP_SITE_ENV: 'prod', MMP_FIREBASE_PROJECT_ID: 'mmp-staging' }],
        ['a project id that is not one', { MMP_SITE_ENV: 'staging', MMP_FIREBASE_PROJECT_ID: 'x/../evil' }],
    ])('refuses to start for %s, and leaves the files alone', (_label, env) => {
        const r = run(env as Record<string, string>);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/40-mmp-environment:/);
        expect(readFileSync(conf, 'utf8')).toBe(read('nginx.conf'));
        expect(existsSync(join(html, 'sitemap.xml'))).toBe(true);
        expect(existsSync(envDir)).toBe(false);
    });

    it('is POSIX sh (the nginx:alpine image has no bash)', () => {
        expect(read('scripts/docker/40-mmp-environment.sh').split('\n')[0]).toBe('#!/bin/sh');
        expect(() => execFileSync('sh', ['-n', SCRIPT])).not.toThrow();
    });
});

describe('nginx.conf carries the per-environment header include', () => {
    const conf = read('nginx.conf');
    const INCLUDE = 'include /etc/nginx/mmp-env/*.conf;';

    it('in the server block and in every location that sets its own add_header', () => {
        // add_header does not inherit into a location that sets any add_header of
        // its own, so a location without the include would serve staging pages
        // with no noindex header.
        const locations = conf.split(/\n\s*location\s/).slice(1);
        const withHeaders = locations.filter((l) => /\badd_header\b/.test(l.split(/\n {4}\}/)[0]));
        expect(withHeaders.length).toBeGreaterThanOrEqual(4);
        for (const loc of withHeaders) {
            const body = loc.split(/\n {4}\}/)[0];
            expect(body, `location ${body.split('\n')[0]}`).toContain(INCLUDE);
        }
        const serverLevel = conf.split(/\n\s*location\s/)[0];
        expect(serverLevel).toContain(INCLUDE);
    });

    it('the Dockerfile installs the start script where the nginx entrypoint runs it', () => {
        const dockerfile = read('Dockerfile');
        expect(dockerfile).toContain('COPY scripts/docker/40-mmp-environment.sh /docker-entrypoint.d/40-mmp-environment.sh');
        expect(dockerfile).toMatch(/chmod 755 \/docker-entrypoint\.d\/40-mmp-environment\.sh/);
    });
});

describe('functions source names production only through lib/siteConfig.ts', () => {
    // Every other mention would bypass the per-environment value. The allowlist
    // is by exact line, so a new literal anywhere fails here.
    const ALLOWED = new Set([
        // The open-redirect allowlist keeps production's alternate hosts: a
        // staging project accepting them as return origins is harmless, and
        // production's list must not change.
        'functions/src/stripe.ts:        "https://marchmeleepools.com",',
        // A comment.
        'functions/src/cspReport.ts:        // marchmeleepools.com, this is on cloudfunctions.net), so Chrome sends a',
    ]);

    it('has no production literal outside the allowlist', () => {
        // spawnSync, not execFileSync: git grep exits 1 when nothing matches.
        // --untracked so a new file is checked before it is committed.
        const out = spawnSync(
            'git',
            [
                'grep', '--untracked', '-n', '-E', 'marchmeleepools\\.com|gridiron-gamble-uzuqo', '--',
                'functions/src/*.ts', ':!functions/src/__tests__/**', ':!functions/src/lib/siteConfig.ts',
            ],
            { cwd: root, encoding: 'utf8' },
        ).stdout.trim();
        const hits = out.split('\n').filter(Boolean).map((l) => l.replace(/^([^:]+):\d+:/, '$1:'));
        expect(hits.filter((h) => !ALLOWED.has(h))).toEqual([]);
    });
});
