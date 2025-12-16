import React, { useState, useEffect } from 'react';
import type { User, GameState } from '../types';
import { dbService } from '../services/dbService';
import { ExternalLink, Trophy, Grid as GridIcon, Loader } from 'lucide-react';
import { getTeamLogo } from '../constants';

import { Header } from './Header';
import { Footer } from './Footer';

interface ParticipantDashboardProps {
    user: User;
    onLogout: () => void;
}

export const ParticipantDashboard: React.FC<ParticipantDashboardProps> = ({ user, onLogout }) => {
    const [myPools, setMyPools] = useState<GameState[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = dbService.subscribeToPools((pools) => {
            // Filter where user has reserved squares OR is the owner (legacy check)
            // Ideally we use the 'participations' subcollection, but for MVP this client-side filter is fine.
            // Filter for pools where the user participates (has squares) or is the owner
            const participating = pools.filter(p => {
                const isOwner = p.ownerId === user.id;
                const matchesId = p.squares.some(s => s.reservedByUid === user.id);
                // Legacy check: match by name or email prefix if uid is missing on square
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

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
            <Header user={user} onOpenAuth={() => { }} onLogout={onLogout} />

            <main className="max-w-6xl mx-auto p-6 md:p-8">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Loader className="animate-spin text-indigo-500 mb-4" size={32} />
                        <p className="text-slate-500">Loading your pools...</p>
                    </div>
                ) : myPools.length === 0 ? (
                    <div className="text-center py-20 bg-slate-900/50 rounded-2xl border border-slate-800 border-dashed">
                        <GridIcon size={48} className="mx-auto text-slate-700 mb-4" />
                        <h2 className="text-xl font-bold text-slate-300 mb-2">No Entries Found</h2>
                        <p className="text-slate-500 mb-6 max-w-md mx-auto">You haven't joined any pools yet. Join a pool to see your squares here.</p>
                        <button onClick={() => window.location.hash = '#browse'} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg shadow-indigo-500/20">
                            Browse Public Pools
                        </button>
                    </div>
                ) : (
                    <div className="space-y-8">
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                                <Trophy className="text-amber-400" size={24} /> My Entries ({myPools.length})
                            </h2>
                            <button onClick={() => window.location.hash = '#browse'} className="text-indigo-400 hover:text-indigo-300 text-sm font-bold flex items-center gap-1">
                                Find More <ExternalLink size={14} />
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {myPools.map(pool => {
                                const emailPrefix = user.email ? user.email.split('@')[0] : '';
                                const mySquares = pool.squares.filter(s =>
                                    s.reservedByUid === user.id ||
                                    s.owner === user.name ||
                                    (emailPrefix && s.owner === emailPrefix) // Handle legacy where owner might be email prefix
                                );
                                const homeLogo = pool.homeTeamLogo || getTeamLogo(pool.homeTeam);
                                const awayLogo = pool.awayTeamLogo || getTeamLogo(pool.awayTeam);

                                return (
                                    <div key={pool.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg hover:border-indigo-500/50 transition-all group relative">
                                        <div className="p-4 bg-slate-950/50 border-b border-slate-800 flex justify-between items-center">
                                            <h3 className="font-bold text-white truncate max-w-[70%]">{pool.name}</h3>
                                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${pool.isLocked ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'}`}>
                                                {pool.isLocked ? 'Locked' : 'Open'}
                                            </span>
                                        </div>
                                        <div className="p-6">
                                            <div className="flex justify-between items-center mb-6">
                                                <div className="flex items-center gap-2">
                                                    {awayLogo && <img src={awayLogo} className="w-8 h-8 object-contain" />}
                                                    <span className="font-bold text-slate-400 text-sm">{pool.awayTeam}</span>
                                                </div>
                                                <span className="text-slate-600 font-bold text-xs uppercase">VS</span>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-slate-400 text-sm">{pool.homeTeam}</span>
                                                    {homeLogo && <img src={homeLogo} className="w-8 h-8 object-contain" />}
                                                </div>
                                            </div>

                                            <div className="bg-slate-800/50 rounded-lg p-3 mb-4">
                                                <p className="text-xs text-slate-500 uppercase font-bold mb-2">Your Squares</p>
                                                <div className="flex flex-wrap gap-2">
                                                    {mySquares.map(s => (
                                                        <span key={s.id} className="bg-indigo-600 text-white text-xs font-bold px-2 py-1 rounded shadow-sm">
                                                            #{s.id}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            <button
                                                onClick={() => window.location.hash = `#pool/${pool.id}`}
                                                className="w-full bg-slate-800 hover:bg-slate-700 text-white py-2 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2"
                                            >
                                                View Grid <ExternalLink size={14} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </main>
            <Footer />
        </div>
    );
};
