import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, Ticket, Save, X } from 'lucide-react';
import { dbService } from '../../../services/dbService';
import type { MonetizationCouponTemplate } from '../../../services/dbService';
import { useToast } from '../../ui/Toast';
import { POOL_TYPES } from '@shared/poolTypes';

interface Props {
    templates: MonetizationCouponTemplate[];
    locked: boolean;
    /** External prefill (from "Save as template" on a coupon in the Coupons panel). */
    prefill?: TemplateFormState | null;
    onPrefillConsumed?: () => void;
}

export interface TemplateFormState {
    name: string;
    notes: string;
    discountType: 'percentage' | 'flat';
    discountValue: number;
    isActive: boolean;
    maxUses: string;
    perUserLimit: string;
    expiresAt: string; // datetime-local string
    allowedPoolTypes: string[];
}

const EMPTY: TemplateFormState = {
    name: '',
    notes: '',
    discountType: 'percentage',
    discountValue: 20,
    isActive: true,
    maxUses: '',
    perUserLimit: '',
    expiresAt: '',
    allowedPoolTypes: [],
};

const CARD = 'bg-surface border border-line rounded-2xl p-5';
const LABEL = 'text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5 block';
const INPUT =
    'w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] text-xs outline-none font-body placeholder:text-faint';

/** Turn form state into the callable payload (drops empty optionals). */
function toPayload(f: TemplateFormState): Record<string, unknown> {
    const out: Record<string, unknown> = {
        name: f.name.trim(),
        discountType: f.discountType,
        discountValue: Number(f.discountValue),
        isActive: f.isActive,
    };
    if (f.notes.trim()) out.notes = f.notes.trim();
    if (f.maxUses.trim()) out.maxUses = Number(f.maxUses);
    if (f.perUserLimit.trim()) out.perUserLimit = Number(f.perUserLimit);
    if (f.expiresAt) {
        const ms = new Date(f.expiresAt).getTime();
        if (Number.isFinite(ms)) out.expiresAt = ms;
    }
    if (f.allowedPoolTypes.length > 0) out.allowedPoolTypes = f.allowedPoolTypes;
    return out;
}

