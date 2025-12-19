import React, { useState, useEffect, useMemo } from 'react';
import type { User, GameState } from '../types';
import { getTeamLogo } from '../constants';
import { dbService } from '../services/dbService';
import { LayoutGrid, User as UserIcon, Search, ChevronRight, Loader, Calendar, Shield } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';

interface ParticipantDashboardProps {
    user: User;
    onLogout: () => void;
    onCreatePool?: () => void;
}

export const ParticipantDashboard: React.FC<ParticipantDashboardProps> = ({ user, onLogout, onCreatePool }) => {
    const [myPools, setMyPools] = useState<GameState[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'all' | 'open' | 'live' | 'completed'>('all');
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        const unsubscribe = dbService.subscribeToPools((pools) => {
            const participating = pools.filter(p => {
                const isOwner = p.ownerId === user.id;
                const matchesId = p.squares.some(s => s.reservedByUid === user.id);
                const matchesName = p.squares.some(s =>
                    !s.reservedByUid && s.owner && (
                        s.owner === user.name ||
                        (user.email && s.owner === user.email) ||
                        (user.email && s.owner.toLowerCase() === user.email.split('@')[0].toLowerCase())
                    )
                );
                return isOwner || matchesId || matchesName;
            });
            setMyPools(participating);
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, [user.id]);

    // Derived State for Filtering
    const filteredPools = useMemo(() => {
        return myPools.filter(pool => {
            // 1. Search Query Filter
            const query = searchQuery.toLowerCase();
            const matchesSearch = !query ||
                pool.name.toLowerCase().includes(query) ||
                pool.homeTeam.toLowerCase().includes(query) ||
                pool.awayTeam.toLowerCase().includes(query) ||
                pool.id.includes(query);

            if (!matchesSearch) return false;

            // 2. Tab Status Filter
            const isCompleted = pool.scores.gameStatus === 'post';
            const isLive = pool.isLocked && !isCompleted;
            const isOpen = !pool.isLocked;

            if (activeTab === 'open') return isOpen;
            if (activeTab === 'live') return isLive;
            if (activeTab === 'completed') return isCompleted;

            return true; // 'all'
        });
    }, [myPools, searchQuery, activeTab]);

    // Counts for Tabs
    const counts = useMemo(() => {
        const open = myPools.filter(p => !p.isLocked).length;
        const completed = myPools.filter(p => p.scores.gameStatus === 'post').length;
        const live = myPools.filter(p => p.isLocked && p.scores.gameStatus !== 'post').length;
        return { all: myPools.length, open, live, completed };
    }, [myPools]);

    const getStatusBadge = (pool: GameState) => {
        if (pool.scores.gameStatus === 'post') return <span className="bg-slate-700 text-slate-300 text-[10px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider">Completed</span>;
        if (pool.isLocked) return <span className="bg-rose-500 text-white text-[10px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider animate-pulse">Live Now</span>;
        return <span className="bg-emerald-500 text-white text-[10px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider">Open</span>;
    };

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col">
            <Header user={user} onOpenAuth={() => { }} onLogout={onLogout} onCreatePool={onCreatePool} />

            <main className="flex-grow max-w-7xl mx-auto w-full p-4 md:p-8">
                {/* Header Section */}
                <div className="flex flex-col md:flex-row justify-between items-end mb-8 gap-4">
                    <div>
                        <h2 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
                            <LayoutGrid className="text-emerald-400" /> My Entries
                        </h2>
                        <p className="text-slate-400">Manage and track all your active pool entries.</p>
                    </div>

                    {/* Search Bar */}
                    <div className="relative w-full md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                        <input
                            type="text"
                            placeholder="Search pools..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none placeholder:text-slate-500"
                        />
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-2 mb-6 border-b border-slate-700 overflow-x-auto">
                    {[
                        { id: 'live', label: 'Live', count: counts.live },
                        { id: 'open', label: 'Open', count: counts.open },
                        { id: 'completed', label: 'Completed', count: counts.completed },
                        { id: 'all', label: 'All Pools', count: counts.all },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`px-4 py-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${activeTab === tab.id
                                ? 'border-emerald-500 text-white'
                                : 'border-transparent text-slate-400 hover:text-slate-200'
                                }`}
                        >
                            {tab.label}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                                {tab.count}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Content Grid */}
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Loader className="animate-spin text-indigo-500 mb-4" size={32} />
                        <p className="text-slate-500">Loading your pools...</p>
                    </div>
                ) : filteredPools.length === 0 ? (
                    <div className="text-center py-20 bg-slate-800/30 rounded-2xl border border-slate-800 border-dashed">
                        {searchQuery ? (
                            <>
                                <Search size={48} className="mx-auto text-slate-700 mb-4" />
                                <h3 className="text-xl font-bold text-slate-300 mb-2">No matches found</h3>
                                <p className="text-slate-500 max-w-md mx-auto">
                                    We couldn't find any pools matching "{searchQuery}" in the {activeTab !== 'all' ? activeTab : ''} category.
                                </p>
                                <button onClick={() => setSearchQuery('')} className="mt-4 text-emerald-400 hover:text-emerald-300 font-bold text-sm">Clear Search</button>
                            </>
                        ) : (
                            <>
                                <LayoutGrid size={48} className="mx-auto text-slate-700 mb-4" />
                                <h3 className="text-xl font-bold text-slate-300 mb-2">No pools found</h3>
                                <p className="text-slate-500 max-w-md mx-auto mb-6">
                                    You don't have any {activeTab !== 'all' && activeTab} pools yet.
                                </p>
                                <button onClick={() => window.location.hash = '#browse'} className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-full font-bold transition-transform hover:scale-105 shadow-lg shadow-emerald-900/20">
                                    Browse Available Pools
                                </button>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredPools.map(pool => {
                            const emailPrefix = user.email ? user.email.split('@')[0] : '';
                            const userSquares = pool.squares.filter(s =>
                                s.reservedByUid === user.id ||
                                s.owner === user.name ||
                                (emailPrefix && s.owner === emailPrefix)
                            );

                            return (
                                <div
                                    key={pool.id}
                                    onClick={() => window.location.hash = `#pool/${pool.urlSlug || pool.id}`}
                                    className="group bg-slate-800/50 border border-slate-700 hover:border-emerald-500/50 hover:bg-slate-800 rounded-xl p-5 transition-all cursor-pointer relative overflow-hidden"
                                >
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="flex -space-x-3 isolate">
                                                <div className="w-10 h-10 rounded-full bg-slate-900 border-2 border-slate-700 flex items-center justify-center overflow-hidden relative z-10 shadow-md">
                                                    {(pool.awayTeamLogo || getTeamLogo(pool.awayTeam)) ? (
                                                        <img src={pool.awayTeamLogo || getTeamLogo(pool.awayTeam) || ''} alt="Away" className="w-full h-full object-contain p-0.5" />
                                                    ) : (
                                                        <Shield className="text-slate-600" size={16} />
                                                    )}
                                                </div>
                                                <div className="w-10 h-10 rounded-full bg-slate-900 border-2 border-slate-700 flex items-center justify-center overflow-hidden relative z-0 shadow-md">
                                                    {(pool.homeTeamLogo || getTeamLogo(pool.homeTeam)) ? (
                                                        <img src={pool.homeTeamLogo || getTeamLogo(pool.homeTeam) || ''} alt="Home" className="w-full h-full object-contain p-0.5" />
                                                    ) : (
                                                        <Shield className="text-slate-600" size={16} />
                                                    )}
                                                </div>
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-white group-hover:text-emerald-400 transition-colors line-clamp-1">{pool.name}</h3>
                                                <div className="flex items-center gap-2 mt-1">
                                                    {getStatusBadge(pool)}
                                                    <span className="text-xs text-slate-500 font-mono">${pool.costPerSquare}/sq</span>
                                                </div>
                                                {pool.scores.startTime && (
                                                    <div className="text-[10px] text-slate-400 mt-1 font-medium flex items-center gap-1">
                                                        <Calendar size={10} />
                                                        {new Date(pool.scores.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-2 mb-4">
                                        <div className="flex justify-between text-xs">
                                            <span className="text-slate-400">Your Squares</span>
                                            <span className="text-white font-bold">{userSquares.length}</span>
                                        </div>
                                        {/* Progress Bar for Pool Fullness */}
                                        <div className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-emerald-500 transition-all duration-500"
                                                style={{ width: `${(pool.squares.filter(s => s.owner).length / 100) * 100}%` }}
                                            />
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between text-xs text-slate-500 border-t border-slate-700/50 pt-3">
                                        <span className="flex items-center gap-1"><UserIcon size={10} /> Owner: {pool.managerName || 'Unknown'}</span>
                                        <span className="group-hover:translate-x-1 transition-transform flex items-center gap-1 text-emerald-400 font-bold">
                                            View Pool <ChevronRight size={10} />
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>
            <Footer />
        </div>
    );
};
