import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Target, Trophy, Calendar, TrendingUp, Users, Award, DollarSign, BarChart3, ListChecks, Shield } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { auth } from '../firebase';
import { dbService } from '../services/dbService';

/**
 * Player Profile (ADR 0005) — renders the sanitized publicProfiles/{subjectId} projection.
 * Tabs: Stats / Weekly / Picks / Achievements (tab rides in the URL). The public doc carries
 * ZERO pool identifiers; the signed-in viewer's "Pools you share" panel enriches via the
 * viewer-gated getProfilePoolDetail callable. Experts (subjectKind EXPERT) render through the
 * same page with money sections hidden. No gambling units anywhere.
 */

type TabId = 'stats' | 'weekly' | 'picks' | 'achievements';
const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'stats', label: 'Stats', icon: <BarChart3 size={13} /> },
  { id: 'weekly', label: 'Weekly Records', icon: <Calendar size={13} /> },
  { id: 'picks', label: 'Pick History', icon: <ListChecks size={13} /> },
  { id: 'achievements', label: 'Achievements', icon: <Award size={13} /> },
];

const TEAM_RANK_MIN_PICKS = 3; // mirror shared/profile.ts

const BUCKET_LABEL: Record<string, string> = {
  'NFL_PICKEM|STRAIGHT': "Pick'em — Straight Up",
  'NFL_PICKEM|ATS': "Pick'em — Against the Spread",
  'NFL_SURVIVOR|': 'Survivor',
  'NFL_MARGIN|': 'Margin',
};

const RESULT_BADGE: Record<string, string> = {
  W: 'bg-[#E4F5EC] text-[#0F7B4A] border-[#BEE7D0]',
  SURVIVED: 'bg-[#E4F5EC] text-[#0F7B4A] border-[#BEE7D0]',
  L: 'bg-brandred-600/10 text-brandred-600 border-brandred-600/25',
  STRUCK: 'bg-brandred-600/10 text-brandred-600 border-brandred-600/25',
  PUSH: 'bg-surface text-muted border-line',
  VOID: 'bg-surface text-faint border-line',
};

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString()}`;

// Static components (hoisted — react-hooks/static-components forbids creating
// component types during render; these close over nothing).
const Stat = ({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) => (
  <div className="bg-card border border-line rounded-2xl p-4 shadow-card flex items-center gap-4">
    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accent ? 'bg-gold-500/10 border border-gold-500/30 text-gold-700 dark:text-gold-400' : 'bg-navy-600/10 dark:bg-navy-600/30 border border-navy-600/20 text-navy-700 dark:text-[#9FB0CC]'}`}>{icon}</div>
    <div>
      <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] leading-none mb-1.5">{label}</p>
      <p className={`text-2xl font-display font-bold num leading-none ${accent ? 'text-gold-700 dark:text-gold-400' : 'text-[color:var(--text)]'}`}>{value}</p>
    </div>
  </div>
);

const Empty = ({ note }: { note: string }) => (
  <div className="bg-surface border border-dashed border-line rounded-2xl p-8 text-center">
    <p className="text-xs text-faint font-body">{note}</p>
  </div>
);

const Card = ({ icon, title, sub, children }: { icon: React.ReactNode; title: string; sub?: string; children: React.ReactNode }) => (
  <div className="bg-card border border-line rounded-3xl p-6 shadow-card">
    <h3 className="text-sm font-display font-bold uppercase tracking-[0.12em] text-muted mb-1 flex items-center gap-2">{icon} {title}</h3>
    {sub && <p className="text-[11px] text-faint font-body mb-4">{sub}</p>}
    {children}
  </div>
);

