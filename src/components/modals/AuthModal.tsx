import React from 'react';
import { X } from 'lucide-react';
import { Auth } from '../Auth';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialMode?: 'login' | 'register';
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, initialMode = 'login' }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-md relative">
                <button
                    onClick={onClose}
                    className="absolute -top-12 right-0 text-slate-400 hover:text-white transition-colors p-2"
                >
                    <X size={24} />
                </button>
                <Auth onLogin={() => { onClose(); }} defaultIsRegistering={initialMode === 'register'} />
            </div>
        </div>
    );
};

export default AuthModal;
