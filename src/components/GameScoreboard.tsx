import React from 'react';
import type { GameState } from '../types';
import { getTeamLogo } from '../constants';

interface GameScoreboardProps {
    gameState: GameState;
}

export const GameScoreboard: React.FC<GameScoreboardProps> = ({ gameState }) => {
    const sanitize = (n: any) => {
        if (n === null || n === undefined) return 0;
        const val = parseInt(n);
        return isNaN(val) ? 0 : val;
    };

    const getScoreboardVal = (period: 1 | 2 | 3 | 4, team: 'home' | 'away') => {
        if (!gameState || !gameState.scores) return 0;
        const s = gameState.scores;
        const cur = sanitize(s.current?.[team]);

        const q1 = s.q1?.[team] !== undefined ? sanitize(s.q1[team]) : null;
        const half = s.half?.[team] !== undefined ? sanitize(s.half[team]) : null;
        const q3 = s.q3?.[team] !== undefined ? sanitize(s.q3[team]) : null;
        const final = s.final?.[team] !== undefined ? sanitize(s.final[team]) : null;

        const currentPeriod = s.period || 1;
        const isPost = s.gameStatus === 'post';

        // Q1
        if (period === 1) {
            if (currentPeriod > 1 || isPost) return q1 ?? 0;
            return cur; // Current Live
        }
        // Q2
        if (period === 2) {
            if (currentPeriod < 2) return '-';
            if (currentPeriod > 2 || isPost) return (half !== null && q1 !== null) ? half - q1 : '-';
            return (half !== null && q1 !== null) ? cur - q1 : (cur - (q1 ?? 0));
        }
        // Q3
        if (period === 3) {
            if (currentPeriod < 3) return '-';
            if (currentPeriod > 3 || isPost) return (q3 !== null && half !== null) ? q3 - half : '-';
            return (q3 !== null && half !== null) ? cur - half : (cur - (half ?? 0));
        }
        // Q4
        if (period === 4) {
            if (currentPeriod < 4) return '-';
            if (isPost) return (final !== null && q3 !== null) ? final - q3 : '-';
            return (final !== null && q3 !== null) ? cur - q3 : (cur - (q3 ?? 0));
        }
        return 0;
    };

    const homeLogo = gameState.homeTeamLogo || (gameState.homeTeam ? getTeamLogo(gameState.homeTeam) : undefined);
    const awayLogo = gameState.awayTeamLogo || (gameState.awayTeam ? getTeamLogo(gameState.awayTeam) : undefined);
    const { gameStatus, startTime, clock, period, syncStatus } = gameState.scores || {};

    // Determine status text
    const renderStatus = () => {
        if (gameStatus === 'in') {
            const pLabel = period === 1 ? '1st' : period === 2 ? '2nd' : period === 3 ? '3rd' : period === 4 ? '4th' : 'OT';
            return <div className="text-emerald-400 font-bold uppercase tracking-wider animate-pulse flex items-center gap-2 text-sm"><span className="w-2 h-2 bg-emerald-400 rounded-full"></span> Live • {pLabel} Qtr • {clock || '0:00'}</div>;
        }
        if (gameStatus === 'post') {
            return <p className="text-sm text-slate-400 font-bold uppercase tracking-wider">Final Score</p>;
        }
        if (startTime) {
            const dateObj = new Date(startTime);
            const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
            const timeStr = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' });
            return <p className="text-sm text-slate-500 font-bold uppercase tracking-wider">{dateStr} • {timeStr}</p>;
        }
        if (syncStatus === 'searching') return <p className="text-sm text-indigo-400 font-bold uppercase tracking-wider animate-pulse">Searching for Game...</p>;
        if (syncStatus === 'not-found') return <p className="text-sm text-rose-500 font-bold uppercase tracking-wider" title="Ensure Home/Away teams match ESPN names">No Active Game Found</p>;
        if (syncStatus === 'found' && !startTime) return <p className="text-sm text-amber-500 font-bold uppercase tracking-wider">Game Matched • Time TBD</p>;

        return <p className="text-sm text-slate-600 font-bold uppercase tracking-wider">Status: Pending (Idle)</p>;
    };

    return (
        <div className="bg-black rounded-xl border border-slate-800 p-0 shadow-xl overflow-hidden relative mb-8 max-w-4xl mx-auto w-full">
            <div className="absolute top-0 right-0 w-64 h-64 bg-slate-800/20 rounded-full blur-3xl"></div>
            <div className="p-4 border-b border-slate-800 text-center relative z-10 flex flex-col md:flex-row items-center justify-between px-8">
                <h3 className="text-white font-bold text-xl tracking-tight">Game Scoreboard</h3>
                {renderStatus()}
            </div>

            {/* Scoreboard Grid */}
            <div className="p-6">
                <div className="grid grid-cols-7 gap-4 text-center text-slate-500 font-bold uppercase text-xs mb-3">
                    <div className="col-span-2 text-left pl-4">Team</div>
                    <div>1</div><div>2</div><div>3</div><div>4</div><div>T</div>
                </div>

                {/* Away Team Row */}
                <div className="grid grid-cols-7 gap-4 text-center text-white font-bold items-center mb-3 bg-slate-900 p-4 rounded-lg border border-slate-800/50">
                    <div className="col-span-2 text-left pl-2 flex items-center gap-3">
                        {awayLogo ? <img src={awayLogo} className="w-10 h-10 object-contain drop-shadow-md" alt={gameState.awayTeam} /> : <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center text-xs">{gameState.awayTeam?.charAt(0) || '?'}</div>}
                        <span className="text-lg md:text-xl truncate">{gameState.awayTeam || 'TBD'}</span>
                    </div>
                    <div className="text-xl text-slate-400">{getScoreboardVal(1, 'away')}</div>
                    <div className="text-xl text-slate-400">{getScoreboardVal(2, 'away')}</div>
                    <div className="text-xl text-slate-400">{getScoreboardVal(3, 'away')}</div>
                    <div className="text-xl text-slate-400">{getScoreboardVal(4, 'away')}</div>
                    <div className="text-3xl text-indigo-400 font-black">{sanitize(gameState.scores?.current?.away)}</div>
                </div>

                {/* Home Team Row */}
                <div className="grid grid-cols-7 gap-4 text-center text-white font-bold items-center bg-slate-900 p-4 rounded-lg border border-slate-800/50">
                    <div className="col-span-2 text-left pl-2 flex items-center gap-3">
                        {homeLogo ? <img src={homeLogo} className="w-10 h-10 object-contain drop-shadow-md" alt={gameState.homeTeam} /> : <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center text-xs">{gameState.homeTeam?.charAt(0) || '?'}</div>}
                        <span className="text-lg md:text-xl truncate">{gameState.homeTeam || 'TBD'}</span>
                    </div>
                    <div className="text-xl text-slate-400">{getScoreboardVal(1, 'home')}</div>
                    <div className="text-xl text-slate-400">{getScoreboardVal(2, 'home')}</div>
                    <div className="text-xl text-slate-400">{getScoreboardVal(3, 'home')}</div>
                    <div className="text-xl text-slate-400">{getScoreboardVal(4, 'home')}</div>
                    <div className="text-3xl text-rose-400 font-black">{sanitize(gameState.scores?.current?.home)}</div>
                </div>
            </div>
        </div>
    );
};
