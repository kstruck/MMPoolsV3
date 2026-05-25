import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Trophy, Grid3X3, Lock, ArrowRight, ArrowLeft } from 'lucide-react';
// import { settingsService } from '../services/settingsService';
import { Header } from './Header';
import { Footer } from './Footer';
import type { User } from '../types';

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

    // Prevent unused variable TS errors for offseason options
    React.useEffect(() => {
        if (false) {
            onSelectBracket();
            onSelectPlayoff();
        }
    }, [onSelectBracket, onSelectPlayoff]);

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col">
            <Header
                user={user}
                isManager={isManager}
                onOpenAuth={onOpenAuth}
                onLogout={onLogout}
                onCreatePool={onCreatePool}
            />

            <main className="flex-grow max-w-4xl mx-auto p-6 md:p-12 mt-8 w-full">
                <div className="mb-6">
                    <button onClick={() => window.history.back()} className="text-slate-400 hover:text-white font-bold flex items-center gap-2 transition-colors">
                        <ArrowLeft size={20} /> Back
                    </button>
                </div>

                <div className="text-center mb-12">
                    <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent mb-2">
                        Start a New Pool
                    </h1>
                    <h2 className="text-3xl md:text-5xl font-black text-white mb-6">Choose Your Game</h2>
                    <p className="text-slate-400 text-lg max-w-2xl mx-auto">
                        Select the type of pool you want to host. You can manage multiple pools of different types from your dashboard.
                    </p>
                </div>

                <div className="space-y-12">
                    {/* SECTION 1: ACTIVE NFL & GAMEDAY POOLS */}
                    <div>
                        <div className="flex items-center justify-center mb-8">
                            <div className="h-[1px] bg-slate-800 flex-grow max-w-[150px]" />
                            <span className="text-slate-400 text-sm font-bold uppercase px-4 tracking-wider">Active NFL & Gameday Pools</span>
                            <div className="h-[1px] bg-slate-800 flex-grow max-w-[150px]" />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* GAMEDAY SQUARES CARD */}
                            <button
                                onClick={onSelectSquares}
                                className="group relative bg-slate-800 hover:bg-slate-700 border-2 border-slate-700 hover:border-violet-500 rounded-2xl p-6 text-left transition-all hover:-translate-y-1 shadow-xl flex flex-col"
                            >
                                <div className="absolute top-4 right-4 bg-violet-500/20 p-2.5 rounded-xl group-hover:bg-violet-500 transition-colors">
                                    <Grid3X3 size={20} className="text-violet-400 group-hover:text-white" />
                                </div>
                                <h3 className="text-xl font-bold text-white mb-2 pr-10">Gameday Squares</h3>
                                <p className="text-slate-400 text-sm mb-4 flex-grow">Classic 10x10 grid for Super Bowl and MNF. Interactive square selection and live updates.</p>
                                <ul className="text-xs text-slate-500 space-y-2 mb-6 mt-auto">
                                    <li className="flex items-center gap-2">✓ Interactive live 10x10 grid</li>
                                    <li className="flex items-center gap-2">✓ Automated scoring & payouts</li>
                                    <li className="flex items-center gap-2">✓ Custom settings & pricing</li>
                                </ul>
                                <span className="inline-flex items-center gap-1.5 text-violet-400 text-sm font-bold group-hover:translate-x-1 transition-transform mt-auto">
                                    Setup Squares <ArrowRight size={14} />
                                </span>
                            </button>

                            {/* WEEKLY PICK'EM CARD */}
                            <button
                                onClick={() => navigate('/nfl-wizard?type=NFL_PICKEM')}
                                className="group relative bg-slate-800 hover:bg-slate-700 border-2 border-slate-700 hover:border-blue-500 rounded-2xl p-6 text-left transition-all hover:-translate-y-1 shadow-xl flex flex-col"
                            >
                                <div className="absolute top-4 right-4 bg-blue-500/20 p-2.5 rounded-xl group-hover:bg-blue-500 transition-colors">
                                    <Trophy size={20} className="text-blue-400 group-hover:text-white" />
                                </div>
                                <h3 className="text-xl font-bold text-white mb-2 pr-10">Weekly Pick'em</h3>
                                <p className="text-slate-400 text-sm mb-4 flex-grow">Pick winners for all games weekly. Supports Standard (1pt/win) or unique Confidence rankings.</p>
                                <ul className="text-xs text-slate-500 space-y-2 mb-6 mt-auto">
                                    <li className="flex items-center gap-2">✓ Standard & Confidence options</li>
                                    <li className="flex items-center gap-2">✓ Custom weekly deadlines</li>
                                    <li className="flex items-center gap-2">✓ Live leaderboards & scoring</li>
                                </ul>
                                <span className="inline-flex items-center gap-1.5 text-blue-400 text-sm font-bold group-hover:translate-x-1 transition-transform mt-auto">
                                    Setup Pick'em <ArrowRight size={14} />
                                </span>
                            </button>

                            {/* SURVIVOR CARD */}
                            <button
                                onClick={() => navigate('/nfl-wizard?type=NFL_SURVIVOR')}
                                className="group relative bg-slate-800 hover:bg-slate-700 border-2 border-slate-700 hover:border-red-500 rounded-2xl p-6 text-left transition-all hover:-translate-y-1 shadow-xl flex flex-col"
                            >
                                <div className="absolute top-4 right-4 bg-red-500/20 p-2.5 rounded-xl group-hover:bg-red-500 transition-colors">
                                    <Trophy size={20} className="text-red-400 group-hover:text-white" />
                                </div>
                                <h3 className="text-xl font-bold text-white mb-2 pr-10">Survivor Pool</h3>
                                <p className="text-slate-400 text-sm mb-4 flex-grow">Pick 1 winner per week. Lose/tie = take a strike. Supports mulligans and buy-backs.</p>
                                <ul className="text-xs text-slate-500 space-y-2 mb-6 mt-auto">
                                    <li className="flex items-center gap-2">✓ 1 strike or custom multi-strikes</li>
                                    <li className="flex items-center gap-2">✓ Mulligans & buy-back settings</li>
                                    <li className="flex items-center gap-2">✓ Automated tiebreakers & lists</li>
                                </ul>
                                <span className="inline-flex items-center gap-1.5 text-red-400 text-sm font-bold group-hover:translate-x-1 transition-transform mt-auto">
                                    Setup Survivor <ArrowRight size={14} />
                                </span>
                            </button>

                            {/* MARGIN CARD */}
                            <button
                                onClick={() => navigate('/nfl-wizard?type=NFL_MARGIN')}
                                className="group relative bg-slate-800 hover:bg-slate-700 border-2 border-slate-700 hover:border-teal-500 rounded-2xl p-6 text-left transition-all hover:-translate-y-1 shadow-xl flex flex-col"
                            >
                                <div className="absolute top-4 right-4 bg-teal-500/20 p-2.5 rounded-xl group-hover:bg-teal-500 transition-colors">
                                    <Trophy size={20} className="text-teal-400 group-hover:text-white" />
                                </div>
                                <h3 className="text-xl font-bold text-white mb-2 pr-10">Margin Pool</h3>
                                <p className="text-slate-400 text-sm mb-4 flex-grow">Choose 1 team per week. Score is their margin of victory. Negative differential hurts you.</p>
                                <ul className="text-xs text-slate-500 space-y-2 mb-6 mt-auto">
                                    <li className="flex items-center gap-2">✓ Margin of victory acts as score</li>
                                    <li className="flex items-center gap-2">✓ Anti-repeat team selection logic</li>
                                    <li className="flex items-center gap-2">✓ Progressive live standings</li>
                                </ul>
                                <span className="inline-flex items-center gap-1.5 text-teal-400 text-sm font-bold group-hover:translate-x-1 transition-transform mt-auto">
                                    Setup Margin <ArrowRight size={14} />
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* SECTION 2: PROPS & CUSTOM GAMES */}
                    <div>
                        <div className="flex items-center justify-center mb-8">
                            <div className="h-[1px] bg-slate-800 flex-grow max-w-[150px]" />
                            <span className="text-slate-400 text-sm font-bold uppercase px-4 tracking-wider">or try something new</span>
                            <div className="h-[1px] bg-slate-800 flex-grow max-w-[150px]" />
                        </div>

                        {/* PROPS / SIDE HUSTLE OPTION */}
                        <button
                            onClick={onSelectProps}
                            className="group relative bg-slate-800 hover:bg-slate-700 border-2 border-slate-700 hover:border-emerald-500 rounded-2xl p-8 text-left transition-all hover:-translate-y-1 shadow-xl w-full"
                        >
                            <div className="absolute top-4 right-4 bg-emerald-500/20 p-3 rounded-xl group-hover:bg-emerald-500 transition-colors">
                                <Grid3X3 size={32} className="text-emerald-400 group-hover:text-white" />
                            </div>
                            <h3 className="text-2xl font-bold text-white mb-2">Side Hustle (Props Only)</h3>
                            <p className="text-slate-400 mb-6">Host a standalone Props game without the grid. Players answer questions like "Who will score first?" or "Total field goals?". Perfect for casual groups.</p>
                            <ul className="text-sm text-slate-500 space-y-2 mb-8 grid grid-cols-1 md:grid-cols-2 gap-2">
                                <li className="flex items-center gap-2">✓ Fully customizable questions</li>
                                <li className="flex items-center gap-2">✓ Automated scoring</li>
                                <li className="flex items-center gap-2">✓ Custom points per question</li>
                                <li className="flex items-center gap-2">✓ Real-time leaderboard</li>
                            </ul>
                            <span className="inline-flex items-center gap-2 text-emerald-400 font-bold group-hover:translate-x-1 transition-transform">
                                Create Props Pool <ArrowRight size={16} />
                            </span>
                        </button>
                    </div>

                    {/* SECTION 3: OFFSEASON POOLS */}
                    <div>
                        <div className="flex items-center justify-center mb-8">
                            <div className="h-[1px] bg-slate-800 flex-grow max-w-[150px]" />
                            <span className="text-slate-500 text-sm font-bold uppercase px-4 tracking-wider">Offseason Pools</span>
                            <div className="h-[1px] bg-slate-800 flex-grow max-w-[150px]" />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* BRACKET OPTION - DISABLED/OFFSEASON */}
                            <div
                                className="group relative border-2 border-slate-800 bg-slate-900/50 rounded-2xl p-8 text-left opacity-50 cursor-not-allowed shadow-none flex flex-col"
                            >
                                <div className="absolute top-4 right-4 bg-slate-800/80 p-3 rounded-xl border border-slate-700">
                                    <Lock size={24} className="text-slate-500" />
                                </div>
                                <div className="flex items-center gap-2 mb-2">
                                    <h3 className="text-2xl font-bold text-slate-400">March Madness Bracket</h3>
                                    <span className="bg-orange-500/10 text-orange-400 border border-orange-500/20 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
                                        Offseason
                                    </span>
                                </div>
                                <p className="text-slate-500 mb-6 text-sm">Traditional 64-team tournament bracket. Pick winners for every round. Features automated scoring, live updates, and "Who to Root For" analytics.</p>
                                <ul className="text-xs text-slate-600 space-y-2 mb-8 mt-auto">
                                    <li className="flex items-center gap-2">✓ Live bracket updates</li>
                                    <li className="flex items-center gap-2">✓ Round-by-round scoring</li>
                                    <li className="flex items-center gap-2">✓ Mobile-friendly tree</li>
                                </ul>

                                <span className="inline-flex items-center gap-2 text-slate-500 font-bold text-sm">
                                    Closed — Opens March 2027
                                </span>
                            </div>

                            {/* NFL PLAYOFFS OPTION - DISABLED/OFFSEASON */}
                            <div
                                className="group relative border-2 border-slate-800 bg-slate-900/50 rounded-2xl p-8 text-left opacity-50 cursor-not-allowed shadow-none flex flex-col"
                            >
                                <div className="absolute top-4 right-4 bg-slate-800/80 p-3 rounded-xl border border-slate-700">
                                    <Lock size={24} className="text-slate-500" />
                                </div>
                                <div className="flex items-center gap-2 mb-2">
                                    <h3 className="text-2xl font-bold text-slate-400">Playoff Challenge</h3>
                                    <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
                                        Upcoming
                                    </span>
                                </div>
                                <p className="text-slate-500 mb-6 text-sm">Rank all 14 NFL playoff teams. Standard wild card multipliers and underdog seed bonuses reward high-strategy selections.</p>
                                <ul className="text-xs text-slate-600 space-y-2 mb-8 mt-auto">
                                    <li className="flex items-center gap-2">✓ Progressive scoring</li>
                                    <li className="flex items-center gap-2">✓ Drag & Drop Rankings</li>
                                    <li className="flex items-center gap-2">✓ Strategic multipliers</li>
                                </ul>
                                <span className="inline-flex items-center gap-2 text-slate-500 font-bold text-sm">
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
