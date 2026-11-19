import React from 'react';
import { Sparkles } from 'lucide-react';

/**
 * Homepage promo: squares pools are FREE to host for a limited time
 * (Kevin, 2026-11-19). It took the countdown's place at the top of the hero.
 *
 * Shown only while `SQUARES_FREE_PROMO` (src/config/season.ts) is on — that
 * flag documents why it must go off when squares prices return.
 *
 * Motion: the FREE tag sweeps a light across itself a few times and stops
 * (`animate-sheen` is finite). `motion-safe:` keeps it still for anyone who
 * asked for reduced motion.
 */

// A 4x4 corner of a squares board. Gold digits on the edges, one "winning"
// square lit — decoration only, so it is hidden from screen readers.
const DIGITS_TOP = ['7', '3', '0', '4'];
const DIGITS_SIDE = ['1', '7', '4', '0'];
const WIN = { row: 1, col: 0 };

const MiniBoard: React.FC = () => (
    <div aria-hidden="true" className="grid grid-cols-5 gap-1 w-[132px] sm:w-[148px] shrink-0">
        <span />
        {DIGITS_TOP.map((d, i) => (
            <span key={`t${i}`} className="h-6 flex items-center justify-center font-display font-bold text-sm text-gold-400 num">{d}</span>
        ))}
        {DIGITS_SIDE.map((d, r) => (
            <React.Fragment key={`r${r}`}>
                <span className="h-6 flex items-center justify-center font-display font-bold text-sm text-brandred-500 num">{d}</span>
                {DIGITS_TOP.map((_, c) => {
                    const win = r === WIN.row && c === WIN.col;
                    return (
                        <span
                            key={`c${r}-${c}`}
                            className={
                                win
                                    ? 'h-6 rounded-[4px] bg-gold-500 shadow-[0_0_14px_rgba(230,206,150,0.75)] motion-safe:animate-live-pulse'
                                    : 'h-6 rounded-[4px] bg-white/[0.07] border border-white/10'
                            }
                        />
                    );
                })}
            </React.Fragment>
        ))}
    </div>
);

/** The FREE tag: a tilted gold stamp with a light sweep. */
export const FreeTag: React.FC<{ className?: string }> = ({ className = '' }) => (
    <span
        className={`relative inline-flex items-center overflow-hidden rounded-md bg-gold-400 text-navy-950 font-display font-extrabold uppercase tracking-[0.12em] leading-none px-2 py-1 text-xs ${className}`}
    >
        Free
        <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent -translate-x-[120%] motion-safe:animate-sheen"
        />
    </span>
);

export const SquaresFreePromo: React.FC = () => (
    <section
        aria-labelledby="squares-free-promo-title"
        data-testid="squares-free-promo"
        className="relative w-full max-w-3xl mx-auto rounded-2xl p-[2px] bg-gradient-to-r from-gold-500 via-gold-300 to-gold-500 shadow-[0_0_40px_rgba(230,206,150,0.25)]"
    >
        <div className="relative rounded-[14px] bg-navy-900 px-5 py-5 sm:px-8 sm:py-6 flex flex-col sm:flex-row items-center gap-5 sm:gap-8 text-center sm:text-left overflow-hidden">
            <div aria-hidden="true" className="absolute -top-16 -right-16 w-48 h-48 rounded-full blur-[70px] bg-gold-500/20" />

            {/* The stamp, tilted off the corner */}
            <span className="absolute top-3 right-3 sm:top-4 sm:right-4 -rotate-[8deg]">
                <FreeTag className="text-sm sm:text-base px-3 py-1.5 shadow-[0_4px_18px_rgba(230,206,150,0.45)]" />
            </span>

            <MiniBoard />

            <div className="relative min-w-0">
                <p className="inline-flex items-center gap-1.5 font-display font-bold uppercase text-xs tracking-[0.16em] text-gold-300 mb-2">
                    <Sparkles size={14} aria-hidden="true" /> Thanksgiving special · limited time
                </p>
                <h2
                    id="squares-free-promo-title"
                    className="font-display font-extrabold uppercase text-white text-3xl sm:text-4xl leading-[0.95] tracking-tight sm:pr-16"
                >
                    Squares pools are <span className="text-gold-400">free</span>
                </h2>
                <p className="mt-2 font-body text-[#C9D4E6] text-base sm:text-lg leading-snug">
                    Host a 100-square football grid for your family, office or league. <strong className="text-white">$0 to host, any number of players.</strong>
                </p>
            </div>
        </div>
    </section>
);
