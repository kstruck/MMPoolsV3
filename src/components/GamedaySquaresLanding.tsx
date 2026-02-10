import React from 'react';
import type { User } from '../types';
import { Trophy, Zap, Shield, LayoutGrid, CheckCircle2, Heart, Globe, ArrowRight } from 'lucide-react';
import { Header } from './Header';

interface GamedaySquaresLandingProps {
    user?: User | null;
    isManager?: boolean;
    onLogin: () => void;
    onSignup: () => void;
    onLogout?: () => void;
    onCreatePool?: () => void;
    onBrowse: () => void;
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

export const GamedaySquaresLanding: React.FC<GamedaySquaresLandingProps> = ({ user, isManager = false, onLogin, onSignup, onLogout, onCreatePool, onBrowse, isLoggedIn }) => {

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
                        <span className="text-xs font-bold tracking-wide uppercase" style={{ color: BRAND.orange }}>Live & Automated • Create Your Grid</span>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-12 duration-700 delay-200 mb-8">
                        <button
                            onClick={onCreatePool}
                            className="w-full sm:w-auto text-white px-8 py-4 rounded-xl text-lg font-bold shadow-xl transition-all flex items-center justify-center gap-2 hover:brightness-110"
                            style={{ backgroundColor: BRAND.orange, boxShadow: `0 10px 40px ${BRAND.orange}40` }}
                        >
                            <LayoutGrid size={20} /> Create a Squares Pool
                        </button>
                        <button
                            onClick={onBrowse}
                            className="w-full sm:w-auto text-white px-8 py-4 rounded-xl text-lg font-bold border shadow-sm transition-all flex items-center justify-center gap-2 hover:bg-white/5"
                            style={{ borderColor: '#334155', backgroundColor: '#1E293B' }}
                        >
                            <Globe size={20} /> Join Public Grid
                        </button>
                    </div>

                    <h1 className="text-4xl md:text-7xl font-black text-white tracking-tight mb-6 md:mb-8 leading-tight animate-in fade-in slide-in-from-bottom-8 duration-700" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                        The Modern Platform for <br />
                        <span style={{ color: BRAND.orange }}>Gameday Squares</span>
                    </h1>

                    <p className="text-lg md:text-xl max-w-2xl mx-auto mb-8 md:mb-10 leading-relaxed animate-in fade-in slide-in-from-bottom-12 duration-700 delay-100" style={{ color: BRAND.lightGray }}>
                        The professional choice for office pools and charity fundraisers. Fully automated scoring, live ESPN integration, and instant payouts. Say goodbye to spreadsheets.
                    </p>

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
            </section>

            {/* Feature Showcase Section */}
            <section className="py-24 border-t relative overflow-hidden" style={{ backgroundColor: BRAND.navy, borderColor: '#334155' }}>
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
                                Live, Interactive Grids for <br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-amber-400">Game Day Action.</span>
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

                    {/* Feature 4: Setup Wizard */}
                    <div className="flex flex-col md:flex-row-reverse items-center gap-12 md:gap-20">
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
                                onClick={isLoggedIn ? onCreatePool : onSignup}
                                className="mt-4 px-8 py-3 rounded-full font-bold text-white transition-transform hover:scale-105 shadow-lg shadow-pink-500/25"
                                style={{ backgroundColor: '#DB2777' }} // Pink-600
                            >
                                Create Your Pool
                            </button>
                        </div>
                    </div>

                </div>
            </section>

            {/* Features Grid */}
            <section id="features" className="py-24 border-y" style={{ backgroundColor: '#0F2540', borderColor: '#334155' }}>
                <div className="max-w-7xl mx-auto px-6">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4" style={{ fontFamily: "'Montserrat', sans-serif" }}>Why Choose Our Platform?</h2>
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

            {/* CTA Section */}
            <div className="pt-24 pb-12" style={{ backgroundColor: BRAND.navy, borderColor: '#334155' }}>
                <div className="max-w-7xl mx-auto px-6 text-center">
                    <div className="flex flex-col items-center">
                        <Link to="/" className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors mb-8 group">
                            Looking for March Madness Brackets? <span className="underline group-hover:no-underline text-orange-500">Click Here</span> <ArrowRight size={16} />
                        </Link>
                        <div className="mb-8">
                            <h2 className="text-3xl md:text-5xl font-black text-white mb-4" style={{ fontFamily: "'Montserrat', sans-serif" }}>Ready to Start Your Pool?</h2>
                            <p className="text-slate-400">Join thousands of commissioners running professional pools.</p>
                        </div>

                        <button
                            onClick={isLoggedIn ? onCreatePool : onSignup}
                            className="text-white px-10 py-5 rounded-full text-xl font-black transition-all transform hover:scale-105 mb-4 hover:brightness-110"
                            style={{ backgroundColor: BRAND.orange, boxShadow: `0 0 40px ${BRAND.orange}50` }}
                        >
                            Create Your Grid Now
                        </button>
                    </div>
                </div>
            </div>

            <Footer />
        </div>
    );
};
