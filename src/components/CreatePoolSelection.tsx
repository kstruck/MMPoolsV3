import React, { useEffect, useState } from 'react';
import { Trophy, Grid3X3, Lock, ArrowRight, ArrowLeft } from 'lucide-react';
import { settingsService } from '../services/settingsService';
import { Header } from './Header';
import { Footer } from './Footer';
import type { SystemSettings, User } from '../types';

interface CreatePoolSelectionProps {
    onSelectSquares: () => void;
    onSelectBracket: () => void;
    user: User | null;
    isManager: boolean;
    onOpenAuth: () => void;
    onLogout: () => void;
    onCreatePool: () => void;
}

export const CreatePoolSelection: React.FC<CreatePoolSelectionProps> = ({
    onSelectSquares,
    onSelectBracket,
    user,
    isManager,
    onOpenAuth,
    onLogout,
    onCreatePool
}) => {
    const [settings, setSettings] = useState<SystemSettings | null>(null);

    useEffect(() => {
        const unsub = settingsService.subscribe(setSettings);
        return () => unsub();
    }, []);

    const isBracketEnabled = settings?.enableBracketPools || user?.role === 'SUPER_ADMIN';

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
                        <h3 className="text-2xl font-bold text-white mb-2">Super Bowl Squares</h3>
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
                        <h3 className="text-2xl font-bold text-white mb-2 flex items-center gap-3">
                            March Madness
                            {!isBracketEnabled && <span className="text-xs bg-slate-700 text-slate-400 px-2 py-1 rounded uppercase tracking-wider">Coming Soon</span>}
                        </h3>
                        <p className="text-slate-400 mb-6 min-h-[48px]">64-Team Bracket Challenge. Points per round. Live standings & leaderboard.</p>
                        <ul className="text-sm text-slate-500 space-y-2 mb-8">
                            <li className="flex items-center gap-2">✓ Live bracket updates</li>
                            <li className="flex items-center gap-2">✓ Round-by-round scoring</li>
                            <li className="flex items-center gap-2">✓ Mobile-friendly tree</li>
                        </ul>

                        {isBracketEnabled ? (
                            <span className="inline-flex items-center gap-2 text-orange-400 font-bold group-hover:translate-x-1 transition-transform">
                                Create Bracket Pool <ArrowRight size={16} />
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-2 text-slate-600 font-bold">
                                Locked <Lock size={14} />
                            </span>
                        )}
                    </button>
                </div>
            </main>
            <Footer />
        </div>
    );
};
