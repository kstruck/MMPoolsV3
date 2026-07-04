import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, DollarSign, Users, Activity, Settings, ArrowRight } from 'lucide-react';
import type { User, Pool } from '../../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Button } from '../ui';

interface GlobalCommissionerDashboardProps {
  user: User;
  managedPools: Pool[];
}

export const GlobalCommissionerDashboard: React.FC<GlobalCommissionerDashboardProps> = ({ user, managedPools }) => {
  const navigate = useNavigate();

  const mStats = user.managerStats || {
    poolsManaged: 0,
    totalRevenue: 0,
    totalPayouts: 0,
    totalParticipants: 0,
  };

  const activePools = managedPools.filter(p => (p as any).status !== 'COMPLETED' && (p as any).status !== 'archived');

  const poolRevenueData = useMemo(() => {
    return managedPools.slice(0, 5).map(p => {
      const fee = (p as any).settings?.entryFee || (p as any).costPerSquare || 0;
      const participants = (p as any).entryCount || p.participantIds?.length || 0;
      return {
        name: p.name.substring(0, 15) + (p.name.length > 15 ? '...' : ''),
        revenue: fee * participants,
      };
    });
  }, [managedPools]);

  return (
    <div className="space-y-8 animate-in fade-in duration-300">

      {/* Lifetime Manager Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-line rounded-2xl p-4 shadow-card flex items-center gap-4 relative overflow-hidden group hover:border-gold-500/40 transition-all duration-150">
            <div className="w-10 h-10 rounded-xl bg-gold-500/10 border border-gold-500/30 text-gold-700 dark:text-gold-400 flex items-center justify-center group-hover:scale-105 transition-all">
                <Crown size={20} />
            </div>
            <div>
                <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] leading-none mb-1.5">Lifetime Pools</p>
                <p className="text-2xl font-display font-bold text-[color:var(--text)] num leading-none">{mStats.poolsManaged || managedPools.length}</p>
            </div>
        </div>
        <div className="bg-card border border-line rounded-2xl p-4 shadow-card flex items-center gap-4 relative overflow-hidden group hover:border-gold-500/40 transition-all duration-150">
            <div className="w-10 h-10 rounded-xl bg-gold-500/10 border border-gold-500/30 text-gold-700 dark:text-gold-400 flex items-center justify-center group-hover:scale-105 transition-all">
                <DollarSign size={20} />
            </div>
            <div>
                <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] leading-none mb-1.5">Total Revenue</p>
                <p className="text-2xl font-display font-bold text-gold-700 dark:text-gold-400 num leading-none">${mStats.totalRevenue.toLocaleString()}</p>
            </div>
        </div>
        <div className="bg-card border border-line rounded-2xl p-4 shadow-card flex items-center gap-4 relative overflow-hidden group hover:border-gold-500/40 transition-all duration-150">
            <div className="w-10 h-10 rounded-xl bg-navy-600/10 dark:bg-navy-600/30 border border-navy-600/20 text-navy-700 dark:text-[#9FB0CC] flex items-center justify-center group-hover:scale-105 transition-all">
                <Users size={20} />
            </div>
            <div>
                <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] leading-none mb-1.5">Participants</p>
                <p className="text-2xl font-display font-bold text-[color:var(--text)] num leading-none">{mStats.totalParticipants.toLocaleString()}</p>
            </div>
        </div>
        <div className="bg-card border border-line rounded-2xl p-4 shadow-card flex items-center gap-4 relative overflow-hidden group hover:border-gold-500/40 transition-all duration-150">
            <div className="w-10 h-10 rounded-xl bg-navy-600/10 dark:bg-navy-600/30 border border-navy-600/20 text-navy-700 dark:text-[#9FB0CC] flex items-center justify-center group-hover:scale-105 transition-all">
                <Activity size={20} />
            </div>
            <div>
                <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] leading-none mb-1.5">Total Payouts</p>
                <p className="text-2xl font-display font-bold text-[color:var(--text)] num leading-none">${mStats.totalPayouts.toLocaleString()}</p>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Pools List */}
        <div className="lg:col-span-2 bg-card border border-line rounded-3xl p-6 shadow-card">
          <h3 className="text-lg font-display font-bold uppercase text-[color:var(--text)] mb-4">Active Managed Pools</h3>
          {activePools.length === 0 ? (
            <div className="bg-surface p-8 rounded-2xl border border-dashed border-line text-center">
              <p className="text-muted font-body font-bold mb-4">You are not currently managing any active pools.</p>
              <Button variant="primary" onClick={() => navigate('/create-pool')}>Create a New Pool</Button>
            </div>
          ) : (
            <div className="space-y-3">
              {activePools.map(pool => (
                <div key={pool.id} className="bg-surface border border-line rounded-2xl p-4 flex items-center justify-between group hover:border-gold-500/40 transition-colors">
                  <div>
                    <h4 className="text-[color:var(--text)] font-display font-bold uppercase">{pool.name}</h4>
                    <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em]">{pool.type.replace('_', ' ')} • <span className="num">{(pool.participantIds?.length || 0)}</span> Players</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigate(`/admin/${pool.id}`)}
                      className="bg-card border border-line hover:border-navy-600 text-muted hover:text-[color:var(--text)] p-2 rounded-lg transition-colors"
                      title="Admin Dashboard"
                    >
                      <Settings size={16} />
                    </button>
                    <button
                      onClick={() => navigate(`/pool/${(pool as any).slug || pool.id}`)}
                      className="bg-navy-800 hover:bg-navy-700 text-white p-2 rounded-lg transition-colors flex items-center justify-center gap-1"
                      title="View Pool"
                    >
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Revenue Chart */}
        <div className="bg-card border border-line rounded-3xl p-6 shadow-card flex flex-col">
          <h3 className="text-sm font-display font-bold text-muted uppercase tracking-[0.16em] mb-4">Top Pools Revenue</h3>
          <div className="flex-1 min-h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={poolRevenueData} layout="vertical" margin={{ top: 0, right: 0, left: 20, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fill: '#7C8698', fontSize: 10, fontWeight: 700}} width={80} />
                <Tooltip
                  cursor={{fill: 'rgba(201,168,103,0.08)'}}
                  contentStyle={{ backgroundColor: '#0E1C34', borderColor: 'rgba(230,206,150,0.16)', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}
                  itemStyle={{ color: '#D9BC80' }}
                  formatter={(value: any) => [`$${Number(value).toLocaleString()}`, 'Revenue']}
                />
                <Bar dataKey="revenue" radius={[0, 4, 4, 0]} barSize={20}>
                  {poolRevenueData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={index === 0 ? '#C9A867' : '#24507F'} opacity={0.9} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
