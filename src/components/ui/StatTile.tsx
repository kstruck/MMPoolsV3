import React from 'react';
import { cn } from './cn';

export type StatAccent = 'navy' | 'gold' | 'red';

const ACCENTS: Record<StatAccent, string> = {
    navy: 'text-navy-800 dark:text-gold-400',
    gold: 'text-gold-600 dark:text-gold-400',
    red: 'text-brandred-600',
};

export interface StatTileProps extends React.HTMLAttributes<HTMLDivElement> {
    label: string;
    value: React.ReactNode;
    accent?: StatAccent;
    /** e.g. "+12% vs last week"; direction colors the text */
    delta?: { text: string; direction?: 'up' | 'flat' };
    /** 0–100 renders a gold progress bar */
    progress?: number;
}

export const StatTile: React.FC<StatTileProps> = ({
    label,
    value,
    accent = 'navy',
    delta,
    progress,
    className,
    ...props
}) => (
    <div
        className={cn('rounded-xl border border-line bg-card p-5 shadow-card', className)}
        {...props}
    >
        <div className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">
            {label}
        </div>
        <div className={cn('mt-1 font-display font-bold text-[40px] leading-none num', ACCENTS[accent])}>
            {value}
        </div>
        {delta && (
            <div
                className={cn(
                    'mt-2 font-body text-[13px] font-semibold num',
                    delta.direction === 'up' ? 'text-[#0F7B4A]' : 'text-muted'
                )}
            >
                {delta.text}
            </div>
        )}
        {progress !== undefined && (
            <div className="mt-3 h-1.5 rounded-full bg-line overflow-hidden">
                <div
                    className="h-full rounded-full bg-gold-foil"
                    style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                />
            </div>
        )}
    </div>
);
