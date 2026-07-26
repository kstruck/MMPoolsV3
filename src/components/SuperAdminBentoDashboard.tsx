import React, { useState, useCallback, useEffect } from 'react';
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
  ShieldAlert,
  ExternalLink,
} from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { functions, db } from '../firebase';
import { useToast } from './ui/Toast';
import { getUserMessage } from '../utils/errorMessages';
import { dbService } from '../services/dbService';
import { Badge } from './ui';
import { withCorrelationId } from '../utils/correlationId';

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

interface OpsAlertSample {
  id: string;
  type: string;
  message?: string;
  createdAt: number | null;
}
interface FailedWebhookSample {
  id: string;
  eventType?: string;
  attemptCount?: number;
  lastFailedAt: number | null;
}
interface OpsHealthSummary {
  at: number;
  openAlerts: { count: number; sample: OpsAlertSample[] };
  failedWebhooks: { count: number; sample: FailedWebhookSample[] };
}

// Optional — set VITE_SENTRY_ORG_URL (e.g. https://myorg.sentry.io/issues/) once
// Kevin has a project slug to link to. Undefined = the deep-link is hidden
// rather than pointing at a guessed/placeholder URL.
const SENTRY_ORG_URL = import.meta.env.VITE_SENTRY_ORG_URL as string | undefined;

interface SuperAdminBentoDashboardProps {
  stats: GlobalStats | null;
}

