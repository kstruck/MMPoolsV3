import React from 'react';

interface LogoProps {
  className?: string;
  /** Tailwind height class applied to the crest image */
  height?: string;
  /** Render the live-text wordmark next to the crest (for dark navy chrome) */
  withWordmark?: boolean;
}

/* Crest + live-text wordmark (white "MARCH MELEE" / gold "POOLS") per brand
   handoff — on dark chrome the navy raster wordmark is illegible, so the
   wordmark is real text.
   Renders a SPAN, not an <a>: both call sites (Header, Footer) wrap it in
   their own link, and nested anchors are invalid HTML (a11y audit follow-up —
   the Header link owns SPA navigation + menu-close). */
export const Logo: React.FC<LogoProps> = ({ className = "", height = "h-12", withWordmark = true }) => (
  <span className={`flex items-center gap-2.5 ${className}`}>
    <img
      src="/mmp-crest-small.webp"
      alt="March Melee Pools crest"
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
