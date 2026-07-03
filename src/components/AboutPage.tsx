import React from 'react';
import type { User } from '../types';
import { Header } from './Header';
import { Footer } from './Footer';
import { Shield, Sparkles, Heart, Trophy, Zap, PlayCircle, Star, ArrowRight } from 'lucide-react';

interface AboutPageProps {
    user?: User | null;
    isManager?: boolean;
    onLogin: () => void;
    onSignup: () => void;
    onLogout?: () => void;
    onCreatePool?: () => void;
    isLoggedIn: boolean;
}

/* Marketing page is navy chrome end-to-end — always dark in both themes. */

export const AboutPage: React.FC<AboutPageProps> = ({ user, isManager = false, onLogin, onLogout, onCreatePool }) => {
    return (
        <div className="min-h-screen text-white font-body bg-navy-950 flex flex-col">
            <Header
                user={user || null}
                isManager={isManager}
                onOpenAuth={onLogin}
                onLogout={onLogout || (() => { })}
                onCreatePool={onCreatePool}
            />

            {/* Hero Header */}
            <section className="relative overflow-hidden pt-20 pb-16 border-b border-[rgba(230,206,150,0.16)] bg-navy-900/60">
                <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-navy-600/10 to-transparent pointer-events-none" />

                <div className="max-w-4xl mx-auto px-6 relative z-10 text-center space-y-6">
                    <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-gold-500/10 border border-gold-500/25">
                        <Trophy size={14} className="text-gold-400" />
                        <span className="font-display font-bold uppercase text-xs tracking-[0.16em] text-gold-400">Our Story</span>
                    </div>

                    <h1 className="font-display font-extrabold uppercase text-4xl md:text-6xl text-white tracking-tight leading-[0.9]">
                        Revolutionizing <br />
                        <span className="text-gold-400">Social Sports Pools</span>
                    </h1>

                    <p className="text-base md:text-lg max-w-2xl mx-auto font-body text-[#9FB0CC] leading-relaxed">
                        March Melee Pools was founded in 2026 to solve a simple problem: spreadsheet anxiety. We took manual math, missing payments, and stale score updates and replaced them with standard-setting automation.
                    </p>
                </div>
            </section>

            {/* Bento Grid Features */}
            <section className="py-16 max-w-7xl mx-auto px-6 w-full flex-grow space-y-16">

                {/* Section Title */}
                <div className="text-center space-y-2">
                    <h2 className="font-display font-extrabold uppercase text-2xl md:text-3xl leading-[0.95] text-white">The Platform Engine</h2>
                    <p className="text-sm font-body text-[#9FB0CC] max-w-lg mx-auto">We build automated solutions designed to let commissioners sit back and enjoy the games.</p>
                </div>

                {/* Bento Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                    {/* Bento Cell 1: Our Mission */}
                    <div className="lg:col-span-2 p-8 rounded-3xl bg-navy-900 border border-[rgba(230,206,150,0.16)] hover:border-gold-500/40 transition-colors flex flex-col justify-between space-y-6">
                        <div className="space-y-4">
                            <div className="p-3 bg-gold-500/15 text-gold-400 rounded-2xl w-fit border border-gold-500/25">
                                <Sparkles size={24} />
                            </div>
                            <h3 className="font-display font-bold uppercase text-2xl text-white">The Core Mission</h3>
                            <p className="font-body text-[#9FB0CC] text-sm leading-relaxed">
                                We believe sports pools should bring friends, family, and coworkers closer together—not burden commissioners with tech support and constant administrative reminders. By designing real-time integrations and beautiful glassmorphism dashboards, we have crafted a sports platform that feels premium and premium-grade.
                            </p>
                        </div>
                        <div className="pt-6 border-t border-[rgba(230,206,150,0.16)] flex items-center justify-between font-display font-bold uppercase text-xs tracking-[0.08em] text-gold-400 group cursor-pointer" onClick={() => window.location.href = '/how-it-works'}>
                            <span>Learn how our platform works</span>
                            <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                        </div>
                    </div>

                    {/* Bento Cell 2: Automated Scoring */}
                    <div className="p-8 rounded-3xl bg-navy-900 border border-[rgba(230,206,150,0.16)] hover:border-gold-500/40 transition-colors space-y-4 flex flex-col justify-between">
                        <div className="space-y-4">
                            <div className="p-3 bg-navy-700/50 text-[#9FB0CC] rounded-2xl w-fit border border-[rgba(230,206,150,0.16)]">
                                <Zap size={24} />
                            </div>
                            <h3 className="font-display font-bold uppercase text-xl text-white">Firestore Real-Time Scoring</h3>
                            <p className="font-body text-[#9FB0CC] text-xs leading-relaxed">
                                Standings shouldn't wait for the morning paper. Our custom Firestore engine pulls official sports feeds and computes point matrices in under one second, updating player ranks instantly.
                            </p>
                        </div>
                        <div className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-[#7C8BA6]">Live Integrations</div>
                    </div>

                    {/* Bento Cell 3: What-If Simulator */}
                    <div className="p-8 rounded-3xl bg-navy-900 border border-[rgba(230,206,150,0.16)] hover:border-gold-500/40 transition-colors space-y-4 flex flex-col justify-between">
                        <div className="space-y-4">
                            <div className="p-3 bg-gold-500/15 text-gold-400 rounded-2xl w-fit border border-gold-500/25">
                                <PlayCircle size={24} />
                            </div>
                            <h3 className="font-display font-bold uppercase text-xl text-white">What-If Standing Simulators</h3>
                            <p className="font-body text-[#9FB0CC] text-xs leading-relaxed">
                                Let players preview standing outcomes recursively. Our simulator maps every potential game outcome, displaying which remaining games matter most to their ranking.
                            </p>
                        </div>
                        <div className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-[#7C8BA6]">Recursive Analytics</div>
                    </div>

                    {/* Bento Cell 4: AI Commissioner */}
                    <div className="p-8 rounded-3xl bg-navy-900 border border-[rgba(230,206,150,0.16)] hover:border-gold-500/40 transition-colors space-y-4 flex flex-col justify-between">
                        <div className="space-y-4">
                            <div className="p-3 bg-navy-700/50 text-[#9FB0CC] rounded-2xl w-fit border border-[rgba(230,206,150,0.16)]">
                                <Star size={24} />
                            </div>
                            <h3 className="font-display font-bold uppercase text-xl text-white">Custom AI Commissioner</h3>
                            <p className="font-body text-[#9FB0CC] text-xs leading-relaxed">
                                Enable the custom AI to trigger weekly league updates, mock trades, flag upset margins, and draft lighthearted trash-talk newsletters to boost participant engagement.
                            </p>
                        </div>
                        <div className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-[#7C8BA6]">LLM Integrations</div>
                    </div>

                    {/* Bento Cell 5: Audited Security */}
                    <div className="p-8 rounded-3xl bg-navy-900 border border-[rgba(230,206,150,0.16)] hover:border-gold-500/40 transition-colors space-y-4 flex flex-col justify-between">
                        <div className="space-y-4">
                            <div className="p-3 bg-gold-500/15 text-gold-400 rounded-2xl w-fit border border-gold-500/25">
                                <Shield size={24} />
                            </div>
                            <h3 className="font-display font-bold uppercase text-xl text-white">Tamper-Proof Audit Logs</h3>
                            <p className="font-body text-[#9FB0CC] text-xs leading-relaxed">
                                Total transparency. Every bracket modification, payment registration, and randomly assigned number grid is permanently written to immutable database logs.
                            </p>
                        </div>
                        <div className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-[#7C8BA6]">Secure Database</div>
                    </div>
                </div>

                {/* Section 3: Social & Charity Impact */}
                <div className="p-8 md:p-12 rounded-3xl bg-navy-900 border border-gold-500/25 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                    <div className="lg:col-span-8 space-y-4">
                        <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-brandred-600/15 border border-brandred-600/35 text-brandred-500">
                            <Heart size={14} className="animate-live-pulse" />
                            <span className="font-display font-bold uppercase text-xs tracking-[0.16em]">Social Impact</span>
                        </div>
                        <h3 className="font-display font-extrabold uppercase text-3xl text-white leading-[0.95]">
                            The $1,000,000 Donation Goal
                        </h3>
                        <p className="font-body text-[#9FB0CC] text-sm leading-relaxed max-w-2xl">
                            We are committed to helping organizations and friends dedicate a portion of their pools to genuine charity campaigns. Our platform has dedicated built-in charity tools that handle donations cleanly, with the ultimate mission of raising $1,000,000 for vetted 501(c)(3) charities.
                        </p>
                    </div>
                    <div className="lg:col-span-4 bg-navy-950 border border-[rgba(230,206,150,0.16)] p-6 rounded-2xl space-y-2 text-center">
                        <div className="font-display font-extrabold text-3xl text-gold-400 num">$1,000,000</div>
                        <div className="font-display font-bold uppercase text-xs tracking-[0.08em] text-[#9FB0CC]">Pledge Target</div>
                    </div>
                </div>

            </section>

            <Footer />
        </div>
    );
};
