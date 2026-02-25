import React from 'react';
import type { User } from '../types';
import { Trophy, LayoutGrid, CheckCircle2, Heart, BarChart3, Users } from 'lucide-react';
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
    "description": "Easy online Super Bowl squares and sports betting pools",
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
    "description": "Online platform for sports pools and betting squares",
    "url": "https://www.marchmeleepools.com"
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "Is it free to start a pool?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Yes! You can create a pool for free. We also offer premium features for advanced customization."
        }
      },
      {
        "@type": "Question",
        "name": "How do payouts work?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Platform managers can record payments manually. We calculate exactly who is owed what based on the game results."
        }
      },
      {
        "@type": "Question",
        "name": "Can I run a charity pool?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Absolutely. You can set a percentage of the pot to go to a specific cause, and we'll display a donation tracker."
        }
      }
    ]
  },
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "March Melee Pools",
    "url": "https://www.marchmeleepools.com",
    "logo": "https://www.marchmeleepools.com/logo.png",
    "description": "Online platform for creating and hosting Super Bowl squares, NFL pools, and sports betting pools",
    "sameAs": [
      "https://twitter.com/marchmeleepools",
      "https://www.facebook.com/marchmeleepools"
    ]
  }
];

export const LandingPage: React.FC<LandingPageProps> = ({ user, isManager = false, onLogin, onSignup, onLogout, onCreatePool, onBrowse, totalDonated = 0, totalPrizes = 0, isLoggedIn }) => {

  return (
    <div className="min-h-screen text-white font-sans selection:bg-orange-500 selection:text-white" style={{ backgroundColor: BRAND.navy }}>
      <SEO
        title="March Melee Pools - Free Online Super Bowl Squares & Sports Pools"
        description="Create and host free NFL pools, Super Bowl squares, March Madness brackets & sports betting pools online. Real-time scoring, secure transactions, and charity options available."
        keywords="Super Bowl Squares, NFL Playoff Pool, March Madness Bracket, Sports Betting, Office Sports Pools, Host Sports Pools, Online Pool Manager, free online pools, football pool software"
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
            <span className="text-xs font-bold tracking-wide uppercase" style={{ color: BRAND.orange }}>2026 Tournament Registration Open</span>
          </div>

          <div className="flex justify-center mb-8 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100">
            <Countdown />
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-12 duration-700 delay-200 mb-8">
            <button
              onClick={isSuperAdmin(user) ? onCreatePool : undefined}
              disabled={!isSuperAdmin(user)}
              className="w-full sm:w-auto text-white px-8 py-4 rounded-xl text-lg font-bold shadow-xl transition-all flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100"
              style={{ backgroundColor: BRAND.orange, boxShadow: `0 10px 40px ${BRAND.orange}40` }}
              title={isSuperAdmin(user) ? "Create a Bracket Pool" : "Pool creation is coming soon"}
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
            Free Online Sports Pools & <br />
            <span style={{ color: BRAND.orange }}>March Madness Brackets</span>
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
      {/* How It Works Section */}
      <section className="py-24 border-t border-b border-slate-800 bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-black text-white mb-6" style={{ fontFamily: "'Montserrat', sans-serif" }}>Get Started in 3 Simple Steps</h2>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">Create Super Bowl squares free or setup a March Madness bracket pool with zero hassle. Here is how our online pool hosting works.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-12 text-center">
            <div className="relative">
              <div className="w-16 h-16 mx-auto bg-orange-500 rounded-full flex items-center justify-center text-2xl font-black text-white mb-6 shadow-lg shadow-orange-500/20">1</div>
              <h3 className="text-2xl font-bold text-white mb-4">Create Your Pool</h3>
              <p className="text-slate-400 leading-relaxed">Customize your rules, scoring logic, and entry fees. Set up a free online sports pool in less than 2 minutes.</p>
            </div>
            <div className="relative">
              <div className="w-16 h-16 mx-auto bg-emerald-500 rounded-full flex items-center justify-center text-2xl font-black text-white mb-6 shadow-lg shadow-emerald-500/20">2</div>
              <h3 className="text-2xl font-bold text-white mb-4">Invite Friends</h3>
              <p className="text-slate-400 leading-relaxed">Share your unique invite link with office colleagues, friends, or family. They can join instantly from any mobile device without downloading an app.</p>
            </div>
            <div className="relative">
              <div className="w-16 h-16 mx-auto bg-blue-500 rounded-full flex items-center justify-center text-2xl font-black text-white mb-6 shadow-lg shadow-blue-500/20">3</div>
              <h3 className="text-2xl font-bold text-white mb-4">Watch the Live Action</h3>
              <p className="text-slate-400 leading-relaxed">As the games happen, our real-time scoring engine automatically updates standings, win probabilities, and payouts so you don't have to lift a finger.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Why Choose Us & Use Cases Section */}
      <section className="py-24 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl md:text-5xl font-black text-white mb-6" style={{ fontFamily: "'Montserrat', sans-serif" }}>Why Host With March Melee?</h2>
              <p className="text-lg text-slate-400 mb-8 leading-relaxed">
                We built March Melee Pools because other football pool software and sports betting pool platforms were stuck in the past. We offer the fastest, most beautiful, and secure online platform for your group.
              </p>
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="w-12 h-12 rounded-xl bg-orange-500/20 flex items-center justify-center shrink-0">
                    <LayoutGrid className="text-orange-500" size={24} />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-white mb-2">Unmatched Customization</h4>
                    <p className="text-slate-400">Whether you want traditional March Madness brackets or complex online betting pools with friends, our engine supports your house rules seamlessly.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center shrink-0">
                    <Users className="text-blue-500" size={24} />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-white mb-2">Perfect for Any Group</h4>
                    <p className="text-slate-400">From competitive office sports pools to casual family tournaments and large-scale charity fundraisers, we scale to meet your needs.</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-3xl p-8 shadow-2xl">
              <h3 className="text-2xl font-bold text-white mb-6 border-b border-slate-700 pb-4">Popular Pool Types</h3>
              <ul className="space-y-4">
                <li className="flex items-center justify-between p-4 bg-slate-900 rounded-xl">
                  <span className="font-bold text-white">March Madness Bracket Pool</span>
                  <span className="text-xs font-bold text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full">Most Popular</span>
                </li>
                <li className="flex items-center justify-between p-4 bg-slate-900 rounded-xl">
                  <span className="font-bold text-white">Super Bowl Squares Online</span>
                  <span className="text-xs font-bold text-orange-400 bg-orange-400/10 px-3 py-1 rounded-full">Trending</span>
                </li>
                <li className="flex items-center justify-between p-4 bg-slate-900 rounded-xl">
                  <span className="font-bold text-white">NFL Playoff Pools</span>
                </li>
                <li className="flex items-center justify-between p-4 bg-slate-900 rounded-xl">
                  <span className="font-bold text-white">Charity Sports Betting Pools</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Expanded FAQ */}
      <section className="py-24 border-t border-slate-800 bg-slate-900/50">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-3xl md:text-5xl font-black text-center text-white mb-16" style={{ fontFamily: "'Montserrat', sans-serif" }}>Sports Pool FAQs</h2>

          <div className="space-y-6">
            <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-6">
              <h3 className="text-xl font-bold text-white mb-3">Is it free to start an online sports pool?</h3>
              <p className="text-slate-400 leading-relaxed">Yes! You can create a pool for free. Setting up a football pool or a bracket tournament costs nothing. We also offer premium features for advanced customization and massive groups.</p>
            </div>

            <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-6">
              <h3 className="text-xl font-bold text-white mb-3">How do payouts and entry fees work?</h3>
              <p className="text-slate-400 leading-relaxed">Platform managers can set entry fees and record payments manually. Our automated system calculates exactly who is owed what based on the live game results and your custom payout structure.</p>
            </div>

            <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-6">
              <h3 className="text-xl font-bold text-white mb-3">Can I run a charity sports pool?</h3>
              <p className="text-slate-400 leading-relaxed">Absolutely. March Melee is the best platform for charity sports pools. You can set a percentage of the total pot to go to a specific cause, and we'll display a transparent live donation tracker for all participants to see.</p>
            </div>

            <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-6">
              <h3 className="text-xl font-bold text-white mb-3">Are my transactions and data secure?</h3>
              <p className="text-slate-400 leading-relaxed">Security is our top priority. We provide a transparent audit trail for all transactions within your pool, use bank-level encryption, and never share your participant data with third parties.</p>
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
            onClick={isSuperAdmin(user) ? (isLoggedIn ? onCreatePool : onSignup) : undefined}
            disabled={!isSuperAdmin(user)}
            className="text-white px-10 py-5 rounded-full text-xl font-black transition-all transform hover:scale-105 mb-4 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:brightness-100"
            style={{ backgroundColor: BRAND.orange, boxShadow: `0 0 40px ${BRAND.orange}50` }}
            title={isSuperAdmin(user) ? "Create Your Free Pool Now" : "Pool creation is coming soon"}
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