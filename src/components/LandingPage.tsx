import React from 'react';
import type { User } from '../types';
import { Trophy, LayoutGrid, CheckCircle2, Heart, BarChart3, Users } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import { Link } from 'react-router-dom';

interface LandingPageProps {
  user?: User | null;
  isManager?: boolean;
  onLogin: () => void;
  onSignup: () => void;
  onLogout?: () => void;
  onCreatePool?: () => void;
  onBrowse: () => void;
  onGoToDashboard?: () => void;
  isLoggedIn: boolean;
  totalDonated?: number;
  totalPrizes?: number;
}

// Brand Colors
const BRAND = {
  navy: '#0A192F',
  orange: '#FF6600',
  white: '#FFFFFF',
  emerald: '#10B981',
  amber: '#FBBF24',
  lightGray: '#E5E7EB',
};

export const LandingPage: React.FC<LandingPageProps> = ({ user, isManager = false, onLogin, onSignup, onLogout, onCreatePool, onBrowse, totalDonated = 0, totalPrizes = 0, isLoggedIn }) => {

  return (
    <div className="min-h-screen text-white font-sans selection:bg-orange-500 selection:text-white" style={{ backgroundColor: BRAND.navy }}>

      {/* Shared Header for Consistency */}
      <Header
        user={user || null}
        isManager={isManager}
        onOpenAuth={onLogin}
        onLogout={onLogout || (() => { })}
        onCreatePool={onCreatePool}
      />


      {/* Hero Section */}
      <section className="relative overflow-hidden pt-12 md:pt-20 pb-20 md:pb-32">
        {/* Background Gradients */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full pointer-events-none">
          <div className="absolute top-20 right-0 w-[500px] h-[500px] rounded-full blur-[120px]" style={{ backgroundColor: `${BRAND.orange}15` }}></div>
          <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full blur-[120px]" style={{ backgroundColor: '#3B82F615' }}></div>
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-6 md:mb-8 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-700" style={{ backgroundColor: `${BRAND.orange}20`, border: `1px solid ${BRAND.orange}40` }}>
            <span className="flex h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: BRAND.orange }}></span>
            <span className="text-xs font-bold tracking-wide uppercase" style={{ color: BRAND.orange }}>2026 Tournament Registration Open</span>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-12 duration-700 delay-200 mb-8">
            <button
              onClick={onCreatePool}
              className="w-full sm:w-auto text-white px-8 py-4 rounded-xl text-lg font-bold shadow-xl transition-all flex items-center justify-center gap-2 hover:brightness-110"
              style={{ backgroundColor: BRAND.orange, boxShadow: `0 10px 40px ${BRAND.orange}40` }}
            >
              <Trophy size={20} /> Create a Bracket Pool
            </button>
            <button
              onClick={onBrowse}
              className="w-full sm:w-auto text-white px-8 py-4 rounded-xl text-lg font-bold border shadow-sm transition-all flex items-center justify-center gap-2 hover:bg-white/5"
              style={{ borderColor: '#334155', backgroundColor: '#1E293B' }}
            >
              <LayoutGrid size={20} /> Browse Public Pools
            </button>
          </div>

          <h1 className="text-4xl md:text-7xl font-black text-white tracking-tight mb-6 md:mb-8 leading-tight animate-in fade-in slide-in-from-bottom-8 duration-700" style={{ fontFamily: "'Montserrat', sans-serif" }}>
            The Ultimate Platform for <br />
            <span style={{ color: BRAND.orange }}>March Madness Pools</span>
          </h1>

          {/* Stat Cards */}
          <div className="flex flex-wrap justify-center gap-4 mb-8">
            <div className="inline-flex items-center gap-4 rounded-2xl p-3 pr-6 shadow-xl animate-in fade-in slide-in-from-bottom-8 duration-700" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
              <div className="p-3 rounded-xl" style={{ backgroundColor: '#EF444420' }}>
                <Heart className="fill-current" size={24} style={{ color: '#EF4444' }} />
              </div>
              <div className="text-left">
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: BRAND.lightGray }}>Total Raised for Charity</p>
                <p className="text-2xl font-black text-white">${totalDonated.toLocaleString()}</p>
              </div>
            </div>

            <div className="inline-flex items-center gap-4 rounded-2xl p-3 pr-6 shadow-xl animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
              <div className="p-3 rounded-xl" style={{ backgroundColor: '#10B98120' }}>
                <Trophy className="fill-current" size={24} style={{ color: '#10B981' }} />
              </div>
              <div className="text-left">
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: BRAND.lightGray }}>Total Prizes Awarded</p>
                <p className="text-2xl font-black text-white">${totalPrizes?.toLocaleString() || '0'}</p>
              </div>
            </div>
          </div>

          <p className="text-lg md:text-xl max-w-2xl mx-auto mb-8 md:mb-10 leading-relaxed animate-in fade-in slide-in-from-bottom-12 duration-700 delay-100" style={{ color: BRAND.lightGray }}>
            The professional choice for <strong>office bracket pools</strong>. Real-time scoring, "Who to Root For" analytics, and Commission-Free Charity Fundraising.
          </p>

          {/* Hero Visual */}
          <div className="mt-16 md:mt-20 relative mx-auto max-w-5xl animate-in fade-in slide-in-from-bottom-20 duration-1000 delay-400">
            <div className="absolute inset-0 bg-gradient-to-b from-[#0A192F] via-transparent to-transparent z-20"></div>
            <div className="rounded-2xl p-2 shadow-2xl" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
              <div className="rounded-xl overflow-hidden relative group" style={{ backgroundColor: BRAND.navy }}>
                <img
                  src="/bracket-app-hero.png"
                  alt="March Melee Pools Tournament Dashboard with Bracket View"
                  loading="lazy"
                  className="w-full h-auto object-cover opacity-90 group-hover:opacity-100 transition-opacity duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-[#0A192F] via-transparent to-transparent opacity-60"></div>
              </div>
            </div>
            <div className="absolute -bottom-6 md:-bottom-10 left-1/2 transform -translate-x-1/2 bg-slate-800/90 backdrop-blur-md border border-slate-700 rounded-full py-3 px-8 shadow-2xl z-30 flex gap-8 whitespace-nowrap overflow-x-auto max-w-[90vw]">
              <div className="flex flex-col items-center">
                <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">First Round</span>
                <span className="text-emerald-400 font-bold">Mar 19-20</span>
              </div>
              <div className="w-px h-8 bg-slate-700"></div>
              <div className="flex flex-col items-center">
                <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Final Four</span>
                <span className="text-amber-400 font-bold">Apr 4</span>
              </div>
              <div className="w-px h-8 bg-slate-700"></div>
              <div className="flex flex-col items-center">
                <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Championship</span>
                <span className="text-white font-bold">Apr 6</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Cross-Link to Squares */}
      <section className="py-12 border-t border-b border-slate-800 bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <h3 className="text-2xl font-bold text-white mb-2">Looking to run a Super Bowl Squares pool?</h3>
            <p className="text-slate-400">We have a dedicated platform for 10x10 grids with live ESPN sync.</p>
          </div>
          <Link to="/gameday-squares" className="px-6 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-colors flex items-center gap-2 shrink-0">
            <LayoutGrid size={20} />
            Go to Gameday Squares
          </Link>
        </div>
      </section>

      {/* Feature Showcase Section */}
      <section className="py-24 relative overflow-hidden" style={{ backgroundColor: BRAND.navy }}>
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-0 w-[500px] h-[500px] rounded-full blur-[120px] opacity-20" style={{ backgroundColor: '#FF6600' }}></div>
          <div className="absolute bottom-1/4 right-0 w-[500px] h-[500px] rounded-full blur-[120px] opacity-20" style={{ backgroundColor: '#3B82F6' }}></div>
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <h2 className="text-3xl md:text-5xl font-black text-center text-white mb-16" style={{ fontFamily: "'Montserrat', sans-serif" }}>Everything You Need for Madness</h2>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="bg-slate-800/50 border border-slate-700 p-8 rounded-2xl hover:border-orange-500/50 transition-colors group">
              <div className="w-14 h-14 rounded-xl bg-orange-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Trophy className="text-orange-500" size={28} />
              </div>
              <h3 className="text-2xl font-bold text-white mb-4">Interactive Bracket</h3>
              <p className="text-slate-400 leading-relaxed mb-6">
                Our sleek, mobile-friendly bracket picker makes selecting teams a breeze. Drag, drop, and advance teams with a tap.
              </p>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Auto-save functionality</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> 'Smart Fill' for favorites</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Shareable bracket images</li>
              </ul>
            </div>

            {/* Feature 2 */}
            <div className="bg-slate-800/50 border border-slate-700 p-8 rounded-2xl hover:border-blue-500/50 transition-colors group">
              <div className="w-14 h-14 rounded-xl bg-blue-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <BarChart3 className="text-blue-500" size={28} />
              </div>
              <h3 className="text-2xl font-bold text-white mb-4">Advanced Analytics</h3>
              <p className="text-slate-400 leading-relaxed mb-6">
                Don't just watch the game. Know exactly how it affects your standing with our "Who to Root For" engine.
              </p>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Real-time Win Probability</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> 'What-If' Scenarios</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Pool-wide Pick Statistics</li>
              </ul>
            </div>

            {/* Feature 3 */}
            <div className="bg-slate-800/50 border border-slate-700 p-8 rounded-2xl hover:border-purple-500/50 transition-colors group">
              <div className="w-14 h-14 rounded-xl bg-purple-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Users className="text-purple-500" size={28} />
              </div>
              <h3 className="text-2xl font-bold text-white mb-4">Easy Management</h3>
              <p className="text-slate-400 leading-relaxed mb-6">
                Being a Commissioner has never been easier. We handle the scoring, the payouts, and the logistics.
              </p>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Automated Scoring</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Broadcast Email Tools</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Payment Tracking</li>
              </ul>
            </div>
          </div>

        </div>
      </section>

      {/* CTA Section */}
      <div className="border-t pt-24 pb-12" style={{ backgroundColor: BRAND.navy, borderColor: '#334155' }}>
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-5xl font-black text-white mb-8" style={{ fontFamily: "'Montserrat', sans-serif" }}>Ready to Fill Your Bracket?</h2>
          <button
            onClick={isLoggedIn ? onCreatePool : onSignup}
            className="text-white px-10 py-5 rounded-full text-xl font-black transition-all transform hover:scale-105 mb-4 hover:brightness-110"
            style={{ backgroundColor: BRAND.orange, boxShadow: `0 0 40px ${BRAND.orange}50` }}
          >
            Create Your Free Pool Now
          </button>
          <p className="text-sm font-bold uppercase tracking-wider mb-12" style={{ color: BRAND.orange }}>Limited Time Offer • No Credit Card Required</p>
        </div>
      </div>

      <Footer />
    </div>
  );
};