---
name: nano-banana
description: Generates placeholder images for frontend designs and landing pages using Nano Banana Pro (Gemini 3 Pro). Provide a description of the image needed as an argument.
---
# !/bin/bash
set -e -E

# Ensure an argument is provided

if [ -z "$1" ]; then
  echo "Error: Please provide a description for the image."
  echo "Usage: antigravity run nano-banana 'description of image'"
  exit 1
fi

# Load API key from .env file (gitignored) — NEVER hardcode keys here

if [ -f "$(git rev-parse --show-toplevel 2>/dev/null)/.env" ]; then
  GEMINI_API_KEY=$(grep '^GEMINI_API_KEY=' "$(git rev-parse --show-toplevel)/.env" | cut -d '=' -f2)
elif [ -f ".env" ]; then
  GEMINI_API_KEY=$(grep '^GEMINI_API_KEY=' .env | cut -d '=' -f2)
fi

if [ -z "$GEMINI_API_KEY" ]; then
  echo "Error: GEMINI_API_KEY not found. Add it to your .env file."
  exit 1
fi
MODEL_ID="gemini-3-pro-image-preview"
GENERATE_CONTENT_API="streamGenerateContent"

# Create the JSON request, injecting the first argument ($1) as the prompt

cat << EOF > request.json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "$1"
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["IMAGE", "TEXT"],
    "imageConfig": {
      "image_size": "1K"
    }
  },
  "tools": [
    {
      "googleSearch": {}
    }
  ]
}
EOF

# Call the API

curl \
-X POST \
-H "Content-Type: application/json" \
"<https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:${GENERATE_CONTENT_API}?key=${GEMINI_API_KEY}>" -d '@request.json'
