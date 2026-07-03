import React from 'react';
import type { User } from '../types';
import { Header } from './Header';
import { Footer } from './Footer';

interface CharityPageProps {
    user?: User | null;
    isManager?: boolean;
    onLogin: () => void;
    onSignup: () => void;
    onLogout?: () => void;
    onCreatePool?: () => void;
    isLoggedIn: boolean;
}

/* Marketing page is navy chrome end-to-end — always dark in both themes. */

export const CharityPage: React.FC<CharityPageProps> = ({ user, isManager = false, onLogin, onLogout, onCreatePool }) => {
    return (
        <div className="min-h-screen bg-navy-950 text-white font-body">
            <Header
                user={user || null}
                isManager={isManager}
                onOpenAuth={onLogin}
                onLogout={onLogout || (() => { })}
                onCreatePool={onCreatePool}
            />

            <section className="relative overflow-hidden pt-12 md:pt-20 pb-20 md:pb-32">
                <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
                    <h1 className="font-display font-extrabold uppercase text-4xl md:text-6xl text-white tracking-tight mb-6 md:mb-8 leading-[0.9]">
                        Charity & Fundraising
                    </h1>
                    <p className="font-body text-[#9FB0CC] text-lg md:text-xl max-w-2xl mx-auto mb-8 md:mb-10 leading-relaxed">
                        Our platform makes it easy to run charity sports pools and fundraising campaigns.
                    </p>
                    <div className="bg-navy-900 border border-[rgba(230,206,150,0.16)] p-8 rounded-2xl max-w-3xl mx-auto text-left font-body text-[#EDF1F8]">
                        <p className="mb-4">You can optionally deduct a percentage of the total prize pot to be directed to a charitable cause of your choosing.</p>
                        <p>We provide full transparency to pool entrants regarding the charity percentage, keeping your fundraiser honest and clear.</p>
                    </div>
                </div>
            </section>
            <Footer />
        </div>
    );
};
