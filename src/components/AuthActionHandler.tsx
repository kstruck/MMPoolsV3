import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import {
    verifyPasswordResetCode,
    confirmPasswordReset,
    checkActionCode,
    applyActionCode
} from 'firebase/auth';
import { auth } from '../firebase';
import { Loader, CheckCircle, AlertCircle } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import type { User } from '../types';
import { authService } from '../services/authService';
import { getUserMessage } from '../utils/errorMessages';

interface AuthActionHandlerProps {
    user: User | null;
    onOpenAuth: (mode?: 'login' | 'register') => void;
    onLogout: () => void;
    onCreatePool?: () => void;
}

export const AuthActionHandler: React.FC<AuthActionHandlerProps> = ({
    user,
    onOpenAuth,
    onLogout,
    onCreatePool
}) => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    const mode = searchParams.get('mode');
    const oobCode = searchParams.get('oobCode');

    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [newPassword, setNewPassword] = useState('');
    const [resetEmail, setResetEmail] = useState<string | null>(null);

    useEffect(() => {
        if (!mode || !oobCode) {
            setError('Invalid request. Missing parameters.');
            return;
        }

        const handleAction = async () => {
            setLoading(true);
            setError(null);
            setMessage(null);

            try {
                switch (mode) {
                    case 'resetPassword': {
                        // Verify the code and get the user's email
                        const email = await verifyPasswordResetCode(auth, oobCode);
                        setResetEmail(email);
                        // Form handles the rest
                        break;
                    }

                    case 'recoverEmail': {
                        const info = await checkActionCode(auth, oobCode);
                        await applyActionCode(auth, oobCode);
                        setMessage(`Email successfully reverted to ${info.data.email}. You can now log in with this email.`);
                        break;
                    }

                    case 'verifyEmail': {
                        await applyActionCode(auth, oobCode);
                        if (auth.currentUser) {
                            await auth.currentUser.reload();
                            // Force sync to Firestore so the global user state updates
                            const currentUser = authService.getCurrentUser();
                            if (currentUser) {
                                await authService.syncUserToFirestore(currentUser);
                                // Force an auth state change to trigger listeners by getting the token
                                await auth.currentUser.getIdToken(true);
                            }
                            setMessage('Your email has been verified! Redirecting...');
                            setTimeout(() => {
                                window.location.href = '/participant';
                            }, 2000);
                        } else {
                            setMessage('Your email has been verified! You can now log in.');
                        }
                        break;
                    }

                    default:
                        setError('Invalid action mode.');
                }
            } catch (err: unknown) {
                setError(getUserMessage(err, 'Something went wrong processing this link. It may have expired — request a new one and try again.'));
            } finally {
                setLoading(false);
            }
        };

        if (mode === 'recoverEmail' || mode === 'verifyEmail' || mode === 'resetPassword') {
            handleAction();
        }
    }, [mode, oobCode]);

    const handlePasswordReset = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!oobCode || !newPassword) return;

        setLoading(true);
        try {
            await confirmPasswordReset(auth, oobCode, newPassword);
            setMessage('Password has been reset successfully. You can now log in.');
            setResetEmail(null); // Hide the form
        } catch (err: unknown) {
            setError(getUserMessage(err, 'Failed to reset password. The link may have expired — request a new one.'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-page flex flex-col font-body transition-colors duration-200">
            <Header
                user={user}
                onOpenAuth={() => onOpenAuth('login')}
                onLogout={onLogout}
                onCreatePool={onCreatePool}
            />
            <div className="flex-1 flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-card rounded-xl shadow-card border border-line p-8">
                    <h2 className="text-2xl font-display font-bold uppercase text-center text-[color:var(--text)] mb-6">
                        Authentication
                    </h2>

                    {loading && (
                        <div className="flex flex-col items-center justify-center space-y-4 py-8">
                            <Loader className="w-8 h-8 text-gold-500 animate-spin" />
                            <p className="text-muted">Processing your request...</p>
                        </div>
                    )}

                    {!loading && error && (
                        <div className="bg-[#FCEEED] dark:bg-transparent dark:border dark:border-brandred-500 text-brandred-600 dark:text-brandred-500 p-4 rounded-lg flex items-center gap-3 mb-6">
                            <AlertCircle className="w-5 h-5 flex-shrink-0" />
                            <p className="text-sm">{error}</p>
                        </div>
                    )}

                    {!loading && message && (
                        <div className="bg-[#E4F5EC] dark:bg-transparent dark:border dark:border-[#0F7B4A] text-[#0F7B4A] dark:text-[#4CC38A] p-4 rounded-lg flex items-center gap-3 mb-6">
                            <CheckCircle className="w-5 h-5 flex-shrink-0" />
                            <p className="text-sm">{message}</p>
                        </div>
                    )}

                    {!loading && mode === 'resetPassword' && resetEmail && !message && (
                        <form onSubmit={handlePasswordReset} className="space-y-4">
                            <p className="text-muted text-sm text-center mb-4">
                                Resetting password for: <span className="font-semibold">{resetEmail}</span>
                            </p>
                            <div>
                                <label className="block mb-1.5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)]">
                                    New Password
                                </label>
                                <input
                                    type="password"
                                    required
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-2 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                    placeholder="Enter new password"
                                    autoComplete="new-password"
                                    minLength={6}
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading || !newPassword || newPassword.length < 6}
                                className="w-full py-2 px-4 bg-brandred-600 hover:bg-brandred-500 text-white rounded-md font-display font-bold uppercase tracking-[0.05em] shadow-[0_6px_16px_rgba(196,52,46,0.28)] transition-colors duration-150 disabled:opacity-50"
                            >
                                Reset Password
                            </button>
                        </form>
                    )}

                    {!loading && (message || error || (!mode && !oobCode)) && (
                        <div className="mt-8 text-center space-y-3">
                            <button
                                onClick={() => navigate('/')}
                                className="w-full py-2 px-4 border-[1.5px] border-navy-800 text-navy-800 hover:bg-navy-800 hover:text-white dark:border-[color:var(--line)] dark:text-[color:var(--text)] dark:hover:bg-white/10 dark:hover:text-white rounded-md font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150"
                            >
                                Return to Home
                            </button>
                            {message && (
                                <button
                                    onClick={() => onOpenAuth('login')}
                                    className="w-full py-2 px-4 bg-brandred-600 hover:bg-brandred-500 text-white rounded-md font-display font-bold uppercase tracking-[0.05em] shadow-[0_6px_16px_rgba(196,52,46,0.28)] transition-colors duration-150"
                                >
                                    Log In Now
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
            <Footer />
        </div>
    );
};
