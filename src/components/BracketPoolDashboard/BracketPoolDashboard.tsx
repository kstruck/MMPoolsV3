import { OverlayRoot } from '../ui/OverlayRoot';
import { logger } from '../../utils/logger';
import { BillingGate } from '../billing';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { HelpRoutePublisher } from '../../help/publish';
// PLAN-HELP-SYSTEM T6. Direct, not through the `ui` barrel — the barrel does
// not export it (see `ui/Field.tsx`, which imports it the same way).
import { HelpTip } from '../ui/HelpTip';
import { createPortal } from 'react-dom';
import type { BracketPool, BracketEntry, Tournament, User } from '../../types';
import { LayoutDashboard, Users, Trophy, Share2, PlusCircle, ArrowLeft, Loader2, Send, Save, BarChart3, FileText, GitBranch, ShieldCheck, Target, Check, Copy, Download, MessageSquare, Edit3, X, Coins, Printer, Lock, ChevronDown, ChevronUp, Palette, Bell, CreditCard, Key, Globe, Trash2, ClipboardList, Mail, AlertTriangle } from 'lucide-react';
import { BracketBuilder } from '../BracketBuilder/BracketBuilder';
import { ConferenceBracketBuilder } from '../BracketBuilder/ConferenceBracketBuilder';
import { StandingsTable } from './StandingsTable';
import { resolveOwnerNames } from './ownerNames';
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
import { PoolShareModal } from './PoolShareModal';
import { PoolAnalytics } from './PoolAnalytics';
import { BracketAwards } from './BracketAwards';
import { ChampionBanner } from './ChampionBanner';
import { ChalkComparison } from './ChalkComparison';
import { ReportsTab } from './ReportsTab';
import { BracketRulesPanel } from './BracketRulesPanel';
import { LiveScoreTicker } from './LiveScoreTicker';
import { EliminationTracker } from './EliminationTracker';
import { BracketCountdown } from './BracketCountdown';
import { AICommissioner } from '../AICommissioner';
import { AddonUpgradeButton } from '../billing/AddonUpgradeButton';
import { BanterBoard } from './BanterBoard';
import { PaymentLedger } from './PaymentLedger';
import { ExportControls } from './ExportControls';
import { useToast } from '../ui/Toast';
import { YouPill } from '../ui';

type DashboardTab = 'dashboard' | 'standings' | 'entries' | 'brackets' | 'reports' | 'rules' | 'manager' | 'ledger';
type BracketSubTab = 'poolwide' | 'history' | 'rootfor' | 'whatif' | 'compare' | 'chalk' | 'analytics' | 'insights';

interface BracketPoolDashboardProps {
    pool: BracketPool;
    user: User | null;
    onBack: () => void;
    onShare?: () => void; // temporarily unused - share feature disabled
}

