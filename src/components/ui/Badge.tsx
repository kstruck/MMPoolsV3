import React from 'react';
import { cn } from './cn';

export type BadgeStatus =
    | 'live'
    | 'paid'
    | 'unpaid'
    | 'open'
    | 'locked'
    | 'winner'
    | 'everyScore';

const STYLES: Record<BadgeStatus, string> = {
    live: 'bg-brandred-600 text-white',
    paid: 'bg-[#E4F5EC] text-[#0F7B4A] border border-[#BEE7D0]',
    unpaid: 'bg-[#FBEEDD] text-[#B4530A] border border-[#F2D6B0]',
    open: 'bg-[#E5EDF6] text-[#142A4C] border border-[#CBDCEC]',
    locked: 'bg-cream text-muted border border-line',
    winner: 'bg-[#FBF3E0] text-gold-700 border border-[#EAD9A8]',
    everyScore: 'bg-[#5B2A86] text-white',
};

const LABELS: Record<BadgeStatus, string> = {
    live: 'Live',
    paid: 'Paid',
    unpaid: 'Unpaid',
    open: 'Open',
    locked: 'Locked',
    winner: 'Winner',
    everyScore: 'Every Score',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
    status: BadgeStatus;
}

export const Badge: React.FC<BadgeProps> = ({ status, className, children, ...props }) => (
    <span
        className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-[5px] leading-none',
            'font-display font-bold uppercase text-[13px] tracking-[0.08em]',
            STYLES[status],
            className
        )}
        {...props}
    >
        {status === 'live' && (
            <span className="size-1.5 rounded-full bg-white animate-live-pulse" aria-hidden="true" />
        )}
        {children ?? LABELS[status]}
    </span>
);
