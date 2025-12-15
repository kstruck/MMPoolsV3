import React from 'react';
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
                        © 2025 MarchMeleePools. All rights reserved.
                    </div>
                    <div className="flex gap-6 text-sm text-white font-bold">
                        <a href="#privacy" className="hover:text-orange-400 transition-colors">Privacy</a>
                        <a href="#terms" className="hover:text-orange-400 transition-colors">Terms</a>
                        <a href="#support" className="hover:text-orange-400 transition-colors">Support</a>
                    </div>
                </div>
            </div>
        </footer>
    );
};
