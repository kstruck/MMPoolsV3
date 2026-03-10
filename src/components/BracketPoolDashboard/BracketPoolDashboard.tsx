import { logger } from '../../utils/logger';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import type { BracketPool, BracketEntry, Tournament, User } from '../../types';
import { LayoutDashboard, Users, Trophy, PlusCircle, ArrowLeft, Loader2, Send, Save, BarChart3, FileText, GitBranch, ShieldCheck, Target, Check, Copy, Download, MessageSquare, Edit3, X, Coins, Printer, Lock, ChevronDown, ChevronUp, Palette, Bell, CreditCard, Key, Globe, Trash2, ClipboardList, Mail } from 'lucide-react';
import { BracketBuilder } from '../BracketBuilder/BracketBuilder';
import { ConferenceBracketBuilder } from '../BracketBuilder/ConferenceBracketBuilder';
import { StandingsTable } from './StandingsTable';
import { dbService } from '../../services/dbService';
import { shareTrackingService, type ShareStats } from '../../services/shareTrackingService';
import { calculateCorrectPicks } from '../../utils/bracketScoring';
import { isPoolManager, isSuperAdmin } from '../../utils/auth';
import { DateTimePicker } from './DateTimePicker';
import { PickHistory } from './PickHistory';
import { WhoToRootFor } from './WhoToRootFor';
import { WhatIfSimulator } from './WhatIfSimulator';
import { BracketComparison } from './BracketComparison';
// import { BracketShareModal } from './BracketShareCard'; // temporarily disabled - image generation failing
import { PoolAnalytics } from './PoolAnalytics';
import { BracketAwards } from './BracketAwards';
import { ChalkComparison } from './ChalkComparison';
import { ReportsTab } from './ReportsTab';
import { LiveScoreTicker } from './LiveScoreTicker';
import { EliminationTracker } from './EliminationTracker';
import { BracketCountdown } from './BracketCountdown';
import { AICommissioner } from '../AICommissioner';
import { BanterBoard } from './BanterBoard';
import { PaymentLedger } from './PaymentLedger';
import { ExportControls } from './ExportControls';

type DashboardTab = 'dashboard' | 'standings' | 'entries' | 'brackets' | 'reports' | 'manager' | 'ledger';
type BracketSubTab = 'poolwide' | 'history' | 'rootfor' | 'whatif' | 'compare' | 'chalk' | 'analytics' | 'insights';

interface BracketPoolDashboardProps {
    pool: BracketPool;
    user: User | null;
    onBack: () => void;
    onShare?: () => void; // temporarily unused - share feature disabled
}

