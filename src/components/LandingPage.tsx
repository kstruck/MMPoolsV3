import React from 'react';
import { Logo } from './Logo';
import { Trophy, Zap, Shield, LayoutGrid, Award, Calendar, CheckCircle2, Heart } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

interface LandingPageProps {
  onLogin: () => void;
  onSignup: () => void;
  onBrowse: () => void;
  isLoggedIn: boolean;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onLogin, onSignup, onBrowse, isLoggedIn }) => {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans selection:bg-orange-500 selection:text-white transition-colors duration-300">

      {/* Navigation */}
      <nav className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <button
              onClick={onBrowse}
              className="hidden md:flex items-center gap-2 text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              <LayoutGrid size={18} /> Public Pools
            </button>
            <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 hidden md:block"></div>

            {isLoggedIn ? (
              <button
                onClick={onLogin} // Redirects to dashboard if logged in
                className="bg-slate-900 dark:bg-white text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-orange-50 px-5 py-2.5 rounded-full text-sm font-bold transition-all transform hover:scale-105 shadow-lg shadow-slate-900/10 dark:shadow-white/10"
              >
                Go to Dashboard
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={onLogin}
                  className="text-sm font-bold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                >
                  Sign In
                </button>
                <button
                  onClick={onSignup}
                  className="bg-slate-900 dark:bg-white text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-orange-50 px-5 py-2.5 rounded-full text-sm font-bold transition-all transform hover:scale-105 shadow-lg shadow-slate-900/10 dark:shadow-white/10"
                >
                  Get Started
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-12 md:pt-20 pb-20 md:pb-32">
        {/* Background Gradients */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full pointer-events-none">
          <div className="absolute top-20 right-0 w-[500px] h-[500px] bg-indigo-500/10 dark:bg-orange-600/10 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-rose-500/10 dark:bg-indigo-600/10 rounded-full blur-[120px]"></div>
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-4 py-1.5 mb-6 md:mb-8 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-700">
            <span className="flex h-2 w-2 rounded-full bg-indigo-500 animate-pulse"></span>
            <span className="text-xs font-bold text-indigo-400 tracking-wide uppercase">Free for a Limited Time • Create Your Pool</span>
          </div>

          <h1 className="text-4xl md:text-7xl font-black text-slate-900 dark:text-white tracking-tight mb-6 md:mb-8 leading-tight animate-in fade-in slide-in-from-bottom-8 duration-700">
            Create Your <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-purple-600 to-rose-600 dark:from-orange-400 dark:via-amber-400 dark:to-rose-400">Squares Pool Now</span>
          </h1>

          <p className="text-lg md:text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto mb-8 md:mb-10 leading-relaxed animate-in fade-in slide-in-from-bottom-12 duration-700 delay-100">
            The professional platform for managing sports pools. Automated scoring, real-time payouts, and extensive customization for the ultimate grid experience.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-12 duration-700 delay-200">
            <button
              onClick={onSignup}
              className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 dark:bg-orange-600 dark:hover:bg-orange-500 text-white px-8 py-4 rounded-xl text-lg font-bold shadow-xl shadow-indigo-600/20 dark:shadow-orange-500/30 transition-all flex items-center justify-center gap-2"
            >
              <Trophy size={20} /> Create Your Pool
            </button>
            <button
              onClick={onBrowse}
              className="w-full sm:w-auto bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-white px-8 py-4 rounded-xl text-lg font-bold border border-slate-200 dark:border-slate-700 shadow-sm transition-all flex items-center justify-center gap-2"
            >
              <LayoutGrid size={20} /> Browse Public Pools
            </button>
          </div>

          {/* Hero Visual */}
          <div className="mt-16 md:mt-20 relative mx-auto max-w-5xl animate-in fade-in slide-in-from-bottom-20 duration-1000 delay-300">
            <div className="absolute inset-0 bg-gradient-to-t from-slate-50 dark:from-slate-950 via-transparent to-transparent z-20"></div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-2 shadow-2xl">
              <div className="bg-slate-100 dark:bg-slate-950 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 relative group">
                <img
                  src="/hero-ui.png"
                  alt="March Melee Pools Interface"
                  className="w-full h-auto object-cover opacity-90 group-hover:opacity-100 transition-opacity duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-50 dark:from-slate-950 via-transparent to-transparent opacity-60"></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24 bg-white dark:bg-slate-900/50 border-y border-slate-200 dark:border-slate-800 transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4">Everything You Need to Run the Perfect Pool</h2>
            <p className="text-slate-600 dark:text-slate-400">Ditch the spreadsheets. Upgrade to a fully automated system.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
            {[
              { icon: Zap, title: "Live ESPN Sync", desc: "Real-time scoring updates. Watch the winners update instantly as the game unfolds." },
              { icon: Shield, title: "Audit Log & Integrity", desc: "Every action is logged. Numbers are generated securely. 100% tamper-proof." },
              { icon: Trophy, title: "AI Commissioner", desc: "Resolve disputes and explain winning squares automatically with our built-in AI." },
              { icon: Heart, title: "Charity Integration", desc: "Easily designate a percentage of the pot to a charity of your choice. Built-in fundraising." }
            ].map((feature, i) => (
              <div key={i} className="bg-slate-50 dark:bg-slate-950 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-indigo-500/50 dark:hover:border-orange-500/50 transition-colors group flex flex-col h-full">
                <div className="w-14 h-14 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 border border-indigo-100 dark:border-indigo-500/20">
                  <feature.icon size={28} className="text-indigo-600 dark:text-indigo-400" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">{feature.title}</h3>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed flex-grow">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Roadmap Section */}
      <section className="py-24 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 text-fuchsia-400 font-bold uppercase tracking-widest text-sm mb-4">
              <Calendar size={16} /> Coming Soon
            </div>
            <h2 className="text-4xl md:text-5xl font-black text-white mb-6">More Sports.<br />More Action.</h2>
            <p className="text-lg text-slate-400 mb-8 leading-relaxed">
              MarchMeleePools is evolving. We are building the ultimate destination for year-round sports pools.
            </p>

            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0 border border-orange-500/20">
                  <Award className="text-orange-500" size={24} />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-white mb-1">March Madness Brackets</h4>
                  <p className="text-slate-500 text-sm">Create and manage tournament brackets with live scoring and leaderboard tracking.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-full bg-sky-500/10 flex items-center justify-center shrink-0 border border-sky-500/20">
                  <Shield className="text-sky-500" size={24} />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-white mb-1">NFL Pick'em Leagues</h4>
                  <p className="text-slate-500 text-sm">Weekly pick'em pools for the entire NFL season. Survivor pools, spread picks, and more.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-orange-500 to-indigo-500 blur-[100px] opacity-20"></div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 relative">
              <h3 className="text-2xl font-bold text-white mb-6">Phase 2 Roadmap</h3>
              <div className="space-y-4">
                {[
                  { label: 'Super Bowl Squares', status: 'Live Now', active: true },
                  { label: 'March Madness Brackets', status: 'February 2026', active: false },
                  { label: 'NFL Pick\'em', status: 'August 2026', active: false },
                  { label: 'Survivor Pools', status: 'August 2026', active: false },
                  { label: 'College Football Squares', status: 'August 2026', active: false },
                ].map((item, i) => (
                  <div key={i} className={`flex items-center justify-between p-4 rounded-xl border ${item.active ? 'bg-indigo-900/20 border-indigo-500/30' : 'bg-slate-950 border-slate-800 opacity-60'}`}>
                    <span className="font-bold text-white flex items-center gap-3">
                      {item.active ? <CheckCircle2 size={18} className="text-emerald-400" /> : <div className="w-4 h-4 rounded-full border-2 border-slate-600"></div>}
                      {item.label}
                    </span>
                    <span className={`text-xs font-bold uppercase ${item.active ? 'text-emerald-400' : 'text-slate-500'}`}>{item.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Footer */}
      <footer className="bg-slate-950 border-t border-slate-800 pt-24 pb-12">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-5xl font-black text-white mb-8">Ready to Start Your Pool?</h2>
          <button
            onClick={onSignup}
            className="bg-white text-indigo-600 px-10 py-5 rounded-full text-xl font-black transition-all transform hover:scale-105 shadow-[0_0_40px_rgba(255,255,255,0.3)] mb-4 hover:shadow-[0_0_60px_rgba(255,255,255,0.5)]"
          >
            Create Your Free Pool Now
          </button>
          <p className="text-indigo-200 text-sm font-bold uppercase tracking-wider mb-12">Limited Time Offer</p>

          <div className="border-t border-slate-900 pt-12 flex flex-col md:flex-row justify-between items-center gap-6 opacity-60">
            <div className="flex items-center gap-2">
              <Logo className="w-6 h-6" textClassName="text-sm" />
            </div>
            <div className="text-sm text-slate-500">
              © 2024 MarchMeleePools. All rights reserved.
            </div>
            <div className="flex gap-6 text-sm text-slate-500 font-medium">
              <a href="#" className="hover:text-white transition-colors">Privacy</a>
              <a href="#" className="hover:text-white transition-colors">Terms</a>
              <a href="#" className="hover:text-white transition-colors">Support</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};