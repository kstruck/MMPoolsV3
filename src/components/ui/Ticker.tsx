import React from 'react';
import { cn } from './cn';

/** Horizontal marquee — content duplicated for a seamless ~32s loop. */
export const Ticker: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
    className,
    children,
    ...props
}) => (
    <div className={cn('overflow-hidden', className)} {...props}>
        <div className="flex w-max items-center animate-ticker">
            <div className="flex items-center gap-8 pr-8">{children}</div>
            <div className="flex items-center gap-8 pr-8" aria-hidden="true">
                {children}
            </div>
        </div>
    </div>
);
