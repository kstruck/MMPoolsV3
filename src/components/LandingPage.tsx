import type { User } from '../types';
import { Trophy, Zap, Shield, LayoutGrid, Calendar, CheckCircle2, Heart, Globe, DollarSign, Star } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';

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

export const LandingPage: React.FC<LandingPageProps> = ({ user, isManager = false, onLogin, onSignup, onLogout, onCreatePool, onBrowse, totalDonated = 0, totalPrizes = 0 }) => {
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
      < section className="relative overflow-hidden pt-12 md:pt-20 pb-20 md:pb-32" >
        {/* Background Gradients */}
        < div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full pointer-events-none" >
          <div className="absolute top-20 right-0 w-[500px] h-[500px] rounded-full blur-[120px]" style={{ backgroundColor: `${BRAND.orange}15` }}></div>
          <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full blur-[120px]" style={{ backgroundColor: '#3B82F615' }}></div>
        </div >

        <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-6 md:mb-8 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-700" style={{ backgroundColor: `${BRAND.orange}20`, border: `1px solid ${BRAND.orange}40` }}>
            <span className="flex h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: BRAND.orange }}></span>
            <span className="text-xs font-bold tracking-wide uppercase" style={{ color: BRAND.orange }}>Free for a Limited Time • Create Your Pool</span>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-12 duration-700 delay-200 mb-8">
            <button
              onClick={onCreatePool}
              className="w-full sm:w-auto text-white px-8 py-4 rounded-xl text-lg font-bold shadow-xl transition-all flex items-center justify-center gap-2 hover:brightness-110"
              style={{ backgroundColor: BRAND.orange, boxShadow: `0 10px 40px ${BRAND.orange}40` }}
            >
              <Trophy size={20} /> Create a Free Pool Now
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
            Hosting your own Football Squares Pool <br />
            <span style={{ color: BRAND.orange }}>has never been easier</span>
          </h1>

          {/* Stat Cards */}
          <div className="flex flex-wrap justify-center gap-4 mb-8">
            {totalDonated > 0 && (
              <div className="inline-flex items-center gap-4 rounded-2xl p-3 pr-6 shadow-xl animate-in fade-in slide-in-from-bottom-8 duration-700" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
                <div className="p-3 rounded-xl" style={{ backgroundColor: '#EF444420' }}>
                  <Heart className="fill-current" size={24} style={{ color: '#EF4444' }} />
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: BRAND.lightGray }}>Total Raised for Charity</p>
                  <p className="text-2xl font-black text-white">${totalDonated.toLocaleString()}</p>
                </div>
              </div>
            )}

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
            The professional platform for managing squares pools for <strong>any game, all season long</strong>. Automated scoring, real-time payouts, and a pre-loaded schedule of every NFL and College game.
          </p>

          {/* Pool Type Badges */}
          <div className="mt-16 flex flex-wrap justify-center gap-6 md:gap-10 animate-in fade-in slide-in-from-bottom-16 duration-1000 delay-300">
            <div className="flex flex-col items-center gap-2 opacity-90 hover:opacity-100 transition-opacity">
              <img src="/squares_badge_dark.png" alt="Football Squares Pool Badge" className="h-16 md:h-20" />
            </div>
            {/* Future badges hidden for Squares-only focus */}
          </div>

          {/* Hero Visual */}
          <div className="mt-16 md:mt-20 relative mx-auto max-w-5xl animate-in fade-in slide-in-from-bottom-20 duration-1000 delay-400">
            <div className="absolute inset-0 bg-gradient-to-b from-[#0A192F] via-transparent to-transparent z-20"></div>
            <div className="rounded-2xl p-2 shadow-2xl" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
              <div className="rounded-xl overflow-hidden relative group" style={{ backgroundColor: BRAND.navy }}>
                <img
                  src="/hero-ui.png"
                  alt="Interactive 10x10 Super Bowl squares grid with live scoring and player names on March Melee Pools"
                  loading="lazy"
                  className="w-full h-auto object-cover opacity-90 group-hover:opacity-100 transition-opacity duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-[#0A192F] via-transparent to-transparent opacity-60"></div>
              </div>
            </div>
          </div>
        </div>
      </section >

      {/* Feature Showcase Section */}
      < section className="py-24 border-t relative overflow-hidden" style={{ backgroundColor: BRAND.navy, borderColor: '#334155' }}>
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-0 w-[500px] h-[500px] rounded-full blur-[120px] opacity-20" style={{ backgroundColor: '#FF6600' }}></div>
          <div className="absolute bottom-1/4 right-0 w-[500px] h-[500px] rounded-full blur-[120px] opacity-20" style={{ backgroundColor: '#3B82F6' }}></div>
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10 space-y-32">

          {/* Feature 1: Live Grid */}
          <div className="flex flex-col md:flex-row items-center gap-12 md:gap-20">
            <div className="md:w-1/2 relative group">
              <div className="absolute -inset-4 bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl blur opacity-20 group-hover:opacity-40 transition-opacity duration-500"></div>
              <img
                src="/feature-live-grid.png"
                alt="Live interactive Super Bowl squares grid showing real-time score updates and winning highlights"
                className="relative rounded-xl shadow-2xl border border-slate-700 w-full transform group-hover:scale-[1.02] transition-transform duration-500"
              />
            </div>
            <div className="md:w-1/2 space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider" style={{ backgroundColor: `${BRAND.orange}20`, color: BRAND.orange }}>
                <LayoutGrid size={14} /> The Main Event
              </div>
              <h3 className="text-3xl md:text-4xl font-black text-white leading-tight" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                Live, Interactive Grids. <br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-amber-400">Not Your Office Excel Sheet.</span>
              </h3>
              <p className="text-lg leading-relaxed text-slate-300">
                Experience the classic 10x10 grid reimagined for the digital age. Track occupied squares, see who bought in, and watch winning squares light up in real-time as the score changes. No more squinting at handwriting.
              </p>
            </div>
          </div>

          {/* Feature 2: Scoreboard & Info */}
          <div className="flex flex-col md:flex-row-reverse items-center gap-12 md:gap-20">
            <div className="md:w-1/2 relative group">
              <div className="absolute -inset-4 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-2xl blur opacity-20 group-hover:opacity-40 transition-opacity duration-500"></div>
              <img
                src="/feature-scoreboard.png"
                alt="March Melee Pools dashboard with all-in-one view of scoreboard, payouts, and charity tracker"
                className="relative rounded-xl shadow-2xl border border-slate-700 w-full transform group-hover:scale-[1.02] transition-transform duration-500"
              />
            </div>
            <div className="md:w-1/2 space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-blue-500/20 text-blue-400">
                <Zap size={14} /> Mission Control
              </div>
              <h3 className="text-3xl md:text-4xl font-black text-white leading-tight" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                Everything You Need.<br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">All in One View.</span>
              </h3>
              <p className="text-lg leading-relaxed text-slate-300">
                Stay glued to the action with our live scoreboard that syncs instantly with game data. View pool status, specific rules, manager instructions, and transparent payout structures—all alongside charity donation goals and progress.
              </p>
            </div>
          </div>

          {/* Feature 3: What If Scenarios */}
          <div className="flex flex-col md:flex-row items-center gap-12 md:gap-20">
            <div className="md:w-1/2 relative group">
              <div className="absolute -inset-4 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-2xl blur opacity-20 group-hover:opacity-40 transition-opacity duration-500"></div>
              <img
                src="/feature-scenarios.png"
                alt="Super Bowl squares payout examples including quarter breakdowns and back-loaded jackpot"
                className="relative rounded-xl shadow-2xl border border-slate-700 w-full transform group-hover:scale-[1.02] transition-transform duration-500"
              />
            </div>
            <div className="md:w-1/2 space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400">
                <Trophy size={14} /> Instant Calculations
              </div>
              <h3 className="text-3xl md:text-4xl font-black text-white leading-tight" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                Know Who Wins.<br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400">Before the Whistle Blows.</span>
              </h3>
              <p className="text-lg leading-relaxed text-slate-300">
                "Who wins if they kick a field goal?" Stop doing math. Our "In the Money" tracker and "If Score Next" scenarios allow you to instantly visualize potential winners for every scoring possibility. It's the ultimate second-screen experience.
              </p>
            </div>
          </div>

          {/* Feature 4: Public Grid Finder */}
          <div className="flex flex-col md:flex-row-reverse items-center gap-12 md:gap-20">
            <div className="md:w-1/2 relative group">
              <div className="absolute -inset-4 bg-gradient-to-r from-violet-500 to-purple-500 rounded-2xl blur opacity-20 group-hover:opacity-40 transition-opacity duration-500"></div>
              <img
                src="/feature-public-finder.png"
                alt="Public Pool Finder to join Super Bowl Squares online"
                className="relative rounded-xl shadow-2xl border border-slate-700 w-full transform group-hover:scale-[1.02] transition-transform duration-500"
              />
            </div>
            <div className="md:w-1/2 space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-violet-500/20 text-violet-400">
                <Globe size={14} /> Join the Community
              </div>
              <h3 className="text-3xl md:text-4xl font-black text-white leading-tight" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                Find Your Perfect Game.<br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-purple-400">Or Keep It Private.</span>
              </h3>
              <p className="text-lg leading-relaxed text-slate-300">
                Browse our Public Grid Finder to discover open pools by sport, entry cost, or charity support. Prefer a private game among friends? Lock your pool with a password and invite only those you choose.
              </p>
            </div>
          </div>

          {/* Feature 5: Setup Wizard */}
          <div className="flex flex-col md:flex-row items-center gap-12 md:gap-20">
            <div className="md:w-1/2 relative group">
              <div className="absolute -inset-4 bg-gradient-to-r from-pink-500 to-rose-500 rounded-2xl blur opacity-20 group-hover:opacity-40 transition-opacity duration-500"></div>
              <img
                src="/feature-setup-wizard.png"
                alt="AI commissioner chat for customizing Super Bowl pool rules"
                className="relative rounded-xl shadow-2xl border border-slate-700 w-full transform group-hover:scale-[1.02] transition-transform duration-500"
              />
            </div>
            <div className="md:w-1/2 space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-pink-500/20 text-pink-400">
                <CheckCircle2 size={14} /> Be the Commissioner
              </div>
              <h3 className="text-3xl md:text-4xl font-black text-white leading-tight" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                Launch in Minutes.<br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-rose-400">Your Rules, Your Way.</span>
              </h3>
              <p className="text-lg leading-relaxed text-slate-300">
                Ready to host? Our intuitive Setup Wizard guides you through every step: selecting the game matchup, configuring payout percentages, setting reminder limits, and more. Creating a professional sports pool has never been easier.
              </p>
              <button
                onClick={onSignup}
                className="mt-4 px-8 py-3 rounded-full font-bold text-white transition-transform hover:scale-105 shadow-lg shadow-pink-500/25"
                style={{ backgroundColor: '#DB2777' }} // Pink-600
              >
                Create Your Pool
              </button>
            </div>
          </div>

        </div>
      </section >
      <section className="py-20 border-t" style={{ backgroundColor: BRAND.navy, borderColor: '#334155' }}>
        <div className="max-w-4xl mx-auto px-6 space-y-16">

          {/* Charity / Fundraising Section */}
          <div className="mb-20">
            <div className="p-8 md:p-12 rounded-2xl border relative overflow-hidden" style={{ backgroundColor: `${BRAND.navy}`, borderColor: '#334155' }}>
              <div className="absolute top-0 right-0 p-8 opacity-10">
                <Heart size={200} fill="white" />
              </div>

              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-3 rounded-full bg-pink-600/20 text-pink-500">
                    <Heart size={32} fill="currentColor" />
                  </div>
                  <h2 className="text-3xl font-bold text-white" style={{ fontFamily: "'Montserrat', sans-serif" }}>Raise Money for Your Cause</h2>
                </div>

                <p className="text-lg md:text-xl max-w-2xl mb-8 leading-relaxed" style={{ color: BRAND.lightGray }}>
                  Turn any big game into a fundraising event. Our platform makes it simple to run a <strong>Charity Squares Pool</strong> to support your favorite cause, youth sports team, or community group.
                </p>

                <div className="grid md:grid-cols-3 gap-6 mb-8">
                  <div className="bg-slate-900/50 p-5 rounded-lg border border-slate-700/50">
                    <h4 className="font-bold text-white mb-2">1. Set Donation %</h4>
                    <p className="text-sm text-slate-400">Designate 10%, 50%, or even 100% of the pot to go directly to your charity.</p>
                  </div>
                  <div className="bg-slate-900/50 p-5 rounded-lg border border-slate-700/50">
                    <h4 className="font-bold text-white mb-2">2. Engage Supporters</h4>
                    <p className="text-sm text-slate-400">Perfect for Church Groups, PTAs, and Youth Leagues. Gamify your fundraising.</p>
                  </div>
                  <div className="bg-slate-900/50 p-5 rounded-lg border border-slate-700/50">
                    <h4 className="font-bold text-white mb-2">3. Automatic Tracking</h4>
                    <p className="text-sm text-slate-400">We clearly display the "Donation Amount" vs "Prize Pot" so everyone knows their impact.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Popular Pools */}
          <div>
            <h2 className="text-3xl font-bold mb-6 text-white" style={{ fontFamily: "'Montserrat', sans-serif" }}>Perfect for Every Week</h2>
            <p className="text-lg leading-relaxed mb-4" style={{ color: BRAND.lightGray }}>
              Whether you are looking for the best <strong className="text-white">Super Bowl squares app</strong> or a reliable way to run your weekly <strong className="text-white">Monday Night Football pools</strong>, March Melee Pools has you covered.
            </p>
            <ul className="list-disc pl-6 space-y-2" style={{ color: BRAND.lightGray }}>
              <li><strong className="text-white">Any Game, Any Time:</strong> Our database includes the full NFL and College Football schedule. Just pick your game.</li>
              <li><strong className="text-white">Super Bowl Squares:</strong> The classic 10x10 grid. Perfect for the big game.</li>
              <li><strong className="text-white">Weekly Office Pools:</strong> Spice up the regular season with a new grid for every prime-time matchup.</li>
            </ul>
          </div>

          {/* How It Works */}
          <div>
            <h2 className="text-3xl font-bold mb-6 text-white" style={{ fontFamily: "'Montserrat', sans-serif" }}>How Game Day Squares Work</h2>
            <p className="text-lg leading-relaxed mb-4" style={{ color: BRAND.lightGray }}>
              Squares pools (specifically the 10x10 grid) are the easiest way to engage your friends and colleagues during any football game.
            </p>
            <ol className="list-decimal pl-6 space-y-3" style={{ color: BRAND.lightGray }}>
              <li><strong className="text-white">Select Your Game:</strong> Browse our <strong className="text-white">pre-loaded schedule</strong> of NFL and College games. No manual data entry needed.</li>
              <li><strong className="text-white">Create a Grid:</strong> Set up your pool in seconds. Customizable buy-ins and payouts.</li>
              <li><strong className="text-white">Invite Friends:</strong> Share a simple link for people to join and pick their squares.</li>
              <li><strong className="text-white">Assign Numbers:</strong> Once the grid is full, random numbers (0-9) are generated for each row and column.</li>
              <li><strong className="text-white">Win Big:</strong> At the end of each quarter, the last digit of each team's score determines the winning square.</li>
            </ol>
            <p className="mt-4" style={{ color: BRAND.lightGray }}>
              Our <strong className="text-white">online squares pool</strong> platform automates everything—from number generation to final payouts—so you can enjoy the game.
            </p>
          </div>

          {/* Payout Scenarios */}
          <div>
            <h2 className="text-3xl font-bold mb-6 text-white" style={{ fontFamily: "'Montserrat', sans-serif" }}>Winning Scenarios & Payout Examples</h2>
            <p className="text-lg leading-relaxed mb-6" style={{ color: BRAND.lightGray }}>
              You control the pot. Choose standard flexible payout structures or create your own custom rules. Here are some popular ways to split the winnings:
            </p>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="p-6 rounded-xl border border-slate-700 bg-slate-800/50">
                <div className="flex items-center gap-3 mb-4">
                  <DollarSign className="text-emerald-400" />
                  <h3 className="font-bold text-white">Standard Quarter Breakdown</h3>
                </div>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li className="flex justify-between border-b border-slate-700/50 pb-2"><span>1st Quarter</span> <span className="font-bold text-white">25%</span></li>
                  <li className="flex justify-between border-b border-slate-700/50 pb-2"><span>Halftime</span> <span className="font-bold text-white">25%</span></li>
                  <li className="flex justify-between border-b border-slate-700/50 pb-2"><span>3rd Quarter</span> <span className="font-bold text-white">25%</span></li>
                  <li className="flex justify-between"><span>Final Score</span> <span className="font-bold text-white">25%</span></li>
                </ul>
              </div>

              <div className="p-6 rounded-xl border border-slate-700 bg-slate-800/50">
                <div className="flex items-center gap-3 mb-4">
                  <Trophy className="text-amber-400" />
                  <h3 className="font-bold text-white">Back-Loaded Jackpot</h3>
                </div>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li className="flex justify-between border-b border-slate-700/50 pb-2"><span>1st Quarter</span> <span className="font-bold text-white">10%</span></li>
                  <li className="flex justify-between border-b border-slate-700/50 pb-2"><span>Halftime</span> <span className="font-bold text-white">10%</span></li>
                  <li className="flex justify-between border-b border-slate-700/50 pb-2"><span>3rd Quarter</span> <span className="font-bold text-white">10%</span></li>
                  <li className="flex justify-between"><span>Final Score</span> <span className="font-bold text-white">70%</span></li>
                </ul>
              </div>
            </div>
            <p className="mt-4 text-sm" style={{ color: BRAND.lightGray }}>
              * We also support <strong>Reverse Winners</strong> (payouts for the reversed score) and custom charity allocations.
            </p>
          </div>

          {/* Benefits */}
          <div>
            <h2 className="text-3xl font-bold mb-6 text-white" style={{ fontFamily: "'Montserrat', sans-serif" }}>Why Choose March Melee Pools?</h2>
            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-xl font-bold mb-2 text-white">Automated & Real-Time</h3>
                <p style={{ color: BRAND.lightGray }}>
                  Forget pen and paper. We sync with live game data to update the board instantly. No more manual calculations.
                </p>
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2 text-white">Secure & Transparent</h3>
                <p style={{ color: BRAND.lightGray }}>
                  Our Audit Log tracks every action. We use verifiable random number generation for fairness.
                </p>
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2 text-white">Mobile Friendly Design</h3>
                <p style={{ color: BRAND.lightGray }}>
                  Manage your pool or check your squares from any device. Optimized for phones and tablets.
                </p>
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2 text-white">Flexible Rules</h3>
                <p style={{ color: BRAND.lightGray }}>
                  Customize payouts for every quarter, half-time, and final score. Supports reverse winners and more.
                </p>
              </div>
            </div>
          </div>




          {/* Testimonials */}
          <div className="mb-20">
            <h2 className="text-3xl font-bold mb-8 text-white" style={{ fontFamily: "'Montserrat', sans-serif" }}>Trusted by Commissioners</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                { quote: "Finally, a squares app that handles the numbers and scoring for me. I used to do this on a poster board!", author: "Mike R.", role: "Alpha Tester" },
                { quote: "I love that I can pick any game from the schedule. We did a pool for the Thanksgiving games and it was flawless.", author: "Sarah T.", role: "Early User" },
                { quote: "The pre-loaded schedule makes setup instant. No more typing in team names or figuring out game times.", author: "David K.", role: "Pool Manager" }
              ].map((t, i) => (
                <div key={i} className="p-6 rounded-xl border border-slate-800 bg-slate-900/50 relative">
                  <div className="flex gap-1 mb-4">
                    {[1, 2, 3, 4, 5].map(s => <Star key={s} size={14} className="fill-amber-400 text-amber-400" />)}
                  </div>
                  <p className="mb-4 italic text-slate-300">"{t.quote}"</p>
                  <div>
                    <p className="font-bold text-white text-sm">{t.author}</p>
                    <p className="text-xs text-slate-500">{t.role}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* FAQ */}
          <div>
            <h2 className="text-3xl font-bold mb-6 text-white" style={{ fontFamily: "'Montserrat', sans-serif" }}>Frequently Asked Questions</h2>
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-bold mb-2 text-white">Is it legal?</h3>
                <p style={{ color: BRAND.lightGray }}>We provide the platform for hosting pools. It is your responsibility to ensure compliance with local laws regarding real-money pools. Many jurisdictions allow social gambling among friends.</p>
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2 text-white">How do payouts work?</h3>
                <p style={{ color: BRAND.lightGray }}>Platform managers can record payments manually. We calculate exactly who is owed what based on the game results.</p>
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2 text-white">Can I run a charity pool?</h3>
                <p style={{ color: BRAND.lightGray }}>Absolutely. You can set a percentage of the pot to go to a specific cause, and we'll display a donation tracker.</p>
              </div>
            </div>
          </div>

          <div className="flex justify-center pt-8">
            <button
              onClick={onSignup}
              className="text-white px-8 py-3 rounded-full text-lg font-bold hover:scale-105 transition-transform"
              style={{ backgroundColor: BRAND.orange }}
            >
              Sign Up to Join
            </button>
          </div>

        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-24 border-y" style={{ backgroundColor: '#0F2540', borderColor: '#334155' }}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4" style={{ fontFamily: "'Montserrat', sans-serif" }}>Features of Our Squares Platform</h2>
            <p style={{ color: BRAND.lightGray }}>Ditch the poster board and spreadsheets. Upgrade to a fully automated system.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
            {[
              { icon: Zap, title: "Live ESPN Sync", desc: "Real-time scoring updates. Watch the winners update instantly as the game unfolds." },
              { icon: Shield, title: "Audit Log & Integrity", desc: "Every action is logged. Numbers are generated securely. 100% tamper-proof." },
              { icon: Trophy, title: "AI Commissioner", desc: "Resolve disputes and explain winning squares automatically with our built-in AI." },
              { icon: Heart, title: "Charity Integration", desc: "Easily designate a percentage of the pot to a charity of your choice. Built-in fundraising." }
            ].map((feature, i) => (
              <div key={i} className="p-8 rounded-2xl border transition-colors group flex flex-col h-full hover:border-orange-500/50" style={{ backgroundColor: BRAND.navy, borderColor: '#334155' }}>
                <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300" style={{ backgroundColor: `${BRAND.orange}20`, border: `1px solid ${BRAND.orange}30` }}>
                  <feature.icon size={28} style={{ color: BRAND.orange }} />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">{feature.title}</h3>
                <p className="leading-relaxed flex-grow" style={{ color: BRAND.lightGray }}>{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Roadmap Section */}
      <section className="py-24 relative overflow-hidden" style={{ backgroundColor: BRAND.navy }}>
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 font-bold uppercase tracking-widest text-sm mb-4" style={{ color: BRAND.orange }}>
              <Calendar size={16} /> Coming Soon
            </div>
            <h2 className="text-4xl md:text-5xl font-black text-white mb-6" style={{ fontFamily: "'Montserrat', sans-serif" }}>More Sports.<br />More Action.</h2>
            <p className="text-lg mb-8 leading-relaxed" style={{ color: BRAND.lightGray }}>
              MarchMeleePools is evolving. We are building the ultimate destination for year-round sports pools.
            </p>

            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${BRAND.orange}20`, border: `1px solid ${BRAND.orange}30` }}>
                  <img src="/bracket_badge_dark.png" alt="Bracket" className="h-8" />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-white mb-1">March Madness Brackets</h4>
                  <p className="text-sm" style={{ color: BRAND.lightGray }}>Create and manage tournament brackets with live scoring and leaderboard tracking.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${BRAND.orange}20`, border: `1px solid ${BRAND.orange}30` }}>
                  <img src="/pickem_badge_dark.png" alt="Pick'em" className="h-8" />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-white mb-1">NFL Pick'em Leagues</h4>
                  <p className="text-sm" style={{ color: BRAND.lightGray }}>Weekly pick'em pools for the entire NFL season. Survivor pools, spread picks, and more.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 blur-[100px] opacity-20" style={{ background: `linear-gradient(to right, ${BRAND.orange}, #3B82F6)` }}></div>
            <div className="rounded-2xl p-8 relative" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
              <h3 className="text-2xl font-bold text-white mb-6">Phase 2 Roadmap</h3>
              <div className="space-y-4">
                {[
                  { label: 'NFL Squares', status: 'Live Now', active: true, badge: '/squares_badge_dark.png' },
                  { label: 'College Football Squares', status: 'Live Now', active: true, badge: '/squares_badge_dark.png' },
                  { label: 'March Madness Brackets', status: 'February 2026', active: false, badge: '/bracket_badge_dark.png' },
                  { label: "NFL Pick'em", status: 'August 2026', active: false, badge: '/pickem_badge_dark.png' },
                  { label: 'Survivor Pools', status: 'August 2026', active: false, badge: '/survivor_badge_dark.png' },
                ].map((item, i) => (
                  <div key={i} className={`flex items-center justify-between p-4 rounded-xl border ${item.active ? 'border-emerald-500/30' : 'opacity-60'}`} style={{ backgroundColor: item.active ? `${BRAND.emerald}15` : BRAND.navy, borderColor: item.active ? undefined : '#334155' }}>
                    <span className="font-bold text-white flex items-center gap-3">
                      {item.active ? <CheckCircle2 size={18} style={{ color: BRAND.emerald }} /> : <div className="w-4 h-4 rounded-full border-2" style={{ borderColor: '#475569' }}></div>}
                      <img src={item.badge} alt="" className="h-6" />
                      {item.label}
                    </span>
                    <span className={`text-xs font-bold uppercase`} style={{ color: item.active ? BRAND.emerald : '#64748B' }}>{item.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <div className="border-t pt-24 pb-12" style={{ backgroundColor: BRAND.navy, borderColor: '#334155' }}>
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-5xl font-black text-white mb-8" style={{ fontFamily: "'Montserrat', sans-serif" }}>Ready to Start Your Pool?</h2>
          <button
            onClick={onSignup}
            className="text-white px-10 py-5 rounded-full text-xl font-black transition-all transform hover:scale-105 mb-4 hover:brightness-110"
            style={{ backgroundColor: BRAND.orange, boxShadow: `0 0 40px ${BRAND.orange}50` }}
          >
            Create Your Free Pool Now
          </button>
          <p className="text-sm font-bold uppercase tracking-wider mb-12" style={{ color: BRAND.orange }}>Limited Time Offer</p>
        </div>
      </div>

      <Footer />
    </div >
  );
};