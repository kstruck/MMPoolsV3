import React from 'react';
import { cn } from './cn';

/**
 * Horizontal marquee — content duplicated for a seamless loop. `durationSec` overrides the
 * default 32s loop (higher = slower); admin-controlled via system settings.
 */
export const Ticker: React.FC<React.HTMLAttributes<HTMLDivElement> & { durationSec?: number }> = ({
    className,
    children,
    durationSec,
    ...props
}) => (
    <div className={cn('overflow-hidden', className)} {...props}>
        <div
            className="flex w-max items-center animate-ticker"
            style={durationSec ? { animationDuration: `${durationSec}s` } : undefined}
        >
            <div className="flex items-center gap-8 pr-8">{children}</div>
            <div className="flex items-center gap-8 pr-8" aria-hidden="true">
                {children}
            </div>
        </div>
    </div>
);
