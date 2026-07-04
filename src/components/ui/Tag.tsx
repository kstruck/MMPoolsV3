import React from 'react';
import { cn } from './cn';

export type SportType = 'nfl' | 'ncaa' | 'squares' | 'survivor' | 'margin' | 'props';

const OUTLINE =
    'border-[1.5px] border-navy-800 text-navy-800 ' +
    'dark:border-[color:var(--line)] dark:text-[color:var(--text)]';

const STYLES: Record<SportType, string> = {
    nfl: 'bg-navy-800 text-white',
    ncaa: 'bg-gold-400 text-navy-900',
    squares: 'bg-brandred-600 text-white',
    survivor: OUTLINE,
    margin: OUTLINE,
    props: OUTLINE,
};

const LABELS: Record<SportType, string> = {
    nfl: 'NFL',
    ncaa: 'NCAA',
    squares: 'Squares',
    survivor: 'Survivor',
    margin: 'Margin',
    props: 'Props',
};

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
    sport: SportType;
}

export const Tag: React.FC<TagProps> = ({ sport, className, children, ...props }) => (
    <span
        className={cn(
            'inline-flex items-center rounded-sm px-2.5 py-1 leading-none',
            'font-display font-bold uppercase text-[12px] tracking-[0.06em]',
            STYLES[sport],
            className
        )}
        {...props}
    >
        {children ?? LABELS[sport]}
    </span>
);
