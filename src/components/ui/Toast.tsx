import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MODAL_TRANSITION, TOAST_TRANSITION } from './motion';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useOverlayOwner } from './overlayStack';

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
    id: number;
    kind: ToastKind;
    message: string;
}

interface ConfirmOptions {
    title: string;
    message: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Use for destructive/money actions — styles the confirm button red */
    danger?: boolean;
}

interface ToastContextValue {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
    confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = (): ToastContextValue => {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
    return ctx;
};

/** Promise-based replacement for window.confirm() */
export const useConfirm = () => useToast().confirm;

const KIND_STYLES: Record<ToastKind, { box: string; Icon: typeof Info }> = {
    success: { box: 'border-[#BEE7D0]/40 bg-[#0F3D28]/95 text-[#BEE7D0]', Icon: CheckCircle2 },
    error: { box: 'border-brandred-500/50 bg-[#3A1210]/95 text-[#F5C6C3]', Icon: AlertCircle },
    info: { box: 'border-gold-500/40 bg-navy-900/95 text-gold-300', Icon: Info },
};

let nextId = 1;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
    const confirmButtonRef = useRef<HTMLButtonElement>(null);

    const dismiss = useCallback((id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const push = useCallback((kind: ToastKind, message: string) => {
        const id = nextId++;
        setToasts(prev => [...prev.slice(-3), { id, kind, message }]);
        // Errors linger longer — users need time to read what went wrong
        const ttl = kind === 'error' ? 8000 : 5000;
        window.setTimeout(() => dismiss(id), ttl);
    }, [dismiss]);

    const confirm = useCallback((options: ConfirmOptions) => {
        return new Promise<boolean>(resolve => {
            setConfirmState({ ...options, resolve });
        });
    }, []);

    const resolveConfirm = useCallback((ok: boolean) => {
        setConfirmState(prev => {
            prev?.resolve(ok);
            return null;
        });
    }, []);

    // PLAN-HELP-SYSTEM T2: the confirm modal that replaced `window.confirm()` is
    // the sixth accessible dialog in `src/`. It owns the screen only while a
    // confirmation is pending, so the `?` shortcut is quiet then and Escape
    // closes exactly one overlay.
    useOverlayOwner('toast-confirm', {
        active: confirmState !== null,
        onEscape: () => resolveConfirm(false),
    });

    useEffect(() => {
        if (!confirmState) return;
        confirmButtonRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') resolveConfirm(false);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [confirmState, resolveConfirm]);

    const value = React.useMemo<ToastContextValue>(() => ({
        success: (m: string) => push('success', m),
        error: (m: string) => push('error', m),
        info: (m: string) => push('info', m),
        confirm,
    }), [push, confirm]);

    return (
        <ToastContext.Provider value={value}>
            {children}

            {/* Toast stack — bottom-center so it's thumb-visible on mobile */}
            <div
                aria-live="polite"
                className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-md pointer-events-none"
            >
                <AnimatePresence>
                    {toasts.map(t => {
                        const { box, Icon } = KIND_STYLES[t.kind];
                        return (
                            <motion.div
                                key={t.id}
                                initial={{ opacity: 0, transform: 'translateY(16px)' }}
                                animate={{ opacity: 1, transform: 'translateY(0px)' }}
                                exit={{ opacity: 0, transform: 'translateY(8px)' }}
                                transition={TOAST_TRANSITION}
                                role={t.kind === 'error' ? 'alert' : 'status'}
                                className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur ${box}`}
                            >
                                <Icon size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
                                <p className="text-sm font-semibold flex-1">{t.message}</p>
                                <button
                                    onClick={() => dismiss(t.id)}
                                    aria-label="Dismiss notification"
                                    className="shrink-0 opacity-60 hover:opacity-100 p-1 -m-1"
                                >
                                    <X size={16} />
                                </button>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>

            {/* Confirm modal — replaces window.confirm() */}
            <AnimatePresence>
                {confirmState && (
                    <motion.div data-overlay-root=""
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={MODAL_TRANSITION}
                        className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70"
                        onClick={() => resolveConfirm(false)}
                    >
                        <motion.div
                            initial={{ opacity: 0, transform: 'scale(0.95)' }}
                            animate={{ opacity: 1, transform: 'scale(1)' }}
                            exit={{ opacity: 0, transform: 'scale(0.95)' }}
                            transition={MODAL_TRANSITION}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="confirm-title"
                            className="w-full max-w-sm rounded-xl border border-line bg-card p-6 shadow-panel"
                            onClick={e => e.stopPropagation()}
                        >
                            <h2 id="confirm-title" className="font-display font-bold uppercase text-lg text-[color:var(--text)] mb-2">
                                {confirmState.title}
                            </h2>
                            <div className="font-body text-sm text-muted mb-6">{confirmState.message}</div>
                            <div className="flex gap-3 justify-end">
                                <button
                                    onClick={() => resolveConfirm(false)}
                                    className="px-4 py-2.5 rounded-md font-display font-bold uppercase tracking-[0.05em] text-sm border-[1.5px] border-navy-800 text-navy-800 hover:bg-navy-800 hover:text-white dark:border-[color:var(--line)] dark:text-[color:var(--text)] dark:hover:bg-white/10 dark:hover:text-white transition-colors"
                                >
                                    {confirmState.cancelLabel ?? 'Cancel'}
                                </button>
                                <button
                                    ref={confirmButtonRef}
                                    onClick={() => resolveConfirm(true)}
                                    className={`px-4 py-2.5 rounded-md font-display font-bold uppercase tracking-[0.05em] text-sm text-white transition-colors ${confirmState.danger
                                        ? 'bg-brandred-600 hover:bg-brandred-500'
                                        : 'bg-navy-800 hover:bg-navy-700'}`}
                                >
                                    {confirmState.confirmLabel ?? 'Confirm'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </ToastContext.Provider>
    );
};
