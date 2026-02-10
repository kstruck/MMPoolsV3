#!/usr/bin/env python3
"""
Documentation Scaffolder
Usage: python scaffold_doc.py <type> <filename>
Types: prd, rfc, adr, tutorial
"""

import sys
import os
from pathlib import Path

TEMPLATES = {
    "prd": """# Product Requirement Document (PRD)

## 1. Executive Summary
## 2. Problem Statement
## 3. Goals & Non-Goals
* **Goal:** ...
* **Non-Goal:** ...

## 4. User Stories
| Actor | Action | Outcome |
|-------|--------|---------|
| User  | ...    | ...     |

## 5. Functional Requirements
...

## 6. Success Metrics
...
""",
    "rfc": """# Request for Comments (RFC)

## 1. Summary
## 2. Motivation
## 3. Proposed Design
## 4. Alternatives Considered
## 5. Drawbacks
...

## 6. Unresolved Questions
...
""",
    "adr": """# Architecture Decision Record (ADR)

## Status
Proposed

## Context
## Decision
## Consequences
"""
}

def scaffold(doc_type, filename):
    path = Path(filename).resolve()
    
    # Create directory if needed
    path.parent.mkdir(parents=True, exist_ok=True)
    
    if path.exists():
        print(f"⚠️  File {filename} already exists. Aborting to prevent overwrite.")
        sys.exit(1)
        
    template = TEMPLATES.get(doc_type.lower())
    if not template:
        # Fallback generic template
        template = f"# Documentation: {doc_type.upper()}\n\n## Overview\n\n## Details\n"
        print(f"ℹ️  Unknown type '{doc_type}', using generic template.")

    path.write_text(template)
    print(f"✅ Created {doc_type.upper()} at: {path}")
    print(f"   You can now start editing this file.")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python scaffold_doc.py <type> <filename>")
        print("Types: prd, rfc, adr")
        sys.exit(1)
        
    scaffold(sys.argv[1], sys.argv[2])