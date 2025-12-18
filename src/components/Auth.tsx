import React, { useState } from 'react';
import { authService } from '../services/authService';
import { Mail, Lock, User, ArrowRight, Loader2, AlertCircle, CheckCircle } from 'lucide-react';

interface AuthProps {
  onLogin: () => void;
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
        setSuccessMsg("Account created! Verify your email to unlock all features.");
        // Optional: Keep them on screen to read message? 
        // Or onLogin() will redirect them.
        // Let's delay redirection slightly or show a banner in the App instead.
        // For now, let's just proceed to onLogin() which starts the session.
        // The App header will show "Verify Email" if we implement that.
      } else {
        await authService.login(formData.email, formData.password);
      }
      onLogin();
    } catch (err: any) {
      console.error("Auth error", err);
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
      console.error("Google Auth error", err);
      setError("Google Sign-In failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-8 text-center border-b border-slate-700 bg-slate-900/50">
          <h2 className="text-2xl font-bold text-white mb-2">
            {isResetting ? 'Reset Password' : (isRegistering ? 'Create Account' : 'Welcome Back')}
          </h2>
          <p className="text-slate-400 text-sm">
            {isResetting ? "Enter your email to receive a reset link" : (isRegistering ? 'Sign up to create and manage pools' : 'Sign in to access your dashboard')}
          </p>
        </div>

        <div className="p-8 space-y-6">
          {/* Error Banner */}
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/50 rounded-lg p-3 flex items-start gap-3 text-rose-200 text-sm">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Banner */}
          {successMsg && (
            <div className="bg-emerald-500/10 border border-emerald-500/50 rounded-lg p-3 flex items-start gap-3 text-emerald-200 text-sm">
              <CheckCircle size={18} className="shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Google Button */}
          <button
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full bg-white text-slate-900 font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-3 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
              <div className="w-full border-t border-slate-600"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-slate-800 px-2 text-slate-500 font-bold">Or continue with email</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegistering && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase">Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-3 text-slate-500" size={18} />
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2.5 pl-10 pr-4 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    placeholder="John Doe"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400 uppercase">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 text-slate-500" size={18} />
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2.5 pl-10 pr-4 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  placeholder="name@example.com"
                />
              </div>
            </div>

            {!isResetting && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 text-slate-500" size={18} />
                  <input
                    type="password"
                    required={!isResetting}
                    minLength={6}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2.5 pl-10 pr-4 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    placeholder="••••••••"
                  />
                </div>
                {isRegistering && (
                  <p className="text-xs text-slate-500 mt-1 ml-1">Password must be at least 6 characters</p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 transition-all mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                <>
                  {isResetting ? 'Send Reset Link' : (isRegistering ? 'Create Account' : 'Sign In')}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>



          <div className="text-center pt-2 space-y-2">
            {!isResetting ? (
              <>
                <button
                  type="button"
                  onClick={() => { setIsRegistering(!isRegistering); setError(null); }}
                  className="text-indigo-400 hover:text-indigo-300 text-sm font-bold transition-colors block w-full"
                >
                  {isRegistering ? 'Already have an account? Sign In' : "Don't have an account? Register"}
                </button>
                {!isRegistering && (
                  <button
                    type="button"
                    onClick={() => { setIsResetting(true); setError(null); }}
                    className="text-slate-500 hover:text-white text-xs transition-colors"
                  >
                    Forgot Password?
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={() => { setIsResetting(false); setError(null); }}
                className="text-slate-500 hover:text-white text-xs transition-colors"
              >
                Back to Sign In
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};