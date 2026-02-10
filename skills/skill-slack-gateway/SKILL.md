---
name: skill-slack-gateway
description: Handles Slack Event Subscriptions (url_verification) and forwards mentions to n8n.
---

# Slack Gateway

## Capability Overview
This skill solves the "Side Channel" gap (Gap #2). Directly connecting Slack to n8n or Firebase can be difficult because Slack requires a 3s latency handshake (`url_verification`).

This skill provides a **middleware script** that:
1.  Handles the Slack challenge automatically (via slack_bolt).
2.  Listens for `@mentions` of your bot.
3.  Forwards the clean text payload to your N8n Webhook for processing.

## Tools (Scripts)
* **Gold Gateway:** `python skills/skill-slack-gateway/scripts/gateway_tool.py`
    * *Type:* Local Flask server (development) or Cloud Function template.
    * *Env Vars:* `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `N8N_WEBHOOK_URL`

## Workflow
1.  **Start the Gateway:** Run the script locally.
2.  **Expose URL:** Use `ngrok` or similar to expose port 3000.
3.  **Config Slack:** Set the Event Subscription URL to `https://your-ngrok.io/slack/events`.
4.  **Test:** Mention the bot: "@gtd-bot Add task to buy milk."
