import React from 'react';

interface LogoProps {
  className?: string;
  /** Tailwind height class applied to the logo mark */
  height?: string;
  /** Render the live-text wordmark next to the mark (for dark navy chrome) */
  withWordmark?: boolean;
}

/* Logo mark + live-text wordmark (white "MARCH MELEE" / gold "POOLS") per
   brand handoff.

   The mark is cut from public/mmp-logo-full.png — the master brand artwork —
   rather than from the legacy standalone crest export, which is stretched ~5%
   wider than the master (986x747 vs 936x746 of content) (Kevin ruling D3,
   2026-08-24). scripts/generate-logo-assets.py regenerates it. That legacy
   export must not be named here: tests/imagePerfBudget.test.ts fails on any
   mention of it inside src/.

   Only the emblem band of that artwork is used here, and the wordmark stays
   REAL TEXT: the artwork's own wordmark is dark navy (15,34,66) on a
   permanently navy-900 (#0E1C34) header, i.e. invisible, and at the 48px
   render height its letters are ~10px tall. Do not "simplify" this by
   dropping the text and pointing the img at the whole lockup.

   Renders a SPAN, not an <a>: both call sites (Header, Footer) wrap it in
   their own link, and nested anchors are invalid HTML (a11y audit follow-up —
   the Header link owns SPA navigation + menu-close). */
export const Logo: React.FC<LogoProps> = ({ className = "", height = "h-12", withWordmark = true }) => (
  <span className={`flex items-center gap-2.5 ${className}`}>
    <img
      src="/mmp-logo-mark.webp"
      alt="March Melee Pools crest"
      width={161}
      height={128}
      className={`${height} w-auto`}
    />
    {withWordmark && (
      <span className="flex flex-col leading-none font-display uppercase">
        <span className="text-white font-bold tracking-[0.04em] text-[17px]">March Melee</span>
        <span className="text-gold-500 font-extrabold tracking-[0.18em] text-[15px]">Pools</span>
      </span>
    )}
  </span>
);