export const CouponTemplates: React.FC<Props> = ({ templates, locked, prefill, onPrefillConsumed }) => {
    const toast = useToast();
    const [form, setForm] = useState<TemplateFormState>(EMPTY);
    const [editingId, setEditingId] = useState<string>('');
    const [busy, setBusy] = useState(false);
    const [mintFor, setMintFor] = useState<MonetizationCouponTemplate | null>(null);
    const [mintCode, setMintCode] = useState('');

    // Absorb an external "Save as template" prefill.
    useEffect(() => {
        if (prefill) {
            setForm(prefill);
            setEditingId('');
            onPrefillConsumed?.();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefill]);

    const reset = () => {
        setForm(EMPTY);
        setEditingId('');
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) {
            toast.error('Template name is required.');
            return;
        }
        setBusy(true);
        try {
            if (editingId) {
                await dbService.updateCouponTemplate(editingId, toPayload(form));
                toast.success('Template updated.');
            } else {
                await dbService.createCouponTemplate(toPayload(form));
                toast.success('Template created.');
            }
            reset();
        } catch (err) {
            toast.error(`Save failed: ${(err as Error).message}`);
        } finally {
            setBusy(false);
        }
    };

    const startEdit = (t: MonetizationCouponTemplate) => {
        setEditingId(t.id);
        setForm({
            name: t.name ?? '',
            notes: t.notes ?? '',
            discountType: t.discountType ?? 'percentage',
            discountValue: t.discountValue ?? 20,
            isActive: t.isActive ?? true,
            maxUses: t.maxUses != null ? String(t.maxUses) : '',
            perUserLimit: t.perUserLimit != null ? String(t.perUserLimit) : '',
            expiresAt: t.expiresAt ? new Date(t.expiresAt).toISOString().slice(0, 16) : '',
            allowedPoolTypes: t.allowedPoolTypes ?? [],
        });
    };

    const remove = async (t: MonetizationCouponTemplate) => {
        setBusy(true);
        try {
            await dbService.deleteCouponTemplate(t.id);
            toast.success('Template deleted.');
            if (editingId === t.id) reset();
        } catch (err) {
            toast.error(`Delete failed: ${(err as Error).message}`);
        } finally {
            setBusy(false);
        }
    };

    const mint = async () => {
        if (!mintFor) return;
        const code = mintCode.trim().toUpperCase();
        if (!code) {
            toast.error('Enter a code for the new coupon.');
            return;
        }
        setBusy(true);
        try {
            const res = await dbService.mintCouponFromTemplate(mintFor.id, code);
            toast.success(`Minted coupon ${res.code ?? code}.`);
            setMintFor(null);
            setMintCode('');
        } catch (err) {
            toast.error(`Mint failed: ${(err as Error).message}`);
        } finally {
            setBusy(false);
        }
    };

    if (locked) {
        return (
            <div className={CARD}>
                <p className="text-sm text-muted">
                    Coupon templates read <code>couponTemplates</code> (SUPER_ADMIN direct read; writes
                    functions-only). This panel populates once the Wave-5 Firestore rules are live.
                </p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: create / edit form */}
            <form onSubmit={submit} className={`lg:col-span-5 ${CARD} space-y-3`}>
                <h3 className="font-display font-bold text-gold-500 flex items-center gap-1.5 border-b border-line pb-2 text-sm uppercase tracking-[0.08em]">
                    <Ticket size={16} /> {editingId ? 'Edit template' : 'New template'}
                </h3>

                <div>
                    <label className={LABEL}>Name</label>
                    <input
                        className={INPUT}
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="Black Friday"
                        required
                    />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={LABEL}>Discount type</label>
                        <select
                            className={INPUT}
                            value={form.discountType}
                            onChange={(e) =>
                                setForm({ ...form, discountType: e.target.value as 'percentage' | 'flat' })
                            }
                        >
                            <option value="percentage">Percentage</option>
                            <option value="flat">Flat ($)</option>
                        </select>
                    </div>
                    <div>
                        <label className={LABEL}>Value</label>
                        <input
                            type="number"
                            className={INPUT}
                            value={form.discountValue}
                            onChange={(e) => setForm({ ...form, discountValue: Number(e.target.value) })}
                            min={0}
                            step="0.01"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={LABEL}>Max uses (optional)</label>
                        <input
                            type="number"
                            className={INPUT}
                            value={form.maxUses}
                            onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
                            placeholder="Unlimited"
                        />
                    </div>
                    <div>
                        <label className={LABEL}>Per-user limit (optional)</label>
                        <input
                            type="number"
                            className={INPUT}
                            value={form.perUserLimit}
                            onChange={(e) => setForm({ ...form, perUserLimit: e.target.value })}
                            placeholder="No limit"
                        />
                    </div>
                </div>

                <div>
                    <label className={LABEL}>Expires (optional)</label>
                    <input
                        type="datetime-local"
                        className={INPUT}
                        value={form.expiresAt}
                        onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                    />
                </div>

                <div>
                    <label className={LABEL}>Allowed pool types (empty = all)</label>
                    <div className="flex flex-wrap gap-1.5">
                        {POOL_TYPES.map((pt) => {
                            const on = form.allowedPoolTypes.includes(pt);
                            return (
                                <button
                                    key={pt}
                                    type="button"
                                    onClick={() =>
                                        setForm({
                                            ...form,
                                            allowedPoolTypes: on
                                                ? form.allowedPoolTypes.filter((x) => x !== pt)
                                                : [...form.allowedPoolTypes, pt],
                                        })
                                    }
                                    className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${
                                        on ? 'bg-navy-800 text-white' : 'bg-page text-muted border border-line'
                                    }`}
                                >
                                    {pt}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-muted">
                    <input
                        type="checkbox"
                        checked={form.isActive}
                        onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    />
                    minted coupons start active
                </label>

                <div>
                    <label className={LABEL}>Notes (optional)</label>
                    <textarea
                        className={INPUT}
                        rows={2}
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        placeholder="internal memo"
                    />
                </div>

                <div className="flex gap-2 pt-1">
                    <button
                        type="submit"
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-navy-800 text-white rounded-lg text-xs font-display font-bold uppercase tracking-[0.08em] disabled:opacity-50"
                    >
                        {editingId ? <Save size={14} /> : <Plus size={14} />}
                        {editingId ? 'Save' : 'Create'}
                    </button>
                    {editingId && (
                        <button
                            type="button"
                            onClick={reset}
                            className="px-4 py-2 rounded-lg text-xs text-muted border border-line"
                        >
                            Cancel
                        </button>
                    )}
                </div>
            </form>

            {/* Right: template list */}
            <div className="lg:col-span-7 space-y-3">
                {templates.length === 0 ? (
                    <div className={CARD}>
                        <div className="text-sm text-muted">No templates yet. Create one, or use “Save as template” on a coupon.</div>
                    </div>
                ) : (
                    templates.map((t) => (
                        <div key={t.id} className={`${CARD} flex items-start justify-between gap-3`}>
                            <div className="min-w-0">
                                <div className="font-display font-bold text-[color:var(--text)]">{t.name}</div>
                                <div className="text-[11px] text-muted mt-0.5">
                                    {t.discountType === 'percentage'
                                        ? `${t.discountValue ?? 0}% off`
                                        : `$${(t.discountValue ?? 0).toFixed(2)} off`}
                                    {typeof t.maxUses === 'number' && ` · max ${t.maxUses}`}
                                    {typeof t.perUserLimit === 'number' && ` · per-user ${t.perUserLimit}`}
                                    {t.allowedPoolTypes && t.allowedPoolTypes.length > 0 && ` · ${t.allowedPoolTypes.join(', ')}`}
                                </div>
                                {t.notes && <div className="text-[10px] text-faint mt-1">{t.notes}</div>}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                    onClick={() => {
                                        setMintFor(t);
                                        setMintCode('');
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gold-500/10 text-gold-500 border border-gold-500/30 text-[11px] font-bold uppercase tracking-[0.06em]"
                                    title="Mint a real coupon from this template"
                                >
                                    <Ticket size={12} /> Mint
                                </button>
                                <button
                                    onClick={() => startEdit(t)}
                                    className="p-1.5 rounded-lg text-muted hover:text-[color:var(--text)] border border-line"
                                    aria-label="Edit"
                                >
                                    <Pencil size={13} />
                                </button>
                                <button
                                    onClick={() => remove(t)}
                                    className="p-1.5 rounded-lg text-red-500 border border-red-500/30"
                                    aria-label="Delete"
                                >
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Mint dialog */}
            {mintFor && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-surface border border-line rounded-2xl p-6 w-full max-w-sm space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="font-display font-bold text-gold-500 text-sm uppercase tracking-[0.08em]">
                                Mint from “{mintFor.name}”
                            </h3>
                            <button onClick={() => setMintFor(null)} className="text-faint hover:text-[color:var(--text)]">
                                <X size={16} />
                            </button>
                        </div>
                        <p className="text-[11px] text-muted">
                            Creates a real coupon with this code and the template’s discount + constraints. Counters start
                            at zero.
                        </p>
                        <div>
                            <label className={LABEL}>New coupon code</label>
                            <input
                                className={INPUT}
                                value={mintCode}
                                onChange={(e) => setMintCode(e.target.value.replace(/\s/g, '').toUpperCase())}
                                placeholder="BLACKFRIDAY"
                                autoFocus
                            />
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={mint}
                                disabled={busy}
                                className="flex-1 px-4 py-2 bg-navy-800 text-white rounded-lg text-xs font-display font-bold uppercase tracking-[0.08em] disabled:opacity-50"
                            >
                                Mint coupon
                            </button>
                            <button
                                onClick={() => setMintFor(null)}
                                className="px-4 py-2 rounded-lg text-xs text-muted border border-line"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
