import React from 'react';
import type { PlayoffPool } from '../../types';
import { Trophy } from 'lucide-react';

interface PlayoffPayoutCardProps {
    pool: PlayoffPool;
    paidEntriesCount: number;
}

export const PlayoffPayoutCard: React.FC<PlayoffPayoutCardProps> = ({ pool, paidEntriesCount }) => {

    const totalPot = paidEntriesCount * (pool.settings?.entryFee || 0);

    // Charity not yet supported in PlayoffPool types
    const netPot = totalPot;

    return (
        <div className="bg-card rounded-xl border border-line shadow-card flex flex-col overflow-hidden h-full max-w-sm">
            <div className="flex border-b border-line bg-surface px-6 py-4">
                <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Payout Structure</h3>
            </div>

            <div className="p-6 flex-1 flex flex-col justify-center">
                <div className="animate-in fade-in slide-in-from-left-4 duration-300">
                    <div className="space-y-3">
                        {/* Total Collected */}
                        <div className="flex justify-between items-center text-sm border-b border-line pb-2 mb-2">
                            <span className="font-body text-muted num">Total Pot ({paidEntriesCount} Paid)</span>
                            <span className="text-gold-600 dark:text-gold-400 num font-display font-bold text-lg">
                                ${(totalPot).toLocaleString()}
                            </span>
                        </div>
                    </div>

                    <div className="space-y-1">
                        {pool.settings?.payouts?.places?.length > 0 ? (
                            pool.settings.payouts.places.map((place: any, idx: number) => {
                                const amount = Math.floor(netPot * (place.percentage / 100));
                                if (place.percentage === 0) return null;
                                return (
                                    <div key={idx} className="flex justify-between items-center text-sm font-body">
                                        <span className="text-muted font-bold num">
                                            {place.rank === 1 ? '1st Place' : place.rank === 2 ? '2nd Place' : place.rank === 3 ? '3rd Place' : `${place.rank}th Place`}
                                            <span className="text-faint font-normal ml-1">({place.percentage}%)</span>
                                        </span>
                                        <span className="text-[color:var(--text)] num font-display font-bold">
                                            ${amount.toLocaleString()}
                                        </span>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="mt-4 bg-surface border border-line rounded-lg p-3 text-center">
                                <Trophy className="w-8 h-8 text-gold-500 mx-auto mb-2" />
                                <p className="text-sm font-body text-[color:var(--text)] font-medium">Winner Takes All / Manager Discretion</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
