
import React, { useState } from 'react';
import type { BracketPool, User } from '../../types';
import { LayoutDashboard, Users, Trophy, Settings, Share2, PlusCircle, ArrowLeft } from 'lucide-react';
import { BracketBuilder } from '../BracketBuilder/BracketBuilder';

interface BracketPoolDashboardProps {
    pool: BracketPool;
    user: User | null;
    onBack: () => void;
    onShare: () => void;
}

// MOCK DATA
const MOCK_TOURNAMENT: any = {
    id: '2025-ncaa-mens',
    year: 2025,
    games: {},
    teams: {}
};

export const BracketPoolDashboard: React.FC<BracketPoolDashboardProps> = ({ pool, user, onBack, onShare }) => {
    const [activeTab, setActiveTab] = useState<'dashboard' | 'standings' | 'entries' | 'settings'>('dashboard');
    // const [userEntryId, setUserEntryId] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [picks, setPicks] = useState<Record<string, string>>({});

    const isManager = user ? pool.managerUid === user.id : false;

    return (
        <div className="min-h-screen bg-slate-950 pb-20">
            {/* Header */}
            <div className="bg-slate-900 border-b border-slate-800 p-4 sticky top-0 z-40">
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
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}
                        >
                            <tab.icon size={16} />
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                {activeTab === 'dashboard' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4">
                        {!isCreating ? (
                            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-8 text-center">
                                <h2 className="text-2xl font-bold text-white mb-4">My Bracket</h2>
                                <p className="text-slate-400 mb-6">You haven't created a bracket entry yet.</p>
                                <button onClick={() => setIsCreating(true)} className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-8 py-3 rounded-xl flex items-center justify-center gap-2 mx-auto transition-transform hover:scale-105">
                                    <PlusCircle size={20} /> Create New Bracket
                                </button>
                            </div>
                        ) : (
                            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                                <div className="flex justify-between items-center p-4 border-b border-slate-800 bg-slate-950">
                                    <h3 className="font-bold text-white">My Picks</h3>
                                    <button onClick={() => setIsCreating(false)} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded font-bold">
                                        {isCreating ? 'Submit Bracket' : 'Update Bracket'}
                                    </button>
                                </div>
                                <div className="p-4 overflow-x-auto">
                                    <BracketBuilder
                                        tournament={MOCK_TOURNAMENT}
                                        picks={picks}
                                        onPick={(slot, team) => setPicks(prev => ({ ...prev, [slot]: team }))}
                                        readOnly={false}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'standings' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4">
                        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                            <div className="p-4 bg-slate-950 border-b border-slate-800 font-bold text-slate-400 grid grid-cols-12 gap-4 text-sm">
                                <div className="col-span-1">Rank</div>
                                <div className="col-span-7">Entry Name</div>
                                <div className="col-span-2 text-right">Points</div>
                                <div className="col-span-2 text-right">Possible</div>
                            </div>
                            <div className="p-8 text-center text-slate-500 italic">
                                No entries yet.
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'entries' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4">
                        <h3 className="text-white font-bold mb-4">All Entries ({pool.entryCount || 0})</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {/* Placeholder List */}
                            <div className="bg-slate-900 p-4 rounded-lg border border-slate-800">
                                <div className="font-bold text-white">Example Entry</div>
                                <div className="text-xs text-slate-500">Owner: Kevin</div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'settings' && isManager && (
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
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};
