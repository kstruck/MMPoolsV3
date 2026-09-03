import React, { useState, useEffect } from 'react';
import type { GameState, PropCard } from '../types';
import { dbService } from '../services/dbService';
import { Percent, Award, Zap } from 'lucide-react';
import { StatTile } from './ui';

interface PoolStatisticsProps {
    pool: GameState;
}
// ...
export const PoolStatistics: React.FC<PoolStatisticsProps> = ({ pool }) => {
    // Props State
    const [propCards, setPropCards] = useState<PropCard[]>([]);
    const [now] = useState(Date.now()); // Stable reference for calculations

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
    const getCreatedMillis = (val: GameState['createdAt']) => {
        if (!val) return now;
        if (typeof val === 'number') return val;
        return val.toMillis();
    };
    const createdMillis = getCreatedMillis(pool.createdAt);
    const daysSinceCreation = Math.max(1, Math.ceil((now - createdMillis) / (1000 * 60 * 60 * 24)));
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
                <StatTile
                    label="Potential Revenue"
                    value={`$${potentialRevenue.toLocaleString()}`}
                    accent="navy"
                    delta={{ text: `${availableSquares > 0 ? `${availableSquares} available` : 'Grid full!'} ($${totalRevenue.toLocaleString()} sold)` }}
                />

                <StatTile
                    label="Collected"
                    value={`$${collectedRevenue.toLocaleString()}`}
                    accent="gold"
                    delta={{ text: `${paidSquares} squares paid` }}
                />

                <StatTile
                    label="Outstanding"
                    value={`$${outstandingRevenue.toLocaleString()}`}
                    accent="red"
                    delta={{ text: `${unpaidSquares} unpaid` }}
                />

                <StatTile
                    label="Participants"
                    value={uniqueParticipants}
                    accent="navy"
                    delta={{ text: 'unique players' }}
                />
            </div>

            {/* Progress Bars */}
            <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                <h3 className="font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)] mb-4">Grid Progress</h3>

                {/* Sold Progress */}
                <div className="mb-4">
                    <div className="flex justify-between text-sm font-body mb-1">
                        <span className="text-muted">Squares Sold</span>
                        <span className="font-display font-bold text-[color:var(--text)] num">{soldSquares} / {totalSquares} ({percentSold}%)</span>
                    </div>
                    <div className="h-3 bg-line rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gold-foil transition-ui duration-500"
                            style={{ width: `${percentSold}%` }}
                        />
                    </div>
                </div>

                {/* Paid Progress */}
                <div>
                    <div className="flex justify-between text-sm font-body mb-1">
                        <span className="text-muted">Payment Collected</span>
                        <span className="font-display font-bold text-[color:var(--text)] num">{paidSquares} / {soldSquares} ({percentPaid}%)</span>
                    </div>
                    <div className="h-3 bg-line rounded-full overflow-hidden">
                        <div
                            className="h-full bg-[#0F7B4A] transition-ui duration-500"
                            style={{ width: `${percentPaid}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Side by Side: Velocity + Top Participants */}
            <div className="grid md:grid-cols-2 gap-4">
                {/* Sales Velocity */}
                <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                    <h3 className="font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)] mb-4 flex items-center gap-2">
                        <Percent size={16} className="text-gold-600 dark:text-gold-400" /> Sales Velocity
                    </h3>
                    <div className="text-center py-4">
                        <div className="font-display font-bold text-4xl leading-none text-[color:var(--text)] num mb-2">{salesVelocity}</div>
                        <div className="text-sm font-body text-muted">squares per day</div>
                    </div>
                    <div className="text-xs font-body text-faint text-center num">
                        Pool created {daysSinceCreation} {daysSinceCreation === 1 ? 'day' : 'days'} ago
                    </div>
                </div>

                {/* Top Participants */}
                <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                    <h3 className="font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)] mb-4 flex items-center gap-2">
                        <Award size={16} className="text-gold-600 dark:text-gold-400" /> Top Participants
                    </h3>
                    {topParticipants.length === 0 ? (
                        <div className="text-muted font-body text-sm text-center py-4">No participants yet</div>
                    ) : (
                        <div className="space-y-2">
                            {topParticipants.map(([name, count], i) => (
                                <div key={name} className="flex items-center justify-between p-2 bg-surface border border-line rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-display font-bold num ${i === 0 ? 'bg-gold-foil text-navy-900' : i === 1 ? 'bg-navy-800 text-white' : i === 2 ? 'bg-navy-600 text-white' : 'bg-card border border-line text-muted'}`}>
                                            {i + 1}
                                        </span>
                                        <span className="text-[color:var(--text)] font-body font-medium truncate max-w-[120px]">{name}</span>
                                    </div>
                                    <span className="text-muted font-body text-sm num">{count} sq</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Side Hustle Stats */}
            {
                pool.props?.enabled && (
                    <div className="bg-card border border-line rounded-xl p-6 shadow-card relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                            <Zap size={120} className="text-gold-500" />
                        </div>
                        <h3 className="font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)] mb-4 flex items-center gap-2 relative z-10">
                            <Zap size={16} className="text-gold-600 dark:text-gold-400" /> Side Hustle Stats
                        </h3>

                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 relative z-10">
                            <div className="bg-surface p-4 rounded-lg border border-line">
                                <div className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1">Total Pot</div>
                                <div className="font-display font-bold text-2xl text-gold-700 dark:text-gold-400 num">${propPot.toLocaleString()}</div>
                                <div className="text-xs font-body text-muted num">${pool.props?.cost} per card</div>
                            </div>
                            <div className="bg-surface p-4 rounded-lg border border-line">
                                <div className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1">Cards Sold</div>
                                <div className="font-display font-bold text-2xl text-navy-800 dark:text-gold-400 num">{propCards.length}</div>
                                <div className="text-xs font-body text-muted num">
                                    {pool.props?.maxCards && pool.props?.maxCards > 1 ? `Max ${pool.props.maxCards} per player` : '1 per player'}
                                </div>
                            </div>
                            {/* Payouts Breakdown */}
                            <div className="col-span-2 bg-surface p-4 rounded-lg border border-line">
                                <div className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-2">Projected Payouts</div>
                                <div className="flex gap-6 overflow-x-auto pb-1">
                                    {payoutAmounts.map((amt, idx) => (
                                        <div key={idx} className="text-center min-w-[60px]">
                                            <div className="text-sm font-display font-bold text-gold-700 dark:text-gold-400 num">${amt.toLocaleString()}</div>
                                            <div className="text-[10px] text-faint mt-1 font-body font-bold num">
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
