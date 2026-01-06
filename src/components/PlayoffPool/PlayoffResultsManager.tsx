import React, { useState } from 'react';
import type { PlayoffPool } from '../../types';
import { dbService } from '../../services/dbService';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase'; // Adjust import
import { Save, Trophy } from 'lucide-react';

interface PlayoffResultsManagerProps {
    pool: PlayoffPool;
    onClose: () => void;
}

export const PlayoffResultsManager: React.FC<PlayoffResultsManagerProps> = ({ pool, onClose }) => {
    // Initialize with existing results or empty arrays
    const [results, setResults] = useState<{
        WILD_CARD: string[];
        DIVISIONAL: string[];
        CONF_CHAMP: string[];
        SUPER_BOWL: string[];
    }>({
        WILD_CARD: pool.results?.WILD_CARD || [],
        DIVISIONAL: pool.results?.DIVISIONAL || [],
        CONF_CHAMP: pool.results?.CONF_CHAMP || [],
        SUPER_BOWL: pool.results?.SUPER_BOWL || [],
    });

    const [isSaving, setIsSaving] = useState(false);

    // Helper to toggle a team in a round
    const toggleTeam = (round: keyof typeof results, teamId: string) => {
        setResults(prev => {
            const current = prev[round];
            if (current.includes(teamId)) {
                return { ...prev, [round]: current.filter(id => id !== teamId) };
            } else {
                return { ...prev, [round]: [...current, teamId] };
            }
        });
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Call Global Update Function
            const updateGlobal = httpsCallable(functions, 'playoffPools-updateGlobalPlayoffResults');
            await updateGlobal({ results });

            setTimeout(onClose, 1500);
        } catch (error) {
            console.error(error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = async () => {
        if (!confirm("Are you sure you want to RESET all results? This will set all scores to 0 for affected rounds.")) return;

        setIsSaving(true);
        try {
            const emptyResults = {
                WILD_CARD: [],
                DIVISIONAL: [],
                CONF_CHAMP: [],
                SUPER_BOWL: []
            };

            // Call Global Update with Empty Results
            const updateGlobal = httpsCallable(functions, 'playoffPools-updateGlobalPlayoffResults');
            await updateGlobal({ results: emptyResults });

            setResults(emptyResults);
            setTimeout(onClose, 1500);
        } catch (error) {
            console.error(error);
        } finally {
            setIsSaving(false);
        }
    };

    // Render logic showing teams available in each round (simplified: show all teams, let admin pick)
    // Or better: Filter based on logic? For fallback, allow picking ANY team.

    const rounds = [
        { key: 'WILD_CARD', label: 'Wild Card' },
        { key: 'DIVISIONAL', label: 'Divisional' },
        { key: 'CONF_CHAMP', label: 'Conf. Champ' },
        { key: 'SUPER_BOWL', label: 'Super Bowl' },
    ];

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 rounded-xl border border-slate-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Trophy className="w-6 h-6 text-yellow-500" />
                        Manage Global Playoff Results
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white">Close</button>
                </div>

                <div className="p-6 space-y-8">
                    {rounds.map(round => (
                        <div key={round.key} className="space-y-4">
                            <h3 className="text-lg font-semibold text-emerald-400 border-b border-slate-800 pb-2">
                                {round.label} Winners
                            </h3>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {pool.teams.map(team => {
                                    const isSelected = results[round.key as keyof typeof results].includes(team.id);
                                    return (
                                        <button
                                            key={team.id}
                                            onClick={() => toggleTeam(round.key as any, team.id)}
                                            className={`p-2 rounded text-sm font-bold transition-colors ${isSelected
                                                ? 'bg-emerald-600 text-white'
                                                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                                }`}
                                        >
                                            {team.name}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="p-6 border-t border-slate-800 flex justify-between gap-3 sticky bottom-0 bg-slate-900">
                    <button
                        onClick={handleReset}
                        disabled={isSaving}
                        className="text-rose-400 hover:text-rose-300 px-4 py-2 font-bold text-sm"
                    >
                        Reset All Results
                    </button>

                    <div className="flex gap-3">
                        <button onClick={onClose} className="px-4 py-2 text-slate-300 hover:text-white">Cancel</button>
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2"
                        >
                            {isSaving ? 'Updating All Pools...' : 'Update All Pools'}
                            {!isSaving && <Save size={18} />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
