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
        <div className="bg-black rounded-xl border border-slate-800 shadow-xl flex flex-col overflow-hidden h-full max-w-sm">
            <div className="flex border-b border-slate-800 bg-slate-900 px-6 py-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">Payout Structure</h3>
            </div>

            <div className="p-6 flex-1 flex flex-col justify-center">
                <div className="animate-in fade-in slide-in-from-left-4 duration-300">
                    <div className="space-y-3">
                        {/* Total Collected */}
                        <div className="flex justify-between items-center text-sm border-b border-slate-700 pb-2 mb-2">
                            <span className="text-slate-400">Total Pot ({paidEntriesCount} Paid)</span>
                            <span className="text-emerald-400 font-mono font-bold text-lg">
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
                                    <div key={idx} className="flex justify-between items-center text-sm">
                                        <span className="text-slate-400 font-bold">
                                            {place.rank === 1 ? '1st Place' : place.rank === 2 ? '2nd Place' : place.rank === 3 ? '3rd Place' : `${place.rank}th Place`}
                                            <span className="text-slate-600 font-normal ml-1">({place.percentage}%)</span>
                                        </span>
                                        <span className="text-white font-mono font-bold">
                                            ${amount.toLocaleString()}
                                        </span>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="mt-4 bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
                                <Trophy className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                                <p className="text-sm text-slate-300 font-medium">Winner Takes All / Manager Discretion</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
