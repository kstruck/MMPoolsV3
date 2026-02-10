#!/usr/bin/env python3
"""
Unofficial NotebookLM Controller
Uses Playwright to automate interactions with notebooklm.google.com
"""

import sys
import os
import argparse
import asyncio
from typing import Optional
from playwright.async_api import async_playwright, Page, expect

# Constants (Selectors - These are FRAGILE and may change!)
URL_BASE = "https://notebooklm.google.com"
SELECTORS = {
    "login_check": "text=Welcome to NotebookLM",
    "notebook_card": ".notebook-card",  # Hypothetical class
    "add_source_btn": "button[aria-label='Add source']",
    "text_source_btn": "text=Copied text",
    "input_box": "textarea[placeholder='Paste text']",
    "submit_source": "button:has-text('Insert')",
    "chat_input": "textarea[placeholder='Type a question...']",
    "chat_response": ".message-bubble.model", # Hypothetical class
}

async def login(page: Page):
    """Injects cookies to bypass login."""
    cookie_val = os.getenv("GOOGLE_LOGIN_COOKIE")
    if not cookie_val:
        print("❌ Error: GOOGLE_LOGIN_COOKIE not set in .env")
        sys.exit(1)
    
    # Inject cookies (simplified for brevity - real impl needs domain/path)
    await page.context.add_cookies([{
        "name": "__Secure-1PSID",
        "value": cookie_val,
        "domain": ".google.com",
        "path": "/"
    }])
    
    await page.goto(URL_BASE)
    # Check if we are redirected to login page (failure)
    try:
        await expect(page.locator(SELECTORS["add_source_btn"])).to_be_visible(timeout=5000)
    except:
        # If we can't see the "Add Source" button (or main UI), auth likely failed
        print("⚠️  Warning: specific UI element not found. Auth might have failed or UI changed.")

async def upload_source(notebook_name: str, text: str, title: str):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()
        
        await login(page)
        
        print(f"📂 Opening notebook: {notebook_name}...")
        # Navigation logic (Clicking the notebook card)
        # In a real script, we'd iterate cards to match the name
        await page.click(f"text={notebook_name}") 
        
        print("📝 Uploading source...")
        await page.click(SELECTORS["add_source_btn"])
        await page.click(SELECTORS["text_source_btn"])
        
        await page.fill(SELECTORS["input_box"], f"{title}\n\n{text}")
        await page.click(SELECTORS["submit_source"])
        
        # Wait for processing
        await page.wait_for_timeout(3000) 
        print("✅ Source uploaded successfully.")
        
        await browser.close()

async def query_notebook(notebook_name: str, query: str):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await login(page)
        
        await page.click(f"text={notebook_name}")
        
        print(f"❓ Asking: {query}")
        await page.fill(SELECTORS["chat_input"], query)
        await page.press(SELECTORS["chat_input"], "Enter")
        
        # Wait for response (simplified)
        await page.wait_for_selector(SELECTORS["chat_response"])
        
        # Extract last response
        responses = await page.locator(SELECTORS["chat_response"]).all_text_contents()
        print(f"🤖 Response: {responses[-1]}")
        
        await browser.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command")
    
    # Upload Command
    up = subparsers.add_parser("upload")
    up.add_argument("--notebook", required=True)
    up.add_argument("--content", required=True)
    up.add_argument("--source-name", required=True)
    
    # Query Command
    q = subparsers.add_parser("query")
    q.add_argument("--notebook", required=True)
    q.add_argument("--query", required=True)
    
    args = parser.parse_args()
    
    if args.command == "upload":
        asyncio.run(upload_source(args.notebook, args.content, args.source_name))
    elif args.command == "query":
        asyncio.run(query_notebook(args.notebook, args.query))
    else:
        parser.print_help()
