import { logger } from '../../utils/logger';
import React, { useState, useEffect } from 'react';
import type { PlayoffTeam } from '../../types';
import { httpsCallable } from 'firebase/functions';
import { functions, db } from '../../firebase'; // Adjust import if needed
import { doc, getDoc } from 'firebase/firestore';
import { Save, Trophy } from 'lucide-react';
import { useToast } from '../ui/Toast';
import { Button } from '../ui';

interface PlayoffResultsManagerProps {
    teams: PlayoffTeam[];
    onClose: () => void;
}

export const PlayoffResultsManager: React.FC<PlayoffResultsManagerProps> = ({ teams, onClose }) => {
    const toast = useToast();
    // Initialize with empty results
    const [results, setResults] = useState<{
        WILD_CARD: string[];
        DIVISIONAL: string[];
        CONF_CHAMP: string[];
        SUPER_BOWL: string[];
    }>({
        WILD_CARD: [],
        DIVISIONAL: [],
        CONF_CHAMP: [],
        SUPER_BOWL: [],
    });

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Fetch Global Results on Mount
    useEffect(() => {
        const fetchResults = async () => {
            try {
                const docRef = doc(db, 'system', 'playoff_results');
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (data.results) {
                        setResults(prev => ({
                            ...prev,
                            ...data.results
                        }));
                    }
                }
            } catch (error) {
                logger.error("Error fetching global results:", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchResults();
    }, []);

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
            const updateGlobal = httpsCallable(functions, 'updateGlobalPlayoffResults');
            await updateGlobal({ results });

            setTimeout(onClose, 1500);
        } catch (error) {
            logger.error(error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = async () => {
        const ok = await toast.confirm({
            title: 'Reset all results?',
            message: 'This will set all scores to 0 for affected rounds.',
            danger: true,
        });
        if (!ok) return;

        setIsSaving(true);
        try {
            const emptyResults = {
                WILD_CARD: [],
                DIVISIONAL: [],
                CONF_CHAMP: [],
                SUPER_BOWL: []
            };

            // Call Global Update with Empty Results
            const updateGlobal = httpsCallable(functions, 'updateGlobalPlayoffResults');
            await updateGlobal({ results: emptyResults });

            setResults(emptyResults);
            setTimeout(onClose, 1500);
        } catch (error) {
            logger.error(error);
        } finally {
            setIsSaving(false);
        }
    };

    const rounds = [
        { key: 'WILD_CARD', label: 'Wild Card' },
        { key: 'DIVISIONAL', label: 'Divisional' },
        { key: 'CONF_CHAMP', label: 'Conf. Champ' },
        { key: 'SUPER_BOWL', label: 'Super Bowl' },
    ];

    if (isLoading) return <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 text-white font-display font-bold uppercase">Loading Global Results...</div>;

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
            <div className="bg-card rounded-xl border border-line shadow-panel max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-line flex justify-between items-center">
                    <h2 className="text-xl font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-2">
                        <Trophy className="w-6 h-6 text-gold-500" />
                        Manage Global Playoff Results
                    </h2>
                    <button onClick={onClose} className="font-display font-bold uppercase text-[13px] tracking-[0.05em] text-muted hover:text-[color:var(--text)] transition-colors duration-150">Close</button>
                </div>

                <div className="p-6 space-y-8">
                    {rounds.map(round => (
                        <div key={round.key} className="space-y-4">
                            <h3 className="text-lg font-display font-bold uppercase tracking-[0.05em] text-gold-600 dark:text-gold-400 border-b border-line pb-2">
                                {round.label} Winners
                            </h3>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {teams.map(team => {
                                    const isSelected = results[round.key as keyof typeof results]?.includes(team.id);
                                    return (
                                        <button
                                            key={team.id}
                                            onClick={() => toggleTeam(round.key as any, team.id)}
                                            className={`p-2 rounded-md text-sm font-display font-bold uppercase tracking-[0.02em] transition-colors duration-150 ${isSelected
                                                ? 'bg-navy-800 text-white dark:ring-1 dark:ring-gold-500'
                                                : 'bg-surface border border-line text-muted hover:border-navy-600 hover:text-[color:var(--text)]'
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

                <div className="p-6 border-t border-line flex justify-between gap-3 sticky bottom-0 bg-card">
                    <button
                        onClick={handleReset}
                        disabled={isSaving}
                        className="text-brandred-600 hover:text-brandred-500 px-4 py-2 font-display font-bold uppercase tracking-[0.05em] text-sm transition-colors duration-150"
                    >
                        Reset All Results
                    </button>

                    <div className="flex gap-3">
                        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
                        <Button
                            size="sm"
                            onClick={handleSave}
                            disabled={isSaving}
                            className="px-6"
                        >
                            {isSaving ? 'Updating All Pools...' : 'Update All Pools'}
                            {!isSaving && <Save size={18} />}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};
