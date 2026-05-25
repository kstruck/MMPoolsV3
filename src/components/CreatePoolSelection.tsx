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
    // onSelectSquares,
    onSelectBracket,
    // onSelectPlayoff,
    user,
    isManager,
    onOpenAuth,
    onLogout,
    onCreatePool,
    onSelectProps
}) => {
    const navigate = useNavigate();
    // const [settings, setSettings] = useState<SystemSettings | null>(null);

    // useEffect(() => {
    //     const unsub = settingsService.subscribe(setSettings);
    //     return () => unsub();
    // }, []);

    const isBracketEnabled = !!user; // Open for all logged-in users

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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* BRACKET OPTION - PRIMARY */}
                    <button
                        onClick={() => isBracketEnabled && onSelectBracket()}
                        disabled={!isBracketEnabled}
                        className={`group relative border-2 rounded-2xl p-8 text-left transition-all shadow-xl ${isBracketEnabled
                            ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 hover:border-orange-500 hover:-translate-y-1'
                            : 'bg-slate-900 border-slate-800 opacity-60 cursor-not-allowed'
                            }`}
                    >
                        <div className={`absolute top-4 right-4 p-3 rounded-xl transition-colors ${isBracketEnabled ? 'bg-orange-500/20 group-hover:bg-orange-500' : 'bg-slate-800'}`}>
                            {isBracketEnabled ? (
                                <Trophy size={32} className="text-orange-400 group-hover:text-white" />
                            ) : (
                                <Lock size={32} className="text-slate-600" />
                            )}
                        </div>
                        <h3 className="text-2xl font-bold text-white mb-2">March Madness Bracket</h3>
                        <p className="text-slate-400 mb-6">Traditional 64-team tournament bracket. Pick winners for every round. Features automated scoring, live updates, and "Who to Root For" analytics.</p>
                        <ul className="text-sm text-slate-500 space-y-2 mb-8">
                            <li className="flex items-center gap-2">✓ Live bracket updates</li>
                            <li className="flex items-center gap-2">✓ Round-by-round scoring</li>
                            <li className="flex items-center gap-2">✓ Mobile-friendly tree</li>
                        </ul>

                        <span className="inline-flex items-center gap-2 text-orange-400 font-bold group-hover:translate-x-1 transition-transform">
                            Create Bracket Pool <ArrowRight size={16} />
                        </span>
                    </button>

                    {/* SQUARES OPTION - DISABLED */}
                    <button
                        disabled={true}
                        className="group relative bg-slate-900 border-2 border-slate-800 rounded-2xl p-8 text-left opacity-60 cursor-not-allowed shadow-none"
                    >
                        <div className="absolute top-4 right-4 bg-slate-800 p-3 rounded-xl">
                            <Grid3X3 size={32} className="text-slate-600" />
                        </div>
                        <h3 className="text-2xl font-bold text-slate-400 mb-2">Gameday Squares</h3>
                        <p className="text-slate-500 mb-6 min-h-[48px]">Classic 10x10 grid for Super Bowl and MNF.</p>
                        <ul className="text-sm text-slate-600 space-y-2 mb-8">
                            <li className="flex items-center gap-2">✓ Automated scoring</li>
                            <li className="flex items-center gap-2">✓ Quarter & Final payouts</li>
                            <li className="flex items-center gap-2">✓ Custom pricing</li>
                        </ul>
                        <span className="inline-flex items-center gap-2 text-slate-500 font-bold">
                            Opens August 2026
                        </span>
                    </button>

                    {/* NFL PLAYOFFS OPTION - DISABLED */}
                    <button
                        disabled={true}
                        className="group relative bg-slate-900 border-2 border-slate-800 rounded-2xl p-8 text-left opacity-60 cursor-not-allowed shadow-none md:col-span-2 lg:col-span-1"
                    >
                        <div className="absolute top-4 right-4 bg-slate-800 p-3 rounded-xl">
                            <Trophy size={32} className="text-slate-600" />
                        </div>
                        <h3 className="text-2xl font-bold text-slate-400 mb-2">Playoff Challenge</h3>
                        <p className="text-slate-500 mb-6">Rank all 14 NFL playoff teams.</p>
                        <ul className="text-sm text-slate-600 space-y-2 mb-8">
                            <li className="flex items-center gap-2">✓ Progressive scoring</li>
                            <li className="flex items-center gap-2">✓ Drag & Drop Rankings</li>
                            <li className="flex items-center gap-2">✓ Strategic multipliers</li>
                        </ul>
                        <span className="inline-flex items-center gap-2 text-slate-500 font-bold">
                            Opens December 2026
                        </span>
                    </button>

                    {/* NFL POOLS SECTION */}
                    <div className="col-span-1 md:col-span-2 flex items-center justify-center my-6">
                        <div className="h-[1px] bg-slate-800 flex-grow max-w-[100px]" />
                        <span className="text-slate-500 text-xs font-bold uppercase px-4 tracking-wider">NFL Pools — Upcoming 2026 Season</span>
                        <div className="h-[1px] bg-slate-800 flex-grow max-w-[100px]" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 col-span-1 md:col-span-2 w-full">
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
                            <span className="inline-flex items-center gap-1.5 text-teal-400 text-sm font-bold group-hover:translate-x-1 transition-transform mt-auto">
                                Setup Margin <ArrowRight size={14} />
                            </span>
                        </button>
                    </div>

                    {/* SPLITTER FOR PROPS */}
                    <div className="col-span-1 md:col-span-2 flex items-center justify-center my-4">
                        <div className="h-[1px] bg-slate-800 flex-grow max-w-[100px]" />
                        <span className="text-slate-500 text-xs font-bold uppercase px-4 tracking-wider">or try something new</span>
                        <div className="h-[1px] bg-slate-800 flex-grow max-w-[100px]" />
                    </div>

                    {/* PROPS / SIDE HUSTLE OPTION */}
                    <button
                        onClick={onSelectProps}
                        className="group relative bg-slate-800 hover:bg-slate-700 border-2 border-slate-700 hover:border-emerald-500 rounded-2xl p-8 text-left transition-all hover:-translate-y-1 shadow-xl col-span-1 md:col-span-2"
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
            </main>
            <Footer />
        </div>
    );
};
