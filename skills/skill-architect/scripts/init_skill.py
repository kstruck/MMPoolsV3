#!/usr/bin/env python3
"""
Skill Initializer - Creates a new Antigravity skill from template
"""

import sys
from pathlib import Path

# --- TEMPLATES UPDATED FOR ANTIGRAVITY ---

SKILL_TEMPLATE = """---
name: {skill_name}
description: [TODO: Precise trigger. When should the Agent use this? e.g., "Use when the user asks to deploy to AWS."]
---

# {skill_title}

## Capability Overview
[TODO: Briefly explain what this skill enables the Agent to do.]

## Tools (Scripts)
This skill utilizes the following executable tools. Prefer running these over manual text generation.

* **Tool Name**: `python skills/{skill_name}/scripts/example.py`
    * *Usage:* [TODO: When to run this]

## Knowledge Base (References)
* [Detailed Guide](./references/guide.md) - Read this for deep-dive instructions.
* [API Spec](./references/api.md) - Read this for endpoint definitions.

## Workflow
1.  [TODO: Step 1]
2.  [TODO: Step 2]
"""

EXAMPLE_SCRIPT = '''#!/usr/bin/env python3
"""
Example Tool for {skill_name}
In Antigravity, agents prefer deterministic tools over hallucinated steps.
"""

def main():
    print("Agent Tool: {skill_name} executing...")
    # TODO: Implement file operations, API calls, or math here.

if __name__ == "__main__":
    main()
'''

EXAMPLE_REFERENCE = """# Reference: {skill_title} Deep Dive

Store heavy documentation here. The Agent will read this file via RAG or direct file reading 
ONLY when it needs to answer specific questions, saving context window space.
"""

def title_case_skill_name(skill_name):
    """Convert hyphen-case to Title Case"""
    return ' '.join(word.capitalize() for word in skill_name.split('-'))

def init_skill(skill_name, path):
    """Creates the skill folder structure and default files"""
    
    # Ensure we are creating it inside the target path
    skill_dir = Path(path).resolve() / skill_name

    if skill_dir.exists():
        print(f"❌ Error: Skill directory already exists: {skill_dir}")
        return None

    try:
        # Create main directory
        skill_dir.mkdir(parents=True, exist_ok=False)
        print(f"✅ Created directory: {skill_dir}")
    except Exception as e:
        print(f"❌ Error creating directory: {e}")
        return None

    skill_title = title_case_skill_name(skill_name)
    skill_content = SKILL_TEMPLATE.format(skill_name=skill_name, skill_title=skill_title)

    try:
        # Write SKILL.md
        (skill_dir / 'SKILL.md').write_text(skill_content)
        
        # Create scripts folder + example
        scripts_dir = skill_dir / 'scripts'
        scripts_dir.mkdir()
        (scripts_dir / 'example.py').write_text(EXAMPLE_SCRIPT.format(skill_name=skill_name))
        
        # Create references folder + example
        ref_dir = skill_dir / 'references'
        ref_dir.mkdir()
        (ref_dir / 'guide.md').write_text(EXAMPLE_REFERENCE.format(skill_title=skill_title))
        
        # Create templates folder
        assets_dir = skill_dir / 'templates'
        assets_dir.mkdir()
        (assets_dir / '.keep').touch()

        print(f"✅ Created SKILL.md and resources")
    except Exception as e:
        print(f"❌ Error writing files: {e}")
        return None

    print(f"\n🚀 Skill '{skill_name}' is ready at {skill_dir}")
    print("Next: Edit SKILL.md to define the logic.")
    return skill_dir

def main():
    # Robust argument parsing
    if len(sys.argv) < 4 or sys.argv[2] != '--path':
        print("Usage: python init_skill.py <skill-name> --path <target-path>")
        print("Example: python init_skill.py my-new-skill --path skills/")
        sys.exit(1)