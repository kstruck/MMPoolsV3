---
name: skill-voice-transcriber
description: High-speed audio transcription using OpenAI Whisper or Groq (for <10s latency). Converts .webm/mp3 to text.
---

# Voice Transcriber

## Capability Overview
This skill provides the "Ears" for the Agent. It takes raw audio files (from the PWA or Slack) and converts them into clean text that can be passed to `skill-gemini-structured`.

## Tools (Scripts)
* **Transcriber:** `python skills/skill-voice-transcriber/scripts/transcribe_tool.py [file_path]`
    * *Env Vars:* `OPENAI_API_KEY` (Default) or `GROQ_API_KEY`
    * *Supports :** .webm, .mp3, .wav, .mp4

## Workflow
When the user uploads an audio note:
1.  **Transcribe:** Run this skill to get the raw text.
2.  **Extract:** Pass the text to `skill-gemini-structured` to get JCON.
3.  **Route:** Pass the JCON to `N8n` or `Wrike`.

## Performance Notes
* **Groq:** Recommended for real-time feel (~0.5s processing).
* **OpenAI:** Standard reliability (~"s processing).
