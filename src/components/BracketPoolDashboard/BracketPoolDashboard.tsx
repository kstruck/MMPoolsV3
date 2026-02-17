import React, { useState, useEffect, useCallback } from 'react';
import type { BracketPool, BracketEntry, Tournament, User } from '../../types';
import { LayoutDashboard, Users, Trophy, Share2, PlusCircle, ArrowLeft, Loader2, Send, Save, BarChart3, FileText, GitBranch, ShieldCheck, Target, Check, Copy, Download, MessageSquare, Edit3, X, Coins, Printer } from 'lucide-react';
import { BracketBuilder } from '../BracketBuilder/BracketBuilder';
import { StandingsTable } from './StandingsTable';
import { dbService } from '../../services/dbService';
import { shareTrackingService, type ShareStats } from '../../services/shareTrackingService';
import { calculateCorrectPicks } from '../../utils/bracketScoring';
import { DateTimePicker } from './DateTimePicker';
import { PickHistory } from './PickHistory';
import { WhoToRootFor } from './WhoToRootFor';
import { WhatIfSimulator } from './WhatIfSimulator';
import { ReportsTab } from './ReportsTab';
import { LiveScoreTicker } from './LiveScoreTicker';

type DashboardTab = 'dashboard' | 'standings' | 'entries' | 'brackets' | 'reports' | 'manager';
type BracketSubTab = 'poolwide' | 'history' | 'rootfor' | 'whatif';

interface BracketPoolDashboardProps {
    pool: BracketPool;
    user: User | null;
    onBack: () => void;
    onShare: () => void;
}

