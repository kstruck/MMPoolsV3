import React, { useMemo } from 'react';
import type { MonetizationBundle } from '../../../services/dbService';
import { fmtUSD, fmtDate, computeLiability } from './monetizationCalcs';

interface Props {
    bundles: MonetizationBundle[];
    locked: boolean;
}

const CARD = 'bg-surface border border-line rounded-2xl p-5';
const LABEL = 'text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em]';

export const BundleLiabilityPanel: React.FC<Props> = ({ bundles, locked }) => {
    const summary = useMemo(() => computeLiability(bundles), [bundles]);
    const revoked = useMemo(() => bundles.filter((b) => b.status === 'revoked'), [bundles]);

    if (locked) {
        return (
            <div className={CARD}>
                <p className="text-sm text-muted">
                    Bundle liability needs SUPER_ADMIN read-all on <code>bundles</code> (added by the
                    Wave-5 Firestore rules). This panel populates once those land.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Headline liability */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className={CARD}>
                    <div className={LABEL}>Outstanding credit liability</div>
                    <div className="text-2xl font-display font-bold text-[color:var(--text)]">
                        {fmtUSD(summary.totalDollarLiability)}
                    </div>
                    <div className="text-[10px] text-faint mt-1">
                        unredeemed credits × per-pool value
                    </div>
                </div>
                <div className={CARD}>
                    <div className={LABEL}>Outstanding credits</div>
                    <div className="text-2xl font-display font-bold text-[color:var(--text)]">
                        {summary.totalOutstandingCredits}
                    </div>
                    <div className="text-[10px] text-faint mt-1">across active credit bundles</div>
                </div>
                <div className={CARD}>
                    <div className={LABEL}>Revoked bundles</div>
                    <div className="text-2xl font-display font-bold text-[color:var(--text)]">
                        {summary.revokedCount}
                    </div>
                    <div className="text-[10px] text-faint mt-1">excluded from liability</div>
                </div>
            </div>

            {/* Per-user drill-down */}
            <div className={CARD}>
                <div className={`${LABEL} mb-3`}>Liability by owner</div>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-faint">
                                <th className="py-1.5 pr-3 font-display uppercase tracking-[0.06em]">Owner</th>
                                <th className="py-1.5 pr-3 text-right">Outstanding credits</th>
                                <th className="py-1.5 pr-3 text-right">Dollar value</th>
                                <th className="py-1.5 text-right">Bundles</th>
                            </tr>
                        </thead>
                        <tbody>
                            {summary.perOwner.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="py-3 text-faint">
                                        No outstanding liability.
                                    </td>
                                </tr>
                            ) : (
                                summary.perOwner.map((r) => (
                                    <tr key={r.ownerId} className="border-t border-line/50">
                                        <td className="py-1.5 pr-3 font-mono text-[10px] text-[color:var(--text)]">
                                            {r.ownerId.slice(0, 14)}
                                        </td>
                                        <td className="py-1.5 pr-3 text-right">{r.outstandingCredits}</td>
                                        <td className="py-1.5 pr-3 text-right font-bold">{fmtUSD(r.dollarValue)}</td>
                                        <td className="py-1.5 text-right text-faint">{r.bundleCount}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Revoked history */}
            <div className={CARD}>
                <div className={`${LABEL} mb-3`}>Revoked history</div>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-faint">
                                <th className="py-1.5 pr-3 font-display uppercase tracking-[0.06em]">Bundle</th>
                                <th className="py-1.5 pr-3">Owner</th>
                                <th className="py-1.5 pr-3">Kind</th>
                                <th className="py-1.5 pr-3">Reason</th>
                                <th className="py-1.5">Revoked</th>
                            </tr>
                        </thead>
                        <tbody>
                            {revoked.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="py-3 text-faint">
                                        No revoked bundles.
                                    </td>
                                </tr>
                            ) : (
                                revoked.map((b) => (
                                    <tr key={b.id} className="border-t border-line/50">
                                        <td className="py-1.5 pr-3 font-mono text-[10px] text-[color:var(--text)]">
                                            {b.id.slice(0, 12)}
                                        </td>
                                        <td className="py-1.5 pr-3 font-mono text-[10px] text-faint">
                                            {b.ownerId ? b.ownerId.slice(0, 12) : '—'}
                                        </td>
                                        <td className="py-1.5 pr-3">{b.productKind ?? '—'}</td>
                                        <td className="py-1.5 pr-3">{b.revokedReason ?? '—'}</td>
                                        <td className="py-1.5">{fmtDate(b.revokedAt)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
