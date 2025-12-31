import React, { useState, useEffect } from 'react';

interface PoolTimerProps {
    targetDate?: string | number;
    gameStatus?: string;
    isLocked: boolean;
}

export const PoolTimer: React.FC<PoolTimerProps> = ({ targetDate, gameStatus, isLocked }) => {
    const [timeLeft, setTimeLeft] = useState<{ d: number; h: number; m: number; s: number } | null>(null);

    useEffect(() => {
        if (!targetDate || gameStatus === 'in' || gameStatus === 'post') {
            setTimeLeft(null);
            return;
        }

        const target = new Date(targetDate).getTime();
        const update = () => {
            const now = Date.now();
            const diff = target - now;
            if (diff <= 0) {
                setTimeLeft({ d: 0, h: 0, m: 0, s: 0 });
                return;
            }
            setTimeLeft({
                d: Math.floor(diff / (1000 * 60 * 60 * 24)),
                h: Math.floor((diff / (1000 * 60 * 60)) % 24),
                m: Math.floor((diff / 1000 / 60) % 60),
                s: Math.floor((diff / 1000) % 60)
            });
        };

        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [targetDate, gameStatus]);

    if (gameStatus === 'post' || gameStatus === 'final') {
        return <span className="text-slate-500 font-bold uppercase tracking-wider text-xs">Game Complete</span>;
    }

    if (gameStatus === 'in') {
        return <span className="text-emerald-400 font-bold uppercase tracking-wider text-xs animate-pulse">Game In Progress</span>;
    }

    if (!timeLeft) {
        return <span className="text-slate-500 font-bold uppercase tracking-wider text-xs">{isLocked ? "Pool Locked" : "Waiting for Schedule"}</span>;
    }

    // Determine color based on time remaining
    const totalHours = timeLeft.d * 24 + timeLeft.h;
    let color = 'text-emerald-400';
    if (totalHours === 0 && timeLeft.m < 10) {
        color = 'text-rose-500 animate-pulse';
    } else if (totalHours === 0) {
        color = 'text-amber-500';
    }

    return (
        <div className={`font-mono font-bold text-xl ${color}`}>
            {timeLeft.d > 0 && <span>{timeLeft.d}d </span>}
            <span>{timeLeft.h.toString().padStart(2, '0')}h </span>
            <span>{timeLeft.m.toString().padStart(2, '0')}m </span>
            <span>{timeLeft.s.toString().padStart(2, '0')}s</span>
            <p className="text-[10px] text-slate-500 font-sans uppercase tracking-widest mt-1">Time Until Kickoff</p>
        </div>
    );
};

export default PoolTimer;
