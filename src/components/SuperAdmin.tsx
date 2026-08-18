import { logger } from '../utils/logger';
import { nflWeekLabel } from '../utils/nflWeekLabel';
import { CANONICAL_ROLES, normalizeRole, roleBadge } from '../utils/roles';
import { ConfirmActionModal } from './admin/ConfirmActionModal';
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { HelpRoutePublisher } from '../help/publish';
import type { GameState, Pool, User, SystemSettings, PropSeed, PlayoffTeam, PoolTheme, LoyaltyTier } from '../types';
import { dbService, type GlobalStats } from '../services/dbService';
import { isTestPool } from '@shared/testPool';
import { settingsService } from '../services/settingsService';
import { SimulationDashboard } from './SimulationDashboard';
import { SimpleTestingDashboard } from './SimpleTestingDashboard';
import { Trash2, Shield, Activity, Heart, Users, Settings, ToggleLeft, ToggleRight, PlayCircle, Search, ArrowDown, Palette, Plus, Eye, EyeOff, Star, Copy, X, List, Bot, Trophy, Lock, CheckCircle, XCircle, RefreshCw, Wrench, Ticket, Megaphone, Globe, PartyPopper, Mail, KeyRound } from 'lucide-react';
import { NFL_TEAMS, getTeamLogo } from '../constants';
import { getPoolSport, getPoolLifecycleState, formatPoolMatchup, getPoolEntrySummary, formatEntryCount, getPoolLockTimeState, isNFLSeasonPoolType, isSquaresPoolType } from '../utils/poolSport';
import type { EntryCountable, LockTimeReadable } from '../utils/poolSport';
import { ErrorBoundary } from './ErrorBoundary';
import { POOL_TYPES, resolvePoolTypeFlags } from '../utils/featureFlags';
import { db } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';


import { PlayoffResultsManager } from './PlayoffPool/PlayoffResultsManager';
import { AdminStatsDashboard } from './AdminStatsDashboard';
import { TournamentManager } from './admin/TournamentManager';
import { SuperAdminBentoDashboard } from './SuperAdminBentoDashboard';
import { simulatePoolGame } from '../utils/simulationUtils';
import { SuperAdminBillingPanel } from './admin/SuperAdminBillingPanel';
import { AdminAuditViewer } from './admin/AdminAuditViewer';
import { OperationsPanel } from './admin/OperationsPanel';
import { useEnsureAdminClaims } from '../hooks/useEnsureAdminClaims';
import { SuperAdminNFLSpreads } from './admin/SuperAdminNFLSpreads';
import { useToast } from './ui/Toast';
import { getUserMessage } from '../utils/errorMessages';

type SystemLog = {
    timestamp?: { toDate?: () => Date } | number | string;
    status?: string;
    type?: string;
    message?: string;
    details?: unknown;
};

type PoolLike = { [key: string]: unknown };