export const BracketPoolDashboard: React.FC<BracketPoolDashboardProps> = ({ pool, user, onBack }) => {
    const [searchParams, setSearchParams] = useSearchParams();
    const toast = useToast();

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
    const [userNames, setUserNames] = useState<Record<string, string>>({});
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
    // Pool Share Modal
    const [showShareModal, setShowShareModal] = useState(false);

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

    // Access Control (PLAN-AUDIT-AUTH-HARDENING Phase B, audit item 13a).
    //
    // This used to seed itself from `pool.accessControl?.password` and save the
    // value back with a direct client `updateDoc` — plaintext, onto a document
    // that is `allow get: if true`, and `joinBracketPool` never even read that
    // field. It is now write-only: the stored value is a PBKDF2 record in
    // `pools/{id}/private/access` that no client can read, so the box starts
    // EMPTY and an empty box means "leave the password as it is". Removing one
    // is an explicit action (`clearPassword`), never an empty save.
    const [editPassword, setEditPassword] = useState('');
    const [clearPassword, setClearPassword] = useState(false);
    const poolHasPassword = Boolean(
        (pool as unknown as { hasPoolPassword?: boolean }).hasPoolPassword
        || pool.accessControl?.password,
    );

    // Collapsible section toggles
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({ details: true, rules: true });
    const [sendingEmail, setSendingEmail] = useState(false);
    const toggleSection = (key: string) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

    const isManager = isPoolManager(user, pool);
    /**
     * The pool's billing, read ONCE and typed — the AI Commissioner gate and the
     * mid-season add-on offer both need it, and `(pool as any)` would be two new
     * lint warnings for a shape this file can name.
     */
    const aiPoolBilling = (pool as unknown as {
        billing?: { status?: string; featuresUnlocked?: Record<string, boolean> };
    }).billing;
    const userEntries = entries.filter(e => e.ownerUid === user?.id);
    const maxEntriesPerUser = pool.settings?.maxEntriesPerUser || 1;
    const canCreateMore = userEntries.length < maxEntriesPerUser && (pool.status === 'OPEN' || pool.status === 'DRAFT');

    // Bracket Visibility Rules: Show brackets to all once pool is locked
    const shouldShowBrackets = useMemo(() => {
        if (isManager) return true;
        // Once locked, live, or completed — entries are visible to everyone
        return pool.status === 'LOCKED' || pool.status === 'LIVE' || pool.status === 'COMPLETED';
    }, [pool.status, isManager]);

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
            toast.info("This bracket is hidden until the pool is locked.");
            return;
        }
        setViewingEntry(entry);
    }, [user?.id, isManager, shouldShowBrackets, toast]);

    // Subscribe to bracket entries
    useEffect(() => {
        const unsub = dbService.subscribeToBracketEntries(pool.id, (data) => {
            setEntries(data);
            setLoading(false);
        });
        return () => unsub();
    }, [pool.id]);

    // Build uid -> display name map whenever entries change.
    //
    // Reads `publicProfiles/{uid}` (world-readable), NOT `users/{uid}` — an
    // ordinary member may only read their OWN user doc, so the old code hit
    // permission-denied once per other member and reported every one of them to
    // Sentry + logClientError. See ownerNames.ts for the full note.
    useEffect(() => {
        if (entries.length === 0) return;
        let cancelled = false;
        resolveOwnerNames(entries, (uid) => dbService.getPublicProfile(uid))
            .then(map => { if (!cancelled) setUserNames(map); })
            // resolveOwnerNames swallows per-uid failures by contract, so this
            // only fires on a real bug. Log it rather than dropping it silently;
            // StandingsTable already renders 'Unknown' for a missing name.
            .catch(err => logger.error('[BracketPoolDashboard] Failed to resolve owner names:', err));
        return () => { cancelled = true; };
    }, [entries]);

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

    // Auto-default editLockAt from tournament when pool has no override
    useEffect(() => {
        if (!pool.lockAt && tournament?.lockAt && !editLockAt) {
            setEditLockAt(tournament.lockAt);
        }
    }, [tournament?.lockAt, pool.lockAt, editLockAt]);

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
        const ok = await toast.confirm({
            title: 'Lock pool now?',
            message: 'No more brackets can be submitted after locking.',
            confirmLabel: 'Lock pool',
            danger: true
        });
        if (!ok) return;
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
    }, [pool.id, toast]);

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
                // Access Control: NOT written here any more. The password goes
                // through the setPoolPassword callable below — see the state
                // declaration for why a direct write was both a leak and a no-op.
                // Dates
                registrationDeadline: editRegDeadline || null,
                submissionDeadline: editSubDeadline || null,
                lockAt: editLockAt || pool.lockAt,
            };
            await dbService.updateBracketPool(pool.id, updates);
            // Password last, and only when the commissioner actually asked for a
            // change: a set (non-empty box) or an explicit removal. An untouched
            // box leaves the stored value alone — the field cannot be read back,
            // so "empty" carries no information about what is stored.
            if (clearPassword) {
                await dbService.setPoolPassword(pool.id, null);
            } else if (editPassword) {
                await dbService.setPoolPassword(pool.id, editPassword);
            }
            setEditPassword('');
            setClearPassword(false);
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
        editPayouts, editBranding, editReminders, editPassword, clearPassword,
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
                toast.info("No users found with incomplete entries.");
            }
        } catch (e) {
            console.error("Failed to fetch users", e);
            toast.error("Failed to fetch user emails.");
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
        const ok = await toast.confirm({
            title: 'Delete entry?',
            message: `Are you sure you want to delete "${entry.name}"? This action cannot be undone.`,
            confirmLabel: 'Delete',
            danger: true
        });
        if (!ok) return;

        setError(null);
        try {
            const result = await dbService.deleteBracketEntry(pool.id, entry.id);
            if (!result.success) {
                setError(result.message || 'Failed to delete entry');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'An error occurred while deleting');
        }
    }, [pool.id, toast]);

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
        if (!activeEntryId) {
            setError('Could not find your bracket entry. Please close and re-open the bracket editor.');
            return;
        }

        const activeEntry = entries.find(e => e.id === activeEntryId);
        if (pool.settings?.lockUnpaid && activeEntry?.paidStatus !== 'PAID') {
            setError('Your entry is unpaid. Please complete payment to submit your picks.');
            return;
        }

        if (entries.some(e => e.name.toLowerCase() === entryName.trim().toLowerCase() && e.id !== activeEntryId)) {
            setError('That bracket name is already taken. Please choose another.');
            return;
        }

        // Exclude First Four games (round 0) — they are not shown in the bracket UI pick slots
        const reqPicks = tournament
            ? Object.values(tournament.games).filter(g => g.round >= 1).length
            : (pool.tournamentType === 'conference' ? 10 : 63);
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
    }, [pool, tournament, activeEntryId, picks, tieBreakerPrediction, entryName, setIsCreating, entries]);

    const pickCount = Object.keys(picks).length;
    // Exclude First Four games (round 0) — they are not shown in the bracket UI pick slots
    const requiredPicks = tournament
        ? Object.values(tournament.games).filter(g => g.round >= 1).length
        : (pool.tournamentType === 'conference' ? 10 : 63);
    const activeEntry = entries.find(e => e.id === activeEntryId);
    const isUnpaidLocked = pool.settings?.lockUnpaid && activeEntry?.paidStatus !== 'PAID';
    // NCAA tournaments (men's/women's) should NEVER use the conference bracket builder,
    // even if tournamentType was accidentally set to 'conference' on the pool.
    const isNcaaTournament = pool.tournamentId?.startsWith('mens-') || pool.tournamentId?.startsWith('womens-');
    const isConference = pool.tournamentType === 'conference' && !isNcaaTournament;

    return (
        <BillingGate pool={pool as any} isCommissioner={isManager}>
        {/* T2: `tab` already rides in `?tab=`; the reports sub-tab does not, so
            it is published. Only meaningful on the reports tab. */}
        <HelpRoutePublisher
            tab={activeTab}
            subTab={activeTab === 'reports' ? bracketSubTab : undefined}
            isManager={isManager}
        />
        <div className="min-h-screen bg-page pb-20">
            {/* Header */}
            <div className="bg-surface border-b border-line p-4 relative">
                <div className="max-w-6xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button onClick={onBack} className="p-2 hover:bg-card rounded-full text-muted hover:text-[color:var(--text)] transition-colors">
                            <ArrowLeft size={20} />
                        </button>
                        <div>
                            <h1 className="text-xl font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-2">
                                <Trophy className="text-gold-500" size={24} />
                                {pool.name}
                            </h1>
                            <p className="text-xs text-muted font-mono hidden md:block">/{pool.slug}</p>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <ExportControls pool={pool} entries={entries} tournament={tournament} />
                        <button onClick={() => setShowShareModal(true)} className="bg-brandred-600 hover:bg-brandred-500 text-white px-4 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2 text-sm transition-all duration-150 hover:-translate-y-px shadow-red-cta">
                            <Share2 size={16} /> Share
                        </button>
                    </div>
                </div>
            </div>

            {/* Live Score Ticker */}
            <LiveScoreTicker tournament={tournament} />

            {/* Main Content */}
            <div className="max-w-6xl mx-auto p-4">

                {/* Champion Banner — the payoff moment. Renders only when the
                    season is decided; visible on every tab. */}
                {!loading && (
                    <ChampionBanner
                        pool={pool}
                        entries={entries}
                        tournament={tournament}
                        currentUserId={user?.id}
                    />
                )}

                {/* Commissioner Message Banner */}
                {pool.commissionerMessage && (
                    <div className="bg-gold-500/10 border border-gold-500/30 rounded-xl p-4 mb-6 flex items-start gap-3 animate-in fade-in">
                        <ShieldCheck className="text-gold-600 shrink-0 mt-0.5" size={18} />
                        <div className="flex-1">
                            <p className="text-xs font-display font-bold text-gold-700 uppercase tracking-[0.08em] mb-1">Commissioner Message</p>
                            <p className="text-[color:var(--text)] font-body text-sm">{pool.commissionerMessage}</p>
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
                        { id: 'rules' as DashboardTab, label: 'Rules', icon: ClipboardList },
                        { id: 'ledger' as DashboardTab, label: 'Payment Ledger', icon: CreditCard, hidden: !isManager },
                        { id: 'manager' as DashboardTab, label: 'Settings', icon: ShieldCheck, hidden: !isManager },
                    ].map(tab => !tab.hidden && (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-full font-display font-bold uppercase tracking-[0.05em] transition-all duration-150 whitespace-nowrap text-sm ${activeTab === tab.id
                                ? (tab.id === 'manager' ? 'bg-gold-foil text-navy-900 shadow-lg shadow-gold-700/30' : 'bg-navy-800 text-white')
                                : (tab.id === 'manager' ? 'bg-card border border-gold-500/40 text-gold-600 hover:bg-surface' : 'bg-card text-muted hover:bg-surface')
                                }`}
                        >
                            <tab.icon size={14} />
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Error Banner */}
                {error && (
                    <div className="bg-brandred-600/10 border border-brandred-600/30 text-brandred-600 px-4 py-3 rounded-xl mb-6 text-sm">
                        {error}
                        <button onClick={() => setError(null)} className="ml-2 underline hover:text-brandred-500">Dismiss</button>
                    </div>
                )}

                {/* Success Banner */}
                {showSuccess && (
                    <div className="bg-[#E4F5EC] border border-[#BEE7D0] text-[#0F7B4A] px-4 py-3 rounded-xl mb-6 text-sm flex items-center gap-2 animate-in fade-in">
                        <Check size={16} />
                        Bracket submitted successfully!
                    </div>
                )}

                {/* Loading State */}
                {loading && (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="animate-spin text-gold-500" size={32} />
                        <span className="ml-3 text-muted">Loading bracket pool...</span>
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
                                            className="bg-gold-foil hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed text-navy-900 font-display font-bold uppercase tracking-[0.05em] px-4 py-2 rounded-lg flex items-center gap-2 transition-all duration-150 hover:-translate-y-px"
                                        >
                                            {submitting ? <Loader2 size={18} className="animate-spin" /> : <PlusCircle size={18} />}
                                            {userEntries.length === 0 ? 'Create Your Bracket' : 'Add Another Entry'}
                                        </button>
                                    </div>
                                )}

                                {/* Pool Overview Stats Cards */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {/* Pot & Payouts */}
                                    <div className="bg-card border border-line rounded-xl p-4 relative overflow-hidden shadow-card">
                                        <div className="absolute top-0 right-0 p-3 opacity-10">
                                            <Coins size={48} className="text-gold-500" />
                                        </div>
                                        <h3 className="text-muted text-[12px] font-display font-bold uppercase tracking-[0.08em] mb-1">Total Pot</h3>
                                        <div className="text-2xl font-display font-bold num text-[color:var(--text)] mb-2">
                                            ${entries.length * pool.settings.entryFee}
                                        </div>
                                        <div className="text-xs text-faint num">
                                            {entries.length} entries × ${pool.settings.entryFee}
                                        </div>
                                        {/* Payout Structure Hint */}
                                        <div className="mt-3 pt-3 border-t border-line">
                                            <p className="text-[10px] font-display text-muted font-bold uppercase tracking-[0.08em] mb-1">Payouts</p>
                                            <div className="space-y-1">
                                                {pool.settings.payouts?.places.map((p, i) => (
                                                    <div key={i} className="flex justify-between text-xs">
                                                        <span className="text-muted">{p.rank === 1 ? '1st' : p.rank === 2 ? '2nd' : p.rank === 3 ? '3rd' : `${p.rank}th`}</span>
                                                        <span className="text-[#0F7B4A] num">
                                                            ${Math.floor((entries.length * pool.settings.entryFee) * (p.percentage / 100))}
                                                        </span>
                                                    </div>
                                                ))}
                                                {pool.settings.charity?.enabled && (
                                                    <div className="flex justify-between text-xs border-t border-line pt-1 mt-1">
                                                        <span className="text-gold-600">Charity ({pool.settings.charity.percentage}%)</span>
                                                        <span className="text-gold-600 num">
                                                            ${Math.floor((entries.length * pool.settings.entryFee) * (pool.settings.charity.percentage / 100))}
                                                        </span>
                                                    </div>
                                                )}
                                                {(!pool.settings.payouts?.places || pool.settings.payouts.places.length === 0) && !pool.settings.charity?.enabled && (
                                                    <div className="text-xs text-faint italic">No payouts configured</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* User Stats */}
                                    <div className="bg-card border border-line rounded-xl p-4 relative overflow-hidden shadow-card">
                                        <div className="absolute top-0 right-0 p-3 opacity-10">
                                            <BarChart3 size={48} className="text-gold-500" />
                                        </div>
                                        <h3 className="text-muted text-[12px] font-display font-bold uppercase tracking-[0.08em] mb-1">Your Stats</h3>
                                        <div className="grid grid-cols-2 gap-4 mt-2">
                                            <div>
                                                <div className="text-xl font-display font-bold num text-[color:var(--text)]">{userEntries.length}</div>
                                                <div className="text-[10px] font-display text-faint uppercase tracking-[0.08em]">Entries</div>
                                            </div>
                                            <div>
                                                <div className="text-xl font-display font-bold num text-gold-600">
                                                    {/* Calculate best rank or score */}
                                                    {userEntries.length > 0
                                                        ? Math.max(...userEntries.map(e => e.score || 0))
                                                        : '-'
                                                    }
                                                </div>
                                                <div className="text-[10px] font-display text-faint uppercase tracking-[0.08em]">Best Score</div>
                                            </div>
                                            {tournament && (
                                                <div className="col-span-2 mt-2 pt-2 border-t border-line flex justify-between items-center">
                                                    <span className="text-[10px] font-display text-faint uppercase tracking-[0.08em]">Max Correct Picks</span>
                                                    <span className="text-sm font-bold num text-[#0F7B4A]">
                                                        {userEntries.length > 0
                                                            ? Math.max(...userEntries.map(e => calculateCorrectPicks(e, tournament)))
                                                            : '-'}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Tournament Status */}
                                    <div className="bg-card border border-line rounded-xl p-4 relative overflow-hidden shadow-card">
                                        <div className="absolute top-0 right-0 p-3 opacity-10">
                                            <Trophy size={48} className="text-gold-500" />
                                        </div>
                                        <h3 className="text-muted text-[12px] font-display font-bold uppercase tracking-[0.08em] mb-1">Tournament</h3>
                                        <div className="text-sm font-display font-bold uppercase text-[color:var(--text)] mt-1">
                                            {tournament?.isFinalized ? 'Finalized' : 'In Progress'}
                                        </div>
                                        <div className="text-xs text-faint mt-1">
                                            Click on "Standings" to see live leaderboards.
                                        </div>
                                    </div>
                                </div>

                                {aiPoolBilling?.featuresUnlocked?.aiCommissioner ? (
                                    <div className="mt-8 pt-8 border-t border-line">
                                        <AICommissioner poolId={pool.id} userId={user?.id} userName={user?.name} poolType="BRACKET" />
                                    </div>
                                ) : (
                                    /* C2 / codex r1 [P1]: the add-on checkout is pool-type
                                       agnostic on the server, so a Bracket commissioner gets
                                       the same mid-season path the NFL one does. Commissioner
                                       only, and only on an ACTIVE pool — the server refuses an
                                       add-on checkout for a pool with no hosting purchase. */
                                    isManager && aiPoolBilling?.status === 'active' && (
                                        <div className="mt-8 pt-8 border-t border-line">
                                            <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">AI Commissioner</h3>
                                            <p className="mt-1 font-body text-[13px] text-muted">
                                                Written recaps and banter for this pool, generated from its own results. Not switched on yet.
                                            </p>
                                            <AddonUpgradeButton pool={pool} addon="aiCommissioner" label="AI Commissioner" />
                                        </div>
                                    )
                                )}

                                {/* User's existing entries */}
                                {userEntries.length > 0 && (
                                    <div className="space-y-3">
                                        <h2 className="text-lg font-display font-bold uppercase text-[color:var(--text)]">My Brackets</h2>
                                        {userEntries.map(entry => (
                                            <div key={entry.id} className="bg-card border border-line rounded-xl p-4 flex items-center justify-between shadow-card">
                                                <div>
                                                    <div className="font-bold text-[color:var(--text)]">{entry.name}</div>
                                                    <div className="text-xs text-faint mt-1 flex items-center gap-2">
                                                        {entry.status === 'SUBMITTED' ? (
                                                            <>
                                                                <span className="text-[#0F7B4A] num flex items-center gap-1"><Check size={12} /> Submitted — Score: {entry.score || 0}</span>
                                                                <span className={`px-2 py-0.5 rounded text-[10px] font-display font-bold uppercase tracking-[0.05em] ${entry.paidStatus === 'PAID' ? 'bg-[#E4F5EC] text-[#0F7B4A] border border-[#BEE7D0]' : 'bg-[#FBEEDD] text-[#B4530A] border border-[#F2D6B0]'}`}>
                                                                    {entry.paidStatus === 'PAID' ? 'PAID' : 'PENDING'}
                                                                </span>
                                                            </>
                                                        ) : (
                                                            <span className="text-gold-600 num">Draft — {Object.keys(entry.picks || {}).length}/{requiredPicks} picks</span>
                                                        )}
                                                        {championshipGameId && entry.picks && entry.picks[championshipGameId] && entry.picks[championshipGameId] !== 'TBD' && (
                                                            <span className="text-muted border-l border-line pl-2">
                                                                Champ: <span className="text-[color:var(--text)] font-bold">{entry.picks[championshipGameId]}</span>
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleViewEntry(entry); }}
                                                        className="bg-navy-800 hover:bg-navy-700 text-white px-3 py-2 rounded-lg text-sm font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2 transition-all duration-150 hover:-translate-y-px"
                                                        title="View & Print"
                                                    >
                                                        <Printer size={16} />
                                                        <span className="hidden sm:inline">View</span>
                                                    </button>
                                                    {/* Share button temporarily hidden - image generation failing */}
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleEditEntry(entry); }}
                                                        className="bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-display font-bold uppercase tracking-[0.05em] transition-all duration-150 hover:-translate-y-px"
                                                        disabled={(entry.status === 'SUBMITTED' && pool.status !== 'OPEN') || pool.status === 'LOCKED' || pool.status === 'LIVE' || pool.status === 'COMPLETED'}
                                                    >
                                                        {entry.status === 'SUBMITTED' ? 'Edit' : 'Enter Picks/Edit Picks'}
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteEntry(entry); }}
                                                        className="bg-brandred-600/10 hover:bg-brandred-600/20 text-brandred-600 px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:text-brandred-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                                        title="Delete Entry"
                                                        disabled={pool.status === 'LOCKED' || pool.status === 'LIVE' || pool.status === 'COMPLETED'}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}


                            </div>
                        ) : null}
                    </div>
                )}

                {/* ── Full-Screen Bracket Editor Portal ─────────────────────────────── */}
                {isCreating && createPortal(
                    <OverlayRoot id="bracket-entry-editor" dialog={false} className="fixed inset-0 z-[60] flex flex-col bg-page animate-in fade-in duration-150">
                        {/* ── Top bar ─────────────────────────────────────────────────── */}
                        <div className="flex-shrink-0 flex flex-wrap justify-between items-center gap-3 px-4 py-3 border-b border-line bg-card/95 backdrop-blur">
                            <div>
                                <input
                                    type="text"
                                    value={entryName}
                                    onChange={(e) => setEntryName(e.target.value)}
                                    className="font-bold text-[color:var(--text)] bg-transparent border-b border-transparent hover:border-line focus:border-gold-500 focus:outline-none px-1 py-0.5 transition-colors w-52 sm:w-72"
                                    placeholder="Bracket Name"
                                />
                                <div className="text-xs text-faint num px-1 mt-0.5">{pickCount}/{requiredPicks} picks</div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => { setIsCreating(false); setActiveEntryId(null); setPicks({}); setTieBreakerPrediction(undefined); setError(null); }}
                                    className="text-muted hover:text-[color:var(--text)] px-3 py-2 rounded text-sm font-medium flex items-center gap-1.5"
                                >
                                    <X size={14} /> Cancel
                                </button>
                                <button
                                    onClick={handleSaveDraft}
                                    disabled={submitting}
                                    className="bg-navy-800 hover:bg-navy-700 text-white px-4 py-2 rounded font-display font-bold uppercase tracking-[0.05em] flex items-center gap-1.5 text-sm transition-all duration-150 hover:-translate-y-px"
                                >
                                    <Save size={14} /> Save Draft
                                </button>
                                <button
                                    onClick={handleSubmitBracket}
                                    disabled={submitting}
                                    className="bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded font-display font-bold uppercase tracking-[0.05em] flex items-center gap-1.5 text-sm shadow-red-cta transition-all duration-150 hover:-translate-y-px"
                                >
                                    {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                    Submit Bracket
                                </button>
                            </div>
                        </div>

                        {/* ── Error / Success strip inside portal ───────────────────────── */}
                        {isUnpaidLocked && (
                            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-gold-500/10 border-b border-gold-500/20 text-gold-700 text-xs font-semibold animate-in slide-in-from-top duration-350">
                                <AlertTriangle size={14} className="animate-pulse animate-duration-1000 shrink-0" />
                                <span>Your entry is unpaid. Please make a payment to the pool manager to enable final submission.</span>
                            </div>
                        )}
                        {error && (
                            <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 bg-brandred-600/10 border-b border-brandred-600/30 text-brandred-600 text-sm animate-in fade-in">
                                <span className="flex items-center gap-2"><AlertTriangle size={14} className="shrink-0" /> {error}</span>
                                <button onClick={() => setError(null)} className="text-brandred-600 hover:text-brandred-500 font-bold ml-4 flex-shrink-0"><X size={14} /></button>
                            </div>
                        )}
                        {showSuccess && (
                            <div className="flex-shrink-0 px-4 py-2.5 bg-[#E4F5EC] border-b border-[#BEE7D0] text-[#0F7B4A] text-sm animate-in fade-in flex items-center gap-2">
                                <Check size={14} /> Bracket submitted successfully!
                            </div>
                        )}

                        {/* ── Bracket canvas — fills remaining height, vertical scroll only ─ */}
                        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
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
                                <div className="text-center py-16 text-faint">
                                    Tournament data not yet available.
                                </div>
                            )}
                        </div>

                        {/* ── Bottom bar: tiebreaker + actions ──────────────────────────── */}
                        <div className="flex-shrink-0 px-4 py-3 border-t border-line bg-card/95 backdrop-blur flex flex-col sm:flex-row items-center justify-between gap-3">
                            <div className="bg-surface border border-line rounded-lg px-4 py-2.5 flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
                                <div>
                                    <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-gold-600 leading-none mb-0.5 flex items-center gap-1"><Trophy size={12} /> Tiebreaker</label>
                                    <p className="text-[11px] text-muted">Combined score of the championship game.</p>
                                </div>
                                <input
                                    type="number"
                                    min={0}
                                    max={500}
                                    value={tieBreakerPrediction ?? ''}
                                    onChange={(e) => setTieBreakerPrediction(e.target.value ? parseInt(e.target.value) : undefined)}
                                    placeholder="e.g. 145"
                                    className={`bg-card border ${error?.includes('tie-breaker') ? 'border-brandred-500 shadow-[0_0_10px_rgba(196,52,46,0.5)]' : 'border-line'} rounded-lg px-4 py-2 text-[color:var(--text)] w-28 text-center num text-lg focus:outline-none focus:border-gold-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                                />
                            </div>
                            <div className="flex gap-2 ml-auto">
                                <button
                                    onClick={handleSaveDraft}
                                    disabled={submitting}
                                    className="bg-navy-800 hover:bg-navy-700 text-white px-4 py-2 rounded font-display font-bold uppercase tracking-[0.05em] flex items-center gap-1.5 text-sm transition-all duration-150 hover:-translate-y-px"
                                >
                                    <Save size={14} /> Save Draft
                                </button>
                                <button
                                    onClick={handleSubmitBracket}
                                    disabled={submitting}
                                    className="bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2 rounded font-display font-bold uppercase tracking-[0.05em] flex items-center gap-1.5 text-sm shadow-red-cta transition-all duration-150 hover:-translate-y-px"
                                >
                                    {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                    Submit Bracket
                                </button>
                            </div>
                        </div>
                    </OverlayRoot>,
                    document.body
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
                                        userNames={userNames}
                                        onEntryClick={handleViewEntry}
                                    />
                                </div>
                                <div className="lg:col-span-1 h-[600px] flex flex-col">
                                    <BanterBoard poolId={pool.id} user={user} />
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-12 text-faint">
                                <Trophy size={48} className="mx-auto mb-4 opacity-20" />
                                <p>Standings will be available once the tournament bracket is finalized.</p>
                            </div>
                        )}
                    </div>
                )}

                {!loading && activeTab === 'entries' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-[color:var(--text)] font-display font-bold uppercase">All Entries ({entries.length})</h3>
                            {!shouldShowBrackets && !isManager && (
                                <p className="text-xs text-gold-700">
                                    Brackets will be visible after pool locks
                                </p>
                            )}
                        </div>
                        {entries.length === 0 ? (
                            <div className="text-center py-10 text-faint italic">No entries yet.</div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {entries.map(entry => (
                                    <div
                                        key={entry.id}
                                        onClick={() => handleViewEntry(entry)}
                                        className={`bg-card p-4 rounded-lg border transition-all cursor-pointer hover:scale-105 shadow-card ${entry.ownerUid === user?.id ? 'border-brandred-600/60 bg-brandred-600/[0.05] hover:border-brandred-500' : 'border-line hover:border-gold-500'}`}
                                    >
                                        <div className="font-bold text-[color:var(--text)] flex items-center gap-2">
                                            {entry.name}
                                            {entry.ownerUid === user?.id && (
                                                <YouPill />
                                            )}
                                        </div>
                                        <div className="text-xs text-faint mt-1">
                                            Score: <span className="text-[color:var(--text)] num font-semibold">{entry.score || 0}</span>
                                            {' · '}
                                            <span className={entry.status === 'SUBMITTED' ? 'text-[#0F7B4A]' : 'text-gold-600'}>
                                                {entry.status === 'SUBMITTED' ? 'Submitted' : 'Draft'}
                                            </span>
                                            {' · '}
                                            <span className={entry.paidStatus === 'PAID' ? 'text-[#0F7B4A]' : 'text-brandred-600'}>
                                                {entry.paidStatus === 'PAID' ? 'Paid' : 'Unpaid'}
                                            </span>
                                        </div>
                                        <div className="mt-2 text-xs text-gold-600 font-display font-bold uppercase tracking-[0.05em]">
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
                                { id: 'insights' as BracketSubTab, label: 'AI Insights' },
                            ].map(sub => (
                                <button
                                    key={sub.id}
                                    onClick={() => setBracketSubTab(sub.id)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-display font-bold uppercase tracking-[0.05em] border transition-colors duration-150 ${bracketSubTab === sub.id
                                        ? 'bg-navy-800 text-white border-navy-700'
                                        : 'bg-card text-muted hover:bg-surface border-line'
                                        }`}
                                >
                                    {sub.label}
                                </button>
                            ))}
                        </div>

                        {/* Poolwide Picks Heatmap */}
                        {bracketSubTab === 'poolwide' && (
                            <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                                <div className="flex items-center gap-2 mb-4">
                                    <Target size={20} className="text-gold-500" />
                                    <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)]">Poolwide Picks</h3>
                                </div>
                                <p className="text-muted font-body text-sm mb-4">See what percentage of the pool picked each team to advance in each round.</p>
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
                                                    <div key={game.id} className="flex items-center gap-2 bg-surface rounded-lg p-3 border border-line">
                                                        <div className="flex-1">
                                                            <div className="flex justify-between text-xs mb-1">
                                                                <span className="text-[color:var(--text)]">{game.homeTeamId}</span>
                                                                <span className="text-gold-600 num">{Math.round((homePicks / total) * 100)}%</span>
                                                            </div>
                                                            <div className="w-full bg-line rounded-full h-1.5">
                                                                <div className="bg-gold-500 h-full rounded-full" style={{ width: `${(homePicks / total) * 100}%` }} />
                                                            </div>
                                                        </div>
                                                        <span className="text-faint text-xs">vs</span>
                                                        <div className="flex-1">
                                                            <div className="flex justify-between text-xs mb-1">
                                                                <span className="text-[color:var(--text)]">{game.awayTeamId}</span>
                                                                <span className="text-navy-700 dark:text-[#9FB0CC] num">{Math.round((awayPicks / total) * 100)}%</span>
                                                            </div>
                                                            <div className="w-full bg-line rounded-full h-1.5">
                                                                <div className="bg-navy-600 h-full rounded-full" style={{ width: `${(awayPicks / total) * 100}%` }} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                ) : (
                                    <div className="text-center py-12 text-faint">
                                        <GitBranch size={48} className="mx-auto mb-4 opacity-20" />
                                        <p>Bracket data will be available once the tournament bracket is set.</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Pick History */}
                        {bracketSubTab === 'history' && (
                            tournament && userEntries.length > 0 ? (
                                <PickHistory entry={userEntries[0]} entries={userEntries} tournament={tournament} pool={pool} />
                            ) : (
                                <div className="bg-card border border-line rounded-xl p-6 text-center py-12 text-faint shadow-card">
                                    <p>{!tournament ? 'Tournament data not yet available.' : 'Submit a bracket to see your pick history.'}</p>
                                </div>
                            )
                        )}

                        {/* Who to Root For */}
                        {bracketSubTab === 'rootfor' && (
                            tournament && userEntries.length > 0 ? (
                                <WhoToRootFor userEntries={userEntries} allEntries={entries} tournament={tournament} pool={pool} />
                            ) : (
                                <div className="bg-card border border-line rounded-xl p-6 text-center py-12 text-faint shadow-card">
                                    <p>{!tournament ? 'Tournament data not yet available.' : 'Submit a bracket to see rooting advice.'}</p>
                                </div>
                            )
                        )}

                        {/* What-If Simulator */}
                        {bracketSubTab === 'whatif' && (
                            tournament ? (
                                <WhatIfSimulator entries={entries} tournament={tournament} pool={pool} currentUserId={user?.id} />
                            ) : (
                                <div className="bg-card border border-line rounded-xl p-6 text-center py-12 text-faint shadow-card">
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
                                        allEntries={pool.status === 'LOCKED' || pool.status === 'LIVE' || pool.status === 'COMPLETED' ? entries : userEntries}
                                        initialEntry1Id={userEntries[0]?.id}
                                        isConference={isConference}
                                    />
                                </div>
                            ) : (
                                <div className="bg-card border border-line rounded-xl p-6 text-center py-12 text-faint shadow-card">
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
                                <div className="bg-card border border-line rounded-xl p-6 text-center py-12 text-faint shadow-card">
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
                                        entries={pool.status === 'LOCKED' || pool.status === 'LIVE' || pool.status === 'COMPLETED' ? entries : userEntries}
                                        isConference={isConference}
                                    />
                                </div>
                            ) : (
                                <div className="bg-card border border-line rounded-xl p-6 text-center py-12 text-faint shadow-card">
                                    <p>{!tournament ? 'Tournament data not yet available.' : 'Need at least 1 entry for analytics.'}</p>
                                </div>
                            )
                        )}

                        {/* AI Insights */}
                        {bracketSubTab === 'insights' && (
                            <div className="animate-in fade-in slide-in-from-bottom-4">
                                <AICommissioner poolId={pool.id} userId={user?.id} userName={user?.name} poolType="BRACKET" />
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

                {/* Rules Tab — visible to all members */}
                {!loading && activeTab === 'rules' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4">
                        <BracketRulesPanel pool={pool} tournament={tournament} />
                    </div>
                )}

                {/* Manager Tab */}
                {!loading && activeTab === 'manager' && isManager && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 space-y-6 max-w-3xl">
                        {/* Pool Settings + Deadlines Card */}
                        <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)]">Pool Settings</h3>
                                {!editingSettings ? (
                                    ((pool.status !== 'LOCKED' && pool.status !== 'LIVE' && pool.status !== 'COMPLETED') || isSuperAdmin(user)) ? (
                                        <button onClick={() => setEditingSettings(true)} className="text-xs text-gold-600 hover:text-gold-500 font-bold flex items-center gap-1 px-3 py-1.5 border border-gold-500/40 rounded-lg">
                                            <Edit3 size={12} /> Edit
                                        </button>
                                    ) : (
                                        <span className="text-xs text-faint font-bold px-3 py-1.5 border border-line rounded-lg flex items-center gap-1">
                                            <Lock size={12} /> Locked
                                        </span>
                                    )
                                ) : (
                                    <button
                                        onClick={handleSaveSettings}
                                        disabled={savingSettings}
                                        className="bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
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
                                        { label: 'Status', value: pool.status, color: 'text-[#0F7B4A]' },
                                        { label: 'Pool Name', value: pool.name, color: 'text-[color:var(--text)]' },
                                        { label: 'Manager', value: pool.managerName || '—', color: 'text-[color:var(--text)]' },
                                        { label: 'Contact', value: pool.contactEmail || '—', color: 'text-[color:var(--text)]' },
                                        { label: 'Public', value: pool.isListedPublic ? 'Yes' : 'No', color: pool.isListedPublic ? 'text-[#0F7B4A]' : 'text-faint' },
                                        { label: 'Scoring', value: pool.settings.scoringSystem, color: 'text-[color:var(--text)]' },
                                        { label: 'Entries', value: `${entries.length} / ${pool.settings.maxEntriesTotal === -1 ? '\u221e' : pool.settings.maxEntriesTotal}`, color: 'text-[color:var(--text)]' },
                                        { label: 'Per User', value: pool.settings.maxEntriesPerUser === -1 ? 'Unlimited' : String(pool.settings.maxEntriesPerUser), color: 'text-[color:var(--text)]' },
                                        { label: 'Entry Fee', value: pool.settings.entryFee > 0 ? `$${pool.settings.entryFee}` : 'Free', color: 'text-[color:var(--text)]' },
                                        { label: 'Tiebreaker', value: pool.settings.tieBreakers?.closestUnder ? 'Closest Under' : 'Closest Absolute', color: 'text-[color:var(--text)]' },
                                        { label: 'Upset Bonus', value: pool.settings.upsetBonus?.enabled ? `${pool.settings.upsetBonus.multiplier}x multiplier` : 'Disabled', color: pool.settings.upsetBonus?.enabled ? 'text-gold-600' : 'text-faint' },
                                        { label: 'Lock Date', value: pool.lockAt ? new Date(pool.lockAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not set', color: pool.lockAt ? 'text-white' : 'text-faint' },
                                        { label: 'Registration', value: pool.registrationDeadline ? new Date(pool.registrationDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'None set', color: pool.registrationDeadline ? 'text-white' : 'text-faint' },
                                        { label: 'Submission', value: pool.submissionDeadline ? new Date(pool.submissionDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'None set', color: pool.submissionDeadline ? 'text-white' : 'text-faint' },
                                        { label: 'Tournament', value: pool.tournamentId || 'Not linked', color: 'text-muted' },
                                        { label: 'Venmo', value: pool.venmo || '—', color: pool.venmo ? 'text-white' : 'text-faint' },
                                        { label: 'Zelle', value: pool.zelle || '—', color: pool.zelle ? 'text-white' : 'text-faint' },
                                        { label: 'CashApp', value: pool.cashapp || '—', color: pool.cashapp ? 'text-white' : 'text-faint' },
                                        { label: 'PayPal', value: pool.paypal || '—', color: pool.paypal ? 'text-white' : 'text-faint' },
                                    ].map(row => (
                                        <div key={row.label} className="flex justify-between items-center p-3 bg-surface rounded border border-line">
                                            <span className="text-muted text-sm">{row.label}</span>
                                            <span className={`num text-sm ${row.color}`}>{row.value}</span>
                                        </div>
                                    ))}
                                    {/* Payouts summary */}
                                    {pool.settings.payouts?.places && pool.settings.payouts.places.length > 0 && (
                                        <div className="p-3 bg-surface rounded border border-line">
                                            <span className="text-muted text-sm block mb-1">Payouts</span>
                                            <div className="flex flex-wrap gap-2">
                                                {pool.settings.payouts.places.map(p => (
                                                    <span key={p.rank} className="text-xs bg-page border border-line text-[color:var(--text)] num px-2 py-1 rounded">
                                                        #{p.rank}: {p.percentage}%
                                                    </span>
                                                ))}
                                                {pool.settings.payouts.bonuses?.map(b => (
                                                    <span key={b.name} className="text-xs bg-[#E4F5EC] border border-[#BEE7D0] text-[#0F7B4A] num px-2 py-1 rounded">
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
                                    <button onClick={() => setEditingSettings(false)} className="text-xs text-faint hover:text-muted flex items-center gap-1 mb-2">
                                        <X size={12} /> Cancel
                                    </button>

                                    {/* Section 1: Pool Details */}
                                    <div className="border border-line rounded-lg overflow-hidden">
                                        <button onClick={() => toggleSection('details')} className="w-full flex items-center justify-between p-3 bg-surface hover:bg-page transition-colors">
                                            <span className="flex items-center gap-2 text-sm font-display font-bold uppercase text-[color:var(--text)]"><Globe size={14} className="text-gold-500" /> Pool Details</span>
                                            {openSections.details ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
                                        </button>
                                        {openSections.details && (
                                            <div className="p-4 bg-card space-y-3">
                                                <div>
                                                    <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">Pool Name</label>
                                                    <input value={editPoolName} onChange={e => setEditPoolName(e.target.value)}
                                                        className="w-full bg-surface border border-line rounded-lg p-2.5 font-body text-[color:var(--text)] text-sm" />
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">Manager Name</label>
                                                        <input value={editManagerName} onChange={e => setEditManagerName(e.target.value)}
                                                            className="w-full bg-surface border border-line rounded-lg p-2.5 font-body text-[color:var(--text)] text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">Contact Email</label>
                                                        <input type="email" value={editContactEmail} onChange={e => setEditContactEmail(e.target.value)}
                                                            className="w-full bg-surface border border-line rounded-lg p-2.5 font-body text-[color:var(--text)] text-sm" />
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between p-3 bg-surface rounded border border-line">
                                                    <span className="text-sm text-muted">Publicly Listed</span>
                                                    <button onClick={() => setEditIsPublic(!editIsPublic)}
                                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editIsPublic ? 'bg-gold-500' : 'bg-line'}`}>
                                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editIsPublic ? 'translate-x-6' : 'translate-x-1'}`} />
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Section 2: Rules */}
                                    <div className="border border-line rounded-lg overflow-hidden">
                                        <button onClick={() => toggleSection('rules')} className="w-full flex items-center justify-between p-3 bg-surface hover:bg-page transition-colors">
                                            <span className="flex items-center gap-2 text-sm font-display font-bold uppercase text-[color:var(--text)]"><Target size={14} className="text-gold-600" /> Rules</span>
                                            {openSections.rules ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
                                        </button>
                                        {openSections.rules && (
                                            <div className="p-4 bg-card space-y-3">
                                                {/* Status (read-only) */}
                                                <div className="flex justify-between items-center p-3 bg-surface rounded border border-line">
                                                    <span className="text-muted text-sm">Status</span>
                                                    <span className="num text-sm text-[#0F7B4A]">{pool.status}</span>
                                                </div>
                                                {/* Scoring System */}
                                                <div>
                                                    <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">Scoring System</label>
                                                    <select value={editScoring} onChange={e => setEditScoring(e.target.value as 'CLASSIC' | 'ESPN' | 'FIBONACCI' | 'CUSTOM')}
                                                        className="w-full bg-surface border border-line rounded-lg p-2.5 font-body text-[color:var(--text)] text-sm">
                                                        <option value="CLASSIC">Classic (1-2-4-8-16-32)</option>
                                                        <option value="ESPN">ESPN (10-20-40-80-160-320)</option>
                                                        <option value="FIBONACCI">Fibonacci (2-3-5-8-13-21)</option>
                                                        <option value="CUSTOM">Custom</option>
                                                    </select>
                                                </div>
                                                {/* Custom Scoring Input */}
                                                {editScoring === 'CUSTOM' && (
                                                    <div>
                                                        <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">Custom Points (R64, R32, S16, E8, F4, Champ)</label>
                                                        <div className="grid grid-cols-6 gap-2">
                                                            {['R64', 'R32', 'S16', 'E8', 'F4', 'CH'].map((label, i) => (
                                                                <div key={label} className="text-center">
                                                                    <span className="text-[10px] text-faint block mb-0.5">{label}</span>
                                                                    <input type="number" value={editCustomScoring[i] || 0}
                                                                        onChange={e => { const c = [...editCustomScoring]; c[i] = Number(e.target.value); setEditCustomScoring(c); }}
                                                                        className="w-full bg-surface border border-line rounded p-1.5 text-[color:var(--text)] num text-sm text-center" min={0} />
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {/* Entry Limits */}
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">Max Entries (Total)</label>
                                                        <input type="number" value={editMaxTotal} onChange={e => setEditMaxTotal(Number(e.target.value))}
                                                            className="w-full bg-surface border border-line rounded-lg p-2.5 font-body text-[color:var(--text)] text-sm" min={-1} />
                                                        <p className="text-[10px] text-faint mt-1">-1 = unlimited</p>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">Max Per User</label>
                                                        <input type="number" value={editMaxPerUser} onChange={e => setEditMaxPerUser(Number(e.target.value))}
                                                            className="w-full bg-surface border border-line rounded-lg p-2.5 font-body text-[color:var(--text)] text-sm" min={-1} />
                                                        <p className="text-[10px] text-faint mt-1">-1 = unlimited</p>
                                                    </div>
                                                </div>
                                                {/* Entry Fee */}
                                                <div>
                                                    <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">Entry Fee ($)</label>
                                                    <input type="number" value={editEntryFee} onChange={e => setEditEntryFee(Number(e.target.value))}
                                                        className="w-full bg-surface border border-line rounded-lg p-2.5 font-body text-[color:var(--text)] text-sm" min={0} step={5} />
                                                </div>
                                                {/* Tiebreaker */}
                                                <div>
                                                    <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">Tiebreaker Rule</label>
                                                    <select value={editTiebreaker} onChange={e => setEditTiebreaker(e.target.value as 'CLOSEST_ABSOLUTE' | 'CLOSEST_UNDER')}
                                                        className="w-full bg-surface border border-line rounded-lg p-2.5 font-body text-[color:var(--text)] text-sm">
                                                        <option value="CLOSEST_ABSOLUTE">Closest to Actual (over or under)</option>
                                                        <option value="CLOSEST_UNDER">Closest Without Going Over</option>
                                                    </select>
                                                </div>
                                                {/* Upset Bonus */}
                                                <div className="pt-3 border-t border-line">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-sm text-muted">Upset Bonus Scoring</span>
                                                        <button onClick={() => setEditUpsetBonusEnabled(!editUpsetBonusEnabled)}
                                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editUpsetBonusEnabled ? 'bg-gold-500' : 'bg-line'}`}>
                                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editUpsetBonusEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                                        </button>
                                                    </div>
                                                    {editUpsetBonusEnabled && (
                                                        <div className="bg-surface p-3 rounded-lg border border-line">
                                                            <label className="text-[10px] text-faint block mb-1">Points per Seed Difference</label>
                                                            <input type="number" value={editUpsetMultiplier} onChange={e => setEditUpsetMultiplier(Number(e.target.value))}
                                                                className="w-full bg-page border border-line rounded p-2 text-[color:var(--text)] num text-sm" min={1} />
                                                            <p className="text-[10px] text-faint mt-2">
                                                                If a #10 beats a #2, bonus is (10 - 2) × {editUpsetMultiplier} = <span className="text-gold-600 font-bold">{8 * editUpsetMultiplier} pts</span>
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Section 3: Payouts */}
                                    <div className="border border-line rounded-lg overflow-hidden">
                                        <button onClick={() => toggleSection('payouts')} className="w-full flex items-center justify-between p-3 bg-surface hover:bg-page transition-colors">
                                            <span className="flex items-center gap-2 text-sm font-display font-bold uppercase text-[color:var(--text)]"><Trophy size={14} className="text-gold-500" /> Payouts</span>
                                            {openSections.payouts ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
                                        </button>
                                        {openSections.payouts && (
                                            <div className="p-4 bg-card space-y-3">
                                                <p className="text-xs text-faint mb-2">Define how the prize pool is split. Percentages should total 100%.</p>
                                                {/* Place payouts */}
                                                {editPayouts.places.map((p, i) => (
                                                    <div key={i} className="flex items-center gap-2">
                                                        <span className="text-xs text-muted w-16">#{p.rank}</span>
                                                        <input type="number" value={p.percentage}
                                                            onChange={e => {
                                                                const updated = [...editPayouts.places];
                                                                updated[i] = { ...p, percentage: Number(e.target.value) };
                                                                setEditPayouts({ ...editPayouts, places: updated });
                                                            }}
                                                            className="flex-1 bg-surface border border-line rounded p-2 text-[color:var(--text)] text-sm" min={0} max={100} />
                                                        <span className="text-xs text-faint">%</span>
                                                        <button onClick={() => {
                                                            const updated = editPayouts.places.filter((_, j) => j !== i);
                                                            setEditPayouts({ ...editPayouts, places: updated });
                                                        }} className="text-brandred-600 hover:text-brandred-500"><X size={14} /></button>
                                                    </div>
                                                ))}
                                                <button onClick={() => {
                                                    const nextRank = editPayouts.places.length > 0 ? Math.max(...editPayouts.places.map(p => p.rank)) + 1 : 1;
                                                    setEditPayouts({ ...editPayouts, places: [...editPayouts.places, { rank: nextRank, percentage: 0 }] });
                                                }} className="text-xs text-gold-600 hover:text-gold-500 flex items-center gap-1">
                                                    <PlusCircle size={12} /> Add place payout
                                                </button>

                                                {/* Bonuses */}
                                                <div className="pt-2 border-t border-line">
                                                    <p className="text-xs text-faint mb-2">Bonus Payouts</p>
                                                    {/* PLAN-HELP-SYSTEM T6: the two `?`s for the bonus rows.
                                                        ON A COLUMN HEADER, ONCE, rather than on every row — the
                                                        list repeats and a tip per input would draw two icons per
                                                        bonus for one explanation each (voice rule 10). The two
                                                        inputs below carry no label at all today, so this row is
                                                        also what names them; `aria-label` gives a screen reader
                                                        the same two words. `text-muted`, NOT the `text-faint` of
                                                        the title above it: `HelpTip` is `text-current` and
                                                        `--faint` is 2.81:1 on the light page, which is the exact
                                                        regression `tests/help-tip-contrast.test.ts` exists for.
                                                        Rendered even with NO bonus rows yet, deliberately: that
                                                        is the moment a commissioner most needs to be told what a
                                                        bonus is, and the `?` is the only thing here that says. */}
                                                    <div className="flex items-center gap-2 mb-1 text-xs text-muted">
                                                        <span className="flex-1 flex items-center gap-1.5">Name<HelpTip helpId="settings.payouts.bonuses.*.name" /></span>
                                                        <span className="w-20 flex items-center gap-1.5">Share<HelpTip helpId="settings.payouts.bonuses.*.percentage" /></span>
                                                        {/* Keeps the two headings over their columns: the `%`
                                                            suffix and the remove button sit to the right of the
                                                            share input on every row below. */}
                                                        <span className="w-[38px]" aria-hidden="true" />
                                                    </div>
                                                    {editPayouts.bonuses.map((b, i) => (
                                                        <div key={i} className="flex items-center gap-2 mb-2">
                                                            <input value={b.name}
                                                                aria-label="Bonus name"
                                                                onChange={e => {
                                                                    const updated = [...editPayouts.bonuses];
                                                                    updated[i] = { ...b, name: e.target.value };
                                                                    setEditPayouts({ ...editPayouts, bonuses: updated });
                                                                }}
                                                                className="flex-1 bg-surface border border-line rounded p-2 text-[color:var(--text)] text-sm" placeholder="Bonus name" />
                                                            <input type="number" value={b.percentage}
                                                                aria-label="Bonus share, percent"
                                                                onChange={e => {
                                                                    const updated = [...editPayouts.bonuses];
                                                                    updated[i] = { ...b, percentage: Number(e.target.value) };
                                                                    setEditPayouts({ ...editPayouts, bonuses: updated });
                                                                }}
                                                                className="w-20 bg-surface border border-line rounded p-2 text-[color:var(--text)] text-sm" min={0} max={100} />
                                                            <span className="text-xs text-faint">%</span>
                                                            <button onClick={() => {
                                                                const updated = editPayouts.bonuses.filter((_, j) => j !== i);
                                                                setEditPayouts({ ...editPayouts, bonuses: updated });
                                                            }} className="text-brandred-600 hover:text-brandred-500"><X size={14} /></button>
                                                        </div>
                                                    ))}
                                                    <button onClick={() => {
                                                        setEditPayouts({ ...editPayouts, bonuses: [...editPayouts.bonuses, { name: '', percentage: 0 }] });
                                                    }} className="text-xs text-gold-600 hover:text-gold-500 flex items-center gap-1">
                                                        <PlusCircle size={12} /> Add bonus
                                                    </button>
                                                </div>

                                                {/* Total indicator */}
                                                {(() => {
                                                    const totalPct = editPayouts.places.reduce((s, p) => s + p.percentage, 0) + editPayouts.bonuses.reduce((s, b) => s + b.percentage, 0);
                                                    return (
                                                        <div className={`text-xs text-right num ${totalPct === 100 ? 'text-[#0F7B4A]' : 'text-brandred-600'}`}>
                                                            Total: {totalPct}% {totalPct !== 100 && '(should be 100%)'}
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        )}
                                    </div>

                                    {/* Section 4: Payment Info */}
                                    <div className="border border-line rounded-lg overflow-hidden">
                                        <button onClick={() => toggleSection('payment')} className="w-full flex items-center justify-between p-3 bg-surface hover:bg-page transition-colors">
                                            <span className="flex items-center gap-2 text-sm font-display font-bold uppercase text-[color:var(--text)]"><CreditCard size={14} className="text-[#0F7B4A]" /> Payment Info</span>
                                            {openSections.payment ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
                                        </button>
                                        {openSections.payment && (
                                            <div className="p-4 bg-card space-y-3">
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">Venmo</label>
                                                        <input value={editVenmo} onChange={e => setEditVenmo(e.target.value)} placeholder="@username"
                                                            className="w-full bg-surface border border-line rounded-lg p-2.5 font-body text-[color:var(--text)] text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">Zelle</label>
                                                        <input value={editZelle} onChange={e => setEditZelle(e.target.value)} placeholder="email or phone"
                                                            className="w-full bg-surface border border-line rounded-lg p-2.5 font-body text-[color:var(--text)] text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">CashApp</label>
                                                        <input value={editCashapp} onChange={e => setEditCashapp(e.target.value)} placeholder="$username"
                                                            className="w-full bg-surface border border-line rounded-lg p-2.5 font-body text-[color:var(--text)] text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">PayPal</label>
                                                        <input value={editPaypal} onChange={e => setEditPaypal(e.target.value)} placeholder="email"
                                                            className="w-full bg-surface border border-line rounded-lg p-2.5 font-body text-[color:var(--text)] text-sm" />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">Payment Instructions</label>
                                                    <textarea value={editPaymentInstructions} onChange={e => setEditPaymentInstructions(e.target.value)}
                                                        className="w-full bg-surface border border-line rounded-lg p-2.5 font-body text-[color:var(--text)] text-sm" rows={3}
                                                        placeholder="How should participants pay? e.g. 'Send $25 to @MyVenmo with Pool Name in the memo'" />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Section 5: Branding */}
                                    <div className="border border-line rounded-lg overflow-hidden">
                                        <button onClick={() => toggleSection('branding')} className="w-full flex items-center justify-between p-3 bg-surface hover:bg-page transition-colors">
                                            <span className="flex items-center gap-2 text-sm font-display font-bold uppercase text-[color:var(--text)]"><Palette size={14} className="text-gold-500" /> Branding</span>
                                            {openSections.branding ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
                                        </button>
                                        {openSections.branding && (
                                            <div className="p-4 bg-card space-y-3">
                                                <div>
                                                    <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">Logo URL</label>
                                                    <input value={editBranding.logoUrl || ''} onChange={e => setEditBranding({ ...editBranding, logoUrl: e.target.value })}
                                                        className="w-full bg-surface border border-line rounded-lg p-2.5 font-body text-[color:var(--text)] text-sm" placeholder="https://..." />
                                                </div>
                                                <div>
                                                    <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">Background Color</label>
                                                    <div className="flex items-center gap-3">
                                                        <input type="color" value={editBranding.bgColor || '#0f172a'}
                                                            onChange={e => setEditBranding({ ...editBranding, bgColor: e.target.value })}
                                                            className="w-10 h-10 rounded border border-line cursor-pointer" />
                                                        <input value={editBranding.bgColor || '#0f172a'}
                                                            onChange={e => setEditBranding({ ...editBranding, bgColor: e.target.value })}
                                                            className="flex-1 bg-surface border border-line rounded-lg p-2.5 text-[color:var(--text)] text-sm font-mono" />
                                                    </div>
                                                </div>
                                                {editBranding.logoUrl && (
                                                    <div className="mt-2">
                                                        <p className="text-xs text-faint mb-1">Preview</p>
                                                        <img src={editBranding.logoUrl} alt="Pool logo" className="h-12 rounded" onError={e => (e.currentTarget.style.display = 'none')} />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Section 6: Reminders */}
                                    <div className="border border-line rounded-lg overflow-hidden">
                                        <button onClick={() => toggleSection('reminders')} className="w-full flex items-center justify-between p-3 bg-surface hover:bg-page transition-colors">
                                            <span className="flex items-center gap-2 text-sm font-display font-bold uppercase text-[color:var(--text)]"><Bell size={14} className="text-gold-500" /> Reminders</span>
                                            {openSections.reminders ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
                                        </button>
                                        {openSections.reminders && (
                                            <div className="p-4 bg-card space-y-3">
                                                {[
                                                    { key: 'auto24h' as const, label: 'Send reminder 24 hours before lock' },
                                                    { key: 'auto1h' as const, label: 'Send reminder 1 hour before lock' },
                                                    { key: 'autoLock' as const, label: 'Auto-lock at tournament start' },
                                                    { key: 'announceWinner' as const, label: 'Announce winner when tournament ends' },
                                                ].map(item => (
                                                    <div key={item.key} className="flex items-center justify-between p-3 bg-surface rounded border border-line">
                                                        <span className="text-sm text-muted">{item.label}</span>
                                                        <button onClick={() => setEditReminders({ ...editReminders, [item.key]: !editReminders[item.key] })}
                                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editReminders[item.key] ? 'bg-gold-500' : 'bg-line'}`}>
                                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editReminders[item.key] ? 'translate-x-6' : 'translate-x-1'}`} />
                                                        </button>
                                                    </div>
                                                ))}
                                                <div>
                                                    <label className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">Reminder Recipient Filter</label>
                                                    <select value={editReminders.recipientFilter || 'all'}
                                                        onChange={e => setEditReminders({ ...editReminders, recipientFilter: e.target.value as 'all' | 'unpaid' | 'noentry' })}
                                                        className="w-full bg-surface border border-line rounded-lg p-2.5 font-body text-[color:var(--text)] text-sm">
                                                        <option value="all">All Participants</option>
                                                        <option value="unpaid">Unpaid Only</option>
                                                        <option value="noentry">No Entry Submitted</option>
                                                    </select>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Section 7: Access Control */}
                                    <div className="border border-line rounded-lg overflow-hidden">
                                        <button onClick={() => toggleSection('access')} className="w-full flex items-center justify-between p-3 bg-surface hover:bg-page transition-colors">
                                            <span className="flex items-center gap-2 text-sm font-display font-bold uppercase text-[color:var(--text)]"><Key size={14} className="text-brandred-600" /> Access Control</span>
                                            {openSections.access ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
                                        </button>
                                        {openSections.access && (
                                            <div className="p-4 bg-card space-y-3">
                                                <div>
                                                    <label htmlFor="bracket-pool-password" className="text-xs font-display font-bold uppercase tracking-[0.08em] text-muted block mb-1">Pool Password</label>
                                                    <input id="bracket-pool-password" type="password" autoComplete="new-password"
                                                        value={editPassword} onChange={e => setEditPassword(e.target.value)} disabled={clearPassword}
                                                        placeholder={poolHasPassword ? 'Enter a new password to change it' : 'Leave blank for no password'}
                                                        className="w-full bg-surface border border-line rounded-lg p-2.5 font-body text-[color:var(--text)] text-sm disabled:opacity-50" />
                                                    <p className="text-[10px] text-faint mt-1">
                                                        {poolHasPassword
                                                            ? 'This pool has a password. It is stored encrypted and cannot be shown again — leave this blank to keep it unchanged.'
                                                            : 'Participants must enter this to join. Leave empty for open access.'}
                                                    </p>
                                                    {poolHasPassword && (
                                                        <label className="mt-2 flex items-center gap-2 text-[11px] text-muted font-body">
                                                            <input type="checkbox" checked={clearPassword} onChange={e => setClearPassword(e.target.checked)} />
                                                            Remove the password (anyone with the link can join)
                                                        </label>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Section 8: Dates & Deadlines */}
                                    <div className="border border-line rounded-lg">
                                        <button onClick={() => toggleSection('dates')} className="w-full flex items-center justify-between p-3 bg-surface hover:bg-page transition-colors rounded-lg">
                                            <span className="flex items-center gap-2 text-sm font-display font-bold uppercase text-[color:var(--text)]"><Lock size={14} className="text-gold-500" /> Dates & Deadlines</span>
                                            {openSections.dates ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
                                        </button>
                                        {openSections.dates && (
                                            <div className="p-4 bg-card space-y-3">
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
                        <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                            <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-3 flex items-center gap-2">
                                <ShieldCheck size={18} className="text-gold-600" /> Pool Locking
                            </h3>
                            <p className="text-muted text-xs mb-4">
                                Control when the pool locks and brackets become visible to all participants.
                            </p>

                            <div className="space-y-4">
                                {/* Current Status */}
                                <div className="bg-surface border border-line rounded-lg p-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-xs text-muted uppercase mb-1">Current Status</p>
                                            <p className="text-lg font-bold text-white">{pool.status}</p>
                                        </div>
                                        <div className="flex flex-col gap-2 items-end">
                                            {pool.status === 'DRAFT' && (
                                                <button
                                                    onClick={async () => {
                                                        setSavingSettings(true);
                                                        try {
                                                            await dbService.updateBracketPool(pool.id, { status: 'OPEN' });
                                                        } catch (err) {
                                                            logger.error('[BracketPoolDashboard] Error publishing pool:', err);
                                                            setError('Failed to publish pool.');
                                                        } finally {
                                                            setSavingSettings(false);
                                                        }
                                                    }}
                                                    disabled={savingSettings}
                                                    className="bg-gold-foil hover:brightness-105 disabled:opacity-50 text-navy-900 px-4 py-2 rounded-lg text-sm font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2"
                                                >
                                                    {savingSettings ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
                                                    Publish Pool (Set OPEN)
                                                </button>
                                            )}
                                            {pool.status !== 'LOCKED' && pool.status !== 'LIVE' && pool.status !== 'COMPLETED' && (
                                                <button
                                                    onClick={handleLockNow}
                                                    disabled={savingSettings}
                                                    className="bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2"
                                                >
                                                    {savingSettings ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                                                    Lock Pool Now
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Auto-Lock Time */}
                                <div className="bg-surface border border-line rounded-lg p-4">
                                    <label className="text-xs text-muted uppercase mb-2 block">Auto-Lock Time</label>
                                    <p className="text-xs text-faint mb-2">
                                        Pool will automatically lock at this time (typically tournament start).
                                    </p>
                                    {/* Quick-fill from tournament */}
                                    {tournament?.lockAt && editLockAt !== tournament.lockAt && (
                                        <button
                                            onClick={() => setEditLockAt(tournament.lockAt)}
                                            className="mb-3 text-xs text-gold-600 hover:text-gold-500 flex items-center gap-1.5 bg-gold-500/10 border border-gold-500/20 rounded-lg px-3 py-1.5 transition-colors"
                                        >
                                            <Lock size={11} />
                                            Use tournament lock: {new Date(tournament.lockAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}
                                        </button>
                                    )}
                                    {tournament?.lockAt && editLockAt === tournament.lockAt && (
                                        <p className="mb-3 text-xs text-[#0F7B4A] flex items-center gap-1.5">
                                            <Check size={11} /> Synced with tournament lock date
                                        </p>
                                    )}
                                    <div className="flex gap-2 items-end">
                                        <div className="flex-1">
                                            <DateTimePicker
                                                label=""
                                                value={editLockAt}
                                                onChange={ts => setEditLockAt(ts ?? undefined)}
                                                placeholder="Pick a lock date & time…"
                                            />
                                        </div>
                                        <button
                                            onClick={handleSaveLockAt}
                                            disabled={savingSettings || !editLockAt}
                                            className="bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 mb-0.5"
                                        >
                                            {savingSettings ? <Loader2 size={14} className="animate-spin" /> : settingsSaved ? <Check size={14} /> : <Save size={14} />}
                                            {settingsSaved ? 'Saved!' : 'Save'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Commissioner Message Editor */}
                        <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                            <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-3 flex items-center gap-2">
                                <MessageSquare size={18} className="text-gold-600" /> Commissioner Message
                            </h3>
                            <p className="text-muted text-xs mb-3">This message is displayed to all pool members as a banner.</p>
                            <textarea
                                value={commissionerDraft}
                                onChange={e => setCommissionerDraft(e.target.value)}
                                placeholder="Welcome to the pool! Payment is due by March 15th via Venmo..."
                                className="w-full bg-surface border border-line rounded-lg p-3 font-body text-[color:var(--text)] text-sm resize-none h-24 placeholder:text-faint"
                                maxLength={500}
                            />
                            <div className="flex items-center justify-between mt-2">
                                <span className="text-[10px] text-faint">{commissionerDraft.length}/500</span>
                                <button
                                    onClick={handleSaveCommissionerMessage}
                                    disabled={savingMessage}
                                    className="bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
                                >
                                    {savingMessage ? <Loader2 size={14} className="animate-spin" /> : messageSaved ? <Check size={14} /> : <Save size={14} />}
                                    {messageSaved ? 'Saved!' : 'Save Message'}
                                </button>
                            </div>
                        </div>

                        {/* Entry Status Card */}
                        <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                            <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2">
                                <ClipboardList size={18} className="text-gold-500" /> Entry Status
                            </h3>
                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <div className="bg-surface rounded-lg p-3 border border-line text-center">
                                    <p className="text-2xl font-bold text-[#0F7B4A]">{entries.filter(e => e.status === 'SUBMITTED').length}</p>
                                    <p className="text-[10px] text-faint uppercase">Completed</p>
                                </div>
                                <div className="bg-surface rounded-lg p-3 border border-line text-center">
                                    <p className="text-2xl font-bold text-gold-600">{entries.filter(e => e.status === 'DRAFT').length + ((pool.participantIds?.length || 0) - new Set(entries.map(e => e.ownerUid)).size)}</p>
                                    <p className="text-[10px] text-faint uppercase">Incomplete</p>
                                </div>
                            </div>
                            <button
                                onClick={handleEmailIncomplete}
                                disabled={sendingEmail}
                                className="w-full bg-navy-700 hover:bg-navy-600 disabled:opacity-50 text-white font-display font-bold uppercase tracking-[0.05em] py-2 rounded-lg flex items-center justify-center gap-2 transition-colors text-sm"
                            >
                                {sendingEmail ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                                Email Incomplete Entries
                            </button>
                        </div>

                        {/* Accounting Card */}
                        <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-2">
                                    <Coins size={18} className="text-gold-500" /> Accounting
                                </h3>
                                <button
                                    onClick={handleExportCSV}
                                    className="text-xs text-gold-600 hover:text-gold-500 font-bold px-3 py-1.5 border border-gold-500/40 rounded-lg flex items-center gap-1"
                                >
                                    <Download size={12} /> Export CSV
                                </button>
                            </div>
                            {/* Summary Stats */}
                            <div className="grid grid-cols-4 gap-3 mb-4">
                                <div className="bg-surface rounded-lg p-3 border border-line text-center">
                                    <p className="text-2xl font-bold text-[#0F7B4A]">${entries.filter(e => e.paidStatus === 'PAID').length * pool.settings.entryFee}</p>
                                    <p className="text-[10px] text-faint uppercase">Collected</p>
                                </div>
                                <div className="bg-surface rounded-lg p-3 border border-line text-center">
                                    <p className="text-2xl font-bold text-gold-600">${entries.filter(e => e.paidStatus !== 'PAID').length * pool.settings.entryFee}</p>
                                    <p className="text-[10px] text-faint uppercase">Outstanding</p>
                                </div>
                                <div className="bg-surface rounded-lg p-3 border border-line text-center">
                                    <p className="text-2xl font-bold text-white">${entries.length * pool.settings.entryFee}</p>
                                    <p className="text-[10px] text-faint uppercase">Gross Pot</p>
                                </div>
                                <div className="bg-surface rounded-lg p-3 border border-line text-center">
                                    <p className="text-2xl font-display font-bold num text-gold-600">
                                        ${pool.settings.charity?.enabled
                                            ? Math.floor((entries.length * pool.settings.entryFee) * (pool.settings.charity.percentage / 100))
                                            : 0}
                                    </p>
                                    <p className="text-[10px] text-faint uppercase">Charity</p>
                                </div>
                            </div>
                            {/* Entry Payment List — now with toggle buttons */}
                            <div className="space-y-2">
                                {entries.map(entry => (
                                    <div key={entry.id} className="flex items-center justify-between p-3 bg-surface rounded border border-line">
                                        <div>
                                            <span className="text-white text-sm font-bold">{entry.name}</span>
                                            <span className="text-faint text-xs ml-2">${pool.settings.entryFee}</span>
                                        </div>
                                        <button
                                            onClick={() => handleTogglePayment(entry.id, entry.paidStatus)}
                                            disabled={togglingPayment === entry.id}
                                            className={`text-xs font-display font-bold uppercase tracking-[0.05em] px-3 py-1.5 rounded transition-colors flex items-center gap-1 ${entry.paidStatus === 'PAID' ? 'bg-[#E4F5EC] text-[#0F7B4A] hover:bg-[#d3ecdd]' : 'bg-[#FBEEDD] text-[#B4530A] hover:bg-[#f4e2c9]'}`}
                                        >
                                            {togglingPayment === entry.id ? (
                                                <Loader2 size={12} className="animate-spin" />
                                            ) : entry.paidStatus === 'PAID' ? (
                                                <><Check size={12} /> Paid</>
                                            ) : (
                                                <><X size={12} /> Unpaid</>
                                            )}
                                        </button>
                                    </div>
                                ))}
                                {entries.length === 0 && (
                                    <p className="text-faint text-sm text-center py-4">No entries yet.</p>
                                )}
                            </div>
                        </div>

                        {/* Send Invitation */}
                        <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                            <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-3 flex items-center gap-2">
                                <Send size={18} className="text-gold-500" /> Send Invitation
                            </h3>
                            <p className="text-muted text-sm mb-3">Share the pool link to invite players.</p>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    readOnly
                                    value={`${window.location.origin}/pool/${pool.slug}`}
                                    className="flex-1 bg-surface border border-line rounded-lg p-2.5 text-[color:var(--text)] text-sm font-mono"
                                />
                                <button
                                    onClick={handleCopyLink}
                                    className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1 transition-colors ${linkCopied ? 'bg-[#0F7B4A] text-white' : 'bg-brandred-600 hover:bg-brandred-500 text-white'}`}
                                >
                                    {linkCopied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy</>}
                                </button>
                            </div>
                        </div>

                        {/* Share Analytics Card */}
                        <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                            <div className="flex items-center gap-2 mb-4">
                                <BarChart3 size={20} className="text-gold-500" />
                                <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)]">Share Analytics</h3>
                            </div>
                            {shareStats ? (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="bg-surface rounded-lg p-4 border border-line text-center">
                                            <p className="text-3xl font-display font-bold num text-gold-600">{shareStats.total}</p>
                                            <p className="text-[10px] text-faint uppercase">Total Clicks</p>
                                        </div>
                                        <div className="bg-surface rounded-lg p-4 border border-line text-center">
                                            <p className="text-3xl font-display font-bold num text-[#0F7B4A]">{shareStats.last7Days}</p>
                                            <p className="text-[10px] text-faint uppercase">Last 7 Days</p>
                                        </div>
                                    </div>
                                    {Object.keys(shareStats.byPlatform).length > 0 ? (
                                        <div className="space-y-2">
                                            <p className="text-xs font-bold text-muted uppercase">By Platform</p>
                                            {Object.entries(shareStats.byPlatform)
                                                .sort(([, a], [, b]) => b - a)
                                                .map(([platform, count]) => {
                                                    const pct = shareStats.total > 0 ? (count / shareStats.total) * 100 : 0;
                                                    const colors: Record<string, string> = {
                                                        facebook: 'bg-navy-600', twitter: 'bg-navy-700', reddit: 'bg-gold-600',
                                                        discord: 'bg-navy-600', email: 'bg-line', copy: 'bg-[#0F7B4A]',
                                                        instagram: 'bg-brandred-500'
                                                    };
                                                    return (
                                                        <div key={platform} className="flex items-center gap-3">
                                                            <span className="text-xs text-muted w-20 capitalize">{platform}</span>
                                                            <div className="flex-1 bg-line rounded-full h-2 overflow-hidden">
                                                                <div className={`h-full rounded-full ${colors[platform] || 'bg-gold-500'}`} style={{ width: `${pct}%` }} />
                                                            </div>
                                                            <span className="text-xs font-mono text-muted w-10 text-right">{count}</span>
                                                        </div>
                                                    );
                                                })}
                                        </div>
                                    ) : (
                                        <p className="text-faint text-sm text-center py-4">No share clicks recorded yet.</p>
                                    )}
                                </div>
                            ) : (
                                <div className="text-center py-6">
                                    <Loader2 className="animate-spin text-gold-500 mx-auto" size={24} />
                                    <p className="text-faint text-xs mt-2">Loading share analytics...</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

            </div>
            {/* Viewing Entry Modal */}
            {viewingEntry && tournament && (
                <OverlayRoot id="bracket-view-entry" label="Entry details" onEscape={() => setViewingEntry(null)} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-card border border-line rounded-2xl w-full max-w-[98vw] max-h-[95vh] flex flex-col shadow-card-hover">
                        <div className="flex items-center justify-between p-4 border-b border-line bg-surface rounded-t-2xl">
                            <div>
                                <h3 className="font-display font-bold uppercase text-lg text-[color:var(--text)] flex items-center gap-2">
                                    {viewingEntry.name}
                                    <span className="text-xs bg-gold-500/15 text-gold-700 border border-gold-500/30 px-2 py-0.5 rounded-full font-medium num">
                                        Score: {viewingEntry.score || 0}
                                    </span>
                                </h3>
                                <p className="text-xs text-muted">
                                    Owner: {entries.find(e => e.id === viewingEntry.id)?.ownerUid === user?.id ? 'You' : 'Another User'}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => window.print()}
                                    className="p-2 hover:bg-card rounded-lg text-muted hover:text-gold-600 transition-colors flex items-center gap-2"
                                    title="Print Bracket"
                                >
                                    <Printer className="w-5 h-5" />
                                    <span className="text-sm font-bold hidden sm:block">Print</span>
                                </button>
                                <button
                                    onClick={() => setViewingEntry(null)}
                                    className="p-2 hover:bg-card rounded-lg text-muted hover:text-[color:var(--text)] transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto p-4 bg-surface/50">
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
                                        entryName={viewingEntry.name}
                                        entryScore={viewingEntry.score ?? 0}
                                        maxPossibleScore={viewingEntry.maxPossibleScore ?? undefined}
                                        rank={[...entries].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).findIndex(e => e.id === viewingEntry.id) + 1}
                                        totalEntries={entries.length}
                                    />
                                )
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-center p-8">
                                    <ShieldCheck className="w-16 h-16 text-faint mb-4" />
                                    <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-2">Brackets Not Yet Visible</h3>
                                    <p className="text-muted max-w-md">
                                        All brackets will be visible once the pool is locked and the tournament has started.
                                        This ensures a fair playing field for all participants.
                                    </p>
                                    <div className="mt-4 text-sm text-faint">
                                        Pool Status: <span className="text-gold-600 num">{pool.status}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </OverlayRoot>
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
                            entryName={viewingEntry.name}
                            entryScore={viewingEntry.score ?? 0}
                            maxPossibleScore={viewingEntry.maxPossibleScore ?? undefined}
                            rank={[...entries].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).findIndex(e => e.id === viewingEntry.id) + 1}
                            totalEntries={entries.length}
                        />
                    )}
                </div>,
                document.body
            )}

            {/* BracketShareModal temporarily hidden - image generation failing */}

            {/* Pool Share Modal */}
            {showShareModal && (
                <PoolShareModal
                    poolId={pool.id}
                    poolName={pool.name}
                    poolSlug={pool.slug}
                    onClose={() => setShowShareModal(false)}
                />
            )}

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
                    <OverlayRoot id="bracket-name-entry" label="Name your bracket" onEscape={() => setShowNameModal(false)} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
                        <div className="bg-card border border-line rounded-xl max-w-md w-full p-6 shadow-card-hover relative">
                            <button
                                onClick={() => setShowNameModal(false)}
                                className="absolute top-4 right-4 text-muted hover:text-white transition-colors"
                            >
                                <X size={20} />
                            </button>

                            <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-2">Name Your Bracket</h3>
                            <p className="text-muted text-sm mb-6">
                                Give your bracket a unique name to easily identify it in the standings.
                            </p>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-muted mb-1">
                                        Bracket Name
                                    </label>
                                    <input
                                        type="text"
                                        value={newNameInput}
                                        onChange={(e) => setNewNameInput(e.target.value)}
                                        placeholder="Enter a bracket name..."
                                        className={`w-full bg-surface border ${isNameTaken && newNameInput.trim() !== '' ? 'border-brandred-500/50 focus:ring-brandred-500' : 'border-line focus:ring-gold-500'} rounded-lg px-4 py-3 text-[color:var(--text)] focus:ring-2 focus:border-transparent outline-none transition-all placeholder:text-faint`}
                                        autoFocus
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && newNameInput.trim() && !isNameTaken) {
                                                setShowNameModal(false);
                                                handleCreateEntry(newNameInput.trim());
                                            }
                                        }}
                                    />
                                    {isNameTaken && newNameInput.trim() !== '' && (
                                        <p className="mt-2 text-sm text-brandred-600 flex items-center gap-1">
                                            This name is taken. How about <button
                                                onClick={() => setNewNameInput(suggestedName)}
                                                className="underline font-bold hover:text-brandred-500"
                                            >"{suggestedName}"</button>?
                                        </p>
                                    )}
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <button
                                        onClick={() => setShowNameModal(false)}
                                        className="flex-1 px-4 py-2 border border-line text-muted rounded-lg hover:bg-surface transition-colors font-medium"
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
                                        className="flex-1 bg-gold-foil hover:brightness-105 text-navy-900 px-4 py-2 rounded-lg transition-all font-display font-bold uppercase tracking-[0.05em] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                                        Continue
                                    </button>
                                </div>
                            </div>
                        </div>
                    </OverlayRoot>
                );
            })()}
        </div>
        </BillingGate>
    );
};
