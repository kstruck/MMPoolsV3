import React from 'react';
import { Link } from 'react-router';
import { Logo } from './Logo';

/* Footer is navy chrome — always dark in both themes. */
const linkCls = 'text-[#9FB0CC] hover:text-gold-300 transition-colors text-sm font-body';
const headCls = 'text-white font-display font-bold uppercase text-[13px] tracking-[0.16em] mb-4';

export const Footer: React.FC = () => {
    return (
        <footer className="bg-navy-950 border-t border-[rgba(230,206,150,0.16)] py-16">
            <div className="max-w-7xl mx-auto px-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
                    <div>
                        <h4 className={headCls}>Products</h4>
                        <div className="flex flex-col gap-2">
                            <Link to="/march-madness" className={linkCls}>March Madness Pools</Link>
                            <Link to="/gameday-squares" className={linkCls}>Super Bowl Squares</Link>
                            <Link to="/nfl-playoffs" className={linkCls}>NFL Playoff Pools</Link>
                            <Link to="/how-it-works?sport=survivor" className={linkCls}>NFL Survivor Pools</Link>
                            <Link to="/how-it-works?sport=pickem" className={linkCls}>Weekly Pick'em Pools</Link>
                            <Link to="/how-it-works?sport=margin" className={linkCls}>NFL Margin Pools</Link>
                            <Link to="/how-it-works?sport=props" className={linkCls}>Side Hustle Props</Link>
                        </div>
                    </div>
                    <div>
                        <h4 className={headCls}>Resources</h4>
                        <div className="flex flex-col gap-2">
                            <Link to="/how-it-works" className={linkCls}>How It Works</Link>
                            <Link to="/pricing" className={linkCls}>Pricing & Hosting</Link>
                            <Link to="/how-it-works?view=strategy" className={linkCls}>Blog & Guides</Link>
                            <Link to="/how-it-works?view=faq" className={linkCls}>Help Center & FAQ</Link>
                        </div>
                    </div>
                    <div>
                        <h4 className={headCls}>Company</h4>
                        <div className="flex flex-col gap-2">
                            <Link to="/about" className={linkCls}>About Us</Link>
                            <Link to="/contact" className={linkCls}>Contact</Link>
                            <Link to="/charity" className={linkCls}>Charity Partnerships</Link>
                        </div>
                    </div>
                    <div>
                        <h4 className={headCls}>Legal</h4>
                        <div className="flex flex-col gap-2">
                            <Link to="/privacy" className={linkCls}>Privacy Policy</Link>
                            <Link to="/terms" className={linkCls}>Terms of Service</Link>
                        </div>
                    </div>
                </div>

                <div className="border-t border-[rgba(230,206,150,0.16)] pt-8 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-2">
                        <a href="/" aria-label="March Melee Pools home"><Logo height="h-10" /></a>
                    </div>
                    <div className="text-sm text-[#7C8BA6] font-body">
                        © 2026 March Melee Pools. All rights reserved.
                    </div>
                    <div className="flex gap-4">
                        <a href="https://twitter.com/marchmeleepools" target="_blank" rel="noopener noreferrer" className="text-[#9FB0CC] hover:text-gold-300 transition-colors text-sm font-display font-bold uppercase tracking-[0.06em]">Twitter</a>
                        <a href="https://facebook.com/marchmeleepools" target="_blank" rel="noopener noreferrer" className="text-[#9FB0CC] hover:text-gold-300 transition-colors text-sm font-display font-bold uppercase tracking-[0.06em]">Facebook</a>
                    </div>
                </div>
            </div>
        </footer>
    );
};
