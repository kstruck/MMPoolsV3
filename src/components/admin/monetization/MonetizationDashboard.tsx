import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Ticket, Package, UserSearch, ShieldAlert, LayoutTemplate } from 'lucide-react';
import { dbService } from '../../../services/dbService';
import type {
    MonetizationBillingCharge,
    MonetizationCoupon,
    MonetizationBundle,
    MonetizationAlert,
    MonetizationCouponTemplate,
} from '../../../services/dbService';
import type { Pool } from '../../../types';
import { AccountingView } from './AccountingView';
import { CouponUsagePanel } from './CouponUsagePanel';
import { BundleLiabilityPanel } from './BundleLiabilityPanel';
import { UserMoneyProfile } from './UserMoneyProfile';
import { AlertCenter } from './AlertCenter';
import { CouponTemplates, type TemplateFormState } from './CouponTemplates';

type MoneyTab = 'accounting' | 'coupons' | 'bundles' | 'user' | 'alerts' | 'templates';

const TABS: { id: MoneyTab; label: string; icon: React.ReactNode }[] = [
    { id: 'accounting', label: 'Accounting', icon: <BarChart3 size={15} /> },
    { id: 'coupons', label: 'Coupons', icon: <Ticket size={15} /> },
    { id: 'bundles', label: 'Bundle liability', icon: <Package size={15} /> },
    { id: 'user', label: 'User profile', icon: <UserSearch size={15} /> },
    { id: 'alerts', label: 'Alerts', icon: <ShieldAlert size={15} /> },
    { id: 'templates', label: 'Templates', icon: <LayoutTemplate size={15} /> },
];

/**
 * The Monetization tab surface (PLAN-BUYFLOW-OVERHAUL Phase 6 #21-23) — the
 * Super-Admin's money-management + troubleshooting screen. Owns the SUPER_ADMIN
 * reads (billingCharges / coupons / bundles / monetization_alerts /
 * couponTemplates), tracks per-collection lock state (permission-denied until
 * the Wave-5 rules land → the sub-panel shows a locked message instead of
 * crashing), and mounts the six views.
 */
export const MonetizationDashboard: React.FC = () => {
    const [tab, setTab] = useState<MoneyTab>('accounting');

    const [charges, setCharges] = useState<MonetizationBillingCharge[]>([]);
    const [coupons, setCoupons] = useState<MonetizationCoupon[]>([]);
    const [bundles, setBundles] = useState<MonetizationBundle[]>([]);
    const [alerts, setAlerts] = useState<MonetizationAlert[]>([]);
    const [templates, setTemplates] = useState<MonetizationCouponTemplate[]>([]);
    const [pools, setPools] = useState<Pool[]>([]);

    const [locks, setLocks] = useState({
        charges: false,
        coupons: false,
        bundles: false,
        alerts: false,
        templates: false,
    });
    const lock = (k: keyof typeof locks) => setLocks((prev) => ({ ...prev, [k]: true }));

    // "Save as template" handoff from the Coupons panel to the Templates form.
    const [templatePrefill, setTemplatePrefill] = useState<TemplateFormState | null>(null);

    useEffect(() => {
        const unsubs: Array<() => void> = [];
        unsubs.push(
            dbService.subscribeToBillingCharges(setCharges, () => lock('charges')),
            dbService.subscribeToCoupons(setCoupons, () => lock('coupons')),
            dbService.subscribeToAllBundles(setBundles, () => lock('bundles')),
            dbService.subscribeToMonetizationAlerts(setAlerts, () => lock('alerts')),
            dbService.subscribeToCouponTemplates(setTemplates, () => lock('templates')),
            dbService.subscribeToAllPools(
                (p) => setPools(p),
                () => {
                    /* pools already have permissive admin rules; ignore */
                }
            )
        );
        return () => unsubs.forEach((u) => u && u());
    }, []);

    const openAlertCount = useMemo(() => alerts.filter((a) => a.status !== 'acked').length, [alerts]);

    const saveCouponAsTemplate = (coupon: MonetizationCoupon) => {
        setTemplatePrefill({
            name: `Template from ${coupon.code}`,
            notes: '',
            discountType: coupon.discountType ?? 'percentage',
            discountValue: coupon.discountValue ?? 0,
            isActive: coupon.isActive ?? true,
            maxUses: coupon.maxUses != null ? String(coupon.maxUses) : '',
            perUserLimit: coupon.perUserLimit != null ? String(coupon.perUserLimit) : '',
            expiresAt: coupon.expiresAt ? new Date(coupon.expiresAt).toISOString().slice(0, 16) : '',
            allowedPoolTypes: coupon.allowedPoolTypes ?? [],
        });
        setTab('templates');
    };

    return (
        <div className="space-y-5">
            {/* Sub-tab nav */}
            <div className="flex flex-wrap gap-1.5 border-b border-line pb-3">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-display font-bold uppercase tracking-[0.06em] ${
                            tab === t.id
                                ? 'bg-navy-800 text-white'
                                : 'text-muted hover:text-[color:var(--text)]'
                        }`}
                    >
                        {t.icon}
                        {t.label}
                        {t.id === 'alerts' && openAlertCount > 0 && (
                            <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] leading-none">
                                {openAlertCount}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {tab === 'accounting' && <AccountingView charges={charges} locked={locks.charges} />}
            {tab === 'coupons' && (
                <CouponUsagePanel
                    coupons={coupons}
                    locked={locks.coupons}
                    onSaveAsTemplate={saveCouponAsTemplate}
                />
            )}
            {tab === 'bundles' && <BundleLiabilityPanel bundles={bundles} locked={locks.bundles} />}
            {tab === 'user' && (
                <UserMoneyProfile
                    charges={charges}
                    coupons={coupons}
                    bundles={bundles}
                    pools={pools}
                    locked={locks.charges && locks.coupons && locks.bundles}
                />
            )}
            {tab === 'alerts' && <AlertCenter alerts={alerts} coupons={coupons} locked={locks.alerts} />}
            {tab === 'templates' && (
                <CouponTemplates
                    templates={templates}
                    locked={locks.templates}
                    prefill={templatePrefill}
                    onPrefillConsumed={() => setTemplatePrefill(null)}
                />
            )}
        </div>
    );
};
