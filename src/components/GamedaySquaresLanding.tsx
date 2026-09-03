import React from 'react';
import type { User } from '../types';
import { Trophy, Zap, Shield, LayoutGrid, CheckCircle2, Heart, Globe, ArrowRight } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import { Link } from 'react-router';
import { canAccessSquaresCreation } from '../utils/auth';

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

/* Nav / hero / footer stay navy chrome in both themes; the content sections
   between them flip cream <-> navy via CSS-var surfaces (bg-page/surface/card). */

const heroBtn =
    'w-full sm:w-auto inline-flex items-center justify-center gap-2 font-display font-bold uppercase tracking-[0.05em] text-[17px] px-[34px] py-4 rounded-lg transition-ui duration-150 fine:hover:-translate-y-px cursor-pointer';

export const GamedaySquaresLanding: React.FC<GamedaySquaresLandingProps> = ({ user, isManager = false, onLogin, onLogout, onCreatePool, onBrowse }) => {

    return (
        <div className="min-h-screen bg-page text-[color:var(--text)] font-body">

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
                {/* Background Gradients */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full pointer-events-none">
                    <div className="absolute top-20 right-0 w-[500px] h-[500px] rounded-full blur-[120px] bg-brandred-600/15"></div>
                    <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full blur-[120px] bg-navy-600/25"></div>
                </div>

                <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
                    <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-6 md:mb-8 bg-brandred-600/15 border border-brandred-600/35 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <span className="flex h-2 w-2 rounded-full bg-brandred-500 animate-live-pulse"></span>
                        <span className="font-display font-bold uppercase text-xs tracking-[0.16em] text-brandred-500">Live & Automated • Create Your Grid</span>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-12 duration-500 delay-100 mb-8">
                        <button
                            onClick={canAccessSquaresCreation(user) ? onCreatePool : undefined}
                            disabled={!canAccessSquaresCreation(user)}
                            className={`${heroBtn} bg-brandred-600 text-white shadow-red-cta hover:bg-brandred-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0`}
                            title={canAccessSquaresCreation(user) ? "Create a Squares Pool" : "Gameday Squares is coming soon"}
                        >
                            <LayoutGrid size={20} /> {canAccessSquaresCreation(user) ? 'Create a Squares Pool' : 'Squares — Coming Soon'}
                        </button>
                        <button
                            onClick={onBrowse}
                            className={`${heroBtn} border-[1.5px] border-white/30 text-white hover:border-gold-500 hover:text-gold-300 bg-transparent`}
                        >
                            <Globe size={20} /> Join Public Grid
                        </button>
                    </div>

                    <h1 className="font-display font-extrabold uppercase text-4xl md:text-7xl text-white tracking-tight mb-6 md:mb-8 leading-[0.9] animate-in fade-in slide-in-from-bottom-8 duration-500">
                        The Modern Platform for <br />
                        <span className="text-gold-400">Gameday Squares</span>
                    </h1>

                    <p className="font-body text-[#9FB0CC] text-lg md:text-xl max-w-2xl mx-auto mb-8 md:mb-10 leading-relaxed animate-in fade-in slide-in-from-bottom-12 duration-500 delay-50">
                        The professional choice for office pools and charity fundraisers. Fully automated scoring, live ESPN integration, and instant payouts. Say goodbye to spreadsheets.
                    </p>

                    {/* Hero Visual */}
                    <div className="mt-16 md:mt-20 relative mx-auto max-w-5xl animate-in fade-in slide-in-from-bottom-20 duration-500 delay-150">
                        <div className="absolute inset-0 bg-gradient-to-b from-navy-950 via-transparent to-transparent z-20"></div>
                        <div className="rounded-3xl p-2 shadow-panel bg-navy-900 border border-[rgba(230,206,150,0.16)]">
                            <div className="rounded-xl overflow-hidden relative group bg-navy-950">
                                <img
                                    src="/hero-ui.webp"
                                    alt="Interactive 10x10 Super Bowl squares grid with live scoring and player names on March Melee Pools"
                                    loading="lazy"
                                    width={1024}
                                    height={591}
                                    className="w-full h-auto object-cover opacity-90 group-hover:opacity-100 transition-opacity duration-500"
                                />
                                <div className="absolute inset-0 bg-gradient-to-b from-navy-950 via-transparent to-transparent opacity-60"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Feature Showcase Section — flips */}
            <section className="py-24 border-t border-line relative overflow-hidden bg-surface">
                <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-1/4 left-0 w-[500px] h-[500px] rounded-full blur-[120px] opacity-10 bg-brandred-600"></div>
                    <div className="absolute bottom-1/4 right-0 w-[500px] h-[500px] rounded-full blur-[120px] opacity-10 bg-gold-500"></div>
                </div>

                <div className="max-w-7xl mx-auto px-6 relative z-10 space-y-32">

                    {/* Feature 1: Live Grid */}
                    <div className="flex flex-col md:flex-row items-center gap-12 md:gap-20">
                        <div className="md:w-1/2 relative group">
                            <div className="absolute -inset-4 bg-gold-foil rounded-2xl blur opacity-20 group-hover:opacity-40 transition-opacity duration-500"></div>
                            <img
                                src="/feature-live-grid.webp"
                                loading="lazy"
                                width={1024}
                                height={591}
                                alt="Live interactive Super Bowl squares grid showing real-time score updates and winning highlights"
                                className="relative rounded-xl shadow-panel border border-line w-full transform fine:group-hover:scale-[1.02] transition-transform duration-500"
                            />
                        </div>
                        <div className="md:w-1/2 space-y-6">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full font-display font-bold uppercase text-xs tracking-[0.16em] bg-gold-500/15 text-gold-600 dark:text-gold-400">
                                <LayoutGrid size={14} /> The Main Event
                            </div>
                            <h3 className="font-display font-extrabold uppercase text-3xl md:text-4xl text-[color:var(--text)] leading-[0.95]">
                                Live, Interactive Grids for <br /><span className="text-gold-600 dark:text-gold-400">Game Day Action.</span>
                            </h3>
                            <p className="text-lg leading-relaxed font-body text-muted">
                                Experience the classic 10x10 grid reimagined for the digital age. Track occupied squares, see who bought in, and watch winning squares light up in real-time as the score changes. No more squinting at handwriting.
                            </p>
                        </div>
                    </div>

                    {/* Feature 2: Scoreboard & Info */}
                    <div className="flex flex-col md:flex-row-reverse items-center gap-12 md:gap-20">
                        <div className="md:w-1/2 relative group">
                            <div className="absolute -inset-4 bg-navy-600 rounded-2xl blur opacity-30 group-hover:opacity-50 transition-opacity duration-500"></div>
                            <img
                                src="/feature-scoreboard.webp"
                                loading="lazy"
                                width={1024}
                                height={517}
                                alt="March Melee Pools dashboard with all-in-one view of scoreboard, payouts, and charity tracker"
                                className="relative rounded-xl shadow-panel border border-line w-full transform fine:group-hover:scale-[1.02] transition-transform duration-500"
                            />
                        </div>
                        <div className="md:w-1/2 space-y-6">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full font-display font-bold uppercase text-xs tracking-[0.16em] bg-navy-600/15 text-navy-700 dark:text-[#9FB0CC] border border-line">
                                <Zap size={14} /> Mission Control
                            </div>
                            <h3 className="font-display font-extrabold uppercase text-3xl md:text-4xl text-[color:var(--text)] leading-[0.95]">
                                Everything You Need.<br /><span className="text-gold-600 dark:text-gold-400">All in One View.</span>
                            </h3>
                            <p className="text-lg leading-relaxed font-body text-muted">
                                Stay glued to the action with our live scoreboard that syncs instantly with game data. View pool status, specific rules, manager instructions, and transparent payout structures—all alongside charity donation goals and progress.
                            </p>
                        </div>
                    </div>

                    {/* Feature 3: What If Scenarios */}
                    <div className="flex flex-col md:flex-row items-center gap-12 md:gap-20">
                        <div className="md:w-1/2 relative group">
                            <div className="absolute -inset-4 bg-gold-500 rounded-2xl blur opacity-20 group-hover:opacity-40 transition-opacity duration-500"></div>
                            <img
                                src="/feature-scenarios.webp"
                                loading="lazy"
                                width={1024}
                                height={541}
                                alt="Super Bowl squares payout examples including quarter breakdowns and back-loaded jackpot"
                                className="relative rounded-xl shadow-panel border border-line w-full transform fine:group-hover:scale-[1.02] transition-transform duration-500"
                            />
                        </div>
                        <div className="md:w-1/2 space-y-6">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full font-display font-bold uppercase text-xs tracking-[0.16em] bg-gold-500/15 text-gold-600 dark:text-gold-400">
                                <Trophy size={14} /> Instant Calculations
                            </div>
                            <h3 className="font-display font-extrabold uppercase text-3xl md:text-4xl text-[color:var(--text)] leading-[0.95]">
                                Know Who Wins.<br /><span className="text-gold-600 dark:text-gold-400">Before the Whistle Blows.</span>
                            </h3>
                            <p className="text-lg leading-relaxed font-body text-muted">
                                "Who wins if they kick a field goal?" Stop doing math. Our "In the Money" tracker and "If Score Next" scenarios allow you to instantly visualize potential winners for every scoring possibility. It's the ultimate second-screen experience.
                            </p>
                        </div>
                    </div>

                    {/* Feature 4: Setup Wizard */}
                    <div className="flex flex-col md:flex-row-reverse items-center gap-12 md:gap-20">
                        <div className="md:w-1/2 relative group">
                            <div className="absolute -inset-4 bg-brandred-600 rounded-2xl blur opacity-20 group-hover:opacity-40 transition-opacity duration-500"></div>
                            <img
                                src="/feature-setup-wizard.webp"
                                loading="lazy"
                                width={996}
                                height={986}
                                alt="AI commissioner chat for customizing Super Bowl pool rules"
                                className="relative rounded-xl shadow-panel border border-line w-full transform fine:group-hover:scale-[1.02] transition-transform duration-500"
                            />
                        </div>
                        <div className="md:w-1/2 space-y-6">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full font-display font-bold uppercase text-xs tracking-[0.16em] bg-brandred-600/15 text-brandred-500">
                                <CheckCircle2 size={14} /> Be the Commissioner
                            </div>
                            <h3 className="font-display font-extrabold uppercase text-3xl md:text-4xl text-[color:var(--text)] leading-[0.95]">
                                Launch in Minutes.<br /><span className="text-gold-600 dark:text-gold-400">Your Rules, Your Way.</span>
                            </h3>
                            <p className="text-lg leading-relaxed font-body text-muted">
                                Ready to host? Our intuitive Setup Wizard guides you through every step: selecting the game matchup, configuring payout percentages, setting reminder limits, and more. Creating a professional sports pool has never been easier.
                            </p>
                            <button
                                onClick={canAccessSquaresCreation(user) ? onCreatePool : undefined}
                                disabled={!canAccessSquaresCreation(user)}
                                className="mt-4 px-8 py-3 rounded-lg font-display font-bold uppercase tracking-[0.05em] text-white bg-brandred-600 hover:bg-brandred-500 transition-ui duration-150 fine:hover:-translate-y-px shadow-red-cta disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                                title={canAccessSquaresCreation(user) ? "Create Your Pool" : "Gameday Squares is coming soon"}
                            >
                                {canAccessSquaresCreation(user) ? 'Create Your Pool' : 'Coming Soon'}
                            </button>
                        </div>
                    </div>

                </div>
            </section>

            {/* Features Grid — flips */}
            <section id="features" className="py-24 border-y border-line bg-surface">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="text-center mb-16">
                        <h2 className="font-display font-extrabold uppercase text-3xl md:text-4xl leading-[0.95] text-[color:var(--text)] mb-4">Why Choose Our Platform?</h2>
                        <p className="font-body text-muted">Ditch the poster board and spreadsheets. Upgrade to a fully automated system.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
                        {[
                            { icon: Zap, title: "Live ESPN Sync", desc: "Real-time scoring updates. Watch the winners update instantly as the game unfolds." },
                            { icon: Shield, title: "Audit Log & Integrity", desc: "Every action is logged. Numbers are generated securely. 100% tamper-proof." },
                            { icon: Trophy, title: "AI Commissioner", desc: "Resolve disputes and explain winning squares automatically with our built-in AI." },
                            { icon: Heart, title: "Charity Integration", desc: "Easily designate a percentage of the pot to a charity of your choice. Built-in fundraising." }
                        ].map((feature, i) => (
                            <div key={i} className="p-8 rounded-2xl bg-card border border-line transition-colors group flex flex-col h-full hover:border-gold-500/50">
                                <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-6 fine:group-hover:scale-110 transition-transform duration-300 bg-gold-500/15 border border-gold-500/25">
                                    <feature.icon size={28} className="text-gold-600 dark:text-gold-400" />
                                </div>
                                <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-3">{feature.title}</h3>
                                <p className="font-body text-muted leading-relaxed flex-grow">{feature.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA Section — navy chrome banner (always dark) */}
            <div className="border-t border-[rgba(230,206,150,0.16)] pt-24 pb-12 bg-navy-950">
                <div className="max-w-7xl mx-auto px-6 text-center">
                    <div className="flex flex-col items-center">
                        <Link to="/" className="inline-flex items-center gap-2 font-body text-[#9FB0CC] hover:text-white transition-colors mb-8 group">
                            Looking for March Madness Brackets? <span className="underline group-hover:no-underline text-gold-400">Click Here</span> <ArrowRight size={16} />
                        </Link>
                        <div className="mb-8">
                            <h2 className="font-display font-extrabold uppercase text-3xl md:text-5xl leading-[0.95] text-white mb-4">Ready to Start Your Pool?</h2>
                            <p className="font-body text-[#9FB0CC]">Join thousands of commissioners running professional pools.</p>
                        </div>

                        <button
                            onClick={canAccessSquaresCreation(user) ? onCreatePool : undefined}
                            disabled={!canAccessSquaresCreation(user)}
                            className="text-white px-10 py-5 rounded-lg font-display font-extrabold uppercase tracking-[0.05em] text-xl bg-brandred-600 hover:bg-brandred-500 shadow-red-cta transition-ui duration-150 fine:hover:-translate-y-px mb-4 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                            title={canAccessSquaresCreation(user) ? "Create Your Grid Now" : "Gameday Squares is coming soon"}
                        >
                            {canAccessSquaresCreation(user) ? 'Create Your Grid Now' : 'Coming Soon'}
                        </button>
                    </div>
                </div>
            </div>

            <Footer />
        </div>
    );
};
