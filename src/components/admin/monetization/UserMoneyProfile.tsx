import React, { useMemo, useState } from 'react';
import { Search, ExternalLink } from 'lucide-react';
import { dbService } from '../../../services/dbService';
import type {
    MonetizationBillingCharge,
    MonetizationBundle,
    MonetizationCoupon,
} from '../../../services/dbService';
import type { Pool, User } from '../../../types';
import { fmtUSD, fmtDateTime, fmtDate, stripePaymentLink } from './monetizationCalcs';

interface Props {
    charges: MonetizationBillingCharge[];
    coupons: MonetizationCoupon[];
    bundles: MonetizationBundle[];
    pools: Pool[];
    locked: boolean;
}

const CARD = 'bg-surface border border-line rounded-2xl p-5';
const LABEL = 'text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em]';

/**
 * One-screen troubleshooting surface: search a user (email or uid) → resolve
 * them, then show their charges, coupons used, entitlements (bundles+credits),
 * pools with billing state, and legacy referral credits — everything the owner
 * needs to resolve a money issue in one place.
 */
export const UserMoneyProfile: React.FC<Props> = ({ charges, coupons, bundles, pools, locked }) => {
    const [queryText, setQueryText] = useState('');
    const [resolved, setResolved] = useState<User | null>(null);
    const [candidates, setCandidates] = useState<User[]>([]);
    const [searching, setSearching] = useState(false);
    const [note, setNote] = useState('');

    // The users collection is keyed by Firebase Auth uid, so User.id === the uid
    // that billingCharges.userId / bundles.ownerId reference.
    const uid = resolved?.id ?? '';

    const userCharges = useMemo(() => charges.filter((c) => c.userId === uid), [charges, uid]);
    const userBundles = useMemo(() => bundles.filter((b) => b.ownerId === uid), [bundles, uid]);
    const userPools = useMemo(() => pools.filter((p) => p.ownerId === uid), [pools, uid]);
    // Coupons this user has used (any live usageLog entry with their uid).
    const userCoupons = useMemo(
        () =>
            coupons
                .map((c) => ({
                    coupon: c,
                    uses: (c.usageLog ?? []).filter((e) => e.userId === uid),
                }))
                .filter((x) => x.uses.length > 0),
        [coupons, uid]
    );

    const runSearch = async () => {
        const q = queryText.trim();
        if (!q) return;
        setSearching(true);
        setNote('');
        setCandidates([]);
        try {
            if (q.includes('@')) {
                const users = await dbService.searchUsersByEmail(q, 10);
                if (users.length === 0) {
                    setNote('No user found for that email.');
                    setResolved(null);
                } else if (users.length === 1) {
                    setResolved(users[0]);
                } else {
                    setCandidates(users);
                    setResolved(null);
                }
            } else {
                // Treat as a uid — pull from the already-loaded user list.
                const all = await dbService.getAllUsers();
                const match = all.find((u) => u.id === q);
                if (match) setResolved(match);
                else {
                    setNote('No user found for that uid.');
                    setResolved(null);
                }
            }
        } catch (e) {
            setNote(`Search failed: ${(e as Error).message}`);
        } finally {
            setSearching(false);
        }
    };

    if (locked) {
        return (
            <div className={CARD}>
                <p className="text-sm text-muted">
                    The user money profile reads billing collections that require a SUPER_ADMIN
                    session + the Wave-5 Firestore rules. It populates once those are live.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Search */}
            <div className={CARD}>
                <div className={`${LABEL} mb-2`}>Find a user (email or uid)</div>
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                        <input
                            value={queryText}
                            onChange={(e) => setQueryText(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                            placeholder="jane@example.com or a uid"
                            className="w-full pl-9 pr-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] text-xs outline-none font-body placeholder:text-faint"
                        />
                    </div>
                    <button
                        onClick={runSearch}
                        disabled={searching}
                        className="px-4 py-2 bg-navy-800 text-white rounded-lg text-xs font-display font-bold uppercase tracking-[0.08em] disabled:opacity-50"
                    >
                        {searching ? 'Searching…' : 'Search'}
                    </button>
                </div>
                {note && <div className="text-xs text-red-500 mt-2">{note}</div>}
                {candidates.length > 0 && (
                    <div className="mt-3 space-y-1">
                        <div className="text-[10px] text-faint uppercase tracking-[0.08em]">Multiple matches:</div>
                        {candidates.map((u) => (
                            <button
                                key={u.id}
                                onClick={() => {
                                    setResolved(u);
                                    setCandidates([]);
                                }}
                                className="block w-full text-left px-3 py-1.5 rounded-lg hover:bg-page text-xs"
                            >
                                <span className="text-[color:var(--text)]">{u.email}</span>{' '}
                                <span className="font-mono text-faint">{u.id.slice(0, 10)}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {resolved && (
                <>
                    {/* Identity + legacy credits */}
                    <div className={CARD}>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <div>
                                <div className="text-lg font-display font-bold text-[color:var(--text)]">
                                    {resolved.email}
                                </div>
                                <div className="font-mono text-[10px] text-faint">{resolved.id}</div>
                            </div>
                            <div className="text-right text-[11px] text-faint">
                                <div>role: {resolved.role ?? '—'}</div>
                                <div>joined {fmtDate(resolved.createdAt)}</div>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                            <div>
                                <div className={LABEL}>Referral credits</div>
                                <div className="text-base font-bold text-[color:var(--text)]">
                                    {resolved.referralCredits ?? 0}
                                </div>
                            </div>
                            <div>
                                <div className={LABEL}>Free pools (legacy)</div>
                                <div className="text-base font-bold text-[color:var(--text)]">
                                    {resolved.freePoolsAvailable ?? 0}
                                </div>
                            </div>
                            <div>
                                <div className={LABEL}>Legacy pool credits</div>
                                <div className="text-base font-bold text-[color:var(--text)]">
                                    {resolved.poolCredits?.length ?? 0}
                                </div>
                            </div>
                            <div>
                                <div className={LABEL}>Charges on file</div>
                                <div className="text-base font-bold text-[color:var(--text)]">{userCharges.length}</div>
                            </div>
                        </div>
                    </div>

                    {/* Charges */}
                    <div className={CARD}>
                        <div className={`${LABEL} mb-3`}>Charges</div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-left text-faint">
                                        <th className="py-1.5 pr-3">When</th>
                                        <th className="py-1.5 pr-3">Kind</th>
                                        <th className="py-1.5 pr-3 text-right">Amount</th>
                                        <th className="py-1.5 pr-3">Coupon</th>
                                        <th className="py-1.5">Stripe</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {userCharges.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="py-3 text-faint">
                                                No charges.
                                            </td>
                                        </tr>
                                    ) : (
                                        userCharges.map((c) => (
                                            <tr key={c.id} className="border-t border-line/50">
                                                <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDateTime(c.at)}</td>
                                                <td className="py-1.5 pr-3">{c.kind ?? 'pool'}</td>
                                                <td
                                                    className={`py-1.5 pr-3 text-right font-bold ${
                                                        (c.amount ?? 0) < 0 ? 'text-red-500' : ''
                                                    }`}
                                                >
                                                    {fmtUSD(c.amount ?? 0)}
                                                </td>
                                                <td className="py-1.5 pr-3 font-mono text-[10px]">{c.couponCode ?? '—'}</td>
                                                <td className="py-1.5">
                                                    <a
                                                        href={stripePaymentLink(c.paymentIntentId)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1 text-gold-500 hover:underline"
                                                    >
                                                        <ExternalLink size={12} /> view
                                                    </a>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Entitlements (bundles) */}
                    <div className={CARD}>
                        <div className={`${LABEL} mb-3`}>Entitlements (bundles + credits)</div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-left text-faint">
                                        <th className="py-1.5 pr-3">Bundle</th>
                                        <th className="py-1.5 pr-3">Kind</th>
                                        <th className="py-1.5 pr-3">Source</th>
                                        <th className="py-1.5 pr-3 text-right">Used / total</th>
                                        <th className="py-1.5 pr-3">Status</th>
                                        <th className="py-1.5">Term ends</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {userBundles.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="py-3 text-faint">
                                                No bundles.
                                            </td>
                                        </tr>
                                    ) : (
                                        userBundles.map((b) => (
                                            <tr key={b.id} className="border-t border-line/50">
                                                <td className="py-1.5 pr-3 font-mono text-[10px]">{b.id.slice(0, 12)}</td>
                                                <td className="py-1.5 pr-3">{b.productKind ?? '—'}</td>
                                                <td className="py-1.5 pr-3">{b.source ?? '—'}</td>
                                                <td className="py-1.5 pr-3 text-right">
                                                    {b.productKind === 'UNLIMITED_PASS'
                                                        ? '—'
                                                        : `${b.creditsUsed ?? 0} / ${b.creditsTotal ?? 0}`}
                                                </td>
                                                <td className="py-1.5 pr-3">{b.status ?? '—'}</td>
                                                <td className="py-1.5">{b.termEndsAt ? fmtDate(b.termEndsAt) : '—'}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Coupons used */}
                    <div className={CARD}>
                        <div className={`${LABEL} mb-3`}>Coupons used</div>
                        {userCoupons.length === 0 ? (
                            <div className="text-xs text-faint">None.</div>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {userCoupons.map(({ coupon, uses }) => (
                                    <span
                                        key={coupon.id}
                                        className="px-2.5 py-1 rounded-lg bg-navy-800/30 border border-line text-[11px]"
                                    >
                                        <span className="font-mono font-bold text-[color:var(--text)]">{coupon.code}</span>{' '}
                                        <span className="text-faint">
                                            ×{uses.filter((u) => u.status !== 'released').length}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Pools with billing state */}
                    <div className={CARD}>
                        <div className={`${LABEL} mb-3`}>Pools + billing state</div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-left text-faint">
                                        <th className="py-1.5 pr-3">Pool</th>
                                        <th className="py-1.5 pr-3">Status</th>
                                        <th className="py-1.5 pr-3">Tier</th>
                                        <th className="py-1.5 pr-3 text-right">Paid</th>
                                        <th className="py-1.5 pr-3">Coupon</th>
                                        <th className="py-1.5 text-right">Cap</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {userPools.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="py-3 text-faint">
                                                No pools owned.
                                            </td>
                                        </tr>
                                    ) : (
                                        userPools.map((p) => {
                                            const b = p.billing;
                                            return (
                                                <tr key={p.id} className="border-t border-line/50">
                                                    <td className="py-1.5 pr-3 text-[color:var(--text)]">
                                                        {p.name ?? p.id.slice(0, 10)}
                                                    </td>
                                                    <td className="py-1.5 pr-3">{b?.status ?? '—'}</td>
                                                    <td className="py-1.5 pr-3">{b?.tier ?? '—'}</td>
                                                    <td className="py-1.5 pr-3 text-right">
                                                        {typeof b?.pricePaid === 'number' ? fmtUSD(b.pricePaid) : '—'}
                                                    </td>
                                                    <td className="py-1.5 pr-3 font-mono text-[10px]">
                                                        {b?.couponCode ?? '—'}
                                                    </td>
                                                    <td className="py-1.5 text-right text-faint">
                                                        {b?.maxPlayersAllowed ?? '—'}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
