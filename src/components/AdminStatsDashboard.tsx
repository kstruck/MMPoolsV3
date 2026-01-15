import React, { useMemo, useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import type { Pool, User } from '../types';
import { Users, Database, Clock, Calendar, RefreshCw } from 'lucide-react';
import { dbService } from '../services/dbService';

interface AdminStatsDashboardProps {
    pools: Pool[];
    users: User[];
}

// COLORS
const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

const getTimestamp = (createdAt: any): number => {
    if (!createdAt) return 0;
    if (typeof createdAt === 'number') return createdAt;
    if (typeof createdAt?.toDate === 'function') return createdAt.toDate().getTime();
    if (createdAt?.seconds) return createdAt.seconds * 1000;
    return new Date(createdAt).getTime() || 0;
};

export const AdminStatsDashboard: React.FC<AdminStatsDashboardProps> = ({ pools, users }) => {
    const [isRecalculating, setIsRecalculating] = useState(false);

    const handleRecalculate = async () => {
        if (!confirm("Recalculate Global Stats? This will scan all locked pools and update the global totals.")) return;
        setIsRecalculating(true);
        try {
            const result = await dbService.recalculateGlobalStats();
            if (result.success) {
                alert(`Success! Updated Stats:\nPrizes: $${result.totalPrizes}\nDonated: $${result.totalDonated}`);
            } else {
                alert(`Failed: ${result.message}`);
            }
        } catch (error: any) {
            console.error("Recalc failed", error);
            alert(`Error: ${error.message}`);
        } finally {
            setIsRecalculating(false);
        }
    };

    // --- 1. DATA PROCESSING ---

    // A. Activity by Hour (Aggregated All Time)
    const activityByHour = useMemo(() => {
        const hours = Array(24).fill(0).map((_, i) => ({ hour: i, pools: 0, users: 0 }));

        pools.forEach(p => {
            const ts = getTimestamp(p.createdAt);
            if (ts) {
                const h = new Date(ts).getHours();
                hours[h].pools++;
            }
        });

        users.forEach(u => {
            const ts = getTimestamp(u.createdAt);
            if (ts) {
                const h = new Date(ts).getHours();
                hours[h].users++;
            }
        });

        return hours.map(h => ({
            ...h,
            label: `${h.hour}:00`,
            total: h.pools + h.users
        }));
    }, [pools, users]);

    // B. Growth (Last 30 Days)
    const growthLast30Days = useMemo(() => {
        const days = new Map<string, { date: string, pools: 0, users: 0 }>();
        const now = new Date();

        // Init last 30 days
        for (let i = 29; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().split('T')[0];
            days.set(key, { date: key.substring(5), pools: 0, users: 0 }); // MM-DD
        }

        pools.forEach(p => {
            const ts = getTimestamp(p.createdAt);
            if (ts) {
                const d = new Date(ts).toISOString().split('T')[0];
                if (days.has(d)) {
                    const entry = days.get(d)!;
                    entry.pools++;
                }
            }
        });

        users.forEach(u => {
            const ts = getTimestamp(u.createdAt);
            if (ts) {
                const d = new Date(ts).toISOString().split('T')[0];
                if (days.has(d)) {
                    const entry = days.get(d)!;
                    entry.users++;
                }
            }
        });

        return Array.from(days.values());
    }, [pools, users]);

    // C. Pool Types Distribution
    const poolTypeStats = useMemo(() => {
        const stats: Record<string, number> = {};
        pools.forEach(p => {
            const type = p.type || 'SQUARES'; // Default
            stats[type] = (stats[type] || 0) + 1;
        });
        return Object.entries(stats).map(([name, value]) => ({ name, value }));
    }, [pools]);

    /* 
    unused for now
    // D. User Provider Stats
    const userProviderStats = useMemo(() => {
        const stats: Record<string, number> = {};
        users.forEach(u => {
            // Normalize provider/method
            let method = u.registrationMethod || u.provider || 'unknown';
            if (method === 'password') method = 'email';
            stats[method] = (stats[method] || 0) + 1;
        });
        return Object.entries(stats).map(([name, value]) => ({ name, value }));
    }, [users]);
    */

    // E. Monthly Trends (Last 12 Months)
    const monthlyTrends = useMemo(() => {
        const months = new Map<string, { month: string, pools: 0, users: 0 }>();
        const now = new Date();

        // Init last 12 months
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            months.set(key, { month: key, pools: 0, users: 0 });
        }

        pools.forEach(p => {
            const ts = getTimestamp(p.createdAt);
            if (ts) {
                const d = new Date(ts);
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                if (months.has(key)) months.get(key)!.pools++;
            }
        });

        users.forEach(u => {
            const ts = getTimestamp(u.createdAt);
            if (ts) {
                const d = new Date(ts);
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                if (months.has(key)) months.get(key)!.users++;
            }
        });

        return Array.from(months.values());
    }, [pools, users]);

    return (
        <div className="space-y-8 animate-in fade-in duration-500">

            {/* KPIS */}
            <div className="flex justify-end mb-4">
                <button
                    onClick={handleRecalculate}
                    disabled={isRecalculating}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold transition-colors disabled:opacity-50"
                >
                    <RefreshCw size={16} className={isRecalculating ? 'animate-spin' : ''} />
                    {isRecalculating ? 'Recalculating...' : 'Recalculate Global Stats'}
                </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400"><Database size={20} /></div>
                        <span className="text-slate-400 text-xs font-bold uppercase">Avg Pools/Day (30d)</span>
                    </div>
                    <p className="text-2xl font-black text-white">
                        {(growthLast30Days.reduce((acc, curr) => acc + curr.pools, 0) / 30).toFixed(1)}
                    </p>
                </div>
                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-400"><Users size={20} /></div>
                        <span className="text-slate-400 text-xs font-bold uppercase">Avg Users/Day (30d)</span>
                    </div>
                    <p className="text-2xl font-black text-white">
                        {(growthLast30Days.reduce((acc, curr) => acc + curr.users, 0) / 30).toFixed(1)}
                    </p>
                </div>
                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-amber-500/20 rounded-lg text-amber-400"><Clock size={20} /></div>
                        <span className="text-slate-400 text-xs font-bold uppercase">Peak Hour</span>
                    </div>
                    <p className="text-2xl font-black text-white">
                        {activityByHour.reduce((max, curr) => curr.total > max.total ? curr : max, { label: '-', total: -1 }).label}
                    </p>
                </div>
                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-rose-500/20 rounded-lg text-rose-400"><Calendar size={20} /></div>
                        <span className="text-slate-400 text-xs font-bold uppercase">Busiest Month</span>
                    </div>
                    <p className="text-2xl font-black text-white">
                        {monthlyTrends.reduce((max, curr) => (curr.pools + curr.users) > (max.pools + max.users) ? curr : max, { month: '-', pools: 0, users: 0 }).month}
                    </p>
                </div>
            </div>

            {/* ROW 1: Growth Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                        <Calendar size={18} className="text-indigo-400" /> 30-Day Growth
                    </h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={growthLast30Days}>
                                <defs>
                                    <linearGradient id="colorPools" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#82ca9d" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#82ca9d" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
                                    itemStyle={{ color: '#f8fafc' }}
                                />
                                <Legend />
                                <Area type="monotone" dataKey="pools" stroke="#8884d8" fillOpacity={1} fill="url(#colorPools)" name="New Pools" />
                                <Area type="monotone" dataKey="users" stroke="#82ca9d" fillOpacity={1} fill="url(#colorUsers)" name="New Users" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                        <Clock size={18} className="text-amber-400" /> Activity by Hour of Day
                    </h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={activityByHour}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 10 }} interval={2} />
                                <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
                                    cursor={{ fill: '#334155', opacity: 0.4 }}
                                />
                                <Legend />
                                <Bar dataKey="pools" stackId="a" fill="#8884d8" name="Pools Created" />
                                <Bar dataKey="users" stackId="a" fill="#82ca9d" name="Users Joined" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* ROW 2: Distributions */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Monthly Trends */}
                <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-lg font-bold text-white mb-6">Monthly Trends (L12M)</h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={monthlyTrends}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                <XAxis dataKey="month" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
                                />
                                <Legend />
                                <Bar dataKey="pools" fill="#8884d8" name="Pools" />
                                <Bar dataKey="users" fill="#82ca9d" name="Users" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Pool Types */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-lg font-bold text-white mb-6">Pool Types</h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={poolTypeStats}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={false}
                                    outerRadius={80}
                                    fill="#8884d8"
                                    dataKey="value"
                                    label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                                >
                                    {poolTypeStats.map((_entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
};
