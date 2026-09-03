import React from 'react';
import { useNavigate } from 'react-router';
import { Trophy, Grid3X3, Lock, ArrowRight, ArrowLeft, Check } from 'lucide-react';
// import { settingsService } from '../services/settingsService';
import { Header } from './Header';
import { Footer } from './Footer';
import type { User } from '../types';
import { canAccessPoolCreation, canAccessSquaresCreation } from '../utils/auth';

interface CreatePoolSelectionProps {
    onSelectSquares: () => void;
    onSelectBracket: () => void;
    onSelectPlayoff: () => void;
    onSelectProps: () => void;
    user: User | null;
    isManager: boolean;
    onOpenAuth: () => void;
    onLogout: () => void;
    onCreatePool: () => void;
}

export const CreatePoolSelection: React.FC<CreatePoolSelectionProps> = ({
    onSelectSquares,
    onSelectBracket,
    onSelectPlayoff,
    user,
    isManager,
    onOpenAuth,
    onLogout,
    onCreatePool,
    onSelectProps
}) => {
    const navigate = useNavigate();
    const canCreate = canAccessPoolCreation(user);
    // Squares is closed on its own switch while the claim-limit defect is fixed
    // (config/season.ts). Everything else follows the master switch.
    const canCreateSquares = canAccessSquaresCreation(user);

    // Prevent unused variable TS errors for offseason options
    React.useEffect(() => {
        if (false) {
            onSelectBracket();
            onSelectPlayoff();
        }
    }, [onSelectBracket, onSelectPlayoff]);

    return (
        <div className="min-h-screen bg-page text-[color:var(--text)] font-body flex flex-col">
            <Header
                user={user}
                isManager={isManager}
                onOpenAuth={onOpenAuth}
                onLogout={onLogout}
                onCreatePool={onCreatePool}
            />

            <main className="flex-grow max-w-4xl mx-auto p-6 md:p-12 mt-8 w-full">
                <div className="mb-6">
                    <button onClick={() => window.history.back()} className="text-muted hover:text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2 transition-colors">
                        <ArrowLeft size={20} /> Back
                    </button>
                </div>

                <div className="text-center mb-12">
                    <h1 className="font-display font-bold uppercase tracking-[0.12em] text-sm text-gold-700 dark:text-gold-400 mb-2">
                        Start a New Pool
                    </h1>
                    <h2 className="font-display font-extrabold uppercase leading-[0.9] text-4xl md:text-6xl text-[color:var(--text)] mb-6">Choose Your Game</h2>
                    <p className="text-muted text-lg max-w-2xl mx-auto font-body">
                        Select the type of pool you want to host. You can manage multiple pools of different types from your dashboard.
                    </p>
                </div>

                <div className="space-y-12">
                    {/* SECTION 1: ACTIVE NFL & GAMEDAY POOLS */}
                    <div>
                        <div className="flex items-center justify-center mb-8">
                            <div className="h-[1px] bg-line flex-grow max-w-[150px]" />
                            <span className="text-muted text-sm font-display font-bold uppercase px-4 tracking-[0.12em]">Active NFL & Gameday Pools</span>
                            <div className="h-[1px] bg-line flex-grow max-w-[150px]" />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* WEEKLY PICK'EM CARD */}
                            <button
                                onClick={canCreate ? () => navigate('/create/pickem') : undefined}
                                disabled={!canCreate}
                                className="group relative bg-card border border-line hover:border-gold-500 rounded-2xl p-6 text-left transition duration-150 hover:-translate-y-1 shadow-card hover:shadow-card-hover flex flex-col disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:border-line disabled:hover:shadow-card"
                            >
                                <div className="absolute top-4 right-4 bg-navy-600/10 dark:bg-navy-600/30 p-2.5 rounded-xl group-hover:bg-navy-700 transition-colors">
                                    <Trophy size={20} className="text-navy-700 dark:text-[#9FB0CC] group-hover:text-white" />
                                </div>
                                <h3 className="font-display font-bold uppercase text-[22px] leading-[0.95] text-[color:var(--text)] mb-2 pr-10">Weekly Pick'em</h3>
                                <p className="text-muted text-sm mb-4 flex-grow font-body">Pick winners for all games weekly. Supports Standard (1pt/win) or unique Confidence rankings.</p>
                                <ul className="text-xs text-muted space-y-2 mb-6 mt-auto font-body">
                                    <li className="flex items-center gap-2"><Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" /> Standard &amp; Confidence options</li>
                                    <li className="flex items-center gap-2"><Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" /> Custom weekly deadlines</li>
                                    <li className="flex items-center gap-2"><Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" /> Live leaderboards &amp; scoring</li>
                                </ul>
                                <span className="inline-flex items-center gap-1.5 text-gold-700 dark:text-gold-400 text-sm font-display font-bold uppercase tracking-[0.05em] group-hover:translate-x-1 transition-transform mt-auto">
                                    {canCreate ? <>Setup Pick'em <ArrowRight size={14} /></> : 'Coming Soon'}
                                </span>
                            </button>

                            {/* SURVIVOR CARD */}
                            <button
                                onClick={canCreate ? () => navigate('/create/survivor') : undefined}
                                disabled={!canCreate}
                                className="group relative bg-card border border-line hover:border-gold-500 rounded-2xl p-6 text-left transition duration-150 hover:-translate-y-1 shadow-card hover:shadow-card-hover flex flex-col disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:border-line disabled:hover:shadow-card"
                            >
                                <div className="absolute top-4 right-4 bg-navy-950/10 dark:bg-navy-950/60 p-2.5 rounded-xl group-hover:bg-navy-950 transition-colors">
                                    <Trophy size={20} className="text-navy-800 dark:text-[#9FB0CC] group-hover:text-white" />
                                </div>
                                <h3 className="font-display font-bold uppercase text-[22px] leading-[0.95] text-[color:var(--text)] mb-2 pr-10">Survivor Pool</h3>
                                <p className="text-muted text-sm mb-4 flex-grow font-body">Pick 1 winner per week. By default a loss or tie is a strike. Supports mulligans, buy-backs and configurable tie and team-reuse rules.</p>
                                <ul className="text-xs text-muted space-y-2 mb-6 mt-auto font-body">
                                    <li className="flex items-center gap-2"><Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" /> 1 strike or custom multi-strikes</li>
                                    <li className="flex items-center gap-2"><Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" /> Mulligans &amp; buy-back settings</li>
                                    <li className="flex items-center gap-2"><Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" /> Automated tiebreakers &amp; lists</li>
                                </ul>
                                <span className="inline-flex items-center gap-1.5 text-gold-700 dark:text-gold-400 text-sm font-display font-bold uppercase tracking-[0.05em] group-hover:translate-x-1 transition-transform mt-auto">
                                    {canCreate ? <>Setup Survivor <ArrowRight size={14} /></> : 'Coming Soon'}
                                </span>
                            </button>

                            {/* MARGIN CARD */}
                            <button
                                onClick={canCreate ? () => navigate('/create/margin') : undefined}
                                disabled={!canCreate}
                                className="group relative bg-card border border-line hover:border-gold-500 rounded-2xl p-6 text-left transition duration-150 hover:-translate-y-1 shadow-card hover:shadow-card-hover flex flex-col disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:border-line disabled:hover:shadow-card"
                            >
                                <div className="absolute top-4 right-4 bg-gold-500/15 p-2.5 rounded-xl group-hover:bg-gold-foil transition-colors">
                                    <Trophy size={20} className="text-gold-700 dark:text-gold-400 group-hover:text-navy-950" />
                                </div>
                                <h3 className="font-display font-bold uppercase text-[22px] leading-[0.95] text-[color:var(--text)] mb-2 pr-10">Margin Pool</h3>
                                <p className="text-muted text-sm mb-4 flex-grow font-body">Choose 1 team per week. Score is their margin of victory. Negative differential hurts you.</p>
                                <ul className="text-xs text-muted space-y-2 mb-6 mt-auto font-body">
                                    <li className="flex items-center gap-2"><Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" /> Margin of victory acts as score</li>
                                    <li className="flex items-center gap-2"><Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" /> Anti-repeat team selection logic</li>
                                    <li className="flex items-center gap-2"><Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" /> Progressive live standings</li>
                                </ul>
                                <span className="inline-flex items-center gap-1.5 text-gold-700 dark:text-gold-400 text-sm font-display font-bold uppercase tracking-[0.05em] group-hover:translate-x-1 transition-transform mt-auto">
                                    {canCreate ? <>Setup Margin <ArrowRight size={14} /></> : 'Coming Soon'}
                                </span>
                            </button>

                            {/* GAMEDAY SQUARES CARD */}
                            <button
                                onClick={canCreateSquares ? onSelectSquares : undefined}
                                disabled={!canCreateSquares}
                                title={canCreateSquares ? undefined : 'Gameday Squares is coming soon'}
                                className="group relative bg-card border border-line hover:border-gold-500 rounded-2xl p-6 text-left transition duration-150 hover:-translate-y-1 shadow-card hover:shadow-card-hover flex flex-col disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:border-line disabled:hover:shadow-card"
                            >
                                <div className="absolute top-4 right-4 bg-brandred-600/10 p-2.5 rounded-xl group-hover:bg-brandred-600 transition-colors">
                                    <Grid3X3 size={20} className="text-brandred-600 group-hover:text-white" />
                                </div>
                                <h3 className="font-display font-bold uppercase text-[22px] leading-[0.95] text-[color:var(--text)] mb-2 pr-10">Gameday Squares</h3>
                                <p className="text-muted text-sm mb-4 flex-grow font-body">Classic 10x10 grid for the Super Bowl, MNF, Thanksgiving weekend, or any game of the season. Interactive square selection and live updates.</p>
                                <ul className="text-xs text-muted space-y-2 mb-6 mt-auto font-body">
                                    <li className="flex items-center gap-2"><Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" /> Interactive live 10x10 grid</li>
                                    <li className="flex items-center gap-2"><Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" /> Automated scoring &amp; payouts</li>
                                    <li className="flex items-center gap-2"><Check size={14} className="text-gold-600 dark:text-gold-400 shrink-0" /> Custom settings &amp; pricing</li>
                                </ul>
                                <span className="inline-flex items-center gap-1.5 text-gold-700 dark:text-gold-400 text-sm font-display font-bold uppercase tracking-[0.05em] group-hover:translate-x-1 transition-transform mt-auto">
                                    {canCreateSquares ? <>Setup Squares <ArrowRight size={14} /></> : 'Coming Soon'}
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* SECTION 2: PROPS & CUSTOM GAMES */}
                    <div>
                        <div className="flex items-center justify-center mb-8">
                            <div className="h-[1px] bg-line flex-grow max-w-[150px]" />
                            <span className="text-muted text-sm font-display font-bold uppercase px-4 tracking-[0.12em]">or try something new</span>
                            <div className="h-[1px] bg-line flex-grow max-w-[150px]" />
                        </div>

                        {/* PROPS / SIDE HUSTLE OPTION */}
                        <button
                            onClick={canCreate ? onSelectProps : undefined}
                            disabled={!canCreate}
                            className="group relative bg-card border border-line hover:border-gold-500 rounded-2xl p-8 text-left transition duration-150 hover:-translate-y-1 shadow-card hover:shadow-card-hover w-full disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:border-line disabled:hover:shadow-card"
                        >
                            <div className="absolute top-4 right-4 bg-gold-500/15 p-3 rounded-xl group-hover:bg-gold-foil transition-colors">
                                <Grid3X3 size={32} className="text-gold-700 dark:text-gold-400 group-hover:text-navy-950" />
                            </div>
                            <h3 className="font-display font-bold uppercase text-[26px] leading-[0.95] text-[color:var(--text)] mb-2">Side Hustle (Props Only)</h3>
                            <p className="text-muted mb-6 font-body">Host a standalone Props game without the grid. Players answer questions like "Who will score first?" or "Total field goals?". Perfect for casual groups.</p>
                            <ul className="text-sm text-muted space-y-2 mb-8 grid grid-cols-1 md:grid-cols-2 gap-2 font-body">
                                <li className="flex items-center gap-2"><Check size={16} className="text-gold-600 dark:text-gold-400 shrink-0" /> Fully customizable questions</li>
                                <li className="flex items-center gap-2"><Check size={16} className="text-gold-600 dark:text-gold-400 shrink-0" /> Automated scoring</li>
                                <li className="flex items-center gap-2"><Check size={16} className="text-gold-600 dark:text-gold-400 shrink-0" /> Custom points per question</li>
                                <li className="flex items-center gap-2"><Check size={16} className="text-gold-600 dark:text-gold-400 shrink-0" /> Real-time leaderboard</li>
                            </ul>
                            <span className="inline-flex items-center gap-2 text-gold-700 dark:text-gold-400 font-display font-bold uppercase tracking-[0.05em] group-hover:translate-x-1 transition-transform">
                                {canCreate ? <>Create Props Pool <ArrowRight size={16} /></> : 'Pool Creation Coming Soon'}
                            </span>
                        </button>
                    </div>

                    {/* SECTION 3: OFFSEASON POOLS */}
                    <div>
                        <div className="flex items-center justify-center mb-8">
                            <div className="h-[1px] bg-line flex-grow max-w-[150px]" />
                            <span className="text-faint text-sm font-display font-bold uppercase px-4 tracking-[0.12em]">Offseason Pools</span>
                            <div className="h-[1px] bg-line flex-grow max-w-[150px]" />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* BRACKET OPTION - DISABLED/OFFSEASON */}
                            <div
                                className="group relative border border-line bg-surface rounded-2xl p-8 text-left opacity-60 cursor-not-allowed shadow-none flex flex-col"
                            >
                                <div className="absolute top-4 right-4 bg-card p-3 rounded-xl border border-line">
                                    <Lock size={24} className="text-faint" />
                                </div>
                                <div className="flex items-center gap-2 mb-2">
                                    <h3 className="font-display font-bold uppercase text-[24px] leading-[0.95] text-muted">March Madness Bracket</h3>
                                    <span className="bg-gold-500/10 text-gold-700 dark:text-gold-400 border border-gold-500/30 text-[10px] font-display font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full">
                                        Offseason
                                    </span>
                                </div>
                                <p className="text-muted mb-6 text-sm font-body">Traditional 64-team tournament bracket. Pick winners for every round. Features automated scoring, live updates, and "Who to Root For" analytics.</p>
                                <ul className="text-xs text-faint space-y-2 mb-8 mt-auto font-body">
                                    <li className="flex items-center gap-2"><Check size={14} className="shrink-0" /> Live bracket updates</li>
                                    <li className="flex items-center gap-2"><Check size={14} className="shrink-0" /> Round-by-round scoring</li>
                                    <li className="flex items-center gap-2"><Check size={14} className="shrink-0" /> Mobile-friendly tree</li>
                                </ul>

                                <span className="inline-flex items-center gap-2 text-muted font-display font-bold uppercase tracking-[0.05em] text-sm">
                                    Closed — Opens March 2027
                                </span>
                            </div>

                            {/* NFL PLAYOFFS OPTION - DISABLED/OFFSEASON */}
                            <div
                                className="group relative border border-line bg-surface rounded-2xl p-8 text-left opacity-60 cursor-not-allowed shadow-none flex flex-col"
                            >
                                <div className="absolute top-4 right-4 bg-card p-3 rounded-xl border border-line">
                                    <Lock size={24} className="text-faint" />
                                </div>
                                <div className="flex items-center gap-2 mb-2">
                                    <h3 className="font-display font-bold uppercase text-[24px] leading-[0.95] text-muted">Playoff Challenge</h3>
                                    <span className="bg-navy-600/10 dark:bg-navy-600/30 text-navy-700 dark:text-[#9FB0CC] border border-navy-600/20 text-[10px] font-display font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full">
                                        Upcoming
                                    </span>
                                </div>
                                <p className="text-muted mb-6 text-sm font-body">Rank all 14 NFL playoff teams. Standard wild card multipliers and underdog seed bonuses reward high-strategy selections.</p>
                                <ul className="text-xs text-faint space-y-2 mb-8 mt-auto font-body">
                                    <li className="flex items-center gap-2"><Check size={14} className="shrink-0" /> Progressive scoring</li>
                                    <li className="flex items-center gap-2"><Check size={14} className="shrink-0" /> Drag &amp; Drop Rankings</li>
                                    <li className="flex items-center gap-2"><Check size={14} className="shrink-0" /> Strategic multipliers</li>
                                </ul>
                                <span className="inline-flex items-center gap-2 text-muted font-display font-bold uppercase tracking-[0.05em] text-sm">
                                    Opens December 2026
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    );
};
