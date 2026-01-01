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
                        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-800 bg-slate-950/50">
                                        <th className="p-4 text-slate-400 font-bold text-sm">Rank</th>
                                        <th className="p-4 text-slate-400 font-bold text-sm">Player</th>
                                        <th className="p-4 text-slate-400 font-bold text-sm text-right">Score</th>
                                        <th className="p-4 text-slate-400 font-bold text-sm text-right hidden md:table-cell">Tiebreaker</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.values(pool.entries || {})
                                        .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0))
                                        .map((entry, index) => {
                                            const isMe = user?.id === entry.userId;
                                            return (
                                                <tr key={entry.userId} className={`border-b border-slate-800/50 ${isMe ? 'bg-indigo-900/20' : 'hover:bg-slate-800/50'}`}>
                                                    <td className="p-4 font-bold text-slate-300">
                                                        {index + 1}
                                                    </td>
                                                    <td className="p-4">
                                                        <div className={`font-bold ${isMe ? 'text-indigo-400' : 'text-white'}`}>{entry.userName}</div>
                                                    </td>
                                                    <td className="p-4 text-right font-black text-emerald-400 text-lg">
                                                        {entry.totalScore || 0}
                                                    </td>
                                                    <td className="p-4 text-right text-slate-500 hidden md:table-cell">
                                                        {entry.tiebreaker}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    {(!pool.entries || Object.keys(pool.entries).length === 0) && (
                                        <tr>
                                            <td colSpan={4} className="p-8 text-center text-slate-500 italic">No entries yet. Be the first!</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {activeTab === 'rules' && (
                        <div className="bg-slate-900 rounded-xl border border-slate-800 p-8 space-y-6">
                            <h3 className="text-xl font-bold">How to Play</h3>
                            <ul className="list-disc pl-5 space-y-2 text-slate-300">
                                <li>Rank all 14 playoff teams from 14 (Strongest) to 1 (Weakest).</li>
                                <li>Earn points equal to the assigned rank when a team wins.</li>
                                <li>
                                    Points are multiplied in each round:
                                    <ul className="list-none grid grid-cols-2 gap-2 mt-2 font-mono text-sm text-emerald-400">
                                        <li>Wild Card: {pool.settings?.scoring?.roundMultipliers?.WILD_CARD ?? 1}x</li>
                                        <li>Divisional: {pool.settings?.scoring?.roundMultipliers?.DIVISIONAL ?? 2}x</li>
                                        <li>Conference: {pool.settings?.scoring?.roundMultipliers?.CONF_CHAMP ?? 4}x</li>
                                        <li>Super Bowl: {pool.settings?.scoring?.roundMultipliers?.SUPER_BOWL ?? 8}x</li>
                                    </ul>
                                </li>
                                <li>Highest total score wins!</li>
                            </ul>

                            {pool.settings?.payouts && (
                                <>
                                    <h3 className="text-xl font-bold pt-4 border-t border-slate-800">Payout Structure</h3>
                                    <div className="grid gap-2 max-w-sm">
                                        {pool.settings.payouts.places.map((p: any) => (
                                            <div key={p.rank} className="flex justify-between p-3 bg-slate-950 rounded-lg">
                                                <span className="font-bold text-slate-300">{p.rank === 1 ? '1st' : p.rank + 'th'} Place</span>
                                                <span className="font-mono text-emerald-400">{p.percentage}%</span>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}

                            {pool.settings?.paymentInstructions && (
                                <>
                                    <h3 className="text-xl font-bold pt-4 border-t border-slate-800">Payment Instructions</h3>
                                    <div className="bg-slate-950 p-4 rounded-lg text-slate-300 whitespace-pre-wrap">
                                        {pool.settings.paymentInstructions}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
