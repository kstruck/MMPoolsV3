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

export const AboutPage: React.FC<AboutPageProps> = ({ user, isManager = false, onLogin, onLogout, onCreatePool }) => {
    return (
        <div className="min-h-screen text-slate-100 font-sans selection:bg-orange-500 selection:text-white bg-slate-950 flex flex-col">
            <Header
                user={user || null}
                isManager={isManager}
                onOpenAuth={onLogin}
                onLogout={onLogout || (() => { })}
                onCreatePool={onCreatePool}
            />

            {/* Hero Header */}
            <section className="relative overflow-hidden pt-20 pb-16 border-b border-slate-900 bg-slate-900/20">
                <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-indigo-900/10 to-transparent pointer-events-none" />
                
                <div className="max-w-4xl mx-auto px-6 relative z-10 text-center space-y-6">
                    <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-indigo-500/15 border border-indigo-500/20">
                        <Trophy size={14} className="text-indigo-400" />
                        <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">Our Story</span>
                    </div>

                    <h1 className="text-4xl md:text-6xl font-black text-white tracking-tight leading-tight">
                        Revolutionizing <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-indigo-400">Social Sports Pools</span>
                    </h1>
                    
                    <p className="text-base md:text-lg max-w-2xl mx-auto text-slate-400 leading-relaxed">
                        March Melee Pools was founded in 2026 to solve a simple problem: spreadsheet anxiety. We took manual math, missing payments, and stale score updates and replaced them with standard-setting automation.
                    </p>
                </div>
            </section>

            {/* Bento Grid Features */}
            <section className="py-16 max-w-7xl mx-auto px-6 w-full flex-grow space-y-16">
                
                {/* Section Title */}
                <div className="text-center space-y-2">
                    <h2 className="text-2xl md:text-3xl font-black text-white">The Platform Engine</h2>
                    <p className="text-sm text-slate-400 max-w-lg mx-auto">We build automated solutions designed to let commissioners sit back and enjoy the games.</p>
                </div>

                {/* Bento Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    
                    {/* Bento Cell 1: Our Mission */}
                    <div className="lg:col-span-2 p-8 rounded-3xl bg-slate-900/40 border border-slate-900 hover:border-slate-800 transition-colors flex flex-col justify-between space-y-6">
                        <div className="space-y-4">
                            <div className="p-3 bg-orange-500/15 text-orange-400 rounded-2xl w-fit border border-orange-500/25">
                                <Sparkles size={24} />
                            </div>
                            <h3 className="text-2xl font-black text-white">The Core Mission</h3>
                            <p className="text-slate-400 text-sm leading-relaxed">
                                We believe sports pools should bring friends, family, and coworkers closer together—not burden commissioners with tech support and constant administrative reminders. By designing real-time integrations and beautiful glassmorphism dashboards, we have crafted a sports platform that feels premium and premium-grade.
                            </p>
                        </div>
                        <div className="pt-6 border-t border-slate-850 flex items-center justify-between text-xs text-orange-400 font-bold group cursor-pointer" onClick={() => window.location.href = '/how-it-works'}>
                            <span>Learn how our platform works</span>
                            <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                        </div>
                    </div>

                    {/* Bento Cell 2: Automated Scoring */}
                    <div className="p-8 rounded-3xl bg-slate-900/40 border border-slate-900 hover:border-slate-800 transition-colors space-y-4 flex flex-col justify-between">
                        <div className="space-y-4">
                            <div className="p-3 bg-indigo-500/15 text-indigo-400 rounded-2xl w-fit border border-indigo-500/25">
                                <Zap size={24} />
                            </div>
                            <h3 className="text-xl font-bold text-white">Firestore Real-Time Scoring</h3>
                            <p className="text-slate-400 text-xs leading-relaxed">
                                Standings shouldn't wait for the morning paper. Our custom Firestore engine pulls official sports feeds and computes point matrices in under one second, updating player ranks instantly.
                            </p>
                        </div>
                        <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Live Integrations</div>
                    </div>

                    {/* Bento Cell 3: What-If Simulator */}
                    <div className="p-8 rounded-3xl bg-slate-900/40 border border-slate-900 hover:border-slate-800 transition-colors space-y-4 flex flex-col justify-between">
                        <div className="space-y-4">
                            <div className="p-3 bg-emerald-500/15 text-emerald-400 rounded-2xl w-fit border border-emerald-500/25">
                                <PlayCircle size={24} />
                            </div>
                            <h3 className="text-xl font-bold text-white">What-If Standing Simulators</h3>
                            <p className="text-slate-400 text-xs leading-relaxed">
                                Let players preview standing outcomes recursively. Our simulator maps every potential game outcome, displaying which remaining games matter most to their ranking.
                            </p>
                        </div>
                        <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Recursive Analytics</div>
                    </div>

                    {/* Bento Cell 4: AI Commissioner */}
                    <div className="p-8 rounded-3xl bg-slate-900/40 border border-slate-900 hover:border-slate-800 transition-colors space-y-4 flex flex-col justify-between">
                        <div className="space-y-4">
                            <div className="p-3 bg-fuchsia-500/15 text-fuchsia-400 rounded-2xl w-fit border border-fuchsia-500/25">
                                <Star size={24} />
                            </div>
                            <h3 className="text-xl font-bold text-white">Custom AI Commissioner</h3>
                            <p className="text-slate-400 text-xs leading-relaxed">
                                Enable the custom AI to trigger weekly league updates, mock trades, flag upset margins, and draft lighthearted trash-talk newsletters to boost participant engagement.
                            </p>
                        </div>
                        <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500">LLM Integrations</div>
                    </div>

                    {/* Bento Cell 5: Audited Security */}
                    <div className="p-8 rounded-3xl bg-slate-900/40 border border-slate-900 hover:border-slate-800 transition-colors space-y-4 flex flex-col justify-between">
                        <div className="space-y-4">
                            <div className="p-3 bg-red-500/15 text-red-400 rounded-2xl w-fit border border-red-500/25">
                                <Shield size={24} />
                            </div>
                            <h3 className="text-xl font-bold text-white">Tamper-Proof Audit Logs</h3>
                            <p className="text-slate-400 text-xs leading-relaxed">
                                Total transparency. Every bracket modification, payment registration, and randomly assigned number grid is permanently written to immutable database logs.
                            </p>
                        </div>
                        <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Secure Database</div>
                    </div>
                </div>

                {/* Section 3: Social & Charity Impact */}
                <div className="p-8 md:p-12 rounded-3xl bg-gradient-to-br from-indigo-950/20 to-emerald-950/10 border border-emerald-500/20 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                    <div className="lg:col-span-8 space-y-4">
                        <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-emerald-500/15 border border-emerald-500/20 text-emerald-400">
                            <Heart size={14} className="animate-pulse" />
                            <span className="text-xs font-bold uppercase tracking-wider">Social Impact</span>
                        </div>
                        <h3 className="text-3xl font-black text-white leading-tight">
                            The $1,000,000 Donation Goal
                        </h3>
                        <p className="text-slate-400 text-sm leading-relaxed max-w-2xl">
                            We are committed to helping organizations and friends dedicate a portion of their pools to genuine charity campaigns. Our platform has dedicated built-in charity tools that handle donations cleanly, with the ultimate mission of raising $1,000,000 for vetted 501(c)(3) charities.
                        </p>
                    </div>
                    <div className="lg:col-span-4 bg-emerald-950/30 border border-emerald-500/10 p-6 rounded-2xl space-y-2 text-center">
                        <div className="text-3xl font-black text-emerald-400">$1,000,000</div>
                        <div className="text-xs text-slate-400 font-bold uppercase tracking-wide">Pledge Target</div>
                    </div>
                </div>

            </section>

            <Footer />
        </div>
    );
};
