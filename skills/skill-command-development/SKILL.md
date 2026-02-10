---
name: skill-command-development
description: Guides the creation and management of slash commands for automated agent workflows.
---

# Command Development SOP

## Capability Overview
Slash commands are frequently-used prompts defined as Markdown files. This skill enables the creation of powerful, reusable workflows using YAML frontmatter, dynamic arguments, file references, and bash execution.

## Key Features
* **YAML Frontmatter:** Configure tools (`allowed-tools`), models, and hints.
* **Dynamic Arguments:** Use `$ARGUMENTS` or positional `$1`, `$2` for flexibility.
* **File References:** Use `@path/to/file` to include file contents automatically.
* **Bash Integration:** Gather repository context using `!` syntax.

## Workflow

### 1. Identify Need
When a task is repetitive (e.g., "Review this PR", "Run these tests"), create a command.

### 2. Design the Command
1.  **Format:** Create a `.md` file in `.agent/commands/` (or equivalent).
2.  **Frontmatter:**
    ```yaml
    ---
    description: Quick summary for /help
    argument-hint: [required-arg]
    allowed-tools: Read, Grep
    ---
    ```
3.  **Prompt:** Write clear instructions for the agent (e.g., "Analyze the following file @$1...").

### 3. Organization
* Use subdirectories for namespacing (e.g., `ci/build.md`).
* Project commands reside in the workspace; personal commands in the user directory.

---
## Best Practices
- **Single Responsibility:** One command per task.
- **Agent Focus:** Write instructions for the agent, not messages for the human.
- **Validation:** Use bash checks to ensure files or arguments exist.
