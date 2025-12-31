import React, { useState } from 'react';
import type { PlayoffPool, User } from '../../types';
import { Trophy, ListOrdered, FileText } from 'lucide-react';
import { RankingForm } from './RankingForm';

interface PlayoffDashboardProps {
    pool: PlayoffPool;
    user: User | null;
    onBack: () => void;
    onShare: () => void;
}

export const PlayoffDashboard: React.FC<PlayoffDashboardProps> = ({ pool, user, onBack, onShare }) => {
    const [activeTab, setActiveTab] = useState<'picks' | 'leaderboard' | 'rules'>('picks');

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-20">
            {/* Header / Nav would go here, reusing App's Header via props or context? 
                App.tsx usually renders Header outside the dashboard for consistent nav. 
                But for BracketDashboard, it renders its own or wraps it. 
                Let's assume App.tsx renders Header if this is returned as a specific view, 
                OR we render Header here. 
                BracketPoolDashboard renders its own because it takes over the page. 
                Let's follow that pattern.
            */}

            {/* Re-using App's Header is complex if not passed. 
                Let's assume the parent (App.tsx) handles the main Header if possible, 
                OR we simply copy the Header usage if we have the props.
                Actually, simpler to just have a specific header for this dashboard or use the global one.
                App.tsx passes `user`... let's just render a Dashboard Header.
            */}

            {/* Main Content */}
            <div className="max-w-6xl mx-auto p-4 md:p-6">
                {/* Pool Header */}
                <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                    <div>
                        <h1 className="text-3xl font-black text-white mb-2">{pool.name}</h1>
                        <div className="flex items-center gap-2 text-slate-400 text-sm">
                            <span className="bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded text-xs font-bold uppercase">NFL Playoffs</span>
                            <span>•</span>
                            <span>Season {pool.season}</span>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={onShare} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors flex items-center gap-2">
                            Share
                        </button>
                        <button onClick={onBack} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-lg font-bold text-sm transition-colors">
                            Back
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-800 mb-6">
                    <button
                        onClick={() => setActiveTab('picks')}
                        className={`px-6 py-3 font-bold text-sm uppercase tracking-wider border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'picks' ? 'border-emerald-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                    >
                        <ListOrdered size={16} /> My Picks
                    </button>
                    <button
                        onClick={() => setActiveTab('leaderboard')}
                        className={`px-6 py-3 font-bold text-sm uppercase tracking-wider border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'leaderboard' ? 'border-emerald-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                    >
                        <Trophy size={16} /> Leaderboard
                    </button>
                    <button
                        onClick={() => setActiveTab('rules')}
                        className={`px-6 py-3 font-bold text-sm uppercase tracking-wider border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'rules' ? 'border-emerald-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                    >
                        <FileText size={16} /> Rules
                    </button>
                </div>

                {/* Content */}
                <div className="min-h-[400px]">
                    {activeTab === 'picks' && (
                        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 md:p-8">
                            <RankingForm pool={pool} user={user} />
                        </div>
                    )}
                    {activeTab === 'leaderboard' && (
                        <div className="text-center p-12 bg-slate-900 rounded-xl border border-slate-800">
                            <h3 className="text-xl font-bold mb-4">Leaderboard</h3>
                            <p className="text-slate-400">Rankings will appear here after lock.</p>
                        </div>
                    )}
                    {activeTab === 'rules' && (
                        <div className="bg-slate-900 rounded-xl border border-slate-800 p-8 space-y-6">
                            <h3 className="text-xl font-bold">How to Play</h3>
                            <ul className="list-disc pl-5 space-y-2 text-slate-300">
                                <li>Rank all 14 playoff teams from 14 (Strongest) to 1 (Weakest).</li>
                                <li>Earn points equal to the assigned rank when a team wins.</li>
                                <li>Points are multiplied in later rounds (10x, 12x, 15x, 20x).</li>
                                <li>Highest total score wins!</li>
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
