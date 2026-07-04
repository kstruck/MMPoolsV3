# Handoff: March Melee Pools — UI Look & Feel Revamp (v3)

## Overview
This package defines the complete visual language for **March Melee Pools** (marchmeleepools.com) — a premium, real-time sports-pool platform: NCAA March Madness brackets, the full NFL season suite (Weekly Pick'em, Survivor, Margin, Playoff Challenge), high-fidelity Gameday Squares, and custom Prop-Bet sheets. The goal is to apply this system across the existing app (React 19 + TypeScript + Tailwind CSS on Firebase) as a **visual/UI refactor** — no changes to business logic, scoring engines, or data flow.

## About the Design Files
The files in `references/` are **design references authored in HTML** — high-fidelity prototypes showing the intended look and behavior. They are **not** production code to copy verbatim. Recreate them in the app's existing React + TypeScript + Tailwind environment using its established component patterns. Two files:

- `references/March Melee Pools Style Guide.dc.html` — the full design system (logo usage, color, type, buttons, badges, forms, stat tiles, pool cards, nav, leaderboard).
- `references/March Melee Pools Home.dc.html` — the system applied to a marketing homepage, including a working light/dark theme toggle.

> These render as self-contained pages — open either `.dc.html` in a browser to view. (They rely on the sibling `support.js`; keep it alongside them.)

## Fidelity
**High-fidelity.** Final colors, typography, spacing, radii, and interaction states are all specified. Recreate the UI pixel-accurately using the codebase's existing libraries; use the exact tokens in `tokens/`.

## Design Tokens
Machine-readable tokens are provided — use these, don't eyeball from screenshots:
- `tokens/theme.ts` — colors, fonts, type scale, radii, shadows, layout as a TypeScript module.
- `tokens/tokens.css` — the same as CSS custom properties, with a `.dark` block.
- `tokens/tailwind.tokens.js` — a `theme.extend` snippet to merge into `tailwind.config`.

### Color (exact hex)
- **Navy** (foundation / dark chrome): `950 #0B1526` · `900 #0E1C34` · `800 #142A4C` (primary) · `700 #1A3B62` · `600 #24507F`
- **Gold** (trophy / premium): `700 #8C6D33` · `600 #B78F4A` · `500 #C9A867` · `400 #D9BC80` · `300 #E6CE96`; foil gradient `linear-gradient(180deg,#EBD49B,#C9A867,#A98038)`
- **Red** (sparing — live / primary CTA / alerts / eliminations): `700 #9E241F` · `600 #C4342E` · `500 #DA463F`
- **Light neutrals:** page `#F7F4EE` · paper `#FFFFFF` · ink `#131B2B` · muted `#5C6678` · faint `#8B93A3` · line `#E7E3D9`
- **Dark surfaces:** page `#0B1526` · surface `#0E1C34` · card `#152747` · ink `#EDF1F8` · muted `#9FB0CC` · line `rgba(230,206,150,0.16)`
- **Status:** Paid `#0F7B4A` on `#E4F5EC`/border `#BEE7D0` · Unpaid `#B4530A` on `#FBEEDD`/border `#F2D6B0` · Open `#142A4C` on `#E5EDF6`/border `#CBDCEC` · Winner `#8C6D33` on `#FBF3E0`/border `#EAD9A8` · Every-Score (Squares) `#FFFFFF` on `#5B2A86` · Live `#FFFFFF` on `#C4342E`.

### Typography
- **Display — Saira Condensed** (700/800), **always UPPERCASE**, tight leading (0.82–1.0). Used for headings, buttons, stat figures, labels, badges, table headers.
- **Body — Barlow** (400–700). Used for paragraphs, form fields, table cells.
- Apply `font-variant-numeric: tabular-nums` to **every** number that can change: scores, money, odds, ranks, counts.
- Scale: hero 74/800 · h1 46/800 · h2 44/700 · h3 24/700 · label 13/700 tracking .16em · button 16/700 tracking .05em · stat 40/700 · body 16/400 lh 1.6.

### Spacing / Radii / Shadows
- 4px base scale; section vertical rhythm ≈ 80px; content max-width **1200px**, 32px gutter.
- Radii: tags 6 · buttons/inputs 10 · large buttons 12 · panels 16 · cards 18 · hero/CTA banners 24 · pills 999.
- Shadows: card `0 2px 4px rgba(19,27,43,.04)`; card hover `0 14px 34px rgba(19,27,43,.14)`; red CTA `0 10px 26px rgba(196,52,46,.40)`; panel `0 18px 46px rgba(19,27,43,.10)`.

## Theming (light + dark)
Use Tailwind `darkMode: 'class'`. Themed **content** surfaces read from CSS vars (`--page`, `--surface`, `--card`, `--text`, `--text-muted`, `--line`) so a single `.dark` class on the root flips the whole body. **Nav, hero, and footer stay dark (navy chrome) in both themes** — only the content body flips. Persist the user's choice (localStorage) and honor `prefers-color-scheme` on first load.

## Components (recreate as reusable React components)
For each, match the reference exactly. States listed are required.

- **Button** — variants: `primary` (red-600 fill, white, shadow-red-cta), `premium` (gold foil gradient, navy-900 text), `secondary` (navy-800 fill, white), `ghost` (1.5px navy-800 border, fills navy on hover), `disabled` (cream fill, faint text, not-allowed). Sizes sm/md/lg → radius 8/10/12, padding 8×16 / 13×26 / 16×34. Label: Saira Condensed 700 uppercase, tracking .05em. Hover: lift `translateY(-1px)` + brighten.
- **Badge / Status pill** — pill radius, Saira Condensed 700 uppercase 13px tracking .08em. `Live` (red fill + pulsing white dot), `Paid`/`Unpaid`/`Open`/`Locked`/`Winner`/`Every Score` per status colors above.
- **Tag (sport/pool type)** — radius 6, 12px Saira Condensed 700 uppercase. NFL (navy fill), NCAA (gold-400 fill, navy text), Squares (red fill), Survivor/Margin/Prop (outline: 1.5px navy border).
- **Input / Select** — cream fill (`--page`), 1.5px `--line` border, radius 10, 12–14px padding; focus → navy-600 border + white fill; error → red-500 border + `#FCEEED` fill + red helper text. Labels: Saira Condensed 700 uppercase 12px tracking .08em. Include toggle switch (navy-800 track), checkbox (navy-800 fill + white check), and range slider (gold-foil fill, white thumb).
- **Stat tile** — `--card`/navy surface, radius 16; label (Saira uppercase 12px muted) + figure (Saira 700 40px, tabular-nums; gold-400 on navy, navy-800/red-600 on light) + optional delta (success green / muted) or progress bar.
- **Pool card** — radius 18, colored header bar keyed to sport (navy / gold-foil / red / dark), holds sport tag + status badge; body has title (Saira 700 uppercase 23–24px), one-line meta, two figures (pot in gold-700, entries in navy-800, tabular-nums), full-width CTA. Hover: `translateY(-4px)` + card-hover shadow.
- **Sticky nav** — navy-900 bar, full logo lockup left (crest + wordmark), centered links (Saira 600 uppercase 14px; active underline gold-500), right side: theme toggle (pill, outline), Log in, red primary CTA.
- **Leaderboard table** — Barlow body + tabular-nums; Saira uppercase 12px muted headers; rank chips (1 = gold-foil, others = subtle circle); highlighted "You" row (red tint) with red "You" pill; alternating row tint optional.
- **Hero / banner** — navy-950 base with layered radial gradients (red + navy + gold) and a faint 52px grid overlay; big Saira 800 headline (accent word in gold-400); supporting Barlow copy; primary + ghost CTAs; trust-stat row; live score ticker (marquee) pinned to the bottom edge.
- **Favicon / app icon** — the detailed crest loses legibility below ~64px. For favicons and small app tiles use the **"MM" monogram**: gold-foil letters on a navy gradient tile with a subtle gold inset hairline (see style guide §01). Use the full crest only at ≥96px.

## Interactions & Behavior
- Buttons/cards: 0.15–0.18s ease transitions on transform + shadow + background.
- Live indicators: pulsing dot, ~1.4–1.6s ease-in-out opacity loop.
- Ticker: horizontal marquee, ~32s linear infinite, duplicated content for seamless loop.
- Theme toggle: swaps the `.dark` class on root; persist to localStorage; smooth is optional.
- Icons: monoline (Lucide-style) only — trophy, shield, trending-up, brackets, grid, list-checks, zap, bot, mail. No emoji.

## Assets
In `references/assets/`:
- `mmp-logo-full.png` — full-color stacked logo (crest + wordmark + URL), transparent bg. Use on **light** backgrounds.
- `mmp-crest.png` — crest mark only, transparent bg. Reads well on **both** light and navy.
- On dark backgrounds, pair `mmp-crest.png` with a **live-text** wordmark (white "MARCH MELEE" / gold "POOLS") rather than the navy raster wordmark — see the homepage nav/hero for the exact treatment.
- The favicon **"MM" monogram** is pure CSS/text (no image needed) — see style guide §01.
- All logo assets were extracted from the client's master logo; recolor/skew is prohibited. Keep clearspace ≥ the trophy-cup height around the crest.

## Aesthetic Guardrails
Sportsbook-grade and clean. Red is an accent only — never a background field. No emoji. Saira Condensed is always uppercase with tight leading. Monoline icons only. Prefer flex/grid with `gap` over ad-hoc margins.

## Suggested Implementation Order
1. Wire tokens + fonts + `darkMode:'class'` + theme persistence.
2. Build the shared component library (Button, Badge, Tag, Input set, StatTile, PoolCard, Table, Nav, Ticker).
3. Refactor screen-by-screen (dashboard → pool detail → create-pool wizard → leaderboards → squares grid → brackets), swapping in the new components.

## Files in this bundle
- `README.md` (this file)
- `tokens/theme.ts`, `tokens/tokens.css`, `tokens/tailwind.tokens.js`
- `references/March Melee Pools Style Guide.dc.html`
- `references/March Melee Pools Home.dc.html`
- `references/support.js` (runtime needed to view the .dc.html files)
- `references/assets/mmp-logo-full.png`, `references/assets/mmp-crest.png`
