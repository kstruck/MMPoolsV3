
import React, { useState, useEffect, useCallback } from 'react';
import type { BracketPool, BracketEntry, Tournament, User } from '../../types';
import { LayoutDashboard, Users, Trophy, Settings, Share2, PlusCircle, ArrowLeft, Loader2, Send, Save } from 'lucide-react';
import { BracketBuilder } from '../BracketBuilder/BracketBuilder';
import { StandingsTable } from './StandingsTable';
import { dbService } from '../../services/dbService';

interface BracketPoolDashboardProps {
    pool: BracketPool;
    user: User | null;
    onBack: () => void;
    onShare: () => void;
}

export const BracketPoolDashboard: React.FC<BracketPoolDashboardProps> = ({ pool, user, onBack, onShare }) => {
    const [activeTab, setActiveTab] = useState<'dashboard' | 'standings' | 'entries' | 'settings'>('dashboard');
    const [entries, setEntries] = useState<BracketEntry[]>([]);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [picks, setPicks] = useState<Record<string, string>>({});
    const [entryName, setEntryName] = useState('');
    const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isManager = user ? pool.managerUid === user.id : false;
    const userEntries = entries.filter(e => e.ownerUid === user?.id);
    const maxEntriesPerUser = pool.settings?.maxEntriesPerUser || 1;
    const canCreateMore = userEntries.length < maxEntriesPerUser;

    // Subscribe to bracket entries
    useEffect(() => {
        const unsub = dbService.subscribeToBracketEntries(pool.id, (data) => {
            setEntries(data);
            setLoading(false);
        });
        return () => unsub();
    }, [pool.id]);

    // Fetch tournament data
    useEffect(() => {
        if (pool.tournamentId) {
            const unsub = dbService.subscribeToBracketTournament(pool.tournamentId, (data) => {
                setTournament(data);
            });
            return () => unsub();
        } else {
            // No tournament linked yet — show empty state
            setTournament(null);
        }
    }, [pool.tournamentId]);

    // Load user's existing entry picks when switching to edit mode
    const handleEditEntry = useCallback((entry: BracketEntry) => {
        setActiveEntryId(entry.id);
        setPicks(entry.picks || {});
        setEntryName(entry.name);
        setIsCreating(true);
    }, []);

    // Create a new bracket entry
    const handleCreateEntry = useCallback(async () => {
        if (!entryName.trim()) {
            setError('Please enter a name for your bracket.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const result = await dbService.createBracketEntry(pool.id, { name: entryName.trim() });
            if (result.success && result.entryId) {
                setActiveEntryId(result.entryId);
                setPicks({});
            } else {
                setError(result.message || 'Failed to create entry');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setSubmitting(false);
        }
    }, [pool.id, entryName]);

    // Save picks (draft)
    const handleSaveDraft = useCallback(async () => {
        if (!activeEntryId) return;
        setSubmitting(true);
        setError(null);
        try {
            const result = await dbService.updateBracketPicks(pool.id, activeEntryId, picks);
            if (!result.success) {
                setError(result.message || 'Failed to save draft');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to save');
        } finally {
            setSubmitting(false);
        }
    }, [pool.id, activeEntryId, picks]);

    // Submit final bracket
    const handleSubmitBracket = useCallback(async () => {
        if (!activeEntryId) return;
        setSubmitting(true);
        setError(null);
        try {
            const result = await dbService.submitBracketEntry(pool.id, activeEntryId, picks);
            if (result.success) {
                setIsCreating(false);
                setActiveEntryId(null);
                setPicks({});
                setEntryName('');
            } else {
                setError(result.message || 'Failed to submit bracket');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setSubmitting(false);
        }
    }, [pool.id, activeEntryId, picks]);

    const pickCount = Object.keys(picks).length;

    return (
        <div className="min-h-screen bg-slate-950 pb-20">
            {/* Header */}
            <div className="bg-slate-900 border-b border-slate-800 p-4 relative">
                <div className="max-w-6xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button onClick={onBack} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
                            <ArrowLeft size={20} />
                        </button>
                        <div>
                            <h1 className="text-xl font-bold text-white flex items-center gap-2">
                                <Trophy className="text-amber-500" size={24} />
                                {pool.name}
                            </h1>
                            <p className="text-xs text-slate-400 font-mono hidden md:block">/{pool.slug}</p>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button onClick={onShare} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 text-sm">
                            <Share2 size={16} /> Share
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-6xl mx-auto p-4">

                {/* Navigation Tabs */}
                <div className="flex gap-4 mb-8 overflow-x-auto pb-2 scrollbar-hide">
                    {[
                        { id: 'dashboard', label: 'My Entry', icon: LayoutDashboard },
                        { id: 'standings', label: 'Standings', icon: Trophy },
                        { id: 'entries', label: 'All Entries', icon: Users },
                        { id: 'settings', label: 'Settings', icon: Settings, hidden: !isManager },
                    ].map(tab => !tab.hidden && (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as 'dashboard' | 'standings' | 'entries' | 'settings')}
                            className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}
                        >
                            <tab.icon size={16} />
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Error Banner */}
                {error && (
                    <div className="bg-red-900/30 border border-red-800 text-red-300 px-4 py-3 rounded-xl mb-6 text-sm">
                        {error}
                        <button onClick={() => setError(null)} className="ml-2 underline hover:text-red-200">Dismiss</button>
                    </div>
                )}

                {/* Loading State */}
                {loading && (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="animate-spin text-indigo-400" size={32} />
                        <span className="ml-3 text-slate-400">Loading bracket pool...</span>
                    </div>
                )}

                {/* Tab Content */}
                {!loading && activeTab === 'dashboard' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4">
                        {!isCreating ? (
                            <div className="space-y-6">
                                {/* User's existing entries */}
                                {userEntries.length > 0 && (
                                    <div className="space-y-3">
                                        <h2 className="text-lg font-bold text-white">My Brackets</h2>
                                        {userEntries.map(entry => (
                                            <div key={entry.id} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
                                                <div>
                                                    <div className="font-bold text-white">{entry.name}</div>
                                                    <div className="text-xs text-slate-500">
                                                        {entry.status === 'SUBMITTED' ? (
                                                            <span className="text-emerald-400">✓ Submitted — Score: {entry.score || 0}</span>
                                                        ) : (
                                                            <span className="text-amber-400">Draft — {Object.keys(entry.picks || {}).length}/63 picks</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleEditEntry(entry)}
                                                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-bold"
                                                    disabled={entry.status === 'SUBMITTED' && pool.status !== 'DRAFT'}
                                                >
                                                    {entry.status === 'SUBMITTED' ? 'View' : 'Edit'}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Create new entry */}
                                {canCreateMore && (
                                    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-8 text-center">
                                        <h2 className="text-2xl font-bold text-white mb-4">
                                            {userEntries.length === 0 ? 'Create Your Bracket' : 'Add Another Entry'}
                                        </h2>
                                        <p className="text-slate-400 mb-6">
                                            {!tournament
                                                ? 'Tournament bracket data is not yet available. Check back after Selection Sunday!'
                                                : `Fill out all 63 games to complete your bracket.`}
                                        </p>
                                        {tournament && (
                                            <div className="max-w-sm mx-auto space-y-4">
                                                <input
                                                    type="text"
                                                    value={entryName}
                                                    onChange={e => setEntryName(e.target.value)}
                                                    placeholder="Entry name (e.g. 'My Lucky Bracket')"
                                                    className="w-full bg-slate-800 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                                    maxLength={50}
                                                />
                                                <button
                                                    onClick={handleCreateEntry}
                                                    disabled={submitting || !entryName.trim()}
                                                    className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold px-8 py-3 rounded-xl flex items-center justify-center gap-2 mx-auto transition-transform hover:scale-105"
                                                >
                                                    {submitting ? <Loader2 size={20} className="animate-spin" /> : <PlusCircle size={20} />}
                                                    Create Entry
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                                <div className="flex flex-wrap justify-between items-center gap-3 p-4 border-b border-slate-800 bg-slate-950">
                                    <div>
                                        <h3 className="font-bold text-white">{entryName}</h3>
                                        <span className="text-xs text-slate-500">{pickCount}/63 picks</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => { setIsCreating(false); setActiveEntryId(null); setPicks({}); }}
                                            className="text-slate-400 hover:text-white px-3 py-2 rounded text-sm"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleSaveDraft}
                                            disabled={submitting}
                                            className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded font-bold flex items-center gap-2 text-sm"
                                        >
                                            <Save size={14} /> Save Draft
                                        </button>
                                        <button
                                            onClick={handleSubmitBracket}
                                            disabled={submitting || pickCount < 63}
                                            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded font-bold flex items-center gap-2 text-sm"
                                        >
                                            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                            Submit Bracket
                                        </button>
                                    </div>
                                </div>
                                <div className="p-4 overflow-x-auto">
                                    {tournament ? (
                                        <BracketBuilder
                                            tournament={tournament}
                                            picks={picks}
                                            onPick={(slot, team) => setPicks(prev => ({ ...prev, [slot]: team }))}
                                            readOnly={false}
                                        />
                                    ) : (
                                        <div className="text-center py-10 text-slate-500">
                                            Tournament data not yet available.
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {!loading && activeTab === 'standings' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4">
                        {tournament ? (
                            <StandingsTable
                                entries={entries}
                                pool={pool}
                                tournament={tournament}
                                currentUserId={user?.id}
                            />
                        ) : (
                            <div className="text-center py-12 text-slate-500">
                                <Trophy size={48} className="mx-auto mb-4 opacity-20" />
                                <p>Standings will be available once the tournament bracket is finalized.</p>
                            </div>
                        )}
                    </div>
                )}

                {!loading && activeTab === 'entries' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4">
                        <h3 className="text-white font-bold mb-4">All Entries ({entries.length})</h3>
                        {entries.length === 0 ? (
                            <div className="text-center py-10 text-slate-500 italic">No entries yet.</div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {entries.map(entry => (
                                    <div key={entry.id} className={`bg-slate-900 p-4 rounded-lg border transition-colors ${entry.ownerUid === user?.id ? 'border-indigo-500 bg-indigo-900/10' : 'border-slate-800'}`}>
                                        <div className="font-bold text-white">{entry.name}</div>
                                        <div className="text-xs text-slate-500 mt-1">
                                            Score: <span className="text-emerald-400 font-mono">{entry.score || 0}</span>
                                            {' · '}
                                            <span className={entry.status === 'SUBMITTED' ? 'text-emerald-400' : 'text-amber-400'}>
                                                {entry.status === 'SUBMITTED' ? 'Submitted' : 'Draft'}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {!loading && activeTab === 'settings' && isManager && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 max-w-2xl">
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
                            <h3 className="text-xl font-bold text-white mb-4">Pool Settings</h3>
                            <div className="space-y-4">
                                <div className="flex justify-between items-center p-3 bg-slate-950 rounded border border-slate-800">
                                    <span className="text-slate-400">Status</span>
                                    <span className="font-mono text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded text-xs">{pool.status}</span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-slate-950 rounded border border-slate-800">
                                    <span className="text-slate-400">Scoring</span>
                                    <span className="text-white">{pool.settings.scoringSystem}</span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-slate-950 rounded border border-slate-800">
                                    <span className="text-slate-400">Entries</span>
                                    <span className="text-white">{entries.length} / {pool.settings.maxEntriesTotal || '∞'}</span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-slate-950 rounded border border-slate-800">
                                    <span className="text-slate-400">Tournament ID</span>
                                    <span className="font-mono text-slate-300 text-xs">{pool.tournamentId || 'Not linked'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};
