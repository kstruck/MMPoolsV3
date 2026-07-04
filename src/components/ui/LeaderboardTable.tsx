import React from 'react';
import { cn } from './cn';

/** Rank chip — #1 gets the gold-foil treatment, everyone else a subtle circle. */
export const RankChip: React.FC<{ rank: number; className?: string }> = ({ rank, className }) => (
    <span
        className={cn(
            'inline-flex size-7 items-center justify-center rounded-full font-display font-bold text-[14px] num',
            rank === 1
                ? 'bg-gold-foil text-navy-900'
                : 'border border-line bg-page text-muted',
            className
        )}
    >
        {rank}
    </span>
);

/** Red "You" pill for the highlighted current-user row. */
export const YouPill: React.FC<{ className?: string }> = ({ className }) => (
    <span
        className={cn(
            'inline-flex items-center rounded-full bg-brandred-600 px-2 py-0.5 leading-none',
            'font-display font-bold uppercase text-[11px] tracking-[0.08em] text-white',
            className
        )}
    >
        You
    </span>
);

export interface LeaderboardColumn {
    key: string;
    label: React.ReactNode;
    align?: 'left' | 'right' | 'center';
    className?: string;
}

export interface LeaderboardRow {
    id: string;
    cells: Record<string, React.ReactNode>;
    /** highlight as the current user's row */
    isYou?: boolean;
}

export interface LeaderboardTableProps {
    columns: LeaderboardColumn[];
    rows: LeaderboardRow[];
    className?: string;
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export const LeaderboardTable: React.FC<LeaderboardTableProps> = ({ columns, rows, className }) => (
    <div className={cn('overflow-x-auto rounded-xl border border-line bg-card shadow-card', className)}>
        <table className="w-full border-collapse font-body text-[15px]">
            <thead>
                <tr>
                    {columns.map((col) => (
                        <th
                            key={col.key}
                            className={cn(
                                'border-b border-line px-4 py-3 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted',
                                ALIGN[col.align ?? 'left'],
                                col.className
                            )}
                        >
                            {col.label}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.map((row) => (
                    <tr
                        key={row.id}
                        className={cn(
                            'border-b border-line last:border-b-0 transition-colors',
                            row.isYou ? 'bg-brandred-600/[0.07]' : 'hover:bg-[color:var(--page)]'
                        )}
                    >
                        {columns.map((col) => (
                            <td
                                key={col.key}
                                className={cn(
                                    'px-4 py-3 num text-[color:var(--text)]',
                                    ALIGN[col.align ?? 'left'],
                                    col.className
                                )}
                            >
                                {row.cells[col.key]}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);
