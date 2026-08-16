import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Crown, DollarSign, Users, Settings, ArrowRight, Trophy } from 'lucide-react';
import type { User, Pool } from '../../types';
import { Button } from '../ui';
import { isActiveManagedPool, isNFLSeasonPoolType } from '../../utils/poolSport';
import { isPoolOwner } from '../../utils/auth';

interface GlobalCommissionerDashboardProps {
  user: User;
  managedPools: Pool[];
}

const POOL_TYPE_LABEL: Record<string, string> = {
  NFL_PICKEM: "Pick'em",
  NFL_SURVIVOR: 'Survivor',
  NFL_MARGIN: 'Margin',
  NFL_PLAYOFFS: 'Playoffs',
  SQUARES: 'Squares',
  BRACKET: 'Bracket',
  PROPS: 'Props',
};
const typeLabel = (t: string) => POOL_TYPE_LABEL[t] || t.replace(/_/g, ' ');

// Hoisted: react-hooks/static-components forbids component types created during render.
const StatCard = ({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) => (
  <div className="bg-card border border-line rounded-2xl p-4 shadow-card flex items-center gap-4 relative overflow-hidden group hover:border-gold-500/40 transition-all duration-150">
    <div className={`w-10 h-10 rounded-xl flex items-center justify-center group-hover:scale-105 transition-all ${accent ? 'bg-gold-500/10 border border-gold-500/30 text-gold-700 dark:text-gold-400' : 'bg-navy-600/10 dark:bg-navy-600/30 border border-navy-600/20 text-navy-700 dark:text-[#9FB0CC]'}`}>
      {icon}
    </div>
    <div className="min-w-0">
      <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] leading-none mb-1.5">{label}</p>
      <p className={`text-2xl font-display font-bold num leading-none truncate ${accent ? 'text-gold-700 dark:text-gold-400' : 'text-[color:var(--text)]'}`}>{value}</p>
    </div>
  </div>
);

