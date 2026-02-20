
import React, { useState, useEffect } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';
import {
    Trophy, Download, RefreshCw, AlertTriangle, Check,
    Calendar, Users, Activity
} from 'lucide-react';
import type { Tournament } from '../../types';

export const TournamentManager: React.FC = () => {
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [importing, setImporting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    // Tournament Config
    const TOURNAMENT_ID = 'mens-2025';
    const YEAR = 2025;

    useEffect(() => {
        const db = getFirestore();
        const unsub = onSnapshot(doc(db, 'tournaments', TOURNAMENT_ID), (docSnap) => {
            if (docSnap.exists()) {
                setTournament({ id: docSnap.id, ...docSnap.data() } as Tournament);
            } else {
                setTournament(null);
            }
        });
        return () => unsub();
    }, []);

    const handleImport = async () => {
        setImporting(true);
        setError(null);
        setSuccessMsg(null);
        try {
            const functions = getFunctions();
            const importFn = httpsCallable(functions, 'importTournamentFromESPN');
            const result = await importFn({
                tournamentId: TOURNAMENT_ID,
                seasonYear: YEAR
            }) as { data: { success: boolean, count: number, teams: number, message?: string } };

            if (result.data.success) {
                setSuccessMsg(`Successfully imported ${result.data.count} games and ${result.data.teams} teams.`);
            } else {
                setError(result.data.message || 'Import failed.');
            }
        } catch (err: unknown) {
            console.error(err);
            setError(err instanceof Error ? err.message : 'Failed to call import function.');
        } finally {
            setImporting(false);
        }
    };

    const handleReset = async () => {
        if (!confirm('Are you sure you want to RESET the tournament? This will wipe existing data and re-initialize a skeleton.')) return;

        setIsLoading(true);
        setError(null);
        try {
            const functions = getFunctions();
            const initFn = httpsCallable(functions, 'adminInitTournament');
            await initFn({
                tournamentId: TOURNAMENT_ID,
                seasonYear: YEAR,
                gender: 'mens',
                teams: [] // Empty teams to trigger skeleton build? Or should we pass teams if we have them?
                // The backend logic for adminInitTournament re-builds skeleton.
            });
            setSuccessMsg('Tournament skeleton re-initialized.');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Unknown error during reset');
        } finally {
            setIsLoading(false);
        }
    };

    // Stats
    const teamCount = tournament?.importedTeams ? Object.keys(tournament.importedTeams).length : 0;
    const gameCount = tournament?.importedGames ? Object.keys(tournament.importedGames).length : 0;

    // Last Updated Helper
    const getLastUpdated = () => {
        if (!tournament?.lastUpdated) return 'Never';
        // Handle Firestore Timestamp or Date object or generic object with toDate
        const ts = tournament.lastUpdated;
        if (typeof ts === 'object' && 'toDate' in ts) {
            return ts.toDate().toLocaleString();
        }
        return 'Unknown';
    };
    const lastUpdated = getLastUpdated();

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Trophy className="text-amber-500" /> Tournament Manager
                    </h2>
                    <p className="text-slate-400 text-sm">Manage data for {YEAR} NCAA Tournament</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold border ${tournament ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                        {tournament ? 'Active' : 'Not Found'}
                    </span>
                </div>
            </div>

            {/* Status Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400"><Users size={20} /></div>
                        <span className="text-xs font-bold text-slate-500 uppercase">Teams</span>
                    </div>
                    <div className="text-2xl font-black text-white">{teamCount}</div>
                    <div className="text-xs text-slate-400">Imported Teams</div>
                </div>
                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 bg-amber-500/20 rounded-lg text-amber-400"><Calendar size={20} /></div>
                        <span className="text-xs font-bold text-slate-500 uppercase">Games</span>
                    </div>
                    <div className="text-2xl font-black text-white">{gameCount}</div>
                    <div className="text-xs text-slate-400">Scheduled / Final</div>
                </div>
                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400"><Activity size={20} /></div>
                        <span className="text-xs font-bold text-slate-500 uppercase">Last Sync</span>
                    </div>
                    <div className="text-lg font-bold text-white truncate">{lastUpdated}</div>
                    <div className="text-xs text-slate-400">From ESPN</div>
                </div>
            </div>

            {/* Actions */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
                <h3 className="text-lg font-bold text-white mb-4">Actions</h3>

                {error && (
                    <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2">
                        <AlertTriangle size={16} /> {error}
                    </div>
                )}

                {successMsg && (
                    <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-sm flex items-center gap-2">
                        <Check size={16} /> {successMsg}
                    </div>
                )}

                <div className="flex flex-col md:flex-row gap-4">
                    <button
                        onClick={handleImport}
                        disabled={importing}
                        className="flex-1 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg shadow-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
                    >
                        {importing ? <RefreshCw className="animate-spin" /> : <Download />}
                        {importing ? 'Importing from ESPN...' : 'Import Data from ESPN'}
                    </button>

                    <button
                        onClick={handleReset}
                        disabled={isLoading || importing}
                        className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 px-6 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
                    >
                        <RefreshCw className={isLoading ? "animate-spin" : ""} />
                        Re-Initialize Skeleton
                    </button>
                </div>
                <p className="mt-2 text-xs text-slate-500 text-center">
                    Importing will fetch live data from ESPN and update the tournament document.
                    Re-initializing will reset the bracket structure to a clean state.
                </p>
            </div>

            {/* Data Preview */}
            {tournament && (
                <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                    <div className="p-4 border-b border-slate-700 bg-slate-900/50">
                        <h3 className="font-bold text-white">Imported Data Preview</h3>
                    </div>
                    <div className="p-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Teams List */}
                            <div>
                                <h4 className="text-sm font-bold text-slate-400 uppercase mb-3">Teams ({teamCount})</h4>
                                <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                                    {Object.values(tournament.importedTeams || {}).map((team) => (
                                        <div key={team.id} className="flex items-center gap-3 p-2 bg-slate-900/50 rounded-lg border border-slate-700/50">
                                            {team.logoUrl ? (
                                                <img src={team.logoUrl} alt={team.name} className="w-6 h-6 object-contain" />
                                            ) : (
                                                <div className="w-6 h-6 bg-slate-700 rounded-full" />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-bold text-white truncate">{team.name}</div>
                                                <div className="text-xs text-slate-500">Seed: {team.seed}</div>
                                            </div>
                                        </div>
                                    ))}
                                    {teamCount === 0 && <p className="text-slate-500 text-sm">No teams imported.</p>}
                                </div>
                            </div>

                            {/* Games List */}
                            <div>
                                <h4 className="text-sm font-bold text-slate-400 uppercase mb-3">Recent Games ({gameCount})</h4>
                                <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                                    {Object.values(tournament.importedGames || {})
                                        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                                        .map((game) => {
                                            const homeTeam = (tournament.importedTeams || {})[game.homeTeamId];
                                            const awayTeam = (tournament.importedTeams || {})[game.awayTeamId];
                                            return (
                                                <div key={game.id} className="p-2 bg-slate-900/50 rounded-lg border border-slate-700/50">
                                                    <div className="flex justify-between items-center mb-1">
                                                        <span className="text-xs font-bold text-indigo-400">{game.status}</span>
                                                        <span className="text-xs text-slate-500">{new Date(game.startTime).toLocaleDateString()}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-sm">
                                                        <span className={game.winnerTeamId === game.homeTeamId ? 'text-amber-400 font-bold' : 'text-slate-300'}>
                                                            {homeTeam?.name || game.homeTeamId}
                                                            {game.homeScore > 0 && <span className="ml-2 text-white">{game.homeScore}</span>}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-sm">
                                                        <span className={game.winnerTeamId === game.awayTeamId ? 'text-amber-400 font-bold' : 'text-slate-300'}>
                                                            {awayTeam?.name || game.awayTeamId}
                                                            {game.awayScore > 0 && <span className="ml-2 text-white">{game.awayScore}</span>}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    {gameCount === 0 && <p className="text-slate-500 text-sm">No games imported.</p>}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
