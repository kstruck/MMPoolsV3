import React, { useId } from 'react';
import { cn } from './cn';

/* Form controls — cream fill, 1.5px line border, navy focus, red error.
   Labels: Saira Condensed 700 uppercase 12px tracking .08em. */

export const FieldLabel: React.FC<React.LabelHTMLAttributes<HTMLLabelElement>> = ({
    className,
    ...props
}) => (
    <label
        className={cn(
            'block mb-1.5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)]',
            className
        )}
        {...props}
    />
);

const CONTROL_BASE =
    'w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] ' +
    'text-[color:var(--text)] placeholder:text-faint transition-colors ' +
    'focus:border-navy-600 focus:bg-surface focus:outline-none';

const CONTROL_ERROR = 'border-brandred-500 bg-[#FCEEED] focus:border-brandred-500 dark:text-ink';

export const FieldError: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
    className,
    ...props
}) => <p className={cn('mt-1.5 font-body text-[13px] text-brandred-600', className)} {...props} />;

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ label, error, className, id, ...props }, ref) => {
        const autoId = useId();
        const inputId = id ?? autoId;
        return (
            <div>
                {label && <FieldLabel htmlFor={inputId}>{label}</FieldLabel>}
                <input
                    ref={ref}
                    id={inputId}
                    className={cn(CONTROL_BASE, error && CONTROL_ERROR, className)}
                    aria-invalid={error ? true : undefined}
                    {...props}
                />
                {error && <FieldError>{error}</FieldError>}
            </div>
        );
    }
);
Input.displayName = 'Input';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label?: string;
    error?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
    ({ label, error, className, id, children, ...props }, ref) => {
        const autoId = useId();
        const selectId = id ?? autoId;
        return (
            <div>
                {label && <FieldLabel htmlFor={selectId}>{label}</FieldLabel>}
                <select
                    ref={ref}
                    id={selectId}
                    className={cn(CONTROL_BASE, 'cursor-pointer', error && CONTROL_ERROR, className)}
                    aria-invalid={error ? true : undefined}
                    {...props}
                >
                    {children}
                </select>
                {error && <FieldError>{error}</FieldError>}
            </div>
        );
    }
);
Select.displayName = 'Select';

export interface ToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label?: string;
    disabled?: boolean;
    className?: string;
}

export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, label, disabled, className }) => (
    <label className={cn('inline-flex items-center gap-3', disabled ? 'opacity-50' : 'cursor-pointer', className)}>
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={cn(
                'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150',
                checked ? 'bg-navy-800 dark:bg-gold-600' : 'bg-line'
            )}
        >
            <span
                className={cn(
                    'absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform duration-150',
                    checked && 'translate-x-5'
                )}
            />
        </button>
        {label && (
            <span className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)]">
                {label}
            </span>
        )}
    </label>
);

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
    label?: string;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
    ({ label, className, id, ...props }, ref) => {
        const autoId = useId();
        const boxId = id ?? autoId;
        return (
            <label htmlFor={boxId} className={cn('inline-flex items-center gap-2.5 cursor-pointer', className)}>
                <span className="relative inline-flex">
                    <input
                        ref={ref}
                        id={boxId}
                        type="checkbox"
                        className={cn(
                            'peer appearance-none size-5 shrink-0 rounded-[5px] border-[1.5px] border-line bg-page',
                            'checked:bg-navy-800 checked:border-navy-800 transition-colors cursor-pointer',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-600'
                        )}
                        {...props}
                    />
                    <svg
                        viewBox="0 0 12 12"
                        className="pointer-events-none absolute inset-0 size-5 p-[3px] text-white opacity-0 peer-checked:opacity-100 transition-opacity"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="M2 6.5L4.5 9L10 3" />
                    </svg>
                </span>
                {label && <span className="font-body text-[15px] text-[color:var(--text)]">{label}</span>}
            </label>
        );
    }
);
Checkbox.displayName = 'Checkbox';

export interface RangeSliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
    label?: string;
}

/* ponytail: native range with gold accent; custom gold-foil track fill if pixel parity demanded later */
export const RangeSlider = React.forwardRef<HTMLInputElement, RangeSliderProps>(
    ({ label, className, id, ...props }, ref) => {
        const autoId = useId();
        const sliderId = id ?? autoId;
        return (
            <div>
                {label && <FieldLabel htmlFor={sliderId}>{label}</FieldLabel>}
                <input
                    ref={ref}
                    id={sliderId}
                    type="range"
                    className={cn('w-full accent-gold-600 cursor-pointer', className)}
                    {...props}
                />
            </div>
        );
    }
);
RangeSlider.displayName = 'RangeSlider';
