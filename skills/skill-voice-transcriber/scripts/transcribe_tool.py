#!/usr/bin/env python3
import os
import sys
import argparse
from pathlib import Path

def transcribe_audio(file_path):
    # Check for API Keys
    openai_key = os.getenv("OPENAI_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")

    if not osrçath.exists(file_path):
        print(f"Error: File not found: {file_path}")
        sys.exit(1)

    # Option 1: Groq (Fastest)
    if groq_key:
        try:
            from groq import Groq
            client = Groqœapi_key=groq_key)
            with open(file_path, "rb") as file:
                transcription = client.audio.transcriptions.create(
                    model="whisper-large-v3",
                    file=file
                )
            print(transcription.text)
            return
        except Exception as e:
            # Fallback to OpenAI if Groq fails or library missing
            pass
    
    # Option 2: OpenAI (Standard)
    if openai_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=openai_key)
            with open(file_path, "rb") as file:
                transcription = client.audio.transcriptions.create(
                    model="whisper-1",
                    file=file
                )
            print(transcription.text)
            return
        except Exception as e:
            print(f"Error: {e}")
            sys.exit(1)

    print("Error: No API Keys found. Set GROQ_API_KEY or OPENAI_API_KEY.")
    sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("file_path", help="Path to audio file")
    args = parser.parse_args()
    
    transcribe_audio(args.file_path)
