---
name: skill-component-refactoring
description: Standardized workflow and patterns for refactoring complex React components to improve maintainability, testability, and performance.
---

# Component Refactoring SOP

## Capability Overview
This skill guides the agent in identifying and refactoring high-complexity React components. It focuses on reducing technical debt by applying proven patterns like hook extraction, sub-component isolation, and logic simplification.

## Complexity Thresholds
Components meeting any of these criteria should be considered for refactoring:
- **Complexity Score > 50** (as measured by `skill-frontend-tester` or `skill-vercel-react-best-practices`).
- **Line Count > 300**.
- **Nested Conditionals > 3 levels**.

## Core Refactoring Patterns

### 1. Extract Custom Hooks
**When:** Component has complex state, multiple `useEffect` calls, or business logic mixed with UI.
**Action:** Move logic to a `use<Feature>.ts` file.

### 2. Extract Sub-Components
**When:** Monolithic JSX with multiple distinct UI sections or repetitive patterns.
**Action:** Split into focused components in the same directory or a sub-folder.

### 3. Simplify Conditional Logic
**When:** Deeply nested ternaries or large `switch`/`if-else` blocks.
**Action:** Use lookup tables (objects/maps) and early returns.

### 4. Extract Data Logic
**When:** Component directly handles fetch calls or heavy data transformation.
**Action:** Move to services or data-fetching hooks (e.g., React Query).

## Workflow

### 1. Analysis
- Run `skill-frontend-tester` to get a complexity baseline.
- Identify "hotspots" (long functions, deep nesting).

### 2. Incremental Execution
- **One piece at a time:** Extract a single hook/component.
- **Verify:** Run type-checks, lints, and existing tests after each change.
- **Repeat:** Continue until complexity falls below threshold.

---
## Best Practices
- **No Over-Engineering:** Avoid creating tiny, single-use abstractions.
- **Preserve API:** Maintain props compatibility where possible to minimize breaking changes.
- **Context Split:** If using Context, split large providers into smaller, domain-specific ones.
