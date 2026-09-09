import React, { useState } from 'react';
import { Palette } from 'lucide-react';
import type { Pool } from '../../types';
import { dbService } from '../../services/dbService';
import { getUserMessage } from '../../utils/errorMessages';
import { useToast } from '../ui/Toast';
import { brandingStyles, isValidHex, normalizeHex, DEFAULT_ACCENT } from '../../utils/brandingStyles';

/**
 * Post-wizard branding editor (PLAN-WIZARD-BUYFLOW-FIXES T8, Kevin 2026-08-23).
 *
 * Before this, the wizard's branding step was the ONLY writer: a commissioner
 * who typed the wrong hex, or wanted a logo later, had no way to change it
 * without recreating the pool.
 *
 * ⚠️ Deliberately its OWN card with its OWN save, NOT part of the big settings
 * form. That form is gated on `canEditSettings` (super admin OR pre-season),
 * because pool RULES must not move once the season is running. Branding is not
 * a rule — and the server agrees: `shared/editability.ts` lists `branding` in
 * `open`, `locked` AND `archived`. Folding it into the gated form would lock a
 * commissioner out of fixing their own logo in week 3 for no reason the server
 * asks for.
 *
 * The colour controls mirror the wizard's `ColorField` (a native swatch beside
 * the hex box, and an invalid hex called out rather than silently ignored) but
 * are plain controlled inputs: this view has no react-hook-form context, and
 * dragging one in for three fields would be the larger change.
 */

interface NFLBrandingSettingsProps {
    pool: Pool;
}

function ColorRow(props: {
    label: string;
    hint: string;
    value: string;
    onChange: (v: string) => void;
    fallback: string;
    placeholder: string;
}) {
    const { label, hint, value, onChange, fallback, placeholder } = props;
    const trimmed = value.trim();
    const valid = isValidHex(trimmed);
    // `<input type="color">` has no empty state — it shows #000000 for anything
    // it cannot parse — so the swatch falls back for DISPLAY while the stored
    // value stays empty. Reading the swatch as the value would turn "no colour
    // chosen" into "black chosen" for every pool.
    const swatch = valid ? normalizeHex(trimmed)! : fallback;

    return (
        <div>
            <label className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-muted block mb-1.5">
                {label}
            </label>
            <div className="flex items-center gap-2">
                <input
                    type="color"
                    aria-label={`${label} — colour picker`}
                    value={swatch}
                    onChange={(e) => onChange(e.target.value)}
                    className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-line bg-page p-1"
                />
                <input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className="w-full font-body bg-page border border-line rounded-md px-3 py-2 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500"
                />
            </div>
            <p className="mt-1 text-[11px] text-faint">{hint}</p>
            {trimmed && !valid && (
                <p className="mt-1 text-[11px] font-semibold text-amber-600 dark:text-amber-300">
                    Use a hex colour like <code>#4f46e5</code>. Anything else is ignored and the pool keeps the default.
                </p>
            )}
        </div>
    );
}

