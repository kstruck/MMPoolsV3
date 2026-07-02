import React from 'react';
import { useLocation } from 'react-router-dom';
import { SEO } from './SEO';
import { getSeoForPath, SITE_URL } from '../seoConfig';

// Mounted once at the router root. Emits per-route <title>/description/canonical/
// OG/JSON-LD from the central SEO config, with the canonical derived from the
// current path (so no page can accidentally canonicalize to the homepage).
export const RouteSEO: React.FC = () => {
    const { pathname } = useLocation();
    const { seo, noindex } = getSeoForPath(pathname);

    const canonicalPath = pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    const url = `${SITE_URL}${canonicalPath === '/' ? '/' : canonicalPath}`;

    return (
        <SEO
            title={seo.title}
            description={seo.description}
            keywords={seo.keywords}
            url={url}
            schemas={seo.schemas}
            noindex={noindex}
        />
    );
};
