---
name: skill-gemini-structured
description: Uses Gemini 1.5 Pro/Flash native JSON mode to extract structured data from unstructured voice transcripts. Enforces strict schema validation for Wrike and NotebookLM payloads.
---

# Gemini Structured Extractor

## Capability Overview
This skill converts messy human speech into rigid database records. It uses the `response_schema` parameter in the Gemini API to guarantee valid JSON output, eliminating "hallucinated markdown" or conversational filler.

**Core Functions:**
1.  **Extract Task:** Converts voice notes into Wrike-ready Task objects (Title, Priority, Due Date).
2.  **Extract Meeting:** Summarizes long transcripts into structured Meeting Notes (Summary, Attendees, Action Items).

## Tools (Scripts)
*### 1. **Structured Extractor** (v2.0)
- **Tool**: `python skills/skill-gemini-structured/scripts/extract_tool.py [mode] [input] [--image path]`
- **Modes**: `task` (Wrike format) or `meeting` (Minutes format).
- **Input**: Raw text, a text file path, or an image file path (via `--image`).
- **Engine**: Gemini 2.0 Flash (Multimodal).

## Workflow

### 1. Task Capture
When the user provides a transcript or text for a task:
1.  **Run Extractor (Task Mode):**
    ```bash
    python skills/skill-gemini-structured/scripts/extract_tool.py task "Remind me to email Sarah next Tuesday high priority about the budget"
    ```
2.  **Output:** A structured JSON object ready for Wrike or other task managers.

### 2. Meeting Summarization
When the user provides a full meeting transcript:
1.  **Run Extractor (Meeting Mode):**
    ```bash
    python skills/skill-gemini-structured/scripts/extract_tool.py meeting "TRANSCRIPT_CONTENT"
    ```
2.  **Output:** A structured summary with attendees and action items.

## Schema Enforcement
- **Task**: `{ "title": str, "due_date": str, "priority": "High"|"Medium"|"Low", "notes": str }`
- **Meeting**: `{ "summary": str, "attendees": [str], "action_items": [{ "owner": str, "task": str }] }`
