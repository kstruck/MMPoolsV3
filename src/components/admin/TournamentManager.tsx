import { logger } from '../../utils/logger';
import React, { useState, useEffect } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirestore, doc, onSnapshot, updateDoc, collection, getDocs, query, where, writeBatch } from 'firebase/firestore';
import {
    Trophy, Download, RefreshCw, AlertTriangle, Check,
    Calendar, Users, Activity, Clock
} from 'lucide-react';
import type { Tournament } from '../../types';
import { useToast } from '../ui/Toast';
import { Button, Badge } from '../ui';

interface TournamentOption {
    id: string;
    label: string;
    seasonYear: number;
    gender: string;
    isFinalized: boolean;
}

export const TournamentManager: React.FC = () => {
    const toast = useToast();
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
        const ok = await toast.confirm({
            title: 'Reset the tournament?',
            message: 'This will wipe existing data and re-initialize a skeleton.',
            danger: true,
        });
        if (!ok) return;

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
                    <h2 className="text-2xl font-display font-bold uppercase tracking-[0.03em] text-[color:var(--text)] flex items-center gap-2">
                        <Trophy className="text-gold-500" /> Tournament Manager
                    </h2>
                    <p className="text-muted text-sm font-body">Manage NCAA Tournament data</p>
                </div>
                <div className="flex items-center gap-3">
                    <select
                        value={selectedTournamentId}
                        onChange={e => setSelectedTournamentId(e.target.value)}
                        disabled={loadingList || tournamentList.length === 0}
                        className="bg-page border border-line rounded-lg px-3 py-1.5 text-[color:var(--text)] text-sm font-body focus:ring-2 focus:ring-gold-500 focus:border-transparent appearance-none pr-8"
                        style={{ backgroundImage: 'none' }}
                    >
                        {loadingList && <option>Loading...</option>}
                        {tournamentList.map(t => (
                            <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                        {!loadingList && tournamentList.length === 0 && <option>No tournaments</option>}
                    </select>
                    {tournament
                        ? <Badge status={tournament.isFinalized ? 'winner' : 'open'}>{tournament.isFinalized ? 'Finalized' : 'Active'}</Badge>
                        : <Badge status="locked">Not Found</Badge>}
                </div>
            </div>

            {/* Status Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-card p-4 rounded-xl border border-line shadow-card">
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 bg-navy-700/20 rounded-lg text-navy-700 dark:text-[#9FB0CC]"><Users size={20} /></div>
                        <span className="text-xs font-display font-bold text-faint uppercase tracking-[0.08em]">Teams</span>
                    </div>
                    <div className="text-2xl font-display font-bold text-[color:var(--text)] num">{teamCount}</div>
                    <div className="text-xs text-muted font-body">Imported Teams</div>
                </div>
                <div className="bg-card p-4 rounded-xl border border-line shadow-card">
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 bg-gold-500/20 rounded-lg text-gold-600"><Calendar size={20} /></div>
                        <span className="text-xs font-display font-bold text-faint uppercase tracking-[0.08em]">Games</span>
                    </div>
                    <div className="text-2xl font-display font-bold text-[color:var(--text)] num">{gameCount}</div>
                    <div className="text-xs text-muted font-body">Scheduled / Final</div>
                </div>
                <div className="bg-card p-4 rounded-xl border border-line shadow-card">
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 bg-navy-700/20 rounded-lg text-navy-700 dark:text-[#9FB0CC]"><Activity size={20} /></div>
                        <span className="text-xs font-display font-bold text-faint uppercase tracking-[0.08em]">Last Sync</span>
                    </div>
                    <div className="text-lg font-bold text-[color:var(--text)] truncate num">{lastUpdated}</div>
                    <div className="text-xs text-muted font-body">From ESPN</div>
                </div>
                <div className="bg-card p-4 rounded-xl border border-line shadow-card">
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 bg-gold-500/20 rounded-lg text-gold-600"><Clock size={20} /></div>
                        <span className="text-xs font-display font-bold text-faint uppercase tracking-[0.08em]">Lock Date</span>
                    </div>
                    <div className="text-sm font-bold text-[color:var(--text)] truncate num">{lockAtDisplay}</div>
                    <div className="text-xs text-muted font-body">Entries lock at this time</div>
                </div>
            </div>

            {/* Lock Date Editor */}
            <div className="bg-card rounded-xl border border-line p-6 shadow-card">
                <h3 className="text-lg font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-4 flex items-center gap-2">
                    <Clock size={18} className="text-gold-500" /> Tournament Lock Date
                </h3>
                <p className="text-xs text-faint mb-4 font-body">
                    All bracket pools linked to this tournament will auto-lock entries at this time.
                    Typically set to the first game of the NCAA Tournament.
                </p>
                <div className="flex items-end gap-4">
                    <div className="flex-1">
                        <label className="text-xs text-muted block mb-1 font-display font-bold uppercase tracking-[0.08em]">Lock Date & Time</label>
                        <input
                            type="datetime-local"
                            value={editLockAt}
                            onChange={e => setEditLockAt(e.target.value)}
                            className="w-full bg-page border border-line rounded-lg p-2.5 text-[color:var(--text)] text-sm font-body focus:ring-2 focus:ring-gold-500 focus:border-transparent"
                        />
                    </div>
                    <Button
                        variant="secondary"
                        onClick={handleSaveLockAt}
                        disabled={savingLockAt || !editLockAt}
                    >
                        {savingLockAt ? <RefreshCw className="animate-spin" size={14} /> : <Check size={14} />}
                        Save
                    </Button>
                </div>
            </div>

            {/* Actions */}
            <div className="bg-card rounded-xl border border-line p-6 shadow-card">
                <h3 className="text-lg font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-4">Actions</h3>

                {error && (
                    <div className="mb-4 p-3 bg-brandred-600/10 border border-brandred-600/30 rounded-lg text-brandred-500 text-sm flex items-center gap-2 font-body">
                        <AlertTriangle size={16} /> {error}
                    </div>
                )}

                {successMsg && (
                    <div className="mb-4 p-3 bg-[#0F7B4A]/10 border border-[#0F7B4A]/30 rounded-lg text-[#0F7B4A] text-sm flex items-center gap-2 font-body">
                        <Check size={16} /> {successMsg}
                    </div>
                )}

                <div className="flex flex-col md:flex-row gap-4">
                    <Button
                        variant="primary"
                        onClick={handleImport}
                        disabled={importing}
                        className="flex-1"
                    >
                        {importing ? <RefreshCw className="animate-spin" /> : <Download />}
                        {importing ? 'Importing from ESPN...' : 'Import Data from ESPN'}
                    </Button>

                    <Button
                        variant="ghost"
                        onClick={handleReset}
                        disabled={isLoading || importing}
                        className="flex-1"
                    >
                        <RefreshCw className={isLoading ? "animate-spin" : ""} />
                        Re-Initialize Skeleton
                    </Button>

                    <Button
                        variant="secondary"
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
                        className="flex-1"
                    >
                        {syncingPlayIns ? <RefreshCw className="animate-spin" /> : <Users />}
                        {syncingPlayIns ? 'Syncing...' : 'Sync Early Bracket Picks'}
                    </Button>
                </div>
                <p className="mt-2 text-xs text-faint text-center font-body">
                    Importing will fetch live data from ESPN and update the tournament document.
                    Re-initializing will reset the bracket structure to a clean state.
                    Sync Early Bracket Picks will process brackets submitted prior to the play-in games.
                </p>
            </div>

            {/* Data Preview */}
            {tournament && (
                <div className="bg-card rounded-xl border border-line overflow-hidden shadow-card">
                    <div className="p-4 border-b border-line bg-page/50">
                        <h3 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)]">Imported Data Preview</h3>
                    </div>
                    <div className="p-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Teams List */}
                            <div>
                                <h4 className="text-sm font-display font-bold text-muted uppercase tracking-[0.08em] mb-3">Teams (<span className="num">{teamCount}</span>)</h4>
                                <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                                    {Object.values(tournament.importedTeams || {}).map((team) => (
                                        <div key={team.id} className="flex items-center gap-3 p-2 bg-page/50 rounded-lg border border-line/50">
                                            {team.logoUrl ? (
                                                <img src={team.logoUrl} alt={team.name} className="w-6 h-6 object-contain" />
                                            ) : (
                                                <div className="w-6 h-6 bg-page rounded-full" />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-bold text-[color:var(--text)] truncate font-body">{team.name}</div>
                                                <div className="text-xs text-faint">Seed: <span className="num">{team.seed}</span></div>
                                            </div>
                                        </div>
                                    ))}
                                    {teamCount === 0 && <p className="text-faint text-sm font-body">No teams imported.</p>}
                                </div>
                            </div>

                            {/* Games List */}
                            <div>
                                <h4 className="text-sm font-display font-bold text-muted uppercase tracking-[0.08em] mb-3">Recent Games (<span className="num">{gameCount}</span>)</h4>
                                <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                                    {Object.values(tournament.importedGames || {})
                                        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                                        .map((game) => {
                                            const homeTeam = (tournament.importedTeams || {})[game.homeTeamId];
                                            const awayTeam = (tournament.importedTeams || {})[game.awayTeamId];
                                            return (
                                                <div key={game.id} className="p-2 bg-page/50 rounded-lg border border-line/50">
                                                    <div className="flex justify-between items-center mb-1">
                                                        <span className="text-xs font-display font-bold uppercase tracking-[0.06em] text-navy-700 dark:text-[#9FB0CC]">{game.status}</span>
                                                        <span className="text-xs text-faint num">{new Date(game.startTime).toLocaleDateString()}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-sm">
                                                        <span className={game.winnerTeamId === game.homeTeamId ? 'text-gold-600 font-bold font-body' : 'text-muted font-body'}>
                                                            {homeTeam?.name || game.homeTeamId}
                                                            {game.homeScore > 0 && <span className="ml-2 text-[color:var(--text)] num">{game.homeScore}</span>}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-sm">
                                                        <span className={game.winnerTeamId === game.awayTeamId ? 'text-gold-600 font-bold font-body' : 'text-muted font-body'}>
                                                            {awayTeam?.name || game.awayTeamId}
                                                            {game.awayScore > 0 && <span className="ml-2 text-[color:var(--text)] num">{game.awayScore}</span>}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    {gameCount === 0 && <p className="text-faint text-sm font-body">No games imported.</p>}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
