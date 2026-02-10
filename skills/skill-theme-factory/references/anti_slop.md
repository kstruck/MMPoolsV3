# Anti-Slop Design Guidelines

To ensure the output feels "Engineered" and not "Generated," strictly follow these rules:

## 1. Typography Hierarchy
* **The Rule:** Never use a single font family for everything.
* **The Fix:** Pair a "Display" font (Serif or Heavy Sans) for Headers with a "Utility" font (Clean Sans or Mono) for Data.
* *Example:* `Playfair Display` (H1) + `Geist Mono` (Table Data).

## 2. Density & Spacing
* **The Rule:** Avoid "Airy, Centered Lists" (The standard LLM output).
* **The Fix:** Use **High Density** for tools (Dashboards) and **Dramatic Whitespace** for marketing.
* *Action:* Use `gap-1` and `text-xs` for data grids. Use `py-24` for hero sections.

## 3. Visual Depth
* **The Rule:** No flat cards with medium-gray shadows.
* **The Fix:** Use **Borders** (`border-border`) instead of shadows for a cleaner look, OR use hard shadows (`box-shadow: 4px 4px 0 #000`) for Brutalism.