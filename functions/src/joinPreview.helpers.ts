// Pure, dependency-free helpers for the /join/:id social preview.
// Kept separate from joinPreview.ts (which imports firebase) so they can be
// unit-tested without any Firebase mocks.

export const SITE = "https://www.marchmeleepools.com";
export const DEFAULT_IMG = `${SITE}/og-image.png`;

// SOCIAL link-unfurl crawlers only. Search engines (Googlebot/bingbot) are
// intentionally excluded: they render the SPA, where <RouteSEO> marks /join
// as noindex — invite links should get rich social previews but not be indexed.
const SOCIAL_CRAWLER = /(facebookexternalhit|Facebot|Twitterbot|Slackbot|Slack-ImgProxy|LinkedInBot|WhatsApp|Discordbot|TelegramBot|Pinterest|redditbot|vkShare|SkypeUriPreview|Embedly|W3C_Validator|nuzzel|Qwantify)/i;

export const TYPE_LABEL: Record<string, string> = {
    SQUARES: "Super Bowl squares",
    NFL_PICKEM: "NFL Pick'em",
    NFL_SURVIVOR: "NFL Survivor",
    NFL_MARGIN: "NFL Margin",
    BRACKET: "March Madness bracket",
    NFL_PLAYOFFS: "NFL Playoff",
    PROPS: "props",
};

export const esc = (s: string) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const isSocialCrawler = (ua: string | undefined): boolean => SOCIAL_CRAWLER.test(ua || "");

// Pool slug/id from a share path. Covers both the invite route (/join/:id) and
// the pool page (/pool/:id) — most share links in the app use /pool/.
export const extractPoolId = (path: string): string => {
    const m = (path || "").match(/\/(?:join|pool)\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : "";
};

// Build the per-pool Open Graph HTML served to social crawlers. `path` is the
// actual requested share path (e.g. "/pool/abc") so og:url/canonical match the
// shared link; it defaults to the /join form.
export const buildJoinPreviewHtml = (opts: { poolId: string; name?: string; type?: string; path?: string }): string => {
    const name = opts.name && opts.name.trim() ? opts.name.trim() : "a sports pool";
    const typeLabel = (opts.type && TYPE_LABEL[opts.type]) || "sports";
    const joinUrl = `${SITE}${opts.path || `/join/${opts.poolId}`}`;
    const title = `Join ${name} — March Melee Pools`;
    const desc = `You're invited to join ${name}, a ${typeLabel} pool. Make your picks and compete!`;

    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<meta name="robots" content="noindex, follow" />
<link rel="canonical" href="${esc(joinUrl)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="March Melee Pools" />
<meta property="og:url" content="${esc(joinUrl)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:image" content="${DEFAULT_IMG}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta name="twitter:image" content="${DEFAULT_IMG}" />
</head><body><p>${esc(desc)} <a href="${esc(joinUrl)}">Open the pool</a>.</p></body></html>`;
};
