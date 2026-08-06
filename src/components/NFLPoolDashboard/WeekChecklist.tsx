import React from 'react';
import { AlertTriangle, ArrowRight, Check, X, Square, Dot, Minus } from 'lucide-react';
import type { Pool, NFLGame } from '../../types';
import { gamesForPoolWeek, getWeekStatus, poolSeasonType, weekDeadline, type WeekStatus } from '../../utils/nflPending';
import { nflWeekLabel, nflWeekChip } from '../../utils/nflWeekLabel';
import { formatDeadline } from '../../utils/formatTime';
import { now as serverNow } from '../../utils/serverClock';
import { Button } from '../ui';
import { effectiveBufferMinutesForWeek } from '@shared/weeklyHardLock';

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
    'complete': 'bg-[#E4F5EC] border-[#BEE7D0] text-[#0F7B4A]',
    'locked-complete': 'bg-cream border-line text-muted',
    'due': 'bg-[#FBEEDD] border-[#F2D6B0] text-[#B4530A]',
    'missed': 'bg-brandred-600/10 border-brandred-600/30 text-brandred-600',
    'future': 'bg-page border-line text-faint',
    'no-games': 'bg-page border-line text-faint opacity-60',
};

const CHIP_MARKS: Record<WeekStatus, React.ReactNode> = {
    'complete': <Check size={11} aria-hidden="true" />,
    'locked-complete': <Check size={11} aria-hidden="true" />,
    'due': <Square size={10} aria-hidden="true" />,
    'missed': <X size={11} aria-hidden="true" />,
    'future': <Dot size={11} aria-hidden="true" />,
    'no-games': <Minus size={10} aria-hidden="true" />,
};

/**
 * Week-by-week picked/unpicked strip + "you owe picks" call-to-action.
 * Answers "what do I still need to do?" at a glance — the audit's top
 * repeat-loop gap.
 */
export const WeekChecklist: React.FC<WeekChecklistProps> = ({ pool, entry, games, selectedWeek, onSelectWeek, onPickNow }) => {
    const castPool = pool as any;
    const seasonType = poolSeasonType(castPool);
    const totalWeeks = seasonType === 1 ? 4 : 18;
    // NOT memoized, deliberately. `getWeekStatus` reads `serverNow()`, so a
    // useMemo keyed on [games, entry, ...] FREEZES TIME: leave the dashboard
    // open across a deadline with no data change and the memo never reruns —
    // the old current week keeps its pre-deadline status (and, worse, its green
    // "picks are in" confirmation) while the real week has moved on. codex
    // found this on the first version of the current-week strip. The parent
    // re-renders on a ~30s tick, and this is 4–18 weeks of array filtering —
    // recomputing per render is the correct price for a clock-dependent value.
    const weeks = Array.from({ length: totalWeeks }, (_, i) => i + 1).map(week => {
        const weekGames = gamesForPoolWeek(games, castPool, week);
        // Per week, because a hard-lock pool's deadline is frozen per week — the
        // checklist must show the deadline the server actually enforces.
        const lockBufferMinutes = effectiveBufferMinutesForWeek(castPool, week, weekGames.map(g => g.startTime));
        const status = getWeekStatus(pool.type, entry, weekGames, week, lockBufferMinutes);
        return { week, status, deadline: weekDeadline(weekGames, lockBufferMinutes) };
    });

    // The week the pool is IN: the earliest week whose deadline has not passed.
    // The strip used to nag about the nearest unpicked week ANYWHERE in the
    // season — with HOF and P1 picked it read "Preseason Week 2 picks not in
    // yet" while the HOF game hadn't even kicked off, which reads as the site
    // being on the wrong week (Kevin's live-test report, 2026-08-05). The nag
    // now speaks only about the current week; future weeks stay visible as
    // chips below, and the nag moves forward on its own when this week locks.
    const currentWeek = weeks.find(w => w.deadline !== null && w.deadline > serverNow()) ?? null;

    const nextDue = currentWeek && currentWeek.status === 'due' ? currentWeek : null;
    // Positive confirmation for the same slot: "your picks are in" is exactly
    // the assurance whose absence made a tester re-submit a saved pick.
    const currentComplete = currentWeek && currentWeek.status === 'complete' ? currentWeek : null;

    // Survivor members who are eliminated owe nothing — don't nag them
    if (pool.type === 'NFL_SURVIVOR' && entry?.status === 'ELIMINATED') return null;

    return (
        <div className="space-y-3">
            {nextDue && (
                <div role="status" className="bg-gold-400/10 border border-gold-500/40 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-2 flex-1">
                        <AlertTriangle size={16} className="text-gold-600 dark:text-gold-400 shrink-0" aria-hidden="true" />
                        <span className="font-display font-bold uppercase tracking-[0.05em] text-[13px] text-gold-700 dark:text-gold-300">
                            {nflWeekLabel(poolSeasonType(castPool), nextDue.week)} picks not in yet — locks {formatDeadline(nextDue.deadline!)}
                        </span>
                    </div>
                    <Button
                        size="sm"
                        onClick={() => onPickNow(nextDue.week)}
                        className="shrink-0"
                    >
                        Make picks <ArrowRight size={13} aria-hidden="true" />
                    </Button>
                </div>
            )}

            {currentComplete && (
                <div role="status" className="bg-[#E4F5EC]/60 dark:bg-emerald-500/10 border border-[#BEE7D0] dark:border-emerald-500/30 rounded-xl px-4 py-3 flex items-center gap-2">
                    <Check size={16} className="text-[#0F7B4A] dark:text-emerald-400 shrink-0" aria-hidden="true" />
                    <span className="font-display font-bold uppercase tracking-[0.05em] text-[13px] text-[#0F7B4A] dark:text-emerald-300">
                        {nflWeekLabel(poolSeasonType(castPool), currentComplete.week)} picks are in — locks {formatDeadline(currentComplete.deadline!)}
                    </span>
                </div>
            )}

            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide" role="tablist" aria-label="Weeks">
                {weeks.map(({ week, status }) => (
                    <button
                        key={week}
                        onClick={() => onSelectWeek(week)}
                        aria-label={`${nflWeekLabel(poolSeasonType(castPool), week)}: ${status === 'complete' || status === 'locked-complete' ? 'picks submitted' : status === 'due' ? 'picks needed' : status === 'missed' ? 'missed' : status === 'no-games' ? 'no games' : 'upcoming'}`}
                        aria-current={week === selectedWeek ? 'true' : undefined}
                        className={`shrink-0 min-w-[52px] px-2 py-1.5 rounded-md border inline-flex items-center justify-center gap-1 font-display font-bold uppercase text-[11px] tracking-[0.05em] num transition-all duration-150 ${CHIP_STYLES[status]} ${week === selectedWeek ? 'ring-2 ring-navy-600 dark:ring-gold-500' : 'hover:-translate-y-px'}`}
                    >
                        {nflWeekChip(poolSeasonType(castPool), week)} {CHIP_MARKS[status]}
                    </button>
                ))}
            </div>
        </div>
    );
};
