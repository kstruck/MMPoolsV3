import React, { useState, useEffect } from 'react';
import type { PropsPool, PropCard } from '../../types';
import { PropCardForm } from '../Props/PropCardForm'; // Reusing this for "My Cards"

import { PropGradingDashboard } from '../Props/PropGradingDashboard';
import { PropLeaderboard } from '../Props/PropLeaderboard';
import { PropStats } from '../Props/PropStats';
import { GameScoreboard } from '../GameScoreboard';
import { StatusCard } from '../StatusCard';
import { PayoutSummaryCard } from '../PayoutSummaryCard';

import { Share2, Grid3X3, Trophy, ChevronLeft, Shield, BarChart2, Check, Lock } from 'lucide-react';
import { PropsWizard as PropWizard } from '../PropsWizard/PropsWizard';
import { dbService } from '../../services/dbService';
import { ShareModal } from '../modals/ShareModal';

interface PropsPoolDashboardProps {
    pool: PropsPool;
    user: any;
    isManager?: boolean;
    isAdmin?: boolean;
    onBack: () => void;
    initialTab?: 'cards' | 'leaderboard' | 'stats' | 'admin' | 'grading';
    onOpenAuth?: () => void;
}

export const PropsPoolDashboard: React.FC<PropsPoolDashboardProps> = ({ pool, user, isManager, isAdmin, onBack, initialTab = 'cards', onOpenAuth }) => {
    const [activeTab, setActiveTab] = useState<'cards' | 'leaderboard' | 'stats' | 'admin' | 'grading'>(initialTab);
    const [allCards, setAllCards] = useState<PropCard[]>([]);
    const [showShareModal, setShowShareModal] = useState(false);

    useEffect(() => {
        if (!pool.id) return;
        const unsub = dbService.subscribeToPropCards(pool.id, (cards) => {
            setAllCards(cards);
        });
        return () => unsub();
    }, [pool.id]);


    const [locking, setLocking] = useState(false); // Add state

    const showStats = pool.isLocked || isManager || isAdmin;

    return (
        <div
            className="min-h-screen text-white pb-20 transition-colors duration-500"
            style={{ backgroundColor: pool.branding?.backgroundColor || '#0f172a' }}
        >
            {/* Header */}
            <header className="bg-slate-900/50 backdrop-blur-md relative border-b border-slate-800">
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button onClick={onBack} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">
                            <ChevronLeft size={20} />
                        </button>
                        <div className="flex items-center gap-3">
                            {pool.branding?.logoUrl ? (
                                <div className="w-10 h-10 bg-slate-900 rounded-lg flex items-center justify-center border border-slate-800 p-1 shadow-lg">
                                    <img src={pool.branding.logoUrl} alt={pool.name} className="max-w-full max-h-full object-contain" />
                                </div>
                            ) : (
                                <div className="w-10 h-10 bg-emerald-600 rounded-lg flex items-center justify-center font-bold text-xl shadow-lg shadow-emerald-600/20">
                                    🎲
                                </div>
                            )}
                            <div>
                                <h1 className="font-bold text-lg leading-tight">{pool.name}</h1>
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                    <span className="uppercase font-bold tracking-wider">Props Pool</span>
                                    <span>•</span>
                                    <span className={pool.isLocked ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                                        {pool.isLocked ? 'LOCKED' : 'OPEN FOR PICKS'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowShareModal(true)}
                            className="p-2 hover:bg-slate-800 rounded-lg text-indigo-400 hover:text-white transition-colors"
                        >
                            <Share2 size={20} />
                        </button>
                    </div>
                </div>

                {/* Navigation Tabs */}
                <div className="max-w-7xl mx-auto px-4 flex gap-6 overflow-x-auto hide-scrollbar">
                    <button
                        onClick={() => setActiveTab('cards')}
                        className={`pb-3 border-b-2 font-bold text-sm flex items-center gap-2 whitespace-nowrap transition-colors ${activeTab === 'cards' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-white'}`}
                    >
                        <Grid3X3 size={16} /> Overview
                    </button>
                    <button
                        onClick={() => setActiveTab('leaderboard')}
                        className={`pb-3 border-b-2 font-bold text-sm flex items-center gap-2 whitespace-nowrap transition-colors ${activeTab === 'leaderboard' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-white'}`}
                    >
                        <Trophy size={16} /> Leaderboard
                    </button>

                    {showStats && (
                        <button
                            onClick={() => setActiveTab('stats')}
                            className={`pb-3 border-b-2 font-bold text-sm flex items-center gap-2 whitespace-nowrap transition-colors ${activeTab === 'stats' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-white'}`}
                        >
                            <BarChart2 size={16} /> Stats
                        </button>
                    )}

                    {(isManager || isAdmin) && (
                        <>
                            <button
                                onClick={() => setActiveTab('admin')}
                                className={`pb-3 border-b-2 font-bold text-sm flex items-center gap-2 whitespace-nowrap transition-colors ${activeTab === 'admin' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-white'}`}
                            >
                                <Shield size={16} /> Pool Admin
                            </button>
                            <button
                                onClick={() => setActiveTab('grading')}
                                className={`pb-3 border-b-2 font-bold text-sm flex items-center gap-2 whitespace-nowrap transition-colors ${activeTab === 'grading' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-white'}`}
                            >
                                <Check size={16} /> Grading
                            </button>
                        </>
                    )}
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 py-8">
                {activeTab === 'cards' && (
                    <div className="max-w-6xl mx-auto space-y-8">
                        {/* Scoreboard */}
                        <GameScoreboard
                            gameState={pool as any}
                            onRepair={(isManager || isAdmin) ? async () => {
                                if (!window.confirm("Repair/Re-sync Scoreboard from ESPN?")) return;
                                try {
                                    const res = await dbService.fixPoolScores(pool.id);
                                    if (res.success) {
                                        alert("Repair Successful. Reloading...");
                                        window.location.reload();
                                    } else {
                                        alert("Repair Failed: " + res.message);
                                    }
                                } catch (e: any) {
                                    alert("Error: " + e.message);
                                }
                            } : undefined}
                        />

                        {/* Status Grid */}
                        <div className="grid md:grid-cols-2 gap-6">
                            <StatusCard
                                gameState={pool as any}
                                mode="props"
                                totalEntries={allCards.length}
                            />
                            <PayoutSummaryCard
                                gameState={pool as any}
                                winners={[]} // Prop winners are handled differently or TBD
                                mode="props"
                                totalEntries={allCards.length}
                            />
                        </div>

                        <div className="grid lg:grid-cols-2 gap-8 items-start">
                            {/* Entry Form */}
                            <div className="order-2 lg:order-1">
                                <PropCardForm
                                    poolId={pool.id}
                                    config={pool.props}
                                    isLocked={pool.isLocked}
                                    currentUser={user}
                                    userCards={allCards.filter(c => c.userId === user?.id)}
                                    onOpenAuth={onOpenAuth}
                                />
                            </div>

                            {/* Leaderboard Condensed */}
                            <div className="order-1 lg:order-2">
                                <PropLeaderboard
                                    gameState={pool as any}
                                    currentUser={user}
                                    cards={allCards}
                                    isManager={false} // Read only view here
                                    isAdmin={false} // Read only view here
                                />
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'leaderboard' && (
                    <div className="max-w-4xl mx-auto">
                        <PropLeaderboard
                            gameState={pool as any}
                            currentUser={user}
                            cards={allCards}
                            isManager={isManager}
                            isAdmin={isAdmin}
                        />
                    </div>
                )}

                {activeTab === 'stats' && (
                    <div className="max-w-4xl mx-auto">
                        <PropStats questions={pool.props.questions} cards={allCards} />
                    </div>
                )}

                {activeTab === 'admin' && (
                    <div className="max-w-4xl mx-auto space-y-6">

                        {/* Manual Lock Control */}
                        {!pool.isLocked && (
                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col md:flex-row justify-between items-center gap-4">
                                <div>
                                    <h3 className="text-white font-bold text-lg flex items-center gap-2">
                                        <Lock className="text-rose-500" size={20} /> Lock Pool
                                    </h3>
                                    <p className="text-slate-400 text-sm mt-1">
                                        Manually lock the pool to prevent further entries.
                                        <br />
                                        <span className="text-amber-500 text-xs">Note: This cannot be undone from this dashboard.</span>
                                    </p>
                                </div>
                                <button
                                    onClick={async () => {
                                        if (!window.confirm("Are you sure you want to LOCK this pool? No more entries will be allowed.")) return;
                                        setLocking(true);
                                        try {
                                            await dbService.lockPool(pool.id);
                                            alert("Pool Locked Successfully!");
                                            window.location.reload();
                                        } catch (e: any) {
                                            alert("Error: " + e.message);
                                        } finally {
                                            setLocking(false);
                                        }
                                    }}
                                    disabled={locking}
                                    className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors"
                                >
                                    {locking ? 'Locking...' : 'Lock Pool Now'}
                                </button>
                            </div>
                        )}

                        {/* Fix Sync Tool */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col md:flex-row justify-between items-center gap-4">
                            <div>
                                <h3 className="text-white font-bold text-lg flex items-center gap-2">
                                    <Shield className="text-amber-500" size={20} /> Score Sync Repair
                                </h3>
                                <p className="text-slate-400 text-sm mt-1">If the scoreboard is missing updated scores or events, use this tool to force a re-sync from ESPN.</p>
                            </div>
                            <button
                                onClick={async () => {
                                    if (!window.confirm("This will force a full re-sync of scores from ESPN. Continue?")) return;
                                    const btn = document.getElementById('btn-fix-sync');
                                    if (btn) btn.innerText = 'Repairing...';
                                    try {
                                        const res = await dbService.fixPoolScores(pool.id);
                                        alert(res.success ? 'Success! Reloading page...' : 'Failed: ' + res.message);
                                        if (res.success) window.location.reload();
                                    } catch (e: any) {
                                        alert('Error: ' + e.message);
                                    }
                                    if (btn) btn.innerText = 'Run Repair';
                                }}
                                id="btn-fix-sync"
                                className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 12-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 9" /><path d="M17.64 15 22 10.64" /><path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25V7.86c0-.55-.45-1-1-1H16.4c-.84 0-1.65-.33-2.25-.93L12.9 4.68" /><path d="M16.25 16.25 9 9" /></svg>
                                Run Repair
                            </button>
                        </div>

                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                            <PropWizard
                                user={user}
                                onCancel={() => setActiveTab('cards')} // Or handle otherwise
                                onComplete={() => {
                                    // Refresh or notify? The wizard handles actual update.
                                    // Just force a reload or maybe we need to reload pool data?
                                    window.location.reload();
                                }}
                                initialData={pool as any}
                                embedded={true}
                            />
                        </div>
                    </div>
                )}

                {activeTab === 'grading' && (
                    <div className="max-w-4xl mx-auto">
                        <PropGradingDashboard gameState={pool as any} />
                    </div>
                )}
            </main>

            {/* Share Modal */}
            <ShareModal
                isOpen={showShareModal}
                onClose={() => setShowShareModal(false)}
                shareUrl={`${window.location.origin}/#pool/${pool.id}`}
            />
        </div>
    );
};
