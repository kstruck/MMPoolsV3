#!/usr/bin/env python3
"""
Validator for Antigravity Skills
"""

import sys
import re
import yaml
from pathlib import Path

def validate_skill(skill_path):
    path = Path(skill_path)
    skill_md = path / 'SKILL.md'
    
    if not skill_md.exists():
        return False, "❌ Missing SKILL.md"

    content = skill_md.read_text()
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    
    if not match:
        return False, "❌ Missing YAML frontmatter (--- name: ... ---)"

    try:
        meta = yaml.safe_load(match.group(1))
    except yaml.YAMLError as e:
        return False, f"❌ Invalid YAML: {e}"

    if 'name' not in meta or 'description' not in meta:
        return False, "❌ Frontmatter must have 'name' and 'description'"

    # Check for executable scripts presence
    scripts_dir = path / 'scripts'
    if scripts_dir.exists() and any(scripts_dir.iterdir()):
        print("ℹ️  Scripts directory found (Good!)")
    else:
        print("⚠️  Warning: No scripts found. Consider adding tools for the agent.")

    return True, "✅ Skill structure is valid."

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: quick_validate.py <skill_directory>")
        sys.exit(1)
    
    valid, msg = validate_skill(sys.argv[1])
    print(msg)
    sys.exit(0 if valid else 1)