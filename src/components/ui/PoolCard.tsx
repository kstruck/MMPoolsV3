import React from 'react';
import { cn } from './cn';
import { Tag, type SportType } from './Tag';
import { Badge, type BadgeStatus } from './Badge';

const HEADER_BG: Record<SportType, string> = {
    nfl: 'bg-navy-800',
    ncaa: 'bg-gold-foil',
    squares: 'bg-brandred-600',
    survivor: 'bg-navy-950',
    margin: 'bg-navy-950',
    props: 'bg-navy-950',
};

export interface PoolCardFigure {
    label: string;
    value: React.ReactNode;
    tone?: 'gold' | 'navy';
}

export interface PoolCardProps extends React.HTMLAttributes<HTMLDivElement> {
    sport: SportType;
    status?: BadgeStatus;
    title: string;
    meta?: React.ReactNode;
    figures?: PoolCardFigure[];
    /** Full-width CTA rendered at the card foot (pass a Button). */
    cta?: React.ReactNode;
}

export const PoolCard: React.FC<PoolCardProps> = ({
    sport,
    status,
    title,
    meta,
    figures,
    cta,
    className,
    children,
    ...props
}) => (
    <div
        className={cn(
            'rounded-2xl border border-line bg-card shadow-card overflow-hidden',
            'transition-ui duration-150 fine:hover:-translate-y-1 hover:shadow-card-hover',
            className
        )}
        {...props}
    >
        <div className={cn('flex items-center justify-between gap-2 px-4 py-2.5', HEADER_BG[sport])}>
            <Tag
                sport={sport}
                className={
                    sport === 'ncaa'
                        ? 'border-[1.5px] border-navy-900/25 bg-transparent text-navy-900'
                        : 'border-[1.5px] border-white/30 bg-transparent text-white dark:border-white/30 dark:text-white'
                }
            />
            {status && <Badge status={status} />}
        </div>
        <div className="p-5">
            <h3 className="font-display font-bold uppercase text-[23px] leading-[0.95] text-[color:var(--text)]">
                {title}
            </h3>
            {meta && <p className="mt-1 font-body text-sm text-muted">{meta}</p>}
            {figures && figures.length > 0 && (
                <div className="mt-4 flex items-end gap-8">
                    {figures.map((f) => (
                        <div key={f.label}>
                            <div className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted">
                                {f.label}
                            </div>
                            <div
                                className={cn(
                                    'font-display font-bold text-[24px] leading-tight num',
                                    f.tone === 'gold'
                                        ? 'text-gold-700 dark:text-gold-400'
                                        : 'text-navy-800 dark:text-[color:var(--text)]'
                                )}
                            >
                                {f.value}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {children}
            {cta && <div className="mt-5 [&>*]:w-full">{cta}</div>}
        </div>
    </div>
);
