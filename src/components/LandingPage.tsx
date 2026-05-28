import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { User } from '../types';
import { Trophy, LayoutGrid, CheckCircle2, Heart, Users, Shield, Zap, Percent } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import { Countdown } from './Countdown';
import { isSuperAdmin } from '../utils/auth';

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

import { SEO } from './SEO';

const landingPageSchemas = [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "url": "https://www.marchmeleepools.com",
    "name": "March Melee Pools",
    "description": "Easy online NFL Survivor, Weekly Pick'em, Margin pools and Super Bowl squares",
    "potentialAction": {
      "@type": "SearchAction",
      "target": "https://www.marchmeleepools.com/#browse?q={search_term_string}",
      "query-input": "required name=search_term_string"
    }
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "March Melee Pools",
    "applicationCategory": "WebApplication",
    "description": "Online platform for private NFL survivor, pick'em, and margin of victory pools",
    "url": "https://www.marchmeleepools.com"
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "Is it free to start an NFL pool?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Yes! You can initialize a standard pool for free, featuring real-time scoreboard syncing."
        }
      },
      {
        "@type": "Question",
        "name": "How does NFL Survivor rebuying work?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "If configured by the host, players can purchase rebuys before the specified deadline week directly inside their dashboard."
        }
      },
      {
        "@type": "Question",
        "name": "What is the Margin pool?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "In Margin pools, you pick one team each week. Your score is their margin of victory (or defeat). Ties are broken using a 5-step negative burden cascade."
        }
      }
    ]
  }
];

