---
name: skill-typescript-review
description: Review TypeScript and JavaScript code changes for compliance with modern coding standards, type safety, and project-specific patterns. Use when reviewing pull requests or diffs.
allowed-tools: Read, Grep, Bash, Glob
---

# TypeScript/JavaScript Code Review SOP

## Intent
Use this skill when the user requests a deep-dive review of TypeScript or JavaScript files. Focus on type safety, architectural consistency, and performance patterns.

## Audit Commands

| Action | Command |
|--------|---------|
| **Type Check** | `npx tsc --noEmit` |
| **Lint Check** | `npm run lint` |
| **Fix Styles** | `npx eslint --fix <path>` |

## Code Review Guidelines

Review code changes with a primary focus on:

1.  **Type Safety**: Avoid `any` types. Ensure interfaces and types correctly describe the data shapes.
2.  **Modern TS/JS**: Use ES6+ features (destructuring, arrow functions, template literals) where appropriate.
3.  **Project Conventions**:
    *   Use functional components with hooks.
    *   Avoid barrel file imports for icons or heavy utilities.
    *   Maintain strict separation of concerns between UI components and logic hooks.
4.  **Documentation**: Verify that JSDoc comments are clear for exported functions and complex logic.
5.  **Error Handling**: Check for proper try-catch usage and safe handling of optional values (optional chaining `?.`).
