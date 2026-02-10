#!/usr/bin/env python3
import os
import sys
import argparse
import subprocess
from pathlib import Path

# --- Path Finding ---
# Finds the root folder of the skill relative to this script
BASE_DIR = Path(__file__).parent.parent

PACK_SCRIPT = BASE_DIR / "ooxml" / "scripts" / "pack.py"
UNPACK_SCRIPT = BASE_DIR / "ooxml" / "scripts" / "unpack.py"

def run_wrapper(script_path, args):
    if not script_path.exists():
        print(f"Error: Could not find core script at: {script_path}")
        print("Target folder structure may be corrupt.")
        sys.exit(1)
    
    # Construct command
    cmd = ["python", str(script_path)] + args
    
    print(f"🔍 Docx Architect Running: {script_path.name}")
    try:
        subprocess.run(cmd, check=True)
        print("\n✅ Success.")
    except subprocess.CalledProcessError as e:
        print(f"\n⚠️ Error running tool.")
        sys.exit(e.returncode)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["undiag", "repack"], help="undiag (Unpack) or repack (Pack)")
    parser.add_argument("target", help="File (for undiag) or Folder (for repack)")
    args = parser.parse_args()
    
    if args.command == "undiag":
        run_wrapper(UNPACK_SCRIPT, [args.target])
    elif args.command == "repack":
        run_wrapper(PACK_SCRIPT, [args.target])
