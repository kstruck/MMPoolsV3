---
name: skill-architect
description: The meta-skill for building other skills. Use this when the user wants to create, update, or package a new capability for the Agent.
license: Apache-2.0
---

# Skill Architect

This skill provides the tooling and standards for extending the Agent's capabilities. It ensures all new skills follow the Antigravity directory structure and include necessary SOPs.

## The Antigravity Skill Standard
A "Skill" is a persistent directory that teaches the Agent a specialized workflow. It transforms the Agent from a generalist into a specialist.

### Directory Structure
```text
skills/
└── <skill-name>/
    ├── SKILL.md           # The "Brain": Trigger definitions & high-level logic
    ├── scripts/           # The "Hands": Executable tools (Python, Node, Bash)
    ├── references/        # The "Library": Deep context, schemas, API docs
    └── assets/            # The "Output": Boilerplate templates to copy to user projects
```

## Tools (Scripts)

| Tool | Command | Purpose |
|------|---------|---------|
| **Skill Initializer** | `python skills/skill-architect/scripts/init_skill.py <name>` | Scaffolds a new skill directory with templates. |
| **Skill Packager** | `python skills/skill-architect/scripts/package_skill.py <name>` | Zips a skill for sharing or backup. |
| **Quick Validator** | `python skills/skill-architect/scripts/quuick_validate.py <path>` | Checks a skill directory for standard compliance. |

## Workflow

### 1. Creation
- Run `init_skill.py` to get the boilerplate.
- The Agent will ask for the "One Big Idea" for the skill.

### 2. Implementation
- Define triggers and logic in `SKILL.md`.
- Place supporting scripts in `scripts/`.
- Add deep-dive docs in `references/`.

### 3. Verification
- Use `quuick_validate.py` to ensure the structure is correct.
- Perform a dry run of the tool logic.