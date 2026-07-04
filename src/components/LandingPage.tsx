import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { User } from '../types';
import { Trophy, LayoutGrid, CheckCircle2, Heart, Users, Shield, Zap, Percent, Target, Timer, Grid3X3 } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import { Countdown } from './Countdown';
import { canAccessPoolCreation, POOL_CREATION_ENABLED } from '../utils/auth';
import { cn } from './ui/cn';

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

/* Nav / hero / footer stay navy chrome in both themes; the content sections
   between them flip cream <-> navy via CSS-var surfaces (bg-page/surface/card). */

const h2Cls = 'font-display font-extrabold uppercase text-3xl md:text-5xl leading-[0.95] text-[color:var(--text)]';
const bodyMuted = 'font-body text-muted';
const cardCls = 'bg-card border border-line rounded-2xl';
// Cards that sit ON the navy hero — always dark
const heroCardCls = 'bg-navy-900 border border-[rgba(230,206,150,0.16)] rounded-2xl';

const heroBtn =
  'w-full sm:w-auto inline-flex items-center justify-center gap-2 font-display font-bold uppercase tracking-[0.05em] text-[17px] px-[34px] py-4 rounded-lg transition-all duration-150 hover:-translate-y-px cursor-pointer';

export const LandingPage: React.FC<LandingPageProps> = ({ user, isManager = false, onLogin, onSignup, onLogout, onCreatePool, onBrowse, totalDonated = 0, totalPrizes = 0, isLoggedIn }) => {
  const navigate = useNavigate();
  const canCreate = canAccessPoolCreation(user);

  return (
    <div className="min-h-screen bg-page text-[color:var(--text)] font-body">
      {/* SEO/meta for '/' is provided centrally by <RouteSEO /> (see src/seoConfig.ts). */}

      {/* Shared Header for Consistency */}
      <Header
        user={user || null}
        isManager={isManager}
        onOpenAuth={onLogin}
        onLogout={onLogout || (() => { })}
        onCreatePool={onCreatePool}
      />

      {/* Hero Section — navy chrome (always dark) */}
      <section className="relative overflow-hidden bg-navy-950 text-white pt-12 md:pt-20 pb-20 md:pb-32">
        {/* Layered radial gradients — red / navy / gold */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 right-0 w-[560px] h-[560px] rounded-full blur-[130px] bg-brandred-600/15"></div>
          <div className="absolute bottom-0 left-0 w-[560px] h-[560px] rounded-full blur-[130px] bg-navy-600/25"></div>
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[420px] h-[420px] rounded-full blur-[140px] bg-gold-500/10"></div>
          {/* Faint 52px grid overlay */}
          <div className="absolute inset-0 opacity-[0.05] bg-[linear-gradient(to_right,#E6CE96_1px,transparent_1px),linear-gradient(to_bottom,#E6CE96_1px,transparent_1px)] bg-[size:52px_52px]"></div>
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-6 md:mb-8 bg-brandred-600/15 border border-brandred-600/35 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <span className="flex h-2 w-2 rounded-full bg-brandred-500 animate-live-pulse"></span>
            <span className="font-display font-bold uppercase text-xs tracking-[0.16em] text-brandred-500">2026 NFL Season Pools Coming Soon</span>
          </div>

          <div className="flex justify-center mb-8 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100">
            <Countdown />
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-12 duration-700 delay-200 mb-8">
            <button
              onClick={canCreate ? onCreatePool : undefined}
              disabled={!canCreate}
              className={cn(
                heroBtn,
                'bg-brandred-600 text-white shadow-red-cta hover:bg-brandred-500',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:shadow-none'
              )}
              title={canCreate ? "Create an NFL Pool" : "Pool creation is coming soon"}
            >
              <Trophy size={20} /> {canCreate ? 'Create an NFL Pool' : 'Pool Creation Coming Soon'}
            </button>
            <button
              onClick={onBrowse}
              className={cn(heroBtn, 'border-[1.5px] border-white/30 text-white hover:border-gold-500 hover:text-gold-300 bg-transparent')}
            >
              <LayoutGrid size={20} /> Browse Public Pools
            </button>
          </div>

          <h1 className="font-display font-extrabold uppercase text-4xl md:text-[74px] text-white tracking-tight mb-6 md:mb-8 leading-[0.9] animate-in fade-in slide-in-from-bottom-8 duration-700">
            The Ultimate Platform for <br />
            <span className="text-gold-400">NFL Survivor & Pick'em Pools</span>
          </h1>

          {/* Trust-stat row */}
          <div className="flex flex-wrap justify-center gap-4 mb-8">
            <div className={cn(heroCardCls, 'inline-flex items-center gap-4 p-3 pr-6 shadow-panel animate-in fade-in slide-in-from-bottom-8 duration-700')}>
              <div className="p-3 rounded-lg bg-brandred-600/15">
                <Heart size={24} className="text-brandred-500" />
              </div>
              <div className="text-left">
                <p className="font-display font-bold uppercase text-xs tracking-[0.08em] text-[#9FB0CC]">Total Raised for Charity</p>
                <p className="font-display font-bold text-2xl text-gold-400 num">${totalDonated.toLocaleString()}</p>
              </div>
            </div>

            <div className={cn(heroCardCls, 'inline-flex items-center gap-4 p-3 pr-6 shadow-panel animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100')}>
              <div className="p-3 rounded-lg bg-gold-500/15">
                <Trophy size={24} className="text-gold-400" />
              </div>
              <div className="text-left">
                <p className="font-display font-bold uppercase text-xs tracking-[0.08em] text-[#9FB0CC]">Total Prizes Awarded</p>
                <p className="font-display font-bold text-2xl text-gold-400 num">${totalPrizes?.toLocaleString() || '0'}</p>
              </div>
            </div>
          </div>

          <p className="font-body text-[#9FB0CC] text-lg md:text-xl max-w-2xl mx-auto mb-8 md:mb-10 leading-relaxed animate-in fade-in slide-in-from-bottom-12 duration-700 delay-100">
            Host standard, high-stakes, or charity office pools. Seamlessly featuring <strong className="text-white">used-team locking</strong>, confidence weight systems, and Margin of victory cascades.
          </p>

          {/* Hero Visual */}
          <div className="mt-16 md:mt-20 relative mx-auto max-w-5xl animate-in fade-in slide-in-from-bottom-20 duration-1000 delay-400">
            <div className="absolute inset-0 bg-gradient-to-b from-navy-950 via-transparent to-transparent z-20"></div>
            <div className={cn(heroCardCls, 'rounded-3xl p-2 shadow-panel')}>
              <div className="rounded-xl overflow-hidden relative group bg-navy-950">
                <img
                  src="/nfl-pools-hero.png"
                  alt="March Melee Pools NFL Survivor and Weekly Pick'em Dashboard"
                  loading="lazy"
                  className="w-full h-auto object-cover opacity-90 group-hover:opacity-100 transition-opacity duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-navy-950 via-transparent to-transparent opacity-60"></div>
              </div>
            </div>
            <div className="absolute -bottom-6 md:-bottom-10 left-1/2 transform -translate-x-1/2 bg-navy-900/90 backdrop-blur-md border border-[rgba(230,206,150,0.16)] rounded-full py-3 px-8 shadow-panel z-30 flex gap-8 whitespace-nowrap overflow-x-auto max-w-[90vw]">
              <div className="flex flex-col items-center">
                <span className="font-display font-bold uppercase text-xs tracking-[0.08em] text-[#9FB0CC]">NFL Kickoff</span>
                <span className="font-display font-bold text-gold-400 num">Sep 10</span>
              </div>
              <div className="w-px h-8 bg-[rgba(230,206,150,0.16)]"></div>
              <div className="flex flex-col items-center">
                <span className="font-display font-bold uppercase text-xs tracking-[0.08em] text-[#9FB0CC]">Mid-Season Rebuy</span>
                <span className="font-display font-bold text-white num">Week 4-6 Cutoff</span>
              </div>
              <div className="w-px h-8 bg-[rgba(230,206,150,0.16)]"></div>
              <div className="flex flex-col items-center">
                <span className="font-display font-bold uppercase text-xs tracking-[0.08em] text-[#9FB0CC]">Super Bowl LX</span>
                <span className="font-display font-bold text-white num">Feb 8</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section — flips */}
      <section className="py-24 border-t border-b border-line bg-surface">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className={cn(h2Cls, 'mb-6')}>Get Started in 3 Simple Steps</h2>
            <p className={cn(bodyMuted, 'text-xl max-w-2xl mx-auto')}>Set up an office pool or play with friends. Our online pool hosting handles the tracking and scores automatically.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-12 text-center">
            <div className="relative">
              <div className="w-16 h-16 mx-auto bg-brandred-600 rounded-full flex items-center justify-center font-display font-extrabold text-2xl text-white mb-6 shadow-red-cta num">1</div>
              <h3 className="font-display font-bold uppercase text-2xl text-[color:var(--text)] mb-4">Create Your Pool</h3>
              <p className={cn(bodyMuted, 'leading-relaxed')}>Customize your rulesets: pick straight/confidence (Pick'em), set strikes & rebuys (Survivor), or launch Margin pools in under 2 minutes.</p>
            </div>
            <div className="relative">
              <div className="w-16 h-16 mx-auto bg-gold-foil rounded-full flex items-center justify-center font-display font-extrabold text-2xl text-navy-900 mb-6 num">2</div>
              <h3 className="font-display font-bold uppercase text-2xl text-[color:var(--text)] mb-4">Invite Participants</h3>
              <p className={cn(bodyMuted, 'leading-relaxed')}>Share your unique invite link. Members can join instantly, review live standings, and log picks from any mobile browser without installs.</p>
            </div>
            <div className="relative">
              <div className="w-16 h-16 mx-auto bg-navy-600 rounded-full flex items-center justify-center font-display font-extrabold text-2xl text-white mb-6 num">3</div>
              <h3 className="font-display font-bold uppercase text-2xl text-[color:var(--text)] mb-4">Watch the Action</h3>
              <p className={cn(bodyMuted, 'leading-relaxed')}>Our live ESPN scheduler feed monitors and scores every matchup automatically, compiling standings, margins, and recaps without manual spreadsheets.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Why Choose Us & Use Cases Section — flips */}
      <section className="py-24 relative overflow-hidden bg-page">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className={cn(h2Cls, 'mb-6')}>Why Host with March Melee?</h2>
              <p className={cn(bodyMuted, 'text-lg mb-8 leading-relaxed')}>
                Our NFL Pools engine is engineered for custom startup excellence. No outdated formats, cluttered sidebars, or delayed score updates.
              </p>
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="w-12 h-12 rounded-lg bg-gold-500/15 flex items-center justify-center shrink-0">
                    <LayoutGrid className="text-gold-600 dark:text-gold-400" size={24} />
                  </div>
                  <div>
                    <h4 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-2">Unmatched Logic Customization</h4>
                    <p className={bodyMuted}>Configure Confidence weights, lock restrictions (weekly vs per-game), Mulligans, or Pick-Loser modes with custom branding options.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-12 h-12 rounded-lg bg-navy-600/15 flex items-center justify-center shrink-0">
                    <Users className="text-navy-700 dark:text-[#9FB0CC]" size={24} />
                  </div>
                  <div>
                    <h4 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-2">Perfect for Office Groups & Charity</h4>
                    <p className={bodyMuted}>Add payment checkmarks to manage user buy-ins, or raise funds with commission-free charity donation trackers built in.</p>
                  </div>
                </div>
              </div>
            </div>
            <div className={cn(cardCls, 'rounded-3xl p-8 shadow-panel')}>
              <h3 className="font-display font-bold uppercase text-2xl text-[color:var(--text)] mb-6 border-b border-line pb-4">NFL Pool Types</h3>
              <ul className="space-y-4">
                <li className="flex items-center justify-between p-4 bg-surface border border-line rounded-xl">
                  <span className="flex items-center gap-2.5 font-display font-bold uppercase text-[color:var(--text)]"><Shield size={18} className="text-gold-600 dark:text-gold-400" /> NFL Survivor Pool</span>
                  <span className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-navy-900 bg-gold-400 px-3 py-1 rounded-full">Most Popular</span>
                </li>
                <li className="flex items-center justify-between p-4 bg-surface border border-line rounded-xl">
                  <span className="flex items-center gap-2.5 font-display font-bold uppercase text-[color:var(--text)]"><Target size={18} className="text-gold-600 dark:text-gold-400" /> Weekly Pick'em (Straight/Confidence)</span>
                  <span className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted border border-line px-3 py-1 rounded-full">Classic</span>
                </li>
                <li className="flex items-center justify-between p-4 bg-surface border border-line rounded-xl">
                  <span className="flex items-center gap-2.5 font-display font-bold uppercase text-[color:var(--text)]"><Timer size={18} className="text-gold-600 dark:text-gold-400" /> Margin of Victory Pool</span>
                  <span className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted border border-line px-3 py-1 rounded-full">Strategic</span>
                </li>
                <li className="flex items-center justify-between p-4 bg-surface border border-line rounded-xl">
                  <span className="flex items-center gap-2.5 font-display font-bold uppercase text-[color:var(--text)]"><Grid3X3 size={18} className="text-gold-600 dark:text-gold-400" /> Super Bowl Squares (100-Grid)</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Dynamic Pricing Bento Section — flips */}
      <section className="py-24 border-t border-line relative overflow-hidden bg-surface">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-7xl h-full pointer-events-none">
          <div className="absolute top-1/3 left-10 w-[300px] h-[300px] rounded-full blur-[120px] bg-gold-500/10 pointer-events-none" />
          <div className="absolute bottom-1/3 right-10 w-[300px] h-[300px] rounded-full blur-[120px] bg-brandred-600/5 pointer-events-none" />
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="text-center mb-16 space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 bg-gold-500/10 border border-gold-500/25">
              <Zap size={14} className="text-gold-600 dark:text-gold-400" />
              <span className="font-display font-bold uppercase text-xs tracking-[0.16em] text-gold-600 dark:text-gold-400">Pricing & Packages</span>
            </div>
            <h2 className={h2Cls}>
              Sleek Plans Built for <br className="hidden sm:inline" />
              <span className="text-gold-600 dark:text-gold-400">Every Commissioner</span>
            </h2>
            <p className={cn(bodyMuted, 'text-lg max-w-2xl mx-auto')}>
              Start hosting your pools with a 14-day free trial. Scale seamlessly from friendly circles to massive leagues.
            </p>
          </div>

          {/* Bento Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch mb-16">

            {/* Card 1: Free Sandbox Tier (4 cols) */}
            <div className={cn(cardCls, 'lg:col-span-4 rounded-3xl p-8 hover:border-gold-500/40 transition-all duration-300 flex flex-col justify-between shadow-card relative group hover:-translate-y-1')}>
              <div className="space-y-6">
                <div className="flex justify-between items-start">
                  <div className="p-3.5 rounded-2xl bg-navy-600/10 text-navy-700 dark:text-[#9FB0CC] border border-line">
                    <Users size={24} />
                  </div>
                  <span className="border border-line text-muted font-display font-bold uppercase text-[10px] tracking-[0.08em] px-2.5 py-1 rounded-full">
                    Free Sandbox
                  </span>
                </div>
                <div className="space-y-2">
                  <h3 className="font-display font-bold uppercase text-2xl text-[color:var(--text)]">Casual Friends Tier</h3>
                  <p className={cn(bodyMuted, 'text-sm leading-relaxed')}>
                    Completely free for small groups. Get the full premium engine experience without any setup fees or host charges.
                  </p>
                </div>
                <ul className="space-y-3 text-sm text-[color:var(--text)] pt-2 font-body">
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400 shrink-0" /> 1 to 10 Participants</li>
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400 shrink-0" /> Real-time ESPN Scoring Sync</li>
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400 shrink-0" /> Standard Rules Customization</li>
                </ul>
              </div>
              <div className="pt-8">
                <div className="font-display font-extrabold text-3xl text-[color:var(--text)] mb-4 num">$0 <span className="text-xs text-faint font-body font-medium normal-case">/ forever</span></div>
                <button
                  onClick={canCreate ? () => navigate('/create-pool') : undefined}
                  disabled={!canCreate}
                  className="w-full border-[1.5px] border-navy-800 text-navy-800 hover:bg-navy-800 hover:text-white dark:border-line dark:text-[color:var(--text)] dark:hover:bg-white/10 py-3 px-6 rounded-md font-display font-bold uppercase tracking-[0.05em] text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  title={canCreate ? 'Launch a free pool' : 'Pool creation is coming soon'}
                >
                  {canCreate ? 'Launch Free Pool' : 'Coming Soon'}
                </button>
              </div>
            </div>

            {/* Card 2: Dynamic Pool Tier - Featured (5 cols) */}
            <div className="lg:col-span-5 bg-card border border-gold-500/40 rounded-3xl p-8 hover:border-gold-500/70 transition-all duration-300 flex flex-col justify-between shadow-panel relative group hover:-translate-y-1 overflow-hidden">
              {/* Top ambient glow */}
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-gold-500/10 blur-2xl pointer-events-none" />

              <div className="space-y-6">
                <div className="flex justify-between items-start">
                  <div className="p-3.5 rounded-2xl bg-gold-500/10 text-gold-600 dark:text-gold-400 border border-gold-500/25">
                    <Trophy size={24} />
                  </div>
                  <span className="bg-gold-foil text-navy-900 font-display font-bold uppercase text-[10px] tracking-[0.08em] px-2.5 py-1 rounded-full flex items-center gap-1.5">
                    <Zap size={10} /> Featured Plan
                  </span>
                </div>
                <div className="space-y-2">
                  <h3 className="font-display font-bold uppercase text-2xl text-[color:var(--text)]">Dynamic Premium Pool</h3>
                  <p className={cn(bodyMuted, 'text-sm leading-relaxed')}>
                    Designed for medium to massive sports pools. Flexible scale-with-size tiers ensure you only pay for your active players.
                  </p>
                </div>
                <ul className="space-y-3 text-sm text-[color:var(--text)] pt-2 font-body">
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400 shrink-0" /> Tiers based on active entries</li>
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400 shrink-0" /> What-If Simulator & AI Commissioner</li>
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400 shrink-0" /> Custom branding, logo and cover uploads</li>
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400 shrink-0" /> Smart SMS Deadlines & Broadcasts</li>
                </ul>
              </div>
              <div className="pt-8">
                <div className="font-display font-extrabold text-3xl text-[color:var(--text)] mb-4 num">Starts at $9 <span className="text-xs text-faint font-body font-medium normal-case">/ pool</span></div>
                <button
                  onClick={() => navigate('/pricing')}
                  className="w-full bg-gold-foil text-navy-900 font-display font-bold uppercase tracking-[0.05em] py-3.5 px-6 rounded-md text-xs transition-all shadow-[0_6px_16px_rgba(140,109,51,0.28)] hover:brightness-105 flex items-center justify-center gap-1.5 group/btn"
                >
                  Estimate Pool Price
                  <Zap size={12} className="group-hover/btn:translate-x-0.5 transition-transform" />
                </button>
              </div>
            </div>

            {/* Card 3: Commissioner Packs (3 cols) */}
            <div className={cn(cardCls, 'lg:col-span-3 rounded-3xl p-8 hover:border-gold-500/40 transition-all duration-300 flex flex-col justify-between shadow-card relative group hover:-translate-y-1')}>
              <div className="space-y-6">
                <div className="flex justify-between items-start">
                  <div className="p-3.5 rounded-2xl bg-gold-500/10 text-gold-600 dark:text-gold-400 border border-line">
                    <Shield size={24} />
                  </div>
                  <span className="border border-gold-500/40 text-gold-600 dark:text-gold-400 font-display font-bold uppercase text-[10px] tracking-[0.08em] px-2.5 py-1 rounded-full">
                    Best Value
                  </span>
                </div>
                <div className="space-y-2">
                  <h3 className="font-display font-bold uppercase text-2xl text-[color:var(--text)]">Universal Packs</h3>
                  <p className={cn(bodyMuted, 'text-sm leading-relaxed')}>
                    Host multiple pools? Buy upfront pool credits or unlock unlimited sports hosting for the entire season.
                  </p>
                </div>
                <ul className="space-y-3 text-sm text-[color:var(--text)] pt-2 font-body">
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400 shrink-0" /> Credits never expire</li>
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400 shrink-0" /> Unlimited Season Pass</li>
                  <li className="flex items-center gap-2.5"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400 shrink-0" /> Save up to 50%</li>
                </ul>
              </div>
              <div className="pt-8">
                <div className="font-display font-extrabold text-3xl text-[color:var(--text)] mb-4 num">$49 <span className="text-xs text-faint font-body font-medium normal-case">/ 3-pool bundle</span></div>
                <button
                  onClick={() => navigate('/pricing')}
                  className="w-full bg-navy-800 hover:bg-navy-700 text-white py-3 px-6 rounded-md font-display font-bold uppercase tracking-[0.05em] text-xs transition-all"
                >
                  View Bundle Packages
                </button>
              </div>
            </div>

          </div>

          {/* Bottom Interactive Promotion Indicator */}
          <div className={cn(cardCls, 'p-6 text-center max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 shadow-card')}>
            <div className="text-left space-y-1">
              <span className="font-display font-bold uppercase text-[10px] text-gold-600 dark:text-gold-400 tracking-[0.16em] block">Interactive Estimator</span>
              <p className="text-sm text-[color:var(--text)] font-body">
                Want to calculate exact pricing? Try our interactive price estimator calculator.
              </p>
            </div>
            <button
              onClick={() => navigate('/pricing')}
              className="border-[1.5px] border-gold-500/50 text-gold-600 dark:text-gold-300 hover:bg-gold-500/10 px-5 py-2.5 rounded-md font-display font-bold uppercase tracking-[0.05em] text-xs transition-all whitespace-nowrap"
            >
              Open Pricing Calculator →
            </button>
          </div>

        </div>
      </section>

      {/* Expanded FAQ — flips */}
      <section className="py-24 border-t border-line bg-page">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className={cn(h2Cls, 'text-center mb-16')}>NFL Pool FAQs</h2>

          <div className="space-y-6">
            <div className={cn(cardCls, 'p-6')}>
              <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-3">Is it free to start an online football pool?</h3>
              <p className={cn(bodyMuted, 'leading-relaxed')}>Yes! Setting up a pool, configuring rules, and registering members is completely free. We offer premium options for massive leagues and branded layouts.</p>
            </div>

            <div className={cn(cardCls, 'p-6')}>
              <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-3">How does the lock buffer deadline work?</h3>
              <p className={cn(bodyMuted, 'leading-relaxed')}>Picks are verified securely on the server. If a game has kicked off (minus your host's configured lock buffer, e.g. 5 minutes), the entry locks. Locked picks are visible to everyone to prevent cheat exploits.</p>
            </div>

            <div className={cn(cardCls, 'p-6')}>
              <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-3">What is the "Negative Burden" in Margin pools?</h3>
              <p className={cn(bodyMuted, 'leading-relaxed')}>Negative Burden tracks the absolute sum of your losing selections. It is used as the primary tiebreaker in Margin Pools to reward consistent accuracy over risky selections.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Showcase Section — flips */}
      <section className="py-24 relative overflow-hidden bg-surface">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-0 w-[500px] h-[500px] rounded-full blur-[120px] opacity-10 bg-brandred-600"></div>
          <div className="absolute bottom-1/4 right-0 w-[500px] h-[500px] rounded-full blur-[120px] opacity-10 bg-gold-500"></div>
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <h2 className={cn(h2Cls, 'text-center mb-16')}>Designed for Gridiron Action</h2>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className={cn(cardCls, 'p-8 hover:border-gold-500/50 transition-colors group')}>
              <div className="w-14 h-14 rounded-lg bg-gold-500/15 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Shield className="text-gold-600 dark:text-gold-400" size={28} />
              </div>
              <h3 className="font-display font-bold uppercase text-2xl text-[color:var(--text)] mb-4">NFL Survivor Suite</h3>
              <p className={cn(bodyMuted, 'leading-relaxed mb-6')}>
                Uncompromising Survivor pool automation. Mulligans, strikes logging, bye week checks, and easy rebuy triggers.
              </p>
              <ul className="space-y-2 text-sm text-[color:var(--text)] font-body">
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400" /> Used team lockouts</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400" /> Automatic strike logging</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400" /> Pre-deadline buybacks</li>
              </ul>
            </div>

            {/* Feature 2 */}
            <div className={cn(cardCls, 'p-8 hover:border-gold-500/50 transition-colors group')}>
              <div className="w-14 h-14 rounded-lg bg-navy-600/15 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Zap className="text-navy-700 dark:text-[#9FB0CC]" size={28} />
              </div>
              <h3 className="font-display font-bold uppercase text-2xl text-[color:var(--text)] mb-4">Weekly Pick'em</h3>
              <p className={cn(bodyMuted, 'leading-relaxed mb-6')}>
                Pick the winners of every matchup. Toggle Confidence weights or play classic Straight Pick'em.
              </p>
              <ul className="space-y-2 text-sm text-[color:var(--text)] font-body">
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400" /> Dynamic confidence weights</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400" /> MNF tiebreaker predictions</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400" /> Straight or ATS modes</li>
              </ul>
            </div>

            {/* Feature 3 */}
            <div className={cn(cardCls, 'p-8 hover:border-gold-500/50 transition-colors group')}>
              <div className="w-14 h-14 rounded-lg bg-brandred-600/15 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Percent className="text-brandred-500" size={28} />
              </div>
              <h3 className="font-display font-bold uppercase text-2xl text-[color:var(--text)] mb-4">Margin of Victory</h3>
              <p className={cn(bodyMuted, 'leading-relaxed mb-6')}>
                Strategic football pools. Pick one victor each week and bank their exact victory margin.
              </p>
              <ul className="space-y-2 text-sm text-[color:var(--text)] font-body">
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400" /> Margin score accumulation</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400" /> Negative burden tiebreakers</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-gold-600 dark:text-gold-400" /> Non-submission penalties (-14)</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section — navy chrome banner (always dark) */}
      <div className="border-t border-[rgba(230,206,150,0.16)] pt-24 pb-12 bg-navy-950">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="font-display font-extrabold uppercase text-3xl md:text-5xl leading-[0.95] text-white mb-8">Ready to Kick Off the Season?</h2>
          <button
            onClick={canCreate ? (isLoggedIn ? onCreatePool : onSignup) : undefined}
            disabled={!canCreate}
            className="bg-brandred-600 text-white px-10 py-5 rounded-lg font-display font-extrabold uppercase tracking-[0.05em] text-xl transition-all hover:-translate-y-px hover:bg-brandred-500 shadow-red-cta mb-4 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:shadow-none cursor-pointer"
            title={canCreate ? "Create Your Free Pool Now" : "Pool creation is coming soon"}
          >
            {canCreate ? 'Create Your Free Pool Now' : 'Pool Creation Coming Soon'}
          </button>
          <p className="font-display font-bold uppercase text-sm tracking-[0.16em] text-gold-400 mb-12">
            {POOL_CREATION_ENABLED ? 'Start Hosting Free • No Credit Card Required' : 'Browse Public Pools While We Get Ready For Kickoff'}
          </p>
        </div>
      </div>

      <Footer />
    </div>
  );
};
