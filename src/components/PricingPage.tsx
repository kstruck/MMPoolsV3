import React from 'react';
import type { User } from '../types';
import { Header } from './Header';
import { Footer } from './Footer';

interface PricingPageProps {
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

export const PricingPage: React.FC<PricingPageProps> = ({ user, isManager = false, onLogin, onLogout, onCreatePool }) => {
    return (
        <div className="min-h-screen text-white font-sans selection:bg-orange-500 selection:text-white" style={{ backgroundColor: BRAND.navy }}>
            <Header
                user={user || null}
                isManager={isManager}
                onOpenAuth={onLogin}
                onLogout={onLogout || (() => { })}
                onCreatePool={onCreatePool}
            />

            <section className="relative overflow-hidden pt-12 md:pt-20 pb-20 md:pb-32">
                <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
                    <h1 className="text-4xl md:text-6xl font-black text-white tracking-tight mb-6 md:mb-8 leading-tight" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                        Pricing
                    </h1>
                    <p className="text-lg md:text-xl max-w-2xl mx-auto mb-8 md:mb-10 leading-relaxed" style={{ color: BRAND.lightGray }}>
                        Our platform offers flexible pricing options for hosting any sports pool you need. Set up office pools, charity fundraisers, or just a small bracket pool with friends.
                    </p>
                    <div className="bg-[#1E293B] border border-slate-700 p-8 rounded-xl">
                        <h2 className="text-2xl font-bold mb-4">Contact us for custom pricing</h2>
                        <p>We'll work with you to handle payments based on your league's needs.</p>
                    </div>
                </div>
            </section>
            <Footer />
        </div>
    );
};
