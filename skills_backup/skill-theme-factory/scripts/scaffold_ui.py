#!/usr/bin/env python3
"""
Theme Factory Scaffolder
Generates a React/Vite/Tailwind project with specific design tokens.
"""

import sys
import os
import json
import argparse
from pathlib import Path

# --- Design Tokens (The "Vibes") ---
THEMES = {
    "luxury": {
        "fontFamily": {'sans': ['"Satoshi"', 'sans-serif'], 'serif': ['"Playfair Display"', 'serif']},
        "colors": {'background': '#0a0a0a', 'foreground': '#ededed', 'primary': '#d4af37', 'radius': '0px'}
    },
    "brutalist": {
        "fontFamily": {'sans': ['"Courier Prime"', 'monospace'], 'serif': ['"Archivo Black"', 'sans-serif']},
        "colors": {'background': '#ffffff', 'foreground': '#000000', 'primary': '#ff3e00', 'radius': '0px'}
    },
    "saas-clean": {
        "fontFamily": {'sans': ['"Geist Sans"', 'sans-serif'], 'serif': ['"Geist Mono"', 'monospace']},
        "colors": {'background': '#ffffff', 'foreground': '#0f172a', 'primary': '#3b82f6', 'radius': '0.5rem'}
    }
}

TAILWIND_TEMPLATE = """/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "%s",
          foreground: "hsl(var(--primary-foreground))",
        },
      },
      borderRadius: {
        lg: "%s",
        md: "calc(%s - 2px)",
        sm: "calc(%s - 4px)",
      },
      fontFamily: %s
    },
  },
  plugins: [require("tailwindcss-animate")],
}
"""

def scaffold(project_name, vibe):
    theme = THEMES.get(vibe, THEMES['saas-clean'])
    base_path = Path(project_name)
    
    print(f"🏗️  Scaffolding '{project_name}' with vibe: {vibe.upper()}...")
    
    # 1. Create Directories
    os.makedirs(base_path / "src" / "components" / "ui", exist_ok=True)
    
    # 2. Generate Tailwind Config
    tw_config = TAILWIND_TEMPLATE % (
        theme['colors']['primary'],
        theme['colors']['radius'],
        theme['colors']['radius'],
        theme['colors']['radius'],
        json.dumps(theme['fontFamily'])
    )
    (base_path / "tailwind.config.js").write_text(tw_config)
    
    # 3. Generate CSS
    css_content = f"""
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {{
  :root {{
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: {theme['colors']['primary']};
    --radius: {theme['colors']['radius']};
  }}
  .dark {{
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
  }}
}}
"""
    (base_path / "src" / "index.css").write_text(css_content)

    print(f"✅ Project '{project_name}' created!")
    print(f"👉 To start: cd {project_name} && npm install && npm run dev")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("name", help="Project name")
    parser.add_argument("--vibe", default="saas-clean", choices=THEMES.keys(), help="Aesthetic style")
    args = parser.parse_args()
    
    scaffold(args.name, args.vibe)