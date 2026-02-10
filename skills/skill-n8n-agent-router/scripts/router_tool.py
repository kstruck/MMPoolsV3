#!/usr/bin/env python3
import os
import sys
import json
import argparse
import requests
import google.generativeai as genai
from datetime import datetime
from dotenv import load_dotenv

def get_env_var(name):
    # Try to load .env if it exists
    load_dotenv()
    val = os.getenv(name)
    if not val:
        print(f"❌ Error: {name} not set in .env")
        sys.exit(1)
    return val

def classify_text(text, api_key):
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-2.0-flash')
    current_date = datetime.now().strftime("%Y-%m-%d %A")
    prompt = f'''You are a GTD Triage Agent. Current Date: {current_date}
    Input: "{text}"
    Task: Classify into ["Task", "Note", "Idea"] and extract fields.
    Return ONLY raw JSON.
    Schema Task: {{ "type": "Task", "confidence": float, "data": {{ "action": str, "due_date": str, "priority": str, "project": str }} }}
    Schema Note: {{ "type": "Note", "confidence": float, "data": {{ "summary": str, "tags": [str] }} }}
    Schema Idea: {{ "type": "Idea", "confidence": float, "data": {{ "concept": str, "impact": str }} }}
    '''
    try:
        response = model.generate_content(prompt)
        clean = response.text.replace("```json", "").replace("```", "").strip()
        return json.loads(clean)
    except Exception as e:
        print(f"❌ Classification Failed: {e}")
        sys.exit(1)

def send_to_n8n(payload, url):
    try:
        print(f"🚀 Sending {payload['type']} to n8n...")
        resp = requests.post(url, json=payload, timeout=10)
        print(f"✅ Status: {resp.status_code}")
    except Exception as e:
        print(f"❌ Network Error: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("text")
    args = parser.parse_args()
    key = get_env_var("GEMINI_API_KEY")
    url = get_env_var("N8N_WEBHOOK_URL")
    data = classify_text(args.text, key)
    data["source"] = "antigravity_cli"
    print(json.dumps(data, indent=2))
    send_to_n8n(data, url)
