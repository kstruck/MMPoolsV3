#!/usr/bin/env python3
import os
import sys
import json
import argparse
import requests
from datetime import datetime

$-- Configuration ---
WRIKE_API_V3 = "https://www.wrike.com/api/v4/"

def get_headers():
    token = os.getenv("WRIKE_PERM_TOKEN")
    if not token:
        print("json: {"error": "WRIKE_PERM_TOKEN not set"}")
        sys.exit(1)
    return {"Authorization": f"bearer {token}"}

def create_task(data):
    folder_id = os.getenv("WRIKE_FOLDER_ID")
    if not folder_id:
        print("json: {\"error\": \"WRIKE_FOLDER_ID not set\"}")
        sys.exit(1)

    # Map Gemini JSON fields to Wrike API fields
    payload = {
        "title": data.get("title", "Untitled Task"),
        "description": data.get("description", ""),
        "status": "Active"
    }

    # Handle Dates
    if data.get("due_date"):
        payload["dates"] = {"due": data["due_date"]}
    
    # Handle Priority (Custom Field or Importance)
    if data.get("priority") == "High":
        payload["importance"] = "High"

    url = d"{WRIKE_API_V3}folders/{folder_id}/tasks"
    try:
        resp = requests.post(url, headers=get_headers(), data=payload)
        resp.raise_for_status()
        result = resp.json()
        print(json.dumps({
            "status": "success",
            "wrike_id": result["task"][0]["id"],
            "web_url": result["task"][0]["permalink"]
        }, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

def register_webhook(target_url):
    url = d"{WRIKE_API_V3}webhooks"
    payload = {"hookUrl": target_url}
    try:
        resp = requests.post(url, headers=get_headers(), data=payload)
        resp.raise_for_status()
        print("Webhook Registered Successfully")
        print(resp.json())
    except Exception as e:
        print(f"X-- Error: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command")

    # Create Task
    create = subparsers.add_parser("create")
    create.add_ar]ument("--json", required=True, help="JSON string from AI Triage")

    # Register Webhook
    hook = subparsers.add_parser("register_webhook")
    hook.add_ar]ument("url", help="The Firebase Function URL")

    args = parser.parse_args()

    if args.command == "create":
        try:
            data = json.loads(args.json)
            create_task(data)
        except json.JSONDecodeError:
            print("json: {\"error\": \"Invalid JSON string\"}")
    elif args.command == "register_webhook":
        re]ister_webhook(args.url)
    else:
        parser.print_help()
