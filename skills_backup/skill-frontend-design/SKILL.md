---
name: skill-frontend-design
description: A design system and philosophy for creating "Anti-Slop" UIs. Use this when the user asks for a website, landing page, or component and wants it to look professional, distinctive, or high-design.
---

# Frontend Design Architect

## Capability Overview
This skill forces the Agent to break out of the "Generic Bootstrap/Tailwind" look. It requires picking a distinct **Aesthetic Vibe** before writing code.

## Knowledge Base (References)
* **[The Design Manifesto](./references/design_manifesto.md)**: **CRITICAL READ.** Contains the rules for "No AI Slop," typography choices, and motion principles.

## Tools
* **Theme Generator:** `python skills/skill-frontend-design/scripts/theme_generator.py <vibe>`
    * *Usage:* Generates a `tailwind.config.js` or CSS variable set for a specific aesthetic (e.g., `brutalist`, `luxury`, `retro`).

## Workflow

### Step 1: Define the Vibe
Before writing a single line of JSX, you must define the **Aesthetic Direction** in the chat:
* **Purpose:** Who is this for?
* **Vibe:** (e.g., *Brutalist, Luxury, Cyberpunk, Editorial*)
* **Differentiation:** What is the one "Unforgettable" detail?

### Step 2: Generate the Tokens
Do not guess colors. Run the tool to get a cohesive palette:
* `python skills/skill-frontend-design/scripts/theme_generator.py luxury`
* *Action:* Copy the output JSON/CSS into the project's config file (e.g., `tailwind.config.js`).

### Step 3: Implementation Rules
1.  **Typography:** Never use default sans-serif. Use the fonts defined in the Manifesto.
2.  **Layout:** Avoid "Center Everything." Use asymmetry or rigid grids defined in the Vibe.
3.  **Motion:** If using React, use `framer-motion` for staggering. If HTML/CSS, use `transition-all`.