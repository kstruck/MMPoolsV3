# Prompt to give Claude Code

Paste the block below into Claude Code, with this whole `design_handoff_march_melee_ui/` folder present in your repo (e.g. `D:\march-melee-pools\design\`).

---

I'm revamping the UI look-and-feel of **March Melee Pools** (marchmeleepools.com) — a premium, real-time sports-pool platform (NFL pick'em/survivor/margin, NCAA brackets, Gameday Squares, prop sheets). Stack: **React 19 + TypeScript + Tailwind CSS** on **Firebase**. This is a **visual/UI refactor only** — do not change business logic, scoring engines, or data flow.

A complete design system is in `./design/design_handoff_march_melee_ui/`. **Read `README.md` first** — it's the source of truth. Use the exact tokens in `tokens/` (don't eyeball). The `references/*.dc.html` files are high-fidelity HTML prototypes to recreate in our React/Tailwind environment (not to ship directly); open them in a browser to see the intended look.

Do this in order:

1. **Foundation.** Add fonts (Google Fonts: **Saira Condensed** 700/800, **Barlow** 400–700). Merge `tokens/tailwind.tokens.js` into `tailwind.config` and set `darkMode: 'class'`. Add `tokens/tokens.css` (CSS vars + `.dark` block) globally. Wire a theme provider that toggles the `.dark` class on the root, persists to localStorage, and honors `prefers-color-scheme` on first load. Note: **nav, hero, and footer stay dark navy in both themes** — only content surfaces flip.

2. **Component library.** Build reusable, typed components matching the style guide exactly: `Button` (primary/premium/secondary/ghost/disabled × sm/md/lg), `Badge`/status pill, `Tag`, form set (`Input`, `Select`, `Toggle`, `Checkbox`, `RangeSlider`), `StatTile`, `PoolCard`, `Table`/leaderboard, `Nav`, `Ticker`. Follow the exact colors, radii, typography, and hover/focus/error states in the README.

3. **Screens.** Refactor screen-by-screen (dashboard → pool detail → create-pool wizard → leaderboards → squares grid → brackets), swapping in the new components.

**Guardrails:** sportsbook-grade and clean; red is an accent only (live/CTA/alerts), never a background; all headings/buttons/labels in Saira Condensed UPPERCASE; `tabular-nums` on every score/money/odds/rank; monoline (Lucide) icons only, no emoji; favicon/small tiles use the "MM" gold-on-navy monogram, not the detailed crest.

Start with step 1 and show me the token wiring + a `Button` and `PoolCard` before continuing.
