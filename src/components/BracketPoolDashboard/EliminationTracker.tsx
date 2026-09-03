import React, { useMemo } from 'react';
import type { BracketEntry, Tournament, BracketPool } from '../../types';
import { calculateScore, isTeamAlive } from './bracketScoring';
import { Activity, TrendingUp, Skull, Shield, Trophy } from 'lucide-react';

interface EliminationTrackerProps {
    entry: BracketEntry;
    allEntries: BracketEntry[];
    tournament: Tournament;
    pool: BracketPool;
}

export const EliminationTracker: React.FC<EliminationTrackerProps> = ({ entry, allEntries, tournament, pool }) => {
    const analysis = useMemo(() => {
        const totalPicks = Object.keys(entry.picks).length;
        if (totalPicks === 0) return null;

        // Count alive picks
        let alivePicks = 0;
        let bustedPicks = 0;
        let pendingPicks = 0; // games not yet played

        for (const [slotId, teamId] of Object.entries(entry.picks)) {
            const game = tournament.games[slotId];
            if (!game) continue;

            if (game.status === 'FINAL') {
                if (game.winnerTeamId === teamId) {
                    alivePicks++;
                } else {
                    bustedPicks++;
                }
            } else {
                // Game hasn't been played yet — check if team is still alive
                if (isTeamAlive(teamId, tournament)) {
                    pendingPicks++;
                } else {
                    bustedPicks++;
                }
            }
        }

        const aliveTotal = alivePicks + pendingPicks;
        const alivePercent = totalPicks > 0 ? Math.round((aliveTotal / totalPicks) * 100) : 0;

        // Calculate scoring
        const userScore = calculateScore(entry, tournament, pool.settings);
        const maxPossible = userScore.maxPossibleScore;

        // Calculate best possible finish
        const allScores = allEntries.map(e => {
            const s = calculateScore(e, tournament, pool.settings);
            return { id: e.id, currentScore: s.score, maxScore: s.maxPossibleScore };
        });

        // Best possible: if I get max possible, how many people could still beat me?
        let bestRank = 1;
        for (const other of allScores) {
            if (other.id === entry.id) continue;
            // If other's current score already exceeds my max possible, they're ahead
            if (other.currentScore > maxPossible) {
                bestRank++;
            }
        }

        // Worst possible: if everyone else gets their max and I stay at current score
        let worstRank = 1;
        for (const other of allScores) {
            if (other.id === entry.id) continue;
            if (other.maxScore > userScore.score) {
                worstRank++;
            }
        }

        return {
            totalPicks,
            alivePicks,
            bustedPicks,
            pendingPicks,
            aliveTotal,
            alivePercent,
            currentScore: userScore.score,
            maxPossible,
            correctPicks: userScore.correctPicks,
            bestRank,
            worstRank,
            totalEntries: allEntries.length,
        };
    }, [entry, allEntries, tournament, pool.settings]);

    if (!analysis || analysis.totalPicks === 0) {
        return null;
    }

    const { alivePercent, aliveTotal, bustedPicks, totalPicks, currentScore, maxPossible, correctPicks, bestRank, totalEntries } = analysis;

    // Color coding
    const ringColor = alivePercent > 75 ? '#0F7B4A' : alivePercent > 50 ? '#C9A867' : '#C4342E';
    const statusLabel = alivePercent > 75 ? 'Strong' : alivePercent > 50 ? 'Hanging On' : alivePercent > 25 ? 'In Trouble' : 'Busted';
    const statusBg = alivePercent > 75 ? 'bg-[#0F7B4A]/10 border-[#0F7B4A]/30' : alivePercent > 50 ? 'bg-gold-500/10 border-gold-500/30' : 'bg-brandred-600/10 border-brandred-600/30';

    // SVG ring
    const radius = 36;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (alivePercent / 100) * circumference;

    return (
        <div className={`border rounded-xl p-5 ${statusBg}`}>
            <div className="flex flex-col gap-1 mb-4">
                <div className="flex items-center gap-2">
                    <Activity size={18} className="text-gold-500" />
                    <h3 className="text-lg font-display font-bold uppercase text-[color:var(--text)] max-w-[150px] truncate" title={entry.name || 'My Bracket'}>
                        {entry.name || 'My Bracket'}
                    </h3>
                    <span className={`text-xs font-display font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full ml-auto whitespace-nowrap
                        ${alivePercent > 75 ? 'bg-[#E4F5EC] text-[#0F7B4A] border border-[#BEE7D0]' : alivePercent > 50 ? 'bg-gold-500/20 text-gold-700' : 'bg-brandred-600/15 text-brandred-600'}
                    `}>
                        {statusLabel}
                    </span>
                </div>
            </div>

            <div className="flex items-center gap-6">
                {/* Circular progress ring */}
                <div className="relative flex-shrink-0">
                    <svg width="88" height="88" className="-rotate-90">
                        {/* Background ring */}
                        <circle cx="44" cy="44" r={radius} fill="none" stroke="var(--line)" strokeWidth="6" />
                        {/* Progress ring */}
                        <circle
                            cx="44" cy="44" r={radius} fill="none"
                            stroke={ringColor}
                            strokeWidth="6"
                            strokeDasharray={circumference}
                            strokeDashoffset={offset}
                            strokeLinecap="round"
                            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-xl font-display font-extrabold num text-[color:var(--text)]">{alivePercent}%</span>
                        <span className="text-[9px] text-muted font-display uppercase tracking-[0.08em]">Alive</span>
                    </div>
                </div>

                {/* Stats grid */}
                <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-2">
                    <div className="flex items-center gap-2">
                        <Shield size={14} className="text-[#0F7B4A]" />
                        <div>
                            <p className="text-xs text-faint">Alive</p>
                            <p className="text-sm font-bold num text-[#0F7B4A]">{aliveTotal} / {totalPicks}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Skull size={14} className="text-brandred-600" />
                        <div>
                            <p className="text-xs text-faint">Busted</p>
                            <p className="text-sm font-bold num text-brandred-600">{bustedPicks}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <TrendingUp size={14} className="text-gold-500" />
                        <div>
                            <p className="text-xs text-faint">Best Finish</p>
                            <p className="text-sm font-bold num text-gold-600">
                                {bestRank === 1 ? <><Trophy size={12} className="inline -mt-0.5 mr-0.5" />1st</> : `${bestRank}${bestRank === 2 ? 'nd' : bestRank === 3 ? 'rd' : 'th'}`}
                                <span className="text-faint font-normal"> / {totalEntries}</span>
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Activity size={14} className="text-gold-500" />
                        <div>
                            <p className="text-xs text-faint">Max Points</p>
                            <p className="text-sm font-bold num text-gold-600">
                                {maxPossible}
                                <span className="text-faint font-normal"> (now: {currentScore})</span>
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Correct picks bar */}
            <div className="mt-4">
                <div className="flex justify-between text-[10px] text-faint num mb-1">
                    <span>{correctPicks} correct picks</span>
                    <span>{bustedPicks} wrong</span>
                </div>
                <div className="w-full bg-line rounded-full h-1.5 overflow-hidden">
                    <div
                        className="h-full rounded-full bg-[#0F7B4A] transition"
                        style={{ width: `${totalPicks > 0 ? (correctPicks / (correctPicks + bustedPicks || 1)) * 100 : 0}%` }}
                    />
                </div>
            </div>
        </div>
    );
};
