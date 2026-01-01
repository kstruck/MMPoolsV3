import React, { useState, useEffect } from 'react';
import type { GameState } from '../types';
import { dbService } from '../services/dbService';
import { DollarSign, Users, TrendingUp, Award, Percent, Clock, Zap } from 'lucide-react';

interface PoolStatisticsProps {
    pool: GameState;
}

export const PoolStatistics: React.FC<PoolStatisticsProps> = ({ pool }) => {
    // Props State
    const [propCards, setPropCards] = useState<any[]>([]);

    useEffect(() => {
        if (pool.id && pool.props?.enabled) {
            const unsub = dbService.subscribeToAllPropCards(pool.id, (cards) => {
                setPropCards(cards);
            });
            return () => unsub();
        }
    }, [pool.id, pool.props?.enabled]);

    // Calculate statistics
    const totalSquares = 100;
    const soldSquares = pool.squares.filter(s => s.owner).length;
    const paidSquares = pool.squares.filter(s => s.owner && s.isPaid).length;
    const unpaidSquares = soldSquares - paidSquares;
    const availableSquares = totalSquares - soldSquares;

    const totalRevenue = soldSquares * pool.costPerSquare;
    const collectedRevenue = paidSquares * pool.costPerSquare;
    const outstandingRevenue = unpaidSquares * pool.costPerSquare;
    const potentialRevenue = totalSquares * pool.costPerSquare;

    // Get unique participants
    const uniqueParticipants = new Set(pool.squares.filter(s => s.owner).map(s => s.owner!.toLowerCase())).size;

    // Get top participants (by square count)
    const participantCounts = pool.squares
        .filter(s => s.owner)
        .reduce((acc, s) => {
            const name = s.owner!;
            acc[name] = (acc[name] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

    const topParticipants = Object.entries(participantCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    // Sale velocity (squares per day since creation)
    const daysSinceCreation = pool.createdAt
        ? Math.max(1, Math.ceil((Date.now() - pool.createdAt.toMillis()) / (1000 * 60 * 60 * 24)))
        : 1;
    const salesVelocity = (soldSquares / daysSinceCreation).toFixed(1);

    const percentSold = ((soldSquares / totalSquares) * 100).toFixed(0);
    const percentPaid = soldSquares > 0 ? ((paidSquares / soldSquares) * 100).toFixed(0) : '0';

    // Prop Stats
    const propPot = propCards.length * (pool.props?.cost || 0);
    const payoutAmounts = (pool.props?.payouts || [100]).map(pct => (pct / 100) * propPot);


    return (
        <div className="space-y-6">
            {/* Revenue Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase mb-2">
                        <DollarSign size={14} /> Potential Revenue
                    </div>
                    <div className="text-2xl font-bold text-white font-mono">${potentialRevenue.toLocaleString()}</div>
                    <div className="text-xs text-slate-500">{availableSquares > 0 ? `${availableSquares} available` : 'Grid full!'} (${totalRevenue.toLocaleString()} sold)</div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase mb-2">
                        <TrendingUp size={14} /> Collected
                    </div>
                    <div className="text-2xl font-bold text-emerald-400 font-mono">${collectedRevenue.toLocaleString()}</div>
                    <div className="text-xs text-slate-500">{paidSquares} squares paid</div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase mb-2">
                        <Clock size={14} /> Outstanding
                    </div>
                    <div className="text-2xl font-bold text-amber-400 font-mono">${outstandingRevenue.toLocaleString()}</div>
                    <div className="text-xs text-slate-500">{unpaidSquares} unpaid</div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold uppercase mb-2">
                        <Users size={14} /> Participants
                    </div>
                    <div className="text-2xl font-bold text-indigo-400 font-mono">{uniqueParticipants}</div>
                    <div className="text-xs text-slate-500">unique players</div>
                </div>
            </div>

            {/* Progress Bars */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-white font-bold mb-4">Grid Progress</h3>

                {/* Sold Progress */}
                <div className="mb-4">
                    <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-400">Squares Sold</span>
                        <span className="text-white font-mono font-bold">{soldSquares} / {totalSquares} ({percentSold}%)</span>
                    </div>
                    <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-500"
                            style={{ width: `${percentSold}%` }}
                        />
                    </div>
                </div>

                {/* Paid Progress */}
                <div>
                    <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-400">Payment Collected</span>
                        <span className="text-white font-mono font-bold">{paidSquares} / {soldSquares} ({percentPaid}%)</span>
                    </div>
                    <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
                            style={{ width: `${percentPaid}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Side by Side: Velocity + Top Participants */}
            <div className="grid md:grid-cols-2 gap-4">
                {/* Sales Velocity */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                        <Percent size={16} className="text-indigo-400" /> Sales Velocity
                    </h3>
                    <div className="text-center py-4">
                        <div className="text-4xl font-bold text-white font-mono mb-2">{salesVelocity}</div>
                        <div className="text-sm text-slate-500">squares per day</div>
                    </div>
                    <div className="text-xs text-slate-600 text-center">
                        Pool created {daysSinceCreation} {daysSinceCreation === 1 ? 'day' : 'days'} ago
                    </div>
                </div>

                {/* Top Participants */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                        <Award size={16} className="text-amber-400" /> Top Participants
                    </h3>
                    {topParticipants.length === 0 ? (
                        <div className="text-slate-500 text-sm text-center py-4">No participants yet</div>
                    ) : (
                        <div className="space-y-2">
                            {topParticipants.map(([name, count], i) => (
                                <div key={name} className="flex items-center justify-between p-2 bg-slate-950 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? 'bg-amber-500 text-black' : i === 1 ? 'bg-slate-400 text-black' : i === 2 ? 'bg-orange-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                                            {i + 1}
                                        </span>
                                        <span className="text-white font-medium truncate max-w-[120px]">{name}</span>
                                    </div>
                                    <span className="text-slate-400 font-mono text-sm">{count} sq</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Side Hustle Stats */}
            {
                pool.props?.enabled && (
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                            <Zap size={120} className="text-amber-400" />
                        </div>
                        <h3 className="text-white font-bold mb-4 flex items-center gap-2 relative z-10">
                            <Zap size={16} className="text-amber-400" /> Side Hustle Stats
                        </h3>

                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 relative z-10">
                            <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                                <div className="text-xs text-slate-500 uppercase font-bold mb-1">Total Pot</div>
                                <div className="text-2xl font-bold text-emerald-400 font-mono">${propPot.toLocaleString()}</div>
                                <div className="text-xs text-slate-500">${pool.props?.cost} per card</div>
                            </div>
                            <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                                <div className="text-xs text-slate-500 uppercase font-bold mb-1">Cards Sold</div>
                                <div className="text-2xl font-bold text-indigo-400 font-mono">{propCards.length}</div>
                                <div className="text-xs text-slate-500">
                                    {pool.props?.maxCards && pool.props?.maxCards > 1 ? `Max ${pool.props.maxCards} per player` : '1 per player'}
                                </div>
                            </div>
                            {/* Payouts Breakdown */}
                            <div className="col-span-2 bg-slate-950 p-4 rounded-lg border border-slate-800">
                                <div className="text-xs text-slate-500 uppercase font-bold mb-2">Projected Payouts</div>
                                <div className="flex gap-6 overflow-x-auto pb-1">
                                    {payoutAmounts.map((amt, idx) => (
                                        <div key={idx} className="text-center min-w-[60px]">
                                            <div className="text-sm font-bold text-white font-mono shadow-green-900">${amt.toLocaleString()}</div>
                                            <div className="text-[10px] text-slate-500 mt-1 font-bold">
                                                {idx === 0 ? '1st' : idx === 1 ? '2nd' : idx === 2 ? '3rd' : `${idx + 1}th`}
                                                <span className="font-normal opacity-50 ml-1">({(pool.props?.payouts || [100])[idx]}%)</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};
