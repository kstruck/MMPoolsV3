import React from 'react';
import type { User } from '../types';
import { Trophy, Shield, CheckCircle2, Heart } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';

interface MarchMadnessLandingProps {
    user?: User | null;
    isManager?: boolean;
    onLogin: () => void;
    onSignup: () => void;
    onLogout?: () => void;
    onCreatePool?: () => void;
    isLoggedIn: boolean;
}

/* Nav / hero / footer stay navy chrome in both themes; the content sections
   between them flip cream <-> navy via CSS-var surfaces (bg-page/surface/card). */

export const MarchMadnessLanding: React.FC<MarchMadnessLandingProps> = ({ user, isManager = false, onLogin, onLogout, onCreatePool }) => {
    return (
        <div className="min-h-screen bg-page text-[color:var(--text)] font-body">
            <Header
                user={user || null}
                isManager={isManager}
                onOpenAuth={onLogin}
                onLogout={onLogout || (() => { })}
                onCreatePool={onCreatePool}
            />

            {/* Hero Section — navy chrome (always dark) */}
            <section className="relative overflow-hidden bg-navy-950 text-white pt-12 md:pt-20 pb-20 md:pb-32">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full pointer-events-none">
                    <div className="absolute top-20 right-0 w-[500px] h-[500px] rounded-full blur-[120px] bg-brandred-600/15"></div>
                    <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full blur-[120px] bg-navy-600/25"></div>
                </div>

                <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
                    <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-6 md:mb-8 bg-gold-500/10 border border-gold-500/25 animate-in fade-in slide-in-from-bottom-4 duration-700">
                        <span className="flex h-2 w-2 rounded-full bg-gold-400 animate-live-pulse"></span>
                        <span className="font-display font-bold uppercase text-xs tracking-[0.16em] text-gold-400">March Madness Brackets</span>
                    </div>

                    <h1 className="font-display font-extrabold uppercase text-4xl md:text-7xl text-white tracking-tight mb-6 md:mb-8 leading-[0.9] animate-in fade-in slide-in-from-bottom-8 duration-700">
                        The Ultimate <br />
                        <span className="text-gold-400">Tournament Experience</span>
                    </h1>

                    <p className="font-body text-[#9FB0CC] text-lg md:text-xl max-w-2xl mx-auto mb-8 md:mb-10 leading-relaxed animate-in fade-in slide-in-from-bottom-12 duration-700 delay-100">
                        Host your own March Madness pool with automated scoring, live updates, and custom payout rules. Engage your office, friends, or raise money for charity with our professional platform.
                    </p>
                </div>
            </section>

            {/* Features Grid — flips */}
            <section id="features" className="py-24 border-y border-line bg-surface">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="text-center mb-16">
                        <h2 className="font-display font-extrabold uppercase text-3xl md:text-4xl leading-[0.95] text-[color:var(--text)] mb-4">Why Host With Us?</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
                        {[
                            { icon: Trophy, title: "Automated Scoring", desc: "Brackets update automatically after every game, saving you hours of manual work." },
                            { icon: Shield, title: "Secure Platform", desc: "Private groups with shareable links and secure entry management." },
                            { icon: CheckCircle2, title: "Custom Rules", desc: "Set your own scoring system, upset bonuses, and payout structures." },
                            { icon: Heart, title: "Charity Focus", desc: "Built-in tools to allocate a portion of the pot directly to a chosen charity." }
                        ].map((feature, i) => (
                            <div key={i} className="p-8 rounded-2xl bg-card border border-line transition-colors group flex flex-col h-full hover:border-gold-500/50">
                                <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 bg-gold-500/15 border border-gold-500/25">
                                    <feature.icon size={28} className="text-gold-600 dark:text-gold-400" />
                                </div>
                                <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-3">{feature.title}</h3>
                                <p className="font-body text-muted leading-relaxed flex-grow">{feature.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <Footer />
        </div>
    );
};
