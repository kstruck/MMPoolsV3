import React, { useCallback, useEffect, useState } from 'react';
import { Eye, RefreshCw, UserPlus, Trophy, Coins, AlertTriangle } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { getUserMessage } from '../../utils/errorMessages';
import { withCorrelationId } from '../../utils/correlationId';

/**
 * Production Watchdog — what real people did in the last 24h, with a link to go
 * look at each one. Sibling of the API Status Center: that card watches the
 * machinery, this one watches the users.
 *
 * Mirrors the server payload in functions/src/prodWatchdog.ts. A signal with no
 * `count` is UNAVAILABLE (the read failed) and renders as such — never as 0,
 * which would read as "nothing happened" on an unreadable collection.
 */

type WatchdogEventKind = 'POOL_CREATED' | 'USER_SIGNED_UP' | 'CHARGE' | 'CLIENT_ERROR';

interface WatchdogEvent {
  kind: WatchdogEventKind;
  at: number;
  label: string;
  href?: string;
}

interface WatchdogSignal {
  count?: number;
  truncated: boolean;
  unavailable?: string;
}

interface WatchdogReport {
  at: number;
  sinceMs: number;
  windowHours: number;
  signals: {
    newUsers: WatchdogSignal;
    newPools: WatchdogSignal;
    charges: WatchdogSignal & { revenue?: number };
    clientErrors: WatchdogSignal;
  };
  events: WatchdogEvent[];
}

const KIND_ICON: Record<WatchdogEventKind, React.ComponentType<{ size?: number; className?: string }>> = {
  USER_SIGNED_UP: UserPlus,
  POOL_CREATED: Trophy,
  CHARGE: Coins,
  CLIENT_ERROR: AlertTriangle,
};

/** Events shown at once. The counts above the list are the full picture. */
const VISIBLE_EVENTS = 12;

/**
 * `kind` decides what truncation MEANS, and the two are not the same claim.
 * A capped COUNT is a genuine lower bound — the real number is at least this.
 * A capped MONEY total is not: `billingCharges` rows can be negative (refunds,
 * disputes), so an unread row can pull the true net DOWN. Marking it "≥" would
 * assert the opposite of what the data supports, so an amount says "partial".
 */
const Tile: React.FC<{
  label: string;
  signal: WatchdogSignal;
  value?: string;
  kind?: 'count' | 'amount';
  alert?: boolean;
}> = ({ label, signal, value, kind = 'count', alert }) => {
  const unavailable = signal.count === undefined;
  const partialAmount = signal.truncated && kind === 'amount';
  return (
    <div
      className={`p-3 rounded-xl border ${alert && !unavailable ? 'border-[#F2D6B0] bg-[#FBEEDD]' : 'border-line bg-surface'}`}
      title={
        signal.unavailable ??
        (signal.truncated
          ? partialAmount
            ? 'Capped — this is a partial total and the real net may be higher OR lower'
            : 'Capped — the real number is at least this'
          : undefined)
      }
    >
      <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.12em] block mb-1">{label}</span>
      {unavailable ? (
        <span className="text-[11px] font-display font-bold text-muted leading-none">unavailable</span>
      ) : (
        <span
          className={`text-xl font-display font-bold num leading-none ${alert ? 'text-[#B4530A]' : 'text-[color:var(--text)]'}`}
        >
          {signal.truncated && !partialAmount ? '≥' : ''}
          {value ?? signal.count}
          {partialAmount && <span className="text-[9px] font-display font-bold text-muted ml-1">partial</span>}
        </span>
      )}
    </div>
  );
};

export const ProductionWatchdogCard: React.FC = () => {
  const [report, setReport] = useState<WatchdogReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (): Promise<WatchdogReport | null> => {
    const fn = httpsCallable<{ _correlationId: string }, WatchdogReport>(functions, 'getProdWatchdog');
    const res = await fn(withCorrelationId(undefined));
    return res.data;
  }, []);

  // Passive fetch on mount — same fail-quiet posture as the health card next to
  // it: a failure shows a message in the card, it does not toast or throw.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await load();
        if (!cancelled) setReport(data);
      } catch (err) {
        if (!cancelled) setError(getUserMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await load());
    } catch (err) {
      setError(getUserMessage(err));
    } finally {
      setLoading(false);
    }
  }, [load]);

  const s = report?.signals;
  const revenue = s?.charges.revenue;
  const deadSignals = s ? Object.values(s).filter((sig) => sig.count === undefined).length : 0;

  return (
    <div className="bg-card border border-line rounded-3xl p-6 shadow-card relative overflow-hidden transition-all duration-150 hover:shadow-card-hover xl:col-span-2">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-xs font-display font-bold text-muted uppercase tracking-[0.16em] flex items-center gap-1.5">
            <Eye size={13} /> Production Watchdog
          </h3>
          <p className="text-[10px] text-faint mt-0.5 font-display font-bold uppercase tracking-[0.08em]">
            {report
              ? `Last ${report.windowHours}h · as of ${new Date(report.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
              : 'Real user activity'}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 bg-surface hover:bg-card border border-line rounded-xl transition-all duration-150 text-muted hover:text-[color:var(--text)] active:scale-95 disabled:opacity-50 text-[10px] font-display font-bold uppercase tracking-[0.08em]"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="text-[11px] text-[#B4530A] font-body mb-4">Could not load the watchdog: {error}</div>
      )}

      {!report && !error && (
        <div className="text-[11px] text-muted font-body">{loading ? 'Reading the last 24 hours…' : 'No data yet.'}</div>
      )}

      {s && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Tile label="New Users" signal={s.newUsers} />
            <Tile label="Pools Created" signal={s.newPools} />
            <Tile
              label="Charges"
              signal={s.charges}
              kind="amount"
              value={revenue === undefined ? undefined : `$${revenue.toFixed(2)}`}
            />
            <Tile label="Client Errors" signal={s.clientErrors} alert={(s.clientErrors.count ?? 0) > 0} />
          </div>

          {report.events.length === 0 ? (
            // "Nothing happened" is a CLAIM, and it is only ours to make when every
            // signal was actually readable. With a dead signal the honest statement
            // is that the readable ones were quiet and the rest is unknown —
            // otherwise the card hands the operator an all-clear over a collection
            // it never managed to read, while a tile right above says "unavailable".
            <div className="text-[11px] text-muted font-body">
              {deadSignals === 0
                ? `Nothing happened in the last ${report.windowHours} hours.`
                : `No activity in the readable signals over the last ${report.windowHours} hours — ${deadSignals} signal${deadSignals > 1 ? 's' : ''} could not be read, so activity there is unknown.`}
            </div>
          ) : (
            <div className="space-y-1.5">
              {report.events.slice(0, VISIBLE_EVENTS).map((e, i) => {
                const Icon = KIND_ICON[e.kind] ?? AlertTriangle;
                const time = new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return (
                  <div key={`${e.kind}-${e.at}-${i}`} className="text-[10px] text-muted font-body flex items-center gap-1.5">
                    <Icon size={10} className="shrink-0" />
                    <span className="num text-faint shrink-0">{time}</span>
                    {e.href ? (
                      <a href={e.href} className="truncate underline decoration-dotted hover:text-[color:var(--text)]">
                        {e.label}
                      </a>
                    ) : (
                      <span className="truncate">{e.label}</span>
                    )}
                  </div>
                );
              })}
              {report.events.length > VISIBLE_EVENTS && (
                <div className="text-[10px] text-faint font-body">
                  + {report.events.length - VISIBLE_EVENTS} more in the window
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ProductionWatchdogCard;
