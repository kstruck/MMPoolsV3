import React, { useState, useEffect } from 'react';
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
        const participantSet = new Set<string>();

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
      <div className="bg-card border border-line rounded-3xl p-6 h-32 flex items-center justify-center animate-pulse">
        <Activity className="text-faint animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-card border border-line rounded-3xl p-6 relative overflow-hidden shadow-card">
      {/* Decorative background glow */}
      <div className="absolute -right-16 -top-16 w-40 h-40 bg-gold-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="flex items-center gap-3 mb-6 relative z-10">
        <div className="p-2.5 bg-gold-500/15 text-gold-700 dark:text-gold-400 rounded-xl">
          <Trophy size={20} />
        </div>
        <div>
          <h3 className="text-[color:var(--text)] font-display font-bold text-sm uppercase tracking-[0.16em]">{poolTypeName}</h3>
          <p className="text-muted text-[11px] font-body font-semibold">Global Platform Leaderboard</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 relative z-10">
        <div className="bg-surface p-3 rounded-2xl border border-line">
          <div className="flex items-center gap-1.5 text-[10px] text-muted font-display font-bold uppercase tracking-[0.08em] mb-1">
            <Crown size={12} className="text-gold-600 dark:text-gold-400" /> Global Rank
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-display font-bold text-[color:var(--text)] num">
              {globalRank ? `#${globalRank}` : 'N/A'}
            </span>
            <span className="text-muted text-xs font-bold num">/ {totalParticipants}</span>
          </div>
        </div>

        <div className="bg-surface p-3 rounded-2xl border border-line">
          <div className="flex items-center gap-1.5 text-[10px] text-muted font-display font-bold uppercase tracking-[0.08em] mb-1">
            <TrendingUp size={12} className="text-gold-600 dark:text-gold-400" /> Platform Pot
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-display font-bold text-gold-700 dark:text-gold-400 num">
              ${globalPrizePot.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="bg-surface p-3 rounded-2xl border border-line">
          <div className="flex items-center gap-1.5 text-[10px] text-muted font-display font-bold uppercase tracking-[0.08em] mb-1">
            <Users size={12} className="text-navy-700 dark:text-[#9FB0CC]" /> Active Players
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-display font-bold text-[color:var(--text)] num">
              {totalParticipants.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
