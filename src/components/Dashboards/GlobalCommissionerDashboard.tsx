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

export const GlobalCommissionerDashboard: React.FC<GlobalCommissionerDashboardProps> = ({ managedPools }) => {
  const navigate = useNavigate();

  const activePools = managedPools.filter(p => (p as any).status !== 'COMPLETED' && (p as any).status !== 'archived');

  // Phase 1: compute honest, provable numbers client-side from the pools we already have.
  // "Guest" sentinel is excluded from participant counts. Dues Collected / Payouts require
  // per-entry paid state + winners and land with the Phase 2 aggregate function; shown as "—".
  const realParticipants = (p: Pool) => (p.participantIds || []).filter(id => id && id !== 'guest');
  const feeOf = (p: Pool) => (p as any).settings?.entryFee || (p as any).costPerSquare || 0;

  const stats = useMemo(() => {
    let participants = 0;
    let duesExpected = 0;
    for (const p of managedPools) {
      const n = realParticipants(p).length;
      participants += n;
      duesExpected += feeOf(p) * n;
    }
    return { poolsManaged: managedPools.length, participants, duesExpected };
  }, [managedPools]);

  const duesByPool = useMemo(() => {
    return managedPools
      .map(p => ({
        name: p.name.substring(0, 15) + (p.name.length > 15 ? '...' : ''),
        dues: feeOf(p) * realParticipants(p).length,
      }))
      .filter(d => d.dues > 0)
      .sort((a, b) => b.dues - a.dues)
      .slice(0, 5);
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
                <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] leading-none mb-1.5">Pools Managed</p>
                <p className="text-2xl font-display font-bold text-[color:var(--text)] num leading-none">{stats.poolsManaged}</p>
            </div>
        </div>
        <div className="bg-card border border-line rounded-2xl p-4 shadow-card flex items-center gap-4 relative overflow-hidden group hover:border-gold-500/40 transition-all duration-150">
            <div className="w-10 h-10 rounded-xl bg-navy-600/10 dark:bg-navy-600/30 border border-navy-600/20 text-navy-700 dark:text-[#9FB0CC] flex items-center justify-center group-hover:scale-105 transition-all">
                <Users size={20} />
            </div>
            <div>
                <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] leading-none mb-1.5">Total Participants</p>
                <p className="text-2xl font-display font-bold text-[color:var(--text)] num leading-none">{stats.participants.toLocaleString()}</p>
            </div>
        </div>
        <div className="bg-card border border-line rounded-2xl p-4 shadow-card flex items-center gap-4 relative overflow-hidden group hover:border-gold-500/40 transition-all duration-150">
            <div className="w-10 h-10 rounded-xl bg-gold-500/10 border border-gold-500/30 text-gold-700 dark:text-gold-400 flex items-center justify-center group-hover:scale-105 transition-all">
                <DollarSign size={20} />
            </div>
            <div>
                <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] leading-none mb-1.5">Dues Expected</p>
                <p className="text-2xl font-display font-bold text-gold-700 dark:text-gold-400 num leading-none">${stats.duesExpected.toLocaleString()}</p>
            </div>
        </div>
        <div className="bg-card border border-line rounded-2xl p-4 shadow-card flex items-center gap-4 relative overflow-hidden group hover:border-gold-500/40 transition-all duration-150">
            <div className="w-10 h-10 rounded-xl bg-navy-600/10 dark:bg-navy-600/30 border border-navy-600/20 text-navy-700 dark:text-[#9FB0CC] flex items-center justify-center group-hover:scale-105 transition-all">
                <Activity size={20} />
            </div>
            <div>
                <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] leading-none mb-1.5">Dues Collected</p>
                <p className="text-2xl font-display font-bold text-faint num leading-none" title="Live once the payments roster sync ships">—</p>
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

        {/* Dues Expected by Pool — real fee × real participant count */}
        <div className="bg-card border border-line rounded-3xl p-6 shadow-card flex flex-col">
          <h3 className="text-sm font-display font-bold text-muted uppercase tracking-[0.16em] mb-4">Dues Expected by Pool</h3>
          {duesByPool.length === 0 ? (
            <div className="flex-1 flex items-center justify-center min-h-[160px] text-center">
              <p className="text-xs text-faint font-body max-w-[220px]">No dues to show yet — pools with an entry fee and joined players will appear here.</p>
            </div>
          ) : (
            <div className="flex-1 min-h-[160px]" style={{ height: Math.max(160, duesByPool.length * 44) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={duesByPool} layout="vertical" margin={{ top: 0, right: 0, left: 20, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fill: '#7C8698', fontSize: 10, fontWeight: 700}} width={80} />
                  <Tooltip
                    cursor={{fill: 'rgba(201,168,103,0.08)'}}
                    contentStyle={{ backgroundColor: '#0E1C34', borderColor: 'rgba(230,206,150,0.16)', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}
                    itemStyle={{ color: '#D9BC80' }}
                    formatter={(value: any) => [`$${Number(value).toLocaleString()}`, 'Dues Expected']}
                  />
                  <Bar dataKey="dues" radius={[0, 4, 4, 0]} barSize={20}>
                    {duesByPool.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={index === 0 ? '#C9A867' : '#24507F'} opacity={0.9} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
