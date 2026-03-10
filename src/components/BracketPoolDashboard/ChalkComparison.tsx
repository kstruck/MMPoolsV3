import React, { useMemo, useState } from 'react';
import type { BracketEntry, Tournament } from '../../types';
import { BracketComparison } from './BracketComparison';

interface ChalkComparisonProps {
    tournament: Tournament;
    userEntries: BracketEntry[];
    isConference?: boolean;
}

export const ChalkComparison: React.FC<ChalkComparisonProps> = ({ tournament, userEntries, isConference }) => {
    const [selectedEntryId, setSelectedEntryId] = useState<string>(userEntries[0]?.id || '');
    const userEntry = userEntries.find(e => e.id === selectedEntryId) || userEntries[0];

    // Generate the "Chalk" entry based on the tournament data
    const chalkEntry = useMemo(() => {
        if (!tournament) return null;

        const picks: Record<string, string> = {};

        // Determine max round dynamically from tournament data
        const maxRound = Object.values(tournament.games).reduce((max, g) => Math.max(max, g.round), 0) || 6;

        // Build a mapping: slotId → gameId (each slot belongs to a game)
        // and a mapping: gameId → [slotIds that feed INTO this game via nextSlotId]
        const slotToGame: Record<string, string> = {};
        const gameFeederSlots: Record<string, string[]> = {};

        Object.values(tournament.slots).forEach(slot => {
            slotToGame[slot.id] = slot.gameId;
            if (slot.nextSlotId) {
                // Find which game the next slot belongs to
                const nextSlot = tournament.slots[slot.nextSlotId];
                if (nextSlot) {
                    const targetGameId = nextSlot.gameId;
                    if (!gameFeederSlots[targetGameId]) gameFeederSlots[targetGameId] = [];
                    gameFeederSlots[targetGameId].push(slot.gameId);
                }
            }
        });

        // Simulate all rounds from 1 to maxRound
        const simulateRound = (round: number) => {
            const gamesInRound = Object.values(tournament.games).filter(g => g.round === round);

            gamesInRound.forEach(game => {
                let teamA = game.homeTeamId;
                let teamB = game.awayTeamId;

                // For rounds after 1, look up feeder games
                if (round > 1) {
                    // Strategy 1: Use nextGameId feeders (NCAA pattern)
                    const feedGames = Object.values(tournament.games).filter(g => g.nextGameId === game.id);
                    if (feedGames.length === 2) {
                        teamA = picks[feedGames[0].id] || teamA || 'TBD';
                        teamB = picks[feedGames[1].id] || teamB || 'TBD';
                    } else if (feedGames.length === 1) {
                        // One feeder + one seeded team (bye scenario)
                        const feederWinner = picks[feedGames[0].id] || 'TBD';
                        if (!teamA || teamA === 'TBD') teamA = feederWinner;
                        else if (!teamB || teamB === 'TBD') teamB = feederWinner;
                    } else {
                        // Strategy 2: Use slot-based feeders (Conference pattern)
                        const feeders = gameFeederSlots[game.id];
                        if (feeders && feeders.length >= 2) {
                            teamA = picks[feeders[0]] || teamA || 'TBD';
                            teamB = picks[feeders[1]] || teamB || 'TBD';
                        } else if (feeders && feeders.length === 1) {
                            const feederWinner = picks[feeders[0]] || 'TBD';
                            if (!teamA || teamA === 'TBD') teamA = feederWinner;
                            else if (!teamB || teamB === 'TBD') teamB = feederWinner;
                        }
                    }
                }

                // If either team is still unknown, handle byes
                if (!teamA || teamA === 'TBD' || !teamB || teamB === 'TBD') {
                    if (teamA && teamA !== 'TBD' && (!teamB || teamB === 'TBD')) {
                        picks[game.id] = teamA;
                    } else if (teamB && teamB !== 'TBD' && (!teamA || teamA === 'TBD')) {
                        picks[game.id] = teamB;
                    } else {
                        picks[game.id] = 'TBD';
                    }
                    return;
                }

                const seedA = tournament.importedTeams?.[teamA]?.seed || 99;
                const seedB = tournament.importedTeams?.[teamB]?.seed || 99;

                // Lower seed number wins. If seeds are equal, pick teamA to be deterministic
                picks[game.id] = seedA <= seedB ? teamA : teamB;
            });
        };

        for (let i = 1; i <= maxRound; i++) {
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
                        <p className="text-slate-400 max-w-2xl mb-4">
                            "Chalk" means always picking the favorite (the higher seed) to win every matchup.
                            Compare your picks against the mathematically safest bracket.
                        </p>

                        {userEntries.length > 1 && (
                            <div className="flex flex-col gap-2 max-w-xs">
                                <label className="text-sm font-bold text-slate-400">Select Bracket to Compare</label>
                                <select
                                    value={selectedEntryId}
                                    onChange={(e) => setSelectedEntryId(e.target.value)}
                                    className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 font-medium"
                                >
                                    {userEntries.map(entry => (
                                        <option key={entry.id} value={entry.id}>{entry.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
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
                isConference={isConference}
            />
        </div>
    );
};
