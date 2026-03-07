import os
import requests
import sys

# Antigravity Skills use environment variables for secrets
API_KEY = os.getenv("OPENAI_API_KEY")

def call_codex(task, code_context=""):
    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }
    
    # Model optimized for code generation
    data = {
        "model": "gpt-4o", 
        "messages": [
            {"role": "system", "content": "You are a specialized code generation assistant within the Antigravity IDE."},
            {"role": "user", "content": f"Task: {task}\nCode context:\n{code_context}"}
        ],
        "temperature": 0.1 # Low temperature for consistent code
    }

    try:
        response = requests.post(url, headers=headers, json=data)
        response.raise_for_status()
        return response.json()['choices'][0]['message']['content']
    except Exception as e:
        return f"Error: {str(e)}"

if __name__ == "__main__":
    # Usage: python codex_sync.py "Your Task" "Your Code Snippet"
    if len(sys.argv) < 2:
        print("Usage: codex_sync <task_description> <optional_code>")
        sys.exit(1)

    task_desc = sys.argv[1]
    snippet = sys.argv[2] if len(sys.argv) > 2 else ""
    
    print(call_codex(task_desc, snippet))