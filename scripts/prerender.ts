/**
 * Build-time prerender for the CSR SPA.
 *
 * Social crawlers (Facebook/Slack/iMessage/etc.) and search bots do not run JS,
 * so per-page <title>/description/OG/canonical/JSON-LD must exist in the served
 * HTML. This reads the built dist/index.html and writes a per-route
 * dist/<route>/index.html with that route's head tags baked in (from the same
 * src/seoConfig.ts the runtime uses — single source of truth).
 *
 * The <body> stays the SPA shell: Google renders JS for full content, and no-JS
 * crawlers get correct head metadata. Firebase Hosting / nginx serve
 * dist/<route>/index.html for /<route> via their existing SPA fallback rules.
 *
 * Run: `tsx scripts/prerender.ts` (wired as `npm run build:static`).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEO_CONFIG, SITE_URL, DEFAULT_OG_IMAGE } from '../src/seoConfig';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(scriptDir, '../dist');
const templatePath = resolve(distDir, 'index.html');

const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Replace the content="" of a <meta name|property="key"> tag, if present.
function setMeta(html: string, attr: 'name' | 'property', key: string, value: string): string {
    const re = new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`, 'i');
    if (re.test(html)) return html.replace(re, `$1${escapeHtml(value)}$2`);
    // Not in the template — inject before </head>.
    return html.replace('</head>', `  <meta ${attr}="${key}" content="${escapeHtml(value)}" />\n</head>`);
}

function renderRoute(path: string, template: string): string {
    const seo = SEO_CONFIG[path];
    const url = `${SITE_URL}${path === '/' ? '/' : path}`;
    let html = template;

    // <title>
    html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(seo.title)}</title>`);

    // Core + social meta
    html = setMeta(html, 'name', 'description', seo.description);
    html = setMeta(html, 'property', 'og:title', seo.title);
    html = setMeta(html, 'property', 'og:description', seo.description);
    html = setMeta(html, 'property', 'og:url', url);
    html = setMeta(html, 'name', 'twitter:title', seo.title);
    html = setMeta(html, 'name', 'twitter:description', seo.description);

    // Per-route canonical + optional keywords + JSON-LD, injected before </head>.
    const head: string[] = [`  <link rel="canonical" href="${url}" />`];
    if (seo.keywords) head.push(`  <meta name="keywords" content="${escapeHtml(seo.keywords)}" />`);
    for (const schema of seo.schemas ?? []) {
        head.push(`  <script type="application/ld+json">${JSON.stringify(schema)}</script>`);
    }
    html = html.replace('</head>', `${head.join('\n')}\n</head>`);

    return html;
}

const template = readFileSync(templatePath, 'utf8');
if (!template.includes(DEFAULT_OG_IMAGE)) {
    console.warn('[prerender] dist/index.html is missing the default OG image — build first.');
}

let count = 0;
for (const path of Object.keys(SEO_CONFIG)) {
    const html = renderRoute(path, template);
    if (path === '/') {
        writeFileSync(templatePath, html); // root index.html = homepage + SPA fallback
    } else {
        const outDir = resolve(distDir, `.${path}`);
        mkdirSync(outDir, { recursive: true });
        writeFileSync(resolve(outDir, 'index.html'), html);
    }
    count++;
}

console.log(`[prerender] Wrote ${count} route HTML files to dist/.`);
