import React, { useState, useEffect, useRef } from 'react';
import { now as serverNow, syncServerClock } from '../../utils/serverClock';

/**
 * Compact live countdown to a deadline, on the server-synced clock (the same
 * one BracketCountdown ticks on, so a skewed local clock cannot show a week
 * open after it locked). Once the deadline passes it renders a LOCKED line
 * rather than nothing: the parent's isWeekLocked re-evaluates on a 30s tick,
 * and an empty card under a stale "Picks are Open" header would contradict
 * reality for up to that long (codex r1).
 */
export const CountdownTo: React.FC<{ deadline: number; onExpire?: () => void }> = ({ deadline, onExpire }) => {
    const [now, setNow] = useState(() => serverNow());

    useEffect(() => {
        void syncServerClock();
        const interval = setInterval(() => setNow(serverNow()), 1000);
        return () => clearInterval(interval);
    }, []);

    // Fire ONCE when the deadline passes so the parent can re-evaluate its own
    // lock state immediately instead of on its slower tick — otherwise the pick
    // form stays enabled under a "Locked" countdown for up to 30s (codex r3).
    // One-shot via ref, and the callback rides in a ref too: an inline
    // `onExpire={() => ...}` changes identity every render, and an effect
    // depending on it would re-fire while expired, looping parent state
    // updates (qodo #358 bug 1).
    const expired = deadline - now <= 0;
    const onExpireRef = useRef(onExpire);
    useEffect(() => {
        onExpireRef.current = onExpire;
    }, [onExpire]);
    const firedRef = useRef(false);
    useEffect(() => {
        if (expired && !firedRef.current) {
            firedRef.current = true;
            onExpireRef.current?.();
        }
    }, [expired]);

    const diff = deadline - now;
    if (diff <= 0) {
        return (
            <div className="flex items-center justify-center mt-1" role="timer" aria-label="Picks locked">
                <span className="text-[11px] font-display font-bold uppercase tracking-[0.08em] text-brandred-600">
                    Locked
                </span>
            </div>
        );
    }

    const days = Math.floor(diff / 86_400_000);
    const hours = Math.floor((diff % 86_400_000) / 3_600_000);
    const minutes = Math.floor((diff % 3_600_000) / 60_000);
    const seconds = Math.floor((diff % 60_000) / 1000);
    const isUrgent = diff < 2 * 3_600_000;

    return (
        <div
            className={`flex items-baseline justify-center gap-1.5 mt-1 ${isUrgent ? 'animate-pulse' : ''}`}
            role="timer"
            aria-label="Time until picks lock"
        >
            {days > 0 && <Unit value={days} label="d" urgent={isUrgent} />}
            <Unit value={hours} label="h" urgent={isUrgent} />
            <Unit value={minutes} label="m" urgent={isUrgent} />
            <Unit value={seconds} label="s" urgent={isUrgent} />
        </div>
    );
};

const Unit: React.FC<{ value: number; label: string; urgent: boolean }> = ({ value, label, urgent }) => (
    <div className="flex items-baseline">
        <span className={`text-base font-display font-extrabold num ${urgent ? 'text-brandred-600' : 'text-gold-600 dark:text-gold-400'}`}>
            {String(value).padStart(2, '0')}
        </span>
        <span className="text-[10px] text-faint font-display font-bold ml-0.5">{label}</span>
    </div>
);
