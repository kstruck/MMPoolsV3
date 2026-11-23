import React, { useState } from 'react';
import { Eye } from 'lucide-react';
import type { Pool } from '../../types';
import { dbService } from '../../services/dbService';
import { getUserMessage } from '../../utils/errorMessages';
import { useToast } from '../ui/Toast';
import { FieldLabel } from '../ui/Field';
import { sharesHiddenPointsLeft } from '@shared/pointsLeftSharing';

/**
 * "Show Everyone's Pts Left" — the commissioner's switch for
 * `settings.shareHiddenPointsLeft` (PLAN-PTS-LEFT-HIDDEN-TOTAL, Kevin 2026-11-23:
 * "Make this an option for the pool manager to turn on or off"). Pick'em only.
 *
 * ⚠️ Deliberately its OWN card with its OWN save, outside the settings form
 * (codex r1 on the PR). That form is gated on `canEditSettings` (super admin
 * OR pre-season), and this switch only matters DURING the season, when hidden
 * picks exist. Inside the form, a commissioner could never turn off a default-on
 * disclosure at the time it applies. The server allows it in season:
 * `settings` is editable while the pool is open (`shared/editability.ts`), and
 * `flattenSettingsPatch` accepts only a boolean.
 *
 * Saves on change. It is one boolean, and a separate Save button would be a
 * second way for the switch on screen to differ from what is stored.
 */
export const NFLPointsLeftSharingSetting: React.FC<{ pool: Pool }> = ({ pool }) => {
    const toast = useToast();
    const stored = sharesHiddenPointsLeft((pool as { settings?: { shareHiddenPointsLeft?: unknown } }).settings);
    // Optimistic while a save is in flight; otherwise the LIVE pool value, so a
    // change made by a co-commissioner shows up here.
    const [pending, setPending] = useState<boolean | null>(null);
    const shown = pending ?? stored;

    const onChange = async (next: boolean) => {
        setPending(next);
        try {
            await dbService.updatePoolSettings(pool.id, { settings: { shareHiddenPointsLeft: next } });
            toast.success(next
                ? "Everyone's Pts Left and Max are now shown to members."
                : "Other players' Pts Left and Max now show ? until their games kick off.");
        } catch (err) {
            toast.error(getUserMessage(err));
        } finally {
            setPending(null);
        }
    };

    return (
        <div className="bg-card border border-line shadow-card rounded-xl overflow-hidden">
            <div className="p-5 border-b border-line flex items-center gap-2 bg-surface">
                <Eye size={14} className="text-navy-700 dark:text-gold-400" />
                <h4 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Points Left</h4>
            </div>
            <div className="p-6">
                <div className="flex items-center justify-between gap-4 bg-page border border-line rounded-md px-4 py-3">
                    <div>
                        <FieldLabel tone="muted" htmlFor="share-points-left" helpId="settings.shareHiddenPointsLeft">Show Everyone&apos;s Pts Left</FieldLabel>
                        <p className="font-body text-[10px] text-faint">
                            Members see each player&apos;s Pts Left and Max before their remaining games kick off.
                            Only a total is shared, never which team or which game. Can be changed at any time.
                        </p>
                    </div>
                    <input
                        id="share-points-left"
                        type="checkbox"
                        checked={shown}
                        disabled={pending !== null}
                        onChange={e => { void onChange(e.target.checked); }}
                        className="w-5 h-5 shrink-0 rounded border-line text-navy-700 focus:ring-navy-600 dark:focus:ring-gold-500 cursor-pointer disabled:cursor-wait"
                    />
                </div>
            </div>
        </div>
    );
};
