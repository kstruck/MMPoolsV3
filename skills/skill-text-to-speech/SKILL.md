---
name: skill-text-to-speech
description: Generates audio feedback from text using OpenAI TTS. Fulfills the "Conversational" requirement.
---

# Text to Speech (TTS)

## Capability Overview
This skill provides the "Mouth" for the Agent. It allows the PWA to play back confirmations (e.g., "Okay, I've added that to Wrike"), making the experience feel truly conversational.

## Tools (Scripts)
* **Speaker:** `python skills/skill-text-to-speech/scripts/tts_tool.py "Message" [--output file.mp3]`
    * *Env Vars:* `OPENAI_API_KEY`
    * *Defaults:* OpenAI `tts-1`, voice `alloy`

## Workflow
1.  **Action Complete:** The system finishes processing a task.
2.  **Generate Audio:** Run this skill to create a short .mp3 confirmation.
3.  **Playback:** The PWA plays the blob to the user.
