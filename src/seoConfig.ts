// Central per-route SEO metadata. Consumed by <RouteSEO /> (mounted once at the
// router root) so every public page gets a unique title/description/canonical
// and structured data without editing each page component.
//
// NOTE: this drives Google (which renders JS) and the build-time prerender.
// Social crawlers (Facebook/Slack/etc.) do NOT run JS — per-page previews for
// them require prerendering these routes or a bot-rewrite. See README/SEO notes.

export const SITE_URL = 'https://www.marchmeleepools.com';
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;

export interface RouteSeo {
    title: string;
    description: string;
    keywords?: string;
    schemas?: object[];
}

const homeSchemas = [
    {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        url: SITE_URL,
        name: 'March Melee Pools',
        description: "Easy online NFL Survivor, Weekly Pick'em, Margin pools and Super Bowl squares",
        potentialAction: {
            '@type': 'SearchAction',
            target: `${SITE_URL}/browse?q={search_term_string}`,
            'query-input': 'required name=search_term_string',
        },
    },
    {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'March Melee Pools',
        applicationCategory: 'WebApplication',
        operatingSystem: 'Web',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        description: 'Online platform for private NFL survivor, pick\'em, and margin of victory pools',
        url: SITE_URL,
    },
    {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [
            {
                '@type': 'Question',
                name: 'Is it free to start an NFL pool?',
                acceptedAnswer: { '@type': 'Answer', text: 'Yes! You can initialize a standard pool for free, featuring real-time scoreboard syncing.' },
            },
            {
                '@type': 'Question',
                name: 'How does NFL Survivor rebuying work?',
                acceptedAnswer: { '@type': 'Answer', text: 'If configured by the host, players can purchase rebuys before the specified deadline week directly inside their dashboard.' },
            },
            {
                '@type': 'Question',
                name: 'What is the Margin pool?',
                acceptedAnswer: { '@type': 'Answer', text: 'In Margin pools, you pick one team each week. Your score is their margin of victory (or defeat). Ties are broken using a 5-step negative burden cascade.' },
            },
        ],
    },
    // Organization is emitted statically in index.html — not repeated here.
];

// Path → metadata. Keys are exact pathnames (no trailing slash except root).
export const SEO_CONFIG: Record<string, RouteSeo> = {
    '/': {
        title: "March Melee Pools - Free NFL Survivor, Pick'em & Margin Pools",
        description: 'Host free NFL Survivor, Weekly Pick\'em, and Margin of Victory pools online. Real-time scoreboard integrations, automated tiebreaker sorting, and commission-free charity trackers.',
        keywords: "NFL Survivor Pool, Weekly Pick'em, Margin of Victory Pool, Super Bowl Squares, Office Football Pools, Online Pool Manager, free survivor pool host",
        schemas: homeSchemas,
    },
    '/gameday-squares': {
        title: 'Super Bowl Squares & Football Squares Pools - March Melee Pools',
        description: 'Create free Super Bowl squares and football squares pools with automatic random number assignment, live scoring, and per-quarter payouts. Run your office grid in minutes.',
        keywords: 'Super Bowl Squares, football squares, gameday squares, squares pool, office squares grid',
    },
    '/march-madness': {
        title: 'March Madness Bracket Pools - Run Your Bracket Challenge Online',
        description: 'Host a March Madness bracket pool with automatic scoring, real-time standings, and custom scoring rules. Free to start, easy to invite your group.',
        keywords: 'March Madness bracket pool, NCAA bracket challenge, bracket pool host, office bracket pool',
    },
    '/nfl-playoffs': {
        title: 'NFL Playoff Pools - Playoff Bracket & Confidence Pools',
        description: 'Run NFL playoff bracket and confidence ranking pools online with live scoring and automated standings. Free to create and share with your group.',
        keywords: 'NFL playoff pool, playoff bracket pool, NFL confidence pool, playoff pick pool',
    },
    '/pricing': {
        title: 'Pricing - March Melee Pools',
        description: 'Simple, transparent pricing for hosting sports pools. Start free, then pay one flat hosting fee per pool or buy a bundle. No commission on your pot.',
        keywords: 'sports pool pricing, pool hosting cost, squares pool fee',
    },
    '/about': {
        title: 'About March Melee Pools',
        description: 'Learn about March Melee Pools — a commission-free platform for hosting NFL pools, Super Bowl squares, and March Madness brackets with real-time scoring.',
    },
    '/charity': {
        title: 'Charity Sports Pools - Raise Money With Your Pool',
        description: 'Run a charity sports pool and donate a percentage of the pot to a cause. Built-in donation tracker and transparent, auditable payouts.',
        keywords: 'charity sports pool, fundraiser football pool, charity squares',
    },
    '/features': {
        title: 'Features - March Melee Pools',
        description: 'Live scoreboard syncing, a public pool finder, scenario simulators, a setup wizard, and secure auditable payouts. Everything you need to run a pool.',
        keywords: 'sports pool features, live scoring, pool manager tools',
    },
    '/how-it-works': {
        title: 'How It Works - Hosting a Sports Pool',
        description: 'A step-by-step guide to creating, sharing, and scoring your sports pool on March Melee Pools — from setup wizard to automated payouts.',
        keywords: 'how to run a sports pool, how to host squares, how to run a bracket pool',
    },
    '/browse': {
        title: 'Browse Public Sports Pools - March Melee Pools',
        description: 'Find and join public NFL pools, Super Bowl squares, and bracket challenges open to the community.',
        keywords: 'join public sports pool, find squares pool, open bracket pool',
    },
    '/scoreboard': {
        title: 'Live NFL Scoreboard - March Melee Pools',
        description: 'Follow live NFL scores that power automated pool scoring and standings on March Melee Pools.',
        keywords: 'live NFL scoreboard, NFL scores',
    },
    '/odds/super-bowl-squares': {
        title: 'Super Bowl Squares Odds - Best & Worst Numbers Explained',
        description: 'A data-backed look at Super Bowl squares odds: which number combinations win most often, why 0 and 7 dominate, and how payouts break down by quarter.',
        keywords: 'Super Bowl squares odds, best squares numbers, squares payout odds',
    },
    '/contact': {
        title: 'Contact - March Melee Pools',
        description: 'Get in touch with the March Melee Pools team for support, partnerships, or questions about hosting your pool.',
    },
    '/privacy': {
        title: 'Privacy Policy - March Melee Pools',
        description: 'How March Melee Pools collects, uses, and protects your data.',
    },
    '/terms': {
        title: 'Terms of Service - March Melee Pools',
        description: 'The terms governing your use of March Melee Pools.',
    },
};

// Default for any path not explicitly configured — private/app routes are
// treated as noindex so they never compete in search or get a wrong canonical.
export function getSeoForPath(pathname: string): { seo: RouteSeo; noindex: boolean } {
    const key = pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    const seo = SEO_CONFIG[key];
    if (seo) return { seo, noindex: false };
    return {
        seo: {
            title: 'March Melee Pools',
            description: 'Host and manage NFL pools, Super Bowl squares, and March Madness brackets.',
        },
        noindex: true,
    };
}
