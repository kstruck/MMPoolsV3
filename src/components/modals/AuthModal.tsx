import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Auth } from '../Auth';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialMode?: 'login' | 'register';
    /** Fires after a successful sign-in/sign-up (modal closes first) */
    onAuthenticated?: (result?: { isNewUser?: boolean }) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, initialMode = 'login', onAuthenticated }) => {
    const dialogRef = useRef<HTMLDivElement>(null);

    // Hooks run unconditionally (before the isOpen early return). Escape closes;
    // focus moves into the dialog on open for keyboard/screen-reader users.
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        dialogRef.current?.focus();
        return () => document.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label="Sign in or create an account"
                tabIndex={-1}
                className="w-full max-w-md relative outline-none"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={onClose}
                    aria-label="Close"
                    className="absolute -top-12 right-0 text-slate-400 hover:text-white transition-colors p-2"
                >
                    <X size={24} />
                </button>
                <Auth onLogin={(result) => { onClose(); onAuthenticated?.(result); }} defaultIsRegistering={initialMode === 'register'} />
            </div>
        </div>
    );
};

export default AuthModal;
