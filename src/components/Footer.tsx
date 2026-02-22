import React from 'react';
import { Link } from 'react-router-dom';
import { Logo } from './Logo';

export const Footer: React.FC = () => {
    return (
        <footer className="bg-slate-950 border-t border-slate-800 py-16">
            <div className="max-w-7xl mx-auto px-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
                    <div>
                        <h4 className="text-white font-bold mb-4">Products</h4>
                        <div className="flex flex-col gap-2">
                            <Link to="/march-madness" className="text-slate-400 hover:text-orange-400 transition-colors text-sm font-medium">March Madness Pools</Link>
                            <Link to="/super-bowl-squares" className="text-slate-400 hover:text-orange-400 transition-colors text-sm font-medium">Super Bowl Squares</Link>
                            <Link to="/nfl-playoffs" className="text-slate-400 hover:text-orange-400 transition-colors text-sm font-medium">NFL Playoff Pools</Link>
                            <Link to="/custom-sports" className="text-slate-400 hover:text-orange-400 transition-colors text-sm font-medium">Custom Sports Betting</Link>
                        </div>
                    </div>
                    <div>
                        <h4 className="text-white font-bold mb-4">Resources</h4>
                        <div className="flex flex-col gap-2">
                            <Link to="/how-it-works" className="text-slate-400 hover:text-orange-400 transition-colors text-sm font-medium">How It Works</Link>
                            <Link to="/pricing" className="text-slate-400 hover:text-orange-400 transition-colors text-sm font-medium">Pricing</Link>
                            <Link to="/blog/pool-hosting-guide" className="text-slate-400 hover:text-orange-400 transition-colors text-sm font-medium">Blog & Guides</Link>
                            <Link to="/support" className="text-slate-400 hover:text-orange-400 transition-colors text-sm font-medium">Help Center & FAQ</Link>
                        </div>
                    </div>
                    <div>
                        <h4 className="text-white font-bold mb-4">Company</h4>
                        <div className="flex flex-col gap-2">
                            <Link to="/about" className="text-slate-400 hover:text-orange-400 transition-colors text-sm font-medium">About Us</Link>
                            <Link to="/contact" className="text-slate-400 hover:text-orange-400 transition-colors text-sm font-medium">Contact</Link>
                            <Link to="/charity" className="text-slate-400 hover:text-orange-400 transition-colors text-sm font-medium">Charity Partnerships</Link>
                        </div>
                    </div>
                    <div>
                        <h4 className="text-white font-bold mb-4">Legal</h4>
                        <div className="flex flex-col gap-2">
                            <Link to="/privacy" className="text-slate-400 hover:text-orange-400 transition-colors text-sm font-medium">Privacy Policy</Link>
                            <Link to="/terms" className="text-slate-400 hover:text-orange-400 transition-colors text-sm font-medium">Terms of Service</Link>
                        </div>
                    </div>
                </div>

                <div className="border-t border-slate-900 pt-8 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-2">
                        <Logo height="h-10" />
                    </div>
                    <div className="text-sm text-slate-500 font-bold">
                        © 2026 March Melee Pools. All rights reserved.
                    </div>
                    <div className="flex gap-4">
                        <a href="https://twitter.com/marchmeleepools" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors text-sm font-bold">Twitter</a>
                        <a href="https://facebook.com/marchmeleepools" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors text-sm font-bold">Facebook</a>
                    </div>
                </div>
            </div>
        </footer>
    );
};
