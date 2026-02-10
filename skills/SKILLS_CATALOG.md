# Antigravity Skills Catalog

This document provides a comprehensive overview of the specialized skills available in the `skills/` directory. Each skill is a self-contained capability that extends the Agent's specific abilities.

## Table of Contents

- [Architecture & Meta-Skills](#architecture--meta-skills)
- [Frontend Development](#frontend-development)
- [Backend & Fullstack](#backend--fullstack)
- [Testing & Quality](#testing--quality)
- [Design & UI](#design--ui)
- [AI & Automation](#ai--automation)
- [Documentation](#documentation)
- [Integrations](#integrations)

---

## Architecture & Meta-Skills

### [skill-architect](./skill-architect/SKILL.md)

**Description:** The meta-skill for building other skills. Use this when the user wants to create, update, or package a new capability for the Agent.
**Tools:** `init_skill.py`, `package_skill.py`, `quick_validate.py`
**Usage:** Scaffolding new skills following Antigravity standards.

### [skill-api-design-principles](./skill-api-design-principles/SKILL.md)

**Description:** Master REST and GraphQL API design principles.
**Usage:** Designing new APIs, reviewing specs, establishing standards.

### [skill-senior-architect](./skill-senior-architect/SKILL.md)

**Description:** Comprehensive architecture toolkit for designing scalable systems.
**Tools:**

- `architecture_diagram_generator.py`: Automated diagram scaffolding.
- `project_architect.py`: Analysis and optimization.
- `dependency_analyzer.py`: Advanced dependency analysis.

### [skill-command-development](./skill-command-development/SKILL.md)

**Description:** Guides the creation and management of slash commands for automated agent workflows.
**Usage:** Creating `.md` files in `.agent/commands/` with YAML configuration.

### [skill-lookup](./skill-lookup/SKILL.md)

**Description:** Discover, retrieve, and install reusable AI capabilities (skills).
**Tools:** `search_skills`, `get_skill` (via MCP).

---

## Frontend Development

### [skill-senior-frontend](./skill-senior-frontend/SKILL.md)

**Description:** Comprehensive frontend toolkit (React, Next.js, TS).
**Tools:**

- `component_generator.py`: Scaffolds components with best practices.
- `bundle_analyzer.py`: Analyzes bundle size and performance.
- `frontend_scaffolder.py`: Advanced frontend scaffolding.

### [skill-react-best-practices](./skill-react-best-practices/SKILL.md)

**Description:** Performance guidelines from Mastra Engineering.
**Key Focus:** Eliminating waterfalls, reducing bundle size, optimizing re-renders.

### [skill-vercel-react-best-practices](./skill-vercel-react-best-practices/SKILL.md)

**Description:** Vercel's official performance guidelines.
**Tools:** `react_auditor.py` (detects anti-patterns like hydration flickers).

### [skill-nextjs15-performance](./skill-nextjs15-performance/SKILL.md)

**Description:** Critical performance fixes for Next.js 15 (Waterfalls, Bundle Size, Server Actions).

### [skill-component-refactoring](./skill-component-refactoring/SKILL.md)

**Description:** Workflows for refactoring complex React components.
**Strategies:** Extract hooks, sub-components, simplify logic.

### [skill-firebase-pwa-offline](./skill-firebase-pwa-offline/SKILL.md)

**Description:** Scaffolds offline-first PWA architecture using Firebase.
**Tools:** `scaffold_pwa.py`

### [skill-web-design-guidelines](./skill-web-design-guidelines/SKILL.md)

**Description:** Checks against Web Interface Guidelines.

---

## Backend & Fullstack

### [skill-senior-backend](./skill-senior-backend/SKILL.md)

**Description:** Comprehensive backend toolkit (Node, Go, Python, Postgres).
**Tools:**

- `api_scaffolder.py`: Scaffolds APIs.
- `database_migration_tool.py`: Manages DB migrations.
- `api_load_tester.py`: Load testing.

### [skill-senior-fullstack](./skill-senior-fullstack/SKILL.md)

**Description:** Fullstack toolkit combining frontend and backend practices.
**Tools:**

- `fullstack_scaffolder.py`
- `project_scaffolder.py`
- `code_quality_analyzer.py`

### [skill-mcp-builder](./skill-mcp-builder/SKILL.md)

**Description:** Build Model Context Protocol (MCP) servers (Python/Node).
**Tools:** `evaluation.py` (Server harness).

---

## Testing & Quality

### [skill-lint-and-validate](./skill-lint-and-validate/SKILL.md)

**Description:** Automatic quality control and linting procedures.
**Tools:** `lint_runner.py`, `type_coverage.py`.
**Mandatory:** Run after every code modification.

### [skill-frontend-tester](./skill-frontend-tester/SKILL.md)

**Description:** Generates Vitest + React Testing Library tests.
**Tools:** `test_planner.py` (Analyzes complexity and suggests scenarios).

### [skill-code-review](./skill-code-review/SKILL.md)

**Description:** General code review assistance for local changes and PRs.
**Tools:** `check_style.py`

### [skill-frontend-code-review](./skill-frontend-code-review/SKILL.md)

**Description:** Frontend-specific review checklist and workflow.

### [skill-typescript-review](./skill-typescript-review/SKILL.md)

**Description:** TypeScript/JavaScript specific review focus (Types, Modern JS).

### [skill-verification](./skill-verification/SKILL.md)

**Description:** "Evidence before assertions" - enforces verified commands before claiming success.

---

## Design & UI

### [skill-frontend-design](./skill-frontend-design/SKILL.md)

**Description:** "Anti-Slop" UI philosophy. Requires distinct aesthetic vibes.
**Tools:** `theme_generator.py` (Generates design tokens).

### [skill-theme-factory](./skill-theme-factory/SKILL.md)

**Description:** Scaffolds production-ready React apps with specific "vibes".
**Tools:** `scaffold_ui.py` (Generates "Brutalist", "Luxury", etc. themes).

### [skill-tailwind-design-system](./skill-tailwind-design-system/SKILL.md)

**Description:** Build scalable design systems with Tailwind.
**Focus:** Design tokens, CVA components, responsive patterns.

### [skill-web-identity-scraper](./skill-web-identity-scraper/SKILL.md)

**Description:** Extracts brand identity and design tokens from websites.
**Tools:** `firecrawl_brand_scraper.py`

### [skill-brand-guidelines](./skill-brand-guidelines/SKILL.md)

**Description:** Apply Anthropic's official visual identity (Colors & Typography).

---

## AI & Automation

### [skill-gemini-structured](./skill-gemini-structured/SKILL.md)

**Description:** Extracts structured JSON (Tasks, Meeting Notes) from unstructured text/voice using Gemini.
**Tools:** `extract_tool.py`

### [skill-voice-transcriber](./skill-voice-transcriber/SKILL.md)

**Description:** Audio transcription using OpenAI Whisper or Groq.
**Tools:** `transcribe_tool.py`

### [skill-n8n-agent-router](./skill-n8n-agent-router/SKILL.md)

**Description:** Intelligent triage system. Classifies text and routes to n8n webhooks.
**Tools:** `router_tool.py`

### [skill-prompt-lookup](./skill-prompt-lookup/SKILL.md)

**Description:** Discover and improve AI prompts from a library.
**Tools:** `prompt_tool.py` (Search, Get, Improve).

### [skill-text-to-speech](./skill-text-to-speech/SKILL.md)

**Description:** Generates audio feedback from text (OpenAI TTS).
**Tools:** `tts_tool.py`

---

## Documentation

### [skill-doc-coauthoring](./skill-doc-coauthoring/SKILL.md)

**Description:** Workflow for co-authoring complex docs (PRDs, RFCs).
**Tools:** `scaffold_doc.py`

### [skill-update-docs](./skill-update-docs/SKILL.md)

**Description:** Next.js documentation updater guide.

### [skill-docx-architect](./skill-docx-architect/SKILL.md)

**Description:** Advanced manipulation of .docx files (XML editing, Unpack/Repack).
**Tools:** `doc_tool.py`, `unpack.py`, `pack.py`

---

## Integrations

### [skill-notebooklm-unofficial](./skill-notebooklm-unofficial/SKILL.md)

**Description:** Unofficial interface for Google NotebookLM (Upload & Query).
**Tools:** `notebook_tool.py`

### [skill-wrike-sync](./skill-wrike-sync/SKILL.md)

**Description:** Two-way sync between Capture App and Wrike.
**Tools:** `wrike_tool.py`

### [skill-slack-gateway](./skill-slack-gateway/SKILL.md)

**Description:** Middleware for Slack Event Subscriptions to n8n.
**Tools:** `gateway_tool.py`

### [skill-superpowers-marketplace](./skill-superpowers-marketplace/SKILL.md)

**Description:** Curated marketplace for Claude Code plugins (Superpowers, Elements of Style).
**Install:** `/plugin marketplace add obra/superpowers-marketplace`

### [skill-superpowers-brainstorming](./skill-superpowers-brainstorming/SKILL.md)

**Description:** Socratic design refinement (Superpowers). Explores user intent, requirements and design before implementation.

### [skill-superpowers-writing-plans](./skill-superpowers-writing-plans/SKILL.md)

**Description:** Create detailed implementation plans (Superpowers). Breaks work into bite-sized tasks.

### [skill-superpowers-test-driven-development](./skill-superpowers-test-driven-development/SKILL.md)

**Description:** RED-GREEN-REFACTOR cycle (Superpowers). Enforces test-first methodology.

### [skill-superpowers-systematic-debugging](./skill-superpowers-systematic-debugging/SKILL.md)

**Description:** Root cause analysis (Superpowers). 4-phase process: trace, defend, reproduce, fix.

### [skill-superpowers-subagent-driven-development](./skill-superpowers-subagent-driven-development/SKILL.md)

**Description:** Subagent orchestration (Superpowers). Iterative development with spec compliance review.

### [skill-superpowers-verification-before-completion](./skill-superpowers-verification-before-completion/SKILL.md)

**Description:** Evidence-based completion (Superpowers). Ensure fixes are verified before claiming success.

### [skill-superpowers-using-git-worktrees](./skill-superpowers-using-git-worktrees/SKILL.md)

**Description:** Parallel development branches (Superpowers). Isolates work in clean environments.

### [skill-superpowers-executing-plans](./skill-superpowers-executing-plans/SKILL.md)

**Description:** Batch execution of plans (Superpowers). Run multiple tasks with checkpoints.

### [skill-superpowers-dispatching-parallel-agents](./skill-superpowers-dispatching-parallel-agents/SKILL.md)

**Description:** Concurrent agent workflows (Superpowers). Managing multiple streams of work.

### [skill-superpowers-requesting-code-review](./skill-superpowers-requesting-code-review/SKILL.md)

**Description:** Pre-review checklist (Superpowers). Self-correction before human review.

### [skill-superpowers-receiving-code-review](./skill-superpowers-receiving-code-review/SKILL.md)

**Description:** Handling feedback (Superpowers). Structured response to code review.

### [skill-superpowers-finishing-a-development-branch](./skill-superpowers-finishing-a-development-branch/SKILL.md)

**Description:** Merge/PR decision workflow (Superpowers). Clean up and finalize work.

### [skill-superpowers-using-superpowers](./skill-superpowers-using-superpowers/SKILL.md)

**Description:** Guide to the Superpowers system (Superpowers). Meta-documentation.

### [skill-security-scanner](./skill-security-scanner/SKILL.md)

**Description:** Expert security auditor for vulnerability assessment, dependency scanning, and comprehensive hardening.
**Tools:** `scanner.py`, `update.sh`.
