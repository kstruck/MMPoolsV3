import { logger } from '../utils/logger';
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameState, Pool, User, SystemSettings, PropSeed, PlayoffTeam, PoolTheme, LoyaltyTier } from '../types';
import { dbService } from '../services/dbService';
import { settingsService } from '../services/settingsService';
import { SimulationDashboard } from './SimulationDashboard';
import { SimpleTestingDashboard } from './SimpleTestingDashboard';
import { Trash2, Shield, Activity, Heart, Users, Settings, ToggleLeft, ToggleRight, PlayCircle, Search, ArrowDown, Palette, Plus, Eye, EyeOff, Star, Copy, X, List, Bot, Trophy, Lock, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { NFL_TEAMS, getTeamLogo } from '../constants';
import { getPoolSport, getPoolLifecycleState } from '../utils/poolSport';
import { POOL_TYPES, resolvePoolTypeFlags } from '../utils/featureFlags';
import { db } from '../firebase';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';


import { PlayoffResultsManager } from './PlayoffPool/PlayoffResultsManager';
import { AdminStatsDashboard } from './AdminStatsDashboard';
import { TournamentManager } from './admin/TournamentManager';
import { SuperAdminBentoDashboard } from './SuperAdminBentoDashboard';
import { simulatePoolGame, seedTestTournament, simulateRound, resetTournament } from '../utils/simulationUtils';
import { SuperAdminBillingPanel } from './admin/SuperAdminBillingPanel';
import { AdminAuditViewer } from './admin/AdminAuditViewer';
import { OperationsPanel } from './admin/OperationsPanel';
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
    // --- STATE ---
    const [pools, setPools] = useState<Pool[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);

    // UI State
    // UI State
    type NavGroup = 'Dashboard' | 'Management' | 'Game Ops' | 'Configuration';
    const [activeGroup, setActiveGroup] = useState<NavGroup>('Dashboard');
    const [activeTab, setActiveTab] = useState<'overview' | 'pools' | 'operations' | 'users' | 'referrals' | 'themes' | 'settings' | 'system' | 'props' | 'testing' | 'playoffs' | 'tournament' | 'stats' | 'nfl' | 'billing' | 'loyalty'>('overview');
    const [searchTerm, setSearchTerm] = useState('');
    const [settings, setSettings] = useState<SystemSettings | null>(null);
    const [showSimDashboard, setShowSimDashboard] = useState(false);
    const [sportFilter, setSportFilter] = useState<string>('ALL');
    const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'locked' | 'live' | 'final'>('all');
    const [priceFilter, setPriceFilter] = useState<'all' | 'low' | 'mid' | 'high'>('all');
    const [charityFilter, setCharityFilter] = useState(false);

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
            const entryRef = doc(db, 'pools', viewingPool.id, 'entries', entryId);
            await updateDoc(entryRef, {
                paidStatus: newStatus,
                updatedAt: Date.now()
            });
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
            const entryRef = doc(db, 'pools', viewingPool.id, 'entries', entryId);
            await deleteDoc(entryRef);
            setViewingPoolEntries(prev => prev.filter(entry => entry.id !== entryId));
            
            if (viewingPool.type === 'BRACKET') {
                const poolRef = doc(db, 'pools', viewingPool.id);
                const currentCount = (viewingPool as any).entryCount || 0;
                const newCount = Math.max(0, currentCount - 1);
                await updateDoc(poolRef, { entryCount: newCount });
                setViewingPool(prev => prev ? { ...prev, entryCount: newCount } as any : null);
            }
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

            const entryRef = doc(db, 'pools', viewingPool.id, 'entries', entryId);
            const updates: Record<string, any> = {
                score: scoreVal,
                payout: payoutVal,
                updatedAt: Date.now()
            };

            if (viewingPool.type === 'BRACKET') {
                updates.tiebreakerScore = tiebreakerVal;
            } else {
                updates.tiebreakerScore = tiebreakerVal;
                updates.tieBreakerPrediction = tiebreakerVal;
            }

            await updateDoc(entryRef, updates);
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

    // Compute real-time live stats directly from loaded data as fallback
    const liveStats = useMemo(() => {
        let totalSquaresSold = 0;
        let totalRevenue = 0;
        let totalDonated = 0;

        pools.forEach((pool: any) => {
            if (pool.type === 'SQUARES') {
                const sold = pool.squares ? pool.squares.filter((s: any) => s.owner).length : 0;
                totalSquaresSold += sold;
                totalRevenue += (pool.costPerSquare || 0) * sold;
                if (pool.charity?.enabled) {
                    totalDonated += ((pool.costPerSquare || 0) * sold) * ((pool.charity.percentage || 0) / 100);
                }
            } else if (pool.type === 'BRACKET' || pool.type === 'NFL_PLAYOFFS' || pool.type === 'NFL_PICKEM' || pool.type === 'NFL_SURVIVOR' || pool.type === 'NFL_MARGIN') {
                const count = pool.entryCount || pool.participantCount || (pool.participantIds ? pool.participantIds.length : 0);
                totalSquaresSold += count;
                totalRevenue += (pool.settings?.entryFee || 0) * count;
                if (pool.settings?.charity?.enabled) {
                    totalDonated += ((pool.settings.entryFee || 0) * count) * ((pool.settings.charity.percentage || 0) / 100);
                }
            } else if (pool.type === 'PROPS') {
                const count = pool.entryCount || pool.participantCount || (pool.participantIds ? pool.participantIds.length : 0);
                totalSquaresSold += count;
                totalRevenue += (pool.props?.cost || 0) * count;
            }
        });

        return {
            totalPools: pools.length,
            totalUsers: users.length,
            totalSquaresSold,
            totalRevenue,
            totalDonated,
            lastUpdated: Date.now()
        };
    }, [pools, users]);

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
            await dbService.updateBracketPool(pool.id, { status: 'COMPLETED' });
            toast.success(`"${pool.name}" has been closed and marked as Completed.`);
        } catch (e: unknown) {
            logger.error('Close pool error:', e);
            toast.error(getUserMessage(e, 'Error closing pool.'));
        }
    };

    const handleReinitBig12Tournament = async () => {
        const ok = await toast.confirm({
            title: 'Re-initialize big12-2026 tournament with CORRECT 2026 seeds?',
            message: 'This will overwrite the current tournament skeleton in Firestore with the real ESPN seedings. Do this now to fix the bracket structure.',
            danger: true,
        });
        if (!ok) return;
        try {
            const functions = getFunctions();
            const initFn = httpsCallable(functions, 'initializeBig12TournamentHttp');
            const result = await initFn({ tournamentId: 'big12-2026', overwrite: true });
            toast.success('✅ Big 12 tournament re-initialized successfully! The next sync (within 10 min) will pull live game results from ESPN.');
            logger.info('Big12 reinit result:', result);
        } catch (e: unknown) {
            logger.error('Reinit failed:', e);
            toast.error(getUserMessage(e, 'Error re-initializing tournament.'));
        }
    };

    const [isScoringBrackets, setIsScoringBrackets] = React.useState(false);
    const handleScoreBracketEntries = async () => {
        const ok = await toast.confirm({
            title: 'Score all locked bracket entries now?',
            message: 'This will recalculate scores for every participant in every locked bracket pool.',
        });
        if (!ok) return;
        setIsScoringBrackets(true);
        try {
            const functions = getFunctions();
            const scoreFn = httpsCallable(functions, 'scoreBracketEntries');
            const result = await scoreFn({});
            const data = result.data as { message?: string; scored?: number };
            toast.success(`✅ ${data?.message ?? 'Scoring complete!'} (${data?.scored ?? '?'} pools scored)`);
        } catch (e: unknown) {
            logger.error('Score bracket entries failed:', e);
            toast.error(getUserMessage(e, 'Error scoring brackets.'));
        } finally {
            setIsScoringBrackets(false);
        }
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
                // Also try to delete from Firestore directly just in case the cloud function didn't catch edge cases or if we want faster UI feedback,
                // but the cloud function does it. We'll just refresh.
                fetchUsers();
                toast.success(`User ${user.name} deleted successfully.`);
            } catch (e: unknown) {
                logger.error("Delete failed", e);
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

    // --- BIG EAST TOURNAMENT INIT ---
    const [isInitializingBigEast, setIsInitializingBigEast] = useState(false);

    const handleInitBigEast = async () => {
        const ok = await toast.confirm({
            title: 'Initialize the Big East Tournament data?',
            message: 'This will seed all teams and games into Firestore. Run this once before the tournament starts.',
        });
        if (!ok) return;
        setIsInitializingBigEast(true);
        try {
            const functions = getFunctions();
            const initFn = httpsCallable(functions, 'initializeBigEastTournamentHttp');
            const result = await initFn({}) as { data?: { tournamentId?: string } };
            toast.success(`✅ Big East Tournament initialized! Tournament ID: ${result.data?.tournamentId || 'N/A'}`);
        } catch (err: unknown) {
            logger.error('Big East init error:', err);
            toast.error(getUserMessage(err, '❌ Failed to initialize Big East Tournament.'));
        } finally {
            setIsInitializingBigEast(false);
        }
    };

    // Fix Participant IDs Handler
    const handleFixParticipantIds = async () => {
        const runLive = await toast.confirm({
            title: 'Run Backfill for Participant IDs?',
            message: 'Confirm = Run LIVE (Writes to DB). Cancel = DRY RUN (Logs Only).',
            confirmLabel: 'Run LIVE',
            cancelLabel: 'Dry Run',
        });
        const dryRun = !runLive;

        try {
            const result = await dbService.fixParticipantIds(dryRun);
            toast.success(`Participant ID Backfill Complete (${dryRun ? 'DRY RUN' : 'LIVE'}): Processed: ${result.processed} pools, Updated: ${result.updated} pools`);
        } catch (error: unknown) {
            logger.error('Fix Participant IDs Error:', error);
            toast.error(getUserMessage(error, 'Failed to fix participant IDs.'));
        }
    };

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

    // --- NAVIGATION STRUCTURE ---
    const navStructure = {
        'Dashboard': [
            { id: 'overview', label: 'Overview', icon: <Activity size={16} /> },
            { id: 'stats', label: 'Stats', icon: <Activity size={16} /> },
            { id: 'system', label: 'System Status', icon: <Activity size={16} /> },
        ],
        'Management': [
            { id: 'users', label: `Users(${users.length})`, icon: <Users size={16} /> },
            { id: 'referrals', label: 'Referrals', icon: <Users size={16} /> },
            { id: 'loyalty', label: 'Loyalty Tiers', icon: <Shield size={16} /> },
        ],
        'Game Ops': [
            { id: 'pools', label: `Pools(${filteredPools.length})`, icon: <Shield size={16} /> },
            { id: 'operations', label: 'Operations', icon: <Settings size={16} /> },
            { id: 'tournament', label: 'Tournament', icon: <Trophy size={16} /> },
            { id: 'playoffs', label: 'Playoffs', icon: <Trophy size={16} /> },
            { id: 'props', label: 'Global Props', icon: <List size={16} /> },
            { id: 'nfl', label: 'NFL Schedule', icon: <Shield size={16} /> },
        ],
        'Configuration': [
            { id: 'themes', label: `Themes(${themes.length})`, icon: <Palette size={16} /> },
            { id: 'testing', label: 'AI Testing', icon: <Bot size={16} /> },
            { id: 'billing', label: 'Monetization', icon: <Shield size={16} /> },
            { id: 'settings', label: 'Settings', icon: <Settings size={16} /> },
        ]
    };

    return (
        <div className="w-[80%] mx-auto py-4 md:py-6 relative text-slate-100">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold flex items-center gap-3">
                    <Shield className="text-emerald-500" /> Super Admin Dashboard
                </h1>
                <button
                    onClick={() => navigate('/tournament-sim')}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold transition-colors shadow-lg"
                >
                    <Trophy size={18} />
                    Tournament Simulator
                </button>
            </div>

            {/* TWO-LEVEL NAVIGATION */}
            <div className="mb-8 space-y-4">
                {/* Level 1: Groups */}
                <div className="flex flex-wrap gap-2 p-1 bg-slate-900/50 rounded-xl border border-slate-700/50 backdrop-blur-sm w-fit">
                    {(Object.keys(navStructure) as NavGroup[]).map(group => (
                        <button
                            key={group}
                            onClick={() => {
                                setActiveGroup(group);
                                // Auto-select first tab in group
                                setActiveTab(navStructure[group][0].id as typeof activeTab);
                            }}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeGroup === group
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                                : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                }`}
                        >
                            {group}
                        </button>
                    ))}
                </div>

                {/* Level 2: Tabs */}
                <div className="flex flex-wrap gap-2 border-b border-slate-700 pb-1">
                    {navStructure[activeGroup].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as typeof activeTab)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg font-bold text-sm transition-colors border-b-2 ${activeTab === tab.id
                                ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                                : 'border-transparent text-slate-400 hover:text-white hover:bg-slate-800/50'
                                }`}
                        >
                            {tab.icon} {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ============ OVERVIEW TAB ============ */}
            {/* ============ OVERVIEW TAB ============ */}
            {activeTab === 'overview' && (
                <div className="w-full">
                    <SuperAdminBentoDashboard stats={liveStats} />
                </div>
            )}

            {/* ============ TOURNAMENT TAB ============ */}
            {activeTab === 'tournament' && (
                <div className="space-y-6">
                    {/* ⚠️ BIG 12 RE-INIT BANNER */}
                    <div className="bg-amber-900/40 border border-amber-500/60 rounded-xl p-5 flex items-center justify-between gap-4">
                        <div>
                            <h3 className="text-amber-400 font-bold text-lg flex items-center gap-2">
                                <Trophy size={20} className="text-amber-400" />
                                Big 12 2026 — Bracket Re-Initialization Required
                            </h3>
                            <p className="text-amber-200/70 text-sm mt-1">
                                The seeds were incorrect. Click to overwrite the Firestore tournament skeleton with the correct 2026 ESPN seedings (Arizona #1, Houston #2, ASU #12 vs Baylor #13, etc).
                            </p>
                        </div>
                        <button
                            onClick={handleReinitBig12Tournament}
                            className="shrink-0 bg-amber-500 hover:bg-amber-400 text-black font-extrabold px-5 py-3 rounded-xl text-sm transition-all shadow-lg shadow-amber-500/30 whitespace-nowrap"
                        >
                            🔧 Re-Init Big 12 Now
                        </button>
                        <button
                            onClick={handleScoreBracketEntries}
                            disabled={isScoringBrackets}
                            className="shrink-0 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-extrabold px-5 py-3 rounded-xl text-sm transition-all shadow-lg shadow-emerald-500/30 whitespace-nowrap flex items-center gap-2"
                        >
                            <Trophy size={16} /> {isScoringBrackets ? 'Scoring...' : 'Score Bracket Entries'}
                        </button>
                    </div>
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
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                                <input
                                    type="text"
                                    placeholder="Search pools by name, ID, or owner..."
                                    className="w-full bg-slate-800 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-white focus:outline-none focus:border-indigo-500"
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* SPORT FILTERS */}
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                            <button
                                onClick={() => setSportFilter('ALL')}
                                className={`px - 4 py - 2 rounded - full text - xs font - bold whitespace - nowrap transition - colors ${sportFilter === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'} `}
                            >
                                ALL SPORTS
                            </button>
                            {Object.keys(poolsBySport).sort().map(sport => (
                                <button
                                    key={sport}
                                    onClick={() => setSportFilter(sport)}
                                    className={`px - 4 py - 2 rounded - full text - xs font - bold whitespace - nowrap transition - colors ${sportFilter === sport ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'} `}
                                >
                                    {sport.toUpperCase()}
                                </button>
                            ))}
                        </div>

                        {/* STATUS, PRICE & CHARITY FILTERS */}
                        <div className="flex flex-wrap gap-4 items-center bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                            {/* Status Filter */}
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-500 uppercase">Status:</span>
                                {[
                                    { id: 'all', label: 'All' },
                                    { id: 'open', label: 'Open' },
                                    { id: 'locked', label: 'Locked' },
                                    { id: 'live', label: 'Live' },
                                    { id: 'final', label: 'Final' }
                                ].map(status => (
                                    <button
                                        key={status.id}
                                        onClick={() => setStatusFilter(status.id as 'all' | 'open' | 'locked' | 'live' | 'final')}
                                        className={`px - 3 py - 1 rounded text - xs font - bold transition - colors ${statusFilter === status.id
                                            ? status.id === 'live' ? 'bg-emerald-500 text-white' : 'bg-indigo-600 text-white'
                                            : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                                            } `}
                                    >
                                        {status.label}
                                    </button>
                                ))}
                            </div>

                            {/* Price Filter */}
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-500 uppercase">Price:</span>
                                {[
                                    { id: 'all', label: 'Any' },
                                    { id: 'low', label: '< $20' },
                                    { id: 'mid', label: '$20-$50' },
                                    { id: 'high', label: '$50+' }
                                ].map(price => (
                                    <button
                                        key={price.id}
                                        onClick={() => setPriceFilter(price.id as 'all' | 'low' | 'mid' | 'high')}
                                        className={`px - 3 py - 1 rounded text - xs font - bold transition - colors ${priceFilter === price.id
                                            ? 'bg-emerald-500 text-white'
                                            : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                                            } `}
                                    >
                                        {price.label}
                                    </button>
                                ))}
                            </div>

                            {/* Charity Filter */}
                            <label className="flex items-center gap-2 cursor-pointer">
                                <span className="text-xs font-bold text-slate-500 uppercase">Charity Only:</span>
                                <button
                                    onClick={() => setCharityFilter(!charityFilter)}
                                    className={`w - 10 h - 5 rounded - full relative transition - colors ${charityFilter ? 'bg-rose-500' : 'bg-slate-700'} `}
                                >
                                    <div className={`absolute top - 1 w - 3 h - 3 bg - white rounded - full transition - all ${charityFilter ? 'left-6' : 'left-1'} `} />
                                </button>
                            </label>
                        </div>


                        {(Object.entries(poolsBySport) as [string, Pool[]][])
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([sport, sportPools]) => (
                                <div key={sport} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-xl">
                                    <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex justify-between items-center">
                                        <h2 className="text-xl font-bold flex items-center gap-2">
                                            🏆 {sport}
                                            <span className="text-sm font-normal text-slate-400">({sportPools.length} pools)</span>
                                        </h2>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left">
                                            <thead className="text-xs text-slate-400 uppercase bg-slate-900/80">
                                                <tr>
                                                    <th className="p-4 font-bold tracking-wider">Pool Name</th>
                                                    <th className="p-4 font-bold tracking-wider">Created</th>
                                                    <th className="p-4 font-bold tracking-wider">Matchup</th>
                                                    <th className="p-4 font-bold tracking-wider">Game Time</th>
                                                    <th className="p-4 font-bold tracking-wider">Owner</th>
                                                    <th className="p-4 font-bold tracking-wider">Filled</th>
                                                    <th className="p-4 font-bold tracking-wider">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-700/50">
                                                {[...sportPools].sort((a, b) => {
                                                    const timeA = typeof a.createdAt === 'number' ? a.createdAt : a.createdAt?.seconds || 0;
                                                    const timeB = typeof b.createdAt === 'number' ? b.createdAt : b.createdAt?.seconds || 0;
                                                    return timeB - timeA;
                                                }).map(pool => {
                                                    const isBracket = pool.type === 'BRACKET';
                                                    // Normalize data access
                                                    const createdAt = typeof pool.createdAt === 'number' ? new Date(pool.createdAt).toLocaleDateString() : (pool.createdAt?.seconds ? new Date(pool.createdAt.seconds * 1000).toLocaleDateString() : 'N/A');
                                                    const matchUp = isBracket ? 'Tournament Bracket' : `${(pool as GameState).awayTeam} @${(pool as GameState).homeTeam} `;
                                                    const poolLike = pool as unknown as PoolLike;
                                                    const ownerId = isBracket ? poolLike.managerUid as string : poolLike.ownerId as string;
                                                    const contact = users.find(u => u.id === ownerId)?.email || (isBracket ? 'N/A' : (pool as GameState).contactEmail);

                                                    let filledPct = 0;
                                                    let filledDisplay = '';
                                                    if (isBracket) {
                                                        const bp = pool as unknown as PoolLike;
                                                        const bpSettings = bp.settings as unknown as PoolLike;
                                                        const max = bpSettings.maxEntriesTotal === -1 ? 100 : (bpSettings.maxEntriesTotal as number);
                                                        filledPct = bpSettings.maxEntriesTotal === -1 ? 0 : Math.round(((bp.entryCount as number || 0) / max) * 100);
                                                        filledDisplay = `${bp.entryCount || 0} Entries`;
                                                    } else if (pool.type === 'PROPS' || pool.type === 'NFL_PLAYOFFS') {
                                                        const pp = pool as unknown as PoolLike;
                                                        const entryCount = pool.type === 'PROPS' ? (pp.entryCount || 0) : (pp.entries ? Object.keys(pp.entries as unknown as Record<string, unknown>).length : 0);
                                                        filledPct = 0;
                                                        filledDisplay = `${entryCount} Entries`;
                                                    } else {
                                                        const sp = pool as GameState;
                                                        const filledCount = sp.squares?.filter(s => s.owner).length || 0;
                                                        filledPct = filledCount;
                                                        filledDisplay = `${100 - filledCount} Left`;
                                                    }

                                                    return (
                                                        <tr key={pool.id} className="hover:bg-slate-700/30 transition-colors">
                                                            <td className="p-4">
                                                                <button
                                                                    onClick={() => setViewingPool(pool as GameState)} // Type assertion or update setViewingPool type
                                                                    className="font-bold text-white hover:text-indigo-400 hover:underline flex items-center gap-2 text-left"
                                                                >
                                                                    {pool.name}
                                                                    {!isBracket && (pool as GameState).charity?.enabled && (
                                                                        <div title="Charity Pool">
                                                                            <Heart size={12} className="text-rose-500 fill-rose-500" />
                                                                        </div>
                                                                    )}
                                                                </button>
                                                                <div className="text-[10px] text-slate-500 font-mono mt-0.5">{pool.id}</div>
                                                            </td>
                                                            <td className="p-4 text-slate-400 text-sm">
                                                                {createdAt}
                                                            </td>
                                                            <td className="p-4 font-bold text-sm">{matchUp}</td>
                                                            <td className="p-4 text-xs text-slate-400 font-mono">
                                                                {(() => {
                                                                    if (pool.type === 'BRACKET') {
                                                                        const lockAt = (pool as unknown as PoolLike).lockAt as string | undefined;
                                                                        return lockAt ? new Date(lockAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'TBD';
                                                                    } else if (pool.type === 'NFL_PLAYOFFS') {
                                                                        const lockDate = (pool as unknown as PoolLike).lockDate as string | undefined;
                                                                        return lockDate ? new Date(lockDate).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'TBD';
                                                                    } else if (pool.type === 'SQUARES' && (pool as GameState).scores?.startTime) {
                                                                        return new Date((pool as GameState).scores.startTime!).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                                                                    } else {
                                                                        return 'TBD';
                                                                    }
                                                                })()}
                                                            </td>
                                                            <td className="p-4 text-slate-400 text-sm max-w-[150px] truncate" title={contact}>{contact}</td>
                                                            <td className="p-4">
                                                                <div className="flex items-center gap-2">
                                                                    {(pool.type === 'SQUARES' || isBracket) && (
                                                                        <div className="w-16 h-2 bg-slate-700 rounded-full overflow-hidden">
                                                                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${filledPct}%` }}></div>
                                                                        </div>
                                                                    )}
                                                                    <span className="text-xs text-slate-500">{filledDisplay}</span>
                                                                </div>
                                                            </td>
                                                            <td className="p-4 flex gap-2 flex-wrap">
                                                                <button onClick={() => navigate(`/admin/${pool.id}`)} className="text-indigo-400 hover:text-indigo-300 text-xs font-bold border border-indigo-500/30 px-2 py-1 rounded">Manage</button>
                                                                {!isBracket && (
                                                                    <button onClick={() => handleRunSim(pool as GameState)} className="text-emerald-400 hover:text-emerald-300 text-xs font-bold border border-emerald-500/30 px-2 py-1 rounded">Sim</button>
                                                                )}
                                                                {!isBracket && (
                                                                    <button onClick={() => handleFixScores(pool as GameState)} className="text-amber-400 hover:text-amber-300 text-xs font-bold border border-amber-500/30 px-2 py-1 rounded flex items-center gap-1">
                                                                        <Settings size={12} /> Fix
                                                                    </button>
                                                                )}
                                                                {/* Close/Lock Button */}
                                                                {!(pool as unknown as PoolLike).isLocked && !((pool as unknown as PoolLike).lockAt && (pool as unknown as PoolLike).status === 'LOCKED') && (
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
                                                                        className="text-rose-400 hover:text-rose-300 text-xs font-bold border border-rose-500/30 px-2 py-1 rounded flex items-center gap-1"
                                                                        title="Lock Pool"
                                                                    >
                                                                        <Lock size={12} /> Lock
                                                                    </button>
                                                                )}
                                                                {/* Close Pool Button — any bracket pool not already COMPLETED */}
                                                                {isBracket && (pool as unknown as PoolLike).status !== 'COMPLETED' && (
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleClosePool(pool); }}
                                                                        className="text-orange-400 hover:text-orange-300 text-xs font-bold border border-orange-500/30 px-2 py-1 rounded flex items-center gap-1"
                                                                        title="Close Pool (mark as Completed)"
                                                                    >
                                                                        <CheckCircle size={12} /> Close Pool
                                                                    </button>
                                                                )}
                                                                <button onClick={() => handleDeletePool(pool.id)} className="text-rose-400 hover:text-rose-300 transition-colors"><Trash2 size={16} /></button>
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
                    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-xl w-full">
                        <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex justify-between items-center w-full">
                            <h2 className="text-xl font-bold">Registered Users</h2>
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
                                    className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded transition-colors flex items-center gap-1 font-bold"
                                >
                                    Force Sync
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
                                                toast.success(res.message + " Total: $" + res.totalPrizes);
                                            } catch (e) {
                                                toast.error(getUserMessage(e, "Failed to recalculate stats."));
                                            }
                                        }
                                    }}
                                    className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded transition-colors flex items-center gap-1 font-bold"
                                >
                                    <Activity size={12} /> Recalculate Stats
                                </button>
                                <button
                                    onClick={fetchUsers}
                                    className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1 rounded transition-colors flex items-center gap-1"
                                >
                                    <Activity size={12} /> Refresh List
                                </button>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="text-xs text-slate-400 uppercase bg-slate-900/80">
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
                                <tbody className="divide-y divide-slate-700/50">
                                    {users.map(u => (
                                        <tr key={u.id} className="hover:bg-slate-700/30 transition-colors">
                                            <td className="p-4 font-medium">
                                                <button onClick={() => handleViewUser(u)} className="hover:text-indigo-400 hover:underline font-bold text-left">{u.name}</button>
                                            </td>
                                            <td className="p-4 text-slate-400">{u.email}</td>
                                            <td className="p-4">
                                                <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded border ${u.role === 'SUPER_ADMIN' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : u.role === 'POOL_MANAGER' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>
                                                    {u.role || 'USER'}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded border ${u.registrationMethod === 'google' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}>
                                                    {u.registrationMethod || 'EMAIL'}
                                                </span>
                                            </td>
                                            <td className="p-4 text-center">
                                                <span className="text-indigo-400 font-bold">{u.referralCount || 0}</span>
                                            </td>
                                            <td className="p-4 text-slate-500 text-xs">
                                                {u.createdAt ? (() => {
                                                    const d = new Date(u.createdAt);
                                                    return `${d.getDate().toString().padStart(2, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getFullYear()}`;
                                                })() : '—'}
                                            </td>
                                            <td className="p-4 text-slate-500 font-mono text-xs max-w-[100px] truncate" title={u.id}>{u.id}</td>
                                            <td className="p-4 flex gap-2">
                                                <button
                                                    onClick={() => handleResetPassword(u)}
                                                    className="text-amber-400 hover:text-amber-300 transition-colors border border-amber-500/30 px-2 py-1 rounded text-xs font-bold"
                                                    title="Send Password Reset (Admin API)"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <Settings size={14} /> Reset
                                                    </div>
                                                </button>
                                                <button onClick={() => handleEditUser(u)} className="text-indigo-400 hover:text-indigo-300 text-xs font-bold border border-indigo-500/30 px-2 py-1 rounded">Edit</button>
                                                <button onClick={() => handleDeleteUser(u)} className="text-rose-400 hover:text-rose-300 transition-colors border border-rose-500/30 px-2 py-1 rounded"><Trash2 size={16} /></button>
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
                <div className="bg-slate-800 rounded-xl border border-indigo-500/30 overflow-hidden shadow-xl">
                    <div className="p-4 border-b border-slate-700 bg-indigo-900/20 flex justify-between items-center">
                        <h2 className="text-xl font-bold flex items-center gap-2"><Users className="text-indigo-400" size={20} /> Referral Dashboard</h2>
                        <span className="text-xs font-mono text-slate-500">Top Referrers & Referral Chain</span>
                    </div>

                    {/* Referral Stats Row */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 border-b border-slate-700/50">
                        <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                            <p className="text-3xl font-bold text-indigo-400">{users.reduce((sum, u) => sum + (getComputedReferrals(u.id) || 0), 0)}</p>
                            <p className="text-xs text-slate-500 uppercase font-bold">Total Referrals</p>
                        </div>
                        <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                            <p className="text-3xl font-bold text-emerald-400">{users.filter(u => u.referredBy).length}</p>
                            <p className="text-xs text-slate-500 uppercase font-bold">Referred Users</p>
                        </div>
                        <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                            <p className="text-3xl font-bold text-amber-400">
                                {new Set(users.filter(u => u.referredBy).map(u => u.referredBy)).size}
                            </p>
                            <p className="text-xs text-slate-500 uppercase font-bold">Active Referrers</p>
                        </div>
                        <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                            <p className="text-3xl font-bold text-white">{users.length > 0 ? ((users.filter(u => u.referredBy).length / users.length) * 100).toFixed(1) : 0}%</p>
                            <p className="text-xs text-slate-500 uppercase font-bold">Referral Rate</p>
                        </div>
                    </div>

                    {/* Top Referrers Leaderboard */}
                    <div className="p-4">
                        <h3 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">🏆 Top Referrers</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                            {[...users]
                                .map(u => ({ ...u, _computedCount: getComputedReferrals(u.id) }))
                                .filter(u => u._computedCount > 0)
                                .sort((a, b) => b._computedCount - a._computedCount)
                                .slice(0, 3)
                                .map((u, i) => (
                                    <div key={u.id} className={`p - 4 rounded - xl border ${i === 0 ? 'bg-amber-500/10 border-amber-500/30' : i === 1 ? 'bg-slate-500/10 border-slate-400/30' : 'bg-orange-500/10 border-orange-600/30'} `}>
                                        <div className="flex items-center gap-3">
                                            <div className={`text - 2xl font - black ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-slate-300' : 'text-orange-500'} `}>#{i + 1}</div>
                                            <div className="flex-1 min-w-0">
                                                <button onClick={() => handleViewUser(u)} className="font-bold text-white truncate hover:text-indigo-400">{u.name}</button>
                                                <p className="text-xs text-slate-400 truncate">{u.email}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-2xl font-bold text-indigo-400">{u._computedCount}</p>
                                                <p className="text-[10px] text-slate-500 uppercase">referrals</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            {users.every(u => getComputedReferrals(u.id) === 0) && (
                                <div className="col-span-3 text-center py-8 text-slate-500">No referrals yet</div>
                            )}
                        </div>

                        {/* Full Referral Table */}
                        <h3 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">All Users Referral Data</h3>
                        <div className="overflow-x-auto rounded-lg border border-slate-700">
                            <table className="w-full text-left text-sm">
                                <thead className="text-xs text-slate-400 uppercase bg-slate-900/80">
                                    <tr>
                                        <th className="p-3 font-bold">User</th>
                                        <th className="p-3 font-bold">Referral Code</th>
                                        <th className="p-3 font-bold text-center">Referrals Made</th>
                                        <th className="p-3 font-bold">Referred By</th>
                                        <th className="p-3 font-bold">Joined</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/50">
                                    {[...users]
                                        .map(u => ({ ...u, _computedCount: getComputedReferrals(u.id) }))
                                        .sort((a, b) => b._computedCount - a._computedCount)
                                        .map(u => {
                                            const referrer = u.referredBy ? users.find(ref => ref.id === u.referredBy) : null;
                                            return (
                                                <tr key={u.id} className="hover:bg-slate-700/30">
                                                    <td className="p-3">
                                                        <button onClick={() => handleViewUser(u)} className="font-bold text-white hover:text-indigo-400">{u.name}</button>
                                                        <p className="text-xs text-slate-500">{u.email}</p>
                                                    </td>
                                                    <td className="p-3">
                                                        <code className="text-xs bg-slate-900 px-2 py-1 rounded text-indigo-400 font-mono">{u.referralCode || u.id.slice(0, 8)}</code>
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <span className={`font - bold ${u._computedCount > 0 ? 'text-indigo-400' : 'text-slate-500'} `}>{u._computedCount}</span>
                                                    </td>
                                                    <td className="p-3">
                                                        {referrer ? (
                                                            <span className="text-emerald-400 text-xs">{referrer.name}</span>
                                                        ) : u.referredBy ? (
                                                            <span className="text-slate-500 text-xs font-mono">{u.referredBy.slice(0, 8)}...</span>
                                                        ) : (
                                                            <span className="text-slate-600 text-xs">—</span>
                                                        )}
                                                    </td>
                                                    <td className="p-3 text-xs text-slate-500">
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
                        <div className="lg:col-span-3 bg-slate-900/40 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <Shield className="text-indigo-400" /> Tiers Control Center
                                </h3>
                                <p className="text-slate-400 text-xs mt-1">
                                    Define loyalty tiers based on lifetime pool entries. Changes will apply immediately across all user dashboards.
                                </p>
                            </div>
                            
                            <div className="space-y-4 mt-6">
                                {editingTiers?.map((tier, index) => (
                                    <div key={tier.id} className="bg-slate-850 border border-slate-700/60 rounded-2xl p-4 flex flex-col md:flex-row items-center gap-4 relative group">
                                        <div className="flex-1 w-full space-y-3">
                                            <div className="grid grid-cols-3 gap-3">
                                                <div className="col-span-2">
                                                    <label className="text-[10px] text-slate-500 font-extrabold uppercase">Tier Name</label>
                                                    <input
                                                        type="text"
                                                        value={tier.name}
                                                        onChange={(e) => {
                                                            const updated = [...(editingTiers || [])];
                                                            updated[index] = { ...tier, name: e.target.value };
                                                            setEditingTiers(updated);
                                                        }}
                                                        className="w-full bg-slate-900 border border-slate-750 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-bold"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-slate-500 font-extrabold uppercase">Min Pools</label>
                                                    <input
                                                        type="number"
                                                        value={tier.minPools}
                                                        onChange={(e) => {
                                                            const updated = [...(editingTiers || [])];
                                                            updated[index] = { ...tier, minPools: Math.max(0, parseInt(e.target.value) || 0) };
                                                            setEditingTiers(updated);
                                                        }}
                                                        className="w-full bg-slate-900 border border-slate-750 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono font-bold"
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-slate-500 font-extrabold uppercase">Description</label>
                                                <input
                                                    type="text"
                                                    value={tier.description}
                                                    onChange={(e) => {
                                                        const updated = [...(editingTiers || [])];
                                                        updated[index] = { ...tier, description: e.target.value };
                                                        setEditingTiers(updated);
                                                    }}
                                                    className="w-full bg-slate-900 border border-slate-750 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 text-slate-350"
                                                />
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleRemoveTierLocal(tier.id)}
                                            className="p-2 border border-rose-500/20 text-rose-450 hover:bg-rose-500/10 rounded-xl mt-3 md:mt-0 transition-all duration-200"
                                            title="Delete Tier"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <div className="flex gap-3 mt-6 pt-4 border-t border-slate-800">
                                <button
                                    onClick={handleAddTierLocal}
                                    className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-xl text-xs font-bold transition-all border border-slate-750"
                                >
                                    <Plus size={14} /> Add New Tier
                                </button>
                                <button
                                    onClick={handleSaveTiers}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl text-xs font-bold transition-all ml-auto shadow-lg"
                                >
                                    Save Tier Configuration
                                </button>
                            </div>
                        </div>

                        {/* TIER DISTRIBUTION GRAPH */}
                        <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <Activity className="text-emerald-400" /> Tier Distribution
                                </h3>
                                <p className="text-slate-400 text-xs mt-1">
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
                                                <span className="text-white flex items-center gap-1.5">
                                                    <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
                                                    {t.name}
                                                </span>
                                                <span className="text-slate-400 font-mono">{count} ({pct.toFixed(0)}%)</span>
                                            </div>
                                            <div className="h-3 w-full bg-slate-950/60 rounded-full border border-slate-800 overflow-hidden">
                                                <div
                                                    className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 rounded-full transition-all duration-500"
                                                    style={{ width: `${pct}%` }}
                                                ></div>
                                            </div>
                                            <p className="text-[10px] text-slate-500">{t.description}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* TARGETED MARKETING HUB */}
                    <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 shadow-2xl">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 pb-4 border-b border-slate-800">
                            <div>
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <Users className="text-orange-500" /> Targeted Marketing Hub
                                </h3>
                                <p className="text-slate-400 text-xs mt-0.5">
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
                                    className="text-xs bg-slate-850 hover:bg-slate-805 text-slate-300 font-bold px-4 py-2.5 rounded-xl border border-slate-700 transition-all flex items-center gap-1.5"
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
                                    className="text-xs bg-emerald-650/10 hover:bg-emerald-650/20 text-emerald-450 font-bold px-4 py-2.5 rounded-xl border border-emerald-500/20 transition-all flex items-center gap-1.5"
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
                                    className="text-xs bg-orange-600 hover:bg-orange-500 text-white font-bold px-4 py-2.5 rounded-xl transition-all shadow-lg shadow-orange-500/10 flex items-center gap-1.5"
                                >
                                    <Plus size={13} /> Bulk Mock Promo
                                </button>
                            </div>
                        </div>

                        {/* FILTERS TOOLBAR */}
                        <div className="flex flex-col sm:flex-row gap-3 mb-6 items-center bg-slate-900/30 p-3 rounded-2xl border border-slate-800">
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <span className="text-[10px] text-slate-500 font-extrabold uppercase shrink-0">Filter Tier:</span>
                                <select
                                    value={selectedMarketingTier}
                                    onChange={(e) => setSelectedMarketingTier(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-bold"
                                >
                                    <option value="all">All Tiers (Show All Users)</option>
                                    {activeTiers.map((t: LoyaltyTier) => (
                                        <option key={t.id} value={t.id}>{t.name} ({userTiers.list[t.id]?.length || 0} users)</option>
                                    ))}
                                </select>
                            </div>

                            <div className="relative w-full sm:flex-grow">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                                <input
                                    type="text"
                                    placeholder="Search roster by name, email, or phone..."
                                    value={marketingSearch}
                                    onChange={(e) => setMarketingSearch(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 pl-9 pr-4 text-xs text-white focus:outline-none focus:border-indigo-500 font-semibold"
                                />
                            </div>
                        </div>

                        {/* ROSTER TABLE */}
                        <div className="overflow-x-auto rounded-2xl border border-slate-800/80">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-slate-900/80 text-slate-400 uppercase font-black tracking-wider text-[10px]">
                                    <tr>
                                        <th className="p-4">Name</th>
                                        <th className="p-4">Email</th>
                                        <th className="p-4">Phone</th>
                                        <th className="p-4 text-center">Pools Entered</th>
                                        <th className="p-4">Current Loyalty Tier</th>
                                        <th className="p-4">Marketing Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/60 font-semibold text-slate-350 text-[11px]">
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
                                            return <tr><td colSpan={6} className="p-8 text-center text-slate-500 font-bold uppercase tracking-wider text-[10px]">No users match this filter</td></tr>;
                                        }

                                        return list.map((u: User) => {
                                            const count = userPoolCounts[u.id] || 0;
                                            const tier = userTiers.mapping[u.id] || 'None';
                                            return (
                                                <tr key={u.id} className="hover:bg-slate-800/20 transition-colors">
                                                    <td className="p-4 font-bold text-white">
                                                        <button onClick={() => handleViewUser(u)} className="hover:text-indigo-400 hover:underline text-left">{u.name}</button>
                                                    </td>
                                                    <td className="p-4 text-slate-400">{u.email}</td>
                                                    <td className="p-4 font-mono text-slate-400">{u.phone || '—'}</td>
                                                    <td className="p-4 text-center font-mono text-white font-bold">{count}</td>
                                                    <td className="p-4">
                                                        <span className="text-[9px] uppercase font-black tracking-widest px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                                            {tier}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 flex gap-2">
                                                        <a
                                                            href={`mailto:${u.email}`}
                                                            className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-lg border border-slate-750 transition-all font-bold"
                                                        >
                                                            Email
                                                        </a>
                                                        <button
                                                            onClick={() => {
                                                                navigator.clipboard.writeText(u.email);
                                                                toast.success('Email copied to clipboard!');
                                                            }}
                                                            className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-lg border border-slate-750 transition-all"
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
                                                            className="text-xs bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-455 border border-indigo-500/20 px-2.5 py-1 rounded-lg transition-all font-black"
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
                            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-lg shadow-2xl flex flex-col justify-between relative">
                                <button
                                    onClick={() => { setPromoUser(null); setPromoBulkTier(null); }}
                                    className="absolute top-4 right-4 p-1.5 border border-slate-800 text-slate-400 hover:text-white rounded-xl bg-slate-950/40"
                                >
                                    <X size={18} />
                                </button>

                                <div>
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-1">
                                        <Bot className="text-orange-550 animate-pulse" /> Mock Promo Campaign Creator
                                    </h3>
                                    <p className="text-slate-400 text-xs font-semibold">
                                        {promoBulkTier 
                                          ? `Broadcasting simulated campaign to all members of the ${activeTiers.find((t: LoyaltyTier) => t.id === promoBulkTier)?.name} loyalty tier.`
                                          : `Configuring mock coupon code/marketing email directly to ${promoUser?.name}.`
                                        }
                                    </p>
                                </div>

                                <div className="space-y-4 mt-6">
                                    <div>
                                        <label className="text-[10px] text-slate-500 font-extrabold uppercase block mb-1">Marketing Action Type</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => setPromoType('coupon')}
                                                className={`py-2 text-xs font-bold rounded-xl border transition-all ${promoType === 'coupon' ? 'bg-orange-500/10 border-orange-500/30 text-orange-500' : 'bg-slate-950 border-slate-855 text-slate-500'}`}
                                            >
                                                🎫 Discount Coupon
                                            </button>
                                            <button
                                                onClick={() => setPromoType('reminder')}
                                                className={`py-2 text-xs font-bold rounded-xl border transition-all ${promoType === 'reminder' ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400' : 'bg-slate-950 border-slate-855 text-slate-500'}`}
                                            >
                                                📢 Text Reminder/Promo
                                            </button>
                                        </div>
                                    </div>

                                    {promoType === 'coupon' && (
                                        <div>
                                            <label className="text-[10px] text-slate-500 font-extrabold uppercase block mb-1">Coupon Code</label>
                                            <input
                                                type="text"
                                                value={promoCoupon}
                                                onChange={(e) => setPromoCoupon(e.target.value.toUpperCase())}
                                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500 font-mono font-bold"
                                                placeholder="e.g. LOYALTY50"
                                            />
                                        </div>
                                    )}

                                    <div>
                                        <label className="text-[10px] text-slate-500 font-extrabold uppercase block mb-1">Subject / Header</label>
                                        <input
                                            type="text"
                                            value={promoSubject}
                                            onChange={(e) => setPromoSubject(e.target.value)}
                                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-555 font-semibold"
                                            placeholder="Subject of marketing email"
                                        />
                                    </div>

                                    <div>
                                        <label className="text-[10px] text-slate-500 font-extrabold uppercase block mb-1">Message Content</label>
                                        <textarea
                                            value={promoMessage}
                                            onChange={(e) => setPromoMessage(e.target.value)}
                                            rows={3}
                                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-555 font-semibold resize-none"
                                            placeholder="Tell them about the coupon/remind them to lock in their picks..."
                                        />
                                    </div>
                                </div>

                                <div className="flex gap-3 mt-6 pt-4 border-t border-slate-800">
                                    <button
                                        onClick={() => { setPromoUser(null); setPromoBulkTier(null); }}
                                        className="bg-slate-800 hover:bg-slate-700 text-slate-350 px-4 py-2 rounded-xl text-xs font-bold transition-all border border-slate-750"
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
                                        className="bg-orange-600 hover:bg-orange-555 text-white px-5 py-2 rounded-xl text-xs font-bold transition-all ml-auto shadow-lg shadow-orange-500/10 disabled:opacity-50"
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
                            <h2 className="text-xl font-bold text-white">Theme Manager</h2>
                            <p className="text-sm text-slate-400">Create and manage custom pool themes. Only active themes are visible to pool managers.</p>
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
                            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold transition-colors"
                        >
                            <Plus size={18} /> Create Theme
                        </button>
                    </div>

                    {/* Seed Presets Button */}
                    {themes.length === 0 && (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-center">
                            <p className="text-amber-400 mb-3">No themes found. Seed the preset themes to get started.</p>
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
                                className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg font-bold"
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
                                className={`bg-slate-800 rounded-xl border overflow-hidden transition-all ${theme.isDefault ? 'border-amber-500' : theme.isActive ? 'border-emerald-500/50' : 'border-slate-700'}`}
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
                                            <span className="bg-amber-500 text-black text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                                <Star size={10} /> DEFAULT
                                            </span>
                                        )}
                                        {theme.isActive ? (
                                            <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                                <Eye size={10} /> ACTIVE
                                            </span>
                                        ) : (
                                            <span className="bg-slate-700 text-slate-400 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                                <EyeOff size={10} /> HIDDEN
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Info */}
                                <div className="p-4">
                                    <h3 className="font-bold text-white text-lg">{theme.name}</h3>
                                    <p className="text-xs text-slate-400 mb-3 line-clamp-1">{theme.description || 'No description'}</p>

                                    {/* Color Swatches */}
                                    <div className="flex gap-1 mb-4">
                                        {['primary', 'secondary', 'success', 'warning', 'error'].map(key => (
                                            <div
                                                key={key}
                                                className="w-5 h-5 rounded-full border border-slate-600"
                                                style={{ background: (theme.colors as unknown as Record<string, string>)?.[key] }}
                                                title={key}
                                            />
                                        ))}
                                    </div>

                                    {/* Actions */}
                                    <div className="flex gap-2 flex-wrap">
                                        <button
                                            onClick={() => { setEditingTheme(theme); setShowThemeBuilder(true); }}
                                            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded font-bold"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={async () => {
                                                await dbService.saveTheme({ ...theme, isActive: !theme.isActive });
                                            }}
                                            className={`text - xs px - 3 py - 1.5 rounded font - bold border ${theme.isActive ? 'border-slate-600 text-slate-400 hover:bg-slate-700' : 'border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/20'} `}
                                        >
                                            {theme.isActive ? 'Deactivate' : 'Activate'}
                                        </button>
                                        {!theme.isDefault && (
                                            <button
                                                onClick={() => dbService.setDefaultTheme(theme.id)}
                                                className="text-xs border border-amber-500/50 text-amber-400 hover:bg-amber-500/20 px-3 py-1.5 rounded font-bold"
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
                                            className="text-xs border border-slate-600 text-slate-400 hover:bg-slate-700 px-2 py-1.5 rounded"
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
                                                }
                                            }}
                                            className="text-xs text-rose-400 hover:bg-rose-500/20 px-2 py-1.5 rounded"
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
                    <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-5xl max-h-[90vh] overflow-auto">
                        {/* Modal Header */}
                        <div className="p-4 border-b border-slate-700 flex justify-between items-center sticky top-0 bg-slate-900 z-10">
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                <Palette size={20} className="text-indigo-400" />
                                {editingTheme.id ? 'Edit Theme' : 'Create Theme'}
                            </h2>
                            <div className="flex gap-2">
                                <button
                                    onClick={async () => {
                                        await dbService.saveTheme(editingTheme);
                                        setShowThemeBuilder(false);
                                        setEditingTheme(null);
                                    }}
                                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold"
                                >
                                    Save Theme
                                </button>
                                <button
                                    onClick={() => { setShowThemeBuilder(false); setEditingTheme(null); }}
                                    className="text-slate-400 hover:text-white p-2"
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
                                <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                                    <h3 className="font-bold text-white mb-4">Basic Info</h3>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-xs text-slate-400 font-bold uppercase block mb-1">Theme Name</label>
                                            <input
                                                type="text"
                                                value={editingTheme.name}
                                                onChange={(e) => setEditingTheme({ ...editingTheme, name: e.target.value })}
                                                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-slate-400 font-bold uppercase block mb-1">Description</label>
                                            <input
                                                type="text"
                                                value={editingTheme.description}
                                                onChange={(e) => setEditingTheme({ ...editingTheme, description: e.target.value })}
                                                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-slate-400 font-bold uppercase block mb-1">Category</label>
                                            <select
                                                value={editingTheme.category}
                                                onChange={(e) => setEditingTheme({ ...editingTheme, category: e.target.value as PoolTheme['category'] })}
                                                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white"
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
                                <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                                    <h3 className="font-bold text-white mb-4">Color Palette</h3>
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
                                                    className="w-8 h-8 rounded cursor-pointer border border-slate-600"
                                                />
                                                <span className="text-xs text-slate-300 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Grid Styling */}
                                <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                                    <h3 className="font-bold text-white mb-4">Grid Styling</h3>
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
                                                    className="w-8 h-8 rounded cursor-pointer border border-slate-600"
                                                />
                                                <span className="text-xs text-slate-300 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
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
                                            <span className="text-xs text-slate-300">Enable Winner Glow Effect</span>
                                        </label>
                                    </div>
                                </div>
                            </div>

                            {/* Right: Live Preview */}
                            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                                <h3 className="font-bold text-white mb-4">Live Preview</h3>
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
                                        <p style={{ color: editingTheme.colors?.success }} className="text-sm font-bold">🎉 Winner: John Smith</p>
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


            {activeTab === 'testing' && <SimpleTestingDashboard />}

            {activeTab === 'operations' && <OperationsPanel />}

            {activeTab === 'system' && (
                <div className="space-y-6 w-full">
                    {/* ADMIN AUDIT LOG (T7) */}
                    <AdminAuditViewer />

                    {/* SYSTEM STATS CARDS */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                            <p className="text-xs text-slate-500 font-bold uppercase mb-1">Active Pools</p>
                            <p className="text-3xl font-black text-white">
                                {pools.filter(p => !('isLocked' in p) ? false : !(p as GameState).isLocked && (p as GameState).scores?.gameStatus !== 'post').length}
                            </p>
                        </div>
                        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                            <p className="text-xs text-slate-500 font-bold uppercase mb-1">Live Games</p>
                            <p className="text-3xl font-black text-emerald-400">
                                {pools.filter(p => (p as GameState).scores?.gameStatus === 'in').length}
                            </p>
                        </div>
                        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                            <p className="text-xs text-slate-500 font-bold uppercase mb-1">Finished</p>
                            <p className="text-3xl font-black text-slate-400">
                                {pools.filter(p => (p as GameState).scores?.gameStatus === 'post').length}
                            </p>
                        </div>
                    </div>

                    {/* EXECUTION LOGS */}
                    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden w-full">
                        <div className="p-4 border-b border-slate-700 bg-slate-900/40 flex flex-col gap-4">
                            <div className="flex justify-between items-center">
                                <h3 className="font-bold text-white flex items-center gap-2">
                                    <Activity size={18} className="text-slate-400" />
                                    System Logs
                                </h3>
                                <div className="flex gap-2">
                                    {/* Email Export Button */}
                                    <button
                                        onClick={async () => {
                                            // 1. Collect Users
                                            const allEmails = new Map<string, string>(); // email -> name
                                            users.forEach(u => allEmails.set(u.email.toLowerCase(), u.name));

                                            // 2. Scan Pools for Guests — PII now lives in the
                                            // squarePrivate subcollection (audit H1), fetched per pool.
                                            const squarePools = pools.filter(p => (p as unknown as PoolLike).squares);
                                            const privLists = await Promise.all(
                                                squarePools.map(p => dbService.getSquarePrivateEmails(p.id).catch(() => []))
                                            );
                                            privLists.forEach(list => {
                                                list.forEach(({ email, name }) => {
                                                    const e = email.toLowerCase();
                                                    if (!allEmails.has(e)) {
                                                        allEmails.set(e, name || 'Guest');
                                                    }
                                                });
                                            });

                                            // 3. Generate CSV
                                            const headers = ['Name', 'Email'];
                                            const rows = Array.from(allEmails.entries()).map(([email, name]) => `"${name}", "${email}"`);
                                            const csvContent = [headers.join(','), ...rows].join('\n');

                                            // 4. Download
                                            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                                            const url = URL.createObjectURL(blob);
                                            const link = document.createElement('a');
                                            link.setAttribute('href', url);
                                            link.setAttribute('download', `mmp_emails_${new Date().toISOString().slice(0, 10)}.csv`);
                                            link.style.visibility = 'hidden';
                                            document.body.appendChild(link);
                                            link.click();
                                            document.body.removeChild(link);
                                        }}
                                        className="text-xs bg-emerald-600 hover:bg-emerald-500 px-3 py-1 rounded text-white transition-colors font-bold flex items-center gap-1"
                                    >
                                        <ArrowDown size={12} /> Export Emails
                                    </button>

                                    <button
                                        onClick={async () => {
                                            const ok = await toast.confirm({
                                                title: 'Run Retroactive Score Fix?',
                                                message: 'This will scan all active pools and repair missing score events.',
                                            });
                                            if (ok) {
                                                try {
                                                    if (dbService.fixPoolScores) {
                                                        await dbService.fixPoolScores();
                                                        toast.success('Fix Complete.');
                                                    }
                                                } catch { toast.error('Fix Failed'); }
                                            }
                                        }}
                                        className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1 rounded text-white transition-colors font-bold"
                                    >
                                        Fix Scoring
                                    </button>
                                    <button
                                        onClick={handleFixParticipantIds}
                                        className="text-xs bg-amber-600 hover:bg-amber-500 px-3 py-1 rounded text-white transition-colors font-bold flex items-center gap-1"
                                    >
                                        <Users size={12} /> Fix Participants
                                    </button>
                                    <button
                                        onClick={handleInitBigEast}
                                        disabled={isInitializingBigEast}
                                        className="text-xs bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-3 py-1 rounded text-white transition-colors font-bold flex items-center gap-1"
                                    >
                                        <Trophy size={12} /> {isInitializingBigEast ? 'Initializing...' : 'Init Big East'}
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (dbService.getSystemLogs) {
                                                dbService.getSystemLogs().then(setSystemLogs).catch(logger.error);
                                            }
                                        }}
                                        className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-white transition-colors"
                                    >
                                        Refresh
                                    </button>
                                </div>
                            </div>

                            {/* Filters Toolbar */}
                            <div className="flex flex-wrap gap-2 items-center bg-slate-900/50 p-2 rounded-lg border border-slate-700">
                                {/* Status Filter */}
                                <select
                                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none"
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
                                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none"
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
                                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none"
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
                                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" size={12} />
                                    <input
                                        type="text"
                                        placeholder="Search logs..."
                                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 pl-7 text-xs text-white placeholder:text-slate-600 w-full focus:ring-1 focus:ring-indigo-500 outline-none"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="overflow-x-auto max-h-[600px]">
                            <table className="w-full text-left text-sm">
                                <thead className="text-xs text-slate-500 uppercase bg-slate-900 sticky top-0">
                                    <tr>
                                        <th className="p-3 font-bold">Time</th>
                                        <th className="p-3 font-bold">Status</th>
                                        <th className="p-3 font-bold">Tag</th>
                                        <th className="p-3 font-bold w-full">Details</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/50">
                                    {filteredLogs.length === 0 ? (
                                        <tr><td colSpan={4} className="p-8 text-center text-slate-500">No logs found matching filters</td></tr>
                                    ) : (
                                        filteredLogs.map((log, i) => (
                                            <tr key={i} className={`log-row hover:bg-slate-700/20 font-mono text-xs ${log.status === 'error' ? 'bg-rose-900/10' : log.status === 'partial' ? 'bg-amber-900/10' : ''}`}>
                                                <td className="p-3 text-slate-400 whitespace-nowrap">
                                                    {(() => {
                                                        const ts2 = log.timestamp;
                                                        return ts2 && typeof ts2 === 'object' && 'toDate' in ts2 && typeof ts2.toDate === 'function'
                                                            ? ts2.toDate().toLocaleString()
                                                            : new Date(ts2 as string | number).toLocaleString();
                                                    })()}
                                                </td>
                                                <td className="p-3">
                                                    <span className={`px-2 py-0.5 rounded ${log.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                                                        log.status === 'partial' ? 'bg-amber-500/10 text-amber-400' :
                                                            'bg-rose-500/10 text-rose-400'
                                                        }`}>
                                                        {(log.status as string | undefined)?.toUpperCase() ?? 'UNKNOWN'}
                                                    </span>
                                                </td>
                                                <td className="p-3">
                                                    {(() => {
                                                        const type = log.type || 'UNKNOWN';
                                                        let label = type;
                                                        let colorClass = 'bg-slate-700 text-slate-300';

                                                        if (type === 'ESPN_FETCH_SUCCESS') { label = 'ESPN Update'; colorClass = 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'; }
                                                        else if (type === 'ESPN_FETCH_FAIL') { label = 'ESPN Error'; colorClass = 'bg-rose-500/20 text-rose-300 border border-rose-500/30'; }
                                                        else if (type === 'SYNC_GAME_STATUS') { label = 'System Sync'; colorClass = 'bg-slate-600/30 text-slate-300 border border-slate-600/50'; }
                                                        else if (type === 'POOL_SYNC_ERROR') { label = 'Pool Error'; colorClass = 'bg-amber-500/20 text-amber-300 border border-amber-500/30'; }
                                                        else if (type === 'SIMULATION') { label = 'Sim Run'; colorClass = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'; }

                                                        return <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${colorClass}`}>{label}</span>;
                                                    })()}
                                                </td>
                                                <td className="p-3 text-slate-300 w-full">
                                                    <div className="flex flex-col gap-1">
                                                        {log.message && <span className="font-bold text-white mb-1 block">{log.message}</span>}
                                                        {log.details !== undefined && <span className="font-mono text-[10px] text-slate-500">{String(log.details)}</span>}
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
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400"><Settings size={24} /></div>
                            <h3 className="text-xl font-bold text-white">Feature Flags</h3>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                                <div>
                                    <h4 className="font-bold text-white">Enable Bracket Pools</h4>
                                    <p className="text-sm text-slate-400">Allow managers to create bracket pools.</p>
                                </div>
                                <button
                                    onClick={() => settingsService.update({ enableBracketPools: !settings?.enableBracketPools })}
                                    className={`transition - colors ${settings?.enableBracketPools ? 'text-emerald-400' : 'text-slate-500'} `}
                                >
                                    {settings?.enableBracketPools ? <ToggleRight size={40} className="fill-emerald-500/20" /> : <ToggleLeft size={40} />}
                                </button>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                                <div>
                                    <h4 className="font-bold text-white">Maintenance Mode</h4>
                                    <p className="text-sm text-slate-400">Disable all write actions for users.</p>
                                </div>
                                <button
                                    onClick={() => settingsService.update({ maintenanceMode: !settings?.maintenanceMode })}
                                    className={`transition - colors ${settings?.maintenanceMode ? 'text-amber-400' : 'text-slate-500'} `}
                                >
                                    {settings?.maintenanceMode ? <ToggleRight size={40} className="fill-amber-500/20" /> : <ToggleLeft size={40} />}
                                </button>
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

                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2 bg-pink-500/20 rounded-lg text-pink-400"><PlayCircle size={24} /></div>
                            <h3 className="text-xl font-bold text-white">Simulation Tools</h3>
                        </div>

                        <div className="space-y-4">
                            <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                                <h4 className="font-bold text-white mb-2">Tournament Data</h4>
                                <div className="flex flex-col gap-2">
                                    <button
                                        onClick={async () => {
                                            const ok = await toast.confirm({
                                                title: "Overwrite 'tournaments/2025' with test data?",
                                                message: 'This will RESET all current brackets.',
                                                danger: true,
                                            });
                                            if (!ok) return;
                                            try {
                                                // Imported statically
                                                await seedTestTournament(2025);
                                                toast.success("Tournament seeded successfully.");
                                            } catch (e: unknown) {
                                                toast.error(getUserMessage(e, "Failed to seed tournament."));
                                            }
                                        }}
                                        className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded font-bold text-sm transition-colors text-left"
                                    >
                                        1. Seed Test Tournament (Teams & R64)
                                    </button>
                                </div>
                            </div>

                            <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                                <h4 className="font-bold text-white mb-2">Advance Tournament</h4>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={async () => {
                                            const ok = await toast.confirm({
                                                title: 'Simulate scores?',
                                                message: 'Simulate scores for current round?',
                                            });
                                            if (!ok) return;
                                            try {
                                                // Imported statically
                                                const res = await simulateRound(2025);
                                                toast.success(res);
                                            } catch (e: unknown) {
                                                logger.error(e);
                                                toast.error(getUserMessage(e, "Failed to simulate round."));
                                            }
                                        }}
                                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded font-bold text-sm transition-colors"
                                    >
                                        Simulate Round
                                    </button>
                                    <button
                                        onClick={async () => {
                                            const ok = await toast.confirm({
                                                title: 'RESET tournament scores?',
                                                message: 'This will reset all tournament scores.',
                                                danger: true,
                                            });
                                            if (!ok) return;
                                            try {
                                                // Imported statically
                                                await resetTournament(2025);
                                                toast.success("Tournament reset.");
                                            } catch (e: unknown) {
                                                toast.error(getUserMessage(e, "Failed to reset tournament."));
                                            }
                                        }}
                                        className="bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded font-bold text-sm transition-colors"
                                    >
                                        Reset Scores
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )
            }
            {
                activeTab === 'referrals' && (
                    <div className="bg-slate-800 rounded-xl border border-indigo-500/30 overflow-hidden shadow-xl">
                        <div className="p-4 border-b border-slate-700 bg-indigo-900/20 flex justify-between items-center">
                            <h2 className="text-xl font-bold flex items-center gap-2"><Users className="text-indigo-400" size={20} /> Referral Dashboard</h2>
                            <span className="text-xs font-mono text-slate-500">Top Referrers & Referral Chain</span>
                        </div>

                        {/* Referral Stats Row */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 border-b border-slate-700/50">
                            <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                                <p className="text-3xl font-bold text-indigo-400">{users.reduce((sum, u) => sum + (u.referralCount || 0), 0)}</p>
                                <p className="text-xs text-slate-500 uppercase font-bold">Total Referrals</p>
                            </div>
                            <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                                <p className="text-3xl font-bold text-emerald-400">{users.filter(u => u.referredBy).length}</p>
                                <p className="text-xs text-slate-500 uppercase font-bold">Referred Users</p>
                            </div>
                            <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                                <p className="text-3xl font-bold text-amber-400">{users.filter(u => (u.referralCount || 0) > 0).length}</p>
                                <p className="text-xs text-slate-500 uppercase font-bold">Active Referrers</p>
                            </div>
                            <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                                <p className="text-3xl font-bold text-white">{users.length > 0 ? ((users.filter(u => u.referredBy).length / users.length) * 100).toFixed(1) : 0}%</p>
                                <p className="text-xs text-slate-500 uppercase font-bold">Referral Rate</p>
                            </div>
                        </div>

                        {/* Top Referrers Leaderboard */}
                        <div className="p-4">
                            <h3 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">🏆 Top Referrers</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                                {[...users]
                                    .filter(u => (u.referralCount || 0) > 0)
                                    .sort((a, b) => (b.referralCount || 0) - (a.referralCount || 0))
                                    .slice(0, 3)
                                    .map((u, i) => (
                                        <div key={u.id} className={`p - 4 rounded - xl border ${i === 0 ? 'bg-amber-500/10 border-amber-500/30' : i === 1 ? 'bg-slate-500/10 border-slate-400/30' : 'bg-orange-500/10 border-orange-600/30'} `}>
                                            <div className="flex items-center gap-3">
                                                <div className={`text - 2xl font - black ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-slate-300' : 'text-orange-500'} `}>#{i + 1}</div>
                                                <div className="flex-1 min-w-0">
                                                    <button onClick={() => handleViewUser(u)} className="font-bold text-white truncate hover:text-indigo-400">{u.name}</button>
                                                    <p className="text-xs text-slate-400 truncate">{u.email}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-2xl font-bold text-indigo-400">{u.referralCount || 0}</p>
                                                    <p className="text-[10px] text-slate-500 uppercase">referrals</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                {users.filter(u => (u.referralCount || 0) > 0).length === 0 && (
                                    <div className="col-span-3 text-center py-8 text-slate-500">No referrals yet</div>
                                )}
                            </div>

                            {/* Full Referral Table */}
                            <h3 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">All Users Referral Data</h3>
                            <div className="overflow-x-auto rounded-lg border border-slate-700">
                                <table className="w-full text-left text-sm">
                                    <thead className="text-xs text-slate-400 uppercase bg-slate-900/80">
                                        <tr>
                                            <th className="p-3 font-bold">User</th>
                                            <th className="p-3 font-bold">Referral Code</th>
                                            <th className="p-3 font-bold text-center">Referrals Made</th>
                                            <th className="p-3 font-bold">Referred By</th>
                                            <th className="p-3 font-bold">Joined</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700/50">
                                        {[...users]
                                            .sort((a, b) => (b.referralCount || 0) - (a.referralCount || 0))
                                            .map(u => {
                                                const referrer = u.referredBy ? users.find(ref => ref.id === u.referredBy) : null;
                                                return (
                                                    <tr key={u.id} className="hover:bg-slate-700/30">
                                                        <td className="p-3">
                                                            <button onClick={() => handleViewUser(u)} className="font-bold text-white hover:text-indigo-400">{u.name}</button>
                                                            <p className="text-xs text-slate-500">{u.email}</p>
                                                        </td>
                                                        <td className="p-3">
                                                            <code className="text-xs bg-slate-900 px-2 py-1 rounded text-indigo-400 font-mono">{u.referralCode || u.id.slice(0, 8)}</code>
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            <span className={`font - bold ${(u.referralCount || 0) > 0 ? 'text-indigo-400' : 'text-slate-500'} `}>{u.referralCount || 0}</span>
                                                        </td>
                                                        <td className="p-3">
                                                            {referrer ? (
                                                                <span className="text-emerald-400 text-xs">{referrer.name}</span>
                                                            ) : u.referredBy ? (
                                                                <span className="text-slate-500 text-xs font-mono">{u.referredBy.slice(0, 8)}...</span>
                                                            ) : (
                                                                <span className="text-slate-600 text-xs">—</span>
                                                            )}
                                                        </td>
                                                        <td className="p-3 text-xs text-slate-500">
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
                        <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
                            {/* Modal Header */}
                            <div className="p-6 border-b border-slate-700 flex justify-between items-start bg-slate-950/50">
                                <div>
                                    <h2 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
                                        {viewingPool.name}
                                        {viewingPool.type !== 'BRACKET' && (viewingPool as GameState).charity?.enabled && <Heart size={20} className="text-rose-500 fill-rose-500 animate-pulse" />}
                                    </h2>
                                    <p className="text-slate-400 text-sm">
                                        ID: <span className="font-mono text-slate-500">{viewingPool.id}</span>
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
                                            className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/50 rounded-lg text-xs font-bold transition-all"
                                        >
                                            Fix Max Entries
                                        </button>
                                    )}
                                    <button onClick={() => setViewingPool(null)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-white transition-colors">
                                        <span className="sr-only">Close</span>
                                        <X size={20} />
                                    </button>
                                </div>
                            </div>

                            {/* Modal Tabs Navigation */}
                            <div className="flex border-b border-slate-700 bg-slate-950/20 px-6 py-2 overflow-x-auto gap-2">
                                {[
                                    { id: 'overview', label: 'Overview & Stats' },
                                    { id: 'settings', label: 'Edit Settings (Override)' },
                                    { id: 'participants', label: `Manage Participants (${viewingPoolEntries.length})` },
                                    { id: 'dangerous', label: 'Dangerous Ops' }
                                ].map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setModalTab(tab.id as any)}
                                        className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
                                            modalTab === tab.id
                                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                                                : 'text-slate-400 hover:text-white hover:bg-slate-800'
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
                                            <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                                                <h4 className="text-slate-400 text-xs font-bold uppercase mb-1">Created At</h4>
                                                <p className="font-medium text-white text-lg">
                                                    {typeof viewingPool.createdAt === 'number'
                                                        ? new Date(viewingPool.createdAt).toLocaleString()
                                                        : (viewingPool.createdAt?.seconds
                                                            ? new Date(viewingPool.createdAt.seconds * 1000).toLocaleString()
                                                            : <span className="italic text-slate-500">Unknown Date</span>)}
                                                </p>
                                            </div>
                                            <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                                                <h4 className="text-slate-400 text-xs font-bold uppercase mb-1">Owner</h4>
                                                <p className="font-medium text-white text-lg">
                                                    {users.find(u => u.id === (viewingPool.type === 'BRACKET' ? (viewingPool as unknown as PoolLike).managerUid as string : (viewingPool as unknown as PoolLike).ownerId as string))?.name || 'Unknown User'}
                                                </p>
                                                <p className="text-xs text-slate-500 font-mono mt-1 break-all">
                                                    UID: {viewingPool.type === 'BRACKET' ? (viewingPool as unknown as PoolLike).managerUid as string : (viewingPool as unknown as PoolLike).ownerId as string}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Status */}
                                        <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700/50">
                                            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4">Live Statistics</h3>
                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                                <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-80">
                                                    <div className="text-xs text-slate-500 font-bold uppercase">State</div>
                                                    <div className="text-2xl font-bold text-white mt-1">
                                                        {viewingPool.type === 'BRACKET'
                                                            ? (viewingPool as unknown as PoolLike).status as string
                                                            : ((viewingPool as GameState).isLocked ? "LOCKED" : "OPEN")}
                                                    </div>
                                                </div>
                                                <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-80">
                                                    <div className="text-xs text-slate-500 font-bold uppercase">Entries</div>
                                                    <div className="text-2xl font-bold text-white mt-1">
                                                        {viewingPoolEntries.length}
                                                    </div>
                                                </div>
                                                <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-80">
                                                    <div className="text-xs text-slate-500 font-bold uppercase">Cost / Fee</div>
                                                    <div className="text-2xl font-bold text-emerald-400 mt-1">
                                                        ${adminEntryFee}
                                                    </div>
                                                </div>
                                                <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-80">
                                                    <div className="text-xs text-slate-500 font-bold uppercase">Total Pot</div>
                                                    <div className="text-2xl font-bold text-indigo-400 font-mono mt-1">
                                                        ${viewingPoolEntries.length * adminEntryFee}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Charity Info */}
                                        {viewingPool.type !== 'BRACKET' && (viewingPool as GameState).charity?.enabled && (
                                            <div className="bg-rose-950/20 p-5 rounded-xl border border-rose-500/20 flex gap-4 items-start">
                                                <div className="p-3 bg-rose-500/10 rounded-lg text-rose-500">
                                                    <Heart size={24} fill="currentColor" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="text-rose-400 text-xs font-bold uppercase tracking-wider mb-1">Fundraising for Charity</h4>
                                                    <p className="text-white font-bold text-lg">{(viewingPool as GameState).charity?.name}</p>
                                                    <a href={(viewingPool as GameState).charity?.url} target="_blank" rel="noreferrer" className="text-rose-400 text-sm hover:underline truncate block mt-0.5">{(viewingPool as GameState).charity?.url}</a>
                                                    <p className="text-xs text-rose-300/70 mt-2 bg-rose-500/10 px-3 py-1.5 rounded-lg w-fit">Donating {(viewingPool as GameState).charity?.percentage}% of the pot</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {modalTab === 'settings' && (
                                    <div className="space-y-4 max-w-xl mx-auto bg-slate-800/20 p-6 rounded-xl border border-slate-700/50">
                                        <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2 border-b border-slate-700 pb-2">
                                            <Settings size={20} className="text-indigo-400" /> Pool Configuration Overrides
                                        </h3>
                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-xs uppercase text-slate-400 font-bold mb-1.5">Pool Name</label>
                                                <input
                                                    type="text"
                                                    value={adminPoolName}
                                                    onChange={e => setAdminPoolName(e.target.value)}
                                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 transition-colors"
                                                />
                                            </div>
                                            
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs uppercase text-slate-400 font-bold mb-1.5">Entry Cost / Fee ($)</label>
                                                    <input
                                                        type="number"
                                                        value={adminEntryFee}
                                                        onChange={e => setAdminEntryFee(Number(e.target.value))}
                                                        className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 transition-colors"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs uppercase text-slate-400 font-bold mb-1.5">Privacy Status</label>
                                                    <button
                                                        type="button"
                                                        onClick={() => setAdminIsPublic(!adminIsPublic)}
                                                        className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                                                            adminIsPublic
                                                                ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 font-bold'
                                                                : 'bg-slate-900 border-slate-700 text-slate-400 font-medium'
                                                        }`}
                                                    >
                                                        <span>{adminIsPublic ? '🌍 Publicly Listed' : '🔒 Private (Invite Only)'}</span>
                                                        <span className="text-xs">{adminIsPublic ? 'Public' : 'Private'}</span>
                                                    </button>
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-xs uppercase text-slate-400 font-bold mb-1.5">Payment Instructions</label>
                                                <textarea
                                                    rows={4}
                                                    value={adminInstructions}
                                                    onChange={e => setAdminInstructions(e.target.value)}
                                                    placeholder="Specify how participants should pay (e.g. Venmo, PayPal link, etc.)"
                                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 transition-colors font-sans resize-none"
                                                />
                                            </div>

                                            <div className="pt-2">
                                                <button
                                                    onClick={handleSavePoolSettingsAdmin}
                                                    className="w-full bg-emerald-600 hover:bg-emerald-500 hover:shadow-emerald-600/20 text-white font-bold py-3 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2"
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
                                                <Search className="absolute left-3 top-3.5 text-slate-500" size={18} />
                                                <input
                                                    type="text"
                                                    placeholder="Search participants by name, email, or entry ID..."
                                                    value={adminSearchEntry}
                                                    onChange={e => setAdminSearchEntry(e.target.value)}
                                                    className="w-full bg-slate-900/60 border border-slate-700/80 rounded-xl py-3 pl-10 pr-4 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                                                />
                                            </div>
                                        </div>

                                        <div className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-900/40">
                                            <table className="w-full text-left text-sm whitespace-nowrap">
                                                <thead className="text-xs text-slate-400 uppercase bg-slate-950/80">
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
                                                <tbody className="divide-y divide-slate-800">
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
                                                                    <tr className="hover:bg-slate-800/30 transition-colors">
                                                                        <td className="p-4">
                                                                            <div className="font-bold text-white">{entry.name || 'Unnamed Player'}</div>
                                                                            <div className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                                                                                <span>{entry.email}</span>
                                                                                <span className="text-slate-600">•</span>
                                                                                <span className="font-mono text-slate-500">{entry.id}</span>
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
                                                                                className="w-16 bg-slate-950 border border-slate-700 rounded-lg p-1 text-center font-bold text-white focus:outline-none focus:border-indigo-500"
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
                                                                                className="w-16 bg-slate-950 border border-slate-700 rounded-lg p-1 text-center text-white focus:outline-none focus:border-indigo-500"
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
                                                                                className="w-20 bg-slate-950 border border-slate-700 rounded-lg p-1 text-center font-bold text-emerald-400 focus:outline-none focus:border-indigo-500"
                                                                            />
                                                                        </td>
                                                                        <td className="p-4 text-center">
                                                                            <button
                                                                                onClick={() => setExpandedPicksEntryId(isExpanded ? null : entry.id)}
                                                                                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 text-xs font-bold text-slate-300 transition-colors"
                                                                            >
                                                                                {isExpanded ? 'Hide Picks' : `View Picks (${entry.picks ? Object.keys(entry.picks).length : 0})`}
                                                                            </button>
                                                                        </td>
                                                                        <td className="p-4 text-center">
                                                                            <button
                                                                                onClick={() => handleToggleEntryPaidAdmin(entry.id, entry.paidStatus)}
                                                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                                                                                    entry.paidStatus === 'PAID'
                                                                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                                                                        : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
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
                                                                                    className="p-2 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 border border-indigo-500/30 rounded-lg transition-colors"
                                                                                >
                                                                                    <CheckCircle size={16} />
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => handleDeleteEntryAdmin(entry.id, entry.name)}
                                                                                    title="Delete Entry"
                                                                                    className="p-2 bg-rose-600/20 hover:bg-rose-600/40 text-rose-400 border border-rose-500/30 rounded-lg transition-colors"
                                                                                >
                                                                                    <Trash2 size={16} />
                                                                                </button>
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                    {isExpanded && (
                                                                        <tr className="bg-slate-950/40">
                                                                            <td colSpan={7} className="p-4 border-l border-r border-slate-800">
                                                                                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                                                                                    <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                                                                                        <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Raw Picks Sheet</span>
                                                                                        <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded-lg text-slate-400">JSON Format</span>
                                                                                    </div>
                                                                                    <pre className="text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap max-h-40 leading-relaxed bg-slate-900/40 p-3 rounded-lg border border-slate-800/60">
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
                                                            <td colSpan={7} className="p-8 text-center text-slate-500">
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
                                    <div className="space-y-6 max-w-xl mx-auto bg-slate-800/20 p-6 rounded-xl border border-slate-700/50">
                                        <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2 border-b border-rose-950/80 pb-2 text-rose-400">
                                            <Shield size={20} className="text-rose-500 animate-pulse" /> Super Administrative Overrides
                                        </h3>
                                        <div className="space-y-4">
                                            <div className="p-4 bg-slate-900/80 rounded-xl border border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                                <div>
                                                    <h4 className="font-bold text-white text-sm">Synchronize Scores & Sync</h4>
                                                    <p className="text-xs text-slate-500 mt-0.5">Force recalculating entries and pull results from ESPN.</p>
                                                </div>
                                                <button
                                                    onClick={() => handleFixScores(viewingPool as GameState)}
                                                    className="w-full sm:w-auto px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5"
                                                >
                                                    <RefreshCw size={14} />
                                                    Process ESPN Sync
                                                </button>
                                            </div>

                                            {viewingPool.type === 'BRACKET' && (
                                                <div className="p-4 bg-slate-900/80 rounded-xl border border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                                    <div>
                                                        <h4 className="font-bold text-white text-sm">Force Re-Open Pool</h4>
                                                        <p className="text-xs text-slate-500 mt-0.5">Change status back to OPEN to allow participants to edit picks.</p>
                                                    </div>
                                                    <button
                                                        onClick={() => handleForceReopenPool(viewingPool)}
                                                        className="w-full sm:w-auto px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5"
                                                    >
                                                        <Lock size={14} />
                                                        Force Re-Open
                                                    </button>
                                                </div>
                                            )}

                                            {viewingPool.type === 'BRACKET' && (
                                                <div className="p-4 bg-slate-900/80 rounded-xl border border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                                    <div>
                                                        <h4 className="font-bold text-white text-sm">Close Pool Settings</h4>
                                                        <p className="text-xs text-slate-500 mt-0.5">Lock pool and transition status directly to COMPLETED.</p>
                                                    </div>
                                                    <button
                                                        onClick={() => { handleClosePool(viewingPool as unknown as Pool); setViewingPool(null); }}
                                                        className="w-full sm:w-auto px-4 py-2.5 bg-rose-700 hover:bg-rose-600 text-white rounded-xl text-xs font-bold transition-all shadow-md"
                                                    >
                                                        Close Pool
                                                    </button>
                                                </div>
                                            )}

                                            <div className="p-4 bg-slate-900/80 rounded-xl border border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                                <div>
                                                    <h4 className="font-bold text-white text-sm">Manage Live Site Panel</h4>
                                                    <p className="text-xs text-slate-500 mt-0.5">Open the host custom settings wizard panel directly.</p>
                                                </div>
                                                <button
                                                    onClick={() => window.location.href = `/admin/${viewingPool.id}`}
                                                    className="w-full sm:w-auto px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-bold transition-all shadow-md text-center"
                                                >
                                                    Configure settings
                                                </button>
                                            </div>

                                            <div className="p-4 bg-rose-950/15 rounded-xl border border-rose-900/30 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                                <div>
                                                    <h4 className="font-bold text-rose-400 text-sm">Destroy Pool and Contents</h4>
                                                    <p className="text-xs text-rose-300/40 mt-0.5">Permanently delete pool configuration, entries, logs, and statistics.</p>
                                                </div>
                                                <button
                                                    onClick={() => { handleDeletePool(viewingPool.id); setViewingPool(null); }}
                                                    className="w-full sm:w-auto px-4 py-2.5 bg-rose-900/40 border border-rose-700 hover:bg-rose-900/60 text-rose-200 rounded-xl text-xs font-bold transition-all shadow-md"
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
                        <div className="bg-slate-800 p-6 rounded-xl border border-slate-600 w-full max-w-md shadow-2xl">
                            <h3 className="text-xl font-bold text-white mb-4">Edit User</h3>
                            <div className="space-y-4 mb-6">
                                <div>
                                    <label className="block text-xs uppercase text-slate-400 font-bold mb-1">Name</label>
                                    <input value={editName} onChange={e => setEditName(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" />
                                </div>
                                <div>
                                    <label className="block text-xs uppercase text-slate-400 font-bold mb-1">Email</label>
                                    <input value={editEmail} onChange={e => setEditEmail(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" />
                                </div>
                            </div>
                            <div className="flex justify-end gap-3">
                                <button onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-white font-bold text-sm">Cancel</button>
                                <button onClick={saveUserChanges} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded font-bold text-sm">Save Changes</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* VIEW USER MODAL (Existing logic preserved) */}
            {
                viewingUser && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                        <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
                            <div className="p-6 border-b border-slate-700 flex justify-between items-start bg-slate-950/50 rounded-t-2xl">
                                <div>
                                    <h2 className="text-3xl font-bold text-white mb-1">{viewingUser.name}</h2>
                                    <p className="text-slate-400 flex items-center gap-2 text-sm">
                                        <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300 border border-slate-700">ID: {viewingUser.id}</span>
                                        <span className="text-slate-500">•</span>
                                        <span>{viewingUser.email}</span>
                                    </p>
                                </div>
                                <button onClick={() => setViewingUser(null)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-white transition-colors">
                                    <span className="sr-only">Close</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>

                            <div className="p-6">
                                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                                    <Activity size={20} className="text-indigo-400" /> Pools Managed by {viewingUser.name.split(' ')[0]}
                                </h3>

                                {pools.filter(p => {
                                    const owner = p.type === 'BRACKET' ? (p as unknown as PoolLike).managerUid as string : (p as unknown as PoolLike).ownerId as string;
                                    return owner === viewingUser.id;
                                }).length === 0 ? (
                                    <div className="p-8 text-center bg-slate-800/50 rounded-xl border border-dashed border-slate-700">
                                        <p className="text-slate-500 font-medium">No pools found for this user.</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {pools.filter(p => {
                                            const owner = p.type === 'BRACKET' ? (p as unknown as PoolLike).managerUid as string : (p as unknown as PoolLike).ownerId as string;
                                            return owner === viewingUser.id;
                                        }).map(pool => {
                                            const isBracket = pool.type === 'BRACKET';
                                            return (
                                                <div key={pool.id} className="bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-indigo-500/50 transition-colors group">
                                                    <div className="flex justify-between items-start mb-3">
                                                        <div>
                                                            <h4 className="font-bold text-white text-lg group-hover:text-indigo-400 transition-colors">{pool.name}</h4>
                                                            <p className="text-xs text-slate-400 uppercase font-bold mt-1">
                                                                {isBracket ? 'Tournament Bracket' : `${(pool as GameState).awayTeam} vs ${(pool as GameState).homeTeam}`}
                                                            </p>
                                                        </div>
                                                        {!isBracket && (pool as GameState).charity?.enabled && <Heart size={16} className="text-rose-500 fill-rose-500" />}
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-2 text-sm text-slate-400 mb-4 bg-slate-900/50 p-3 rounded-lg">
                                                        {isBracket ? (
                                                            <>
                                                                <div>Entries: <span className="text-white font-mono">{(pool as unknown as PoolLike).entryCount as number || 0}</span></div>
                                                                <div>Status: <span className={(pool as unknown as PoolLike).status === 'LOCKED' ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>{(pool as unknown as PoolLike).status as string || 'OPEN'}</span></div>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <div>Squares: <span className="text-white font-mono">{(pool as GameState).squares.filter(s => s.owner).length}/100</span></div>
                                                                <div>Status: <span className={(pool as GameState).isLocked ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>{(pool as GameState).isLocked ? 'LOCKED' : 'OPEN'}</span></div>
                                                            </>
                                                        )}
                                                    </div>

                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => {
                                                                window.location.href = `/admin/${pool.id}`;
                                                                setViewingUser(null);
                                                            }}
                                                            className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded font-bold text-sm transition-colors text-center"
                                                        >
                                                            Manage Pool
                                                        </button>
                                                        <a
                                                            href={`#pool/${pool.id}`}
                                                            target="_blank"
                                                            className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded font-bold text-sm transition-colors text-center"
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
                        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                            <h3 className="text-xl font-bold mb-4">Manage Global Categories</h3>
                            <div className="flex flex-wrap gap-2 mb-4">
                                {availableCategories.map(cat => (
                                    <div key={cat} className="flex items-center gap-1 bg-slate-700 text-slate-200 px-3 py-1 rounded-full text-sm font-bold border border-slate-600">
                                        <span>{cat}</span>
                                        <button
                                            onClick={() => handleRemoveCategory(cat)}
                                            className="hover:text-rose-400 p-0.5 rounded-full transition-colors"
                                            title="Remove Category"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <input
                                    className="bg-slate-900 border border-slate-600 p-2 rounded text-white text-sm"
                                    placeholder="New Category Name"
                                    value={newCategoryName}
                                    onChange={e => setNewCategoryName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                                />
                                <button
                                    onClick={handleAddCategory}
                                    disabled={!newCategoryName}
                                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-bold flex items-center gap-2"
                                >
                                    <Plus size={16} /> Add
                                </button>
                            </div>
                        </div>

                        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                            <h3 className="text-xl font-bold mb-4">{editingSeed ? 'Edit Seed Question' : 'Add New Seed Question'}</h3>
                            <div className="grid gap-4 bg-slate-900/50 p-4 rounded-lg">
                                <input
                                    className="w-full bg-slate-800 border border-slate-700 p-2 rounded text-white"
                                    placeholder="Question Text (e.g. Who wins the coin toss?)"
                                    value={seedText}
                                    onChange={e => setSeedText(e.target.value)}
                                />
                                <div className="grid grid-cols-2 gap-4">
                                    <input
                                        className="w-full bg-slate-800 border border-slate-700 p-2 rounded text-white"
                                        placeholder="Option 1 (e.g. Heads)"
                                        value={seedOpt1}
                                        onChange={e => setSeedOpt1(e.target.value)}
                                    />
                                    <input
                                        className="w-full bg-slate-800 border border-slate-700 p-2 rounded text-white"
                                        placeholder="Option 2 (e.g. Tails)"
                                        value={seedOpt2}
                                        onChange={e => setSeedOpt2(e.target.value)}
                                    />
                                </div>

                                <div>
                                    <label className="text-xs text-slate-400 font-bold uppercase mb-2 block">Categories</label>
                                    <div className="flex flex-wrap gap-2">
                                        {availableCategories.map(cat => (
                                            <button
                                                key={cat}
                                                onClick={() => toggleCategory(cat)}
                                                className={`px-3 py-1 rounded-full text-xs font-bold transition-all border ${seedCategories.includes(cat)
                                                    ? 'bg-indigo-500 text-white border-indigo-400'
                                                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500'
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
                                            className="px-4 py-2 text-slate-400 hover:text-white"
                                        >
                                            Cancel
                                        </button>
                                    )}
                                    <button
                                        onClick={handleSaveSeed}
                                        disabled={!seedText || !seedOpt1 || !seedOpt2}
                                        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2 rounded font-bold"
                                    >
                                        {editingSeed ? 'Update Seed' : 'Add Seed'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                            <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex flex-col md:flex-row gap-4 justify-between items-center">
                                <div className="flex items-center gap-4">
                                    <h3 className="font-bold">Seed Library ({propSeeds.length})</h3>
                                    <button
                                        onClick={handleSeedNCAAProps}
                                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded text-xs font-bold transition-colors shadow-lg shadow-emerald-500/20"
                                    >
                                        Seed NCAA Props
                                    </button>
                                </div>
                                <div className="flex gap-2 text-xs overflow-x-auto max-w-full pb-2 md:pb-0">
                                    <button
                                        onClick={() => setSeedCategoryFilter('All')}
                                        className={`px-3 py-1 rounded-full font-bold transition-colors ${seedCategoryFilter === 'All' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
                                    >
                                        All
                                    </button>
                                    {availableCategories.map(cat => (
                                        <button
                                            key={cat}
                                            onClick={() => setSeedCategoryFilter(cat)}
                                            className={`px-3 py-1 rounded-full font-bold transition-colors ${seedCategoryFilter === cat ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
                                        >
                                            {cat}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="divide-y divide-slate-700">
                                {propSeeds
                                    .filter(s => seedCategoryFilter === 'All' || s.categories?.includes(seedCategoryFilter) || s.category === seedCategoryFilter)
                                    .map(seed => (
                                        <div key={seed.id} className="p-4 hover:bg-slate-700/20 flex justify-between items-center group">
                                            <div>
                                                <p className="font-medium text-white">{seed.text}</p>
                                                <p className="text-sm text-slate-400 mb-1">{seed.options.join(' vs ')}</p>
                                                <div className="flex gap-1 flex-wrap">
                                                    {seed.categories?.map(c => (
                                                        <span key={c} className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
                                                            {c}
                                                        </span>
                                                    ))}
                                                    {!seed.categories && seed.category && (
                                                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">{seed.category}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => handleEditSeed(seed)} className="text-indigo-400 hover:text-indigo-300 p-2 bg-slate-800 rounded">
                                                    <Settings size={16} />
                                                </button>
                                                <button onClick={() => handleDeleteSeed(seed.id)} className="text-rose-400 hover:text-rose-300 p-2 bg-slate-800 rounded">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                {propSeeds.length === 0 && (
                                    <div className="p-8 text-center text-slate-500">
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
                    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                            <div>
                                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                                    <Trophy className="text-amber-500" /> Playoff Challenge Configuration
                                </h2>
                                <p className="text-slate-400">Global configuration for teams, seeds, and elimination status.</p>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowResultsManager(true)}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-xl font-bold transition-all shadow-lg shadow-indigo-500/20 flex items-center gap-2"
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
                                    className="bg-slate-700 hover:bg-slate-600 text-slate-300 px-4 py-2 rounded-lg font-bold text-sm transition-colors"
                                >
                                    Reset Default Teams
                                </button>
                                <button
                                    onClick={handleSavePlayoffs}
                                    disabled={isSavingPlayoffs}
                                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-6 py-2 rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/20"
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
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-xl font-bold transition-all shadow-lg shadow-indigo-500/20 flex items-center gap-2"
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
                                <h3 className="text-xl font-black text-red-500 flex items-center justify-between border-b border-red-500/20 pb-2">
                                    AFC CONFERENCE
                                    <button onClick={() => addPlayoffTeam('AFC')} className="text-[10px] bg-red-500/10 hover:bg-red-500/20 text-red-400 px-2 py-1 rounded border border-red-500/30">ADD TEAM</button>
                                </h3>
                                <div className="space-y-3">
                                    {playoffTeams.filter(t => t.conference === 'AFC').sort((a, b) => a.seed - b.seed).map((team) => {
                                        const overallIdx = playoffTeams.indexOf(team);
                                        const logo = getTeamLogo(team.id);
                                        return (
                                            <div key={overallIdx} className={`p-4 rounded-xl border transition-all ${team.eliminated ? 'bg-slate-900/50 border-slate-800 opacity-50' : 'bg-slate-900 border-slate-700 shadow-lg'}`}>
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 bg-slate-800 rounded-lg flex items-center justify-center p-1 border border-slate-700">
                                                        {logo ? <img src={logo} alt={team.id} className="w-full h-full object-contain" /> : <div className="font-bold text-slate-500">{team.id || '?'}</div>}
                                                    </div>
                                                    <div className="flex-1 grid grid-cols-2 gap-3">
                                                        <div className="col-span-2">
                                                            <select
                                                                value={team.id}
                                                                onChange={(e) => {
                                                                    const t = Object.values(NFL_TEAMS).find(nt => nt.abbr === e.target.value);
                                                                    if (t) updatePlayoffTeam(overallIdx, { id: t.abbr, name: t.name });
                                                                }}
                                                                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-white font-bold text-sm"
                                                            >
                                                                <option value="">Select Team...</option>
                                                                {Object.values(NFL_TEAMS).sort((a, b) => a.name.localeCompare(b.name)).map(nt => (
                                                                    <option key={nt.abbr} value={nt.abbr}>{nt.name}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Seed</label>
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                max="8"
                                                                value={team.seed}
                                                                onChange={(e) => updatePlayoffTeam(overallIdx, { seed: parseInt(e.target.value) })}
                                                                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white font-bold"
                                                            />
                                                        </div>
                                                        <div className="flex items-center justify-end gap-4 pt-4">
                                                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={team.eliminated}
                                                                    onChange={(e) => updatePlayoffTeam(overallIdx, { eliminated: e.target.checked })}
                                                                    className="w-4 h-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-slate-950"
                                                                />
                                                                <span className="text-xs font-bold text-slate-400">Eliminated</span>
                                                            </label>
                                                            <button onClick={() => removePlayoffTeam(overallIdx)} className="text-rose-500 hover:text-rose-400 p-1"><Trash2 size={16} /></button>
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
                                <h3 className="text-xl font-black text-blue-500 flex items-center justify-between border-b border-blue-500/20 pb-2">
                                    NFC CONFERENCE
                                    <button onClick={() => addPlayoffTeam('NFC')} className="text-[10px] bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 px-2 py-1 rounded border border-blue-500/30">ADD TEAM</button>
                                </h3>
                                <div className="space-y-3">
                                    {playoffTeams.filter(t => t.conference === 'NFC').sort((a, b) => a.seed - b.seed).map((team) => {
                                        const overallIdx = playoffTeams.indexOf(team);
                                        const logo = getTeamLogo(team.id);
                                        return (
                                            <div key={overallIdx} className={`p-4 rounded-xl border transition-all ${team.eliminated ? 'bg-slate-900/50 border-slate-800 opacity-50' : 'bg-slate-900 border-slate-700 shadow-lg'}`}>
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 bg-slate-800 rounded-lg flex items-center justify-center p-1 border border-slate-700">
                                                        {logo ? <img src={logo} alt={team.id} className="w-full h-full object-contain" /> : <div className="font-bold text-slate-500">{team.id || '?'}</div>}
                                                    </div>
                                                    <div className="flex-1 grid grid-cols-2 gap-3">
                                                        <div className="col-span-2">
                                                            <select
                                                                value={team.id}
                                                                onChange={(e) => {
                                                                    const t = Object.values(NFL_TEAMS).find(nt => nt.abbr === e.target.value);
                                                                    if (t) updatePlayoffTeam(overallIdx, { id: t.abbr, name: t.name });
                                                                }}
                                                                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-white font-bold text-sm"
                                                            >
                                                                <option value="">Select Team...</option>
                                                                {Object.values(NFL_TEAMS).sort((a, b) => a.name.localeCompare(b.name)).map(nt => (
                                                                    <option key={nt.abbr} value={nt.abbr}>{nt.name}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Seed</label>
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                max="8"
                                                                value={team.seed}
                                                                onChange={(e) => updatePlayoffTeam(overallIdx, { seed: parseInt(e.target.value) })}
                                                                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white font-bold"
                                                            />
                                                        </div>
                                                        <div className="flex items-center justify-end gap-4 pt-4">
                                                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={team.eliminated}
                                                                    onChange={(e) => updatePlayoffTeam(overallIdx, { eliminated: e.target.checked })}
                                                                    className="w-4 h-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-slate-950"
                                                                />
                                                                <span className="text-xs font-bold text-slate-400">Eliminated</span>
                                                            </label>
                                                            <button onClick={() => removePlayoffTeam(overallIdx)} className="text-rose-500 hover:text-rose-400 p-1"><Trash2 size={16} /></button>
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
                            <div className="text-center p-12 bg-slate-900 rounded-2xl border border-dashed border-slate-700 mt-8">
                                <Trophy size={48} className="text-slate-700 mx-auto mb-4" />
                                <p className="text-slate-400">No teams configured yet. Reset to defaults or add teams manually.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ============ NFL SCHEDULE TAB ============ */}
            {activeTab === 'nfl' && (
                <div className="space-y-6">
                    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-3 bg-indigo-500/20 rounded-xl text-indigo-400">
                                <Activity size={24} />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-white">NFL Schedule Bulk Importer</h3>
                                <p className="text-sm text-slate-400">Import weekly or seasonal game data from official ESPN feeds.</p>
                            </div>
                        </div>

                        {nflImportResult && (
                            <div className={`p-4 rounded-xl text-xs font-bold mb-6 flex gap-2 items-center ${
                                nflImportResult.type === 'success'
                                    ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400'
                                    : 'bg-rose-500/10 border border-rose-500/25 text-rose-400'
                            }`}>
                                {nflImportResult.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
                                {nflImportResult.message}
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* Season Input */}
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-2">Season Year</label>
                                <input
                                    type="text"
                                    value={nflSeason}
                                    onChange={(e) => setNflSeason(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white font-bold text-sm focus:outline-none focus:border-indigo-500"
                                    placeholder="e.g. 2026"
                                />
                            </div>

                            {/* Season Type Selection */}
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-2">Season Type</label>
                                <select
                                    value={nflSeasonType}
                                    onChange={(e) => setNflSeasonType(parseInt(e.target.value))}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white font-bold text-sm focus:outline-none focus:border-indigo-500"
                                >
                                    <option value={1}>Preseason</option>
                                    <option value={2}>Regular Season</option>
                                    <option value={3}>Postseason</option>
                                </select>
                            </div>

                            {/* Weeks Filter */}
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-2">Weeks Filter</label>
                                <select
                                    value={nflWeeks}
                                    onChange={(e) => setNflWeeks(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white font-bold text-sm focus:outline-none focus:border-indigo-500"
                                >
                                    <option value="all">All 18 Weeks (Regular)</option>
                                    <option value="specific">Specific Week Only</option>
                                </select>
                            </div>
                        </div>

                        {/* Specific Week Selector */}
                        {nflWeeks === 'specific' && (
                            <div className="mt-6 max-w-xs">
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-2">Select Week</label>
                                <select
                                    value={selectedNflWeek}
                                    onChange={(e) => setSelectedNflWeek(parseInt(e.target.value))}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white font-bold text-sm focus:outline-none focus:border-indigo-500"
                                >
                                    {Array.from({ length: 18 }, (_, i) => i + 1).map(w => (
                                        <option key={w} value={w}>Week {w}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="mt-8 flex justify-end">
                            <button
                                onClick={handleImportNFLSchedule}
                                disabled={isImportingNfl || !nflSeason}
                                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-extrabold px-6 py-3 rounded-xl text-sm transition-all hover:scale-[1.02] shadow-lg shadow-indigo-600/15 flex items-center gap-2 cursor-pointer"
                            >
                                <RefreshCw size={16} className={isImportingNfl ? 'animate-spin' : ''} />
                                {isImportingNfl ? 'Seeding games...' : 'Bulk Import ESPN NFL Schedule'}
                            </button>
                        </div>
                    </div>

                    {/* NFL Spread Override */}
                    <SuperAdminNFLSpreads />
                </div>
            )}

        </div >
    );
};
