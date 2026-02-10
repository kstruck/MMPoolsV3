---
name: skill-docx-architect
description: Comprehensive document creation, editing, and analysis with support for tracked changes, comments, and direct OOXML/XML manipulation.
---

# DOCX Architect SOP

## Capability Overview
This skill provides advanced tools for "Open Heart Surgery" on Microsoft Word (.docx) documents. It supports unpacking documents into raw XML, direct XML modification for complex formatting, and rebuilding valid .docx files. It also includes deep support for tracked changes, comments, and structure analysis.

## Tools (Scripts)
* **Doc Commander:** `python skills/skill-docx-architect/scripts/doc_tool.py [command] [args]`
    * *undiag <file.docx>:* Unpacks a .docx into a folder for analysis.
    * *repack <folder>:* Rebuilds an unpacked folder back into a .docx file.
* **OOXML Unpacker:** `python skills/skill-docx-architect/ooxml/scripts/unpack.py <file.docx> <dir>`
* **OOXML Packer:** `python skills/skill-docx-architect/ooxml/scripts/pack.py <dir> <file.docx>`

## Workflow

### 1. Document Analysis (Unpacking)
If you need to analyze comments, complex formatting, or metadata:
1.  Run `undiag` or `unpack.py` on the target file.
2.  Examine `word/document.xml` for structural details.

### 2. Document Creation & Editing
*   **New Documents:** Use JavaScript/TypeScript with `docx-js` (see `docx-js.md` for syntax).
*   **Existing Documents:**
    1.  Unpack the document.
    2.  Use the Python **Document library** (`scripts/document.py`) for OOXML manipulation.
    3.  Modify `document.xml` or other XML components.
    4.  Repack the document.

### 3. Redlining (Tracked Changes)
1.  **Extract Text:** Convert to markdown via `pandoc` to identify change points.
    ```bash
    pandoc --track-changes=all file.docx -o draft.md
    ```
2.  **Implementation:** Apply changes in batches (3-10 changes).
3.  **Minimal Edits:** Only mark changed text, preserving original RSIDs for unchanged runs.

---
## Code Style & Rules
- **Concise Logic:** Write minimal, efficient Python for XML manipulation.
- **Batching:** Process changes in logical groups to avoid script complexity.
- **Reference Docs:** Always read `ooxml.md` and `docx-js.md` before complex assembly.