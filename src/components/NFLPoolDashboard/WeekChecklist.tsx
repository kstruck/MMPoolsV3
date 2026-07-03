import React, { useMemo } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { Pool, NFLGame } from '../../types';
import { getWeekStatus, weekDeadline, type WeekStatus } from '../../utils/nflPending';
import { formatDeadline } from '../../utils/formatTime';
import { now as serverNow } from '../../utils/serverClock';

interface WeekChecklistProps {
    pool: Pool;
    entry: any;
    games: NFLGame[];
    selectedWeek: number;
    onSelectWeek: (week: number) => void;
    /** Jump to the picks tab for the given week */
    onPickNow: (week: number) => void;
}

const CHIP_STYLES: Record<WeekStatus, string> = {
    'complete': 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400',
    'locked-complete': 'bg-slate-800/60 border-slate-700 text-slate-400',
    'due': 'bg-amber-500/10 border-amber-500/50 text-amber-400',
    'missed': 'bg-rose-500/10 border-rose-500/40 text-rose-400',
    'future': 'bg-slate-900/40 border-slate-800 text-slate-500',
    'no-games': 'bg-slate-900/20 border-slate-900 text-slate-700',
};

const CHIP_MARKS: Record<WeekStatus, string> = {
    'complete': '✓',
    'locked-complete': '✓',
    'due': '☐',
    'missed': '✗',
    'future': '·',
    'no-games': '–',
};

/**
 * Week-by-week picked/unpicked strip + "you owe picks" call-to-action.
 * Answers "what do I still need to do?" at a glance — the audit's top
 * repeat-loop gap.
 */
export const WeekChecklist: React.FC<WeekChecklistProps> = ({ pool, entry, games, selectedWeek, onSelectWeek, onPickNow }) => {
    const castPool = pool as any;
    const seasonType = Number(castPool.seasonType);
    const totalWeeks = seasonType === 1 ? 4 : 18;
    const lockBufferMinutes = castPool.settings?.lockBufferMinutes ?? 5;

    const weeks = useMemo(() => {
        return Array.from({ length: totalWeeks }, (_, i) => i + 1).map(week => {
            const weekGames = games.filter(g => g.week === week && Number(g.seasonType) === seasonType);
            const status = getWeekStatus(pool.type, entry, weekGames, week, lockBufferMinutes);
            return { week, status, deadline: weekDeadline(weekGames, lockBufferMinutes) };
        });
    }, [games, entry, pool.type, seasonType, totalWeeks, lockBufferMinutes]);

    // The nearest upcoming week the user hasn't finished — that's the one to nag about
    const nextDue = useMemo(() => {
        const now = serverNow();
        return weeks.find(w => w.status === 'due' && w.deadline !== null && w.deadline > now) ?? null;
    }, [weeks]);

    // Survivor members who are eliminated owe nothing — don't nag them
    if (pool.type === 'NFL_SURVIVOR' && entry?.status === 'ELIMINATED') return null;

    return (
        <div className="space-y-3">
            {nextDue && (
                <div role="status" className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-2 flex-1">
                        <AlertTriangle size={16} className="text-amber-400 shrink-0" aria-hidden="true" />
                        <span className="text-xs font-bold text-amber-300">
                            Week {nextDue.week} picks not in yet — locks {formatDeadline(nextDue.deadline!)}
                        </span>
                    </div>
                    <button
                        onClick={() => onPickNow(nextDue.week)}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black px-4 py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all shrink-0"
                    >
                        Make picks <ArrowRight size={13} aria-hidden="true" />
                    </button>
                </div>
            )}

            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide" role="tablist" aria-label="Weeks">
                {weeks.map(({ week, status }) => (
                    <button
                        key={week}
                        onClick={() => onSelectWeek(week)}
                        aria-label={`Week ${week}: ${status === 'complete' || status === 'locked-complete' ? 'picks submitted' : status === 'due' ? 'picks needed' : status === 'missed' ? 'missed' : status === 'no-games' ? 'no games' : 'upcoming'}`}
                        aria-current={week === selectedWeek ? 'true' : undefined}
                        className={`shrink-0 min-w-[52px] px-2 py-1.5 rounded-lg border text-[11px] font-black transition-all ${CHIP_STYLES[status]} ${week === selectedWeek ? 'ring-2 ring-blue-500/60' : 'hover:brightness-125'}`}
                    >
                        W{week} {CHIP_MARKS[status]}
                    </button>
                ))}
            </div>
        </div>
    );
};
