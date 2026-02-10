#!/usr/bin/env python3
"""
Skill Packager - Creates a distributable .skill file (zip) of a skill folder.

Usage:
    python skills/skill-architect/scripts/package_skill.py <path/to/skill-folder> [output-directory]
"""

import sys
import zipfile
from pathlib import Path

# Try to import the validator. 
# This works if both scripts are in the same folder and run directly.
try:
    from quick_validate import validate_skill
except ImportError:
    # Fallback if run from a different context where quick_validate isn't in path
    sys.path.append(str(Path(__file__).parent))
    from quick_validate import validate_skill

def package_skill(skill_path, output_dir=None):
    """
    Package a skill folder into a .skill file.
    """
    skill_path = Path(skill_path).resolve()

    # 1. Validate existence
    if not skill_path.exists():
        print(f"❌ Error: Skill folder not found: {skill_path}")
        return None

    if not skill_path.is_dir():
        print(f"❌ Error: Path is not a directory: {skill_path}")
        return None

    if not (skill_path / "SKILL.md").exists():
        print(f"❌ Error: SKILL.md not found in {skill_path}")
        return None

    # 2. Run Validation
    print(f"🔍 Validating {skill_path.name}...")
    valid, message = validate_skill(skill_path)
    if not valid:
        print(f"❌ Validation failed: {message}")
        return None
    print(f"✅ {message}")

    # 3. Determine Output
    if output_dir:
        output_path = Path(output_dir).resolve()
        output_path.mkdir(parents=True, exist_ok=True)
    else:
        output_path = Path.cwd()

    # The output file will be named <skill-name>.skill
    zip_filename = output_path / f"{skill_path.name}.skill"

    # 4. Create Zip
    print(f"📦 Packaging into {zip_filename}...")
    try:
        with zipfile.ZipFile(zip_filename, 'w', zipfile.ZIP_DEFL