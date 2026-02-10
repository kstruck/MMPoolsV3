---
name: skill-prompt-lookup
description: Discover, retrieve, and improve AI prompts using the prompts.chat API (via Python wrapper).
---

# Prompt Lookup Client

## Capability Overview
This skill gives the Agent access to a vast library of optimized prompts. Instead of guessing or writing prompts from scratch, the Agent can search the database and retrieve templates for coding, writing, and analysis.

## Tools (Scripts)
* **Prompt Client:** `python skills/skill-prompt-lookup/scripts/prompt_tool.py [command] [args]`
    * *Commands:*
        * `search <query>`: Find prompts by semantic match.
        * `get <id>`: Retrieve the full template for a specific ID.
        * `improve "<text>"`: Use AI to refine a raw prompt.

## Workflow

### 1. Discovery
When the user asks for a "prompt to do X" or "better way to ask Y":
1.  **Search:**
    ```bash
    python skills/skill-prompt-lookup/scripts/prompt_tool.py search "code review" --limit 5
    ```
2.  **Present:** Show the user the list of options (Title, Description, ID).

### 2. Retrieval
When the user selects a prompt, or if a ID is known:
1.  **Get:**
    ```bash
    python skills/skill-prompt-lookup/scripts/prompt_tool.py get "12345"
    ```
2.  **Fill Variables:** If the output contains variables like `${topic}`, ask the user to fill them or infer them from context.

### 3. Refinement
1.  **Improve:**
    ```bash
    python skills/skill-prompt-lookup/scripts/prompt_tool.py improve "Whrite me a song about code"
    ```
