import React, { useState, useEffect } from 'react';
import { useOverlayOwner } from '../ui/overlayStack';
import { AlertTriangle, X } from 'lucide-react';

/**
 * Reusable guardrail modal (T7) for admin/destructive actions. Explains what
 * the action does and its blast radius before it runs; for destructive actions
 * (confirmToken set) the operator must type the token to enable Confirm.
 * Shared by the Operations tab, closePool (T2), and role changes (T6).
 */
export interface ConfirmActionModalProps {
  open: boolean;
  title: string;
  description: string;
  /** Human-readable scope, e.g. "Affects 1 pool" / "Runs 12,000 writes". */
  blastRadius?: string;
  /** If set, the operator must type this exact string to enable Confirm. */
  confirmToken?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmActionModal: React.FC<ConfirmActionModalProps> = ({
  open,
  title,
  description,
  blastRadius,
  confirmToken,
  confirmLabel = 'Confirm',
  destructive = false,
  onConfirm,
  onCancel,
}) => {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  // PLAN-HELP-SYSTEM T2: own the screen while open, so the `?` shortcut stays
  // quiet and Escape closes exactly one overlay. On `open`, not on mount.
  useOverlayOwner('confirm-action-modal', { active: open, onEscape: onCancel });

  if (!open) return null;

  const tokenOk = !confirmToken || typed === confirmToken;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${destructive ? 'bg-rose-500/15 text-rose-400' : 'bg-indigo-500/15 text-indigo-400'}`}>
              <AlertTriangle size={20} />
            </div>
            <h3 className="text-lg font-black text-white">{title}</h3>
          </div>
          <button aria-label="Cancel" onClick={onCancel} className="text-slate-500 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-slate-300 mb-3">{description}</p>
        {blastRadius && (
          <p className="text-xs font-bold uppercase tracking-wider text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 mb-4">
            {blastRadius}
          </p>
        )}

        {confirmToken && (
          <div className="mb-4">
            <label className="text-xs text-slate-400 block mb-1">
              Type <span className="font-mono text-white">{confirmToken}</span> to confirm
            </label>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-indigo-500"
              autoFocus
            />
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!tokenOk}
            className={`px-4 py-2 rounded-xl font-bold text-sm text-white disabled:opacity-40 disabled:cursor-not-allowed ${destructive ? 'bg-rose-600 hover:bg-rose-500' : 'bg-indigo-600 hover:bg-indigo-500'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