export const GlobalCommissionerDashboard: React.FC<GlobalCommissionerDashboardProps> = ({ user, managedPools }) => {
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  // Shared inclusion predicate: exclude finished/closed/canceled/archived + sim-* test pools.
  const activePools = useMemo(() => managedPools.filter(isActiveManagedPool), [managedPools]);

  const realParticipants = (p: Pool) => (p.participantIds || []).filter(id => id && id !== 'guest');
  const feeOf = (p: Pool) => (p as any).settings?.entryFee || (p as any).costPerSquare || 0;

  // Client-computed honest baseline (Dues Expected always provable). Dues Collected + Payouts
  // come from the server aggregate once deployed+backfilled; until then they read "—".
  // OWNER-scoped, deliberately (PLAN-CO-COMMISSIONERS C12/D7; codex r4 on
  // PR-B): `user.commissionerAggregate` is computed server-side from ownerId
  // pools only, so the tiles must count the same set or "Pools managed" would
  // include a co-managed pool whose dues/payouts the money tiles omit. The
  // LIST below still shows co-managed pools — that is the whole point of D7.
  const ownedActive = useMemo(() => activePools.filter(p => isPoolOwner(user, p)), [activePools, user]);
  const computed = useMemo(() => {
    let participants = 0;
    let duesExpected = 0;
    for (const p of ownedActive) {
      const n = realParticipants(p).length;
      participants += n;
      duesExpected += feeOf(p) * n;
    }
    return { poolsManaged: ownedActive.length, participants, duesExpected };
  }, [ownedActive]);

  // Prefer the server aggregate when present; fall back to the provable client baseline.
  const agg = user.commissionerAggregate;
  const poolsManaged = computed.poolsManaged;
  const participants = agg?.totalParticipants ?? computed.participants;
  const duesExpected = agg?.duesExpected ?? computed.duesExpected;
  const duesCollected = agg?.duesCollected;   // undefined -> "—"
  const totalPayouts = agg?.totalPayouts;      // undefined -> "—"
  const money = (n: number) => `$${n.toLocaleString()}`;

  // Pools grouped by type, honoring the filter.
  const typesPresent = useMemo(() => {
    const set = new Map<string, number>();
    for (const p of activePools) set.set(p.type, (set.get(p.type) || 0) + 1);
    return Array.from(set.entries());
  }, [activePools]);

  const visiblePools = useMemo(
    () => (typeFilter === 'ALL' ? activePools : activePools.filter(p => p.type === typeFilter)),
    [activePools, typeFilter],
  );

  const grouped = useMemo(() => {
    const g = new Map<string, Pool[]>();
    for (const p of visiblePools) {
      if (!g.has(p.type)) g.set(p.type, []);
      g.get(p.type)!.push(p);
    }
    return Array.from(g.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [visiblePools]);

  const PoolRow = ({ pool }: { pool: Pool }) => {
    const players = realParticipants(pool).length;
    const dues = feeOf(pool) * players;
    return (
      <div className="bg-surface border border-line rounded-2xl p-4 flex items-center justify-between group hover:border-gold-500/40 transition-colors">
        <div className="min-w-0">
          <h4 className="text-[color:var(--text)] font-display font-bold uppercase truncate">
            {pool.name}
            {!isPoolOwner(user, pool) && <span className="ml-2 align-middle px-1.5 py-0.5 rounded-full text-[8px] font-display font-bold tracking-[0.08em] bg-gold-500/15 text-gold-700 dark:text-gold-400 border border-gold-500/30">Co-Commissioner</span>}
          </h4>
          <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em]">
            <span className="num">{players}</span> Players{dues > 0 && <> • <span className="num">{money(dues)}</span> dues</>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* NFL pools have no /admin surface — AdminRoute only redirects them to
              ?tab=manager AFTER a strict owner/managerUid guard, which would refuse a
              co-commissioner (PLAN-CO-COMMISSIONERS D7; codex r1 on PR-B). Go straight
              to the manager tab, where PoolRoute computes the NFL-widened isManager. */}
          <button onClick={() => navigate(isNFLSeasonPoolType(pool.type) ? `/pool/${pool.id}?tab=manager` : `/admin/${pool.id}`)} className="bg-card border border-line hover:border-navy-600 text-muted hover:text-[color:var(--text)] p-2 rounded-lg transition-colors" title="Admin Dashboard">
            <Settings size={16} />
          </button>
          <button onClick={() => navigate(`/pool/${(pool as any).slug || pool.id}`)} className="bg-navy-800 hover:bg-navy-700 text-white p-2 rounded-lg transition-colors flex items-center justify-center" title="View Pool">
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Commissioner rollup — honest numbers only */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Crown size={20} />} label="Pools Managed" value={String(poolsManaged)} accent />
        <StatCard icon={<Users size={20} />} label="Total Participants" value={participants.toLocaleString()} />
        <StatCard icon={<DollarSign size={20} />} label="Dues (Collected / Expected)" value={`${duesCollected === undefined ? '—' : money(duesCollected)} / ${money(duesExpected)}`} accent />
        <StatCard icon={<Trophy size={20} />} label="Total Payouts" value={totalPayouts === undefined ? '—' : money(totalPayouts)} />
      </div>

      {/* Active Managed Pools — grouped by type, filterable, gridded */}
      <div className="bg-card border border-line rounded-3xl p-6 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <h3 className="text-lg font-display font-bold uppercase text-[color:var(--text)]">Active Managed Pools</h3>
          {typesPresent.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <FilterChip active={typeFilter === 'ALL'} onClick={() => setTypeFilter('ALL')} label="All" count={activePools.length} />
              {typesPresent.map(([t, n]) => (
                <FilterChip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)} label={typeLabel(t)} count={n} />
              ))}
            </div>
          )}
        </div>

        {activePools.length === 0 ? (
          <div className="bg-surface p-8 rounded-2xl border border-dashed border-line text-center">
            <p className="text-muted font-body font-bold mb-4">You are not currently managing any active pools.</p>
            <Button variant="primary" onClick={() => navigate('/create-pool')}>Create a New Pool</Button>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(([type, pools]) => (
              <div key={type}>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-[11px] font-display font-bold uppercase tracking-[0.1em] text-gold-700 dark:text-gold-400">{typeLabel(type)}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-display font-bold num bg-surface text-faint">{pools.length}</span>
                  <div className="flex-1 h-px bg-line" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {pools.map(pool => <PoolRow key={pool.id} pool={pool} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const FilterChip = ({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-full text-[11px] font-display font-bold uppercase tracking-[0.06em] flex items-center gap-1.5 transition-colors ${active ? 'bg-gold-500/15 text-gold-700 dark:text-gold-400 border border-gold-500/40' : 'bg-surface text-muted border border-line hover:text-[color:var(--text)]'}`}
  >
    {label}<span className="num opacity-70">{count}</span>
  </button>
);
