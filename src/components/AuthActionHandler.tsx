import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
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
                const error = err as Error;
                setError(error.message || 'An error occurred while processing your request. The link may have expired.');
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
            const error = err as Error;
            setError(error.message || 'Failed to reset password.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col font-sans transition-colors duration-200">
            <Header
                user={user}
                onOpenAuth={() => onOpenAuth('login')}
                onLogout={onLogout}
                onCreatePool={onCreatePool}
            />
            <div className="flex-1 flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800 p-8">
                    <h2 className="text-2xl font-bold text-center text-slate-900 dark:text-white mb-6">
                        Authentication
                    </h2>

                    {loading && (
                        <div className="flex flex-col items-center justify-center space-y-4 py-8">
                            <Loader className="w-8 h-8 text-indigo-500 animate-spin" />
                            <p className="text-slate-600 dark:text-slate-400">Processing your request...</p>
                        </div>
                    )}

                    {!loading && error && (
                        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg flex items-center gap-3 mb-6">
                            <AlertCircle className="w-5 h-5 flex-shrink-0" />
                            <p className="text-sm">{error}</p>
                        </div>
                    )}

                    {!loading && message && (
                        <div className="bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 p-4 rounded-lg flex items-center gap-3 mb-6">
                            <CheckCircle className="w-5 h-5 flex-shrink-0" />
                            <p className="text-sm">{message}</p>
                        </div>
                    )}

                    {!loading && mode === 'resetPassword' && resetEmail && !message && (
                        <form onSubmit={handlePasswordReset} className="space-y-4">
                            <p className="text-slate-600 dark:text-slate-400 text-sm text-center mb-4">
                                Resetting password for: <span className="font-semibold">{resetEmail}</span>
                            </p>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    New Password
                                </label>
                                <input
                                    type="password"
                                    required
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    className="w-full px-4 py-2 bg-white dark:bg-black border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white transition-colors"
                                    placeholder="Enter new password"
                                    autoComplete="new-password"
                                    minLength={6}
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading || !newPassword || newPassword.length < 6}
                                className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                            >
                                Reset Password
                            </button>
                        </form>
                    )}

                    {!loading && (message || error || (!mode && !oobCode)) && (
                        <div className="mt-8 text-center space-y-3">
                            <button
                                onClick={() => navigate('/')}
                                className="w-full py-2 px-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white rounded-lg font-medium transition-colors"
                            >
                                Return to Home
                            </button>
                            {message && (
                                <button
                                    onClick={() => onOpenAuth('login')}
                                    className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
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
