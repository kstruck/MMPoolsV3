---
name: skill-theme-factory
description: Scaffolds production-ready React applications with "Anti-Slop" design principles. Use this when the user wants to "build a frontend," "start a new app," or "create a dashboard" with a specific visual identity.
---

# Theme Factory

## Capability Overview
This skill is the "Builder" counterpart to the Web Identity Scraper. It takes a visual direction (or a scraped identity) and scaffolds a real **React + Vite + Tailwind** codebase.

## Core Philosophy: "No AI Slop"
We strictly avoid generic AI aesthetics.
* **Typography:** No default "Inter". We use distinct pairings (e.g., Playfair + Satoshi).
* **Layout:** No "Center Everything." We use asymmetry, density, and distinct grids.
* **Color:** No "Purple Gradients." We use cohesive, high-contrast palettes.

## Tools (Scripts)
* **Scaffolder:** `python skills/skill-theme-factory/scripts/scaffold_ui.py <project_name> --vibe <style>`
    * *Usage:* Generates the file structure, `tailwind.config.js`, and `globals.css` with the chosen variables.
    * *Vibes:* `luxury`, `brutalist`, `saas-clean`, `retro-pop`.

## Workflow
1.  **Define the Vibe:** Ask the user: "What is the aesthetic? (Luxury, Brutalist, Clean, Retro)" OR use data from the *Web Identity Scraper*.
2.  **Scaffold:** Run the script to create the project core.
    * `python skills/skill-theme-factory/scripts/scaffold_ui.py my-app --vibe luxury`
3.  **Refine:** Once the files are created, use the `references/shadcn_guide.md` to add specific components.

## Knowledge Base
* **[Anti-Slop Guidelines](./references/anti_slop.md)**: The strict rules for layout and typography.
* **[Shadcn Component List](./references/shadcn_guide.md)**: How to import and use the UI primitives.