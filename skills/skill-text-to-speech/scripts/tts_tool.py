#!/usr/bin/env python3
import os
import sys
import argparse
from pathlib import Path

def generate_speech(text, output_path):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("Error: OPENAI_API_KEY not set")
        sys.exit(1)

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        
        response = client.audio.speech.create(
            model="tts-1",
            voice="alloy",
            input=text
        )
        
        response.stream_to_file(output_path)
        print(f"✅ Audio saved to: {output_path}")
    except Exception as e:
        print(f"Error generating audio: {e}")
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("text", help="Text to speak")
    parser.add_argument("--output", help="Path to save mp3", default="speech.mp3")
    args = parser.parse_args()
    
    generate_speech(args.text, args.output)
