import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader, Shield, Edit2, ChevronUp, ChevronDown, Lock, Zap, HelpCircle, ExternalLink, Check, Copy, Heart } from 'lucide-react';

import { Header } from '../Header';
import { Footer } from '../Footer';
import { ShareModal, AuthModal } from '../modals';
import { PoolTimer } from '../PoolTimer';
import { Grid } from '../Grid';
import { AuditLog } from '../AuditLog';
import { AICommissioner } from '../AICommissioner';


import { BracketPoolDashboard } from '../BracketPoolDashboard/BracketPoolDashboard';
import { PropsPoolDashboard } from '../PropsPoolDashboard/PropsPoolDashboard';
import { PlayoffDashboard } from '../PlayoffPool/PlayoffDashboard';


import { dbService } from '../../services/dbService';
import { calculateScenarioWinners, getLastDigit } from '../../services/gameLogic';
import { getTeamLogo } from '../../constants';
import { calculateQuarterlyPayouts } from '../../utils/payouts';
import type { User, Pool, GameState, PropsPool, PlayoffPool, Winner } from '../../types';

interface PoolRouteProps {
    user: User | null;
    pools: Pool[]; // Changed from pool: Pool | null
    isLoading: boolean;
    onOpenAuth: () => void;
    onLogout: () => void;
    onCreatePool: () => void;
}

