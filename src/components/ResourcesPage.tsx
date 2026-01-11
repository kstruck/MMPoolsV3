import React from 'react';
import { Header } from './Header';
import { Footer } from './Footer';
import type { User } from '../types';
import { BookOpen, Trophy, LayoutGrid, CheckCircle } from 'lucide-react';

interface ResourcesPageProps {
    user: User | null;
    onLogin: () => void;
    onSignup: () => void;
    onCreatePool: () => void;
    onLogout?: () => void;
}

export const ResourcesPage: React.FC<ResourcesPageProps> = ({ user, onLogin, onSignup, onCreatePool, onLogout }) => {
    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
            <Header
                user={user}
                isManager={!!user}
                onOpenAuth={onLogin}
                onLogout={onLogout || (() => { })}
                onCreatePool={onCreatePool}
            />

            <div className="pt-24 pb-12 bg-slate-800/50 border-b border-slate-700">
                <div className="max-w-4xl mx-auto px-6 text-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-400 mb-6">
                        <BookOpen size={14} /> Knowledge Base
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black text-white mb-6">Guides & Resources</h1>
                    <p className="text-lg text-slate-400 max-w-2xl mx-auto">
                        Everything you need to know about setting up, running, and winning your office sports pools.
                    </p>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-6 py-20 space-y-20">

                {/* ARTICLE 1: NFL PLAYOFF OPTIMIZATION */}
                <article className="prose prose-invert max-w-none">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="p-3 rounded-xl bg-orange-500/20 text-orange-500">
                            <Trophy size={32} />
                        </div>
                        <h2 className="text-3xl font-bold text-white m-0">How to Set Up an NFL Playoff Pool</h2>
                    </div>
                    <p className="text-lg text-slate-300 leading-relaxed">
                        Running an <strong>NFL Playoff Pool</strong> is one of the best ways to keep your group engaged after the regular season ends. Unlike a standard bracket, a Playoff Ranking pool requires strategy that balances risk and reward.
                    </p>

                    <h3 className="text-xl font-bold text-white mt-8 mb-4">Step-by-Step Setup Guide</h3>
                    <ul className="space-y-4 list-none pl-0">
                        <li className="flex gap-3">
                            <CheckCircle className="text-emerald-500 shrink-0 mt-1" size={20} />
                            <span><strong>Choose Your Format:</strong> The most popular format is a "Rank 'Em" challenge. Participants rank all 14 playoff teams from 1 (lowest confidence) to 14 (highest confidence).</span>
                        </li>
                        <li className="flex gap-3">
                            <CheckCircle className="text-emerald-500 shrink-0 mt-1" size={20} />
                            <span><strong>Set Scoring Multipliers:</strong> To keep suspense high until the Super Bowl, use multipliers. We recommend 1x for Wild Card, 2x for Divisional, 4x for Conference, and 8x for the Super Bowl.</span>
                        </li>
                        <li className="flex gap-3">
                            <CheckCircle className="text-emerald-500 shrink-0 mt-1" size={20} />
                            <span><strong>Automate the Scoring:</strong> Don't try to track 50 entries in a spreadsheet. Use March Melee Pools to automatically calculate scores live as games finish.</span>
                        </li>
                    </ul>
                </article>

                <hr className="border-slate-800" />

                {/* ARTICLE 2: SUPER BOWL SQUARES */}
                <article className="prose prose-invert max-w-none">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="p-3 rounded-xl bg-indigo-500/20 text-indigo-500">
                            <LayoutGrid size={32} />
                        </div>
                        <h2 className="text-3xl font-bold text-white m-0">The Official Rules for Super Bowl Squares</h2>
                    </div>
                    <p className="text-lg text-slate-300 leading-relaxed">
                        <strong>Super Bowl Squares</strong> is the king of office pools because absolutely no football knowledge is required to win. Whether you call it a "Football Box Pool" or "Grid Pool," the rules are simple.
                    </p>

                    <h3 className="text-xl font-bold text-white mt-8 mb-4">How to Play</h3>
                    <div className="grid md:grid-cols-2 gap-8 my-8">
                        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                            <h4 className="font-bold text-white mb-2">1. The Empty Grid</h4>
                            <p className="text-sm text-slate-400">Start with a 10x10 blank grid. Invite your friends or coworkers to purchase squares. They can pick specific spots or get assigned randomly.</p>
                        </div>
                        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                            <h4 className="font-bold text-white mb-2">2. The Numbers</h4>
                            <p className="text-sm text-slate-400">Once the grid is full (or locked), assign numbers 0-9 randomly to the top row (Away Team) and left column (Home Team).</p>
                        </div>
                    </div>

                    <h3 className="text-xl font-bold text-white mt-8 mb-4">Determining Winners</h3>
                    <p className="text-slate-300 mb-4">
                        Winners are determined at the end of every quarter based on the <strong>last digit</strong> of each team's score.
                    </p>
                    <div className="bg-slate-800/50 p-4 border-l-4 border-orange-500 rounded-r-lg italic text-slate-300">
                        Example: If the score at Halftime is Chiefs 14, 49ers 10. The winning square is the intersection of Chiefs (4) and 49ers (0).
                    </div>
                </article>

                <div className="pt-12 text-center">
                    <h3 className="text-2xl font-bold text-white mb-6">Ready to host your own pool?</h3>
                    <button
                        onClick={onSignup}
                        className="bg-orange-600 hover:bg-orange-500 text-white px-8 py-4 rounded-full font-bold text-lg transition-all shadow-lg shadow-orange-500/25"
                    >
                        Start a Free Pool
                    </button>
                </div>

            </div>

            <Footer />
        </div>
    );
};
