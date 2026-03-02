import React from 'react';
import type { User } from '../types';
import { Header } from './Header';
import { Footer } from './Footer';

interface ContactPageProps {
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

export const ContactPage: React.FC<ContactPageProps> = ({ user, isManager = false, onLogin, onLogout, onCreatePool }) => {
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
                        Contact Us
                    </h1>
                    <p className="text-lg md:text-xl max-w-2xl mx-auto mb-8 md:mb-10 leading-relaxed" style={{ color: BRAND.lightGray }}>
                        Have questions? Need help setting up your pool? We are here to help.
                    </p>
                    <div className="bg-[#1E293B] border border-slate-700 p-8 rounded-xl max-w-lg mx-auto">
                        <p className="mb-4 text-orange-400 font-bold">Email Support</p>
                        <p>support@example.com</p>
                        <p className="mt-8 text-sm text-slate-400">We typically respond within 24 hours.</p>
                    </div>
                </div>
            </section>
            <Footer />
        </div>
    );
};
