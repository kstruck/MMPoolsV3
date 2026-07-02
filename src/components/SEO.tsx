import React from 'react';

interface SEOProps {
    title: string;
    description: string;
    keywords?: string;
    url?: string;
    image?: string;
    type?: string;
    schemas?: object[];
    /** Private/app routes: keep them out of the index and skip social tags. */
    noindex?: boolean;
}

// React 19 natively hoists <title>/<meta>/<link> rendered anywhere in the tree
// into <head> (and dedupes <title>). We use that directly instead of
// react-helmet-async, which only reliably sets document.title under React 19.
export const SEO: React.FC<SEOProps> = ({
    title,
    description,
    keywords,
    url = 'https://www.marchmeleepools.com/',
    image = 'https://www.marchmeleepools.com/og-image.png',
    type = 'website',
    schemas = [],
    noindex = false
}) => {
    if (noindex) {
        return (
            <>
                <title>{title}</title>
                <meta name="robots" content="noindex, nofollow" />
                <link rel="canonical" href={url} />
            </>
        );
    }

    return (
        <>
            <title>{title}</title>
            <meta name="description" content={description} />
            {keywords && <meta name="keywords" content={keywords} />}
            <meta name="robots" content="index, follow" />
            <link rel="canonical" href={url} />

            {/* Open Graph / Facebook */}
            <meta property="og:type" content={type} />
            <meta property="og:url" content={url} />
            <meta property="og:title" content={title} />
            <meta property="og:description" content={description} />
            <meta property="og:image" content={image} />
            <meta property="og:image:width" content="1200" />
            <meta property="og:image:height" content="630" />

            {/* Twitter */}
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={title} />
            <meta name="twitter:description" content={description} />
            <meta name="twitter:image" content={image} />

            {/* JSON-LD structured data (valid anywhere in the document). */}
            {schemas.map((schema, index) => (
                <script
                    key={index}
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
                />
            ))}
        </>
    );
};
