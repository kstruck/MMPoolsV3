import { logger } from '../utils/logger';
import React, { useState } from 'react';
import { Link } from 'react-router';
import { authService } from '../services/authService';
import { Mail, Lock, User, ArrowRight, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from './ui';

interface AuthProps {
  onLogin: (result?: { isNewUser?: boolean }) => void;
  defaultIsRegistering?: boolean;
}

export const Auth: React.FC<AuthProps> = ({ onLogin, defaultIsRegistering = false }) => {
  const [isRegistering, setIsRegistering] = useState(defaultIsRegistering);
  const [isResetting, setIsResetting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      if (isResetting) {
        await authService.resetPassword(formData.email);
        setSuccessMsg("If an account exists, a password reset link has been sent to your email.");
        setIsLoading(false);
        return;
      }

      if (isRegistering) {
        await authService.register(formData.name, formData.email, formData.password);
        onLogin({ isNewUser: true });
      } else {
        await authService.login(formData.email, formData.password);
        onLogin();
      }
    } catch (err: any) {
      logger.error("Auth error", err);
      // Map common Firebase errors to readable messages
      if (err.code === 'auth/email-already-in-use') {
        setError("This email is already registered. Please sign in.");
      } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setError("Invalid email or password.");
      } else if (err.code === 'auth/weak-password') {
        setError("Password should be at least 6 characters.");
      } else if (err.code === 'auth/operation-not-allowed') {
        setError("Email/Password login is not enabled in Firebase Console.");
      } else {
        setError(err.message || "Authentication failed. Please try again.");
      }
    } finally {
      if (!isResetting) setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await authService.loginWithGoogle();
      onLogin();
    } catch (err: any) {
      logger.error("Google Auth error", err);
      setError("Google Sign-In failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-card border border-line rounded-2xl shadow-panel overflow-hidden">
        <div className="p-8 text-center border-b border-line bg-surface">
          <h2 className="font-display font-extrabold uppercase text-[28px] leading-none text-[color:var(--text)] mb-2">
            {isResetting ? 'Reset Password' : (isRegistering ? 'Create Account' : 'Welcome Back')}
          </h2>
          <p className="text-muted text-sm font-body">
            {isResetting ? "Enter your email to receive a reset link" : (isRegistering ? 'Sign up to create and manage pools' : 'Sign in to access your dashboard')}
          </p>
        </div>

        <div className="p-8 space-y-6">
          {/* Error Banner */}
          {error && (
            <div role="alert" className="bg-brandred-600/10 border border-brandred-600/40 rounded-lg p-3 flex items-start gap-3 text-brandred-600 text-sm font-body">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Banner */}
          {successMsg && (
            <div className="bg-[#E4F5EC] border border-[#BEE7D0] rounded-lg p-3 flex items-start gap-3 text-[#0F7B4A] text-sm font-body">
              <CheckCircle size={18} className="shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Google Button */}
          <button
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full bg-white text-navy-900 font-display font-bold uppercase tracking-[0.05em] py-3 px-4 rounded-md border border-line flex items-center justify-center gap-3 hover:bg-cream transition-all duration-150 hover:-translate-y-px disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0"
          >
            {isLoading ? <Loader2 className="animate-spin" size={20} /> : (
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
            )}
            {isRegistering ? 'Sign up with Google' : 'Sign in with Google'}
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-line"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted font-display font-bold tracking-[0.08em]">Or continue with email</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegistering && (
              <div className="space-y-1">
                <label className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)]">Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-3 text-faint" size={18} />
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full rounded-md border-[1.5px] border-line bg-page py-2.5 pl-10 pr-4 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                    placeholder="John Doe"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)]">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 text-faint" size={18} />
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full rounded-md border-[1.5px] border-line bg-page py-2.5 pl-10 pr-4 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                  placeholder="name@example.com"
                />
              </div>
            </div>

            {!isResetting && (
              <div className="space-y-1">
                <label className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)]">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 text-faint" size={18} />
                  <input
                    type="password"
                    required={!isResetting}
                    minLength={6}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full rounded-md border-[1.5px] border-line bg-page py-2.5 pl-10 pr-4 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                    placeholder="••••••••"
                  />
                </div>
                {isRegistering && (
                  <p className="text-xs text-faint font-body mt-1 ml-1">Password must be at least 6 characters</p>
                )}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={isLoading}
              className="w-full mt-6"
            >
              {isLoading ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                <>
                  {isResetting ? 'Send Reset Link' : (isRegistering ? 'Create Account' : 'Sign In')}
                  <ArrowRight size={18} />
                </>
              )}
            </Button>
          </form>



          <div className="text-center pt-2 space-y-2">
            {!isResetting ? (
              <>
                <button
                  type="button"
                  onClick={() => { setIsRegistering(!isRegistering); setError(null); }}
                  className="text-gold-700 dark:text-gold-400 hover:text-gold-600 dark:hover:text-gold-300 text-sm font-display font-bold uppercase tracking-[0.05em] transition-colors block w-full"
                >
                  {isRegistering ? 'Already have an account? Sign In' : "Don't have an account? Register"}
                </button>
                {!isRegistering && (
                  <button
                    type="button"
                    onClick={() => { setIsResetting(true); setError(null); }}
                    className="text-muted hover:text-[color:var(--text)] text-xs font-body transition-colors"
                  >
                    Forgot Password?
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={() => { setIsResetting(false); setError(null); }}
                className="text-muted hover:text-[color:var(--text)] text-xs font-body transition-colors"
              >
                Back to Sign In
              </button>
            )}
          </div>

          <div className="mt-6 pt-6 border-t border-line text-center">
            <p className="text-xs text-faint font-body">
              By continuing, you agree to our <Link to="/terms" className="underline hover:text-muted">Terms</Link> and acknowledge our <Link to="/privacy" className="underline hover:text-muted">Privacy Policy</Link>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
