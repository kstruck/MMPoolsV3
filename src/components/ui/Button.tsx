import React from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'premium' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
    'inline-flex items-center justify-center gap-2 font-display font-bold uppercase tracking-[0.05em] ' +
    'transition-all duration-150 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-navy-600 focus-visible:ring-offset-2 ' +
    'disabled:translate-y-0 disabled:cursor-not-allowed disabled:shadow-none disabled:bg-cream disabled:text-faint disabled:border-line';

const VARIANTS: Record<ButtonVariant, string> = {
    primary: 'bg-brandred-600 text-white shadow-[0_6px_16px_rgba(196,52,46,0.28)] hover:bg-brandred-500',
    premium: 'bg-gold-foil text-navy-900 shadow-[0_6px_16px_rgba(140,109,51,0.28)] hover:brightness-105',
    secondary: 'bg-navy-800 text-white hover:bg-navy-700',
    ghost:
        'border-[1.5px] border-navy-800 text-navy-800 hover:bg-navy-800 hover:text-white ' +
        'dark:border-[color:var(--line)] dark:text-[color:var(--text)] dark:hover:bg-white/10 dark:hover:text-white',
};

const SIZES: Record<ButtonSize, string> = {
    sm: 'text-[14px] px-4 py-2 rounded-[8px]',
    md: 'text-[16px] px-[26px] py-[13px] rounded-md',
    lg: 'text-[17px] px-[34px] py-4 rounded-lg',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ variant = 'primary', size = 'md', className, type = 'button', ...props }, ref) => (
        <button
            ref={ref}
            type={type}
            className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
            {...props}
        />
    )
);
Button.displayName = 'Button';

/** Anchor styled as a Button — for links / router navigation. */
export interface ButtonLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
}

export const ButtonLink = React.forwardRef<HTMLAnchorElement, ButtonLinkProps>(
    ({ variant = 'primary', size = 'md', className, ...props }, ref) => (
        <a ref={ref} className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props} />
    )
);
ButtonLink.displayName = 'ButtonLink';
