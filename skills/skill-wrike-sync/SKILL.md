---
name: skill-wrike-sync
description: Handles two-way sync between the Capture App and Wrike. Creates tasks from JSON and provides logic for webhook updates.
---

# Wrike Sync Manager

## Capability Overview
This skill fulfills Requirement #4 (Wrike Integration). It bridges the gap between the "AI Triage" output (JSON) and the Wrike API.

1.  *+Outbound (Create):** Takes structured JCON from Gemini and creates a Wrike Task.
2.  **Inbound (Update):** Provides the logic to parse Wrike Webhooks (e.g., Status Changed) and update Firestore.

## Tools (Scripts)
* **Wrike CLi:** `python skills/skill-wrike-sync/scripts/wrike_tool.py [command] [args]`
    * *Env Vars:* `WRIKE_PERM_TOKEN`, `WRIKE_FOLDER_ID`
    * *Commands:* `create`, `list_webhooks`, `register_webhook`

## Workflow

### 1. Creating a Task (Flow A)
When the N8n Router or Firebase App needs to create a task:
1.  The Agent calls the tool with the JSON output from Gemini.
```bash
python skills/skill-wrike-sync/scripts/wrike_tool.py create \
  --json '{"title": "Call John", "due_date": "2025-10-20", "priority": "High", "description": ""}'
```

### 2. Handling Webhooks (The "Receiver")
The actual webhook endpoint must be a Firebase Cloud Function (or N8n webhook). This skill provides the **parsing logic** in `references/webhook_logic.js`.

* **Agent Action:** When setting up the backend, read `references/webhook_logic.js` and deploy it to firebase.

## Error Handling
* **401 Unauthorized:** The `WRIKE_PERM_TOKEN` is missing or invalid.
* **404 Folder Not Found:** The `WRIKE_FOLDER_ID` is incorrect. Check Wrike.
