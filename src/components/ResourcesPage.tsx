import React from 'react';
import { Header } from './Header';
import { Footer } from './Footer';
import type { User } from '../types';
import { BookOpen, Trophy, LayoutGrid, CheckCircle } from 'lucide-react';
import { canAccessPoolCreation } from '../utils/auth';

interface ResourcesPageProps {
    user: User | null;
    onLogin: () => void;
    onSignup: () => void;
    onCreatePool: () => void;
    onLogout?: () => void;
}

/* Marketing page is navy chrome end-to-end — always dark in both themes. */

export const ResourcesPage: React.FC<ResourcesPageProps> = ({ user, onLogin, onSignup, onCreatePool, onLogout }) => {
    const canCreate = canAccessPoolCreation(user);
    return (
        <div className="min-h-screen bg-page text-[color:var(--text)] font-body">
            <Header
                user={user}
                isManager={!!user}
                onOpenAuth={onLogin}
                onLogout={onLogout || (() => { })}
                onCreatePool={onCreatePool}
            />

            {/* Hero band — navy chrome (always dark) */}
            <div className="pt-24 pb-12 bg-navy-950 border-b border-[rgba(230,206,150,0.16)]">
                <div className="max-w-4xl mx-auto px-6 text-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full font-display font-bold uppercase text-xs tracking-[0.16em] bg-gold-500/10 border border-gold-500/25 text-gold-400 mb-6">
                        <BookOpen size={14} /> Knowledge Base
                    </div>
                    <h1 className="font-display font-extrabold uppercase text-4xl md:text-5xl leading-[0.95] text-white mb-6">Guides & Resources</h1>
                    <p className="text-lg font-body text-[#9FB0CC] max-w-2xl mx-auto">
                        Everything you need to know about setting up, running, and winning your office sports pools.
                    </p>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-6 py-20 space-y-20">

                {/* ARTICLE 1: NFL PLAYOFF OPTIMIZATION */}
                <article className="prose max-w-none">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="p-3 rounded-xl bg-gold-500/15 text-gold-600 dark:text-gold-400">
                            <Trophy size={32} />
                        </div>
                        <h2 className="font-display font-bold uppercase text-3xl leading-[0.95] text-[color:var(--text)] m-0">How to Set Up an NFL Playoff Pool</h2>
                    </div>
                    <p className="text-lg font-body text-[color:var(--text)] leading-relaxed">
                        Running an <strong>NFL Playoff Pool</strong> is one of the best ways to keep your group engaged after the regular season ends. Unlike a standard bracket, a Playoff Ranking pool requires strategy that balances risk and reward.
                    </p>

                    <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mt-8 mb-4">Step-by-Step Setup Guide</h3>
                    <ul className="space-y-4 list-none pl-0 font-body text-[color:var(--text)]">
                        <li className="flex gap-3">
                            <CheckCircle className="text-gold-600 dark:text-gold-400 shrink-0 mt-1" size={20} />
                            <span><strong>Choose Your Format:</strong> The most popular format is a "Rank 'Em" challenge. Participants rank all 14 playoff teams from 1 (lowest confidence) to 14 (highest confidence).</span>
                        </li>
                        <li className="flex gap-3">
                            <CheckCircle className="text-gold-600 dark:text-gold-400 shrink-0 mt-1" size={20} />
                            <span><strong>Set Scoring Multipliers:</strong> To keep suspense high until the Super Bowl, use multipliers. We recommend 1x for Wild Card, 2x for Divisional, 4x for Conference, and 8x for the Super Bowl.</span>
                        </li>
                        <li className="flex gap-3">
                            <CheckCircle className="text-gold-600 dark:text-gold-400 shrink-0 mt-1" size={20} />
                            <span><strong>Automate the Scoring:</strong> Don't try to track 50 entries in a spreadsheet. Use March Melee Pools to automatically calculate scores live as games finish.</span>
                        </li>
                    </ul>
                </article>

                <hr className="border-line" />

                {/* ARTICLE 2: SUPER BOWL SQUARES */}
                <article className="prose max-w-none">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="p-3 rounded-xl bg-navy-600/15 text-navy-700 dark:text-[#9FB0CC]">
                            <LayoutGrid size={32} />
                        </div>
                        <h2 className="font-display font-bold uppercase text-3xl leading-[0.95] text-[color:var(--text)] m-0">The Official Rules for Super Bowl Squares</h2>
                    </div>
                    <p className="text-lg font-body text-[color:var(--text)] leading-relaxed">
                        <strong>Super Bowl Squares</strong> is the king of office pools because absolutely no football knowledge is required to win. Whether you call it a "Football Box Pool" or "Grid Pool," the rules are simple.
                    </p>

                    <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mt-8 mb-4">How to Play</h3>
                    <div className="grid md:grid-cols-2 gap-8 my-8">
                        <div className="bg-card p-6 rounded-xl border border-line">
                            <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-2">1. The Empty Grid</h4>
                            <p className="text-sm font-body text-muted">Start with a 10x10 blank grid. Invite your friends or coworkers to purchase squares. They can pick specific spots or get assigned randomly.</p>
                        </div>
                        <div className="bg-card p-6 rounded-xl border border-line">
                            <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-2">2. The Numbers</h4>
                            <p className="text-sm font-body text-muted">Once the grid is full (or locked), assign numbers 0-9 randomly to the top row (Away Team) and left column (Home Team).</p>
                        </div>
                    </div>

                    <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mt-8 mb-4">Determining Winners</h3>
                    <p className="font-body text-[color:var(--text)] mb-4">
                        Winners are determined at the end of every quarter based on the <strong>last digit</strong> of each team's score.
                    </p>
                    <div className="bg-surface p-4 border-l-4 border-gold-500 rounded-r-lg italic font-body text-[color:var(--text)]">
                        Example: If the score at Halftime is Chiefs 14, 49ers 10. The winning square is the intersection of Chiefs (4) and 49ers (0).
                    </div>
                </article>

                <div className="pt-12 text-center">
                    <h3 className="font-display font-bold uppercase text-2xl text-[color:var(--text)] mb-6">Ready to host your own pool?</h3>
                    <button
                        onClick={canCreate ? onSignup : undefined}
                        disabled={!canCreate}
                        className="bg-brandred-600 hover:bg-brandred-500 text-white px-8 py-4 rounded-lg font-display font-bold uppercase tracking-[0.05em] text-lg transition-all duration-150 hover:-translate-y-px shadow-red-cta disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:bg-brandred-600 disabled:shadow-none"
                        title={canCreate ? 'Start a Free Pool' : 'Pool creation is coming soon'}
                    >
                        {canCreate ? 'Start a Free Pool' : 'Pool Creation Coming Soon'}
                    </button>
                </div>

            </div>

            <Footer />
        </div>
    );
};