export const NFLBrandingSettings: React.FC<NFLBrandingSettingsProps> = ({ pool }) => {
    const toast = useToast();
    const stored = ((pool as { branding?: Record<string, unknown> }).branding ?? {}) as Record<string, unknown> & {
        logoUrl?: string; primaryColor?: string; secondaryColor?: string;
    };

    const [logoUrl, setLogoUrl] = useState(stored.logoUrl ?? '');
    const [primaryColor, setPrimaryColor] = useState(stored.primaryColor ?? '');
    const [secondaryColor, setSecondaryColor] = useState(stored.secondaryColor ?? '');
    const [saving, setSaving] = useState(false);

    // The preview is built from the SAME helper the pool page paints with, so it
    // cannot drift into promising a look the pool will not have.
    const brand = brandingStyles({ logoUrl, primaryColor, secondaryColor });

    const save = async () => {
        setSaving(true);
        try {
            await dbService.updatePoolSettings(pool.id, {
                branding: {
                    // ⚠️ SPREAD the stored map first (codex [P2]). This write
                    // REPLACES `branding` wholesale, so sending only these three
                    // fields would silently delete anything else a pool carries
                    // — notably the legacy `bgColor`, which `brandingStyles`
                    // still renders as the page background. Changing a logo
                    // would have wiped an older pool's background colour.
                    ...stored,
                    logoUrl: logoUrl.trim(),
                    primaryColor: primaryColor.trim(),
                    secondaryColor: secondaryColor.trim(),
                },
            });
            toast.success('Branding saved. Your pool page updates for everyone.');
        } catch (err) {
            toast.error(getUserMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-card border border-line shadow-card rounded-xl overflow-hidden">
            <div className="p-5 border-b border-line flex items-center gap-2 bg-surface">
                <Palette size={14} className="text-navy-700 dark:text-gold-400" />
                <h4 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Pool Branding</h4>
            </div>

            <div className="p-6 space-y-5">
                <p className="font-body text-muted text-xs leading-relaxed">
                    Your logo and colours on the pool page every member sees. Included with every pool,
                    and editable at any time — unlike pool rules, these are not locked once the season starts.
                </p>

                <div>
                    <label className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-muted block mb-1.5">
                        Logo URL
                    </label>
                    <input
                        type="text"
                        value={logoUrl}
                        onChange={(e) => setLogoUrl(e.target.value)}
                        placeholder="https://…"
                        className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500"
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ColorRow
                        label="Primary color"
                        hint="Header and primary buttons."
                        value={primaryColor}
                        onChange={setPrimaryColor}
                        fallback="#4f46e5"
                        placeholder="#4f46e5"
                    />
                    <ColorRow
                        label="Accent color"
                        hint="Highlights and the active tab."
                        value={secondaryColor}
                        onChange={setSecondaryColor}
                        fallback={DEFAULT_ACCENT}
                        placeholder={DEFAULT_ACCENT}
                    />
                </div>

                <div>
                    <p className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-muted mb-1.5">Preview</p>
                    <div className="rounded-lg border border-line p-3" style={brand.page}>
                        <div className="overflow-hidden rounded-lg border border-line bg-card" style={brand.headerCard}>
                            {/* Same header band the pool page paints. Both previews
                                render it, or one of them starts lying. (codex.) */}
                            {brand.themed && (
                                <div className="px-3 py-2.5 text-sm font-bold" style={brand.headerBand}>
                                    {pool.name}
                                </div>
                            )}
                            <div className="p-3">
                            <div className="flex items-center justify-between gap-3">
                                {!brand.themed && (
                                    <span className="truncate text-sm font-bold text-[color:var(--text)]">{pool.name}</span>
                                )}
                                <span className="ml-auto rounded-md border px-3 py-1 text-xs font-bold" style={brand.primaryButton}>
                                    Make Picks
                                </span>
                            </div>
                            <div className="mt-3 flex gap-4 text-xs text-muted">
                                <span className="border-b-2 pb-1 font-semibold text-[color:var(--text)]" style={brand.activeTabUnderline}>
                                    Dashboard
                                </span>
                                <span className="border-b-2 border-transparent pb-1">Standings</span>
                                <span className="border-b-2 border-transparent pb-1">Rules</span>
                            </div>
                            </div>
                        </div>
                    </div>
                    {!brand.themed && (
                        <p className="mt-1 text-[11px] text-faint">
                            No primary colour set — your pool uses the standard theme.
                        </p>
                    )}
                </div>

                <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="bg-brandred-600 hover:bg-brandred-500 text-white px-6 py-2.5 rounded-md font-display font-bold uppercase text-[11px] tracking-[0.08em] transition-ui disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {saving ? 'Saving…' : 'Save branding'}
                </button>
            </div>
        </div>
    );
};
