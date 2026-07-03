import React, { useState, useEffect } from 'react';
import { Clock, Lock, AlertTriangle } from 'lucide-react';
import { now as serverNow, syncServerClock } from '../../utils/serverClock';
import { formatDeadline } from '../../utils/formatTime';

interface BracketCountdownProps {
    lockAt: number; // Unix timestamp in ms
}

export const BracketCountdown: React.FC<BracketCountdownProps> = ({ lockAt }) => {
    const [now, setNow] = useState(() => serverNow());

    useEffect(() => {
        void syncServerClock();
        const interval = setInterval(() => setNow(serverNow()), 1000);
        return () => clearInterval(interval);
    }, []);

    const diff = lockAt - now;
    const isLocked = diff <= 0;

    if (isLocked) {
        return (
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/30">
                <Lock size={16} className="text-red-400" />
                <span className="text-sm font-bold text-red-400">Brackets are locked</span>
            </div>
        );
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    const isUrgent = diff < 2 * 60 * 60 * 1000; // < 2 hours
    const isWarning = diff < 24 * 60 * 60 * 1000; // < 24 hours

    const bgClass = isUrgent
        ? 'bg-red-500/10 border-red-500/30'
        : isWarning
            ? 'bg-amber-500/10 border-amber-500/30'
            : 'bg-slate-800/50 border-slate-700/50';

    const iconColor = isUrgent ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-indigo-400';
    const textColor = isUrgent ? 'text-red-300' : isWarning ? 'text-amber-300' : 'text-slate-300';
    const numColor = isUrgent ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-white';

    return (
        <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border ${bgClass} ${isUrgent ? 'animate-pulse' : ''}`}>
            {isUrgent ? (
                <AlertTriangle size={16} className={iconColor} />
            ) : (
                <Clock size={16} className={iconColor} />
            )}
            <span className={`text-xs font-medium ${textColor}`}>
                {isUrgent ? 'Hurry!' : 'Locks in'}
            </span>
            <div className="flex items-baseline gap-1.5">
                {days > 0 && (
                    <TimeUnit value={days} label="d" color={numColor} />
                )}
                <TimeUnit value={hours} label="h" color={numColor} />
                <TimeUnit value={minutes} label="m" color={numColor} />
                <TimeUnit value={seconds} label="s" color={numColor} />
            </div>
            <span className="hidden sm:inline text-[10px] font-bold text-slate-500">
                {formatDeadline(lockAt)}
            </span>
        </div>
    );
};

const TimeUnit: React.FC<{ value: number; label: string; color: string }> = ({ value, label, color }) => (
    <div className="flex items-baseline">
        <span className={`text-lg font-black tabular-nums ${color}`}>
            {String(value).padStart(2, '0')}
        </span>
        <span className="text-[10px] text-slate-500 font-bold ml-0.5">{label}</span>
    </div>
);
