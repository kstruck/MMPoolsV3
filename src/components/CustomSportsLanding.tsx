import React from 'react';
import type { User } from '../types';
import { Trophy, Shield, CheckCircle2, Heart } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';

interface CustomSportsLandingProps {
    user?: User | null;
    isManager?: boolean;
    onLogin: () => void;
    onSignup: () => void;
    onLogout?: () => void;
    onCreatePool?: () => void;
    isLoggedIn: boolean;
}

const BRAND = {
    navy: '#0A192F',
    orange: '#FF6600',
    white: '#FFFFFF',
    emerald: '#10B981',
    amber: '#FBBF24',
    lightGray: '#E5E7EB',
};

export const CustomSportsLanding: React.FC<CustomSportsLandingProps> = ({ user, isManager = false, onLogin, onLogout, onCreatePool }) => {
    return (
        <div className="min-h-screen text-white font-sans selection:bg-orange-500 selection:text-white" style={{ backgroundColor: BRAND.navy }}>
            <Header
                user={user || null}
                isManager={isManager}
                onOpenAuth={onLogin}
                onLogout={onLogout || (() => { })}
                onCreatePool={onCreatePool}
            />

            {/* Hero Section */}
            <section className="relative overflow-hidden pt-12 md:pt-20 pb-20 md:pb-32">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full pointer-events-none">
                    <div className="absolute top-20 right-0 w-[500px] h-[500px] rounded-full blur-[120px]" style={{ backgroundColor: `${BRAND.orange}15` }}></div>
                    <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full blur-[120px]" style={{ backgroundColor: '#3B82F615' }}></div>
                </div>

                <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
                    <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-6 md:mb-8 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-700" style={{ backgroundColor: `${BRAND.orange}20`, border: `1px solid ${BRAND.orange}40` }}>
                        <span className="flex h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: BRAND.orange }}></span>
                        <span className="text-xs font-bold tracking-wide uppercase" style={{ color: BRAND.orange }}>Custom Sports Pools</span>
                    </div>

                    <h1 className="text-4xl md:text-7xl font-black text-white tracking-tight mb-6 md:mb-8 leading-tight animate-in fade-in slide-in-from-bottom-8 duration-700" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                        Host Your Pool <br />
                        <span style={{ color: BRAND.orange }}>For Any Sport</span>
                    </h1>

                    <p className="text-lg md:text-xl max-w-2xl mx-auto mb-8 md:mb-10 leading-relaxed animate-in fade-in slide-in-from-bottom-12 duration-700 delay-100" style={{ color: BRAND.lightGray }}>
                        Want to run a golf major pool, NBA playoffs bracket, or a custom sports league challenge? Manage everything from your favorite custom events with our versatile platform.
                    </p>
                </div>
            </section>

            {/* Features Grid */}
            <section id="features" className="py-24 border-y" style={{ backgroundColor: '#0F2540', borderColor: '#334155' }}>
                <div className="max-w-7xl mx-auto px-6">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4" style={{ fontFamily: "'Montserrat', sans-serif" }}>Why Host With Us?</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
                        {[
                            { icon: Trophy, title: "Flexible Formats", desc: "Build brackets, squares, fantasy drafts, or custom pick'ems for any sport." },
                            { icon: Shield, title: "Secure Platform", desc: "Private groups with shareable links and secure entry management." },
                            { icon: CheckCircle2, title: "Custom Rules", desc: "Set your own scoring system, payouts, and rules for every customized game." },
                            { icon: Heart, title: "Charity Focus", desc: "Built-in tools to allocate a portion of the pot directly to a chosen charity." }
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

            <Footer />
        </div>
    );
};
