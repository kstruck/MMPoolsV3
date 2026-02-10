#!/usr/bin/env python3
"""
Theme Generator
Usage: python theme_generator.py <vibe>
Vibes: brutalist, luxury, retro, clean
"""

import sys
import json

THEMES = {
    "brutalist": {
        "colors": {
            "background": "#f0f0f0",
            "foreground": "#000000",
            "primary": "#ff3e00",
            "border": "#000000"
        },
        "borderRadius": "0px",
        "borderWidth": "2px",
        "fontFamily": "Courier New, monospace",
        "boxShadow": "4px 4px 0px 0px #000000"
    },
    "luxury": {
        "colors": {
            "background": "#0a0a0a",
            "foreground": "#ededed",
            "primary": "#d4af37", # Gold
            "muted": "#333333"
        },
        "borderRadius": "0px",
        "fontFamily": "Playfair Display, serif",
        "letterSpacing": "0.05em"
    },
    "retro": {
        "colors": {
            "background": "#fdf6e3",
            "foreground": "#657b83",
            "primary": "#2aa198",
            "accent": "#cb4b16"
        },
        "borderRadius": "8px",
        "fontFamily": "Chivo, sans-serif",
        "boxShadow": "inset 0 0 10px #00000010"
    },
    "clean": {
        "colors": {
            "background": "#ffffff",
            "foreground": "#18181b",
            "primary": "#3b82f6",
            "muted": "#f4f4f5"
        },
        "borderRadius": "0.5rem",
        "fontFamily": "Satoshi, sans-serif"
    }
}

def generate(vibe):
    theme = THEMES.get(vibe.lower())
    if not theme:
        print(f"❌ Unknown vibe '{vibe}'. Available: {', '.join(THEMES.keys())}")
        return

    print(f"/* Tailwind Config for Vibe: {vibe.upper()} */")
    print(json.dumps(theme, indent=2))
    print("\n/* Copy these values into your tailwind.config.js 'extend' block */")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python theme_generator.py <vibe>")
        sys.exit(1)
    
    generate(sys.argv[1])