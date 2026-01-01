import React from 'react';
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
    // const [settings, setSettings] = useState<SystemSettings | null>(null);

    // useEffect(() => {
    //     const unsub = settingsService.subscribe(setSettings);
    //     return () => unsub();
    // }, []);

    const isBracketEnabled = user?.role === 'SUPER_ADMIN';

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
                    {/* SQUARES OPTION */}
                    <button
                        onClick={onSelectSquares}
                        className="group relative bg-slate-800 hover:bg-slate-700 border-2 border-slate-700 hover:border-indigo-500 rounded-2xl p-8 text-left transition-all hover:-translate-y-1 shadow-xl"
                    >
                        <div className="absolute top-4 right-4 bg-indigo-500/20 p-3 rounded-xl group-hover:bg-indigo-500 transition-colors">
                            <Grid3X3 size={32} className="text-indigo-400 group-hover:text-white" />
                        </div>
                        <h3 className="text-2xl font-bold text-white mb-2">Gameday Squares</h3>
                        <p className="text-slate-400 mb-6 min-h-[48px]">Classic 10x10 grid. Random numbers per quarter. Perfect for the big game.</p>
                        <ul className="text-sm text-slate-500 space-y-2 mb-8">
                            <li className="flex items-center gap-2">✓ Automated scoring</li>
                            <li className="flex items-center gap-2">✓ Quarter & Final payouts</li>
                            <li className="flex items-center gap-2">✓ Custom pricing</li>
                        </ul>
                        <span className="inline-flex items-center gap-2 text-indigo-400 font-bold group-hover:translate-x-1 transition-transform">
                            Create Squares Pool <ArrowRight size={16} />
                        </span>
                    </button>

                    {/* BRACKET OPTION */}
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
                        <h3 className="text-2xl font-bold text-white mb-2">Bracket Challenge</h3>
                        <p className="text-slate-400 mb-6">Traditional 64-team bracket. Pick winners for every round. Features automated scoring and multiple scoring systems.</p>
                        <ul className="text-sm text-slate-500 space-y-2 mb-8">
                            <li className="flex items-center gap-2">✓ Live bracket updates</li>
                            <li className="flex items-center gap-2">✓ Round-by-round scoring</li>
                            <li className="flex items-center gap-2">✓ Mobile-friendly tree</li>
                        </ul>

                        <span className="inline-flex items-center gap-2 text-orange-400 font-bold group-hover:translate-x-1 transition-transform">
                            Create Bracket Pool <ArrowRight size={16} />
                        </span>
                    </button>

                    {/* NFL PLAYOFFS OPTION */}
                    <button
                        onClick={onSelectPlayoff}
                        className="group relative bg-slate-800 hover:bg-slate-700 border-2 border-slate-700 hover:border-orange-500 rounded-2xl p-8 text-left transition-all hover:-translate-y-1 shadow-xl md:col-span-2 lg:col-span-1"
                    >
                        <div className="absolute top-4 right-4 bg-orange-500/20 p-3 rounded-xl group-hover:bg-orange-500 transition-colors">
                            <Trophy size={32} className="text-orange-400 group-hover:text-white" />
                        </div>
                        <h3 className="text-2xl font-bold text-white mb-2">Playoff Challenge</h3>
                        <p className="text-slate-400 mb-6">Rank all 14 playoff teams from 14 down to 1. Points accumulate as teams advance. Simple and exciting.</p>
                        <ul className="text-sm text-slate-500 space-y-2 mb-8">
                            <li className="flex items-center gap-2">✓ Progressive scoring</li>
                            <li className="flex items-center gap-2">✓ Drag & Drop Rankings</li>
                            <li className="flex items-center gap-2">✓ Strategic multipliers</li>
                        </ul>
                        <span className="inline-flex items-center gap-2 text-orange-400 font-bold group-hover:translate-x-1 transition-transform">
                            Create Playoff Pool <ArrowRight size={16} />
                        </span>
                    </button>

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
