import { logger } from '../utils/logger';
import React, { useMemo, useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import type { Pool, User } from '../types';
import { Users, Database, Clock, Calendar, RefreshCw } from 'lucide-react';
import { dbService } from '../services/dbService';
import { Button } from './ui';
import { useToast } from './ui/Toast';
import { getUserMessage } from '../utils/errorMessages';

interface AdminStatsDashboardProps {
    pools: Pool[];
    users: User[];
}

// COLORS (brand palette: gold / navy / success / deep navy)
const COLORS = ['#C9A867', '#24507F', '#0F7B4A', '#1A3B62', '#C9A867', '#24507F', '#0F7B4A', '#1A3B62'];

const getTimestamp = (createdAt: any): number => {
    if (!createdAt) return 0;
    if (typeof createdAt === 'number') return createdAt;
    if (typeof createdAt?.toDate === 'function') return createdAt.toDate().getTime();
    if (createdAt?.seconds) return createdAt.seconds * 1000;
    return new Date(createdAt).getTime() || 0;
};

export const AdminStatsDashboard: React.FC<AdminStatsDashboardProps> = ({ pools, users }) => {
    const [isRecalculating, setIsRecalculating] = useState(false);
    const toast = useToast();

    const handleRecalculate = async () => {
        const ok = await toast.confirm({ title: 'Recalculate Global Stats?', message: 'This will scan all locked pools and update the global totals.', confirmLabel: 'Recalculate' });
        if (!ok) return;
        setIsRecalculating(true);
        try {
            const result = await dbService.recalculateGlobalStats();
            if (result.success) {
                toast.success(`Success! Updated Stats:\nPrizes: $${result.totalPrizes}\nDonated: $${result.totalDonated}`);
            } else {
                toast.error(`Failed: ${result.message}`);
            }
        } catch (error: any) {
            logger.error("Recalc failed", error);
            toast.error(getUserMessage(error, 'Failed to recalculate stats. Please try again.'));
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
                <Button
                    onClick={handleRecalculate}
                    disabled={isRecalculating}
                    size="sm"
                >
                    <RefreshCw size={16} className={isRecalculating ? 'animate-spin' : ''} />
                    {isRecalculating ? 'Recalculating...' : 'Recalculate Global Stats'}
                </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-card p-4 rounded-xl border border-line shadow-card">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-gold-500/10 rounded-lg text-gold-600 dark:text-gold-400"><Database size={20} /></div>
                        <span className="text-muted text-xs font-display font-bold uppercase tracking-[0.08em]">Avg Pools/Day (30d)</span>
                    </div>
                    <p className="text-2xl font-display font-bold text-navy-800 dark:text-gold-400 num">
                        {(growthLast30Days.reduce((acc, curr) => acc + curr.pools, 0) / 30).toFixed(1)}
                    </p>
                </div>
                <div className="bg-card p-4 rounded-xl border border-line shadow-card">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-gold-500/10 rounded-lg text-gold-600 dark:text-gold-400"><Users size={20} /></div>
                        <span className="text-muted text-xs font-display font-bold uppercase tracking-[0.08em]">Avg Users/Day (30d)</span>
                    </div>
                    <p className="text-2xl font-display font-bold text-navy-800 dark:text-gold-400 num">
                        {(growthLast30Days.reduce((acc, curr) => acc + curr.users, 0) / 30).toFixed(1)}
                    </p>
                </div>
                <div className="bg-card p-4 rounded-xl border border-line shadow-card">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-gold-500/10 rounded-lg text-gold-600 dark:text-gold-400"><Clock size={20} /></div>
                        <span className="text-muted text-xs font-display font-bold uppercase tracking-[0.08em]">Peak Hour</span>
                    </div>
                    <p className="text-2xl font-display font-bold text-navy-800 dark:text-gold-400 num">
                        {activityByHour.reduce((max, curr) => curr.total > max.total ? curr : max, { label: '-', total: -1 }).label}
                    </p>
                </div>
                <div className="bg-card p-4 rounded-xl border border-line shadow-card">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-gold-500/10 rounded-lg text-gold-600 dark:text-gold-400"><Calendar size={20} /></div>
                        <span className="text-muted text-xs font-display font-bold uppercase tracking-[0.08em]">Busiest Month</span>
                    </div>
                    <p className="text-2xl font-display font-bold text-navy-800 dark:text-gold-400 num">
                        {monthlyTrends.reduce((max, curr) => (curr.pools + curr.users) > (max.pools + max.users) ? curr : max, { month: '-', pools: 0, users: 0 }).month}
                    </p>
                </div>
            </div>

            {/* ROW 1: Growth Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                    <h3 className="text-lg font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)] mb-6 flex items-center gap-2">
                        <Calendar size={18} className="text-gold-500" /> 30-Day Growth
                    </h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={growthLast30Days}>
                                <defs>
                                    <linearGradient id="colorPools" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#24507F" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#24507F" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#C9A867" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#C9A867" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(159,176,204,0.25)" />
                                <XAxis dataKey="date" stroke="#9FB0CC" tick={{ fontSize: 12 }} />
                                <YAxis stroke="#9FB0CC" tick={{ fontSize: 12 }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1A3B62', borderColor: 'rgba(230,206,150,0.16)', color: '#EDF1F8' }}
                                    itemStyle={{ color: '#EDF1F8' }}
                                />
                                <Legend />
                                <Area type="monotone" dataKey="pools" stroke="#24507F" fillOpacity={1} fill="url(#colorPools)" name="New Pools" />
                                <Area type="monotone" dataKey="users" stroke="#C9A867" fillOpacity={1} fill="url(#colorUsers)" name="New Users" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                    <h3 className="text-lg font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)] mb-6 flex items-center gap-2">
                        <Clock size={18} className="text-gold-500" /> Activity by Hour of Day
                    </h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={activityByHour}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(159,176,204,0.25)" />
                                <XAxis dataKey="label" stroke="#9FB0CC" tick={{ fontSize: 10 }} interval={2} />
                                <YAxis stroke="#9FB0CC" tick={{ fontSize: 12 }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1A3B62', borderColor: 'rgba(230,206,150,0.16)', color: '#EDF1F8' }}
                                    cursor={{ fill: '#9FB0CC', opacity: 0.2 }}
                                />
                                <Legend />
                                <Bar dataKey="pools" stackId="a" fill="#24507F" name="Pools Created" />
                                <Bar dataKey="users" stackId="a" fill="#C9A867" name="Users Joined" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* ROW 2: Distributions */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Monthly Trends */}
                <div className="lg:col-span-2 bg-card border border-line rounded-xl p-6 shadow-card">
                    <h3 className="text-lg font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)] mb-6">Monthly Trends (L12M)</h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={monthlyTrends}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(159,176,204,0.25)" />
                                <XAxis dataKey="month" stroke="#9FB0CC" tick={{ fontSize: 12 }} />
                                <YAxis stroke="#9FB0CC" tick={{ fontSize: 12 }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1A3B62', borderColor: 'rgba(230,206,150,0.16)', color: '#EDF1F8' }}
                                />
                                <Legend />
                                <Bar dataKey="pools" fill="#24507F" name="Pools" />
                                <Bar dataKey="users" fill="#C9A867" name="Users" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Pool Types */}
                <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                    <h3 className="text-lg font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)] mb-6">Pool Types</h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={poolTypeStats}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={false}
                                    outerRadius={80}
                                    fill="#24507F"
                                    dataKey="value"
                                    label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                                >
                                    {poolTypeStats.map((_entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1A3B62', borderColor: 'rgba(230,206,150,0.16)', color: '#EDF1F8' }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
};