export const PlayerProfile: React.FC<{ previewData?: any }> = ({ previewData }) => {
  const { uid } = useParams<{ uid: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [profile, setProfile] = useState<any | null>(previewData ?? null);
  const [loaded, setLoaded] = useState(!!previewData);
  const [achievements, setAchievements] = useState<any[]>(previewData?.achievements ?? []);
  const [viewer, setViewer] = useState<FirebaseUser | null>(null);
  const [sharedPools, setSharedPools] = useState<any[] | null>(null);

  const rawTab = searchParams.get('tab') as TabId | null;
  const tab: TabId = TABS.some(t => t.id === rawTab) ? (rawTab as TabId) : 'stats';
  const setTab = (t: TabId) => setSearchParams(prev => {
    const p = new URLSearchParams(prev);
    p.set('tab', t);
    return p;
  }, { replace: true });

  useEffect(() => {
    if (previewData || !uid) return;
    return dbService.subscribeToPublicProfile(uid, (p) => { setProfile(p); setLoaded(true); });
  }, [uid, previewData]);

  useEffect(() => {
    if (previewData || !uid) return;
    return dbService.subscribeToAchievements(uid, setAchievements);
  }, [uid, previewData]);

  useEffect(() => {
    if (previewData) return;
    return onAuthStateChanged(auth, setViewer);
  }, [previewData]);

  // Self-heal: a member visiting their OWN profile before any scoring has ever
  // written it materializes the doc on the spot (recomputeMyProfile is self-auth'd
  // server-side). One attempt per visit.
  const healedRef = useRef(false);
  useEffect(() => {
    if (previewData || !uid || !loaded || profile || healedRef.current) return;
    if (!viewer || viewer.uid !== uid) return;
    healedRef.current = true;
    dbService.recomputeMyProfile().catch(() => { /* empty state stays; next scoring writes it */ });
  }, [previewData, uid, loaded, profile, viewer]);

  // League-average line (real site-wide aggregate; absent until the daily job runs).
  const [siteAverages, setSiteAverages] = useState<any | null>(previewData?.siteAverages ?? null);
  useEffect(() => {
    if (previewData) return;
    let cancelled = false;
    dbService.getSiteAverages().then(d => { if (!cancelled) setSiteAverages(d); });
    return () => { cancelled = true; };
  }, [previewData]);

  // "Pools you share with X": probe the viewer's own NFL pools through the gated
  // callable (server rejects non-shared pools). Capped; loaded once per subject.
  useEffect(() => {
    if (previewData || !uid || !viewer || viewer.uid === uid) return;
    let cancelled = false;
    (async () => {
      try {
        const parts = (await dbService.getMyParticipations(viewer.uid))
          .filter(p => ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'].includes(p.type))
          .slice(0, 10);
        const results = await Promise.all(parts.map(p =>
          dbService.getProfilePoolDetail(uid, p.poolId).catch(() => null)));
        if (!cancelled) setSharedPools(results.filter(Boolean));
      } catch {
        if (!cancelled) setSharedPools([]);
      }
    })();
    return () => { cancelled = true; };
  }, [uid, viewer, previewData]);

  const chartData = useMemo(() => {
    const weekly: any[] = profile?.weekly || [];
    const avgByKey = new Map<string, number>(
      (siteAverages?.weekly || []).map((a: any) => [`${a.season}|${a.week}`, a.avgAccuracy]),
    );
    return weekly.map((w, i) => ({
      label: `${w.season?.slice(-2) || ''}W${w.week}`,
      accuracy: w.total > 0 ? Math.round((w.correct / w.total) * 100) : 0,
      leagueAvg: avgByKey.get(`${w.season}|${w.week}`) ?? null,
      points: w.points || 0,
      i,
    }));
  }, [profile, siteAverages]);
  const hasLeagueAvg = chartData.some(d => d.leagueAvg !== null);

  const o = profile?.overall || { accuracy: 0, correct: 0, total: 0, points: 0, poolsEntered: 0, seasonsPlayed: 0 };
  const isExpert = profile?.subjectKind === 'EXPERT';
  const profit = !isExpert ? profile?.profit : null;

  const teamBuckets: any[] = profile?.teamByTeam || [];
  const yearly: any[] = profile?.yearly || [];
  const pickHistory: any[] = profile?.pickHistory || [];

  return (
    <div className="min-h-screen bg-page text-[color:var(--text)] p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-card border border-line rounded-3xl p-6 shadow-card flex items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-navy-800 flex items-center justify-center font-display font-bold uppercase text-white text-2xl shadow-card">
            {isExpert ? <Shield size={26} className="text-gold-400" /> : (profile?.userName || 'P').substring(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold uppercase tracking-[0.04em] flex items-center gap-3">
              {profile?.userName || (loaded ? 'Player' : '…')}
              {isExpert && <span className="text-[10px] font-display font-bold uppercase tracking-[0.08em] bg-gold-500/10 border border-gold-500/30 text-gold-700 dark:text-gold-400 rounded-full px-2.5 py-1">Expert</span>}
            </h1>
            <p className="text-muted text-sm font-body">
              {isExpert ? 'Tracked expert · graded straight-up against final scores'
                : `Player profile · ${o.poolsEntered} pool${o.poolsEntered === 1 ? '' : 's'} · ${o.seasonsPlayed} season${o.seasonsPlayed === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 bg-card border border-line rounded-2xl p-1.5 shadow-card overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-display font-bold uppercase text-[11px] tracking-[0.08em] whitespace-nowrap transition-colors ${
                tab === t.id ? 'bg-navy-700 text-white' : 'text-muted hover:bg-page'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* ===== STATS ===== */}
        {tab === 'stats' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Stat icon={<Target size={20} />} label="Accuracy" value={`${o.accuracy}%`} accent />
              <Stat icon={<TrendingUp size={20} />} label="Correct / Total" value={`${o.correct} / ${o.total}`} />
              <Stat icon={<Trophy size={20} />} label="Total Points" value={(o.points || 0).toLocaleString()} />
              {isExpert
                ? <Stat icon={<Calendar size={20} />} label="Seasons" value={String(o.seasonsPlayed)} />
                : <Stat icon={<Users size={20} />} label="Pools Entered" value={String(o.poolsEntered)} />}
            </div>

            <Card icon={<BarChart3 size={16} />} title="Performance Chart" sub="Weekly accuracy across all pools">
              {chartData.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(124,134,152,0.15)" />
                      <XAxis dataKey="label" tick={{ fill: '#7C8698', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fill: '#7C8698', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ backgroundColor: '#0E1C34', borderColor: 'rgba(230,206,150,0.16)', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }} itemStyle={{ color: '#D9BC80' }} formatter={(v: any, name: any) => [`${v}%`, name === 'leagueAvg' ? 'League Avg' : 'Accuracy']} />
                      <Line type="monotone" dataKey="accuracy" stroke="#C9A867" strokeWidth={2.5} dot={{ r: 3, fill: '#C9A867' }} />
                      {hasLeagueAvg && (
                        <Line type="monotone" dataKey="leagueAvg" stroke="#7C8698" strokeWidth={1.5} strokeDasharray="6 4" dot={false} connectNulls />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : <Empty note="No scored weeks yet — the chart fills in as games are played." />}
            </Card>

            {!isExpert && (
              <Card icon={<DollarSign size={16} />} title="Profit" sub="Recorded winnings minus entry fees owed — money moves peer-to-peer; these are recorded figures.">
                {profit ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-page border border-line rounded-xl p-3 text-center">
                        <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] mb-1">Net</p>
                        <p className={`text-xl font-display font-bold num ${profit.net >= 0 ? 'text-[#0F7B4A]' : 'text-brandred-600'}`}>{money(profit.net)}</p>
                      </div>
                      <div className="bg-page border border-line rounded-xl p-3 text-center">
                        <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] mb-1">Won</p>
                        <p className="text-xl font-display font-bold num">{money(profit.won)}</p>
                      </div>
                      <div className="bg-page border border-line rounded-xl p-3 text-center">
                        <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] mb-1">Fees Owed</p>
                        <p className="text-xl font-display font-bold num">{money(profit.feesOwed)}</p>
                      </div>
                    </div>
                    {(profit.poolsPendingPayouts > 0 || profit.feesEstimated) && (
                      <p className="text-[11px] text-faint font-body">
                        {profit.poolsPendingPayouts > 0 && `Payouts pending in ${profit.poolsPendingPayouts} pool${profit.poolsPendingPayouts === 1 ? '' : 's'}. `}
                        {profit.feesEstimated && 'Some fees are estimated for pools joined before fee tracking.'}
                      </p>
                    )}
                  </div>
                ) : <Empty note="Profit appears once a commissioner records this player's first payout." />}
              </Card>
            )}

            <Card icon={<Trophy size={16} />} title="Team by Team" sub={`Record when picking each team, by pool type and pick mode. Teams with fewer than ${TEAM_RANK_MIN_PICKS} picks aren't ranked.`}>
              {teamBuckets.length > 0 ? (
                <div className="space-y-5">
                  {teamBuckets.map((bucket: any, bi: number) => {
                    const rankable = bucket.teams.filter((t: any) => t.wins + t.losses + t.pushes >= TEAM_RANK_MIN_PICKS);
                    const best = rankable[0];
                    const worst = rankable.length > 1 ? rankable[rankable.length - 1] : null;
                    return (
                      <div key={bi}>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-[color:var(--text)]">
                            {BUCKET_LABEL[`${bucket.poolType}|${bucket.pickMode || ''}`] || bucket.poolType}
                          </h4>
                          {best && (
                            <span className="text-[10px] font-body text-muted">
                              Best: <b className="num">{best.team} {best.accuracy}%</b>
                              {worst && <> · Worst: <b className="num">{worst.team} {worst.accuracy}%</b></>}
                            </span>
                          )}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left">
                            <thead>
                              <tr className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] border-b border-line">
                                <th className="py-1.5 pr-4">Team</th>
                                <th className="py-1.5 pr-4 text-right">W</th>
                                <th className="py-1.5 pr-4 text-right">L</th>
                                <th className="py-1.5 pr-4 text-right">Push</th>
                                <th className="py-1.5 text-right">Acc%</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                              {bucket.teams.map((t: any) => (
                                <tr key={t.team} className="text-xs font-body">
                                  <td className="py-2 pr-4 font-bold">{t.team}</td>
                                  <td className="py-2 pr-4 text-right num">{t.wins}</td>
                                  <td className="py-2 pr-4 text-right num">{t.losses}</td>
                                  <td className="py-2 pr-4 text-right num text-muted">{t.pushes}</td>
                                  <td className="py-2 text-right num font-bold">{t.accuracy}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <Empty note="Team-by-team performance fills in as weeks are scored." />}
            </Card>

            <Card icon={<Calendar size={16} />} title="Yearly Record">
              {yearly.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] border-b border-line">
                        <th className="py-2 pr-4">Season</th>
                        <th className="py-2 pr-4 text-right">W-L</th>
                        <th className="py-2 pr-4 text-right">Acc%</th>
                        {!isExpert && <th className="py-2 pr-4 text-right">Profit</th>}
                        {!isExpert && <th className="py-2 text-right">Best Finish</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {yearly.map((y: any) => (
                        <tr key={y.season} className="text-xs font-body">
                          <td className="py-2.5 pr-4 num font-bold">{y.season}</td>
                          <td className="py-2.5 pr-4 text-right num">{y.correct}-{Math.max(0, y.total - y.correct)}</td>
                          <td className="py-2.5 pr-4 text-right num font-bold">{y.accuracy}%</td>
                          {!isExpert && (
                            <td className={`py-2.5 pr-4 text-right num font-bold ${y.profitNet === null ? 'text-faint' : y.profitNet >= 0 ? 'text-[#0F7B4A]' : 'text-brandred-600'}`}>
                              {y.profitNet === null ? '—' : money(y.profitNet)}
                            </td>
                          )}
                          {!isExpert && (
                            <td className="py-2.5 text-right num">
                              {y.bestFinish ? `${y.bestFinish.rank}${['', 'st', 'nd', 'rd'][y.bestFinish.rank] || 'th'} of ${y.bestFinish.totalEntries}` : '—'}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty note="Yearly records appear after a season is played." />}
            </Card>
          </div>
        )}

        {/* ===== WEEKLY ===== */}
        {tab === 'weekly' && (
          <Card icon={<Calendar size={16} />} title="Weekly Record" sub="Aggregated across all pools per week">
            {(profile?.weekly?.length || 0) > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] border-b border-line">
                      <th className="py-2 pr-4">Season</th><th className="py-2 pr-4">Week</th>
                      <th className="py-2 pr-4 text-right">Record</th><th className="py-2 text-right">Points</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {profile.weekly.map((w: any, i: number) => (
                      <tr key={i} className="text-xs font-body">
                        <td className="py-2.5 pr-4 num">{w.season}</td>
                        <td className="py-2.5 pr-4 num font-bold">W{w.week}</td>
                        <td className="py-2.5 pr-4 text-right num font-bold">{w.correct}/{w.total}</td>
                        <td className="py-2.5 text-right num text-gold-700 dark:text-gold-400 font-bold">{w.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty note="No scored weeks yet." />}
          </Card>
        )}

        {/* ===== PICKS ===== */}
        {tab === 'picks' && (
          <Card icon={<ListChecks size={16} />} title="Pick History" sub="Scored picks only — a pick appears here once its week is scored.">
            {pickHistory.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] border-b border-line">
                      <th className="py-2 pr-4">Week</th>
                      <th className="py-2 pr-4">Matchup</th>
                      <th className="py-2 pr-4">Pick</th>
                      <th className="py-2 pr-4">Type</th>
                      <th className="py-2 text-right">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {pickHistory.map((r: any, i: number) => (
                      <tr key={i} className="text-xs font-body">
                        <td className="py-2.5 pr-4 num">{r.season} W{r.week}</td>
                        <td className="py-2.5 pr-4 text-muted">{r.awayAbbr && r.homeAbbr ? `${r.awayAbbr} @ ${r.homeAbbr}` : '—'}</td>
                        <td className="py-2.5 pr-4 font-bold">{r.pick || '—'}{typeof r.net === 'number' ? <span className="text-muted font-normal num"> ({r.net > 0 ? '+' : ''}{r.net})</span> : null}</td>
                        <td className="py-2.5 pr-4 text-faint text-[10px] uppercase font-display font-bold tracking-[0.06em]">{(BUCKET_LABEL[`${r.poolType}|${r.pickMode || ''}`] || r.poolType || '').replace("Pick'em — ", '')}</td>
                        <td className="py-2.5 text-right">
                          <span className={`inline-block border rounded-full px-2 py-0.5 text-[10px] font-display font-bold ${RESULT_BADGE[r.result] || RESULT_BADGE.PUSH}`}>{r.result}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty note="No scored picks yet." />}
          </Card>
        )}

        {/* ===== ACHIEVEMENTS ===== */}
        {tab === 'achievements' && (
          <Card icon={<Award size={16} />} title="Achievements">
            {achievements.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {achievements.map((a: any) => (
                  <div key={a.id} className="bg-page border border-line rounded-2xl p-4 text-center space-y-1.5">
                    <Award size={22} className={`mx-auto ${a.tier === 'GOLD' ? 'text-gold-500' : a.tier === 'SILVER' ? 'text-muted' : 'text-[#B08D57]'}`} />
                    <p className="font-display font-bold uppercase text-[11px] tracking-[0.06em]">{a.title}</p>
                    <p className="font-body text-[11px] text-muted">{a.description}</p>
                    {a.season && <p className="font-body text-[10px] text-faint num">{a.season}</p>}
                  </div>
                ))}
              </div>
            ) : <Empty note={isExpert ? 'Experts don’t earn achievements.' : 'None earned yet — achievements land as they’re unlocked.'} />}
          </Card>
        )}

        {/* Shared pools (viewer-gated) */}
        {!isExpert && sharedPools !== null && sharedPools.length > 0 && (
          <Card icon={<Users size={16} />} title={`Pools you share with ${profile?.userName || 'this player'}`} sub="Visible to you because you're in these pools together.">
            <div className="space-y-2">
              {sharedPools.map((p: any) => (
                <div key={p.poolId} className="flex flex-wrap justify-between items-center bg-page border border-line rounded-xl px-4 py-2.5 font-body text-xs gap-2">
                  <span className="font-bold">{p.poolName}</span>
                  <span className="text-muted num">{p.season} · {p.poolType?.replace('NFL_', '')}</span>
                  {p.finish && <span className="num">{p.finish.rank}{['', 'st', 'nd', 'rd'][p.finish.rank] || 'th'} of {p.finish.totalEntries}</span>}
                  <span className="num text-muted">Won {money(p.profit?.won || 0)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default PlayerProfile;