export const SuperAdminBentoDashboard: React.FC<SuperAdminBentoDashboardProps> = ({ stats }) => {
  const toast = useToast();
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [revenue, setRevenue] = useState<{ totalRevenue?: number; last30dRevenue?: number } | null>(null);
  const [opsHealth, setOpsHealth] = useState<OpsHealthSummary | null>(null);

  // Platform revenue (Stripe income) — distinct from prize volume (GMV) below.
  useEffect(() => {
    const unsub = dbService.subscribeToRevenueStats((r) => setRevenue(r as { totalRevenue?: number } | null));
    return unsub;
  }, []);

  // Hydrate from the persisted health/latest snapshot (written hourly by the
  // scheduler + on every manual Run Check) so the card shows recent status
  // without requiring a click. Manual Run Check overwrites this in state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'health', 'latest'));
        const data = snap.data() as { latest?: HealthSnapshot } | undefined;
        if (!cancelled && data?.latest) setHealth(data.latest);
      } catch {
        // Non-fatal: card falls back to "run a health check" empty state.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Ops Health (PLAN #12) — open monetization_alerts + failed stripeWebhookEvents,
  // surfaced next to the existing health checks. Passive on-mount fetch, same
  // fail-quiet-not-fail-loud posture as the health/latest hydration above.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fn = httpsCallable<{ _correlationId: string }, OpsHealthSummary>(functions, 'getOpsHealthSummary');
        const res = await fn(withCorrelationId(undefined));
        if (!cancelled) setOpsHealth(res.data);
      } catch {
        // Non-fatal: section just stays hidden if this fails.
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-stretch p-4 md:p-8 bg-page min-h-screen text-[color:var(--text)] font-body selection:bg-brandred-600 selection:text-white">

      {/* 1. Global Platform Statistics — live via parent subscription. */}
      <div
        className="bg-card border border-line rounded-3xl p-6 shadow-card relative overflow-hidden transition-all duration-150 hover:shadow-card-hover flex flex-col justify-between"
      >
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-xs font-display font-bold text-muted uppercase tracking-[0.16em]">Platform Ledger</h3>
              <p className="text-[10px] text-faint mt-0.5 font-display font-bold uppercase tracking-[0.08em]">Global Administrative Accounts</p>
            </div>
          </div>

          {/* Interactive Metric Ledger Grid */}
          <div className="grid grid-cols-2 gap-4 mb-6">

            {/* Metric A */}
            <div className="bg-surface border border-line p-4 rounded-2xl relative overflow-hidden group hover:border-gold-500/40 transition-colors duration-150">
              <div className="absolute top-3 right-3 p-1.5 rounded-lg bg-gold-500/10 text-gold-600 dark:text-gold-400">
                <Database size={16} />
              </div>
              <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.16em] block mb-1">
                Active Pools
              </span>
              <span className="text-2xl font-display font-bold text-[color:var(--text)] num leading-none">
                {stats?.totalPools || 0}
              </span>
            </div>

            {/* Metric B */}
            <div className="bg-surface border border-line p-4 rounded-2xl relative overflow-hidden group hover:border-gold-500/40 transition-colors duration-150">
              <div className="absolute top-3 right-3 p-1.5 rounded-lg bg-gold-500/10 text-gold-600 dark:text-gold-400">
                <Users size={16} />
              </div>
              <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.16em] block mb-1">
                Total Users
              </span>
              <span className="text-2xl font-display font-bold text-[color:var(--text)] num leading-none">
                {stats?.totalUsers || 0}
              </span>
            </div>

            {/* Metric C — this card used to read `totalSquaresSold`, which summed
                actual squares AND every NFL/bracket/props ENTRY into one number
                under the label "Squares Sold". Two different units, one figure.
                They are counted separately now and both are shown. */}
            <div className="bg-surface border border-line p-4 rounded-2xl relative overflow-hidden group hover:border-gold-500/40 transition-colors duration-150" title="Squares claimed on SQUARES pools, and entries on every other pool type. Test pools are excluded from both.">
              <div className="absolute top-3 right-3 p-1.5 rounded-lg bg-gold-500/10 text-gold-600 dark:text-gold-400">
                <Trophy size={16} />
              </div>
              <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.16em] block mb-1">
                Squares / Entries
              </span>
              <span className="text-2xl font-display font-bold text-[color:var(--text)] num leading-none">
                {stats?.totalSquaresSold || 0}
                <span className="text-muted"> / </span>
                {stats?.totalEntries || 0}
              </span>
            </div>

            {/* Metric D */}
            <div className="bg-surface border border-line p-4 rounded-2xl relative overflow-hidden group hover:border-gold-500/40 transition-colors duration-150" title="Total prize money across all pools — player money, not platform income.">
              <div className="absolute top-3 right-3 p-1.5 rounded-lg bg-gold-500/10 text-gold-600 dark:text-gold-400">
                <Coins size={16} />
              </div>
              <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.16em] block mb-1">
                Prize Volume (GMV)
              </span>
              <span className="text-2xl font-display font-bold text-gold-700 dark:text-gold-400 num leading-none">
                ${(stats?.totalRevenue || 0).toLocaleString()}
              </span>
            </div>

          </div>

          {/* Platform Revenue — real Stripe income (admin_stats/revenue), distinct from GMV above. */}
          <div className="bg-surface border border-gold-500/40 p-5 rounded-2xl flex items-center justify-between shadow-card mb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gold-500/15 border border-gold-500/40 rounded-xl text-gold-600 dark:text-gold-400">
                <Coins size={20} />
              </div>
              <div>
                <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.16em] block mb-0.5">Platform Revenue</span>
                <span className="text-xl font-display font-bold text-gold-700 dark:text-gold-400 num">${(revenue?.totalRevenue || 0).toLocaleString()}</span>
              </div>
            </div>
            <span className="text-[10px] font-display font-bold text-gold-700 dark:text-gold-400 bg-gold-500/10 px-3 py-1 rounded-full uppercase tracking-[0.08em]">
              ${(revenue?.last30dRevenue || 0).toLocaleString()} / 30d
            </span>
          </div>

          {/* Charity Glow Metric */}
          <div className="bg-surface border border-gold-500/40 p-5 rounded-2xl flex items-center justify-between shadow-card">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gold-500/15 border border-gold-500/40 rounded-xl text-gold-600 dark:text-gold-400">
                <Heart size={20} className="fill-current" />
              </div>
              <div>
                <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.16em] block mb-0.5">Charity Funds Raised</span>
                <span className="text-xl font-display font-bold text-gold-700 dark:text-gold-400 num">${(stats?.totalDonated || 0).toLocaleString()}</span>
              </div>
            </div>
            <span className="text-[10px] font-display font-bold text-gold-700 dark:text-gold-400 bg-gold-500/10 px-3 py-1 rounded-full uppercase tracking-[0.08em]">
              100% Free
            </span>
          </div>
        </div>

        <div className="mt-8 pt-4 border-t border-line flex justify-between items-center text-[10px] text-faint font-display font-bold uppercase tracking-[0.08em]">
          <span>Ledger statistics</span>
          <span className="text-[#0F7B4A] num">
            Last Updated: {stats?.lastUpdated ? new Date(stats.lastUpdated).toLocaleTimeString() : 'Live'}
          </span>
        </div>
      </div>

      {/* 2. Service Integration & API Health Monitor — real on-demand probe. */}
      <div
        className="bg-card border border-line rounded-3xl p-6 shadow-card relative overflow-hidden transition-all duration-150 hover:shadow-card-hover flex flex-col justify-between"
      >
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-xs font-display font-bold text-muted uppercase tracking-[0.16em]">API Status Center</h3>
              <p className="text-[10px] text-faint mt-0.5 font-display font-bold uppercase tracking-[0.08em]">
                {health ? `Last checked ${new Date(health.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'Live Integration Probe · auto-checks hourly'}
              </p>
            </div>
            <button
              onClick={runHealthCheck}
              disabled={isProbing}
              className="flex items-center gap-2 px-3 py-2 bg-surface hover:bg-card border border-line rounded-xl transition-all duration-150 text-muted hover:text-[color:var(--text)] active:scale-95 disabled:opacity-50 text-[10px] font-display font-bold uppercase tracking-[0.08em]"
            >
              <RefreshCw size={14} className={isProbing ? 'animate-spin' : ''} />
              {isProbing ? 'Probing' : 'Run Check'}
            </button>
          </div>

          {!health && !healthError && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Activity size={28} className="text-muted mb-3" />
              <p className="text-xs text-muted font-body font-semibold">No live data yet — run a health check to probe ESPN, Firestore, Cloud Functions, and email delivery.</p>
            </div>
          )}

          {healthError && (
            <div className="flex items-center gap-3 p-4 bg-[#FBEEDD] border border-[#F2D6B0] rounded-2xl text-[#B4530A]">
              <AlertTriangle size={18} />
              <span className="text-xs font-body font-semibold">{healthError}</span>
            </div>
          )}

          {health && (
            <div className="space-y-3.5">
              {checkEntries.map(([key, c]) => {
                const Icon = CHECK_ICONS[key] ?? Server;
                return (
                  <div
                    key={key}
                    className="flex justify-between items-center p-3.5 bg-surface border border-line rounded-2xl transition-all duration-150 hover:border-gold-500/40"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-card border border-line flex items-center justify-center text-muted">
                        <Icon size={16} />
                      </div>
                      <div>
                        <span className="text-xs font-display font-bold text-[color:var(--text)] block uppercase leading-none mb-1 tracking-[0.05em]">{c.label}</span>
                        <span className="text-[9px] font-display font-bold text-faint uppercase tracking-[0.08em] num">{c.latencyMs}ms · {c.detail}</span>
                      </div>
                    </div>
                    <Badge status={c.ok ? 'paid' : 'unpaid'} className="text-[9px] px-3 py-1">
                      {c.ok ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                      {c.ok ? 'OK' : 'FAIL'}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}

          {/* Ops Health (PLAN #12) — alerts the platform already emits, not a
              new monitoring source. Sentry's own dashboard stays the
              real-time errors/replay/perf pane; this is a deep-link out to it. */}
          {opsHealth && (
            <div className="mt-6 pt-5 border-t border-line">
              <div className="flex justify-between items-center mb-3">
                <h4 className="text-[10px] font-display font-bold text-muted uppercase tracking-[0.16em] flex items-center gap-1.5">
                  <ShieldAlert size={13} /> Ops Health
                </h4>
                {SENTRY_ORG_URL && (
                  <a
                    href={SENTRY_ORG_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[9px] font-display font-bold uppercase tracking-[0.08em] text-muted hover:text-[color:var(--text)] transition-colors duration-150"
                  >
                    Open Sentry <ExternalLink size={11} />
                  </a>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className={`p-3 rounded-xl border ${opsHealth.openAlerts.count > 0 ? 'border-[#F2D6B0] bg-[#FBEEDD]' : 'border-line bg-surface'}`}>
                  <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.12em] block mb-1">Open Alerts</span>
                  <span className={`text-xl font-display font-bold num leading-none ${opsHealth.openAlerts.count > 0 ? 'text-[#B4530A]' : 'text-[color:var(--text)]'}`}>
                    {opsHealth.openAlerts.count}
                  </span>
                </div>
                <div className={`p-3 rounded-xl border ${opsHealth.failedWebhooks.count > 0 ? 'border-[#F2D6B0] bg-[#FBEEDD]' : 'border-line bg-surface'}`}>
                  <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.12em] block mb-1">Failed Webhooks</span>
                  <span className={`text-xl font-display font-bold num leading-none ${opsHealth.failedWebhooks.count > 0 ? 'text-[#B4530A]' : 'text-[color:var(--text)]'}`}>
                    {opsHealth.failedWebhooks.count}
                  </span>
                </div>
              </div>

              {(opsHealth.openAlerts.sample.length > 0 || opsHealth.failedWebhooks.sample.length > 0) && (
                <div className="space-y-1.5">
                  {opsHealth.openAlerts.sample.slice(0, 3).map((a) => (
                    <div key={a.id} className="text-[10px] text-muted font-body flex items-center gap-1.5">
                      <AlertTriangle size={10} className="text-[#B4530A] shrink-0" />
                      <span className="truncate">{a.type}{a.message ? ` — ${a.message}` : ''}</span>
                    </div>
                  ))}
                  {opsHealth.failedWebhooks.sample.slice(0, 3).map((w) => (
                    <div key={w.id} className="text-[10px] text-muted font-body flex items-center gap-1.5">
                      <AlertTriangle size={10} className="text-[#B4530A] shrink-0" />
                      <span className="truncate">webhook {w.eventType ?? w.id} — {w.attemptCount ?? '?'} attempt(s)</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-8 pt-4 border-t border-line flex justify-between items-center text-[10px] text-faint font-display font-bold uppercase tracking-[0.08em]">
          <span>Systems monitor</span>
          {health ? (
            <span className={`num ${allOk ? 'text-[#0F7B4A]' : 'text-[#B4530A]'}`}>
              {allOk ? 'All checks passed' : 'Degradation detected'} · {new Date(health.at).toLocaleTimeString()}
            </span>
          ) : (
            <span className="text-faint">Idle</span>
          )}
        </div>
      </div>

    </div>
  );
};