export const PoolRoute: React.FC<PoolRouteProps> = ({
    user,
    pools,
    isLoading,
    onOpenAuth,
    onLogout,
    onCreatePool
}) => {
    const navigate = useNavigate();
    const { id } = useParams();

    // Find pool logic
    // Find pool logic
    // We now subscribe to the pool directly to ensure real-time updates (Issue #FixReservation)
    const [pool, setPool] = useState<Pool | null>(null);
    const [isFetchingPool, setIsFetchingPool] = useState(true);

    useEffect(() => {
        if (!id) return;

        // Optimistically set from global cache if available to prevent flash
        // We do not add pools to default dependency to avoid re-subscribing on every global update
        const cached = pools.find(p => p.id === id || (p as any).slug === id || (p as any).urlSlug === id);
        if (cached) {
            setPool(cached);
            setIsFetchingPool(false);
        } else {
            setIsFetchingPool(true);
        }

        const unsubscribe = dbService.subscribeToPool(id, (p) => {
            setPool(p);
            setIsFetchingPool(false);
        });
        return () => unsubscribe();
    }, [id]);

    // State for winners
    const [winners, setWinners] = useState<Winner[]>([]);

    useEffect(() => {
        if (!pool) return;
        // Subscribe to winners subcollection
        const unsubscribe = dbService.subscribeToWinners(pool.id, (data) => {
            setWinners(data);
        });
        return () => unsubscribe();
    }, [pool]);



    // Calculate isManager
    const isManager = useMemo(() => {
        if (!user || !pool) return false;
        return user.id === pool.ownerId || user.id === (pool as any).managerUid;
    }, [user, pool]);

    // State moved from App.tsx
    const [statusTab, setStatusTab] = useState<'overview' | 'rules' | 'payment'>('overview');
    const [showPoolInfo, setShowPoolInfo] = useState(true);
    const [showAudit, setShowAudit] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);
    const [shareUrl, setShareUrl] = useState('');
    const [showRulesModal, setShowRulesModal] = useState(false);
    const [zelleCopied, setZelleCopied] = useState(false);

    // Auth Modal local state
    const [showAuthModalLocal, setShowAuthModalLocal] = useState(false);
    const [authModeLocal, setAuthModeLocal] = useState<'login' | 'register'>('login');

    const handleLocalAuth = (mode: 'login' | 'register') => {
        setAuthModeLocal(mode);
        setShowAuthModalLocal(true);
    };

    // Password Gate (Local) moved to top
    const [enteredPassword, setEnteredPassword] = useState('');
    const [passwordError, setPasswordError] = useState(false);
    const [isUnlocked, setIsUnlocked] = useState(false);

    // Quarterly Payouts (Moved to top)
    const quarterlyPayouts = useMemo(() => {
        if (!pool || pool.type !== 'SQUARES') {
            console.log('[PoolRoute] Quarterly Payouts: Pool not SQUARES or null', pool?.type);
            return [];
        }
        const res = calculateQuarterlyPayouts(pool as GameState, winners);
        console.log('[PoolRoute] Quarterly Payouts Calculated:', res.length, 'First:', res[0]?.amount);
        return res;
    }, [pool, winners]);

    if (isLoading || isFetchingPool) return <div className="text-white p-10 flex flex-col items-center gap-4"><Loader className="animate-spin text-indigo-500" size={48} /><p>Loading Pool...</p></div>;

    if (!pool) {
        return (
            <div className="text-white p-10 font-mono flex flex-col items-center justify-center min-h-[50vh]">
                <h2 className="text-xl font-bold mb-4 text-rose-400">Pool Not Found</h2>
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 max-w-2xl w-full text-sm space-y-2 shadow-2xl">
                    <p><strong>ID/Slug:</strong> <span className="text-amber-300">"{id}"</span></p>
                    <div className="pt-4 flex gap-4">
                        <button onClick={() => navigate('/')} className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded text-white font-bold transition-colors">Go Home</button>
                        <button onClick={() => window.location.reload()} className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded text-white font-bold transition-colors">Reload Page</button>
                    </div>
                </div>
            </div>
        );
    }

    const openShare = (poolId: string) => {
        const identifier = (pool.type === 'BRACKET' ? pool.slug : pool.urlSlug) || poolId;
        const url = `${window.location.origin}/pool/${identifier}`;
        setShareUrl(url);
        setShowShareModal(true);
    };

    if (pool.type === 'BRACKET') {
        return (
            <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white flex flex-col">
                <Header
                    user={user}
                    isManager={isManager}
                    onOpenAuth={onOpenAuth}
                    onLogout={onLogout}
                    onCreatePool={onCreatePool}
                />
                <div className="flex-grow">
                    <BracketPoolDashboard
                        pool={pool}
                        user={user}
                        onBack={() => navigate('/')}
                        onShare={() => {
                            const identifier = pool.slug || pool.id;
                            const url = `${window.location.origin}/pool/${identifier}`;
                            navigator.clipboard.writeText(url);
                            alert("Link copied!");
                        }}
                    />
                </div>
                <Footer />
            </div>
        );
    }

    if (pool.type === 'PROPS') {
        return (
            <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white flex flex-col">
                <Header
                    user={user}
                    isManager={isManager}
                    onOpenAuth={onOpenAuth}
                    onLogout={onLogout}
                    onCreatePool={onCreatePool}
                />
                <div className="flex-grow">
                    <PropsPoolDashboard
                        pool={pool as PropsPool}
                        user={user}
                        isManager={isManager}
                        isAdmin={user?.role === 'SUPER_ADMIN'}
                        onBack={() => navigate('/')}
                        onOpenAuth={onOpenAuth}
                    />
                </div>
                <Footer />
            </div>
        );
    }

    if (pool.type === 'NFL_PLAYOFFS') {
        return (
            <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white flex flex-col">
                <Header
                    user={user}
                    isManager={isManager}
                    onOpenAuth={onOpenAuth}
                    onLogout={onLogout}
                    onCreatePool={onCreatePool}
                />
                <div className="flex-grow">
                    <PlayoffDashboard
                        pool={pool as PlayoffPool}
                        user={user}
                        onBack={() => navigate('/')}
                    />
                </div>
                <Footer />
            </div>
        );
    }

    // --- SQUARES LOGIC ---
    const squaresPool = pool as GameState;

    // Helper Functions

    // Claim Logic
    const handleClaimSquares = async (ids: number[], name: string, details: { email?: string, phone?: string }, guestKey?: string) => {
        if (!ids.length && !name) return { success: false, message: 'Invalid data' };
        if (!name.trim()) return { success: false, message: 'Name is required' };
        // Validations
        const normalizedName = name.trim();
        // Check for taking existing
        if (ids.some(id => squaresPool.squares[id]?.owner && squaresPool.squares[id].owner !== normalizedName)) {
            return { success: false, message: 'Square already taken.' };
        }
        // Max limit
        const currentOwned = squaresPool.squares.filter((s: any) => s.owner === normalizedName).length;
        const limit = Number(squaresPool.maxSquaresPerPlayer) || 10;
        if (currentOwned + ids.length > limit && squaresPool.ownerId !== user?.id) return { success: false, message: `Limit exceeded. Max ${limit}.` };

        try {
            const promises = ids.map(id => dbService.reserveSquare(
                squaresPool.id,
                id,
                { ...details, name: normalizedName },
                guestKey,
                normalizedName
            ));
            await Promise.all(promises);
        } catch (error: any) {
            console.error("Reserve failed", error);
            return { success: false, message: error.message || "Reservation failed." };
        }

        // Email Confirmation Trigger (Client Side for now per original App.tsx)
        if ((squaresPool.emailConfirmation === 'Email Confirmation' || squaresPool.emailConfirmation === 'true') && details.email) {
            const ownerId = (pool as any).ownerId || (pool as any).managerUid;
            import('../../services/emailService').then(({ emailService }) => {
                emailService.sendConfirmation(
                    squaresPool.name,
                    ids.map(id => ({ id, cost: squaresPool.costPerSquare })),
                    details.email!,
                    normalizedName,
                    squaresPool.id,
                    {
                        ruleVariations: squaresPool.ruleVariations,
                        charity: squaresPool.charity,
                        costPerSquare: squaresPool.costPerSquare,
                        payouts: squaresPool.payouts
                    },
                    ownerId,
                    squaresPool.paymentHandles
                ).catch(err => console.error('[PoolRoute] Email failed', err));
            }).catch(err => console.error('[PoolRoute] Failed to import emailService', err));
        }

        return { success: true };
    };

    const handleJoinWaitlist = async (name: string, email: string) => {
        if (squaresPool.waitlist?.some(w => w.email.toLowerCase() === email.toLowerCase())) {
            return { success: false, message: 'You are already on the waitlist!' };
        }
        try {
            await dbService.joinWaitlist(squaresPool.id, { email, name, timestamp: Date.now() });
            return { success: true, message: 'You have been added to the waitlist!' };
        } catch (error: any) {
            return { success: false, message: error.message || 'Failed to join waitlist.' };
        }
    };

    const handlePasswordSubmit = () => {
        if (enteredPassword === squaresPool.gridPassword) {
            setIsUnlocked(true);
            setPasswordError(false);
        } else {
            setPasswordError(true);
        }
    };


    // Actually it was mainly for debug in header.

    const renderPasswordGate = () => (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 max-w-md w-full text-center">
                <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-6"><Lock size={32} className="text-indigo-500" /></div>
                <h2 className="text-2xl font-bold text-white mb-2">Password Protected</h2>
                <p className="text-slate-400 mb-6">This pool is private. Please enter the password to view it.</p>
                {passwordError && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3 rounded-lg text-sm mb-4">Incorrect password.</div>}
                <div className="flex gap-2">
                    <input type="password" value={enteredPassword} onChange={(e) => setEnteredPassword(e.target.value)} placeholder="Enter Password" className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white outline-none focus:border-indigo-500" onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()} />
                    <button onClick={handlePasswordSubmit} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-6 rounded-lg">Unlock</button>
                </div>
                <div className="mt-6 pt-6 border-t border-slate-800"><p className="text-xs text-slate-500">Contact the pool manager for access.</p></div>
            </div>
        </div>
    );

    if (squaresPool.gridPassword && !isUnlocked && user?.id !== squaresPool.ownerId) {
        return renderPasswordGate();
    }

    const homeLogo = squaresPool.homeTeamLogo || getTeamLogo(squaresPool.homeTeam);
    const awayLogo = squaresPool.awayTeamLogo || getTeamLogo(squaresPool.awayTeam);
    const homePredictions = calculateScenarioWinners(squaresPool, 'home');
    const awayPredictions = calculateScenarioWinners(squaresPool, 'away');
    const squaresRemaining = 100 - (squaresPool.squares?.filter(s => s.owner).length || 0);
    const latestWinner = winners.length > 0 ? winners[winners.length - 1].owner : null;

    return (
        <div
            className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white pb-20 relative transition-colors duration-500"
            style={{ backgroundColor: squaresPool.branding?.backgroundColor || '#020617' }}
        >
            <Header user={user} isManager={isManager} onOpenAuth={onOpenAuth} onLogout={onLogout} onCreatePool={onCreatePool} />
            <ShareModal isOpen={showShareModal} onClose={() => setShowShareModal(false)} shareUrl={shareUrl} />

            {/* Header Content */}
            <div className="max-w-[1400px] mx-auto px-4 pt-6 flex justify-between items-center">
                <div className="text-center md:text-left">
                    <div className="flex items-center gap-3 mb-1">
                        {squaresPool.branding?.logoUrl && (
                            <img src={squaresPool.branding.logoUrl} className="h-16 w-auto object-contain drop-shadow-lg" alt="Pool Logo" />
                        )}
                        <h1 className="text-3xl font-bold text-white">{squaresPool.name}</h1>
                        <button onClick={() => setShowAudit(true)} className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors">
                            <Shield size={10} className="fill-emerald-400/20" /> Fully Auditable
                        </button>
                    </div>
                    <p className="text-slate-400 text-sm font-medium">{squaresRemaining} Squares Remaining</p>
                </div>
                <div className="flex gap-2">
                    {user && (user.id === squaresPool.ownerId || user.role === 'SUPER_ADMIN') && (
                        <button onClick={() => navigate(`/admin/${squaresPool.id}`)} className="bg-slate-800 hover:bg-slate-700 text-indigo-400 border border-indigo-500/30 px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2">
                            <Edit2 size={16} /> Manage Pool
                        </button>
                    )}
                    {!user && (
                        <button onClick={() => handleLocalAuth('login')} className="hidden md:block bg-indigo-900/50 hover:bg-indigo-800 text-indigo-200 border border-indigo-500/30 px-4 py-2 rounded-lg text-sm font-bold transition-colors">
                            Sign In to Manage Your Pool
                        </button>
                    )}
                    <button onClick={() => openShare(squaresPool.id)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold">Share</button>
                </div>
            </div>

            {/* Latest Winner Banner */}
            {latestWinner && (
                <div className="flex justify-center mt-4 mb-2">
                    <div className="bg-gradient-to-r from-amber-900/40 to-yellow-900/40 border border-amber-500/50 rounded-full px-8 py-2 text-amber-200 font-bold tracking-widest uppercase shadow-[0_0_20px_rgba(245,158,11,0.1)] flex items-center gap-3">
                        🤑 IN THE MONEY: <span className="text-white text-lg">{latestWinner}</span> 🤑
                    </div>
                </div>
            )}

            <div className="max-w-[1400px] mx-auto px-4 py-6">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-slate-400 font-black uppercase text-xl tracking-wider">Pool Details</h3>
                    <button
                        onClick={() => setShowPoolInfo(!showPoolInfo)}
                        className="bg-slate-900 hover:bg-slate-800 text-slate-400 p-2 rounded-full transition-colors"
                    >
                        {showPoolInfo ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                </div>

                <div className={`transition-all duration-500 ease-in-out overflow-hidden ${showPoolInfo ? 'max-h-[1000px] opacity-100 mb-6' : 'max-h-0 opacity-0 mb-0'}`}>
                    <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 ${(squaresPool as GameState).charity?.enabled ? 'lg:grid-cols-3' : 'lg:grid-cols-2 max-w-5xl mx-auto'}`}>

                        {/* 1. Status Card (Tabbed) */}
                        <div className="bg-black rounded-xl border border-slate-800 shadow-xl flex flex-col overflow-hidden h-full">
                            {/* Tabs Header */}
                            <div className="flex border-b border-slate-800">
                                <button onClick={() => setStatusTab('overview')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${statusTab === 'overview' ? 'bg-slate-900 text-white border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-400 hover:bg-slate-900/50'}`}>Overview</button>
                                <button onClick={() => setStatusTab('rules')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${statusTab === 'rules' ? 'bg-slate-900 text-white border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-400 hover:bg-slate-900/50'}`}>Rules</button>
                                <button onClick={() => setStatusTab('payment')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${statusTab === 'payment' ? 'bg-slate-900 text-white border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-400 hover:bg-slate-900/50'}`}>Payment</button>
                            </div>

                            <div className="p-6 flex-1 flex flex-col justify-center">
                                {statusTab === 'overview' && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
                                        <div><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Status:</h3>
                                            {!squaresPool.isLocked ? <div className="flex items-center gap-2"><span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span></span><div><p className="text-emerald-400 font-bold text-sm leading-none">Open</p><p className="text-slate-500 text-[10px]">Grid is available to choose squares</p></div></div>
                                                : squaresPool.scores?.gameStatus === 'post' ? <div className="flex items-center gap-2"><span className="relative flex h-3 w-3"><span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span></span><div><p className="text-blue-500 font-bold text-sm leading-none">Locked - Final</p><p className="text-slate-500 text-[10px]">Game has completed</p></div></div>
                                                    : squaresPool.scores?.gameStatus === 'in' ? <div className="flex items-center gap-2"><span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-rose-600"></span></span><div><p className="text-rose-500 font-bold text-sm leading-none">Locked - Live</p><p className="text-slate-500 text-[10px]">Game has started</p></div></div>
                                                        : <div className="flex items-center gap-2"><Lock size={14} className="text-amber-500" /><div><p className="text-amber-500 font-bold text-sm leading-none">Locked - Pending</p><p className="text-slate-500 text-[10px]">Waiting for kickoff</p></div></div>
                                            }</div>
                                        <div><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Grid Owner:</h3><p className="text-white font-medium">{squaresPool.contactEmail || 'Admin'}</p></div>
                                        <div><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Cost Per Square:</h3><p className="text-white font-medium text-sm">${squaresPool.costPerSquare}</p></div>
                                    </div>
                                )}
                                {statusTab === 'rules' && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                                        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
                                            <PoolTimer
                                                targetDate={squaresPool.scores.startTime}
                                                gameStatus={squaresPool.scores.gameStatus}
                                                isLocked={squaresPool.isLocked || (squaresRemaining === 0 && !!squaresPool.axisNumbers)}
                                            />
                                        </div>
                                        <div><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Limits:</h3><p className="text-white font-medium text-sm">Max {squaresPool.maxSquaresPerPlayer || 'N/A'} squares per player</p></div>
                                        {/* Simplified Rule Buttons */}
                                        <div>
                                            <h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Active Rules:</h3>
                                            <div className="flex flex-wrap gap-2">
                                                {/* Rollover */}
                                                {squaresPool.ruleVariations.quarterlyRollover && (
                                                    <div className="group relative cursor-help">
                                                        <div className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1"><Zap size={12} className="fill-emerald-400" /> Rollover Active</div>
                                                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-slate-800 text-slate-200 text-[10px] p-2 rounded shadow-xl border border-slate-700 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-center">
                                                            Unsold squares roll their prize money to the next quarter.
                                                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-800"></div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Number Sets */}
                                                <div className="group relative cursor-help">
                                                    <div className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1">Number Sets: {squaresPool.numberSets || '1'}</div>
                                                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-slate-800 text-slate-200 text-[10px] p-2 rounded shadow-xl border border-slate-700 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-center">
                                                        {squaresPool.numberSets === 4 ? "New numbers generated for each quarter." : "Same numbers used for the entire game."}
                                                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-800"></div>
                                                    </div>
                                                </div>

                                                {/* Reverse Payouts */}
                                                {squaresPool.ruleVariations.reverseWinners && (
                                                    <div className="group relative cursor-help">
                                                        <div className="bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1">Reverse Numbers</div>
                                                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-slate-800 text-slate-200 text-[10px] p-2 rounded shadow-xl border border-slate-700 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-center">
                                                            Winners split the pot 50/50 with the reverse number combination.
                                                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-800"></div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Every Score Pays */}
                                                {squaresPool.ruleVariations.scoreChangePayout && (
                                                    <div className="group relative cursor-help">
                                                        <div className="bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/30 px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1">Every Score Pays</div>
                                                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-slate-800 text-slate-200 text-[10px] p-2 rounded shadow-xl border border-slate-700 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-center">
                                                            Payouts awarded for every score change, not just at quarter ends.
                                                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-800"></div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <button onClick={() => setShowRulesModal(true)} className="flex items-center gap-2 group hover:text-white transition-colors text-slate-500 text-xs font-bold uppercase tracking-wider">
                                                <HelpCircle size={14} className="text-slate-500 group-hover:text-indigo-400 transition-colors" /> View Full Rules
                                            </button>
                                        </div>
                                    </div>
                                )}
                                {statusTab === 'payment' && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300 w-full">
                                        {(squaresPool.paymentHandles?.venmo || squaresPool.paymentHandles?.zelle) ? (
                                            <div className="flex flex-col gap-2">
                                                {squaresPool.paymentHandles?.venmo && <a href={`https://venmo.com/u/${squaresPool.paymentHandles.venmo.replace('@', '')}`} target="_blank" rel="noreferrer" className="bg-[#008CFF] hover:bg-[#0077D9] text-white px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 justify-center transition-colors w-full">Venmo: {squaresPool.paymentHandles.venmo} <ExternalLink size={14} /></a>}
                                                {squaresPool.paymentHandles?.zelle && <div className="bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 justify-center w-full">Zelle: {squaresPool.paymentHandles.zelle} <button onClick={() => { navigator.clipboard.writeText(squaresPool.paymentHandles?.zelle || ''); setZelleCopied(true); setTimeout(() => setZelleCopied(false), 2000); }} className="ml-2 bg-slate-700 hover:bg-slate-600 p-1.5 rounded transition-colors">{zelleCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} className="text-slate-400 opacity-80" />}</button></div>}
                                            </div>
                                        ) : <div className="text-slate-500 text-xs italic">No digital payment methods configured.</div>}
                                        <div className="border-t border-slate-800 pt-3">
                                            <h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Instructions:</h3>
                                            <p className="text-slate-300 text-sm leading-relaxed max-h-32 overflow-y-auto pr-1">{squaresPool.paymentInstructions || "No additional instructions."}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Charity */}
                        {squaresPool.charity?.enabled && (
                            <div className="bg-slate-900 border border-rose-500/30 rounded-xl p-6 shadow-lg shadow-rose-500/10 relative overflow-hidden flex flex-col justify-center">
                                <div className="absolute top-0 right-0 p-4 opacity-10"><Heart size={80} className="text-rose-500" /></div>
                                <div className="relative z-10">
                                    <div className="flex items-center gap-2 mb-2"><div className="bg-rose-500/20 p-1.5 rounded-lg"><Heart size={18} className="text-rose-400" /></div><h3 className="text-sm font-bold text-white uppercase tracking-wider">Proudly Supporting</h3></div>
                                    <h2 className="text-2xl font-black text-rose-400 mb-1 leading-tight">{squaresPool.charity.name}</h2>
                                    <span className="text-2xl font-mono font-bold text-white">${(Math.floor((squaresPool.squares.filter(s => s.owner).length * squaresPool.costPerSquare * (squaresPool.charity.percentage / 100)))).toLocaleString()}</span>
                                </div>
                            </div>
                        )}

                        {/* Payout Structure Card - Simplified */}
                        <div className="bg-black rounded-xl border border-slate-800 shadow-xl flex flex-col overflow-hidden h-full">
                            <div className="flex border-b border-slate-800 bg-slate-900 px-6 py-4"><h3 className="text-sm font-bold uppercase tracking-wider text-white">Payout Structure</h3></div>
                            <div className="p-6 flex-1 flex flex-col justify-center">
                                <div className="flex justify-between items-center text-sm border-b border-slate-800 pb-2"><span className="text-slate-400">Total Pot</span><span className="text-white font-mono font-bold">${(squaresPool.squares.filter((s: any) => s.owner).length * squaresPool.costPerSquare).toLocaleString()}</span></div>
                                <div className="flex justify-between items-center text-sm border-b border-slate-700 pb-2 mb-2 mt-2"><span className="text-white font-bold">Net Prize Pool</span><span className="text-emerald-400 font-mono font-bold text-lg">${(Math.floor((squaresPool.squares.filter((s: any) => s.owner).length * squaresPool.costPerSquare * (1 - (squaresPool.charity?.enabled ? squaresPool.charity.percentage / 100 : 0))))).toLocaleString()}</span></div>
                                <div className="space-y-1 mt-2">
                                    {quarterlyPayouts.map((card) => {
                                        return (
                                            <div key={card.period} className="flex justify-between items-center text-sm border-b border-slate-800/50 pb-2 last:border-0">
                                                <span className="text-slate-400 font-bold">{card.label} <span className="text-slate-600 font-normal">({(squaresPool as GameState).payouts[card.period as keyof typeof squaresPool.payouts]}%)</span></span>
                                                <div className="flex flex-col items-end"><span className="text-white font-mono font-bold">${(card.amount || 0).toLocaleString()}</span></div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* SCOREBOARD */}
                <div className="bg-black rounded-xl border border-slate-800 p-0 shadow-xl overflow-hidden relative mb-8 max-w-4xl mx-auto">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-slate-800/20 rounded-full blur-3xl"></div>
                    <div className="p-4 border-b border-slate-800 text-center relative z-10 flex flex-col md:flex-row items-center justify-between px-8">
                        <h3 className="text-white font-bold text-xl tracking-tight">Game Scoreboard</h3>
                        <p className="text-sm text-slate-500 font-bold uppercase tracking-wider">{squaresPool.scores.gameStatus === 'in' ? 'LIVE' : squaresPool.scores.gameStatus === 'post' ? 'FINAL' : 'PENDING'}</p>
                    </div>
                    {/* Simple Scoreboard Grid */}
                    <div className="p-0 overflow-x-auto">
                        <table className="w-full text-center">
                            <thead>
                                <tr className="border-b border-slate-800 bg-slate-900/50">
                                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-left">Team</th>
                                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Q1</th>
                                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Q2</th>
                                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Q3</th>
                                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Q4</th>
                                    <th className="py-3 px-4 text-xs font-bold text-white uppercase tracking-wider bg-slate-800">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                <tr>
                                    <td className="py-4 px-4 font-bold text-white text-left flex items-center gap-2">{awayLogo ? <img src={awayLogo} className="w-6 h-6 object-contain" /> : null} {squaresPool.awayTeam}</td>
                                    <td className="py-4 px-4 font-mono text-slate-300">{squaresPool.scores.q1?.away ?? '-'}</td>
                                    <td className="py-4 px-4 font-mono text-slate-300">{squaresPool.scores.half && squaresPool.scores.q1 ? (squaresPool.scores.half.away - squaresPool.scores.q1.away) : (squaresPool.scores.period && squaresPool.scores.period >= 2 && squaresPool.scores.q1 ? ((squaresPool.scores.current?.away ?? 0) - squaresPool.scores.q1.away) : '-')}</td>
                                    <td className="py-4 px-4 font-mono text-slate-300">{squaresPool.scores.q3 && squaresPool.scores.half ? (squaresPool.scores.q3.away - squaresPool.scores.half.away) : (squaresPool.scores.period && squaresPool.scores.period >= 3 && squaresPool.scores.half ? ((squaresPool.scores.current?.away ?? 0) - squaresPool.scores.half.away) : '-')}</td>
                                    <td className="py-4 px-4 font-mono text-slate-300">{squaresPool.scores.final && squaresPool.scores.q3 ? (squaresPool.scores.final.away - squaresPool.scores.q3.away) : (squaresPool.scores.period && squaresPool.scores.period >= 4 && squaresPool.scores.q3 ? ((squaresPool.scores.current?.away ?? 0) - squaresPool.scores.q3.away) : '-')}</td>
                                    <td className="py-4 px-4 font-black text-indigo-400 text-lg bg-slate-900/50">{squaresPool.scores.current?.away ?? 0}</td>
                                </tr>
                                <tr>
                                    <td className="py-4 px-4 font-bold text-white text-left flex items-center gap-2">{homeLogo ? <img src={homeLogo} className="w-6 h-6 object-contain" /> : null} {squaresPool.homeTeam}</td>
                                    <td className="py-4 px-4 font-mono text-slate-300">{squaresPool.scores.q1?.home ?? '-'}</td>
                                    <td className="py-4 px-4 font-mono text-slate-300">{squaresPool.scores.half && squaresPool.scores.q1 ? (squaresPool.scores.half.home - squaresPool.scores.q1.home) : (squaresPool.scores.period && squaresPool.scores.period >= 2 && squaresPool.scores.q1 ? ((squaresPool.scores.current?.home ?? 0) - squaresPool.scores.q1.home) : '-')}</td>
                                    <td className="py-4 px-4 font-mono text-slate-300">{squaresPool.scores.q3 && squaresPool.scores.half ? (squaresPool.scores.q3.home - squaresPool.scores.half.home) : (squaresPool.scores.period && squaresPool.scores.period >= 3 && squaresPool.scores.half ? ((squaresPool.scores.current?.home ?? 0) - squaresPool.scores.half.home) : '-')}</td>
                                    <td className="py-4 px-4 font-mono text-slate-300">{squaresPool.scores.final && squaresPool.scores.q3 ? (squaresPool.scores.final.home - squaresPool.scores.q3.home) : (squaresPool.scores.period && squaresPool.scores.period >= 4 && squaresPool.scores.q3 ? ((squaresPool.scores.current?.home ?? 0) - squaresPool.scores.q3.home) : '-')}</td>
                                    <td className="py-4 px-4 font-black text-rose-400 text-lg bg-slate-900/50">{squaresPool.scores.current?.home ?? 0}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Grid Component */}
            <div className="max-w-[1600px] mx-auto px-4 py-8 flex flex-col items-center">
                {/* Grid Rendering */}
                <div className="flex items-center gap-4 w-full justify-center">
                    <div className="hidden md:flex flex-col items-center gap-2">
                        <div className="w-16 h-16 bg-indigo-900/20 rounded-full flex items-center justify-center border-2 border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.3)] bg-white p-1">
                            {awayLogo ? <img src={awayLogo} className="w-full h-full object-contain" /> : <span className="text-indigo-400 font-bold text-xl">{squaresPool.awayTeam.substring(0, 2).toUpperCase()}</span>}
                        </div>
                    </div>
                    <div className="flex-1 overflow-x-auto">
                        <Grid
                            gameState={squaresPool}
                            onClaimSquares={handleClaimSquares}
                            winners={winners}
                            highlightHomeDigit={getLastDigit(squaresPool.scores.current?.home ?? 0)}
                            highlightAwayDigit={getLastDigit(squaresPool.scores.current?.away ?? 0)}
                            currentUser={user}
                            onLogin={() => handleLocalAuth('login')}
                            onCreateClaimCode={(k) => dbService.createClaimCode(squaresPool.id, k)}
                            onClaimByCode={(c) => dbService.claimByCode(c)}
                            onJoinWaitlist={handleJoinWaitlist}
                            onConfirmPayment={(ids) => dbService.confirmPayment(squaresPool.id, ids)}
                        />
                    </div>
                    <div className="hidden md:flex flex-col items-center gap-2">
                        <div className="w-16 h-16 bg-rose-900/20 rounded-full flex items-center justify-center border-2 border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.3)] bg-white p-1">
                            {homeLogo ? <img src={homeLogo} className="w-full h-full object-contain" /> : <span className="text-rose-400 font-bold text-xl">{squaresPool.homeTeam.substring(0, 2).toUpperCase()}</span>}
                        </div>
                    </div>
                </div>
            </div>

            {/* What If Scenarios */}
            <div className="max-w-[1600px] mx-auto px-4 grid grid-cols-1 xl:grid-cols-2 gap-8 items-start mb-8">
                <div className="border border-amber-500/30 rounded-xl p-0 overflow-hidden">
                    <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-4 border-b border-slate-800 flex items-center gap-2"><h3 className="text-amber-400 font-medium text-sm">If {squaresPool.awayTeam} scores next...</h3></div>
                    <div className="bg-slate-950 p-4 space-y-4">{awayPredictions.map(pred => <div key={pred.points} className="flex justify-between items-center border-b border-slate-800/50 pb-2"><div><span className="block text-slate-300 font-bold text-sm">+{pred.points}</span><span className="text-[10px] text-slate-500">Digit: {pred.newDigit}</span></div><span className="text-white font-bold text-sm">{pred.owner}</span></div>)}</div>
                </div>
                <div className="border border-amber-500/30 rounded-xl p-0 overflow-hidden">
                    <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-4 border-b border-slate-800 flex items-center gap-2"><h3 className="text-amber-400 font-medium text-sm">If {squaresPool.homeTeam} scores next...</h3></div>
                    <div className="bg-slate-950 p-4 space-y-4">{homePredictions.map(pred => <div key={pred.points} className="flex justify-between items-center border-b border-slate-800/50 pb-2"><div><span className="block text-slate-300 font-bold text-sm">+{pred.points}</span><span className="text-[10px] text-slate-500">Digit: {pred.newDigit}</span></div><span className="text-white font-bold text-sm">{pred.owner}</span></div>)}</div>
                </div>
            </div>

            {/* Quarter Winner Cards */}
            <div className="max-w-[1600px] mx-auto px-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
                {quarterlyPayouts.map((card) => {
                    const homeDigit = getLastDigit(card.home);
                    const awayDigit = getLastDigit(card.away);

                    return (
                        <div key={card.period} className="bg-black border border-slate-800 rounded-xl p-6 flex flex-col items-center text-center shadow-lg relative overflow-hidden group">
                            {/* Top Bar Color Indicator (Optional) */}
                            {card.isLocked && <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-emerald-400"></div>}

                            <h3 className="text-slate-500 font-bold uppercase tracking-widest text-xs mb-4 mt-2">{card.label}</h3>

                            <div className="text-4xl font-black text-white mb-6 flex gap-4 items-center">
                                <span>{card.home}</span>
                                <span className="text-slate-700 text-2xl">-</span>
                                <span>{card.away}</span>
                            </div>

                            <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-3 w-full mb-4 grid grid-cols-2 gap-4">
                                <div className="flex flex-col items-center border-r border-slate-800 border-dashed pr-2">
                                    <span className="text-[10px] font-bold text-rose-400 uppercase mb-1">{squaresPool.homeTeam ? "Home Digit" : "Row Digit"}</span>
                                    <span className="text-2xl font-black text-white font-mono">{homeDigit}</span>
                                </div>
                                <div className="flex flex-col items-center pl-2">
                                    <span className="text-[10px] font-bold text-indigo-400 uppercase mb-1">{squaresPool.awayTeam ? "Away Digit" : "Col Digit"}</span>
                                    <span className="text-2xl font-black text-white font-mono">{awayDigit}</span>
                                </div>
                            </div>

                            <div className="text-slate-500 text-xs font-mono mb-6">
                                This Quarter: {card.qPointsHome} - {card.qPointsAway}
                            </div>

                            <div className="mt-auto flex flex-col items-center w-full">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">IN THE MONEY:</span>
                                <div className="text-lg font-bold text-white mb-1 truncate w-full px-2" title={card.winnerName}>{card.winnerName}</div>
                                <div className="text-3xl font-black text-emerald-400 font-mono tracking-tight">${card.amount}</div>
                            </div>

                            <div className="mt-6">
                                {card.isLocked ? <Lock size={18} className="text-emerald-500/30" /> : <Lock size={18} className="text-slate-800/50" />}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Score Change History (Only for Every Score Pays) */}
            {squaresPool.ruleVariations.scoreChangePayout && (
                <div className="max-w-[1600px] mx-auto px-4 mb-8">
                    <div className="bg-black border border-slate-800 rounded-xl overflow-hidden shadow-xl">
                        <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
                            <h3 className="font-bold text-white flex items-center gap-2"><Zap size={18} className="text-amber-400" /> Score Change History</h3>
                            <span className="text-xs font-bold text-slate-500 uppercase">{winners.filter(w => w.period === 'Event').length} Events</span>
                        </div>
                        <div className="max-h-[400px] overflow-y-auto">
                            <table className="w-full">
                                <thead className="bg-slate-900 sticky top-0 z-10">
                                    <tr>
                                        <th className="py-3 px-4 text-left text-xs font-bold text-slate-500 uppercase">Time</th>
                                        <th className="py-3 px-4 text-center text-xs font-bold text-slate-500 uppercase">Score</th>
                                        <th className="py-3 px-4 text-center text-xs font-bold text-slate-500 uppercase">Digits</th>
                                        <th className="py-3 px-4 text-right text-xs font-bold text-slate-500 uppercase">Winner</th>
                                        <th className="py-3 px-4 text-right text-xs font-bold text-slate-500 uppercase">Prize</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800">
                                    {winners.filter(w => w.period === 'Event').length === 0 ? (
                                        <tr><td colSpan={5} className="py-8 text-center text-slate-500 italic">No score changes yet.</td></tr>
                                    ) : (
                                        winners.filter(w => w.period === 'Event').map((win, i) => {
                                            // Find matching scoreEvent by description to get the actual score
                                            const matchingEvent = squaresPool.scoreEvents?.find(e => e.description === win.description);
                                            const homeScore = matchingEvent?.home ?? null;
                                            const awayScore = matchingEvent?.away ?? null;
                                            return (
                                                <tr key={i} className="hover:bg-slate-900/30 transition-colors">
                                                    <td className="py-3 px-4 text-slate-400 text-sm">{win.description || 'Score Update'}</td>
                                                    <td className="py-3 px-4 text-center font-mono text-white text-sm">{homeScore !== null && awayScore !== null ? `${homeScore} - ${awayScore}` : '-'}</td>
                                                    <td className="py-3 px-4 text-center"><span className="bg-slate-800 px-2 py-1 rounded text-xs font-mono text-slate-300">{win.homeDigit}-{win.awayDigit}</span></td>
                                                    <td className="py-3 px-4 text-right font-bold text-emerald-400">{win.owner}</td>
                                                    <td className="py-3 px-4 text-right font-mono text-white">${win.amount}</td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* AI Commissioner */}
            <div className="max-w-[1600px] mx-auto px-4 mb-20">
                <AICommissioner poolId={squaresPool.id} userId={user?.id} />
                <div className="flex justify-center mt-8">
                    <p className="text-slate-600 text-xs italic">All pool activities are automated and verified.</p>
                </div>
            </div>

            <AuthModal isOpen={showAuthModalLocal} onClose={() => setShowAuthModalLocal(false)} initialMode={authModeLocal} />
            {showAudit && <AuditLog poolId={squaresPool.id} onClose={() => setShowAudit(false)} />}
            <Footer />

            {/* Rule Modal */}
            {showRulesModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full relative shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-slate-800 bg-slate-950 flex justify-between items-center shrink-0">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <HelpCircle className="text-indigo-400" /> Pool Rules & Payouts
                            </h3>
                            <button onClick={() => setShowRulesModal(false)} className="text-slate-500 hover:text-white transition-colors bg-slate-800 hover:bg-slate-700 p-2 rounded-lg">
                                <span className="sr-only">Close</span>
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto space-y-8">
                            {/* General Stats */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-center">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Cost Per Square</div>
                                    <div className="text-xl font-mono font-bold text-white">${squaresPool.costPerSquare}</div>
                                </div>
                                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-center">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Max Per Player</div>
                                    <div className="text-xl font-mono font-bold text-white">{squaresPool.maxSquaresPerPlayer || '∞'}</div>
                                </div>
                                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-center">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Number Sets</div>
                                    <div className="text-xl font-mono font-bold text-white">{squaresPool.numberSets}</div>
                                </div>
                                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-center">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Winners</div>
                                    <div className="text-xl font-mono font-bold text-white">{Object.keys(squaresPool.payouts).length + (squaresPool.ruleVariations.reverseWinners ? Object.keys(squaresPool.payouts).length : 0)}</div>
                                </div>
                            </div>

                            {/* Payout Structure */}
                            <div>
                                <h4 className="text-slate-400 font-bold uppercase text-xs mb-3 flex items-center gap-2">
                                    <Zap size={14} /> Payout Breakdown
                                </h4>
                                <div className="bg-black rounded-lg overflow-hidden border border-slate-800">
                                    <table className="w-full text-sm">
                                        <thead className="bg-slate-900 text-slate-500 font-bold uppercase text-xs">
                                            <tr>
                                                <th className="py-2 px-4 text-left">Period</th>
                                                <th className="py-2 px-4 text-right">Percentage</th>
                                                <th className="py-2 px-4 text-right">Est. Prize</th>
                                                {squaresPool.ruleVariations.reverseWinners && <th className="py-2 px-4 text-right text-amber-500">Reverse</th>}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800 text-slate-300">
                                            {[
                                                { label: '1st Quarter', pct: squaresPool.payouts.q1 },
                                                { label: 'Halftime', pct: squaresPool.payouts.half },
                                                { label: '3rd Quarter', pct: squaresPool.payouts.q3 },
                                                { label: 'Final Score', pct: squaresPool.payouts.final },
                                            ].map((r, i) => {
                                                // Calculate raw pot based on FULL grid (projected)
                                                // Adjust for charity
                                                const charityCut = squaresPool.charity?.enabled ? (squaresPool.charity.percentage / 100) : 0;
                                                const totalPot = 100 * squaresPool.costPerSquare;
                                                const netPot = totalPot * (1 - charityCut);
                                                const prize = Math.floor(netPot * (r.pct / 100));
                                                // If reverse winners, prize is split? Usually reverse is separate calc or split.
                                                // Assumption: If reverse is on, standard prize is halved? Or defined separately?
                                                // Implementation Plan: Reverse usually splits the pot for that quarter.
                                                // We'll show the base calculation.
                                                return (
                                                    <tr key={i}>
                                                        <td className="py-3 px-4 font-bold text-white">{r.label}</td>
                                                        <td className="py-3 px-4 text-right font-mono text-slate-400">{r.pct}%</td>
                                                        <td className="py-3 px-4 text-right font-mono text-emerald-400">${prize.toLocaleString()}*</td>
                                                        {squaresPool.ruleVariations.reverseWinners && <td className="py-3 px-4 text-right font-mono text-amber-500">Active</td>}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                <p className="text-[10px] text-slate-600 mt-2 italic">* Estimated prizes assuming all 100 squares are sold. Actual prizes depend on total sales.</p>
                            </div>

                            {/* Special Rules */}
                            <div>
                                <h4 className="text-slate-400 font-bold uppercase text-xs mb-3 flex items-center gap-2">
                                    <Shield size={14} /> Active Rules
                                </h4>
                                <div className="space-y-3">
                                    {squaresPool.numberSets === 4 ? (
                                        <div className="flex gap-3">
                                            <div className="shrink-0 w-1 bg-indigo-500 rounded-full"></div>
                                            <div>
                                                <p className="font-bold text-indigo-400 text-sm">4 Number Sets</p>
                                                <p className="text-slate-400 text-xs">New numbers are generated for each quarter (Q1, Half, Q3, Final). This increases randomness and fairness.</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex gap-3">
                                            <div className="shrink-0 w-1 bg-slate-600 rounded-full"></div>
                                            <div>
                                                <p className="font-bold text-slate-400 text-sm">Standard Numbers</p>
                                                <p className="text-slate-500 text-xs">The same numbers (row/column) apply for the entire game.</p>
                                            </div>
                                        </div>
                                    )}

                                    {squaresPool.ruleVariations.quarterlyRollover && (
                                        <div className="flex gap-3">
                                            <div className="shrink-0 w-1 bg-emerald-500 rounded-full"></div>
                                            <div>
                                                <p className="font-bold text-emerald-400 text-sm">Quarterly Rollover</p>
                                                <p className="text-slate-400 text-xs">If a winning square is unsold, the prize money rolls over and is added to the NEXT quarter's pot.</p>
                                            </div>
                                        </div>
                                    )}

                                    {squaresPool.ruleVariations.reverseWinners && (
                                        <div className="flex gap-3">
                                            <div className="shrink-0 w-1 bg-amber-500 rounded-full"></div>
                                            <div>
                                                <p className="font-bold text-amber-400 text-sm">Reverse Winners</p>
                                                <p className="text-slate-400 text-xs">The square matching the REVERSE of the score digits also wins (e.g., if ending in 3-7, then 7-3 also wins). The quarter's pot is split.</p>
                                            </div>
                                        </div>
                                    )}

                                    {squaresPool.ruleVariations.scoreChangePayout && (
                                        <div className="flex gap-3">
                                            <div className="shrink-0 w-1 bg-fuchsia-500 rounded-full"></div>
                                            <div>
                                                <p className="font-bold text-fuchsia-400 text-sm">Every Score Pays</p>
                                                <p className="text-slate-400 text-xs">Payouts are awarded for EVERY score change (Touchdown, Field Goal, Safety, etc.), not just end of quarters.</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Charity Info */}
                            {squaresPool.charity?.enabled && (
                                <div className="bg-rose-900/10 border border-rose-500/20 p-4 rounded-xl flex gap-4 items-start">
                                    <div className="bg-rose-500/20 p-2 rounded-lg shrink-0"><Heart className="text-rose-400" size={24} /></div>
                                    <div>
                                        <h4 className="text-rose-400 font-bold text-sm uppercase">Fundraiser Pool</h4>
                                        <p className="text-slate-300 text-sm mb-1"><span className="font-bold text-white">{squaresPool.charity.percentage}%</span> of all proceeds go directly to <span className="font-bold text-white">{squaresPool.charity.name}</span>.</p>
                                        {squaresPool.charity.url && <a href={squaresPool.charity.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 hover:text-indigo-300 underline">Learn more about this cause</a>}
                                    </div>
                                </div>
                            )}

                        </div>

                        <div className="p-4 border-t border-slate-800 bg-slate-950 text-center">
                            <p className="text-[10px] text-slate-600">
                                This pool is hosted on MarchMelee. Prize distribution is managed by the pool host: <span className="text-slate-500">{squaresPool.contactEmail}</span>
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