export const SuperAdmin: React.FC = () => {
    const navigate = useNavigate();
    const toast = useToast();
    // Mirror the SUPER_ADMIN Firestore role onto the auth token claim (which the
    // Firestore rules check) before any admin-only subscription runs. This page
    // only mounts for admins (App gate), so always ensure.
    const claimsReady = useEnsureAdminClaims(true);
    // --- STATE ---
    const [pools, setPools] = useState<Pool[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);

    // UI State
    // The eight canonical Super-Admin Dashboard tabs (CONTEXT.md). Each top tab
    // owns one or more sub-tabs (the legacy render blocks, reused unchanged).
    type NavGroup = 'Overview' | 'Pools' | 'Members' | 'Operations' | 'Test Suite' | 'Monetization' | 'Themes' | 'System';
    const [activeGroup, setActiveGroup] = useState<NavGroup>('Overview');
    const [activeTab, setActiveTab] = useState<'overview' | 'pools' | 'operations' | 'users' | 'referrals' | 'themes' | 'settings' | 'system' | 'props' | 'testing' | 'playoffs' | 'tournament' | 'stats' | 'nfl' | 'billing' | 'loyalty'>('overview');
    const [searchTerm, setSearchTerm] = useState('');
    const [roleChange, setRoleChange] = useState<{ user: User; role: string } | null>(null);
    const [emailSearch, setEmailSearch] = useState('');
    const [emailSearchResults, setEmailSearchResults] = useState<User[] | null>(null);
    const [emailSearching, setEmailSearching] = useState(false);
    const [settings, setSettings] = useState<SystemSettings | null>(null);
    const [showSimDashboard, setShowSimDashboard] = useState(false);
    const [sportFilter, setSportFilter] = useState<string>('ALL');
    const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'locked' | 'live' | 'final' | 'closed'>('all');
    const [priceFilter, setPriceFilter] = useState<'all' | 'low' | 'mid' | 'high'>('all');
    const [charityFilter, setCharityFilter] = useState(false);

    // Member (Users tab) client-side filters — the full user list is already
    // loaded, so name/email search + role/method filters run instantly with no
    // backend round-trip (server email search above is kept for scale).
    const [memberSearch, setMemberSearch] = useState('');
    const [memberRoleFilter, setMemberRoleFilter] = useState<string>('ALL');
    const [memberMethodFilter, setMemberMethodFilter] = useState<'ALL' | 'google' | 'email'>('ALL');
    const [memberSort, setMemberSort] = useState<'created_desc' | 'created_asc' | 'name'>('created_desc');

    // Log Filters
    const [logStatusFilter, setLogStatusFilter] = useState<string>('ALL');
    const [logTagFilter, setLogTagFilter] = useState<string>('ALL');
    const [logTimeFilter, setLogTimeFilter] = useState<string>('24H'); // Default to last 24h

    // Edit/View State
    const [viewingPool, setViewingPool] = useState<Pool | null>(null);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [viewingUser, setViewingUser] = useState<User | null>(null);
    const [editName, setEditName] = useState('');
    const [editEmail, setEditEmail] = useState('');

    // Theme Builder State
    const [themes, setThemes] = useState<PoolTheme[]>([]);
    const [editingTheme, setEditingTheme] = useState<PoolTheme | null>(null);
    const [showThemeBuilder, setShowThemeBuilder] = useState(false);

    // Prop Seeds State
    const [propSeeds, setPropSeeds] = useState<PropSeed[]>([]);
    const [editingSeed, setEditingSeed] = useState<PropSeed | null>(null);
    const [seedText, setSeedText] = useState('');
    const [seedOpt1, setSeedOpt1] = useState('');
    const [seedOpt2, setSeedOpt2] = useState('');

    // Playoff State
    const [playoffTeams, setPlayoffTeams] = useState<PlayoffTeam[]>([]);
    const [isSavingPlayoffs, setIsSavingPlayoffs] = useState(false);
    const [showResultsManager, setShowResultsManager] = useState(false);

    // NFL Importer State
    const [nflSeason, setNflSeason] = useState('2026');
    const [nflSeasonType, setNflSeasonType] = useState<number>(2);
    const [nflWeeks, setNflWeeks] = useState<string>('all');
    const [selectedNflWeek, setSelectedNflWeek] = useState<number>(1);
    const [isImportingNfl, setIsImportingNfl] = useState(false);
    const [nflImportResult, setNflImportResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // Admin Override States & Functions
    const [viewingPoolEntries, setViewingPoolEntries] = useState<any[]>([]);
    const [adminSearchEntry, setAdminSearchEntry] = useState('');
    const [adminPoolName, setAdminPoolName] = useState('');
    const [adminEntryFee, setAdminEntryFee] = useState(0);
    const [adminIsPublic, setAdminIsPublic] = useState(false);
    const [adminInstructions, setAdminInstructions] = useState('');
    const [modalTab, setModalTab] = useState<'overview' | 'settings' | 'participants' | 'dangerous'>('overview');
    
    // Participant Overrides input states
    const [entryScoreOverrides, setEntryScoreOverrides] = useState<Record<string, string>>({});
    const [entryTiebreakerOverrides, setEntryTiebreakerOverrides] = useState<Record<string, string>>({});
    const [entryPayoutOverrides, setEntryPayoutOverrides] = useState<Record<string, string>>({});
    const [expandedPicksEntryId, setExpandedPicksEntryId] = useState<string | null>(null);

    // Loyalty Tiers State
    const [selectedMarketingTier, setSelectedMarketingTier] = useState<string>('all');
    const [marketingSearch, setMarketingSearch] = useState<string>('');
    const [editingTiers, setEditingTiers] = useState<LoyaltyTier[]>([]);
    const [promoUser, setPromoUser] = useState<User | null>(null);
    const [promoBulkTier, setPromoBulkTier] = useState<string | null>(null);
    const [promoSubject, setPromoSubject] = useState<string>('');
    const [promoMessage, setPromoMessage] = useState<string>('');
    const [promoCoupon, setPromoCoupon] = useState<string>('');
    const [promoType, setPromoType] = useState<'coupon' | 'reminder'>('coupon');
    const [isSendingPromo, setIsSendingPromo] = useState<boolean>(false);

    const handleSavePoolSettingsAdmin = async () => {
        if (!viewingPool) return;
        try {
            const isMM = viewingPool.type === 'BRACKET';
            const poolRef = doc(db, 'pools', viewingPool.id);
            const updates: Record<string, any> = {};
            
            if (isMM) {
                updates.name = adminPoolName;
                updates['settings.entryFee'] = Number(adminEntryFee);
                updates.isListedPublic = adminIsPublic;
                updates['settings.paymentInstructions'] = adminInstructions;
            } else {
                updates.name = adminPoolName;
                updates.costPerSquare = Number(adminEntryFee);
                updates.isPublic = adminIsPublic;
                updates.paymentInstructions = adminInstructions;
            }
            
            await updateDoc(poolRef, updates);
            setViewingPool(prev => prev ? { ...prev, ...updates, name: adminPoolName } : null);
            toast.success('Pool settings saved successfully by Admin override!');
        } catch (err: unknown) {
            logger.error("Failed to save admin settings override", err);
            toast.error(getUserMessage(err, "Failed to save pool settings."));
        }
    };

    const handleToggleEntryPaidAdmin = async (entryId: string, currentStatus: string) => {
        if (!viewingPool) return;
        try {
            const newStatus = currentStatus === 'PAID' ? 'UNPAID' : 'PAID';
            // Server-side since Phase 5 — entries deny ALL client writes.
            await dbService.updateBracketEntryPayment(viewingPool.id, entryId, newStatus as 'PAID' | 'UNPAID');
            setViewingPoolEntries(prev => prev.map(entry => entry.id === entryId ? { ...entry, paidStatus: newStatus } : entry));
        } catch (err: unknown) {
            logger.error("Failed to toggle payment status", err);
            toast.error(getUserMessage(err, "Failed to toggle payment status."));
        }
    };

    const handleDeleteEntryAdmin = async (entryId: string, name: string) => {
        if (!viewingPool) return;
        const ok = await toast.confirm({
            title: `Delete ${name}'s entry from this pool?`,
            message: 'This will remove their picks permanently. This action cannot be undone!',
            danger: true,
        });
        if (!ok) return;
        try {
            if (viewingPool.type === 'BRACKET') {
                // Route through the server callable: it deletes the entry AND
                // decrements entryCount in ONE transaction and writes an audit
                // entry. The old client-side `entryCount = current - 1` math raced
                // the transactional FieldValue.increment(-1) and could corrupt the
                // count under concurrent joins/deletes.
                const delFn = httpsCallable(getFunctions(), 'deleteBracketEntry');
                await delFn({ poolId: viewingPool.id, entryId });
                setViewingPool(prev => prev ? { ...prev, entryCount: Math.max(0, ((prev as any).entryCount || 0) - 1) } as any : null);
            } else {
                // Server-side since Phase 5 (adminDeleteEntry, SUPER_ADMIN +
                // audited + transactional entryCount decrement) — entries deny
                // ALL client writes now.
                const delFn = httpsCallable(getFunctions(), 'adminDeleteEntry');
                await delFn({ poolId: viewingPool.id, entryId });
                setViewingPool(prev => prev ? { ...prev, entryCount: Math.max(0, ((prev as any).entryCount || 0) - 1) } as any : null);
            }
            setViewingPoolEntries(prev => prev.filter(entry => entry.id !== entryId));
            toast.success('Entry successfully deleted.');
        } catch (err: unknown) {
            logger.error("Failed to delete entry", err);
            toast.error(getUserMessage(err, "Error deleting entry."));
        }
    };

    const handleSaveEntryOverridesAdmin = async (entryId: string) => {
        if (!viewingPool) return;
        try {
            const scoreVal = Number(entryScoreOverrides[entryId] || 0);
            const tiebreakerVal = Number(entryTiebreakerOverrides[entryId] || 0);
            const payoutVal = Number(entryPayoutOverrides[entryId] || 0);

            const updates: Record<string, any> = {
                score: scoreVal,
                payout: payoutVal,
            };

            if (viewingPool.type === 'BRACKET') {
                updates.tiebreakerScore = tiebreakerVal;
            } else {
                updates.tiebreakerScore = tiebreakerVal;
                updates.tieBreakerPrediction = tiebreakerVal;
            }

            // Server-side since Phase 5 (adminUpdateEntryOverrides, SUPER_ADMIN +
            // allowlisted fields + audited) — entries deny ALL client writes now.
            const overridesFn = httpsCallable(getFunctions(), 'adminUpdateEntryOverrides');
            await overridesFn({ poolId: viewingPool.id, entryId, overrides: updates });
            setViewingPoolEntries(prev => prev.map(entry => entry.id === entryId ? { ...entry, ...updates } : entry));
            toast.success('Participant overrides successfully saved!');
        } catch (err: unknown) {
            logger.error("Failed to save entry overrides", err);
            toast.error(getUserMessage(err, "Failed to save entry overrides."));
        }
    };

    const fetchUsers = () => {
        dbService.getAllUsers()
            .then(setUsers)
            .catch(err => logger.error("Failed to load users", err));
    };

    // Loyalty Tiers Handlers & State Sync
    useEffect(() => {
        if (settings?.loyaltyTiers) {
            setEditingTiers(settings.loyaltyTiers);
        } else {
            setEditingTiers([
                { id: 'tier_contender', name: 'Contender', minPools: 0, description: 'Accrued based on lifetime pool entries' },
                { id: 'tier_vanguard', name: 'Vanguard Hall', minPools: 6, description: 'Accrued based on lifetime pool entries' }
            ]);
        }
    }, [settings?.loyaltyTiers]);

    const handleSaveTiers = async () => {
        try {
            await settingsService.update({ loyaltyTiers: editingTiers });
            toast.success('Loyalty tiers configuration updated successfully!');
        } catch (e: any) {
            toast.error(getUserMessage(e, 'Failed to save loyalty tiers.'));
        }
    };

    const handleAddTierLocal = () => {
        const newId = 'tier_' + Date.now();
        const newTier = { id: newId, name: 'New Tier', minPools: 1, description: 'Enter more pools to qualify' };
        setEditingTiers(prev => [...prev, newTier]);
    };

    const handleRemoveTierLocal = (id: string) => {
        setEditingTiers(prev => prev.filter((t: LoyaltyTier) => t.id !== id));
    };

    // Loyalty Tier Computations
    const userPoolCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        users.forEach((u: User) => {
            counts[u.id] = pools.filter(p => {
                const isParticipant = (p.participantIds || []).includes(u.id);
                const isOwner = p.ownerId === u.id || (p as any).managerUid === u.id;
                return isParticipant || isOwner;
            }).length;
        });
        return counts;
    }, [users, pools]);

    const activeTiers = useMemo<LoyaltyTier[]>(() => {
        return settings?.loyaltyTiers || [
            { id: 'tier_contender', name: 'Contender', minPools: 0, description: 'Accrued based on lifetime pool entries' },
            { id: 'tier_vanguard', name: 'Vanguard Hall', minPools: 6, description: 'Accrued based on lifetime pool entries' }
        ];
    }, [settings?.loyaltyTiers]);

    const userTiers = useMemo(() => {
        const sortedTiers = [...activeTiers].sort((a, b) => b.minPools - a.minPools);
        const mapping: Record<string, string> = {};
        const list: Record<string, User[]> = {};
        
        activeTiers.forEach((t: LoyaltyTier) => {
            list[t.id] = [];
        });
        list['none'] = [];

        users.forEach((u: User) => {
            const count = userPoolCounts[u.id] || 0;
            const matched = sortedTiers.find((t: LoyaltyTier) => count >= t.minPools);
            if (matched) {
                mapping[u.id] = matched.name;
                list[matched.id].push(u);
            } else {
                mapping[u.id] = 'None';
                list['none'].push(u);
            }
        });

        return { mapping, list };
    }, [activeTiers, users, userPoolCounts]);

    // The money half of the Overview now comes from the SERVER aggregate
    // (stats/global), not from a browser re-derivation. See liveStats below.
    const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);
    useEffect(() => dbService.onGlobalStatsUpdate(setGlobalStats), []);

    /**
     * The Overview cards (PLAN-STATS-INTEGRITY §8.3 step 3). Two separate defects
     * were fixed here; they are easy to conflate.
     *
     * 1. TEST POOLS WERE COUNTED. This aggregated EVERY loaded pool with no
     *    filter at all (§2.4), which is why Kevin's Overview read 138 pools and
     *    $38,991 of prize volume. `isTestPool` is the shared predicate — the same
     *    module the `stats/global` writers use, so the two cannot drift again.
     *    That drift IS the original bug: these cards never read `stats/global`,
     *    so a backend-only fix would have changed nothing on this screen.
     *
     * 2. THE MONEY WAS A HEAD COUNT. It computed `entryFee × (entryCount ||
     *    participantCount || participantIds.length)` — everyone who joined,
     *    whether or not they ever paid — and no client can fix that, because the
     *    paid state lives in per-pool Member Record subcollections this page does
     *    not load (§2.8, codex R3 finding (i)). So the money figures now come
     *    from `stats/global`, which PRs B and C taught to compute a real,
     *    paid-only, test-pool-free total server-side.
     *
     *    ⚠️ That document only becomes correct once PRs A–D are DEPLOYED and
     *    Kevin presses Recalculate Global Stats. Until then these cards show the
     *    OLD stored figure. That is the plan's step order (§8.6), not a bug — and
     *    it is strictly better than the alternative, which was a number that
     *    looked live and was structurally wrong.
     *
     * Counts stay client-side: they are derivable from what this page already has,
     * and `stats/global` carries no pool or user count.
     */
    const liveStats = useMemo(() => {
        // Test pools count toward nothing — including friends' preseason pools
        // (Kevin, 2026-07-25). Expect these cards to look quiet through the pilot.
        const realPools = pools.filter((pool: any) => !isTestPool(pool, pool.id));

        let totalSquaresSold = 0;
        let totalEntries = 0;

        realPools.forEach((pool: any) => {
            if (pool.type === 'SQUARES') {
                totalSquaresSold += pool.squares ? pool.squares.filter((s: any) => s.owner).length : 0;
            } else {
                // "Squares Sold" used to add THESE into the squares total, so the
                // card was summing squares and NFL/bracket/props ENTRIES into one
                // mislabelled number. They are different units; they get separate
                // counters now.
                totalEntries += pool.entryCount || pool.participantCount || (pool.participantIds ? pool.participantIds.length : 0);
            }
        });

        return {
            totalPools: realPools.length,
            // Sim runs create run-scoped uids (`sim-<runId>-alice`), so they are
            // identifiable and excluded for the same reason the pools are.
            totalUsers: users.filter((u: User) => !String(u.id || '').startsWith('sim-')).length,
            totalSquaresSold,
            totalEntries,
            totalRevenue: globalStats?.totalPrizes ?? 0,
            totalDonated: globalStats?.totalDonated ?? 0,
            lastUpdated: Date.now()
        };
    }, [pools, users, globalStats]);

    // --- EFFECTS ---
    useEffect(() => {
        const unsubPools = dbService.subscribeToAllPools(setPools);
        const unsubSettings = settingsService.subscribe(setSettings);
        fetchUsers();

        // Load System Logs if on system tab
        if (activeTab === 'system') {
            if (dbService.getSystemLogs) {
                dbService.getSystemLogs().then(setSystemLogs).catch(logger.error);
            }
        }

        return () => {
            unsubPools();
            unsubSettings();
        };
    }, [activeTab]);

    useEffect(() => {
        if (viewingPool) {
            setViewingPoolEntries([]);
            setAdminSearchEntry('');
            setAdminPoolName(viewingPool.name || '');
            setModalTab('overview');
            
            const isMM = viewingPool.type === 'BRACKET';
            const poolCost = isMM 
                ? ((viewingPool as any).settings?.entryFee || 0) 
                : ((viewingPool as any).costPerSquare || (viewingPool as any).settings?.entryFee || 0);
            const poolPublic = isMM
                ? (viewingPool as any).isListedPublic
                : ((viewingPool as any).isPublic ?? (viewingPool as any).isListedPublic ?? false);
            const poolInstructions = isMM
                ? ((viewingPool as any).settings?.paymentInstructions || '')
                : ((viewingPool as any).paymentInstructions || (viewingPool as any).settings?.paymentInstructions || '');

            setAdminEntryFee(poolCost);
            setAdminIsPublic(poolPublic);
            setAdminInstructions(poolInstructions);

            dbService.getBracketEntries(viewingPool.id)
                .then((entries) => {
                    setViewingPoolEntries(entries);
                    const scores: Record<string, string> = {};
                    const tiebreakers: Record<string, string> = {};
                    const payouts: Record<string, string> = {};
                    entries.forEach(e => {
                        const entryAny = e as any;
                        scores[entryAny.id] = String(entryAny.score ?? 0);
                        tiebreakers[entryAny.id] = String(entryAny.tiebreakerScore ?? entryAny.tieBreakerPrediction ?? 0);
                        payouts[entryAny.id] = String(entryAny.payout ?? 0);
                    });
                    setEntryScoreOverrides(scores);
                    setEntryTiebreakerOverrides(tiebreakers);
                    setEntryPayoutOverrides(payouts);
                })
                .catch(err => logger.error("Failed to load pool entries for admin override", err));
        }
    }, [viewingPool?.id]);

    // Theme & Seed Subscription
    useEffect(() => {
        const unsubThemes = dbService.subscribeToThemes(setThemes);
        const unsubSeeds = dbService.subscribeToPropSeeds(setPropSeeds);
        const unsubPlayoffs = dbService.subscribeToPlayoffConfig((config) => {
            if (config) setPlayoffTeams(config.teams);
        });
        return () => {
            unsubThemes();
            unsubSeeds();
            unsubPlayoffs();
        };
    }, []);



    // --- Categories State ---
    // --- Categories State ---
    const [seedCategories, setSeedCategories] = useState<string[]>(['Game']);
    const [seedCategoryFilter, setSeedCategoryFilter] = useState<string>('All');
    const [newCategoryName, setNewCategoryName] = useState('');

    const availableCategories = settings?.propCategories || ['Game', 'Player', 'Offense', 'Defense', 'Yards', 'TD', 'FG', 'Fun'];

    const toggleCategory = (cat: string) => {
        if (seedCategories.includes(cat)) {
            setSeedCategories(seedCategories.filter(c => c !== cat));
        } else {
            setSeedCategories([...seedCategories, cat]);
        }
    };

    const handleAddCategory = () => {
        if (!newCategoryName || !settings) return;
        const currentCats = settings.propCategories || [];
        if (currentCats.includes(newCategoryName)) return;

        settingsService.update({
            propCategories: [...currentCats, newCategoryName].sort()
        });
        setNewCategoryName('');
    };

    const handleRemoveCategory = async (cat: string) => {
        if (!settings) return;
        const ok = await toast.confirm({
            title: `Delete category "${cat}"?`,
            message: "This won't remove it from existing questions.",
            danger: true,
        });
        if (!ok) return;
        const currentCats = settings.propCategories || [];
        settingsService.update({
            propCategories: currentCats.filter(c => c !== cat)
        });
    };

    const handleSeedNCAAProps = async () => {
        const okSeed = await toast.confirm({
            title: 'Seed NCAA props?',
            message: 'Seed NCAA March Madness props into the library?',
        });
        if (!okSeed) return;

        const ncaaProps = [
            { text: "Who will win the National Championship?", options: ["Favorite", "Field"], categories: ["NCAA"] },
            { text: "Will a 1-seed win the tournament?", options: ["Yes", "No"], categories: ["NCAA", "Tournament"] },
            { text: "How many 1-seeds reach the Final Four?", options: ["Over 1.5", "Under 1.5"], categories: ["NCAA", "Final Four"] },
            { text: "Will there be a buzzer-beater in the Round of 64?", options: ["Yes", "No"], categories: ["NCAA", "Game"] },
            { text: "Will a 12-seed or lower reach the Sweet 16?", options: ["Yes", "No"], categories: ["NCAA", "Upset"] },
            { text: "Which conference will have more teams in the Final Four?", options: ["Big East/Big Ten/ACC", "SEC/Big 12/Other"], categories: ["NCAA", "Conference"] },
            { text: "Will the Championship game go to overtime?", options: ["Yes", "No"], categories: ["NCAA", "Finals"] },
            { text: "Total points in the Championship Game?", options: ["Over 145.5", "Under 145.5"], categories: ["NCAA", "Finals"] },
            { text: "Will any player score 40+ points in a single game?", options: ["Yes", "No"], categories: ["NCAA", "Player"] },
            { text: "Will the Most Outstanding Player be a guard or a forward/center?", options: ["Guard", "Forward/Center"], categories: ["NCAA", "Player"] }
        ];

        let added = 0;
        for (const p of ncaaProps) {
            const exists = propSeeds.some(s => s.text === p.text);
            if (!exists) {
                await dbService.savePropSeed({
                    text: p.text,
                    options: p.options,
                    categories: p.categories,
                    category: p.categories[0] // Legacy fallback
                });
                added++;
            }
        }

        if (settings) {
            const currentCats = settings.propCategories || [];
            const newCats = ['NCAA', 'Tournament', 'Final Four', 'Upset', 'Conference', 'Finals'];
            const combined = [...currentCats, ...newCats].filter((v, idx, arr) => arr.indexOf(v) === idx);
            if (combined.length !== currentCats.length) {
                settingsService.update({ propCategories: combined });
            }
        }

        toast.success(`Seeded ${added} NCAA props!`);
    };



    const handleSaveSeed = async () => {
        if (!seedText || !seedOpt1 || !seedOpt2) return;

        const seed: Partial<PropSeed> = {
            text: seedText,
            options: [seedOpt1, seedOpt2],
            category: seedCategories[0] || 'General',   // Legacy back-compat
            categories: seedCategories                 // New Array
        };

        if (editingSeed) {
            seed.id = editingSeed.id;
        }

        await dbService.savePropSeed(seed);
        setEditingSeed(null);
        setSeedText('');
        setSeedOpt1('');
        setSeedOpt2('');
        setSeedCategories(['Game']);
    };

    const handleEditSeed = (seed: PropSeed) => {
        setEditingSeed(seed);
        setSeedText(seed.text);
        setSeedOpt1(seed.options[0]);
        setSeedOpt2(seed.options[1]);
        setSeedCategories(seed.categories || (seed.category ? [seed.category] : ['Game']));
    };

    // --- PLAYOFF LOGIC ---
    const handleSavePlayoffs = async () => {
        setIsSavingPlayoffs(true);
        try {
            await dbService.savePlayoffConfig(playoffTeams);
            toast.success("Playoff configuration saved!");
        } catch (error) {
            logger.error(error);
            toast.error("Failed to save playoff config.");
        } finally {
            setIsSavingPlayoffs(false);
        }
    };

    const updatePlayoffTeam = (index: number, updates: Partial<PlayoffTeam>) => {
        const newTeams = [...playoffTeams];
        newTeams[index] = { ...newTeams[index], ...updates };
        setPlayoffTeams(newTeams);
    };

    const addPlayoffTeam = (conference: 'AFC' | 'NFC') => {
        if (playoffTeams.length >= 14) return;
        const newTeam: PlayoffTeam = {
            id: '',
            name: '',
            conference,
            seed: 1,
            eliminated: false
        };
        setPlayoffTeams([...playoffTeams, newTeam]);
    };

    const removePlayoffTeam = (index: number) => {
        const newTeams = [...playoffTeams];
        newTeams.splice(index, 1);
        setPlayoffTeams(newTeams);
    };

    const handleDeleteSeed = async (id: string) => {
        const ok = await toast.confirm({
            title: 'Delete this seed question?',
            message: 'This will remove the seed question from the library.',
            danger: true,
        });
        if (ok) {
            await dbService.deletePropSeed(id);
            dbService.logAdminAction({ action: 'DELETE_PROP_SEED', targetType: 'propSeed', targetId: id, status: 'success' });
        }
    };

    const handleDeletePool = async (id: string) => {
        const ok = await toast.confirm({
            title: 'Super Delete Pool?',
            message: 'This will permanently delete this pool.',
            danger: true,
        });
        if (ok) {
            await dbService.deletePool(id);
            dbService.logAdminAction({ action: 'DELETE_POOL', targetType: 'pool', targetId: id, status: 'success' });
        }
    };

    const handleClosePool = async (pool: Pool) => {
        const ok = await toast.confirm({
            title: `Close "${pool.name}"?`,
            message: 'This will mark the pool as COMPLETED, removing it from the "Live" section on participants\' My Entries page. This cannot be easily undone.',
            danger: true,
        });
        if (!ok) return;
        try {
            // T2: routes through the closePool callable — dual-writes the terminal
            // status + legacy fields + closedVia so triggers stay silent and the pool
            // leaves every open/live surface. Server writes its own admin_audit entry.
            await dbService.closePool(pool.id);
            toast.success(`"${pool.name}" has been closed and marked as Completed.`);
        } catch (e: unknown) {
            logger.error('Close pool error:', e);
            toast.error(getUserMessage(e, 'Error closing pool.'));
        }
    };

    // Big 12 re-init + Score Bracket Entries handlers removed — both are global
    // ops now living only in the Operations tab (initializeBig12TournamentHttp,
    // scoreBracketEntries), per the CONTEXT.md "one home" contract.

    // Export a CSV of all member + guest emails. Lives on the Members tab (it's a
    // membership/marketing export, not a System-log action). Guest PII comes from
    // the per-pool squarePrivate subcollection (audit H1).
    const handleExportEmails = async () => {
        const allEmails = new Map<string, string>(); // email -> name
        users.forEach(u => allEmails.set(u.email.toLowerCase(), u.name));

        const squarePools = pools.filter(p => (p as unknown as PoolLike).squares);
        const privLists = await Promise.all(
            squarePools.map(p => dbService.getSquarePrivateEmails(p.id).catch(() => []))
        );
        privLists.forEach(list => {
            list.forEach(({ email, name }) => {
                const e = email.toLowerCase();
                if (!allEmails.has(e)) allEmails.set(e, name || 'Guest');
            });
        });

        const headers = ['Name', 'Email'];
        const rows = Array.from(allEmails.entries()).map(([email, name]) => `"${name}", "${email}"`);
        const csvContent = [headers.join(','), ...rows].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `mmp_emails_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleForceReopenPool = async (pool: Pool) => {
        if (pool.type !== 'BRACKET') {
            toast.info('Force Re-Open only applies to bracket pools.');
            return;
        }
        const ok = await toast.confirm({
            title: `Re-open "${pool.name}"?`,
            message: 'This will set the status back to OPEN, allowing participants to edit and re-submit their brackets. You will need to manually close/lock it again when ready.',
        });
        if (!ok) return;
        try {
            await dbService.updateBracketPool(pool.id, { status: 'OPEN', lockedAt: null });
            toast.success(`✅ "${pool.name}" is now OPEN. Participants can edit and re-submit their brackets.`);
            setViewingPool(null);
        } catch (e: unknown) {
            logger.error('Force reopen error:', e);
            toast.error(getUserMessage(e, 'Error re-opening pool.'));
        }
    };


    const handleDeleteUser = async (user: User) => {
        const ok = await toast.confirm({
            title: `COMPLETELY DELETE user ${user.name}?`,
            message: 'This will remove their Login Account AND Database Profile. This action cannot be undone.',
            danger: true,
        });
        if (ok) {
            try {
                await dbService.deleteUserAccount(user.id);
                dbService.logAdminAction({ action: 'DELETE_USER_ACCOUNT', targetType: 'user', targetId: user.id, metadata: { email: user.email }, status: 'success' });
                // The cloud function removes both Auth + Firestore; just refresh.
                fetchUsers();
                toast.success(`User ${user.name} deleted successfully.`);
            } catch (e: unknown) {
                logger.error("Delete failed", e);
                dbService.logAdminAction({ action: 'DELETE_USER_ACCOUNT', targetType: 'user', targetId: user.id, status: 'error', error: getUserMessage(e, 'error') });
                toast.error(getUserMessage(e, "Error deleting user."));
            }
        }
    };

    const handleResetPassword = async (user: User) => {
        if (!user.email) return;
        const ok = await toast.confirm({
            title: 'Send Password Reset email?',
            message: `Send a Password Reset email to ${user.email}?`,
        });
        if (ok) {
            try {
                await dbService.sendAdminPasswordReset(user.email);
                toast.success(`Reset email sent to ${user.email}`);
            } catch (e: unknown) {
                logger.error("Reset failed", e);
                toast.error(getUserMessage(e, "Error sending reset email."));
            }
        }
    };

    const handleEditUser = (user: User) => {
        setEditingUser(user);
        setEditName(user.name);
        setEditEmail(user.email);
    };

    const handleViewUser = (user: User) => {
        setViewingUser(user);
    };

    // Server-side email search (step 6b) — indexed lookup, no full-list scan.
    const runEmailSearch = async () => {
        const p = emailSearch.trim();
        if (!p) { setEmailSearchResults(null); return; }
        setEmailSearching(true);
        try {
            const results = await dbService.searchUsersByEmail(p, 25);
            setEmailSearchResults(results);
        } catch (e) {
            toast.error(getUserMessage(e, 'User search failed.'));
        } finally {
            setEmailSearching(false);
        }
    };

    // One-time role backfill (T6) — dry-run first, then confirm to migrate live.
    const handleBackfillRoles = async () => {
        try {
            const dry = await dbService.backfillUserRoles(true);
            if (!dry.wouldMigrate) { toast.success('No legacy roles found — nothing to migrate.'); return; }
            const ok = await toast.confirm({
                title: 'Migrate legacy roles?',
                message: `${dry.wouldMigrate} user(s) still have legacy roles${dry.more ? ' (more beyond this batch)' : ''}. Rewrite them to canonical values (doc + auth claim)?`,
                danger: true,
            });
            if (!ok) return;
            const res = await dbService.backfillUserRoles(false);
            toast.success(`Migrated ${res.migrated} user(s).${res.more ? ' Run again for the rest.' : ''}`);
            fetchUsers();
        } catch (e) {
            toast.error(getUserMessage(e, 'Backfill failed.'));
        }
    };

    // Admin one-off email (step 6c) — server sends + logs to activity + audit.
    const handleEmailUser = async (user: User) => {
        if (!user.email) { toast.error('That user has no email on file.'); return; }
        const subject = window.prompt(`Email subject for ${user.email}:`)?.trim();
        if (!subject) return;
        const body = window.prompt('Message body:')?.trim();
        if (!body) return;
        try {
            await dbService.sendUserEmail(user.id, subject, body);
            toast.success(`Email queued to ${user.email}.`);
        } catch (e) {
            toast.error(getUserMessage(e, 'Failed to send email.'));
        }
    };

    // Role change (T6) — routed through the guardrail modal + setUserRole callable.
    const applyRoleChange = async () => {
        if (!roleChange) return;
        const { user: u, role } = roleChange;
        setRoleChange(null);
        try {
            await dbService.setUserRole(u.id, role);
            toast.success(`${u.email || u.id} is now ${role}.`);
        } catch (e) {
            toast.error(getUserMessage(e, 'Failed to change role.'));
        }
    };

    const saveUserChanges = async () => {
        if (!editingUser) return;
        try {
            await dbService.updateUser(editingUser.id, { name: editName, email: editEmail });
            setEditingUser(null);
            fetchUsers();
        } catch {
            toast.error('Failed to update user');
        }
    };



    // Pool Edit/View State

    const handleRunSim = async (pool: GameState) => {
        const confirmSim = await toast.confirm({
            title: `Run simulation for ${pool.name}?`,
            message: 'This will advance the game state.',
        });
        if (!confirmSim) return;
        try {
            // Imported statically
            const scores = {
                ...pool.scores,
                current: pool.scores.current || { home: 0, away: 0 }
            };

            // State Machine Logic
            // We construct the "Next" ESPN-like score object
            const nextState: Record<string, unknown> = { ...scores as Record<string, unknown> };
            let actionDescription = "";

            if (!pool.isLocked) {
                // Special case: Lock is a pool property, not score.
                // We can just update it locally or via existing updatePool
                await dbService.updatePool(pool.id, {
                    isLocked: true,
                    lockGrid: true,
                    'scores.gameStatus': 'pre',
                    'scores.startTime': new Date().toISOString()
                } as Record<string, unknown>);
                toast.info('Sim: Pool Locked. Open Sim again to start Game.');
                return;
            }

            if (scores.gameStatus === 'pre') {
                // Start Game -> Q1 0-0
                nextState.gameStatus = 'in';
                nextState.period = 1;
                nextState.clock = '15:00';
                nextState.current = { home: 0, away: 0 };
                actionDescription = "Start Game (Q1 0-0)";
            } else if (scores.gameStatus === 'in') {
                const p = scores.period || 1;
                const h = scores.current?.home || 0;
                const a = scores.current?.away || 0;

                if (p === 1) {
                    if (h === 0 && a === 0) {
                        nextState.current = { home: 7, away: 0 };
                        nextState.clock = '10:00';
                        actionDescription = "Score Change: Home 7, Away 0";
                    } else if (h === 7 && a === 0) {
                        nextState.current = { home: 7, away: 3 };
                        nextState.clock = '5:00';
                        actionDescription = "Score Change: Home 7, Away 3";
                    } else {
                        // End Q1
                        nextState.period = 2;
                        nextState.clock = '15:00';
                        nextState.q1 = { home: 7, away: 3 }; // Delta/Cumulative same for Q1
                        nextState.current = { home: 7, away: 3 };
                        actionDescription = "End Q1";
                    }
                } else if (p === 2) {
                    if (h === 7 && a === 3) {
                        nextState.current = { home: 14, away: 3 };
                        nextState.clock = '10:00';
                        actionDescription = "Score Change: Home 14, Away 3";
                    } else if (h === 14 && a === 3) {
                        nextState.current = { home: 14, away: 10 };
                        nextState.clock = '2:00';
                        actionDescription = "Score Change: Home 14, Away 10";
                    } else {
                        // End Half
                        nextState.period = 3;
                        nextState.clock = '15:00';
                        nextState.half = { home: 14, away: 10 };
                        nextState.current = { home: 14, away: 10 };
                        actionDescription = "End Halftime";
                    }
                } else if (p === 3) {
                    if (h === 14) {
                        nextState.current = { home: 21, away: 10 };
                        nextState.clock = '8:00';
                        actionDescription = "Score Change: Home 21, Away 10";
                    } else if (a === 10) {
                        nextState.current = { home: 21, away: 17 };
                        nextState.clock = '4:00';
                        actionDescription = "Score Change: Home 21, Away 17";
                    } else {
                        // End Q3
                        nextState.period = 4;
                        nextState.clock = '15:00';
                        nextState.q3 = { home: 21, away: 17 };
                        nextState.current = { home: 21, away: 17 };
                        actionDescription = "End Q3";
                    }
                } else if (p === 4) {
                    if (h === 21) {
                        nextState.current = { home: 24, away: 17 };
                        nextState.clock = '5:00';
                        actionDescription = "Score Change: Home 24, Away 17";
                    } else if (a === 17) {
                        nextState.current = { home: 24, away: 20 };
                        nextState.clock = '1:00';
                        actionDescription = "Score Change: Home 24, Away 20";
                    } else {
                        // Final
                        nextState.gameStatus = 'post';
                        nextState.clock = '0:00';
                        nextState.final = { home: 24, away: 20 };
                        nextState.apiTotal = { home: 24, away: 20 }; // For ESPN compat
                        nextState.current = { home: 24, away: 20 };
                        actionDescription = "Game Final";
                    }
                }
            } else if (scores.gameStatus === 'post') {
                // Reset
                const okReset = await toast.confirm({
                    title: 'Reset Pool to Pre-Game?',
                    message: 'This will reset all scores and unlock the pool.',
                    danger: true,
                });
                if (okReset) {
                    await dbService.updatePool(pool.id, {
                        isLocked: false,
                        lockGrid: false,
                        scores: { current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre' },
                        axisNumbers: null,
                        quarterlyNumbers: null
                    } as Record<string, unknown>);
                    toast.success('Pool Reset');
                    return;
                }
                return;
            }

            if (actionDescription) {
                // Call Cloud Function
                await simulatePoolGame(pool.id, nextState);
                toast.success(`Simulated: ${actionDescription} `);
            }

        } catch (e: unknown) {
            logger.error(e);
            toast.error(getUserMessage(e, 'Sim Failed.'));
        }
    };

    // Fix Scores Handler
    const handleFixScores = async (pool: GameState) => {
        const confirmFix = await toast.confirm({
            title: `Reprocess scores for "${pool.name}"?`,
            message: 'This will fetch the latest scores from ESPN, backfill missing history, and recalculate payouts.',
        });
        if (!confirmFix) return;

        try {
            await dbService.fixPoolScores(pool.id);
            toast.success('Score fix initiated successfully. Check system logs for details.');
            // Refresh logs if on system tab
            if (activeTab === 'system') {
                dbService.getSystemLogs().then(setSystemLogs).catch(logger.error);
            }
        } catch (error: unknown) {
            logger.error('Fix Score Error:', error);
            toast.error(getUserMessage(error, 'Failed to fix scores.'));
        }
    };

    // Tab state

    // Big East init + Fix Participant IDs handlers removed — these global ops
    // now live only in the Operations tab (initializeBigEastTournamentHttp,
    // fixParticipantIds), per the CONTEXT.md "one home" contract.

    const handleImportNFLSchedule = async () => {
        setIsImportingNfl(true);
        setNflImportResult(null);

        const weeksParam = nflWeeks === 'all'
            ? Array.from({ length: 18 }, (_, i) => i + 1)
            : [selectedNflWeek];

        try {
            const res = await dbService.importNFLSchedule({
                season: nflSeason,
                seasonType: nflSeasonType,
                weeks: weeksParam
            });
            setNflImportResult({
                type: 'success',
                message: `Successfully imported ${res.importedCount} NFL games for the ${nflSeason} season!`
            });
        } catch (err: any) {
            logger.error('Failed to import NFL schedule:', err);
            setNflImportResult({
                type: 'error',
                message: err.message || 'Bulk schedule import failed. Please verify API configurations.'
            });
        } finally {
            setIsImportingNfl(false);
        }
    };

    const filteredPools = pools.filter(p => {
        const isBracket = p.type === 'BRACKET';

        // Sport filter — single source of truth shared with the grouping below.
        if (sportFilter !== 'ALL' && getPoolSport(p) !== sportFilter) return false;

        // Status filter — per-type lifecycle state (SQUARES via gameStatus,
        // string-status types via `status`).
        if (statusFilter !== 'all') {
            const state = getPoolLifecycleState(p);
            if (statusFilter === 'open' && state !== 'open') return false;
            if (statusFilter === 'locked' && state !== 'locked') return false;
            if (statusFilter === 'live' && state !== 'live') return false;
            if (statusFilter === 'final' && state !== 'final') return false;
            if (statusFilter === 'closed' && state !== 'closed') return false;
        }

        // Price filter
        if (priceFilter !== 'all') {
            const bpForCost = p as unknown as PoolLike;
            const cost = isBracket ? ((bpForCost.settings as PoolLike)?.entryFee as number || 0) : (p as GameState).costPerSquare || 0;
            if (priceFilter === 'low' && cost >= 20) return false;
            if (priceFilter === 'mid' && (cost < 20 || cost > 50)) return false;
            if (priceFilter === 'high' && cost <= 50) return false;
        }

        // Charity filter
        if (charityFilter) {
            if (isBracket || !(p as GameState).charity?.enabled) return false;
        }

        // Search term
        if (!searchTerm) return true;
        const lowSearch = searchTerm.toLowerCase();
        return p.name.toLowerCase().includes(lowSearch) ||
            p.id.toLowerCase().includes(lowSearch) ||
            ((p as unknown as PoolLike).ownerId as string || '').toLowerCase().includes(lowSearch);
    });

    // Members (Users tab) — client-side name/email search + role/method filter + sort.
    const visibleMembers = users
        .filter(u => {
            if (memberRoleFilter !== 'ALL' && normalizeRole(u.role) !== memberRoleFilter) return false;
            if (memberMethodFilter === 'google' && u.registrationMethod !== 'google') return false;
            if (memberMethodFilter === 'email' && u.registrationMethod === 'google') return false;
            if (memberSearch.trim()) {
                const q = memberSearch.trim().toLowerCase();
                const hay = `${u.name || ''} ${u.email || ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        })
        .sort((a, b) => {
            if (memberSort === 'name') return (a.name || '').localeCompare(b.name || '');
            const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return memberSort === 'created_asc' ? at - bt : bt - at;
        });

    const poolsBySport = filteredPools.reduce((acc, pool) => {
        const sport = getPoolSport(pool);
        if (!acc[sport]) acc[sport] = [];
        acc[sport].push(pool);
        return acc;
    }, {} as Record<string, Pool[]>);

    // Helper: Compute referrals locally
    const getComputedReferrals = (userId: string) => {
        return users.filter(u => u.referredBy === userId).length;
    };

    // Filtered Logs Logic (Restored)
    const filteredLogs = systemLogs.filter(log => {
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            const text = ((log.message || '') + (JSON.stringify(log.details) || '')).toLowerCase();
            if (!text.includes(term)) return false;
        }
        if (logStatusFilter !== 'ALL' && log.status !== logStatusFilter) return false;
        if (logTagFilter !== 'ALL' && log.type !== logTagFilter) return false;
        if (logTimeFilter !== 'ALL') {
            const ts = log.timestamp;
            const time = ts && typeof ts === 'object' && 'toDate' in ts && typeof ts.toDate === 'function'
                ? ts.toDate().getTime()
                : new Date(ts as string | number).getTime();
            const now = Date.now();
            const hours = (now - time) / (1000 * 60 * 60);
            if (logTimeFilter === '1H' && hours > 1) return false;
            if (logTimeFilter === '24H' && hours > 24) return false;
            if (logTimeFilter === '7D' && hours > 24 * 7) return false;
        }
        return true;
    });

    // --- NAVIGATION STRUCTURE (8 canonical tabs; sub-tabs reuse legacy render blocks) ---
    const navStructure: Record<NavGroup, { id: string; label: string; icon: React.ReactNode }[]> = {
        'Overview': [
            { id: 'overview', label: 'Dashboard', icon: <Activity size={16} /> },
            { id: 'stats', label: 'Stats', icon: <Activity size={16} /> },
        ],
        'Pools': [
            { id: 'pools', label: `All Pools(${filteredPools.length})`, icon: <Shield size={16} /> },
            { id: 'tournament', label: 'Tournament', icon: <Trophy size={16} /> },
            { id: 'playoffs', label: 'Playoffs', icon: <Trophy size={16} /> },
            { id: 'props', label: 'Global Props', icon: <List size={16} /> },
            { id: 'nfl', label: 'NFL Schedule', icon: <Shield size={16} /> },
        ],
        'Members': [
            { id: 'users', label: `Users(${users.length})`, icon: <Users size={16} /> },
            { id: 'referrals', label: 'Referrals', icon: <Users size={16} /> },
            { id: 'loyalty', label: 'Loyalty Tiers', icon: <Shield size={16} /> },
        ],
        'Operations': [
            { id: 'operations', label: 'Operations', icon: <Settings size={16} /> },
        ],
        'Test Suite': [
            { id: 'testing', label: 'Test Suite', icon: <Bot size={16} /> },
        ],
        'Monetization': [
            { id: 'billing', label: 'Monetization', icon: <Shield size={16} /> },
        ],
        'Themes': [
            { id: 'themes', label: `Themes(${themes.length})`, icon: <Palette size={16} /> },
        ],
        'System': [
            { id: 'system', label: 'System Status', icon: <Activity size={16} /> },
            { id: 'settings', label: 'Settings', icon: <Settings size={16} /> },
        ],
    };

    if (!claimsReady) {
        return (
            <div className="w-[80%] mx-auto py-24 flex flex-col items-center justify-center text-muted font-body">
                <RefreshCw size={24} className="animate-spin mb-3 text-gold-500" />
                <p className="text-sm font-display font-bold uppercase tracking-[0.08em]">Syncing admin session…</p>
            </div>
        );
    }

    return (
        <div className="w-[80%] mx-auto py-4 md:py-6 relative font-body text-[color:var(--text)]">
            {/* T2: the admin tab, for the Help panel. K13 leaves these tabs
                UNLINKED — an admin can click the tab — so the tab stays in
                memory and is published rather than moved into the URL. The tab
                summaries themselves are T14. */}
            <HelpRoutePublisher tab={activeTab} audience="admin" />
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-display font-extrabold uppercase leading-none flex items-center gap-3">
                    <Shield className="text-gold-500" /> Super Admin Dashboard
                </h1>
                {/* Tournament Simulator lives in the Test Suite tab now (CONTEXT.md:
                    Test Suite is the sole home for testing/simulation tools). Removed
                    the global-header button that showed on every tab. */}
            </div>

            {/* TWO-LEVEL NAVIGATION */}
            <div className="mb-8 space-y-4">
                {/* Level 1: Groups */}
                <div className="flex flex-wrap gap-2 p-1 bg-surface rounded-xl border border-line backdrop-blur-sm w-fit">
                    {(Object.keys(navStructure) as NavGroup[]).map(group => (
                        <button
                            key={group}
                            onClick={() => {
                                setActiveGroup(group);
                                // Auto-select first tab in group
                                setActiveTab(navStructure[group][0].id as typeof activeTab);
                            }}
                            className={`px-4 py-2 rounded-lg text-sm font-display font-bold uppercase tracking-[0.05em] transition-all ${activeGroup === group
                                ? 'bg-navy-800 text-white shadow-card'
                                : 'text-muted hover:text-[color:var(--text)] hover:bg-card'
                                }`}
                        >
                            {group}
                        </button>
                    ))}
                </div>

                {/* Level 2: Sub-tabs (only when the active tab has more than one section) */}
                {navStructure[activeGroup].length > 1 && (
                <div className="flex flex-wrap gap-2 border-b border-line pb-1">
                    {navStructure[activeGroup].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as typeof activeTab)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg font-display font-bold uppercase tracking-[0.05em] text-sm transition-colors border-b-2 ${activeTab === tab.id
                                ? 'border-gold-500 text-gold-600 dark:text-gold-400 bg-gold-500/10'
                                : 'border-transparent text-muted hover:text-[color:var(--text)] hover:bg-surface'
                                }`}
                        >
                            {tab.icon} {tab.label}
                        </button>
                    ))}
                </div>
                )}
            </div>

            {/* Per-tab error boundary: a crash in one panel shows a scoped fallback
                instead of white-screening the whole app; switching tabs (resetKey)
                clears it. */}
            <ErrorBoundary
                resetKey={activeTab}
                fallback={
                    <div className="bg-card p-8 rounded-xl border border-brandred-600/30 text-center">
                        <h3 className="text-lg font-display font-bold uppercase text-brandred-500 mb-2">This panel hit an error</h3>
                        <p className="text-sm text-muted font-body mb-4">The rest of the dashboard is fine — switch tabs and come back, or reload.</p>
                        <button onClick={() => window.location.reload()} className="px-4 py-2 bg-navy-800 hover:bg-navy-700 text-white rounded-lg text-sm font-display font-bold uppercase tracking-[0.05em]">Reload</button>
                    </div>
                }
            >

            {/* ============ OVERVIEW TAB ============ */}
            {activeTab === 'overview' && (
                <div className="w-full">
                    <SuperAdminBentoDashboard stats={liveStats} />
                </div>
            )}

            {/* ============ OPERATIONS TAB (T7) ============ */}
            {activeTab === 'operations' && <OperationsPanel />}

            {/* Role-change guardrail (T6): typed-confirm for SUPER_ADMIN / BANNED grants. */}
            <ConfirmActionModal
                open={!!roleChange}
                title="Change user role"
                description={roleChange ? `Set ${roleChange.user.email || roleChange.user.id} from ${normalizeRole(roleChange.user.role)} to ${roleChange.role}.` : ''}
                blastRadius={roleChange && (roleChange.role === 'SUPER_ADMIN' || roleChange.role === 'BANNED') ? `${roleChange.role} is a high-impact role — confirm carefully.` : undefined}
                confirmToken={roleChange && (roleChange.role === 'SUPER_ADMIN' || roleChange.role === 'BANNED') ? (roleChange.user.email || roleChange.user.id) : undefined}
                destructive={roleChange?.role === 'SUPER_ADMIN' || roleChange?.role === 'BANNED'}
                confirmLabel="Change role"
                onConfirm={applyRoleChange}
                onCancel={() => setRoleChange(null)}
            />

            {/* ============ TOURNAMENT TAB ============ */}
            {activeTab === 'tournament' && (
                <div className="space-y-6">
                    {/* Big 12 re-init + Score Bracket Entries moved to the Operations tab
                        (initializeBig12TournamentHttp, scoreBracketEntries) — one home per
                        capability. Per-tournament management stays here in TournamentManager. */}
                    <TournamentManager />
                </div>
            )}


            {/* ============ STATS TAB ============ */}
            {activeTab === 'stats' && (
                <div className="w-full">
                    <AdminStatsDashboard pools={pools} users={users} />
                </div>
            )}

            {/* ============ POOLS TAB ============ */}
            {
                activeTab === 'pools' && (
                    <div className="space-y-8">
                        {/* SEARCH BAR */}
                        <div className="flex gap-4">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={20} />
                                <input
                                    type="text"
                                    placeholder="Search pools by name, ID, or owner..."
                                    className="w-full bg-surface border border-line rounded-xl py-3 pl-10 pr-4 font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600"
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* SPORT FILTERS */}
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                            <button
                                onClick={() => setSportFilter('ALL')}
                                className={`px-4 py-2 rounded-full text-xs font-display font-bold uppercase tracking-[0.08em] whitespace-nowrap transition-colors ${sportFilter === 'ALL' ? 'bg-navy-800 text-white' : 'bg-surface text-muted hover:bg-card border border-line'} `}
                            >
                                ALL SPORTS
                            </button>
                            {Object.keys(poolsBySport).sort().map(sport => (
                                <button
                                    key={sport}
                                    onClick={() => setSportFilter(sport)}
                                    className={`px-4 py-2 rounded-full text-xs font-display font-bold uppercase tracking-[0.08em] whitespace-nowrap transition-colors ${sportFilter === sport ? 'bg-navy-800 text-white' : 'bg-surface text-muted hover:bg-card border border-line'} `}
                                >
                                    {sport.toUpperCase()}
                                </button>
                            ))}
                        </div>

                        {/* STATUS, PRICE & CHARITY FILTERS */}
                        <div className="flex flex-wrap gap-4 items-center bg-card p-4 rounded-xl border border-line">
                            {/* Status Filter */}
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-display font-bold text-muted uppercase tracking-[0.08em]">Status:</span>
                                {[
                                    { id: 'all', label: 'All' },
                                    { id: 'open', label: 'Open' },
                                    { id: 'locked', label: 'Locked' },
                                    { id: 'live', label: 'Live' },
                                    { id: 'final', label: 'Final' },
                                    { id: 'closed', label: 'Closed' }
                                ].map(status => (
                                    <button
                                        key={status.id}
                                        onClick={() => setStatusFilter(status.id as 'all' | 'open' | 'locked' | 'live' | 'final' | 'closed')}
                                        className={`px-3 py-1 rounded text-xs font-display font-bold uppercase tracking-[0.05em] transition-colors ${statusFilter === status.id
                                            ? status.id === 'live' ? 'bg-brandred-600 text-white' : 'bg-navy-800 text-white'
                                            : 'bg-surface text-muted hover:bg-card border border-line'
                                            } `}
                                    >
                                        {status.label}
                                    </button>
                                ))}
                            </div>

                            {/* Price Filter */}
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-display font-bold text-muted uppercase tracking-[0.08em]">Price:</span>
                                {[
                                    { id: 'all', label: 'Any' },
                                    { id: 'low', label: '< $20' },
                                    { id: 'mid', label: '$20-$50' },
                                    { id: 'high', label: '$50+' }
                                ].map(price => (
                                    <button
                                        key={price.id}
                                        onClick={() => setPriceFilter(price.id as 'all' | 'low' | 'mid' | 'high')}
                                        className={`px-3 py-1 rounded text-xs font-display font-bold uppercase tracking-[0.05em] num transition-colors ${priceFilter === price.id
                                            ? 'bg-navy-800 text-white'
                                            : 'bg-surface text-muted hover:bg-card border border-line'
                                            } `}
                                    >
                                        {price.label}
                                    </button>
                                ))}
                            </div>

                            {/* Charity Filter */}
                            <label className="flex items-center gap-2 cursor-pointer">
                                <span className="text-xs font-display font-bold text-muted uppercase tracking-[0.08em]">Charity Only:</span>
                                <button
                                    onClick={() => setCharityFilter(!charityFilter)}
                                    className={`w-10 h-5 rounded-full relative transition-colors ${charityFilter ? 'bg-brandred-600' : 'bg-line'} `}
                                >
                                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${charityFilter ? 'left-6' : 'left-1'} `} />
                                </button>
                            </label>
                        </div>


                        {(Object.entries(poolsBySport) as [string, Pool[]][])
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([sport, sportPools]) => (
                                <div key={sport} className="bg-card rounded-xl border border-line overflow-hidden shadow-card">
                                    <div className="p-4 border-b border-line bg-surface flex justify-between items-center">
                                        <h2 className="text-xl font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2">
                                            <Trophy size={18} className="text-gold-500" /> {sport}
                                            <span className="text-sm font-body font-normal normal-case tracking-normal text-muted num">({sportPools.length} pools)</span>
                                        </h2>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left">
                                            <thead className="font-display font-bold text-xs text-muted uppercase tracking-[0.08em] bg-surface">
                                                <tr>
                                                    <th className="p-4 font-bold tracking-wider">Pool Name</th>
                                                    <th className="p-4 font-bold tracking-wider">Created</th>
                                                    <th className="p-4 font-bold tracking-wider">Type / Matchup</th>
                                                    <th className="p-4 font-bold tracking-wider">Starts / Locks</th>
                                                    <th className="p-4 font-bold tracking-wider">Owner</th>
                                                    <th className="p-4 font-bold tracking-wider">Entries</th>
                                                    <th className="p-4 font-bold tracking-wider">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-line">
                                                {[...sportPools].sort((a, b) => {
                                                    const timeA = typeof a.createdAt === 'number' ? a.createdAt : a.createdAt?.seconds || 0;
                                                    const timeB = typeof b.createdAt === 'number' ? b.createdAt : b.createdAt?.seconds || 0;
                                                    return timeB - timeA;
                                                }).map(pool => {
                                                    const isBracket = pool.type === 'BRACKET';
                                                    // Normalize data access
                                                    const createdAt = typeof pool.createdAt === 'number' ? new Date(pool.createdAt).toLocaleDateString() : (pool.createdAt?.seconds ? new Date(pool.createdAt.seconds * 1000).toLocaleDateString() : 'N/A');
                                                    const matchUp = formatPoolMatchup(pool as unknown as { type?: string; awayTeam?: string; homeTeam?: string });
                                                    const poolLike = pool as unknown as PoolLike;
                                                    const ownerId = isBracket ? poolLike.managerUid as string : poolLike.ownerId as string;
                                                    const contact = users.find(u => u.id === ownerId)?.email || (isBracket ? 'N/A' : (pool as GameState).contactEmail);

                                                    const entrySummary = getPoolEntrySummary(pool as unknown as EntryCountable);
                                                    const filledPct = entrySummary.capacity
                                                        ? Math.min(100, Math.round((entrySummary.count / entrySummary.capacity) * 100))
                                                        : null;
                                                    const filledDisplay = formatEntryCount(entrySummary);
                                                    const lockState = getPoolLockTimeState(pool as unknown as LockTimeReadable);
                                                    const lock = lockState.kind === 'at'
                                                        ? { text: new Date(lockState.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), title: undefined }
                                                        : lockState.kind === 'per-week'
                                                            ? { text: 'n/a', title: 'Season-long pool — picks lock per game and per week, not pool-wide' }
                                                            : { text: 'not set', title: 'No lock or start time is configured on this pool' };

                                                    return (
                                                        <tr key={pool.id} className="hover:bg-surface transition-colors">
                                                            <td className="p-4">
                                                                <button
                                                                    onClick={() => setViewingPool(pool as GameState)} // Type assertion or update setViewingPool type
                                                                    className="font-bold text-[color:var(--text)] hover:text-gold-600 dark:hover:text-gold-400 hover:underline flex items-center gap-2 text-left"
                                                                >
                                                                    {pool.name}
                                                                    {!isBracket && (pool as GameState).charity?.enabled && (
                                                                        <div title="Charity Pool">
                                                                            <Heart size={12} className="text-brandred-500 fill-brandred-500" />
                                                                        </div>
                                                                    )}
                                                                </button>
                                                                <div className="text-[10px] text-faint font-mono mt-0.5">{pool.id}</div>
                                                                {(() => {
                                                                    const lc = getPoolLifecycleState(pool);
                                                                    const styles: Record<string, string> = {
                                                                        open: 'bg-gold-500/15 text-gold-600 dark:text-gold-400',
                                                                        locked: 'bg-navy-700/40 text-[color:var(--text)]',
                                                                        live: 'bg-brandred-600 text-white',
                                                                        final: 'bg-surface text-muted border border-line',
                                                                        closed: 'bg-[#3B4A66]/30 text-[#9FB0CC] border border-[#3B4A66]/50',
                                                                    };
                                                                    return (
                                                                        <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[9px] font-display font-bold uppercase tracking-[0.08em] ${styles[lc]}`}>
                                                                            {lc}
                                                                        </span>
                                                                    );
                                                                })()}
                                                            </td>
                                                            <td className="p-4 text-muted font-body text-sm num">
                                                                {createdAt}
                                                            </td>
                                                            <td className="p-4 font-bold font-body text-sm">{matchUp}</td>
                                                            <td className="p-4 text-xs text-muted font-mono num" title={lock.title}>
                                                                {lock.text}
                                                            </td>
                                                            <td className="p-4 text-muted font-body text-sm max-w-[150px] truncate" title={contact}>{contact}</td>
                                                            <td className="p-4">
                                                                <div className="flex items-center gap-2">
                                                                    {filledPct !== null && (
                                                                        <div className="w-16 h-2 bg-line rounded-full overflow-hidden">
                                                                            <div className="h-full bg-gold-foil rounded-full" style={{ width: `${filledPct}%` }}></div>
                                                                        </div>
                                                                    )}
                                                                    <span className="text-xs text-muted num">{filledDisplay}</span>
                                                                </div>
                                                            </td>
                                                            <td className="p-4 flex gap-2 flex-wrap">
                                                                <button onClick={() => navigate(`/admin/${pool.id}`)} className="text-navy-700 dark:text-gold-400 hover:bg-navy-600/10 text-xs font-display font-bold uppercase tracking-[0.05em] border border-navy-600/40 px-2 py-1 rounded transition-colors">Manage</button>
                                                                {/* Sim and Fix drive `pool.scores` / fixPoolScores, which only SQUARES
                                                                    pools have. They used to render for every non-BRACKET row, so on an
                                                                    NFL or PROPS pool Sim threw on `pool.scores.current` and Fix ran the
                                                                    wrong scorer (NFL scores through scoreNFLWeek). */}
                                                                {isSquaresPoolType(pool.type) && (
                                                                    <button onClick={() => handleRunSim(pool as GameState)} className="text-gold-700 dark:text-gold-400 hover:bg-gold-500/10 text-xs font-display font-bold uppercase tracking-[0.05em] border border-gold-500/40 px-2 py-1 rounded transition-colors">Sim</button>
                                                                )}
                                                                {isSquaresPoolType(pool.type) && (
                                                                    <button onClick={() => handleFixScores(pool as GameState)} className="text-gold-700 dark:text-gold-400 hover:bg-gold-500/10 text-xs font-display font-bold uppercase tracking-[0.05em] border border-gold-500/40 px-2 py-1 rounded flex items-center gap-1 transition-colors">
                                                                        <Settings size={12} /> Fix
                                                                    </button>
                                                                )}
                                                                {/* Close/Lock Button. Hidden for NFL season pools: lockPool sets
                                                                    `isLocked` on them but no NFL path reads it (joins and picks gate on
                                                                    per-game/per-week GAME_LOCKED/WEEK_LOCKED), so the only effect was an
                                                                    admin LOCKED badge on a pool the server still accepts entries for. */}
                                                                {!isNFLSeasonPoolType(pool.type) && !(pool as unknown as PoolLike).isLocked && !((pool as unknown as PoolLike).lockAt && (pool as unknown as PoolLike).status === 'LOCKED') && (
                                                                    <button
                                                                        onClick={async (e) => {
                                                                            e.stopPropagation();
                                                                            const ok = await toast.confirm({
                                                                                title: `LOCK "${pool.name}"?`,
                                                                                message: 'This will prevent further entries.',
                                                                                danger: true,
                                                                            });
                                                                            if (!ok) return;
                                                                            try {
                                                                                await dbService.lockPool(pool.id);
                                                                                toast.success("Pool Locked");
                                                                                // Ideally refresh pools
                                                                            } catch (e: unknown) { toast.error(getUserMessage(e, "Failed to lock pool.")); }
                                                                        }}
                                                                        className="text-brandred-500 hover:bg-brandred-600/10 text-xs font-display font-bold uppercase tracking-[0.05em] border border-brandred-600/40 px-2 py-1 rounded flex items-center gap-1 transition-colors"
                                                                        title="Lock Pool"
                                                                    >
                                                                        <Lock size={12} /> Lock
                                                                    </button>
                                                                )}
                                                                {/* Close Pool Button — any bracket pool not already COMPLETED */}
                                                                {isBracket && (pool as unknown as PoolLike).status !== 'COMPLETED' && (
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleClosePool(pool); }}
                                                                        className="text-brandred-500 hover:bg-brandred-600/10 text-xs font-display font-bold uppercase tracking-[0.05em] border border-brandred-600/40 px-2 py-1 rounded flex items-center gap-1 transition-colors"
                                                                        title="Close Pool (mark as Completed)"
                                                                    >
                                                                        <CheckCircle size={12} /> Close Pool
                                                                    </button>
                                                                )}
                                                                <button onClick={() => handleDeletePool(pool.id)} className="text-brandred-500 hover:text-brandred-600 transition-colors"><Trash2 size={16} /></button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                            {/* Close for loop and tbody */}
                                        </table>
                                    </div>
                                </div>
                            ))}
                    </div>
                )
            }

            {/* ============ USERS TAB ============ */}
            {
                activeTab === 'users' && (
                    <div className="bg-card rounded-xl border border-line overflow-hidden shadow-card w-full">
                        {/* Server-side email search (step 6b) — finds any user by email prefix without scanning the full list. */}
                        <div className="p-4 border-b border-line bg-surface w-full">
                            <div className="flex flex-wrap gap-2 items-center">
                                <input
                                    value={emailSearch}
                                    onChange={(e) => setEmailSearch(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') runEmailSearch(); }}
                                    placeholder="Find any user by name or email…"
                                    className="flex-1 min-w-[200px] bg-card border border-line rounded-lg px-3 py-2 text-sm text-[color:var(--text)] focus:outline-none focus:border-gold-500"
                                />
                                <button
                                    onClick={runEmailSearch}
                                    disabled={emailSearching}
                                    className="text-xs bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-navy-900 px-4 py-2 rounded-lg transition-colors font-display font-bold uppercase tracking-[0.05em]"
                                >
                                    {emailSearching ? 'Searching…' : 'Search'}
                                </button>
                                {emailSearchResults !== null && (
                                    <button
                                        onClick={() => { setEmailSearch(''); setEmailSearchResults(null); }}
                                        className="text-xs bg-surface hover:bg-card border border-line text-muted px-3 py-2 rounded-lg transition-colors font-display font-bold uppercase tracking-[0.05em]"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                            {emailSearchResults !== null && (
                                <div className="mt-3 space-y-1">
                                    {emailSearchResults.length === 0 ? (
                                        <p className="text-xs text-muted font-body">No users match “{emailSearch.trim()}”.</p>
                                    ) : emailSearchResults.map(u => (
                                        <button
                                            key={u.id}
                                            onClick={() => handleViewUser(u)}
                                            className="w-full flex items-center justify-between gap-3 bg-card border border-line rounded-lg px-3 py-2 hover:border-gold-500/40 transition-colors text-left"
                                        >
                                            <span className="text-sm font-display font-bold text-[color:var(--text)] truncate">{u.name || 'Anonymous'}</span>
                                            <span className="text-xs text-muted font-body truncate">{u.email}</span>
                                            <span className={`shrink-0 text-[10px] uppercase font-display font-bold tracking-[0.08em] px-2 py-1 rounded border ${roleBadge(u.role).className}`}>{roleBadge(u.role).label}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-b border-line bg-surface flex justify-between items-center w-full">
                            <h2 className="text-xl font-display font-bold uppercase tracking-[0.05em]">Registered Users</h2>
                            <div className="flex gap-2">
                                <button
                                    onClick={async () => {
                                        const ok = await toast.confirm({
                                            title: 'Force sync all users?',
                                            message: 'Force sync all users from Auth to DB?',
                                        });
                                        if (ok) {
                                            try {
                                                const res = await dbService.syncAllUsers();
                                                toast.success(`Synced ${res.count} users.`);
                                                fetchUsers();
                                            } catch (e: unknown) {
                                                toast.error(getUserMessage(e, "Sync failed."));
                                            }
                                        }
                                    }}
                                    className="text-xs bg-navy-800 hover:bg-navy-700 text-white px-3 py-1 rounded transition-colors flex items-center gap-1 font-display font-bold uppercase tracking-[0.05em]"
                                >
                                    Force Sync
                                </button>
                                <button
                                    onClick={handleBackfillRoles}
                                    title="Migrate legacy roles (POOL_MANAGER/PARTICIPANT) to canonical (dry-run first)"
                                    className="text-xs bg-surface hover:bg-card border border-line text-[color:var(--text)] px-3 py-1 rounded transition-colors flex items-center gap-1 font-display font-bold uppercase tracking-[0.05em]"
                                >
                                    Backfill Roles
                                </button>
                                {/* Admin Actions */}
                                <button
                                    onClick={async () => {
                                        const ok = await toast.confirm({
                                            title: 'Recalculate GLOBAL PRIZE STATS?',
                                            message: 'This will scan all locked pools and reset the total prize counter.',
                                            danger: true,
                                        });
                                        if (ok) {
                                            try {
                                                const res = await dbService.recalculateGlobalStats();
                                                dbService.logAdminAction({ action: 'RECALCULATE_GLOBAL_STATS', targetType: 'stats', status: 'success' });
                                                toast.success(res.message + " Total: $" + res.totalPrizes);
                                            } catch (e) {
                                                dbService.logAdminAction({ action: 'RECALCULATE_GLOBAL_STATS', targetType: 'stats', status: 'error', error: getUserMessage(e, 'error') });
                                                toast.error(getUserMessage(e, "Failed to recalculate stats."));
                                            }
                                        }
                                    }}
                                    className="text-xs bg-navy-800 hover:bg-navy-700 text-white px-3 py-1 rounded transition-colors flex items-center gap-1 font-display font-bold uppercase tracking-[0.05em]"
                                >
                                    <Activity size={12} /> Recalculate Stats
                                </button>
                                <button
                                    onClick={fetchUsers}
                                    className="text-xs bg-surface hover:bg-card border border-line text-[color:var(--text)] px-3 py-1 rounded transition-colors flex items-center gap-1 font-display font-bold uppercase tracking-[0.05em]"
                                >
                                    <Activity size={12} /> Refresh List
                                </button>
                                <button
                                    onClick={handleExportEmails}
                                    className="text-xs bg-navy-800 hover:bg-navy-700 text-white px-3 py-1 rounded transition-colors flex items-center gap-1 font-display font-bold uppercase tracking-[0.05em]"
                                >
                                    <ArrowDown size={12} /> Export Emails
                                </button>
                            </div>
                        </div>
                        {/* Client-side member filters — search by name OR email, filter by
                            role / registration method, sort by created date or name. */}
                        <div className="p-4 border-b border-line bg-surface flex flex-wrap gap-2 items-center w-full">
                            <input
                                value={memberSearch}
                                onChange={(e) => setMemberSearch(e.target.value)}
                                placeholder="Filter by name or email…"
                                className="flex-1 min-w-[200px] bg-card border border-line rounded-lg px-3 py-2 text-sm text-[color:var(--text)] focus:outline-none focus:border-gold-500"
                            />
                            <select
                                aria-label="Filter by role"
                                value={memberRoleFilter}
                                onChange={(e) => setMemberRoleFilter(e.target.value)}
                                className="bg-card border border-line rounded-lg px-3 py-2 text-sm text-[color:var(--text)] focus:outline-none focus:border-gold-500"
                            >
                                <option value="ALL">All roles</option>
                                {CANONICAL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <select
                                aria-label="Filter by registration method"
                                value={memberMethodFilter}
                                onChange={(e) => setMemberMethodFilter(e.target.value as 'ALL' | 'google' | 'email')}
                                className="bg-card border border-line rounded-lg px-3 py-2 text-sm text-[color:var(--text)] focus:outline-none focus:border-gold-500"
                            >
                                <option value="ALL">All methods</option>
                                <option value="email">Email</option>
                                <option value="google">Google</option>
                            </select>
                            <select
                                aria-label="Sort members"
                                value={memberSort}
                                onChange={(e) => setMemberSort(e.target.value as 'created_desc' | 'created_asc' | 'name')}
                                className="bg-card border border-line rounded-lg px-3 py-2 text-sm text-[color:var(--text)] focus:outline-none focus:border-gold-500"
                            >
                                <option value="created_desc">Newest first</option>
                                <option value="created_asc">Oldest first</option>
                                <option value="name">Name A–Z</option>
                            </select>
                            <span className="text-xs text-muted font-body num whitespace-nowrap">{visibleMembers.length} of {users.length}</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="font-display font-bold text-xs text-muted uppercase tracking-[0.08em] bg-surface">
                                    <tr>
                                        <th className="p-4 tracking-wider">Name</th>
                                        <th className="p-4 tracking-wider">Email</th>
                                        <th className="p-4 tracking-wider">Role</th>
                                        <th className="p-4 tracking-wider">Method</th>
                                        <th className="p-4 tracking-wider">Referrals</th>
                                        <th className="p-4 tracking-wider">Created</th>
                                        <th className="p-4 tracking-wider">ID</th>
                                        <th className="p-4 tracking-wider">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                    {visibleMembers.map(u => (
                                        <tr key={u.id} className="hover:bg-surface transition-colors">
                                            <td className="p-4 font-medium">
                                                <button onClick={() => handleViewUser(u)} className="hover:text-gold-600 dark:hover:text-gold-400 hover:underline font-bold text-left">{u.name}</button>
                                            </td>
                                            <td className="p-4 text-muted font-body">{u.email}</td>
                                            <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-[10px] uppercase font-display font-bold tracking-[0.08em] px-2 py-1 rounded border ${roleBadge(u.role).className}`}>
                                                        {roleBadge(u.role).label}
                                                    </span>
                                                    <select
                                                        aria-label={`Change role for ${u.email || u.id}`}
                                                        value={normalizeRole(u.role)}
                                                        onChange={(e) => setRoleChange({ user: u, role: e.target.value })}
                                                        className="bg-surface border border-line rounded text-[10px] text-muted px-1 py-1 focus:outline-none focus:border-gold-500"
                                                    >
                                                        {CANONICAL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                                                    </select>
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <span className={`text-[10px] uppercase font-display font-bold tracking-[0.08em] px-2 py-1 rounded border ${u.registrationMethod === 'google' ? 'bg-gold-500/10 text-gold-700 dark:text-gold-400 border-gold-500/25' : 'bg-navy-600/10 text-navy-700 dark:text-gold-400 border-navy-600/25'}`}>
                                                    {u.registrationMethod || 'EMAIL'}
                                                </span>
                                            </td>
                                            <td className="p-4 text-center">
                                                <span className="text-navy-700 dark:text-gold-400 font-display font-bold num">{u.referralCount || 0}</span>
                                            </td>
                                            <td className="p-4 text-faint text-xs num">
                                                {u.createdAt ? (() => {
                                                    const d = new Date(u.createdAt);
                                                    return `${d.getDate().toString().padStart(2, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getFullYear()}`;
                                                })() : '—'}
                                            </td>
                                            <td className="p-4 text-faint font-mono text-xs max-w-[100px] truncate" title={u.id}>{u.id}</td>
                                            <td className="p-4 flex gap-2">
                                                <button
                                                    onClick={() => handleResetPassword(u)}
                                                    className="text-gold-700 dark:text-gold-400 hover:bg-gold-500/10 transition-colors border border-gold-500/40 px-2 py-1 rounded text-xs font-display font-bold uppercase tracking-[0.05em]"
                                                    title="Send Password Reset (Admin API)"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <Settings size={14} /> Reset
                                                    </div>
                                                </button>
                                                <button
                                                    onClick={() => handleEmailUser(u)}
                                                    title="Send a one-off email (logged to their activity + admin audit)"
                                                    className="text-navy-700 dark:text-gold-400 hover:bg-navy-600/10 text-xs font-display font-bold uppercase tracking-[0.05em] border border-navy-600/40 px-2 py-1 rounded transition-colors"
                                                >Email</button>
                                                <button onClick={() => handleEditUser(u)} className="text-navy-700 dark:text-gold-400 hover:bg-navy-600/10 text-xs font-display font-bold uppercase tracking-[0.05em] border border-navy-600/40 px-2 py-1 rounded transition-colors">Edit</button>
                                                <button onClick={() => handleDeleteUser(u)} className="text-brandred-500 hover:bg-brandred-600/10 transition-colors border border-brandred-600/40 px-2 py-1 rounded"><Trash2 size={16} /></button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            }

            {/* ============ REFERRALS TAB ============ */}
            {activeTab === 'referrals' && (
                <div className="bg-card rounded-xl border border-line overflow-hidden shadow-card">
                    <div className="p-4 border-b border-line bg-surface flex justify-between items-center">
                        <h2 className="text-xl font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2"><Users className="text-gold-500" size={20} /> Referral Dashboard</h2>
                        <span className="text-xs font-mono text-faint">Top Referrers & Referral Chain</span>
                    </div>

                    {/* Referral Stats Row */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 border-b border-line">
                        <div className="bg-surface border border-line p-4 rounded-lg text-center">
                            <p className="text-3xl font-display font-bold text-navy-800 dark:text-gold-400 num">{users.reduce((sum, u) => sum + (getComputedReferrals(u.id) || 0), 0)}</p>
                            <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em]">Total Referrals</p>
                        </div>
                        <div className="bg-surface border border-line p-4 rounded-lg text-center">
                            <p className="text-3xl font-display font-bold text-gold-600 dark:text-gold-400 num">{users.filter(u => u.referredBy).length}</p>
                            <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em]">Referred Users</p>
                        </div>
                        <div className="bg-surface border border-line p-4 rounded-lg text-center">
                            <p className="text-3xl font-display font-bold text-gold-600 dark:text-gold-400 num">
                                {new Set(users.filter(u => u.referredBy).map(u => u.referredBy)).size}
                            </p>
                            <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em]">Active Referrers</p>
                        </div>
                        <div className="bg-surface border border-line p-4 rounded-lg text-center">
                            <p className="text-3xl font-display font-bold text-[color:var(--text)] num">{users.length > 0 ? ((users.filter(u => u.referredBy).length / users.length) * 100).toFixed(1) : 0}%</p>
                            <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em]">Referral Rate</p>
                        </div>
                    </div>

                    {/* Top Referrers Leaderboard */}
                    <div className="p-4">
                        <h3 className="text-sm font-display font-bold text-[color:var(--text)] mb-3 uppercase tracking-[0.08em] flex items-center gap-1.5"><Trophy size={14} className="text-gold-500" /> Top Referrers</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                            {[...users]
                                .map(u => ({ ...u, _computedCount: getComputedReferrals(u.id) }))
                                .filter(u => u._computedCount > 0)
                                .sort((a, b) => b._computedCount - a._computedCount)
                                .slice(0, 3)
                                .map((u, i) => (
                                    <div key={u.id} className={`p-4 rounded-xl border ${i === 0 ? 'bg-gold-500/10 border-gold-500/40' : i === 1 ? 'bg-surface border-line' : 'bg-gold-700/10 border-gold-700/40'}`}>
                                        <div className="flex items-center gap-3">
                                            <div className={`text-2xl font-display font-extrabold num ${i === 0 ? 'text-gold-500' : i === 1 ? 'text-muted' : 'text-gold-700'}`}>#{i + 1}</div>
                                            <div className="flex-1 min-w-0">
                                                <button onClick={() => handleViewUser(u)} className="font-bold text-[color:var(--text)] truncate hover:text-gold-600 dark:hover:text-gold-400">{u.name}</button>
                                                <p className="text-xs text-muted truncate">{u.email}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-2xl font-display font-bold text-navy-800 dark:text-gold-400 num">{u._computedCount}</p>
                                                <p className="text-[10px] text-faint uppercase font-display font-bold tracking-[0.08em]">referrals</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            {users.every(u => getComputedReferrals(u.id) === 0) && (
                                <div className="col-span-3 text-center py-8 text-faint">No referrals yet</div>
                            )}
                        </div>

                        {/* Full Referral Table */}
                        <h3 className="text-sm font-display font-bold text-[color:var(--text)] mb-3 uppercase tracking-[0.08em]">All Users Referral Data</h3>
                        <div className="overflow-x-auto rounded-lg border border-line">
                            <table className="w-full text-left text-sm">
                                <thead className="font-display font-bold text-xs text-muted uppercase tracking-[0.08em] bg-surface">
                                    <tr>
                                        <th className="p-3 font-bold">User</th>
                                        <th className="p-3 font-bold">Referral Code</th>
                                        <th className="p-3 font-bold text-center">Referrals Made</th>
                                        <th className="p-3 font-bold">Referred By</th>
                                        <th className="p-3 font-bold">Joined</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                    {[...users]
                                        .map(u => ({ ...u, _computedCount: getComputedReferrals(u.id) }))
                                        .sort((a, b) => b._computedCount - a._computedCount)
                                        .map(u => {
                                            const referrer = u.referredBy ? users.find(ref => ref.id === u.referredBy) : null;
                                            return (
                                                <tr key={u.id} className="hover:bg-surface">
                                                    <td className="p-3">
                                                        <button onClick={() => handleViewUser(u)} className="font-bold text-[color:var(--text)] hover:text-gold-600 dark:hover:text-gold-400">{u.name}</button>
                                                        <p className="text-xs text-faint">{u.email}</p>
                                                    </td>
                                                    <td className="p-3">
                                                        <code className="text-xs bg-surface border border-line px-2 py-1 rounded text-gold-700 dark:text-gold-400 font-mono">{u.referralCode || u.id.slice(0, 8)}</code>
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <span className={`font-bold num ${u._computedCount > 0 ? 'text-navy-700 dark:text-gold-400' : 'text-faint'} `}>{u._computedCount}</span>
                                                    </td>
                                                    <td className="p-3">
                                                        {referrer ? (
                                                            <span className="text-gold-600 dark:text-gold-400 text-xs">{referrer.name}</span>
                                                        ) : u.referredBy ? (
                                                            <span className="text-faint text-xs font-mono">{u.referredBy.slice(0, 8)}...</span>
                                                        ) : (
                                                            <span className="text-faint text-xs">—</span>
                                                        )}
                                                    </td>
                                                    <td className="p-3 text-xs text-faint">
                                                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* ============ LOYALTY TIERS TAB ============ */}
            {activeTab === 'loyalty' && (
                <div className="space-y-8 animate-in fade-in duration-300">
                    
                    {/* TIER CONFIGURATION CONTROL CENTER */}
                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                        <div className="lg:col-span-3 bg-card border border-line rounded-3xl p-6 shadow-panel flex flex-col justify-between">
                            <div>
                                <h3 className="text-lg font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
                                    <Shield className="text-gold-500" /> Tiers Control Center
                                </h3>
                                <p className="text-muted text-xs mt-1">
                                    Define loyalty tiers based on lifetime pool entries. Changes will apply immediately across all user dashboards.
                                </p>
                            </div>
                            
                            <div className="space-y-4 mt-6">
                                {editingTiers?.map((tier, index) => (
                                    <div key={tier.id} className="bg-surface border border-line rounded-2xl p-4 flex flex-col md:flex-row items-center gap-4 relative group">
                                        <div className="flex-1 w-full space-y-3">
                                            <div className="grid grid-cols-3 gap-3">
                                                <div className="col-span-2">
                                                    <label className="text-[10px] text-muted font-display font-extrabold uppercase tracking-[0.08em]">Tier Name</label>
                                                    <input
                                                        type="text"
                                                        value={tier.name}
                                                        onChange={(e) => {
                                                            const updated = [...(editingTiers || [])];
                                                            updated[index] = { ...tier, name: e.target.value };
                                                            setEditingTiers(updated);
                                                        }}
                                                        className="w-full bg-surface border border-line rounded-xl px-3 py-1.5 text-xs font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600 font-bold"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-muted font-display font-extrabold uppercase tracking-[0.08em]">Min Pools</label>
                                                    <input
                                                        type="number"
                                                        value={tier.minPools}
                                                        onChange={(e) => {
                                                            const updated = [...(editingTiers || [])];
                                                            updated[index] = { ...tier, minPools: Math.max(0, parseInt(e.target.value) || 0) };
                                                            setEditingTiers(updated);
                                                        }}
                                                        className="w-full bg-surface border border-line rounded-xl px-3 py-1.5 text-xs font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600 font-mono font-bold"
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-muted font-display font-extrabold uppercase tracking-[0.08em]">Description</label>
                                                <input
                                                    type="text"
                                                    value={tier.description}
                                                    onChange={(e) => {
                                                        const updated = [...(editingTiers || [])];
                                                        updated[index] = { ...tier, description: e.target.value };
                                                        setEditingTiers(updated);
                                                    }}
                                                    className="w-full bg-surface border border-line rounded-xl px-3 py-1.5 text-xs font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600"
                                                />
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleRemoveTierLocal(tier.id)}
                                            className="p-2 border border-brandred-600/30 text-brandred-500 hover:bg-brandred-600/10 rounded-xl mt-3 md:mt-0 transition-all duration-200"
                                            title="Delete Tier"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <div className="flex gap-3 mt-6 pt-4 border-t border-line">
                                <button
                                    onClick={handleAddTierLocal}
                                    className="flex items-center gap-1 bg-surface hover:bg-card text-[color:var(--text)] px-4 py-2 rounded-xl text-xs font-display font-bold uppercase tracking-[0.05em] transition-all border border-line"
                                >
                                    <Plus size={14} /> Add New Tier
                                </button>
                                <button
                                    onClick={handleSaveTiers}
                                    className="bg-brandred-600 hover:bg-brandred-500 text-white px-5 py-2 rounded-xl text-xs font-display font-bold uppercase tracking-[0.05em] transition-all ml-auto shadow-red-cta"
                                >
                                    Save Tier Configuration
                                </button>
                            </div>
                        </div>

                        {/* TIER DISTRIBUTION GRAPH */}
                        <div className="lg:col-span-2 bg-card border border-line rounded-3xl p-6 shadow-panel flex flex-col justify-between">
                            <div>
                                <h3 className="text-lg font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
                                    <Activity className="text-gold-500" /> Tier Distribution
                                </h3>
                                <p className="text-muted text-xs mt-1">
                                    Active user split across loyalty thresholds.
                                </p>
                            </div>

                            <div className="space-y-6 mt-8 flex-1 flex flex-col justify-center">
                                {activeTiers.map((t: LoyaltyTier) => {
                                    const count = userTiers.list[t.id]?.length || 0;
                                    const pct = users.length > 0 ? (count / users.length) * 100 : 0;
                                    return (
                                        <div key={t.id} className="space-y-1.5">
                                            <div className="flex justify-between text-xs font-bold">
                                                <span className="text-[color:var(--text)] flex items-center gap-1.5">
                                                    <span className="h-2 w-2 rounded-full bg-gold-500"></span>
                                                    {t.name}
                                                </span>
                                                <span className="text-muted font-mono num">{count} ({pct.toFixed(0)}%)</span>
                                            </div>
                                            <div className="h-3 w-full bg-surface rounded-full border border-line overflow-hidden">
                                                <div
                                                    className="h-full bg-gold-foil rounded-full transition-all duration-500"
                                                    style={{ width: `${pct}%` }}
                                                ></div>
                                            </div>
                                            <p className="text-[10px] text-faint">{t.description}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* TARGETED MARKETING HUB */}
                    <div className="bg-card border border-line rounded-3xl p-6 shadow-panel">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 pb-4 border-b border-line">
                            <div>
                                <h3 className="text-lg font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
                                    <Users className="text-gold-500" /> Targeted Marketing Hub
                                </h3>
                                <p className="text-muted text-xs mt-0.5">
                                    Filter and search users by tier, copy bulk emails, export CSV data, or send mock promos.
                                </p>
                            </div>

                            <div className="flex flex-wrap gap-2 shrink-0">
                                <button
                                    onClick={() => {
                                        let list: User[] = [];
                                        if (selectedMarketingTier === 'all') {
                                            list = users;
                                        } else {
                                            list = userTiers.list[selectedMarketingTier] || [];
                                        }
                                        const emails = list.map((u: User) => u.email).join(', ');
                                        navigator.clipboard.writeText(emails);
                                        toast.success(`Copied ${list.length} emails to clipboard!`);
                                    }}
                                    className="text-xs bg-surface hover:bg-card text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em] px-4 py-2.5 rounded-xl border border-line transition-all flex items-center gap-1.5"
                                >
                                    <Copy size={13} /> Copy Group Emails
                                </button>
                                
                                <button
                                    onClick={() => {
                                        let list: User[] = [];
                                        if (selectedMarketingTier === 'all') {
                                            list = users;
                                        } else {
                                            list = userTiers.list[selectedMarketingTier] || [];
                                        }
                                        const headers = ['UID', 'Name', 'Email', 'Phone', 'Pools Entered', 'Tier'];
                                        const rows = list.map((u: User) => {
                                            const count = userPoolCounts[u.id] || 0;
                                            const tier = userTiers.mapping[u.id] || 'None';
                                            return `"${u.id}","${u.name}","${u.email}","${u.phone || ''}",${count},"${tier}"`;
                                        });
                                        const csvContent = [headers.join(','), ...rows].join('\n');
                                        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                                        const url = URL.createObjectURL(blob);
                                        const link = document.createElement('a');
                                        link.setAttribute('href', url);
                                        const tierSuffix = selectedMarketingTier === 'all' ? 'all_users' : activeTiers.find((t: LoyaltyTier) => t.id === selectedMarketingTier)?.name.toLowerCase().replace(/\s+/g, '_') || 'tier';
                                        link.setAttribute('download', `loyalty_${tierSuffix}_${new Date().toISOString().slice(0, 10)}.csv`);
                                        link.style.visibility = 'hidden';
                                        document.body.appendChild(link);
                                        link.click();
                                        document.body.removeChild(link);
                                    }}
                                    className="text-xs bg-gold-500/10 hover:bg-gold-500/20 text-gold-700 dark:text-gold-400 font-display font-bold uppercase tracking-[0.05em] px-4 py-2.5 rounded-xl border border-gold-500/30 transition-all flex items-center gap-1.5"
                                >
                                    <ArrowDown size={13} /> Export CSV
                                </button>

                                <button
                                    onClick={() => {
                                        if (selectedMarketingTier === 'all') {
                                            toast.info('Please select a specific tier from the dropdown to run bulk promo actions.');
                                            return;
                                        }
                                        setPromoBulkTier(selectedMarketingTier);
                                        setPromoSubject(`Special Offer for our ${activeTiers.find((t: LoyaltyTier) => t.id === selectedMarketingTier)?.name} Members!`);
                                        setPromoMessage('Thank you for being such an active part of March Melee Pools!');
                                        setPromoType('coupon');
                                        setPromoCoupon('LOYALTY20');
                                    }}
                                    className="text-xs bg-gold-foil text-navy-900 hover:brightness-105 font-display font-bold uppercase tracking-[0.05em] px-4 py-2.5 rounded-xl transition-all shadow-card flex items-center gap-1.5"
                                >
                                    <Plus size={13} /> Bulk Mock Promo
                                </button>
                            </div>
                        </div>

                        {/* FILTERS TOOLBAR */}
                        <div className="flex flex-col sm:flex-row gap-3 mb-6 items-center bg-surface p-3 rounded-2xl border border-line">
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <span className="text-[10px] text-muted font-display font-extrabold uppercase tracking-[0.08em] shrink-0">Filter Tier:</span>
                                <select
                                    value={selectedMarketingTier}
                                    onChange={(e) => setSelectedMarketingTier(e.target.value)}
                                    className="w-full bg-card border border-line rounded-xl px-3 py-2 text-xs font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600 font-bold"
                                >
                                    <option value="all">All Tiers (Show All Users)</option>
                                    {activeTiers.map((t: LoyaltyTier) => (
                                        <option key={t.id} value={t.id}>{t.name} ({userTiers.list[t.id]?.length || 0} users)</option>
                                    ))}
                                </select>
                            </div>

                            <div className="relative w-full sm:flex-grow">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={14} />
                                <input
                                    type="text"
                                    placeholder="Search roster by name, email, or phone..."
                                    value={marketingSearch}
                                    onChange={(e) => setMarketingSearch(e.target.value)}
                                    className="w-full bg-card border border-line rounded-xl py-2 pl-9 pr-4 text-xs font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600 font-semibold"
                                />
                            </div>
                        </div>

                        {/* ROSTER TABLE */}
                        <div className="overflow-x-auto rounded-2xl border border-line">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-surface text-muted uppercase font-display font-black tracking-[0.08em] text-[10px]">
                                    <tr>
                                        <th className="p-4">Name</th>
                                        <th className="p-4">Email</th>
                                        <th className="p-4">Phone</th>
                                        <th className="p-4 text-center">Pools Entered</th>
                                        <th className="p-4">Current Loyalty Tier</th>
                                        <th className="p-4">Marketing Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line font-body font-semibold text-muted text-[11px]">
                                    {(() => {
                                        let list: User[] = [];
                                        if (selectedMarketingTier === 'all') {
                                            list = users;
                                        } else {
                                            list = userTiers.list[selectedMarketingTier] || [];
                                        }

                                        if (marketingSearch) {
                                            const s = marketingSearch.toLowerCase();
                                            list = list.filter((u: User) => 
                                                u.name.toLowerCase().includes(s) || 
                                                u.email.toLowerCase().includes(s) || 
                                                (u.phone && u.phone.includes(s))
                                            );
                                        }

                                        if (list.length === 0) {
                                            return <tr><td colSpan={6} className="p-8 text-center text-faint font-display font-bold uppercase tracking-[0.08em] text-[10px]">No users match this filter</td></tr>;
                                        }

                                        return list.map((u: User) => {
                                            const count = userPoolCounts[u.id] || 0;
                                            const tier = userTiers.mapping[u.id] || 'None';
                                            return (
                                                <tr key={u.id} className="hover:bg-surface transition-colors">
                                                    <td className="p-4 font-bold text-[color:var(--text)]">
                                                        <button onClick={() => handleViewUser(u)} className="hover:text-gold-600 dark:hover:text-gold-400 hover:underline text-left">{u.name}</button>
                                                    </td>
                                                    <td className="p-4 text-muted">{u.email}</td>
                                                    <td className="p-4 font-mono text-muted num">{u.phone || '—'}</td>
                                                    <td className="p-4 text-center font-mono text-[color:var(--text)] font-bold num">{count}</td>
                                                    <td className="p-4">
                                                        <span className="text-[9px] uppercase font-display font-black tracking-widest px-2 py-0.5 rounded-full bg-gold-500/10 text-gold-700 dark:text-gold-400 border border-gold-500/30">
                                                            {tier}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 flex gap-2">
                                                        <a
                                                            href={`mailto:${u.email}`}
                                                            className="text-xs bg-surface hover:bg-card text-[color:var(--text)] px-2.5 py-1 rounded-lg border border-line transition-all font-display font-bold uppercase tracking-[0.05em]"
                                                        >
                                                            Email
                                                        </a>
                                                        <button
                                                            onClick={() => {
                                                                navigator.clipboard.writeText(u.email);
                                                                toast.success('Email copied to clipboard!');
                                                            }}
                                                            className="text-xs bg-surface hover:bg-card text-[color:var(--text)] px-2.5 py-1 rounded-lg border border-line transition-all"
                                                            title="Copy Email"
                                                        >
                                                            <Copy size={12} />
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                setPromoUser(u);
                                                                setPromoSubject(`Special Direct Offer for ${u.name}!`);
                                                                setPromoMessage(`Hi ${u.name}, we have a special offer just for you!`);
                                                                setPromoType('coupon');
                                                                setPromoCoupon('DIRECT15');
                                                            }}
                                                            className="text-xs bg-navy-600/10 hover:bg-navy-600/20 text-navy-700 dark:text-gold-400 border border-navy-600/30 px-2.5 py-1 rounded-lg transition-all font-display font-black uppercase tracking-[0.05em]"
                                                        >
                                                            Direct Mock Promo
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        });
                                    })()}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* MOCK PROMO SENDER MODAL */}
                    {(promoUser || promoBulkTier) && (
                        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                            <div className="bg-card border border-line rounded-3xl p-6 w-full max-w-lg shadow-panel flex flex-col justify-between relative">
                                <button
                                    onClick={() => { setPromoUser(null); setPromoBulkTier(null); }}
                                    className="absolute top-4 right-4 p-1.5 border border-line text-muted hover:text-[color:var(--text)] rounded-xl bg-surface"
                                >
                                    <X size={18} />
                                </button>

                                <div>
                                    <h3 className="text-lg font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2 mb-1">
                                        <Bot className="text-gold-500 animate-pulse" /> Mock Promo Campaign Creator
                                    </h3>
                                    <p className="text-muted text-xs font-body font-semibold">
                                        {promoBulkTier
                                          ? `Broadcasting simulated campaign to all members of the ${activeTiers.find((t: LoyaltyTier) => t.id === promoBulkTier)?.name} loyalty tier.`
                                          : `Configuring mock coupon code/marketing email directly to ${promoUser?.name}.`
                                        }
                                    </p>
                                </div>

                                <div className="space-y-4 mt-6">
                                    <div>
                                        <label className="text-[10px] text-muted font-display font-extrabold uppercase tracking-[0.08em] block mb-1">Marketing Action Type</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => setPromoType('coupon')}
                                                className={`py-2 text-xs font-display font-bold uppercase tracking-[0.05em] rounded-xl border transition-all flex items-center justify-center gap-1.5 ${promoType === 'coupon' ? 'bg-gold-500/10 border-gold-500/40 text-gold-700 dark:text-gold-400' : 'bg-surface border-line text-muted'}`}
                                            >
                                                <Ticket size={13} /> Discount Coupon
                                            </button>
                                            <button
                                                onClick={() => setPromoType('reminder')}
                                                className={`py-2 text-xs font-display font-bold uppercase tracking-[0.05em] rounded-xl border transition-all flex items-center justify-center gap-1.5 ${promoType === 'reminder' ? 'bg-navy-600/10 border-navy-600/40 text-navy-700 dark:text-gold-400' : 'bg-surface border-line text-muted'}`}
                                            >
                                                <Megaphone size={13} /> Text Reminder/Promo
                                            </button>
                                        </div>
                                    </div>

                                    {promoType === 'coupon' && (
                                        <div>
                                            <label className="text-[10px] text-muted font-display font-extrabold uppercase tracking-[0.08em] block mb-1">Coupon Code</label>
                                            <input
                                                type="text"
                                                value={promoCoupon}
                                                onChange={(e) => setPromoCoupon(e.target.value.toUpperCase())}
                                                className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-xs text-[color:var(--text)] focus:outline-none focus:border-gold-500 font-mono font-bold"
                                                placeholder="e.g. LOYALTY50"
                                            />
                                        </div>
                                    )}

                                    <div>
                                        <label className="text-[10px] text-muted font-display font-extrabold uppercase tracking-[0.08em] block mb-1">Subject / Header</label>
                                        <input
                                            type="text"
                                            value={promoSubject}
                                            onChange={(e) => setPromoSubject(e.target.value)}
                                            className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-xs font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600 font-semibold"
                                            placeholder="Subject of marketing email"
                                        />
                                    </div>

                                    <div>
                                        <label className="text-[10px] text-muted font-display font-extrabold uppercase tracking-[0.08em] block mb-1">Message Content</label>
                                        <textarea
                                            value={promoMessage}
                                            onChange={(e) => setPromoMessage(e.target.value)}
                                            rows={3}
                                            className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-xs font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600 font-semibold resize-none"
                                            placeholder="Tell them about the coupon/remind them to lock in their picks..."
                                        />
                                    </div>
                                </div>

                                <div className="flex gap-3 mt-6 pt-4 border-t border-line">
                                    <button
                                        onClick={() => { setPromoUser(null); setPromoBulkTier(null); }}
                                        className="bg-surface hover:bg-card text-[color:var(--text)] px-4 py-2 rounded-xl text-xs font-display font-bold uppercase tracking-[0.05em] transition-all border border-line"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={async () => {
                                            if (!promoSubject || !promoMessage || (promoType === 'coupon' && !promoCoupon)) {
                                                toast.info('Please fill out all promo fields.');
                                                return;
                                            }
                                            setIsSendingPromo(true);
                                            // Simulate API delay
                                            await new Promise(r => setTimeout(r, 1200));
                                            setIsSendingPromo(false);
                                            toast.success(`Campaign successfully simulated! Target: ${promoBulkTier ? activeTiers.find((t: LoyaltyTier) => t.id === promoBulkTier)?.name + ' Tier' : promoUser?.name} - Type: ${promoType.toUpperCase()} - Code: ${promoType === 'coupon' ? promoCoupon : 'N/A'} - Message: ${promoMessage}`);
                                            setPromoUser(null);
                                            setPromoBulkTier(null);
                                        }}
                                        disabled={isSendingPromo}
                                        className="bg-brandred-600 hover:bg-brandred-500 text-white px-5 py-2 rounded-xl text-xs font-display font-bold uppercase tracking-[0.05em] transition-all ml-auto shadow-red-cta disabled:opacity-50"
                                    >
                                        {isSendingPromo ? 'Sending Simulation...' : 'Execute Mock Campaign'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ============ THEMES TAB ============ */}
            {activeTab === 'themes' && (
                <div className="space-y-6">
                    {/* Header */}
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="text-xl font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)]">Theme Manager</h2>
                            <p className="text-sm text-muted">Create and manage custom pool themes. Only active themes are visible to pool managers.</p>
                        </div>
                        <button
                            onClick={() => {
                                // Create new theme from defaults
                                import('../constants/presetThemes').then(({ createEmptyTheme }) => {
                                    setEditingTheme({
                                        id: 'new',
                                        updatedAt: Date.now(),
                                        ...createEmptyTheme(),
                                        createdAt: Date.now(),
                                        createdBy: 'SUPER_ADMIN'
                                    });
                                    setShowThemeBuilder(true);
                                });
                            }}
                            className="flex items-center gap-2 bg-brandred-600 hover:bg-brandred-500 text-white px-4 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] transition-colors shadow-red-cta"
                        >
                            <Plus size={18} /> Create Theme
                        </button>
                    </div>

                    {/* Seed Presets Button */}
                    {themes.length === 0 && (
                        <div className="bg-gold-500/10 border border-gold-500/40 rounded-xl p-4 text-center">
                            <p className="text-gold-700 dark:text-gold-400 mb-3 font-body">No themes found. Seed the preset themes to get started.</p>
                            <button
                                onClick={async () => {
                                    const { PRESET_THEMES } = await import('../constants/presetThemes');
                                    for (const preset of PRESET_THEMES) {
                                        await dbService.saveTheme({
                                            ...preset,
                                            createdAt: Date.now(),
                                            createdBy: 'SYSTEM'
                                        });
                                    }
                                    toast.success(`Seeded ${PRESET_THEMES.length} preset themes!`);
                                }}
                                className="bg-gold-foil text-navy-900 hover:brightness-105 px-4 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em]"
                            >
                                Seed Preset Themes
                            </button>
                        </div>
                    )}

                    {/* Theme Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {themes.map((theme) => (
                            <div
                                key={theme.id}
                                className={`bg-card rounded-xl border overflow-hidden transition-all shadow-card ${theme.isDefault ? 'border-gold-500' : theme.isActive ? 'border-[#0F7B4A]/50' : 'border-line'}`}
                            >
                                {/* Preview */}
                                <div
                                    className="h-24 relative"
                                    style={{ background: theme.colors?.background || '#0f172a' }}
                                >
                                    {/* Mini Grid Preview */}
                                    <div className="absolute inset-2 flex items-center justify-center">
                                        <div className="grid grid-cols-5 gap-0.5">
                                            {[...Array(15)].map((_, i) => (
                                                <div
                                                    key={i}
                                                    className="w-3 h-3 rounded-sm"
                                                    style={{
                                                        background: i % 2 === 0 ? theme.grid?.cellBackground : theme.grid?.cellBackgroundAlt,
                                                        border: `1px solid ${theme.grid?.cellBorder || '#334155'} `
                                                    }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    {/* Status Badges */}
                                    <div className="absolute top-2 right-2 flex gap-1">
                                        {theme.isDefault && (
                                            <span className="bg-gold-foil text-navy-900 text-[10px] font-display font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                                <Star size={10} /> DEFAULT
                                            </span>
                                        )}
                                        {theme.isActive ? (
                                            <span className="bg-[#E4F5EC] text-[#0F7B4A] text-[10px] font-display font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                                <Eye size={10} /> ACTIVE
                                            </span>
                                        ) : (
                                            <span className="bg-surface text-muted border border-line text-[10px] font-display font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                                <EyeOff size={10} /> HIDDEN
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Info */}
                                <div className="p-4">
                                    <h3 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] text-lg">{theme.name}</h3>
                                    <p className="text-xs text-muted font-body mb-3 line-clamp-1">{theme.description || 'No description'}</p>

                                    {/* Color Swatches */}
                                    <div className="flex gap-1 mb-4">
                                        {['primary', 'secondary', 'success', 'warning', 'error'].map(key => (
                                            <div
                                                key={key}
                                                className="w-5 h-5 rounded-full border border-line"
                                                style={{ background: (theme.colors as unknown as Record<string, string>)?.[key] }}
                                                title={key}
                                            />
                                        ))}
                                    </div>

                                    {/* Actions */}
                                    <div className="flex gap-2 flex-wrap">
                                        <button
                                            onClick={() => { setEditingTheme(theme); setShowThemeBuilder(true); }}
                                            className="text-xs bg-navy-800 hover:bg-navy-700 text-white px-3 py-1.5 rounded font-display font-bold uppercase tracking-[0.05em]"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={async () => {
                                                await dbService.saveTheme({ ...theme, isActive: !theme.isActive });
                                            }}
                                            className={`px-3 py-1.5 rounded text-xs font-display font-bold uppercase tracking-[0.05em] border transition-colors ${theme.isActive ? 'border-line text-muted hover:bg-surface' : 'border-gold-500/50 text-gold-700 dark:text-gold-400 hover:bg-gold-500/10'} `}
                                        >
                                            {theme.isActive ? 'Deactivate' : 'Activate'}
                                        </button>
                                        {!theme.isDefault && (
                                            <button
                                                onClick={() => dbService.setDefaultTheme(theme.id)}
                                                className="text-xs border border-gold-500/50 text-gold-700 dark:text-gold-400 hover:bg-gold-500/10 px-3 py-1.5 rounded font-display font-bold uppercase tracking-[0.05em]"
                                            >
                                                Set Default
                                            </button>
                                        )}
                                        <button
                                            onClick={async () => {
                                                const { id: _copyId, ...rest } = theme;
                                                void _copyId;
                                                await dbService.saveTheme({
                                                    ...rest,
                                                    name: `${theme.name} (Copy)`,
                                                    id: undefined,
                                                    isDefault: false,
                                                    createdAt: Date.now()
                                                });
                                            }}
                                            className="text-xs border border-line text-muted hover:bg-surface px-2 py-1.5 rounded"
                                            title="Duplicate"
                                        >
                                            <Copy size={12} />
                                        </button>
                                        <button
                                            onClick={async () => {
                                                const ok = await toast.confirm({
                                                    title: `Delete theme "${theme.name}"?`,
                                                    message: 'This will permanently delete this theme.',
                                                    danger: true,
                                                });
                                                if (ok) {
                                                    await dbService.deleteTheme(theme.id);
                                                    dbService.logAdminAction({ action: 'DELETE_THEME', targetType: 'theme', targetId: theme.id, metadata: { name: theme.name }, status: 'success' });
                                                }
                                            }}
                                            className="text-xs text-brandred-500 hover:bg-brandred-600/10 px-2 py-1.5 rounded"
                                            title="Delete"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ============ THEME BUILDER MODAL ============ */}
            {showThemeBuilder && editingTheme && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 overflow-auto">
                    <div className="bg-card rounded-2xl border border-line w-full max-w-5xl max-h-[90vh] overflow-auto">
                        {/* Modal Header */}
                        <div className="p-4 border-b border-line flex justify-between items-center sticky top-0 bg-card z-10">
                            <h2 className="text-xl font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
                                <Palette size={20} className="text-gold-500" />
                                {editingTheme.id ? 'Edit Theme' : 'Create Theme'}
                            </h2>
                            <div className="flex gap-2">
                                <button
                                    onClick={async () => {
                                        await dbService.saveTheme(editingTheme);
                                        setShowThemeBuilder(false);
                                        setEditingTheme(null);
                                    }}
                                    className="bg-brandred-600 hover:bg-brandred-500 text-white px-4 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] shadow-red-cta"
                                >
                                    Save Theme
                                </button>
                                <button
                                    onClick={() => { setShowThemeBuilder(false); setEditingTheme(null); }}
                                    className="text-muted hover:text-[color:var(--text)] p-2"
                                >
                                    <X size={24} />
                                </button>
                            </div>
                        </div>

                        {/* Modal Body */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
                            {/* Left: Settings */}
                            <div className="space-y-6">
                                {/* Basic Info */}
                                <div className="bg-surface rounded-xl p-4 border border-line">
                                    <h3 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-4">Basic Info</h3>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em] block mb-1">Theme Name</label>
                                            <input
                                                type="text"
                                                value={editingTheme.name}
                                                onChange={(e) => setEditingTheme({ ...editingTheme, name: e.target.value })}
                                                className="w-full bg-card border border-line rounded-lg px-3 py-2 font-body text-[color:var(--text)]"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em] block mb-1">Description</label>
                                            <input
                                                type="text"
                                                value={editingTheme.description}
                                                onChange={(e) => setEditingTheme({ ...editingTheme, description: e.target.value })}
                                                className="w-full bg-card border border-line rounded-lg px-3 py-2 font-body text-[color:var(--text)]"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em] block mb-1">Category</label>
                                            <select
                                                value={editingTheme.category}
                                                onChange={(e) => setEditingTheme({ ...editingTheme, category: e.target.value as PoolTheme['category'] })}
                                                className="w-full bg-card border border-line rounded-lg px-3 py-2 font-body text-[color:var(--text)]"
                                            >
                                                <option value="sports">Sports</option>
                                                <option value="holiday">Holiday</option>
                                                <option value="classic">Classic</option>
                                                <option value="custom">Custom</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                {/* Color Palette */}
                                <div className="bg-surface rounded-xl p-4 border border-line">
                                    <h3 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-4">Color Palette</h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        {Object.entries(editingTheme.colors || {}).map(([key, value]) => (
                                            <div key={key} className="flex items-center gap-2">
                                                <input
                                                    type="color"
                                                    value={value as string}
                                                    onChange={(e) => setEditingTheme({
                                                        ...editingTheme,
                                                        colors: { ...editingTheme.colors, [key]: e.target.value }
                                                    })}
                                                    className="w-8 h-8 rounded cursor-pointer border border-line"
                                                />
                                                <span className="text-xs text-[color:var(--text)] font-body capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Grid Styling */}
                                <div className="bg-surface rounded-xl p-4 border border-line">
                                    <h3 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-4">Grid Styling</h3>
                                    <div className="space-y-3">
                                        {['cellBackground', 'cellBackgroundAlt', 'cellBorder', 'headerBackground', 'winnerGlowColor'].map((key) => (
                                            <div key={key} className="flex items-center gap-2">
                                                <input
                                                    type="color"
                                                    value={(editingTheme.grid as unknown as Record<string, string>)?.[key] || '#1e293b'}
                                                    onChange={(e) => setEditingTheme({
                                                        ...editingTheme,
                                                        grid: { ...editingTheme.grid, [key]: e.target.value }
                                                    })}
                                                    className="w-8 h-8 rounded cursor-pointer border border-line"
                                                />
                                                <span className="text-xs text-[color:var(--text)] font-body capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                                            </div>
                                        ))}
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={editingTheme.grid?.winnerGlow || false}
                                                onChange={(e) => setEditingTheme({
                                                    ...editingTheme,
                                                    grid: { ...editingTheme.grid, winnerGlow: e.target.checked }
                                                })}
                                                className="w-5 h-5 rounded"
                                            />
                                            <span className="text-xs text-[color:var(--text)] font-body">Enable Winner Glow Effect</span>
                                        </label>
                                    </div>
                                </div>
                            </div>

                            {/* Right: Live Preview */}
                            <div className="bg-surface rounded-xl p-4 border border-line">
                                <h3 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-4">Live Preview</h3>
                                <div
                                    className="rounded-lg p-4 min-h-[400px]"
                                    style={{ background: editingTheme.colors?.background }}
                                >
                                    {/* Header Preview */}
                                    <div className="flex justify-between items-center mb-4" style={{ color: editingTheme.colors?.text }}>
                                        <span className="font-bold text-lg">Sample Pool</span>
                                        <span className="text-sm" style={{ color: editingTheme.colors?.textMuted }}>Chiefs @ Eagles</span>
                                    </div>

                                    {/* Card Preview */}
                                    <div
                                        className="rounded-lg p-3 mb-4"
                                        style={{ background: editingTheme.colors?.surface, border: `1px solid ${editingTheme.colors?.border} ` }}
                                    >
                                        <p style={{ color: editingTheme.colors?.text }} className="font-bold mb-1">Score: 24 - 17</p>
                                        <p style={{ color: editingTheme.colors?.success }} className="text-sm font-bold flex items-center gap-1"><PartyPopper size={14} /> Winner: John Smith</p>
                                    </div>

                                    {/* Grid Preview */}
                                    <div className="grid grid-cols-6 gap-1">
                                        {/* Header Row */}
                                        <div style={{ background: editingTheme.grid?.headerBackground }} className="rounded-sm h-8" />
                                        {[0, 1, 2, 3, 4].map(n => (
                                            <div
                                                key={n}
                                                style={{ background: editingTheme.grid?.headerBackground, color: editingTheme.colors?.text }}
                                                className="rounded-sm h-8 flex items-center justify-center text-xs font-bold"
                                            >
                                                {n}
                                            </div>
                                        ))}
                                        {/* Body Rows */}
                                        {[0, 1, 2, 3, 4].map(row => (
                                            <React.Fragment key={row}>
                                                <div
                                                    style={{ background: editingTheme.grid?.headerBackground, color: editingTheme.colors?.text }}
                                                    className="rounded-sm h-8 flex items-center justify-center text-xs font-bold"
                                                >
                                                    {row}
                                                </div>
                                                {[0, 1, 2, 3, 4].map(col => {
                                                    const isWinner = row === 2 && col === 3;
                                                    return (
                                                        <div
                                                            key={col}
                                                            style={{
                                                                background: (row + col) % 2 === 0 ? editingTheme.grid?.cellBackground : editingTheme.grid?.cellBackgroundAlt,
                                                                border: `1px solid ${editingTheme.grid?.cellBorder} `,
                                                                boxShadow: isWinner && editingTheme.grid?.winnerGlow ? `0 0 10px ${editingTheme.grid?.winnerGlowColor} ` : undefined
                                                            }}
                                                            className="rounded-sm h-8 flex items-center justify-center text-[10px]"
                                                        >
                                                            {isWinner && <span style={{ color: editingTheme.colors?.success }}>★</span>}
                                                        </div>
                                                    );
                                                })}
                                            </React.Fragment>
                                        ))}
                                    </div>

                                    {/* Button Preview */}
                                    <div className="mt-4 flex gap-2">
                                        <button
                                            style={{ background: editingTheme.colors?.primary }}
                                            className="px-4 py-2 rounded-lg text-white font-bold text-sm"
                                        >
                                            Primary
                                        </button>
                                        <button
                                            style={{ background: editingTheme.colors?.secondary }}
                                            className="px-4 py-2 rounded-lg text-white font-bold text-sm"
                                        >
                                            Secondary
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}


            {activeTab === 'testing' && (
                <div className="space-y-6 w-full">
                    {/* Simulation tools — consolidated into the single Test Suite tab (T12 UI merge). */}
                    <div className="bg-card border border-line rounded-2xl p-5 flex items-center justify-between gap-4 shadow-card">
                        <div>
                            <h3 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
                                <PlayCircle size={18} className="text-gold-500" /> Pool Simulation
                            </h3>
                            <p className="text-muted font-body text-sm mt-1">Drive a pool through a full lifecycle against live engines to verify counts, standings, and payouts.</p>
                        </div>
                        <button
                            onClick={() => setShowSimDashboard(true)}
                            className="shrink-0 bg-navy-800 hover:bg-navy-700 text-white font-display font-bold uppercase tracking-[0.05em] px-5 py-3 rounded-xl text-sm transition-all duration-150 hover:-translate-y-px shadow-card whitespace-nowrap flex items-center gap-2"
                        >
                            <PlayCircle size={16} /> Open Simulation Dashboard
                        </button>
                    </div>
                    {/* Tournament Simulator — relocated here from the global header (CONTEXT.md:
                        Test Suite is the sole home for simulation tools). This is the NCAA
                        bracket-tournament simulator, distinct from Pool Simulation above. */}
                    <div className="bg-card border border-line rounded-2xl p-5 flex items-center justify-between gap-4 shadow-card">
                        <div>
                            <h3 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
                                <Trophy size={18} className="text-brandred-500" /> Tournament Simulator
                            </h3>
                            <p className="text-muted font-body text-sm mt-1">Seed a full NCAA bracket tournament + synthetic entries and advance it round-by-round to verify bracket scoring end-to-end.</p>
                        </div>
                        <button
                            onClick={() => navigate('/tournament-sim')}
                            className="shrink-0 bg-brandred-600 hover:bg-brandred-500 text-white font-display font-bold uppercase tracking-[0.05em] px-5 py-3 rounded-xl text-sm transition-all duration-150 hover:-translate-y-px shadow-red-cta whitespace-nowrap flex items-center gap-2"
                        >
                            <Trophy size={16} /> Open Tournament Simulator
                        </button>
                    </div>
                    <SimpleTestingDashboard />
                </div>
            )}

            {activeTab === 'system' && (
                <div className="space-y-6 w-full">
                    {/* ADMIN AUDIT LOG (T7) */}
                    <AdminAuditViewer />

                    {/* SYSTEM STATS CARDS */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-card p-4 rounded-xl border border-line shadow-card">
                            <p className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em] mb-1">Active Pools</p>
                            <p className="text-3xl font-display font-black text-[color:var(--text)] num">
                                {pools.filter(p => !('isLocked' in p) ? false : !(p as GameState).isLocked && (p as GameState).scores?.gameStatus !== 'post').length}
                            </p>
                        </div>
                        <div className="bg-card p-4 rounded-xl border border-line shadow-card">
                            <p className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em] mb-1">Live Games</p>
                            <p className="text-3xl font-display font-black text-brandred-500 num">
                                {pools.filter(p => (p as GameState).scores?.gameStatus === 'in').length}
                            </p>
                        </div>
                        <div className="bg-card p-4 rounded-xl border border-line shadow-card">
                            <p className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em] mb-1">Finished</p>
                            <p className="text-3xl font-display font-black text-muted num">
                                {pools.filter(p => (p as GameState).scores?.gameStatus === 'post').length}
                            </p>
                        </div>
                    </div>

                    {/* EXECUTION LOGS */}
                    <div className="bg-card rounded-xl border border-line overflow-hidden w-full">
                        <div className="p-4 border-b border-line bg-surface flex flex-col gap-4">
                            <div className="flex justify-between items-center">
                                <h3 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
                                    <Activity size={18} className="text-gold-500" />
                                    System Logs
                                </h3>
                                <div className="flex gap-2">
                                    {/* Export Emails moved to the Members tab (membership/marketing
                                        export, not a System-log action). */}

                                    {/* Fix Scoring / Fix Participants / Init Big East removed —
                                        these are global ops and now live only in the Operations
                                        tab (fixPoolScores, fixParticipantIds, Big East re-init),
                                        per the CONTEXT.md "one home" contract. */}
                                    <button
                                        onClick={() => {
                                            if (dbService.getSystemLogs) {
                                                dbService.getSystemLogs().then(setSystemLogs).catch(logger.error);
                                            }
                                        }}
                                        className="text-xs bg-surface hover:bg-card border border-line px-3 py-1 rounded text-[color:var(--text)] transition-colors font-display font-bold uppercase tracking-[0.05em]"
                                    >
                                        Refresh
                                    </button>
                                </div>
                            </div>

                            {/* Filters Toolbar */}
                            <div className="flex flex-wrap gap-2 items-center bg-card p-2 rounded-lg border border-line">
                                {/* Status Filter */}
                                <select
                                    className="bg-surface border border-line rounded px-2 py-1 text-xs font-body text-[color:var(--text)] focus:ring-1 focus:ring-navy-600 outline-none"
                                    value={logStatusFilter}
                                    onChange={(e) => setLogStatusFilter(e.target.value)}
                                >
                                    <option value="ALL">All Statuses</option>
                                    <option value="success">Success</option>
                                    <option value="error">Error</option>
                                    <option value="partial">Partial</option>
                                </select>

                                {/* Tag Filter */}
                                <select
                                    className="bg-surface border border-line rounded px-2 py-1 text-xs font-body text-[color:var(--text)] focus:ring-1 focus:ring-navy-600 outline-none"
                                    value={logTagFilter}
                                    onChange={(e) => setLogTagFilter(e.target.value)}
                                >
                                    <option value="ALL">All Tags</option>
                                    <option value="ESPN_FETCH_SUCCESS">ESPN Update</option>
                                    <option value="ESPN_FETCH_FAIL">ESPN Error</option>
                                    <option value="SYNC_GAME_STATUS">System Sync</option>
                                    <option value="POOL_SYNC_ERROR">Pool Error</option>
                                    <option value="SIMULATION">Sim Run</option>
                                </select>

                                {/* Time Filter */}
                                <select
                                    className="bg-surface border border-line rounded px-2 py-1 text-xs font-body text-[color:var(--text)] focus:ring-1 focus:ring-navy-600 outline-none"
                                    value={logTimeFilter}
                                    onChange={(e) => setLogTimeFilter(e.target.value)}
                                >
                                    <option value="ALL">All Time</option>
                                    <option value="1H">Last Hour</option>
                                    <option value="24H">Last 24 Hours</option>
                                    <option value="7D">Last 7 Days</option>
                                </select>

                                {/* Search Input */}
                                <div className="relative flex-1 min-w-[150px]">
                                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" size={12} />
                                    <input
                                        type="text"
                                        placeholder="Search logs..."
                                        className="bg-surface border border-line rounded px-2 py-1 pl-7 text-xs font-body text-[color:var(--text)] placeholder:text-faint w-full focus:ring-1 focus:ring-navy-600 outline-none"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="overflow-x-auto max-h-[600px]">
                            <table className="w-full text-left text-sm">
                                <thead className="font-display font-bold text-xs text-muted uppercase tracking-[0.08em] bg-surface sticky top-0">
                                    <tr>
                                        <th className="p-3 font-bold">Time</th>
                                        <th className="p-3 font-bold">Status</th>
                                        <th className="p-3 font-bold">Tag</th>
                                        <th className="p-3 font-bold w-full">Details</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                    {filteredLogs.length === 0 ? (
                                        <tr><td colSpan={4} className="p-8 text-center text-faint">No logs found matching filters</td></tr>
                                    ) : (
                                        filteredLogs.map((log, i) => (
                                            <tr key={i} className={`log-row hover:bg-surface font-mono text-xs ${log.status === 'error' ? 'bg-brandred-600/5' : log.status === 'partial' ? 'bg-gold-500/5' : ''}`}>
                                                <td className="p-3 text-muted whitespace-nowrap num">
                                                    {(() => {
                                                        const ts2 = log.timestamp;
                                                        return ts2 && typeof ts2 === 'object' && 'toDate' in ts2 && typeof ts2.toDate === 'function'
                                                            ? ts2.toDate().toLocaleString()
                                                            : new Date(ts2 as string | number).toLocaleString();
                                                    })()}
                                                </td>
                                                <td className="p-3">
                                                    <span className={`px-2 py-0.5 rounded font-display font-bold uppercase tracking-[0.08em] ${log.status === 'success' ? 'bg-[#0F7B4A]/15 text-[#0F7B4A]' :
                                                        log.status === 'partial' ? 'bg-gold-500/15 text-gold-700 dark:text-gold-400' :
                                                            'bg-brandred-600/10 text-brandred-500'
                                                        }`}>
                                                        {(log.status as string | undefined)?.toUpperCase() ?? 'UNKNOWN'}
                                                    </span>
                                                </td>
                                                <td className="p-3">
                                                    {(() => {
                                                        const type = log.type || 'UNKNOWN';
                                                        let label = type;
                                                        let colorClass = 'bg-surface text-muted border border-line';

                                                        if (type === 'ESPN_FETCH_SUCCESS') { label = 'ESPN Update'; colorClass = 'bg-navy-600/10 text-navy-700 dark:text-gold-400 border border-navy-600/30'; }
                                                        else if (type === 'ESPN_FETCH_FAIL') { label = 'ESPN Error'; colorClass = 'bg-brandred-600/10 text-brandred-500 border border-brandred-600/30'; }
                                                        else if (type === 'SYNC_GAME_STATUS') { label = 'System Sync'; colorClass = 'bg-surface text-muted border border-line'; }
                                                        else if (type === 'POOL_SYNC_ERROR') { label = 'Pool Error'; colorClass = 'bg-gold-500/15 text-gold-700 dark:text-gold-400 border border-gold-500/30'; }
                                                        else if (type === 'SIMULATION') { label = 'Sim Run'; colorClass = 'bg-gold-500/10 text-gold-700 dark:text-gold-400 border border-gold-500/30'; }

                                                        return <span className={`px-2 py-0.5 rounded text-[10px] font-display font-bold uppercase tracking-[0.08em] whitespace-nowrap ${colorClass}`}>{label}</span>;
                                                    })()}
                                                </td>
                                                <td className="p-3 text-[color:var(--text)] w-full">
                                                    <div className="flex flex-col gap-1">
                                                        {log.message && <span className="font-bold text-[color:var(--text)] mb-1 block">{log.message}</span>}
                                                        {log.details !== undefined && <span className="font-mono text-[10px] text-faint">{String(log.details)}</span>}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'billing' && (
                <div className="w-full">
                    <SuperAdminBillingPanel />
                </div>
            )}

            {activeTab === 'settings' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2 bg-gold-500/15 rounded-lg text-gold-600 dark:text-gold-400"><Settings size={24} /></div>
                            <h3 className="text-xl font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)]">Feature Flags</h3>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-surface rounded-lg border border-line">
                                <div>
                                    <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)]">Enable Bracket Pools</h4>
                                    <p className="text-sm text-muted">Allow managers to create bracket pools.</p>
                                </div>
                                <button
                                    onClick={() => settingsService.update({ enableBracketPools: !settings?.enableBracketPools })}
                                    className={`transition-colors ${settings?.enableBracketPools ? 'text-[#0F7B4A]' : 'text-faint'} `}
                                >
                                    {settings?.enableBracketPools ? <ToggleRight size={40} className="fill-[#0F7B4A]/20" /> : <ToggleLeft size={40} />}
                                </button>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-surface rounded-lg border border-line">
                                <div>
                                    <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)]">Maintenance Mode</h4>
                                    <p className="text-sm text-muted">Disable all write actions for users.</p>
                                </div>
                                <button
                                    onClick={async () => {
                                        const turningOn = !settings?.maintenanceMode;
                                        const ok = await toast.confirm({
                                            title: turningOn ? 'Enable maintenance mode?' : 'Disable maintenance mode?',
                                            message: turningOn
                                                ? 'This disables ALL write actions for every user platform-wide (joins, picks, payments). Confirm you want to take the site read-only.'
                                                : 'This re-enables write actions for all users.',
                                            danger: turningOn,
                                        });
                                        if (ok) settingsService.update({ maintenanceMode: turningOn });
                                    }}
                                    className={`transition-colors ${settings?.maintenanceMode ? 'text-gold-500' : 'text-faint'} `}
                                >
                                    {settings?.maintenanceMode ? <ToggleRight size={40} className="fill-gold-500/20" /> : <ToggleLeft size={40} />}
                                </button>
                            </div>

                            {/* Live-score ticker speed. Higher seconds = slower scroll. Written to
                                system/config.tickerDurationSec; read live by NFLGameTicker. */}
                            <div className="flex items-center justify-between p-4 bg-surface rounded-lg border border-line">
                                <div>
                                    <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)]">Score Ticker Speed</h4>
                                    <p className="text-sm text-muted">Seconds for one full scroll of the live-score ticker. Higher = slower. Default 60.</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        min={15}
                                        max={180}
                                        step={5}
                                        key={settings?.tickerDurationSec ?? 60}
                                        defaultValue={settings?.tickerDurationSec ?? 60}
                                        onBlur={(e) => {
                                            const v = Math.max(15, Math.min(180, Math.round(Number(e.target.value) || 60)));
                                            if (v !== (settings?.tickerDurationSec ?? 60)) settingsService.update({ tickerDurationSec: v });
                                        }}
                                        className="w-20 px-2 py-1.5 text-right num font-display font-bold bg-page border border-line rounded-lg text-[color:var(--text)]"
                                        aria-label="Ticker scroll duration in seconds"
                                    />
                                    <span className="text-sm text-muted">sec</span>
                                </div>
                            </div>

                            {/* Auto-Close sweep (T2). Kill-switch OFF by default; when enabled it
                                runs daily but stays in dry-run (reports only) until Dry-Run is off. */}
                            <div className="flex items-center justify-between p-4 bg-surface rounded-lg border border-line">
                                <div>
                                    <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)]">Auto-Close Sweep</h4>
                                    <p className="text-sm text-muted">Daily job that closes stuck-open finished pools. {settings?.autoClose?.enabled ? (settings?.autoClose?.dryRun === false ? 'ENABLED — closing live.' : 'Enabled — dry-run (reports only).') : 'Disabled.'}</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => settingsService.update({ autoClose: { enabled: !settings?.autoClose?.enabled, dryRun: settings?.autoClose?.dryRun !== false } })}
                                        title="Enable / disable the daily sweep"
                                        className={`transition-colors ${settings?.autoClose?.enabled ? 'text-gold-500' : 'text-faint'}`}
                                    >
                                        {settings?.autoClose?.enabled ? <ToggleRight size={40} className="fill-gold-500/20" /> : <ToggleLeft size={40} />}
                                    </button>
                                    {settings?.autoClose?.enabled && (
                                        <button
                                            onClick={async () => {
                                                if (settings?.autoClose?.dryRun === false) {
                                                    settingsService.update({ autoClose: { enabled: true, dryRun: true } });
                                                } else {
                                                    const ok = await toast.confirm({ title: 'Arm live auto-close?', message: 'Turning off dry-run lets the daily sweep actually close pools. Review a few dry-run audit reports first.', danger: true });
                                                    if (ok) settingsService.update({ autoClose: { enabled: true, dryRun: false } });
                                                }
                                            }}
                                            className={`text-[10px] font-display font-bold uppercase tracking-[0.08em] px-3 py-2 rounded-lg border ${settings?.autoClose?.dryRun === false ? 'bg-brandred-600/10 text-brandred-500 border-brandred-600/25' : 'bg-surface text-muted border-line'}`}
                                        >
                                            {settings?.autoClose?.dryRun === false ? 'Live — click for dry-run' : 'Dry-run — click to arm live'}
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Per-pool-type creation flags (T5). Server-enforced: disabling a
                                type blocks its create callable end-to-end, not just the UI. */}
                            <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                                <h4 className="font-bold text-white mb-1">Pool Type Availability</h4>
                                <p className="text-sm text-slate-400 mb-4">Disabling a type hides its card on <span className="font-mono">/create-pool</span> and rejects new creation server-side.</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {POOL_TYPES.map((pt) => {
                                        const flags = resolvePoolTypeFlags(settings);
                                        const on = flags[pt];
                                        return (
                                            <div key={pt} className="flex items-center justify-between px-3 py-2 bg-slate-900/60 rounded-lg border border-slate-700/60">
                                                <span className="text-sm font-mono text-slate-200">{pt}</span>
                                                <button
                                                    aria-label={`Toggle ${pt} pool creation`}
                                                    onClick={() => settingsService.update({ poolTypeFlags: { ...flags, [pt]: !on } })}
                                                    className={on ? 'text-emerald-400' : 'text-slate-500'}
                                                >
                                                    {on ? <ToggleRight size={32} className="fill-emerald-500/20" /> : <ToggleLeft size={32} />}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )
            }
            {
                activeTab === 'referrals' && (
                    <div className="bg-card rounded-xl border border-line overflow-hidden shadow-card">
                        <div className="p-4 border-b border-line bg-surface flex justify-between items-center">
                            <h2 className="text-xl font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2"><Users className="text-gold-500" size={20} /> Referral Dashboard</h2>
                            <span className="text-xs font-mono text-faint">Top Referrers & Referral Chain</span>
                        </div>

                        {/* Referral Stats Row */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 border-b border-line">
                            <div className="bg-surface border border-line p-4 rounded-lg text-center">
                                <p className="text-3xl font-display font-bold text-navy-800 dark:text-gold-400 num">{users.reduce((sum, u) => sum + (u.referralCount || 0), 0)}</p>
                                <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em]">Total Referrals</p>
                            </div>
                            <div className="bg-surface border border-line p-4 rounded-lg text-center">
                                <p className="text-3xl font-display font-bold text-gold-600 dark:text-gold-400 num">{users.filter(u => u.referredBy).length}</p>
                                <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em]">Referred Users</p>
                            </div>
                            <div className="bg-surface border border-line p-4 rounded-lg text-center">
                                <p className="text-3xl font-display font-bold text-gold-600 dark:text-gold-400 num">{users.filter(u => (u.referralCount || 0) > 0).length}</p>
                                <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em]">Active Referrers</p>
                            </div>
                            <div className="bg-surface border border-line p-4 rounded-lg text-center">
                                <p className="text-3xl font-display font-bold text-[color:var(--text)] num">{users.length > 0 ? ((users.filter(u => u.referredBy).length / users.length) * 100).toFixed(1) : 0}%</p>
                                <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em]">Referral Rate</p>
                            </div>
                        </div>

                        {/* Top Referrers Leaderboard */}
                        <div className="p-4">
                            <h3 className="text-sm font-display font-bold text-[color:var(--text)] mb-3 uppercase tracking-[0.08em] flex items-center gap-1.5"><Trophy size={14} className="text-gold-500" /> Top Referrers</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                                {[...users]
                                    .filter(u => (u.referralCount || 0) > 0)
                                    .sort((a, b) => (b.referralCount || 0) - (a.referralCount || 0))
                                    .slice(0, 3)
                                    .map((u, i) => (
                                        <div key={u.id} className={`p-4 rounded-xl border ${i === 0 ? 'bg-gold-500/10 border-gold-500/40' : i === 1 ? 'bg-surface border-line' : 'bg-gold-700/10 border-gold-700/40'}`}>
                                            <div className="flex items-center gap-3">
                                                <div className={`text-2xl font-display font-extrabold num ${i === 0 ? 'text-gold-500' : i === 1 ? 'text-muted' : 'text-gold-700'}`}>#{i + 1}</div>
                                                <div className="flex-1 min-w-0">
                                                    <button onClick={() => handleViewUser(u)} className="font-bold text-[color:var(--text)] truncate hover:text-gold-600 dark:hover:text-gold-400">{u.name}</button>
                                                    <p className="text-xs text-muted truncate">{u.email}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-2xl font-display font-bold text-navy-800 dark:text-gold-400 num">{u.referralCount || 0}</p>
                                                    <p className="text-[10px] text-faint uppercase font-display font-bold tracking-[0.08em]">referrals</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                {users.filter(u => (u.referralCount || 0) > 0).length === 0 && (
                                    <div className="col-span-3 text-center py-8 text-faint">No referrals yet</div>
                                )}
                            </div>

                            {/* Full Referral Table */}
                            <h3 className="text-sm font-display font-bold text-[color:var(--text)] mb-3 uppercase tracking-[0.08em]">All Users Referral Data</h3>
                            <div className="overflow-x-auto rounded-lg border border-line">
                                <table className="w-full text-left text-sm">
                                    <thead className="font-display font-bold text-xs text-muted uppercase tracking-[0.08em] bg-surface">
                                        <tr>
                                            <th className="p-3 font-bold">User</th>
                                            <th className="p-3 font-bold">Referral Code</th>
                                            <th className="p-3 font-bold text-center">Referrals Made</th>
                                            <th className="p-3 font-bold">Referred By</th>
                                            <th className="p-3 font-bold">Joined</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line">
                                        {[...users]
                                            .sort((a, b) => (b.referralCount || 0) - (a.referralCount || 0))
                                            .map(u => {
                                                const referrer = u.referredBy ? users.find(ref => ref.id === u.referredBy) : null;
                                                return (
                                                    <tr key={u.id} className="hover:bg-surface">
                                                        <td className="p-3">
                                                            <button onClick={() => handleViewUser(u)} className="font-bold text-[color:var(--text)] hover:text-gold-600 dark:hover:text-gold-400">{u.name}</button>
                                                            <p className="text-xs text-faint">{u.email}</p>
                                                        </td>
                                                        <td className="p-3">
                                                            <code className="text-xs bg-surface border border-line px-2 py-1 rounded text-gold-700 dark:text-gold-400 font-mono">{u.referralCode || u.id.slice(0, 8)}</code>
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            <span className={`font-bold num ${(u.referralCount || 0) > 0 ? 'text-navy-700 dark:text-gold-400' : 'text-faint'} `}>{u.referralCount || 0}</span>
                                                        </td>
                                                        <td className="p-3">
                                                            {referrer ? (
                                                                <span className="text-gold-600 dark:text-gold-400 text-xs">{referrer.name}</span>
                                                            ) : u.referredBy ? (
                                                                <span className="text-faint text-xs font-mono">{u.referredBy.slice(0, 8)}...</span>
                                                            ) : (
                                                                <span className="text-faint text-xs">—</span>
                                                            )}
                                                        </td>
                                                        <td className="p-3 text-xs text-faint">
                                                            {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* POOL DETAILS MODAL */}
            {
                viewingPool && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                        {/* T2: the pool-detail modal's sub-tab. Mounted only while
                            the modal is open, so it retracts when it closes. */}
                        <HelpRoutePublisher subTab={modalTab} />
                        <div className="bg-card border border-line rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-panel flex flex-col">
                            {/* Modal Header */}
                            <div className="p-6 border-b border-line flex justify-between items-start bg-surface">
                                <div>
                                    <h2 className="text-2xl font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-1 flex items-center gap-2">
                                        {viewingPool.name}
                                        {viewingPool.type !== 'BRACKET' && (viewingPool as GameState).charity?.enabled && <Heart size={20} className="text-brandred-500 fill-brandred-500 animate-pulse" />}
                                    </h2>
                                    <p className="text-muted font-body text-sm">
                                        ID: <span className="font-mono text-faint">{viewingPool.id}</span>
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {(viewingPool.type === 'NFL_PLAYOFFS' || viewingPool.type === 'BRACKET') && (
                                        <button
                                            onClick={async () => {
                                                const ok = await toast.confirm({
                                                    title: 'Update Max Entries?',
                                                    message: `Update Max Entries to 50 for pool: ${viewingPool.name}?`,
                                                });
                                                if (!ok) return;
                                                try {
                                                    const poolRef = doc(db, 'pools', viewingPool.id);
                                                    await updateDoc(poolRef, {
                                                        'settings.maxEntriesPerUser': 50,
                                                        'settings.maxEntriesTotal': 500
                                                    });
                                                    toast.success('Success: Max entries updated to 50!');
                                                } catch (err: unknown) {
                                                    logger.error(err);
                                                    toast.error(getUserMessage(err, 'Failed to update max entries.'));
                                                }
                                            }}
                                            className="px-3 py-1.5 bg-gold-500/10 text-gold-700 dark:text-gold-400 hover:bg-gold-500/20 border border-gold-500/50 rounded-lg text-xs font-display font-bold uppercase tracking-[0.05em] transition-all"
                                        >
                                            Fix Max Entries
                                        </button>
                                    )}
                                    <button onClick={() => setViewingPool(null)} className="p-2 hover:bg-surface rounded-lg text-muted hover:text-[color:var(--text)] transition-colors">
                                        <span className="sr-only">Close</span>
                                        <X size={20} />
                                    </button>
                                </div>
                            </div>

                            {/* Modal Tabs Navigation */}
                            <div className="flex border-b border-line bg-surface px-6 py-2 overflow-x-auto gap-2">
                                {[
                                    { id: 'overview', label: 'Overview & Stats' },
                                    { id: 'settings', label: 'Edit Settings (Override)' },
                                    { id: 'participants', label: `Manage Participants (${viewingPoolEntries.length})` },
                                    { id: 'dangerous', label: 'Dangerous Ops' }
                                ].map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setModalTab(tab.id as any)}
                                        className={`px-4 py-2 text-xs font-display font-bold uppercase tracking-[0.08em] rounded-lg transition-all ${
                                            modalTab === tab.id
                                                ? 'bg-navy-800 text-white shadow-card'
                                                : 'text-muted hover:text-[color:var(--text)] hover:bg-card'
                                        }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            {/* Scrollable Content Area */}
                            <div className="p-6 flex-1 overflow-y-auto space-y-6">
                                {modalTab === 'overview' && (
                                    <div className="space-y-6">
                                        {/* Meta Data */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="bg-surface p-4 rounded-xl border border-line">
                                                <h4 className="text-muted text-xs font-display font-bold uppercase tracking-[0.08em] mb-1">Created At</h4>
                                                <p className="font-medium text-[color:var(--text)] text-lg num">
                                                    {typeof viewingPool.createdAt === 'number'
                                                        ? new Date(viewingPool.createdAt).toLocaleString()
                                                        : (viewingPool.createdAt?.seconds
                                                            ? new Date(viewingPool.createdAt.seconds * 1000).toLocaleString()
                                                            : <span className="italic text-faint">Unknown Date</span>)}
                                                </p>
                                            </div>
                                            <div className="bg-surface p-4 rounded-xl border border-line">
                                                <h4 className="text-muted text-xs font-display font-bold uppercase tracking-[0.08em] mb-1">Owner</h4>
                                                <p className="font-medium text-[color:var(--text)] text-lg">
                                                    {users.find(u => u.id === (viewingPool.type === 'BRACKET' ? (viewingPool as unknown as PoolLike).managerUid as string : (viewingPool as unknown as PoolLike).ownerId as string))?.name || 'Unknown User'}
                                                </p>
                                                <p className="text-xs text-faint font-mono mt-1 break-all">
                                                    UID: {viewingPool.type === 'BRACKET' ? (viewingPool as unknown as PoolLike).managerUid as string : (viewingPool as unknown as PoolLike).ownerId as string}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Status */}
                                        <div className="bg-surface p-6 rounded-xl border border-line">
                                            <h3 className="text-sm font-display font-bold text-[color:var(--text)] uppercase tracking-[0.08em] mb-4">Live Statistics</h3>
                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                                <div className="bg-card p-4 rounded-lg border border-line">
                                                    <div className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em]">State</div>
                                                    <div className="text-2xl font-display font-bold text-[color:var(--text)] mt-1 num">
                                                        {viewingPool.type === 'BRACKET'
                                                            ? (viewingPool as unknown as PoolLike).status as string
                                                            : ((viewingPool as GameState).isLocked ? "LOCKED" : "OPEN")}
                                                    </div>
                                                </div>
                                                <div className="bg-card p-4 rounded-lg border border-line">
                                                    <div className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em]">Entries</div>
                                                    <div className="text-2xl font-display font-bold text-[color:var(--text)] mt-1 num">
                                                        {viewingPoolEntries.length}
                                                    </div>
                                                </div>
                                                <div className="bg-card p-4 rounded-lg border border-line">
                                                    <div className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em]">Cost / Fee</div>
                                                    <div className="text-2xl font-display font-bold text-gold-700 dark:text-gold-400 mt-1 num">
                                                        ${adminEntryFee}
                                                    </div>
                                                </div>
                                                <div className="bg-card p-4 rounded-lg border border-line">
                                                    <div className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em]">Total Pot</div>
                                                    <div className="text-2xl font-display font-bold text-gold-700 dark:text-gold-400 mt-1 num">
                                                        ${viewingPoolEntries.length * adminEntryFee}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Charity Info */}
                                        {viewingPool.type !== 'BRACKET' && (viewingPool as GameState).charity?.enabled && (
                                            <div className="bg-brandred-600/5 p-5 rounded-xl border border-brandred-600/20 flex gap-4 items-start">
                                                <div className="p-3 bg-brandred-600/10 rounded-lg text-brandred-500">
                                                    <Heart size={24} fill="currentColor" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="text-brandred-500 text-xs font-display font-bold uppercase tracking-[0.08em] mb-1">Fundraising for Charity</h4>
                                                    <p className="text-[color:var(--text)] font-bold text-lg">{(viewingPool as GameState).charity?.name}</p>
                                                    <a href={(viewingPool as GameState).charity?.url} target="_blank" rel="noreferrer" className="text-brandred-500 text-sm hover:underline truncate block mt-0.5">{(viewingPool as GameState).charity?.url}</a>
                                                    <p className="text-xs text-brandred-500/80 mt-2 bg-brandred-600/10 px-3 py-1.5 rounded-lg w-fit num">Donating {(viewingPool as GameState).charity?.percentage}% of the pot</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {modalTab === 'settings' && (
                                    <div className="space-y-4 max-w-xl mx-auto bg-surface p-6 rounded-xl border border-line">
                                        <h3 className="text-lg font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-2 flex items-center gap-2 border-b border-line pb-2">
                                            <Settings size={20} className="text-gold-500" /> Pool Configuration Overrides
                                        </h3>
                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-xs uppercase text-muted font-display font-bold tracking-[0.08em] mb-1.5">Pool Name</label>
                                                <input
                                                    type="text"
                                                    value={adminPoolName}
                                                    onChange={e => setAdminPoolName(e.target.value)}
                                                    className="w-full bg-card border border-line rounded-xl p-3 font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600 transition-colors"
                                                />
                                            </div>
                                            
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs uppercase text-muted font-display font-bold tracking-[0.08em] mb-1.5">Entry Cost / Fee ($)</label>
                                                    <input
                                                        type="number"
                                                        value={adminEntryFee}
                                                        onChange={e => setAdminEntryFee(Number(e.target.value))}
                                                        className="w-full bg-card border border-line rounded-xl p-3 font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600 transition-colors"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs uppercase text-muted font-display font-bold tracking-[0.08em] mb-1.5">Privacy Status</label>
                                                    <button
                                                        type="button"
                                                        onClick={() => setAdminIsPublic(!adminIsPublic)}
                                                        className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                                                            adminIsPublic
                                                                ? 'bg-gold-500/10 border-gold-500/50 text-gold-700 dark:text-gold-400 font-bold'
                                                                : 'bg-card border-line text-muted font-medium'
                                                        }`}
                                                    >
                                                        <span className="flex items-center gap-1.5">{adminIsPublic ? <><Globe size={14} /> Publicly Listed</> : <><Lock size={14} /> Private (Invite Only)</>}</span>
                                                        <span className="text-xs">{adminIsPublic ? 'Public' : 'Private'}</span>
                                                    </button>
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-xs uppercase text-muted font-display font-bold tracking-[0.08em] mb-1.5">Payment Instructions</label>
                                                <textarea
                                                    rows={4}
                                                    value={adminInstructions}
                                                    onChange={e => setAdminInstructions(e.target.value)}
                                                    placeholder="Specify how participants should pay (e.g. Venmo, PayPal link, etc.)"
                                                    className="w-full bg-card border border-line rounded-xl p-3 font-body text-[color:var(--text)] focus:outline-none focus:border-navy-600 transition-colors font-sans resize-none"
                                                />
                                            </div>

                                            <div className="pt-2">
                                                <button
                                                    onClick={handleSavePoolSettingsAdmin}
                                                    className="w-full bg-brandred-600 hover:bg-brandred-500 text-white font-display font-bold uppercase tracking-[0.05em] py-3 rounded-xl transition-all shadow-red-cta flex items-center justify-center gap-2"
                                                >
                                                    <CheckCircle size={18} />
                                                    Save Settings Override
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {modalTab === 'participants' && (
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-3">
                                            <div className="relative flex-1">
                                                <Search className="absolute left-3 top-3.5 text-muted" size={18} />
                                                <input
                                                    type="text"
                                                    placeholder="Search participants by name, email, or entry ID..."
                                                    value={adminSearchEntry}
                                                    onChange={e => setAdminSearchEntry(e.target.value)}
                                                    className="w-full bg-surface border border-line rounded-xl py-3 pl-10 pr-4 font-body text-[color:var(--text)] placeholder:text-faint focus:outline-none focus:border-navy-600 transition-colors"
                                                />
                                            </div>
                                        </div>

                                        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                                            <table className="w-full text-left text-sm whitespace-nowrap">
                                                <thead className="font-display font-bold text-xs text-muted uppercase tracking-[0.08em] bg-surface">
                                                    <tr>
                                                        <th className="p-4 font-bold">Player details</th>
                                                        <th className="p-4 font-bold text-center">Score</th>
                                                        <th className="p-4 font-bold text-center">Tiebreaker</th>
                                                        <th className="p-4 font-bold text-center">Payout</th>
                                                        <th className="p-4 font-bold text-center">Picks</th>
                                                        <th className="p-4 font-bold text-center">Payment Status</th>
                                                        <th className="p-4 font-bold text-center">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-line font-body">
                                                    {viewingPoolEntries
                                                        .filter(e => {
                                                            if (!adminSearchEntry) return true;
                                                            const term = adminSearchEntry.toLowerCase();
                                                            return (
                                                                (e.name || '').toLowerCase().includes(term) ||
                                                                (e.email || '').toLowerCase().includes(term) ||
                                                                (e.id || '').toLowerCase().includes(term)
                                                            );
                                                        })
                                                        .map(entry => {
                                                            const isExpanded = expandedPicksEntryId === entry.id;
                                                            return (
                                                                <React.Fragment key={entry.id}>
                                                                    <tr className="hover:bg-card transition-colors">
                                                                        <td className="p-4">
                                                                            <div className="font-bold text-[color:var(--text)]">{entry.name || 'Unnamed Player'}</div>
                                                                            <div className="text-xs text-muted flex items-center gap-1.5 mt-0.5">
                                                                                <span>{entry.email}</span>
                                                                                <span className="text-faint">•</span>
                                                                                <span className="font-mono text-faint">{entry.id}</span>
                                                                            </div>
                                                                        </td>
                                                                        <td className="p-4 text-center">
                                                                            <input
                                                                                type="number"
                                                                                value={entryScoreOverrides[entry.id] ?? ''}
                                                                                onChange={e => setEntryScoreOverrides({
                                                                                    ...entryScoreOverrides,
                                                                                    [entry.id]: e.target.value
                                                                                })}
                                                                                className="w-16 bg-card border border-line rounded-lg p-1 text-center font-bold text-[color:var(--text)] num focus:outline-none focus:border-navy-600"
                                                                            />
                                                                        </td>
                                                                        <td className="p-4 text-center">
                                                                            <input
                                                                                type="number"
                                                                                value={entryTiebreakerOverrides[entry.id] ?? ''}
                                                                                onChange={e => setEntryTiebreakerOverrides({
                                                                                    ...entryTiebreakerOverrides,
                                                                                    [entry.id]: e.target.value
                                                                                })}
                                                                                className="w-16 bg-card border border-line rounded-lg p-1 text-center text-[color:var(--text)] num focus:outline-none focus:border-navy-600"
                                                                            />
                                                                        </td>
                                                                        <td className="p-4 text-center">
                                                                            <input
                                                                                type="number"
                                                                                value={entryPayoutOverrides[entry.id] ?? ''}
                                                                                onChange={e => setEntryPayoutOverrides({
                                                                                    ...entryPayoutOverrides,
                                                                                    [entry.id]: e.target.value
                                                                                })}
                                                                                className="w-20 bg-card border border-line rounded-lg p-1 text-center font-bold text-gold-700 dark:text-gold-400 num focus:outline-none focus:border-navy-600"
                                                                            />
                                                                        </td>
                                                                        <td className="p-4 text-center">
                                                                            <button
                                                                                onClick={() => setExpandedPicksEntryId(isExpanded ? null : entry.id)}
                                                                                className="px-2.5 py-1.5 bg-card hover:bg-surface rounded-lg border border-line text-xs font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] transition-colors"
                                                                            >
                                                                                {isExpanded ? 'Hide Picks' : `View Picks (${entry.picks ? Object.keys(entry.picks).length : 0})`}
                                                                            </button>
                                                                        </td>
                                                                        <td className="p-4 text-center">
                                                                            <button
                                                                                onClick={() => handleToggleEntryPaidAdmin(entry.id, entry.paidStatus)}
                                                                                className={`px-3 py-1.5 rounded-full text-xs font-display font-bold uppercase tracking-[0.08em] border transition-all ${
                                                                                    entry.paidStatus === 'PAID'
                                                                                        ? 'bg-[#E4F5EC] border-[#BEE7D0] text-[#0F7B4A]'
                                                                                        : 'bg-[#FBEEDD] border-[#F2D6B0] text-[#B4530A]'
                                                                                }`}
                                                                            >
                                                                                {entry.paidStatus === 'PAID' ? 'PAID' : 'UNPAID'}
                                                                            </button>
                                                                        </td>
                                                                        <td className="p-4 text-center">
                                                                            <div className="flex justify-center items-center gap-2">
                                                                                <button
                                                                                    onClick={() => handleSaveEntryOverridesAdmin(entry.id)}
                                                                                    title="Save Changes"
                                                                                    className="p-2 bg-navy-600/15 hover:bg-navy-600/25 text-navy-700 dark:text-gold-400 border border-navy-600/40 rounded-lg transition-colors"
                                                                                >
                                                                                    <CheckCircle size={16} />
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => handleDeleteEntryAdmin(entry.id, entry.name)}
                                                                                    title="Delete Entry"
                                                                                    className="p-2 bg-brandred-600/10 hover:bg-brandred-600/20 text-brandred-500 border border-brandred-600/40 rounded-lg transition-colors"
                                                                                >
                                                                                    <Trash2 size={16} />
                                                                                </button>
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                    {isExpanded && (
                                                                        <tr className="bg-surface">
                                                                            <td colSpan={7} className="p-4 border-l border-r border-line">
                                                                                <div className="p-4 bg-card border border-line rounded-xl space-y-3">
                                                                                    <div className="flex justify-between items-center border-b border-line pb-2">
                                                                                        <span className="text-xs text-faint uppercase font-display font-bold tracking-[0.08em]">Raw Picks Sheet</span>
                                                                                        <span className="text-[10px] bg-surface border border-line px-2 py-0.5 rounded-lg text-muted">JSON Format</span>
                                                                                    </div>
                                                                                    <pre className="text-xs text-[color:var(--text)] font-mono overflow-x-auto whitespace-pre-wrap max-h-40 leading-relaxed bg-surface p-3 rounded-lg border border-line">
                                                                                        {entry.picks ? JSON.stringify(entry.picks, null, 2) : 'No picks submitted yet.'}
                                                                                    </pre>
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    )}
                                                                </React.Fragment>
                                                            );
                                                        })}
                                                    {viewingPoolEntries.length === 0 && (
                                                        <tr>
                                                            <td colSpan={7} className="p-8 text-center text-faint">
                                                                No entries found in this pool.
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}

                                {modalTab === 'dangerous' && (
                                    <div className="space-y-6 max-w-xl mx-auto bg-brandred-600/5 p-6 rounded-xl border border-brandred-600/40">
                                        <h3 className="text-lg font-display font-bold uppercase tracking-[0.05em] mb-2 flex items-center gap-2 border-b border-brandred-600/30 pb-2 text-brandred-500">
                                            <Shield size={20} className="text-brandred-500 animate-pulse" /> Super Administrative Overrides
                                        </h3>
                                        <div className="space-y-4">
                                            <div className="p-4 bg-surface rounded-xl border border-line flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                                <div>
                                                    <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] text-sm">Synchronize Scores & Sync</h4>
                                                    <p className="text-xs text-faint mt-0.5">Force recalculating entries and pull results from ESPN.</p>
                                                </div>
                                                <button
                                                    onClick={() => handleFixScores(viewingPool as GameState)}
                                                    className="w-full sm:w-auto px-4 py-2.5 bg-navy-800 hover:bg-navy-700 text-white rounded-xl text-xs font-display font-bold uppercase tracking-[0.05em] transition-all shadow-card flex items-center justify-center gap-1.5"
                                                >
                                                    <RefreshCw size={14} />
                                                    Process ESPN Sync
                                                </button>
                                            </div>

                                            {viewingPool.type === 'BRACKET' && (
                                                <div className="p-4 bg-surface rounded-xl border border-line flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                                    <div>
                                                        <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] text-sm">Force Re-Open Pool</h4>
                                                        <p className="text-xs text-faint mt-0.5">Change status back to OPEN to allow participants to edit picks.</p>
                                                    </div>
                                                    <button
                                                        onClick={() => handleForceReopenPool(viewingPool)}
                                                        className="w-full sm:w-auto px-4 py-2.5 bg-navy-800 hover:bg-navy-700 text-white rounded-xl text-xs font-display font-bold uppercase tracking-[0.05em] transition-all shadow-card flex items-center justify-center gap-1.5"
                                                    >
                                                        <Lock size={14} />
                                                        Force Re-Open
                                                    </button>
                                                </div>
                                            )}

                                            {viewingPool.type === 'BRACKET' && (
                                                <div className="p-4 bg-surface rounded-xl border border-line flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                                    <div>
                                                        <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] text-sm">Close Pool Settings</h4>
                                                        <p className="text-xs text-faint mt-0.5">Lock pool and transition status directly to COMPLETED.</p>
                                                    </div>
                                                    <button
                                                        onClick={() => { handleClosePool(viewingPool as unknown as Pool); setViewingPool(null); }}
                                                        className="w-full sm:w-auto px-4 py-2.5 bg-brandred-600 hover:bg-brandred-500 text-white rounded-xl text-xs font-display font-bold uppercase tracking-[0.05em] transition-all shadow-red-cta"
                                                    >
                                                        Close Pool
                                                    </button>
                                                </div>
                                            )}

                                            <div className="p-4 bg-surface rounded-xl border border-line flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                                <div>
                                                    <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] text-sm">Manage Live Site Panel</h4>
                                                    <p className="text-xs text-faint mt-0.5">Open the host custom settings wizard panel directly.</p>
                                                </div>
                                                <button
                                                    onClick={() => window.location.href = `/admin/${viewingPool.id}`}
                                                    className="w-full sm:w-auto px-4 py-2.5 bg-card hover:bg-page border border-line text-[color:var(--text)] rounded-xl text-xs font-display font-bold uppercase tracking-[0.05em] transition-all shadow-card text-center"
                                                >
                                                    Configure settings
                                                </button>
                                            </div>

                                            <div className="p-4 bg-brandred-600/5 rounded-xl border border-brandred-600/40 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                                <div>
                                                    <h4 className="font-display font-bold uppercase tracking-[0.05em] text-brandred-500 text-sm">Destroy Pool and Contents</h4>
                                                    <p className="text-xs text-brandred-500/70 mt-0.5">Permanently delete pool configuration, entries, logs, and statistics.</p>
                                                </div>
                                                <button
                                                    onClick={() => { handleDeletePool(viewingPool.id); setViewingPool(null); }}
                                                    className="w-full sm:w-auto px-4 py-2.5 bg-brandred-600 hover:bg-brandred-700 text-white rounded-xl text-xs font-display font-bold uppercase tracking-[0.05em] transition-all shadow-red-cta"
                                                >
                                                    Super Delete Pool
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }

            {/* EDIT USER MODAL (Existing logic preserved, just styling tweaks if needed) */}
            {
                editingUser && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                        <div className="bg-card p-6 rounded-xl border border-line w-full max-w-md shadow-panel">
                            <h3 className="text-xl font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-4">Edit User</h3>
                            <div className="space-y-4 mb-6">
                                <div>
                                    <label className="block text-xs uppercase text-muted font-display font-bold tracking-[0.08em] mb-1">Name</label>
                                    <input value={editName} onChange={e => setEditName(e.target.value)} className="w-full bg-surface border border-line rounded p-2 font-body text-[color:var(--text)]" />
                                </div>
                                <div>
                                    <label className="block text-xs uppercase text-muted font-display font-bold tracking-[0.08em] mb-1">Email</label>
                                    <input value={editEmail} onChange={e => setEditEmail(e.target.value)} className="w-full bg-surface border border-line rounded p-2 font-body text-[color:var(--text)]" />
                                </div>
                            </div>
                            <div className="flex justify-end gap-3">
                                <button onClick={() => setEditingUser(null)} className="text-muted hover:text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em] text-sm">Cancel</button>
                                <button onClick={saveUserChanges} className="bg-brandred-600 hover:bg-brandred-500 text-white px-4 py-2 rounded font-display font-bold uppercase tracking-[0.05em] text-sm shadow-red-cta">Save Changes</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* VIEW USER MODAL (Existing logic preserved) */}
            {
                viewingUser && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                        <div className="bg-card border border-line rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-panel flex flex-col">
                            <div className="p-6 border-b border-line flex justify-between items-start bg-surface rounded-t-2xl">
                                <div>
                                    <h2 className="text-3xl font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-1">{viewingUser.name}</h2>
                                    <p className="text-muted font-body flex items-center gap-2 text-sm">
                                        <span className="bg-card px-2 py-0.5 rounded text-[color:var(--text)] border border-line">ID: {viewingUser.id}</span>
                                        <span className="text-faint">•</span>
                                        <span>{viewingUser.email}</span>
                                    </p>
                                </div>
                                <button onClick={() => setViewingUser(null)} className="p-2 hover:bg-surface rounded-lg text-muted hover:text-[color:var(--text)] transition-colors">
                                    <span className="sr-only">Close</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>

                            <div className="p-6">
                                {/* Member actions — reuse the row handlers so every user action
                                    is reachable from the detail popup, not just the table row. */}
                                <div className="flex flex-wrap gap-2 mb-6">
                                    <button
                                        onClick={() => handleEmailUser(viewingUser)}
                                        className="text-xs bg-navy-800 hover:bg-navy-700 text-white px-3 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] flex items-center gap-1.5 transition-colors"
                                    >
                                        <Mail size={14} /> Email User
                                    </button>
                                    <button
                                        onClick={() => handleResetPassword(viewingUser)}
                                        className="text-xs bg-navy-800 hover:bg-navy-700 text-white px-3 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] flex items-center gap-1.5 transition-colors"
                                    >
                                        <KeyRound size={14} /> Reset Password
                                    </button>
                                    <button
                                        onClick={() => { const u = viewingUser; setViewingUser(null); handleEditUser(u); }}
                                        className="text-xs bg-gold-500 hover:bg-gold-400 text-navy-900 px-3 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] flex items-center gap-1.5 transition-colors"
                                    >
                                        <Wrench size={14} /> Edit User
                                    </button>
                                </div>
                                {/* Unified profile facts (T6): role + referrals + loyalty + account in one place. */}
                                {(() => {
                                    const ownedCount = pools.filter(p => {
                                        const owner = p.type === 'BRACKET' ? (p as unknown as PoolLike).managerUid as string : (p as unknown as PoolLike).ownerId as string;
                                        return owner === viewingUser.id;
                                    }).length;
                                    const tier = [...activeTiers].reverse().find(t => ownedCount >= (t.minPools || 0));
                                    const facts = [
                                        { label: 'Role', value: roleBadge(viewingUser.role).label },
                                        { label: 'Referrals', value: String(getComputedReferrals(viewingUser.id)) },
                                        { label: 'Loyalty Tier', value: tier?.name || '—' },
                                        { label: 'Method', value: (viewingUser.registrationMethod || 'email').toUpperCase() },
                                        { label: 'Pools Owned', value: String(ownedCount) },
                                    ];
                                    return (
                                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                                            {facts.map(f => (
                                                <div key={f.label} className="bg-surface border border-line rounded-xl p-3">
                                                    <p className="text-[9px] uppercase tracking-[0.16em] text-muted font-display font-bold mb-1">{f.label}</p>
                                                    <p className="text-sm font-display font-bold text-[color:var(--text)] truncate">{f.value}</p>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })()}

                                <h3 className="text-xl font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-4 flex items-center gap-2">
                                    <Activity size={20} className="text-gold-500" /> Pools Managed by {viewingUser.name.split(' ')[0]}
                                </h3>

                                {pools.filter(p => {
                                    const owner = p.type === 'BRACKET' ? (p as unknown as PoolLike).managerUid as string : (p as unknown as PoolLike).ownerId as string;
                                    return owner === viewingUser.id;
                                }).length === 0 ? (
                                    <div className="p-8 text-center bg-surface rounded-xl border border-dashed border-line">
                                        <p className="text-faint font-medium">No pools found for this user.</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {pools.filter(p => {
                                            const owner = p.type === 'BRACKET' ? (p as unknown as PoolLike).managerUid as string : (p as unknown as PoolLike).ownerId as string;
                                            return owner === viewingUser.id;
                                        }).map(pool => {
                                            const isBracket = pool.type === 'BRACKET';
                                            return (
                                                <div key={pool.id} className="bg-card border border-line rounded-xl p-5 hover:border-gold-500/50 hover:-translate-y-1 hover:shadow-card-hover transition-all duration-150 group">
                                                    <div className="flex justify-between items-start mb-3">
                                                        <div>
                                                            <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] text-lg group-hover:text-gold-600 dark:group-hover:text-gold-400 transition-colors">{pool.name}</h4>
                                                            <p className="text-xs text-muted uppercase font-display font-bold tracking-[0.08em] mt-1">
                                                                {formatPoolMatchup(pool as unknown as { type?: string; awayTeam?: string; homeTeam?: string })}
                                                            </p>
                                                        </div>
                                                        {!isBracket && (pool as GameState).charity?.enabled && <Heart size={16} className="text-brandred-500 fill-brandred-500" />}
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-2 text-sm text-muted mb-4 bg-surface border border-line p-3 rounded-lg">
                                                        {/* Counted through getPoolEntrySummary so this card can't repeat the
                                                            pool-list bug where NFL season pools read an `entryCount` no server
                                                            path maintains and always showed 0. */}
                                                        {(() => {
                                                            const summary = getPoolEntrySummary(pool as unknown as EntryCountable);
                                                            const label = summary.unit.charAt(0).toUpperCase() + summary.unit.slice(1);
                                                            return (
                                                                <div>{label}: <span className="text-[color:var(--text)] font-mono num">{summary.capacity ? `${summary.count}/${summary.capacity}` : summary.count}</span></div>
                                                            );
                                                        })()}
                                                        {isBracket ? (
                                                            <div>Status: <span className={(pool as unknown as PoolLike).status === 'LOCKED' ? "text-brandred-500 font-bold" : "text-gold-600 dark:text-gold-400 font-bold"}>{(pool as unknown as PoolLike).status as string || 'OPEN'}</span></div>
                                                        ) : (
                                                            <div>Status: <span className={(pool as GameState).isLocked ? "text-brandred-500 font-bold" : "text-gold-600 dark:text-gold-400 font-bold"}>{(pool as GameState).isLocked ? 'LOCKED' : 'OPEN'}</span></div>
                                                        )}
                                                    </div>

                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => {
                                                                window.location.href = `/admin/${pool.id}`;
                                                                setViewingUser(null);
                                                            }}
                                                            className="flex-1 bg-brandred-600 hover:bg-brandred-500 text-white py-2 rounded font-display font-bold uppercase tracking-[0.05em] text-sm transition-colors text-center"
                                                        >
                                                            Manage Pool
                                                        </button>
                                                        <a
                                                            href={`#pool/${pool.id}`}
                                                            target="_blank"
                                                            className="flex-1 bg-navy-800 hover:bg-navy-700 text-white py-2 rounded font-display font-bold uppercase tracking-[0.05em] text-sm transition-colors text-center"
                                                        >
                                                            {isBracket ? 'View Bracket' : 'View Grid'}
                                                        </a>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }

            {
                showSimDashboard && (
                    <SimulationDashboard pools={pools} onClose={() => setShowSimDashboard(false)} />
                )
            }

            {/* ============ PROPS TAB ============ */}
            {
                activeTab === 'props' && (
                    <div className="space-y-6">
                        {/* Manage Categories Section */}
                        <div className="bg-card p-6 rounded-xl border border-line shadow-card">
                            <h3 className="text-xl font-display font-bold uppercase tracking-[0.05em] mb-4">Manage Global Categories</h3>
                            <div className="flex flex-wrap gap-2 mb-4">
                                {availableCategories.map(cat => (
                                    <div key={cat} className="flex items-center gap-1 bg-surface text-[color:var(--text)] px-3 py-1 rounded-full text-sm font-display font-bold uppercase tracking-[0.05em] border border-line">
                                        <span>{cat}</span>
                                        <button
                                            onClick={() => handleRemoveCategory(cat)}
                                            className="hover:text-brandred-500 p-0.5 rounded-full transition-colors"
                                            title="Remove Category"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <input
                                    className="bg-surface border border-line p-2 rounded font-body text-[color:var(--text)] text-sm"
                                    placeholder="New Category Name"
                                    value={newCategoryName}
                                    onChange={e => setNewCategoryName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                                />
                                <button
                                    onClick={handleAddCategory}
                                    disabled={!newCategoryName}
                                    className="bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2"
                                >
                                    <Plus size={16} /> Add
                                </button>
                            </div>
                        </div>

                        {/* When editing (gear clicked), the form floats as a modal so a
                            low seed in the list can be edited without scrolling to the top.
                            When adding, it stays inline. */}
                        <div
                            className={editingSeed ? "fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto p-6" : ""}
                            onClick={editingSeed ? (e) => { if (e.target === e.currentTarget) { setEditingSeed(null); setSeedText(''); setSeedOpt1(''); setSeedOpt2(''); } } : undefined}
                        >
                        <div className={`bg-card p-6 rounded-xl border border-line shadow-card${editingSeed ? ' max-w-2xl w-full mt-10 shadow-2xl' : ''}`}>
                            <h3 className="text-xl font-display font-bold uppercase tracking-[0.05em] mb-4">{editingSeed ? 'Edit Seed Question' : 'Add New Seed Question'}</h3>
                            <div className="grid gap-4 bg-surface border border-line p-4 rounded-lg">
                                <input
                                    className="w-full bg-card border border-line p-2 rounded font-body text-[color:var(--text)]"
                                    placeholder="Question Text (e.g. Who wins the coin toss?)"
                                    value={seedText}
                                    onChange={e => setSeedText(e.target.value)}
                                />
                                <div className="grid grid-cols-2 gap-4">
                                    <input
                                        className="w-full bg-card border border-line p-2 rounded font-body text-[color:var(--text)]"
                                        placeholder="Option 1 (e.g. Heads)"
                                        value={seedOpt1}
                                        onChange={e => setSeedOpt1(e.target.value)}
                                    />
                                    <input
                                        className="w-full bg-card border border-line p-2 rounded font-body text-[color:var(--text)]"
                                        placeholder="Option 2 (e.g. Tails)"
                                        value={seedOpt2}
                                        onChange={e => setSeedOpt2(e.target.value)}
                                    />
                                </div>

                                <div>
                                    <label className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em] mb-2 block">Categories</label>
                                    <div className="flex flex-wrap gap-2">
                                        {availableCategories.map(cat => (
                                            <button
                                                key={cat}
                                                onClick={() => toggleCategory(cat)}
                                                className={`px-3 py-1 rounded-full text-xs font-display font-bold uppercase tracking-[0.05em] transition-all border ${seedCategories.includes(cat)
                                                    ? 'bg-navy-800 text-white border-navy-700'
                                                    : 'bg-card text-muted border-line hover:border-navy-600'
                                                    }`}
                                            >
                                                {cat}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex justify-end gap-2">
                                    {editingSeed && (
                                        <button
                                            onClick={() => { setEditingSeed(null); setSeedText(''); setSeedOpt1(''); setSeedOpt2(''); }}
                                            className="px-4 py-2 text-muted hover:text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em]"
                                        >
                                            Cancel
                                        </button>
                                    )}
                                    <button
                                        onClick={handleSaveSeed}
                                        disabled={!seedText || !seedOpt1 || !seedOpt2}
                                        className="bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2 rounded font-display font-bold uppercase tracking-[0.05em] shadow-red-cta"
                                    >
                                        {editingSeed ? 'Update Seed' : 'Add Seed'}
                                    </button>
                                </div>
                            </div>
                        </div>
                        </div>

                        <div className="bg-card rounded-xl border border-line overflow-hidden">
                            <div className="p-4 border-b border-line bg-surface flex flex-col md:flex-row gap-4 justify-between items-center">
                                <div className="flex items-center gap-4">
                                    <h3 className="font-display font-bold uppercase tracking-[0.05em] num">Seed Library ({propSeeds.length})</h3>
                                    <button
                                        onClick={handleSeedNCAAProps}
                                        className="bg-navy-800 hover:bg-navy-700 text-white px-3 py-1 rounded text-xs font-display font-bold uppercase tracking-[0.05em] transition-colors shadow-card"
                                    >
                                        Seed NCAA Props
                                    </button>
                                </div>
                                <div className="flex gap-2 text-xs overflow-x-auto max-w-full pb-2 md:pb-0">
                                    <button
                                        onClick={() => setSeedCategoryFilter('All')}
                                        className={`px-3 py-1 rounded-full font-display font-bold uppercase tracking-[0.05em] transition-colors ${seedCategoryFilter === 'All' ? 'bg-navy-800 text-white' : 'bg-surface border border-line text-muted hover:text-[color:var(--text)]'}`}
                                    >
                                        All
                                    </button>
                                    {availableCategories.map(cat => (
                                        <button
                                            key={cat}
                                            onClick={() => setSeedCategoryFilter(cat)}
                                            className={`px-3 py-1 rounded-full font-display font-bold uppercase tracking-[0.05em] transition-colors ${seedCategoryFilter === cat ? 'bg-navy-800 text-white' : 'bg-surface border border-line text-muted hover:text-[color:var(--text)]'}`}
                                        >
                                            {cat}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="divide-y divide-line">
                                {propSeeds
                                    .filter(s => seedCategoryFilter === 'All' || s.categories?.includes(seedCategoryFilter) || s.category === seedCategoryFilter)
                                    .map(seed => (
                                        <div key={seed.id} className="p-4 hover:bg-surface flex justify-between items-center group">
                                            <div>
                                                <p className="font-medium text-[color:var(--text)]">{seed.text}</p>
                                                <p className="text-sm text-muted mb-1">{seed.options.join(' vs ')}</p>
                                                <div className="flex gap-1 flex-wrap">
                                                    {seed.categories?.map(c => (
                                                        <span key={c} className="text-[10px] uppercase font-display font-bold tracking-[0.08em] px-1.5 py-0.5 rounded bg-surface border border-line text-muted">
                                                            {c}
                                                        </span>
                                                    ))}
                                                    {!seed.categories && seed.category && (
                                                        <span className="text-[10px] uppercase font-display font-bold tracking-[0.08em] px-1.5 py-0.5 rounded bg-surface border border-line text-muted">{seed.category}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => handleEditSeed(seed)} className="text-navy-700 dark:text-gold-400 hover:bg-navy-600/10 p-2 bg-surface border border-line rounded">
                                                    <Settings size={16} />
                                                </button>
                                                <button onClick={() => handleDeleteSeed(seed.id)} className="text-brandred-500 hover:bg-brandred-600/10 p-2 bg-surface border border-line rounded">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                {propSeeds.length === 0 && (
                                    <div className="p-8 text-center text-faint">
                                        No seed questions yet. Add one above.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }

            {/* ============ PLAYOFFS TAB ============ */}
            {activeTab === 'playoffs' && (
                <div className="space-y-6">
                    <div className="bg-card p-6 rounded-xl border border-line shadow-card">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                            <div>
                                <h2 className="text-2xl font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
                                    <Trophy className="text-gold-500" /> Playoff Challenge Configuration
                                </h2>
                                <p className="text-muted font-body">Global configuration for teams, seeds, and elimination status.</p>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowResultsManager(true)}
                                    className="bg-navy-800 hover:bg-navy-700 text-white px-6 py-2 rounded-xl font-display font-bold uppercase tracking-[0.05em] transition-all shadow-card flex items-center gap-2"
                                >
                                    <Trophy size={16} /> Manage Results / Score
                                </button>
                                <button
                                    onClick={async () => {
                                        const ok = await toast.confirm({
                                            title: 'Reset Default Teams?',
                                            message: 'Reset to 2024-25 NFL Playoff Teams?',
                                            danger: true,
                                        });
                                        if (ok) {
                                            const MOCK = [
                                                { id: 'KC', name: 'Kansas City Chiefs', conference: 'AFC', seed: 1, eliminated: false },
                                                { id: 'BUF', name: 'Buffalo Bills', conference: 'AFC', seed: 2, eliminated: false },
                                                { id: 'BAL', name: 'Baltimore Ravens', conference: 'AFC', seed: 3, eliminated: false },
                                                { id: 'HOU', name: 'Houston Texans', conference: 'AFC', seed: 4, eliminated: false },
                                                { id: 'LAC', name: 'Los Angeles Chargers', conference: 'AFC', seed: 5, eliminated: false },
                                                { id: 'PIT', name: 'Pittsburgh Steelers', conference: 'AFC', seed: 6, eliminated: false },
                                                { id: 'DEN', name: 'Denver Broncos', conference: 'AFC', seed: 7, eliminated: false },
                                                { id: 'DET', name: 'Detroit Lions', conference: 'NFC', seed: 1, eliminated: false },
                                                { id: 'PHI', name: 'Philadelphia Eagles', conference: 'NFC', seed: 2, eliminated: false },
                                                { id: 'TB', name: 'Tampa Bay Buccaneers', conference: 'NFC', seed: 3, eliminated: false },
                                                { id: 'ARI', name: 'Arizona Cardinals', conference: 'NFC', seed: 4, eliminated: false },
                                                { id: 'MIN', name: 'Minnesota Vikings', conference: 'NFC', seed: 5, eliminated: false },
                                                { id: 'WAS', name: 'Washington Commanders', conference: 'NFC', seed: 6, eliminated: false },
                                                { id: 'GB', name: 'Green Bay Packers', conference: 'NFC', seed: 7, eliminated: false },
                                            ];
                                            setPlayoffTeams(MOCK as PlayoffTeam[]);
                                        }
                                    }}
                                    className="bg-surface hover:bg-card border border-line text-[color:var(--text)] px-4 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] text-sm transition-colors"
                                >
                                    Reset Default Teams
                                </button>
                                <button
                                    onClick={handleSavePlayoffs}
                                    disabled={isSavingPlayoffs}
                                    className="bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 text-white px-6 py-2 rounded-xl font-display font-bold uppercase tracking-[0.05em] transition-all shadow-red-cta"
                                >
                                    {isSavingPlayoffs ? 'Saving...' : 'Save Global Config'}
                                </button>
                                <button
                                    onClick={async () => {
                                        const ok = await toast.confirm({
                                            title: 'Force Sync global config to all Playoff Pools?',
                                            message: 'This is useful if elimination status is out of sync.',
                                        });
                                        if (ok) {
                                            try {
                                                const res = await dbService.syncPlayoffPools();
                                                toast.success(res.message);
                                            } catch (e: unknown) {
                                                logger.error(e);
                                                toast.error(getUserMessage(e, "Sync Failed."));
                                            }
                                        }
                                    }}
                                    className="bg-navy-800 hover:bg-navy-700 text-white px-6 py-2 rounded-xl font-display font-bold uppercase tracking-[0.05em] transition-all shadow-card flex items-center gap-2"
                                >
                                    <Bot size={16} /> Force Sync
                                </button>
                            </div>
                        </div>

                        {showResultsManager && (
                            <PlayoffResultsManager
                                teams={playoffTeams}
                                onClose={() => setShowResultsManager(false)}
                            />
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* AFC Conference */}
                            <div className="space-y-6">
                                <h3 className="text-xl font-display font-black uppercase text-brandred-500 flex items-center justify-between border-b border-brandred-600/20 pb-2">
                                    AFC CONFERENCE
                                    <button onClick={() => addPlayoffTeam('AFC')} className="text-[10px] font-display font-bold tracking-[0.08em] bg-brandred-600/10 hover:bg-brandred-600/20 text-brandred-500 px-2 py-1 rounded border border-brandred-600/30">ADD TEAM</button>
                                </h3>
                                <div className="space-y-3">
                                    {playoffTeams.filter(t => t.conference === 'AFC').sort((a, b) => a.seed - b.seed).map((team) => {
                                        const overallIdx = playoffTeams.indexOf(team);
                                        const logo = getTeamLogo(team.id);
                                        return (
                                            <div key={overallIdx} className={`p-4 rounded-xl border transition-all ${team.eliminated ? 'bg-surface border-line opacity-50' : 'bg-surface border-line shadow-card'}`}>
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 bg-card rounded-lg flex items-center justify-center p-1 border border-line">
                                                        {logo ? <img src={logo} alt={team.id} className="w-full h-full object-contain" /> : <div className="font-bold text-faint">{team.id || '?'}</div>}
                                                    </div>
                                                    <div className="flex-1 grid grid-cols-2 gap-3">
                                                        <div className="col-span-2">
                                                            <select
                                                                value={team.id}
                                                                onChange={(e) => {
                                                                    const t = Object.values(NFL_TEAMS).find(nt => nt.abbr === e.target.value);
                                                                    if (t) updatePlayoffTeam(overallIdx, { id: t.abbr, name: t.name });
                                                                }}
                                                                className="w-full bg-card border border-line rounded px-2 py-1.5 font-body text-[color:var(--text)] font-bold text-sm"
                                                            >
                                                                <option value="">Select Team...</option>
                                                                {Object.values(NFL_TEAMS).sort((a, b) => a.name.localeCompare(b.name)).map(nt => (
                                                                    <option key={nt.abbr} value={nt.abbr}>{nt.name}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] block mb-1">Seed</label>
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                max="8"
                                                                value={team.seed}
                                                                onChange={(e) => updatePlayoffTeam(overallIdx, { seed: parseInt(e.target.value) })}
                                                                className="w-full bg-card border border-line rounded px-2 py-1 text-[color:var(--text)] font-bold num"
                                                            />
                                                        </div>
                                                        <div className="flex items-center justify-end gap-4 pt-4">
                                                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={team.eliminated}
                                                                    onChange={(e) => updatePlayoffTeam(overallIdx, { eliminated: e.target.checked })}
                                                                    className="w-4 h-4 rounded border-line text-brandred-600 focus:ring-navy-600 bg-card"
                                                                />
                                                                <span className="text-xs font-display font-bold uppercase tracking-[0.05em] text-muted">Eliminated</span>
                                                            </label>
                                                            <button onClick={() => removePlayoffTeam(overallIdx)} className="text-brandred-500 hover:text-brandred-600 p-1"><Trash2 size={16} /></button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* NFC Conference */}
                            <div className="space-y-6">
                                <h3 className="text-xl font-display font-black uppercase text-navy-600 dark:text-gold-400 flex items-center justify-between border-b border-navy-600/20 pb-2">
                                    NFC CONFERENCE
                                    <button onClick={() => addPlayoffTeam('NFC')} className="text-[10px] font-display font-bold tracking-[0.08em] bg-navy-600/10 hover:bg-navy-600/20 text-navy-700 dark:text-gold-400 px-2 py-1 rounded border border-navy-600/30">ADD TEAM</button>
                                </h3>
                                <div className="space-y-3">
                                    {playoffTeams.filter(t => t.conference === 'NFC').sort((a, b) => a.seed - b.seed).map((team) => {
                                        const overallIdx = playoffTeams.indexOf(team);
                                        const logo = getTeamLogo(team.id);
                                        return (
                                            <div key={overallIdx} className={`p-4 rounded-xl border transition-all ${team.eliminated ? 'bg-surface border-line opacity-50' : 'bg-surface border-line shadow-card'}`}>
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 bg-card rounded-lg flex items-center justify-center p-1 border border-line">
                                                        {logo ? <img src={logo} alt={team.id} className="w-full h-full object-contain" /> : <div className="font-bold text-faint">{team.id || '?'}</div>}
                                                    </div>
                                                    <div className="flex-1 grid grid-cols-2 gap-3">
                                                        <div className="col-span-2">
                                                            <select
                                                                value={team.id}
                                                                onChange={(e) => {
                                                                    const t = Object.values(NFL_TEAMS).find(nt => nt.abbr === e.target.value);
                                                                    if (t) updatePlayoffTeam(overallIdx, { id: t.abbr, name: t.name });
                                                                }}
                                                                className="w-full bg-card border border-line rounded px-2 py-1.5 font-body text-[color:var(--text)] font-bold text-sm"
                                                            >
                                                                <option value="">Select Team...</option>
                                                                {Object.values(NFL_TEAMS).sort((a, b) => a.name.localeCompare(b.name)).map(nt => (
                                                                    <option key={nt.abbr} value={nt.abbr}>{nt.name}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] block mb-1">Seed</label>
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                max="8"
                                                                value={team.seed}
                                                                onChange={(e) => updatePlayoffTeam(overallIdx, { seed: parseInt(e.target.value) })}
                                                                className="w-full bg-card border border-line rounded px-2 py-1 text-[color:var(--text)] font-bold num"
                                                            />
                                                        </div>
                                                        <div className="flex items-center justify-end gap-4 pt-4">
                                                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={team.eliminated}
                                                                    onChange={(e) => updatePlayoffTeam(overallIdx, { eliminated: e.target.checked })}
                                                                    className="w-4 h-4 rounded border-line text-brandred-600 focus:ring-navy-600 bg-card"
                                                                />
                                                                <span className="text-xs font-display font-bold uppercase tracking-[0.05em] text-muted">Eliminated</span>
                                                            </label>
                                                            <button onClick={() => removePlayoffTeam(overallIdx)} className="text-brandred-500 hover:text-brandred-600 p-1"><Trash2 size={16} /></button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {playoffTeams.length === 0 && (
                            <div className="text-center p-12 bg-surface rounded-2xl border border-dashed border-line mt-8">
                                <Trophy size={48} className="text-faint mx-auto mb-4" />
                                <p className="text-muted font-body">No teams configured yet. Reset to defaults or add teams manually.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ============ NFL SCHEDULE TAB ============ */}
            {activeTab === 'nfl' && (
                <div className="space-y-6">
                    <div className="bg-card p-6 rounded-xl border border-line shadow-card shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-3 bg-gold-500/15 rounded-xl text-gold-600 dark:text-gold-400">
                                <Activity size={24} />
                            </div>
                            <div>
                                <h3 className="text-xl font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)]">NFL Schedule Bulk Importer</h3>
                                <p className="text-sm text-muted font-body">Import weekly or seasonal game data from official ESPN feeds.</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* Season Input */}
                            <div>
                                <label className="text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] block mb-2">Season Year</label>
                                <input
                                    type="text"
                                    value={nflSeason}
                                    onChange={(e) => setNflSeason(e.target.value)}
                                    className="w-full bg-card border border-line rounded-xl px-4 py-2.5 font-body text-[color:var(--text)] font-bold text-sm focus:outline-none focus:border-navy-600"
                                    placeholder="e.g. 2026"
                                />
                            </div>

                            {/* Season Type Selection */}
                            <div>
                                <label className="text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] block mb-2">Season Type</label>
                                <select
                                    value={nflSeasonType}
                                    onChange={(e) => {
                                        const st = parseInt(e.target.value);
                                        setNflSeasonType(st);
                                        // Preseason has 4 importer weeks; a stale week 5-18 in state
                                        // would import a nonexistent slate AFTER the season-wide
                                        // delete (codex r5 P1) — clamp with the option list.
                                        if (st === 1 && selectedNflWeek > 4) setSelectedNflWeek(1);
                                    }}
                                    className="w-full bg-card border border-line rounded-xl px-4 py-2.5 font-body text-[color:var(--text)] font-bold text-sm focus:outline-none focus:border-navy-600"
                                >
                                    <option value={1}>Preseason</option>
                                    <option value={2}>Regular Season</option>
                                    <option value={3}>Postseason</option>
                                </select>
                            </div>

                            {/* Weeks Filter */}
                            <div>
                                <label className="text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] block mb-2">Weeks Filter</label>
                                <select
                                    value={nflWeeks}
                                    onChange={(e) => setNflWeeks(e.target.value)}
                                    className="w-full bg-card border border-line rounded-xl px-4 py-2.5 font-body text-[color:var(--text)] font-bold text-sm focus:outline-none focus:border-navy-600"
                                >
                                    <option value="all">All 18 Weeks (Regular)</option>
                                    <option value="specific">Specific Week Only</option>
                                </select>
                            </div>
                        </div>

                        {/* Specific Week Selector */}
                        {nflWeeks === 'specific' && (
                            <div className="mt-6 max-w-xs">
                                <label className="text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] block mb-2">Select Week</label>
                                <select
                                    value={selectedNflWeek}
                                    onChange={(e) => setSelectedNflWeek(parseInt(e.target.value))}
                                    className="w-full bg-card border border-line rounded-xl px-4 py-2.5 font-body text-[color:var(--text)] font-bold text-sm focus:outline-none focus:border-navy-600"
                                >
                                    {Array.from({ length: nflSeasonType === 1 ? 4 : 18 }, (_, i) => i + 1).map(w => (
                                        <option key={w} value={w}>{nflWeekLabel(nflSeasonType, w)}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="mt-8 flex justify-end">
                            <button
                                onClick={handleImportNFLSchedule}
                                disabled={isImportingNfl || !nflSeason}
                                // `cursor-pointer` used to be unconditional, so a DISABLED button
                                // still showed the hand cursor and simply did nothing when
                                // clicked — indistinguishable from a broken one. An empty Season
                                // Year is the reachable case.
                                // `disabled:hover:*` neutralises the hover styles too. Without
                                // them a disabled button still lightens and lifts under the
                                // cursor, which reads as "this is clickable" — the same wrong
                                // signal `cursor-pointer` was giving (qodo, PR #397).
                                className="bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brandred-600 disabled:hover:translate-y-0 text-white font-display font-extrabold uppercase tracking-[0.05em] px-6 py-3 rounded-xl text-sm transition-all hover:-translate-y-px shadow-red-cta flex items-center gap-2 cursor-pointer"
                            >
                                <RefreshCw size={16} className={isImportingNfl ? 'animate-spin' : ''} />
                                {isImportingNfl ? 'Seeding games...' : 'Bulk Import ESPN NFL Schedule'}
                            </button>
                        </div>

                        {/* The outcome banner lives BELOW the button, not above the form.
                            It used to render at the top of the card, so on a short window the
                            success or failure of a click at the bottom of a three-column form
                            appeared off-screen — which is one way an import that really ran, or
                            really failed, reads as a button that did nothing. */}
                        {!nflSeason && (
                            <p className="mt-4 text-right text-xs font-bold text-brandred-500">
                                Enter a Season Year — the import button is disabled without one.
                            </p>
                        )}
                        {nflImportResult && (
                            <div className={`p-4 rounded-xl text-xs font-bold mt-4 flex gap-2 items-center ${
                                nflImportResult.type === 'success'
                                    ? 'bg-[#0F7B4A]/10 border border-[#0F7B4A]/25 text-[#0F7B4A]'
                                    : 'bg-brandred-600/10 border border-brandred-600/25 text-brandred-500'
                            }`}>
                                {nflImportResult.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
                                {nflImportResult.message}
                            </div>
                        )}
                    </div>

                    {/* NFL Spread Override */}
                    <SuperAdminNFLSpreads />
                </div>
            )}

            </ErrorBoundary>
        </div >
    );
};
