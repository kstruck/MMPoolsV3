import React from 'react';
import { Link } from 'react-router-dom';
import { Logo } from './Logo';

export const Footer: React.FC = () => {
    return (
        <footer className="bg-slate-950 border-t border-slate-800 py-12">
            <div className="max-w-7xl mx-auto px-6">
                <div className="border-t border-slate-900 pt-8 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-2">
                        <Logo height="h-14" />
                    </div>
                    <div className="text-sm text-white font-bold">
                        © 2026 MarchMeleePools. All rights reserved.
                    </div>
                    <div className="flex gap-6 text-sm text-white font-bold">
                        <Link to="/privacy" className="hover:text-orange-400 transition-colors">Privacy</Link>
                        <Link to="/terms" className="hover:text-orange-400 transition-colors">Terms</Link>
                        <Link to="/how-it-works" className="hover:text-orange-400 transition-colors">Resources</Link>
                        <Link to="/support" className="hover:text-orange-400 transition-colors">Support</Link>
                    </div>
                </div>
            </div>
        </footer>
    );
};
