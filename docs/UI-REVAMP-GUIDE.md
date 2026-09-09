# MMP UI Revamp — Style Mapping Guide

Source of truth: `design/Marchmeleepools logo system/design_handoff_march_melee_ui/README.md`.
This file is the working recipe for converting existing screens to the new brand system.
**Visual refactor only — never change business logic, data flow, handlers, props, or copy.**

## Foundation (already wired)
- Fonts: Saira Condensed 500–800 (display), Barlow 400–700 (body) — loaded in `index.html`.
- Tokens in `tailwind.config.js`: `navy-{950,900,800,700,600}`, `gold-{700..300}`, `brandred-{700,600,500}`, `cream`, `ink`, plus CSS-var surfaces `page/surface/card/line/muted/faint`.
- CSS vars + `.dark` block in `src/index.css`. `ThemeContext` toggles `.dark` on `<html>` (persists, honors `prefers-color-scheme`).
- Utilities: `font-display`, `font-body`, `bg-gold-foil`, `shadow-card`, `shadow-card-hover`, `shadow-red-cta`, `shadow-panel`, `animate-live-pulse`, `animate-ticker`, `.num` (tabular-nums).
- Radii scale overridden: `rounded-sm`=6, `md`=10, `lg`=12, `xl`=16, `2xl`=18, `3xl`=24.

## Component library — `src/components/ui/` (use these, don't hand-roll)
`Button`/`ButtonLink` (primary red / premium gold-foil / secondary navy / ghost; sm/md/lg),
`Badge` (live/paid/unpaid/open/locked/winner/everyScore), `Tag` (nfl/ncaa/squares/survivor/margin/props),
`Input`/`Select`/`Toggle`/`Checkbox`/`RangeSlider`/`FieldLabel`/`FieldError`,
`StatTile`, `PoolCard`, `LeaderboardTable`/`RankChip`/`YouPill`, `Ticker`, `ThemeToggle`, `cn`.
Import via `./ui` barrel (adjust relative path).

## Two surface modes
1. **Navy chrome** (Header, Footer, hero, marketing homepage): always dark. Hardcode navy classes —
   `bg-navy-950`/`bg-navy-900`, cards `bg-navy-900 border border-[rgba(230,206,150,0.16)]`,
   body text `text-[#9FB0CC]`, bright text `text-[#EDF1F8]` or white, accents gold.
2. **Content body** (dashboards, wizards, tables, forms): theme-flipping. Use var-backed utilities —
   `bg-page`, `bg-surface`, `bg-card`, `border-line`, `text-muted`, `text-faint`,
   `text-[color:var(--text)]` for main text. Never hardcode slate.

## Color migration map (old → new)
| Old | New |
|---|---|
| `bg-slate-950`, `bg-slate-900`, `#0A192F` | `bg-navy-950` / `bg-navy-900` (chrome) or `bg-page`/`bg-surface` (content) |
| `bg-slate-800`, `bg-slate-800/50` | `bg-card` (content) or `bg-navy-900` (chrome) |
| `border-slate-700/800` | `border-line` (content) or `border-[rgba(230,206,150,0.16)]` (chrome) |
| `text-slate-400/500` | `text-muted` (content) or `text-[#9FB0CC]` (chrome) |
| `text-slate-100/200/300`, `text-white` (content) | `text-[color:var(--text)]` |
| orange (`#FF6600`, `orange-500`, `amber-*`) accents | gold (`gold-400/500`, `bg-gold-foil`) |
| emerald/green accents & CTAs | gold for premium/success-ish accents; keep `#0F7B4A` only for paid/success status |
| indigo/blue/purple/fuchsia accents | `navy-600/700` or gold; purple ONLY `#5B2A86` for Every-Score |
| red anywhere as background field | forbidden — red only for live/CTA/alerts/eliminations (`brandred-600`) |

## Type rules
- Headings/buttons/labels/badges/table headers/stat figures: `font-display font-bold uppercase` (+`font-extrabold` for hero/h1), tight leading (`leading-[0.9]`–`leading-none`), tracking: labels `tracking-[0.08em]`–`[0.16em]`, buttons `tracking-[0.05em]`.
- Body/forms/table cells: `font-body` (Barlow).
- EVERY changeable number (scores, money, odds, ranks, counts): add `num` class or `tabular-nums`.
- No emoji anywhere — replace with Lucide monoline icons. No new icon libs.

## Interaction rules
- Buttons/cards: 150ms ease transitions; hover lift `-translate-y-px` (buttons) / `-translate-y-1` + `shadow-card-hover` (cards).
- Live indicators: `animate-live-pulse` dot inside `Badge status="live"`.
- Leaderboards: rank 1 = `RankChip` gold-foil, current user row red-tinted + `YouPill`.

## Verify
`npx tsc -b` must pass. Do not touch tests, services, contexts (except styling), or firebase code.
