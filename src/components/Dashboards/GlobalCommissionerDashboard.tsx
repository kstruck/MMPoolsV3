import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, DollarSign, Users, Activity, Settings, ArrowRight } from 'lucide-react';
import type { User, Pool, PoolType } from '../../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

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

  const activePools = managedPools.filter(p => p.status !== 'COMPLETED' && (p as any).status !== 'archived');

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
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 flex items-center gap-4 relative overflow-hidden group hover:border-amber-500/30 transition-all duration-300">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center shadow-lg group-hover:scale-105 transition-all">
                <Crown size={20} />
            </div>
            <div>
                <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest leading-none mb-1.5">Lifetime Pools</p>
                <p className="text-2xl font-black text-white font-mono leading-none">{mStats.poolsManaged || managedPools.length}</p>
            </div>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 flex items-center gap-4 relative overflow-hidden group hover:border-emerald-500/30 transition-all duration-300">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shadow-lg group-hover:scale-105 transition-all">
                <DollarSign size={20} />
            </div>
            <div>
                <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest leading-none mb-1.5">Total Revenue</p>
                <p className="text-2xl font-black text-white font-mono leading-none">${mStats.totalRevenue.toLocaleString()}</p>
            </div>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 flex items-center gap-4 relative overflow-hidden group hover:border-blue-500/30 transition-all duration-300">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center shadow-lg group-hover:scale-105 transition-all">
                <Users size={20} />
            </div>
            <div>
                <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest leading-none mb-1.5">Participants</p>
                <p className="text-2xl font-black text-white font-mono leading-none">{mStats.totalParticipants.toLocaleString()}</p>
            </div>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 flex items-center gap-4 relative overflow-hidden group hover:border-rose-500/30 transition-all duration-300">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center shadow-lg group-hover:scale-105 transition-all">
                <Activity size={20} />
            </div>
            <div>
                <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest leading-none mb-1.5">Total Payouts</p>
                <p className="text-2xl font-black text-white font-mono leading-none">${mStats.totalPayouts.toLocaleString()}</p>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Pools List */}
        <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800 rounded-3xl p-6">
          <h3 className="text-lg font-black text-white mb-4">Active Managed Pools</h3>
          {activePools.length === 0 ? (
            <div className="bg-slate-950/40 p-8 rounded-2xl border border-dashed border-slate-800 text-center">
              <p className="text-slate-500 font-bold mb-4">You are not currently managing any active pools.</p>
              <button onClick={() => navigate('/create-pool')} className="bg-orange-500 hover:bg-orange-400 text-white font-black px-6 py-2 rounded-xl">Create a New Pool</button>
            </div>
          ) : (
            <div className="space-y-3">
              {activePools.map(pool => (
                <div key={pool.id} className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex items-center justify-between group hover:border-slate-600 transition-colors">
                  <div>
                    <h4 className="text-white font-bold">{pool.name}</h4>
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">{pool.type.replace('_', ' ')} • {(pool.participantIds?.length || 0)} Players</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => navigate(`/admin/${pool.id}`)}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-2 rounded-lg transition-colors"
                      title="Admin Dashboard"
                    >
                      <Settings size={16} />
                    </button>
                    <button 
                      onClick={() => navigate(`/pool/${(pool as any).slug || pool.id}`)}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded-lg transition-colors flex items-center justify-center gap-1"
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
        <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 flex flex-col">
          <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-4">Top Pools Revenue</h3>
          <div className="flex-1 min-h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={poolRevenueData} layout="vertical" margin={{ top: 0, right: 0, left: 20, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 700}} width={80} />
                <Tooltip 
                  cursor={{fill: 'rgba(255,255,255,0.05)'}} 
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}
                  itemStyle={{ color: '#34d399' }}
                  formatter={(value: number) => [`$${value.toLocaleString()}`, 'Revenue']}
                />
                <Bar dataKey="revenue" radius={[0, 4, 4, 0]} barSize={20}>
                  {poolRevenueData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index === 0 ? '#10b981' : '#3b82f6'} opacity={0.8} />
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
