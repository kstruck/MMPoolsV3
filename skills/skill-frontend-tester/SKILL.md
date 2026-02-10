---
name: skill-frontend-tester
description: Generates Vitest + React Testing Library tests. Uses static analysis to plan test cases and complexity.
---

# Frontend Testing Architect

## Capability Overview
This skill addresses the need for high-quality, standardized frontend tests. It replaces "guesswork" with a deterministic Analyze->Plan->Generate workflow.

## Tools (Scripts)
* **Test Planner:** `python skills/skill-frontend-tester/scripts/test_planner.py [target_file]`
    * *Input:* Path to a .tsx/.ts file.
    * *Output:* JSON dossier containing Complexity Score, Imports (to mock), and Suggested Scenarios.

## Workflow

### 1. Analyze the Component
When the user asks to "test" a file:
1.  **Run Planner:**
    ```bash
    python skills/skill-frontend-tester/scripts/test_planner.py ./src/components/Button.tsx
    ```
2.  **Review Dossier:** Look at the `Mocks Needed` and `Complexity`. If Complexity > 50, plan to split the test into multiple files or describe blocks.

### 2. Generate the Test
1.  **Read Template:** Read `templates/component-test.template.tsx`.
2.  **Draft Code:** Fill in the template using the data from the Planner.
    * **Rule:** NEVER mock base components (`@/components/base/*`). Import them real.
    * **Rule:** ALWAYS use `beforeEach`, not `afterEach`, for cleanup.

### 3. Verify
1.  **Run Test:** `pnpm test <file>`.
2.  **Fix:** If it fails, analyze the error and self-anneal.
