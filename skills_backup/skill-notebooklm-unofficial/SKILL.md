---
name: skill-notebooklm-unofficial
description: Unofficial interface for Google NotebookLM. Allows the Agent to upload sources (PDF/Text) and query notebooks for RAG-style retrieval. WARNING: Relies on internal APIs/DOM structure and may break.
---

# NotebookLM (Unofficial)

## Capability Overview
This skill bridges the gap between the Agent and **Google NotebookLM**. Since there is no public API, this skill uses browser automation (Playwright) to interact with the web interface.

**Core Actions:**
1.  **Upload:** Push raw text or PDFs into a specific Notebook.
2.  **Query:** Ask questions to a Notebook and get citations back.
3.  **Check Health:** Verify if Google's DOM structure has changed (Breakage Detection).

## Knowledge Base (References)
* **[Fragility Guide](./references/fragility.md)**: Known selectors and failure modes. Read this if the script fails with "Element not found."

## Tools (Scripts)
* **Notebook Controller:** `python skills/skill-notebooklm-unofficial/scripts/notebook_tool.py [action] [args]`
    * *Env Vars Required:* `GOOGLE_LOGIN_COOKIE` (The `__Secure-1PSID` or similar auth cookie).

## Workflow

### 1. Setup (First Time Only)
The Agent cannot solve Captchas. The user *must* export their Google Cookies first.
1.  **Ask User:** "Please extract your `__Secure-1PSID` cookie from `notebooklm.google.com` and add it to `.env`."

### 2. Uploading Sources (Capture Flow)
When the user wants to "Save this note to NotebookLM":
1.  **Select Notebook:** If `NOTEBOOK_ID` isn't known, list notebooks first (if supported) or ask for the URL.
2.  **Run Upload:**
    ```bash
    python skills/skill-notebooklm-unofficial/scripts/notebook_tool.py upload \
      --notebook "Notebook Name or ID" \
      --content "The text to upload..." \
      --source-name "Meeting Notes 2023-10-27"
    ```

### 3. Querying (RAG Flow)
When the user asks "What did we decide about X?":
1.  **Run Query:**
    ```bash
    python skills/skill-notebooklm-unofficial/scripts/notebook_tool.py query \
      --notebook "Project Falcon" \
      --query "What is the launch date?"
    ```

## Error Handling (Self-Annealing)
* **Selector Errors:** If Playwright fails to find a button, the CSS class likely changed.
    * *Action:* Do NOT retry blindly. Update `references/fragility.md` with the failure log.
    * *Action:* Ask the user to "Visually inspect the NotebookLM UI" or provide a new HTML dump.
