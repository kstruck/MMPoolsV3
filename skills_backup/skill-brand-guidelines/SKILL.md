---
name: skill-brand-guidelines
description: Directs the Agent on how to apply Anthropic's official visual identity (Colors & Typography). Use this when the user asks to "style" a project, "make it look on-brand," or requests visual assets.
---

# Brand Guidelines

## Capability Overview
This skill provides the official design tokens for the Anthropic brand identity. It ensures consistent use of color, typography, and hierarchy across all generated artifacts (Web, Documents, Slides).

## Knowledge Base (References)
* **[Design Tokens](./references/design_tokens.md)**: Contains the exact HEX codes, font families, and usage rules. **Read this file first** before writing any CSS or styling code.

## Usage Workflows

### 1. Web Development (React/Tailwind)
When scaffolding a UI, do not guess colors.
1.  Read `references/design_tokens.md`.
2.  Create/Update `tailwind.config.js` with the brand colors (Dark, Light, Accent).
3.  Set the font family to Poppins (Headings) and Lora (Body).

### 2. Document Generation (Python/PPTX)
When writing scripts to generate documents:
1.  Import the HEX values from `references/design_tokens.md`.
2.  Use `RGBColor` in Python to strictly map these values.
3.  Ensure Headings are 24pt+ (Poppins) and Body is Lora.