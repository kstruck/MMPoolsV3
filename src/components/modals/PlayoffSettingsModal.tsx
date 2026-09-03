import { logger } from '../../utils/logger';
import React, { useState, useEffect, useRef } from 'react';
import { useOverlayOwner } from '../ui/overlayStack';
import { useFocusTrap } from '../ui/useFocusTrap';
import { X, Lock, Unlock, Save, Loader } from 'lucide-react';
import type { PlayoffPool } from '../../types';
import { db } from '../../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { Button, Input, FieldLabel } from '../ui';

interface PlayoffSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    pool: PlayoffPool;
}

export const PlayoffSettingsModal: React.FC<PlayoffSettingsModalProps> = ({ isOpen, onClose, pool }) => {
    const [name, setName] = useState(pool.name);
    const [isLocked, setIsLocked] = useState(pool.isLocked);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const dialogRef = useRef<HTMLDivElement>(null);

    // Escape closes; focus moves into the dialog on open. (No backdrop-click
    // close on this form modal — avoids losing unsaved edits by accident.)
    // PLAN-HELP-SYSTEM T2: own the screen while open, so the `?` shortcut stays
    // quiet and Escape closes exactly one overlay. Registered on `isOpen`, NOT
    // on mount — this component stays mounted while closed, and pushing on
    // mount would let it own the stack for the life of the app.
    useOverlayOwner('playoff-settings-modal', { active: isOpen, onEscape: onClose });
    useFocusTrap(dialogRef, isOpen); // aria-modal promises containment (a11y audit)
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        dialogRef.current?.focus();
        return () => document.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        setSuccess(false);

        try {
            const poolRef = doc(db, 'pools', pool.id);
            await updateDoc(poolRef, {
                name,
                isLocked,
                updatedAt: Date.now()
            });

            setSuccess(true);
            setTimeout(() => {
                setSuccess(false);
                onClose();
            }, 1000);
        } catch (err: any) {
            logger.error("Error updating pool:", err);
            setError("Failed to update settings. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div data-overlay-root="" className="fixed inset-0 bg-navy-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="playoff-settings-title"
                tabIndex={-1}
                className="bg-card border border-line w-full max-w-lg rounded-xl shadow-panel flex flex-col max-h-[90vh] outline-none"
            >
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-line">
                    <h2 id="playoff-settings-title" className="text-xl font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
                        <SettingsIcon /> Pool Settings
                    </h2>
                    <button onClick={onClose} aria-label="Close" className="text-muted hover:text-[color:var(--text)] transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6 overflow-y-auto">

                    {/* Pool Name */}
                    <Input
                        label="Pool Name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />

                    {/* Locking Status */}
                    <div className="bg-surface p-4 rounded-lg border border-line">
                        <FieldLabel>Pool Status</FieldLabel>
                        <div className="flex gap-4">
                            <button
                                onClick={() => setIsLocked(false)}
                                className={`flex-1 py-3 px-4 rounded-lg font-display font-bold uppercase tracking-[0.05em] border transition-ui flex items-center justify-center gap-2
                                    ${!isLocked
                                        ? 'bg-[#E4F5EC] border-[#0F7B4A] text-[#0F7B4A]'
                                        : 'bg-page border-line text-muted hover:border-navy-600'}`}
                            >
                                <Unlock size={18} /> Open
                            </button>
                            <button
                                onClick={() => setIsLocked(true)}
                                className={`flex-1 py-3 px-4 rounded-lg font-display font-bold uppercase tracking-[0.05em] border transition-ui flex items-center justify-center gap-2
                                    ${isLocked
                                        ? 'bg-cream border-line text-muted'
                                        : 'bg-page border-line text-muted hover:border-navy-600'}`}
                            >
                                <Lock size={18} /> Locked
                            </button>
                        </div>
                        <p className="text-xs font-body text-muted mt-3">
                            {isLocked
                                ? "Pool is currently LOCKED. Players cannot submit or edit entries."
                                : "Pool is OPEN. Players can submit and edit their entries."}
                        </p>
                    </div>

                    {/* Danger Zone / Advanced Config could go here */}

                    {/* Feedback */}
                    {error && (
                        <div className="p-4 bg-[#FCEEED] border border-brandred-500/30 text-brandred-600 rounded-lg text-sm font-body font-bold text-center">
                            {error}
                        </div>
                    )}
                    {success && (
                        <div className="p-4 bg-[#E4F5EC] border border-[#BEE7D0] text-[#0F7B4A] rounded-lg text-sm font-body font-bold text-center">
                            Settings Saved Successfully!
                        </div>
                    )}

                </div>

                {/* Footer */}
                <div className="p-6 border-t border-line bg-surface rounded-b-xl flex justify-end gap-3">
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant="primary" size="sm" onClick={handleSave} disabled={isSaving}>
                        {isSaving ? <Loader className="animate-spin" size={18} /> : <Save size={18} />}
                        Save Changes
                    </Button>
                </div>
            </div>
        </div>
    );
};

const SettingsIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
);
