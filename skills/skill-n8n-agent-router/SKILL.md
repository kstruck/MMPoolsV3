---
name: skill-n8n-agent-router
description: Intelligent triage system. Uses Gemini to classify raw text inputs (Task, Note, Idea) and extracts metadata (Dates, Priority) before routing to n8n for execution.
---

# n8n Agent Router

## Capability Overview
This skill acts as the "Pre-Processor" for your automation pipeline. Instead of sending raw, messy text to n8n, the Agent uses Gemini to:
1.  **Classify** the intent (Task vs. Note vs. Idea).
2.  **Extract** structured fields (Due Date, Project, Priority).
3.  **Route** the clean JSON to a specific n8n Webhook.

## Tools (Scripts)
* **Smart Router:** `python skills/skill-n8n-agent-router/scripts/router_tool.py [text] [optional_context]`
    * *Env Vars Required:* `GEMINI_API_KEY`, `N8N_WEBHOOK_URL`

## Workflow

### 1. Triage & Route
When the user says "Process this thought: [text]" or "Triage this":
1.  **Run Router:**
    ```bash
    python skills/skill-n8n-agent-router/scripts/router_tool.py "Remind me to call John on Friday about the Falcon project"
    ```
2.  **Output:** The script will print the Classification decision and the HTTP status of the n8n handoff.

## Classification Logic
* **Task:** Actionable items with a verb (Call, Write, Buy) or implied deadline.
    * *Fields:* `action`, `due_date`, `priority`, `project`.
* **Note:** Static information, facts, or meeting summaries.
    * *Fields:* `summary`, `tags`, `entities`.
* **Idea:** Abstract thoughts or future potential projects.
    * *Fields:* `concept`, `impact_score`.

## Error Handling
* **500 Error from n8n:** The webhook is down.
    * *Action:* Save the JSON payload to `.tmp/failed_routing.json` and tell the user to retry later.
* **Classification Low Confidence:**
    * *Action:* Ask the user for clarification before sending.
