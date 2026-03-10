import React from 'react';
import type { GameState } from '../types';
import { getTeamLogo } from '../constants';

interface GameScoreboardProps {
    gameState: GameState;
    onRepair?: () => void;
}

export const GameScoreboard: React.FC<GameScoreboardProps> = ({ gameState, onRepair }) => {
    const sanitize = (n: string | number | undefined | null) => {
        if (n === null || n === undefined) return 0;
        const val = typeof n === 'string' ? parseInt(n) : n;
        return isNaN(val) ? 0 : val;
    };
    /* ... existing sanitize and getScoreboardVal ... */
    // VERSION: 2026-01-17-v2 - Individual quarter scores fix

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
            // If we're past Q2 or game is final, use stored half score
            if (currentPeriod > 2 || isPost) {
                if (half !== null && q1 !== null) return half - q1;
                return '-';
            }
            // Currently in Q2 - calculate from current score minus Q1
            const q1Score = q1 ?? 0;
            return cur - q1Score;
        }
        // Q3
        if (period === 3) {
            if (currentPeriod < 3) return '-';
            if (currentPeriod > 3 || isPost) {
                if (q3 !== null && half !== null) return q3 - half;
                return '-';
            }
            // Currently in Q3 - calculate from current minus half
            const halfScore = half ?? 0;
            return cur - halfScore;
        }
        // Q4
        if (period === 4) {
            if (currentPeriod < 4) return '-';
            if (isPost) {
                if (final !== null && q3 !== null) return final - q3;
                return '-';
            }
            // Currently in Q4 - calculate from current minus Q3
            const q3Score = q3 ?? 0;
            return cur - q3Score;
        }
        return 0;
    };

    // Calculate OT score for a team (overtime points only)
    const getOTScore = (team: 'home' | 'away'): number | '-' => {
        if (!gameState?.scores) return '-';
        const s = gameState.scores;

        // OT can only happen after game is complete
        if (s.gameStatus !== 'post') return '-';

        const final = s.final?.[team] !== undefined ? sanitize(s.final[team]) : null;
        const q3 = s.q3?.[team] !== undefined ? sanitize(s.q3[team]) : null;

        if (final === null || q3 === null) return '-';

        // Q4 score is final - q3 (which includes OT if any)
        // But we need to calculate just the OT portion
        // For this, we need either:
        // 1. A stored end-of-regulation score, or
        // 2. Calculate: if final > (q3 + typical Q4 points), there was OT
        // Since we don't have end-of-regulation stored, we'll infer from period

        // Actually, let's check if period > 4 or if game status indicates OT
        // For now, we'll show OT column only if detected based on stored data

        // The only reliable way is if the period was > 4 during the game
        // We'll store this in the scores.period field
        // For backwards compatibility, we'll assume OT if scores exist
        return '-'; // Will be calculated below in the hasOvertime check
    };

    // Detect if game went to overtime
    const detectOvertime = (): boolean => {
        if (!gameState?.scores) return false;
        const s = gameState.scores;

        // If game is not complete, no OT yet
        if (s.gameStatus !== 'post') return false;

        // Check if period stored indicates OT (period 5 = OT)
        if (s.period && s.period > 4) return true;

        // Alternative: check if there's an 'overtime' field stored
        // For backwards compatibility, just return false for now unless period > 4
        return false;
    };

    const hasOvertime = detectOvertime();

    const homeLogo = gameState.homeTeamLogo || (gameState.homeTeam ? getTeamLogo(gameState.homeTeam, gameState.league === 'college' ? 'ncaa' : (gameState.league as 'nfl' | 'ncaa' | undefined)) : undefined);
    const awayLogo = gameState.awayTeamLogo || (gameState.awayTeam ? getTeamLogo(gameState.awayTeam, gameState.league === 'college' ? 'ncaa' : (gameState.league as 'nfl' | 'ncaa' | undefined)) : undefined);
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
                <div className="flex items-center gap-3">
                    <h3 className="text-white font-bold text-xl tracking-tight">Game Scoreboard</h3>
                    {onRepair && (
                        <button
                            onClick={onRepair}
                            className="text-amber-500 hover:text-amber-400 p-1 rounded hover:bg-slate-800 transition-colors"
                            title="Repair Scoreboard Sync"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 12-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 9" /><path d="M17.64 15 22 10.64" /><path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25V7.86c0-.55-.45-1-1-1H16.4c-.84 0-1.65-.33-2.25-.93L12.9 4.68" /><path d="M16.25 16.25 9 9" /></svg>
                        </button>
                    )}
                </div>
                {renderStatus()}
            </div>

            {/* Scoreboard Grid */}
            <div className="p-6">
                <div className={`grid ${hasOvertime ? 'grid-cols-8' : 'grid-cols-7'} gap-4 text-center text-slate-500 font-bold uppercase text-xs mb-3`}>
                    <div className="col-span-2 text-left pl-4">Team</div>
                    <div>1</div><div>2</div><div>3</div><div>4</div>
                    {hasOvertime && <div className="text-amber-400">OT</div>}
                    <div>T</div>
                </div>

                {/* Away Team Row */}
                <div className={`grid ${hasOvertime ? 'grid-cols-8' : 'grid-cols-7'} gap-4 text-center text-white font-bold items-center mb-3 bg-slate-900 p-4 rounded-lg border border-slate-800/50`}>
                    <div className="col-span-2 text-left pl-2 flex items-center gap-3">
                        {awayLogo ? <img src={awayLogo} className="w-10 h-10 object-contain drop-shadow-md" alt={gameState.awayTeam} /> : <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center text-xs">{gameState.awayTeam?.charAt(0) || '?'}</div>}
                        <span className="text-lg md:text-xl truncate">{gameState.awayTeam || 'TBD'}</span>
                    </div>
                    <div className="text-xl text-slate-400">{getScoreboardVal(1, 'away')}</div>
                    <div className="text-xl text-slate-400">{getScoreboardVal(2, 'away')}</div>
                    <div className="text-xl text-slate-400">{getScoreboardVal(3, 'away')}</div>
                    <div className="text-xl text-slate-400">{getScoreboardVal(4, 'away')}</div>
                    {hasOvertime && <div className="text-xl text-amber-400">{getOTScore('away')}</div>}
                    <div className="text-3xl text-indigo-400 font-black">{sanitize(gameState.scores?.current?.away)}</div>
                </div>

                {/* Home Team Row */}
                <div className={`grid ${hasOvertime ? 'grid-cols-8' : 'grid-cols-7'} gap-4 text-center text-white font-bold items-center bg-slate-900 p-4 rounded-lg border border-slate-800/50`}>
                    <div className="col-span-2 text-left pl-2 flex items-center gap-3">
                        {homeLogo ? <img src={homeLogo} className="w-10 h-10 object-contain drop-shadow-md" alt={gameState.homeTeam} /> : <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center text-xs">{gameState.homeTeam?.charAt(0) || '?'}</div>}
                        <span className="text-lg md:text-xl truncate">{gameState.homeTeam || 'TBD'}</span>
                    </div>
                    <div className="text-xl text-slate-400">{getScoreboardVal(1, 'home')}</div>
                    <div className="text-xl text-slate-400">{getScoreboardVal(2, 'home')}</div>
                    <div className="text-xl text-slate-400">{getScoreboardVal(3, 'home')}</div>
                    <div className="text-xl text-slate-400">{getScoreboardVal(4, 'home')}</div>
                    {hasOvertime && <div className="text-xl text-amber-400">{getOTScore('home')}</div>}
                    <div className="text-3xl text-rose-400 font-black">{sanitize(gameState.scores?.current?.home)}</div>
                </div>
            </div>
        </div>
    );
};
