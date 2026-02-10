import os
import json
import argparse
from datetime import datetime
from dotenv import load_dotenv
from firecrawl import Firecrawl

def scrape_web_identity(url):
    # Load environment variables
    load_dotenv()
    api_key = os.getenv("FIRECRAWL_API_KEY")
    
    if not api_key:
        print("Error: FIRECRAWL_API_KEY not found in .env file.")
        return

    firecrawl = Firecrawl(api_key=api_key)

    print(f"Scraping Identity for: {url}...")

    # Define the custom branding and extraction schema
    formats = ["markdown", "branding", "screenshot", "images"]
    
    # Custom extraction for UX/UI details
    extraction_schema = {
        "type": "object",
        "properties": {
            "ui_effects": {
                "type": "array",
                "description": "List of visual effects like glassmorphism, gradients, box-shadows, or complex animations.",
                "items": {"type": "string"}
            },
            "button_styles": {
                "type": "object",
                "description": "Details about button styles, shapes, and hover effects.",
                "properties": {
                    "shape": {"type": "string"},
                    "hover_behavior": {"type": "string"},
                    "gradient_usage": {"type": "boolean"}
                }
            },
            "design_language_personality": {
                "type": "string",
                "description": "The overall vibe: e.g., 'Modern SaaS', 'High-end Luxury', 'Minimalist Tech'."
            }
        },
        "required": ["ui_effects", "button_styles", "design_language_personality"]
    }

    try:
        # Perform the scrape
        result = firecrawl.scrape(
            url=url,
            formats=formats + [{"type": "json", "schema": extraction_schema}]
        )

        if result.get("success"):
            data = result.get("data", {})
            
            # Prepare output
            output = {
                "url": url,
                "timestamp": datetime.now().isoformat(),
                "metadata": data.get("metadata", {}),
                "branding": data.get("branding", {}),
                "ui_insights": data.get("json", {}),
                "images": data.get("images", []),
                "markdown": data.get("markdown", ""),
                "screenshot_url": data.get("screenshot", "")
            }

            # Save to .tmp
            timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"web_identity_{timestamp_str}.json"
            filepath = os.path.join(".tmp", filename)
            
            # Ensure .tmp exists (though it should from initialization)
            os.makedirs(".tmp", exist_ok=True)

            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(output, f, indent=4)

            print(f"Successfully scraped identity. Results saved to {filepath}")
            return filepath
        else:
            print(f"Scrape failed: {result.get('error', 'Unknown error')}")
            return None

    except Exception as e:
        print(f"An error occurred during scraping: {str(e)}")
        return None

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape web identity using Firecrawl")
    parser.add_argument("url", help="The URL of the website to scrape")
    args = parser.parse_args()

    scrape_web_identity(args.url)
