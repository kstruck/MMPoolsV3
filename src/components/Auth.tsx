import React, { useState } from 'react';
import { authService } from '../services/authService';
import { Mail, Lock, User, Chrome, ArrowRight, Loader2, AlertCircle } from 'lucide-react';

interface AuthProps {
  onLogin: () => void;
  defaultIsRegistering?: boolean;
}

export const Auth: React.FC<AuthProps> = ({ onLogin, defaultIsRegistering = false }) => {
  const [isRegistering, setIsRegistering] = useState(defaultIsRegistering);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      if (isRegistering) {
        await authService.register(formData.name, formData.email, formData.password);
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
      setIsLoading(false);
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
            {isRegistering ? 'Create Account' : 'Welcome Back'}
          </h2>
          <p className="text-slate-400 text-sm">
            {isRegistering ? 'Sign up to create and manage pools' : 'Sign in to access your dashboard'}
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

          {/* Google Button */}
          <button
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full bg-white text-slate-900 font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-3 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? <Loader2 className="animate-spin" size={20} /> : <Chrome size={20} />}
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

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400 uppercase">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 text-slate-500" size={18} />
                <input
                  type="password"
                  required
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

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 transition-all mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                <>
                  {isRegistering ? 'Create Account' : 'Sign In to Manage Your Pool'}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>



          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => { setIsRegistering(!isRegistering); setError(null); }}
              className="text-indigo-400 hover:text-indigo-300 text-sm font-bold transition-colors"
            >
              {isRegistering ? 'Already have an account? Sign In' : "Don't have an account? Register"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};