export const BracketPoolDashboard: React.FC<BracketPoolDashboardProps> = ({ pool, user, onBack, onShare }) => {
    const [activeTab, setActiveTab] = useState<DashboardTab>('dashboard');
    const [entries, setEntries] = useState<BracketEntry[]>([]);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [picks, setPicks] = useState<Record<string, string>>({});
    const [entryName, setEntryName] = useState('');
    const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [shareStats, setShareStats] = useState<ShareStats | null>(null);
    const [bracketSubTab, setBracketSubTab] = useState<BracketSubTab>('poolwide');

    // Entry Viewing Modal
    const [viewingEntry, setViewingEntry] = useState<BracketEntry | null>(null);

    const handleViewEntry = useCallback((entry: BracketEntry) => {
        setViewingEntry(entry);
    }, []);

    // Manager tab interactive state
    const [commissionerDraft, setCommissionerDraft] = useState(pool.commissionerMessage || '');
    const [savingMessage, setSavingMessage] = useState(false);
    const [messageSaved, setMessageSaved] = useState(false);
    const [togglingPayment, setTogglingPayment] = useState<string | null>(null);
    const [linkCopied, setLinkCopied] = useState(false);
    // Editable pool settings state
    const [editEntryFee, setEditEntryFee] = useState(pool.settings.entryFee);
    const [editMaxTotal, setEditMaxTotal] = useState(pool.settings.maxEntriesTotal);
    const [editMaxPerUser, setEditMaxPerUser] = useState(pool.settings.maxEntriesPerUser);
    const [editScoring, setEditScoring] = useState(pool.settings.scoringSystem);
    const [editRegDeadline, setEditRegDeadline] = useState<number | undefined>(pool.registrationDeadline);
    const [editSubDeadline, setEditSubDeadline] = useState<number | undefined>(pool.submissionDeadline);
    const [editLockAt, setEditLockAt] = useState<number | undefined>(pool.lockAt);
    const [savingSettings, setSavingSettings] = useState(false);
    const [settingsSaved, setSettingsSaved] = useState(false);
    const [editingSettings, setEditingSettings] = useState(false);

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

    // Load share analytics for managers
    useEffect(() => {
        if (isManager && activeTab === 'manager') {
            shareTrackingService.getStats(pool.id).then(setShareStats);
        }
    }, [isManager, activeTab, pool.id]);

    // Commissioner message save
    const handleSaveCommissionerMessage = useCallback(async () => {
        setSavingMessage(true);
        try {
            await dbService.updateBracketPool(pool.id, { commissionerMessage: commissionerDraft.trim() || null });
            setMessageSaved(true);
            setTimeout(() => setMessageSaved(false), 2000);
        } catch (err) {
            console.error('Failed to save commissioner message:', err);
            setError('Failed to save message');
        } finally {
            setSavingMessage(false);
        }
    }, [pool.id, commissionerDraft]);

    // Payment toggle
    const handleTogglePayment = useCallback(async (entryId: string, currentStatus: string) => {
        setTogglingPayment(entryId);
        try {
            const newStatus = currentStatus === 'PAID' ? 'UNPAID' : 'PAID';
            await dbService.updateBracketEntryPayment(pool.id, entryId, newStatus);
        } catch (err) {
            console.error('Failed to toggle payment:', err);
            setError('Failed to update payment');
        } finally {
            setTogglingPayment(null);
        }
    }, [pool.id]);

    // Save all pool settings
    const handleSaveSettings = useCallback(async () => {
        setSavingSettings(true);
        try {
            const updates: Record<string, unknown> = {
                'settings.entryFee': editEntryFee,
                'settings.maxEntriesTotal': editMaxTotal,
                'settings.maxEntriesPerUser': editMaxPerUser,
                'settings.scoringSystem': editScoring,
                registrationDeadline: editRegDeadline || null,
                submissionDeadline: editSubDeadline || null,
                lockAt: editLockAt || pool.lockAt,
            };
            await dbService.updateBracketPool(pool.id, updates);
            setSettingsSaved(true);
            setEditingSettings(false);
            setTimeout(() => setSettingsSaved(false), 2000);
        } catch (err) {
            console.error('Failed to save settings:', err);
            setError('Failed to save settings');
        } finally {
            setSavingSettings(false);
        }
    }, [pool.id, pool.lockAt, editEntryFee, editMaxTotal, editMaxPerUser, editScoring, editRegDeadline, editSubDeadline, editLockAt]);

    // CSV Export
    const handleExportCSV = useCallback(() => {
        const headers = ['Entry Name', 'Status', 'Paid Status', 'Score', 'Entry Fee'];
        const rows = entries.map(e => [
            e.name,
            e.status,
            e.paidStatus,
            String(e.score || 0),
            String(pool.settings.entryFee),
        ]);
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${pool.name.replace(/\s+/g, '-')}-accounting.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [entries, pool.name, pool.settings.entryFee]);

    // Copy link with feedback
    const handleCopyLink = useCallback(() => {
        navigator.clipboard.writeText(`${window.location.origin}/pool/${pool.slug}`);
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
    }, [pool.slug]);

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

            {/* Live Score Ticker */}
            <LiveScoreTicker tournament={tournament} />

            {/* Main Content */}
            <div className="max-w-6xl mx-auto p-4">

                {/* Commissioner Message Banner */}
                {pool.commissionerMessage && (
                    <div className="bg-indigo-900/30 border border-indigo-800 rounded-xl p-4 mb-6 flex items-start gap-3 animate-in fade-in">
                        <ShieldCheck className="text-indigo-400 shrink-0 mt-0.5" size={18} />
                        <div className="flex-1">
                            <p className="text-xs font-bold text-indigo-400 uppercase mb-1">Commissioner Message</p>
                            <p className="text-slate-300 text-sm">{pool.commissionerMessage}</p>
                        </div>
                    </div>
                )}

                {/* Navigation Tabs */}
                <div className="flex gap-2 mb-8 overflow-x-auto pb-2 scrollbar-hide">
                    {[
                        { id: 'dashboard' as DashboardTab, label: 'Overview', icon: LayoutDashboard },
                        { id: 'standings' as DashboardTab, label: 'Standings', icon: Trophy },
                        { id: 'entries' as DashboardTab, label: 'All Entries', icon: Users },
                        { id: 'brackets' as DashboardTab, label: 'Brackets', icon: GitBranch },
                        { id: 'reports' as DashboardTab, label: 'Reports', icon: FileText },
                        { id: 'manager' as DashboardTab, label: 'Manager', icon: ShieldCheck, hidden: !isManager },
                    ].map(tab => !tab.hidden && (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold transition-all whitespace-nowrap text-sm ${activeTab === tab.id ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}
                        >
                            <tab.icon size={14} />
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
                                {/* Pool Overview Stats Cards */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {/* Pot & Payouts */}
                                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-3 opacity-10">
                                            <Coins size={48} className="text-emerald-400" />
                                        </div>
                                        <h3 className="text-slate-400 text-xs font-bold uppercase mb-1">Total Pot</h3>
                                        <div className="text-2xl font-bold text-white mb-2">
                                            ${entries.length * pool.settings.entryFee}
                                        </div>
                                        <div className="text-xs text-slate-500">
                                            {entries.length} entries × ${pool.settings.entryFee}
                                        </div>
                                        {/* Payout Structure Hint */}
                                        <div className="mt-3 pt-3 border-t border-slate-800">
                                            <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Payouts</p>
                                            <div className="space-y-1">
                                                {pool.settings.payouts?.places.map((p, i) => (
                                                    <div key={i} className="flex justify-between text-xs">
                                                        <span className="text-slate-400">{p.rank === 1 ? '1st' : p.rank === 2 ? '2nd' : p.rank === 3 ? '3rd' : `${p.rank}th`}</span>
                                                        <span className="text-emerald-400 font-mono">
                                                            ${Math.floor((entries.length * pool.settings.entryFee) * (p.percentage / 100))}
                                                        </span>
                                                    </div>
                                                ))}
                                                {(!pool.settings.payouts?.places || pool.settings.payouts.places.length === 0) && (
                                                    <div className="text-xs text-slate-500 italic">No payouts configured</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* User Stats */}
                                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-3 opacity-10">
                                            <BarChart3 size={48} className="text-indigo-400" />
                                        </div>
                                        <h3 className="text-slate-400 text-xs font-bold uppercase mb-1">Your Stats</h3>
                                        <div className="grid grid-cols-2 gap-4 mt-2">
                                            <div>
                                                <div className="text-xl font-bold text-white">{userEntries.length}</div>
                                                <div className="text-[10px] text-slate-500 uppercase">Entries</div>
                                            </div>
                                            <div>
                                                <div className="text-xl font-bold text-amber-400">
                                                    {/* Calculate best rank or score */}
                                                    {userEntries.length > 0
                                                        ? Math.max(...userEntries.map(e => e.score || 0))
                                                        : '-'
                                                    }
                                                </div>
                                                <div className="text-[10px] text-slate-500 uppercase">Best Score</div>
                                            </div>
                                            {tournament && (
                                                <div className="col-span-2 mt-2 pt-2 border-t border-slate-800 flex justify-between items-center">
                                                    <span className="text-[10px] text-slate-500 uppercase">Max Correct Picks</span>
                                                    <span className="text-sm font-bold text-emerald-400">
                                                        {userEntries.length > 0
                                                            ? Math.max(...userEntries.map(e => calculateCorrectPicks(e, tournament)))
                                                            : '-'}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Tournament Status */}
                                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-3 opacity-10">
                                            <Trophy size={48} className="text-amber-500" />
                                        </div>
                                        <h3 className="text-slate-400 text-xs font-bold uppercase mb-1">Tournament</h3>
                                        <div className="text-sm font-bold text-white mt-1">
                                            {tournament?.isFinalized ? 'Finalized' : 'In Progress'}
                                        </div>
                                        <div className="text-xs text-slate-500 mt-1">
                                            Click on "Standings" to see live leaderboards.
                                        </div>
                                    </div>
                                </div>

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
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleViewEntry(entry)}
                                                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
                                                        title="View & Print"
                                                    >
                                                        <Printer size={16} />
                                                        <span className="hidden sm:inline">View</span>
                                                    </button>
                                                    <button
                                                        onClick={() => handleEditEntry(entry)}
                                                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-bold"
                                                        disabled={entry.status === 'SUBMITTED' && pool.status !== 'DRAFT'}
                                                    >
                                                        {entry.status === 'SUBMITTED' ? 'Edit' : 'Edit Draft'}
                                                    </button>
                                                </div>
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

                {/* Standings Tab */}
                {!loading && activeTab === 'standings' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4">
                        {tournament ? (
                            <StandingsTable
                                entries={entries}
                                pool={pool}
                                tournament={tournament}
                                currentUserId={user?.id}
                                onEntryClick={handleViewEntry}
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

                {/* Brackets Tab */}
                {!loading && activeTab === 'brackets' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 space-y-6">
                        {/* Brackets Sub-Navigation */}
                        <div className="flex gap-2 flex-wrap">
                            {[
                                { id: 'poolwide' as BracketSubTab, label: 'Poolwide Picks' },
                                { id: 'history' as BracketSubTab, label: 'Pick History' },
                                { id: 'rootfor' as BracketSubTab, label: 'Who to Root For' },
                                { id: 'whatif' as BracketSubTab, label: 'What-If Simulator' },
                            ].map(sub => (
                                <button
                                    key={sub.id}
                                    onClick={() => setBracketSubTab(sub.id)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${bracketSubTab === sub.id
                                        ? 'bg-indigo-600 text-white border-indigo-500'
                                        : 'bg-slate-900 text-slate-400 hover:bg-slate-800 border-slate-800'
                                        }`}
                                >
                                    {sub.label}
                                </button>
                            ))}
                        </div>

                        {/* Poolwide Picks Heatmap */}
                        {bracketSubTab === 'poolwide' && (
                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                                <div className="flex items-center gap-2 mb-4">
                                    <Target size={20} className="text-amber-400" />
                                    <h3 className="text-xl font-bold text-white">Poolwide Picks</h3>
                                </div>
                                <p className="text-slate-400 text-sm mb-4">See what percentage of the pool picked each team to advance in each round.</p>
                                {tournament ? (
                                    <div className="space-y-3">
                                        {Object.values(tournament.games)
                                            .filter(g => g.round === 1)
                                            .slice(0, 8)
                                            .map(game => {
                                                const homePicks = entries.filter(e => e.picks[game.id] === game.homeTeamId).length;
                                                const awayPicks = entries.filter(e => e.picks[game.id] === game.awayTeamId).length;
                                                const total = entries.length || 1;
                                                return (
                                                    <div key={game.id} className="flex items-center gap-2 bg-slate-950 rounded-lg p-3 border border-slate-800">
                                                        <div className="flex-1">
                                                            <div className="flex justify-between text-xs mb-1">
                                                                <span className="text-white">{game.homeTeamId}</span>
                                                                <span className="text-emerald-400 font-mono">{Math.round((homePicks / total) * 100)}%</span>
                                                            </div>
                                                            <div className="w-full bg-slate-800 rounded-full h-1.5">
                                                                <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${(homePicks / total) * 100}%` }} />
                                                            </div>
                                                        </div>
                                                        <span className="text-slate-600 text-xs">vs</span>
                                                        <div className="flex-1">
                                                            <div className="flex justify-between text-xs mb-1">
                                                                <span className="text-white">{game.awayTeamId}</span>
                                                                <span className="text-indigo-400 font-mono">{Math.round((awayPicks / total) * 100)}%</span>
                                                            </div>
                                                            <div className="w-full bg-slate-800 rounded-full h-1.5">
                                                                <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${(awayPicks / total) * 100}%` }} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                ) : (
                                    <div className="text-center py-12 text-slate-500">
                                        <GitBranch size={48} className="mx-auto mb-4 opacity-20" />
                                        <p>Bracket data will be available once the tournament bracket is set.</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Pick History */}
                        {bracketSubTab === 'history' && (
                            tournament && userEntries.length > 0 ? (
                                <PickHistory entry={userEntries[0]} tournament={tournament} pool={pool} />
                            ) : (
                                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center py-12 text-slate-500">
                                    <p>{!tournament ? 'Tournament data not yet available.' : 'Submit a bracket to see your pick history.'}</p>
                                </div>
                            )
                        )}

                        {/* Who to Root For */}
                        {bracketSubTab === 'rootfor' && (
                            tournament && userEntries.length > 0 ? (
                                <WhoToRootFor userEntry={userEntries[0]} allEntries={entries} tournament={tournament} pool={pool} />
                            ) : (
                                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center py-12 text-slate-500">
                                    <p>{!tournament ? 'Tournament data not yet available.' : 'Submit a bracket to see rooting advice.'}</p>
                                </div>
                            )
                        )}

                        {/* What-If Simulator */}
                        {bracketSubTab === 'whatif' && (
                            tournament ? (
                                <WhatIfSimulator entries={entries} tournament={tournament} pool={pool} currentUserId={user?.id} />
                            ) : (
                                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center py-12 text-slate-500">
                                    <p>Tournament data not yet available for simulation.</p>
                                </div>
                            )
                        )}
                    </div>
                )}

                {/* Reports Tab */}
                {!loading && activeTab === 'reports' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4">
                        <ReportsTab entries={entries} tournament={tournament} pool={pool} />
                    </div>
                )}

                {/* Manager Tab */}
                {!loading && activeTab === 'manager' && isManager && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 space-y-6 max-w-3xl">
                        {/* Pool Settings + Deadlines Card */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-xl font-bold text-white">Pool Settings</h3>
                                {!editingSettings ? (
                                    <button onClick={() => setEditingSettings(true)} className="text-xs text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1 px-3 py-1.5 border border-indigo-800 rounded-lg">
                                        <Edit3 size={12} /> Edit
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleSaveSettings}
                                        disabled={savingSettings}
                                        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
                                    >
                                        {savingSettings ? <Loader2 size={14} className="animate-spin" /> : settingsSaved ? <Check size={14} /> : <Save size={14} />}
                                        {settingsSaved ? 'Saved!' : 'Save Settings'}
                                    </button>
                                )}
                            </div>

                            {!editingSettings ? (
                                /* Read-Only View */
                                <div className="space-y-3">
                                    {[
                                        { label: 'Status', value: pool.status, color: 'text-emerald-400' },
                                        { label: 'Scoring', value: pool.settings.scoringSystem, color: 'text-white' },
                                        { label: 'Entries', value: `${entries.length} / ${pool.settings.maxEntriesTotal === -1 ? '\u221e' : pool.settings.maxEntriesTotal}`, color: 'text-white' },
                                        { label: 'Per User', value: pool.settings.maxEntriesPerUser === -1 ? 'Unlimited' : String(pool.settings.maxEntriesPerUser), color: 'text-white' },
                                        { label: 'Entry Fee', value: pool.settings.entryFee > 0 ? `$${pool.settings.entryFee}` : 'Free', color: 'text-white' },
                                        { label: 'Lock Date', value: new Date(pool.lockAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }), color: 'text-white' },
                                        { label: 'Registration', value: pool.registrationDeadline ? new Date(pool.registrationDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'None set', color: pool.registrationDeadline ? 'text-white' : 'text-slate-600' },
                                        { label: 'Submission', value: pool.submissionDeadline ? new Date(pool.submissionDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'None set', color: pool.submissionDeadline ? 'text-white' : 'text-slate-600' },
                                        { label: 'Tournament', value: pool.tournamentId || 'Not linked', color: 'text-slate-300' },
                                    ].map(row => (
                                        <div key={row.label} className="flex justify-between items-center p-3 bg-slate-950 rounded border border-slate-800">
                                            <span className="text-slate-400 text-sm">{row.label}</span>
                                            <span className={`font-mono text-sm ${row.color}`}>{row.value}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                /* Edit Mode */
                                <div className="space-y-4">
                                    {/* Status (read-only) */}
                                    <div className="flex justify-between items-center p-3 bg-slate-950 rounded border border-slate-800">
                                        <span className="text-slate-400 text-sm">Status</span>
                                        <span className="font-mono text-sm text-emerald-400">{pool.status}</span>
                                    </div>

                                    {/* Scoring System */}
                                    <div>
                                        <label className="text-xs text-slate-500 block mb-1">Scoring System</label>
                                        <select
                                            value={editScoring}
                                            onChange={e => setEditScoring(e.target.value as 'CLASSIC' | 'ESPN' | 'FIBONACCI' | 'CUSTOM')}
                                            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm"
                                        >
                                            <option value="CLASSIC">Classic (1-2-4-8-16-32)</option>
                                            <option value="ESPN">ESPN (10-20-40-80-160-320)</option>
                                            <option value="FIBONACCI">Fibonacci (1-1-2-3-5-8)</option>
                                            <option value="CUSTOM">Custom</option>
                                        </select>
                                    </div>

                                    {/* Entry Limits */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs text-slate-500 block mb-1">Max Entries (Total)</label>
                                            <input
                                                type="number"
                                                value={editMaxTotal}
                                                onChange={e => setEditMaxTotal(Number(e.target.value))}
                                                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm"
                                                min={-1}
                                                placeholder="-1 for unlimited"
                                            />
                                            <p className="text-[10px] text-slate-600 mt-1">-1 = unlimited</p>
                                        </div>
                                        <div>
                                            <label className="text-xs text-slate-500 block mb-1">Max Per User</label>
                                            <input
                                                type="number"
                                                value={editMaxPerUser}
                                                onChange={e => setEditMaxPerUser(Number(e.target.value))}
                                                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm"
                                                min={-1}
                                                placeholder="-1 for unlimited"
                                            />
                                            <p className="text-[10px] text-slate-600 mt-1">-1 = unlimited</p>
                                        </div>
                                    </div>

                                    {/* Entry Fee */}
                                    <div>
                                        <label className="text-xs text-slate-500 block mb-1">Entry Fee ($)</label>
                                        <input
                                            type="number"
                                            value={editEntryFee}
                                            onChange={e => setEditEntryFee(Number(e.target.value))}
                                            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm"
                                            min={0}
                                            step={5}
                                        />
                                    </div>

                                    {/* Date Pickers */}
                                    <div className="pt-3 border-t border-slate-800">
                                        <h4 className="text-sm font-bold text-white mb-3">Dates & Deadlines</h4>
                                        <div className="space-y-3">
                                            <DateTimePicker
                                                label="Lock Date (auto-lock entries)"
                                                value={editLockAt}
                                                onChange={ts => setEditLockAt(ts ?? undefined)}
                                            />
                                            <DateTimePicker
                                                label="Registration Deadline (no new members)"
                                                value={editRegDeadline}
                                                onChange={ts => setEditRegDeadline(ts ?? undefined)}
                                            />
                                            <DateTimePicker
                                                label="Submission Deadline (no new/edited brackets)"
                                                value={editSubDeadline}
                                                onChange={ts => setEditSubDeadline(ts ?? undefined)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Commissioner Message Editor */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                            <h3 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
                                <MessageSquare size={18} className="text-amber-400" /> Commissioner Message
                            </h3>
                            <p className="text-slate-400 text-xs mb-3">This message is displayed to all pool members as a banner.</p>
                            <textarea
                                value={commissionerDraft}
                                onChange={e => setCommissionerDraft(e.target.value)}
                                placeholder="Welcome to the pool! Payment is due by March 15th via Venmo..."
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white text-sm resize-none h-24 placeholder:text-slate-600"
                                maxLength={500}
                            />
                            <div className="flex items-center justify-between mt-2">
                                <span className="text-[10px] text-slate-600">{commissionerDraft.length}/500</span>
                                <button
                                    onClick={handleSaveCommissionerMessage}
                                    disabled={savingMessage}
                                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
                                >
                                    {savingMessage ? <Loader2 size={14} className="animate-spin" /> : messageSaved ? <Check size={14} /> : <Save size={14} />}
                                    {messageSaved ? 'Saved!' : 'Save Message'}
                                </button>
                            </div>
                        </div>

                        {/* Accounting Card */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                    💰 Accounting
                                </h3>
                                <button
                                    onClick={handleExportCSV}
                                    className="text-xs text-indigo-400 hover:text-indigo-300 font-bold px-3 py-1.5 border border-indigo-800 rounded-lg flex items-center gap-1"
                                >
                                    <Download size={12} /> Export CSV
                                </button>
                            </div>
                            {/* Summary Stats */}
                            <div className="grid grid-cols-3 gap-3 mb-4">
                                <div className="bg-slate-950 rounded-lg p-3 border border-slate-800 text-center">
                                    <p className="text-2xl font-bold text-emerald-400">${entries.filter(e => e.paidStatus === 'PAID').length * pool.settings.entryFee}</p>
                                    <p className="text-[10px] text-slate-500 uppercase">Collected</p>
                                </div>
                                <div className="bg-slate-950 rounded-lg p-3 border border-slate-800 text-center">
                                    <p className="text-2xl font-bold text-amber-400">${entries.filter(e => e.paidStatus !== 'PAID').length * pool.settings.entryFee}</p>
                                    <p className="text-[10px] text-slate-500 uppercase">Outstanding</p>
                                </div>
                                <div className="bg-slate-950 rounded-lg p-3 border border-slate-800 text-center">
                                    <p className="text-2xl font-bold text-white">${entries.length * pool.settings.entryFee}</p>
                                    <p className="text-[10px] text-slate-500 uppercase">Total Pot</p>
                                </div>
                            </div>
                            {/* Entry Payment List — now with toggle buttons */}
                            <div className="space-y-2">
                                {entries.map(entry => (
                                    <div key={entry.id} className="flex items-center justify-between p-3 bg-slate-950 rounded border border-slate-800">
                                        <div>
                                            <span className="text-white text-sm font-bold">{entry.name}</span>
                                            <span className="text-slate-500 text-xs ml-2">${pool.settings.entryFee}</span>
                                        </div>
                                        <button
                                            onClick={() => handleTogglePayment(entry.id, entry.paidStatus)}
                                            disabled={togglingPayment === entry.id}
                                            className={`text-xs font-bold px-3 py-1.5 rounded transition-colors flex items-center gap-1 ${entry.paidStatus === 'PAID' ? 'bg-emerald-400/10 text-emerald-400 hover:bg-emerald-400/20' : 'bg-red-400/10 text-red-400 hover:bg-red-400/20'}`}
                                        >
                                            {togglingPayment === entry.id ? (
                                                <Loader2 size={12} className="animate-spin" />
                                            ) : entry.paidStatus === 'PAID' ? (
                                                <><Check size={12} /> Paid</>
                                            ) : (
                                                <>✗ Unpaid</>
                                            )}
                                        </button>
                                    </div>
                                ))}
                                {entries.length === 0 && (
                                    <p className="text-slate-500 text-sm text-center py-4">No entries yet.</p>
                                )}
                            </div>
                        </div>

                        {/* Send Invitation */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                            <h3 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
                                <Send size={18} className="text-indigo-400" /> Send Invitation
                            </h3>
                            <p className="text-slate-400 text-sm mb-3">Share the pool link to invite players.</p>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    readOnly
                                    value={`${window.location.origin}/pool/${pool.slug}`}
                                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm font-mono"
                                />
                                <button
                                    onClick={handleCopyLink}
                                    className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1 transition-colors ${linkCopied ? 'bg-emerald-600 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}
                                >
                                    {linkCopied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy</>}
                                </button>
                            </div>
                        </div>

                        {/* Share Analytics Card */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                            <div className="flex items-center gap-2 mb-4">
                                <BarChart3 size={20} className="text-indigo-400" />
                                <h3 className="text-xl font-bold text-white">Share Analytics</h3>
                            </div>
                            {shareStats ? (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="bg-slate-950 rounded-lg p-4 border border-slate-800 text-center">
                                            <p className="text-3xl font-bold text-indigo-400">{shareStats.total}</p>
                                            <p className="text-[10px] text-slate-500 uppercase">Total Clicks</p>
                                        </div>
                                        <div className="bg-slate-950 rounded-lg p-4 border border-slate-800 text-center">
                                            <p className="text-3xl font-bold text-emerald-400">{shareStats.last7Days}</p>
                                            <p className="text-[10px] text-slate-500 uppercase">Last 7 Days</p>
                                        </div>
                                    </div>
                                    {Object.keys(shareStats.byPlatform).length > 0 ? (
                                        <div className="space-y-2">
                                            <p className="text-xs font-bold text-slate-400 uppercase">By Platform</p>
                                            {Object.entries(shareStats.byPlatform)
                                                .sort(([, a], [, b]) => b - a)
                                                .map(([platform, count]) => {
                                                    const pct = shareStats.total > 0 ? (count / shareStats.total) * 100 : 0;
                                                    const colors: Record<string, string> = {
                                                        facebook: 'bg-blue-500', twitter: 'bg-sky-500', reddit: 'bg-orange-500',
                                                        discord: 'bg-indigo-500', email: 'bg-slate-500', copy: 'bg-emerald-500',
                                                        instagram: 'bg-pink-500'
                                                    };
                                                    return (
                                                        <div key={platform} className="flex items-center gap-3">
                                                            <span className="text-xs text-slate-300 w-20 capitalize">{platform}</span>
                                                            <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
                                                                <div className={`h-full rounded-full ${colors[platform] || 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
                                                            </div>
                                                            <span className="text-xs font-mono text-slate-400 w-10 text-right">{count}</span>
                                                        </div>
                                                    );
                                                })}
                                        </div>
                                    ) : (
                                        <p className="text-slate-500 text-sm text-center py-4">No share clicks recorded yet.</p>
                                    )}
                                </div>
                            ) : (
                                <div className="text-center py-6">
                                    <Loader2 className="animate-spin text-indigo-400 mx-auto" size={24} />
                                    <p className="text-slate-500 text-xs mt-2">Loading share analytics...</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

            </div>
            {/* Viewing Entry Modal */}
            {viewingEntry && tournament && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl">
                        <div className="flex items-center justify-between p-4 border-b border-slate-700 bg-slate-950 rounded-t-2xl">
                            <div>
                                <h3 className="font-bold text-lg text-white flex items-center gap-2">
                                    {viewingEntry.name}
                                    <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-medium">
                                        Score: {viewingEntry.score || 0}
                                    </span>
                                </h3>
                                <p className="text-xs text-slate-400">
                                    Owner: {entries.find(e => e.id === viewingEntry.id)?.ownerUid === user?.id ? 'You' : 'Another User'}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => window.print()}
                                    className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-indigo-400 transition-colors flex items-center gap-2"
                                    title="Print Bracket"
                                >
                                    <Printer className="w-5 h-5" />
                                    <span className="text-sm font-bold hidden sm:block">Print</span>
                                </button>
                                <button
                                    onClick={() => setViewingEntry(null)}
                                    className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto p-4 bg-slate-950/50">
                            <BracketBuilder
                                tournament={tournament}
                                picks={viewingEntry.picks}
                                onPick={() => { }} // Read-only
                                readOnly={true}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Hidden Printable View - Only visible when printing */}
            {viewingEntry && tournament && (
                <div className="hidden print:block fixed inset-0 z-[100] bg-white">
                    <BracketBuilder
                        tournament={tournament}
                        picks={viewingEntry.picks}
                        onPick={() => { }} // Read-only
                        readOnly={true}
                        viewMode="full"
                    />
                </div>
            )}
        </div>
    );
};
