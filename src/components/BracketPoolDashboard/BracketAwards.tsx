import React, { useMemo } from 'react';
import { Trophy, Zap, Compass, Crosshair, Crown } from 'lucide-react';
import type { BracketEntry, Tournament } from '../../types';

interface BracketAwardsProps {
    entries: BracketEntry[];
    tournament: Tournament;
}

interface AwardResult {
    id: string;
    title: string;
    description: string;
    icon: React.ElementType;
    color: string;
    winners: string[];
    value: string | number;
}

export const BracketAwards: React.FC<BracketAwardsProps> = ({ entries, tournament }) => {
    const awards = useMemo(() => {
        if (!tournament || entries.length === 0) return [];
        // Determine awards if tournament has started or is completed

        const results: AwardResult[] = [];

        // 1. Crystal Ball - Most correct Round 1 picks
        const r1Games = Object.values(tournament.games).filter(g => g.round === 1 && g.winnerTeamId);
        if (r1Games.length > 0) {
            let maxR1 = 0;
            let currentWinners: string[] = [];

            entries.forEach(entry => {
                let correct = 0;
                r1Games.forEach(g => {
                    if (entry.picks[g.id] === g.winnerTeamId) correct++;
                });

                if (correct > maxR1) {
                    maxR1 = correct;
                    currentWinners = [entry.name];
                } else if (correct === maxR1 && correct > 0) {
                    currentWinners.push(entry.name);
                }
            });

            if (maxR1 > 0) {
                results.push({
                    id: 'crystal-ball',
                    title: 'Crystal Ball',
                    description: 'Most correct Round 1 picks',
                    icon: Compass,
                    color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
                    winners: currentWinners,
                    value: `${maxR1}/${r1Games.length}`
                });
            }
        }

        // 2. Upset King - Most upsets correctly called
        // Calculate upsets: winner seed > loser seed
        const completedGames = Object.values(tournament.games).filter(g => g.winnerTeamId);
        const upsets = completedGames.filter(g => {
            if (!g.winnerTeamId) return false;
            const loserTeamId = g.homeTeamId === g.winnerTeamId ? g.awayTeamId : g.homeTeamId;
            const winnerSeed = tournament.importedTeams?.[g.winnerTeamId]?.seed || 0;
            const loserSeed = tournament.importedTeams?.[loserTeamId]?.seed || 0;
            return winnerSeed > loserSeed; // Higher seed number means lower rank (an upset)
        });

        if (upsets.length > 0) {
            let maxUpsets = 0;
            let currentWinners: string[] = [];

            entries.forEach(entry => {
                let upsetCount = 0;
                upsets.forEach(g => {
                    if (entry.picks[g.id] === g.winnerTeamId) upsetCount++;
                });

                if (upsetCount > maxUpsets) {
                    maxUpsets = upsetCount;
                    currentWinners = [entry.name];
                } else if (upsetCount === maxUpsets && upsetCount > 0) {
                    currentWinners.push(entry.name);
                }
            });

            if (maxUpsets > 0) {
                results.push({
                    id: 'upset-king',
                    title: 'Upset King',
                    description: 'Most upsets correctly called',
                    icon: Zap,
                    color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
                    winners: currentWinners,
                    value: `${maxUpsets} upsets`
                });
            }
        }

        // 3. Chalk Walker - Highest average seed in Final Four picks
        // "Highest average seed" means lowest numbers (e.g. all 1 seeds) = chalkiest
        // Wait, chalk walker means picking mostly favorites.
        // Let's compute average seed of Final Four picks. The lower the better for Chalk Walker.
        const f4Games = Object.values(tournament.games).filter(g => g.round === 4);
        if (f4Games.length > 0) {
            // we'll assign to the one with the *lowest* average seed (most chalky)
            let minAvgSeed = 999;
            let currentWinners: string[] = [];
            let winningVal = '';

            entries.forEach(entry => {
                let totalSeed = 0;
                let pickCount = 0;
                f4Games.forEach(g => {
                    const pick = entry.picks[g.id];
                    if (pick) {
                        const seed = tournament.importedTeams?.[pick]?.seed || 1; // fallback
                        totalSeed += seed;
                        pickCount++;
                    }
                });
                if (pickCount > 0) {
                    const avgSeed = totalSeed / pickCount;
                    if (avgSeed < minAvgSeed) {
                        minAvgSeed = avgSeed;
                        currentWinners = [entry.name];
                        winningVal = avgSeed.toFixed(1);
                    } else if (avgSeed === minAvgSeed) {
                        currentWinners.push(entry.name);
                    }
                }
            });

            if (currentWinners.length > 0) {
                results.push({
                    id: 'chalk-walker',
                    title: 'Chalk Walker',
                    description: 'Safest Final Four picks (avg seed)',
                    icon: Trophy,
                    color: 'text-slate-300 bg-slate-500/10 border-slate-500/20',
                    winners: currentWinners,
                    value: `Avg: ${winningVal}`
                });
            }
        }

        // 4. Sharpshooter - Highest accuracy in later rounds (S16+)
        const lateGames = Object.values(tournament.games).filter(g => g.round >= 4 && g.winnerTeamId); // S16 is round 4
        if (lateGames.length > 0) {
            let maxLate = 0;
            let currentWinners: string[] = [];

            entries.forEach(entry => {
                let correct = 0;
                lateGames.forEach(g => {
                    if (entry.picks[g.id] === g.winnerTeamId) correct++;
                });

                if (correct > maxLate) {
                    maxLate = correct;
                    currentWinners = [entry.name];
                } else if (correct === maxLate && correct > 0) {
                    currentWinners.push(entry.name);
                }
            });

            if (maxLate > 0) {
                results.push({
                    id: 'sharpshooter',
                    title: 'Sharpshooter',
                    description: 'Most correct late-round picks (S16+)',
                    icon: Crosshair,
                    color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
                    winners: currentWinners,
                    value: `${maxLate}/${lateGames.length}`
                });
            }
        }

        // 5. Champion Caller - Correctly picked the champion
        const champGame = Object.values(tournament.games).find(g => g.round === 6 && g.winnerTeamId);
        if (champGame && champGame.winnerTeamId) {
            const currentWinners: string[] = [];
            const finalChampId = champGame.winnerTeamId; // Guaranteed string
            entries.forEach(entry => {
                if (entry.picks[champGame.id] === finalChampId) {
                    currentWinners.push(entry.name);
                }
            });

            if (currentWinners.length > 0) {
                results.push({
                    id: 'champ-caller',
                    title: 'Champion Caller',
                    description: 'Correctly predicted the National Champion',
                    icon: Crown,
                    color: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
                    winners: currentWinners,
                    value: tournament.importedTeams?.[finalChampId]?.name || 'Champ'
                });
            }
        }

        return results;
    }, [tournament, entries]);

    if (awards.length === 0) return null;

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl w-full">
            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <Trophy size={24} className="text-amber-400" /> End of Tournament Awards
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {awards.map((award) => (
                    <div key={award.id} className={`border rounded-lg p-5 flex flex-col justify-between ${award.color}`}>
                        <div>
                            <div className="flex justify-between items-start mb-2">
                                <div className="p-2 bg-slate-950/50 rounded-lg">
                                    <award.icon size={24} />
                                </div>
                                <span className="font-bold text-lg opacity-90">{award.value}</span>
                            </div>
                            <h4 className="text-lg font-bold mb-1">{award.title}</h4>
                            <p className="opacity-80 text-sm mb-4">{award.description}</p>
                        </div>

                        <div className="pt-4 border-t border-current/20">
                            <h5 className="text-xs uppercase tracking-wider opacity-70 mb-2 font-semibold">Awarded To</h5>
                            <div className="flex flex-wrap gap-2">
                                {award.winners.map((winner, idx) => (
                                    <span key={idx} className="bg-slate-950/50 px-2 py-1 rounded text-sm font-medium">
                                        {winner}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
