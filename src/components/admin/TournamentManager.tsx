import { logger } from '../../utils/logger';
import React, { useState, useEffect } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirestore, doc, onSnapshot, updateDoc, collection, getDocs, query, where, writeBatch } from 'firebase/firestore';
import {
    Trophy, Download, RefreshCw, AlertTriangle, Check,
    Calendar, Users, Activity, Clock
} from 'lucide-react';
import type { Tournament } from '../../types';

interface TournamentOption {
    id: string;
    label: string;
    seasonYear: number;
    gender: string;
    isFinalized: boolean;
}

export const TournamentManager: React.FC = () => {
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [importing, setImporting] = useState(false);
    const [syncingPlayIns, setSyncingPlayIns] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    // Lock-at editing state
    const [editLockAt, setEditLockAt] = useState<string>(''); // ISO datetime-local format
    const [savingLockAt, setSavingLockAt] = useState(false);

    // Dynamic tournament selection
    const [tournamentList, setTournamentList] = useState<TournamentOption[]>([]);
    const [selectedTournamentId, setSelectedTournamentId] = useState<string>('');
    const [loadingList, setLoadingList] = useState(true);

    // Fetch available tournaments on mount
    useEffect(() => {
        const fetchTournaments = async () => {
            setLoadingList(true);
            const db = getFirestore();
            const snapshot = await getDocs(collection(db, 'tournaments'));
            const options: TournamentOption[] = [];
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                let prefix = data.gender === 'womens' ? "Women's" : "Men's";
                if (docSnap.id.startsWith('bigeast')) prefix = 'Big East';
                if (docSnap.id.startsWith('big12')) prefix = 'Big 12';

                options.push({
                    id: docSnap.id,
                    label: `${prefix} ${data.seasonYear}${data.isFinalized ? ' (Finalized)' : ''}`,
                    seasonYear: data.seasonYear || 0,
                    gender: data.gender || 'mens',
                    isFinalized: data.isFinalized || false,
                });
            });

            // Inject Uninitialized Tournaments if not present
            if (!options.some(o => o.id === 'mens-2026')) {
                options.push({
                    id: 'mens-2026',
                    label: "Men's 2026 (Uninitialized)",
                    seasonYear: 2026,
                    gender: 'mens',
                    isFinalized: false
                });
            }
            if (!options.some(o => o.id === 'bigeast-2026')) {
                options.push({
                    id: 'bigeast-2026',
                    label: "Big East 2026 (Uninitialized)",
                    seasonYear: 2026,
                    gender: 'mens',
                    isFinalized: false
                });
            }
            if (!options.some(o => o.id === 'big12-2026')) {
                options.push({
                    id: 'big12-2026',
                    label: "Big 12 2026 (Uninitialized)",
                    seasonYear: 2026,
                    gender: 'mens',
                    isFinalized: false
                });
            }

            // Sort: active first, then by year descending
            options.sort((a, b) => {
                if (a.isFinalized !== b.isFinalized) return a.isFinalized ? 1 : -1;
                return b.seasonYear - a.seasonYear;
            });
            setTournamentList(options);
            // Auto-select first active tournament, or first in list
            if (options.length > 0 && !selectedTournamentId) {
                setSelectedTournamentId(options[0].id);
            }
            setLoadingList(false);
        };
        fetchTournaments();
    }, [selectedTournamentId]);

    // Subscribe to selected tournament
    useEffect(() => {
        if (!selectedTournamentId) return;
        const db = getFirestore();
        const unsub = onSnapshot(doc(db, 'tournaments', selectedTournamentId), (docSnap) => {
            if (docSnap.exists()) {
                const data = { id: docSnap.id, ...docSnap.data() } as Tournament;
                setTournament(data);
                // Initialize lockAt editor with current value in LOCAL time
                // toISOString() gives UTC - we need local time for datetime-local inputs
                if (data.lockAt) {
                    const d = new Date(data.lockAt);
                    const localISO = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                        .toISOString()
                        .slice(0, 16);
                    setEditLockAt(localISO);
                } else {
                    setEditLockAt('');
                }
            } else {
                setTournament(null);
                setEditLockAt('');
            }
        });
        return () => unsub();
    }, [selectedTournamentId]);

    // Derive year from selected tournament
    const selectedOption = tournamentList.find(t => t.id === selectedTournamentId);
    const selectedYear = selectedOption?.seasonYear || 2025;

    const handleImport = async () => {
        setImporting(true);
        setError(null);
        setSuccessMsg(null);
        try {
            const functions = getFunctions();
            let importFnName = 'importTournamentFromESPN';
            const params: Record<string, unknown> = {
                tournamentId: selectedTournamentId,
                seasonYear: selectedYear
            };

            if (selectedTournamentId.startsWith('bigeast') || selectedTournamentId.startsWith('big12')) {
                importFnName = 'importConferenceTournamentFromESPN';
                if (selectedTournamentId.startsWith('bigeast')) params.conferenceName = 'Big East';
                else if (selectedTournamentId.startsWith('big12')) params.conferenceName = 'Big 12';
            }

            const importFn = httpsCallable(functions, importFnName);
            const result = await importFn(params) as { data: { success: boolean, count: number, teams: number, message?: string } };

            if (result.data.success) {
                setSuccessMsg(`Successfully imported ${result.data.count} games and ${result.data.teams} teams.`);
            } else {
                setError(result.data.message || 'Import failed.');
            }
        } catch (err: unknown) {
            logger.error(err);
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
            let initFnName = 'adminInitTournament';
            if (selectedTournamentId.startsWith('bigeast')) initFnName = 'initializeBigEastTournamentHttp';
            if (selectedTournamentId.startsWith('big12')) initFnName = 'initializeBig12TournamentHttp';

            const initFn = httpsCallable(functions, initFnName);
            await initFn({
                tournamentId: selectedTournamentId,
                seasonYear: selectedYear,
                gender: selectedOption?.gender || 'mens',
                teams: [],
                overwrite: true,
            });
            setSuccessMsg('Tournament skeleton re-initialized.');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Unknown error during reset');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveLockAt = async () => {
        if (!editLockAt) return;
        setSavingLockAt(true);
        setError(null);
        try {
            const db = getFirestore();
            const lockAtMs = new Date(editLockAt).getTime();

            // 1. Save lock date to the tournament doc
            await updateDoc(doc(db, 'tournaments', selectedTournamentId), {
                lockAt: lockAtMs,
            });

            // 2. Propagate lockAt to all bracket pools linked to this tournament
            //    so the autoLock cloud function will pick them up automatically.
            const linkedPoolsSnap = await getDocs(
                query(
                    collection(db, 'pools'),
                    where('tournamentId', '==', selectedTournamentId),
                    where('type', '==', 'BRACKET')
                )
            );

            if (!linkedPoolsSnap.empty) {
                const batch = writeBatch(db);
                linkedPoolsSnap.forEach((poolDoc) => {
                    const poolData = poolDoc.data();
                    // Only update pools that aren't already locked
                    if (poolData.status !== 'LOCKED' && poolData.status !== 'COMPLETED') {
                        batch.update(poolDoc.ref, { lockAt: lockAtMs });
                    }
                });
                await batch.commit();
                setSuccessMsg(
                    `Lock date updated to ${new Date(lockAtMs).toLocaleString()}. ` +
                    `Synced to ${linkedPoolsSnap.size} linked bracket pool(s).`
                );
            } else {
                setSuccessMsg(`Lock date updated to ${new Date(lockAtMs).toLocaleString()}. No linked bracket pools found.`);
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to update lock date');
        } finally {
            setSavingLockAt(false);
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

    // LockAt display helper
    const lockAtDisplay = tournament?.lockAt
        ? new Date(tournament.lockAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
        : 'Not set';

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Trophy className="text-amber-500" /> Tournament Manager
                    </h2>
                    <p className="text-slate-400 text-sm">Manage NCAA Tournament data</p>
                </div>
                <div className="flex items-center gap-3">
                    <select
                        value={selectedTournamentId}
                        onChange={e => setSelectedTournamentId(e.target.value)}
                        disabled={loadingList || tournamentList.length === 0}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent appearance-none pr-8"
                        style={{ backgroundImage: 'none' }}
                    >
                        {loadingList && <option>Loading...</option>}
                        {tournamentList.map(t => (
                            <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                        {!loadingList && tournamentList.length === 0 && <option>No tournaments</option>}
                    </select>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold border ${tournament ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                        {tournament ? (tournament.isFinalized ? 'Finalized' : 'Active') : 'Not Found'}
                    </span>
                </div>
            </div>

            {/* Status Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 bg-cyan-500/20 rounded-lg text-cyan-400"><Clock size={20} /></div>
                        <span className="text-xs font-bold text-slate-500 uppercase">Lock Date</span>
                    </div>
                    <div className="text-sm font-bold text-white truncate">{lockAtDisplay}</div>
                    <div className="text-xs text-slate-400">Entries lock at this time</div>
                </div>
            </div>

            {/* Lock Date Editor */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Clock size={18} className="text-cyan-400" /> Tournament Lock Date
                </h3>
                <p className="text-xs text-slate-500 mb-4">
                    All bracket pools linked to this tournament will auto-lock entries at this time.
                    Typically set to the first game of the NCAA Tournament.
                </p>
                <div className="flex items-end gap-4">
                    <div className="flex-1">
                        <label className="text-xs text-slate-400 block mb-1">Lock Date & Time</label>
                        <input
                            type="datetime-local"
                            value={editLockAt}
                            onChange={e => setEditLockAt(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                        />
                    </div>
                    <button
                        onClick={handleSaveLockAt}
                        disabled={savingLockAt || !editLockAt}
                        className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2.5 px-6 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all text-sm"
                    >
                        {savingLockAt ? <RefreshCw className="animate-spin" size={14} /> : <Check size={14} />}
                        Save
                    </button>
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

                    <button
                        onClick={async () => {
                            setSyncingPlayIns(true);
                            setError(null);
                            setSuccessMsg('');
                            try {
                                const functions = getFunctions();
                                const syncFn = httpsCallable(functions, 'syncPlayInPicks');
                                const res = await syncFn({ tournamentId: selectedTournamentId });
                                setSuccessMsg((res.data as { message?: string })?.message || 'Play-in picks synced successfully!');
                            } catch (err: unknown) {
                                setError(err instanceof Error ? err.message : 'Error syncing play-in picks.');
                            } finally {
                                setSyncingPlayIns(false);
                            }
                        }}
                        disabled={syncingPlayIns || importing}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-6 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
                    >
                        {syncingPlayIns ? <RefreshCw className="animate-spin" /> : <Users />}
                        {syncingPlayIns ? 'Syncing...' : 'Sync Early Bracket Picks'}
                    </button>
                </div>
                <p className="mt-2 text-xs text-slate-500 text-center">
                    Importing will fetch live data from ESPN and update the tournament document.
                    Re-initializing will reset the bracket structure to a clean state.
                    Sync Early Bracket Picks will process brackets submitted prior to the play-in games.
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
