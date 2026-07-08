import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Target, Trophy, Calendar, TrendingUp, Users, Award, DollarSign, BarChart3 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { dbService } from '../services/dbService';

/**
 * Player Profile — reads the sanitized publicProfiles/{uid} projection (ADR 0004). Real
 * overall stats + performance chart + weekly record. Team-by-team, Profit, and Achievements
 * render honest "coming soon" states until their backend lands (never fabricated).
 */
export const PlayerProfile: React.FC<{ previewData?: any }> = ({ previewData }) => {
  const { uid } = useParams<{ uid: string }>();
  const [profile, setProfile] = useState<any | null>(previewData ?? null);
  const [loaded, setLoaded] = useState(!!previewData);

  useEffect(() => {
    if (previewData || !uid) return;
    return dbService.subscribeToPublicProfile(uid, (p) => { setProfile(p); setLoaded(true); });
  }, [uid, previewData]);

  const chartData = useMemo(() => {
    const weekly: any[] = profile?.weekly || [];
    return weekly.map((w, i) => ({
      label: `${w.season?.slice(-2) || ''}W${w.week}`,
      accuracy: w.total > 0 ? Math.round((w.correct / w.total) * 100) : 0,
      points: w.points || 0,
      i,
    }));
  }, [profile]);

  const o = profile?.overall || { accuracy: 0, correct: 0, total: 0, points: 0, poolsEntered: 0, seasonsPlayed: 0 };

  const Stat = ({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) => (
    <div className="bg-card border border-line rounded-2xl p-4 shadow-card flex items-center gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accent ? 'bg-gold-500/10 border border-gold-500/30 text-gold-700 dark:text-gold-400' : 'bg-navy-600/10 dark:bg-navy-600/30 border border-navy-600/20 text-navy-700 dark:text-[#9FB0CC]'}`}>{icon}</div>
      <div>
        <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] leading-none mb-1.5">{label}</p>
        <p className={`text-2xl font-display font-bold num leading-none ${accent ? 'text-gold-700 dark:text-gold-400' : 'text-[color:var(--text)]'}`}>{value}</p>
      </div>
    </div>
  );

  const Stub = ({ icon, title, note }: { icon: React.ReactNode; title: string; note: string }) => (
    <div className="bg-card border border-line rounded-3xl p-6 shadow-card">
      <h3 className="text-sm font-display font-bold uppercase tracking-[0.12em] text-muted mb-3 flex items-center gap-2">{icon} {title}</h3>
      <div className="bg-surface border border-dashed border-line rounded-2xl p-8 text-center">
        <p className="text-xs text-faint font-body">{note}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-page text-[color:var(--text)] p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="bg-card border border-line rounded-3xl p-6 shadow-card flex items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-navy-800 flex items-center justify-center font-display font-bold uppercase text-white text-2xl shadow-card">
            {(profile?.userName || 'P').substring(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold uppercase tracking-[0.04em]">{profile?.userName || (loaded ? 'Player' : '…')}</h1>
            <p className="text-muted text-sm font-body">Player profile · {o.poolsEntered} pool{o.poolsEntered === 1 ? '' : 's'} · {o.seasonsPlayed} season{o.seasonsPlayed === 1 ? '' : 's'}</p>
          </div>
        </div>

        {/* Overall stats (real) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat icon={<Target size={20} />} label="Accuracy" value={`${o.accuracy}%`} accent />
          <Stat icon={<TrendingUp size={20} />} label="Correct / Total" value={`${o.correct} / ${o.total}`} />
          <Stat icon={<Trophy size={20} />} label="Total Points" value={o.points.toLocaleString()} />
          <Stat icon={<Users size={20} />} label="Pools Entered" value={String(o.poolsEntered)} />
        </div>

        {/* Performance chart (real, from weekly record) */}
        <div className="bg-card border border-line rounded-3xl p-6 shadow-card">
          <h3 className="text-sm font-display font-bold uppercase tracking-[0.12em] text-muted mb-1 flex items-center gap-2"><BarChart3 size={16} /> Performance Chart</h3>
          <p className="text-[11px] text-faint font-body mb-4">Weekly accuracy across all pools</p>
          {chartData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(124,134,152,0.15)" />
                  <XAxis dataKey="label" tick={{ fill: '#7C8698', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#7C8698', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#0E1C34', borderColor: 'rgba(230,206,150,0.16)', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }} itemStyle={{ color: '#D9BC80' }} formatter={(v: any) => [`${v}%`, 'Accuracy']} />
                  <Line type="monotone" dataKey="accuracy" stroke="#C9A867" strokeWidth={2.5} dot={{ r: 3, fill: '#C9A867' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="bg-surface border border-dashed border-line rounded-2xl p-10 text-center">
              <p className="text-xs text-faint font-body">No scored weeks yet — the chart fills in as games are played.</p>
            </div>
          )}
        </div>

        {/* Weekly record (real) */}
        <div className="bg-card border border-line rounded-3xl p-6 shadow-card">
          <h3 className="text-sm font-display font-bold uppercase tracking-[0.12em] text-muted mb-4 flex items-center gap-2"><Calendar size={16} /> Weekly Record</h3>
          {(profile?.weekly?.length || 0) > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] border-b border-line">
                    <th className="py-2 pr-4">Season</th><th className="py-2 pr-4">Week</th><th className="py-2 pr-4">Pool</th>
                    <th className="py-2 pr-4 text-right">Record</th><th className="py-2 text-right">Points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {profile.weekly.map((w: any, i: number) => (
                    <tr key={i} className="text-xs font-body">
                      <td className="py-2.5 pr-4 num">{w.season}</td>
                      <td className="py-2.5 pr-4 num font-bold">W{w.week}</td>
                      <td className="py-2.5 pr-4 text-muted truncate max-w-[160px]">{w.poolName}</td>
                      <td className="py-2.5 pr-4 text-right num font-bold">{w.correct}/{w.total}</td>
                      <td className="py-2.5 text-right num text-gold-700 dark:text-gold-400 font-bold">{w.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-surface border border-dashed border-line rounded-2xl p-8 text-center">
              <p className="text-xs text-faint font-body">No scored weeks yet.</p>
            </div>
          )}
        </div>

        {/* Honest stubs — need more backend (see ADR 0004 / NOTES) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Stub icon={<Trophy size={14} />} title="Team by Team" note="Per-team pick performance — coming with per-pick result tracking." />
          <Stub icon={<DollarSign size={14} />} title="Profit" note="Winnings across pools — coming with the payout ledger." />
          <Stub icon={<Award size={14} />} title="Achievements" note="Badges & milestones — a separate upcoming feature." />
        </div>
      </div>
    </div>
  );
};

export default PlayerProfile;
