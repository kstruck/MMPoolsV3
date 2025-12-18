
import React, { useState, useMemo } from 'react';
import { Search, Trophy } from 'lucide-react';
import type { GameState, User, BracketPool } from '../types';
import { Header } from './Header';
import { Footer } from './Footer';

interface BrowsePoolsProps {
    user: User | null;
    pools: (GameState | BracketPool)[];
    onOpenAuth: () => void;
    onLogout: () => void;
}

export const BrowsePools: React.FC<BrowsePoolsProps> = ({ user, pools, onOpenAuth, onLogout }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedLeague, setSelectedLeague] = useState<string>('all');

    // Filter Logic
    const filteredPools = useMemo(() => {
        return pools.filter(p => {
            // Cast helper
            const isBracket = p.type === 'BRACKET';
            const isSquares = !p.type || p.type === 'SQUARES'; // Default to squares if undefined

            // Common fields
            const name = p.name || '';
            const isPublic = isBracket ? (p as BracketPool).isListedPublic : (p as GameState).isPublic;

            if (!isPublic) return false;

            // Search Match
            const searchLower = searchTerm.toLowerCase();
            const contactEmail = (p as any).contactEmail || ''; // Bracket pool might not have contactEmail in same place yet
            const matchesSearch =
                name.toLowerCase().includes(searchLower) ||
                (isSquares && (p as GameState).homeTeam.toLowerCase().includes(searchLower)) ||
                (isSquares && (p as GameState).awayTeam.toLowerCase().includes(searchLower)) ||
                contactEmail.toLowerCase().includes(searchLower);

            if (!matchesSearch) return false;



            // League Filter
            if (selectedLeague !== 'all') {
                if (isBracket && selectedLeague !== 'ncaa_bb') return false;
                if (isSquares) {
                    const poolLeague = (p as GameState).league || 'nfl';
                    if (selectedLeague === 'nfl' && poolLeague !== 'nfl') return false;
                    if (selectedLeague === 'college' && (poolLeague !== 'college' && poolLeague !== 'ncaa')) return false;
                    if (selectedLeague === 'ncaa_bb') return false; // Squares aren't usually NCAA BB
                }
            }

            return true;
        });
    }, [pools, searchTerm, selectedLeague]);

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
            <Header user={user} onOpenAuth={onOpenAuth} onLogout={onLogout} />

            <main className="max-w-7xl mx-auto p-4 md:p-8 mt-6">
                {/* Header Section */}
                <div className="flex flex-col md:flex-row justify-between items-end mb-10 gap-6 border-b border-slate-800 pb-8">
                    <div>
                        <h2 className="text-4xl font-extrabold text-white mb-2 tracking-tight">Public Pools</h2>
                        <p className="text-slate-400 max-w-xl">
                            Join active Super Bowl squares pools and March Madness brackets.
                        </p>
                    </div>
                </div>

                {/* Filters Row */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    <div className="space-y-6">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-3 text-slate-500" size={18} />
                            <input
                                type="text"
                                placeholder="Search pools, teams..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-slate-900/50 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                            />
                        </div>

                        {/* Sport Filter */}
                        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                <Trophy size={14} /> Sport / League
                            </h3>
                            <div className="flex flex-col gap-2">
                                {[
                                    { id: 'all', label: 'All Sports', active: true },
                                    { id: 'nfl', label: 'NFL Football', active: true },
                                    { id: 'college', label: 'NCAA Football', active: true },
                                    { id: 'ncaa_bb', label: 'NCAA Basketball', active: true },
                                    { id: 'nba', label: 'NBA', active: false },
                                ].map((sport) => (
                                    <button
                                        key={sport.id}
                                        onClick={() => sport.active && setSelectedLeague(sport.id)}
                                        disabled={!sport.active}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all flex justify-between items-center ${!sport.active
                                            ? 'opacity-40 cursor-not-allowed text-slate-500 hover:bg-transparent'
                                            : selectedLeague === sport.id
                                                ? 'bg-indigo-600 text-white'
                                                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                                            }`}
                                    >
                                        <span>{sport.label}</span>
                                        {!sport.active && <span className="text-[10px] uppercase font-bold bg-slate-800 px-1.5 py-0.5 rounded">Soon</span>}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Results */}
                    <div className="lg:col-span-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {filteredPools.map(pool => {
                                const isBracket = pool.type === 'BRACKET';
                                const cost = isBracket ? (pool as BracketPool).settings.entryFee : (pool as GameState).costPerSquare;

                                return (
                                    <div key={pool.id} onClick={() => window.location.hash = `#pool/${pool.id}`} className="group bg-slate-900/50 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-800 rounded-xl p-5 cursor-pointer transition-all relative overflow-hidden">
                                        <div className="flex justify-between items-start mb-4 relative z-10">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-12 h-12 rounded-full border flex items-center justify-center text-lg font-bold group-hover:scale-105 transition-transform ${isBracket ? 'bg-amber-900/20 border-amber-500/30 text-amber-500' : 'bg-slate-800 border-slate-700 text-indigo-400'}`}>
                                                    {isBracket ? <Trophy size={20} /> : pool.name.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <h3 className="text-lg font-bold text-white group-hover:text-indigo-400 transition-colors line-clamp-1">{pool.name}</h3>
                                                    <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
                                                        {isBracket ? <span className="text-amber-500">March Madness Bracket</span> : <span>Super Bowl Squares</span>}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <span className="block text-xl font-bold text-emerald-400 font-mono">${cost}</span>
                                                <span className="text-[10px] text-slate-500 uppercase font-bold">Entry</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    );
};