export const LandingPage: React.FC<LandingPageProps> = ({ user, isManager = false, onLogin, onSignup, onLogout, onCreatePool, onBrowse, totalDonated = 0, totalPrizes = 0, isLoggedIn }) => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen text-white font-sans selection:bg-orange-500 selection:text-white" style={{ backgroundColor: BRAND.navy }}>
      <SEO
        title="March Melee Pools - Free NFL Survivor, Pick'em & Margin Pools"
        description="Host free NFL Survivor, Weekly Pick'em, and Margin of Victory pools online. Enjoy real-time scoreboard integrations, automated tiebreaker sorting, and commission-free charity trackers."
        keywords="NFL Survivor Pool, Weekly Pick'em, Margin of Victory Pool, Super Bowl Squares, Office Football Pools, Online Pool Manager, free survivor pool host"
        schemas={landingPageSchemas}
      />

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
            <span className="text-xs font-bold tracking-wide uppercase" style={{ color: BRAND.orange }}>2026 NFL Season Pools are Open</span>
          </div>

          <div className="flex justify-center mb-8 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100">
            <Countdown />
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-12 duration-700 delay-200 mb-8">
            <button
              onClick={isSuperAdmin(user) ? onCreatePool : undefined}
              disabled={!isSuperAdmin(user)}
              className="w-full sm:w-auto text-white px-8 py-4 rounded-xl text-lg font-bold shadow-xl transition-all flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100 cursor-pointer"
              style={{ backgroundColor: BRAND.orange, boxShadow: `0 10px 40px ${BRAND.orange}40` }}
              title={isSuperAdmin(user) ? "Create an NFL Pool" : "Pool creation is coming soon"}
            >
              <Trophy size={20} /> Create an NFL Pool
            </button>
            <button
              onClick={onBrowse}
              className="w-full sm:w-auto text-white px-8 py-4 rounded-xl text-lg font-bold border shadow-sm transition-all flex items-center justify-center gap-2 hover:bg-white/5 cursor-pointer"
              style={{ borderColor: '#334155', backgroundColor: '#1E293B' }}
            >
              <LayoutGrid size={20} /> Browse Public Pools
            </button>
          </div>

          <h1 className="text-4xl md:text-7xl font-black text-white tracking-tight mb-6 md:mb-8 leading-tight animate-in fade-in slide-in-from-bottom-8 duration-700" style={{ fontFamily: "'Montserrat', sans-serif" }}>
            The Ultimate Platform for <br />
            <span style={{ color: BRAND.orange }}>NFL Survivor & Pick'em Pools</span>
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
            Host standard, high-stakes, or charity office pools. Seamlessly featuring <strong>used-team locking</strong>, confidence weight systems, and Margin of victory cascades.
          </p>

          {/* Hero Visual */}
          <div className="mt-16 md:mt-20 relative mx-auto max-w-5xl animate-in fade-in slide-in-from-bottom-20 duration-1000 delay-400">
            <div className="absolute inset-0 bg-gradient-to-b from-[#0A192F] via-transparent to-transparent z-20"></div>
            <div className="rounded-2xl p-2 shadow-2xl" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
              <div className="rounded-xl overflow-hidden relative group" style={{ backgroundColor: BRAND.navy }}>
                <img
                  src="/nfl-pools-hero.png"
                  alt="March Melee Pools NFL Survivor and Weekly Pick'em Dashboard"
                  loading="lazy"
                  className="w-full h-auto object-cover opacity-90 group-hover:opacity-100 transition-opacity duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-[#0A192F] via-transparent to-transparent opacity-60"></div>
              </div>
            </div>
            <div className="absolute -bottom-6 md:-bottom-10 left-1/2 transform -translate-x-1/2 bg-slate-800/90 backdrop-blur-md border border-slate-700 rounded-full py-3 px-8 shadow-2xl z-30 flex gap-8 whitespace-nowrap overflow-x-auto max-w-[90vw]">
              <div className="flex flex-col items-center">
                <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">NFL Kickoff</span>
                <span className="text-emerald-400 font-bold">Sep 10</span>
              </div>
              <div className="w-px h-8 bg-slate-700"></div>
              <div className="flex flex-col items-center">
                <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Mid-Season Rebuy</span>
                <span className="text-amber-400 font-bold">Week 4-6 Cutoff</span>
              </div>
              <div className="w-px h-8 bg-slate-700"></div>
              <div className="flex flex-col items-center">
                <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Super Bowl LX</span>
                <span className="text-white font-bold">Feb 8</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-24 border-t border-b border-slate-800 bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-black text-white mb-6" style={{ fontFamily: "'Montserrat', sans-serif" }}>Get Started in 3 Simple Steps</h2>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">Set up an office pool or play with friends. Our online pool hosting handles the tracking and scores automatically.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-12 text-center">
            <div className="relative">
              <div className="w-16 h-16 mx-auto bg-orange-500 rounded-full flex items-center justify-center text-2xl font-black text-white mb-6 shadow-lg shadow-orange-500/20">1</div>
              <h3 className="text-2xl font-bold text-white mb-4">Create Your Pool</h3>
              <p className="text-slate-400 leading-relaxed">Customize your rulesets: pick straight/confidence (Pick'em), set strikes & rebuys (Survivor), or launch Margin pools in under 2 minutes.</p>
            </div>
            <div className="relative">
              <div className="w-16 h-16 mx-auto bg-emerald-500 rounded-full flex items-center justify-center text-2xl font-black text-white mb-6 shadow-lg shadow-emerald-500/20">2</div>
              <h3 className="text-2xl font-bold text-white mb-4">Invite Participants</h3>
              <p className="text-slate-400 leading-relaxed">Share your unique invite link. Members can join instantly, review live standings, and log picks from any mobile browser without installs.</p>
            </div>
            <div className="relative">
              <div className="w-16 h-16 mx-auto bg-blue-500 rounded-full flex items-center justify-center text-2xl font-black text-white mb-6 shadow-lg shadow-blue-500/20">3</div>
              <h3 className="text-2xl font-bold text-white mb-4">Watch the Action</h3>
              <p className="text-slate-400 leading-relaxed">Our live ESPN scheduler feed monitors and scores every matchup automatically, compiling standings, margins, and recaps without manual spreadsheets.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Why Choose Us & Use Cases Section */}
      <section className="py-24 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl md:text-5xl font-black text-white mb-6" style={{ fontFamily: "'Montserrat', sans-serif" }}>Why Host with March Melee?</h2>
              <p className="text-lg text-slate-400 mb-8 leading-relaxed">
                Our NFL Pools engine is engineered for custom startup excellence. No outdated formats, cluttered sidebars, or delayed score updates.
              </p>
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="w-12 h-12 rounded-xl bg-orange-500/20 flex items-center justify-center shrink-0">
                    <LayoutGrid className="text-orange-500" size={24} />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-white mb-2">Unmatched Logic Customization</h4>
                    <p className="text-slate-400">Configure Confidence weights, lock restrictions (weekly vs per-game), Mulligans, or Pick-Loser modes with custom branding options.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center shrink-0">
                    <Users className="text-blue-500" size={24} />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-white mb-2">Perfect for Office Groups & Charity</h4>
                    <p className="text-slate-400">Add payment checkmarks to manage user buy-ins, or raise funds with commission-free charity donation trackers built in.</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-3xl p-8 shadow-2xl">
              <h3 className="text-2xl font-bold text-white mb-6 border-b border-slate-700 pb-4">NFL Pool Types</h3>
              <ul className="space-y-4">
                <li className="flex items-center justify-between p-4 bg-slate-900 rounded-xl">
                  <span className="font-bold text-white">🏈 NFL Survivor Pool</span>
                  <span className="text-xs font-bold text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full">Most Popular</span>
                </li>
                <li className="flex items-center justify-between p-4 bg-slate-900 rounded-xl">
                  <span className="font-bold text-white">🎯 Weekly Pick'em (Straight/Confidence)</span>
                  <span className="text-xs font-bold text-orange-400 bg-orange-400/10 px-3 py-1 rounded-full">Classic</span>
                </li>
                <li className="flex items-center justify-between p-4 bg-slate-900 rounded-xl">
                  <span className="font-bold text-white">⏱️ Margin of Victory Pool</span>
                  <span className="text-xs font-bold text-indigo-400 bg-indigo-400/10 px-3 py-1 rounded-full">Strategic</span>
                </li>
                <li className="flex items-center justify-between p-4 bg-slate-900 rounded-xl">
                  <span className="font-bold text-white">🟩 Super Bowl Squares (100-Grid)</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Dynamic Pricing Bento Section */}
      <section className="py-24 border-t border-slate-800 relative overflow-hidden bg-gradient-to-b from-[#0A192F] via-[#0D1F3D] to-[#0A192F]">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-7xl h-full pointer-events-none">
          <div className="absolute top-1/3 left-10 w-[300px] h-[300px] rounded-full blur-[120px] bg-orange-500/10 pointer-events-none" />
          <div className="absolute bottom-1/3 right-10 w-[300px] h-[300px] rounded-full blur-[120px] bg-indigo-500/10 pointer-events-none" />
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="text-center mb-16 space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 shadow-sm bg-orange-500/10 border border-orange-500/20">
              <Zap size={14} className="text-orange-500 animate-pulse" />
              <span className="text-xs font-bold tracking-wide uppercase text-orange-400">Pricing & Packages</span>
            </div>
            <h2 className="text-3xl md:text-5xl font-black text-white leading-tight" style={{ fontFamily: "'Montserrat', sans-serif" }}>
              Sleek Plans Built for <br className="hidden sm:inline" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-amber-400 to-indigo-400">Every Commissioner</span>
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              Start hosting your pools with a 14-day free trial. Scale seamlessly from friendly circles to massive leagues.
            </p>
          </div>

          {/* Bento Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch mb-16">
            
            {/* Card 1: Free Sandbox Tier (4 cols) */}
            <div className="lg:col-span-4 bg-slate-900/40 border border-slate-800 rounded-3xl p-8 hover:border-emerald-500/40 transition-all duration-300 flex flex-col justify-between shadow-2xl relative group hover:scale-[1.01]">
              <div className="space-y-6">
                <div className="flex justify-between items-start">
                  <div className="p-3.5 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 group-hover:scale-110 transition-transform duration-300">
                    <Users size={24} />
                  </div>
                  <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full">
                    Free Sandbox
                  </span>
                </div>
                <div className="space-y-2">
                  <h3 className="text-2xl font-bold text-white">Casual Friends Tier</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Completely free for small groups. Get the full premium engine experience without any setup fees or host charges.
                  </p>
                </div>
                <ul className="space-y-3 text-xs text-slate-300 pt-2">
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-emerald-500 shrink-0" /> 1 to 10 Participants</li>
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-emerald-500 shrink-0" /> Real-time ESPN Scoring Sync</li>
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-emerald-500 shrink-0" /> Standard Rules Customization</li>
                </ul>
              </div>
              <div className="pt-8">
                <div className="text-3xl font-black text-white mb-4">$0 <span className="text-xs text-slate-500 font-medium">/ forever</span></div>
                <button
                  onClick={() => navigate('/create-pool')}
                  className="w-full bg-slate-800/80 hover:bg-slate-750 text-slate-200 border border-slate-700/60 hover:border-slate-600 py-3 px-6 rounded-2xl text-xs font-bold transition-all"
                >
                  Launch Free Pool
                </button>
              </div>
            </div>

            {/* Card 2: Dynamic Pool Tier - Featured (5 cols) */}
            <div className="lg:col-span-5 bg-gradient-to-b from-indigo-950/20 via-slate-900/40 to-slate-900/40 border border-indigo-500/20 rounded-3xl p-8 hover:border-indigo-500/50 transition-all duration-300 flex flex-col justify-between shadow-2xl relative group hover:scale-[1.01] overflow-hidden">
              {/* Top ambient glow */}
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-indigo-500/10 blur-2xl pointer-events-none" />
              
              <div className="space-y-6">
                <div className="flex justify-between items-start">
                  <div className="p-3.5 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 group-hover:scale-110 transition-transform duration-300">
                    <Trophy size={24} />
                  </div>
                  <span className="bg-indigo-500/20 border border-indigo-500/35 text-indigo-300 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
                    <Zap size={10} className="fill-current text-indigo-300" /> Featured Plan
                  </span>
                </div>
                <div className="space-y-2">
                  <h3 className="text-2xl font-bold text-white">Dynamic Premium Pool</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Designed for medium to massive sports pools. Flexible scale-with-size tiers ensure you only pay for your active players.
                  </p>
                </div>
                <ul className="space-y-3 text-xs text-slate-300 pt-2">
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-indigo-400 shrink-0" /> Tiers based on active entries</li>
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-indigo-400 shrink-0" /> What-If Simulator & AI Commissioner</li>
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-indigo-400 shrink-0" /> Custom branding, logo and cover uploads</li>
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-indigo-400 shrink-0" /> Smart SMS Deadlines & Broadcasts</li>
                </ul>
              </div>
              <div className="pt-8">
                <div className="text-3xl font-black text-white mb-4">Starts at $9 <span className="text-xs text-slate-500 font-medium">/ pool</span></div>
                <button
                  onClick={() => navigate('/pricing')}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 px-6 rounded-2xl text-xs transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-1.5 group/btn"
                >
                  Estimate Pool Price
                  <Zap size={12} className="group-hover/btn:translate-x-0.5 transition-transform" />
                </button>
              </div>
            </div>

            {/* Card 3: Commissioner Packs (3 cols) */}
            <div className="lg:col-span-3 bg-slate-900/40 border border-slate-800 rounded-3xl p-8 hover:border-amber-500/40 transition-all duration-300 flex flex-col justify-between shadow-2xl relative group hover:scale-[1.01]">
              <div className="space-y-6">
                <div className="flex justify-between items-start">
                  <div className="p-3.5 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 group-hover:scale-110 transition-transform duration-300">
                    <Shield size={24} />
                  </div>
                  <span className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full">
                    Best Value
                  </span>
                </div>
                <div className="space-y-2">
                  <h3 className="text-2xl font-bold text-white">Universal Packs</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Host multiple pools? Buy upfront pool credits or unlock unlimited sports hosting for the entire season.
                  </p>
                </div>
                <ul className="space-y-3 text-xs text-slate-300 pt-2">
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-amber-400 shrink-0" /> Credits never expire</li>
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-amber-400 shrink-0" /> Unlimited Season Pass</li>
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-amber-400 shrink-0" /> Save up to 50%</li>
                </ul>
              </div>
              <div className="pt-8">
                <div className="text-3xl font-black text-white mb-4">$49 <span className="text-xs text-slate-500 font-medium">/ 3-pool bundle</span></div>
                <button
                  onClick={() => navigate('/pricing')}
                  className="w-full bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700/60 hover:border-slate-600 py-3 px-6 rounded-2xl text-xs font-bold transition-all"
                >
                  View Bundle Packages
                </button>
              </div>
            </div>

          </div>

          {/* Bottom Interactive Promotion Indicator */}
          <div className="bg-slate-900/20 border border-slate-850 p-6 rounded-2xl text-center max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 backdrop-blur-sm shadow-xl">
            <div className="text-left space-y-1">
              <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block">Interactive Estimator</span>
              <p className="text-sm text-slate-300 font-medium">
                Want to calculate exact pricing? Try our interactive price estimator calculator.
              </p>
            </div>
            <button
              onClick={() => navigate('/pricing')}
              className="bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 px-5 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap"
            >
              Open Pricing Calculator →
            </button>
          </div>

        </div>
      </section>

      {/* Expanded FAQ */}
      <section className="py-24 border-t border-slate-800 bg-slate-900/50">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-3xl md:text-5xl font-black text-center text-white mb-16" style={{ fontFamily: "'Montserrat', sans-serif" }}>NFL Pool FAQs</h2>

          <div className="space-y-6">
            <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-6">
              <h3 className="text-xl font-bold text-white mb-3">Is it free to start an online football pool?</h3>
              <p className="text-slate-400 leading-relaxed">Yes! Setting up a pool, configuring rules, and registering members is completely free. We offer premium options for massive leagues and branded layouts.</p>
            </div>

            <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-6">
              <h3 className="text-xl font-bold text-white mb-3">How does the lock buffer deadline work?</h3>
              <p className="text-slate-400 leading-relaxed">Picks are verified securely on the server. If a game has kicked off (minus your host's configured lock buffer, e.g. 5 minutes), the entry locks. Locked picks are visible to everyone to prevent cheat exploits.</p>
            </div>

            <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-6">
              <h3 className="text-xl font-bold text-white mb-3">What is the "Negative Burden" in Margin pools?</h3>
              <p className="text-slate-400 leading-relaxed">Negative Burden tracks the absolute sum of your losing selections. It is used as the primary tiebreaker in Margin Pools to reward consistent accuracy over risky selections.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Showcase Section */}
      <section className="py-24 relative overflow-hidden" style={{ backgroundColor: BRAND.navy }}>
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-0 w-[500px] h-[500px] rounded-full blur-[120px] opacity-20" style={{ backgroundColor: '#FF6600' }}></div>
          <div className="absolute bottom-1/4 right-0 w-[500px] h-[500px] rounded-full blur-[120px] opacity-20" style={{ backgroundColor: '#3B82F6' }}></div>
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <h2 className="text-3xl md:text-5xl font-black text-center text-white mb-16" style={{ fontFamily: "'Montserrat', sans-serif" }}>Designed for Gridiron Action</h2>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="bg-slate-800/50 border border-slate-700 p-8 rounded-2xl hover:border-orange-500/50 transition-colors group">
              <div className="w-14 h-14 rounded-xl bg-orange-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Shield className="text-orange-500" size={28} />
              </div>
              <h3 className="text-2xl font-bold text-white mb-4">NFL Survivor Suite</h3>
              <p className="text-slate-400 leading-relaxed mb-6">
                Uncompromising Survivor pool automation. Mulligans, strikes logging, bye week checks, and easy rebuy triggers.
              </p>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Used team lockouts</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Automatic strike logging</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Pre-deadline buybacks</li>
              </ul>
            </div>

            {/* Feature 2 */}
            <div className="bg-slate-800/50 border border-slate-700 p-8 rounded-2xl hover:border-blue-500/50 transition-colors group">
              <div className="w-14 h-14 rounded-xl bg-blue-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Zap className="text-blue-500" size={28} />
              </div>
              <h3 className="text-2xl font-bold text-white mb-4">Weekly Pick'em</h3>
              <p className="text-slate-400 leading-relaxed mb-6">
                Pick the winners of every matchup. Toggle Confidence weights or play classic Straight Pick'em.
              </p>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Dynamic confidence weights</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> MNF tiebreaker predictions</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Straight or ATS modes</li>
              </ul>
            </div>

            {/* Feature 3 */}
            <div className="bg-slate-800/50 border border-slate-700 p-8 rounded-2xl hover:border-purple-500/50 transition-colors group">
              <div className="w-14 h-14 rounded-xl bg-purple-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Percent className="text-purple-500" size={28} />
              </div>
              <h3 className="text-2xl font-bold text-white mb-4">Margin of Victory</h3>
              <p className="text-slate-400 leading-relaxed mb-6">
                Strategic football pools. Pick one victor each week and bank their exact victory margin.
              </p>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Margin score accumulation</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Negative burden tiebreakers</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Non-submission penalties (-14)</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <div className="border-t pt-24 pb-12" style={{ backgroundColor: BRAND.navy, borderColor: '#334155' }}>
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-5xl font-black text-white mb-8" style={{ fontFamily: "'Montserrat', sans-serif" }}>Ready to Kick Off the Season?</h2>
          <button
            onClick={isSuperAdmin(user) ? (isLoggedIn ? onCreatePool : onSignup) : undefined}
            disabled={!isSuperAdmin(user)}
            className="text-white px-10 py-5 rounded-full text-xl font-black transition-all transform hover:scale-105 mb-4 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:brightness-100 cursor-pointer"
            style={{ backgroundColor: BRAND.orange, boxShadow: `0 0 40px ${BRAND.orange}50` }}
            title={isSuperAdmin(user) ? "Create Your Free Pool Now" : "Pool creation is coming soon"}
          >
            Create Your Free Pool Now
          </button>
          <p className="text-sm font-bold uppercase tracking-wider mb-12" style={{ color: BRAND.orange }}>Start Hosting Free • No Credit Card Required</p>
        </div>
      </div>

      <Footer />
    </div>
  );
};