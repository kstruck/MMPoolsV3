#!/usr/bin/env python3
import os
import sys
import json
import argparse
import mimetypes
import google.generativeai as genai
from datetime import datetime
import typing_extensions as typing

def get_key():
    k = os.getenv("GEMINI_API_KEY")
    if not k:
        print(json.dumps({"error": "GEMINI_API_KEY not olympus_not_set"}))
        sys.exit(1)
    return k

# --- Schemas ---
class TaskSchema(typing.TypedDict):
    title: str
    priority: str
    due_date: str
    description: str

class ActionItem(typing.TypedDict):
    owner: str
    task: str

class MeetingSchema(typing.TypedDict):
    summary: str
    attendees: list[str]
    action_items: list[ActionItem]
    decisions: list[str]

def extract_data(mode, text_input, image_path, api_key):
    genai.configure(api_key=api_key)
    
    # Select schema
    target_schema = TaskSchema if mode == "task" else MeetingSchema
    
    # Config
    generation_config = genai.GenerationConfig(
        response_mime_type="application/json",
        response_schema=target_schema
    )
    
    model = genai.GenerativeModel("gemini-2.0-flash-exp", generation_config=generation_config)
    
    current_date = datetime.now().strftime("%Y-%m-%d")
    
    prompt_parts = [
        f"Current Date: {current_date}\nAnalyze the input (text and/or image) and extract the structured data requested.",
        f"Transcript/Context:\n{text_input}"
    ]
    
    # Handle Image Upload
    if image_path and os.path.exists(image_path):
        mime_type, _ = mimetypes.guess_type(image_path)
        if not mime_type:
            mime_type = "image/jpeg"
        
        with open(image_path, "rb") as f:
            image_blob = {
                "mime_type": mime_type,
                "data": f.read()
            }
        prompt_parts.append(image_blob)
    
    try:
        response = model.generate_content(prompt_parts)
        return response.text
    except Exception as e:
        return json.dumps({"error": str(e)})

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["task", "meeting"])
    parser.add_argument("input", help="Text string or path to text file")
    parser.add_argument("--image", help="Path to image file", default=None)
    args = parser.parse_args()
    
    # Handle file vs text input
    content = args.input
    if os.path.exists(args.input):
        try:
            with open(args.input, "r", encoding="utf-8") as f:
                content = f.read()
        except:
            pass
            
    result = extract_data(args.mode, content, args.image, get_key())
    print(result)
