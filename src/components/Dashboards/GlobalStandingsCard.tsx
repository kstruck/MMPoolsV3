import React, { useState, useEffect, useMemo } from 'react';
import { Trophy, TrendingUp, Users, Activity, Crown } from 'lucide-react';
import { dbService } from '../../services/dbService';
import type { User, PoolType } from '../../types';

interface GlobalStandingsCardProps {
  user: User;
  poolType: PoolType;
  poolTypeName: string; // e.g., 'Weekly Pick-em', 'Survivor'
}

export const GlobalStandingsCard: React.FC<GlobalStandingsCardProps> = ({ user, poolType, poolTypeName }) => {
  const [globalRank, setGlobalRank] = useState<number | null>(null);
  const [totalParticipants, setTotalParticipants] = useState<number>(0);
  const [globalPrizePot, setGlobalPrizePot] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const fetchGlobalStats = async () => {
      setIsLoading(true);
      try {
        // Fetch all active pools of this type to calculate global prize pot and total participants
        const activePools = await dbService.getPoolsByType(poolType);
        
        let totalPrize = 0;
        let participantSet = new Set<string>();

        activePools.forEach((pool: any) => {
          // Add to prize pot (using generic settings.entryFee or costPerSquare if applicable)
          const fee = pool.settings?.entryFee || pool.costPerSquare || 0;
          const entriesCount = pool.entryCount || (pool.participantIds?.length || 0);
          totalPrize += (fee * entriesCount);

          if (pool.participantIds) {
            pool.participantIds.forEach((id: string) => participantSet.add(id));
          }
        });

        // Calculate user's relative rank (Mock calculation for UI demonstration)
        // In a full implementation, you'd calculate this via a Cloud Function aggregation.
        // For now, we simulate a percentile rank based on their historical stats or entry count.
        const userStats = user.historicalStats;
        let percentile = 50; // Default middle pack
        
        if (userStats) {
          if (userStats.poolsWon > 0) {
            percentile = 90; // Top 10%
          } else if (userStats.totalPoints > 0) {
            percentile = 75; // Top 25%
          }
        }

        const calculatedRank = Math.max(1, Math.floor(participantSet.size * (1 - percentile / 100)));

        if (isMounted) {
          setGlobalPrizePot(totalPrize);
          setTotalParticipants(participantSet.size);
          setGlobalRank(calculatedRank);
        }
      } catch (err) {
        console.error('Failed to fetch global standings', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchGlobalStats();

    return () => { isMounted = false; };
  }, [poolType, user.historicalStats]);

  if (isLoading) {
    return (
      <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 h-32 flex items-center justify-center animate-pulse">
        <Activity className="text-slate-700 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 relative overflow-hidden backdrop-blur-md">
      {/* Decorative background glow */}
      <div className="absolute -right-16 -top-16 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="flex items-center gap-3 mb-6 relative z-10">
        <div className="p-2.5 bg-indigo-500/20 text-indigo-400 rounded-xl">
          <Trophy size={20} />
        </div>
        <div>
          <h3 className="text-white font-extrabold text-sm uppercase tracking-widest">{poolTypeName}</h3>
          <p className="text-slate-400 text-[11px] font-semibold">Global Platform Leaderboard</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 relative z-10">
        <div className="bg-slate-950/40 p-3 rounded-2xl border border-slate-800/50">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-extrabold uppercase mb-1">
            <Crown size={12} className="text-amber-500" /> Global Rank
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-black text-white">
              {globalRank ? `#${globalRank}` : 'N/A'}
            </span>
            <span className="text-slate-500 text-xs font-bold">/ {totalParticipants}</span>
          </div>
        </div>

        <div className="bg-slate-950/40 p-3 rounded-2xl border border-slate-800/50">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-extrabold uppercase mb-1">
            <TrendingUp size={12} className="text-emerald-500" /> Platform Pot
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-black text-emerald-400">
              ${globalPrizePot.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="bg-slate-950/40 p-3 rounded-2xl border border-slate-800/50">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-extrabold uppercase mb-1">
            <Users size={12} className="text-blue-500" /> Active Players
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-black text-white">
              {totalParticipants.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
