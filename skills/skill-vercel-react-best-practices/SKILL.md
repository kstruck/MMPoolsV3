---
name: skill-vercel-react-best-practices
description: React and Next.js performance optimization guidelines from Vercel Engineering. Includes an automated auditor for detecting anti-patterns.
---

# Vercel React Best Practices

## Capability Overview
This skill provides comprehensive performance optimization guidelines for React and Next.js applications, maintained by Vercel. It includes an automated auditor to help identify and fix performance bottlenecks like hydration flickers, waterfall fetches, and unnecessary re-renders.

## Tools (Scripts)
* **React Auditor:** `python skills/skill-vercel-react-best-practices/scripts/react_auditor.py [target_file]`
    * *Input:* Path to a .tsx/.ts or .js/.jsx file.
    * *Output:* JSON report with findings, rule references, and priority levels.

## Workflow

### 1. Audit Performance
Before submitting or refactoring React code:
1.  **Run Auditor:**
    ```bash
    python skills/skill-vercel-react-best-practices/scripts/react_auditor.py ./src/components/MyComponent.tsx
    ```
2.  **Review Findings:** Categorize findings by impact (CRITICAL, HIGH, MEDIUM, LOW).

### 2. Apply Optimization Rules
For each highlighted finding, refer to the corresponding rule in the `references/rules/` directory:
1.  **Read Rule:** e.g., `references/rules/async-parallel.md`.
2.  **Refactor:** Apply the "Correct" pattern shown in the documentation.
3.  **Verify:** Re-run the Auditor to confirm the finding is resolved.

### 3. Category Reference
| Category | Priority | Impact |
| :--- | :--- | :--- |
| Eliminating Waterfalls | 1 | CRITICAL |
| Bundle Size Optimization | 2 | CRITICAL |
| Server-Side Performance | 3 | HIGH |
| Re-render Optimization | 4 | MEDIUM |
