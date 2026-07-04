import React, { useState, useEffect } from 'react';
import { now as serverNow, syncServerClock } from '../utils/serverClock';
import { formatDeadline } from '../utils/formatTime';

interface PoolTimerProps {
    targetDate?: string | number;
    gameStatus?: string;
    isLocked: boolean;
}

export const PoolTimer: React.FC<PoolTimerProps> = ({ targetDate, gameStatus, isLocked }) => {
    const [timeLeft, setTimeLeft] = useState<{ d: number; h: number; m: number; s: number } | null>(() => {
        if (!targetDate || gameStatus === 'in' || gameStatus === 'post') return null;
        const target = new Date(targetDate).getTime();
        const diff = target - serverNow();
        if (diff <= 0) return { d: 0, h: 0, m: 0, s: 0 };
        return {
            d: Math.floor(diff / (1000 * 60 * 60 * 24)),
            h: Math.floor((diff / (1000 * 60 * 60)) % 24),
            m: Math.floor((diff / 1000 / 60) % 60),
            s: Math.floor((diff / 1000) % 60)
        };
    });

    useEffect(() => {
        if (!targetDate || gameStatus === 'in' || gameStatus === 'post') {
            return;
        }

        void syncServerClock();
        const target = new Date(targetDate).getTime();
        const update = () => {
            const diff = target - serverNow();
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
        return <span className="text-gold-400 font-display font-extrabold uppercase tracking-widest text-lg">GAME FINAL</span>;
    }

    if (gameStatus === 'in') {
        return (
            <span className="text-brandred-500 font-display font-extrabold uppercase tracking-widest text-lg inline-flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-brandred-500 animate-live-pulse"></span>LIVE
            </span>
        );
    }

    if (isLocked) {
        return <span className="text-gold-500 font-display font-extrabold uppercase tracking-widest text-lg">LOCKED</span>;
    }

    if (!targetDate || !timeLeft) {
        return <span className="text-[#9FB0CC] font-display font-bold uppercase tracking-wider text-xs">Waiting for Schedule</span>;
    }

    // Determine color based on time remaining
    const totalHours = timeLeft.d * 24 + timeLeft.h;
    let color = 'text-gold-400';
    if (totalHours === 0 && timeLeft.m < 10) {
        color = 'text-brandred-500 animate-pulse';
    } else if (totalHours === 0) {
        color = 'text-brandred-500';
    }

    return (
        <div className={`font-display font-bold text-xl num ${color}`}>
            {timeLeft.d > 0 && <span>{timeLeft.d}d </span>}
            <span>{timeLeft.h.toString().padStart(2, '0')}h </span>
            <span>{timeLeft.m.toString().padStart(2, '0')}m </span>
            <span>{timeLeft.s.toString().padStart(2, '0')}s</span>
            <p className="text-[10px] text-[#9FB0CC] font-body font-bold uppercase tracking-widest mt-1">
                Kickoff · {formatDeadline(new Date(targetDate).getTime())}
            </p>
        </div>
    );
};

export default PoolTimer;
