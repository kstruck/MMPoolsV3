#!/usr/bin/env python3
"""Regenerate the site + email logo assets from public/mmp-logo-full.png.

Kevin ruling D3 (2026-08-24): mmp-logo-full.png is THE brand artwork; the
header crest was exported separately and reads as if its bottom is chopped.
Everything the site and the email templates show is now derived from this one
1269x1222 source so the two can never drift apart again.

The source is a VERTICAL lockup in three bands (measured, not guessed):

    emblem    x 93..1029  y   58..804    936x746
    wordmark  x 58..1065  y  823..1091  1007x268   "MARCH MELEE" / "POOLS"
    url line  x 281..1211 y 1117..1164   930x47    www.marchmeleepools.com

Two constraints drive the two different outputs:

1. The site header/footer chrome is ALWAYS navy-900 (#0E1C34) and the header
   renders the logo 48px tall. The artwork's wordmark is dark navy (15,34,66)
   with a thin gold stroke, so on that chrome it is invisible, and at 48px the
   whole lockup is ~10px of unreadable text. So the site takes the EMBLEM band
   only and Logo.tsx keeps the live-text wordmark (white "MARCH MELEE" / gold
   "POOLS") that already exists for exactly this reason.

2. The email header band is #0f172a (also dark) and renders the logo 50px tall
   with width:auto, so a square-ish lockup would shrink to 50x50. The email
   asset is therefore a HORIZONTAL recomposition -- emblem left, wordmark right
   -- on a white rounded card so the navy artwork reads on the dark band. The
   canvas stays 589x150 and the filename stays email-logo.png because
   functions/src/emailStyles.ts LOGO_URL and already-delivered mail both point
   at that exact path.

Run from the repo root:  python scripts/generate-logo-assets.py
Requires Pillow (already on this machine; not a repo dependency -- this is a
one-off generator, the committed assets are the artifact).
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "public")
SRC = os.path.join(PUB, "mmp-logo-full.png")

EMBLEM_BOX = (93, 58, 1029, 804)
WORDMARK_BOX = (58, 823, 1065, 1091)

# Site logo: 128px tall == 2.67x the 48px header render (and 3.2x the 40px
# footer render). Matches the height of the crest webp it replaces.
SITE_HEIGHT = 128
SITE_OUT = os.path.join(PUB, "mmp-logo-mark.webp")
SITE_QUALITY = 82

# Email logo: unchanged canvas + filename, see module docstring.
EMAIL_W, EMAIL_H = 589, 150
EMAIL_PAD = 12
EMAIL_RADIUS = 16
EMAIL_GAP = 18
EMAIL_OUT = os.path.join(PUB, "email-logo.png")


def _fit_height(img: Image.Image, height: int) -> Image.Image:
    width = max(1, round(img.width * height / img.height))
    return img.resize((width, height), Image.LANCZOS)


def build_site_mark(source: Image.Image) -> None:
    emblem = _fit_height(source.crop(EMBLEM_BOX), SITE_HEIGHT)
    emblem.save(SITE_OUT, "WEBP", quality=SITE_QUALITY, method=6)


def build_email_logo(source: Image.Image) -> None:
    card = Image.new("RGBA", (EMAIL_W, EMAIL_H), (0, 0, 0, 0))
    ImageDraw.Draw(card).rounded_rectangle(
        (0, 0, EMAIL_W - 1, EMAIL_H - 1), radius=EMAIL_RADIUS, fill=(255, 255, 255, 255)
    )

    emblem = _fit_height(source.crop(EMBLEM_BOX), EMAIL_H - 2 * EMAIL_PAD)
    emblem_x = EMAIL_PAD + 6
    card.alpha_composite(emblem, (emblem_x, (EMAIL_H - emblem.height) // 2))

    word_src = source.crop(WORDMARK_BOX)
    word_left = emblem_x + emblem.width + EMAIL_GAP
    avail_w = EMAIL_W - EMAIL_PAD - word_left
    avail_h = EMAIL_H - 2 * EMAIL_PAD
    scale = min(avail_w / word_src.width, avail_h / word_src.height)
    wordmark = word_src.resize(
        (max(1, round(word_src.width * scale)), max(1, round(word_src.height * scale))),
        Image.LANCZOS,
    )
    card.alpha_composite(
        wordmark,
        (word_left + (avail_w - wordmark.width) // 2, (EMAIL_H - wordmark.height) // 2),
    )

    # Palette-quantized like the asset it replaces (which was mode "P").
    # FASTOCTREE is the only Pillow method that keeps the alpha channel, which
    # the rounded corners need.
    card.quantize(colors=192, method=Image.FASTOCTREE).save(
        EMAIL_OUT, "PNG", optimize=True
    )


def main() -> None:
    with Image.open(SRC) as raw:
        source = raw.convert("RGBA")
    build_site_mark(source)
    build_email_logo(source)
    for path in (SITE_OUT, EMAIL_OUT):
        with Image.open(path) as out:
            print(f"{os.path.basename(path):24s} {out.width}x{out.height} "
                  f"{os.path.getsize(path)} bytes")


if __name__ == "__main__":
    main()
