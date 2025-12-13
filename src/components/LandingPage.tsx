import React from 'react';
import { Logo } from './Logo';
import { Trophy, Zap, Shield, LayoutGrid, Award, Calendar, CheckCircle2, Heart } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { Footer } from './Footer';

interface LandingPageProps {
  onLogin: () => void;
  onSignup: () => void;
  onBrowse: () => void;
  isLoggedIn: boolean;
  totalDonated?: number;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onLogin, onSignup, onBrowse, isLoggedIn, totalDonated = 0 }) => {
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
            <button
              onClick={() => window.location.hash = '#features'}
              className="hidden md:flex items-center gap-2 text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors ml-4"
            >
              <Zap size={18} /> Features
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
            Create and Join <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-purple-600 to-rose-600 dark:from-orange-400 dark:via-amber-400 dark:to-rose-400">Super Bowl Squares & Sports Pools Online</span>
          </h1>

          {/* Charity Stat Card */}
          {totalDonated > 0 && (
            <div className="mb-8 inline-flex items-center gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 pr-6 shadow-xl animate-in fade-in slide-in-from-bottom-8 duration-700">
              <div className="bg-rose-500/10 p-3 rounded-xl">
                <Heart className="text-rose-500 fill-rose-500" size={24} />
              </div>
              <div className="text-left">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Raised for Charity</p>
                <p className="text-2xl font-black text-slate-900 dark:text-white">${totalDonated.toLocaleString()}</p>
              </div>
            </div>
          )}

          <p className="text-lg md:text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto mb-8 md:mb-10 leading-relaxed animate-in fade-in slide-in-from-bottom-12 duration-700 delay-100">
            The professional platform for managing sports pools. Automated scoring, real-time payouts, and extensive customization for the ultimate grid experience.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-12 duration-700 delay-200">
            <button
              onClick={onSignup}
              className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 dark:bg-orange-600 dark:hover:bg-orange-500 text-white px-8 py-4 rounded-xl text-lg font-bold shadow-xl shadow-indigo-600/20 dark:shadow-orange-500/30 transition-all flex items-center justify-center gap-2"
            >
              <Trophy size={20} /> Create a Free Pool Now
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
                  alt="10x10 Super Bowl squares grid example"
                  loading="lazy"
                  className="w-full h-auto object-cover opacity-90 group-hover:opacity-100 transition-opacity duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-50 dark:from-slate-950 via-transparent to-transparent opacity-60"></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SEO Content Section */}
      <section className="py-20 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 border-t border-slate-200 dark:border-slate-800">
        <div className="max-w-4xl mx-auto px-6 space-y-16">

          {/* Popular Pools */}
          <div>
            <h2 className="text-3xl font-bold mb-6">Popular Pools: Super Bowl, March Madness, and More</h2>
            <p className="text-lg text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
              Whether you are looking for the best <strong>Super Bowl squares app 2026</strong> or a reliable way to run your office <strong>March Madness bracket pools</strong>, March Melee Pools has you covered. Our platform supports a wide range of sports pools tailored for major events.
            </p>
            <ul className="list-disc pl-6 space-y-2 text-slate-600 dark:text-slate-400">
              <li><strong>Super Bowl Squares:</strong> The classic 10x10 grid. Perfect for the big game.</li>
              <li><strong>March Madness Pools:</strong> Bracket challenges and survivor pools for the NCAA tournament.</li>
              <li><strong>Football Office Pools:</strong> Weekly pick'em leagues and survivor pools for the NFL season.</li>
            </ul>
          </div>

          {/* How It Works */}
          <div>
            <h2 className="text-3xl font-bold mb-6">How Super Bowl Squares Work</h2>
            <p className="text-lg text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
              Super Bowl Squares is one of the most popular <strong>football office pools</strong>. It involves a 10x10 grid where one axis represents the home team and the other represents the away team.
            </p>
            <ol className="list-decimal pl-6 space-y-3 text-slate-600 dark:text-slate-400">
              <li><strong>Create a Grid:</strong> Set up your pool in seconds. Customizable buy-ins and payouts.</li>
              <li><strong>Invite Friends:</strong> Share a simple link for people to join and pick their squares.</li>
              <li><strong>Assign Numbers:</strong> Once the grid is full, random numbers (0-9) are generated for each row and column.</li>
              <li><strong>Win Big:</strong> At the end of each quarter, the last digit of each team's score determines the winning square.</li>
            </ol>
            <p className="mt-4 text-slate-600 dark:text-slate-400">
              Our <strong>online sports pools</strong> platform automates this entire process, handling number generation and scoring so you don't have to.
            </p>
          </div>

          {/* Benefits */}
          <div>
            <h2 className="text-3xl font-bold mb-6">Why Choose March Melee Pools?</h2>
            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-xl font-bold mb-2">Automated & Real-Time</h3>
                <p className="text-slate-600 dark:text-slate-400">
                  Forget pen and paper. We sync with live game data to update the board instantly. No more manual calculations.
                </p>
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2">Secure & Transparent</h3>
                <p className="text-slate-600 dark:text-slate-400">
                  Our Audit Log tracks every action. We use verifiable random number generation for fairness.
                </p>
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2">Mobile Friendly Design</h3>
                <p className="text-slate-600 dark:text-slate-400">
                  Manage your pool or check your squares from any device. Optimized for phones and tablets.
                </p>
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2">Flexible Rules</h3>
                <p className="text-slate-600 dark:text-slate-400">
                  Customize payouts for every quarter, half-time, and final score. Supports reverse winners and more.
                </p>
              </div>
            </div>
          </div>

          {/* FAQ */}
          <div>
            <h2 className="text-3xl font-bold mb-6">Frequently Asked Questions</h2>
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-bold mb-2">Is it legal?</h3>
                <p className="text-slate-600 dark:text-slate-400">We provide the platform for hosting pools. It is your responsibility to ensure compliance with local laws regarding real-money pools. Many jurisdictions allow social gambling among friends.</p>
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2">How do payouts work?</h3>
                <p className="text-slate-600 dark:text-slate-400">Platform managers can record payments manually. We calculate exactly who is owed what based on the game results.</p>
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2">Can I run a charity pool?</h3>
                <p className="text-slate-600 dark:text-slate-400">Absolutely. You can set a percentage of the pot to go to a specific cause, and we'll display a donation tracker.</p>
              </div>
            </div>
          </div>

          <div className="flex justify-center pt-8">
            <button
              onClick={onSignup}
              className="bg-slate-900 dark:bg-white text-white dark:text-slate-950 px-8 py-3 rounded-full text-lg font-bold hover:scale-105 transition-transform"
            >
              Sign Up to Join
            </button>
          </div>

        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24 bg-white dark:bg-slate-900/50 border-y border-slate-200 dark:border-slate-800 transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4">Features of Our Sports Pools</h2>
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

      {/* CTA Section */}
      <div className="bg-slate-950 border-t border-slate-800 pt-24 pb-12">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-5xl font-black text-white mb-8">Ready to Start Your Pool?</h2>
          <button
            onClick={onSignup}
            className="bg-white text-indigo-600 px-10 py-5 rounded-full text-xl font-black transition-all transform hover:scale-105 shadow-[0_0_40px_rgba(255,255,255,0.3)] mb-4 hover:shadow-[0_0_60px_rgba(255,255,255,0.5)]"
          >
            Create Your Free Pool Now
          </button>
          <p className="text-indigo-200 text-sm font-bold uppercase tracking-wider mb-12">Limited Time Offer</p>
        </div>
      </div>

      <Footer />
    </div>
  );
};