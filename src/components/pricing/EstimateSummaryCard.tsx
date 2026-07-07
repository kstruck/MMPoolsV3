import React from 'react';
import { Sparkles } from 'lucide-react';
import type { BillingConfig } from '../../types';

interface EstimateSummaryCardProps {
    config: BillingConfig;
    poolType: string;
    players: number;
    hasAiCommissioner: boolean;
    hasSmsNotifications: boolean;
    hasWhatIfSimulator: boolean;
    hasCustomBranding: boolean;
}

/** Mirrors BillingInvoiceCard's tier lookup so the estimate matches checkout pricing. */
const getBasePrice = (config: BillingConfig, poolType: string, players: number): number => {
    const count = Number(players) || 0;

    // Free tier exemption
    if (count <= config.freePlayerThreshold) return 0;

    const pType = poolType.toUpperCase();
    let tiers = config.pricing.season || [];
    if (pType === 'SQUARES') tiers = config.pricing.squares || [];
    else if (pType === 'PROPS') tiers = config.pricing.props || [];
    else if (pType === 'BRACKET' || pType === 'NFL_PLAYOFFS') tiers = config.pricing.bracket || [];

    if (!Array.isArray(tiers) || tiers.length === 0) return 0;

    const matched = tiers.find(t => count >= t.min && count <= t.max);
    if (matched) return matched.price;

    const sorted = [...tiers].sort((a, b) => b.min - a.min);
    return sorted[0]?.price ?? 0;
};

/**
 * Read-only hosting quote for visitors who cannot check out yet (anonymous or
 * no trial pools). Deliberately NOT a payment card: no pay button, no coupon
 * input — purchasing happens from a launched pool.
 */
export const EstimateSummaryCard: React.FC<EstimateSummaryCardProps> = ({
    config,
    poolType,
    players,
    hasAiCommissioner,
    hasSmsNotifications,
    hasWhatIfSimulator,
    hasCustomBranding
}) => {
    const basePrice = getBasePrice(config, poolType, players);
    const aiCost = (hasAiCommissioner && config.features.aiCommissioner?.isPremium) ? config.features.aiCommissioner.addonPrice : 0;
    const smsCost = (hasSmsNotifications && config.features.smsNotifications?.isPremium) ? config.features.smsNotifications.addonPrice : 0;
    const simCost = (hasWhatIfSimulator && config.features.whatIfSimulator?.isPremium) ? config.features.whatIfSimulator.addonPrice : 0;
    const brandingCost = (hasCustomBranding && config.features.customBranding?.isPremium) ? config.features.customBranding.addonPrice : 0;
    const total = basePrice + aiCost + smsCost + simCost + brandingCost;
    const isFreeTier = (Number(players) || 0) <= config.freePlayerThreshold;

    return (
        <div className="bg-card border border-line rounded-3xl p-6 space-y-4 shadow-panel">
            <div className="flex items-start justify-between gap-3">
                <h4 className="text-sm font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-1.5">
                    <Sparkles size={16} className="text-gold-600 dark:text-gold-400" /> Estimated Hosting Quote
                </h4>
                <span className="bg-gold-500/10 border border-gold-500/25 text-gold-600 dark:text-gold-400 font-display font-bold text-[9px] uppercase tracking-[0.08em] px-2 py-0.5 rounded-full shrink-0">
                    Estimate Only
                </span>
            </div>

            <div className="bg-surface border border-line rounded-2xl p-4 space-y-2.5">
                <div className="flex justify-between items-center text-muted text-xs gap-3">
                    <span className="capitalize">Base hosting — {poolType.toLowerCase().replace(/_/g, ' ')} (<span className="num">{players}</span> players)</span>
                    <span className="font-mono num text-gold-700 dark:text-gold-400 font-bold shrink-0">
                        {basePrice === 0 ? 'FREE' : `$${basePrice.toFixed(2)}`}
                    </span>
                </div>
                {aiCost > 0 && (
                    <div className="flex justify-between items-center text-muted text-xs gap-3">
                        <span>AI Commissioner Newsletter</span>
                        <span className="font-mono num text-gold-700 dark:text-gold-400 font-bold shrink-0">+${aiCost.toFixed(2)}</span>
                    </div>
                )}
                {smsCost > 0 && (
                    <div className="flex justify-between items-center text-muted text-xs gap-3">
                        <span>Smart SMS Broadcasts</span>
                        <span className="font-mono num text-gold-700 dark:text-gold-400 font-bold shrink-0">+${smsCost.toFixed(2)}</span>
                    </div>
                )}
                {simCost > 0 && (
                    <div className="flex justify-between items-center text-muted text-xs gap-3">
                        <span>Standings What-If Simulator</span>
                        <span className="font-mono num text-gold-700 dark:text-gold-400 font-bold shrink-0">+${simCost.toFixed(2)}</span>
                    </div>
                )}
                {brandingCost > 0 && (
                    <div className="flex justify-between items-center text-muted text-xs gap-3">
                        <span>Premium Custom Branding &amp; Covers</span>
                        <span className="font-mono num text-gold-700 dark:text-gold-400 font-bold shrink-0">+${brandingCost.toFixed(2)}</span>
                    </div>
                )}

                <div className="flex justify-between items-center border-t border-line pt-3 mt-1 text-[color:var(--text)] font-bold">
                    <span className="text-sm font-display uppercase tracking-[0.05em]">Estimated Total</span>
                    <span className="text-lg font-mono num text-gold-700 dark:text-gold-400 font-bold">
                        {total === 0 ? 'FREE' : `$${total.toFixed(2)}`}
                    </span>
                </div>
            </div>

            {isFreeTier && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-body leading-relaxed flex items-center gap-1.5">
                    <Sparkles size={12} className="shrink-0" /> Pools with <span className="num">{config.freePlayerThreshold}</span> players or fewer are free to host.
                </p>
            )}

            <p className="text-[10px] font-display font-bold uppercase tracking-[0.08em] text-faint">
                Estimate only — launch a pool to purchase
            </p>
        </div>
    );
};
