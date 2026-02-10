# SOP: Scrape Brand Identity and UI Profiles

This directive outlines how to use the Firecrawl-based brand scraper to extract design tokens and visual identity from websites.

## Overview
The scraper uses the Firecrawl `/scrape` endpoint with custom schemas to extract not just branding data (colors, fonts), but also specific UI insights like glassmorphism, button shapes, and hover behaviors.

## Prerequisites
- A target website URL.
- `FIRECRAWL_API_KEY` configured in the `.env` file.

## Execution Steps

1. **Run the Scraper Script**
   Use the `execution/firecrawl_brand_scraper.py` script.
   ```powershell
   python execution/firecrawl_brand_scraper.py "https://example.com"
   ```

2. **Check the Output**
   The script saves a JSON profile in the `.tmp/` directory with the format `web_identity_[timestamp].json`.

3. **Locate Visual Assets**
   - The JSON output will contain a `screenshot_url`.
   - The `images` array contains URLs for logos, icons, and hero images.
   - The `branding` object contains colors, typography, and spacing.

## Data Structure
The resulting JSON includes:
- `branding`: Official brand colors, fonts, and spacing.
- `ui_insights`: LLM-extracted details on button styles and visual effects.
- `markdown`: Clean text content of the page.
- `metadata`: SEO and social sharing tags.

## Handling Failures
- **Empty JSON**: Verify the URL is accessible and the API key is valid.
- **Missing UI Details**: Some complex sites might block specific extraction; checking the `markdown` format can provide clues.
