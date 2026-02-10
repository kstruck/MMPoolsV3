---
name: skill-web-identity-scraper
description: Extracts brand identity, design systems, and UI components from websites using Firecrawl. Use when asked to "analyze branding," "audit UI/UX," or "reverse engineer a site's aesthetic."
allowed-tools: Read, Grep, Bash, Glob
---

# Web Identity Scraper Skill

This skill enables the automated extraction of visual identity and design tokens from any website. It is designed to help designers and developers "reverse engineer" the aesthetic of a site for inspiration or brand consistency.

## Capabilities
- **Design Token Extraction**: Pulls primary/secondary/accent colors, font families, and spacing units.
- **UI Insight Generation**: Identifies specific visual effects like glassmorphism, specific button stylings, and design "personality".
- **Asset Discovery**: Automatically identifies logos, favicons, and hero images.
- **Clean Content**: Provides a markdown version of the page content for context.

## Tools (Scripts)

| Tool | Command | Purpose |
|------|---------|---------|
| **Brand Scraper** | `python skills/skill-web-identity-scraper/scripts/firecrawl_brand_scraper.py <url>` | Scrapes design data from a URL via Firecrawl. |

## Workflow

When asked to "scrape a site's branding" or "analyze a website's UI":

1.  **Read SOP**: Review the [scrape_brand_identity.md](./references/scrape_brand_identity.md) guidelines.
2.  **Execute**: Trigger the execution script: `skills/skill-web-identity-scraper/scripts/firecrawl_brand_scraper.py`.
3.  **Review**: Check the resulting JSON in `.tmp/`.
4.  **Synthesize**: Incorporate the findings into a theme definition or design draft.
