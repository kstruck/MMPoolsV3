import React, { useMemo } from 'react';
import type { BracketEntry, Tournament } from '../../types';
import { BracketComparison } from './BracketComparison';

interface ChalkComparisonProps {
    tournament: Tournament;
    userEntry: BracketEntry;
}

export const ChalkComparison: React.FC<ChalkComparisonProps> = ({ tournament, userEntry }) => {

    // Generate the "Chalk" entry based on the tournament data
    const chalkEntry = useMemo(() => {
        if (!tournament) return null;

        const picks: Record<string, string> = {};

        // We need to simulate the tournament from Round 1 to Round 6
        // Always advance the team with the better (lower) seed number.
        // For this, we need to know who is playing in each slot.
        const simulateRound = (round: number) => {
            const gamesInRound = Object.values(tournament.games).filter(g => g.round === round);

            gamesInRound.forEach(game => {
                let teamA = game.homeTeamId;
                let teamB = game.awayTeamId;

                // If it's not round 1, the teams are the winners of the previous slots
                if (round > 1) {
                    // Find the games that feed into this one
                    const feedGames = Object.values(tournament.games).filter(g => g.nextGameId === game.id);
                    if (feedGames.length === 2) {
                        teamA = picks[feedGames[0].id] || 'TBD';
                        teamB = picks[feedGames[1].id] || 'TBD';
                    }
                }

                if (teamA === 'TBD' || teamB === 'TBD') {
                    picks[game.id] = 'TBD';
                    return;
                }

                const seedA = tournament.importedTeams?.[teamA]?.seed || 99;
                const seedB = tournament.importedTeams?.[teamB]?.seed || 99;

                // Lower seed number wins. If seeds are equal, just pick teamA to be deterministic
                picks[game.id] = seedA <= seedB ? teamA : teamB;
            });
        };

        // Simulate all rounds
        for (let i = 1; i <= 6; i++) {
            simulateRound(i);
        }

        const entry: BracketEntry = {
            id: 'chalk-bracket',
            name: 'The Chalk Bracket (Perfect Favorites)',
            poolId: userEntry.poolId,
            ownerUid: 'system',
            status: 'SUBMITTED',
            paidStatus: 'PAID',
            score: 0,
            picks,
            createdAt: 0,
            updatedAt: 0
        };

        return entry;
    }, [tournament, userEntry.poolId]);

    if (!chalkEntry) return null;

    // Calculate how many upsets the user picked compared to chalk
    const totalPicks = Object.keys(userEntry.picks).filter(k => userEntry.picks[k] && userEntry.picks[k] !== 'TBD').length;
    const diffCount = Object.keys(userEntry.picks).filter(k => {
        const uPick = userEntry.picks[k];
        const cPick = chalkEntry.picks[k];
        return uPick && uPick !== 'TBD' && cPick && cPick !== 'TBD' && uPick !== cPick;
    }).length;

    const upsetPercent = totalPicks > 0 ? Math.round((diffCount / totalPicks) * 100) : 0;

    return (
        <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                    <span className="text-8xl font-black italic">CHALK</span>
                </div>
                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                            My Bracket vs. The Chalk
                        </h3>
                        <p className="text-slate-400 max-w-2xl">
                            "Chalk" means always picking the favorite (the higher seed) to win every matchup.
                            Compare your picks against the mathematically safest bracket.
                        </p>
                    </div>

                    <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex items-center gap-4 min-w-[200px] justify-center text-center">
                        <div>
                            <div className="text-3xl font-bold text-rose-400">{diffCount}</div>
                            <div className="text-xs uppercase tracking-wider text-slate-500 font-bold">Upset Picks</div>
                        </div>
                        <div className="w-px h-10 bg-slate-800"></div>
                        <div>
                            <div className="text-3xl font-bold text-amber-400">{upsetPercent}%</div>
                            <div className="text-xs uppercase tracking-wider text-slate-500 font-bold">Divergence</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* We reuse the BracketComparison, but force the two entries */}
            <BracketComparison
                tournament={tournament}
                allEntries={[userEntry, chalkEntry]}
                initialEntry1Id={userEntry.id}
                initialEntry2Id={chalkEntry.id}
                hideSelectors={true}
            />
        </div>
    );
};
