import React, { useState, useCallback } from 'react';
import type { GlobalStats } from '../services/dbService';
import {
  Trophy,
  Users,
  Coins,
  Activity,
  Server,
  Cpu,
  Database,
  RefreshCw,
  Heart,
  Mail,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { useToast } from './ui/Toast';
import { getUserMessage } from '../utils/errorMessages';

const BRAND = {
  emeraldGlow: 'rgba(16, 185, 129, 0.15)',
};

interface HealthCheck {
  label: string;
  ok: boolean;
  latencyMs: number;
  detail: string;
}
interface HealthSnapshot {
  at: number;
  checks: { espn: HealthCheck; firestore: HealthCheck; email: HealthCheck; functions: HealthCheck };
}

const CHECK_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  espn: Server,
  firestore: Database,
  functions: Cpu,
  email: Mail,
};

interface SuperAdminBentoDashboardProps {
  stats: GlobalStats | null;
}

export const SuperAdminBentoDashboard: React.FC<SuperAdminBentoDashboardProps> = ({ stats }) => {
  const toast = useToast();
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [isProbing, setIsProbing] = useState(false);

  const runHealthCheck = useCallback(async () => {
    setIsProbing(true);
    setHealthError(null);
    try {
      const fn = httpsCallable<void, HealthSnapshot>(functions, 'getAdminHealthSnapshot');
      const res = await fn();
      setHealth(res.data);
    } catch (err) {
      setHealthError(getUserMessage(err));
      toast.error('Health check failed. See the status card for detail.');
    } finally {
      setIsProbing(false);
    }
  }, [toast]);

  const checkEntries = health
    ? (Object.entries(health.checks) as [string, HealthCheck][])
    : [];
  const allOk = checkEntries.length > 0 && checkEntries.every(([, c]) => c.ok);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-8 items-stretch p-4 md:p-8 bg-slate-950 min-h-screen text-slate-100 font-sans">

      {/* 1. Platform Ledger — real global stats (live via parent subscription). */}
      <div
        className="xl:col-span-2 bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 shadow-2xl relative overflow-hidden transition-all duration-300 hover:border-slate-700/80 flex flex-col justify-between"
        style={{ boxShadow: `inset 0 0 20px rgba(59, 130, 246, 0.05), 0 10px 40px rgba(0,0,0,0.4)` }}
      >
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Platform Ledger</h3>
              <p className="text-[10px] text-slate-500 mt-0.5 font-bold uppercase">Global Administrative Accounts</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-2xl relative overflow-hidden group hover:border-blue-500/35 transition-colors">
              <div className="absolute top-3 right-3 p-1.5 rounded-lg bg-blue-500/10 text-blue-400"><Database size={16} /></div>
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Active Pools</span>
              <span className="text-2xl font-black text-white font-mono leading-none">{stats?.totalPools || 0}</span>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-2xl relative overflow-hidden group hover:border-emerald-500/35 transition-colors">
              <div className="absolute top-3 right-3 p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400"><Users size={16} /></div>
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Total Users</span>
              <span className="text-2xl font-black text-white font-mono leading-none">{stats?.totalUsers || 0}</span>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-2xl relative overflow-hidden group hover:border-amber-500/35 transition-colors">
              <div className="absolute top-3 right-3 p-1.5 rounded-lg bg-amber-500/10 text-amber-400"><Trophy size={16} /></div>
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Squares Sold</span>
              <span className="text-2xl font-black text-white font-mono leading-none">{stats?.totalSquaresSold || 0}</span>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-2xl relative overflow-hidden group hover:border-purple-500/35 transition-colors">
              <div className="absolute top-3 right-3 p-1.5 rounded-lg bg-purple-500/10 text-purple-400"><Coins size={16} /></div>
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Total Revenue</span>
              <span className="text-2xl font-black text-white font-mono leading-none">${(stats?.totalRevenue || 0).toLocaleString()}</span>
            </div>
          </div>

          <div className="bg-gradient-to-r from-emerald-950/30 to-slate-950/60 border border-emerald-500/20 p-5 rounded-2xl flex items-center justify-between"
               style={{ boxShadow: `0 4px 20px ${BRAND.emeraldGlow}` }}>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-500/25 border border-emerald-500/40 rounded-xl text-emerald-400"><Heart size={20} className="fill-current" /></div>
              <div>
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">Charity Funds Raised</span>
                <span className="text-xl font-black text-emerald-400 font-mono">${(stats?.totalDonated || 0).toLocaleString()}</span>
              </div>
            </div>
            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full uppercase tracking-wider">100% Free</span>
          </div>
        </div>

        <div className="mt-8 pt-4 border-t border-slate-800/50 flex justify-between items-center text-[10px] text-slate-500 font-bold uppercase">
          <span>Ledger statistics</span>
          <span className="text-emerald-400 font-black">
            {stats?.lastUpdated ? `Updated ${new Date(stats.lastUpdated).toLocaleTimeString()}` : 'Live'}
          </span>
        </div>
      </div>

      {/* 2. API Status Center — real, on-demand health probe (getAdminHealthSnapshot). */}
      <div
        className="xl:col-span-3 bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 shadow-2xl relative overflow-hidden transition-all duration-300 hover:border-slate-700/80 flex flex-col justify-between"
        style={{ boxShadow: `inset 0 0 20px rgba(16, 185, 129, 0.05), 0 10px 40px rgba(0,0,0,0.4)` }}
      >
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">API Status Center</h3>
              <p className="text-[10px] text-slate-500 mt-0.5 font-bold uppercase">Live Integration Probe</p>
            </div>
            <button
              onClick={runHealthCheck}
              disabled={isProbing}
              className="flex items-center gap-2 px-3 py-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-xl transition-all text-slate-300 hover:text-white active:scale-95 disabled:opacity-50 text-[10px] font-black uppercase tracking-wider"
            >
              <RefreshCw size={14} className={isProbing ? 'animate-spin' : ''} />
              {isProbing ? 'Probing' : 'Run Check'}
            </button>
          </div>

          {!health && !healthError && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Activity size={28} className="text-slate-600 mb-3" />
              <p className="text-xs text-slate-500 font-semibold">No live data yet — run a health check to probe ESPN, Firestore, Cloud Functions, and email delivery.</p>
            </div>
          )}

          {healthError && (
            <div className="flex items-center gap-3 p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-300">
              <AlertTriangle size={18} />
              <span className="text-xs font-semibold">{healthError}</span>
            </div>
          )}

          {health && (
            <div className="space-y-3.5">
              {checkEntries.map(([key, c]) => {
                const Icon = CHECK_ICONS[key] ?? Server;
                return (
                  <div key={key} className="flex justify-between items-center p-3.5 bg-slate-950/60 border border-slate-800 rounded-2xl">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400"><Icon size={16} /></div>
                      <div>
                        <span className="text-xs font-extrabold text-white block uppercase leading-none mb-1">{c.label}</span>
                        <span className="text-[9px] font-bold text-slate-500 uppercase">{c.latencyMs}ms · {c.detail}</span>
                      </div>
                    </div>
                    <span className={`flex items-center gap-1 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider border ${c.ok ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' : 'text-rose-400 bg-rose-400/10 border-rose-400/30'}`}>
                      {c.ok ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                      {c.ok ? 'OK' : 'FAIL'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-8 pt-4 border-t border-slate-800/50 flex justify-between items-center text-[10px] text-slate-500 font-bold uppercase">
          <span>Systems monitor</span>
          {health ? (
            <span className={`font-black ${allOk ? 'text-emerald-400' : 'text-rose-400'}`}>
              {allOk ? 'All checks passed' : 'Degradation detected'} · {new Date(health.at).toLocaleTimeString()}
            </span>
          ) : (
            <span className="text-slate-600 font-black">Idle</span>
          )}
        </div>
      </div>

    </div>
  );
};
