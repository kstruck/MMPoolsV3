import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { cn } from './cn';

/** Outline pill theme toggle — lives on the always-dark navy chrome. */
export const ThemeToggle: React.FC<{ className?: string }> = ({ className }) => {
    const { theme, toggleTheme } = useTheme();
    return (
        <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className={cn(
                'inline-flex items-center gap-2 rounded-full border border-white/25 px-3 py-1.5',
                'font-display font-bold uppercase text-[12px] tracking-[0.08em] text-white/80',
                'transition-colors hover:border-gold-500 hover:text-gold-300',
                className
            )}
        >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
    );
};