export const BracketPoolDashboard: React.FC<BracketPoolDashboardProps> = ({ pool, user, onBack }) => {
    const [searchParams, setSearchParams] = useSearchParams();

    // Replace local state with URL params to enable correct browser back-button behavior
    const activeTab = (searchParams.get('tab') as DashboardTab) || 'dashboard';
    const setActiveTab = useCallback((tab: DashboardTab) => {
        setSearchParams(prev => {
            if (tab === 'dashboard') {
                prev.delete('tab');
            } else {
                prev.set('tab', tab);
            }
            return prev;
        }); // no {replace: true} because we want history items
    }, [setSearchParams]);

    const isCreating = searchParams.get('action') === 'create';
    const setIsCreating = useCallback((creating: boolean) => {
        setSearchParams(prev => {
            if (creating) {
                prev.set('action', 'create');
            } else {
                prev.delete('action');
            }
            return prev;
        }); // no {replace: true} because we want history items
    }, [setSearchParams]);

    const [entries, setEntries] = useState<BracketEntry[]>([]);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [picks, setPicks] = useState<Record<string, string>>({});
    const [entryName, setEntryName] = useState('');
    const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [shareStats, setShareStats] = useState<ShareStats | null>(null);
    const [bracketSubTab, setBracketSubTab] = useState<BracketSubTab>('poolwide');
    const [showSuccess, setShowSuccess] = useState(false);
    const [tieBreakerPrediction, setTieBreakerPrediction] = useState<number | undefined>(undefined);

    // Entry Viewing Modal
    const [viewingEntry, setViewingEntry] = useState<BracketEntry | null>(null);
    // sharingEntry/setSharingEntry removed - share feature temporarily disabled (image generation failing)

    // Create Entry Name Modal
    const [showNameModal, setShowNameModal] = useState(false);
    const [newNameInput, setNewNameInput] = useState('');

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
    const [editCustomScoring, setEditCustomScoring] = useState<number[]>(pool.settings.customScoring || [1, 2, 4, 8, 16, 32]);
    const [editRegDeadline, setEditRegDeadline] = useState<number | undefined>(pool.registrationDeadline);
    const [editSubDeadline, setEditSubDeadline] = useState<number | undefined>(pool.submissionDeadline);
    const [editLockAt, setEditLockAt] = useState<number | undefined>(pool.lockAt);
    const [savingSettings, setSavingSettings] = useState(false);
    const [settingsSaved, setSettingsSaved] = useState(false);
    const [editingSettings, setEditingSettings] = useState(false);

    // Pool Details
    const [editPoolName, setEditPoolName] = useState(pool.name);
    const [editManagerName, setEditManagerName] = useState(pool.managerName || '');
    const [editContactEmail, setEditContactEmail] = useState(pool.contactEmail || '');
    const [editIsPublic, setEditIsPublic] = useState(pool.isListedPublic);

    // Payment Info
    const [editVenmo, setEditVenmo] = useState(pool.venmo || '');
    const [editZelle, setEditZelle] = useState(pool.zelle || '');
    const [editCashapp, setEditCashapp] = useState(pool.cashapp || '');
    const [editPaypal, setEditPaypal] = useState(pool.paypal || '');
    const [editPaymentInstructions, setEditPaymentInstructions] = useState(pool.settings.paymentInstructions || '');

    // Tiebreaker
    const [editTiebreaker, setEditTiebreaker] = useState<'CLOSEST_ABSOLUTE' | 'CLOSEST_UNDER'>(
        pool.settings.tieBreakers?.closestUnder ? 'CLOSEST_UNDER' : 'CLOSEST_ABSOLUTE'
    );
    const [editUpsetBonusEnabled, setEditUpsetBonusEnabled] = useState(pool.settings.upsetBonus?.enabled || false);
    const [editUpsetMultiplier, setEditUpsetMultiplier] = useState(pool.settings.upsetBonus?.multiplier || 5);

    // Payouts
    const [editPayouts, setEditPayouts] = useState(pool.settings.payouts || { places: [{ rank: 1, percentage: 100 }], bonuses: [] });

    // Branding
    const [editBranding, setEditBranding] = useState(pool.branding || { bgColor: '#0f172a' });

    // Reminders
    const [editReminders, setEditReminders] = useState(pool.reminders || {
        auto24h: true, auto1h: true, autoLock: true, announceWinner: true, recipientFilter: 'all' as const
    });

    // Access Control
    const [editPassword, setEditPassword] = useState(pool.accessControl?.password || '');

    // Collapsible section toggles
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({ details: true, rules: true });
    const [sendingEmail, setSendingEmail] = useState(false);
    const toggleSection = (key: string) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

    const isManager = isPoolManager(user, pool);
    const userEntries = entries.filter(e => e.ownerUid === user?.id);
    const maxEntriesPerUser = pool.settings?.maxEntriesPerUser || 1;
    const canCreateMore = userEntries.length < maxEntriesPerUser;

    // Bracket Visibility Rules: Show brackets only when pool is locked and tournament has started
    const shouldShowBrackets = useMemo(() => {
        if (isManager) return true;
        const isLocked = pool.status === 'LOCKED' || pool.status === 'COMPLETED';
        const tournamentStarted = tournament?.games ? Object.values(tournament.games).some(g => g.winnerTeamId) : false;
        return isLocked && tournamentStarted;
    }, [pool.status, tournament, isManager]);

    const championshipGameId = useMemo(() => {
        if (!tournament) return null;
        let maxRound = 0;
        let finalGameId = null;
        Object.values(tournament.games).forEach(g => {
            if (g.round > maxRound) {
                maxRound = g.round;
                finalGameId = g.id;
            }
        });
        return finalGameId;
    }, [tournament]);

    const handleViewEntry = useCallback((entry: BracketEntry) => {
        if (entry.ownerUid !== user?.id && !isManager && !shouldShowBrackets) {
            alert("This bracket is hidden until the pool locks and the tournament begins.");
            return;
        }
        setViewingEntry(entry);
    }, [user?.id, isManager, shouldShowBrackets]);

    // Subscribe to bracket entries
    useEffect(() => {
        const unsub = dbService.subscribeToBracketEntries(pool.id, (data) => {
            setEntries(data);
            setLoading(false);
        });
        return () => unsub();
    }, [pool.id]);

    // Listen for master bracket print event
    useEffect(() => {
        const handlePrintMaster = () => {
            setViewingEntry({
                id: 'master',
                poolId: pool.id,
                ownerUid: 'system',
                name: 'Master Bracket',
                picks: {},
                score: 0,
                status: 'SUBMITTED',
                paidStatus: 'PAID',
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
        };
        window.addEventListener('print-master-bracket', handlePrintMaster);
        return () => window.removeEventListener('print-master-bracket', handlePrintMaster);
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
            await dbService.updateBracketPool(pool.id, { commissionerMessage: commissionerDraft });
            setMessageSaved(true);
            setTimeout(() => setMessageSaved(false), 2000);
        } catch (err) {
            logger.error('[BracketPoolDashboard] Error saving commissioner message:', err);
            setError('Failed to save commissioner message.');
        } finally {
            setSavingMessage(false);
        }
    }, [pool.id, commissionerDraft]);

    // Pool locking handlers
    const handleLockNow = useCallback(async () => {
        if (!window.confirm('Are you sure you want to lock the pool now? No more brackets can be submitted after locking.')) {
            return;
        }
        setSavingSettings(true);
        try {
            await dbService.updateBracketPool(pool.id, { status: 'LOCKED' });
            setSettingsSaved(true);
            setTimeout(() => setSettingsSaved(false), 2000);
        } catch (err) {
            logger.error('[BracketPoolDashboard] Error locking pool:', err);
            setError('Failed to lock pool.');
        } finally {
            setSavingSettings(false);
        }
    }, [pool.id]);

    const handleSaveLockAt = useCallback(async () => {
        if (!editLockAt) {
            setError('Please select a valid lock time.');
            return;
        }
        setSavingSettings(true);
        try {
            await dbService.updateBracketPool(pool.id, { lockAt: editLockAt });
            setSettingsSaved(true);
            setTimeout(() => setSettingsSaved(false), 2000);
        } catch (err) {
            logger.error('[BracketPoolDashboard] Error saving lock time:', err);
            setError('Failed to save lock time.');
        } finally {
            setSavingSettings(false);
        }
    }, [pool.id, editLockAt]);

    // Payment toggle
    const handleTogglePayment = useCallback(async (entryId: string, currentStatus: string) => {
        setTogglingPayment(entryId);
        try {
            const newStatus = currentStatus === 'PAID' ? 'UNPAID' : 'PAID';
            await dbService.updateBracketEntryPayment(pool.id, entryId, newStatus);
        } catch (err) {
            logger.error('Failed to toggle payment:', err);
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
                // Pool Details
                name: editPoolName,
                managerName: editManagerName,
                contactEmail: editContactEmail,
                isListedPublic: editIsPublic,
                // Payment Info
                venmo: editVenmo,
                zelle: editZelle,
                cashapp: editCashapp,
                paypal: editPaypal,
                'settings.paymentInstructions': editPaymentInstructions,
                // Rules
                'settings.entryFee': editEntryFee,
                'settings.maxEntriesTotal': editMaxTotal,
                'settings.maxEntriesPerUser': editMaxPerUser,
                'settings.scoringSystem': editScoring,
                'settings.customScoring': editScoring === 'CUSTOM' ? editCustomScoring : null,
                'settings.tieBreakers': {
                    closestAbsolute: editTiebreaker === 'CLOSEST_ABSOLUTE',
                    closestUnder: editTiebreaker === 'CLOSEST_UNDER',
                },
                'settings.upsetBonus': {
                    enabled: editUpsetBonusEnabled,
                    multiplier: editUpsetMultiplier,
                },
                // Payouts
                'settings.payouts': editPayouts,
                // Branding
                branding: editBranding,
                // Reminders
                reminders: editReminders,
                // Access Control
                'accessControl.password': editPassword || null,
                // Dates
                registrationDeadline: editRegDeadline || null,
                submissionDeadline: editSubDeadline || null,
                lockAt: editLockAt || pool.lockAt,
            };
            await dbService.updateBracketPool(pool.id, updates);
            setSettingsSaved(true);
            setEditingSettings(false);
            setTimeout(() => setSettingsSaved(false), 2000);
        } catch (err) {
            logger.error('Failed to save settings:', err);
            setError('Failed to save settings');
        } finally {
            setSavingSettings(false);
        }
    }, [pool.id, pool.lockAt, editPoolName, editManagerName, editContactEmail, editIsPublic,
        editVenmo, editZelle, editCashapp, editPaypal, editPaymentInstructions,
        editEntryFee, editMaxTotal, editMaxPerUser, editScoring, editCustomScoring, editTiebreaker,
        editPayouts, editBranding, editReminders, editPassword,
        editRegDeadline, editSubDeadline, editLockAt, editUpsetBonusEnabled, editUpsetMultiplier]);

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

    // Handle emailing users with incomplete entries
    const handleEmailIncomplete = async () => {
        try {
            setSendingEmail(true);
            const draftEntries = entries.filter(e => e.status === 'DRAFT');
            const draftUids = [...new Set(draftEntries.map(e => e.ownerUid))];

            const allEntryUids = new Set(entries.map(e => e.ownerUid));
            const participantsWithoutEntries = (pool.participantIds || []).filter(uid => !allEntryUids.has(uid));

            const combinedUidsToEmail = [...new Set([...draftUids, ...participantsWithoutEntries])];

            const allUsers = await dbService.getAllUsers();
            const incompleteEmails = allUsers
                .filter(u => combinedUidsToEmail.includes(u.id))
                .map(u => u.email)
                .filter(Boolean);

            if (incompleteEmails.length > 0) {
                const bcc = incompleteEmails.join(',');
                const subject = encodeURIComponent(`Action Required: Complete your bracket for ${pool.name}`);
                const body = encodeURIComponent(`Please complete and submit your bracket entry for ${pool.name} before the pool locks.\n\nLink: ${window.location.origin}/pool/${pool.slug}`);
                window.location.href = `mailto:?bcc=${bcc}&subject=${subject}&body=${body}`;
            } else {
                alert("No users found with incomplete entries.");
            }
        } catch (e) {
            console.error("Failed to fetch users", e);
            alert("Failed to fetch user emails.");
        } finally {
            setSendingEmail(false);
        }
    };

    // Load user's existing entry picks when switching to edit mode
    const handleEditEntry = useCallback((entry: BracketEntry) => {
        setActiveEntryId(entry.id);
        setPicks(entry.picks || {});
        setEntryName(entry.name);
        setTieBreakerPrediction(entry.tieBreakerPrediction);
        setIsCreating(true);
    }, [setIsCreating]);

    // Delete a user's entry
    const handleDeleteEntry = useCallback(async (entry: BracketEntry) => {
        if (!confirm(`Are you sure you want to delete "${entry.name}"? This action cannot be undone.`)) {
            return;
        }

        setError(null);
        try {
            const result = await dbService.deleteBracketEntry(pool.id, entry.id);
            if (!result.success) {
                setError(result.message || 'Failed to delete entry');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'An error occurred while deleting');
        }
    }, [pool.id]);

    // Create a new bracket entry
    const handleCreateEntry = useCallback(async (customName?: string) => {
        const finalName = customName || entryName.trim();
        if (!finalName) {
            setError('Please enter a name for your bracket.');
            return;
        }

        if (entries.some(e => e.name.toLowerCase() === finalName.toLowerCase())) {
            setError('That bracket name is already taken. Please choose another.');
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const result = await dbService.createBracketEntry(pool.id, { name: finalName });
            if (result.success && result.entryId) {
                setActiveEntryId(result.entryId);
                setPicks({});
                setEntryName(finalName);
                setTieBreakerPrediction(undefined);
                setIsCreating(true);
            } else {
                setError(result.message || 'Failed to create entry');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setSubmitting(false);
        }
    }, [pool.id, entryName, setIsCreating, entries]);

    // Save picks (draft)
    const handleSaveDraft = useCallback(async () => {
        if (!activeEntryId) return;

        if (entries.some(e => e.name.toLowerCase() === entryName.trim().toLowerCase() && e.id !== activeEntryId)) {
            setError('That bracket name is already taken. Please choose another.');
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const result = await dbService.updateBracketPicks(pool.id, activeEntryId, picks, tieBreakerPrediction, entryName.trim());
            if (!result.success) {
                setError(result.message || 'Failed to save draft');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to save');
        } finally {
            setSubmitting(false);
        }
    }, [pool.id, activeEntryId, picks, tieBreakerPrediction, entryName, entries]);

    // Submit final bracket
    const handleSubmitBracket = useCallback(async () => {
        if (!activeEntryId) return;

        if (entries.some(e => e.name.toLowerCase() === entryName.trim().toLowerCase() && e.id !== activeEntryId)) {
            setError('That bracket name is already taken. Please choose another.');
            return;
        }

        const reqPicks = tournament ? Object.keys(tournament.games).length : (pool.tournamentType === 'conference' ? 10 : 63);
        const currentPicksCount = Object.keys(picks).length;

        if (currentPicksCount < reqPicks) {
            setError(`Please complete all picks before submitting. You have made ${currentPicksCount} of ${reqPicks} picks.`);
            return;
        }

        if (tieBreakerPrediction === undefined || tieBreakerPrediction === null || String(tieBreakerPrediction).trim() === '') {
            setError('Please enter a tie-breaker prediction before submitting.');
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const result = await dbService.submitBracketEntry(pool.id, activeEntryId, picks, tieBreakerPrediction, entryName.trim());
            if (result.success) {
                setIsCreating(false);
                setActiveEntryId(null);
                setPicks({});
                setEntryName('');
                setTieBreakerPrediction(undefined);
                setShowSuccess(true);
                setTimeout(() => setShowSuccess(false), 3000);
            } else {
                setError(result.message || 'Failed to submit bracket');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setSubmitting(false);
        }
    }, [pool.id, pool.tournamentType, tournament, activeEntryId, picks, tieBreakerPrediction, entryName, setIsCreating, entries]);

    const pickCount = Object.keys(picks).length;
    const requiredPicks = tournament ? Object.keys(tournament.games).length : (pool.tournamentType === 'conference' ? 10 : 63);
    const isConference = pool.tournamentType === 'conference';

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
                        <ExportControls pool={pool} entries={entries} tournament={tournament} />
                        {/* Share button temporarily hidden - image generation failing */}
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
                        { id: 'ledger' as DashboardTab, label: 'Payment Ledger', icon: CreditCard, hidden: !isManager },
                        { id: 'manager' as DashboardTab, label: '⚙️ Settings', icon: ShieldCheck, hidden: !isManager },
                    ].map(tab => !tab.hidden && (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold transition-all whitespace-nowrap text-sm ${activeTab === tab.id
                                ? (tab.id === 'manager' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30' : 'bg-indigo-600 text-white')
                                : (tab.id === 'manager' ? 'bg-slate-900 border border-indigo-500/30 text-indigo-400 hover:bg-slate-800' : 'bg-slate-900 text-slate-400 hover:bg-slate-800')
                                }`}
                        >
                            {tab.id !== 'manager' && <tab.icon size={14} />}
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

                {/* Success Banner */}
                {showSuccess && (
                    <div className="bg-emerald-900/40 border border-emerald-800 text-emerald-300 px-4 py-3 rounded-xl mb-6 text-sm flex items-center gap-2 animate-in fade-in">
                        <Check size={16} />
                        Bracket submitted successfully!
                    </div>
                )}

                {/* Loading State */}
                {loading && (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="animate-spin text-indigo-400" size={32} />
                        <span className="ml-3 text-slate-400">Loading bracket pool...</span>
                    </div>
                )}

                {/* Countdown Timer */}
                {Boolean(pool.lockAt) && pool.status !== 'COMPLETED' && (
                    <div className="mb-6">
                        <BracketCountdown lockAt={pool.lockAt} />
                    </div>
                )}

                {/* Tab Content */}
                {!loading && activeTab === 'dashboard' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4">

                        {!isCreating ? (
                            <div className="space-y-6">
                                {/* Create new entry button (Moved to top)*/}
                                {canCreateMore && (
                                    <div className="flex justify-end">
                                        <button
                                            onClick={() => {
                                                setNewNameInput(`Bracket ${userEntries.length + 1}`);
                                                setShowNameModal(true);
                                            }}
                                            disabled={submitting || !tournament}
                                            title={!tournament ? "Tournament data not available yet" : ""}
                                            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold px-4 py-2 rounded-lg flex items-center gap-2"
                                        >
                                            {submitting ? <Loader2 size={18} className="animate-spin" /> : <PlusCircle size={18} />}
                                            {userEntries.length === 0 ? 'Create Your Bracket' : 'Add Another Entry'}
                                        </button>
                                    </div>
                                )}

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
                                                {pool.settings.charity?.enabled && (
                                                    <div className="flex justify-between text-xs border-t border-slate-800 pt-1 mt-1">
                                                        <span className="text-indigo-400">Charity ({pool.settings.charity.percentage}%)</span>
                                                        <span className="text-indigo-400 font-mono">
                                                            ${Math.floor((entries.length * pool.settings.entryFee) * (pool.settings.charity.percentage / 100))}
                                                        </span>
                                                    </div>
                                                )}
                                                {(!pool.settings.payouts?.places || pool.settings.payouts.places.length === 0) && !pool.settings.charity?.enabled && (
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
                                                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                                                        {entry.status === 'SUBMITTED' ? (
                                                            <>
                                                                <span className="text-emerald-400">✓ Submitted — Score: {entry.score || 0}</span>
                                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${entry.paidStatus === 'PAID' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                                                                    {entry.paidStatus === 'PAID' ? 'PAID' : 'PENDING'}
                                                                </span>
                                                            </>
                                                        ) : (
                                                            <span className="text-amber-400">Draft — {Object.keys(entry.picks || {}).length}/{requiredPicks} picks</span>
                                                        )}
                                                        {championshipGameId && entry.picks && entry.picks[championshipGameId] && entry.picks[championshipGameId] !== 'TBD' && (
                                                            <span className="text-slate-400 border-l border-slate-700 pl-2">
                                                                Champ: <span className="text-white font-bold">{entry.picks[championshipGameId]}</span>
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleViewEntry(entry); }}
                                                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
                                                        title="View & Print"
                                                    >
                                                        <Printer size={16} />
                                                        <span className="hidden sm:inline">View</span>
                                                    </button>
                                                    {/* Share button temporarily hidden - image generation failing */}
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleEditEntry(entry); }}
                                                        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-bold"
                                                        disabled={(entry.status === 'SUBMITTED' && pool.status !== 'DRAFT') || pool.status === 'LOCKED' || pool.status === 'COMPLETED'}
                                                    >
                                                        {entry.status === 'SUBMITTED' ? 'Edit' : 'Enter Picks/Edit Picks'}
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteEntry(entry); }}
                                                        className="bg-red-500/20 hover:bg-red-500/40 text-red-400 px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                                        title="Delete Entry"
                                                        disabled={pool.status === 'LOCKED' || pool.status === 'COMPLETED'}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}


                            </div>
                        ) : (
                            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                                <div className="flex flex-wrap justify-between items-center gap-3 p-4 border-b border-slate-800 bg-slate-950">
                                    <div>
                                        <input
                                            type="text"
                                            value={entryName}
                                            onChange={(e) => setEntryName(e.target.value)}
                                            className="font-bold text-white bg-transparent border-b border-transparent hover:border-slate-700 focus:border-indigo-500 focus:outline-none px-1 py-0.5 transition-colors w-full sm:w-64"
                                            placeholder="Bracket Name"
                                        />
                                        <div className="text-xs text-slate-500 px-1 mt-1">{pickCount}/{requiredPicks} picks</div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => { setIsCreating(false); setActiveEntryId(null); setPicks({}); setTieBreakerPrediction(undefined); }}
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
                                            disabled={submitting}
                                            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded font-bold flex items-center gap-2 text-sm"
                                        >
                                            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                            Submit Bracket
                                        </button>
                                    </div>
                                </div>
                                <div className="p-4 overflow-x-auto">
                                    {tournament ? (
                                        isConference ? (
                                            <ConferenceBracketBuilder
                                                tournament={tournament}
                                                picks={picks}
                                                onPick={(slot, team) => setPicks(prev => ({ ...prev, [slot]: team }))}
                                                readOnly={false}
                                            />
                                        ) : (
                                            <BracketBuilder
                                                tournament={tournament}
                                                picks={picks}
                                                onPick={(slot, team) => setPicks(prev => ({ ...prev, [slot]: team }))}
                                                readOnly={false}
                                            />
                                        )
                                    ) : (
                                        <div className="text-center py-10 text-slate-500">
                                            Tournament data not yet available.
                                        </div>
                                    )}
                                </div>

                                {/* Tiebreaker and Action Buttons (Bottom) */}
                                <div className="p-4 xl:px-6 border-t border-slate-800 bg-slate-900/50 flex flex-col xl:flex-row items-center justify-between gap-4">
                                    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full xl:w-auto">
                                        <div className="flex-1">
                                            <label className="text-sm font-bold text-amber-400 block mb-1">🏆 Tiebreaker</label>
                                            <p className="text-xs text-slate-400">Predict the total combined score of the championship game.</p>
                                        </div>
                                        <input
                                            type="number"
                                            min={0}
                                            max={500}
                                            value={tieBreakerPrediction ?? ''}
                                            onChange={(e) => setTieBreakerPrediction(e.target.value ? parseInt(e.target.value) : undefined)}
                                            placeholder="e.g. 145"
                                            className={`bg-slate-900 border ${error?.includes('tie-breaker') ? 'border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'border-slate-600'} rounded-lg px-4 py-2 text-white w-32 text-center font-mono text-lg focus:outline-none focus:border-amber-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                                        />
                                    </div>

                                    <div className="flex flex-wrap gap-2 w-full xl:w-auto justify-end">
                                        <button
                                            onClick={() => { setIsCreating(false); setActiveEntryId(null); setPicks({}); setTieBreakerPrediction(undefined); }}
                                            className="text-slate-400 hover:text-white px-3 py-2 rounded text-sm font-bold"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleSaveDraft}
                                            disabled={submitting}
                                            className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded font-bold flex items-center justify-center gap-2 text-sm"
                                        >
                                            <Save size={14} /> Save Draft
                                        </button>
                                        <button
                                            onClick={handleSubmitBracket}
                                            disabled={submitting}
                                            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2 rounded font-bold flex items-center justify-center gap-2 text-sm shadow-lg shadow-emerald-500/20"
                                        >
                                            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                            Submit Bracket
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Standings Tab */}
                {!loading && activeTab === 'standings' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 space-y-6">
                        {tournament?.isFinalized && entries.length > 0 && (
                            <BracketAwards tournament={tournament} entries={entries} />
                        )}
                        {tournament ? (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                <div className="lg:col-span-2">
                                    <StandingsTable
                                        entries={entries}
                                        pool={pool}
                                        tournament={tournament}
                                        currentUserId={user?.id}
                                        onEntryClick={handleViewEntry}
                                    />
                                </div>
                                <div className="lg:col-span-1 h-[600px] flex flex-col">
                                    <BanterBoard poolId={pool.id} user={user} />
                                </div>
                            </div>
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
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-white font-bold">All Entries ({entries.length})</h3>
                            {!shouldShowBrackets && !isManager && (
                                <p className="text-xs text-amber-400">
                                    Brackets will be visible after pool locks
                                </p>
                            )}
                        </div>
                        {entries.length === 0 ? (
                            <div className="text-center py-10 text-slate-500 italic">No entries yet.</div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {entries.map(entry => (
                                    <div
                                        key={entry.id}
                                        onClick={() => handleViewEntry(entry)}
                                        className={`bg-slate-900 p-4 rounded-lg border transition-all cursor-pointer hover:scale-105 ${entry.ownerUid === user?.id ? 'border-indigo-500 bg-indigo-900/10 hover:border-indigo-400' : 'border-slate-800 hover:border-slate-600'}`}
                                    >
                                        <div className="font-bold text-white flex items-center gap-2">
                                            {entry.name}
                                            {entry.ownerUid === user?.id && (
                                                <span className="text-xs bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded-full">You</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-slate-500 mt-1">
                                            Score: <span className="text-emerald-400 font-mono">{entry.score || 0}</span>
                                            {' · '}
                                            <span className={entry.status === 'SUBMITTED' ? 'text-emerald-400' : 'text-amber-400'}>
                                                {entry.status === 'SUBMITTED' ? 'Submitted' : 'Draft'}
                                            </span>
                                            {' · '}
                                            <span className={entry.paidStatus === 'PAID' ? 'text-emerald-400' : 'text-red-400'}>
                                                {entry.paidStatus === 'PAID' ? 'Paid' : 'Unpaid'}
                                            </span>
                                        </div>
                                        <div className="mt-2 text-xs text-indigo-400 font-bold">
                                            Click to view →
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
                        {/* Elimination Tracker - Bracket Health */}
                        {tournament && userEntries.some(e => e.status === 'SUBMITTED') && (
                            <div className="flex overflow-x-auto snap-x snap-mandatory gap-4 pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
                                {userEntries.filter(e => e.status === 'SUBMITTED').map(entry => (
                                    <div key={entry.id} className="w-[85vw] sm:w-[360px] shrink-0 snap-center first:pl-0">
                                        <EliminationTracker
                                            entry={entry}
                                            allEntries={entries}
                                            tournament={tournament}
                                            pool={pool}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Brackets Sub-Navigation */}
                        <div className="flex gap-2 flex-wrap">
                            {[
                                { id: 'poolwide' as BracketSubTab, label: 'Poolwide Picks' },
                                { id: 'history' as BracketSubTab, label: 'Pick History' },
                                { id: 'rootfor' as BracketSubTab, label: 'Who to Root For' },
                                { id: 'whatif' as BracketSubTab, label: 'What-If Simulator' },
                                { id: 'compare' as BracketSubTab, label: 'Compare Brackets' },
                                { id: 'chalk' as BracketSubTab, label: 'Vs. Chalk' },
                                { id: 'analytics' as BracketSubTab, label: 'Analytics' },
                                { id: 'insights' as BracketSubTab, label: '✨ AI Insights' },
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
                                <WhoToRootFor userEntries={userEntries} allEntries={entries} tournament={tournament} pool={pool} />
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

                        {/* Compare Brackets */}
                        {bracketSubTab === 'compare' && (
                            tournament && entries.length > 0 ? (
                                <div className="animate-in fade-in slide-in-from-bottom-4">
                                    <BracketComparison
                                        tournament={tournament}
                                        allEntries={pool.status === 'LOCKED' || pool.status === 'COMPLETED' ? entries : userEntries}
                                        initialEntry1Id={userEntries[0]?.id}
                                        isConference={isConference}
                                    />
                                </div>
                            ) : (
                                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center py-12 text-slate-500">
                                    <p>{!tournament ? 'Tournament data not yet available.' : 'Need at least 2 entries to compare.'}</p>
                                </div>
                            )
                        )}

                        {/* Vs Chalk */}
                        {bracketSubTab === 'chalk' && (
                            tournament && userEntries.length > 0 ? (
                                <div className="animate-in fade-in slide-in-from-bottom-4">
                                    <ChalkComparison tournament={tournament} userEntries={userEntries} isConference={isConference} />
                                </div>
                            ) : (
                                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center py-12 text-slate-500">
                                    <p>{!tournament ? 'Tournament data not yet available.' : 'Submit a bracket to compare.'}</p>
                                </div>
                            )
                        )}

                        {/* Analytics */}
                        {bracketSubTab === 'analytics' && (
                            tournament && entries.length > 0 ? (
                                <div className="animate-in fade-in slide-in-from-bottom-4">
                                    <PoolAnalytics
                                        tournament={tournament}
                                        entries={pool.status === 'LOCKED' || pool.status === 'COMPLETED' ? entries : userEntries}
                                        isConference={isConference}
                                    />
                                </div>
                            ) : (
                                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center py-12 text-slate-500">
                                    <p>{!tournament ? 'Tournament data not yet available.' : 'Need at least 1 entry for analytics.'}</p>
                                </div>
                            )
                        )}

                        {/* AI Insights */}
                        {bracketSubTab === 'insights' && (
                            <div className="animate-in fade-in slide-in-from-bottom-4">
                                <AICommissioner poolId={pool.id} userId={user?.id} poolType="BRACKET" />
                            </div>
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
                                    ((pool.status !== 'LOCKED' && pool.status !== 'COMPLETED') || isSuperAdmin(user)) ? (
                                        <button onClick={() => setEditingSettings(true)} className="text-xs text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1 px-3 py-1.5 border border-indigo-800 rounded-lg">
                                            <Edit3 size={12} /> Edit
                                        </button>
                                    ) : (
                                        <span className="text-xs text-slate-500 font-bold px-3 py-1.5 border border-slate-800 rounded-lg flex items-center gap-1">
                                            <Lock size={12} /> Locked
                                        </span>
                                    )
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
                                        { label: 'Pool Name', value: pool.name, color: 'text-white' },
                                        { label: 'Manager', value: pool.managerName || '—', color: 'text-white' },
                                        { label: 'Contact', value: pool.contactEmail || '—', color: 'text-white' },
                                        { label: 'Public', value: pool.isListedPublic ? 'Yes' : 'No', color: pool.isListedPublic ? 'text-emerald-400' : 'text-slate-500' },
                                        { label: 'Scoring', value: pool.settings.scoringSystem, color: 'text-white' },
                                        { label: 'Entries', value: `${entries.length} / ${pool.settings.maxEntriesTotal === -1 ? '\u221e' : pool.settings.maxEntriesTotal}`, color: 'text-white' },
                                        { label: 'Per User', value: pool.settings.maxEntriesPerUser === -1 ? 'Unlimited' : String(pool.settings.maxEntriesPerUser), color: 'text-white' },
                                        { label: 'Entry Fee', value: pool.settings.entryFee > 0 ? `$${pool.settings.entryFee}` : 'Free', color: 'text-white' },
                                        { label: 'Tiebreaker', value: pool.settings.tieBreakers?.closestUnder ? 'Closest Under' : 'Closest Absolute', color: 'text-white' },
                                        { label: 'Upset Bonus', value: pool.settings.upsetBonus?.enabled ? `${pool.settings.upsetBonus.multiplier}x multiplier` : 'Disabled', color: pool.settings.upsetBonus?.enabled ? 'text-amber-400' : 'text-slate-600' },
                                        { label: 'Lock Date', value: pool.lockAt ? new Date(pool.lockAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not set', color: pool.lockAt ? 'text-white' : 'text-slate-600' },
                                        { label: 'Registration', value: pool.registrationDeadline ? new Date(pool.registrationDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'None set', color: pool.registrationDeadline ? 'text-white' : 'text-slate-600' },
                                        { label: 'Submission', value: pool.submissionDeadline ? new Date(pool.submissionDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'None set', color: pool.submissionDeadline ? 'text-white' : 'text-slate-600' },
                                        { label: 'Tournament', value: pool.tournamentId || 'Not linked', color: 'text-slate-300' },
                                        { label: 'Venmo', value: pool.venmo || '—', color: pool.venmo ? 'text-white' : 'text-slate-600' },
                                        { label: 'Zelle', value: pool.zelle || '—', color: pool.zelle ? 'text-white' : 'text-slate-600' },
                                        { label: 'CashApp', value: pool.cashapp || '—', color: pool.cashapp ? 'text-white' : 'text-slate-600' },
                                        { label: 'PayPal', value: pool.paypal || '—', color: pool.paypal ? 'text-white' : 'text-slate-600' },
                                    ].map(row => (
                                        <div key={row.label} className="flex justify-between items-center p-3 bg-slate-950 rounded border border-slate-800">
                                            <span className="text-slate-400 text-sm">{row.label}</span>
                                            <span className={`font-mono text-sm ${row.color}`}>{row.value}</span>
                                        </div>
                                    ))}
                                    {/* Payouts summary */}
                                    {pool.settings.payouts?.places && pool.settings.payouts.places.length > 0 && (
                                        <div className="p-3 bg-slate-950 rounded border border-slate-800">
                                            <span className="text-slate-400 text-sm block mb-1">Payouts</span>
                                            <div className="flex flex-wrap gap-2">
                                                {pool.settings.payouts.places.map(p => (
                                                    <span key={p.rank} className="text-xs bg-slate-800 text-white px-2 py-1 rounded">
                                                        #{p.rank}: {p.percentage}%
                                                    </span>
                                                ))}
                                                {pool.settings.payouts.bonuses?.map(b => (
                                                    <span key={b.name} className="text-xs bg-emerald-800/50 text-emerald-300 px-2 py-1 rounded">
                                                        {b.name}: {b.percentage}%
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                /* Edit Mode - Collapsible Sections */
                                <div className="space-y-3">
                                    {/* Cancel button */}
                                    <button onClick={() => setEditingSettings(false)} className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 mb-2">
                                        <X size={12} /> Cancel
                                    </button>

                                    {/* Section 1: Pool Details */}
                                    <div className="border border-slate-800 rounded-lg overflow-hidden">
                                        <button onClick={() => toggleSection('details')} className="w-full flex items-center justify-between p-3 bg-slate-850 hover:bg-slate-800 transition-colors">
                                            <span className="flex items-center gap-2 text-sm font-bold text-white"><Globe size={14} className="text-blue-400" /> Pool Details</span>
                                            {openSections.details ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                        </button>
                                        {openSections.details && (
                                            <div className="p-4 bg-slate-950 space-y-3">
                                                <div>
                                                    <label className="text-xs text-slate-500 block mb-1">Pool Name</label>
                                                    <input value={editPoolName} onChange={e => setEditPoolName(e.target.value)}
                                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" />
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="text-xs text-slate-500 block mb-1">Manager Name</label>
                                                        <input value={editManagerName} onChange={e => setEditManagerName(e.target.value)}
                                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-slate-500 block mb-1">Contact Email</label>
                                                        <input type="email" value={editContactEmail} onChange={e => setEditContactEmail(e.target.value)}
                                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" />
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between p-3 bg-slate-900 rounded border border-slate-800">
                                                    <span className="text-sm text-slate-300">Publicly Listed</span>
                                                    <button onClick={() => setEditIsPublic(!editIsPublic)}
                                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editIsPublic ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editIsPublic ? 'translate-x-6' : 'translate-x-1'}`} />
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Section 2: Rules */}
                                    <div className="border border-slate-800 rounded-lg overflow-hidden">
                                        <button onClick={() => toggleSection('rules')} className="w-full flex items-center justify-between p-3 bg-slate-850 hover:bg-slate-800 transition-colors">
                                            <span className="flex items-center gap-2 text-sm font-bold text-white"><Target size={14} className="text-amber-400" /> Rules</span>
                                            {openSections.rules ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                        </button>
                                        {openSections.rules && (
                                            <div className="p-4 bg-slate-950 space-y-3">
                                                {/* Status (read-only) */}
                                                <div className="flex justify-between items-center p-3 bg-slate-900 rounded border border-slate-800">
                                                    <span className="text-slate-400 text-sm">Status</span>
                                                    <span className="font-mono text-sm text-emerald-400">{pool.status}</span>
                                                </div>
                                                {/* Scoring System */}
                                                <div>
                                                    <label className="text-xs text-slate-500 block mb-1">Scoring System</label>
                                                    <select value={editScoring} onChange={e => setEditScoring(e.target.value as 'CLASSIC' | 'ESPN' | 'FIBONACCI' | 'CUSTOM')}
                                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm">
                                                        <option value="CLASSIC">Classic (1-2-4-8-16-32)</option>
                                                        <option value="ESPN">ESPN (10-20-40-80-160-320)</option>
                                                        <option value="FIBONACCI">Fibonacci (1-1-2-3-5-8)</option>
                                                        <option value="CUSTOM">Custom</option>
                                                    </select>
                                                </div>
                                                {/* Custom Scoring Input */}
                                                {editScoring === 'CUSTOM' && (
                                                    <div>
                                                        <label className="text-xs text-slate-500 block mb-1">Custom Points (R64, R32, S16, E8, F4, Champ)</label>
                                                        <div className="grid grid-cols-6 gap-2">
                                                            {['R64', 'R32', 'S16', 'E8', 'F4', 'CH'].map((label, i) => (
                                                                <div key={label} className="text-center">
                                                                    <span className="text-[10px] text-slate-500 block mb-0.5">{label}</span>
                                                                    <input type="number" value={editCustomScoring[i] || 0}
                                                                        onChange={e => { const c = [...editCustomScoring]; c[i] = Number(e.target.value); setEditCustomScoring(c); }}
                                                                        className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white text-sm text-center" min={0} />
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {/* Entry Limits */}
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="text-xs text-slate-500 block mb-1">Max Entries (Total)</label>
                                                        <input type="number" value={editMaxTotal} onChange={e => setEditMaxTotal(Number(e.target.value))}
                                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" min={-1} />
                                                        <p className="text-[10px] text-slate-600 mt-1">-1 = unlimited</p>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-slate-500 block mb-1">Max Per User</label>
                                                        <input type="number" value={editMaxPerUser} onChange={e => setEditMaxPerUser(Number(e.target.value))}
                                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" min={-1} />
                                                        <p className="text-[10px] text-slate-600 mt-1">-1 = unlimited</p>
                                                    </div>
                                                </div>
                                                {/* Entry Fee */}
                                                <div>
                                                    <label className="text-xs text-slate-500 block mb-1">Entry Fee ($)</label>
                                                    <input type="number" value={editEntryFee} onChange={e => setEditEntryFee(Number(e.target.value))}
                                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" min={0} step={5} />
                                                </div>
                                                {/* Tiebreaker */}
                                                <div>
                                                    <label className="text-xs text-slate-500 block mb-1">Tiebreaker Rule</label>
                                                    <select value={editTiebreaker} onChange={e => setEditTiebreaker(e.target.value as 'CLOSEST_ABSOLUTE' | 'CLOSEST_UNDER')}
                                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm">
                                                        <option value="CLOSEST_ABSOLUTE">Closest to Actual (over or under)</option>
                                                        <option value="CLOSEST_UNDER">Closest Without Going Over</option>
                                                    </select>
                                                </div>
                                                {/* Upset Bonus */}
                                                <div className="pt-3 border-t border-slate-800">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-sm text-slate-300">Upset Bonus Scoring</span>
                                                        <button onClick={() => setEditUpsetBonusEnabled(!editUpsetBonusEnabled)}
                                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editUpsetBonusEnabled ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editUpsetBonusEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                                        </button>
                                                    </div>
                                                    {editUpsetBonusEnabled && (
                                                        <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                                                            <label className="text-[10px] text-slate-500 block mb-1">Points per Seed Difference</label>
                                                            <input type="number" value={editUpsetMultiplier} onChange={e => setEditUpsetMultiplier(Number(e.target.value))}
                                                                className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-white text-sm" min={1} />
                                                            <p className="text-[10px] text-slate-500 mt-2">
                                                                If a #10 beats a #2, bonus is (10 - 2) × {editUpsetMultiplier} = <span className="text-amber-400 font-bold">{8 * editUpsetMultiplier} pts</span>
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Section 3: Payouts */}
                                    <div className="border border-slate-800 rounded-lg overflow-hidden">
                                        <button onClick={() => toggleSection('payouts')} className="w-full flex items-center justify-between p-3 bg-slate-850 hover:bg-slate-800 transition-colors">
                                            <span className="flex items-center gap-2 text-sm font-bold text-white"><Trophy size={14} className="text-yellow-400" /> Payouts</span>
                                            {openSections.payouts ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                        </button>
                                        {openSections.payouts && (
                                            <div className="p-4 bg-slate-950 space-y-3">
                                                <p className="text-xs text-slate-500 mb-2">Define how the prize pool is split. Percentages should total 100%.</p>
                                                {/* Place payouts */}
                                                {editPayouts.places.map((p, i) => (
                                                    <div key={i} className="flex items-center gap-2">
                                                        <span className="text-xs text-slate-400 w-16">#{p.rank}</span>
                                                        <input type="number" value={p.percentage}
                                                            onChange={e => {
                                                                const updated = [...editPayouts.places];
                                                                updated[i] = { ...p, percentage: Number(e.target.value) };
                                                                setEditPayouts({ ...editPayouts, places: updated });
                                                            }}
                                                            className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" min={0} max={100} />
                                                        <span className="text-xs text-slate-500">%</span>
                                                        <button onClick={() => {
                                                            const updated = editPayouts.places.filter((_, j) => j !== i);
                                                            setEditPayouts({ ...editPayouts, places: updated });
                                                        }} className="text-red-400 hover:text-red-300"><X size={14} /></button>
                                                    </div>
                                                ))}
                                                <button onClick={() => {
                                                    const nextRank = editPayouts.places.length > 0 ? Math.max(...editPayouts.places.map(p => p.rank)) + 1 : 1;
                                                    setEditPayouts({ ...editPayouts, places: [...editPayouts.places, { rank: nextRank, percentage: 0 }] });
                                                }} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
                                                    <PlusCircle size={12} /> Add place payout
                                                </button>

                                                {/* Bonuses */}
                                                <div className="pt-2 border-t border-slate-800">
                                                    <p className="text-xs text-slate-500 mb-2">Bonus Payouts</p>
                                                    {editPayouts.bonuses.map((b, i) => (
                                                        <div key={i} className="flex items-center gap-2 mb-2">
                                                            <input value={b.name}
                                                                onChange={e => {
                                                                    const updated = [...editPayouts.bonuses];
                                                                    updated[i] = { ...b, name: e.target.value };
                                                                    setEditPayouts({ ...editPayouts, bonuses: updated });
                                                                }}
                                                                className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" placeholder="Bonus name" />
                                                            <input type="number" value={b.percentage}
                                                                onChange={e => {
                                                                    const updated = [...editPayouts.bonuses];
                                                                    updated[i] = { ...b, percentage: Number(e.target.value) };
                                                                    setEditPayouts({ ...editPayouts, bonuses: updated });
                                                                }}
                                                                className="w-20 bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" min={0} max={100} />
                                                            <span className="text-xs text-slate-500">%</span>
                                                            <button onClick={() => {
                                                                const updated = editPayouts.bonuses.filter((_, j) => j !== i);
                                                                setEditPayouts({ ...editPayouts, bonuses: updated });
                                                            }} className="text-red-400 hover:text-red-300"><X size={14} /></button>
                                                        </div>
                                                    ))}
                                                    <button onClick={() => {
                                                        setEditPayouts({ ...editPayouts, bonuses: [...editPayouts.bonuses, { name: '', percentage: 0 }] });
                                                    }} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
                                                        <PlusCircle size={12} /> Add bonus
                                                    </button>
                                                </div>

                                                {/* Total indicator */}
                                                {(() => {
                                                    const totalPct = editPayouts.places.reduce((s, p) => s + p.percentage, 0) + editPayouts.bonuses.reduce((s, b) => s + b.percentage, 0);
                                                    return (
                                                        <div className={`text-xs text-right font-mono ${totalPct === 100 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                            Total: {totalPct}% {totalPct !== 100 && '(should be 100%)'}
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        )}
                                    </div>

                                    {/* Section 4: Payment Info */}
                                    <div className="border border-slate-800 rounded-lg overflow-hidden">
                                        <button onClick={() => toggleSection('payment')} className="w-full flex items-center justify-between p-3 bg-slate-850 hover:bg-slate-800 transition-colors">
                                            <span className="flex items-center gap-2 text-sm font-bold text-white"><CreditCard size={14} className="text-green-400" /> Payment Info</span>
                                            {openSections.payment ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                        </button>
                                        {openSections.payment && (
                                            <div className="p-4 bg-slate-950 space-y-3">
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="text-xs text-slate-500 block mb-1">Venmo</label>
                                                        <input value={editVenmo} onChange={e => setEditVenmo(e.target.value)} placeholder="@username"
                                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-slate-500 block mb-1">Zelle</label>
                                                        <input value={editZelle} onChange={e => setEditZelle(e.target.value)} placeholder="email or phone"
                                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-slate-500 block mb-1">CashApp</label>
                                                        <input value={editCashapp} onChange={e => setEditCashapp(e.target.value)} placeholder="$username"
                                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-slate-500 block mb-1">PayPal</label>
                                                        <input value={editPaypal} onChange={e => setEditPaypal(e.target.value)} placeholder="email"
                                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="text-xs text-slate-500 block mb-1">Payment Instructions</label>
                                                    <textarea value={editPaymentInstructions} onChange={e => setEditPaymentInstructions(e.target.value)}
                                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" rows={3}
                                                        placeholder="How should participants pay? e.g. 'Send $25 to @MyVenmo with Pool Name in the memo'" />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Section 5: Branding */}
                                    <div className="border border-slate-800 rounded-lg overflow-hidden">
                                        <button onClick={() => toggleSection('branding')} className="w-full flex items-center justify-between p-3 bg-slate-850 hover:bg-slate-800 transition-colors">
                                            <span className="flex items-center gap-2 text-sm font-bold text-white"><Palette size={14} className="text-purple-400" /> Branding</span>
                                            {openSections.branding ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                        </button>
                                        {openSections.branding && (
                                            <div className="p-4 bg-slate-950 space-y-3">
                                                <div>
                                                    <label className="text-xs text-slate-500 block mb-1">Logo URL</label>
                                                    <input value={editBranding.logo || ''} onChange={e => setEditBranding({ ...editBranding, logo: e.target.value })}
                                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" placeholder="https://..." />
                                                </div>
                                                <div>
                                                    <label className="text-xs text-slate-500 block mb-1">Background Color</label>
                                                    <div className="flex items-center gap-3">
                                                        <input type="color" value={editBranding.bgColor || '#0f172a'}
                                                            onChange={e => setEditBranding({ ...editBranding, bgColor: e.target.value })}
                                                            className="w-10 h-10 rounded border border-slate-700 cursor-pointer" />
                                                        <input value={editBranding.bgColor || '#0f172a'}
                                                            onChange={e => setEditBranding({ ...editBranding, bgColor: e.target.value })}
                                                            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm font-mono" />
                                                    </div>
                                                </div>
                                                {editBranding.logo && (
                                                    <div className="mt-2">
                                                        <p className="text-xs text-slate-500 mb-1">Preview</p>
                                                        <img src={editBranding.logo} alt="Pool logo" className="h-12 rounded" onError={e => (e.currentTarget.style.display = 'none')} />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Section 6: Reminders */}
                                    <div className="border border-slate-800 rounded-lg overflow-hidden">
                                        <button onClick={() => toggleSection('reminders')} className="w-full flex items-center justify-between p-3 bg-slate-850 hover:bg-slate-800 transition-colors">
                                            <span className="flex items-center gap-2 text-sm font-bold text-white"><Bell size={14} className="text-orange-400" /> Reminders</span>
                                            {openSections.reminders ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                        </button>
                                        {openSections.reminders && (
                                            <div className="p-4 bg-slate-950 space-y-3">
                                                {[
                                                    { key: 'auto24h' as const, label: 'Send reminder 24 hours before lock' },
                                                    { key: 'auto1h' as const, label: 'Send reminder 1 hour before lock' },
                                                    { key: 'autoLock' as const, label: 'Auto-lock at tournament start' },
                                                    { key: 'announceWinner' as const, label: 'Announce winner when tournament ends' },
                                                ].map(item => (
                                                    <div key={item.key} className="flex items-center justify-between p-3 bg-slate-900 rounded border border-slate-800">
                                                        <span className="text-sm text-slate-300">{item.label}</span>
                                                        <button onClick={() => setEditReminders({ ...editReminders, [item.key]: !editReminders[item.key] })}
                                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editReminders[item.key] ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editReminders[item.key] ? 'translate-x-6' : 'translate-x-1'}`} />
                                                        </button>
                                                    </div>
                                                ))}
                                                <div>
                                                    <label className="text-xs text-slate-500 block mb-1">Reminder Recipient Filter</label>
                                                    <select value={editReminders.recipientFilter || 'all'}
                                                        onChange={e => setEditReminders({ ...editReminders, recipientFilter: e.target.value as 'all' | 'unpaid' | 'noentry' })}
                                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm">
                                                        <option value="all">All Participants</option>
                                                        <option value="unpaid">Unpaid Only</option>
                                                        <option value="noentry">No Entry Submitted</option>
                                                    </select>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Section 7: Access Control */}
                                    <div className="border border-slate-800 rounded-lg overflow-hidden">
                                        <button onClick={() => toggleSection('access')} className="w-full flex items-center justify-between p-3 bg-slate-850 hover:bg-slate-800 transition-colors">
                                            <span className="flex items-center gap-2 text-sm font-bold text-white"><Key size={14} className="text-red-400" /> Access Control</span>
                                            {openSections.access ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                        </button>
                                        {openSections.access && (
                                            <div className="p-4 bg-slate-950 space-y-3">
                                                <div>
                                                    <label className="text-xs text-slate-500 block mb-1">Pool Password</label>
                                                    <input value={editPassword} onChange={e => setEditPassword(e.target.value)} placeholder="Leave blank for no password"
                                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" />
                                                    <p className="text-[10px] text-slate-600 mt-1">Participants must enter this to join. Leave empty for open access.</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Section 8: Dates & Deadlines */}
                                    <div className="border border-slate-800 rounded-lg overflow-hidden">
                                        <button onClick={() => toggleSection('dates')} className="w-full flex items-center justify-between p-3 bg-slate-850 hover:bg-slate-800 transition-colors">
                                            <span className="flex items-center gap-2 text-sm font-bold text-white"><Lock size={14} className="text-cyan-400" /> Dates & Deadlines</span>
                                            {openSections.dates ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                        </button>
                                        {openSections.dates && (
                                            <div className="p-4 bg-slate-950 space-y-3">
                                                <DateTimePicker label="Lock Date (auto-lock entries)" value={editLockAt} onChange={ts => setEditLockAt(ts ?? undefined)} />
                                                <DateTimePicker label="Registration Deadline (no new members)" value={editRegDeadline} onChange={ts => setEditRegDeadline(ts ?? undefined)} />
                                                <DateTimePicker label="Submission Deadline (no new/edited brackets)" value={editSubDeadline} onChange={ts => setEditSubDeadline(ts ?? undefined)} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Pool Locking Controls */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                            <h3 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
                                <ShieldCheck size={18} className="text-amber-400" /> Pool Locking
                            </h3>
                            <p className="text-slate-400 text-xs mb-4">
                                Control when the pool locks and brackets become visible to all participants.
                            </p>

                            <div className="space-y-4">
                                {/* Current Status */}
                                <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-xs text-slate-400 uppercase mb-1">Current Status</p>
                                            <p className="text-lg font-bold text-white">{pool.status}</p>
                                        </div>
                                        {pool.status !== 'LOCKED' && pool.status !== 'COMPLETED' && (
                                            <button
                                                onClick={handleLockNow}
                                                disabled={savingSettings}
                                                className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
                                            >
                                                {savingSettings ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                                                Lock Pool Now
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Auto-Lock Time */}
                                <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
                                    <label className="text-xs text-slate-400 uppercase mb-2 block">Auto-Lock Time</label>
                                    <p className="text-xs text-slate-500 mb-3">
                                        Pool will automatically lock at this time (typically tournament start).
                                    </p>
                                    <div className="flex gap-2">
                                        <input
                                            type="datetime-local"
                                            value={editLockAt ? new Date(editLockAt).toISOString().slice(0, 16) : ''}
                                            onChange={(e) => {
                                                const timestamp = e.target.value ? new Date(e.target.value).getTime() : undefined;
                                                setEditLockAt(timestamp);
                                            }}
                                            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm"
                                        />
                                        <button
                                            onClick={handleSaveLockAt}
                                            disabled={savingSettings || !editLockAt}
                                            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
                                        >
                                            {savingSettings ? <Loader2 size={14} className="animate-spin" /> : settingsSaved ? <Check size={14} /> : <Save size={14} />}
                                            {settingsSaved ? 'Saved!' : 'Save'}
                                        </button>
                                    </div>
                                </div>
                            </div>
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

                        {/* Entry Status Card */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                                <ClipboardList size={18} className="text-blue-400" /> Entry Status
                            </h3>
                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <div className="bg-slate-950 rounded-lg p-3 border border-slate-800 text-center">
                                    <p className="text-2xl font-bold text-emerald-400">{entries.filter(e => e.status === 'SUBMITTED').length}</p>
                                    <p className="text-[10px] text-slate-500 uppercase">Completed</p>
                                </div>
                                <div className="bg-slate-950 rounded-lg p-3 border border-slate-800 text-center">
                                    <p className="text-2xl font-bold text-amber-400">{entries.filter(e => e.status === 'DRAFT').length + ((pool.participantIds?.length || 0) - new Set(entries.map(e => e.ownerUid)).size)}</p>
                                    <p className="text-[10px] text-slate-500 uppercase">Incomplete</p>
                                </div>
                            </div>
                            <button
                                onClick={handleEmailIncomplete}
                                disabled={sendingEmail}
                                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-2 rounded-lg flex items-center justify-center gap-2 transition-colors text-sm"
                            >
                                {sendingEmail ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                                Email Incomplete Entries
                            </button>
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
                            <div className="grid grid-cols-4 gap-3 mb-4">
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
                                    <p className="text-[10px] text-slate-500 uppercase">Gross Pot</p>
                                </div>
                                <div className="bg-slate-950 rounded-lg p-3 border border-slate-800 text-center">
                                    <p className="text-2xl font-bold text-indigo-400">
                                        ${pool.settings.charity?.enabled
                                            ? Math.floor((entries.length * pool.settings.entryFee) * (pool.settings.charity.percentage / 100))
                                            : 0}
                                    </p>
                                    <p className="text-[10px] text-slate-500 uppercase">Charity</p>
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
                            {shouldShowBrackets || isManager ? (
                                isConference ? (
                                    <ConferenceBracketBuilder
                                        tournament={tournament}
                                        picks={viewingEntry.picks}
                                        onPick={() => { }}
                                        readOnly={true}
                                    />
                                ) : (
                                    <BracketBuilder
                                        tournament={tournament}
                                        picks={viewingEntry.picks}
                                        onPick={() => { }}
                                        readOnly={true}
                                    />
                                )
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-center p-8">
                                    <ShieldCheck className="w-16 h-16 text-slate-600 mb-4" />
                                    <h3 className="text-xl font-bold text-white mb-2">Brackets Not Yet Visible</h3>
                                    <p className="text-slate-400 max-w-md">
                                        All brackets will be visible once the pool is locked and the tournament has started.
                                        This ensures a fair playing field for all participants.
                                    </p>
                                    <div className="mt-4 text-sm text-slate-500">
                                        Pool Status: <span className="text-amber-400 font-mono">{pool.status}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Payment Ledger Tab */}
            {!loading && activeTab === 'ledger' && isManager && (
                <div className="animate-in fade-in slide-in-from-bottom-4">
                    <PaymentLedger pool={pool} entries={entries} />
                </div>
            )}

            {/* Printable Bracket View - Hidden on screen, visible when printing */}
            {viewingEntry && tournament && (shouldShowBrackets || isManager) && createPortal(
                <div
                    id="bracket-print-view"
                    style={{ position: 'absolute', left: '-9999px', top: 0 }}
                >
                    <div className="print-header" style={{ display: 'none' }}>
                        <div>
                            <strong style={{ fontSize: '18px' }}>{viewingEntry.name}</strong>
                            <span style={{ marginLeft: '12px', fontSize: '14px', color: '#64748b' }}>
                                {pool.name}
                            </span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                            Score: {viewingEntry.score || 0} • {new Date().toLocaleDateString()}
                        </div>
                    </div>
                    {isConference ? (
                        <ConferenceBracketBuilder
                            tournament={tournament}
                            picks={viewingEntry.picks}
                            onPick={() => { }}
                            readOnly={true}
                        />
                    ) : (
                        <BracketBuilder
                            tournament={tournament}
                            picks={viewingEntry.picks}
                            onPick={() => { }}
                            readOnly={true}
                        />
                    )}
                </div>,
                document.body
            )}

            {/* BracketShareModal temporarily hidden - image generation failing */}

            {/* Create Bracket Name Modal */}
            {showNameModal && (() => {
                const normalizedInput = newNameInput.trim().toLowerCase();
                const isNameTaken = entries.some(e => e.name.toLowerCase() === normalizedInput);
                const suggestedName = isNameTaken ? (function () {
                    let suffix = 2;
                    let suggestion = `${newNameInput.trim()} ${suffix}`;
                    while (entries.some(e => e.name.toLowerCase() === suggestion.toLowerCase())) {
                        suffix++;
                        suggestion = `${newNameInput.trim()} ${suffix}`;
                    }
                    return suggestion;
                })() : '';

                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
                        <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl relative">
                            <button
                                onClick={() => setShowNameModal(false)}
                                className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
                            >
                                <X size={20} />
                            </button>

                            <h3 className="text-xl font-bold text-white mb-2">Name Your Bracket</h3>
                            <p className="text-slate-400 text-sm mb-6">
                                Give your bracket a unique name to easily identify it in the standings.
                            </p>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1">
                                        Bracket Name
                                    </label>
                                    <input
                                        type="text"
                                        value={newNameInput}
                                        onChange={(e) => setNewNameInput(e.target.value)}
                                        placeholder="Enter a bracket name..."
                                        className={`w-full bg-slate-950 border ${isNameTaken && newNameInput.trim() !== '' ? 'border-red-500/50 focus:ring-red-500' : 'border-slate-800 focus:ring-amber-500'} rounded-lg px-4 py-3 text-white focus:ring-2 focus:border-transparent outline-none transition-all placeholder:text-slate-600`}
                                        autoFocus
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && newNameInput.trim() && !isNameTaken) {
                                                setShowNameModal(false);
                                                handleCreateEntry(newNameInput.trim());
                                            }
                                        }}
                                    />
                                    {isNameTaken && newNameInput.trim() !== '' && (
                                        <p className="mt-2 text-sm text-red-400 flex items-center gap-1">
                                            This name is taken. How about <button
                                                onClick={() => setNewNameInput(suggestedName)}
                                                className="underline font-bold hover:text-red-300"
                                            >"{suggestedName}"</button>?
                                        </p>
                                    )}
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <button
                                        onClick={() => setShowNameModal(false)}
                                        className="flex-1 px-4 py-2 border border-slate-700 text-slate-300 rounded-lg hover:bg-slate-800 transition-colors font-medium"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (newNameInput.trim() && !isNameTaken) {
                                                setShowNameModal(false);
                                                handleCreateEntry(newNameInput.trim());
                                            }
                                        }}
                                        disabled={!newNameInput.trim() || isNameTaken || submitting}
                                        className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 px-4 py-2 rounded-lg transition-colors font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                                        Continue
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};
