---
name: nano-banana
description: Generates placeholder images for frontend designs and landing pages using Nano Banana Pro (Gemini 3 Pro). Provide a description of the image needed as an argument.
---
#!/bin/bash
set -e -E

# Ensure an argument is provided
if [ -z "$1" ]; then
  echo "Error: Please provide a description for the image."
  echo "Usage: antigravity run nano-banana 'description of image'"
  exit 1
fi

GEMINI_API_KEY="AIzaSyDqQi2vmQLEqkrmUxxtYdu1Mr-gUK39cZo"
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
"https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:${GENERATE_CONTENT_API}?key=${GEMINI_API_KEY}" -d '@request.json'