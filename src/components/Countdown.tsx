import React, { useState, useEffect } from 'react';
import { now as serverNow, syncServerClock } from '../utils/serverClock';
import { formatDeadline } from '../utils/formatTime';

// Explicit UTC offset makes this instant unambiguous regardless of viewer timezone
const NFL_KICKOFF = new Date('2026-09-09T18:20:00-06:00').getTime();

const TimeBox = ({ value, label }: { value: number; label: string }) => (
    <div className="flex flex-col items-center justify-center bg-slate-800/80 backdrop-blur-sm border border-slate-700 rounded-lg py-3 w-20 md:w-24 shadow-xl">
        <span className="text-3xl md:text-4xl font-black text-white" style={{ fontFamily: "'Montserrat', sans-serif" }}>
            {value.toString().padStart(2, '0')}
        </span>
        <span className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            {label}
        </span>
    </div>
);

export const Countdown: React.FC = () => {
    const [timeLeft, setTimeLeft] = useState(() => Math.max(0, NFL_KICKOFF - serverNow()));

    useEffect(() => {
        void syncServerClock();
        const timer = setInterval(() => {
            setTimeLeft(Math.max(0, NFL_KICKOFF - serverNow()));
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeLeft / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((timeLeft / 1000 / 60) % 60);
    const seconds = Math.floor((timeLeft / 1000) % 60);

    return (
        <div className="flex flex-col items-center gap-2">
            <div className="flex justify-center gap-2 md:gap-4">
                <TimeBox value={days} label="Days" />
                <TimeBox value={hours} label="Hours" />
                <TimeBox value={minutes} label="Minutes" />
                <TimeBox value={seconds} label="Seconds" />
            </div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                NFL Season Kickoff · {formatDeadline(NFL_KICKOFF)}
            </p>
        </div>
    );
};
