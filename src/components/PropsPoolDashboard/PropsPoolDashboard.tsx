import React, { useState, useEffect } from 'react';
import type { PropsPool, PropCard } from '../../types';
import { PropCardForm } from '../Props/PropCardForm'; // Reusing this for "My Cards"
import { PropsManager } from '../Props/PropsManager';
import { PropGradingDashboard } from '../Props/PropGradingDashboard';
import { PropLeaderboard } from '../Props/PropLeaderboard';

// actually Leaderboard import was erroring.
import { Share2, Grid3X3, Trophy, ChevronLeft, Shield } from 'lucide-react';
import { dbService } from '../../services/dbService';

interface PropsPoolDashboardProps {
    pool: PropsPool;
    user: any;
    isManager?: boolean;
    isAdmin?: boolean;
    onBack: () => void;
}

export const PropsPoolDashboard: React.FC<PropsPoolDashboardProps> = ({ pool, user, isManager, isAdmin, onBack }) => {
    const [activeTab, setActiveTab] = useState<'cards' | 'leaderboard' | 'admin' | 'grading'>('cards');

    // Helper functions
    const updatePoolConfig = async (updates: Partial<PropsPool>) => {
        if (!pool.id) return;
        // Cast to any to bypass strict type check for now if needed, but dbService handles Partial<Pool>
        await dbService.updatePool(pool.id, updates as any);
    };

    return (
        <div className="min-h-screen bg-slate-950 text-white pb-20">
            {/* Header */}
            <header className="bg-slate-900/50 backdrop-blur-md sticky top-0 z-40 border-b border-slate-800">
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button onClick={onBack} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">
                            <ChevronLeft size={20} />
                        </button>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-emerald-600 rounded-lg flex items-center justify-center font-bold text-xl shadow-lg shadow-emerald-600/20">
                                🎲
                            </div>
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
                        <button className="p-2 hover:bg-slate-800 rounded-lg text-indigo-400 hover:text-white transition-colors">
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
                        <Grid3X3 size={16} /> My Cards
                    </button>
                    <button
                        onClick={() => setActiveTab('leaderboard')}
                        className={`pb-3 border-b-2 font-bold text-sm flex items-center gap-2 whitespace-nowrap transition-colors ${activeTab === 'leaderboard' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-white'}`}
                    >
                        <Trophy size={16} /> Leaderboard
                    </button>
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
                    <div className="max-w-3xl mx-auto">
                        <PropCardFetcher poolId={pool.id} user={user} config={pool.props} isLocked={pool.isLocked} />
                    </div>
                )}

                {activeTab === 'leaderboard' && (
                    <div className="max-w-4xl mx-auto">
                        <PropLeaderboard gameState={pool as any} currentUser={user} />
                    </div>
                )}

                {activeTab === 'admin' && (
                    <div className="max-w-4xl mx-auto bg-slate-900 border border-slate-800 rounded-xl p-6">
                        <h2 className="text-2xl font-bold text-white mb-6">Pool Settings</h2>
                        <PropsManager
                            gameState={pool as any} // Compatible enough
                            updateConfig={updatePoolConfig as any}
                            isWizardMode={false}
                            updateGameState={updatePoolConfig as any}
                        />
                    </div>
                )}

                {activeTab === 'grading' && (
                    <div className="max-w-4xl mx-auto">
                        <PropGradingDashboard gameState={pool as any} />
                    </div>
                )}
            </main>
        </div>
    );
};

// Internal wrapper to handle fetching cards for the form
import { Check } from 'lucide-react';

const PropCardFetcher = ({ poolId, user, config, isLocked }: { poolId: string, user: any, config: PropsPool['props'], isLocked: boolean }) => {
    const [cards, setCards] = useState<PropCard[]>([]);
    useEffect(() => {
        if (!user) return;
        const unsub = dbService.subscribeToAllPropCards(poolId, (allCards) => {
            const myCards = allCards.filter(c => c.userId === user.id);
            setCards(myCards);
        });
        return () => unsub();
    }, [poolId, user]);

    return (
        <PropCardForm
            poolId={poolId}
            config={config}
            isLocked={isLocked}
            currentUser={user}
            userCards={cards}
        />
    );
};
