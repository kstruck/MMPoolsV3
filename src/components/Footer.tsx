import React from 'react';
import { Logo } from './Logo';

export const Footer: React.FC = () => {
    return (
        <footer className="bg-slate-950 border-t border-slate-800 py-12">
            <div className="max-w-7xl mx-auto px-6">
                <div className="border-t border-slate-900 pt-8 flex flex-col md:flex-row justify-between items-center gap-6 opacity-60">
                    <div className="flex items-center gap-2">
                        <Logo className="w-6 h-6" textClassName="text-sm" />
                    </div>
                    <div className="text-sm text-slate-500">
                        © 2025 MarchMeleePools. All rights reserved.
                    </div>
                    <div className="flex gap-6 text-sm text-slate-500 font-medium">
                        <a href="#privacy" className="hover:text-white transition-colors">Privacy</a>
                        <a href="#terms" className="hover:text-white transition-colors">Terms</a>
                        <a href="#support" className="hover:text-white transition-colors">Support</a>
                    </div>
                </div>
            </div>
        </footer>
    );
};
