---
name: skill-doc-coauthoring
description: A structured workflow for co-authoring complex technical documentation (PRDs, RFCs, Design Docs). Use this when the user needs to write a substantial document and wants a guided, iterative process.
---

# Documentation Architect

## Capability Overview
This skill guides the user through the **Drafting -> Refining -> Testing** lifecycle of documentation. It transforms the Agent from a passive chatter into an active editor.

## Workflow

### Stage 1: Context & Scaffolding
**Goal:** Establish the file structure and gather requirements.

1.  **Interrogation:** Ask the user:
    * What type of doc? (PRD, RFC, Tutorial, ADR)
    * Who is the reader?
    * What is the "One Big Idea"?
2.  **Scaffold:** Run the tool to create the file.
    * *Command:* `python skills/skill-doc-coauthoring/scripts/scaffold_doc.py <type> <filename>`
    * *Example:* `python skills/skill-doc-coauthoring/scripts/scaffold_doc.py prd docs/payment-api-spec.md`
3.  **Context Dump:** Ask the user to dump all raw notes. *Action:* Summarize these notes into a temporary file `docs/scratchpad.md` so they aren't lost.

### Stage 2: Section-by-Section Drafting
**Goal:** Write the content iteratively. Do not generate the whole doc at once.

1.  **Select a Section:** Start with the hardest section (usually "Technical Design" or "Requirements").
2.  **Draft:** Write the content directly into the target file using file editing tools.
3.  **Review:** Ask the user to review the specific changes in the IDE.
    * *User instruction:* "Please open `docs/payment-api-spec.md` and check the 'Security' section."
4.  **Iterate:** Refine based on feedback.

### Stage 3: The "Naive Reader" Test
**Goal:** Simulate a fresh reader to find gaps.

1.  **Persona Switch:** Explicitly state: "I am now reviewing `docs/payment-api-spec.md` as a reader who has NO context of our previous conversation."
2.  **Critique:** Read the file from disk (do not rely on context memory).
3.  **Report:** List 3-5 questions a reader would be confused by.
4.  **Fix:** ask the user for permission to apply fixes.

## Tools
* **Scaffolder:** `scripts/scaffold_doc.py` - Generates templates.
* **Templates:** `templates/*.md` - Source of the structures.

## Rules
* **Real Files Only:** Never write documentation in the chat window. Always write to a `.md` file.
* **One Section at a Time:** Prevent hallucinations by focusing on 50-100 lines at a time.
* **Keep a Scratchpad:** Store user ramblings in `docs/scratchpad.md` so the main doc stays clean.
